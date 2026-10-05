// Track chunks and scenery for the behind-the-runner view: snowy path, rope bridge over a
// frozen river and a stone plaza with a Christmas tree — all recycled as the world scrolls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flipbookSprite } from './vfx.js';
import { bendObject } from './curve.js';

export const CHUNK_LEN = 24;
export const TRACK_HALF = 3.2;     // half-width of the runnable path

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

// ---------------------------------------------------------------- canvas textures

function canvasTexture(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function speckle(g, w, h, n, colors, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = pick(colors);
    g.beginPath();
    g.ellipse(Math.random() * w, Math.random() * h, rand(rMin, rMax), rand(rMin, rMax) * 0.7, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

const TEX = {};
function textures() {
  if (TEX.snow) return TEX;
  TEX.snow = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#eef3fb'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, ['rgba(200,214,236,0.35)', 'rgba(255,255,255,0.8)', 'rgba(185,200,228,0.25)'], 2, 9);
  }, { repeat: [40, 4] });
  // Trodden path: warm, slightly golden, with footprints like the reference.
  TEX.path = canvasTexture(256, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#e8e6ea'); grad.addColorStop(0.18, '#e2cfae'); grad.addColorStop(0.5, '#d9bd8e');
    grad.addColorStop(0.82, '#e2cfae'); grad.addColorStop(1, '#e8e6ea');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['rgba(255,255,255,0.45)', 'rgba(170,130,80,0.18)', 'rgba(230,200,150,0.35)'], 1.5, 6);
    g.fillStyle = 'rgba(150,110,70,0.22)';
    for (let y = 10; y < h; y += 46) {
      for (const x of [w * 0.38 + rand(-8, 8), w * 0.6 + rand(-8, 8)]) {
        g.beginPath(); g.ellipse(x, y + (x > w / 2 ? 23 : 0), 9, 15, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }, { repeat: [1, 2] });
  TEX.ice = canvasTexture(512, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#a9dcf2'); grad.addColorStop(0.5, '#d6f1fb'); grad.addColorStop(1, '#8fcbe6');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 160, ['rgba(255,255,255,0.5)', 'rgba(120,190,220,0.35)'], 6, 30);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.5;
    for (let i = 0; i < 28; i++) {
      let x = Math.random() * w, y = Math.random() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rand(-40, 40); y += rand(-40, 40); g.lineTo(x, y); }
      g.stroke();
    }
  }, { repeat: [16, 3] });
  TEX.rune = canvasTexture(512, 512, (g, w) => {
    const c = w / 2;
    g.clearRect(0, 0, w, w);
    // Outer ring of flagstones.
    for (let ring = 0; ring < 2; ring++) {
      const r0 = ring ? 150 : 205, r1 = ring ? 196 : 250;
      const n = ring ? 22 : 30;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2 + 0.01, a1 = ((i + 1) / n) * Math.PI * 2 - 0.02;
        g.beginPath(); g.arc(c, c, r1, a0, a1); g.arc(c, c, r0, a1, a0, true); g.closePath();
        g.fillStyle = pick(['#8d97a6', '#9aa3b1', '#848d9b', '#a3abb7']); g.fill();
        g.strokeStyle = 'rgba(40,46,60,0.6)'; g.lineWidth = 2; g.stroke();
      }
    }
    g.beginPath(); g.arc(c, c, 148, 0, Math.PI * 2); g.fillStyle = '#7d8696'; g.fill();
    // Celtic-style knot swirls.
    g.strokeStyle = '#c9d0db'; g.lineWidth = 7; g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      g.save(); g.translate(c, c); g.rotate((i / 6) * Math.PI * 2);
      g.beginPath();
      for (let t = 0; t < 1; t += 0.02) {
        const r = 20 + t * 110, a = t * Math.PI * 2.2;
        g.lineTo(Math.cos(a) * r * 0.55 + 40, Math.sin(a) * r * 0.55);
      }
      g.stroke(); g.restore();
    }
    g.beginPath(); g.arc(c, c, 40, 0, Math.PI * 2); g.stroke();
    // Snow dusting.
    speckle(g, w, w, 260, ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0.4)'], 3, 14);
  }, { repeat: [1, 1] });
  TEX.spiralStone = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#9aa1ad'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 300, ['rgba(70,78,92,0.25)', 'rgba(220,226,235,0.3)'], 2, 10);
    g.strokeStyle = 'rgba(60,66,80,0.75)'; g.lineWidth = 6;
    g.beginPath();
    for (let t = 0; t < 1; t += 0.01) {
      const a = t * Math.PI * 6, r = t * 90;
      g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    }
    g.stroke();
  });
  TEX.shaft = canvasTexture(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,230,170,0)'); grad.addColorStop(0.25, 'rgba(255,225,160,0.55)');
    grad.addColorStop(1, 'rgba(255,215,150,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = side; g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
  TEX.bark = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#5a4030'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(30,20,14,0.6)'; g.lineWidth = 3;
    for (let i = 0; i < 14; i++) { const x = Math.random() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + rand(-12, 12), h / 3, x + rand(-12, 12), h * 0.66, x, h); g.stroke(); }
  });
  return TEX;
}

