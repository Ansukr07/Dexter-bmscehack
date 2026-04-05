import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Line, Bar, Radar } from "react-chartjs-2";
import {
  DEFAULT_SAMPLE_STEP,
  fetchDisasterManagement,
  fetchVisualizationFiles,
  prefetchAnalytics,
} from "../utils/visualizationApi";
import {
  BarElement, CategoryScale, Chart as ChartJS, Filler, Legend,
  LineElement, LinearScale, PointElement, RadialLinearScale, Tooltip,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, RadialLinearScale, Tooltip, Legend, Filler);

const chartAxis = {
  ticks: { color: "rgba(200,216,240,0.78)", font: { size: 11 } },
  grid: { color: "rgba(99,102,241,0.08)" },
  border: { color: "rgba(99,102,241,0.2)" },
};

const smallOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  elements: { point: { radius: 2, hoverRadius: 4 } },
};

function statusBadge(s) {
  if (s === "CRITICAL") return "badge-error";
  if (s === "WATCH") return "badge-pending";
  return "badge-success";
}

function severityClass(s) {
  if (s === "HIGH") return "zone-high";
  if (s === "MEDIUM") return "zone-medium";
  return "zone-low";
}

const ZONE_LABELS = [
  ["NW","N","NE"],
  ["W","Center","E"],
  ["SW","S","SE"],
];

