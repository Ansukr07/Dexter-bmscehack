import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

function BoolRow({ label, checked, onChange }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function ListFilesModal({ files, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(4,8,14,0.9)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="card"
        style={{
          width: "min(860px, 94vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div className="card-title" style={{ marginBottom: 0 }}>
            Available Output Files
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div
          className="log-terminal"
          style={{ maxHeight: "70vh", overflowY: "auto", lineHeight: 1.5 }}
        >
          {files.length === 0 ? (
            <div style={{ color: "rgba(200,216,240,0.4)" }}>
              (no files found in output/)
            </div>
          ) : (
            files.map((f, i) => (
              <div key={f.path}>
                {i + 1}. {f.path}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function Visualization() {
  const location = useLocation();
  const navigate = useNavigate();

  const [files, setFiles] = useState([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [loadedPath, setLoadedPath] = useState("");
  const [meta, setMeta] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showFileList, setShowFileList] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [verticalSplit, setVerticalSplit] = useState(false);
  const [streamNonce, setStreamNonce] = useState(0);

  const [fps, setFps] = useState(30);
  const [jumpFrames, setJumpFrames] = useState(60);
  const [startFrame, setStartFrame] = useState(0);
  const [currentFrame, setCurrentFrame] = useState(0);

  const [showTracking, setShowTracking] = useState(true);
  const [show3d, setShow3d] = useState(true);
  const [showLabel, setShowLabel] = useState(true);
  const [showRoi, setShowRoi] = useState(false);

  const [satOpacity, setSatOpacity] = useState(0);
  const [layerPhysical, setLayerPhysical] = useState(true);
  const [layerGuidelines, setLayerGuidelines] = useState(false);
  const [layerAesthetic, setLayerAesthetic] = useState(true);
  const [layerBackground, setLayerBackground] = useState(true);

  const [showSatBox, setShowSatBox] = useState(true);
  const [showSatCoordsDot, setShowSatCoordsDot] = useState(false);
  const [showSatArrow, setShowSatArrow] = useState(false);
  const [showSatLabel, setShowSatLabel] = useState(false);
  const [satBoxThick, setSatBoxThick] = useState(2);
  const [satLabelSize, setSatLabelSize] = useState(12);
  const [textColorMode, setTextColorMode] = useState("White");
  const [speedDelay, setSpeedDelay] = useState(30);
  const [showFov, setShowFov] = useState(false);
  const [fovFillPct, setFovFillPct] = useState(25);

  // Overlay toggles
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showIncidents, setShowIncidents] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [showDisasterZones, setShowDisasterZones] = useState(false);
  const [showPotholeAlerts, setShowPotholeAlerts] = useState(false);

  const cctvRef = useRef(null);
  const satRef = useRef(null);
  const timerRef = useRef(null);

  const maxFrames = useMemo(() => {
    if (!meta) return 0;
    const counts = [
      Number(meta.mp4_frame_count || 0),
      Number(meta.animation_frame_count || 0),
      Number(meta.frame_count || 0),
    ].filter((v) => Number.isFinite(v) && v > 0);
    return counts.length ? Math.max(...counts) : 0;
  }, [meta]);

  function fetchFiles() {
    fetch("/api/visualization/files")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setFiles(list);
        if (!selectedPath && list.length > 0) setSelectedPath(list[0].path);
      })
      .catch(() => {});
  }

  function fetchMeta(path) {
    if (!path) return;
    setLoadingMeta(true);
    fetch(`/api/visualization/data?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => {
        setMeta(d);
        setLoadingMeta(false);
      })
      .catch(() => setLoadingMeta(false));
  }

  useEffect(() => {
    fetchFiles();
  }, []);

  useEffect(() => {
    const queryPath = new URLSearchParams(location.search).get("path");
    if (!queryPath) return;
    setSelectedPath(queryPath);
    setLoadedPath(queryPath);
    fetchMeta(queryPath);
  }, [location.search]);

  useEffect(() => {
    if (!streaming) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(
      () => {
        setCurrentFrame((prev) => {
          if (maxFrames > 0 && prev + 1 >= maxFrames) {
            setStreaming(false);
            return Math.max(0, maxFrames - 1);
          }
          return prev + 1;
        });
      },
      Math.max(16, Math.floor(1000 / Math.max(1, fps))),
    );
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [streaming, fps, maxFrames]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === " ") {
        e.preventDefault();
        if (streaming) handleStop();
        else handlePlay();
      } else if (e.key.toLowerCase() === "r") {
        setStartFrame(0);
        setCurrentFrame(0);
        if (streaming) setStreamNonce((n) => n + 1);
      } else if (e.key === "ArrowLeft") {
        jumpBy(-1);
      } else if (e.key === "ArrowRight") {
        jumpBy(1);
      } else if (e.key.toLowerCase() === "a") {
        setSidebarCollapsed((v) => !v);
      } else if (e.key.toLowerCase() === "t") {
        setShowSatLabel((v) => !v);
      } else if (e.key.toLowerCase() === "h") {
        setShowSatArrow((v) => !v);
      } else if (e.key.toLowerCase() === "g") {
        setLayerGuidelines((v) => !v);
      } else if (e.key === "1") {
        setShowTracking((v) => !v);
      } else if (e.key === "2") {
        setShowRoi((v) => !v);
      } else if (e.key === "3") {
        setShow3d((v) => !v);
      } else if (e.key === "5") {
        setVerticalSplit((v) => !v);
      } else if (e.key === "6") {
        setShowSatCoordsDot((v) => !v);
      } else if (e.key === "7") {
        setShowSatBox((v) => !v);
      } else if (e.key.toLowerCase() === "f") {
        setShowFov((v) => !v);
      } else if (e.key === "8") {
        setShowHeatmap((v) => !v);
      } else if (e.key === "9") {
        setShowIncidents((v) => !v);
      } else if (e.key === "0") {
        setShowRecommendations((v) => !v);
      } else if (e.key.toLowerCase() === "d") {
        setShowDisasterZones((v) => !v);
      } else if (e.key.toLowerCase() === "p") {
        setShowPotholeAlerts((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function handleLoadSelected() {
    if (!selectedPath) return;
    setLoadedPath(selectedPath);
    setStartFrame(0);
    setCurrentFrame(0);
    setStreaming(false);
    fetchMeta(selectedPath);
  }

  function handlePlay() {
    const pathToPlay = selectedPath || loadedPath;
    if (!pathToPlay) return;
    if (loadedPath !== pathToPlay) {
      setLoadedPath(pathToPlay);
      fetchMeta(pathToPlay);
    }
    setCurrentFrame(startFrame);
    setStreaming(true);
    setStreamNonce((n) => n + 1);
  }

  function handleStop() {
    setStreaming(false);
  }

  function jumpBy(delta) {
    const maxF = maxFrames > 0 ? maxFrames : Number.POSITIVE_INFINITY;
    const next = Math.max(0, Math.min(maxF - 1, startFrame + delta));
    setStartFrame(next);
    setCurrentFrame(next);
    if (streaming) setStreamNonce((n) => n + 1);
  }

  const cctvUrl = useMemo(() => {
    if (!streaming || !loadedPath) return "";
    const q = new URLSearchParams({
      path: loadedPath,
      fps: String(fps),
      show_3d: String(show3d),
      show_label: String(showLabel),
      show_tracking: String(showTracking),
      show_roi: String(showRoi),
      show_heatmap: String(showHeatmap),
      show_incidents: String(showIncidents),
      show_recommendations: String(showRecommendations),
      show_disaster_zones: String(showDisasterZones),
      show_pothole_alerts: String(showPotholeAlerts),
      start_frame: String(startFrame),
      nonce: String(streamNonce),
    });
    return `/api/visualization/stream/cctv?${q.toString()}`;
  }, [
    streaming,
    loadedPath,
    fps,
    show3d,
    showLabel,
    showTracking,
    showRoi,
    showHeatmap,
    showIncidents,
    showRecommendations,
    showDisasterZones,
    showPotholeAlerts,
    startFrame,
    streamNonce,
  ]);

  const satUrl = useMemo(() => {
    if (!streaming || !loadedPath) return "";
    const q = new URLSearchParams({
      path: loadedPath,
      fps: String(fps),
      show_3d: String(show3d),
      show_tracking: String(showTracking),
      show_sat_box: String(showSatBox),
      show_sat_arrow: String(showSatArrow),
      show_sat_coords_dot: String(showSatCoordsDot),
      show_sat_label: String(showSatLabel),
      sat_label_size: String(satLabelSize),
      sat_box_thick: String(satBoxThick),
      text_color_mode: textColorMode,
      speed_delay_frames: String(speedDelay),
      sat_opacity: String(satOpacity),
      layer_physical: String(layerPhysical),
      layer_guidelines: String(layerGuidelines),
      layer_aesthetic: String(layerAesthetic),
      layer_background: String(layerBackground),
      show_fov: String(showFov),
      fov_fill_pct: String(fovFillPct),
      start_frame: String(startFrame),
      nonce: String(streamNonce),
    });
    return `/api/visualization/stream/sat?${q.toString()}`;
  }, [
    streaming,
    loadedPath,
    fps,
    show3d,
    showTracking,
    showSatBox,
    showSatArrow,
    showSatCoordsDot,
    showSatLabel,
    satLabelSize,
    satBoxThick,
    textColorMode,
    speedDelay,
    satOpacity,
    layerPhysical,
    layerGuidelines,
    layerAesthetic,
    layerBackground,
    showFov,
    fovFillPct,
    startFrame,
    streamNonce,
  ]);

  const analysisPath = loadedPath || selectedPath;

  return (
    <>
      {showFileList && (
        <ListFilesModal files={files} onClose={() => setShowFileList(false)} />
      )}

      <div className="page-header">
        <div className="page-title">VISUALIZATION</div>
        <div className="page-subtitle">
          CCTV + SATELLITE REPLAY WITH PYTHON-GUI CONTROLS
        </div>
      </div>

      <div className="page-body fade-in" style={{ display: "flex", gap: 14 }}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ height: 34, minWidth: 34, padding: "6px 8px" }}
          onClick={() => setSidebarCollapsed((v) => !v)}
          title="Toggle Controls"
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>

        {!sidebarCollapsed && (
          <div
            style={{
              width: 340,
              minWidth: 340,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div className="card">
              <div className="card-title">Select File</div>
              <select
                className="form-control"
                value={selectedPath}
                onChange={(e) => setSelectedPath(e.target.value)}
              >
                {files.length === 0 && (
                  <option value="">(no files found in output/)</option>
                )}
                {files.map((f, i) => (
                  <option key={f.path} value={f.path}>
                    {i + 1}: {f.path}
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleLoadSelected}
                >
                  Load
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowFileList(true)}
                >
                  List Files
                </button>
                <button className="btn btn-ghost btn-sm" onClick={fetchFiles}>
                  Refresh
                </button>
              </div>
              {loadedPath && (
                <div
                  className="text-mono"
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    color: "rgba(200,216,240,0.5)",
                  }}
                >
                  Loaded: {loadedPath}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Map and SVG Layers</div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label className="form-label">
                  Map/SVG Blend: {satOpacity}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={satOpacity}
                  onChange={(e) => setSatOpacity(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ display: "grid", gap: 7 }}>
                <BoolRow
                  label="Physical"
                  checked={layerPhysical}
                  onChange={setLayerPhysical}
                />
                <BoolRow
                  label="Guidelines"
                  checked={layerGuidelines}
                  onChange={setLayerGuidelines}
                />
                <BoolRow
                  label="Aesthetic"
                  checked={layerAesthetic}
                  onChange={setLayerAesthetic}
                />
                <BoolRow
                  label="Background"
                  checked={layerBackground}
                  onChange={setLayerBackground}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-title">SAT Visualization</div>
              <div style={{ display: "grid", gap: 7 }}>
                <BoolRow
                  label="Floor Box"
                  checked={showSatBox}
                  onChange={setShowSatBox}
                />
                <BoolRow
                  label="Show Coords Dot"
                  checked={showSatCoordsDot}
                  onChange={setShowSatCoordsDot}
                />
                <BoolRow
                  label="Heading Arrow"
                  checked={showSatArrow}
                  onChange={setShowSatArrow}
                />
                <BoolRow
                  label="Text Label"
                  checked={showSatLabel}
                  onChange={setShowSatLabel}
                />
                <BoolRow
                  label="Show FOV Polygon"
                  checked={showFov}
                  onChange={setShowFov}
                />
              </div>
              <div
                className="form-group"
                style={{ marginTop: 10, marginBottom: 8 }}
              >
                <label className="form-label">Box Thick: {satBoxThick}</label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={satBoxThick}
                  onChange={(e) => setSatBoxThick(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Size: {satLabelSize}</label>
                <input
                  type="range"
                  min={6}
                  max={48}
                  value={satLabelSize}
                  onChange={(e) => setSatLabelSize(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Color</label>
                <select
                  className="form-control"
                  value={textColorMode}
                  onChange={(e) => setTextColorMode(e.target.value)}
                >
                  <option value="White">White</option>
                  <option value="Black">Black</option>
                  <option value="Yellow">Yellow</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Speed Delay: {speedDelay}</label>
                <input
                  type="range"
                  min={0}
                  max={60}
                  value={speedDelay}
                  onChange={(e) => setSpeedDelay(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">FOV Fill %: {fovFillPct}</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={fovFillPct}
                  onChange={(e) => setFovFillPct(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            <div className="card">
              <div className="card-title">CCTV Controls</div>
              <div style={{ display: "grid", gap: 7 }}>
                <BoolRow
                  label="Color by ID"
                  checked={showTracking}
                  onChange={setShowTracking}
                />
                <BoolRow
                  label="Show 3D Box"
                  checked={show3d}
                  onChange={setShow3d}
                />
                <BoolRow
                  label="Show Text"
                  checked={showLabel}
                  onChange={setShowLabel}
                />
                <BoolRow
                  label="Show ROI"
                  checked={showRoi}
                  onChange={setShowRoi}
                />
              </div>
              <div
                className="form-group"
                style={{ marginTop: 10, marginBottom: 8 }}
              >
                <label className="form-label">Target FPS: {fps}</label>
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Jump Frames</label>
                <input
                  className="form-control"
                  type="number"
                  min={1}
                  max={10000}
                  value={jumpFrames}
                  onChange={(e) => setJumpFrames(Number(e.target.value || 1))}
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 6,
                }}
              >
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => jumpBy(-jumpFrames)}
                >
                  {"<<"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => jumpBy(-1)}
                >
                  {"<"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => jumpBy(1)}
                >
                  {">"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => jumpBy(jumpFrames)}
                >
                  {">>"}
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Traffic Analysis Overlays</div>
              <div style={{ display: "grid", gap: 7 }}>
                <BoolRow
                  label="Heatmap (8)"
                  checked={showHeatmap}
                  onChange={setShowHeatmap}
                />
                <BoolRow
                  label="Incidents (9)"
                  checked={showIncidents}
                  onChange={setShowIncidents}
                />
                <BoolRow
                  label="Recommendations (0)"
                  checked={showRecommendations}
                  onChange={setShowRecommendations}
                />
                <BoolRow
                  label="Disaster Zones (D)"
                  checked={showDisasterZones}
                  onChange={setShowDisasterZones}
                />
                <BoolRow
                  label="Pothole Alerts (P)"
                  checked={showPotholeAlerts}
                  onChange={setShowPotholeAlerts}
                />
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: "rgba(200,216,240,0.5)",
                }}
              >
                Real-time traffic analysis visualization with density mapping,
                incident detection, congestion recommendations, disaster zoning,
                and pothole hazard alerts.
              </div>
            </div>

            <div className="card">
              <div className="card-title">Execution</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  className="btn btn-success"
                  disabled={!selectedPath || streaming || loadingMeta}
                  onClick={handlePlay}
                >
                  Play
                </button>
                <button
                  className="btn btn-danger"
                  disabled={!streaming}
                  onClick={handleStop}
                >
                  Stop
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setVerticalSplit((v) => !v)}
                >
                  {verticalSplit ? "Horizontal" : "Vertical"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!analysisPath}
                  onClick={() =>
                    navigate(`/ai-analytics?path=${encodeURIComponent(analysisPath || "")}`)
                  }
                >
                  AI Analytics
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!analysisPath}
                  onClick={() =>
                    navigate(`/junction-report?path=${encodeURIComponent(analysisPath || "")}`)
                  }
                >
                  Junction Report
                </button>
              </div>
              <div
                className="text-mono"
                style={{ fontSize: 12, color: "rgba(200,216,240,0.7)" }}
              >
                {streaming
                  ? `Frame: ${currentFrame}${maxFrames ? ` / ${maxFrames - 1}` : ""}`
                  : "Idle"}
              </div>
              {loadingMeta && (
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div className="spinner" style={{ width: 14, height: 14 }} />{" "}
                  <span className="text-mono" style={{ fontSize: 11 }}>
                    Loading metadata...
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: verticalSplit ? "1fr" : "1fr 1fr",
              gap: 12,
            }}
          >
            <div
              className="card"
              style={{ padding: 0, overflow: "hidden", background: "#0b0f17" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 12,
                }}
              >
                <span>CCTV</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (cctvRef.current)
                      cctvRef.current.style.objectFit = "contain";
                  }}
                >
                  Fit CCTV
                </button>
              </div>
              <div
                style={{
                  aspectRatio: "16 / 9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#000",
                }}
              >
                {streaming ? (
                  <img
                    ref={cctvRef}
                    src={cctvUrl}
                    alt="CCTV stream"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      color: "rgba(200,216,240,0.35)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Press Play
                  </div>
                )}
              </div>
            </div>

            <div
              className="card"
              style={{ padding: 0, overflow: "hidden", background: "#0b0f17" }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 12,
                }}
              >
                <span>Satellite / SVG</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (satRef.current)
                      satRef.current.style.objectFit = "contain";
                  }}
                >
                  Fit SAT
                </button>
              </div>
              <div
                style={{
                  aspectRatio: "16 / 9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#000",
                }}
              >
                {streaming ? (
                  <img
                    ref={satRef}
                    src={satUrl}
                    alt="SAT stream"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      color: "rgba(200,216,240,0.35)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Press Play
                  </div>
                )}
              </div>
            </div>
          </div>

          {meta && (
            <div className="card">
              <div className="card-title">Replay Info</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0,1fr))",
                  gap: 8,
                }}
              >
                {[
                  ["Location", meta.location_code || "-"],
                  [
                    "Resolution",
                    meta.meta?.resolution
                      ? `${meta.meta.resolution[0]}x${meta.meta.resolution[1]}`
                      : "-",
                  ],
                  [
                    "FPS",
                    meta.meta?.fps?.toFixed
                      ? meta.meta.fps.toFixed(2)
                      : (meta.meta?.fps ?? "-"),
                  ],
                  ["Frames", maxFrames || "-"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "8px 10px",
                      background: "var(--bg-elevated)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "rgba(200,216,240,0.5)",
                        marginBottom: 3,
                      }}
                    >
                      {k}
                    </div>
                    <div
                      className="text-mono"
                      style={{ color: "var(--cyan)", fontSize: 12 }}
                    >
                      {v}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
