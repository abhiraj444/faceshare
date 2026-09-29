import type { CropResult, Landmark } from "./types";
import { IDX } from "./landmarks";
import { clamp } from "./math";

export interface DepthResult {
  depth: Float32Array;
  confidence: Float32Array;
}

/**
 * Distortion Guard:
 * Analyzes second-order discrete curvature (Laplacian ∇²Z) to detect and suppress
 * unnatural ballooning on flat surfaces.
 */
export function applyDistortionGuard(
  depth: Float32Array,
  w: number,
  h: number,
  maxCurvature = 0.045,
): Float32Array {
  const out = new Float32Array(depth);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const c = depth[idx]!;
      const l = depth[idx - 1]!;
      const r = depth[idx + 1]!;
      const u = depth[idx - w]!;
      const d = depth[idx + w]!;

      const laplacian = l + r + u + d - 4 * c;

      if (laplacian < -maxCurvature) {
        out[idx] = c + (laplacian + maxCurvature) * 0.35;
      } else if (laplacian > maxCurvature) {
        out[idx] = c + (laplacian - maxCurvature) * 0.25;
      }
    }
  }
  return out;
}

/**
 * Fast O(N) box blur on Float32Array.
 */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    const count = 2 * r + 1;
    for (let x = -r; x <= r; x++) {
      sum += src[row + clamp(x, 0, w - 1)]!;
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / count;
      const left = src[row + clamp(x - r, 0, w - 1)]!;
      const right = src[row + clamp(x + r + 1, 0, w - 1)]!;
      sum += right - left;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    const count = 2 * r + 1;
    for (let y = -r; y <= r; y++) {
      sum += tmp[clamp(y, 0, h - 1) * w + x]!;
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / count;
      const top = tmp[clamp(y - r, 0, h - 1) * w + x]!;
      const bot = tmp[clamp(y + r + 1, 0, h - 1) * w + x]!;
      sum += bot - top;
    }
  }

  return out;
}

/**
 * Fast O(N) Guided Filter for edge-preserving depth alignment.
 */
export function guidedFilter(
  guide: Float32Array,
  src: Float32Array,
  w: number,
  h: number,
  r = 8,
  eps = 1e-3,
): Float32Array {
  const n = w * h;
  const meanI = boxBlur(guide, w, h, r);
  const meanP = boxBlur(src, w, h, r);

  const guideSq = new Float32Array(n);
  const guideP = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    guideSq[i] = guide[i]! * guide[i]!;
    guideP[i] = guide[i]! * src[i]!;
  }

  const corrI = boxBlur(guideSq, w, h, r);
  const corrIP = boxBlur(guideP, w, h, r);

  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = Math.max(0, corrI[i]! - meanI[i]! * meanI[i]!);
    const covIP = corrIP[i]! - meanI[i]! * meanP[i]!;
    const aVal = covIP / (varI + eps);
    a[i] = aVal;
    b[i] = meanP[i]! - aVal * meanI[i]!;
  }

  const meanA = boxBlur(a, w, h, r);
  const meanB = boxBlur(b, w, h, r);

  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    q[i] = meanA[i]! * guide[i]! + meanB[i]!;
  }

  return q;
}

/**
 * P2.2 Silhouette Inflation Prior (Pillow profile with shoulder roll-off).
 */
export function computeSilhouetteInflation(
  mask: Float32Array,
  w: number,
  h: number,
  chinY?: number,
): Float32Array {
  const n = w * h;
  const dist = new Float32Array(n).fill(9999);

  // Two-pass distance transform approximation
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (mask[idx]! < 0.3) {
        dist[idx] = 0;
      } else {
        let minD = dist[idx]!;
        if (x > 0) minD = Math.min(minD, dist[idx - 1]! + 1);
        if (y > 0) minD = Math.min(minD, dist[idx - w]! + 1);
        dist[idx] = minD;
      }
    }
  }

  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const idx = row + x;
      let minD = dist[idx]!;
      if (x < w - 1) minD = Math.min(minD, dist[idx + 1]! + 1);
      if (y < h - 1) minD = Math.min(minD, dist[idx + w]! + 1);
      dist[idx] = minD;
    }
  }

  let maxD = 1;
  for (let i = 0; i < n; i++) {
    if (dist[i]! < 9999 && dist[i]! > maxD) maxD = dist[i]!;
  }

  const out = new Float32Array(n);
  const refChinY = chinY ?? h * 0.65;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const shoulderFactor = y > refChinY ? clamp(1.0 - 0.5 * ((y - refChinY) / (h - refChinY)), 0.4, 1.0) : 1.0;

    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const d = clamp(dist[idx]! / maxD, 0, 1);
      // Sqrt rounded pillow profile
      out[idx] = Math.sqrt(d) * 0.45 * shoulderFactor * (mask[idx] ?? 1.0);
    }
  }

  return out;
}

/**
 * P2.1 Robust Fit-Based Depth Fusion (MediaPipe rigid face mesh + Depth Anything V2 neural map).
 */
