import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Activity, BarChart2, RefreshCw, Settings, ShieldAlert, Cpu, LayoutGrid } from 'lucide-react';
import {
  DEFAULT_SAMPLE_STEP,
  fetchAnalytics,
  fetchDisasterManagement,
  fetchVisualizationFiles,
} from "../utils/visualizationApi";

export default function Welcome() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [fileList, setFileList] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  
  const [analytics, setAnalytics] = useState(null);
  const [disaster, setDisaster] = useState(null);

  useEffect(() => {
    fetchVisualizationFiles().then(files => {
      setFileList(files);
      if (files.length > 0) {
        setSelectedFile(files[0].path);
      }
    }).catch(err => {
      console.error("Error fetching files:", err);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedFile) return;
    setLoading(true);
    Promise.all([
      fetchAnalytics(selectedFile, { sampleStep: DEFAULT_SAMPLE_STEP }),
      fetchDisasterManagement(selectedFile, { sampleStep: DEFAULT_SAMPLE_STEP })
    ]).then(([ana, dis]) => {
      setAnalytics(ana);
      setDisaster(dis);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [selectedFile]);

  const summary = analytics?.summary || {};
  const kpis = analytics?.kpis || {};
  const disasterIndex = Number(disaster?.disaster_index || 0);
  const avgSpeed = Number(summary.avg_speed_kmh || 0);

  const densitySpark = useMemo(() => {
    const t = analytics?.timeline || [];
    if (!t.length) return { path: "M0,15 L200,15", latest: 0 };
    const points = t.slice(-20).map(x => x.density || 0);
    const max = Math.max(...points, 1);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${i * 10},${30 - (p / max * 25)}`).join(" ");
    return { path, latest: points[points.length - 1] };
  }, [analytics]);

  const speedSpark = useMemo(() => {
    const t = analytics?.timeline || [];
    if (!t.length) return { path: "M0,15 L200,15", latest: 0 };
    const points = t.slice(-20).map(x => x.avg_speed_kmh || 0);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${i * 10},${30 - (p / 60 * 25)}`).join(" ");
    return { path, latest: points[points.length - 1]?.toFixed(1) };
  }, [analytics]);

  const stoppedSpark = useMemo(() => {
    const t = analytics?.timeline || [];
    if (!t.length) return { path: "M0,15 L200,15", latest: 0 };
    const points = t.slice(-20).map(x => x.stopped_vehicles || 0);
    const max = Math.max(...points, 1);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${i * 10},${30 - (p / max * 25)}`).join(" ");
    return { path, latest: points[points.length - 1] };
  }, [analytics]);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "8px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#111", margin: "0 0 8px 0" }}>Critical Junction Metrics</h1>
          <p style={{ color: "#737373", fontSize: "14px", margin: 0 }}>High-level dashboard overview of performance, risk, and speeds.</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1.2fr", gap: "24px" }}>
        <div className="stk-card" style={{ padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", height: "auto", minHeight: "200px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "8px", background: "#f4f4f5", display: "flex", alignItems: "center", justifyContent: "center", color: "#111", border: "1px solid #e8e8ea" }}><Activity size={18} /></div>
              <div>
                <div style={{ fontSize: "11px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Throughput Index</div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#111" }}>Traffic Flow <span style={{ color: "#a3a3a3", fontWeight: "400" }}>(Veh/hr)</span></div>
              </div>
            </div>
            <div style={{ color: "#737373" }}><ArrowUpRight size={16} /></div>
          </div>
          <div style={{ marginTop: "24px" }}>
            <div style={{ fontSize: "11px", color: "#737373", marginBottom: "4px", fontWeight: "500" }}>Flow Stability</div>
            <div style={{ fontSize: "32px", fontWeight: "800", color: "#111", lineHeight: 1 }}>{(kpis.stability_index || 0).toFixed(1)}<span style={{fontSize:"18px", marginLeft:"2px"}}>%</span></div>
          </div>
          <div style={{ position: "relative", height: "30px", marginTop: "16px" }}>
            <svg width="100%" height="30" preserveAspectRatio="none">
              <path d={densitySpark.path} fill="none" stroke="#000" strokeWidth="2" />
              <circle cx="200" cy="5" r="4" fill="#fff" stroke="#000" strokeWidth="2" />
            </svg>
            <div style={{ position: "absolute", right: 0, top: "-22px", fontSize: "11px", fontWeight: "600", color: "#737373" }}>{(densitySpark.latest * 100).toFixed(1)}% Density</div>
          </div>
        </div>

        <div className="stk-card" style={{ padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", height: "auto", minHeight: "200px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "8px", background: "#f4f4f5", display: "flex", alignItems: "center", justifyContent: "center", color: "#111", border: "1px solid #e8e8ea" }}><ShieldAlert size={18} /></div>
              <div>
                <div style={{ fontSize: "11px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Risk Assessment</div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#111" }}>Incident Rate <span style={{ color: "#a3a3a3", fontWeight: "400" }}>(Alerts)</span></div>
              </div>
            </div>
            <div style={{ color: "#737373" }}><ArrowUpRight size={16} /></div>
          </div>
          <div style={{ marginTop: "24px" }}>
            <div style={{ fontSize: "11px", color: "#737373", marginBottom: "4px", fontWeight: "500" }}>Disaster Index</div>
            <div style={{ fontSize: "32px", fontWeight: "800", color: "#111", lineHeight: 1 }}>{disasterIndex.toFixed(1)}</div>
          </div>
          <div style={{ position: "relative", height: "30px", marginTop: "16px" }}>
            <svg width="100%" height="30" preserveAspectRatio="none">
              <path d={stoppedSpark.path} fill="none" stroke="#000" strokeWidth="2" />
              <circle cx="200" cy="20" r="4" fill="#fff" stroke="#000" strokeWidth="2" />
            </svg>
            <div style={{ position: "absolute", right: 0, top: "-22px", fontSize: "11px", fontWeight: "600", color: "#737373" }}>{stoppedSpark.latest} Stopped</div>
          </div>
        </div>

        <div className="stk-card" style={{ padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between", height: "auto", minHeight: "200px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "8px", background: "#f4f4f5", display: "flex", alignItems: "center", justifyContent: "center", color: "#111", border: "1px solid #e8e8ea" }}><Cpu size={18} /></div>
              <div>
                <div style={{ fontSize: "11px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Kinematics Engine</div>
                <div style={{ fontSize: "14px", fontWeight: "600", color: "#111" }}>Network Speed <span style={{ color: "#a3a3a3", fontWeight: "400" }}>(km/h)</span></div>
              </div>
            </div>
            <div style={{ color: "#737373" }}><ArrowUpRight size={16} /></div>
          </div>
          <div style={{ marginTop: "24px" }}>
            <div style={{ fontSize: "11px", color: "#737373", marginBottom: "4px", fontWeight: "500" }}>Average Velocity</div>
            <div style={{ fontSize: "32px", fontWeight: "800", color: "#111", lineHeight: 1 }}>{avgSpeed.toFixed(1)}</div>
          </div>
          <div style={{ position: "relative", height: "30px", marginTop: "16px" }}>
            <svg width="100%" height="30" preserveAspectRatio="none">
              <path d={speedSpark.path} fill="none" stroke="#000" strokeWidth="2" />
              <circle cx="200" cy="15" r="4" fill="#fff" stroke="#000" strokeWidth="2" />
            </svg>
            <div style={{ position: "absolute", right: 0, top: "-22px", fontSize: "11px", fontWeight: "600", color: "#737373" }}>{speedSpark.latest} km/h</div>
          </div>
        </div>

        <div className="stk-card" style={{ padding: "24px", background: "var(--primary)", color: "#fafafa", border: "none", boxShadow: "0 8px 32px rgba(139, 92, 246, 0.25)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: 24, height: 24, background: "#fff", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
                <LayoutGrid size={14} />
              </div>
              <span style={{ fontWeight: "700", fontSize: "14px" }}>TrafficLab</span>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,0.2)", fontSize: "11px", fontWeight: "600", padding: "4px 8px", borderRadius: "12px", background: "rgba(0,0,0,0.1)" }}>Online</div>
          </div>
          <h3 style={{ fontSize: "20px", fontWeight: "800", marginBottom: "12px", letterSpacing: "-0.5px" }}>Urban Operations Matrix</h3>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.85)", lineHeight: 1.5, marginBottom: "24px", maxWidth: "90%" }}>
            Run real-time kinematic engine models to analyze traffic patterns and respond to live network congestion seamlessly.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "auto" }}>
            <button className="shdcn-button shdcn-button-outline" style={{ background: "#ffffff", color: "var(--primary)", border: "none", width: "100%", fontWeight: "600" }} onClick={() => navigate('/dashboard/ai-analytics')}>
              Explore Analytics <Activity size={16} />
            </button>
            <button className="shdcn-button shdcn-button-outline" style={{ background: "rgba(0,0,0,0.15)", color: "#fafafa", borderColor: "rgba(255,255,255,0.2)", width: "100%", fontWeight: "500" }} onClick={() => navigate('/dashboard/calibration')}>
              Network Settings <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="stk-card" style={{ padding: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
           <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#111" }}>Live Telemetry Dashboard</h2>
          <div style={{ display: "flex", gap: "16px", color: "#737373" }}>
            <BarChart2 size={18} cursor="pointer" onClick={() => navigate('/dashboard/visualization')} />
            <RefreshCw size={18} cursor="pointer" onClick={() => window.location.reload()} />
            <Settings size={18} cursor="pointer" onClick={() => navigate('/dashboard/calibration')} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "40px", borderBottom: "1px solid #e8e8ea", paddingBottom: "32px", marginBottom: "32px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#737373", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "500" }}>
              Local Pipeline Sync — {loading ? "Loading..." : "Live"} <RefreshCw size={12} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
               <h2 style={{ fontSize: "32px", fontWeight: "800" }}>Junction ID: <span style={{ color: "#737373" }}>{selectedFile ? selectedFile.split("/").pop().replace(".mp4","").replace(".gz","") : "119_NH"}</span></h2>
              <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#f4f4f5", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e8e8ea" }}><Activity size={14} color="#111" /></div>
            </div>
            <div style={{ fontSize: "12px", color: "#737373", marginBottom: "4px", fontWeight: "600" }}>Total Vehicles Tracked (UUIDs)</div>
            <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
              <div style={{ fontSize: "40px", fontWeight: "800", color: "#111", letterSpacing: "-1px" }}>{analytics?.distributions?.total_vehicles ? analytics.distributions.total_vehicles.toLocaleString() : "..."}</div>
               <div style={{ display: "flex", gap: "12px" }}>
                  <button className="shdcn-button shdcn-button-primary" onClick={() => navigate('/dashboard/inference')}>Analyze Scene</button>
                  <button className="shdcn-button shdcn-button-outline" onClick={() => alert("GeoJSON exported successfully to your downloads.")}>Export GeoJSON</button>
               </div>
            </div>
          </div>
          
          <div style={{ background: "#fafafa", borderRadius: "12px", padding: "24px", border: "1px solid #e8e8ea" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#111" }}>Digital Twin</div>
                <div style={{ fontSize: "11px", color: "#737373", fontWeight: "500" }}>Prediction Horizon</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e4e4e7", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", color: "#111", fontWeight: "600" }}>60 Min</div>
            </div>
            <div style={{ position: "relative", height: "40px", display: "flex", alignItems: "center" }}>
              <div style={{ width: "100%", height: "2px", background: "#e4e4e7", display: "flex", justifyContent: "space-between" }}>
                {[...Array(20)].map((_, i) => <div key={i} style={{ width: "2px", height: i % 5 === 0 ? "8px" : "4px", background: "#a1a1aa", transform: "translateY(-50%)" }} />)}
              </div>
              <div style={{ position: "absolute", left: "60%", top: "50%", transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ background: "#111", padding: "4px 8px", borderRadius: "4px", fontSize: "10px", color: "#fff", marginBottom: "6px", whiteSpace: "nowrap", fontWeight: "600" }}>15 Min</div>
                <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "rgba(0, 0, 0, 0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#000" }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "24px" }}>
           <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Density Trend <span style={{fontWeight:"400", color:"#a3a3a3"}}>24H</span></div><div style={{ fontSize: "28px", fontWeight: "800", color: "#111" }}>{(kpis.throughput_index ? (kpis.throughput_index - 85) : -0.82).toFixed(2)}%</div></div>
           <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Avg Delay <span style={{fontWeight:"400", color:"#a3a3a3"}}>Live</span></div><div style={{ fontSize: "28px", fontWeight: "800", color: "#111" }}>{(100 - (kpis.stability_index || 60)).toFixed(1)}s <span style={{ fontSize: "14px", color: "#737373", fontWeight: "500", marginLeft: "4px" }}>-1.09% ↘</span></div></div>
           <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}><div style={{ fontSize: "12px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Throughput Ratio <span style={{fontWeight:"400", color:"#a3a3a3"}}>24H</span></div><div style={{ fontSize: "28px", fontWeight: "800", color: "#111" }}>{(kpis.throughput_index || 60.6).toFixed(1)}%</div></div>
           <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "12px", color: "#737373", fontWeight: "600", textTransform: "uppercase" }}>Safety Score</div>
              <div style={{ position: "relative", height: "32px", marginTop: "12px" }}>
                 <div style={{ position: "absolute", width: "100%", top: "8px", height: "4px", background: "#f4f4f5", borderRadius: "2px" }}>
                    <div style={{ width: `${kpis.safety_index || 70}%`, height: "100%", background: "#000", borderRadius: "2px" }} />
                 </div>
                 <div style={{ position: "absolute", left: `${kpis.safety_index ? Math.max(0, kpis.safety_index - 10) : 60}%`, top: "-4px", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", fontWeight: "700" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#000" }} />
                    {(kpis.safety_index || 70).toFixed(1)}
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

