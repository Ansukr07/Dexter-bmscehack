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

# Optional overlay/AI modules (desktop-first features that web can consume).
generate_density_map = None
normalize_density_map = None
draw_heatmap = None
IncidentDetector = None
draw_incidents = None
generate_recommendations = None
draw_recommendations = None

OVERLAY_FEATURES_AVAILABLE = False

try:
    from modules.heatmap import generate_density_map, normalize_density_map, draw_heatmap
    from modules.incidents import IncidentDetector, draw_incidents
    from modules.recommendations import generate_recommendations, draw_recommendations

    OVERLAY_FEATURES_AVAILABLE = True
except ImportError:
    OVERLAY_FEATURES_AVAILABLE = False

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


_CLASS_ALIASES = {
    "car": "car",
    "bus": "bus",
    "bike": "bike",
    "bicycle": "bike",
    "motorbike": "bike",
    "motorcycle": "bike",
    "truck": "truck",
    "lorry": "truck",
}


def _safe_float(value, default: float = 0.0) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(f):
        return default
    return f


def _extract_obj_point(obj: dict) -> tuple[float | None, float | None]:
    if not isinstance(obj, dict):
        return None, None

    x = _safe_float(obj.get("x"), np.nan)
    y = _safe_float(obj.get("y"), np.nan)
    if np.isfinite(x) and np.isfinite(y):
        return float(x), float(y)

    ref = obj.get("reference_point")
    if isinstance(ref, (list, tuple)) and len(ref) >= 2:
        x = _safe_float(ref[0], np.nan)
        y = _safe_float(ref[1], np.nan)
        if np.isfinite(x) and np.isfinite(y):
            return float(x), float(y)

    bbox = obj.get("bbox_2d")
    if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
        x1 = _safe_float(bbox[0], np.nan)
        y1 = _safe_float(bbox[1], np.nan)
        x2 = _safe_float(bbox[2], np.nan)
        y2 = _safe_float(bbox[3], np.nan)
        if np.isfinite(x1) and np.isfinite(y1) and np.isfinite(x2) and np.isfinite(y2):
            return float((x1 + x2) * 0.5), float((y1 + y2) * 0.5)

    return None, None


def _extract_obj_speed(obj: dict) -> float | None:
    if not isinstance(obj, dict):
        return None

    if "speed" in obj:
        return abs(_safe_float(obj.get("speed"), 0.0))
    if "speed_kmh" in obj:
        return abs(_safe_float(obj.get("speed_kmh"), 0.0))

    vx = _safe_float(obj.get("vx"), np.nan)
    vy = _safe_float(obj.get("vy"), np.nan)
    if np.isfinite(vx) and np.isfinite(vy):
        return float((vx * vx + vy * vy) ** 0.5)
    return None


def _extract_obj_class(obj: dict) -> str:
    raw = str((obj or {}).get("class", "")).strip().lower()
    return _CLASS_ALIASES.get(raw, "other")


def _congestion_score(density: float, avg_speed: float) -> float:
    speed_ratio = max(0.0, min(1.0, avg_speed / 24.0))
    speed_slowdown = 1.0 - speed_ratio
    return max(0.0, min(1.0, 0.65 * density + 0.35 * speed_slowdown))


def _congestion_level(density: float, avg_speed: float, score: float) -> str:
    if density >= 0.8 and avg_speed <= 12.0:
        return "HIGH"
    if density >= 0.65 and avg_speed <= 7.0:
        return "HIGH"
    if score >= 0.68:
        return "HIGH"
    if score >= 0.38:
        return "MEDIUM"
    return "LOW"


def _risk_score(density: float, avg_speed: float, stopped_count: int, cluster_count: int) -> float:
    speed_ratio = max(0.0, min(1.0, avg_speed / 24.0))
    return max(
        0.0,
        min(
            1.0,
            0.58 * density
            + 0.24 * (1.0 - speed_ratio)
            + 0.10 * min(1.0, stopped_count / 4.0)
            + 0.08 * min(1.0, cluster_count / 3.0),
        ),
    )


def _infer_frame_shape(data: dict) -> tuple[int, int]:
    meta = data.get("meta") or {}
    candidates = [
        (meta.get("height"), meta.get("width")),
        (meta.get("frame_height"), meta.get("frame_width")),
        (meta.get("h"), meta.get("w")),
    ]
    for h_raw, w_raw in candidates:
        h = int(_safe_float(h_raw, 0))
        w = int(_safe_float(w_raw, 0))
        if h > 0 and w > 0:
            return h, w

    mp4_path = data.get("mp4_path", "")
    if mp4_path and not os.path.isabs(mp4_path):
        mp4_path = os.path.normpath(os.path.join(PROJECT_ROOT, mp4_path))
    if mp4_path and os.path.exists(mp4_path):
        cap = cv2.VideoCapture(mp4_path)
        if cap.isOpened():
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            cap.release()
            if h > 0 and w > 0:
                return h, w

    return 720, 1280


