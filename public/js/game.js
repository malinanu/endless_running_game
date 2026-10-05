// Christmas Runner — Three.js endless runner using KayKit CC0 models.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { auth, initAuthUI, openAuthModal } from './auth.js';
import { loadInto } from './leaderboard.js';
import { Sfx } from './audio.js';

// ---------------------------------------------------------------- tuning

const CFG = {
  baseSpeed: 10,          // world units / second
  speedStep: 1.05,        // ×5% ...
  speedEvery: 200,        // ... every 200 points
  gravity: -34,
  jumpVelocity: 12.5,     // apex ≈ 2.3 units, air time ≈ 0.74 s
  fastFall: -60,          // extra gravity when ↓ is pressed mid-air
  slideTime: 0.75,
  standHeight: 1.7,
  slideHeight: 0.75,
  halfWidth: 0.32,
  spawnX: 48,
  despawnX: -16,
  coinValue: 25,
};

const ASSET = '/assets';
const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- renderer / scene

const container = $('#game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.append(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0x5a5fa8);
scene.background = makeSkyTexture();
scene.fog = new THREE.Fog(HORIZON, 45, 170);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 400);
const CAM_BASE = new THREE.Vector3(4, 3.9, 11);
const CAM_LOOK = new THREE.Vector3(6.5, 1.5, 0);
camera.position.copy(CAM_BASE);
camera.lookAt(CAM_LOOK);

scene.add(new THREE.HemisphereLight(0xb8ccff, 0xf2f6ff, 1.5));
const moon = new THREE.DirectionalLight(0xdfe8ff, 2.2);
moon.position.set(-8, 22, 14);
moon.target.position.set(6, 0, 0);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -14, right: 34, top: 14, bottom: -8, near: 1, far: 70 });
moon.shadow.bias = -0.0005;
moon.shadow.normalBias = 0.02;
scene.add(moon, moon.target);
// Warm lantern glow around the runner.
const glow = new THREE.PointLight(0xffb36b, 6, 9, 1.6);
glow.position.set(1, 2.5, 2.5);
scene.add(glow);

function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#060b24');
  grad.addColorStop(0.45, '#1a2560');
  grad.addColorStop(0.75, '#3b3f8a');
  grad.addColorStop(1, '#5a5fa8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- loading

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => { $('#load-bar').style.width = `${(loaded / total) * 100}%`; };
const loader = new GLTFLoader(manager);

const MODELS = {
  knight: 'player/Knight.glb',
  animBasic: 'player/Rig_Medium_MovementBasic.glb',
  animGeneral: 'player/Rig_Medium_General.glb',
  animAdvanced: 'player/Rig_Medium_MovementAdvanced.glb',
  snow: 'environment/snow.gltf',
  grassSnow: 'environment/grass_with_snow.gltf',
  dirtSnow: 'environment/dirt_with_snow.gltf',
  tree: 'environment/tree_with_snow.gltf',
  ice: 'environment/glass.gltf',
  buildingA: 'environment/building_A.gltf',
  buildingB: 'environment/building_B.gltf',
  buildingC: 'environment/building_C.gltf',
  buildingD: 'environment/building_D.gltf',
  buildingE: 'environment/building_E.gltf',
  streetlight: 'environment/streetlight.gltf',
  box: 'obstacles/box_A.gltf',
  logs: 'obstacles/Wood_Log_Stack.gltf',
  coal: 'obstacles/Stone_Chunks_Small.gltf',
  gold: 'obstacles/Gold_Bar.gltf',
};

async function loadModels() {
  const entries = await Promise.all(
    Object.entries(MODELS).map(async ([key, path]) => [key, await loader.loadAsync(`${ASSET}/${path}`)]),
  );
  return Object.fromEntries(entries);
}

function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

function firstMesh(gltf) {
  let mesh = null;
  gltf.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  return mesh;
}

/** Clone a model and give every mesh its own tinted / replaced material. */
function tinted(source, { color, map, emissive, emissiveIntensity = 1, roughness, transparent, opacity } = {}) {
  const obj = source.clone(true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (map !== undefined) o.material.map = map;
    if (color !== undefined) o.material.color = new THREE.Color(color);
    if (emissive !== undefined) { o.material.emissive = new THREE.Color(emissive); o.material.emissiveIntensity = emissiveIntensity; }
    if (roughness !== undefined) o.material.roughness = roughness;
    if (transparent) { o.material.transparent = true; o.material.opacity = opacity; o.material.depthWrite = false; }
  });
  return obj;
}

// ---------------------------------------------------------------- world construction

const world = {
  layers: [],        // parallax layers: { factor, span, items: Object3D[] }
  obstacles: [],     // active obstacles { obj, type, box, kind }
  coins: [],         // active collectibles
  pools: new Map(),  // type -> inactive Object3D[]
  templates: {},     // type -> { make(), box, kind }
};

