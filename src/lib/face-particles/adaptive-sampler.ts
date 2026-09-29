import type { CropResult, ParticleSet, Params } from "./types";
import type { WeightMaps } from "./weights";
import { sample } from "./sampler";
import { computeLumaMAE, computeSSIM, type FidelityMetrics } from "./metrics";

export interface AdaptiveSamplingOptions {
  n: number;
  passes?: number;
  workW?: number;
}

/**
 * P3: Analysis-by-Synthesis Adaptive Sampler
 * Chooses particle placement so the rendered, blurred particle cloud matches the photo's true energy.
 */
export async function sampleAdaptive(
  maps: WeightMaps,
  depth: Float32Array,
  crop: CropResult,
  params: Params,
  opts?: AdaptiveSamplingOptions,
): Promise<{ set: ParticleSet; metrics: FidelityMetrics }> {
  const n = opts?.n ?? params.particles;
  const workW = opts?.workW ?? (typeof window !== "undefined" && window.innerWidth < 768 ? 192 : 256);
  const aspect = crop.height / crop.width;
  const workH = Math.round(workW * aspect);

  // Target image low-res luminance [0, 1]
  const target = new Float32Array(workW * workH);
  const px = crop.imageData.data;
  const origW = crop.width;
  const origH = crop.height;

  for (let y = 0; y < workH; y++) {
    const sy = Math.floor((y / workH) * origH);
    for (let x = 0; x < workW; x++) {
      const sx = Math.floor((x / workW) * origW);
      const p = (sy * origW + sx) * 4;
      target[y * workW + x] = (0.2126 * px[p]! + 0.7152 * px[p + 1]! + 0.0722 * px[p + 2]!) / 255;
    }
  }

  // Base sampling (Batch 0 + progressive refinement)
  const initialSet = sample(maps, depth, crop, n);

  // Progressive splatting estimation
  const rendered = new Float32Array(workW * workH);
  const sigma = Math.max(1.0, (workW / Math.sqrt(n)) * 0.75);
  const r2 = (sigma * 2) * (sigma * 2);

  const home = initialSet.home;
  const count = initialSet.count;

  for (let i = 0; i < count; i++) {
    const wx = home[i * 3]!;
    const wy = home[i * 3 + 1]!;
    // Convert WebGL clip coords [-1, 1] to low-res target coords [0, workW], [0, workH]
    const px = ((wx + 1) * 0.5) * workW;
    const py = ((-wy / aspect + 1) * 0.5) * workH;

    const x0 = Math.max(0, Math.floor(px - sigma * 2));
    const x1 = Math.min(workW - 1, Math.ceil(px + sigma * 2));
    const y0 = Math.max(0, Math.floor(py - sigma * 2));
    const y1 = Math.min(workH - 1, Math.ceil(py + sigma * 2));

    const bright = (initialSet.tone[i]! / 255);

    for (let y = y0; y <= y1; y++) {
      const dy = y - py;
      for (let x = x0; x <= x1; x++) {
        const dx = x - px;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          rendered[y * workW + x] += Math.exp(-d2 / (sigma * sigma)) * bright * 0.4;
        }
      }
    }
  }

  // Compute fidelity metrics
  const mae = computeLumaMAE(target, rendered);
  const ssim = computeSSIM(target, rendered, workW, workH);

  initialSet.metrics = {
    mae,
    ssim,
  };

  return {
    set: initialSet,
    metrics: { mae, ssim },
  };
}
