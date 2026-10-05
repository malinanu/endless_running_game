// Christmas Runner — behind-the-runner Three.js endless runner.
// Models: KayKit (CC0). Effects: Brackeys VFX bundle (CC0).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { auth, initAuthUI, openAuthModal } from './auth.js';
import { loadInto } from './leaderboard.js';
import { Sfx } from './audio.js';
import { Vfx, loadVfxTextures } from './vfx.js';
import { Track, makeSkyTexture, shadows } from './world.js';
import { RoadPlan, bendObject, bendMaterial, offsetAhead } from './curve.js';

// ---------------------------------------------------------------- tuning

const CFG = {
  baseSpeed: 12,          // world units / second
  speedStep: 1.05,        // ×5% ...
  speedEvery: 200,        // ... every 200 points
  lanes: [-1.8, 0, 1.8],
  laneRate: 16,           // how quickly the runner eases into a lane
  gravity: -34,
  jumpVelocity: 12.5,     // apex ≈ 2.3 units, air time ≈ 0.74 s
  fastFall: -60,          // extra gravity when ↓ is pressed mid-air
  slideTime: 0.75,
  standHeight: 1.7,
  slideHeight: 0.75,
  halfWidth: 0.32,
  halfDepth: 0.3,
  spawnZ: -78,
  despawnZ: 9,
  peanutValue: 10,
  snowballSpeed: 7,       // extra closing speed of rolling snowballs
};

const ASSET = '/assets';
const $ = (sel) => document.querySelector(sel);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const params = new URLSearchParams(location.search);
// Mobile-first: phones are the main target, so they get lighter defaults.
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------------------------------------------------------------- renderer / scene