// Items scroll left at `factor` × run speed and jump ahead by `span` once they pass `minX`.
function addLayer(factor, span, items, minX = -span / 2) {
  const layer = { factor, span, items, minX };
  world.layers.push(layer);
  return layer;
}

function scrollLayers(dx) {
  for (const layer of world.layers) {
    const shift = dx * layer.factor;
    for (const item of layer.items) {
      item.position.x -= shift;
      if (item.position.x < layer.minX) {
        item.position.x += layer.span;
        if (item.userData.recycle) item.userData.recycle(item);
      }
    }
    if (layer.onScroll) layer.onScroll(shift);
  }
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function buildGround(m) {
  // Ground is 1×1×1 blocks (KayKit blocks are 2 units, scaled 0.5) in instanced segments.
  const SEG = 8;
  const SEGMENTS = 10;
  const blocks = {
    snow: firstMesh(m.snow), grass: firstMesh(m.grassSnow), dirt: firstMesh(m.dirtSnow),
  };
  const segments = [];
  const tmp = new THREE.Object3D();
  for (let s = 0; s < SEGMENTS; s++) {
    const seg = new THREE.Group();
    const cells = { snow: [], grass: [], dirt: [] };
    for (let i = 0; i < SEG; i++) {
      for (let z = -3; z <= 3; z++) {
        const type = Math.abs(z) <= 1 ? 'snow' : (Math.random() < 0.35 ? 'snow' : 'grass');
        cells[type].push([i, -0.5, z]);
      }
      // Front face depth so the strip does not look paper-thin.
      cells.dirt.push([i, -1.5, 3], [i, -2.5, 3]);
    }
    for (const [type, list] of Object.entries(cells)) {
      const src = blocks[type];
      const inst = new THREE.InstancedMesh(src.geometry, src.material, list.length);
      list.forEach(([x, y, z], k) => {
        tmp.position.set(x, y, z);
        tmp.scale.setScalar(0.5);
        tmp.updateMatrix();
        inst.setMatrixAt(k, tmp.matrix);
      });
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      seg.add(inst);
    }
    seg.position.x = -20 + s * SEG;
    scene.add(seg);
    segments.push(seg);
  }
  addLayer(1.0, SEG * SEGMENTS, segments, -20 - SEG);

  // Endless snow field behind/around the track (untextured, so it never needs to scroll).
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 300),
    new THREE.MeshStandardMaterial({ color: 0xe9f1ff, roughness: 0.95 }),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, -0.02, -150);
  field.receiveShadow = true;
  scene.add(field);
  const front = field.clone();
  front.position.set(0, -3, 150);
  scene.add(front);
}

function makePine() {
  // Low-poly pine: stacked cones with snow caps, sitting on the KayKit trunk colour.
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.8, 6), PINE_MATS.trunk);
  trunk.position.y = 0.4;
  g.add(trunk);
  const tiers = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < tiers; i++) {
    const r = 1.25 - i * 0.26;
    const y = 0.7 + i * 0.75;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.3, 7), PINE_MATS.leaf);
    cone.position.y = y + 0.65;
    cone.rotation.y = i * 0.6;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, 0.52, 7), PINE_MATS.snow);
    cap.position.y = y + 1.04;
    cap.rotation.y = i * 0.6;
    g.add(cone, cap);
  }
  return shadows(g, true, false);
}

const PINE_MATS = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9, flatShading: true }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x1e6b45, roughness: 0.85, flatShading: true }),
  snow: new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, flatShading: true }),
};

function buildMidLayer(m) {
  // Snowy pines (plus the odd KayKit snow-block tree) at 0.5× speed.
  const SPAN = 80;
  const items = [];
  const place = (tree) => {
    tree.scale.setScalar(rand(0.8, 1.5) * (tree.userData.blocky ? 0.6 : 1));
    tree.position.z = rand(-16, -5.5);
    tree.rotation.y = rand(0, Math.PI * 2);
  };
  for (let i = 0; i < 26; i++) {
    let tree;
    if (i % 6 === 5) {
      // KayKit block tree, lifted because the block model is centred on its origin.
      const block = shadows(m.tree.scene.clone(true), true, false);
      block.position.y = 1;
      tree = new THREE.Group().add(block);
      tree.userData.blocky = true;
    } else {
      tree = makePine();
    }
    place(tree);
    tree.position.x = -SPAN / 2 + 8 + (i / 26) * SPAN + rand(-1.5, 1.5);
    tree.userData.recycle = place;
    scene.add(tree);
    items.push(tree);
  }
  // Streetlights along the back edge of the track.
  for (let i = 0; i < 6; i++) {
    const lamp = m.streetlight.scene.clone(true);
    lamp.scale.setScalar(2.4);
    lamp.position.set(-SPAN / 2 + 8 + i * (SPAN / 6), 0, -4);
    lamp.rotation.y = Math.PI / 2;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd28a }),
    );
    bulb.position.set(-0.2, 0.9, 0);
    lamp.add(bulb);
    shadows(lamp, true, false);
    scene.add(lamp);
    items.push(lamp);
  }
  addLayer(0.5, SPAN, items, -34);
}

