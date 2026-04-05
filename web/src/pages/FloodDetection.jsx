import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Line } from "react-chartjs-2";
import { Droplets, Map, Activity, ShieldCheck, Search, Navigation } from "lucide-react";
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
  ticks: { color: "#a0a0a0", font: { size: 11, family: "Inter" } },
  grid: { color: "#f0f0f0" },
  border: { display: false },
};

const smallOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  elements: { point: { radius: 0, hoverRadius: 4 } },
  scales: { x: { display: false }, y: chartAxis },
};

const ZONE_LABELS = [
  ["NW","N","NE"],
  ["W","Center","E"],
  ["SW","S","SE"],
];

function statusBg(s) {
  if (s === "CRITICAL") return "#000";
  if (s === "WATCH") return "#71717a";
  return "#e4e4e7";
}

function statusText(s) {
  if (s === "CRITICAL") return "#fff";
  if (s === "WATCH") return "#fff";
  return "#000";
}

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
  const digitalTwin = data?.digital_twin || {};
  const grid = digitalTwin.grid || [];
  const playbook = data?.playbook || [];
  const disasterIndex = Number(data?.disaster_index || 0);
  const status = data?.report?.status || "STABLE";

  const zoneGrid = useMemo(() => {
    const g = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ risk: 0, sev: "LOW", speed: 0, label: "" })));
    grid.forEach(z => {
      const r = Math.min(2, Math.max(0, z.row ?? 0));
      const c = Math.min(2, Math.max(0, z.col ?? 0));
      g[r][c] = { risk: z.risk_score || 0, sev: z.severity || "LOW", speed: z.avg_speed_kmh || 0, label: z.zone_label || ZONE_LABELS[r][c] };
    });
    return g;
  }, [grid]);

  const floodRiskIndex = useMemo(() => {
    const speedPenalty = summary.avg_speed_kmh ? Math.max(0, 1 - (summary.avg_speed_kmh / 20)) * 25 : 0;
    return Math.min(100, disasterIndex + speedPenalty).toFixed(1);
  }, [disasterIndex, summary]);

  const speedAnomalies = useMemo(() => {
    if (timeline.length < 5) return [];
    const speeds = timeline.map(t => Number(t.avg_speed_kmh || 0));
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const std = Math.sqrt(speeds.reduce((a, s) => a + (s - mean) ** 2, 0) / speeds.length) || 1;
    return timeline.map((t, i) => ({ ...t, isAnomaly: speeds[i] < mean - 1.5 * std }));
  }, [timeline]);

  const labels = timeline.map(t => String(t.frame));

  const speedChartData = {
    labels,
    datasets: [{
      label: "Speed (km/h)", data: timeline.map(t => t.avg_speed_kmh),
      borderColor: "#000", backgroundColor: "rgba(0,0,0,0.05)", fill: true, tension: 0.4, borderWidth: 2,
    }, {
      label: "Anomaly Threshold",
      data: (() => {
        const speeds = timeline.map(t => Number(t.avg_speed_kmh || 0));
        const mean = speeds.reduce((a, b) => a + b, 0) / (speeds.length || 1);
        const std = Math.sqrt(speeds.reduce((a, s) => a + (s - mean) ** 2, 0) / (speeds.length || 1)) || 1;
        return timeline.map(() => Math.max(0, mean - 1.5 * std));
      })(),
      borderColor: "#71717a", borderDash: [4, 4], backgroundColor: "transparent", fill: false, tension: 0, borderWidth: 2,
    }],
  };

  const projectedTimeline = digitalTwin.projected_risk_timeline || [];
  const recoveryData = {
    labels: projectedTimeline.map((_, i) => `T+${i + 1}`),
    datasets: [{
      label: "Projected Risk Recovery", data: projectedTimeline,
      borderColor: "#000", backgroundColor: "rgba(0,0,0,0.05)", fill: true, tension: 0.4, borderWidth: 2,
    }],
  };

  const waterlogZones = useMemo(() =>
    [...grid].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)).slice(0, 6).map(z => ({
      ...z, waterlog_prob: Math.min(1, (z.risk_score || 0) * 0.6 + (1 - Math.min(1, (z.avg_speed_kmh || 0) / 20)) * 0.4),
    })),
  [grid]);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111", margin: "0 0 8px 0" }}>Flood Vulnerability</h1>
          <p style={{ color: "#737373", fontSize: "14px", margin: 0 }}>Assess environmental impacts, waterlogging probabilities, and recovery plans.</p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <select className="shdcn-input shdcn-select" style={{ width: "240px", cursor: "pointer" }} value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}>
            {files.length === 0 && <option value="">(no files found)</option>}
            {files.map(f => <option key={f.path} value={f.path}>{f.path.split('/').pop() || f.path}</option>)}
          </select>
          <button className="shdcn-button shdcn-button-outline" onClick={() => loadData(selectedPath, { force: true })} disabled={!selectedPath || loading}>
            {loading ? "Scanning Terrain..." : "Analyze Flood Risk"} <Droplets size={14} />
          </button>
        </div>
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "12px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: "500" }}>{error}</div>}

      <div className="stk-card" style={{ padding: "32px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Flood Risk Index <span style={{fontWeight:"400", color:"#a3a3a3"}}>/100</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{floodRiskIndex}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Hazards High <span style={{fontWeight:"400", color:"#a3a3a3"}}>Zones</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{zoneSummary.HIGH || 0}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Hazards Medium <span style={{fontWeight:"400", color:"#a3a3a3"}}>Zones</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{zoneSummary.MEDIUM || 0}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Avg Speed <span style={{fontWeight:"400", color:"#a3a3a3"}}>km/h</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(summary.avg_speed_kmh || 0).toFixed(1)}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Speed Anomalies <span style={{fontWeight:"400", color:"#a3a3a3"}}>Count</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{speedAnomalies.filter(a => a.isAnomaly).length}</div></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div className="stk-card" style={{ height: "360px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
             <h3 style={{ fontSize: "14px", fontWeight: "600", letterSpacing: "-0.5px" }}>Zone Vulnerability Grid</h3>
            <span className="shdcn-badge shdcn-badge-solid" style={{ background: statusBg(status), color: statusText(status) }}>{status}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px", padding: "4px", background: "#f4f4f5", borderRadius: "12px", height: "calc(100% - 70px)", border: "1px solid #e8e8e8" }}>
            {zoneGrid.map((row, ri) => row.map((cell, ci) => {
              const bg = cell.sev === "HIGH" ? "#000" : cell.sev === "MEDIUM" ? "#71717a" : "#ffffff";
              const txt = cell.sev === "HIGH" || cell.sev === "MEDIUM" ? "#ffffff" : "#000";
              const brd = cell.sev === "LOW" ? "#e4e4e7" : "transparent";
              
              return (
                <div key={`${ri}-${ci}`} style={{ background: bg, border: `1px solid ${brd}`, borderRadius: "8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "10px", gap: "8px" }}>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: txt }}>{cell.label}</div>
                  <div style={{ fontSize: "11px", color: txt, opacity: 0.8 }}>Risk: {(cell.risk * 100).toFixed(0)}%</div>
                  <div style={{ fontSize: "10px", color: txt, opacity: 0.6 }}>{cell.speed.toFixed(1)} km/h</div>
                </div>
              );
            }))}
          </div>
        </div>

        <div className="stk-card" style={{ height: "360px" }}>
           <div className="card-title"><div>Speed Anomaly Detection <span style={{fontSize:"11px", fontWeight:"500", color:"#737373", marginLeft:"4px"}}>Kinematics</span></div></div>
          <div style={{ flex: 1, position: "relative" }}>
            <Line data={speedChartData} options={smallOpts} />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "24px" }}>
        <div className="stk-card" style={{ height: "340px", overflow: "hidden" }}>
           <div className="card-title">Waterlog Probability Heat</div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table className="shdcn-table" style={{ width: "100%" }}>
               <thead>
                 <tr>
                    <th>Zone Label</th>
                    <th style={{ width: "50%" }}>Probability</th>
                 </tr>
               </thead>
               <tbody>
                  {waterlogZones.map((z, i) => (
                    <tr key={i}>
                       <td style={{ fontWeight: "600", fontSize: "13px" }}>{z.zone_label}<div style={{ fontSize:"11px", color:"#737373", fontWeight:"400" }}>Risk {(z.risk_score*100).toFixed(0)}%</div></td>
                       <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                             <div style={{ flex: 1, height: "6px", background: "#f4f4f5", borderRadius: "3px" }}>
                                <div style={{ width: `${z.waterlog_prob * 100}%`, height: "100%", background: "#000", borderRadius: "3px" }} />
                             </div>
                             <span style={{ fontSize: "12px", color: "#111", fontWeight: "600", width: "35px", textAlign: "right" }}>{(z.waterlog_prob * 100).toFixed(0)}%</span>
                          </div>
                       </td>
                    </tr>
                  ))}
               </tbody>
            </table>
          </div>
        </div>

        <div className="stk-card" style={{ height: "340px" }}>
           <div className="card-title">Projected Risk Recovery</div>
          {projectedTimeline.length > 0 ? (
            <div style={{ flex: 1, position: "relative" }}>
               <Line data={recoveryData} options={{ ...smallOpts, scales: { x: { display: false }, y: { ...chartAxis, min: 0, max: 1 } } }} />
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: "13px", color: "#a3a3a3" }}>No projected recovery timeline available.</div>
          )}
        </div>
      </div>

      <div className="stk-card">
        <div className="card-title">AI Emergency Action Playbook</div>
        <div style={{ background: "#f4f4f5", padding: "16px", borderRadius: "8px", maxHeight: "200px", overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "13px", color: "#000", display: "flex", flexDirection: "column", gap: "12px", border: "1px solid #e8e8ea" }}>
          {playbook.length === 0 ? <div style={{ color: "#737373" }}>System idle. No playbook actions generated.</div> :
            playbook.map((line, i) => <div key={i} style={{ display: "flex", gap: "12px" }}><span style={{ color: "#a3a3a3", fontWeight: "bold" }}>{i+1}.</span> <span>{line}</span></div>)
          }
        </div>
      </div>
      
    </div>
  );
}