const container = $('#game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
container.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = makeSkyTexture();
scene.fog = new THREE.Fog(0xc4cbe0, 26, 105);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
const CAM = { y: 4.4, z: 7.8, lookY: 1.2, lookZ: -10, fov: 60 };
camera.position.set(0, CAM.y, CAM.z);
camera.lookAt(0, CAM.lookY, CAM.lookZ);

// Cool fill everywhere, warm golden key light from the far end of the path (back-lit look).
scene.add(new THREE.HemisphereLight(0xcfdcff, 0xf4f1ee, 1.35));
const sun = new THREE.DirectionalLight(0xffd59a, 2.6);
sun.position.set(-7, 14, -26);
sun.target.position.set(0, 0, -6);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(IS_TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 22, bottom: -22, near: 1, far: 70 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xaec4ff, 0.7);
fill.position.set(4, 8, 12);
scene.add(fill);
const heroGlow = new THREE.PointLight(0xffc27a, 5, 7, 1.6);
heroGlow.position.set(0, 2.4, 1.6);
scene.add(heroGlow);

// Post-processing: soft bloom on lights, peanuts and effects.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.55, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let useBloom = !params.has('lowfx');

// ---------------------------------------------------------------- loading

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => { $('#load-bar').style.width = `${(loaded / total) * 100}%`; };
const loader = new GLTFLoader(manager);
const texLoader = new THREE.TextureLoader(manager);

const MODELS = {
  hero: 'player/Rogue.glb',
  animBasic: 'player/Rig_Medium_MovementBasic.glb',
  animGeneral: 'player/Rig_Medium_General.glb',
  animAdvanced: 'player/Rig_Medium_MovementAdvanced.glb',
  snow: 'environment/snow.gltf',
  ice: 'environment/glass.gltf',
  box: 'obstacles/box_A.gltf',
  logs: 'obstacles/Wood_Log_Stack.gltf',
  coal: 'obstacles/Stone_Chunks_Small.gltf',
  plankA: 'obstacles/Wood_Plank_A.gltf',
  plankB: 'obstacles/Wood_Plank_B.gltf',
  plankC: 'obstacles/Wood_Plank_C.gltf',
  logA: 'obstacles/Wood_Log_A.gltf',
};

async function loadModels() {
  const entries = await Promise.all(
    Object.entries(MODELS).map(async ([key, path]) => [key, await loader.loadAsync(`${ASSET}/${path}`)]),
  );
  return Object.fromEntries(entries);
}

async function loadHeroTexture(name) {
  const tex = await texLoader.loadAsync(`${ASSET}/player/${name}`);
  tex.flipY = false; // glTF UV convention
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Optional brand logo supplied by the game owner (not shipped in the repo). */
async function loadBrandLogo() {
  try {
    const { logo: url } = await (await fetch('/api/brand')).json();
    if (!url) return null;
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const img of document.querySelectorAll('.brand-logo')) { img.src = url; img.hidden = false; }
    return tex;
  } catch {
    return null;
  }
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

// ---------------------------------------------------------------- world state

const world = {
  track: null,
  vfx: null,
  tex: null,
  obstacles: [],     // active obstacles { obj, type, box, kind }
  peanuts: [],       // active collectibles
  pools: new Map(),  // type -> inactive Object3D[]
  templates: {},     // type -> { make(), box, kind }
  snow: null,
};

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

function makePeanutTexture() {
  // Ridged, dimpled shell pattern.
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#dca563';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = 'rgba(140,90,40,0.55)';
  g.lineWidth = 3;
  for (let x = 0; x < 128; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  g.strokeStyle = 'rgba(150,100,50,0.35)';
  g.lineWidth = 2;
  for (let y = 0; y < 256; y += 18) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y + 6); g.stroke(); }
  for (let i = 0; i < 160; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,225,170,0.35)' : 'rgba(120,75,30,0.2)';
    g.fillRect(Math.random() * 128, Math.random() * 256, 3, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePeanutGeometry() {
  // Two lobes with a pinched waist, like a peanut in its shell.
  const pts = [];
  const lobe = (y, c, r) => Math.sqrt(Math.max(0, r * r - (y - c) * (y - c)));
  for (let i = 0; i <= 32; i++) {
    const y = -0.5 + i / 32;
    const r = Math.max(lobe(y, -0.22, 0.28), lobe(y, 0.24, 0.26), y > -0.45 && y < 0.47 ? 0.17 : 0);
    pts.push(new THREE.Vector2(Math.max(0.001, r * 0.95), y));
  }
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.computeVertexNormals();
  return geo;
}

function hitboxOf(obj, shrink = 0.12) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const sx = (b.max.x - b.min.x) * shrink;
  const sz = (b.max.z - b.min.z) * shrink;
  return {
    minX: b.min.x + sx, maxX: b.max.x - sx,
    minY: Math.max(0, b.min.y), maxY: b.max.y - (b.max.y - b.min.y) * shrink * 0.6,
    minZ: b.min.z + sz, maxZ: b.max.z - sz,
  };
}

function buildTemplates(m, tex) {
  const T = world.templates;
  const ribbonMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.4, roughness: 0.35, emissive: 0x3a2a00 });
  const stripe = makeStripeTexture();
  const caneMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.4 });
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xc8eeff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.88, emissive: 0x3b8fc0, emissiveIntensity: 0.55 });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });

  const makePresent = (color, scale = 5.6) => () => {
    const g = new THREE.Group();
    const box = tinted(m.box.scene, { map: null, color, roughness: 0.5 });
    box.scale.setScalar(scale);
    g.add(box);
    const b = new THREE.Box3().setFromObject(box);
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 1.02, 0.12), ribbonMat);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 1.02, w * 1.02), ribbonMat);
    r1.position.y = r2.position.y = h / 2;
    const bow = new THREE.Mesh(new THREE.TorusKnotGeometry(0.13, 0.05, 32, 6, 2, 3), ribbonMat);
    bow.position.y = h + 0.08;
    const snowTop = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.06, w * 0.9), snowMat);
    snowTop.position.y = h + 0.02;
    g.add(r1, r2, bow, snowTop);
    return shadows(g);
  };
  const presentColors = { presentRed: 0xc8102e, presentGreen: 0x1f8a4c, presentBlue: 0x2b59c3 };
  for (const [name, color] of Object.entries(presentColors)) T[name] = { make: makePresent(color), kind: 'low' };

  T.presentPile = {
    kind: 'low',
    make: () => {
      const g = new THREE.Group();
      const a = makePresent(0xc8102e, 4.6)();
      const b = makePresent(0x1f8a4c, 3.4)();
      const c = makePresent(0xf2c14e, 3)();
      a.position.set(-0.25, 0, 0.1);
      b.position.set(0.42, 0, -0.15);
      b.rotation.y = 0.5;
      c.position.set(0.1, 0, 0.45);
      c.rotation.y = -0.4;
      g.add(a, b, c);
      return g;
    },
  };

  T.logs = {
    kind: 'low',
    make: () => {
      const o = shadows(m.logs.scene.clone(true));
      o.scale.setScalar(0.66);
      return o;
    },
  };

  T.coal = {
    kind: 'low',
    make: () => {
      const o = shadows(tinted(m.coal.scene, { color: 0x2a2a30, roughness: 0.6 }));
      o.scale.setScalar(1.3);
      return o;
    },
  };

  T.drift = {
    kind: 'low',
    make: () => {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), snowMat);
      top.scale.set(0.95, 0.95, 0.75);
      g.add(shadows(top));
      return g;
    },
  };

  T.snowman = {
    kind: 'low',
    make: () => {
      const g = new THREE.Group();
      const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.5 });
      const carrot = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
      const scarf = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.8 });
      const s1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), snowMat);
      s1.position.y = 0.45;
      const s2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 2), snowMat);
      s2.position.y = 1.0;
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 2), snowMat);
      head.position.y = 1.42;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 6), carrot);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 1.42, 0.32);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), dark);
      brim.position.y = 1.62;
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.3, 12), dark);
      hat.position.y = 1.78;
      const sc = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.06, 6, 16), scarf);
      sc.rotation.x = Math.PI / 2;
      sc.position.y = 1.2;
      const eyes = [-0.08, 0.08].map((x) => {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), dark);
        e.position.set(x, 1.5, 0.22);
        return e;
      });
      g.add(s1, s2, head, nose, brim, hat, sc, ...eyes);
      return shadows(g);
    },
    box: { minX: -0.4, maxX: 0.4, minY: 0, maxY: 1.45, minZ: -0.4, maxZ: 0.4 },
  };

  // Lane-wide gate: slide under the icicles.
  const makeGate = (half, bulbs) => () => {
    const g = new THREE.Group();
    for (const x of [-half, half]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.6, 12), caneMat);
      post.position.set(x, 1.8, 0);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.12, 8, 16, Math.PI), caneMat);
      hook.position.set(x + (x < 0 ? 0.25 : -0.25), 3.6, 0);
      g.add(post, hook);
    }
    const beam = tinted(m.ice.scene, { color: 0xd5f2ff, transparent: true, opacity: 0.85 });
    beam.scale.set(half + 0.1, 0.24, 0.32);
    beam.position.y = 1.86;
    g.add(beam);
    const count = Math.round(half * 7);
    for (let i = 0; i < count; i++) {
      const len = rand(0.32, 0.62);
      const ice = new THREE.Mesh(new THREE.ConeGeometry(rand(0.06, 0.11), len, 6), iceMat);
      ice.rotation.x = Math.PI;
      ice.position.set(-half + 0.15 + (i / (count - 1)) * (half * 2 - 0.3), 1.62 - len / 2, rand(-0.12, 0.12));
      g.add(ice);
    }
    // Garland with twinkly bulbs across the top.
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-half, 3.3, 0), new THREE.Vector3(0, 2.85, 0), new THREE.Vector3(half, 3.3, 0)]);
    const garland = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.11, 6), new THREE.MeshStandardMaterial({ color: 0x1f7a3c, roughness: 0.8 }));
    g.add(garland);
    if (bulbs) {
      const colors = [0xff4d4d, 0xffd24d, 0x4dff88, 0x4dc3ff];
      for (let i = 0; i <= 8; i++) {
        const p = curve.getPoint(i / 8);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: colors[i % 4] }));
        b.position.copy(p).add(new THREE.Vector3(0, -0.12, 0.05));
        g.add(b);
      }
    }
    return shadows(g);
  };
  T.icicleGate = { kind: 'high', make: makeGate(0.85, true), box: { minX: -0.85, maxX: 0.85, minY: 1.05, maxY: 50, minZ: -0.3, maxZ: 0.3 } };
  T.garlandArch = { kind: 'high', wide: true, make: makeGate(3.0, true), box: { minX: -3, maxX: 3, minY: 1.05, maxY: 50, minZ: -0.3, maxZ: 0.3 } };

  // Fallen log across all three lanes: jump it.
  T.fallenLog = {
    kind: 'low',
    wide: true,
    make: () => {
      const g = new THREE.Group();
      const log = shadows(m.logA.scene.clone(true));
      log.rotation.y = Math.PI / 2;
      log.scale.set(1.25, 1.25, 4.9);
      log.position.y = 0.35;
      const snow = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 6.2, 10, 1, false, -Math.PI / 2, Math.PI), snowMat);
      snow.rotation.z = Math.PI / 2;
      snow.position.y = 0.76;
      g.add(log, shadows(snow));
      return g;
    },
  };

  // Giant rolling snowball: travels toward the runner faster than the world scrolls.
  T.snowball = {
    kind: 'low',
    rolling: true,
    make: () => {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.88, 2), new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, flatShading: true }));
      ball.position.y = 0.88;
      // A few sticks and pebbles caught in the snow make the roll readable.
      const bits = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), bits);
        const a = (i / 6) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.8, Math.sin(a) * 0.8, rand(-0.4, 0.4));
        b.rotation.set(rand(0, 3), rand(0, 3), 0);
        ball.add(b);
      }
      g.add(shadows(ball));
      g.userData.ball = ball;
      return g;
    },
    box: { minX: -0.72, maxX: 0.72, minY: 0, maxY: 1.6, minZ: -0.7, maxZ: 0.7 },
  };

  // Peanut collectible with a soft golden glow.
  const peanutGeo = makePeanutGeometry();
  const peanutMat = new THREE.MeshStandardMaterial({ map: makePeanutTexture(), roughness: 0.75, emissive: 0x5a3208, emissiveIntensity: 0.35 });
  T.peanut = {
    kind: 'peanut',
    make: () => {
      const g = new THREE.Group();
      const nut = new THREE.Mesh(peanutGeo, peanutMat);
      nut.scale.setScalar(0.85);
      nut.rotation.z = 0.25;
      nut.castShadow = true;
      g.add(nut);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.spotlight_01, color: 0xffb347, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }));
      glow.scale.set(1.5, 1.5, 1);
      g.add(glow);
      g.userData.nut = nut;
      return g;
    },
    box: { minX: -0.5, maxX: 0.5, minY: -0.55, maxY: 0.55, minZ: -0.45, maxZ: 0.45 },
  };

  for (const [type, t] of Object.entries(T)) {
    if (!t.box) t.box = hitboxOf(t.make());
    world.pools.set(type, []);
    t.type = type;
  }
}

