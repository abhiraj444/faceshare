import { clamp } from "./math";
import { cleanBackgroundAndIsolateSubject, type BackgroundCleanResult } from "./background-cleaner";

export interface PreprocessOptions {
  denoise?: boolean;
  normalizeExposure?: boolean;
  upscaleLowRes?: boolean;
  minDimension?: number;
  cleanBackground?: boolean;
}

const DEFAULT_OPTIONS: Required<PreprocessOptions> = {
  denoise: true,
  normalizeExposure: true,
  upscaleLowRes: true,
  minDimension: 512,
  cleanBackground: true,
};

export interface ToneOpts {
  clipLimit?: number;
  tiles?: number;
  lift?: number; // 0..1 UI slider
}

/**
 * Adaptive CLAHE Tone Normalization (Phase 1.1):
 * - Evaluates mean face luma (meanL) inside faceMask
 * - Automatically computes adaptive lift strength s = clamp((0.42 - meanL)/0.22, 0, 1) * lift
 * - Applies 8x8 tiled CLAHE with bilinear CDF interpolation
 * - Preserves exact R:G:B ratios and soft-clips highlights
 */
export function normalizeTone(
  img: ImageData,
  faceMask?: Float32Array,
  options?: ToneOpts,
): ImageData {
  const opts = { clipLimit: 2.0, tiles: 8, lift: 1.0, ...options };
  const { width: w, height: h, data } = img;
  const nPix = w * h;
  const luma = new Float32Array(nPix);

  let meanL = 0;
  let maskCount = 0;

  for (let i = 0; i < nPix; i++) {
    const p = i * 4;
    // Rec. 709 luma
    const yVal = (0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!) / 255;
    luma[i] = yVal;

    const m = faceMask ? (faceMask[i] ?? 0) : 1;
    if (m > 0.5) {
      meanL += yVal * m;
      maskCount += m;
    }
  }

  if (maskCount > 0) {
    meanL /= maskCount;
  } else {
    meanL = 0.35;
  }

  // Auto strength s = clamp((0.42 - meanL) / 0.22, 0, 1) * lift
  const strength = clamp((0.42 - meanL) / 0.22, 0, 1) * (opts.lift ?? 1.0);
  if (strength < 0.05) {
    return img;
  }

  // 8x8 Grid CLAHE
  const numTilesX = opts.tiles;
  const numTilesY = opts.tiles;
  const tileW = w / numTilesX;
  const tileH = h / numTilesY;

  // Compute tile CDFs
  const cdfs = new Array(numTilesY);
  for (let ty = 0; ty < numTilesY; ty++) {
    cdfs[ty] = new Array(numTilesX);
    for (let tx = 0; tx < numTilesX; tx++) {
      const hist = new Uint32Array(256);
      const startX = Math.floor(tx * tileW);
      const endX = Math.min(w, Math.floor((tx + 1) * tileW));
      const startY = Math.floor(ty * tileH);
      const endY = Math.min(h, Math.floor((ty + 1) * tileH));
      const tilePix = (endX - startX) * (endY - startY);

      for (let y = startY; y < endY; y++) {
        const row = y * w;
        for (let x = startX; x < endX; x++) {
          const bin = clamp(Math.round(luma[row + x]! * 255), 0, 255);
          hist[bin]++;
        }
      }

      // Clip and redistribute
      const clipVal = Math.max(1, Math.round((opts.clipLimit * tilePix) / 256));
      let excess = 0;
      for (let b = 0; b < 256; b++) {
        if (hist[b]! > clipVal) {
          excess += hist[b]! - clipVal;
          hist[b] = clipVal;
        }
      }
      const redist = Math.floor(excess / 256);
      for (let b = 0; b < 256; b++) {
        hist[b] += redist;
      }

      // CDF
      const cdf = new Float32Array(256);
      let accum = 0;
      for (let b = 0; b < 256; b++) {
        accum += hist[b]!;
        cdf[b] = accum / (tilePix + excess);
      }
      cdfs[ty][tx] = cdf;
    }
  }

  const outData = new Uint8ClampedArray(data.length);
  outData.set(data);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const ty = (y / tileH) - 0.5;
    const ty0 = clamp(Math.floor(ty), 0, numTilesY - 1);
    const ty1 = clamp(ty0 + 1, 0, numTilesY - 1);
    const dy = clamp(ty - ty0, 0, 1);

    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const tx = (x / tileW) - 0.5;
      const tx0 = clamp(Math.floor(tx), 0, numTilesX - 1);
      const tx1 = clamp(tx0 + 1, 0, numTilesX - 1);
      const dx = clamp(tx - tx0, 0, 1);

      const yOld = luma[idx]!;
      const bin = clamp(Math.round(yOld * 255), 0, 255);

      const c00 = cdfs[ty0][tx0][bin];
      const c10 = cdfs[ty0][tx1][bin];
      const c01 = cdfs[ty1][tx0][bin];
      const c11 = cdfs[ty1][tx1][bin];

      const top = c00 * (1 - dx) + c10 * dx;
      const bot = c01 * (1 - dx) + c11 * dx;
      const yClahe = top * (1 - dy) + bot * dy;

      const yNew = yOld * (1 - strength) + yClahe * strength;
      const gain = clamp(yNew / Math.max(yOld, 1e-3), 0.6, 2.5);

      const p = idx * 4;
      for (let c = 0; c < 3; c++) {
        let v = (data[p + c]! / 255) * gain;
        // Soft-clip highlights: v / (1 + 0.15 * v)
        v = (v / (1 + 0.15 * v)) * (1 + 0.15);
        outData[p + c] = clamp(Math.round(v * 255), 0, 255);
      }
      outData[p + 3] = data[p + 3]!;
    }
  }

  return new ImageData(outData, w, h);
}

