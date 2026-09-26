import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";

export interface TextAdapterOptions {
  text: string;
  fontFamily?: string;
  colorTheme?: "gold" | "cyberpunk" | "monochrome" | "emerald";
}

/**
 * TextAdapter (v2 Remediation §5.3):
 * Turns any word, name, or phrase into a 3D volumetric particle typography cloud.
 * Extrudes 2D glyph outlines along Z with an edge-distance bevel field,
 * producing tactile 3D typographic sculpture that works seamlessly with all
 * physics forces, video recording, and fine-art plotter printing.
 */
export function buildTextSubject(
  options: TextAdapterOptions | string,
  _params: Params,
): SubjectField {
  const text = typeof options === "string" ? options : options.text || "PARTICLES";
  const { w: outW, h: outH } = workingSize();

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize text canvas");

  // Deep obsidian gallery canvas
  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);

  // Measure text and fit with safe margins for mobile & desktop
  const maxTextW = outW * 0.70;
  let fontSize = Math.round(outH * 0.16);
  const fontFam =
    typeof options === "object" && options.fontFamily
      ? options.fontFamily
      : "ui-sans-serif, system-ui, -apple-system, sans-serif";

  ctx.font = `900 ${fontSize}px ${fontFam}`;
  let metrics = ctx.measureText(text);
  if (metrics.width > maxTextW) {
    fontSize = Math.floor(fontSize * (maxTextW / metrics.width));
    ctx.font = `900 ${fontSize}px ${fontFam}`;
    metrics = ctx.measureText(text);
  }

  // Draw vibrant, high-contrast text with typographic bevel gradient
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const cx = outW / 2;
  const cy = outH / 2;

  // Render text fill
  const grad = ctx.createLinearGradient(cx - metrics.width / 2, cy - fontSize / 2, cx + metrics.width / 2, cy + fontSize / 2);
  const theme = typeof options === "object" ? options.colorTheme : "gold";
  if (theme === "cyberpunk") {
    grad.addColorStop(0, "#00f0ff");
    grad.addColorStop(0.5, "#ff0077");
    grad.addColorStop(1, "#ffe600");
  } else if (theme === "emerald") {
    grad.addColorStop(0, "#10b981");
    grad.addColorStop(0.6, "#06b6d4");
    grad.addColorStop(1, "#3b82f6");
  } else if (theme === "monochrome") {
    grad.addColorStop(0, "#f8fafc");
    grad.addColorStop(1, "#cbd5e1");
  } else {
    // Gold / warm fine art default
    grad.addColorStop(0, "#fef08a");
    grad.addColorStop(0.4, "#f59e0b");
    grad.addColorStop(1, "#d97706");
  }

  ctx.fillStyle = grad;
  ctx.fillText(text, cx, cy);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const px = imgData.data;
  const mask = new Float32Array(outW * outH);
  const hairSkin = new Float32Array(outW * outH);
  const faceSkin = new Float32Array(outW * outH);
  const depthMap = new Float32Array(outW * outH);
  const depthConfidence = new Float32Array(outW * outH);

  // Detect glyph occupancy & compute simple chamfer distance transform for 3D bevel
  const binary = new Uint8Array(outW * outH);
  for (let i = 0; i < outW * outH; i++) {
    const alpha = px[i * 4 + 3]!;
    const lum = (px[i * 4]! + px[i * 4 + 1]! + px[i * 4 + 2]!) / 3;
    if (alpha > 40 && lum > 25) {
      binary[i] = 1;
      mask[i] = clamp(alpha / 255, 0, 1);
      hairSkin[i] = 1;
      faceSkin[i] = 1;
      depthConfidence[i] = 1.0;
    }
  }

  // Fast 2-pass distance transform (Manhattan/Chamfer) to create tactile 3D bevel
  const dist = new Float32Array(outW * outH);
  const INF = 1e5;
  for (let i = 0; i < dist.length; i++) {
    dist[i] = binary[i] ? INF : 0;
  }
  // Forward pass
  for (let y = 1; y < outH; y++) {
    for (let x = 1; x < outW; x++) {
      const idx = y * outW + x;
      if (binary[idx]) {
        dist[idx] = Math.min(dist[idx]!, dist[idx - 1]! + 1, dist[idx - outW]! + 1);
      }
    }
  }
  // Backward pass
  for (let y = outH - 2; y >= 0; y--) {
    for (let x = outW - 2; x >= 0; x--) {
      const idx = y * outW + x;
      if (binary[idx]) {
        dist[idx] = Math.min(dist[idx]!, dist[idx + 1]! + 1, dist[idx + outW]! + 1);
      }
    }
  }

  // Convert distance to smooth rounded 3D extrusion relief along Z
  const bevelRadius = Math.max(6, Math.round(fontSize * 0.14));
  for (let i = 0; i < depthMap.length; i++) {
    if (binary[i]) {
      const dNorm = clamp(dist[i]! / bevelRadius, 0, 1);
      // Cosine bevel curve for pillowed 3D typography
      const zCurv = 0.5 * (1 - Math.cos(dNorm * Math.PI));
      depthMap[i] = (0.25 + 0.65 * zCurv) * mask[i]!;
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
    iod: fontSize * 0.45,
    hasFace: false,
  };

  return {
    subjectType: "text",
    width: outW,
    height: outH,
    depthMap,
    depthConfidence,
    segMask: mask,
    colorMap: px,
    controlPoints: [
      { x: cx - metrics.width / 2, y: cy, z: 0.5, group: "text_left" },
      { x: cx, y: cy, z: 0.7, group: "text_center" },
      { x: cx + metrics.width / 2, y: cy, z: 0.5, group: "text_right" },
    ],
    boundingBox: {
      x: cx - metrics.width / 2,
      y: cy - fontSize / 2,
      w: metrics.width,
      h: fontSize,
      rollDeg: 0,
    },
    crop,
  };
}
