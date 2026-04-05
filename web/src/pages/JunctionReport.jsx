import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bar, Line, Radar } from "react-chartjs-2";
import { buildDisasterInsights } from "../utils/disasterFromAnalytics";
import {
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
  RadialLinearScale,
  Tooltip,
  Legend,
  Filler,
);

const chartAxis = {
  ticks: { color: "rgba(200,216,240,0.78)", font: { size: 11 } },
  grid: { color: "rgba(0,212,255,0.08)" },
  border: { color: "rgba(0,212,255,0.2)" },
};

function readinessGrade(score) {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

function gradeBadge(score) {
  if (score >= 80) return "badge-success";
  if (score >= 60) return "badge-pending";
  return "badge-error";
}

function statusBadge(status) {
  if (status === "CRITICAL") return "badge-error";
  if (status === "WATCH") return "badge-pending";
  return "badge-success";
}

export default function JunctionReport() {
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

  async function refreshReport(path = selectedPath) {
    if (!path) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/visualization/analytics?path=${encodeURIComponent(path)}&sample_step=4`,
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${r.status}`);
      }
      const d = await r.json();
      setAnalytics(d);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedPath) return;
    refreshReport(selectedPath);
  }, [selectedPath]);

  const summary = analytics?.summary || {};
  const kpis = analytics?.kpis || {};
  const plan = analytics?.improvement_plan || [];
  const feedback = analytics?.report?.feedback || [];
  const timeline = analytics?.timeline || [];
  const hot = analytics?.hotspots || { density: [], stopped: [], clusters: [] };
  const disaster = useMemo(() => buildDisasterInsights(analytics), [analytics]);

  const readiness = Number(kpis.junction_readiness || 0);
  const grade = readinessGrade(readiness);

  const cumulativeReduction = Math.min(
    52,
    (plan || []).reduce(
      (sum, p) => sum + Number(p.expected_delay_reduction_pct || 0),
      0,
    ),
  );

  const congestionBase = Math.round(Number(summary.high_congestion_ratio || 0) * 100);
  const congestionAfter = Math.max(0, Math.round(congestionBase * (1 - cumulativeReduction / 100)));

  const kpiRadarData = {
    labels: ["Throughput", "Stability", "Safety", "Readiness"],
    datasets: [
      {
        label: "Current Junction Profile",
        data: [
          Number(kpis.throughput_index || 0),
          Number(kpis.stability_index || 0),
          Number(kpis.safety_index || 0),
          Number(kpis.junction_readiness || 0),
        ],
        borderColor: "#00d4ff",
        backgroundColor: "rgba(0,212,255,0.24)",
      },
    ],
  };

  const beforeAfterData = {
    labels: ["High Congestion Share", "Incident Frame Share"],
    datasets: [
      {
        label: "Current %",
        data: [
          Number((summary.high_congestion_ratio || 0) * 100),
          Number((summary.incident_frame_ratio || 0) * 100),
        ],
        backgroundColor: "rgba(255,64,96,0.55)",
        borderColor: "#ff4060",
        borderWidth: 1,
      },
      {
        label: "Projected % (post-plan)",
        data: [
          Math.max(0, Number((summary.high_congestion_ratio || 0) * 100) - cumulativeReduction),
          Math.max(0, Number((summary.incident_frame_ratio || 0) * 100) - cumulativeReduction * 0.6),
        ],
        backgroundColor: "rgba(0,255,136,0.55)",
        borderColor: "#00ff88",
        borderWidth: 1,
      },
    ],
  };

  const riskTrendData = {
    labels: timeline.map((t) => String(t.frame)),
    datasets: [
      {
        label: "Risk Score",
        data: timeline.map((t) => t.risk_score),
        borderColor: "#ff4060",
        backgroundColor: "rgba(255,64,96,0.26)",
        fill: true,
        tension: 0.24,
      },
      {
        label: "Avg Speed (normalized)",
        data: timeline.map((t) => Math.min(1, Number(t.avg_speed_kmh || 0) / 24)),
        borderColor: "#00ff88",
        backgroundColor: "rgba(0,255,136,0.2)",
        fill: false,
        tension: 0.22,
      },
    ],
  };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Junction Improvement Report</div>
        <div className="page-subtitle">
          Dense Decision Report: KPI Radar, Risk Trends, Delay Reduction Projection, and Action Priorities
        </div>
      </div>

      <div className="page-body fade-in" style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px, 2fr) auto auto auto",
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
              onClick={() => refreshReport(selectedPath)}
              disabled={!selectedPath || loading}
            >
              {loading ? "Refreshing..." : "Refresh Report"}
            </button>

            <Link
              className="btn btn-ghost"
              to={`/ai-analytics?path=${encodeURIComponent(selectedPath || "")}`}
            >
              Open AI Analytics
            </Link>

            <Link
              className="btn btn-ghost"
              to={`/visualization?path=${encodeURIComponent(selectedPath || "")}`}
            >
              Back to Visualization
            </Link>
          </div>

          {error && <div className="alert alert-error" style={{ marginBottom: 0 }}>{error}</div>}
        </div>

        <div
          className="card"
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: 14,
            alignItems: "center",
          }}
        >
          <div>
            <div className="card-title">Executive AI Verdict</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: "#e8f4ff", marginBottom: 10 }}>
              {analytics?.report?.headline || "Run analytics to generate report"}
            </div>
            <div className="text-mono" style={{ color: "rgba(200,216,240,0.65)" }}>
              Location: {analytics?.location_code || "N/A"} | Frames: {summary.frames_total ?? 0} | Peak volume:
              {" "}{summary.peak_vehicle_count ?? 0}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div className="stat-label">Junction Grade</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 56, color: "var(--cyan)", lineHeight: 1 }}>
              {grade}
            </div>
            <div className={`badge ${gradeBadge(readiness)}`} style={{ marginTop: 10 }}>
              <span className="badge-dot" />
              Readiness {readiness.toFixed(1)}
            </div>
            <div className="text-mono" style={{ marginTop: 10, color: "rgba(200,216,240,0.58)" }}>
              Projected delay reduction if plan applied: {cumulativeReduction.toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="stat-row" style={{ marginBottom: 0 }}>
          <div className="stat-card">
            <div className="stat-label">Throughput Index</div>
            <div className="stat-value">{Number(kpis.throughput_index || 0).toFixed(1)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Stability Index</div>
            <div className="stat-value">{Number(kpis.stability_index || 0).toFixed(1)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Safety Index</div>
            <div className="stat-value">{Number(kpis.safety_index || 0).toFixed(1)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Speed</div>
            <div className="stat-value">
              {Number(summary.avg_speed_kmh || 0).toFixed(1)}
              <span className="stat-unit">km/h</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">High Congestion</div>
            <div className="stat-value">{Number((summary.high_congestion_ratio || 0) * 100).toFixed(1)}%</div>
          </div>
        </div>

        <div className="panel-grid panel-grid-2">
          <div className="card" style={{ minHeight: 330 }}>
            <div className="card-title">KPI Radar Profile</div>
            <div style={{ height: 255 }}>
              <Radar
                data={kpiRadarData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: "rgba(220,240,255,0.92)" } } },
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

          <div className="card" style={{ minHeight: 330 }}>
            <div className="card-title">Before vs Projected After</div>
            <div style={{ height: 255 }}>
              <Bar
                data={beforeAfterData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: "rgba(220,240,255,0.92)" } } },
                  scales: { x: chartAxis, y: chartAxis },
                }}
              />
            </div>
            <div className="text-mono" style={{ marginTop: 8, color: "rgba(200,216,240,0.58)" }}>
              Congestion severity index: {congestionBase}% -&gt; {congestionAfter}% (projected)
            </div>
          </div>

          <div className="card" style={{ minHeight: 330 }}>
            <div className="card-title">Risk Trajectory and Mobility Recovery</div>
            <div style={{ height: 255 }}>
              <Line
                data={riskTrendData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: "rgba(220,240,255,0.92)" } } },
                  scales: {
                    x: chartAxis,
                    y: { ...chartAxis, min: 0, max: 1 },
                  },
                }}
              />
            </div>
          </div>

          <div className="card" style={{ minHeight: 330 }}>
            <div className="card-title">Hotspot Evidence Snapshot</div>
            <div className="json-viewer" style={{ maxHeight: 255 }}>
{JSON.stringify(
  {
    density: (hot.density || []).slice(0, 6),
    stopped: (hot.stopped || []).slice(0, 6),
    clusters: (hot.clusters || []).slice(0, 6),
  },
  null,
  2,
)}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Improvement Plan (Prioritized)</div>
          <div style={{ display: "grid", gap: 10 }}>
            {(plan || []).length === 0 ? (
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                No improvement plan available for this replay yet.
              </div>
            ) : (
              plan.map((p, idx) => (
                <div
                  key={`${idx}-${p.title}`}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 12,
                    background: "var(--bg-elevated)",
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div className="badge badge-info">P{idx + 1}</div>
                  <div>
                    <div style={{ color: "#e8f4ff", fontWeight: 700, marginBottom: 3 }}>{p.title}</div>
                    <div className="text-mono" style={{ color: "rgba(200,216,240,0.62)", marginBottom: 2 }}>
                      {p.impact}
                    </div>
                    <div className="text-mono" style={{ color: "rgba(200,216,240,0.52)" }}>
                      Evidence: {p.evidence}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="badge badge-success" style={{ marginBottom: 6 }}>{p.priority}</div>
                    <div className="text-cyan text-mono">-{Number(p.expected_delay_reduction_pct || 0).toFixed(1)}%</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel-grid panel-grid-2">
          <div className="card">
            <div className="card-title">Operational Feedback</div>
            <div className="log-terminal" style={{ maxHeight: 220 }}>
              {(feedback || []).length === 0 ? (
                <div className="text-muted">No feedback available.</div>
              ) : (
                feedback.map((line, idx) => <div key={`${idx}-${line}`}>• {line}</div>)
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-title">Decision Notes</div>
            <div className="alert alert-info" style={{ marginBottom: 10 }}>
              The report combines congestion persistence, incident recurrence, and motion stability to produce
              a practical engineering roadmap for this intersection.
            </div>
            <div className="json-viewer" style={{ maxHeight: 170 }}>
{JSON.stringify(
  {
    projected_delay_reduction_pct: cumulativeReduction,
    congestion_before_pct: congestionBase,
    congestion_after_pct: congestionAfter,
    readiness_grade: grade,
    monitored_path: analytics?.path || selectedPath,
  },
  null,
  2,
)}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Disaster Management (Embedded in Report)</div>
          <div className="stat-row" style={{ marginBottom: 10 }}>
            <div className="stat-card">
              <div className="stat-label">Disaster Index</div>
              <div className="stat-value">{Number(disaster?.disaster_index || 0).toFixed(1)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Status</div>
              <div style={{ marginTop: 6 }} className={`badge ${statusBadge(disaster?.status)}`}>
                <span className="badge-dot" />
                {disaster?.status || "STABLE"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">High Zones</div>
              <div className="stat-value">{Number(disaster?.zone_summary?.HIGH || 0)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Emergency Reroutes</div>
              <div className="stat-value">{(disaster?.rerouting_plan || []).length}</div>
            </div>
          </div>

          <div className="panel-grid panel-grid-2">
            <div className="log-terminal" style={{ maxHeight: 220 }}>
              {(disaster?.playbook || []).length === 0 ? (
                <div className="text-muted">No disaster playbook generated.</div>
              ) : (
                (disaster?.playbook || []).map((line, idx) => <div key={`${idx}-${line}`}>• {line}</div>)
              )}
            </div>
            <div className="json-viewer" style={{ maxHeight: 220 }}>
{JSON.stringify(
  {
    zone_summary: disaster?.zone_summary,
    rerouting_plan: (disaster?.rerouting_plan || []).slice(0, 4),
    pothole_predictions: (disaster?.pothole_model?.prediction_zones || []).slice(0, 6),
    best_twin_scenario: disaster?.digital_twin?.best_scenario || null,
  },
  null,
  2,
)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