function acquire(type) {
  const pool = world.pools.get(type);
  const obj = pool.pop() || bendObject(world.templates[type].make());
  obj.visible = true;
  scene.add(obj);
  return obj;
}

function release(entry) {
  scene.remove(entry.obj);
  world.pools.get(entry.type).push(entry.obj);
}

const LOW_TYPES = ['presentRed', 'presentGreen', 'presentBlue', 'presentPile', 'logs', 'coal', 'drift', 'snowman'];

function spawnObstacle(type, x, z) {
  const obj = acquire(type);
  obj.position.set(x, 0, z);
  const t = world.templates[type];
  world.obstacles.push({ obj, type, kind: t.kind, box: t.box, vz: t.rolling ? CFG.snowballSpeed : 0 });
  return t;
}

function spawnPeanut(x, y, z) {
  const obj = acquire('peanut');
  obj.position.set(x, y, z);
  world.peanuts.push({ obj, type: 'peanut', box: world.templates.peanut.box, baseY: y });
}

function peanutLine(lane, z, count) {
  for (let i = 0; i < count; i++) spawnPeanut(CFG.lanes[lane], 0.75, z - i * 1.6);
}

function peanutArc(lane, z) {
  // Over a low obstacle: follows the jump curve.
  for (let i = -2; i <= 2; i++) spawnPeanut(CFG.lanes[lane], 0.8 + 1.7 * Math.cos((i / 2.6) * (Math.PI / 2)), z - i * 1.1);
}

