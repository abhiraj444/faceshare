import type { CropResult, Landmark, Params, VisionResult } from "./types";
import { workingSize } from "./config";
import { IDX } from "./landmarks";
import { clamp } from "./math";

const CLASS_HAIR = 1;
const CLASS_BODY = 2;
const CLASS_FACE = 3;
const CLASS_CLOTHES = 4;
const CLASS_OTHERS = 5;

function sampleClass(
  classes: Uint8Array | null,
  classW: number,
  classH: number,
  u: number,
  v: number,
): number {
  if (!classes || classW <= 0 || classH <= 0) return 0;
  const x = clamp(Math.floor(u * classW), 0, classW - 1);
  const y = clamp(Math.floor(v * classH), 0, classH - 1);
  return classes[y * classW + x] ?? 0;
}

function headBounds(vision: VisionResult, srcW: number, srcH: number, chinLimitY?: number) {
  let minX = srcW, minY = srcH, maxX = 0, maxY = 0;
  let found = false;
  if (vision.classes && vision.classW > 0) {
    const { classW, classH, classes } = vision;
    if (!classes) return null;
    const maxNeckY = chinLimitY ? (chinLimitY / srcH) * classH : classH;
    for (let y = 0; y < classH; y++) {
      for (let x = 0; x < classW; x++) {
        const c = classes[y * classW + x] ?? 0;
        // Include hair, face, accessories/glasses (class 5), and headwear/hat (class 4 above face center)
        const isHeadElement =
          c === CLASS_HAIR ||
          c === CLASS_FACE ||
          c === CLASS_OTHERS ||
          (c === CLASS_CLOTHES && y <= maxNeckY * 0.45);
        const isNeckSlice = c === CLASS_BODY && y <= maxNeckY;
        if (isHeadElement || isNeckSlice) {
          const px = (x / classW) * srcW;
          const py = (y / classH) * srcH;
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
          found = true;
        }
      }
    }
  }
  if (!found && vision.landmarks && vision.landmarks.length) {
    for (const p of vision.landmarks) {
      minX = Math.min(minX, p.x * srcW);
      minY = Math.min(minY, p.y * srcH);
      maxX = Math.max(maxX, p.x * srcW);
      maxY = Math.max(maxY, p.y * srcH);
    }
    found = true;
  }
  if (!found) return null;
  return { minX, minY, maxX, maxY };
}