function buildFarLayer(m) {
  // Village, mountains and aurora at 0.2× speed.
  const SPAN = 140;
  const items = [];
  const buildings = ['buildingA', 'buildingB', 'buildingC', 'buildingD', 'buildingE'].map((k) => m[k].scene);
  const roofSnow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const placeHouse = (house) => {
    house.position.z = rand(-38, -26);
    house.rotation.y = pick([0, Math.PI / 2, -Math.PI / 2]) + rand(-0.15, 0.15);
  };
  for (let i = 0; i < 16; i++) {
    const house = new THREE.Group();
    const body = pick(buildings).clone(true);
    body.scale.setScalar(rand(2.4, 3.2));
    house.add(body);
    const box = new THREE.Box3().setFromObject(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(box.max.x - box.min.x + 0.2, 0.25, box.max.z - box.min.z + 0.2), roofSnow);
    cap.position.y = box.max.y + 0.1;
    house.add(cap);
    // Warm window glow.
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshBasicMaterial({ color: 0xffc66b }));
    win.position.set(rand(-0.4, 0.4), box.max.y * 0.45, box.max.z + 0.02);
    house.add(win);
    placeHouse(house);
    house.position.x = -SPAN / 2 + (i / 16) * SPAN + rand(-2, 2);
    house.userData.recycle = placeHouse;
    scene.add(house);
    items.push(house);
  }

  const mountainMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ff, roughness: 1, flatShading: true });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const MSPAN = 320;
  const mountains = [];
  for (let i = 0; i < 12; i++) {
    const h = rand(22, 46);
    const r = rand(20, 34);
    const mtn = new THREE.Group();
    const base = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 1), mountainMat);
    base.position.y = h / 2;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.32, h * 0.32, 7, 1), capMat);
    cap.position.y = h - h * 0.16 + 0.05;
    mtn.add(base, cap);
    mtn.position.set(-MSPAN / 2 + (i / 12) * MSPAN + rand(-8, 8), -1, rand(-130, -95));
    mtn.rotation.y = rand(0, Math.PI);
    scene.add(mtn);
    mountains.push(mtn);
  }
  addLayer(0.2, SPAN, items, -72);
  addLayer(0.2, MSPAN, mountains, -165);

  // Aurora: additive ribbon whose texture scrolls with the far layer.
  const aurora = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 70),
    new THREE.MeshBasicMaterial({ map: makeAuroraTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  aurora.position.set(20, 62, -170);
  scene.add(aurora);
  const auroraLayer = addLayer(0.2, 1, []);
  auroraLayer.onScroll = (shift) => { aurora.material.map.offset.x += shift / 600; };
  world.aurora = aurora;

  // Stars and moon.
  const starGeo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 700; i++) pts.push(rand(-260, 280), rand(25, 140), rand(-200, -175));
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: true, fog: false })));
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(7, 32), new THREE.MeshBasicMaterial({ color: 0xfff6dc, fog: false }));
  moonDisc.position.set(70, 85, -185);
  scene.add(moonDisc);
}

function makeAuroraTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  for (let x = 0; x < 512; x += 2) {
    const wave = Math.sin(x / 40) * 0.5 + Math.sin(x / 13 + 1) * 0.25 + 0.5;
    const top = 20 + wave * 30;
    const grad = g.createLinearGradient(0, top, 0, 128);
    const hue = 140 + Math.sin(x / 90) * 40;
    grad.addColorStop(0, `hsla(${hue + 120}, 80%, 65%, 0)`);
    grad.addColorStop(0.25, `hsla(${hue}, 90%, 60%, ${0.25 + wave * 0.25})`);
    grad.addColorStop(1, `hsla(${hue}, 90%, 50%, 0)`);
    g.fillStyle = grad;
    g.fillRect(x, top, 2, 128 - top);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSnowfall() {
  const COUNT = 1400;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = rand(-25, 55);
    pos[i * 3 + 1] = rand(0, 26);
    pos[i * 3 + 2] = rand(-25, 11);
    vel[i] = rand(1.2, 3.2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.22, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.9,
  }));
  scene.add(points);
  world.snow = { points, pos, vel, count: COUNT };
}

