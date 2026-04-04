import os
import re
import json
import gzip
import time
import math
import hashlib
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ROOT = os.path.abspath(os.path.join(PROJECT_ROOT, "output"))
LOC_ROOT = os.path.abspath(os.path.join(PROJECT_ROOT, "location"))

router = APIRouter()

_LAYER_NAMES = ["Background", "Aesthetic", "Guidelines", "Physical"]
_COLOR_CACHE = {}


def _safe_out_path(rel_path: str) -> str:
    full = os.path.abspath(os.path.normpath(os.path.join(OUT_ROOT, rel_path)))
    try:
        if os.path.commonpath([full, OUT_ROOT]) != OUT_ROOT:
            raise HTTPException(403, "Invalid path")
    except ValueError:
        raise HTTPException(403, "Invalid path")
    if not os.path.exists(full):
        raise HTTPException(404, "File not found")
    return full


def _load_replay(path: str) -> dict:
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_g_projection(loc_code: str) -> dict | None:
    if not loc_code:
        return None
    base = os.path.join(LOC_ROOT, loc_code)
    for cand in [f"G_projection_{loc_code}.json", f"G_projection_svg_{loc_code}.json"]:
        p = os.path.join(base, cand)
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None
    return None


def _deterministic_bgr(seed: str | int | None) -> tuple[int, int, int]:
    if seed is None:
        return (200, 200, 200)
    key = str(seed)
    if key not in _COLOR_CACHE:
        h = hashlib.md5(key.encode("utf-8")).digest()
        _COLOR_CACHE[key] = (int(h[2]), int(h[1]), int(h[0]))
    return _COLOR_CACHE[key]


def _tag_name(elem) -> str:
    return elem.tag.split("}")[-1]


def _parse_css_classes(root) -> dict:
    classes = {}
    style_elem = None
    for elem in root.iter():
        if _tag_name(elem) == "style":
            style_elem = elem
            break
    if style_elem is None or not style_elem.text:
        return classes

    css = re.sub(r"/\*.*?\*/", "", style_elem.text, flags=re.DOTALL)
    for match in re.finditer(r"([^{]+)\{([^}]*)\}", css, flags=re.DOTALL):
        selectors = [s.strip().lstrip(".") for s in match.group(1).split(",")]
        body = match.group(2)
        props = {}
        for p in body.split(";"):
            if ":" not in p:
                continue
            k, v = p.split(":", 1)
            props[k.strip()] = v.strip()
        for sel in selectors:
            if not sel:
                continue
            classes.setdefault(sel, {}).update(props)
    return classes


def _parse_transform(txt: str | None) -> np.ndarray:
    m = np.identity(3, dtype=np.float64)
    if not txt:
        return m

    ops = re.findall(r"(\w+)\s*\(([^)]*)\)", txt)
    for name, args in ops:
        vals = [float(v) for v in re.split(r"[ ,]+", args.strip()) if v]
        t = np.identity(3, dtype=np.float64)
        if name == "translate":
            tx = vals[0] if len(vals) > 0 else 0.0
            ty = vals[1] if len(vals) > 1 else 0.0
            t[0, 2] = tx
            t[1, 2] = ty
        elif name == "scale":
            sx = vals[0] if len(vals) > 0 else 1.0
            sy = vals[1] if len(vals) > 1 else sx
            t[0, 0] = sx
            t[1, 1] = sy
        elif name == "rotate" and len(vals) >= 1:
            ang = math.radians(vals[0])
            c = math.cos(ang)
            s = math.sin(ang)
            r = np.identity(3, dtype=np.float64)
            r[0, 0] = c
            r[0, 1] = -s
            r[1, 0] = s
            r[1, 1] = c
            if len(vals) == 3:
                cx, cy = vals[1], vals[2]
                t1 = np.identity(3, dtype=np.float64)
                t2 = np.identity(3, dtype=np.float64)
                t1[0, 2], t1[1, 2] = cx, cy
                t2[0, 2], t2[1, 2] = -cx, -cy
                t = t1 @ r @ t2
            else:
                t = r
        elif name == "matrix" and len(vals) == 6:
            t = np.array(
                [[vals[0], vals[2], vals[4]], [vals[1], vals[3], vals[5]], [0.0, 0.0, 1.0]],
                dtype=np.float64,
            )
        m = m @ t
    return m