/**
 * One "row" of content at depth z. `mustFree` lists lanes that were open in the row just
 * before; at least one of them stays open so back-to-back rows are always survivable.
 * Returns the lanes left open.
 */
function spawnRow(z, mustFree = [0, 1, 2]) {
  const lvl = state.level;
  const r = Math.random();
  const wideChance = Math.min(0.22, 0.1 + lvl * 0.012);
  if (r < wideChance) {
    const type = Math.random() < 0.5 ? 'fallenLog' : 'garlandArch';
    spawnObstacle(type, 0, z);
    const lane = Math.floor(Math.random() * 3);
    if (type === 'fallenLog') peanutArc(lane, z);
    else peanutLine(lane, z + 1.6, 3);
    return [0, 1, 2];
  }
  const open = pick(mustFree);
  const others = [0, 1, 2].filter((l) => l !== open).sort(() => Math.random() - 0.5);
  const blocked = Math.random() < Math.min(0.75, 0.45 + lvl * 0.04) ? 2 : 1;
  for (let i = 0; i < blocked; i++) {
    const lane = others[i];
    const high = Math.random() < Math.min(0.42, 0.24 + lvl * 0.02);
    const t = spawnObstacle(high ? 'icicleGate' : pick(LOW_TYPES), CFG.lanes[lane], z);
    if (t.kind === 'low' && Math.random() < 0.3) peanutArc(lane, z);
  }
  if (Math.random() < 0.7) peanutLine(open, z + 2, Math.floor(rand(5, 8)));
  return [open, ...others.slice(blocked)];
}

/** Picks what comes next: a normal row, a quick double row, or a rolling snowball. */
function spawnNext() {
  const lvl = state.level;
  const minGap = Math.max(11, state.speed * 1.0);
  let gap = rand(minGap, minGap * 1.5);
  if (lvl >= 2 && Math.random() < Math.min(0.3, 0.08 + lvl * 0.02)) {
    // Snowball rolls down an open lane; give it room because it closes in faster.
    const lane = pick(state.lastFree);
    spawnObstacle('snowball', CFG.lanes[lane], CFG.spawnZ);
    state.lastFree = [0, 1, 2].filter((l) => l !== lane);
    gap += (-CFG.spawnZ * CFG.snowballSpeed) / (state.speed + CFG.snowballSpeed); // ground it gains on the world
  } else {
    state.lastFree = spawnRow(CFG.spawnZ, state.lastFree);
    if (lvl >= 1 && Math.random() < Math.min(0.4, 0.12 + lvl * 0.03)) {
      // Back-to-back row: a quick second decision right after the first.
      const z2 = CFG.spawnZ - Math.max(7, state.speed * 0.62);
      state.lastFree = spawnRow(z2, state.lastFree);
      gap += CFG.spawnZ - z2; // the second row sits this much further away
    }
  }
  state.nextSpawnAt = state.distance + gap;
}

// ---------------------------------------------------------------- player

const player = {
  root: new THREE.Group(),
  model: null,
  mixer: null,
  actions: {},
  current: null,
  lane: 1,
  x: 0,
  y: 0,
  vy: 0,
  onGround: true,
  slideTimer: 0,
  wantFastFall: false,
};

function buildPlayer(m, bodyTex, legsTex, logoTex) {
  const model = m.hero.scene;
  // Recolour: red sweater with mustard trim, green trousers (pre-baked palette swaps).
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.includes('Cape')) { o.visible = false; return; }
    if (/Body|Arm/.test(o.name)) { o.material = o.material.clone(); o.material.map = bodyTex; }
    else if (/Leg/.test(o.name)) { o.material = o.material.clone(); o.material.map = legsTex; }
  });
  shadows(model, true, false);
  addCap(model, logoTex);
  model.scale.setScalar(0.66);
  model.rotation.y = Math.PI; // KayKit characters face +Z; the run goes toward −Z
  player.root.add(model);
  bendObject(model);
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
    run: make('Running_A', { speed: 1.15 }),
    jumpStart: make('Jump_Start', { once: true, speed: 2.4 }),
    jumpAir: make('Jump_Idle'),
    slide: make('Crawling', { speed: 1.4 }),
    death: make('Death_A', { once: true }),
  };
  mixer.addEventListener('finished', (e) => {
    if (e.action === player.actions.jumpStart && !player.onGround) playAction('jumpAir', 0.1);
  });
}