function updateSnow(dt, worldShift, t) {
  const { pos, vel, count, points } = world.snow;
  for (let i = 0; i < count; i++) {
    const k = i * 3;
    pos[k + 1] -= vel[i] * dt;
    pos[k] -= worldShift * 0.35 + Math.sin(t + i) * 0.3 * dt;
    if (pos[k + 1] < 0) pos[k + 1] += 26;
    if (pos[k] < -25) pos[k] += 80;
  }
  points.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- obstacles & collectibles

function makeStripeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#d7263d';
  for (let i = -64; i < 128; i += 22) {
    g.beginPath();
    g.moveTo(i, 0); g.lineTo(i + 11, 0); g.lineTo(i + 11 + 64, 64); g.lineTo(i + 64, 64);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hitboxOf(obj, shrink = 0.12) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const sx = (b.max.x - b.min.x) * shrink;
  return { minX: b.min.x + sx, maxX: b.max.x - sx, minY: Math.max(0, b.min.y), maxY: b.max.y - (b.max.y - b.min.y) * shrink * 0.6 };
}

function buildTemplates(m) {
  const T = world.templates;
  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.4, roughness: 0.35 });

  const makePresent = (color, scale = 5.2) => () => {
    const g = new THREE.Group();
    const box = tinted(m.box.scene, { map: null, color, roughness: 0.55 });
    box.scale.setScalar(scale);
    g.add(box);
    const b = new THREE.Box3().setFromObject(box);
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 1.02, 0.12), ribbonMat);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 1.02, w * 1.02), ribbonMat);
    r1.position.y = r2.position.y = h / 2;
    const bow = new THREE.Mesh(new THREE.TorusKnotGeometry(0.12, 0.05, 32, 6, 2, 3), ribbonMat);
    bow.position.y = h + 0.08;
    g.add(r1, r2, bow);
    return shadows(g);
  };
  const presentColors = { presentRed: 0xc8102e, presentGreen: 0x1f8a4c, presentBlue: 0x2b59c3 };
  for (const [name, color] of Object.entries(presentColors)) T[name] = { make: makePresent(color), kind: 'low' };

  T.presentPair = {
    kind: 'low',
    make: () => {
      const g = new THREE.Group();
      const a = makePresent(0xc8102e)();
      const b = makePresent(0x1f8a4c, 3.6)();
      a.position.x = -0.45;
      b.position.x = 0.55;
      b.rotation.y = 0.5;
      g.add(a, b);
      return g;
    },
  };

  T.logs = {
    kind: 'low',
    make: () => {
      const o = shadows(m.logs.scene.clone(true));
      o.scale.setScalar(0.62);
      o.rotation.y = Math.PI / 2;
      return o;
    },
  };

  T.coal = {
    kind: 'low',
    make: () => {
      const o = shadows(tinted(m.coal.scene, { color: 0x2a2a30, roughness: 0.6 }));
      o.scale.setScalar(1.35);
      return o;
    },
  };

  T.drift = {
    kind: 'low',
    make: () => {
      const g = new THREE.Group();
      const o = shadows(m.snow.scene.clone(true));
      o.scale.set(0.75, 0.38, 1.15);
      o.position.y = 0.38;
      g.add(o);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
      top.scale.set(1, 0.45, 1.4);
      top.position.y = 0.72;
      g.add(shadows(top));
      return g;
    },
  };

  T.snowman = {
    kind: 'low',
    make: () => {
      const g = new THREE.Group();
      const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.5 });
      const carrot = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
      const scarf = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.8 });
      const s1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), snowMat);
      s1.position.y = 0.45;
      const s2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), snowMat);
      s2.position.y = 1.0;
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), snowMat);
      head.position.y = 1.42;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 6), carrot);
      nose.rotation.z = Math.PI / 2;
      nose.position.set(-0.32, 1.42, 0);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), dark);
      brim.position.y = 1.62;
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.3, 12), dark);
      hat.position.y = 1.78;
      const sc = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.06, 6, 16), scarf);
      sc.rotation.x = Math.PI / 2;
      sc.position.y = 1.2;
      const eyes = [-0.08, 0.08].map((z) => {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), dark);
        e.position.set(-0.22, 1.5, z);
        return e;
      });
      g.add(s1, s2, head, nose, brim, hat, sc, ...eyes);
      return shadows(g);
    },
    // Snowman is tall but narrow; the hat can be cleared by a good jump.
    box: { minX: -0.4, maxX: 0.4, minY: 0, maxY: 1.45 },
  };

  T.icicleGate = {
    kind: 'high',
    make: () => {
      const g = new THREE.Group();
      const stripe = makeStripeTexture();
      const caneMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.4 });
      const iceMat = new THREE.MeshStandardMaterial({ color: 0xbfe9ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x2a6f9a, emissiveIntensity: 0.35 });
      for (const z of [-2.1, 2.1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.2, 12), caneMat);
        post.position.set(0, 2.1, z);
        g.add(post);
      }
      // Ice beam (KayKit glass block) with hanging icicles.
      const beam = tinted(m.ice.scene, { color: 0xcdeeff, transparent: true, opacity: 0.8 });
      beam.scale.set(0.42, 0.28, 2.25);
      beam.position.y = 1.92;
      g.add(beam);
      for (let i = 0; i < 11; i++) {
        const len = rand(0.35, 0.65);
        const ice = new THREE.Mesh(new THREE.ConeGeometry(rand(0.07, 0.12), len, 6), iceMat);
        ice.rotation.x = Math.PI;
        ice.position.set(rand(-0.25, 0.25), 1.64 - len / 2, -1.9 + i * 0.38);
        g.add(ice);
      }
      // Garland and a wreath on top make it read as a gate you must duck under.
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.4, 10), caneMat);
      top.rotation.x = Math.PI / 2;
      top.position.y = 4.15;
      const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.14, 8, 18), new THREE.MeshStandardMaterial({ color: 0x1f7a3c, roughness: 0.7 }));
      wreath.position.set(-0.05, 3.55, 0);
      wreath.rotation.y = Math.PI / 2;
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd7263d }));
      berry.position.set(-0.2, 3.15, 0);
      g.add(top, wreath, berry);
      return shadows(g);
    },
    // Lethal from the icicle tips upward: you can only get through by sliding.
    box: { minX: -0.35, maxX: 0.35, minY: 1.05, maxY: 50 },
  };

  T.coin = {
    kind: 'coin',
    make: () => {
      const o = tinted(m.gold.scene, { emissive: 0x6b4a00, emissiveIntensity: 0.6 });
      o.scale.setScalar(1.25);
      const pivot = new THREE.Group();
      o.position.y = -0.15;
      pivot.add(shadows(o, true, false));
      return pivot;
    },
    box: { minX: -0.45, maxX: 0.45, minY: -0.5, maxY: 0.6 },
  };

  for (const [type, t] of Object.entries(T)) {
    if (!t.box) t.box = hitboxOf(t.make());
    world.pools.set(type, []);
    t.type = type;
  }
}