def _parse_points_attr(raw: str) -> list[tuple[float, float]]:
    if not raw:
        return []
    vals = [x for x in re.split(r"[ ,]+", raw.strip()) if x]
    if len(vals) % 2 != 0:
        return []
    pts = []
    for i in range(0, len(vals), 2):
        pts.append((float(vals[i]), float(vals[i + 1])))
    return pts


def _parse_color(s: str | None) -> tuple[int, int, int] | None:
    if not s:
        return None
    txt = s.strip().lower()
    if txt in ("none", "transparent"):
        return None

    named = {
        "white": (255, 255, 255),
        "black": (0, 0, 0),
        "yellow": (0, 255, 255),
        "lime": (0, 255, 0),
        "red": (0, 0, 255),
        "green": (0, 128, 0),
        "blue": (255, 0, 0),
        "gray": (128, 128, 128),
        "grey": (128, 128, 128),
        "cyan": (255, 255, 0),
        "magenta": (255, 0, 255),
    }
    if txt in named:
        return named[txt]

    m_rgb = re.match(r"rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)", txt)
    if m_rgb:
        r, g, b = [int(m_rgb.group(i)) for i in (1, 2, 3)]
        return (b, g, r)

    if txt.startswith("#"):
        hx = txt[1:]
        if len(hx) == 3:
            hx = "".join([c * 2 for c in hx])
        if len(hx) == 6:
            r = int(hx[0:2], 16)
            g = int(hx[2:4], 16)
            b = int(hx[4:6], 16)
            return (b, g, r)
    return None


def _style_for_element(elem, css_classes: dict, layer_name: str) -> dict:
    defaults = {
        "Background": {"fill": "#afafaf", "stroke": "none", "stroke-width": "1"},
        "Aesthetic": {"fill": "#ffffff", "stroke": "none", "stroke-width": "1"},
        "Guidelines": {"fill": "none", "stroke": "#ffff00", "stroke-width": "1"},
        "Physical": {"fill": "#ffffff", "stroke": "#000000", "stroke-width": "2"},
    }
    style = dict(defaults.get(layer_name, {}))

    cls = elem.get("class")
    if cls:
        for c in cls.split():
            style.update(css_classes.get(c, {}))

    style_attr = elem.get("style")
    if style_attr:
        for p in style_attr.split(";"):
            if ":" not in p:
                continue
            k, v = p.split(":", 1)
            style[k.strip()] = v.strip()

    for k in ["fill", "stroke", "stroke-width"]:
        v = elem.get(k)
        if v is not None:
            style[k] = v

    try:
        width = int(round(float(str(style.get("stroke-width", "1")).replace("px", ""))))
    except Exception:
        width = 1

    return {
        "fill": _parse_color(style.get("fill")),
        "stroke": _parse_color(style.get("stroke")),
        "stroke_width": max(1, width),
    }


def _shape_points(elem) -> tuple[list[tuple[float, float]], bool]:
    tag = _tag_name(elem)
    if tag == "line":
        x1 = float(elem.get("x1", 0.0))
        y1 = float(elem.get("y1", 0.0))
        x2 = float(elem.get("x2", 0.0))
        y2 = float(elem.get("y2", 0.0))
        return [(x1, y1), (x2, y2)], False
    if tag == "rect":
        x = float(elem.get("x", 0.0))
        y = float(elem.get("y", 0.0))
        w = float(elem.get("width", 0.0))
        h = float(elem.get("height", 0.0))
        return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True
    if tag == "polygon":
        return _parse_points_attr(elem.get("points", "")), True
    if tag == "polyline":
        return _parse_points_attr(elem.get("points", "")), False
    return [], False


def _transform_pts(pts: list[tuple[float, float]], m_elem: np.ndarray, m_align: np.ndarray) -> np.ndarray:
    arr = np.array(pts, dtype=np.float64)
    homo = np.hstack([arr, np.ones((len(arr), 1), dtype=np.float64)])
    transformed = (m_align @ (m_elem @ homo.T)).T
    return transformed[:, :2]