// ---------------------------------------------------------------- shared materials / geometry

const MAT = {};
function mats() {
  if (MAT.snow) return MAT;
  const T = textures();
  MAT.snow = new THREE.MeshStandardMaterial({ map: T.snow, color: 0xffffff, roughness: 0.95 });
  MAT.path = new THREE.MeshStandardMaterial({ map: T.path, roughness: 0.9 });
  MAT.ice = new THREE.MeshStandardMaterial({ map: T.ice, roughness: 0.15, metalness: 0.15, emissive: 0x1b4a63, emissiveIntensity: 0.35 });
  MAT.bank = new THREE.MeshStandardMaterial({ color: 0x8794a8, roughness: 0.95, flatShading: true });
  MAT.rune = new THREE.MeshStandardMaterial({ map: T.rune, transparent: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
  MAT.spiral = new THREE.MeshStandardMaterial({ map: T.spiralStone, roughness: 0.9 });
  MAT.rope = new THREE.MeshStandardMaterial({ color: 0xd9c8a6, roughness: 0.9 });
  MAT.trunk = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9, flatShading: true });
  MAT.leaf = new THREE.MeshStandardMaterial({ color: 0x1c6a48, roughness: 0.85, flatShading: true });
  MAT.leafDark = new THREE.MeshStandardMaterial({ color: 0x14513a, roughness: 0.85, flatShading: true });
  MAT.snowCap = new THREE.MeshStandardMaterial({ color: 0xf6f9ff, roughness: 0.9, flatShading: true });
  MAT.rock = new THREE.MeshStandardMaterial({ color: 0x7c8494, roughness: 0.95, flatShading: true });
  MAT.bark = new THREE.MeshStandardMaterial({ map: T.bark, roughness: 0.95 });
  MAT.shaft = new THREE.MeshBasicMaterial({ map: T.shaft, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, opacity: 0.22 });
  MAT.lanternGlass = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  MAT.lanternFrame = new THREE.MeshStandardMaterial({ color: 0x2d2a2a, roughness: 0.5, metalness: 0.6 });
  // Twinkling Christmas lights (colour intensity animated in update()).
  MAT.bulbs = [0xff4d4d, 0xffd24d, 0x4dff88, 0x4dc3ff].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  MAT.bulbBase = MAT.bulbs.map((m) => m.color.clone());
  MAT.ornaments = [0xd7263d, 0xf2c14e, 0x2b59c3].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.6 }));
  MAT.star = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  return MAT;
}

