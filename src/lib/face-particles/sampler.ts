import type { CropResult, ParticleSet } from "./types";
import type { WeightMaps } from "./weights";
import { N_MAX } from "./config";
import { blueAt, getBlueNoise } from "./blue-noise";
import { clamp, hash21 } from "./math";

export function sample(
  maps: WeightMaps,
  depth: Float32Array,
  crop: CropResult,
  nMax = N_MAX,
): ParticleSet {
  const { width: w, height: h, weight, tone } = maps;
  const noise = getBlueNoise();
  const nPix = w * h;

  const keys = new Uint16Array(nPix);
  const index = new Uint32Array(nPix);
  let n = 0;
  for (let i = 0; i < nPix; i++) {
    const wv = weight[i]!;
    if (wv < 0.001) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const t = Math.max(1e-5, blueAt(noise, x, y));
    const r = t / (t + Math.max(1e-5, wv));
    keys[n] = Math.min(65535, (r * 65535) | 0);
    index[n] = i;
    n++;
  }

  const counts = new Uint32Array(65536);
  for (let i = 0; i < n; i++) counts[keys[i]!]++;
  let sum = 0;
  for (let i = 0; i < 65536; i++) {
    const c = counts[i]!;
    counts[i] = sum;
    sum += c;
  }
  const sorted = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const k = keys[i]!;
    sorted[counts[k]!] = index[i]!;
    counts[k]++;
  }

  const count = Math.min(nMax, n > 0 ? nMax : 0);
  const home = new Float32Array(count * 3);
  const restZ = new Float32Array(count);
  const toneOut = new Uint8Array(count);
  const seed = new Float32Array(count);
  const color = new Uint8Array(count * 3);
  const semantic = new Uint8Array(count);
  const size = new Uint8Array(count);
  const normal = new Int8Array(count * 2);

  const px = crop.imageData.data;
  const aspect = h / w;
  const srcSemantics = maps.semantics;

  // Compute normals
  const gradScale = 2.5;
  const normalsX = new Float32Array(nPix);
  const normalsY = new Float32Array(nPix);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      const dzdx = (depth[idx + 1]! - depth[idx - 1]!) * 0.5 * gradScale;
      const dzdy = (depth[idx + w]! - depth[idx - w]!) * 0.5 * gradScale * aspect;
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1.0);
      normalsX[idx] = -dzdx / len;
      normalsY[idx] = -dzdy / len;
    }
  }

  for (let i = 0; i < count; i++) {
    const sortedIdx = n > 0 ? i % n : 0;
    const pi = sorted[sortedIdx]!;
    const x = pi % w;
    const y = (pi / w) | 0;
    const pass = n > 0 ? (i / n) | 0 : 0;

    const jx = hash21(x + 0.3 + pass * 3.7, y + 1.7 + pass * 7.1) - 0.5;
    const jy = hash21(x + 9.1 + pass * 5.3, y + 4.2 + pass * 2.9) - 0.5;

    const wx = ((x + jx + 0.5) / w) * 2 - 1;
    const wy = -(((y + jy + 0.5) / h) * 2 - 1) * aspect;
    const z01 = depth[pi] ?? 0;
    const wz = (z01 - 0.30) * 0.65;

    home[i * 3] = wx;
    home[i * 3 + 1] = wy;
    home[i * 3 + 2] = wz;
    restZ[i] = wz;

    toneOut[i] = clampByte((tone[pi] ?? 0) * 255);
    seed[i] = hash21(x + 21.3 + pass * 11.7, y + 8.9 + pass * 13.1);

    // 100% Authentic Camera Sensor Color (Direct 24-bit sRGB)
    const p = pi * 4;
    color[i * 3] = px[p]!;
    color[i * 3 + 1] = px[p + 1]!;
    color[i * 3 + 2] = px[p + 2]!;

    size[i] = 128; // Crisp 1.0x point size

    const nx = clamp(normalsX[pi] ?? 0, -1, 1);
    const ny = clamp(normalsY[pi] ?? 0, -1, 1);
    normal[i * 2] = Math.round(nx * 127);
    normal[i * 2 + 1] = Math.round(ny * 127);

    semantic[i] = srcSemantics ? srcSemantics[pi]! : 0;
  }

  return {
    count,
    home,
    restZ,
    tone: toneOut,
    seed,
    color,
    semantic,
    size,
    normal,
    focusZ: 0.0,
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export function makeCloud(count = 40_000): ParticleSet {
  const home = new Float32Array(count * 3);
  const restZ = new Float32Array(count);
  const tone = new Uint8Array(count);
  const seed = new Float32Array(count);
  const color = new Uint8Array(count * 3);
  const semantic = new Uint8Array(count);
  const size = new Uint8Array(count).fill(128);
  const normal = new Int8Array(count * 2);

  for (let i = 0; i < count; i++) {
    const u = hash21(i, 1.2);
    const v = hash21(i, 7.7);
    const w = hash21(i, 13.3);
    const th = u * Math.PI * 2;
    const ph = (v - 0.5) * Math.PI;
    const r = 0.4 + w * 0.55;
    home[i * 3] = Math.cos(th) * Math.cos(ph) * r;
    home[i * 3 + 1] = Math.sin(ph) * r * 1.2;
    home[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r * 0.55;
    restZ[i] = home[i * 3 + 2]!;
    tone[i] = clampByte((0.35 + 0.65 * w) * 255);
    seed[i] = hash21(i * 1.7 + 0.3, i * 2.3 + 0.7);
    color[i * 3] = 230;
    color[i * 3 + 1] = 235;
    color[i * 3 + 2] = 245;
    semantic[i] = 0;
  }
  return { count, home, restZ, tone, seed, color, semantic, size, normal, focusZ: 0.0 };
}

export function applyDepthScale(set: ParticleSet, scale: number): void {
  const s = Math.max(0, scale);
  const n = set.count;
  const home = set.home;
  const restZ = set.restZ;
  for (let i = 0; i < n; i++) {
    const z = restZ[i]! * s;
    home[i * 3 + 2] = z;
  }
}