def _collect_svg_shapes(svg_path: str, affine_a: list | None) -> dict:
    shapes_by_layer = {k: [] for k in _LAYER_NAMES}
    if not os.path.exists(svg_path):
        return shapes_by_layer

    try:
        tree = ET.parse(svg_path)
        root = tree.getroot()
    except Exception:
        return shapes_by_layer

    css_classes = _parse_css_classes(root)
    m_align = np.identity(3, dtype=np.float64)
    if affine_a and isinstance(affine_a, list) and len(affine_a) >= 2:
        try:
            m_align[:2, :] = np.array(affine_a, dtype=np.float64)
        except Exception:
            m_align = np.identity(3, dtype=np.float64)

    def process_node(node, current_m: np.ndarray, layer_name: str):
        local_m = _parse_transform(node.get("transform"))
        m = current_m @ local_m

        pts, closed = _shape_points(node)
        if pts:
            t_pts = _transform_pts(pts, m, m_align)
            style = _style_for_element(node, css_classes, layer_name)
            shapes_by_layer[layer_name].append(
                {
                    "pts": t_pts,
                    "closed": closed,
                    "fill": style["fill"],
                    "stroke": style["stroke"],
                    "stroke_width": style["stroke_width"],
                }
            )

        for child in list(node):
            process_node(child, m, layer_name)

    for layer_name in _LAYER_NAMES:
        group_node = None
        for elem in root.iter():
            if _tag_name(elem) == "g" and elem.get("id") == layer_name:
                group_node = elem
                break
        if group_node is None:
            continue
        process_node(group_node, np.identity(3, dtype=np.float64), layer_name)

    return shapes_by_layer


def _draw_svg_overlay(canvas: np.ndarray, shapes_by_layer: dict, visible_layers: set[str], opacity: float) -> np.ndarray:
    if opacity <= 0.0:
        return canvas

    overlay = np.zeros_like(canvas)
    drawn = False
    for layer in _LAYER_NAMES:
        if layer not in visible_layers:
            continue
        for shp in shapes_by_layer.get(layer, []):
            pts = np.round(shp["pts"]).astype(np.int32)
            if pts.shape[0] < 2:
                continue
            if shp["closed"] and shp["fill"] is not None and pts.shape[0] >= 3:
                cv2.fillPoly(overlay, [pts], shp["fill"])
                drawn = True
            if shp["stroke"] is not None:
                cv2.polylines(
                    overlay,
                    [pts],
                    bool(shp["closed"]),
                    shp["stroke"],
                    int(shp.get("stroke_width", 1)),
                    lineType=cv2.LINE_AA,
                )
                drawn = True

    if not drawn:
        return canvas

    alpha = max(0.0, min(1.0, float(opacity)))
    return cv2.addWeighted(canvas, 1.0 - alpha, overlay, alpha, 0)