export function headCrop(
  source: HTMLCanvasElement,
  vision: VisionResult,
  params: Pick<Params, "straighten">,
): CropResult {
  const { w: outW, h: outH } = workingSize();
  const srcW = source.width;
  const srcH = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create crop canvas.");

  let angle = 0;
  let iod = Math.min(srcW, srcH) * 0.18;
  let faceCx = srcW * 0.5;
  let faceCy = srcH * 0.45;

  const lm = vision.landmarks;
  let chinY = srcH * 0.72;
  if (lm && lm.length > IDX.leftEyeOuter) {
    const r = lm[IDX.rightEyeOuter]!;
    const l = lm[IDX.leftEyeOuter]!;
    const dx = (l.x - r.x) * srcW;
    const dy = (l.y - r.y) * srcH;
    iod = Math.hypot(dx, dy) || iod;
    if (params.straighten) angle = Math.atan2(dy, dx);
    const nose = lm[IDX.noseTip];
    const eyeMidX = ((r.x + l.x) / 2) * srcW;
    const eyeMidY = ((r.y + l.y) / 2) * srcH;
    faceCx = eyeMidX;
    faceCy = nose ? (nose.y * srcH + eyeMidY) * 0.5 : eyeMidY + iod * 0.35;
    if (lm[IDX.chin]) {
      chinY = lm[IDX.chin]!.y * srcH;
    }
  }

  const bounds = headBounds(vision, srcW, srcH, chinY + srcH * 0.15);
  let cropW: number;
  let cropH: number;
  const bx: number = faceCx;
  const by: number = faceCy;

  // Ensure distance from faceCy up to bounds.minY (top of hair/crown) and down to chin is completely preserved
  const pad = 0.28;
  if (bounds) {
    const distUp = Math.max(faceCy - bounds.minY, iod * 2.2);
    const distDown = Math.max(bounds.maxY - faceCy, iod * 2.2);
    const halfH = Math.max(distUp, distDown) * (1 + pad);
    const distLeft = Math.max(faceCx - bounds.minX, iod * 1.8);
    const distRight = Math.max(bounds.maxX - faceCx, iod * 1.8);
    const halfW = Math.max(distLeft, distRight) * (1 + pad);
    cropH = halfH * 2;
    cropW = halfW * 2;
  } else {
    const side = Math.min(srcW, srcH) * 0.85;
    cropW = side;
    cropH = side * (4 / 3);
  }

  const targetAspect = outW / outH;
  if (cropW / cropH > targetAspect) cropH = cropW / targetAspect;
  else cropW = cropH * targetAspect;

  ctx.save();
  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(-angle);
  ctx.scale(outW / cropW, outH / cropH);
  ctx.translate(-bx, -by);
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, outW, outH);
  const mask = new Float32Array(outW * outH);
  const hairSkin = new Float32Array(outW * outH);
  const faceSkin = new Float32Array(outW * outH);

  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const sx = outW / cropW;
  const sy = outH / cropH;

  const mapSrcToCrop = (srcX: number, srcY: number) => {
    const dx = srcX - bx;
    const dy = srcY - by;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: rx * sx + outW / 2, y: ry * sy + outH / 2 };
  };

  let chinCropY = outH * 0.72;
  let landmarks: Landmark[] | null = null;
  if (lm) {
    landmarks = lm.map((p) => {
      const mapped = mapSrcToCrop(p.x * srcW, p.y * srcH);
      return { x: mapped.x, y: mapped.y, z: p.z };
    });
    if (landmarks[IDX.leftEyeOuter] && landmarks[IDX.rightEyeOuter]) {
      const a = landmarks[IDX.rightEyeOuter]!;
      const b = landmarks[IDX.leftEyeOuter]!;
      iod = Math.hypot(b.x - a.x, b.y - a.y) || iod * (outW / cropW);
    }
    if (landmarks[IDX.chin]) {
      chinCropY = landmarks[IDX.chin]!.y;
    }
  }

  // Tight inner beard/mouth zone to protect dark mustaches without touching background wall
  let beardMinX = 0, beardMaxX = 0, beardMinY = 0, beardMaxY = 0;
  let hasBeardZone = false;
  if (landmarks && landmarks[IDX.noseTip] && landmarks[IDX.chin]) {
    const nose = landmarks[IDX.noseTip]!;
    const chin = landmarks[IDX.chin]!;
    beardMinX = nose.x - iod * 0.55;
    beardMaxX = nose.x + iod * 0.55;
    beardMinY = nose.y - iod * 0.1;
    beardMaxY = chin.y + iod * 0.15;
    hasBeardZone = true;
  }

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const scale = outW / cropW;

  if (vision.classes && vision.classW > 0) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        // Exact inverse transformation from crop canvas to source image coordinates
        const x0 = (x - outW / 2) / scale;
        const y0 = (y - outH / 2) / scale;
        const srcX = x0 * cosA - y0 * sinA + bx;
        const srcY = x0 * sinA + y0 * cosA + by;
        const u = srcX / srcW;
        const v = srcY / srcH;
        const c =
          u < 0 || v < 0 || u > 1 || v > 1
            ? 0
            : sampleClass(vision.classes, vision.classW, vision.classH, u, v);
        const i = y * outW + x;

        const inBeardZone = hasBeardZone && x >= beardMinX && x <= beardMaxX && y >= beardMinY && y <= beardMaxY;
        const isHair = c === CLASS_HAIR;
        // Strictly true face, plus inner mustache/beard zone if dark shadow was classified as 0
        const isFace = c === CLASS_FACE || (inBeardZone && (c === 0 || c === CLASS_BODY));
        const isBody = c === CLASS_BODY;
        const isOthers = c === CLASS_OTHERS; // Glasses and accessories!
        const isHat = c === CLASS_CLOTHES && y0 < -outH * 0.2; // Caps / hats strictly above head
        // Include neck, collar, and upper torso / shoulders symmetrically below chin with a graceful bust vignette.
        // Prevents asymmetric one-sided cutoff when clothing on one side is CLASS_CLOTHES while the other side has hair.
        const isTorso = (isBody || c === CLASS_CLOTHES) && y > chinCropY - 6;
        const torsoFalloff = isTorso ? clamp(1 - (y - chinCropY) / (outH * 0.32), 0, 1) : 0;
        const isHeadSubject = isHair || isFace || isOthers || isHat;

        hairSkin[i] = isHeadSubject || (isTorso && torsoFalloff > 0.05) ? 1 : 0;
        faceSkin[i] = isFace || isOthers ? 1 : 0;
        mask[i] = isHeadSubject ? 1 : torsoFalloff;
      }
    }
  } else {
    const cx = outW * 0.5;
    const cy = outH * 0.44;
    const rx = outW * 0.36;
    const ry = outH * 0.42;

    // Sample border pixels to detect if background is light/white or dark
    const px = imageData.data;
    let bLum = 0;
    let bCount = 0;
    for (let x = 0; x < outW; x += 16) {
      const topP = x * 4;
      const btmP = ((outH - 1) * outW + x) * 4;
      bLum += (px[topP]! + px[topP + 1]! + px[topP + 2]!) / 3;
      bLum += (px[btmP]! + px[btmP + 1]! + px[btmP + 2]!) / 3;
      bCount += 2;
    }
    const borderLum = bLum / Math.max(1, bCount);
    const isLightBg = borderLum > 140;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const i = y * outW + x;
        const p = i * 4;
        const lum = (px[p]! + px[p + 1]! + px[p + 2]!) / 3;

        // If light background, empty out pixels that match the white/light background
        if (isLightBg && Math.abs(lum - borderLum) < 30) {
          mask[i] = 0;
          hairSkin[i] = 0;
          faceSkin[i] = 0;
          continue;
        }

        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d = nx * nx + ny * ny;
        const m = d < 1 ? clamp(1 - (d - 0.72) / 0.28, 0, 1) : 0;
        mask[i] = m;
        hairSkin[i] = m > 0.2 ? 1 : 0;
        faceSkin[i] = ny > -0.15 && d < 0.72 ? m : 0;
      }
    }
  }

  return {
    canvas,
    imageData,
    width: outW,
    height: outH,
    landmarks,
    mask,
    hairSkin,
    faceSkin,
    iod,
    hasFace: Boolean(landmarks),
  };
}
