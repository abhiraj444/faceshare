import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";
import { cleanBackgroundAndIsolateSubject } from "../background-cleaner";

/**
 * AnimalAdapter:
 * Universal adapter for dogs, cats, pets, and wildlife.
 * Cleans the background (grass, floor, carpet, room), isolates the animal subject,
 * and fits an anatomical animal head 3D field:
 * - Volumetric skull dome
 * - Forward-projecting snout / muzzle (+Z extension in lower-center)
 * - Eye socket depth depressions
 * - Tall ear planes
 * - Fur contrast relief
 */
export function buildAnimalSubject(
  source: HTMLCanvasElement,
  _params: Params,
): SubjectField {
  const { w: outW, h: outH } = workingSize();

  // Run comprehensive background cleaner to isolate the animal from environment
  const bgClean = cleanBackgroundAndIsolateSubject(source);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize animal canvas");

  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);

  // Scale & center source image with comfortable margin
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

  let m00 = 0, m10 = 0, m01 = 0;
  for (let dy = 0; dy < drawH; dy++) {
    const y = drawY + dy;
    if (y < 0 || y >= outH) continue;
    const sy = Math.min(srcH - 1, Math.max(0, Math.floor(dy / scale)));

    for (let dx = 0; dx < drawW; dx++) {
      const x = drawX + dx;
      if (x < 0 || x >= outW) continue;
      const sx = Math.min(srcW - 1, Math.max(0, Math.floor(dx / scale)));

      const mVal = bgClean.mask[sy * srcW + sx] ?? 0;
      const i = y * outW + x;

      mask[i] = mVal;
      hairSkin[i] = mVal > 0.2 ? 1 : 0;
      faceSkin[i] = mVal > 0.35 ? 1 : 0;

      if (mVal > 0.2) {
        m00 += mVal;
        m10 += x * mVal;
        m01 += y * mVal;
      }
    }
  }

  // Moments for center of mass of the animal head / body
  const centerX = m00 > 0 ? m10 / m00 : outW / 2;
  const centerY = m00 > 0 ? m01 / m00 : outH / 2;

  // Compute second central moments for principal head ellipsoid
  let u20 = 0, u02 = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const wVal = mask[i]!;
      if (wVal > 0.2) {
        u20 += (x - centerX) ** 2 * wVal;
        u02 += (y - centerY) ** 2 * wVal;
      }
    }
  }
  const radX = Math.max(outW * 0.28, Math.sqrt(u20 / Math.max(1, m00)) * 1.6);
  const radY = Math.max(outH * 0.32, Math.sqrt(u02 / Math.max(1, m00)) * 1.6);

  // Anatomical landmarks for an animal head:
  // Snout is typically positioned slightly below center
  const snoutX = centerX;
  const snoutY = centerY + radY * 0.18;
  const snoutRadX = radX * 0.36;
  const snoutRadY = radY * 0.32;

  // Volumetric animal depth synthesis:
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const m = mask[i]!;

      if (m < 0.04) {
        depthMap[i] = 0.0;
        depthConfidence[i] = 0.0;
        continue;
      }

      // 1. Cranial ellipsoidal base dome
      const nx = (x - centerX) / radX;
      const ny = (y - centerY) / radY;
      const d = nx * nx + ny * ny;
      const dist = Math.sqrt(d);
      const headDome = dist < 1.0 ? 0.5 * (1.0 + Math.cos(dist * Math.PI)) * 0.55 : 0.0;

      // 2. Snout & muzzle cone projection (closest to camera, highest Z)
      const sx = (x - snoutX) / snoutRadX;
      const sy = (y - snoutY) / snoutRadY;
      const sDist = Math.sqrt(sx * sx + sy * sy);
      const snoutCone = sDist < 1.0 ? 0.5 * (1.0 + Math.cos(sDist * Math.PI)) * 0.42 : 0.0;

      // 3. Eye socket depressions
      const leftEyeDist = Math.hypot((x - (centerX - radX * 0.32)) / (radX * 0.2), (y - (centerY - radY * 0.15)) / (radY * 0.2));
      const rightEyeDist = Math.hypot((x - (centerX + radX * 0.32)) / (radX * 0.2), (y - (centerY - radY * 0.15)) / (radY * 0.2));
      const eyeCavity = (leftEyeDist < 1.0 ? (1.0 - leftEyeDist) * 0.08 : 0.0) +
                        (rightEyeDist < 1.0 ? (1.0 - rightEyeDist) * 0.08 : 0.0);

      // 4. Fur micro-relief
      const idx = i * 4;
      const lum = (0.299 * px[idx]! + 0.587 * px[idx + 1]! + 0.114 * px[idx + 2]!) / 255;
      const furRelief = (lum - 0.45) * 0.12;

      // Total blended depth: Base Cranial Dome + Snout Projection - Eye Cavity + Fur
      const rawDepth = (headDome + snoutCone - eyeCavity + furRelief) * (0.45 + 0.55 * m);
      depthMap[i] = clamp(rawDepth, 0.0, 1.0) * m;
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
    iod: radX * 0.6,
    hasFace: false,
  };

  return {
    subjectType: "animal",
    width: outW,
    height: outH,
    depthMap,
    depthConfidence,
    segMask: mask,
    colorMap: px,
    controlPoints: [
      { x: centerX, y: centerY, z: 0.65, group: "animal_center" },
      { x: centerX - radX * 0.4, y: centerY - radY * 0.4, z: 0.5, group: "animal_left_ear" },
      { x: centerX + radX * 0.4, y: centerY - radY * 0.4, z: 0.5, group: "animal_right_ear" },
    ],
    boundingBox: {
      x: centerX - radX,
      y: centerY - radY,
      w: radX * 2,
      h: radY * 2,
      rollDeg: 0,
    },
    crop,
  };
}

