import { featureGroups } from "./landmarks";
import { getFaceLandmarkerClass } from "./vision";
import { clamp } from "./math";
import type { CropResult, Params } from "./types";

export interface WeightMaps {
  weight: Float32Array;
  tone: Float32Array;
  width: number;
  height: number;
  semantics?: Uint8Array;
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp((-0.5 * i * i) / (sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return k;
}

export function blurChannel(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) >> 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = clamp(x + k, 0, w - 1);
        acc += src[y * w + xx]! * kernel[k + radius]!;
      }
      tmp[y * w + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = clamp(y + k, 0, h - 1);
        acc += tmp[yy * w + x]! * kernel[k + radius]!;
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

export function percentileMasked(src: Float32Array, mask: Float32Array, p: number): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    if ((mask[i] ?? 0) < 0.35) continue;
    hist[clamp((src[i]! * 255) | 0, 0, 255)]++;
    n++;
  }
  if (n < 16) {
    for (let i = 0; i < src.length; i++) hist[clamp((src[i]! * 255) | 0, 0, 255)]++;
    n = src.length;
  }
  const target = p * (n - 1);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc > target) return i / 255;
  }
  return 1;
}

export function dilate(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const out = new Float32Array(src);
  if (radius < 1) return out;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -radius; k <= radius; k++) m = Math.max(m, src[y * w + clamp(x + k, 0, w - 1)]!);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = -radius; k <= radius; k++) m = Math.max(m, tmp[clamp(y + k, 0, h - 1) * w + x]!);
      out[y * w + x] = m;
    }
  }
  return out;
}

function featureMap(crop: CropResult): Float32Array {
  const { width: w, height: h, landmarks, iod } = crop;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const out = new Float32Array(w * h);
  if (!ctx || !landmarks || landmarks.length < 80) return out;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const width = Math.max(2, iod * 0.06);
  const groups = featureGroups(getFaceLandmarkerClass());
  for (const g of groups) {
    ctx.lineWidth = g.name.includes("Iris") || g.name === "lips" ? width * 1.15 : width;
    ctx.beginPath();
    for (const c of g.connections) {
      const a = landmarks[c.start];
      const b = landmarks[c.end];
      if (!a || !b) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = data[p]! / 255;
  }
  return blurChannel(out, w, h, Math.max(1, iod * 0.018));
}

export function buildWeights(crop: CropResult, params: Params): WeightMaps {
  const { width: w, height: h, imageData, mask, hairSkin, faceSkin } = crop;
  const px = imageData.data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (0.2126 * px[p]! + 0.7152 * px[p + 1]! + 0.0722 * px[p + 2]!) / 255;
  }

  let hasHairSkin = false;
  for (let i = 0; i < hairSkin.length; i++) {
    if (hairSkin[i]! > 0.3) {
      hasHairSkin = true;
      break;
    }
  }
  const toneMask = hasHairSkin ? hairSkin : faceSkin;
  const p5 = percentileMasked(lum, toneMask, 0.03);
  const p95 = Math.max(p5 + 0.04, percentileMasked(lum, toneMask, 0.97));
  const tone = new Float32Array(w * h);
  const invRange = 1 / (p95 - p5);
  for (let i = 0; i < lum.length; i++) {
    let t = clamp((lum[i]! - p5) * invRange, 0, 1);
    if (params.invert) t = 1 - t;
    tone[i] = t;
  }

  const blurA = blurChannel(tone, w, h, 1.0);
  const blurB = blurChannel(tone, w, h, 1.6);
  const edges = new Float32Array(w * h);
  const edgeHist = new Uint32Array(256);
  for (let i = 0; i < edges.length; i++) {
    const e = clamp(Math.abs(blurA[i]! - blurB[i]!) * 6, 0, 1);
    edges[i] = e;
    edgeHist[(e * 255) | 0]++;
  }
  let edgeP95 = 0.2;
  {
    const target = 0.95 * (edges.length - 1);
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += edgeHist[i]!;
      if (acc > target) {
        edgeP95 = i / 255;
        break;
      }
    }
  }
  const edgeNorm = 1 / Math.max(0.04, edgeP95);
  for (let i = 0; i < edges.length; i++) edges[i] = clamp(edges[i]! * edgeNorm, 0, 1);

  const L = featureMap(crop);
  const dil = dilate(mask, w, h, 1);
  const maskSigma = Math.max(1.0, Math.min(w, h) * 0.006 * (0.5 + params.softness));
  const M = blurChannel(dil, w, h, maskSigma);

  const weight = new Float32Array(w * h);
  const gamma = params.contrast;
  const a = params.detail;
  const b = params.feature;
  const floor = params.floor;
  // Ensure balanced baseline particles across the subject without muddy densification
  const subjFloor = params.invert
    ? Math.min(floor, 0.05)
    : Math.max(0.02, floor);

  for (let i = 0; i < weight.length; i++) {
    // Feature & tone weighting: preserves high contrast between features and smooth regions
    let wv = Math.pow(Math.max(tone[i]!, 1e-5), gamma) * (1 + a * edges[i]!) * (1 + b * L[i]!);
    // Subtle shadow lift respecting user's floor parameter
    const subjectMask = Math.max(hairSkin[i] ?? 0, (faceSkin[i] ?? 0));
    wv = Math.max(wv, subjFloor * subjectMask * (1.0 + edges[i]! * 0.5));
    if (params.removeBg) {
      const m = M[i]!;
      // Clean background cutoff: completely erases particles from room/wall background
      wv = m < 0.04 ? 0 : wv * m;
    }
    weight[i] = wv;
  }

  const semantics = new Uint8Array(w * h);
  for (let i = 0; i < semantics.length; i++) {
    if (L[i]! > 0.15) {
      semantics[i] = 3; // Feature: eyes, brows, lips, irises
    } else if ((faceSkin[i] ?? 0) > 0.45) {
      semantics[i] = 2; // Facial skin / complexion
    } else if ((hairSkin[i] ?? 0) > 0.45) {
      semantics[i] = 1; // Hair
    } else {
      semantics[i] = 0; // Other / torso / clothing
    }
  }

  return { weight, tone, width: w, height: h, semantics };
}
