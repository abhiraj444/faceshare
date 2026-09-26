import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";
import { cleanBackgroundAndIsolateSubject } from "../background-cleaner";

/**
 * ObjectAdapter:
 * Universal adapter for sculptures, products, still life, and miscellaneous objects.
 * Cleans the background (table, floor, room, walls), isolates the main subject,
 * and generates 3D volumetric depth with edge preservation.
 */
export function buildObjectSubject(
  source: HTMLCanvasElement,
  _params: Params,
): SubjectField {
  const { w: outW, h: outH } = workingSize();

  // Run comprehensive background cleaner to isolate the object from environment
  const bgClean = cleanBackgroundAndIsolateSubject(source);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize object canvas");

  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);

  const scale = Math.min(outW / source.width, outH / source.height) * 0.92;
  const drawW = Math.round(source.width * scale);
  const drawH = Math.round(source.height * scale);
  const drawX = Math.round((outW - drawW) / 2);
  const drawY = Math.round((outH - drawH) / 2);

  ctx.drawImage(bgClean.cleanedCanvas, drawX, drawY, drawW, drawH);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const px = imgData.data;

  const mask = new Float32Array(outW * outH);
  const hairSkin = new Float32Array(outW * outH);
  const faceSkin = new Float32Array(outW * outH);
  const depthMap = new Float32Array(outW * outH);
  const depthConfidence = new Float32Array(outW * outH);

  const srcW = source.width;
  const srcH = source.height;

  for (let dy = 0; dy < drawH; dy++) {
    const y = drawY + dy;
    if (y < 0 || y >= outH) continue;
    const sy = Math.min(srcH - 1, Math.max(0, Math.floor(dy / scale)));

    for (let dx = 0; dx < drawW; dx++) {
      const x = drawX + dx;
      if (x < 0 || x >= outW) continue;
      const sx = Math.min(srcW - 1, Math.max(0, minXorClamp(dx, scale, srcW)));

      const mVal = bgClean.mask[sy * srcW + sx] ?? 0;
      const i = y * outW + x;

      mask[i] = mVal;
      hairSkin[i] = mVal > 0.2 ? 1 : 0;
      faceSkin[i] = mVal > 0.35 ? 1 : 0;
    }
  }

  const cx = outW / 2;
  const cy = outH / 2;
  const maxR = Math.min(outW, outH) * 0.48;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const m = mask[i]!;

      if (m < 0.04) {
        depthMap[i] = 0;
        depthConfidence[i] = 0;
        continue;
      }

      const idx = i * 4;
      const r = px[idx]!;
      const g = px[idx + 1]!;
      const b = px[idx + 2]!;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const dist = Math.hypot(x - cx, y - cy);
      // Smooth dome depth + luminance relief
      const domeZ = Math.sqrt(Math.max(0, 1 - (dist / maxR) ** 2));
      const reliefZ = (lum - 0.4) * 0.22;
      depthMap[i] = clamp((domeZ * 0.65 + reliefZ) * m, 0, 1);
      depthConfidence[i] = m;
    }
  }

  const crop: CropResult = {
    canvas,
    imageData: imgData,
    width: outW,
    height: outH,
    landmarks: null,
    mask,
    hairSkin,
    faceSkin,
    iod: maxR * 0.5,
    hasFace: false,
  };

  return {
    subjectType: "object",
    width: outW,
    height: outH,
    depthMap,
    depthConfidence,
    segMask: mask,
    colorMap: px,
    controlPoints: [
      { x: cx, y: cy, z: 0.6, group: "object_center" },
      { x: cx - maxR * 0.5, y: cy, z: 0.4, group: "object_left" },
      { x: cx + maxR * 0.5, y: cy, z: 0.4, group: "object_right" },
    ],
    boundingBox: {
      x: cx - maxR,
      y: cy - maxR,
      w: maxR * 2,
      h: maxR * 2,
      rollDeg: 0,
    },
    crop,
  };
}

function minXorClamp(dx: number, scale: number, maxW: number): number {
  return Math.min(maxW - 1, Math.max(0, Math.floor(dx / scale)));
}

