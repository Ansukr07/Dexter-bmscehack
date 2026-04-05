import { useState, useEffect, useRef } from "react";
import { FolderOpen, Film, MapPin, Plus, RefreshCw, UploadCloud, Target, Image } from "lucide-react";

function FileUploadField({ label, accept, value, onChange, hint }) {
  const ref = useRef();
  return (
    <div style={{ marginBottom: "16px" }}>
      <label style={{ fontSize: "12px", fontWeight: "600", color: "#111", marginBottom: "8px", display: "block" }}>{label}</label>
      <div
        style={{ position: "relative", padding: "16px 20px", textAlign: "left", border: "1px dashed #d4d4d8", borderRadius: "8px", background: "#fafafa", cursor: "pointer", transition: "all 0.15s" }}
        onClick={() => ref.current?.click()}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = "#111"}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = "#d4d4d8"}
      >
        <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={(e) => onChange(e.target.files[0])} />
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <FolderOpen size={20} color="#737373" />
          <div>
            <div style={{ fontSize: "13px", color: "#111", fontWeight: "600" }}>{value ? value.name : `Choose ${label}`}</div>
            <div style={{ fontSize: "12px", color: "#737373", marginTop: "4px" }}>{hint}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MultiFileUploadField({ label, accept, values, onChange, hint }) {
  const ref = useRef();
  return (
    <div style={{ marginBottom: "16px" }}>
      <label style={{ fontSize: "12px", fontWeight: "600", color: "#111", marginBottom: "8px", display: "block" }}>{label}</label>
      <div
        style={{ position: "relative", padding: "16px 20px", textAlign: "left", border: "1px dashed #d4d4d8", borderRadius: "8px", background: "#fafafa", cursor: "pointer", transition: "all 0.15s" }}
        onClick={() => ref.current?.click()}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = "#111"}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = "#d4d4d8"}
      >
        <input ref={ref} type="file" multiple accept={accept} style={{ display: "none" }} onChange={(e) => onChange(Array.from(e.target.files || []))} />
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Film size={20} color="#737373" />
          <div>
            <div style={{ fontSize: "13px", color: "#111", fontWeight: "600" }}>{values?.length ? `${values.length} file(s) selected` : `Choose ${label}`}</div>
            <div style={{ fontSize: "12px", color: "#737373", marginTop: "4px" }}>{hint}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Location() {
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [locDetail, setLocDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [code, setCode] = useState("");
  const [cctv, setCctv] = useState(null);
  const [sat, setSat] = useState(null);
  const [layout, setLayout] = useState(null);
  const [roi, setRoi] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState(null);
  const [cctvPreview, setCctvPreview] = useState(null);
  const [satPreview, setSatPreview] = useState(null);

  const [footageFiles, setFootageFiles] = useState([]);
  const [importLocation, setImportLocation] = useState("");
  const [uploadingFootage, setUploadingFootage] = useState(false);
  const [footageMsg, setFootageMsg] = useState(null);
  const [footageLog, setFootageLog] = useState([]);

  const [lightbox, setLightbox] = useState(null); 

  const [gFile, setGFile] = useState(null);
  const [uploadingG, setUploadingG] = useState(false);
  const [gMsg, setGMsg] = useState(null);

  function loadLocations() {
    fetch("/api/locations").then((r) => r.json()).then(setLocations).catch(() => {});
  }

  function loadLocationDetail(codeValue) {
    const code = codeValue || selected;
    if (!code) { setLocDetail(null); return; }
    setLoadingDetail(true);
    fetch(`/api/locations/${code}`).then((r) => r.json()).then((d) => { setLocDetail(d); setLoadingDetail(false); }).catch(() => setLoadingDetail(false));
  }

  useEffect(() => { loadLocations(); }, []);

  useEffect(() => { if (!importLocation && locations.length > 0) setImportLocation(locations[0].code); }, [locations, importLocation]);

  useEffect(() => { if (!selected) { setLocDetail(null); return; } loadLocationDetail(selected); }, [selected]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!code.trim() || !cctv || !sat) { setCreateMsg({ type: "error", text: "Location code, CCTV and SAT images are required." }); return; }
    setCreating(true); setCreateMsg(null);
    const fd = new FormData();
    fd.append("code", code.trim()); fd.append("cctv", cctv); fd.append("sat", sat);
    if (layout) fd.append("layout", layout);
    if (roi) fd.append("roi", roi);
    try {
      const r = await fetch("/api/locations", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) {
        setCreateMsg({ type: "success", text: `Location '${code}' created successfully.` });
        setCode(""); setCctv(null); setSat(null); setLayout(null); setRoi(null); setCctvPreview(null); setSatPreview(null);
        loadLocations(); setSelected(code.trim()); setImportLocation(code.trim());
      } else { setCreateMsg({ type: "error", text: d.detail || "Failed to create location." }); }
    } catch (err) { setCreateMsg({ type: "error", text: String(err) }); } finally { setCreating(false); }
  }

  async function handleFootageUpload() {
    const target = importLocation || selected;
    if (!target || footageFiles.length === 0) return;
    setUploadingFootage(true); setFootageMsg(null);
    try {
      const fd = new FormData();
      for (const f of footageFiles) fd.append("files", f);
      const useBatch = footageFiles.length > 1;
      const endpoint = useBatch ? `/api/locations/${target}/footage/batch` : `/api/locations/${target}/footage`;
      if (!useBatch) { fd.delete("files"); fd.append("file", footageFiles[0]); }
      const r = await fetch(endpoint, { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) {
        const items = useBatch ? d.items || [] : [d];
        setFootageMsg({ type: "success", text: `Imported ${items.length} footage file(s).` });
        setFootageFiles([]);
        for (const item of items) {
          const m = item.metadata || {};
          const logLine = `[${new Date().toLocaleTimeString()}] [${target}] ${item.saved_as} | ${m.width || 0}x${m.height || 0}, ${m.fps || 0} FPS, ${m.frames || 0} frames`;
          setFootageLog((prev) => [...prev.slice(-29), logLine]);
        }
        if (selected === target) loadLocationDetail(target);
        loadLocations();
      } else { setFootageMsg({ type: "error", text: d.detail || "Upload failed" }); }
    } catch (err) { setFootageMsg({ type: "error", text: String(err) }); } finally { setUploadingFootage(false); }
  }

  async function handleGUpload() {
    if (!selected || !gFile) return;
    setUploadingG(true); setGMsg(null);
    const fd = new FormData(); fd.append("file", gFile);
    try {
      const r = await fetch(`/api/locations/${selected}/g_projection`, { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok) {
        setGMsg({ type: "success", text: "G-projection uploaded successfully." });
        setGFile(null);
        setSelected((s) => { setTimeout(() => setSelected(s), 10); return null; });
      } else { setGMsg({ type: "error", text: d.detail || "Upload failed" }); }
    } catch (err) { setGMsg({ type: "error", text: String(err) }); } finally { setUploadingG(false); }
  }

  return (
    <>
      {lightbox && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, cursor: "zoom-out" }} onClick={() => setLightbox(null)}>
          <div style={{ position: "absolute", top: 20, width: "100%", textAlign: "center", color: "#111", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 800 }}>{lightbox.title}</div>
          <img src={lightbox.url} style={{ maxWidth: "95vw", maxHeight: "85vh", borderRadius: "8px", boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.2)", border: "1px solid #e8e8ea" }} alt="Full view" />
          <div style={{ position: "absolute", bottom: 30, color: "#737373", fontSize: 13, fontWeight: "500" }}>Click anywhere to close</div>
        </div>
      )}
      <div className="fade-in" style={{ display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "stretch" }}>
        
        <div style={{ flex: "1", minWidth: "320px", maxWidth: "420px", display: "flex", flexDirection: "column", gap: "24px" }}>
          
          <div className="stk-card">
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}><MapPin size={16} /> Locations</div>
            {locations.length === 0 ? (
              <div style={{ color: "#737373", fontSize: "14px", textAlign: "center", padding: "24px 0" }}>No locations found</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {locations.map((loc) => (
                  <button key={loc.code} onClick={() => setSelected(loc.code)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderRadius: "8px", border: "1px solid", borderColor: selected === loc.code ? "#111" : "#e8e8ea", background: selected === loc.code ? "#f4f4f5" : "#fff", cursor: "pointer", transition: "all 0.2s" }}>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "#111", fontWeight: "700" }}>{loc.code}</div>
                      <div style={{ fontSize: "11px", color: "#737373", marginTop: "2px", fontWeight: "500" }}>{loc.footage_count} clip{loc.footage_count !== 1 ? "s" : ""}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
                      {loc.has_g_projection && <span className="shdcn-badge" style={{ background: "#f4f4f5", color: "#111", fontSize: "10px", padding: "2px 6px" }}>G-PROJ</span>}
                      {loc.has_cctv && loc.has_sat && <span className="shdcn-badge" style={{ background: "#f4f4f5", color: "#111", fontSize: "10px", padding: "2px 6px" }}>IMAGES</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
             <button className="shdcn-button shdcn-button-ghost" style={{ width: "100%", marginTop: "16px" }} onClick={loadLocations}><RefreshCw size={14} /> Refresh</button>
          </div>

          <div className="stk-card">
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}><Plus size={16} /> Create Location</div>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "#111", marginBottom: "8px", display: "block" }}>Location Code</label>
                <input className="shdcn-input" placeholder="e.g. 119NH" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <FileUploadField label="CCTV Frame" accept="image/*" value={cctv} onChange={(f) => { setCctv(f); if (f) setCctvPreview(URL.createObjectURL(f)); }} hint="PNG/JPG frame from CCTV camera" />
              <FileUploadField label="Satellite Image" accept="image/*" value={sat} onChange={(f) => { setSat(f); if (f) setSatPreview(URL.createObjectURL(f)); }} hint="Overhead satellite/map image" />
              <FileUploadField label="Layout SVG (optional)" accept=".svg" value={layout} onChange={setLayout} hint="Road layout SVG overlay" />
              <FileUploadField label="ROI Mask (optional)" accept="image/*" value={roi} onChange={setRoi} hint="Region of interest PNG mask" />
              {createMsg && <div style={{ background: createMsg.type === "success" ? "#f0fdf4" : "#fee2e2", border: `1px solid ${createMsg.type === "success" ? "#22c55e" : "#ef4444"}`, color: createMsg.type === "success" ? "#15803d" : "#b91c1c", padding: "12px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: "500", marginBottom: "16px" }}>{createMsg.text}</div>}
              <button type="submit" className="shdcn-button shdcn-button-primary" style={{ width: "100%" }} disabled={creating}>{creating ? "Creating…" : "+ Create Location"}</button>
            </form>

            {(cctvPreview || satPreview) && (
              <div style={{ marginTop: "24px" }}>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#111", marginBottom: "12px" }}>Media Preview</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#737373", marginBottom: "6px", fontWeight: "600" }}>CCTV</div>
                    {cctvPreview ? <img src={cctvPreview} alt="CCTV Preview" style={{ width: "100%", height: "80px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e8e8ea" }} />
                                 : <div style={{ width: "100%", height: "80px", background: "#f4f4f5", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#a3a3a3" }}>No CCTV</div>}
                    <button className="shdcn-button shdcn-button-ghost" style={{ width: "100%", marginTop: "8px", fontSize: "12px", height: "28px" }} onClick={() => setLightbox({ url: cctvPreview, title: "CCTV FRAME" })} type="button">Expand CCTV</button>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#737373", marginBottom: "6px", fontWeight: "600" }}>SATELLITE</div>
                    {satPreview ? <img src={satPreview} alt="SAT Preview" style={{ width: "100%", height: "80px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e8e8ea", cursor: "zoom-in" }} onClick={() => setLightbox({ url: satPreview, title: "SATELLITE IMAGE" })} />
                                : <div style={{ width: "100%", height: "80px", background: "#f4f4f5", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#a3a3a3" }}>No SAT</div>}
                    <button className="shdcn-button shdcn-button-ghost" style={{ width: "100%", marginTop: "8px", fontSize: "12px", height: "28px" }} onClick={() => setLightbox({ url: satPreview, title: "SATELLITE IMAGE" })} type="button">Expand SAT</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="stk-card">
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}><Film size={16} /> Import Footage</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px", marginBottom: "16px" }}>
              <select className="shdcn-input shdcn-select" value={importLocation} onChange={(e) => setImportLocation(e.target.value)}>
                {locations.length === 0 && <option value="">(none)</option>}
                {locations.map((l) => <option key={l.code} value={l.code}>{l.code}</option>)}
              </select>
            </div>
            <MultiFileUploadField label="Add footage (mp4)" accept=".mp4,video/mp4" values={footageFiles} onChange={setFootageFiles} hint="Select one or multiple MP4 files" />
            <button className="shdcn-button shdcn-button-primary" style={{ width: "100%" }} disabled={!importLocation || footageFiles.length === 0 || uploadingFootage} onClick={handleFootageUpload}>{uploadingFootage ? "Uploading..." : "Import Footage"}</button>
            {footageMsg && <div style={{ background: footageMsg.type === "success" ? "#f0fdf4" : "#fee2e2", border: `1px solid ${footageMsg.type === "success" ? "#22c55e" : "#ef4444"}`, color: footageMsg.type === "success" ? "#15803d" : "#b91c1c", padding: "12px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: "500", marginTop: "16px" }}>{footageMsg.text}</div>}
            
            <div style={{ background: "#000", color: "#a1a1aa", padding: "12px", borderRadius: "8px", minHeight: "120px", marginTop: "16px", fontSize: "11px", fontFamily: "var(--font-mono)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
              {footageLog.length === 0 ? <div style={{ color: "#71717a" }}>// Footage import log will appear here.</div> : footageLog.map((line, idx) => <div key={idx}>{line}</div>)}
            </div>
          </div>
        </div>

        <div style={{ flex: "2", minWidth: "400px", display: "flex", flexDirection: "column", gap: "24px" }}>
          {!selected ? (
            <div className="stk-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "300px" }}>
              <div style={{ textAlign: "center", color: "#a3a3a3" }}>
                <div style={{ fontSize: "40px", marginBottom: "16px", filter: "grayscale(100%)" }}>📍</div>
                <div style={{ fontSize: "15px", fontWeight: "500", color:"#737373" }}>Select a location to view details</div>
              </div>
            </div>
          ) : loadingDetail ? (
             <div className="stk-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "300px", color: "#737373", fontWeight: "500" }}>Loading...</div>
          ) : locDetail ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              
              <div className="stk-card" style={{ background: "#09090b", color: "#fff", padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "24px", fontWeight: "800", letterSpacing:"-0.5px" }}>{locDetail.code}</div>
                    <div style={{ fontSize: "13px", color: "#a1a1aa", marginTop: "4px", fontWeight: "500" }}>Location Reference Code</div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {locDetail.g_projection && <span className="shdcn-badge" style={{ background: "#fff", color: "#000", border: "none" }}>G-PROJECTION ✓</span>}
                    {locDetail.cctv_url && <span className="shdcn-badge" style={{ background: "#3f3f46", color: "#fff", border: "none" }}>CCTV ✓</span>}
                    {locDetail.sat_url && <span className="shdcn-badge" style={{ background: "#3f3f46", color: "#fff", border: "none" }}>SAT ✓</span>}
                  </div>
                </div>
              </div>

              {(locDetail.cctv_url || locDetail.sat_url) && (
                <div className="stk-card">
                  <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}><Image size={16} /> Location Imagery</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <div>
                      <div style={{ fontSize: "11px", color: "#737373", marginBottom: "8px", fontWeight: "600" }}>CCTV FRAME</div>
                      {locDetail.cctv_url ? <img src={locDetail.cctv_url} alt="CCTV" style={{ width: "100%", height: "180px", objectFit: "cover", borderRadius: "8px", border: "1px solid #e8e8ea", cursor: "zoom-in" }} onClick={() => setLightbox({ url: locDetail.cctv_url, title: "CCTV FRAME" })} />
                                          : <div style={{ width: "100%", height: "180px", background: "#f4f4f5", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: "#a3a3a3", fontSize: "13px" }}>No CCTV image</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#737373", marginBottom: "8px", fontWeight: "600" }}>SATELLITE</div>
                      {locDetail.sat_url ? <img src={locDetail.sat_url} alt="SAT" style={{ width: "100%", height: "180px", objectFit: "cover", borderRadius: "8px", border: "1px solid #e8e8ea", cursor: "zoom-in" }} onClick={() => setLightbox({ url: locDetail.sat_url, title: "SATELLITE IMAGE" })} />
                                         : <div style={{ width: "100%", height: "180px", background: "#f4f4f5", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: "#a3a3a3", fontSize: "13px" }}>No SAT image</div>}
                    </div>
                  </div>
                </div>
              )}

              <div className="stk-card">
                <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><Film size={16} /> Footage Clips</div>
                  <span className="shdcn-badge" style={{ background: "#f4f4f5", color: "#111" }}>{locDetail.footage?.length || 0} Clips</span>
                </div>
                {locDetail.footage?.length > 0 ? (
                  <table className="shdcn-table">
                    <thead><tr><th>File</th><th>Resolution</th><th>FPS</th><th>Duration</th><th>Frames</th></tr></thead>
                    <tbody>
                      {locDetail.footage.map((f) => (
                        <tr key={f.name}>
                          <td style={{ fontWeight: "600", color: "#111", fontSize: "13px" }}>{f.name}</td>
                          <td style={{ color: "#737373", fontSize: "13px" }}>{f.width}×{f.height}</td>
                          <td style={{ color: "#737373", fontSize: "13px" }}>{f.fps}</td>
                          <td style={{ color: "#737373", fontSize: "13px" }}>{f.duration_s}s</td>
                          <td style={{ color: "#737373", fontSize: "13px" }}>{f.frames}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: "#737373", fontSize: "14px", padding: "16px 0", textAlign: "center" }}>No footage clips yet</div>
                )}
                <div style={{ background: "#f4f4f5", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", color: "#737373", fontWeight: "500", marginTop: "24px", border: "1px solid #e8e8ea" }}>Use the left-side "Import Footage" section to add MP4 clips.</div>
              </div>

              <div className="stk-card">
                <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}><Target size={16} /> G-Projection Config</div>
                {!locDetail.g_projection ? (
                  <div style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "500", marginBottom: "20px" }}>No G-projection found. Please upload one or use the Calibration tool.</div>
                ) : (
                  <div style={{ background: "#f0fdf4", border: "1px solid #22c55e", color: "#15803d", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "500", marginBottom: "20px" }}>G-projection loaded. {locDetail.g_projection.use_svg ? "SVG mode." : "Raster mode."}</div>
                )}
                <div style={{ display: "flex", gap: "16px", alignItems: "flex-end" }}>
                   <div style={{ flex: 1 }}><FileUploadField label="Upload G_projection JSON" accept=".json" value={gFile} onChange={setGFile} hint={`Expected: G_projection_${selected}.json`} /></div>
                  <button className="shdcn-button shdcn-button-primary" style={{ marginBottom: "16px", height: "54px", padding: "0 24px" }} disabled={!gFile || uploadingG} onClick={handleGUpload}>
                    {uploadingG ? "Uploading..." : <><UploadCloud size={16} style={{ marginRight: "8px" }} /> Upload</>}
                  </button>
                </div>
                {gMsg && <div style={{ background: gMsg.type === "success" ? "#f0fdf4" : "#fee2e2", border: `1px solid ${gMsg.type === "success" ? "#22c55e" : "#ef4444"}`, color: gMsg.type === "success" ? "#15803d" : "#b91c1c", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "500" }}>{gMsg.text}</div>}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
