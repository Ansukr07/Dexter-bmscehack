function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function severityFromRisk(risk) {
  if (risk >= 0.66) return "HIGH";
  if (risk >= 0.38) return "MEDIUM";
  return "LOW";
}

function safeNum(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

function zoneLabelFromGrid(grid) {
  if (!Array.isArray(grid) || grid.length < 2) return "Unknown";
  const gx = safeNum(grid[0], 0);
  const gy = safeNum(grid[1], 0);
  return `Zone ${gx}-${gy}`;
}

export function buildDisasterInsights(analytics) {
  const summary = analytics?.summary || {};
  const timeline = Array.isArray(analytics?.timeline) ? analytics.timeline : [];
  const hotspots = analytics?.hotspots || {};
  const densityHot = Array.isArray(hotspots.density) ? hotspots.density : [];
  const stoppedHot = Array.isArray(hotspots.stopped) ? hotspots.stopped : [];
  const clusterHot = Array.isArray(hotspots.clusters) ? hotspots.clusters : [];

  const zoneMap = new Map();

  function upsert(entry, source) {
    const grid = Array.isArray(entry?.grid) ? entry.grid : [0, 0];
    const key = `${safeNum(grid[0], 0)}_${safeNum(grid[1], 0)}`;
    const item = zoneMap.get(key) || {
      zone_id: key,
      zone_label: zoneLabelFromGrid(grid),
      grid,
      center: Array.isArray(entry?.center) ? entry.center : [0, 0],
      density_score: 0,
      stopped_score: 0,
      cluster_score: 0,
    };

    const score = safeNum(entry?.score, 0);
    if (source === "density") item.density_score = Math.max(item.density_score, score);
    if (source === "stopped") item.stopped_score = Math.max(item.stopped_score, score);
    if (source === "clusters") item.cluster_score = Math.max(item.cluster_score, score);

    zoneMap.set(key, item);
  }

  densityHot.forEach((z) => upsert(z, "density"));
  stoppedHot.forEach((z) => upsert(z, "stopped"));
  clusterHot.forEach((z) => upsert(z, "clusters"));

  const maxDensity = Math.max(1, ...densityHot.map((z) => safeNum(z?.score, 0)));
  const maxStopped = Math.max(1, ...stoppedHot.map((z) => safeNum(z?.score, 0)));
  const maxCluster = Math.max(1, ...clusterHot.map((z) => safeNum(z?.score, 0)));

  const riskZonesAll = [...zoneMap.values()].map((z) => {
    const densityNorm = clamp(z.density_score / maxDensity, 0, 1);
    const stoppedNorm = clamp(z.stopped_score / maxStopped, 0, 1);
    const clusterNorm = clamp(z.cluster_score / maxCluster, 0, 1);
    const potholeProb = clamp(0.52 * stoppedNorm + 0.28 * clusterNorm + 0.20 * densityNorm, 0, 1);
    const riskScore = clamp(0.46 * densityNorm + 0.34 * stoppedNorm + 0.20 * clusterNorm, 0, 1);
    const severity = severityFromRisk(riskScore);

    return {
      ...z,
      risk_score: Number(riskScore.toFixed(5)),
      severity,
      pothole_probability: Number(potholeProb.toFixed(5)),
    };
  });

  riskZonesAll.sort((a, b) => safeNum(b.risk_score) - safeNum(a.risk_score));

  const riskZones = {
    HIGH: riskZonesAll.filter((z) => z.severity === "HIGH"),
    MEDIUM: riskZonesAll.filter((z) => z.severity === "MEDIUM"),
    LOW: riskZonesAll.filter((z) => z.severity === "LOW"),
  };

  const zoneSummary = {
    HIGH: riskZones.HIGH.length,
    MEDIUM: riskZones.MEDIUM.length,
    LOW: riskZones.LOW.length,
  };

  const reroutingPlan = [];
  const lowPool = [...riskZones.LOW, ...riskZones.MEDIUM].sort((a, b) => safeNum(a.risk_score) - safeNum(b.risk_score));
  riskZones.HIGH.slice(0, 4).forEach((src, idx) => {
    const dst = lowPool.find((x) => x.zone_id !== src.zone_id);
    if (!dst) return;
    const etaGain = clamp(9 + (safeNum(src.risk_score) - safeNum(dst.risk_score)) * 38, 6, 40);
    reroutingPlan.push({
      route_id: `R-${idx + 1}`,
      source_zone: src.zone_label,
      target_zone: dst.zone_label,
      priority: safeNum(src.risk_score) >= 0.78 ? "Immediate" : "Urgent",
      eta_gain_pct: Number(etaGain.toFixed(2)),
      reason: "High-risk congestion and stoppage activity in source sector",
      signal_directive: "Raise dynamic green split and divert inbound flow",
    });
  });

  const potholePredictions = riskZonesAll
    .map((z) => {
      const p = safeNum(z.pothole_probability);
      let priority = "Monitor";
      let repair_window_hours = 48;
      if (p >= 0.72) {
        priority = "Critical";
        repair_window_hours = 6;
      } else if (p >= 0.5) {
        priority = "High";
        repair_window_hours = 12;
      } else if (p >= 0.35) {
        priority = "Moderate";
        repair_window_hours = 24;
      }

      return {
        zone_label: z.zone_label,
        pothole_probability: Number(p.toFixed(5)),
        confidence: Number(clamp(0.5 + p * 0.42, 0.25, 0.98).toFixed(3)),
        priority,
        repair_window_hours,
      };
    })
    .filter((x) => x.pothole_probability >= 0.22)
    .slice(0, 8);

  const avgRisk = timeline.length
    ? timeline.reduce((acc, t) => acc + safeNum(t.risk_score), 0) / timeline.length
    : safeNum(summary.avg_risk_score, 0);
  const avgDensity = safeNum(summary.avg_density, 0);
  const avgSpeed = safeNum(summary.avg_speed_kmh, 0);
  const incidentRatio = safeNum(summary.incident_frame_ratio, 0);
  const avgPothole = potholePredictions.length
    ? potholePredictions.reduce((acc, p) => acc + safeNum(p.pothole_probability), 0) / potholePredictions.length
    : 0;

  const highShare = riskZonesAll.length ? zoneSummary.HIGH / riskZonesAll.length : 0;
  const disasterIndex = clamp((0.50 * highShare + 0.28 * clamp(incidentRatio * 1.25, 0, 1) + 0.22 * avgPothole) * 100, 0, 100);

  const status = disasterIndex >= 70 ? "CRITICAL" : disasterIndex >= 45 ? "WATCH" : "STABLE";

  const baseline = {
    density: Number(avgDensity.toFixed(5)),
    avg_speed_kmh: Number(avgSpeed.toFixed(3)),
    risk_score: Number(avgRisk.toFixed(5)),
    incident_ratio: Number(incidentRatio.toFixed(5)),
  };

  const scenarios = [
    {
      id: "adaptive_signal_priority",
      name: "Adaptive Signal Priority",
      metrics_after: {
        density: Number(clamp(avgDensity * 0.88, 0, 1).toFixed(5)),
        avg_speed_kmh: Number((avgSpeed * 1.12).toFixed(3)),
        risk_score: Number(clamp(avgRisk * 0.82, 0, 1).toFixed(5)),
        pothole_probability: Number(clamp(avgPothole * 0.96, 0, 1).toFixed(5)),
      },
      resilience_index: Number(clamp(100 - disasterIndex * 0.82, 0, 100).toFixed(2)),
      eta_gain_projection_pct: Number(clamp(12 + (100 - disasterIndex) * 0.17, 8, 42).toFixed(2)),
      operational_play: "Retime phases and open emergency green corridor",
    },
    {
      id: "controlled_emergency_reroute",
      name: "Controlled Emergency Reroute",
      metrics_after: {
        density: Number(clamp(avgDensity * 0.84, 0, 1).toFixed(5)),
        avg_speed_kmh: Number((avgSpeed * 1.08).toFixed(3)),
        risk_score: Number(clamp(avgRisk * 0.78, 0, 1).toFixed(5)),
        pothole_probability: Number(clamp(avgPothole * 0.91, 0, 1).toFixed(5)),
      },
      resilience_index: Number(clamp(100 - disasterIndex * 0.76, 0, 100).toFixed(2)),
      eta_gain_projection_pct: Number(clamp(10 + (100 - disasterIndex) * 0.21, 8, 45).toFixed(2)),
      operational_play: "Divert from high-risk sectors and meter inflow",
    },
    {
      id: "rapid_pothole_response",
      name: "Rapid Pothole Response",
      metrics_after: {
        density: Number(clamp(avgDensity * 0.92, 0, 1).toFixed(5)),
        avg_speed_kmh: Number((avgSpeed * 1.11).toFixed(3)),
        risk_score: Number(clamp(avgRisk * 0.74, 0, 1).toFixed(5)),
        pothole_probability: Number(clamp(avgPothole * 0.56, 0, 1).toFixed(5)),
      },
      resilience_index: Number(clamp(100 - disasterIndex * 0.72, 0, 100).toFixed(2)),
      eta_gain_projection_pct: Number(clamp(9 + (100 - disasterIndex) * 0.19, 7, 40).toFixed(2)),
      operational_play: "Patch high-probability road-damage sectors with lane shielding",
    },
  ].sort((a, b) => safeNum(b.resilience_index) - safeNum(a.resilience_index));

  const bestScenario = scenarios[0] || null;

  const projectedRiskTimeline = [];
  const target = safeNum(bestScenario?.metrics_after?.risk_score, avgRisk);
  for (let i = 1; i <= 8; i += 1) {
    const t = i / 8;
    projectedRiskTimeline.push(Number(((1 - t) * avgRisk + t * target).toFixed(5)));
  }

  const playbook = [
    "Activate incident command workflow and lock monitoring on high-severity zones.",
    "Deploy nearest response crew to top two high-risk sectors within 12 minutes.",
  ];

  if (reroutingPlan.length > 0) {
    const first = reroutingPlan[0];
    playbook.push(`Enable reroute ${first.route_id}: ${first.source_zone} to ${first.target_zone}.`);
  }
  if (potholePredictions.length > 0) {
    const top = potholePredictions[0];
    playbook.push(`Prioritize pothole repair in ${top.zone_label} (${(top.pothole_probability * 100).toFixed(1)}%).`);
  }
  if (safeNum(summary.high_congestion_ratio, 0) > 0.25) {
    playbook.push("Activate peak-hour emergency phase plan to reduce queue spillback.");
  }
  if (bestScenario) {
    playbook.push(`Primary twin strategy: ${bestScenario.name} (resilience ${bestScenario.resilience_index.toFixed(1)}).`);
  }

  return {
    disaster_index: Number(disasterIndex.toFixed(2)),
    status,
    zone_summary: zoneSummary,
    risk_zones: riskZones,
    rerouting_plan: reroutingPlan,
    pothole_model: {
      model: {
        name: "Pipeline-Embedded Pothole Risk Model v1",
        features: ["density hotspots", "stoppage hotspots", "cluster hotspots", "risk timeline"],
      },
      prediction_zones: potholePredictions,
      event_samples: [],
    },
    digital_twin: {
      baseline,
      scenarios,
      best_scenario: bestScenario,
      projected_risk_timeline: projectedRiskTimeline,
      grid: riskZonesAll,
    },
    playbook: playbook.slice(0, 8),
  };
}
