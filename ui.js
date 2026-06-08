/**
 * ui.js — Supply Chain Digital Twin — Cinematic UI & GSAP Camera Controller
 * Handles: GSAP animations, HUD overlay, node click lifecycle, chart rendering
 */

import {
  initScene,
  loadNodes,
  getCamera,
  getScene,
  getRenderer,
  getNodMeshByID,
  highlightNode,
} from "./scene.js";

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js";

// ─── GSAP (loaded via CDN in HTML) ───────────────────────────────────────────
const gsap = window.gsap;

// ─── STATE ────────────────────────────────────────────────────────────────────
let selectedNodeId = null;
let allNodes = [];
let miniChartInstances = {};

// Camera presets
const CAM_GLOBAL = { x: 0, y: 18, z: 22 };

// ─── BOOT ─────────────────────────────────────────────────────────────────────
export async function boot() {
  const canvas = document.getElementById("gl-canvas");
  initScene(canvas, onNodeClicked, onNodeHovered);
  _bindUIEvents();
  await fetchAndRenderNodes();
  _playIntroAnimation();
}

// ─── DATA FETCHING ────────────────────────────────────────────────────────────
async function fetchAndRenderNodes() {
  try {
    showLoader(true);
    const res = await fetch("/api/nodes");
    const data = await res.json();
    if (!data.success) throw new Error("API error");
    allNodes = data.nodes;
    loadNodes(allNodes);
    _renderNodeList(allNodes);
    _updateGlobalStats(allNodes);
    showLoader(false);
  } catch (err) {
    console.error("[UI] fetchNodes failed:", err);
    showLoader(false);
    _showToast("Failed to load network nodes. Check backend.", "error");
  }
}

async function fetchNodeMetrics(nodeId) {
  try {
    const res = await fetch(`/api/nodes/${nodeId}/metrics`);
    const data = await res.json();
    if (!data.success) throw new Error("Metrics API error");
    return data;
  } catch (err) {
    console.error("[UI] fetchNodeMetrics failed:", err);
    _showToast("Failed to load node metrics.", "error");
    return null;
  }
}

// ─── NODE CLICK HANDLER ───────────────────────────────────────────────────────
async function onNodeClicked(nodeData, nodeGroup) {
  if (selectedNodeId === nodeData.id) return;
  selectedNodeId = nodeData.id;

  // Mark node selected
  document.querySelectorAll(".node-list-item").forEach(el => {
    el.classList.toggle("active", parseInt(el.dataset.nodeId) === nodeData.id);
  });

  // Fire camera zoom
  _zoomToNode(nodeData, nodeGroup);

  // Dim others
  highlightNode(nodeData.id, true);

  // Slide HUD in while fetching
  _openHUD(nodeData);

  const metrics = await fetchNodeMetrics(nodeData.id);
  if (metrics) {
    _populateHUD(metrics);
  }
}

// ─── NODE HOVER HANDLER ───────────────────────────────────────────────────────
function onNodeHovered(nodeData) {
  const tooltip = document.getElementById("tooltip");
  if (!nodeData) {
    gsap.to(tooltip, { opacity: 0, duration: 0.2 });
    return;
  }
  document.getElementById("tooltip-name").textContent = nodeData.name;
  document.getElementById("tooltip-status").textContent = nodeData.status.replace("_", " ");
  document.getElementById("tooltip-status").className = `status-badge status-${nodeData.status.toLowerCase()}`;
  document.getElementById("tooltip-stock").textContent = `${nodeData.stock_pct}% stocked`;
  gsap.to(tooltip, { opacity: 1, duration: 0.25 });
}

// ─── CAMERA TRANSITIONS ───────────────────────────────────────────────────────
function _zoomToNode(nodeData, nodeGroup) {
  const camera = getCamera();
  const targetX = nodeData.grid_x;
  const targetZ = nodeData.grid_z;

  const tl = gsap.timeline();

  // Phase 1: pull up & rotate toward target
  tl.to(camera.position, {
    x: targetX + 3.5,
    y: 10,
    z: targetZ + 9,
    duration: 1.1,
    ease: "power3.inOut",
    onUpdate: () => {
      camera.lookAt(new THREE.Vector3(targetX, 2, targetZ));
    },
  });

  // Phase 2: swoop in close
  tl.to(camera.position, {
    x: targetX + 1.8,
    y: 5.5,
    z: targetZ + 5.5,
    duration: 0.9,
    ease: "expo.out",
    onUpdate: () => {
      camera.lookAt(new THREE.Vector3(targetX, 1.5, targetZ));
    },
  });
}