const GEO = {};
function geos() {
  if (GEO.cone) return GEO;
  GEO.cone = [1.3, 1.05, 0.82, 0.6].map((r) => new THREE.ConeGeometry(r, 1.4, 8));
  GEO.cap = [1.3, 1.05, 0.82, 0.6].map((r) => new THREE.ConeGeometry(r * 0.66, 0.6, 8));
  GEO.trunk = new THREE.CylinderGeometry(0.16, 0.24, 0.9, 6);
  GEO.rock = new THREE.DodecahedronGeometry(1, 0);
  GEO.bulb = new THREE.SphereGeometry(0.07, 6, 4);
  GEO.ornament = new THREE.SphereGeometry(0.16, 10, 8);
  return GEO;
}

// ---------------------------------------------------------------- props

export function makePine(scale = 1, dark = false) {
  const M = mats(); const G = geos();
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(G.trunk, M.trunk);
  trunk.position.y = 0.45;
  g.add(trunk);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const y = 0.75 + i * 0.78;
    const cone = new THREE.Mesh(G.cone[i], dark ? M.leafDark : M.leaf);
    cone.position.y = y + 0.7;
    cone.rotation.y = i * 0.7;
    const cap = new THREE.Mesh(G.cap[i], M.snowCap);
    cap.position.y = y + 1.12;
    cap.rotation.y = i * 0.7;
    g.add(cone, cap);
  }
  g.scale.setScalar(scale);
  return shadows(g, true, false);
}

/** Big decorated Christmas tree: ornaments, twinkling lights and a glowing star. */
export function makeChristmasTree(tex) {
  const M = mats(); const G = geos();
  const g = makePine(2.1);
  const rows = [[0.95, 1.18, 12], [1.75, 0.98, 10], [2.5, 0.78, 8], [3.25, 0.55, 6]];
  rows.forEach(([y, r, n], row) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + row * 0.4;
      const o = new THREE.Mesh(G.ornament, M.ornaments[(i + row) % 3]);
      o.position.set(Math.cos(a) * r, y + 0.25, Math.sin(a) * r);
      o.scale.setScalar(0.6);
      g.add(o);
      const b = new THREE.Mesh(G.bulb, M.bulbs[(i + row) % 4]);
      const a2 = a + Math.PI / n;
      b.position.set(Math.cos(a2) * (r + 0.05), y + 0.55, Math.sin(a2) * (r + 0.05));
      g.add(b);
    }
  });
  // Star: a flat 5-point star mesh plus an additive glow sprite.
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.16 : 0.38, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }), M.star);
  star.position.y = 4.15;
  g.add(star);
  if (tex) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.flare_01, color: 0xffd36b, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.set(2.2, 2.2, 1);
    glow.position.y = 4.2;
    g.add(glow);
  }
  return g;
}

function makeRock(s) {
  const M = mats(); const G = geos();
  const g = new THREE.Group();
  const r = new THREE.Mesh(G.rock, M.rock);
  r.scale.set(s, s * 0.7, s * rand(0.8, 1.2));
  r.rotation.set(rand(0, 1), rand(0, 6), rand(0, 1));
  r.position.y = s * 0.35;
  const cap = new THREE.Mesh(G.rock, M.snowCap);
  cap.scale.set(s * 0.85, s * 0.25, s * 0.85);
  cap.position.y = s * 0.78;
  g.add(r, cap);
  return shadows(g);
}

function makeLantern(tex, sprites, height = 1.8) {
  const M = mats();
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, height, 6), M.lanternFrame);
  pole.position.y = height / 2;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.32), M.lanternGlass);
  box.position.y = height + 0.2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.22, 4), M.lanternFrame);
  roof.position.y = height + 0.51;
  roof.rotation.y = Math.PI / 4;
  const snow = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.1, 4), M.snowCap);
  snow.position.y = height + 0.6;
  snow.rotation.y = Math.PI / 4;
  g.add(pole, box, roof, snow);
  if (tex) {
    const flame = flipbookSprite(tex.flame, 16, 4, 64, { fps: 30, size: 0.55, color: 0xffb35c });
    flame.position.y = height + 0.25;
    sprites.push(flame);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.spotlight_01, color: 0xffae50, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
    halo.scale.set(2.4, 2.4, 1);
    halo.position.y = height + 0.2;
    g.add(flame, halo);
  }
  return shadows(g, true, false);
}