function acquire(type) {
  const pool = world.pools.get(type);
  const obj = pool.pop() || world.templates[type].make();
  obj.visible = true;
  scene.add(obj);
  return obj;
}

function release(entry) {
  scene.remove(entry.obj);
  world.pools.get(entry.type).push(entry.obj);
}

const LOW_TYPES = ['presentRed', 'presentGreen', 'presentBlue', 'presentPair', 'logs', 'coal', 'drift', 'snowman'];

function spawnObstacle(x) {
  // The share of slide obstacles grows a little as the game speeds up.
  const highChance = Math.min(0.42, 0.25 + state.level * 0.02);
  const type = Math.random() < highChance ? 'icicleGate' : pick(LOW_TYPES);
  const obj = acquire(type);
  obj.position.set(x, 0, 0);
  obj.rotation.y = type === 'icicleGate' ? 0 : rand(-0.25, 0.25);
  const t = world.templates[type];
  world.obstacles.push({ obj, type, kind: t.kind, box: t.box });

  // Reward a jump with a gold bar arcing over some low obstacles.
  if (t.kind === 'low' && Math.random() < 0.35) spawnCoin(x, 2.6);
  if (t.kind === 'high' && Math.random() < 0.3) spawnCoin(x, 0.45);
}

function spawnCoin(x, y) {
  const obj = acquire('coin');
  obj.position.set(x, y, 0);
  world.coins.push({ obj, type: 'coin', box: world.templates.coin.box, baseY: y });
}

function spawnCoinRow(x, count) {
  for (let i = 0; i < count; i++) spawnCoin(x + i * 1.6, 0.7);
}

// ---------------------------------------------------------------- player

const player = {
  root: new THREE.Group(),
  model: null,
  mixer: null,
  actions: {},
  current: null,
  y: 0,
  vy: 0,
  onGround: true,
  slideTimer: 0,
  wantFastFall: false,
};

function buildPlayer(m) {
  const model = m.knight.scene;
  shadows(model, true, false);
  model.scale.setScalar(0.68);
  model.rotation.y = Math.PI / 2; // KayKit characters face +Z; the run goes toward +X
  player.root.add(model);
  scene.add(player.root);
  player.model = model;

  const mixer = new THREE.AnimationMixer(model);
  player.mixer = mixer;
  const clips = [...m.animBasic.animations, ...m.animGeneral.animations, ...m.animAdvanced.animations];
  const clip = (name) => {
    const c = clips.find((a) => a.name === name);
    if (!c) throw new Error(`Missing animation ${name}`);
    return c;
  };
  const make = (name, { once = false, speed = 1 } = {}) => {
    const a = mixer.clipAction(clip(name));
    a.timeScale = speed;
    if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    return a;
  };
  player.actions = {
    idle: make('Idle_A'),
    run: make('Running_A', { speed: 1.1 }),
    jumpStart: make('Jump_Start', { once: true, speed: 2.4 }),
    jumpAir: make('Jump_Idle'),
    slide: make('Crawling', { speed: 1.4 }),
    death: make('Death_A', { once: true }),
  };
  mixer.addEventListener('finished', (e) => {
    if (e.action === player.actions.jumpStart && !player.onGround) playAction('jumpAir', 0.1);
  });
}