/** Blue baseball cap on the head bone, with the brand logo on the back when supplied. */
function addCap(model, logoTex) {
  const head = model.getObjectByName('head');
  let headMesh = null;
  model.traverse((o) => { if (!headMesh && o.isMesh && /_Head$/.test(o.name)) headMesh = o; });
  if (!head || !headMesh) return;
  model.updateMatrixWorld(true);
  headMesh.geometry.computeBoundingBox();
  const box = headMesh.geometry.boundingBox.clone().applyMatrix4(headMesh.matrixWorld);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const w = Math.max(size.x, size.z);

  const capMat = new THREE.MeshStandardMaterial({ color: 0x1d4f8f, roughness: 0.55 });
  const cap = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(w * 0.47, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  dome.scale.set(1.04, 0.82, 1.1);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.49, w * 0.49, w * 0.08, 24, 1, true), capMat);
  band.position.y = w * 0.02;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.4, w * 0.4, w * 0.04, 24, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0x173f73, roughness: 0.6 }));
  brim.scale.set(1.15, 1, 1.3);
  brim.position.set(0, 0, w * 0.45);
  const button = new THREE.Mesh(new THREE.SphereGeometry(w * 0.05, 8, 6), capMat);
  button.position.y = w * 0.39;
  cap.add(dome, band, brim, button);
  if (logoTex) {
    const aspect = logoTex.image ? logoTex.image.width / logoTex.image.height : 1.6;
    const lw = w * 0.5;
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(lw, lw / aspect),
      new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    // On the back of the cap, facing the camera, tilted to follow the dome.
    logo.position.set(0, w * 0.17, -w * 0.47);
    logo.rotation.set(0.35, Math.PI, 0);
    cap.add(logo);
  }
  cap.position.set(center.x, box.max.y - size.y * 0.36, center.z + size.z * 0.02);
  cap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  model.add(cap);
  head.attach(cap);
}

function playAction(name, fade = 0.15) {
  const next = player.actions[name];
  if (player.current === next) return;
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (player.current) player.current.fadeOut(fade);
  player.current = next;
}

function resetPlayer() {
  Object.assign(player, { lane: 1, x: 0, y: 0, vy: 0, onGround: true, slideTimer: 0, wantFastFall: false });
  player.root.position.set(0, 0, 0);
  player.root.rotation.set(0, 0, 0);
}

function feet() {
  return { x: player.x, y: player.y, z: 0.1 };
}

function jump() {
  if (state.mode !== 'playing' || !player.onGround) return;
  player.slideTimer = 0;
  player.vy = CFG.jumpVelocity;
  player.onGround = false;
  playAction('jumpStart', 0.05);
  sfx.jump();
  world.vfx.puff(feet());
}

function slide() {
  if (state.mode !== 'playing') return;
  if (!player.onGround) { player.wantFastFall = true; return; }
  if (player.slideTimer <= 0) sfx.slide();
  player.slideTimer = CFG.slideTime;
  playAction('slide', 0.08);
}

function steer(dir) {
  if (state.mode !== 'playing') return;
  const lane = Math.max(0, Math.min(2, player.lane + dir));
  if (lane === player.lane) return;
  player.lane = lane;
  world.vfx.laneStreak({ x: player.x, y: player.y, z: 0 }, dir);
}

function land() {
  player.y = 0;
  player.vy = 0;
  player.onGround = true;
  world.vfx.puff(feet(), true);
  if (player.wantFastFall) {
    player.wantFastFall = false;
    player.slideTimer = CFG.slideTime;
    sfx.slide();
    playAction('slide', 0.08);
  } else {
    playAction('run', 0.12);
  }
}

function updatePlayer(dt) {
  const targetX = CFG.lanes[player.lane];
  player.x += (targetX - player.x) * Math.min(1, dt * CFG.laneRate);
  if (!player.onGround) {
    const g = CFG.gravity + (player.wantFastFall ? CFG.fastFall : 0);
    player.vy += g * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) land();
  } else if (player.slideTimer > 0) {
    player.slideTimer -= dt;
    world.vfx.slideSpray(feet(), dt);
    if (player.slideTimer <= 0) playAction('run', 0.15);
  }
  player.root.position.set(player.x, player.y, 0);
  // Lean into lane changes.
  const lean = (targetX - player.x) * -0.12;
  player.root.rotation.z += (lean - player.root.rotation.z) * Math.min(1, dt * 14);
}

function playerBox() {
  const h = player.slideTimer > 0 ? CFG.slideHeight : CFG.standHeight;
  return {
    minX: player.x - CFG.halfWidth, maxX: player.x + CFG.halfWidth,
    minY: player.y + 0.05, maxY: player.y + h,
    minZ: -CFG.halfDepth, maxZ: CFG.halfDepth,
  };
}

