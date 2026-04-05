import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import * as tf from "@tensorflow/tfjs";
import { Bar, Line } from "react-chartjs-2";
import { ChevronDown, MoreHorizontal } from "lucide-react";
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
  Tooltip,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }

export default function AIAnalytics() {
  const location = useLocation();
  const queryPath = useMemo(() => new URLSearchParams(location.search).get("path") || "", [location.search]);

  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState(queryPath);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [modelRunning, setModelRunning] = useState(false);
  const [modelForecast, setModelForecast] = useState(null);

  useEffect(() => {
    fetchVisualizationFiles().then(list => {
      setFiles(list);
      if (!queryPath && list.length > 0 && !selectedPath) setSelectedPath(list[0].path);
    }).catch(() => {});
  }, [queryPath]);

  useEffect(() => {
    if (queryPath) setSelectedPath(queryPath);
  }, [queryPath]);

  async function loadAnalytics(path = selectedPath, { force = false } = {}) {
    if (!path) return;
    setLoading(true); setError("");
    try {
      const d = await fetchAnalytics(path, { sampleStep: DEFAULT_SAMPLE_STEP, force });
      setAnalytics(d); setModelForecast(null);
    } catch (e) { setError(String(e?.message || e)); } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!selectedPath) return;
    loadAnalytics(selectedPath);
    prefetchDisasterManagement(selectedPath, { sampleStep: DEFAULT_SAMPLE_STEP });
  }, [selectedPath]);

  async function runTensorForecast() {
    const timeline = analytics?.timeline || [];
    if (timeline.length < 10) { setError("Need at least 10 timeline points."); return; }
    setModelRunning(true); setError("");

    let xs, ys, xLast, predTensor, model;
    try {
      const maxVehicle = Math.max(1, ...timeline.map((p) => Number(p.vehicle_count || 0)));
      const xsData = []; const ysData = [];
      for (let i = 0; i < timeline.length - 1; i++) {
        const now = timeline[i]; const next = timeline[i + 1];
        xsData.push([Number(now.density || 0), Number(now.avg_speed_kmh || 0) / 30, Number(now.vehicle_count || 0) / maxVehicle, Number(now.congestion_score || 0), Number(now.risk_score || 0)]);
        ysData.push([Number(next.risk_score || 0)]);
      }
      xs = tf.tensor2d(xsData); ys = tf.tensor2d(ysData);

      model = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [5], units: 24, activation: "relu" }),
          tf.layers.dense({ units: 12, activation: "relu" }),
          tf.layers.dense({ units: 1, activation: "sigmoid" }),
        ],
      });
      model.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });

      await model.fit(xs, ys, { epochs: 36, batchSize: Math.min(16, xsData.length), shuffle: true, verbose: 0 });

      const last = timeline[timeline.length - 1];
      xLast = tf.tensor2d([[Number(last.density || 0), Number(last.avg_speed_kmh || 0) / 30, Number(last.vehicle_count || 0) / maxVehicle, Number(last.congestion_score || 0), Number(last.risk_score || 0)]]);
      predTensor = model.predict(xLast);
      const nextRisk = Number((await predTensor.data())[0] || 0);

      setModelForecast({ nextRisk: Number(nextRisk.toFixed(4)) });
    } catch (e) { setError(`TensorFlow forecast failed: ${e?.message || e}`); } finally {
      if (predTensor) predTensor.dispose(); if (xLast) xLast.dispose();
      if (xs) xs.dispose(); if (ys) ys.dispose(); if (model) model.dispose();
      setModelRunning(false);
    }
  }

  const timeline = analytics?.timeline || [];
  const summary = analytics?.summary || {};
  const kpis = analytics?.kpis || {};
  const recs = analytics?.recommendations || [];
  const labels = timeline.map((t) => String(t.frame));

  const chartAxis = { 
    ticks: { color: "#a0a0a0", font: { size: 10, family: "Inter" } }, 
    grid: { color: "#f0f0f0" }, 
    border: { display: false } 
  };

  // Black and white spline line graph matching Dynamics of the Balance
  const flowData = {
    labels,
    datasets: [{
      label: "Density",
      data: timeline.map(t => t.vehicle_count),
      borderColor: "#000000",
      backgroundColor: "transparent",
      fill: false,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#fff",
      pointBorderColor: "#000",
      pointBorderWidth: 2,
    },{
      label: "Speed",
      data: timeline.map(t => t.avg_speed_kmh),
      borderColor: "#d0d0d0",
      backgroundColor: "transparent",
      fill: false,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
    }],
  };

  // Minimal blocky bar chart matching Kreosis Analytics
  const classTotals = analytics?.distributions?.class_totals || {};
  const barData = {
    labels: ["Car", "Bus", "Bike", "Trk"],
    datasets: [{
      data: [Number(classTotals.car || 0), Number(classTotals.bus || 0), Number(classTotals.bike || 0), Number(classTotals.truck || 0)],
      backgroundColor: ["#000000", "#e4e4e7", "#a1a1aa", "#000000"],
      borderRadius: 4,
      borderSkipped: false,
      barThickness: 24,
    }],
  };

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      
      {error && <div style={{ background: "#fff", border: "1px solid #000", color: "#000", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "600" }}>Error: {error}</div>}

      {/* Grid Layout Top Mapping exactly to Kreosis */}
      <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr", gap: "24px" }}>
        
        {/* Card 1: Dynamics of Flow */}
        <div className="stk-card" style={{ height: "340px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#111" }}>Dynamics of the Traffic Flow</div>
            
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select 
                style={{ background: "#f8f8fa", color: "#111", border: "1px solid #e0e0e0", borderRadius: "100px", padding: "6px 14px", fontSize: "11px", fontWeight: "600", appearance: "none", cursor: "pointer", width: "120px" }}
                value={selectedPath} 
                onChange={e => setSelectedPath(e.target.value)}
              >
                {files.length === 0 && <option value="">(no source)</option>}
                {files.map(f => <option key={f.path} value={f.path}>{f.path.split('/').pop() || f.path}</option>)}
              </select>
              <button className="stk-btn-secondary" style={{ padding: "6px 12px" }} onClick={() => loadAnalytics(selectedPath, { force: true })} disabled={!selectedPath || loading}>
                {loading ? "Syncing..." : "Sync"}
              </button>
            </div>
          </div>
          
          <div style={{ flex: 1, minHeight: 0 }}>
             <Line 
               data={flowData} 
               options={{ 
                 responsive: true, 
                 maintainAspectRatio: false, 
                 plugins: { legend: { display: false } }, 
                 scales: { x: { display: false }, y: chartAxis },
                 interaction: { intersect: false, mode: 'index' }
               }} 
             />
          </div>
        </div>

        {/* Card 2: Analytics (Bar Chart) */}
        <div className="stk-card" style={{ height: "340px" }}>
          <div style={{ fontSize: "16px", fontWeight: "700", color: "#111", marginBottom: "20px" }}>Class Analytics</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Bar 
              data={barData} 
              options={{ 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { display: false } }, 
                scales: { x: { grid: { display: false }, border: { display: false } }, y: chartAxis }
              }} 
            />
          </div>
        </div>

      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr", gap: "24px" }}>
        
        {/* Card 3: Four Metrics */}
        <div className="stk-card" style={{ padding: "32px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "12px", color: "#777", fontWeight: "500", display: "flex", alignItems: "center", gap: "6px" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", border: "2px solid #111" }} /> Active Flow</div>
              <div style={{ fontSize: "28px", fontWeight: "800", color: "#111", letterSpacing: "-1px" }}>{Number(summary.avg_vehicle_count || 0).toFixed(0)}k</div>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "12px", color: "#777", fontWeight: "500", display: "flex", alignItems: "center", gap: "6px" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", border: "2px solid #111" }} /> Frames Analyzed</div>
              <div style={{ fontSize: "28px", fontWeight: "800", color: "#111", letterSpacing: "-1px" }}>{Number(summary.frames_total || 0)}</div>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "12px", color: "#777", fontWeight: "500", display: "flex", alignItems: "center", gap: "6px" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", border: "2px solid #111" }} /> Efficiency Index</div>
              <div style={{ fontSize: "28px", fontWeight: "800", color: "#111", letterSpacing: "-1px" }}>{Math.round(Number(kpis.junction_readiness || 0))}</div>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "12px", color: "#777", fontWeight: "500", display: "flex", alignItems: "center", gap: "6px" }}><div style={{ width: "6px", height: "6px", borderRadius: "50%", border: "2px solid #111" }} /> Target Risk</div>
              <div style={{ fontSize: "28px", fontWeight: "800", color: "#111", letterSpacing: "-1px" }}>{(Number(summary.avg_risk_score || 0)*100).toFixed(0)}</div>
            </div>

          </div>
        </div>

        {/* Card 4: Forecast Engine (Mapping to Available Balance black card) */}
        <div className="stk-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "28px 24px" }}>
          
          <div>
            <div style={{ fontSize: "14px", fontWeight: "600", color: "#111", marginBottom: "16px" }}>Forecasting Engine</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", marginBottom: "16px" }}>
              <span style={{ fontSize: "36px", fontWeight: "800", color: "#111", letterSpacing: "-1.5px", lineHeight: 1 }}>{modelForecast ? modelForecast.nextRisk.toFixed(3) : "0.000"}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid #e0e0e0", padding: "4px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "600", color: "#111" }}>IDX <ChevronDown size={12} /></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#777" }}>
              <div style={{ background: "#000", padding: "4px" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg></div>
              Next-Step Confidence Interval
            </div>
          </div>
          
          <button className="stk-btn-primary" style={{ width: "100%", marginTop: "24px" }} onClick={runTensorForecast} disabled={modelRunning || !analytics}>
            {modelRunning ? "TRAINING NETWORK..." : "INITIALIZE AI PREDICTION"}
          </button>
        </div>

      </div>

      {/* Card 5: Recent Anomalies Table */}
      <div className="stk-card">
        <div style={{ fontSize: "16px", fontWeight: "700", color: "#111", marginBottom: "24px" }}>Recent Anomalies & Recommendations</div>
        
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
          <thead>
            <tr style={{ color: "#808080", borderBottom: "1px solid #f0f0f0" }}>
              <th style={{ padding: "12px 16px", fontWeight: "500" }}>System Task <ChevronDown size={12} /></th>
              <th style={{ padding: "12px 16px", fontWeight: "500" }}>Priority <ChevronDown size={12} /></th>
              <th style={{ padding: "12px 16px", fontWeight: "500" }}>Date <ChevronDown size={12} /></th>
              <th style={{ padding: "12px 16px", fontWeight: "500" }}>Status <ChevronDown size={12} /></th>
              <th style={{ padding: "12px 16px", fontWeight: "500" }}>Actions <ChevronDown size={12} /></th>
            </tr>
          </thead>
          <tbody>
            {(recs.length > 0 ? recs.slice(0,4) : ["Standby mode... Waiting for data", "Optimizing memory load"]).map((rec, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td style={{ padding: "16px", display: "flex", alignItems: "center", gap: "12px", color: "#111", fontWeight: "600" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "6px", background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: "16px", height: "16px", border: "2px solid #000", borderRadius: "50%" }} />
                  </div>
                  <div style={{ maxWidth: "250px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rec}</div>
                </td>
                <td style={{ padding: "16px", fontWeight: "700", color: "#111" }}>Level {i+1}</td>
                <td style={{ padding: "16px", color: "#808080", fontSize: "12px" }}>Today<br/>10:00 AM</td>
                <td style={{ padding: "16px" }}>
                  <span style={{ border: "1px solid #e0e0e0", padding: "4px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: "600", color: "#111" }}>Identified</span>
                </td>
                <td style={{ padding: "16px", color: "#808080", cursor: "pointer" }}><MoreHorizontal size={16} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