function makeShaft() {
  const M = mats();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(rand(1.6, 2.8), 16), M.shaft);
  m.rotation.z = rand(0.35, 0.55) * (Math.random() < 0.5 ? 1 : -1);
  m.rotation.y = rand(-0.4, 0.4);
  m.renderOrder = 5;
  return m;
}

function makeBareTree() {
  // Gnarled trunk with a few snowy branches (frames the path like the reference).
  const M = mats();
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 7, 8), M.bark);
  trunk.position.y = 3.5;
  trunk.rotation.z = rand(-0.08, 0.08);
  g.add(trunk);
  for (let i = 0; i < 4; i++) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 3, 5), M.bark);
    const a = rand(0, Math.PI * 2);
    br.position.set(Math.cos(a) * 0.8, rand(4.5, 6.5), Math.sin(a) * 0.8);
    br.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    const snow = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 2.6, 5), M.snowCap);
    snow.position.copy(br.position).add(new THREE.Vector3(0, 0.12, 0));
    snow.rotation.copy(br.rotation);
    g.add(br, snow);
  }
  const root = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), M.snowCap);
  root.scale.y = 0.4;
  g.add(root);
  return shadows(g, true, false);
}

// ---------------------------------------------------------------- baking

/**
 * Merge every static mesh in a chunk into one mesh per material, cutting hundreds of draw
 * calls down to a couple of dozen. Sprites (flames, glows) are left untouched.
 */
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) {
    const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const key = m.material.uuid;
    if (!groups.has(key)) groups.set(key, { material: m.material, geos: [], cast: false, receive: false, order: m.renderOrder });
    const entry = groups.get(key);
    entry.geos.push(geo);
    entry.cast ||= m.castShadow;
    entry.receive ||= m.receiveShadow;
    m.removeFromParent();
  }
  for (const { material, geos, cast, receive, order } of groups.values()) {
    const merged = new THREE.Mesh(mergeGeometries(geos, false), material);
    merged.castShadow = cast;
    merged.receiveShadow = receive;
    merged.renderOrder = order;
    root.add(merged);
    geos.forEach((g) => g.dispose());
  }
  return root;
}

// ---------------------------------------------------------------- chunks

function groundStrip(z0, z1, width = 220) {
  const M = mats();
  const len = z0 - z1;
  const g = new THREE.Group();
  const snow = new THREE.Mesh(new THREE.PlaneGeometry(width, len, 1, Math.ceil(len / 1.5)), M.snow);
  snow.rotation.x = -Math.PI / 2;
  snow.position.set(0, 0, (z0 + z1) / 2);
  snow.receiveShadow = true;
  const path = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_HALF * 2 + 0.6, len, 1, Math.ceil(len / 1.5)), M.path);
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, (z0 + z1) / 2);
  path.receiveShadow = true;
  g.add(snow, path);
  // Snow banks lining the path.
  for (const side of [-1, 1]) {
    for (let z = z0 - 1.5; z > z1 + 0.5; z -= rand(2.2, 3.4)) {
      const bank = new THREE.Mesh(geos().rock, mats().snowCap);
      bank.scale.set(rand(0.7, 1.1), rand(0.25, 0.45), rand(1.0, 1.6));
      bank.position.set(side * (TRACK_HALF + rand(0.6, 1.1)), 0.05, z);
      bank.rotation.y = rand(0, 3);
      bank.receiveShadow = true;
      g.add(bank);
    }
  }
  return g;
}