/** AABB test; `dz` widens the obstacle along its travel so fast frames can't tunnel through. */
function overlaps(p, e, dz = 0) {
  const { x, y, z } = e.obj.position;
  const b = e.box;
  return p.maxX > x + b.minX && p.minX < x + b.maxX
    && p.maxY > y + b.minY && p.minY < y + b.maxY
    && p.maxZ > z + b.minZ - dz && p.minZ < z + b.maxZ;
}

// ---------------------------------------------------------------- snowfall

function buildSnowfall() {
  const COUNT = IS_TOUCH ? 650 : 1200;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = rand(-16, 16);
    pos[i * 3 + 1] = rand(0, 16);
    pos[i * 3 + 2] = rand(-50, 9);
    vel[i] = rand(1.2, 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.13, map: world.tex.circle_05, transparent: true, depthWrite: false, opacity: 0.95, color: 0xffffff,
  }));
  points.frustumCulled = false;
  bendMaterial(points.material);
  scene.add(points);
  world.snow = { points, pos, vel, count: COUNT };
}

function updateSnow(dt, dz, t) {
  const { pos, vel, count, points } = world.snow;
  for (let i = 0; i < count; i++) {
    const k = i * 3;
    pos[k + 1] -= vel[i] * dt;
    pos[k] += Math.sin(t * 0.8 + i) * 0.25 * dt;
    pos[k + 2] += dz * 0.9;
    if (pos[k + 1] < 0) pos[k + 1] += 16;
    if (pos[k + 2] > 9) pos[k + 2] -= 59;
  }
  points.geometry.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- game state

const sfx = new Sfx();
const road = new RoadPlan();
const state = {
  mode: 'loading',  // loading | menu | playing | paused | dying | over
  distance: 0,
  bonus: 0,
  peanuts: 0,
  score: 0,
  level: 0,
  speed: CFG.baseSpeed,
  nextSpawnAt: 0,
  best: 0,
  shake: 0,
  deathTimer: 0,
  slowmo: 0,
  fovKick: 0,
  pendingScore: null,
  time: 0,
  runTime: 0,
};

try { state.best = Number(localStorage.getItem('runner-best')) || 0; } catch { /* storage unavailable */ }

function setOverlay(id) {
  for (const el of document.querySelectorAll('.overlay')) el.hidden = el.id !== id;
  document.body.classList.toggle('in-run', id === null);
}

function resetRun() {
  for (const e of world.obstacles) release(e);
  for (const e of world.peanuts) release(e);
  world.obstacles.length = 0;
  world.peanuts.length = 0;
  world.vfx?.clear();
  world.track?.reset();
  road.reset();
  Object.assign(state, {
    distance: 0, bonus: 0, peanuts: 0, score: 0, level: 0, speed: CFG.baseSpeed, nextSpawnAt: 20, lastFree: [0, 1, 2],
    shake: 0, deathTimer: 0, slowmo: 0, fovKick: 0, runTime: 0,
  });
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
  perf.reset();
  if (IS_TOUCH) {
    // Immersive phone play: fullscreen where supported, keep the screen awake, teach the swipes once.
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    showSwipeHint();
  }
}

let wakeLock = null;
let hintTimer = null;

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

function showSwipeHint() {
  let seen = false;
  try { seen = localStorage.getItem('runner-hinted') === '1'; } catch { /* ignore */ }
  if (seen) return;
  $('#swipe-hint').hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideSwipeHint, 6000);
}

