import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bar, Line, Radar } from "react-chartjs-2";
import { ChevronDown, ExternalLink, ArrowLeft } from "lucide-react";
import { buildDisasterInsights } from "../utils/disasterFromAnalytics";
import {
  DEFAULT_SAMPLE_STEP,
  fetchAnalytics,
  fetchVisualizationFiles,
  prefetchDisasterManagement,
} from "../utils/visualizationApi";
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
  Filler
);

const chartAxis = {
  ticks: { color: "#a0a0a0", font: { size: 11, family: "Inter" } },
  grid: { color: "#f0f0f0" },
  border: { display: false },
};

function readinessGrade(score) {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

function gradeColor(score) {
  return score >= 80 ? "#111" : score >= 60 ? "#666" : "#000";
}

export default function JunctionReport() {
  const location = useLocation();
  const queryPath = useMemo(() => new URLSearchParams(location.search).get("path") || "", [location.search]);

  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState(queryPath);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchVisualizationFiles().then((list) => {
      setFiles(list);
      if (!queryPath && list.length > 0 && !selectedPath) setSelectedPath(list[0].path);
    }).catch(() => {});
  }, [queryPath]);

  useEffect(() => { if (queryPath) setSelectedPath(queryPath); }, [queryPath]);

  async function refreshReport(path = selectedPath, { force = false } = {}) {
    if (!path) return;
    setLoading(true); setError("");
    try {
      const d = await fetchAnalytics(path, { sampleStep: DEFAULT_SAMPLE_STEP, force });
      setAnalytics(d);
    } catch (e) { setError(String(e?.message || e)); } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!selectedPath) return;
    refreshReport(selectedPath);
    prefetchDisasterManagement(selectedPath, { sampleStep: DEFAULT_SAMPLE_STEP });
  }, [selectedPath]);

  const summary = analytics?.summary || {};
  const kpis = analytics?.kpis || {};
  const plan = analytics?.improvement_plan || [];
  const timeline = analytics?.timeline || [];
  
  const readiness = Number(kpis.junction_readiness || 0);
  const grade = readinessGrade(readiness);
  const cumulativeReduction = Math.min(52, plan.reduce((sum, p) => sum + Number(p.expected_delay_reduction_pct || 0), 0));
  const congestionBase = Math.round(Number(summary.high_congestion_ratio || 0) * 100);
  const congestionAfter = Math.max(0, Math.round(congestionBase * (1 - cumulativeReduction / 100)));

  const kpiRadarData = {
    labels: ["Throughput", "Stability", "Safety", "Readiness"],
    datasets: [{
      label: "Current Junction Profile",
      data: [Number(kpis.throughput_index || 0), Number(kpis.stability_index || 0), Number(kpis.safety_index || 0), Number(kpis.junction_readiness || 0)],
      borderColor: "#000", backgroundColor: "rgba(0,0,0,0.05)", borderWidth: 2,
    }],
  };

  const beforeAfterData = {
    labels: ["High Congestion Share", "Incident Frame Share"],
    datasets: [
      { label: "Current %", data: [Number((summary.high_congestion_ratio || 0) * 100), Number((summary.incident_frame_ratio || 0) * 100)], backgroundColor: "#000", borderRadius: 4, barThickness: 32 },
      { label: "Projected % (post-plan)", data: [Math.max(0, Number((summary.high_congestion_ratio || 0) * 100) - cumulativeReduction), Math.max(0, Number((summary.incident_frame_ratio || 0) * 100) - cumulativeReduction * 0.6)], backgroundColor: "#d4d4d8", borderRadius: 4, barThickness: 32 },
    ],
  };

  const riskTrendData = {
    labels: timeline.map(t => String(t.frame)),
    datasets: [
      { label: "Risk Score", data: timeline.map(t => t.risk_score), borderColor: "#000", backgroundColor: "rgba(0,0,0,0.04)", fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 },
      { label: "Avg Speed (normalized)", data: timeline.map(t => Math.min(1, Number(t.avg_speed_kmh || 0) / 24)), borderColor: "#a1a1aa", backgroundColor: "transparent", fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2, borderDash: [4, 4] },
    ],
  };

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111", margin: "0 0 8px 0" }}>Junction Improvement Report</h1>
          <p style={{ color: "#737373", fontSize: "14px", margin: 0 }}>Dense Decision Report: KPI Radar, Risk Trends, Delay Reduction Projection, and Action Priorities</p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ position: "relative" }}>
            <select className="shdcn-input shdcn-select" style={{ width: "240px", cursor: "pointer" }} value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}>
              {files.length === 0 && <option value="">(no replay files found)</option>}
              {files.map((f) => <option key={f.path} value={f.path}>{f.path.split('/').pop() || f.path}</option>)}
            </select>
          </div>
          <button className="shdcn-button shdcn-button-outline" onClick={() => refreshReport(selectedPath, { force: true })} disabled={!selectedPath || loading}>
            {loading ? "Refreshing..." : "Refresh Report"}
          </button>
          <Link to={`/dashboard/ai-analytics?path=${encodeURIComponent(selectedPath || "")}`} className="shdcn-button shdcn-button-primary">
            Open AI Analytics <ExternalLink size={14} />
          </Link>
          <Link to={`/dashboard/visualization?path=${encodeURIComponent(selectedPath || "")}`} className="shdcn-button shdcn-button-ghost">
            <ArrowLeft size={14} /> Back
          </Link>
        </div>
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "12px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: "500" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "24px" }}>
        <div className="stk-card" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="card-title">Executive AI Verdict</div>
            <div style={{ fontSize: "28px", fontWeight: "700", color: "#111", lineHeight: 1.2, marginBottom: "16px" }}>
              {analytics?.report?.headline || "Run analytics to generate standard compliance report."}
            </div>
            <div style={{ color: "#737373", fontSize: "14px", fontWeight: "500" }}>
              Location: <b>{analytics?.location_code || "N/A"}</b> &nbsp;&nbsp;|&nbsp;&nbsp; Frames: <b>{summary.frames_total ?? 0}</b> &nbsp;&nbsp;|&nbsp;&nbsp; Peak volume: <b>{summary.peak_vehicle_count ?? 0}</b>
            </div>
          </div>
        </div>

        <div className="stk-card" style={{ background: "#fafafa" }}>
          <div className="card-title">Junction Grade</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px" }}>
            <div style={{ fontSize: "64px", fontWeight: "900", color: gradeColor(readiness), lineHeight: 1 }}>{grade}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span className="shdcn-badge shdcn-badge-solid" style={{ marginBottom: "8px", alignSelf: "flex-start" }}>Readiness {readiness.toFixed(1)}</span>
              <span style={{ fontSize: "12px", color: "#737373", fontWeight: "500" }}>Projected reduction: {cumulativeReduction.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="stk-card" style={{ padding: "32px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Throughput Index</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(kpis.throughput_index || 0).toFixed(1)}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Stability Index</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(kpis.stability_index || 0).toFixed(1)}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Safety Index</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(kpis.safety_index || 0).toFixed(1)}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Avg Speed</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(summary.avg_speed_kmh || 0).toFixed(1)}<span style={{ fontSize:"12px", color:"#a3a3a3", marginLeft:"4px"}}>km/h</span></div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>High Congestion</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number((summary.high_congestion_ratio || 0) * 100).toFixed(1)}%</div></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
        <div className="stk-card" style={{ height: "340px" }}>
          <div className="card-title">KPI Radar Profile</div>
          <div style={{ flex: 1 }}>
            <Radar data={kpiRadarData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { angleLines: { color: "#f0f0f0" }, grid: { color: "#f0f0f0" }, pointLabels: { color: "#737373", font: { family:"Inter", size: 10, weight: "600" } }, ticks: { display: false }, min: 0, max: 100 } } }} />
          </div>
        </div>

        <div className="stk-card" style={{ height: "340px" }}>
          <div className="card-title">Before vs Projected</div>
          <div style={{ flex: 1 }}>
            <Bar data={beforeAfterData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, family:"Inter" } } } }, scales: { x: { grid: {display:false}, border:{display:false}, ticks:{color:"#737373", font:{size:11}} }, y: chartAxis } }} />
          </div>
        </div>

        <div className="stk-card" style={{ height: "340px" }}>
          <div className="card-title">Risk Trajectory</div>
          <div style={{ flex: 1 }}>
            <Line data={riskTrendData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, family:"Inter" } } } }, scales: { x: { display: false }, y: { ...chartAxis, min: 0 } } }} />
          </div>
        </div>
      </div>

      <div className="stk-card">
        <div className="card-title">Improvement Plan Recommendations</div>
        {plan.length === 0 ? (
          <div style={{ color: "#737373", fontSize: "14px" }}>No improvement plan available for this replay yet.</div>
        ) : (
          <table className="shdcn-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Recommendation</th>
                <th>Evidence</th>
                <th style={{ textAlign: "right" }}>Impact</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p, idx) => (
                <tr key={`${idx}-${p.title}`}>
                  <td style={{ fontWeight: "700" }}>P{idx + 1}</td>
                  <td style={{ fontWeight: "600", color: "#111" }}>{p.title}<div style={{ fontSize: "12px", color: "#737373", marginTop: "4px", fontWeight:"400" }}>{p.impact}</div></td>
                  <td style={{ fontSize: "13px", color: "#737373", maxWidth: "300px" }}>{p.evidence}</td>
                  <td style={{ textAlign: "right", fontWeight: "700" }}>-{Number(p.expected_delay_reduction_pct || 0).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