function dressSides(g, tex, sprites, z0, z1, { pines = 9, rocks = 3, lanterns = true, shafts = 2, bare = 1 } = {}) {
  for (let i = 0; i < pines; i++) {
    const side = i % 2 ? 1 : -1;
    const pine = makePine(rand(1.1, 2.3), Math.random() < 0.4);
    pine.position.set(side * rand(5.4, 22), 0, rand(z1, z0));
    pine.rotation.y = rand(0, 6);
    g.add(pine);
  }
  for (let i = 0; i < rocks; i++) {
    const rock = makeRock(rand(0.5, 1.1));
    rock.position.set((Math.random() < 0.5 ? -1 : 1) * rand(4.4, 8), 0, rand(z1, z0));
    g.add(rock);
  }
  for (let i = 0; i < bare; i++) {
    const t = makeBareTree();
    t.position.set((Math.random() < 0.5 ? -1 : 1) * rand(6, 9), 0, rand(z1 + 4, z0 - 4));
    g.add(t);
  }
  if (lanterns) {
    for (const side of [-1, 1]) {
      const l = makeLantern(tex, sprites);
      l.position.set(side * (TRACK_HALF + 1.5), 0, (z0 + z1) / 2 + rand(-4, 4));
      g.add(l);
    }
  }
  for (let i = 0; i < shafts; i++) {
    const s = makeShaft();
    s.position.set((Math.random() < 0.5 ? -1 : 1) * rand(4.5, 11), 6.5, rand(z1, z0));
    g.add(s);
  }
}

function buildPathChunk(models, tex) {
  const g = new THREE.Group();
  const sprites = [];
  g.add(groundStrip(0, -CHUNK_LEN));
  dressSides(g, tex, sprites, 0, -CHUNK_LEN, { pines: 12, rocks: 4, shafts: 2 });
  if (Math.random() < 0.35) {
    const tree = makeChristmasTree(tex);
    tree.position.set((Math.random() < 0.5 ? -1 : 1) * rand(7, 9), 0, -CHUNK_LEN / 2);
    g.add(tree);
  }
  g.userData = { type: 'path', sprites };
  return bake(g);
}