function playAction(name, fade = 0.15) {
  const next = player.actions[name];
  if (player.current === next) return;
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (player.current) player.current.fadeOut(fade);
  player.current = next;
}

function resetPlayer() {
  player.y = 0;
  player.vy = 0;
  player.onGround = true;
  player.slideTimer = 0;
  player.wantFastFall = false;
  player.root.position.set(0, 0, 0);
  player.model.position.set(0, 0, 0);
  player.model.rotation.set(0, Math.PI / 2, 0);
}

function jump() {
  if (state.mode !== 'playing') return;
  if (!player.onGround) return;
  player.slideTimer = 0;
  player.vy = CFG.jumpVelocity;
  player.onGround = false;
  playAction('jumpStart', 0.05);
  sfx.jump();
}

function slide() {
  if (state.mode !== 'playing') return;
  if (!player.onGround) { player.wantFastFall = true; return; }
  if (player.slideTimer <= 0) sfx.slide();
  player.slideTimer = CFG.slideTime;
  playAction('slide', 0.08);
}

function updatePlayer(dt) {
  if (!player.onGround) {
    const g = CFG.gravity + (player.wantFastFall ? CFG.fastFall : 0);
    player.vy += g * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.onGround = true;
      if (player.wantFastFall) {
        player.wantFastFall = false;
        player.slideTimer = CFG.slideTime;
        sfx.slide();
        playAction('slide', 0.08);
      } else {
        playAction('run', 0.12);
      }
    }
  } else if (player.slideTimer > 0) {
    player.slideTimer -= dt;
    if (player.slideTimer <= 0) playAction('run', 0.15);
  }
  player.root.position.y = player.y;
  // Lean forward while sliding so the crawl reads as a belly-slide.
  const targetTilt = player.slideTimer > 0 ? -0.18 : 0;
  player.model.rotation.z += (targetTilt - player.model.rotation.z) * Math.min(1, dt * 12);
}

function playerBox() {
  const h = player.slideTimer > 0 ? CFG.slideHeight : CFG.standHeight;
  return { minX: -CFG.halfWidth, maxX: CFG.halfWidth, minY: player.y + 0.05, maxY: player.y + h };
}

function overlaps(p, e) {
  const x = e.obj.position.x;
  const y = e.obj.position.y;
  return p.maxX > x + e.box.minX && p.minX < x + e.box.maxX && p.maxY > y + e.box.minY && p.minY < y + e.box.maxY;
}

// ---------------------------------------------------------------- game state

const sfx = new Sfx();
const state = {
  mode: 'loading',  // loading | menu | playing | paused | over
  distance: 0,
  bonus: 0,
  score: 0,
  level: 0,
  speed: CFG.baseSpeed,
  nextSpawnAt: 0,
  best: 0,
  shake: 0,
  deathTimer: 0,
  pendingScore: null,
  time: 0,
};

try { state.best = Number(localStorage.getItem('runner-best')) || 0; } catch { /* storage unavailable */ }

function setOverlay(id) {
  for (const el of document.querySelectorAll('.overlay')) el.hidden = el.id !== id;
}

function resetRun() {
  for (const e of world.obstacles) release(e);
  for (const e of world.coins) release(e);
  world.obstacles.length = 0;
  world.coins.length = 0;
  Object.assign(state, { distance: 0, bonus: 0, score: 0, level: 0, speed: CFG.baseSpeed, nextSpawnAt: 22, shake: 0, deathTimer: 0 });
  resetPlayer();
  updateHud();
}

function startGame() {
  if (document.body.classList.contains('modal-open')) return;
  sfx.unlock();
  resetRun();
  state.mode = 'playing';
  setOverlay(null);
  playAction('run', 0.2);
  sfx.startMusic();
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  setOverlay('pause-screen');
  sfx.stopMusic();
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  setOverlay(null);
  sfx.startMusic();
}

function toMenu() {
  resetRun();
  state.mode = 'menu';
  setOverlay('menu-screen');
  playAction('idle', 0.2);
  sfx.stopMusic();
}

function gameOver() {
  state.mode = 'dying';
  state.deathTimer = 1.1;
  state.shake = 0.45;
  player.slideTimer = 0;
  player.model.rotation.z = 0;
  playAction('death', 0.08);
  sfx.crash();
  sfx.stopMusic();
}

async function showGameOver() {
  state.mode = 'over';
  const score = state.score;
  if (score > state.best) {
    state.best = score;
    try { localStorage.setItem('runner-best', String(score)); } catch { /* ignore */ }
  }
  $('#final-score').textContent = score.toLocaleString();
  $('#final-best').textContent = '–';
  $('#over-title').textContent = pick(['Game Over', 'Oh, Fudge!', 'Snowed Under!', 'Ho-Ho-Oops!']);
  setOverlay('over-screen');
  updateHud();

  const status = $('#save-status');
  status.className = 'save-status';
  $('#save-login-btn').hidden = true;
  if (auth.user && score > 0) {
    status.textContent = 'Saving your score…';
    await submitScore(score);
  } else if (score > 0) {
    state.pendingScore = score;
    $('#final-best').textContent = state.best.toLocaleString();
    status.textContent = 'Sign in to put this run on the leaderboard.';
    $('#save-login-btn').hidden = false;
  } else {
    status.textContent = '';
  }
  await loadInto($('#over-board'), auth.user?.username);
}