function hideSwipeHint() {
  if ($('#swipe-hint').hidden) return;
  $('#swipe-hint').hidden = true;
  try { localStorage.setItem('runner-hinted', '1'); } catch { /* ignore */ }
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
  hideSwipeHint();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  state.deathTimer = 1.2;
  state.shake = 0.5;
  state.slowmo = 0.35;
  player.slideTimer = 0;
  player.root.rotation.z = 0;
  playAction('death', 0.08);
  world.vfx.crash({ x: player.x, y: player.y, z: 0 });
  buzz(80);
  const flash = $('#flash');
  flash.classList.remove('go');
  void flash.offsetWidth; // restart the CSS animation
  flash.classList.add('go');
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
  $('#final-peanuts').textContent = `🥜 ${state.peanuts} peanuts · ⏱ ${formatTime(state.runTime)}`;
  $('#over-title').textContent = pick(['Game Over', 'Oh, Nuts!', 'Snowed Under!', 'Ho-Ho-Oops!']);
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

const hud = { score: $('#hud-score'), time: $('#hud-time'), best: $('#hud-best'), speed: $('#hud-speed') };
let toastTimer = null;
let lastHud = '';

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function updateHud() {
  const key = `${state.score}|${Math.floor(state.runTime)}|${state.level}|${state.best}`;
  if (key === lastHud) return;
  lastHud = key;
  hud.score.textContent = state.score.toLocaleString();
  hud.time.textContent = formatTime(state.runTime);
  hud.best.textContent = Math.max(state.best, state.score).toLocaleString();
  hud.speed.textContent = `×${(CFG.baseSpeed * Math.pow(CFG.speedStep, state.level) / CFG.baseSpeed).toFixed(2)}`;
}

function toast(text) {
  const el = $('#level-toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1100);
}

const _proj = new THREE.Vector3();
function floatText(text, pos) {
  _proj.set(pos.x, pos.y, pos.z).project(camera);
  const el = document.createElement('div');
  el.className = 'float-text';
  el.textContent = text;
  el.style.left = `${(_proj.x * 0.5 + 0.5) * window.innerWidth}px`;
  el.style.top = `${(-_proj.y * 0.5 + 0.5) * window.innerHeight}px`;
  $('#float-layer').append(el);
  setTimeout(() => el.remove(), 800);
}

// ---------------------------------------------------------------- quality

/** Watches frame times early in each run and drops bloom / resolution on slow devices. */
const perf = {
  frames: 0, total: 0, settled: false,
  reset() { this.frames = 0; this.total = 0; },
  sample(ms) {
    if (this.settled || state.mode !== 'playing') return;
    this.frames++;
    this.total += ms;
    if (this.frames < 120) return;
    const avg = this.total / this.frames;
    this.settled = true;
    if (avg > 24) {
      useBloom = false;
      pixelRatio = Math.min(pixelRatio, 1.25);
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      console.info(`Christmas Runner: ${avg.toFixed(1)} ms/frame, switching to low effects`);
    }
  },
};

// ---------------------------------------------------------------- main loop

const clock = new THREE.Clock();

function step(rawDt) {
  let dt = rawDt;
  if (state.slowmo > 0) {
    state.slowmo -= rawDt;
    dt *= 0.3;
  }
  state.time += dt;
  let dz = 0;

  if (state.mode === 'playing') {
    dz = state.speed * dt;
    state.distance += dz;
    state.runTime += dt;

    // Spawning rows: gaps scale with speed so reaction time stays roughly constant.
    if (state.distance >= state.nextSpawnAt) spawnNext();

    for (const e of world.obstacles) {
      e.obj.position.z += dz + e.vz * dt;
      if (e.vz) {
        e.obj.userData.ball.rotation.x -= ((dz + e.vz * dt) / 0.88);
        if (e.obj.position.z > -45 && Math.random() < 0.5) world.vfx.snowChunk({ x: e.obj.position.x, y: 0, z: e.obj.position.z + 0.6 }, 2.2, true);
      }
    }
    for (const c of world.peanuts) {
      c.obj.position.z += dz;
      c.obj.userData.nut.rotation.y += dt * 3.5;
      c.obj.position.y = c.baseY + Math.sin(state.time * 4 + c.obj.position.z * 0.5) * 0.08;
    }
    cull(world.obstacles);
    cull(world.peanuts);

    updatePlayer(dt);
    const pb = playerBox();
    for (let i = world.peanuts.length - 1; i >= 0; i--) {
      const c = world.peanuts[i];
      if (overlaps(pb, c, dz)) {
        world.vfx.pickup(c.obj.position);
        floatText(`+${CFG.peanutValue}`, { x: c.obj.position.x, y: c.obj.position.y + 0.6, z: c.obj.position.z });
        release(c);
        world.peanuts.splice(i, 1);
        state.bonus += CFG.peanutValue;
        state.peanuts++;
        sfx.pickup();
      }
    }
    for (const e of world.obstacles) {
      if (overlaps(pb, e, dz + e.vz * dt)) { gameOver(); break; }
    }

    state.score = Math.floor(state.distance) + state.bonus;
    const level = Math.floor(state.score / CFG.speedEvery);
    if (level > state.level) {
      state.level = level;
      sfx.levelUp();
      state.fovKick = 1;
      world.vfx.levelUp({ x: player.x, y: player.y, z: 0 });
      buzz([15, 40, 15]);
      toast(`Faster! ×${Math.pow(CFG.speedStep, level).toFixed(2)}`);
    }
    // Ease toward the target speed so level-ups don't jolt.
    const target = CFG.baseSpeed * Math.pow(CFG.speedStep, state.level);
    state.speed += (target - state.speed) * Math.min(1, dt * 2);
    updateHud();
  } else if (state.mode === 'dying') {
    state.deathTimer -= rawDt;
    if (player.y > 0) {
      player.vy += CFG.gravity * dt;
      player.y = Math.max(0, player.y + player.vy * dt);
      player.root.position.y = player.y;
    }
    if (state.deathTimer <= 0) showGameOver();
  }

  road.difficulty = state.level;
  const bend = road.update(state.distance);
  world.track.update(dz, state.time);
  updateSnow(dt, dz, state.time);
  world.vfx.ambient(dt, { x: player.x, y: player.y }, state.mode === 'playing' ? state.speed / CFG.baseSpeed : 0);
  world.vfx.update(dt, dz);
  player.mixer?.update(dt);

  // Camera: trails the runner's lane, rises a little on jumps, kicks FOV on speed-ups, shakes on impact.
  state.fovKick = Math.max(0, state.fovKick - dt * 1.6);
  camera.fov = CAM.fov + Math.sin(state.fovKick * Math.PI) * 7 + (state.speed / CFG.baseSpeed - 1) * 4;
  camera.updateProjectionMatrix();
  const lerp = Math.min(1, dt * 6);
  camera.position.x += (player.x * 0.7 - camera.position.x) * lerp;
  camera.position.y += (CAM.y + player.y * 0.35 - camera.position.y) * lerp;
  camera.position.z = CAM.z;
  let sx = 0, sy = 0;
  if (state.shake > 0) {
    state.shake = Math.max(0, state.shake - rawDt);
    const s = state.shake * 0.5;
    sx = rand(-s, s); sy = rand(-s, s);
  }
  camera.position.x += sx;
  camera.position.y += sy;
  // Look along the road: into bends and up / down slopes, banking slightly in turns.
  const ahead = offsetAhead(-CAM.lookZ);
  camera.lookAt(player.x * 0.45 + ahead.x * 0.75, CAM.lookY + player.y * 0.3 + ahead.y * 0.7, CAM.lookZ);
  camera.rotateZ(-bend.kx * 14);
  // Runner leans into turns and forward up climbs.
  player.model.rotation.z = THREE.MathUtils.lerp(player.model.rotation.z, -bend.kx * 22, Math.min(1, dt * 4));
  player.model.rotation.x = THREE.MathUtils.lerp(player.model.rotation.x, -bend.ky * 28, Math.min(1, dt * 4));
  heroGlow.position.set(player.x, 2.4 + player.y, 1.6);
  sun.position.x = -7 + player.x;
  sun.target.position.x = player.x;
}

function cull(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].obj.position.z > CFG.despawnZ) {
      release(list[i]);
      list.splice(i, 1);
    }
  }
}