function resetCamera() {
  selectedNodeId = null;
  const camera = getCamera();

  highlightNode(null, false);

  document.querySelectorAll(".node-list-item").forEach(el => el.classList.remove("active"));

  gsap.to(camera.position, {
    x: CAM_GLOBAL.x,
    y: CAM_GLOBAL.y,
    z: CAM_GLOBAL.z,
    duration: 1.6,
    ease: "power4.inOut",
    onUpdate: () => {
      camera.lookAt(new THREE.Vector3(0, 0, 0));
    },
  });

  _closeHUD();
}

// ─── HUD MANAGEMENT ───────────────────────────────────────────────────────────
function _openHUD(nodeData) {
  const hud = document.getElementById("node-hud");
  const cfg = _getStatusConfig(nodeData.status);

  // Header info
  document.getElementById("hud-node-name").textContent = nodeData.name;
  document.getElementById("hud-city").textContent = `${nodeData.city}, ${nodeData.country}`;
  document.getElementById("hud-tenant").textContent = nodeData.tenant_name;
  document.getElementById("hud-status-badge").textContent = nodeData.status.replace("_", " ");
  document.getElementById("hud-status-badge").className = `hud-status-badge status-${nodeData.status.toLowerCase()}`;

  // Quick stats
  document.getElementById("hud-stock-pct").textContent = `${nodeData.stock_pct}%`;
  document.getElementById("hud-health").textContent = `${nodeData.inventory_health.toFixed(1)}`;
  document.getElementById("hud-throughput").textContent = `${nodeData.throughput_tph.toFixed(0)}`;
  document.getElementById("hud-capacity").textContent = `${nodeData.capacity_units.toLocaleString()}`;

  // Stock bar
  const bar = document.getElementById("hud-stock-bar-fill");
  bar.style.width = "0%";
  bar.style.background = cfg.gradient;
  setTimeout(() => { bar.style.width = `${nodeData.stock_pct}%`; }, 100);

  // Show loading state for charts
  document.getElementById("hud-charts-area").innerHTML = _chartLoadingHTML();
  document.getElementById("hud-items-list").innerHTML = `<div class="loading-text">Loading inventory data...</div>`;
  document.getElementById("hud-alerts").innerHTML = "";

  // Slide in
  hud.classList.remove("hud-hidden");
  gsap.fromTo(hud,
    { x: 340, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.55, ease: "expo.out" }
  );

  // Animate stat counters
  _animateCounters();
}

function _closeHUD() {
  const hud = document.getElementById("node-hud");
  gsap.to(hud, {
    x: 340,
    opacity: 0,
    duration: 0.4,
    ease: "power3.in",
    onComplete: () => hud.classList.add("hud-hidden"),
  });
}

function _populateHUD(metrics) {
  const { node, items, analytics, alerts } = metrics;

  // Risk badge
  const riskEl = document.getElementById("hud-risk");
  if (riskEl) {
    riskEl.textContent = `${analytics.risk.label} (${analytics.risk.score}/100)`;
    riskEl.className = `risk-badge risk-${analytics.risk.label.toLowerCase()}`;
  }

  // Charts area
  document.getElementById("hud-charts-area").innerHTML = `
    <div class="chart-block">
      <div class="chart-label">INVENTORY HEALTH · 30 DAYS</div>
      <canvas id="chart-health" width="290" height="80"></canvas>
    </div>
    <div class="chart-block">
      <div class="chart-label">THROUGHPUT INDEX · 30 DAYS</div>
      <canvas id="chart-throughput" width="290" height="80"></canvas>
    </div>
    <div class="chart-block">
      <div class="chart-label">7-DAY DEMAND FORECAST</div>
      <canvas id="chart-demand" width="290" height="90"></canvas>
    </div>
  `;

  _renderMiniChart("chart-health", analytics.health_timeseries, "#00e5ff", "value");
  _renderMiniChart("chart-throughput", analytics.throughput_timeseries, "#f5a623", "value");
  _renderBarChart("chart-demand", analytics.demand_forecast);

  // Inventory items
  const itemsHTML = items.map(item => `
    <div class="inv-item ${item.critical ? "inv-item--critical" : ""}">
      <div class="inv-item-sku">${item.sku}</div>
      <div class="inv-item-name">${item.name}</div>
      <div class="inv-item-row">
        <span class="inv-item-cat">${item.category}</span>
        <span class="inv-item-dos ${item.days_of_supply < 3 ? "dos-critical" : item.days_of_supply < 7 ? "dos-warning" : "dos-ok"}">
          ${item.days_of_supply.toFixed(1)}d supply
        </span>
      </div>
      <div class="inv-item-bar-wrap">
        <div class="inv-item-bar" style="width:${Math.min(100, (item.stock_level / item.reorder_point) * 60)}%;
          background:${item.critical ? "#ff2244" : "#00e5ff"}"></div>
      </div>
      <div class="inv-item-nums">
        <span>${item.stock_level.toLocaleString()} units</span>
        <span>Reorder: ${item.reorder_point.toLocaleString()}</span>
        <span>DFI: ×${item.demand_forecast_index.toFixed(1)}</span>
      </div>
    </div>
  `).join("");
  document.getElementById("hud-items-list").innerHTML = itemsHTML;

  // Alerts
  const alertsHTML = alerts.length === 0
    ? `<div class="no-alerts">✓ No active alerts</div>`
    : alerts.map(a => `
      <div class="alert-item alert-${a.severity.toLowerCase()}">
        <span class="alert-dot"></span>
        <div>
          <div class="alert-sev">${a.severity}</div>
          <div class="alert-msg">${a.message}</div>
        </div>
      </div>
    `).join("");
  document.getElementById("hud-alerts").innerHTML = alertsHTML;

  // Analytics footer
  document.getElementById("hud-inv-value").textContent =
    `$${(analytics.total_inventory_value / 1000).toFixed(0)}K`;
  document.getElementById("hud-critical-skus").textContent = analytics.critical_skus;
  document.getElementById("hud-avg-dos").textContent = `${analytics.avg_days_of_supply}d`;
}