export function fuseDepth(args: {
  meshZ: Float32Array;
  neural: Float32Array;
  landmarks: Landmark[] | null;
  faceMask: Float32Array;
  subjectMask: Float32Array;
  w: number;
  h: number;
  guide?: Float32Array;
}): Float32Array {
  const { meshZ, neural, landmarks, faceMask, subjectMask, w, h, guide } = args;
  const n = w * h;

  // 1. Guided filter to eliminate neural edge dilation
  const lumaGuide = guide ?? new Float32Array(n).fill(0.5);
  const filteredNeural = guidedFilter(lumaGuide, neural, w, h, 8, 1e-3);

  if (!landmarks || landmarks.length < 50) {
    // Non-face subject: normalize neural map with distortion guard
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = filteredNeural[i]! * (subjectMask[i] ?? 1);
    return applyDistortionGuard(out, w, h, 0.045);
  }

  // 2. Sample paired depths (z_mesh vs d_neural) at landmark coordinates
  let sumN = 0;
  let sumZ = 0;
  let sumNN = 0;
  let sumNZ = 0;
  let validCount = 0;

  for (const lm of landmarks) {
    const lx = Math.round(lm.x);
    const ly = Math.round(lm.y);
    if (lx < 0 || lx >= w || ly < 0 || ly >= h) continue;
    const idx = ly * w + lx;
    const zM = meshZ[idx] ?? 0;
    const zN = filteredNeural[idx] ?? 0;
    sumN += zN;
    sumZ += zM;
    sumNN += zN * zN;
    sumNZ += zN * zM;
    validCount++;
  }

  // Affine fit: z ≈ a * d + b
  let a = 1.0;
  let b = 0.0;
  if (validCount > 10) {
    const denom = validCount * sumNN - sumN * sumN;
    if (Math.abs(denom) > 1e-5) {
      a = (validCount * sumNZ - sumN * sumZ) / denom;
      b = (sumZ - a * sumN) / validCount;
    }
  }

  if (a <= 0) {
    a = 0.8;
    b = 0.1;
  }

  // 3. Residual Blending: Z = D_fit + wf * (Z_mesh - D_fit)
  const fused = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dFit = a * filteredNeural[i]! + b;
    const zM = meshZ[i]!;
    const wf = clamp(faceMask[i] ?? 0, 0, 1);
    fused[i] = clamp(dFit + wf * (zM - dFit), 0, 1) * (0.2 + 0.8 * (subjectMask[i] ?? 1));
  }

  return applyDistortionGuard(fused, w, h, 0.045);
}

/**
 * Standard 468-point 3D Face Mesh Depth with cranium dome and distortion guard.
 */
export function meshDomeDepth(crop: CropResult): Float32Array {
  const { width: w, height: h, landmarks, mask, iod } = crop;
  const depth = new Float32Array(w * h);

  const cx = w * 0.5;
  let cy = h * 0.45;
  let rx = w * 0.38;
  let ry = h * 0.48;
  if (landmarks && landmarks[IDX.forehead] && landmarks[IDX.chin]) {
    const top = landmarks[IDX.forehead]!;
    const chin = landmarks[IDX.chin]!;
    const crownY = Math.max(0.06 * h, top.y - iod * 1.35);
    cy = (chin.y + crownY) * 0.5;
    ry = Math.max((chin.y - crownY) * 0.62, h * 0.44);
    rx = Math.max(iod * 1.6, w * 0.36);
  }

  const relief = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  let hasRelief = false;

  if (landmarks && landmarks.length > 10) {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of landmarks) {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const range = Math.max(1e-4, maxZ - minZ);

    const radius = Math.max(6, iod * 0.22);
    const r2 = radius * radius;

    for (let lIdx = 0; lIdx < landmarks.length; lIdx++) {
      const p = landmarks[lIdx]!;
      const normZ = clamp(1.0 - (p.z - minZ) / range, 0.0, 1.0);
      const val = normZ * 0.85 + 0.15;
      const x0 = p.x | 0;
      const y0 = p.y | 0;
      const rad = radius | 0;

      for (let y = y0 - rad; y <= y0 + rad; y++) {
        if (y < 0 || y >= h) continue;
        const dy = y - p.y;
        for (let x = x0 - rad; x <= x0 + rad; x++) {
          if (x < 0 || x >= w) continue;
          const dx = x - p.x;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;

          const g = Math.exp(-d2 / (r2 * 0.45));
          const idx = y * w + x;
          relief[idx] += val * g;
          weight[idx] += g;
        }
      }
    }

    for (let i = 0; i < w * h; i++) {
      if (weight[i]! > 1e-4) relief[i] /= weight[i]!;
    }
    hasRelief = true;
  }

  // Ellipsoid dome
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const dy = (y - cy) / ry;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const dx = (x - cx) / rx;
      const distSq = dx * dx + dy * dy;
      const dome = distSq < 1.0 ? Math.sqrt(1.0 - distSq) : 0.0;
      let dVal = dome * 0.65;
      if (hasRelief) {
        const wRelief = clamp(weight[idx]!, 0, 1);
        dVal = dVal * (1 - wRelief) + relief[idx]! * wRelief;
      }
      depth[idx] = clamp(dVal, 0, 1) * (mask[idx] ?? 1.0);
    }
  }

  return applyDistortionGuard(depth, w, h, 0.045);
}