function frame() {
  const rawDt = clock.getDelta();
  perf.sample(rawDt * 1000);
  const dt = Math.min(rawDt, 1 / 20);
  if (state.mode !== 'paused' && state.mode !== 'loading') step(dt);
  if (useBloom) composer.render();
  else renderer.render(scene, camera);
}

// ---------------------------------------------------------------- input

function isTyping(e) {
  return document.body.classList.contains('modal-open') || ['INPUT', 'TEXTAREA'].includes(e.target?.tagName);
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  const k = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
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
  else if (k === 'ArrowLeft' || k === 'KeyA') steer(-1);
  else if (k === 'ArrowRight' || k === 'KeyD') steer(1);
  else if (k === 'KeyP' || k === 'Escape') pauseGame();
});

// Swipes are read from the whole screen (not just the canvas) so a thumb that starts over the
// HUD still counts; touches that begin on buttons, menus or the sign-in form are left alone.
let touchStart = null;
const isUiTouch = (e) => e.target.closest?.('button, a, input, .overlay, .modal');
window.addEventListener('touchstart', (e) => {
  if (state.mode !== 'playing' || isUiTouch(e)) { touchStart = null; return; }
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (state.mode === 'playing' && !isUiTouch(e)) e.preventDefault(); // no scroll / pull-to-refresh mid-run
  if (!touchStart || state.mode !== 'playing') return;
  // Fire the swipe as soon as it is clear, without waiting for the finger to lift.
  const t = e.changedTouches[0];
  const min = Math.min(window.innerWidth, window.innerHeight) * 0.07;
  if (handleSwipe(t.clientX - touchStart.x, t.clientY - touchStart.y, min)) touchStart = null;
}, { passive: false });
window.addEventListener('touchend', (e) => {
  if (!touchStart || state.mode !== 'playing') return;
  const t = e.changedTouches[0];
  if (!handleSwipe(t.clientX - touchStart.x, t.clientY - touchStart.y, 20)) jump();
  touchStart = null;
}, { passive: true });

function handleSwipe(dx, dy, min) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return false;
  hideSwipeHint();
  if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1);
  else if (dy > 0) slide();
  else jump();
  return true;
}

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  // Portrait (the reference look) uses a taller view; landscape pulls the camera in a bit.
  const portrait = camera.aspect < 1;
  Object.assign(CAM, portrait
    ? { y: 3.5, z: 5.6, lookY: 1.4, lookZ: -10, fov: 60 }
    : { y: 3.6, z: 6.6, lookY: 1.5, lookZ: -10, fov: 52 });
  camera.position.set(0, CAM.y, CAM.z);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
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
    const [models, tex, bodyTex, legsTex, logoTex] = await Promise.all([
      loadModels(), loadVfxTextures(manager), loadHeroTexture('hero_body.png'), loadHeroTexture('hero_legs.png'), loadBrandLogo(),
    ]);
    world.tex = tex;
    world.track = new Track(scene, models, tex);
    world.vfx = new Vfx(scene, tex);
    buildSnowfall();
    buildTemplates(models, tex);
    buildPlayer(models, bodyTex, legsTex, logoTex);
  } catch (err) {
    console.error(err);
    $('#loading-screen .muted').textContent = 'Could not load the game assets. Please refresh.';
    return;
  }
  resetRun();
  toMenu();
  // Compile shaders up front so the first jump / pickup doesn't hitch.
  renderer.compile(scene, camera);
  renderer.setAnimationLoop(frame);
}

boot();

// Exposed for automated smoke tests and debugging in the console.
window.__runner = { state, player, world, road, startGame, jump, slide, steer, step, CFG };