async function submitScore(score) {
  const status = $('#save-status');
  try {
    const res = await auth.submitScore(score);
    state.pendingScore = null;
    $('#final-best').textContent = res.personalBest.toLocaleString();
    status.textContent = score >= res.personalBest ? '🎉 New personal best — saved!' : 'Score saved to the leaderboard.';
    status.className = 'save-status good';
    if (res.personalBest > state.best) state.best = res.personalBest;
    updateHud();
  } catch (err) {
    status.textContent = err.status === 401 ? 'Your session expired — sign in to save.' : 'Could not save score. Check your connection.';
    status.className = 'save-status bad';
    if (err.status === 401) { state.pendingScore = score; $('#save-login-btn').hidden = false; }
  }
}

// ---------------------------------------------------------------- HUD

const hud = { score: $('#hud-score'), best: $('#hud-best'), speed: $('#hud-speed') };
let toastTimer = null;

function updateHud() {
  hud.score.textContent = state.score.toLocaleString();
  hud.best.textContent = Math.max(state.best, state.score).toLocaleString();
  hud.speed.textContent = `×${(state.speed / CFG.baseSpeed).toFixed(2)}`;
}

function toast(text) {
  const el = $('#level-toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1100);
}

// ---------------------------------------------------------------- main loop

const clock = new THREE.Clock();

function step(dt) {
  state.time += dt;
  let shift = 0;

  if (state.mode === 'playing') {
    shift = state.speed * dt;
    state.distance += shift;

    // Spawning: gaps scale with speed so reaction time stays roughly constant.
    if (state.distance >= state.nextSpawnAt) {
      spawnObstacle(CFG.spawnX);
      const minGap = Math.max(10, state.speed * 1.05);
      const gap = rand(minGap, minGap * 1.8);
      if (gap > minGap * 1.45 && Math.random() < 0.5) spawnCoinRow(CFG.spawnX + gap * 0.35, 3);
      state.nextSpawnAt = state.distance + gap;
    }

    for (const e of world.obstacles) e.obj.position.x -= shift;
    for (const c of world.coins) {
      c.obj.position.x -= shift;
      c.obj.rotation.y += dt * 3;
      c.obj.position.y = c.baseY + Math.sin(state.time * 4 + c.obj.position.x) * 0.08;
    }
    cull(world.obstacles);
    cull(world.coins);

    updatePlayer(dt);
    const pb = playerBox();
    for (let i = world.coins.length - 1; i >= 0; i--) {
      if (overlaps(pb, world.coins[i])) {
        release(world.coins[i]);
        world.coins.splice(i, 1);
        state.bonus += CFG.coinValue;
        sfx.pickup();
      }
    }
    for (const e of world.obstacles) {
      if (overlaps(pb, e)) { gameOver(); break; }
    }

    state.score = Math.floor(state.distance) + state.bonus;
    const level = Math.floor(state.score / CFG.speedEvery);
    if (level > state.level) {
      state.level = level;
      sfx.levelUp();
      toast(`Faster! ×${Math.pow(CFG.speedStep, level).toFixed(2)}`);
    }
    // Ease toward the target speed so level-ups don't jolt.
    const target = CFG.baseSpeed * Math.pow(CFG.speedStep, state.level);
    state.speed += (target - state.speed) * Math.min(1, dt * 2);
    updateHud();
  } else if (state.mode === 'dying') {
    state.deathTimer -= dt;
    // Fall back to the ground if the crash happened mid-air.
    if (player.y > 0) {
      player.vy += CFG.gravity * dt;
      player.y = Math.max(0, player.y + player.vy * dt);
      player.root.position.y = player.y;
    }
    if (state.deathTimer <= 0) showGameOver();
  } else if (state.mode === 'menu') {
    // Gentle drift on the title screen.
    shift = 2.5 * dt;
  }

  if (shift) scrollLayers(shift);
  updateSnow(dt, shift, state.time);
  player.mixer?.update(dt);

  // Camera follows jumps a little and shakes on impact.
  const camY = CAM_BASE.y + player.y * 0.35;
  camera.position.x = CAM_BASE.x;
  camera.position.y += (camY - camera.position.y) * Math.min(1, dt * 5);
  camera.position.z = CAM_BASE.z;
  if (state.shake > 0) {
    state.shake = Math.max(0, state.shake - dt);
    const s = state.shake * 0.5;
    camera.position.x += rand(-s, s);
    camera.position.y += rand(-s, s);
  }
  camera.lookAt(CAM_LOOK.x, CAM_LOOK.y + player.y * 0.25, CAM_LOOK.z);
  glow.position.y = 2.5 + player.y;
  if (world.aurora) world.aurora.material.opacity = 0.75 + Math.sin(state.time * 0.7) * 0.25;
}

function cull(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].obj.position.x < CFG.despawnX) {
      release(list[i]);
      list.splice(i, 1);
    }
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (state.mode !== 'paused' && state.mode !== 'loading') step(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- input

function isTyping(e) {
  return document.body.classList.contains('modal-open') || ['INPUT', 'TEXTAREA'].includes(e.target?.tagName);
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  const k = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
  if (k === 'KeyM') { toggleMute(); return; }
  if (e.repeat && k !== 'ArrowDown' && k !== 'KeyS') return;

  if (state.mode === 'menu' || state.mode === 'over') {
    if (k === 'Space' || k === 'Enter') startGame();
    return;
  }
  if (state.mode === 'paused') {
    if (k === 'KeyP' || k === 'Escape' || k === 'Space') resumeGame();
    return;
  }
  if (state.mode !== 'playing') return;
  if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') jump();
  else if (k === 'ArrowDown' || k === 'KeyS') slide();
  else if (k === 'KeyP' || k === 'Escape') pauseGame();
});

