import os
import glob
import json
import gzip
import threading
import uuid
import queue
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import yaml

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOC_ROOT = os.path.join(PROJECT_ROOT, "location")
OUT_ROOT = os.path.join(PROJECT_ROOT, "output")
CONFIG_PATH = os.path.join(PROJECT_ROOT, "inference_config.yaml")

router = APIRouter()

# ─── Global state for the running inference session ───────────────────────────
_lock = threading.Lock()
_session_id: Optional[str] = None
_stop_flag = threading.Event()
_log_queue: queue.Queue = queue.Queue()
_progress: int = 0
_is_running: bool = False


def _emit(msg: str):
    _log_queue.put({"type": "log", "msg": msg})


def _emit_progress(pct: int):
    global _progress
    _progress = pct
    _log_queue.put({"type": "progress", "pct": pct})


# ─── Scan ──────────────────────────────────────────────────────────────────────

@router.get("/scan")
def scan(config_name: Optional[str] = None):
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(404, "inference_config.yaml not found")

    with open(CONFIG_PATH, "r") as f:
        raw = yaml.safe_load(f)

    # Resolve config
    if isinstance(raw, dict) and "configs" in raw:
        keys = list(raw["configs"].keys())
        if not config_name or config_name not in keys:
            config_name = keys[0]
        cfg = raw["configs"][config_name]
    else:
        cfg = raw or {}
        config_name = cfg.get("config_name", "default")

    model_stem = Path(cfg.get("model", {}).get("weights", "unknown")).stem
    tracker = cfg.get("tracking", {}).get("tracker_type", "unknown")
    base_out = os.path.join(OUT_ROOT, f"model-{model_stem}_tracker-{tracker}", config_name)

    tasks = []
    if os.path.exists(LOC_ROOT):
        for loc in sorted(os.listdir(LOC_ROOT)):
            if not os.path.isdir(os.path.join(LOC_ROOT, loc)):
                continue
            footage_dir = os.path.join(LOC_ROOT, loc, "footage")
            if not os.path.exists(footage_dir):
                continue

            g_proj = None
            for candidate in [f"G_projection_{loc}.json", f"G_projection_svg_{loc}.json"]:
                p = os.path.join(LOC_ROOT, loc, candidate)
                if os.path.exists(p):
                    g_proj = p
                    break

            for mp4 in sorted(glob.glob(os.path.join(footage_dir, "*.mp4"))):
                fname = os.path.basename(mp4)
                out_name = os.path.splitext(fname)[0] + ".json.gz"
                out_path = os.path.join(base_out, loc, out_name)
                if not g_proj:
                    status = "no_g_proj"
                elif os.path.exists(out_path):
                    status = "done"
                else:
                    status = "pending"

                tasks.append({
                    "loc": loc,
                    "mp4": fname,
                    "mp4_path": mp4,
                    "g_proj": g_proj,
                    "status": status,
                    "out_path": out_path,
                })

    return {"config_name": config_name, "tasks": tasks}


# ─── Start ─────────────────────────────────────────────────────────────────────

class StartBody(BaseModel):
    config_name: str
    tasks: List[dict]  # list of {loc, mp4_path, g_proj}


@router.post("/start")
def start_inference(body: StartBody):
    global _session_id, _is_running, _progress, _stop_flag, _log_queue

    with _lock:
        if _is_running:
            raise HTTPException(409, "Inference already running")
        _stop_flag.clear()
        _log_queue = queue.Queue()
        _progress = 0
        _is_running = True
        _session_id = str(uuid.uuid4())

    def run_batch():
        global _is_running, _progress
        try:
            import sys
            if PROJECT_ROOT not in sys.path:
                sys.path.insert(0, PROJECT_ROOT)
            from trafficlab.inference.pipeline import InferencePipeline

            total = len(body.tasks)
            for i, task in enumerate(body.tasks):
                if _stop_flag.is_set():
                    _emit("[STOP] Batch stopped by user.")
                    break
                loc = task["loc"]
                mp4 = task["mp4_path"]
                gp = task["g_proj"]
                _emit(f"--- [{i+1}/{total}] Starting: {os.path.basename(mp4)} ---")
                _emit_progress(0)
                try:
                    pipeline = InferencePipeline(
                        location_code=loc,
                        footage_path=mp4,
                        config_path=CONFIG_PATH,
                        output_root=OUT_ROOT,
                        g_proj_path=gp,
                        config_name=body.config_name,
                        log_fn=_emit,
                        progress_fn=_emit_progress,
                        stop_flag_fn=_stop_flag.is_set,
                    )
                    pipeline.run()
                    _emit(f"✅ Done: {os.path.basename(mp4)}")
                except Exception as e:
                    _emit(f"❌ Error on {os.path.basename(mp4)}: {e}")

            _emit("=== Batch Finished ===")
            _emit_progress(100)
        finally:
            with _lock:
                _is_running = False

    thread = threading.Thread(target=run_batch, daemon=True)
    thread.start()
    return {"ok": True, "session_id": _session_id}


@router.delete("/wipe")
def wipe_output(config_name: str):
    """Delete the output directory for a given config (requires confirmation in client)."""
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(404, "inference_config.yaml not found")

    with open(CONFIG_PATH, "r") as f:
        raw = yaml.safe_load(f)

    if isinstance(raw, dict) and "configs" in raw:
        keys = list(raw["configs"].keys())
        if not config_name or config_name not in keys:
            config_name = keys[0]
        cfg = raw["configs"][config_name]
    else:
        cfg = raw or {}
        config_name = cfg.get("config_name", "default")

    model_stem = Path(cfg.get("model", {}).get("weights", "unknown")).stem
    tracker = cfg.get("tracking", {}).get("tracker_type", "unknown")
    target_dir = os.path.join(OUT_ROOT, f"model-{model_stem}_tracker-{tracker}", config_name)

    if not os.path.exists(target_dir):
        return {"ok": True, "wiped": False, "msg": "Nothing to wipe — directory does not exist."}

    import shutil
    shutil.rmtree(target_dir)
    return {"ok": True, "wiped": True, "msg": f"Wiped: {target_dir}"}


@router.post("/stop")
def stop_inference():
    global _stop_flag
    _stop_flag.set()
    _emit("[STOP] Stop requested.")
    return {"ok": True}


@router.get("/status")
def get_status():
    return {"running": _is_running, "progress": _progress}


@router.get("/progress")
def progress_stream():
    """SSE stream that emits log messages and progress updates."""

    def event_generator():
        # Send current state immediately
        yield f"data: {json.dumps({'type': 'status', 'running': _is_running, 'progress': _progress})}\n\n"

        while True:
            try:
                msg = _log_queue.get(timeout=25)
                yield f"data: {json.dumps(msg)}\n\n"
            except queue.Empty:
                # Heartbeat to keep connection alive
                yield ": heartbeat\n\n"
                if not _is_running:
                    break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
