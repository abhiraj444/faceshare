/**
 * Face Particles 3D — Fidelity Metrics & Benchmarking Harness
 * Evaluates image reconstruction fidelity (MAE, SSIM, ROI Delta E) and performance.
 */

export interface FidelityMetrics {
  mae: number;
  ssim: number;
  deltaE_roi?: number;
  timings?: {
    preprocessMs: number;
    visionMs: number;
    depthMs: number;
    sampleMs: number;
    totalMs: number;
  };
}

/**
 * Computes luminance Mean Absolute Error (MAE) between two grayscale Float32 buffers [0, 1].
 */
export function computeLumaMAE(
  target: Float32Array,
  rendered: Float32Array,
  mask?: Float32Array,
): number {
  const len = Math.min(target.length, rendered.length);
  let sumErr = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    const w = mask ? (mask[i] ?? 0) : 1;
    if (w < 0.1) continue;
    sumErr += Math.abs(target[i]! - rendered[i]!) * w;
    count += w;
  }
  return count > 0 ? sumErr / count : 0;
}

/**
 * Fast Structural Similarity Index (SSIM) approximation on 8x8 blocks.
 */
export function computeSSIM(
  img1: Float32Array,
  img2: Float32Array,
  w: number,
  h: number,
  mask?: Float32Array,
): number {
  const c1 = 0.0001; // (K1*L)^2
  const c2 = 0.0009; // (K2*L)^2
  const blockSize = 8;
  const numBlocksX = Math.floor(w / blockSize);
  const numBlocksY = Math.floor(h / blockSize);

  if (numBlocksX <= 0 || numBlocksY <= 0) return 1.0;

  let totalSsim = 0;
  let validBlocks = 0;

  for (let by = 0; by < numBlocksY; by++) {
    for (let bx = 0; bx < numBlocksX; bx++) {
      let sum1 = 0;
      let sum2 = 0;
      let sum11 = 0;
      let sum22 = 0;
      let sum12 = 0;
      let blockWeight = 0;

      for (let y = 0; y < blockSize; y++) {
        const py = by * blockSize + y;
        for (let x = 0; x < blockSize; x++) {
          const px = bx * blockSize + x;
          const idx = py * w + px;
          const mw = mask ? (mask[idx] ?? 0) : 1;
          const v1 = img1[idx] ?? 0;
          const v2 = img2[idx] ?? 0;

          sum1 += v1 * mw;
          sum2 += v2 * mw;
          sum11 += v1 * v1 * mw;
          sum22 += v2 * v2 * mw;
          sum12 += v1 * v2 * mw;
          blockWeight += mw;
        }
      }

      const n = blockWeight;
      if (n < 4) continue;

      const mu1 = sum1 / n;
      const mu2 = sum2 / n;
      const sigma1_sq = Math.max(0, sum11 / n - mu1 * mu1);
      const sigma2_sq = Math.max(0, sum22 / n - mu2 * mu2);
      const sigma12 = sum12 / n - mu1 * mu2;

      const ssimVal =
        ((2 * mu1 * mu2 + c1) * (2 * sigma12 + c2)) /
        ((mu1 * mu1 + mu2 * mu2 + c1) * (sigma1_sq + sigma2_sq + c2));

      totalSsim += ssimVal;
      validBlocks++;
    }
  }

  return validBlocks > 0 ? totalSsim / validBlocks : 1.0;
}

/**
 * Calculates Color Delta E (CIE76 approximation) in an ROI (e.g. eyes + mouth).
 */
export function computeRoiDeltaE(
  sourceRgb: Uint8Array,
  renderedRgb: Uint8Array,
  roiMask: Float32Array,
): number {
  const len = roiMask.length;
  let sumDeltaE = 0;
  let count = 0;

  for (let i = 0; i < len; i++) {
    const w = roiMask[i] ?? 0;
    if (w < 0.2) continue;
    const p = i * 3;
    const r1 = sourceRgb[p] ?? 0;
    const g1 = sourceRgb[p + 1] ?? 0;
    const b1 = sourceRgb[p + 2] ?? 0;
    const r2 = renderedRgb[p] ?? 0;
    const g2 = renderedRgb[p + 1] ?? 0;
    const b2 = renderedRgb[p + 2] ?? 0;

    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    const dE = Math.sqrt(dr * dr + dg * dg + db * db) / 2.55;

    sumDeltaE += dE * w;
    count += w;
  }

  return count > 0 ? sumDeltaE / count : 0;
}
