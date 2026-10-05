// Road shape: turns, climbs and descents.
//
// Gameplay stays on a straight three-lane track (simple, fair collisions), while every
// world vertex is displaced in the vertex shader by how far ahead of the runner it is.
// A procedural "road plan" of segments (straight, left/right bend, climb, crest, dip)
// gives the bend; the CPU integrates it each frame into a small offset table that all
// shaders read. Offsets are relative to the runner's position and heading, so the road
// right under the runner is always straight and level.
import * as THREE from 'three';

const SAMPLES = 33;      // offsets for 0, 4, 8 … 128 units ahead
const STEP = 4;

export const curveUniforms = {
  uCurveX: { value: new Float32Array(SAMPLES) },
  uCurveH: { value: new Float32Array(SAMPLES) },
  uCurve0: { value: new THREE.Vector2() },   // curvature at the runner (used behind the camera)
};

export const CURVE_GLSL = /* glsl */ `
  uniform float uCurveX[${SAMPLES}];
  uniform float uCurveH[${SAMPLES}];
  uniform vec2 uCurve0;
  vec3 curveOffset(float z) {
    float d = -z;
    if (d <= 0.0) return vec3(0.5 * uCurve0.x * d * d, 0.5 * uCurve0.y * d * d, 0.0);
    float f = d / ${STEP.toFixed(1)};
    if (f >= ${(SAMPLES - 1).toFixed(1)}) {
      float sx = uCurveX[${SAMPLES - 1}] - uCurveX[${SAMPLES - 2}];
      float sh = uCurveH[${SAMPLES - 1}] - uCurveH[${SAMPLES - 2}];
      float e = f - ${(SAMPLES - 1).toFixed(1)};
      return vec3(uCurveX[${SAMPLES - 1}] + sx * e, uCurveH[${SAMPLES - 1}] + sh * e, 0.0);
    }
    int i = int(floor(f));
    float t = f - float(i);
    return vec3(mix(uCurveX[i], uCurveX[i + 1], t), mix(uCurveH[i], uCurveH[i + 1], t), 0.0);
  }
`;

// ---------------------------------------------------------------- material patching

const patched = new WeakSet();

function patchShader(shader, isSprite) {
  Object.assign(shader.uniforms, curveUniforms);
  shader.vertexShader = shader.vertexShader.replace('void main() {', `${CURVE_GLSL}\nvoid main() {`);
  if (isSprite) {
    shader.vertexShader = shader.vertexShader.replace(
      'vec4 mvPosition = modelViewMatrix[ 3 ];',
      'vec4 cwp = modelMatrix[ 3 ]; cwp.xyz += curveOffset( cwp.z ); vec4 mvPosition = viewMatrix * cwp;',
    );
  } else {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition = modelMatrix * mvPosition;
      mvPosition.xyz += curveOffset( mvPosition.z );
      mvPosition = viewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
    // Shadow-map depth shaders compute a world position for point lights; keep them in sync.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      #if defined( USE_SHADOWMAP ) || defined( USE_ENVMAP ) || defined( DISTANCE )
        worldPosition.xyz += curveOffset( worldPosition.z );
      #endif`,
    );
  }
}

export function bendMaterial(mat) {
  if (!mat || patched.has(mat) || mat.isShaderMaterial) return mat;
  patched.add(mat);
  const prev = mat.onBeforeCompile;
  const isSprite = mat.isSpriteMaterial;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    patchShader(shader, isSprite);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `curve|${prevKey ? prevKey() : ''}`;
  mat.needsUpdate = true;
  return mat;
}

const depthMat = bendMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));

/** Patch every material under `root` (and give shadow casters a bent depth material). */
export function bendObject(root) {
  root.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(bendMaterial);
    if (o.isMesh && o.castShadow && !o.isSkinnedMesh && !o.customDepthMaterial) o.customDepthMaterial = depthMat;
  });
  return root;
}

// ---------------------------------------------------------------- road plan

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Generates segments lazily as the runner advances. Each segment has a length and a target
 * turn curvature (kx) and vertical curvature (ky); curvature eases between segments.
 */
export class RoadPlan {
  constructor() {
    this.reset();
  }

  reset() {
    this.segments = [{ start: 0, len: 70, kx: 0, ky: 0 }];   // a straight, flat start
    this.difficulty = 0;
    this.heading = 0;   // used only for gentle camera yaw
  }

  grow(until) {
    let last = this.segments.at(-1);
    while (last.start + last.len < until) {
      const d = Math.min(1, this.difficulty / 12);
      const kind = Math.random();
      const turn = (0.0035 + 0.0055 * d) * (Math.random() < 0.5 ? -1 : 1) * rand(0.6, 1);
      const hill = (0.0018 + 0.0022 * d) * (Math.random() < 0.5 ? -1 : 1) * rand(0.6, 1);
      let seg;
      if (kind < 0.18) seg = { kx: 0, ky: 0, len: rand(30, 60) };                 // straight
      else if (kind < 0.48) seg = { kx: turn, ky: 0, len: rand(45, 90) };          // bend
      else if (kind < 0.72) seg = { kx: 0, ky: hill, len: rand(40, 70) };          // climb / dip
      else seg = { kx: turn * 0.8, ky: hill * 0.8, len: rand(50, 90) };            // winding hill
      seg.start = last.start + last.len;
      this.segments.push(seg);
      last = seg;
    }
    // Drop segments far behind.
    while (this.segments.length > 2 && this.segments[1].start + this.segments[1].len < until - 400) this.segments.shift();
  }

  /** Curvature at track distance s, eased across 18 units at each segment boundary. */
  curvature(s) {
    const segs = this.segments;
    let i = segs.length - 1;
    while (i > 0 && segs[i].start > s) i--;
    const cur = segs[i];
    const prev = segs[i - 1] || cur;
    const t = smooth(Math.min(1, (s - cur.start) / 18));
    return [prev.kx + (cur.kx - prev.kx) * t, prev.ky + (cur.ky - prev.ky) * t];
  }

  /** Fill the shader offset tables for a runner at track distance s. */
  update(s, strength = 1) {
    this.grow(s + 200);
    const X = curveUniforms.uCurveX.value;
    const H = curveUniforms.uCurveH.value;
    // Double integration of curvature: offset(d) = ∫0..d (d-u)·k(s+u) du, sampled every unit.
    let x = 0, h = 0, vx = 0, vh = 0;
    X[0] = 0; H[0] = 0;
    for (let u = 0; u < (SAMPLES - 1) * STEP; u++) {
      const [kx, ky] = this.curvature(s + u + 0.5);
      vx += kx * strength; vh += ky * strength;
      x += vx; h += vh;
      if ((u + 1) % STEP === 0) {
        X[(u + 1) / STEP] = x;
        H[(u + 1) / STEP] = h;
      }
    }
    const [k0x, k0y] = this.curvature(s);
    curveUniforms.uCurve0.value.set(k0x * strength, k0y * strength);
    return { kx: k0x * strength, ky: k0y * strength };
  }
}

/** World-space offset for a point `d` units ahead (for CPU-side placement such as the camera target). */
export function offsetAhead(d) {
  const X = curveUniforms.uCurveX.value;
  const H = curveUniforms.uCurveH.value;
  const f = Math.min(SAMPLES - 1.001, Math.max(0, d / STEP));
  const i = Math.floor(f);
  const t = f - i;
  return { x: X[i] + (X[i + 1] - X[i]) * t, y: H[i] + (H[i + 1] - H[i]) * t };
}
