import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as tf from "@tensorflow/tfjs";
import { Bar, Doughnut, Line, Radar } from "react-chartjs-2";
import { buildDisasterInsights } from "../utils/disasterFromAnalytics";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  RadialLinearScale,
  Tooltip,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  RadialLinearScale,
  Tooltip,
  Legend,
  Filler,
);

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function riskBadge(score) {
  if (score >= 0.7) return "badge-error";
  if (score >= 0.4) return "badge-pending";
  return "badge-success";
}

function statusBadge(status) {
  if (status === "CRITICAL") return "badge-error";
  if (status === "WATCH") return "badge-pending";
  return "badge-success";
}

const chartAxis = {
  ticks: { color: "rgba(200,216,240,0.78)", font: { size: 11 } },
  grid: { color: "rgba(0,212,255,0.08)" },
  border: { color: "rgba(0,212,255,0.2)" },
};

export default function AIAnalytics() {
  const location = useLocation();
  const queryPath = useMemo(
    () => new URLSearchParams(location.search).get("path") || "",
    [location.search],
  );

  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState(queryPath);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [modelRunning, setModelRunning] = useState(false);
  const [modelForecast, setModelForecast] = useState(null);
  const [lossCurve, setLossCurve] = useState([]);

  useEffect(() => {
    fetch("/api/visualization/files")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setFiles(list);
        if (!queryPath && list.length > 0 && !selectedPath) {
          setSelectedPath(list[0].path);
        }
      })
      .catch(() => {});
  }, [queryPath, selectedPath]);

  useEffect(() => {
    if (!queryPath) return;
    setSelectedPath(queryPath);
  }, [queryPath]);

  async function loadAnalytics(path = selectedPath) {
    if (!path) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/visualization/analytics?path=${encodeURIComponent(path)}&sample_step=5`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${r.status}`);
      }
      const d = await r.json();
      setAnalytics(d);
      setModelForecast(null);
      setLossCurve([]);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedPath) return;
    loadAnalytics(selectedPath);
  }, [selectedPath]);

  async function runTensorForecast() {
    const timeline = analytics?.timeline || [];
    if (timeline.length < 10) {
      setError("Need at least 10 timeline points for TensorFlow forecast.");
      return;
    }

    setModelRunning(true);
    setError("");

    let xs;
    let ys;
    let xLast;
    let predTensor;
    let model;

    try {
      const maxVehicle = Math.max(
        1,
        ...timeline.map((p) => Number(p.vehicle_count || 0)),
      );

      const xsData = [];
      const ysData = [];

      for (let i = 0; i < timeline.length - 1; i += 1) {
        const now = timeline[i];
        const next = timeline[i + 1];

        xsData.push([
          Number(now.density || 0),
          Number(now.avg_speed_kmh || 0) / 30,
          Number(now.vehicle_count || 0) / maxVehicle,
          Number(now.congestion_score || 0),
          Number(now.risk_score || 0),
        ]);
        ysData.push([Number(next.risk_score || 0)]);
      }

      xs = tf.tensor2d(xsData);
      ys = tf.tensor2d(ysData);

      model = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [5], units: 24, activation: "relu" }),
          tf.layers.dense({ units: 12, activation: "relu" }),
          tf.layers.dense({ units: 1, activation: "sigmoid" }),
        ],
      });

      model.compile({
        optimizer: tf.train.adam(0.01),
        loss: "meanSquaredError",
      });

      const losses = [];
      await model.fit(xs, ys, {
        epochs: 36,
        batchSize: Math.min(16, xsData.length),
        shuffle: true,
        verbose: 0,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            losses.push({
              epoch: epoch + 1,
              loss: Number(logs?.loss || 0),
            });
          },
        },
      });

      const last = timeline[timeline.length - 1];
      xLast = tf.tensor2d([
        [
          Number(last.density || 0),
          Number(last.avg_speed_kmh || 0) / 30,
          Number(last.vehicle_count || 0) / maxVehicle,
          Number(last.congestion_score || 0),
          Number(last.risk_score || 0),
        ],
      ]);

      predTensor = model.predict(xLast);
      const nextRisk = Number((await predTensor.data())[0] || 0);

      let rolling = nextRisk;
      const horizon = [];
      for (let i = 0; i < 10; i += 1) {
        rolling = clamp(rolling * 0.9 + Number(last.congestion_score || 0) * 0.1, 0, 1);
        horizon.push(Number(rolling.toFixed(4)));
      }

      const finalLoss = losses.length ? losses[losses.length - 1].loss : 0.2;
      const confidence = clamp(
        Math.round((1 - clamp(finalLoss / 0.35, 0, 1)) * 100),
        12,
        98,
      );

      setLossCurve(losses);
      setModelForecast({
        nextRisk: Number(nextRisk.toFixed(4)),
        confidence,
        finalLoss: Number(finalLoss.toFixed(6)),
        horizon,
      });
    } catch (e) {
      setError(`TensorFlow forecast failed: ${e?.message || e}`);
    } finally {
      if (predTensor) predTensor.dispose();
      if (xLast) xLast.dispose();
      if (xs) xs.dispose();
      if (ys) ys.dispose();
      if (model) model.dispose();
      setModelRunning(false);
    }
  }

  const timeline = analytics?.timeline || [];
  const summary = analytics?.summary || {};
  const kpis = analytics?.kpis || {};
  const hotspots = analytics?.hotspots || { density: [], stopped: [], clusters: [] };
  const recs = analytics?.recommendations || [];
  const feedback = analytics?.report?.feedback || [];
  const disaster = useMemo(() => buildDisasterInsights(analytics), [analytics]);

  const labels = timeline.map((t) => String(t.frame));

  const flowData = {
    labels,
    datasets: [
      {
        label: "Vehicle Count",
        data: timeline.map((t) => t.vehicle_count),
        borderColor: "#00d4ff",
        backgroundColor: "rgba(0,212,255,0.22)",
        fill: true,
        tension: 0.28,
        yAxisID: "yCount",
      },
      {
        label: "Avg Speed (km/h)",
        data: timeline.map((t) => t.avg_speed_kmh),
        borderColor: "#00ff88",
        backgroundColor: "rgba(0,255,136,0.18)",
        fill: false,
        tension: 0.24,
        yAxisID: "ySpeed",
      },
    ],
  };

  const flowOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "rgba(220,240,255,0.92)" } } },
    scales: {
      x: chartAxis,
      yCount: { ...chartAxis, position: "left" },
      ySpeed: { ...chartAxis, position: "right", grid: { drawOnChartArea: false } },
    },
  };

  const riskData = {
    labels,
    datasets: [
      {
        label: "Congestion Score",
        data: timeline.map((t) => t.congestion_score),
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245,158,11,0.2)",
        fill: false,
        tension: 0.25,
      },
      {
        label: "Risk Score",
        data: timeline.map((t) => t.risk_score),
        borderColor: "#ff4060",
        backgroundColor: "rgba(255,64,96,0.25)",
        fill: true,
        tension: 0.25,
      },
    ],
  };

  const smallLineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "rgba(220,240,255,0.92)" } } },
    scales: {
      x: chartAxis,
      y: { ...chartAxis, min: 0, max: 1 },
    },
  };

  const congestionDistData = {
    labels: ["Low", "Medium", "High"],
    datasets: [
      {
        label: "Frames",
        data: [
          Number(analytics?.distributions?.congestion_bins?.LOW || 0),
          Number(analytics?.distributions?.congestion_bins?.MEDIUM || 0),
          Number(analytics?.distributions?.congestion_bins?.HIGH || 0),
        ],
        backgroundColor: ["rgba(0,255,136,0.5)", "rgba(245,158,11,0.5)", "rgba(255,64,96,0.5)"],
        borderColor: ["#00ff88", "#f59e0b", "#ff4060"],
        borderWidth: 1,
      },
    ],
  };

  const classTotals = analytics?.distributions?.class_totals || {};
  const classData = {
    labels: ["Car", "Bike", "Bus", "Truck", "Other"],
    datasets: [
      {
        data: [
          Number(classTotals.car || 0),
          Number(classTotals.bike || 0),
          Number(classTotals.bus || 0),
          Number(classTotals.truck || 0),
          Number(classTotals.other || 0),
        ],
        backgroundColor: [
          "rgba(0,212,255,0.65)",
          "rgba(0,255,136,0.65)",
          "rgba(124,58,237,0.65)",
          "rgba(245,158,11,0.65)",
          "rgba(255,64,96,0.65)",
        ],
        borderColor: ["#00d4ff", "#00ff88", "#7c3aed", "#f59e0b", "#ff4060"],
      },
    ],
  };

  const radarData = {
    labels: ["Throughput", "Stability", "Safety", "Readiness"],
    datasets: [
      {
        label: "Junction KPI Radar",
        data: [
          Number(kpis.throughput_index || 0),
          Number(kpis.stability_index || 0),
          Number(kpis.safety_index || 0),
          Number(kpis.junction_readiness || 0),
        ],
        borderColor: "#00d4ff",
        backgroundColor: "rgba(0,212,255,0.25)",
      },
    ],
  };

  const lossData = {
    labels: lossCurve.map((x) => x.epoch),
    datasets: [
      {
        label: "Training Loss",
        data: lossCurve.map((x) => x.loss),
        borderColor: "#7c3aed",
        backgroundColor: "rgba(124,58,237,0.24)",
        fill: true,
        tension: 0.24,
      },
    ],
  };

  const twinScenarios = disaster?.digital_twin?.scenarios || [];
  const disasterScenarioData = {
    labels: twinScenarios.map((s) => s.name),
    datasets: [
      {
        label: "Resilience Index",
        data: twinScenarios.map((s) => Number(s.resilience_index || 0)),
        backgroundColor: "rgba(0,212,255,0.52)",
        borderColor: "#00d4ff",
        borderWidth: 1,
      },
      {
        label: "ETA Gain Projection %",
        data: twinScenarios.map((s) => Number(s.eta_gain_projection_pct || 0)),
        backgroundColor: "rgba(0,255,136,0.45)",
        borderColor: "#00ff88",
        borderWidth: 1,
      },
    ],
  };

  const disasterRiskProjectionData = {
    labels: (disaster?.digital_twin?.projected_risk_timeline || []).map((_, i) => `T+${i + 1}`),
    datasets: [
      {
        label: "Projected Risk",
        data: disaster?.digital_twin?.projected_risk_timeline || [],
        borderColor: "#ff4060",
        backgroundColor: "rgba(255,64,96,0.25)",
        fill: true,
        tension: 0.24,
      },
    ],
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">AI Analytics Lab</div>
        <div className="page-subtitle">
          TensorFlow Forecasting, Congestion Curves, Hotspot Mining, and Junction Diagnostics
        </div>
      </div>

      <div className="page-body fade-in" style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px, 2fr) repeat(4, auto)",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Replay Source</label>
              <select
                className="form-control"
                value={selectedPath}
                onChange={(e) => setSelectedPath(e.target.value)}
              >
                {files.length === 0 && <option value="">(no replay files found)</option>}
                {files.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="btn btn-primary"
              onClick={() => loadAnalytics(selectedPath)}
              disabled={!selectedPath || loading}
            >
              {loading ? "Refreshing..." : "Refresh Analytics"}
            </button>

            <button
              className="btn btn-success"
              onClick={runTensorForecast}
              disabled={!analytics || modelRunning}
            >
              {modelRunning ? "Training TF Model..." : "Run TensorFlow Forecast"}
            </button>

            <Link
              className="btn btn-ghost"
              to={`/junction-report?path=${encodeURIComponent(selectedPath || "")}`}
            >
              Open Junction Report
            </Link>
          </div>

          {error && <div className="alert alert-error" style={{ marginBottom: 0 }}>{error}</div>}
        </div>

        <div className="stat-row" style={{ marginBottom: 0 }}>
          <div className="stat-card">
            <div className="stat-label">Frames</div>
            <div className="stat-value">{summary.frames_total ?? 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Vehicles</div>
            <div className="stat-value">{Number(summary.avg_vehicle_count || 0).toFixed(1)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Speed</div>
            <div className="stat-value">
              {Number(summary.avg_speed_kmh || 0).toFixed(1)}
              <span className="stat-unit">km/h</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Junction Readiness</div>
            <div className="stat-value">{Number(kpis.junction_readiness || 0).toFixed(1)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Risk</div>
            <div className="stat-value">{Number(summary.avg_risk_score || 0).toFixed(3)}</div>
            <div className={`badge ${riskBadge(Number(summary.avg_risk_score || 0))}`} style={{ marginTop: 8 }}>
              <span className="badge-dot" />
              {Number(summary.avg_risk_score || 0) >= 0.7
                ? "Critical"
                : Number(summary.avg_risk_score || 0) >= 0.4
                  ? "Watch"
                  : "Stable"}
            </div>
          </div>
        </div>

        <div className="panel-grid panel-grid-2">
          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title">Vehicle Flow and Speed Dynamics</div>
            <div style={{ height: 250 }}>
              <Line data={flowData} options={flowOptions} />
            </div>
          </div>

          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title">Risk and Congestion Profile</div>
            <div style={{ height: 250 }}>
              <Line data={riskData} options={smallLineOptions} />
            </div>
          </div>

          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title">Congestion Distribution</div>
            <div style={{ height: 250 }}>
              <Bar
                data={congestionDistData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: "rgba(220,240,255,0.9)" } } },
                  scales: { x: chartAxis, y: chartAxis },
                }}
              />
            </div>
          </div>

          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title">Class Composition + KPI Radar</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, height: 250 }}>
              <Doughnut
                data={classData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: "rgba(220,240,255,0.9)" } } },
                }}
              />
              <Radar
                data={radarData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: "rgba(220,240,255,0.9)" } } },
                  scales: {
                    r: {
                      angleLines: { color: "rgba(0,212,255,0.15)" },
                      grid: { color: "rgba(0,212,255,0.15)" },
                      pointLabels: { color: "rgba(220,240,255,0.85)" },
                      ticks: { display: false },
                      min: 0,
                      max: 100,
                    },
                  },
                }}
              />
            </div>
          </div>
        </div>

        <div className="panel-grid panel-grid-2">
          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title">TensorFlow Forecast Engine</div>
            {!modelForecast ? (
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                Train a compact TF model to predict next-step congestion risk from your replay timeline.
              </div>
            ) : (
              <>
                <div className="stat-row" style={{ marginBottom: 12 }}>
                  <div className="stat-card">
                    <div className="stat-label">Predicted Next Risk</div>
                    <div className="stat-value">{modelForecast.nextRisk.toFixed(3)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Model Confidence</div>
                    <div className="stat-value">{modelForecast.confidence}%</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Final Loss</div>
                    <div className="stat-value">{modelForecast.finalLoss.toFixed(5)}</div>
                  </div>
                </div>
                <div className="json-viewer" style={{ marginBottom: 12, maxHeight: 120 }}>
{`10-step projected risk horizon:\n${modelForecast.horizon.map((v, i) => `T+${i + 1}: ${v.toFixed(4)}`).join("\n")}`}
                </div>
                <div style={{ height: 160 }}>
                  <Line data={lossData} options={smallLineOptions} />
                </div>
              </>
            )}
          </div>

          <div className="card" style={{ minHeight: 320 }}>
            <div className="card-title">Hotspots and Junction Recommendations</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div className="text-mono" style={{ color: "rgba(0,212,255,0.75)", marginBottom: 6 }}>
                  Top Density Hotspots
                </div>
                <div className="json-viewer" style={{ maxHeight: 140 }}>
{JSON.stringify(hotspots.density || [], null, 2)}
                </div>
              </div>

              <div>
                <div className="text-mono" style={{ color: "rgba(0,255,136,0.75)", marginBottom: 6 }}>
                  AI Recommendations
                </div>
                <div className="log-terminal" style={{ maxHeight: 150 }}>
                  {recs.length === 0 ? (
                    <div className="text-muted">No recommendations generated for current sample.</div>
                  ) : (
                    recs.map((r, idx) => <div key={`${idx}-${r}`}>{idx + 1}. {r}</div>)
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">AI Feedback for Junction Improvement</div>
          <div className="panel-grid panel-grid-2">
            <div className="log-terminal" style={{ maxHeight: 220 }}>
              {(feedback || []).map((line, idx) => (
                <div key={`${idx}-${line}`}>• {line}</div>
              ))}
            </div>
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              This page intentionally provides dense diagnostics: trend curves, incident/risk decomposition,
              TensorFlow forecasting, hotspot extraction, and actionable improvement planning to support
              data-driven junction redesign decisions.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Integrated Disaster Management Layer</div>
          <div className="stat-row" style={{ marginBottom: 12 }}>
            <div className="stat-card">
              <div className="stat-label">Disaster Index</div>
              <div className="stat-value">{Number(disaster?.disaster_index || 0).toFixed(1)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">System Status</div>
              <div style={{ marginTop: 6 }} className={`badge ${statusBadge(disaster?.status)}`}>
                <span className="badge-dot" />
                {disaster?.status || "STABLE"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">High Risk Zones</div>
              <div className="stat-value">{Number(disaster?.zone_summary?.HIGH || 0)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Reroute Paths</div>
              <div className="stat-value">{(disaster?.rerouting_plan || []).length}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pothole Predictions</div>
              <div className="stat-value">{(disaster?.pothole_model?.prediction_zones || []).length}</div>
            </div>
          </div>

          <div className="panel-grid panel-grid-2">
            <div className="card" style={{ minHeight: 300 }}>
              <div className="card-title">Rerouting and Pothole Priorities</div>
              <div className="log-terminal" style={{ maxHeight: 230, marginBottom: 10 }}>
                {(disaster?.rerouting_plan || []).length === 0 ? (
                  <div className="text-muted">No urgent reroutes required for current run.</div>
                ) : (
                  (disaster?.rerouting_plan || []).map((r) => (
                    <div key={r.route_id}>
                      {r.route_id} | {r.priority} | {r.source_zone} -&gt; {r.target_zone} | ETA +{Number(r.eta_gain_pct || 0).toFixed(1)}%
                    </div>
                  ))
                )}
              </div>
              <div className="json-viewer" style={{ maxHeight: 170 }}>
{JSON.stringify((disaster?.pothole_model?.prediction_zones || []).slice(0, 8), null, 2)}
              </div>
            </div>

            <div className="card" style={{ minHeight: 300 }}>
              <div className="card-title">Digital Twin Scenarios</div>
              <div style={{ height: 210, marginBottom: 10 }}>
                <Bar
                  data={disasterScenarioData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: "rgba(220,240,255,0.92)" } } },
                    scales: { x: chartAxis, y: chartAxis },
                  }}
                />
              </div>
              <div className="log-terminal" style={{ maxHeight: 90 }}>
                {(disaster?.playbook || []).map((line, idx) => (
                  <div key={`${idx}-${line}`}>• {line}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12, minHeight: 240 }}>
            <div className="card-title">Projected Risk Under Best Twin Strategy</div>
            {(disaster?.digital_twin?.projected_risk_timeline || []).length === 0 ? (
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                Risk projection is not available for this replay sample.
              </div>
            ) : (
              <div style={{ height: 180 }}>
                <Line data={disasterRiskProjectionData} options={smallLineOptions} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