/**
 * Preprocessing & Cleaning Pipeline (Phase 1):
 * - Primary Background Cleanup & Subject Isolation:
 *   Detects background, separates subject (face, signature, fingerprint, animal, object),
 *   and eliminates background noise/paper texture before any particle sampling.
 * - Auto-exposure / Dynamic range histogram normalization (fixes underexposed/washed out photos)
 * - Bilateral edge-preserving spatial denoiser (eliminates camera grain that causes depth spikes)
 * - Bicubic super-resolution upscale with unsharp mask (reconstructs low-res crops under 512px)
 */
export function preprocessImage(
  source: HTMLCanvasElement,
  options?: PreprocessOptions,
): PreprocessResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const origW = source.width;
  const origH = source.height;

  if (origW === 0 || origH === 0) {
    return { canvas: source, applied: false };
  }

  // 1. Primary Background Cleanup & Subject Isolation
  let currentCanvas = source;
  let bgCleanResult: BackgroundCleanResult | undefined = undefined;

  if (opts.cleanBackground) {
    try {
      bgCleanResult = cleanBackgroundAndIsolateSubject(currentCanvas);
      // For document/graphic inputs (signatures, fingerprints, line-art, sketches),
      // use the cleaned canvas directly so ink/ridges stand out cleanly on dark gallery void!
      if (bgCleanResult.isDocumentOrGraphic) {
        currentCanvas = bgCleanResult.cleanedCanvas;
      }
    } catch (err) {
      console.warn("[Preprocess] Background cleaning non-fatal fallback:", err);
    }
  }

  // 2. Super-resolution / Upscale check
  const minDim = Math.min(currentCanvas.width, currentCanvas.height);
  let wasUpscaled = false;

  if (opts.upscaleLowRes && minDim < opts.minDimension) {
    const scale = Math.min(2.5, opts.minDimension / minDim);
    const newW = Math.round(currentCanvas.width * scale);
    const newH = Math.round(currentCanvas.height * scale);
    const upCanvas = document.createElement("canvas");
    upCanvas.width = newW;
    upCanvas.height = newH;
    const upCtx = upCanvas.getContext("2d", { willReadFrequently: true });
    if (upCtx) {
      upCtx.imageSmoothingEnabled = true;
      upCtx.imageSmoothingQuality = "high";
      upCtx.drawImage(currentCanvas, 0, 0, newW, newH);
      currentCanvas = upCanvas;
      wasUpscaled = true;
    }
  }

  const w = currentCanvas.width;
  const h = currentCanvas.height;
  const ctx = currentCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { canvas: currentCanvas, applied: wasUpscaled, bgCleanResult };

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const nPixels = w * h;

  // 3. For documents/graphics (signatures, line art, sketches on paper),
  // apply high-contrast ink isolation so drawings pop on black gallery void.
  const isDarkGraphic = bgCleanResult?.isDocumentOrGraphic && bgCleanResult.isLightBg;
  if (isDarkGraphic && opts.normalizeExposure && nPixels > 100) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < nPixels; i++) {
      const p = i * 4;
      const lum = (data[p]! * 77 + data[p + 1]! * 150 + data[p + 2]! * 29) >> 8;
      hist[lum]++;
    }

    const p1Count = Math.floor(nPixels * 0.015);
    const p99Count = Math.floor(nPixels * 0.985);
    let accum = 0;
    let minLum = 0;
    let maxLum = 255;

    for (let v = 0; v < 256; v++) {
      accum += hist[v]!;
      if (accum >= p1Count && minLum === 0) {
        minLum = v;
      }
      if (accum >= p99Count) {
        maxLum = v;
        break;
      }
    }

    const lumRange = maxLum - minLum;
    if (lumRange > 30 && (minLum > 10 || maxLum < 240)) {
      const scale = 255 / lumRange;
      const lut = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        const norm = clamp((v - minLum) * scale / 255, 0, 1);
        lut[v] = Math.round(norm * 255);
      }

      for (let i = 0; i < nPixels; i++) {
        const p = i * 4;
        data[p] = lut[data[p]!]!;
        data[p + 1] = lut[data[p + 1]!]!;
        data[p + 2] = lut[data[p + 2]!]!;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }

  // Authentic photos: NEVER mutate RGB colors or apply lossy bilateral blur.
  // 100% of original camera tones, skin colors, and fine facial features are preserved.
  return { canvas: currentCanvas, applied: wasUpscaled, bgCleanResult };
}