// ─── MINI CHARTS (Canvas API — no dependencies) ──────────────────────────────
function _renderMiniChart(canvasId, series, color, valueKey) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const vals = series.map(d => d[valueKey]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.roundRect(0, 0, W, H, 4);
  ctx.fill();

  const pad = { l: 4, r: 4, t: 6, b: 6 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;

  const pts = vals.map((v, i) => ({
    x: pad.l + (i / (vals.length - 1)) * cW,
    y: pad.t + (1 - (v - min) / range) * cH,
  }));

  // Fill gradient
  const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0, color + "55");
  grad.addColorStop(1, color + "00");

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const cp = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, cp.x, cp.y);
  }
  ctx.lineTo(pts[pts.length - 1].x, H - pad.b);
  ctx.lineTo(pts[0].x, H - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const cp = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, cp.x, cp.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Current value label
  const last = vals[vals.length - 1];
  ctx.fillStyle = color;
  ctx.font = "bold 10px 'Space Grotesk', monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${last.toFixed(1)}%`, W - pad.r, pad.t + 10);
}

function _renderBarChart(canvasId, forecast) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.roundRect(0, 0, W, H, 4);
  ctx.fill();

  const pad = { l: 6, r: 6, t: 10, b: 22 };
  const n = forecast.length;
  const barW = (W - pad.l - pad.r) / n - 3;
  const maxIdx = Math.max(...forecast.map(d => d.demand_index));

  forecast.forEach((d, i) => {
    const barH = ((d.demand_index / maxIdx) * (H - pad.t - pad.b));
    const x = pad.l + i * ((W - pad.l - pad.r) / n);
    const y = H - pad.b - barH;

    const color = d.demand_index > 2.5 ? "#ff2244" : d.demand_index > 1.5 ? "#f5a623" : "#00e5ff";
    const grad = ctx.createLinearGradient(0, y, 0, H - pad.b);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color + "44");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 2);
    ctx.fill();

    // Day label
    ctx.fillStyle = "#6688aa";
    ctx.font = "8px 'Space Grotesk', monospace";
    ctx.textAlign = "center";
    ctx.fillText(d.day.split(" ")[0], x + barW / 2, H - pad.b + 10);

    // Value
    if (barH > 16) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 8px monospace";
      ctx.fillText(d.demand_index.toFixed(1), x + barW / 2, y + 9);
    }
  });
}

// ─── NODE SIDEBAR LIST ────────────────────────────────────────────────────────
function _renderNodeList(nodes) {
  const list = document.getElementById("node-list");
  list.innerHTML = nodes.map(n => `
    <div class="node-list-item" data-node-id="${n.id}" title="${n.name}">
      <div class="node-list-dot status-dot-${n.status.toLowerCase()}"></div>
      <div class="node-list-info">
        <div class="node-list-name">${n.name}</div>
        <div class="node-list-meta">${n.city} · ${n.stock_pct}%</div>
      </div>
      <div class="node-list-health" style="color:${_statusColor(n.status)}">${n.inventory_health.toFixed(0)}</div>
    </div>
  `).join("");

  list.querySelectorAll(".node-list-item").forEach(el => {
    el.addEventListener("click", () => {
      const nodeId = parseInt(el.dataset.nodeId);
      const nodeData = allNodes.find(n => n.id === nodeId);
      if (nodeData) {
        const mesh = getNodMeshByID(nodeId);
        if (mesh) onNodeClicked(nodeData, mesh.group);
      }
    });
  });
}

