// GPU-instanced billboard particles with flipbook support, plus the game's effect presets.
// Textures are from the Brackeys VFX bundle (CC0), see /assets/licenses.
import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec4 iColor;
  attribute vec4 iData; // size, rotation, frame, stretch
  uniform vec2 grid;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    float c = cos(iData.y), s = sin(iData.y);
    vec2 p = position.xy * vec2(iData.x, iData.x * iData.w);
    mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    gl_Position = projectionMatrix * mv;
    float f = floor(iData.z);
    float col = mod(f, grid.x);
    float row = floor(f / grid.x);
    vUv = (vec2(col, grid.y - 1.0 - row) + uv) / grid;
    vColor = iColor;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float additive;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = t.a * vColor.a;
    if (a < 0.003) discard;
    vec3 rgb = t.rgb * vColor.rgb;
    gl_FragColor = additive > 0.5 ? vec4(rgb * a, 1.0) : vec4(rgb, a);
    #include <colorspace_fragment>
  }
`;

const _color = new THREE.Color();

/** One texture, one draw call, up to `max` live particles. */
export class ParticleSystem {
  constructor(scene, texture, { cols = 1, rows = 1, frames = cols * rows, additive = true, max = 256, depthTest = true, renderOrder = 10 } = {}) {
    this.frames = frames;
    this.max = max;
    this.list = [];
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iOffset', this.offset);
    geo.setAttribute('iColor', this.color);
    geo.setAttribute('iData', this.data);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { map: { value: texture }, grid: { value: new THREE.Vector2(cols, rows) }, additive: { value: additive ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (additive) {
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  /**
   * p: { pos, vel?, life, size, sizeEnd?, color?, alpha?, alphaEnd?, rot?, spin?, gravity?, drag?,
   *      fps? (flipbook rate; default plays whole sheet over life), loop?, frame?, stretch?, worldVel? }
   */
  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    _color.set(p.color ?? 0xffffff);
    const part = {
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      vx: p.vel?.x ?? 0, vy: p.vel?.y ?? 0, vz: p.vel?.z ?? 0,
      age: 0, life: p.life,
      size: p.size, sizeEnd: p.sizeEnd ?? p.size,
      r: _color.r, g: _color.g, b: _color.b,
      alpha: p.alpha ?? 1, alphaEnd: p.alphaEnd ?? 0,
      rot: p.rot ?? Math.random() * Math.PI * 2, spin: p.spin ?? 0,
      gravity: p.gravity ?? 0, drag: p.drag ?? 0,
      fps: p.fps ?? null, loop: p.loop ?? false, frame: p.frame ?? 0,
      stretch: p.stretch ?? 1,
      scroll: p.scroll ?? true, // moves with the world toward the camera
    };
    this.list.push(part);
    return part;
  }

  /** worldDz: how far the world moved toward the camera this frame. */
  update(dt, worldDz = 0) {
    const L = this.list;
    let n = 0;
    const off = this.offset.array;
    const col = this.color.array;
    const dat = this.data.array;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = p.age / p.life;
      if (p.drag) {
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d; p.vy *= d; p.vz *= d;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt + (p.scroll ? worldDz : 0);
      p.rot += p.spin * dt;
      let frame;
      if (this.frames > 1) {
        frame = p.fps ? p.frame + p.age * p.fps : k * this.frames;
        frame = p.loop ? frame % this.frames : Math.min(this.frames - 1, frame);
      } else frame = 0;
      off[n * 3] = p.x; off[n * 3 + 1] = p.y; off[n * 3 + 2] = p.z;
      const a = p.alpha + (p.alphaEnd - p.alpha) * k;
      col[n * 4] = p.r; col[n * 4 + 1] = p.g; col[n * 4 + 2] = p.b; col[n * 4 + 3] = a;
      dat[n * 4] = p.size + (p.sizeEnd - p.size) * k;
      dat[n * 4 + 1] = p.rot;
      dat[n * 4 + 2] = frame;
      dat[n * 4 + 3] = p.stretch;
      L[n] = p;
      n++;
    }
    L.length = n;
    this.mesh.geometry.instanceCount = n;
    this.offset.needsUpdate = this.color.needsUpdate = this.data.needsUpdate = true;
  }

  clear() {
    this.list.length = 0;
    this.mesh.geometry.instanceCount = 0;
  }
}

/** A single looping flipbook billboard that can be parented to moving scenery (lantern flames etc.). */
export function flipbookSprite(texture, cols, rows, frames, { fps = 30, size = 1, color = 0xffffff, additive = true } = {}) {
  const tex = texture.clone();
  tex.repeat.set(1 / cols, 1 / rows);
  const mat = new THREE.SpriteMaterial({
    map: tex, color, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  const start = Math.random() * frames;
  sprite.userData.tick = (t) => {
    const f = Math.floor(start + t * fps) % frames;
    tex.offset.set((f % cols) / cols, 1 - (Math.floor(f / cols) + 1) / rows);
  };
  return sprite;
}

// ---------------------------------------------------------------- presets

const rand = (a, b) => a + Math.random() * (b - a);
const V = (x, y, z) => ({ x, y, z });

export class Vfx {
  constructor(scene, textures) {
    const T = textures;
    this.sys = {
      glow: new ParticleSystem(scene, T.spotlight_01, { max: 400 }),
      star: new ParticleSystem(scene, T.star_07, { max: 300 }),
      flare: new ParticleSystem(scene, T.flare_01, { max: 100 }),
      trace: new ParticleSystem(scene, T.trace_01, { max: 120 }),
      snow: new ParticleSystem(scene, T.circle_05, { additive: false, max: 300 }),
      puff: new ParticleSystem(scene, T.cloud, { cols: 8, rows: 8, frames: 64, additive: false, max: 80 }),
      burst: new ParticleSystem(scene, T.star_explosion, { cols: 6, rows: 5, frames: 26, max: 40, renderOrder: 12 }),
      impact: new ParticleSystem(scene, T.impact_white, { cols: 6, rows: 4, frames: 15, max: 8, renderOrder: 13, depthTest: false }),
      hit: new ParticleSystem(scene, T.big_hit, { cols: 6, rows: 5, frames: 12, max: 8, renderOrder: 13, depthTest: false }),
      ring: new ParticleSystem(scene, T.electric_ring, { cols: 6, rows: 5, frames: 30, max: 8, renderOrder: 12 }),
      twirl: new ParticleSystem(scene, T.twirl_01, { max: 20 }),
      magic: new ParticleSystem(scene, T.magic_05, { max: 60 }),
    };
    this.moteTimer = 0;
    this.speedTimer = 0;
  }

  update(dt, worldDz) {
    for (const s of Object.values(this.sys)) s.update(dt, worldDz);
  }

  clear() {
    for (const s of Object.values(this.sys)) s.clear();
  }

  /** Golden sparkle burst when a peanut is collected. */
  pickup(pos) {
    const { burst, star, glow } = this.sys;
    burst.spawn({ pos: V(pos.x, pos.y, pos.z + 0.3), life: 0.55, size: 2.4, sizeEnd: 3.2, color: 0xffd36b, alpha: 1, alphaEnd: 0.6, rot: 0, scroll: true });
    glow.spawn({ pos: V(pos.x, pos.y, pos.z), life: 0.35, size: 2.6, sizeEnd: 0.4, color: 0xffc04d, alpha: 1, alphaEnd: 0 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      star.spawn({
        pos: V(pos.x, pos.y, pos.z),
        vel: V(Math.cos(a) * rand(2, 3.5), Math.sin(a) * rand(2, 3.5) + 1.5, rand(-0.5, 0.5)),
        life: rand(0.4, 0.7), size: rand(0.35, 0.6), sizeEnd: 0.05, color: pick([0xffe08a, 0xffffff, 0xffb84d]),
        gravity: -6, drag: 2.5, spin: rand(-6, 6),
      });
    }
  }

  /** Snow puff at the feet (jump take-off and landing). */
  puff(pos, big = false) {
    const n = big ? 6 : 4;
    for (let i = 0; i < n; i++) {
      this.sys.puff.spawn({
        pos: V(pos.x + rand(-0.35, 0.35), pos.y + 0.15, pos.z + rand(-0.2, 0.3)),
        vel: V(rand(-1.4, 1.4), rand(0.4, 1.4), rand(0.5, 1.5)),
        life: rand(0.45, 0.7), size: rand(0.5, 0.8), sizeEnd: big ? 1.8 : 1.3,
        color: 0xf2f6ff, alpha: 0.8, alphaEnd: 0, drag: 3, fps: rand(50, 80), frame: rand(0, 20),
      });
    }
    if (big) {
      for (let i = 0; i < 10; i++) this.snowChunk(pos, 3.5);
    }
  }

  snowChunk(pos, power = 2.5) {
    this.sys.snow.spawn({
      pos: V(pos.x + rand(-0.3, 0.3), pos.y + 0.1, pos.z + rand(-0.1, 0.3)),
      vel: V(rand(-1, 1) * power * 0.6, rand(0.6, 1) * power, rand(0.2, 1) * power * 0.5),
      life: rand(0.35, 0.6), size: rand(0.06, 0.14), sizeEnd: 0.03, color: 0xffffff, alpha: 1, alphaEnd: 0.2, gravity: -14,
    });
  }

  /** Continuous spray while sliding. */
  slideSpray(pos, dt) {
    const n = Math.ceil(60 * dt);
    for (let i = 0; i < n; i++) this.snowChunk(pos, 2.8);
    if (Math.random() < 30 * dt) {
      this.sys.puff.spawn({
        pos: V(pos.x + rand(-0.3, 0.3), 0.15, pos.z + 0.3), vel: V(rand(-0.6, 0.6), rand(0.3, 0.8), 2),
        life: 0.5, size: 0.4, sizeEnd: 1.1, color: 0xf2f6ff, alpha: 0.6, alphaEnd: 0, drag: 2, fps: 60, frame: rand(0, 30),
      });
    }
  }

  /** Streak left behind when changing lanes. */
  laneStreak(from, dir) {
    for (let i = 0; i < 3; i++) {
      this.sys.trace.spawn({
        pos: V(from.x, from.y + 0.5 + i * 0.35, from.z + 0.2),
        vel: V(-dir * 2, 0, 0), life: 0.22, size: 0.5, sizeEnd: 0.2, stretch: 2.2, rot: Math.PI / 2,
        color: 0xbfe6ff, alpha: 0.7, alphaEnd: 0,
      });
    }
  }

  /** Blue magic ring + streaks on a speed-up. */
  levelUp(pos) {
    this.sys.ring.spawn({ pos: V(pos.x, pos.y + 1, pos.z), life: 0.7, size: 2.6, sizeEnd: 4, color: 0xffffff, alpha: 1, alphaEnd: 0.4, rot: 0 });
    this.sys.twirl.spawn({ pos: V(pos.x, pos.y + 1, pos.z), life: 0.6, size: 1.5, sizeEnd: 3.5, color: 0x8fd8ff, alpha: 0.9, alphaEnd: 0, spin: 8 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.sys.magic.spawn({
        pos: V(pos.x + Math.cos(a) * 0.6, pos.y + 1 + Math.sin(a) * 0.6, pos.z),
        vel: V(Math.cos(a) * 3, Math.sin(a) * 3, 0), life: 0.6, size: 0.45, sizeEnd: 0, color: 0xa6e3ff, drag: 2, spin: 5,
      });
    }
  }

  /** Big white impact on crash. */
  crash(pos) {
    this.sys.impact.spawn({ pos: V(pos.x, pos.y + 1, pos.z - 0.4), life: 0.45, size: 3.6, sizeEnd: 4.5, color: 0xffffff, alpha: 1, alphaEnd: 0.8, rot: rand(0, 6.28), scroll: false });
    this.sys.hit.spawn({ pos: V(pos.x, pos.y + 1, pos.z - 0.5), life: 0.5, size: 3, sizeEnd: 4, color: 0xffe6b0, alpha: 1, alphaEnd: 0.7, rot: rand(0, 6.28), scroll: false });
    for (let i = 0; i < 18; i++) {
      this.sys.star.spawn({
        pos: V(pos.x, pos.y + 1, pos.z - 0.3), vel: V(rand(-5, 5), rand(1, 6), rand(-1, 3)),
        life: rand(0.4, 0.8), size: rand(0.25, 0.5), sizeEnd: 0, color: 0xffffff, gravity: -10, drag: 1.5, spin: rand(-8, 8), scroll: false,
      });
    }
    for (let i = 0; i < 16; i++) this.snowChunk({ x: pos.x, y: pos.y + 0.6, z: pos.z - 0.3 }, 5);
  }

  /** Ambient: floating golden motes and, at high speed, wind streaks past the camera. */
  ambient(dt, player, speedRatio) {
    this.moteTimer -= dt;
    while (this.moteTimer < 0) {
      this.moteTimer += 0.06;
      this.sys.glow.spawn({
        pos: V(player.x + rand(-9, 9), rand(0.4, 5), rand(-45, -5)),
        vel: V(rand(-0.2, 0.2), rand(0.1, 0.4), 0), life: rand(2.5, 4), size: rand(0.12, 0.3), sizeEnd: 0.05,
        color: pick([0xffd48a, 0xffe9b8, 0xfff3d6]), alpha: 0.9, alphaEnd: 0,
      });
    }
    if (speedRatio > 1.25) {
      this.speedTimer -= dt * (speedRatio - 1.1) * 3;
      while (this.speedTimer < 0) {
        this.speedTimer += 0.05;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.sys.trace.spawn({
          pos: V(player.x + side * rand(2.2, 4), rand(0.5, 4), rand(-14, -6)),
          vel: V(0, 0, 30), life: 0.35, size: 0.18, sizeEnd: 0.18, stretch: 9, rot: 0,
          color: 0xdff2ff, alpha: 0.45, alphaEnd: 0, scroll: false,
        });
      }
    }
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const VFX_TEXTURES = [
  'star_07', 'flare_01', 'trace_01', 'circle_05', 'spotlight_01', 'magic_05', 'twirl_01',
  'cloud', 'star_explosion', 'impact_white', 'big_hit', 'electric_ring', 'flame',
];

export async function loadVfxTextures(manager) {
  const loader = new THREE.TextureLoader(manager);
  const entries = await Promise.all(VFX_TEXTURES.map(async (name) => {
    const tex = await loader.loadAsync(`/assets/vfx/${name}.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    return [name, tex];
  }));
  return Object.fromEntries(entries);
}