export default function FloodDetection() {
  const loc = useLocation();
  const queryPath = useMemo(() => new URLSearchParams(loc.search).get("path") || "", [loc.search]);

  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState(queryPath);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchVisualizationFiles()
      .then(l => { setFiles(l); if (!queryPath && l.length > 0 && !selectedPath) setSelectedPath(l[0].path); })
      .catch(() => {});
  }, []);

  useEffect(() => { if (queryPath) setSelectedPath(queryPath); }, [queryPath]);

  async function loadData(path = selectedPath, { force = false } = {}) {
    if (!path) return;
    setLoading(true); setError("");
    try {
      const d = await fetchDisasterManagement(path, { sampleStep: DEFAULT_SAMPLE_STEP, force });
      setData(d);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!selectedPath) return;
    loadData(selectedPath);
    prefetchAnalytics(selectedPath, { sampleStep: DEFAULT_SAMPLE_STEP });
  }, [selectedPath]);

  const summary = data?.summary || {};
  const timeline = data?.timeline || [];
  const zoneSummary = data?.zone_summary || {};
  const riskZones = data?.risk_zones || {};
  const digitalTwin = data?.digital_twin || {};
  const grid = digitalTwin.grid || [];
  const playbook = data?.playbook || [];
  const disasterIndex = Number(data?.disaster_index || 0);
  const status = data?.report?.status || "STABLE";

  // Build 3x3 zone grid
  const zoneGrid = useMemo(() => {
    const g = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ risk: 0, sev: "LOW", speed: 0, label: "" })));
    grid.forEach(z => {
      const r = Math.min(2, Math.max(0, z.row ?? 0));
      const c = Math.min(2, Math.max(0, z.col ?? 0));
      g[r][c] = { risk: z.risk_score || 0, sev: z.severity || "LOW", speed: z.avg_speed_kmh || 0, label: z.zone_label || ZONE_LABELS[r][c] };
    });
    return g;
  }, [grid]);

  // Flood risk index (derived from disaster index + speed anomaly)
  const floodRiskIndex = useMemo(() => {
    const speedPenalty = summary.avg_speed_kmh ? Math.max(0, 1 - (summary.avg_speed_kmh / 20)) * 25 : 0;
    return Math.min(100, disasterIndex + speedPenalty).toFixed(1);
  }, [disasterIndex, summary]);

  // Speed anomaly detection
  const speedAnomalies = useMemo(() => {
    if (timeline.length < 5) return [];
    const speeds = timeline.map(t => Number(t.avg_speed_kmh || 0));
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const std = Math.sqrt(speeds.reduce((a, s) => a + (s - mean) ** 2, 0) / speeds.length) || 1;
    return timeline.map((t, i) => ({ ...t, isAnomaly: speeds[i] < mean - 1.5 * std }));
  }, [timeline]);

  const labels = timeline.map(t => String(t.frame));

  // Speed anomaly chart
  const speedChartData = {
    labels,
    datasets: [{
      label: "Speed (km/h)", data: timeline.map(t => t.avg_speed_kmh),
      borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,0.15)", fill: true, tension: 0.28,
    }, {
      label: "Anomaly Threshold",
      data: (() => {
        const speeds = timeline.map(t => Number(t.avg_speed_kmh || 0));
        const mean = speeds.reduce((a, b) => a + b, 0) / (speeds.length || 1);
        const std = Math.sqrt(speeds.reduce((a, s) => a + (s - mean) ** 2, 0) / (speeds.length || 1)) || 1;
        return timeline.map(() => Math.max(0, mean - 1.5 * std));
      })(),
      borderColor: "#ef4444", borderDash: [6, 3], backgroundColor: "rgba(239,68,68,0.08)", fill: true, tension: 0, pointRadius: 0,
    }],
  };

  // Risk recovery
  const projectedTimeline = digitalTwin.projected_risk_timeline || [];
  const recoveryData = {
    labels: projectedTimeline.map((_, i) => `T+${i + 1}`),
    datasets: [{
      label: "Projected Risk Recovery", data: projectedTimeline,
      borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.2)", fill: true, tension: 0.28,
    }],
  };

  // Waterlog probability = zones sorted by risk_score * speed_penalty
  const waterlogZones = useMemo(() =>
    [...grid].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)).slice(0, 6).map(z => ({
      ...z, waterlog_prob: Math.min(1, (z.risk_score || 0) * 0.6 + (1 - Math.min(1, (z.avg_speed_kmh || 0) / 20)) * 0.4),
    })),
  [grid]);

  return (
    <div className="fade-in" style={{ display: "grid", gap: 16 }}>
      {/* Source selector */}
      <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Replay Source</label>
          <select className="form-control" value={selectedPath} onChange={e => setSelectedPath(e.target.value)}>
            {files.length === 0 && <option value="">(no replay files)</option>}
            {files.map(f => <option key={f.path} value={f.path}>{f.path}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => loadData(selectedPath, { force: true })} disabled={!selectedPath || loading}>
          {loading ? "Scanning..." : "Analyze Flood Risk"}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {/* Flood Risk Overview */}
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">Flood Risk Index</div>
          <div className="stat-value" style={{ color: Number(floodRiskIndex) >= 60 ? "#f87171" : Number(floodRiskIndex) >= 35 ? "#fbbf24" : "#34d399" }}>{floodRiskIndex}</div>
          <div className={`badge ${statusBadge(status)}`} style={{ marginTop: 8 }}><span className="badge-dot" />{status}</div>
        </div>
        <div className="stat-card"><div className="stat-label">High Risk Zones</div><div className="stat-value">{zoneSummary.HIGH || 0}</div></div>
        <div className="stat-card"><div className="stat-label">Medium Zones</div><div className="stat-value">{zoneSummary.MEDIUM || 0}</div></div>
        <div className="stat-card"><div className="stat-label">Avg Speed</div><div className="stat-value">{Number(summary.avg_speed_kmh || 0).toFixed(1)}<span className="stat-unit">km/h</span></div></div>
        <div className="stat-card"><div className="stat-label">Anomalies Detected</div><div className="stat-value">{speedAnomalies.filter(a => a.isAnomaly).length}</div></div>
      </div>

      {/* Zone Vulnerability Grid + Speed Anomaly */}
      <div className="panel-grid panel-grid-2">
        <div className="card" style={{ minHeight: 340 }}>
          <div className="card-title">Zone Vulnerability Grid</div>
          <div className="zone-grid" style={{ marginBottom: 12 }}>
            {zoneGrid.map((row, ri) => row.map((cell, ci) => (
              <div key={`${ri}-${ci}`} className={`zone-cell ${severityClass(cell.sev)}`}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{ZONE_LABELS[ri][ci]}</div>
                <div style={{ fontSize: 10, marginTop: 4 }}>Risk: {(cell.risk * 100).toFixed(0)}%</div>
                <div style={{ fontSize: 10 }}>{cell.speed.toFixed(1)} km/h</div>
              </div>
            )))}
          </div>
          <div className="alert alert-info" style={{ marginBottom: 0, fontSize: 11 }}>
            Zones are color-coded by risk severity. Low speed + high density = potential waterlogging.
          </div>
        </div>
        <div className="card" style={{ minHeight: 340 }}>
          <div className="card-title">Speed Anomaly Detection</div>
          <div style={{ height: 255 }}>
            <Line data={speedChartData} options={{ ...smallOpts, scales: { x: chartAxis, y: chartAxis } }} />
          </div>
          <div className="text-mono" style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
            Red dashed line = anomaly threshold (1.5σ below mean). Points below indicate potential disruption.
          </div>
        </div>
      </div>

      {/* Waterlog Probability + Recovery */}
      <div className="panel-grid panel-grid-2">
        <div className="card" style={{ minHeight: 340 }}>
          <div className="card-title">Waterlog Probability Zones</div>
          <div style={{ display: "grid", gap: 8 }}>
            {waterlogZones.map((z, i) => (
              <div key={z.zone_id || i} className="priority-item">
                <div className={`badge ${z.waterlog_prob >= 0.6 ? "badge-error" : z.waterlog_prob >= 0.35 ? "badge-pending" : "badge-success"}`}>
                  {(z.waterlog_prob * 100).toFixed(0)}%
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: "#fff", fontSize: 13 }}>{z.zone_label}</div>
                  <div className="text-mono" style={{ fontSize: 11, color: "#94a3b8" }}>
                    Risk: {((z.risk_score || 0) * 100).toFixed(0)}% | Speed: {(z.avg_speed_kmh || 0).toFixed(1)} km/h
                  </div>
                </div>
                <div className="progress-track" style={{ width: 80, height: 6 }}>
                  <div className="progress-fill" style={{ width: `${z.waterlog_prob * 100}%`, background: z.waterlog_prob >= 0.6 ? "#ef4444" : z.waterlog_prob >= 0.35 ? "#f59e0b" : "#10b981" }} />
                </div>
              </div>
            ))}
            {waterlogZones.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>No zone data available</div>}
          </div>
        </div>
        <div className="card" style={{ minHeight: 340 }}>
          <div className="card-title">Emergency Response — Projected Risk Recovery</div>
          {projectedTimeline.length > 0 ? (
            <div style={{ height: 240 }}>
              <Line data={recoveryData} options={{ ...smallOpts, scales: { x: chartAxis, y: { ...chartAxis, min: 0, max: 1 } } }} />
            </div>
          ) : (
            <div className="alert alert-info" style={{ marginBottom: 0 }}>No projected recovery timeline available for this replay.</div>
          )}
        </div>
      </div>

      {/* Playbook */}
      <div className="card">
        <div className="card-title">Flood Emergency Action Playbook</div>
        <div className="log-terminal" style={{ maxHeight: 200 }}>
          {playbook.length === 0 ? <div className="text-muted">No playbook actions generated.</div> :
            playbook.map((line, i) => <div key={i}>• {line}</div>)
          }
        </div>
      </div>
    </div>
  );
}
