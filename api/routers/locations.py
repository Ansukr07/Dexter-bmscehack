import os
import glob
import json
import shutil
import cv2
import numpy as np
from pathlib import Path
from fastapi import APIRouter, HTTPException, File, UploadFile, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOC_ROOT = os.path.join(PROJECT_ROOT, "location")

router = APIRouter()


class GProjectionBody(BaseModel):
    data: dict


def _loc_dir(code: str) -> str:
    return os.path.join(LOC_ROOT, code)


def _ensure_png_bytes(raw: bytes, label: str) -> bytes:
    """Decode arbitrary image bytes and re-encode as PNG bytes."""
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise HTTPException(400, f"Failed to read {label} image")
    ok, enc = cv2.imencode(".png", img)
    if not ok:
        raise HTTPException(500, f"Failed to convert {label} image to PNG")
    return enc.tobytes()


def _video_metadata(path: str) -> dict:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {
            "width": 0,
            "height": 0,
            "fps": 0.0,
            "frames": 0,
            "duration_s": 0.0,
        }
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    return {
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "frames": frames,
        "duration_s": round((frames / fps), 2) if fps > 0 else 0.0,
    }


async def _save_footage_file(code: str, file: UploadFile) -> dict:
    base = _loc_dir(code)
    if not os.path.isdir(base):
        raise HTTPException(404, f"Location '{code}' not found")

    footage_dir = os.path.join(base, "footage")
    os.makedirs(footage_dir, exist_ok=True)

    fname = os.path.basename(file.filename or "upload.mp4")
    if not fname.lower().endswith(".mp4"):
        raise HTTPException(400, "Only MP4 files are accepted")

    dst = os.path.join(footage_dir, fname)
    if os.path.exists(dst):
        stem, ext = os.path.splitext(fname)
        i = 1
        while os.path.exists(os.path.join(footage_dir, f"{stem}_{i}{ext}")):
            i += 1
        dst = os.path.join(footage_dir, f"{stem}_{i}{ext}")

    data = await file.read()
    with open(dst, "wb") as f:
        f.write(data)

    return {
        "saved_as": os.path.basename(dst),
        "metadata": _video_metadata(dst),
    }


@router.get("")
def list_locations():
    if not os.path.exists(LOC_ROOT):
        return []
    locs = sorted([
        d for d in os.listdir(LOC_ROOT)
        if os.path.isdir(os.path.join(LOC_ROOT, d))
    ])
    result = []
    for loc in locs:
        base = _loc_dir(loc)
        has_cctv = os.path.exists(os.path.join(base, f"cctv_{loc}.png"))
        has_sat = os.path.exists(os.path.join(base, f"sat_{loc}.png"))
        has_g = (
            os.path.exists(os.path.join(base, f"G_projection_{loc}.json")) or
            os.path.exists(os.path.join(base, f"G_projection_svg_{loc}.json"))
        )
        has_layout = os.path.exists(os.path.join(base, f"layout_{loc}.svg"))
        has_roi = os.path.exists(os.path.join(base, f"roi_{loc}.png"))
        footage_dir = os.path.join(base, "footage")
        footage_count = len(glob.glob(os.path.join(footage_dir, "*.mp4"))) if os.path.exists(footage_dir) else 0
        result.append({
            "code": loc,
            "has_cctv": has_cctv,
            "has_sat": has_sat,
            "has_g_projection": has_g,
            "has_layout": has_layout,
            "has_roi": has_roi,
            "footage_count": footage_count,
        })
    return result


@router.get("/{code}")
def get_location(code: str):
    base = _loc_dir(code)
    if not os.path.isdir(base):
        raise HTTPException(404, f"Location '{code}' not found")

    g_path = None
    for candidate in [f"G_projection_{code}.json", f"G_projection_svg_{code}.json"]:
        p = os.path.join(base, candidate)
        if os.path.exists(p):
            g_path = p
            break

    g_data = None
    if g_path:
        try:
            with open(g_path, "r") as f:
                g_data = json.load(f)
        except Exception:
            pass

    footage_dir = os.path.join(base, "footage")
    footages = []
    if os.path.exists(footage_dir):
        for mp4 in sorted(glob.glob(os.path.join(footage_dir, "*.mp4"))):
            cap = cv2.VideoCapture(mp4)
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            cap.release()
            footages.append({
                "name": os.path.basename(mp4),
                "frames": frames,
                "fps": round(fps, 2),
                "width": w,
                "height": h,
                "duration_s": round(frames / fps, 2) if fps > 0 else 0,
            })

    return {
        "code": code,
        "cctv_url": f"/location/{code}/cctv_{code}.png" if os.path.exists(os.path.join(base, f"cctv_{code}.png")) else None,
        "sat_url": f"/location/{code}/sat_{code}.png" if os.path.exists(os.path.join(base, f"sat_{code}.png")) else None,
        "layout_url": f"/location/{code}/layout_{code}.svg" if os.path.exists(os.path.join(base, f"layout_{code}.svg")) else None,
        "roi_url": f"/location/{code}/roi_{code}.png" if os.path.exists(os.path.join(base, f"roi_{code}.png")) else None,
        "g_projection": g_data,
        "footage": footages,
    }


