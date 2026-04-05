import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bar } from "react-chartjs-2";
import { Search, Target, Activity } from "lucide-react";
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from "chart.js";
import {
  DEFAULT_SAMPLE_STEP,
  fetchDisasterManagement,
  fetchVisualizationFiles,
  prefetchAnalytics,
} from "../utils/visualizationApi";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const chartAxis = {
  ticks: { color: "#a0a0a0", font: { size: 11, family: "Inter" } },
  grid: { color: "#f0f0f0" },
  border: { display: false },
};

function priorityColor(p) {
  if (p === "Critical") return "#000";
  if (p === "High") return "#3f3f46";
  if (p === "Moderate") return "#a1a1aa";
  return "#e4e4e7";
}

function priorityText(p) {
  if (p === "Critical") return "#fff";
  if (p === "High") return "#fff";
  if (p === "Moderate") return "#000";
  return "#000";
}

const ZONE_LABELS = [["NW","N","NE"],["W","Center","E"],["SW","S","SE"]];

export default function PotholeDetection() {
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

  const potholeModel = data?.pothole_model || {};
  const modelInfo = potholeModel.model || {};
  const predictions = potholeModel.prediction_zones || [];
  const eventSamples = potholeModel.event_samples || [];
  const detectedClasses = potholeModel.detected_classes || {};
  const grid = data?.digital_twin?.grid || [];

  const criticalCount = predictions.filter(p => p.priority === "Critical").length;
  const highCount = predictions.filter(p => p.priority === "High").length;
  const avgConfidence = predictions.length ? (predictions.reduce((a, p) => a + (p.confidence || 0), 0) / predictions.length * 100).toFixed(1) : "0.0";

  const zoneGrid = useMemo(() => {
    const g = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ prob: 0, label: "", hits: 0 })));
    grid.forEach(z => {
      const r = Math.min(2, Math.max(0, z.row ?? 0));
      const c = Math.min(2, Math.max(0, z.col ?? 0));
      g[r][c] = { prob: z.pothole_probability || 0, label: z.zone_label || ZONE_LABELS[r][c], hits: z.pothole_hits || 0 };
    });
    return g;
  }, [grid]);

  const classLabels = Object.keys(detectedClasses);
  const classBarData = {
    labels: classLabels.length > 0 ? classLabels : ["(none detected)"],
    datasets: [{
      label: "Detections",
      data: classLabels.length > 0 ? classLabels.map(k => detectedClasses[k]) : [0],
      backgroundColor: "#000",
      borderRadius: 4,
    }],
  };

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111", margin: "0 0 8px 0" }}>Surface Defect Detection</h1>
          <p style={{ color: "#737373", fontSize: "14px", margin: 0 }}>Pinpoint structural damage and dispatch repair queues.</p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <select className="shdcn-input shdcn-select" style={{ width: "240px", cursor: "pointer" }} value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}>
            {files.length === 0 && <option value="">(no files found)</option>}
            {files.map(f => <option key={f.path} value={f.path}>{f.path.split('/').pop() || f.path}</option>)}
          </select>
          <button className="shdcn-button shdcn-button-outline" onClick={() => loadData(selectedPath, { force: true })} disabled={!selectedPath || loading}>
            {loading ? "Scanning Terrain..." : "Locate Defects"} <Target size={14} />
          </button>
        </div>
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "12px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: "500" }}>{error}</div>}

      <div className="stk-card" style={{ padding: "32px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "16px", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Prediction Zones</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{predictions.length}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Critical Priority</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{criticalCount}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>High Priority</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{highCount}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Model Confidence</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{avgConfidence}<span style={{fontWeight:"400", color:"#a3a3a3"}}>%</span></div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Event Samples</div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{eventSamples.length}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderLeft: "1px solid #e4e4e7", paddingLeft: "24px" }}>
             <div style={{ fontSize: "11px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Model Network</div>
             <div style={{ fontSize: "13px", fontWeight: "700", color: "#111" }}>{modelInfo.name || "N/A"}</div>
             <div style={{ fontSize: "11px", color: "#a3a3a3" }}>{(modelInfo.features || []).join(" • ")} | {modelInfo.calibration || "N/A"}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "24px" }}>
        
        <div className="stk-card" style={{ height: "460px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
           <div className="card-title">Priority Repair Queue</div>
          <div style={{ flex: 1, overflowY: "auto", paddingRight: "8px" }}>
            <table className="shdcn-table">
               <thead>
                 <tr>
                    <th>Zone</th>
                    <th>Priority</th>
                    <th style={{ textAlign: "right" }}>Repair Limit</th>
                 </tr>
               </thead>
               <tbody>
               {predictions.length === 0 ? (
                <tr><td colSpan="3" style={{ fontSize: "13px", color: "#737373", textAlign: "center", paddingTop: "40px" }}>No pothole risk zones detected in this replay.</td></tr>
              ) : predictions.map((p, i) => (
                <tr key={p.zone_id || i}>
                   <td style={{ fontWeight: "600", fontSize: "13px" }}>{p.zone_label || p.zone_id}<div style={{ fontSize:"11px", color:"#737373", fontWeight:"400" }}>Prob: {((p.pothole_probability || 0) * 100).toFixed(1)}% | Conf: {((p.confidence || 0) * 100).toFixed(0)}%</div></td>
                   <td><span className="shdcn-badge" style={{ background: priorityColor(p.priority), color: priorityText(p.priority) }}>{p.priority}</span></td>
                   <td style={{ textAlign: "right", fontWeight: "700", fontSize: "14px" }}>{p.repair_window_hours}H</td>
                </tr>
              ))}
               </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="stk-card" style={{ flex: 1 }}>
             <div className="card-title">Zone Defect Heatmap</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px", padding: "4px", background: "#f4f4f5", border: "1px solid #e8e8ea", borderRadius: "12px", height: "180px", marginBottom: "20px" }}>
              {zoneGrid.map((row, ri) => row.map((cell, ci) => {
                const pct = (cell.prob * 100).toFixed(0);
                const bg = cell.prob >= 0.5 ? "#000" : cell.prob >= 0.25 ? "#71717a" : "#fff";
                const txt = cell.prob >= 0.25 ? "#fff" : "#000";
                const brd = cell.prob < 0.25 ? "#e4e4e7" : "transparent";
                return (
                  <div key={`${ri}-${ci}`} style={{ background: bg, border: `1px solid ${brd}`, borderRadius: "8px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px", gap: "4px" }}>
                    <div style={{ fontWeight: 600, fontSize: "12px", color: txt }}>{cell.label}</div>
                    <div style={{ fontSize: "16px", fontWeight: "700", color: txt }}>{pct}%</div>
                    <div style={{ fontSize: "9px", color: txt, opacity: 0.6 }}>Hits: {cell.hits}</div>
                  </div>
                );
              }))}
            </div>

            <div style={{ height: "120px" }}>
              <Bar data={classBarData} options={{ responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display:false } }, scales: { x: chartAxis, y: { ...chartAxis, grid: {display:false} } } }} />
            </div>
          </div>
        </div>
      </div>

      <div className="stk-card">
         <div className="card-title">Event Evidence Log</div>
        <div style={{ background: "#f4f4f5", border: "1px solid #e4e4e7", padding: "16px", borderRadius: "8px", maxHeight: "240px", overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "12px", display: "flex", flexDirection: "column", gap: "8px", color: "#000" }}>
          {eventSamples.length === 0 ? <div style={{ color: "#737373" }}>No pothole events detected in this replay.</div> :
            eventSamples.slice(0, 40).map((ev, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 100px 150px 1fr", gap: "10px", alignItems: "center", borderBottom: "1px solid #e4e4e7", paddingBottom: "6px" }}>
                <span><span style={{color: "#a3a3a3"}}>FRM:</span> {ev.frame}</span>
                <span style={{ fontWeight: "700" }}>{ev.zone_label}</span>
                <span><span style={{color: "#a3a3a3"}}>CONF:</span> {(ev.confidence * 100).toFixed(0)}%</span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>POS: [{ev.center?.[0]}, {ev.center?.[1]}] | {ev.label}</span>
              </div>
            ))
          }
        </div>
      </div>
      
    </div>
  );
}
