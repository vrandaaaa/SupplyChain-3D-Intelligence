/**
 * scene.js — Supply Chain Digital Twin — 3D WebGL Engine
 * Three.js r158 | Full 3D node visualization, particle grid, and raycasting
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js";

// ─── COLOR PALETTE ───────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  CRITICAL_LOW:  { color: 0xff2244, emissive: 0xff0022, emissiveIntensity: 2.2, label: "CRITICAL LOW"  },
  STABLE:        { color: 0xf5a623, emissive: 0xe08800, emissiveIntensity: 1.4, label: "STABLE"         },
  OVERSTOCKED:   { color: 0x00e5ff, emissive: 0x00aacc, emissiveIntensity: 1.8, label: "OVERSTOCKED"    },
  DISRUPTED:     { color: 0xff6b00, emissive: 0xcc4400, emissiveIntensity: 2.0, label: "DISRUPTED"      },
};

const GRID_COLOR   = 0x0a2a3a;
const ACCENT_CYAN  = 0x00e5ff;
const BG_COLOR     = 0x030b12;

// ─── SCENE STATE ─────────────────────────────────────────────────────────────
let renderer, scene, camera, raycaster, mouse;
let nodeMeshes = [];
let particleSystem, gridHelper;
let animationId = null;
let clock;
let hoveredNode = null;
let pulseTime = 0;
let connectionLines = [];

// Callbacks injected by ui.js
let onNodeClickCallback = null;
let onNodeHoverCallback = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
export function initScene(canvas, onNodeClick, onNodeHover) {
  onNodeClickCallback = onNodeClick;
  onNodeHoverCallback = onNodeHover;
  clock = new THREE.Clock();

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.FogExp2(BG_COLOR, 0.018);

  // Camera
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 18, 22);
  camera.lookAt(0, 0, 0);

  // Interaction
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Build scene elements
  _buildLighting();
  _buildParticleField();
  _buildGroundGrid();
  _buildAtmosphericRings();

  // Events
  window.addEventListener("resize", _onResize);
  canvas.addEventListener("mousemove", _onMouseMove);
  canvas.addEventListener("click", _onCanvasClick);

  // Start loop
  _animate();

  return { scene, camera, renderer };
}

// ─── LIGHTING ─────────────────────────────────────────────────────────────────
function _buildLighting() {
  const ambient = new THREE.AmbientLight(0x0a1520, 4.0);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0x2266aa, 2.5);
  keyLight.position.set(10, 20, 10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 80;
  keyLight.shadow.camera.left = -30;
  keyLight.shadow.camera.right = 30;
  keyLight.shadow.camera.top = 30;
  keyLight.shadow.camera.bottom = -30;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x00e5ff, 1.2);
  rimLight.position.set(-12, 8, -15);
  scene.add(rimLight);

  const fillLight = new THREE.PointLight(0x001122, 3.0, 60);
  fillLight.position.set(0, -5, 0);
  scene.add(fillLight);
}

// ─── PARTICLE FIELD ────────────────────────────────────────────────────────────
function _buildParticleField() {
  const count = 2400;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const c1 = new THREE.Color(0x003355);
  const c2 = new THREE.Color(0x00e5ff);
  const c3 = new THREE.Color(0x001122);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const r = 40 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = (Math.random() - 0.5) * 30;
    positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 0.5 + Math.random() * 1.5;

    const mixFactor = Math.random();
    const color = mixFactor < 0.4 ? c1 : mixFactor < 0.7 ? c2 : c3;
    const variance = (Math.random() - 0.5) * 0.3;
    colors[i3]     = Math.max(0, Math.min(1, color.r + variance));
    colors[i3 + 1] = Math.max(0, Math.min(1, color.g + variance));
    colors[i3 + 2] = Math.max(0, Math.min(1, color.b + variance));
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  particleSystem = new THREE.Points(geometry, material);
  scene.add(particleSystem);
}

// ─── GROUND GRID ──────────────────────────────────────────────────────────────
function _buildGroundGrid() {
  // Primary grid plane
  const gridGeo = new THREE.PlaneGeometry(80, 80, 60, 60);
  const gridMat = new THREE.MeshBasicMaterial({
    color: 0x001a2e,
    wireframe: true,
    transparent: true,
    opacity: 0.18,
  });
  const gridPlane = new THREE.Mesh(gridGeo, gridMat);
  gridPlane.rotation.x = -Math.PI / 2;
  gridPlane.position.y = -0.05;
  scene.add(gridPlane);

  // Glowing floor disc
  const discGeo = new THREE.CircleGeometry(32, 128);
  const discMat = new THREE.MeshStandardMaterial({
    color: 0x000d1a,
    emissive: 0x001122,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.88,
    roughness: 0.9,
    metalness: 0.1,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.1;
  disc.receiveShadow = true;
  scene.add(disc);
}

// ─── ATMOSPHERIC RINGS ────────────────────────────────────────────────────────
function _buildAtmosphericRings() {
  const ringData = [
    { radius: 15, tube: 0.03, color: 0x00e5ff, opacity: 0.3, speed: 0.0008 },
    { radius: 22, tube: 0.02, color: 0x0066aa, opacity: 0.2, speed: -0.0005 },
    { radius: 30, tube: 0.015, color: 0x004466, opacity: 0.15, speed: 0.0003 },
  ];

  ringData.forEach((r, i) => {
    const geo = new THREE.TorusGeometry(r.radius, r.tube, 8, 180);
    const mat = new THREE.MeshBasicMaterial({
      color: r.color,
      transparent: true,
      opacity: r.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.05;
    ring.userData.rotSpeed = r.speed;
    ring.userData.isRing = true;
    scene.add(ring);
  });
}

// ─── NODE LOADING ─────────────────────────────────────────────────────────────
export function loadNodes(nodesData) {
  // Clear previous
  nodeMeshes.forEach(m => scene.remove(m.group));
  connectionLines.forEach(l => scene.remove(l));
  nodeMeshes = [];
  connectionLines = [];

  nodesData.forEach(nodeData => {
    const group = _createNodeMesh(nodeData);
    scene.add(group);
    nodeMeshes.push({ group, nodeData, id: nodeData.id });
  });

  _buildConnectionLines(nodesData);
}

function _createNodeMesh(nodeData) {
  const cfg = STATUS_CONFIG[nodeData.status] || STATUS_CONFIG.STABLE;
  const group = new THREE.Group();

  // Scale height 0.8–5.5 based on capacity
  const maxCap = 35000;
  const heightScale = 0.8 + (nodeData.capacity_units / maxCap) * 4.7;
  const stockPct = nodeData.stock_pct / 100;

  // Base pedestal
  const pedestalGeo = new THREE.CylinderGeometry(0.55, 0.7, 0.18, 16);
  const pedestalMat = new THREE.MeshStandardMaterial({
    color: 0x051525,
    emissive: cfg.emissive,
    emissiveIntensity: 0.3,
    roughness: 0.4,
    metalness: 0.9,
  });
  const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  // Main tower
  const towerGeo = new THREE.CylinderGeometry(0.32, 0.45, heightScale, 8);
  const towerMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.emissive,
    emissiveIntensity: cfg.emissiveIntensity * 0.7,
    roughness: 0.2,
    metalness: 0.85,
    transparent: true,
    opacity: 0.92,
  });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.y = heightScale / 2 + 0.09;
  tower.castShadow = true;
  group.add(tower);

  // Stock fill visualization
  const fillHeight = heightScale * stockPct;
  if (fillHeight > 0.05) {
    const fillGeo = new THREE.CylinderGeometry(0.30, 0.43, fillHeight, 8);
    const fillMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.emissive,
      emissiveIntensity: cfg.emissiveIntensity * 1.4,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.75,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.y = fillHeight / 2 + 0.09;
    group.add(fill);
  }

  // Top cap / beacon
  const capGeo = new THREE.OctahedronGeometry(0.28, 0);
  const capMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.emissive,
    emissiveIntensity: cfg.emissiveIntensity * 1.8,
    roughness: 0.05,
    metalness: 1.0,
  });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = heightScale + 0.38;
  cap.userData.isBeacon = true;
  group.add(cap);

  // Point light on beacon
  const nodeLight = new THREE.PointLight(cfg.color, 2.8, 6.5);
  nodeLight.position.y = heightScale + 0.4;
  group.add(nodeLight);
  group.userData.nodeLight = nodeLight;

  // Halo ring
  const haloGeo = new THREE.TorusGeometry(0.65, 0.025, 8, 64);
  const haloMat = new THREE.MeshBasicMaterial({
    color: cfg.color,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.1;
  halo.userData.isHalo = true;
  group.add(halo);

  // Position in 3D space
  group.position.set(nodeData.grid_x, 0, nodeData.grid_z);
  group.userData = {
    ...group.userData,
    nodeId: nodeData.id,
    nodeData,
    cfg,
    heightScale,
    baseY: 0,
    phaseOffset: Math.random() * Math.PI * 2,
    isNodeGroup: true,
  };

  // Tag tower as clickable target
  tower.userData.nodeId = nodeData.id;
  cap.userData.nodeId = nodeData.id;

  return group;
}

// ─── CONNECTION LINES ─────────────────────────────────────────────────────────
function _buildConnectionLines(nodesData) {
  // Connect each node to its nearest 2 neighbours
  nodesData.forEach(src => {
    const distances = nodesData
      .filter(n => n.id !== src.id)
      .map(n => ({
        node: n,
        dist: Math.hypot(n.grid_x - src.grid_x, n.grid_z - src.grid_z),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2);

    distances.forEach(({ node: dst }) => {
      const srcCfg = STATUS_CONFIG[src.status] || STATUS_CONFIG.STABLE;
      const points = [
        new THREE.Vector3(src.grid_x, 0.2, src.grid_z),
        new THREE.Vector3(
          (src.grid_x + dst.grid_x) / 2,
          1.5 + Math.random() * 1.5,
          (src.grid_z + dst.grid_z) / 2
        ),
        new THREE.Vector3(dst.grid_x, 0.2, dst.grid_z),
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      const curvePoints = curve.getPoints(40);
      const geo = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const mat = new THREE.LineBasicMaterial({
        color: srcCfg.color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.userData.isConnectionLine = true;
      line.userData.baseOpacity = 0.18;
      scene.add(line);
      connectionLines.push(line);
    });
  });
}

// ─── ANIMATION LOOP ───────────────────────────────────────────────────────────
function _animate() {
  animationId = requestAnimationFrame(_animate);
  const delta = clock.getDelta();
  pulseTime += delta;

  // Rotate particle field slowly
  if (particleSystem) {
    particleSystem.rotation.y += 0.00015;
  }

  // Animate atmospheric rings
  scene.children.forEach(obj => {
    if (obj.userData.isRing) {
      obj.rotation.z += obj.userData.rotSpeed;
    }
  });

  // Animate node groups
  nodeMeshes.forEach(({ group }) => {
    const { phaseOffset, cfg, heightScale } = group.userData;
    const t = pulseTime * 1.8 + phaseOffset;

    // Hover bob
    group.position.y = group.userData.baseY + Math.sin(t * 0.6) * 0.04;

    // Beacon spin + pulse
    group.children.forEach(child => {
      if (child.userData.isBeacon) {
        child.rotation.y += delta * 1.2;
        child.rotation.x += delta * 0.4;
        const scale = 1 + Math.sin(t * 2.4) * 0.18;
        child.scale.setScalar(scale);
      }
      if (child.userData.isHalo) {
        child.material.opacity = 0.3 + Math.sin(t * 1.8) * 0.25;
        const hs = 1 + Math.sin(t * 1.1) * 0.12;
        child.scale.setScalar(hs);
      }
    });

    // Node light pulse
    if (group.userData.nodeLight) {
      group.userData.nodeLight.intensity = 2.2 + Math.sin(t * 2.2) * 0.9;
    }
  });

  renderer.render(scene, camera);
}

// ─── RAYCASTING ───────────────────────────────────────────────────────────────
function _getIntersectedNode(event) {
  mouse.x =  (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const targets = [];
  nodeMeshes.forEach(({ group }) => {
    group.children.forEach(child => {
      if (child.userData.nodeId !== undefined) targets.push(child);
    });
  });

  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length > 0) {
    const nodeId = hits[0].object.userData.nodeId;
    return nodeMeshes.find(n => n.id === nodeId) || null;
  }
  return null;
}

function _onMouseMove(event) {
  const hit = _getIntersectedNode(event);
  if (hit !== hoveredNode) {
    hoveredNode = hit;
    document.body.style.cursor = hit ? "pointer" : "default";
    if (onNodeHoverCallback) onNodeHoverCallback(hit ? hit.nodeData : null);
  }
}

function _onCanvasClick(event) {
  const hit = _getIntersectedNode(event);
  if (hit && onNodeClickCallback) {
    onNodeClickCallback(hit.nodeData, hit.group);
  }
}

// ─── CAMERA HELPERS ───────────────────────────────────────────────────────────
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getScene() { return scene; }
export function getNodMeshByID(id) {
  return nodeMeshes.find(n => n.id === id) || null;
}

// ─── HIGHLIGHT ────────────────────────────────────────────────────────────────
export function highlightNode(nodeId, active) {
  nodeMeshes.forEach(({ group, id }) => {
    group.children.forEach(child => {
      if (child.material && child.userData.isBeacon !== true) {
        if (active && id === nodeId) {
          if (child.material.emissiveIntensity !== undefined) {
            child.material.emissiveIntensity *= 1.8;
          }
        }
      }
    });

    // Dim others
    if (active && id !== nodeId) {
      group.children.forEach(child => {
        if (child.material) {
          child.material.opacity = child.material.opacity !== undefined
            ? Math.max(0.15, child.material.opacity * 0.35)
            : 1;
        }
      });
    } else if (!active) {
      // Restore
      const cfg = group.userData.cfg;
      group.children.forEach(child => {
        if (child.material && child.userData.isBeacon !== true && child.userData.isHalo !== true) {
          child.material.opacity = child.material.transparent ? 0.92 : 1;
          if (child.material.emissiveIntensity !== undefined && cfg) {
            child.material.emissiveIntensity = cfg.emissiveIntensity * 0.7;
          }
        }
      });
    }
  });
}

// ─── RESIZE ───────────────────────────────────────────────────────────────────
function _onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// ─── CLEANUP ──────────────────────────────────────────────────────────────────
export function destroyScene() {
  if (animationId) cancelAnimationFrame(animationId);
  window.removeEventListener("resize", _onResize);
  renderer.dispose();
}