let touchStart = null;
renderer.domElement.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
}, { passive: true });
renderer.domElement.addEventListener('touchend', (e) => {
  if (!touchStart || state.mode !== 'playing') return;
  const t = e.changedTouches[0];
  const dy = t.clientY - touchStart.y;
  const dx = t.clientX - touchStart.x;
  touchStart = null;
  if (dy > 30 && Math.abs(dy) > Math.abs(dx)) slide();
  else jump();
}, { passive: true });

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  // Narrow (portrait) screens: widen the view and slide it so the runner sits at the left edge
  // with as much of the track ahead visible as possible.
  const portrait = camera.aspect < 1;
  camera.fov = portrait ? 62 : 48;
  CAM_BASE.set(portrait ? 2.4 : 4, portrait ? 4.6 : 3.9, portrait ? 14 : 11);
  CAM_LOOK.set(portrait ? 3.0 : 6.5, 1.5, 0);
  camera.position.copy(CAM_BASE);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.dispatchEvent(new Event('resize'));

function toggleMute() {
  const muted = sfx.toggleMute();
  $('#mute-btn').classList.toggle('muted', muted);
  $('#mute-btn').textContent = muted ? '🔕' : '🔔';
}

// ---------------------------------------------------------------- UI wiring

function wireUi() {
  initAuthUI();
  $('#play-btn').addEventListener('click', startGame);
  $('#again-btn').addEventListener('click', startGame);
  $('#resume-btn').addEventListener('click', resumeGame);
  $('#quit-btn').addEventListener('click', toMenu);
  $('#pause-btn').addEventListener('click', () => (state.mode === 'paused' ? resumeGame() : pauseGame()));
  $('#mute-btn').addEventListener('click', () => { sfx.unlock(); toggleMute(); });
  if (sfx.muted) { $('#mute-btn').classList.add('muted'); $('#mute-btn').textContent = '🔕'; }

  $('#menu-board-btn').addEventListener('click', () => {
    setOverlay('board-screen');
    loadInto($('#menu-board'), auth.user?.username);
  });
  $('#board-close-btn').addEventListener('click', () => setOverlay('menu-screen'));

  $('#save-login-btn').addEventListener('click', () => openAuthModal('login'));

  auth.onChange(async (user) => {
    $('#menu-auth-hint').textContent = user
      ? `Signed in as ${user.username} — your scores will be saved.`
      : 'Sign in to save your scores to the leaderboard.';
    // A guest who signs in from the game-over screen keeps the run they just finished.
    if (user && state.mode === 'over' && state.pendingScore) {
      $('#save-login-btn').hidden = true;
      $('#save-status').textContent = 'Saving your score…';
      await submitScore(state.pendingScore);
      await loadInto($('#over-board'), user.username);
    } else if (state.mode === 'over') {
      loadInto($('#over-board'), user?.username);
    }
    if (!user) state.pendingScore = null;
  });
}

// ---------------------------------------------------------------- boot

async function boot() {
  wireUi();
  auth.refresh();
  try {
    const models = await loadModels();
    buildGround(models);
    buildMidLayer(models);
    buildFarLayer(models);
    buildSnowfall();
    buildTemplates(models);
    buildPlayer(models);
  } catch (err) {
    console.error(err);
    $('#loading-screen .muted').textContent = 'Could not load the game assets. Please refresh.';
    return;
  }
  resetRun();
  toMenu();
  renderer.setAnimationLoop(frame);
}

boot();

// Exposed for automated smoke tests and debugging in the console.
window.__runner = { state, player, world, startGame, jump, slide, step, CFG };
