import os
import json
import yaml
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_PATH = os.path.join(PROJECT_ROOT, "inference_config.yaml")
MEASUREMENTS_PATH = os.path.join(PROJECT_ROOT, "prior_dimensions.json")

router = APIRouter()


class RawYAMLBody(BaseModel):
    content: str


class MeasurementsBody(BaseModel):
    data: dict


@router.get("")
def get_config():
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(404, "inference_config.yaml not found")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        raw = f.read()
    try:
        parsed = yaml.safe_load(raw)
        config_names = list(parsed.get("configs", {}).keys()) if isinstance(parsed, dict) else []
    except Exception:
        config_names = []
    return {"raw": raw, "config_names": config_names}


@router.put("")
def save_config(body: RawYAMLBody):
    try:
        yaml.safe_load(body.content)  # validate
    except Exception as e:
        raise HTTPException(400, f"Invalid YAML: {e}")
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        f.write(body.content)
    return {"ok": True}


@router.get("/measurements")
def get_measurements():
    if not os.path.exists(MEASUREMENTS_PATH):
        raise HTTPException(404, "prior_dimensions.json not found")
    with open(MEASUREMENTS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


@router.put("/measurements")
def save_measurements(body: MeasurementsBody):
    with open(MEASUREMENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(body.data, f, indent=2)
    return {"ok": True}