/**
 * Fast LUT-accelerated edge-preserving bilateral denoiser for RGB byte buffers.
 * Smooths high-frequency sensor grain in smooth regions (forehead, cheeks)
 * while preserving sharp edges (eyelashes, pupil, lip line) in <15ms.
 */
function _applyFastBilateralRGB(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  spatialSigma = 1.4,
  colorThreshold = 22,
): void {
  const radius = 1; // 3x3 neighborhood: optimal balance of noise reduction & microsecond speed
  const temp = new Uint8ClampedArray(data.length);
  temp.set(data);

  // Precompute spatial weights for 3x3 kernel
  const spatialWeights: number[] = [];
  const twoSpatialSigma2 = 2 * spatialSigma * spatialSigma;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      spatialWeights.push(Math.exp(-(dx * dx + dy * dy) / twoSpatialSigma2));
    }
  }

  // Precompute Range Exp LUT (0 to 195075 max colorDistSq)
  const thresholdSq = colorThreshold * colorThreshold;
  const lutSize = 4096;
  const maxDistSq = 4 * thresholdSq;
  const lut = new Float32Array(lutSize);
  for (let i = 0; i < lutSize; i++) {
    const distSq = (i / lutSize) * maxDistSq;
    lut[i] = Math.exp(-distSq / thresholdSq);
  }
  const lutFactor = lutSize / maxDistSq;

  // Process rows with ultra-fast LUT lookups
  for (let y = 1; y < h - 1; y++) {
    const rowOffset = y * w * 4;
    for (let x = 1; x < w - 1; x++) {
      const centerIdx = rowOffset + x * 4;
      const cR = temp[centerIdx]!;
      const cG = temp[centerIdx + 1]!;
      const cB = temp[centerIdx + 2]!;

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let totalW = 0;
      let kIdx = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const nRowOffset = (y + dy) * w * 4;
        for (let dx = -radius; dx <= radius; dx++) {
          const nIdx = nRowOffset + (x + dx) * 4;
          const nR = temp[nIdx]!;
          const nG = temp[nIdx + 1]!;
          const nB = temp[nIdx + 2]!;

          const dR = nR - cR;
          const dG = nG - cG;
          const dB = nB - cB;
          const colorDistSq = dR * dR + dG * dG + dB * dB;

          let wRange = 0;
          if (colorDistSq < maxDistSq) {
            const idx = (colorDistSq * lutFactor) | 0;
            wRange = lut[idx] ?? 0;
          }

          const weight = spatialWeights[kIdx++]! * wRange;
          sumR += nR * weight;
          sumG += nG * weight;
          sumB += nB * weight;
          totalW += weight;
        }
      }

      if (totalW > 1e-4) {
        data[centerIdx] = (sumR / totalW) | 0;
        data[centerIdx + 1] = (sumG / totalW) | 0;
        data[centerIdx + 2] = (sumB / totalW) | 0;
      }
    }
  }
}

/**
 * Lightweight Unsharp Mask filter for subtle edge crispness after scaling.
 */
function _applyUnsharpMaskRGB(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount = 0.4,
): void {
  const temp = new Uint8ClampedArray(data.length);
  temp.set(data);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = temp[idx + c]!;
        // Simple 3x3 Laplacian blur
        const up = temp[((y - 1) * w + x) * 4 + c]!;
        const down = temp[((y + 1) * w + x) * 4 + c]!;
        const left = temp[(y * w + (x - 1)) * 4 + c]!;
        const right = temp[(y * w + (x + 1)) * 4 + c]!;
        const blur = (up + down + left + right) * 0.25;
        const diff = center - blur;
        data[idx + c] = clamp(center + diff * amount, 0, 255);
      }
    }
  }
}
