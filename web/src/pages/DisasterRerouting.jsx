import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bar, Line } from "react-chartjs-2";
import { Search, Route, Activity } from "lucide-react";
import {
  DEFAULT_SAMPLE_STEP,
  fetchDisasterManagement,
  fetchVisualizationFiles,
  prefetchAnalytics,
} from "../utils/visualizationApi";
import {
  BarElement, CategoryScale, Chart as ChartJS, Filler, Legend,
  LineElement, LinearScale, PointElement, Tooltip,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const chartAxis = {
  ticks: { color: "#a0a0a0", font: { size: 11, family: "Inter" } },
  grid: { color: "#f0f0f0" },
  border: { display: false },
};

const ZONE_LABELS = [["NW","N","NE"],["W","Center","E"],["SW","S","SE"]];

export default function DisasterRerouting() {
  const loc = useLocation();
  const queryPath = useMemo(() => new URLSearchParams(loc.search).get("path") || "", [loc.search]);

  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState(queryPath);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchVisualizationFiles()
      .then(l => { const list = Array.isArray(l) ? l : []; setFiles(list); if (!queryPath && list.length > 0 && !selectedPath) setSelectedPath(list[0].path); })
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
  const zoneSummary = data?.zone_summary || {};
  const rerouting = data?.rerouting_plan || [];
  const digitalTwin = data?.digital_twin || {};
  const grid = digitalTwin.grid || [];
  const scenarios = digitalTwin.scenarios || [];
  const bestScenario = digitalTwin.best_scenario || null;
  const baseline = digitalTwin.baseline || {};
  const projectedTimeline = digitalTwin.projected_risk_timeline || [];
  const playbook = data?.playbook || [];
  const disasterIndex = Number(data?.disaster_index || 0);
  const status = data?.report?.status || "STABLE";

  const zoneGrid = useMemo(() => {
    const g = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ risk: 0, sev: "LOW", label: "" })));
    grid.forEach(z => {
      const r = Math.min(2, Math.max(0, z.row ?? 0));
      const c = Math.min(2, Math.max(0, z.col ?? 0));
      g[r][c] = { risk: z.risk_score || 0, sev: z.severity || "LOW", label: z.zone_label || ZONE_LABELS[r][c] };
    });
    return g;
  }, [grid]);

  const scenarioData = {
    labels: scenarios.map(s => s.name),
    datasets: [{
      label: "Resilience Index",
      data: scenarios.map(s => Number(s.resilience_index || 0)),
      backgroundColor: "#000", borderRadius: 4,
    }, {
      label: "ETA Gain %",
      data: scenarios.map(s => Number(s.eta_gain_projection_pct || 0)),
      backgroundColor: "#d4d4d8", borderRadius: 4,
    }],
  };

  const recoveryData = {
    labels: projectedTimeline.map((_, i) => `T+${i + 1}`),
    datasets: [{
      label: "Projected Risk", data: projectedTimeline,
      borderColor: "#000", backgroundColor: "rgba(0,0,0,0.05)", fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0
    }],
  };

  const afterMetrics = bestScenario?.metrics_after || {};
  const compareItems = [
    { label: "Density", before: baseline.density || 0, after: afterMetrics.density || 0, fmt: v => (v * 100).toFixed(1) + "%" },
    { label: "Avg Speed", before: baseline.avg_speed_kmh || 0, after: afterMetrics.avg_speed_kmh || 0, fmt: v => v.toFixed(1) + " km/h" },
    { label: "Risk Score", before: baseline.risk_score || 0, after: afterMetrics.risk_score || 0, fmt: v => (v * 100).toFixed(1) + "%" },
  ];

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111", margin: "0 0 8px 0" }}>Dynamic Rerouting Optimization</h1>
          <p style={{ color: "#737373", fontSize: "14px", margin: 0 }}>Assess emergency evacuation paths and optimization vectors.</p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <select className="shdcn-input shdcn-select" style={{ width: "240px", cursor: "pointer" }} value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}>
            {files.length === 0 && <option value="">(no files found)</option>}
            {files.map(f => <option key={f.path} value={f.path}>{f.path.split('/').pop() || f.path}</option>)}
          </select>
          <button className="shdcn-button shdcn-button-outline" onClick={() => loadData(selectedPath, { force: true })} disabled={!selectedPath || loading}>
            {loading ? "Computing Network Graph..." : "Generate Rerouting Plan"} <Route size={14} />
          </button>
        </div>
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "12px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: "500" }}>{error}</div>}

      <div className="stk-card" style={{ padding: "32px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1.5fr", gap: "24px", alignItems: "center" }}>
          
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ fontSize: "40px", fontWeight: "800", color: "#111", lineHeight: 1 }}>{disasterIndex.toFixed(1)}</div>
            <div>
              <div style={{ padding: "4px 8px", background: status === "CRITICAL" ? "#000" : "#f4f4f5", color: status === "CRITICAL" ? "#fff" : "#111", border: "1px solid #e8e8ea", borderRadius: "100px", fontSize: "11px", fontWeight: "600", marginBottom: "4px", display: "inline-block" }}>{status}</div>
              <div style={{ fontSize: "11px", color: "#737373", textTransform: "uppercase", fontWeight: "600" }}>Disaster Index</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Active Reroutes</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{rerouting.length}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Hazards High</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{zoneSummary.HIGH || 0}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Hazards Medium</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{zoneSummary.MEDIUM || 0}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Hazards Low</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{zoneSummary.LOW || 0}</div></div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderLeft: "1px solid #e4e4e7", paddingLeft: "16px" }}>
            <div style={{ fontSize: "11px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Best Strategy</div>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#111" }}>{bestScenario?.name || "N/A"}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "24px" }}>
        
        <div className="stk-card" style={{ height: "480px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div className="card-title">Active Optimization Plans</div>
          
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table className="shdcn-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                   <th>Priority</th>
                   <th>Route ID</th>
                   <th>Gain %</th>
                </tr>
              </thead>
              <tbody>
                {rerouting.length === 0 ? (
                  <tr><td colSpan="3" style={{ fontSize: "13px", color: "#737373", textAlign: "center", paddingTop: "40px" }}>No reroutes required for current conditions.</td></tr>
                ) : rerouting.map((rt, i) => (
                  <tr key={rt.route_id || i}>
                     <td><span className="shdcn-badge" style={{ background: rt.priority === "Immediate" ? "#000" : "#fff", color: rt.priority === "Immediate" ? "#fff" : "#000" }}>{rt.priority}</span></td>
                     <td style={{ fontWeight: "600", fontSize: "13px" }}>
                        {rt.route_id}
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#737373", fontFamily: "var(--font-mono)", marginTop: "4px", background: "#f4f4f5", padding: "4px 8px", borderRadius: "4px", width: "fit-content" }}>
                           <span style={{ fontWeight: "500", color: "#111" }}>{rt.source_zone}</span> → <span style={{ fontWeight: "500", color: "#111" }}>{rt.target_zone}</span>
                        </div>
                     </td>
                     <td style={{ fontWeight: "700", fontSize: "14px" }}>+{Number(rt.eta_gain_pct || 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="stk-card" style={{ height: "480px" }}>
           <div className="card-title">Zone Risk Array</div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px", padding: "4px", background: "#f4f4f5", border: "1px solid #e8e8ea", borderRadius: "12px", height: "200px", marginBottom: "20px" }}>
            {zoneGrid.map((row, ri) => row.map((cell, ci) => {
              const bg = cell.sev === "HIGH" ? "#000" : cell.sev === "MEDIUM" ? "#71717a" : "#fff";
              const txt = cell.sev === "HIGH" || cell.sev === "MEDIUM" ? "#ffffff" : "#000";
              const brd = cell.sev === "LOW" ? "#e4e4e7" : "transparent";
              return (
                <div key={`${ri}-${ci}`} style={{ background: bg, border: `1px solid ${brd}`, borderRadius: "8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px", gap: "4px" }}>
                  <div style={{ fontWeight: 600, fontSize: "12px", color: txt }}>{cell.label}</div>
                  <div style={{ fontSize: "16px", fontWeight: "700", color: txt }}>{(cell.risk * 100).toFixed(0)}%</div>
                  <div style={{ fontSize: "10px", color: txt, textTransform: "uppercase", opacity: 0.6 }}>{cell.sev}</div>
                </div>
              );
            }))}
          </div>
          
          {bestScenario && (
            <div style={{ background: "#fafafa", border: "1px solid #e4e4e7", borderRadius: "8px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "#737373", marginBottom: "16px", display: "flex", justifyContent: "space-between", fontWeight: "600" }}>
                <span>Impact Simulation</span>
                <span style={{ color: "#111" }}>{bestScenario.name}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {compareItems.map(item => (
                  <div key={item.label} style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: "16px", alignItems: "center" }}>
                    <div style={{ fontSize: "11px", color: "#737373", fontWeight: "600" }}>{item.label}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ flex: 1, height: "6px", background: "#f4f4f5", borderRadius: "3px" }}>
                        <div style={{ width: `${Math.min(100, item.before * 100)}%`, height: "100%", background: "#a1a1aa", borderRadius: "3px" }} />
                      </div>
                      <span style={{ fontSize: "11px", color: "#737373", fontWeight: "600", width: "45px" }}>{item.fmt(item.before)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ flex: 1, height: "6px", background: "#f4f4f5", borderRadius: "3px" }}>
                        <div style={{ width: `${Math.min(100, item.after * 100)}%`, height: "100%", background: "#000", borderRadius: "3px" }} />
                      </div>
                      <span style={{ fontSize: "11px", color: "#111", fontWeight: "700", width: "45px" }}>{item.fmt(item.after)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div className="stk-card" style={{ height: "340px" }}>
           <div className="card-title">Digital Twin Scenarios</div>
          <div style={{ flex: 1, position: "relative" }}>
            {scenarios.length > 0 ? (
              <Bar data={scenarioData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true, font: {family: "Inter", size: 11} } } }, scales: { x: {grid: {display:false}, border: {display:false}, ticks: {color: "#737373", font: {family:"Inter", size: 11}}}, y: chartAxis } }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: "13px", color: "#a3a3a3" }}>No scenarios available.</div>
            )}
          </div>
        </div>
        
        <div className="stk-card" style={{ height: "340px" }}>
           <div className="card-title">Projected Risk Recovery</div>
          <div style={{ flex: 1, position: "relative" }}>
            {projectedTimeline.length > 0 ? (
              <Line data={recoveryData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display:false } }, scales: { x: {display: false}, y: { ...chartAxis, min: 0, max: 1 } } }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: "13px", color: "#a3a3a3" }}>No risk projection available.</div>
            )}
          </div>
        </div>
      </div>

      <div className="stk-card">
         <div className="card-title">AI Emergency Response Playbook</div>
        <div style={{ background: "#f4f4f5", border: "1px solid #e4e4e7", padding: "16px", borderRadius: "8px", maxHeight: "200px", overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "13px", color: "#000", display: "flex", flexDirection: "column", gap: "12px" }}>
          {playbook.length === 0 ? <div style={{ color: "#737373" }}>System idle. No playbook actions generated.</div> :
            playbook.map((line, i) => (
              <div key={i} style={{ display: "flex", gap: "16px", paddingBottom: "12px", borderBottom: "1px solid #e8e8ea" }}>
                <span style={{ background: "#000", color: "#fff", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", textAlign: "center", alignSelf: "flex-start", fontWeight: "700", marginTop: "2px" }}>STEP {i + 1}</span>
                <span style={{ lineHeight: 1.4 }}>{line}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