def _top_zones_from_counts(zone_counts: dict, grid_size: int, limit: int = 8) -> list[dict]:
    out = []
    for (gx, gy), score in sorted(zone_counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]:
        cx = int(gx * grid_size + grid_size * 0.5)
        cy = int(gy * grid_size + grid_size * 0.5)
        out.append(
            {
                "grid": [int(gx), int(gy)],
                "center": [cx, cy],
                "score": int(score),
            }
        )
    return out


def _build_improvement_plan(summary: dict, top_hotspots: list[dict], recommendations: list[str]) -> list[dict]:
    high_ratio = float(summary.get("high_congestion_ratio", 0.0) or 0.0)
    incident_ratio = float(summary.get("incident_frame_ratio", 0.0) or 0.0)
    avg_speed = float(summary.get("avg_speed_kmh", 0.0) or 0.0)

    plan = []

    plan.append(
        {
            "title": "Adaptive Signal Split Optimization",
            "priority": "High" if high_ratio >= 0.25 else "Medium",
            "impact": "Reduce queue spillback and smooth phase transitions",
            "expected_delay_reduction_pct": 18 if high_ratio >= 0.25 else 10,
            "evidence": f"High-congestion share is {high_ratio * 100:.1f}% of sampled frames.",
        }
    )

    if incident_ratio >= 0.15:
        plan.append(
            {
                "title": "Conflict-Point Redesign",
                "priority": "High",
                "impact": "Reduce stopped-vehicle hotspots and improve safety margins",
                "expected_delay_reduction_pct": 12,
                "evidence": f"Incident activity detected in {incident_ratio * 100:.1f}% of frames.",
            }
        )

    if avg_speed < 12.0:
        plan.append(
            {
                "title": "Peak-Hour Turn Channelization",
                "priority": "Medium",
                "impact": "Increase discharge rate for dominant movement",
                "expected_delay_reduction_pct": 9,
                "evidence": f"Average corridor speed is low at {avg_speed:.1f} km/h.",
            }
        )

    if top_hotspots:
        h0 = top_hotspots[0].get("center", [0, 0])
        plan.append(
            {
                "title": "Targeted Junction Micro-Intervention",
                "priority": "Medium",
                "impact": "Deploy lane marking and enforcement at dominant congestion cell",
                "expected_delay_reduction_pct": 7,
                "evidence": f"Primary hotspot detected near pixel ({h0[0]}, {h0[1]}).",
            }
        )

    for rec in (recommendations or [])[:2]:
        plan.append(
            {
                "title": "AI Recommendation",
                "priority": "Advisory",
                "impact": rec,
                "expected_delay_reduction_pct": 5,
                "evidence": "Generated from observed traffic states.",
            }
        )

    return plan[:6]


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


