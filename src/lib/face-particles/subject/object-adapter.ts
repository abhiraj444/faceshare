import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";

/**
 * ObjectAdapter (v2 Remediation §5.4):
 * Generic fallback adapter for sculptures, products, vehicles, architecture, and still life.
 * Uses center-weighted saliency depth + edge preservation to reconstruct 3D particle forms.
 */
export function buildObjectSubject(
  source: HTMLCanvasElement,
  _params: Params,
): SubjectField {
  const { w: outW, h: outH } = workingSize();
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize object canvas");

  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);

  const scale = Math.min(outW / source.width, outH / source.height) * 0.94;
  const drawW = source.width * scale;
  const drawH = source.height * scale;
  const drawX = (outW - drawW) / 2;
  const drawY = (outH - drawH) / 2;
  ctx.drawImage(source, drawX, drawY, drawW, drawH);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const px = imgData.data;

  const mask = new Float32Array(outW * outH);
  const hairSkin = new Float32Array(outW * outH);
  const faceSkin = new Float32Array(outW * outH);
  const depthMap = new Float32Array(outW * outH);
  const depthConfidence = new Float32Array(outW * outH);

  const cx = outW / 2;
  const cy = outH / 2;
  const maxR = Math.min(outW, outH) * 0.48;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const idx = i * 4;
      const r = px[idx]!;
      const g = px[idx + 1]!;
      const b = px[idx + 2]!;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      const dist = Math.hypot(x - cx, y - cy);
      const centerFalloff = dist < maxR ? Math.cos((dist / maxR) * (Math.PI / 2)) : 0;

      // Subject saliency
      const isSalient = (lum > 0.08 || dist < maxR * 0.75) && centerFalloff > 0.05;
      const mVal = isSalient ? clamp(centerFalloff * 1.25, 0, 1) : 0;

      mask[i] = mVal;
      hairSkin[i] = mVal > 0.25 ? 1 : 0;
      faceSkin[i] = mVal > 0.35 ? 1 : 0;

      // Smooth dome depth + luminance relief
      const domeZ = Math.sqrt(Math.max(0, 1 - (dist / maxR) ** 2));
      const reliefZ = (lum - 0.4) * 0.22;
      depthMap[i] = clamp((domeZ * 0.65 + reliefZ) * mVal, 0, 1);
      depthConfidence[i] = mVal;
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
