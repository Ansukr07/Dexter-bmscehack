import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bar, Line, Radar, Doughnut } from "react-chartjs-2";
import { Activity, Car, TrendingUp, AlertTriangle, ShieldCheck, MapPin } from "lucide-react";
import {
  DEFAULT_SAMPLE_STEP,
  fetchAnalytics,
  fetchVisualizationFiles,
  prefetchDisasterManagement,
} from "../utils/visualizationApi";
import {
  ArcElement, BarElement, CategoryScale, Chart as ChartJS,
  Filler, Legend, LineElement, LinearScale, PointElement,
  RadialLinearScale, Tooltip,
} from "chart.js";

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, RadialLinearScale, Tooltip, Legend, Filler,
);

const chartAxis = {
  ticks: { color: "#a0a0a0", font: { size: 11, family: "Inter" } },
  grid: { color: "#f0f0f0" },
  border: { display: false },
};

const smallOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { x: { display: false }, y: chartAxis },
};

export default function BehaviorPatterns() {
  const loc = useLocation();
  const queryPath = useMemo(() => new URLSearchParams(loc.search).get("path") || "", [loc.search]);

  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState(queryPath);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchVisualizationFiles()
      .then(list => {
        setFiles(list);
        if (!queryPath && list.length > 0 && !selectedPath) setSelectedPath(list[0].path);
      }).catch(() => {});
  }, []);

  useEffect(() => { if (queryPath) setSelectedPath(queryPath); }, [queryPath]);

  async function loadData(path = selectedPath, { force = false } = {}) {
    if (!path) return;
    setLoading(true); setError("");
    try {
      const d = await fetchAnalytics(path, { sampleStep: DEFAULT_SAMPLE_STEP, force });
      setAnalytics(d);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!selectedPath) return;
    loadData(selectedPath);
    prefetchDisasterManagement(selectedPath, { sampleStep: DEFAULT_SAMPLE_STEP });
  }, [selectedPath]);

  const timeline = analytics?.timeline || [];
  const summary = analytics?.summary || {};
  const kpis = analytics?.kpis || {};
  const distributions = analytics?.distributions || {};
  const labels = timeline.map(t => String(t.frame));

  const speedBuckets = useMemo(() => {
    const buckets = { "0-5": 0, "5-10": 0, "10-15": 0, "15-20": 0, "20-30": 0, "30+": 0 };
    timeline.forEach(t => {
      const s = Number(t.avg_speed_kmh || 0);
      if (s < 5) buckets["0-5"]++;
      else if (s < 10) buckets["5-10"]++;
      else if (s < 15) buckets["10-15"]++;
      else if (s < 20) buckets["15-20"]++;
      else if (s < 30) buckets["20-30"]++;
      else buckets["30+"]++;
    });
    return buckets;
  }, [timeline]);

  const transitions = useMemo(() => {
    const t = { "LOW→LOW": 0, "LOW→MED": 0, "LOW→HIGH": 0, "MED→LOW": 0, "MED→MED": 0, "MED→HIGH": 0, "HIGH→LOW": 0, "HIGH→MED": 0, "HIGH→HIGH": 0 };
    const short = { LOW: "LOW", MEDIUM: "MED", HIGH: "HIGH" };
    for (let i = 1; i < timeline.length; i++) {
      const prev = short[timeline[i - 1].congestion_level] || "LOW";
      const curr = short[timeline[i].congestion_level] || "LOW";
      const key = `${prev}→${curr}`;
      if (key in t) t[key]++;
    }
    return t;
  }, [timeline]);

  const densityData = {
    labels,
    datasets: [{
      label: "Density", data: timeline.map(t => t.density),
      borderColor: "#000", backgroundColor: "rgba(0,0,0,0.05)", fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0
    }, {
      label: "Congestion Score", data: timeline.map(t => t.congestion_score),
      borderColor: "#a1a1aa", backgroundColor: "transparent", fill: false, tension: 0.4, borderWidth: 2, borderDash: [4, 4], pointRadius: 0
    }],
  };

  const speedHistData = {
    labels: Object.keys(speedBuckets),
    datasets: [{
      label: "Frames in Range",
      data: Object.values(speedBuckets),
      backgroundColor: ["#e4e4e7", "#d4d4d8", "#a1a1aa", "#71717a", "#3f3f46", "#000"],
      borderRadius: 4,
    }],
  };

  const classTotals = distributions.class_totals || {};
  const classData = {
    labels: ["Car", "Bike", "Bus", "Truck", "Other"],
    datasets: [{
      data: [classTotals.car || 0, classTotals.bike || 0, classTotals.bus || 0, classTotals.truck || 0, classTotals.other || 0],
      backgroundColor: ["#000", "#3f3f46", "#71717a", "#a1a1aa", "#e4e4e7"],
      borderWidth: 0,
    }],
  };

  const radarData = {
    labels: ["Throughput", "Stability", "Safety", "Readiness"],
    datasets: [{
      label: "Current", data: [kpis.throughput_index || 0, kpis.stability_index || 0, kpis.safety_index || 0, kpis.junction_readiness || 0],
      borderColor: "#000", backgroundColor: "rgba(0,0,0,0.05)", borderWidth: 2,
    }],
  };

  const flowData = {
    labels,
    datasets: [{
      label: "Vehicles Tracked", data: timeline.map(t => t.vehicle_count),
      borderColor: "#000", backgroundColor: "rgba(0,0,0,0.05)", fill: true, tension: 0.4, borderWidth: 2, yAxisID: "yL", pointRadius: 0
    }, {
      label: "Stopped Hazards", data: timeline.map(t => t.stopped_vehicles || 0),
      borderColor: "#71717a", backgroundColor: "transparent", fill: true, tension: 0.4, borderWidth: 2, yAxisID: "yR", pointRadius: 0
    }],
  };

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111", margin: "0 0 8px 0" }}>Behavior Patterns</h1>
          <p style={{ color: "#737373", fontSize: "14px", margin: 0 }}>Systemic flow patterns, speed profiles, and macroscopic tracking traces.</p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <select className="shdcn-input shdcn-select" style={{ width: "240px", cursor: "pointer" }} value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}>
            {files.length === 0 && <option value="">(no files found)</option>}
            {files.map((f) => <option key={f.path} value={f.path}>{f.path.split('/').pop() || f.path}</option>)}
          </select>
          <button className="shdcn-button shdcn-button-outline" onClick={() => loadData(selectedPath, { force: true })} disabled={!selectedPath || loading}>
            {loading ? "Analyzing..." : "Analyze Pipeline"} <Activity size={14} />
          </button>
        </div>
      </div>

      {error && <div style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "12px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: "500" }}>{error}</div>}

      <div className="stk-card" style={{ padding: "32px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Avg Speed <span style={{fontWeight:"400", color:"#a3a3a3"}}>km/h</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(summary.avg_speed_kmh || 0).toFixed(1)}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Volume <span style={{fontWeight:"400", color:"#a3a3a3"}}>Total</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(summary.avg_vehicle_count || 0).toFixed(0)}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Peak Flow <span style={{fontWeight:"400", color:"#a3a3a3"}}>Max</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{summary.peak_vehicle_count ?? 0}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Stability Index <span style={{fontWeight:"400", color:"#a3a3a3"}}>/100</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(kpis.stability_index || 0).toFixed(1)}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600" }}>Safety Score <span style={{fontWeight:"400", color:"#a3a3a3"}}>/100</span></div><div style={{ fontSize: "24px", fontWeight: "800", color: "#111" }}>{Number(kpis.safety_index || 0).toFixed(1)}</div></div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div className="stk-card" style={{ height: "340px" }}>
          <div className="card-title"><div>Speed Distribution <span style={{fontSize:"11px", fontWeight:"500", color:"#737373", marginLeft:"4px"}}>km/h</span></div></div>
          <div style={{ flex: 1, position: "relative" }}><Bar data={speedHistData} options={{ ...smallOpts, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10, family: "Inter" } } }, y: chartAxis } }} /></div>
        </div>
        
        <div className="stk-card" style={{ height: "340px" }}>
          <div className="card-title"><div>Vehicle Composition <span style={{fontSize:"11px", fontWeight:"500", color:"#737373", marginLeft:"4px"}}>Classes</span></div></div>
          <div style={{ flex: 1, position: "relative" }}>
            <Doughnut data={classData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { color: "#737373", font: { size: 11, family: "Inter" }, boxWidth: 10 } } }, cutout: "70%" }} />
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none", marginLeft: "-40px" }}>
              <div style={{ fontSize: "24px", fontWeight: "800", letterSpacing: "-0.5px", color: "#111" }}>{Object.values(classTotals).reduce((a,b)=>a+b,0)}</div>
              <div style={{ fontSize: "11px", color: "#737373", fontWeight:"500" }}>Total</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div className="stk-card" style={{ height: "340px" }}>
          <div className="card-title">Vehicle Count & Stationary Hazards</div>
          <div style={{ flex: 1, position: "relative" }}>
            <Line data={flowData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display:false } }, scales: { x: { display: false }, yL: { ...chartAxis, position: "left" }, yR: { ...chartAxis, position: "right", grid: { drawOnChartArea: false } } } }} />
          </div>
        </div>
        
        <div className="stk-card" style={{ height: "340px" }}>
          <div className="card-title">Density & Congestion Evolution</div>
          <div style={{ flex: 1, position: "relative" }}>
             <Line data={densityData} options={{ ...smallOpts, scales: { x: { display: false }, y: { ...chartAxis, min: 0, max: 1 } } }} />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "24px" }}>
        <div className="stk-card" style={{ height: "360px" }}>
          <div className="card-title">KPI Fingerprint</div>
          <div style={{ flex: 1, position: "relative" }}>
            <Radar data={radarData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { angleLines: { color: "#f0f0f0" }, grid: { color: "#f0f0f0" }, pointLabels: { color: "#737373", font: { size: 10, family: "Inter", weight:"600" } }, ticks: { display: false }, min: 0, max: 100 } } }} />
          </div>
        </div>
        
        <div className="stk-card" style={{ height: "360px", overflow: "hidden" }}>
          <div className="card-title">Congestion State Transitions</div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table className="shdcn-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Transition</th>
                  <th>Occurrences</th>
                  <th style={{ width: "60%" }}>Distribution</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(transitions).map(([key, count]) => {
                  const total = Math.max(1, timeline.length - 1);
                  const pct = ((count / total) * 100).toFixed(1);
                  return (
                    <tr key={key}>
                      <td style={{ fontWeight: "600" }}>{key}</td>
                      <td style={{ fontWeight: "700" }}>{count}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ flex: 1, height: "6px", background: "#f4f4f5", borderRadius: "3px" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: "#000", borderRadius: "3px" }} />
                          </div>
                          <div style={{ fontSize: "12px", width: "40px", textAlign: "right", fontWeight: "600", color: "#737373" }}>{pct}%</div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
    </div>
  );
}