function buildBridgeChunk(models, tex) {
  const M = mats();
  const g = new THREE.Group();
  const sprites = [];
  const B0 = -3, B1 = -21;            // bridge span
  g.add(groundStrip(0, B0));
  g.add(groundStrip(B1, -CHUNK_LEN));
  // Frozen river below.
  const river = new THREE.Mesh(new THREE.PlaneGeometry(220, B0 - B1, 1, 12), M.ice);
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, -1.7, (B0 + B1) / 2);
  river.receiveShadow = true;
  g.add(river);
  // Snowy banks dropping down to the ice.
  for (const z of [B0, B1]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(220, 1.8, 0.8), M.bank);
    bank.position.set(0, -0.85, z + (z === B0 ? -0.3 : 0.3));
    bank.receiveShadow = true;
    g.add(bank);
    for (let i = 0; i < 26; i++) {
      const lump = new THREE.Mesh(geos().rock, M.snowCap);
      lump.scale.set(rand(1, 2.2), rand(0.4, 0.8), rand(0.6, 1));
      lump.position.set(rand(-40, 40), -0.2, z + (z === B0 ? -0.8 : 0.8));
      if (Math.abs(lump.position.x) < TRACK_HALF + 1.2) continue;
      g.add(lump);
    }
  }
  // Ice floes and rocks in the river.
  for (let i = 0; i < 10; i++) {
    const r = makeRock(rand(0.5, 1.2));
    r.position.set((Math.random() < 0.5 ? -1 : 1) * rand(5, 20), -1.75, rand(B1 + 2, B0 - 2));
    g.add(r);
  }
  // Deck: KayKit planks laid across the path, slightly uneven.
  const plankSrc = [models.plankA.scene, models.plankB.scene, models.plankC.scene];
  for (let z = B0 + 0.2; z > B1 - 0.2; z -= 0.47) {
    const p = pick(plankSrc).clone(true);
    p.rotation.y = Math.PI / 2 + rand(-0.03, 0.03);
    p.scale.set(1.1, 1, (TRACK_HALF + 0.5) / 0.75);
    p.position.set(rand(-0.1, 0.1), -0.15, z);
    g.add(shadows(p, false, true));
  }
  // Beams under the deck.
  for (const x of [-TRACK_HALF, TRACK_HALF]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, B0 - B1 + 1, 1, 1, 12), MAT.trunk);
    beam.position.set(x, -0.35, (B0 + B1) / 2);
    g.add(beam);
  }
  // Rope posts (KayKit logs stood upright) with snow caps, and sagging rope rails.
  const postTop = 1.5;
  const postAt = (x, z) => {
    const post = models.logA.scene.clone(true);
    post.rotation.x = Math.PI / 2;
    post.scale.set(0.9, 1.25, 0.9);
    post.position.set(x, 0.7, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.18, 10), M.snowCap);
    cap.position.set(x, postTop + 0.05, z);
    // Rope wraps.
    for (const y of [0.55, 1.1]) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 14), M.rope);
      wrap.rotation.x = Math.PI / 2;
      wrap.position.set(x, y, z);
      g.add(wrap);
    }
    g.add(shadows(post), cap);
  };
  for (const side of [-1, 1]) {
    const x = side * (TRACK_HALF + 0.35);
    postAt(x, B0 + 0.6);
    postAt(x, B1 - 0.6);
    for (const [h, sag] of [[1.3, 0.55], [0.75, 0.35]]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, h, B0 + 0.6),
        new THREE.Vector3(x, h - sag, (B0 + B1) / 2),
        new THREE.Vector3(x, h, B1 - 0.6),
      ]);
      const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.06, 6), M.rope);
      rope.castShadow = true;
      g.add(rope);
    }
    // Vertical ties down to the deck.
    for (let z = B0 - 1.5; z > B1 + 1; z -= 1.8) {
      const t = (z - B0) / (B1 - B0);
      const top = 1.3 - 0.55 * Math.sin(t * Math.PI);
      const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, top, 4), M.rope);
      tie.position.set(x, top / 2, z);
      g.add(tie);
    }
  }
  dressSides(g, tex, sprites, 2, B0 - 1, { pines: 4, rocks: 1, lanterns: false, shafts: 1, bare: 0 });
  dressSides(g, tex, sprites, B1 + 1, -CHUNK_LEN, { pines: 4, rocks: 1, lanterns: false, shafts: 1, bare: 0 });
  // Far-side pines across the river.
  for (let i = 0; i < 8; i++) {
    const pine = makePine(rand(1.2, 2.2), Math.random() < 0.5);
    pine.position.set((i % 2 ? 1 : -1) * rand(8, 24), -1.7, rand(B1 + 3, B0 - 3));
    g.add(pine);
  }
  g.userData = { type: 'bridge', sprites };
  return bake(g);
}

