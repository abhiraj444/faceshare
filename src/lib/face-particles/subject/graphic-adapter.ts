import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";
import { cleanBackgroundAndIsolateSubject } from "../background-cleaner";

/**
 * GraphicAdapter:
 * Handles uploaded non-face graphics, handwriting, text photos, drawings, logos, signatures, and fingerprints.
 * Uses adaptive background subtraction with shadow removal to isolate foreground strokes/ridges,
 * perfectly centers the content with safety margins, and generates clean 3D extrusion relief
 * without any stray background or paper particles.
 */
export function buildGraphicSubject(
  source: HTMLCanvasElement,
  _params: Params,
): SubjectField {
  const { w: outW, h: outH } = workingSize();

  // Run comprehensive background cleaner to eliminate paper texture, scanner noise, and desk shadows
  const bgClean = cleanBackgroundAndIsolateSubject(source, { forceGraphic: true });
  const { minX, minY, maxX, maxY } = bgClean.subjectBounds;
  const fgW = Math.max(1, maxX - minX);
  const fgH = Math.max(1, maxY - minY);

  // Scale & Center Foreground safely within working canvas (max 70% width & height)
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize graphic canvas");

  // Deep obsidian gallery canvas
  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);

  const safeMaxW = outW * 0.70;
  const safeMaxH = outH * 0.70;
  const scale = Math.min(safeMaxW / fgW, safeMaxH / fgH);

  const drawW = Math.round(fgW * scale);
  const drawH = Math.round(fgH * scale);
  const drawX = Math.round((outW - drawW) / 2);
  const drawY = Math.round((outH - drawH) / 2);

  // Render centered cleaned foreground
  ctx.drawImage(
    bgClean.cleanedCanvas,
    minX, minY, fgW, fgH,
    drawX, drawY, drawW, drawH,
  );

  const outImgData = ctx.getImageData(0, 0, outW, outH);
  const outPx = outImgData.data;

  const mask = new Float32Array(outW * outH);
  const hairSkin = new Float32Array(outW * outH);
  const faceSkin = new Float32Array(outW * outH);
  const depthMap = new Float32Array(outW * outH);
  const depthConfidence = new Float32Array(outW * outH);
  const binary = new Uint8Array(outW * outH);

  // Map mask from cleaned source to centered destination
  const srcW = source.width;
  for (let dy = 0; dy < drawH; dy++) {
    const y = drawY + dy;
    if (y < 0 || y >= outH) continue;
    const sy = Math.min(source.height - 1, Math.max(0, minY + Math.floor(dy / scale)));

    for (let dx = 0; dx < drawW; dx++) {
      const x = drawX + dx;
      if (x < 0 || x >= outW) continue;
      const sx = Math.min(srcW - 1, Math.max(0, minX + Math.floor(dx / scale)));

      const srcMaskVal = bgClean.mask[sy * srcW + sx] ?? 0;
      if (srcMaskVal > 0.08) {
        const i = y * outW + x;
        binary[i] = 1;
        mask[i] = srcMaskVal;
        hairSkin[i] = srcMaskVal;
        faceSkin[i] = srcMaskVal;
        depthConfidence[i] = 1.0;
      }
    }
  }

  // Fast 2-pass Chamfer distance transform for rounded 3D bevel relief
  const dist = new Float32Array(outW * outH);
  const INF = 1e5;
  for (let i = 0; i < dist.length; i++) dist[i] = binary[i] ? INF : 0;

  for (let y = 1; y < outH; y++) {
    for (let x = 1; x < outW; x++) {
      const idx = y * outW + x;
      if (binary[idx]) {
        dist[idx] = Math.min(dist[idx]!, dist[idx - 1]! + 1, dist[idx - outW]! + 1);
      }
    }
  }
  for (let y = outH - 2; y >= 0; y--) {
    for (let x = outW - 2; x >= 0; x--) {
      const idx = y * outW + x;
      if (binary[idx]) {
        dist[idx] = Math.min(dist[idx]!, dist[idx + 1]! + 1, dist[idx + outW]! + 1);
      }
    }
  }

  const bevelRadius = Math.max(3, Math.round(Math.min(drawW, drawH) * 0.08));
  for (let i = 0; i < depthMap.length; i++) {
    if (binary[i]) {
      const dNorm = clamp(dist[i]! / bevelRadius, 0, 1);
      const zCurv = 0.5 * (1 - Math.cos(dNorm * Math.PI));
      depthMap[i] = (0.28 + 0.62 * zCurv) * mask[i]!;
    }
  }

  const crop: CropResult = {
    canvas,
    imageData: outImgData,
    width: outW,
    height: outH,
    landmarks: null,
    mask,
    hairSkin,
    faceSkin,
    iod: Math.min(drawW, drawH) * 0.4,
    hasFace: false,
  };

  const cx = drawX + drawW / 2;
  const cy = drawY + drawH / 2;

  return {
    subjectType: "object",
    width: outW,
    height: outH,
    depthMap,
    depthConfidence,
    segMask: mask,
    colorMap: outPx,
    controlPoints: [
      { x: cx, y: cy, z: 0.65, group: "graphic_center" },
      { x: drawX + drawW * 0.2, y: cy, z: 0.5, group: "graphic_left" },
      { x: drawX + drawW * 0.8, y: cy, z: 0.5, group: "graphic_right" },
    ],
    boundingBox: {
      x: drawX,
      y: drawY,
      w: drawW,
      h: drawH,
      rollDeg: 0,
    },
    crop,
  };
}