@router.post("")
async def create_location(
    code: str = Form(...),
    cctv: UploadFile = File(...),
    sat: UploadFile = File(...),
    layout: Optional[UploadFile] = File(None),
    roi: Optional[UploadFile] = File(None),
):
    code = code.strip()
    if not code or "/" in code or "\\" in code:
        raise HTTPException(400, "Invalid location code")

    loc_dir = _loc_dir(code)
    if os.path.exists(loc_dir):
        raise HTTPException(409, f"Location '{code}' already exists")

    os.makedirs(loc_dir, exist_ok=False)
    try:
        # Save CCTV
        dst_cctv = os.path.join(loc_dir, f"cctv_{code}.png")
        data = _ensure_png_bytes(await cctv.read(), "CCTV")
        with open(dst_cctv, "wb") as f:
            f.write(data)

        # Save SAT
        dst_sat = os.path.join(loc_dir, f"sat_{code}.png")
        data = _ensure_png_bytes(await sat.read(), "SAT")
        with open(dst_sat, "wb") as f:
            f.write(data)

        # Optional layout SVG
        if layout and layout.filename:
            if not layout.filename.lower().endswith(".svg"):
                raise HTTPException(400, "Layout must be an SVG file")
            dst_layout = os.path.join(loc_dir, f"layout_{code}.svg")
            data = await layout.read()
            with open(dst_layout, "wb") as f:
                f.write(data)

        # Optional ROI
        if roi and roi.filename:
            dst_roi = os.path.join(loc_dir, f"roi_{code}.png")
            data = _ensure_png_bytes(await roi.read(), "ROI")
            with open(dst_roi, "wb") as f:
                f.write(data)

    except Exception as e:
        shutil.rmtree(loc_dir, ignore_errors=True)
        raise HTTPException(500, f"Failed to create location: {e}")

    return {"ok": True, "code": code}


@router.post("/{code}/footage")
async def upload_footage(code: str, file: UploadFile = File(...)):
    saved = await _save_footage_file(code, file)
    return {"ok": True, **saved}


@router.post("/{code}/footage/batch")
async def upload_footage_batch(code: str, files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "No files uploaded")
    results = []
    for file in files:
        results.append(await _save_footage_file(code, file))
    return {"ok": True, "items": results}


@router.post("/{code}/g_projection")
async def upload_g_projection(code: str, file: UploadFile = File(...)):
    base = _loc_dir(code)
    if not os.path.isdir(base):
        raise HTTPException(404, f"Location '{code}' not found")

    data = await file.read()
    try:
        parsed = json.loads(data)
    except Exception:
        raise HTTPException(400, "File is not valid JSON")

    dst = os.path.join(base, f"G_projection_{code}.json")
    with open(dst, "wb") as f:
        f.write(data)

    return {"ok": True}


@router.get("/{code}/g_projection")
def get_g_projection(code: str):
    base = _loc_dir(code)
    if not os.path.isdir(base):
        raise HTTPException(404, f"Location '{code}' not found")
    path = os.path.join(base, f"G_projection_{code}.json")
    if not os.path.exists(path):
        raise HTTPException(404, f"G_projection_{code}.json not found")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.put("/{code}/g_projection")
def save_g_projection(code: str, body: GProjectionBody):
    base = _loc_dir(code)
    if not os.path.isdir(base):
        raise HTTPException(404, f"Location '{code}' not found")
    path = os.path.join(base, f"G_projection_{code}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(body.data, f, indent=2)
    return {"ok": True, "path": path}