function buildPlazaChunk(models, tex) {
  const M = mats();
  const g = new THREE.Group();
  const sprites = [];
  g.add(groundStrip(0, -CHUNK_LEN));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), M.rune);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 0.02, -CHUNK_LEN / 2);
  disc.receiveShadow = true;
  g.add(disc);
  // Spiral-carved standing stones and pillars framing the plaza.
  for (const side of [-1, 1]) {
    for (const z of [-5, -19]) {
      const pillar = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 2.6, 10), M.spiral);
      body.position.y = 1.3;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.snowCap);
      cap.scale.y = 0.45;
      cap.position.y = 2.6;
      pillar.add(body, cap);
      pillar.position.set(side * (TRACK_HALF + 1.9), 0, z);
      g.add(shadows(pillar));
      const l = makeLantern(tex, sprites, 0.1);
      l.position.set(side * (TRACK_HALF + 1.9), 2.75, z);
      g.add(l);
    }
    // Low stone walls with snow on top.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 10, 1, 1, 7), M.rock);
    wall.position.set(side * (TRACK_HALF + 3.5), 0.45, -CHUNK_LEN / 2);
    const wallSnow = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 10.2, 1, 1, 7), M.snowCap);
    wallSnow.position.set(side * (TRACK_HALF + 3.5), 0.98, -CHUNK_LEN / 2);
    g.add(shadows(wall), wallSnow);
  }
  const tree = makeChristmasTree(tex);
  tree.position.set((Math.random() < 0.5 ? -1 : 1) * 8, 0, -CHUNK_LEN / 2 - 2);
  g.add(tree);
  dressSides(g, tex, sprites, 0, -CHUNK_LEN, { pines: 10, rocks: 2, lanterns: false, shafts: 3, bare: 1 });
  g.userData = { type: 'plaza', sprites };
  return bake(g);
}

// ---------------------------------------------------------------- environment controller

export class Track {
  constructor(scene, models, tex) {
    this.scene = scene;
    this.pool = { path: [], bridge: [], plaza: [] };
    const builders = { path: buildPathChunk, bridge: buildBridgeChunk, plaza: buildPlazaChunk };
    const counts = { path: 5, bridge: 2, plaza: 2 };
    for (const [type, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        const c = builders[type](models, tex);
        c.visible = false;
        bendObject(c);
        scene.add(c);
        this.pool[type].push(c);
      }
    }
    this.active = [];
    this.reset();
  }

  take(type) {
    const c = this.pool[type].pop();
    c.visible = true;
    return c;
  }

  nextType() {
    const last = this.active.at(-1)?.userData.type;
    const options = [];
    if (this.pool.path.length) options.push('path', 'path');
    if (this.pool.bridge.length && last !== 'bridge') options.push('bridge');
    if (this.pool.plaza.length && last !== 'plaza') options.push('plaza');
    return pick(options);
  }

  reset() {
    for (const c of this.active) { c.visible = false; this.pool[c.userData.type].push(c); }
    this.active = [];
    let z = 14;
    // Start on a path, show a bridge early because it is the signature view.
    for (const type of ['path', 'bridge', 'plaza', 'path', 'path', 'bridge']) {
      const c = this.take(this.pool[type].length ? type : 'path');
      c.position.z = z;
      this.active.push(c);
      z -= CHUNK_LEN;
    }
  }

  update(dz, t) {
    for (const c of this.active) c.position.z += dz;
    while (this.active[0].position.z - CHUNK_LEN > 16) {
      const old = this.active.shift();
      old.visible = false;
      this.pool[old.userData.type].push(old);
      const c = this.take(this.nextType());
      c.position.z = this.active.at(-1).position.z - CHUNK_LEN;
      this.active.push(c);
    }
    for (const c of this.active) for (const s of c.userData.sprites) s.userData.tick(t);
    // Twinkle the Christmas lights.
    const M = mats();
    M.bulbs.forEach((m, i) => {
      const k = 0.55 + 0.45 * Math.max(0, Math.sin(t * 3 + i * 1.7));
      m.color.copy(MAT.bulbBase[i]).multiplyScalar(0.4 + k * 1.6);
    });
  }
}

/** Sky: deep blue overhead with a warm golden glow over the path's vanishing point. */
export function makeSkyTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1c2c55'); grad.addColorStop(0.35, '#51689f'); grad.addColorStop(0.6, '#b9c3dc'); grad.addColorStop(1, '#e8e2dc');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w / 2, h * 0.52, 0, w / 2, h * 0.52, w * 0.5);
    glow.addColorStop(0, 'rgba(255,226,160,0.95)'); glow.addColorStop(0.35, 'rgba(255,205,130,0.45)'); glow.addColorStop(1, 'rgba(255,200,130,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}