def _draw_fov(frame: np.ndarray, g_data: dict, fill_pct: int):
    hom = g_data.get("homography", {}) if g_data else {}
    fov = hom.get("fov_polygon")
    if not isinstance(fov, list) or len(fov) < 3:
        return

    try:
        pts = np.array([[int(float(p[0])), int(float(p[1]))] for p in fov], dtype=np.int32)
    except Exception:
        return

    alpha = max(0.0, min(1.0, float(fill_pct) / 100.0))
    fill = frame.copy()
    cv2.fillPoly(fill, [pts], (0, 160, 0))
    cv2.addWeighted(fill, alpha, frame, 1.0 - alpha, 0, frame)
    cv2.polylines(frame, [pts], True, (0, 220, 0), 2, lineType=cv2.LINE_AA)

    par = g_data.get("parallax", {}) if g_data else {}
    cx = par.get("x_cam_coords_sat")
    cy = par.get("y_cam_coords_sat")
    cz = par.get("z_cam_meters")
    if cx is None or cy is None:
        return
    cxi, cyi = int(float(cx)), int(float(cy))
    cv2.circle(frame, (cxi, cyi), 10, (0, 215, 255), 2, lineType=cv2.LINE_AA)
    cv2.drawMarker(frame, (cxi, cyi), (0, 0, 255), markerType=cv2.MARKER_CROSS, markerSize=18, thickness=2)
    if cz is not None:
        txt = f"cam z={float(cz):.2f}m"
        cv2.putText(frame, txt, (cxi + 10, cyi + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1, lineType=cv2.LINE_AA)


def _build_sat_template(
    data: dict,
    g_data: dict | None,
    sat_opacity: int,
    visible_layers: set[str],
    show_fov: bool,
    fov_fill_pct: int,
) -> tuple[np.ndarray, bool]:
    loc = data.get("location_code", "")
    loc_dir = os.path.join(LOC_ROOT, loc)

    sat_img = None
    use_svg = bool((g_data or {}).get("use_svg", False))
    if g_data:
        inputs = g_data.get("inputs", {}) if isinstance(g_data, dict) else {}
        sat_rel = inputs.get("sat_path") or f"sat_{loc}.png"
        sat_path = os.path.normpath(os.path.join(loc_dir, sat_rel))
        if os.path.exists(sat_path):
            sat_img = cv2.imread(sat_path, cv2.IMREAD_COLOR)
    if sat_img is None:
        sat_path = os.path.join(loc_dir, f"sat_{loc}.png")
        if os.path.exists(sat_path):
            sat_img = cv2.imread(sat_path, cv2.IMREAD_COLOR)

    if sat_img is None:
        res = data.get("meta", {}).get("resolution") or [1280, 720]
        w = int(res[0]) if len(res) >= 2 else 1280
        h = int(res[1]) if len(res) >= 2 else 720
        sat_img = np.zeros((max(1, h), max(1, w), 3), dtype=np.uint8)

    out = sat_img.copy()

    if use_svg and g_data:
        inputs = g_data.get("inputs", {})
        layout_rel = inputs.get("layout_path")
        a_mat = g_data.get("layout_svg", {}).get("A", [])
        if layout_rel:
            layout_path = os.path.normpath(os.path.join(loc_dir, layout_rel))
            shapes = _collect_svg_shapes(layout_path, a_mat)
            svg_mix = max(0.0, min(1.0, 1.0 - float(sat_opacity) / 100.0))
            out = _draw_svg_overlay(out, shapes, visible_layers, svg_mix)

    if show_fov and g_data:
        _draw_fov(out, g_data, fov_fill_pct)

    return out, use_svg


def _apply_roi_overlay(frame: np.ndarray, roi_mask: np.ndarray | None):
    if roi_mask is None:
        return
    if roi_mask.shape[:2] != frame.shape[:2]:
        roi_mask = cv2.resize(roi_mask, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_NEAREST)
    is_black = roi_mask < 10
    if not np.any(is_black):
        return
    overlay = frame.copy()
    overlay[is_black] = (0, 0, 255)
    cv2.addWeighted(overlay, 0.4, frame, 0.6, 0, frame)


def _draw_cctv_objects(frame: np.ndarray, objects: list, show_tracking: bool, show_3d: bool, show_label: bool):
    for obj in objects:
        cls = obj.get("class", "?")
        tid = obj.get("tracked_id")
        seed = f"{cls}_{tid}" if (show_tracking and tid is not None) else cls
        bgr = _deterministic_bgr(seed)

        box = obj.get("bbox_2d")
        if box:
            x1, y1, x2, y2 = [int(v) for v in box]
            cv2.rectangle(frame, (x1, y1), (x2, y2), bgr, 2)
            if show_label:
                spd = float(obj.get("speed_kmh", 0.0) or 0.0)
                label = f"{cls} #{tid} {spd:.1f}km/h" if tid is not None else f"{cls} {spd:.1f}km/h"
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 4, y1), bgr, -1)
                cv2.putText(frame, label, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        if show_3d:
            b3 = obj.get("bbox_3d")
            if b3 and len(b3) == 8:
                pts = [(int(p[0]), int(p[1])) for p in b3]
                for i in range(4):
                    cv2.line(frame, pts[i], pts[(i + 1) % 4], bgr, 1)
                    cv2.line(frame, pts[i + 4], pts[((i + 1) % 4) + 4], bgr, 1)
                    cv2.line(frame, pts[i], pts[i + 4], bgr, 1)


def _draw_sat_objects(
    frame: np.ndarray,
    objects: list,
    *,
    show_tracking: bool,
    show_3d: bool,
    show_sat_box: bool,
    show_sat_arrow: bool,
    show_sat_coords_dot: bool,
    show_sat_label: bool,
    sat_label_size: int,
    sat_box_thick: int,
    text_color_mode: str,
    speed_delay_frames: int,
    speed_cache: dict,
    frame_idx: int,
    sat_use_svg: bool,
):
    text_color = {
        "Black": (0, 0, 0),
        "Yellow": (143, 255, 255),
    }.get(text_color_mode, (255, 255, 255))

    for obj in objects:
        cls = obj.get("class", "?")
        tid = obj.get("tracked_id")
        seed = f"{cls}_{tid}" if (show_tracking and tid is not None) else cls
        bgr = _deterministic_bgr(seed)

        have_heading = bool(obj.get("have_heading", False))
        have_measurements = bool(obj.get("have_measurements", False))
        default_heading = bool(obj.get("default_heading", False))
        coord = obj.get("sat_coords") or obj.get("sat_coord")
        pts = obj.get("sat_floor_box")
        has_floor = bool(pts and isinstance(pts, list) and len(pts) >= 3)

        if show_sat_box and have_heading and have_measurements and has_floor:
            poly = np.array([[int(p[0]), int(p[1])] for p in pts], dtype=np.int32)
            fill = frame.copy()
            cv2.fillPoly(fill, [poly], bgr)
            cv2.addWeighted(fill, 0.35, frame, 0.65, 0, frame)
            cv2.polylines(frame, [poly], True, bgr, max(1, int(sat_box_thick)), lineType=cv2.LINE_AA)

        if show_sat_arrow and have_heading and (not default_heading) and coord is not None:
            heading = obj.get("heading")
            if heading is not None:
                rad = math.radians(float(heading))
                x1, y1 = int(coord[0]), int(coord[1])
                x2 = int(x1 + 40 * math.cos(rad))
                y2 = int(y1 + 40 * math.sin(rad))
                cv2.arrowedLine(frame, (x1, y1), (x2, y2), (0, 255, 255), 2, line_type=cv2.LINE_AA, tipLength=0.25)

        no_svg_no_3d = (not sat_use_svg) and (not show_3d)
        if show_sat_coords_dot and coord is not None and (has_floor or no_svg_no_3d):
            radius = 4
            if has_floor:
                xs = [float(p[0]) for p in pts]
                ys = [float(p[1]) for p in pts]
                avg_dim = ((max(xs) - min(xs)) + (max(ys) - min(ys))) / 2.0
                radius = max(3, int(avg_dim * 0.15))
            cv2.circle(frame, (int(coord[0]), int(coord[1])), radius, bgr, -1, lineType=cv2.LINE_AA)
            cv2.circle(frame, (int(coord[0]), int(coord[1])), radius, (0, 0, 0), 1, lineType=cv2.LINE_AA)
        elif (not have_heading) and have_measurements and (not show_3d) and coord is not None and (has_floor or no_svg_no_3d):
            cv2.circle(frame, (int(coord[0]), int(coord[1])), 3, bgr, -1, lineType=cv2.LINE_AA)

        if show_sat_label and coord is not None and (has_floor or no_svg_no_3d):
            raw_s = float(obj.get("speed_kmh", 0.0) or 0.0)
            disp_s = raw_s
            if tid is not None:
                cache = speed_cache.get(tid, {"val": raw_s, "last": -999999})
                if frame_idx - int(cache["last"]) >= int(speed_delay_frames):
                    cache["val"] = raw_s
                    cache["last"] = frame_idx
                speed_cache[tid] = cache
                disp_s = float(cache["val"])

            label = f"{cls} {disp_s:.1f}km/h"
            font_scale = max(0.3, float(sat_label_size) / 22.0)
            cv2.putText(
                frame,
                label,
                (int(coord[0]), int(coord[1])),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                text_color,
                1,
                lineType=cv2.LINE_AA,
            )


def _jpg_chunk(frame: np.ndarray, quality: int = 75) -> bytes:
    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, int(quality)])
    if not ok:
        return b""
    return b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg.tobytes() + b"\r\n"


