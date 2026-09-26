import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";

/**
 * GraphicAdapter:
 * Handles uploaded non-face graphics, handwriting, text photos, drawings, logos, and signatures.
 * Automatically analyzes background color (light or dark), extracts foreground subject bounds,
 * perfectly centers the content with comfortable safety margins to prevent overflow on mobile,
 * and generates clean 3D extrusion relief without stray background particles.
 */
export function buildGraphicSubject(
  source: HTMLCanvasElement,
  _params: Params,
): SubjectField {
  const { w: outW, h: outH } = workingSize();
  const srcW = source.width;
  const srcH = source.height;

  const srcCtx = source.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) throw new Error("Could not initialize source canvas context");
  const srcImgData = srcCtx.getImageData(0, 0, srcW, srcH);
  const srcPx = srcImgData.data;

  // Step 1: Sample borders of the source image to identify background color & luminance
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
  const sampleBorder = (x: number, y: number) => {
    const idx = (y * srcW + x) * 4;
    bgR += srcPx[idx]!;
    bgG += srcPx[idx + 1]!;
    bgB += srcPx[idx + 2]!;
    bgCount++;
  };

  const stepX = Math.max(1, Math.floor(srcW / 40));
  const stepY = Math.max(1, Math.floor(srcH / 40));
  for (let x = 0; x < srcW; x += stepX) {
    sampleBorder(x, 0);
    sampleBorder(x, srcH - 1);
  }
  for (let y = 0; y < srcH; y += stepY) {
    sampleBorder(0, y);
    sampleBorder(srcW - 1, y);
  }

  bgR = Math.round(bgR / Math.max(1, bgCount));
  bgG = Math.round(bgG / Math.max(1, bgCount));
  bgB = Math.round(bgB / Math.max(1, bgCount));
  const bgLum = (0.299 * bgR + 0.587 * bgG + 0.114 * bgB) / 255;
  const isLightBg = bgLum > 0.55;

  // Step 2: Find tight foreground bounding box
  let minX = srcW, minY = srcH, maxX = 0, maxY = 0;
  let fgPixelCount = 0;

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const idx = (y * srcW + x) * 4;
      const r = srcPx[idx]!;
      const g = srcPx[idx + 1]!;
      const b = srcPx[idx + 2]!;
      const a = srcPx[idx + 3]!;
      if (a < 30) continue;

      const dColor = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      const isForeground = dColor > 28;

      if (isForeground) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        fgPixelCount++;
      }
    }
  }

  // Fallback if no distinct foreground found: use central area
  if (fgPixelCount < 20 || minX >= maxX || minY >= maxY) {
    minX = Math.round(srcW * 0.15);
    maxX = Math.round(srcW * 0.85);
    minY = Math.round(srcH * 0.15);
    maxY = Math.round(srcH * 0.85);
  }

  const fgW = Math.max(1, maxX - minX);
  const fgH = Math.max(1, maxY - minY);

  // Step 3: Scale & Center Foreground safely within working canvas (max 68% width & height)
  // This guarantees that even on narrow mobile portrait screens, the content is never clipped!
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize graphic canvas");

  // Deep obsidian gallery canvas
  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);

  const safeMaxW = outW * 0.68;
  const safeMaxH = outH * 0.68;
  const scale = Math.min(safeMaxW / fgW, safeMaxH / fgH);

  const drawW = fgW * scale;
  const drawH = fgH * scale;
  const drawX = Math.round((outW - drawW) / 2);
  const drawY = Math.round((outH - drawH) / 2);

  // Render centered foreground
  ctx.drawImage(
    source,
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

  // Step 4: Extract subject mask and normalize ink/strokes
  for (let y = drawY; y < drawY + drawH; y++) {
    if (y < 0 || y >= outH) continue;
    for (let x = drawX; x < drawX + drawW; x++) {
      if (x < 0 || x >= outW) continue;
      const i = y * outW + x;
      const idx = i * 4;
      const r = outPx[idx]!;
      const g = outPx[idx + 1]!;
      const b = outPx[idx + 2]!;
      const a = outPx[idx + 3]!;

      if (a < 30) continue;

      const dColor = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      const mVal = clamp((dColor - 24) / 45, 0, 1);

      if (mVal > 0.15) {
        binary[i] = 1;
        mask[i] = mVal;
        hairSkin[i] = mVal;
        faceSkin[i] = mVal;
        depthConfidence[i] = 1.0;

        // If source was light background (e.g. dark ink on white paper),
        // adjust pixel color to luminous tone for dark gallery mode
        if (isLightBg) {
          const inkLum = 1.0 - (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const brightVal = Math.round(clamp(inkLum * 255 + 40, 60, 255));
          outPx[idx] = brightVal;
          outPx[idx + 1] = Math.round(brightVal * 0.95);
          outPx[idx + 2] = Math.round(brightVal * 0.9);
        }
      }
    }
  }

  // Put updated pixel data back to canvas for sampler color extraction
  ctx.putImageData(outImgData, 0, 0);

  // Step 5: Fast 2-pass Chamfer distance transform for rounded 3D bevel relief
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

  const bevelRadius = Math.max(4, Math.round(Math.min(drawW, drawH) * 0.08));
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
