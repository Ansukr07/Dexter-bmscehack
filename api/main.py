import os
import sys

# Ensure the project root is on the Python path so trafficlab package is importable
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.routers import config, locations, inference, visualization

app = FastAPI(title="TrafficLab 3D API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config.router, prefix="/api/config", tags=["Config"])
app.include_router(locations.router, prefix="/api/locations", tags=["Locations"])
app.include_router(inference.router, prefix="/api/inference", tags=["Inference"])
app.include_router(visualization.router, prefix="/api/visualization", tags=["Visualization"])

# Serve location images statically
location_dir = os.path.join(PROJECT_ROOT, "location")
os.makedirs(location_dir, exist_ok=True)
app.mount("/location", StaticFiles(directory=location_dir), name="location")

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.1.0"}