def _frame_map(data: dict) -> dict:
    return {int(f.get("frame_index", 0)): (f.get("objects") or []) for f in data.get("frames", [])}


@router.get("/files")
def list_files():
    files = []
    if not os.path.exists(OUT_ROOT):
        return files
    for root, _, fnames in os.walk(OUT_ROOT):
        for fname in fnames:
            if fname.endswith(".json") or fname.endswith(".json.gz"):
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, OUT_ROOT)
                files.append({"path": rel.replace("\\", "/"), "name": fname})
    files.sort(key=lambda x: x["path"])
    return files


@router.get("/data")
def get_data(path: str = Query(...)):
    full = _safe_out_path(path)
    try:
        data = _load_replay(full)
        frame_map = _frame_map(data)
        has_3d = False
        for _, objs in list(frame_map.items())[:50]:
            if any(o.get("bbox_3d") and len(o.get("bbox_3d", [])) == 8 for o in objs):
                has_3d = True
                break

        g_data = _load_g_projection(data.get("location_code", ""))
        return {
            "mp4_path": data.get("mp4_path"),
            "location_code": data.get("location_code"),
            "meta": data.get("meta"),
            "mp4_frame_count": data.get("mp4_frame_count"),
            "animation_frame_count": data.get("animation_frame_count"),
            "frame_count": len(data.get("frames", [])),
            "has_3d_data": has_3d,
            "g_projection": {
                "loaded": bool(g_data),
                "use_svg": bool((g_data or {}).get("use_svg", False)),
                "use_roi": bool((g_data or {}).get("use_roi", False)),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to load: {e}")


@router.get("/stream")
def stream_video_compat(
    path: str = Query(...),
    fps: int = Query(default=25, ge=1, le=60),
    show_3d: bool = Query(default=True),
    show_label: bool = Query(default=True),
    show_tracking: bool = Query(default=True),
    show_roi: bool = Query(default=False),
    start_frame: int = Query(default=0, ge=0),
):
    return stream_cctv(
        path=path,
        fps=fps,
        show_3d=show_3d,
        show_label=show_label,
        show_tracking=show_tracking,
        show_roi=show_roi,
        start_frame=start_frame,
    )


@router.get("/stream/cctv")
def stream_cctv(
    path: str = Query(...),
    fps: int = Query(default=25, ge=1, le=60),
    show_3d: bool = Query(default=True),
    show_label: bool = Query(default=True),
    show_tracking: bool = Query(default=True),
    show_roi: bool = Query(default=False),
    start_frame: int = Query(default=0, ge=0),
):
    full = _safe_out_path(path)

    def generate():
        try:
            data = _load_replay(full)
        except Exception:
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(blank, "Failed to load replay", (20, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 80, 255), 2)
            yield _jpg_chunk(blank, quality=80)
            return

        frame_map = _frame_map(data)
        mp4_path = data.get("mp4_path", "")
        if mp4_path and not os.path.isabs(mp4_path):
            mp4_path = os.path.normpath(os.path.join(PROJECT_ROOT, mp4_path))

        cap = cv2.VideoCapture(mp4_path)
        if not cap.isOpened():
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(blank, f"Cannot open: {os.path.basename(mp4_path)}", (20, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 80, 255), 2)
            yield _jpg_chunk(blank, quality=80)
            return

        loc = data.get("location_code", "")
        roi_mask = None
        if show_roi and loc:
            roi_path = os.path.join(LOC_ROOT, loc, f"roi_{loc}.png")
            if os.path.exists(roi_path):
                roi_mask = cv2.imread(roi_path, cv2.IMREAD_GRAYSCALE)

        frame_idx = int(start_frame)
        if frame_idx > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)

        delay = 1.0 / max(1, int(fps))
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            objects = frame_map.get(frame_idx, [])
            if show_roi and roi_mask is not None:
                _apply_roi_overlay(frame, roi_mask)
            _draw_cctv_objects(frame, objects, show_tracking=show_tracking, show_3d=show_3d, show_label=show_label)

            cv2.putText(
                frame,
                f"Frame {frame_idx}",
                (10, max(20, frame.shape[0] - 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (210, 210, 210),
                1,
                lineType=cv2.LINE_AA,
            )

            yield _jpg_chunk(frame)
            frame_idx += 1
            time.sleep(delay)

        cap.release()

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.get("/stream/sat")
def stream_sat(
    path: str = Query(...),
    fps: int = Query(default=25, ge=1, le=60),
    show_3d: bool = Query(default=True),
    show_tracking: bool = Query(default=True),
    show_sat_box: bool = Query(default=True),
    show_sat_arrow: bool = Query(default=False),
    show_sat_coords_dot: bool = Query(default=False),
    show_sat_label: bool = Query(default=False),
    sat_label_size: int = Query(default=12, ge=6, le=48),
    sat_box_thick: int = Query(default=2, ge=1, le=10),
    text_color_mode: str = Query(default="White"),
    speed_delay_frames: int = Query(default=30, ge=0, le=120),
    sat_opacity: int = Query(default=0, ge=0, le=100),
    layer_physical: bool = Query(default=True),
    layer_guidelines: bool = Query(default=False),
    layer_aesthetic: bool = Query(default=True),
    layer_background: bool = Query(default=True),
    show_fov: bool = Query(default=False),
    fov_fill_pct: int = Query(default=25, ge=0, le=100),
    start_frame: int = Query(default=0, ge=0),
):
    full = _safe_out_path(path)

    def generate():
        try:
            data = _load_replay(full)
        except Exception:
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(blank, "Failed to load replay", (20, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 80, 255), 2)
            yield _jpg_chunk(blank, quality=80)
            return

        frame_map = _frame_map(data)
        g_data = _load_g_projection(data.get("location_code", ""))

        layers = set()
        if layer_background:
            layers.add("Background")
        if layer_aesthetic:
            layers.add("Aesthetic")
        if layer_guidelines:
            layers.add("Guidelines")
        if layer_physical:
            layers.add("Physical")

        sat_template, sat_use_svg = _build_sat_template(
            data,
            g_data,
            sat_opacity=sat_opacity,
            visible_layers=layers,
            show_fov=show_fov,
            fov_fill_pct=fov_fill_pct,
        )

        max_frames = 0
        for cand in [
            data.get("mp4_frame_count"),
            data.get("animation_frame_count"),
            data.get("frame_count"),
        ]:
            try:
                v = int(cand or 0)
            except Exception:
                v = 0
            if v > max_frames:
                max_frames = v

        if frame_map:
            max_frames = max(max_frames, max(frame_map.keys()) + 1)

        if max_frames <= 0:
            max_frames = 1

        frame_idx = int(start_frame)
        speed_cache = {}
        delay = 1.0 / max(1, int(fps))

        while frame_idx < max_frames:
            frame = sat_template.copy()
            objects = frame_map.get(frame_idx, [])

            _draw_sat_objects(
                frame,
                objects,
                show_tracking=show_tracking,
                show_3d=show_3d,
                show_sat_box=show_sat_box,
                show_sat_arrow=show_sat_arrow,
                show_sat_coords_dot=show_sat_coords_dot,
                show_sat_label=show_sat_label,
                sat_label_size=sat_label_size,
                sat_box_thick=sat_box_thick,
                text_color_mode=text_color_mode,
                speed_delay_frames=speed_delay_frames,
                speed_cache=speed_cache,
                frame_idx=frame_idx,
                sat_use_svg=sat_use_svg,
            )

            cv2.putText(
                frame,
                f"Frame {frame_idx}  Objects {len(objects)}",
                (10, max(20, frame.shape[0] - 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (230, 230, 230),
                1,
                lineType=cv2.LINE_AA,
            )

            yield _jpg_chunk(frame)
            frame_idx += 1
            time.sleep(delay)

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")