@router.get("/analytics")
def get_analytics(
    path: str = Query(...),
    sample_step: int = Query(default=5, ge=1, le=240),
):
    full = _safe_out_path(path)
    try:
        data = _load_replay(full)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to load replay: {e}")

    frames = data.get("frames", []) or []
    if not frames:
        return {
            "path": path,
            "location_code": data.get("location_code"),
            "frame_shape": [720, 1280],
            "summary": {},
            "kpis": {},
            "distributions": {},
            "timeline": [],
            "hotspots": {"density": [], "stopped": [], "clusters": []},
            "recommendations": [],
            "improvement_plan": [],
            "report": {
                "headline": "No replay frames available for analytics.",
                "feedback": [],
            },
        }

    frame_h, frame_w = _infer_frame_shape(data)
    grid_size = max(36, int(min(frame_h, frame_w) / 14))

    class_totals = {"car": 0, "bus": 0, "bike": 0, "truck": 0, "other": 0}
    congestion_bins = {"LOW": 0, "MEDIUM": 0, "HIGH": 0}

    density_zone_counts = {}
    stopped_zone_counts = {}
    cluster_zone_counts = {}

    vehicle_series = []
    speed_series = []
    density_series = []
    congestion_series = []
    risk_series = []

    timeline = []
    incident_frame_count = 0
    peak_vehicle_count = 0

    incident_detector = IncidentDetector() if IncidentDetector is not None else None

    for i, frame in enumerate(frames):
        frame_idx = int(frame.get("frame_index", i))
        objects = frame.get("objects") or []
        vehicle_count = len(objects)
        peak_vehicle_count = max(peak_vehicle_count, vehicle_count)

        speeds = []
        for obj in objects:
            speed = _extract_obj_speed(obj)
            if speed is not None:
                speeds.append(speed)

            cls = _extract_obj_class(obj)
            class_totals[cls] = class_totals.get(cls, 0) + 1

            px, py = _extract_obj_point(obj)
            if px is not None and py is not None:
                gx = int(max(0, px) // grid_size)
                gy = int(max(0, py) // grid_size)
                density_zone_counts[(gx, gy)] = density_zone_counts.get((gx, gy), 0) + 1

        avg_speed = float(np.mean(speeds)) if speeds else 0.0
        density = min(1.0, vehicle_count / 80.0)
        congestion_score = _congestion_score(density, avg_speed)
        congestion_level = _congestion_level(density, avg_speed, congestion_score)
        congestion_bins[congestion_level] += 1

        stopped_count = 0
        cluster_count = 0

        if incident_detector is not None:
            try:
                incidents = incident_detector.process(objects)
            except Exception:
                incidents = {"stopped": [], "clusters": [], "stopped_points": []}

            stopped_count = len(incidents.get("stopped", []))
            cluster_count = len(incidents.get("clusters", []))

            for pt in incidents.get("stopped_points", []):
                x = _safe_float(pt.get("x"), -1)
                y = _safe_float(pt.get("y"), -1)
                if x >= 0 and y >= 0:
                    gx = int(x // grid_size)
                    gy = int(y // grid_size)
                    stopped_zone_counts[(gx, gy)] = stopped_zone_counts.get((gx, gy), 0) + 1

            for c in incidents.get("clusters", []):
                if not isinstance(c, (list, tuple)) or len(c) < 2:
                    continue
                x = _safe_float(c[0], -1)
                y = _safe_float(c[1], -1)
                if x >= 0 and y >= 0:
                    gx = int(x // grid_size)
                    gy = int(y // grid_size)
                    cluster_zone_counts[(gx, gy)] = cluster_zone_counts.get((gx, gy), 0) + 1

        if stopped_count > 0 or cluster_count > 0:
            incident_frame_count += 1

        risk_score = _risk_score(density, avg_speed, stopped_count, cluster_count)

        vehicle_series.append(float(vehicle_count))
        speed_series.append(float(avg_speed))
        density_series.append(float(density))
        congestion_series.append(float(congestion_score))
        risk_series.append(float(risk_score))

        if (i % sample_step) == 0 or i == (len(frames) - 1):
            timeline.append(
                {
                    "frame": int(frame_idx),
                    "vehicle_count": int(vehicle_count),
                    "avg_speed_kmh": round(avg_speed, 3),
                    "density": round(density, 5),
                    "congestion_score": round(congestion_score, 5),
                    "risk_score": round(risk_score, 5),
                    "congestion_level": congestion_level,
                    "stopped_vehicles": int(stopped_count),
                    "clusters": int(cluster_count),
                }
            )

    avg_vehicle = float(np.mean(vehicle_series)) if vehicle_series else 0.0
    avg_speed = float(np.mean(speed_series)) if speed_series else 0.0
    avg_density = float(np.mean(density_series)) if density_series else 0.0
    avg_risk = float(np.mean(risk_series)) if risk_series else 0.0
    high_ratio = congestion_bins.get("HIGH", 0) / max(1, len(frames))
    incident_ratio = incident_frame_count / max(1, len(frames))

    top_density = _top_zones_from_counts(density_zone_counts, grid_size=grid_size, limit=10)
    top_stopped = _top_zones_from_counts(stopped_zone_counts, grid_size=grid_size, limit=8)
    top_clusters = _top_zones_from_counts(cluster_zone_counts, grid_size=grid_size, limit=8)

    rec_input = {
        "density_zones": [tuple(z.get("center", [0, 0])) for z in top_density[:6]],
        "stopped_zones": [tuple(z.get("center", [0, 0])) for z in top_stopped[:6]],
        "avg_speed": avg_speed,
        "vehicle_count": int(round(avg_vehicle)),
    }
    recommendations = []
    if generate_recommendations is not None:
        try:
            recommendations = generate_recommendations(rec_input)
        except Exception:
            recommendations = []

    summary = {
        "frames_total": int(len(frames)),
        "frames_sampled": int(len(timeline)),
        "avg_vehicle_count": round(avg_vehicle, 3),
        "peak_vehicle_count": int(peak_vehicle_count),
        "avg_speed_kmh": round(avg_speed, 3),
        "avg_density": round(avg_density, 5),
        "avg_risk_score": round(avg_risk, 5),
        "high_congestion_ratio": round(high_ratio, 5),
        "incident_frame_ratio": round(incident_ratio, 5),
    }

    speed_norm = max(0.0, min(1.0, avg_speed / 24.0))
    stability = 1.0 - min(1.0, (float(np.std(vehicle_series)) / max(1.0, peak_vehicle_count)))
    safety = 1.0 - min(1.0, high_ratio * 0.65 + incident_ratio * 0.75)
    throughput = min(1.0, (avg_vehicle / max(1.0, peak_vehicle_count)) * (0.5 + 0.5 * speed_norm))
    readiness = max(0.0, min(1.0, 0.35 * throughput + 0.35 * stability + 0.30 * safety))

    kpis = {
        "throughput_index": round(throughput * 100.0, 2),
        "stability_index": round(stability * 100.0, 2),
        "safety_index": round(safety * 100.0, 2),
        "junction_readiness": round(readiness * 100.0, 2),
    }

    improvement_plan = _build_improvement_plan(summary, top_density, recommendations)

    feedback = [
        "Prioritize adaptive phase splits during peak demand windows.",
        "Deploy targeted enforcement/markings near the top hotspot cells.",
        "Monitor stopped-vehicle recurrence after each geometry/signal adjustment.",
    ]
    if avg_speed < 10.0:
        feedback.append("Average speed is critically low; consider immediate signal retiming pilot.")
    if high_ratio > 0.30:
        feedback.append("High congestion persistence suggests potential approach-capacity deficit.")

    return {
        "path": path,
        "location_code": data.get("location_code"),
        "frame_shape": [int(frame_h), int(frame_w)],
        "grid_size": int(grid_size),
        "sample_step": int(sample_step),
        "summary": summary,
        "kpis": kpis,
        "distributions": {
            "class_totals": class_totals,
            "congestion_bins": congestion_bins,
        },
        "timeline": timeline,
        "hotspots": {
            "density": top_density,
            "stopped": top_stopped,
            "clusters": top_clusters,
        },
        "recommendations": recommendations,
        "improvement_plan": improvement_plan,
        "report": {
            "headline": "AI junction assessment complete: review congestion trends, incident hotspots, and optimization actions.",
            "feedback": feedback,
            "overlay_features_available": OVERLAY_FEATURES_AVAILABLE,
        },
    }


@router.get("/stream")
def stream_video_compat(
    path: str = Query(...),
    fps: int = Query(default=25, ge=1, le=60),
    show_3d: bool = Query(default=True),
    show_label: bool = Query(default=True),
    show_tracking: bool = Query(default=True),
    show_roi: bool = Query(default=False),
    show_heatmap: bool = Query(default=False),
    show_incidents: bool = Query(default=False),
    show_recommendations: bool = Query(default=False),
    start_frame: int = Query(default=0, ge=0),
):
    return stream_cctv(
        path=path,
        fps=fps,
        show_3d=show_3d,
        show_label=show_label,
        show_tracking=show_tracking,
        show_roi=show_roi,
        show_heatmap=show_heatmap,
        show_incidents=show_incidents,
        show_recommendations=show_recommendations,
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
    show_heatmap: bool = Query(default=False),
    show_incidents: bool = Query(default=False),
    show_recommendations: bool = Query(default=False),
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

        incident_detector = IncidentDetector() if IncidentDetector is not None else None
        delay = 1.0 / max(1, int(fps))
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            objects = frame_map.get(frame_idx, [])
            if show_roi and roi_mask is not None:
                _apply_roi_overlay(frame, roi_mask)
            _draw_cctv_objects(frame, objects, show_tracking=show_tracking, show_3d=show_3d, show_label=show_label)

            # Apply traffic analysis overlays
            try:
                if show_heatmap and generate_density_map is not None and normalize_density_map is not None and draw_heatmap is not None:
                    density_map = generate_density_map(frame.shape, objects)
                    normalized_map = normalize_density_map(density_map)
                    frame = draw_heatmap(frame, normalized_map)

                detections = {"stopped": [], "clusters": [], "stopped_points": []}
                if show_incidents and incident_detector is not None and draw_incidents is not None:
                    detections = incident_detector.process(objects)
                    frame = draw_incidents(frame, detections)

                if show_recommendations and generate_recommendations is not None and draw_recommendations is not None:
                    zone_clusters = detections.get("clusters", []) if isinstance(detections, dict) else []
                    stopped_pts = detections.get("stopped_points", []) if isinstance(detections, dict) else []
                    avg_speed = 0.0
                    if objects:
                        speeds = [s for s in (_extract_obj_speed(o) for o in objects) if s is not None]
                        avg_speed = float(np.mean(speeds)) if speeds else 0.0

                    insights = {
                        "density_zones": zone_clusters,
                        "stopped_zones": [(p.get("x", 0), p.get("y", 0)) for p in stopped_pts],
                        "avg_speed": avg_speed,
                        "vehicle_count": len(objects),
                    }
                    frame = draw_recommendations(frame, insights)
            except Exception:
                # Silently skip overlays if feature modules are unavailable.
                pass

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