// ─── GLOBAL STATS ─────────────────────────────────────────────────────────────
function _updateGlobalStats(nodes) {
  const critical = nodes.filter(n => n.status === "CRITICAL_LOW" || n.status === "DISRUPTED").length;
  const stable = nodes.filter(n => n.status === "STABLE").length;
  const avgHealth = (nodes.reduce((s, n) => s + n.inventory_health, 0) / nodes.length).toFixed(1);

  _animStat("stat-nodes", nodes.length);
  _animStat("stat-critical", critical);
  _animStat("stat-stable", stable);
  document.getElementById("stat-avg-health").textContent = `${avgHealth}%`;
}

function _animStat(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const obj = { v: 0 };
  gsap.to(obj, {
    v: target,
    duration: 1.5,
    ease: "power2.out",
    onUpdate: () => { el.textContent = Math.round(obj.v); },
  });
}

function _animateCounters() {
  document.querySelectorAll("[data-counter]").forEach(el => {
    const target = parseFloat(el.dataset.counter) || 0;
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target,
      duration: 1.2,
      ease: "power2.out",
      onUpdate: () => { el.textContent = Math.round(obj.v); },
    });
  });
}

// ─── INTRO ANIMATION ──────────────────────────────────────────────────────────
function _playIntroAnimation() {
  const camera = getCamera();
  // Start far above, swoop down
  camera.position.set(0, 45, 50);

  gsap.to(camera.position, {
    x: CAM_GLOBAL.x,
    y: CAM_GLOBAL.y,
    z: CAM_GLOBAL.z,
    duration: 3.2,
    ease: "expo.out",
    delay: 0.4,
    onUpdate: () => camera.lookAt(new THREE.Vector3(0, 0, 0)),
  });

  // Fade in header
  gsap.fromTo("#header", { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: 1.0, delay: 1.0 });
  gsap.fromTo("#sidebar-left", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.9, delay: 1.4 });
  gsap.fromTo("#global-stats", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.9, delay: 1.8 });
}

// ─── UI BINDINGS ──────────────────────────────────────────────────────────────
function _bindUIEvents() {
  document.getElementById("btn-reset-view").addEventListener("click", resetCamera);
  document.getElementById("hud-close-btn").addEventListener("click", () => {
    resetCamera();
  });

  document.getElementById("mouse-tooltip").addEventListener("mousemove", e => {
    const tooltip = document.getElementById("tooltip");
    tooltip.style.left = `${e.clientX + 16}px`;
    tooltip.style.top  = `${e.clientY - 10}px`;
  });

  window.addEventListener("mousemove", e => {
    const tooltip = document.getElementById("tooltip");
    tooltip.style.left = `${e.clientX + 16}px`;
    tooltip.style.top  = `${e.clientY - 10}px`;
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function _statusColor(status) {
  const map = {
    CRITICAL_LOW: "#ff2244",
    DISRUPTED:    "#ff6b00",
    STABLE:       "#f5a623",
    OVERSTOCKED:  "#00e5ff",
  };
  return map[status] || "#aaa";
}

function _getStatusConfig(status) {
  const map = {
    CRITICAL_LOW: { gradient: "linear-gradient(90deg, #ff2244, #ff6688)" },
    DISRUPTED:    { gradient: "linear-gradient(90deg, #ff6b00, #ffaa44)" },
    STABLE:       { gradient: "linear-gradient(90deg, #f5a623, #ffcc44)" },
    OVERSTOCKED:  { gradient: "linear-gradient(90deg, #00e5ff, #44aaff)" },
  };
  return map[status] || map.STABLE;
}

function _chartLoadingHTML() {
  return `<div class="charts-loading">
    <div class="loading-pulse"></div>
    <span>Fetching analytics...</span>
  </div>`;
}

function showLoader(visible) {
  const el = document.getElementById("global-loader");
  if (!el) return;
  el.style.opacity = visible ? "1" : "0";
  el.style.pointerEvents = visible ? "all" : "none";
}

function _showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast toast-${type} toast-visible`;
  setTimeout(() => { toast.className = "toast"; }, 4000);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", boot);
