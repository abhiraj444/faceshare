import type { CropResult } from "../types";
import { clamp } from "../math";

let depthModelPromise: Promise<unknown> | null = null;
let isWebGPUSupported: boolean | null = null;

async function checkWebGPUSupport(): Promise<boolean> {
  if (isWebGPUSupported !== null) return isWebGPUSupported;
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    isWebGPUSupported = false;
    return false;
  }
  try {
    const gpu = navigator.gpu as { requestAdapter?: () => Promise<unknown> };
    const adapter = await gpu.requestAdapter?.();
    isWebGPUSupported = Boolean(adapter);
  } catch {
    isWebGPUSupported = false;
  }
  return isWebGPUSupported;
}

/**
 * Loads Depth Anything V2 Small using Transformers.js with WebGPU / WASM acceleration.
 */
async function loadDepthAnythingPipeline(
  onProgress?: (progress: number, stage: string) => void,
) {
  if (depthModelPromise) return depthModelPromise;

  depthModelPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");

    env.allowLocalModels = false;
    env.useBrowserCache = true;

    const useGpu = await checkWebGPUSupport();
    const device = useGpu ? "webgpu" : "wasm";
    const dtype = useGpu ? "fp32" : "q8";

    onProgress?.(0.15, `Loading Depth Anything V2 (${device.toUpperCase()})...`);

    const depthEstimator = await pipeline(
      "depth-estimation",
      "onnx-community/depth-anything-v2-small",
      {
        device,
        dtype,
        progress_callback: (item: { status: string; progress?: number; file?: string }) => {
          if (item.status === "progress" && typeof item.progress === "number") {
            const pct = Math.round(item.progress);
            onProgress?.(0.2 + (pct / 100) * 0.6, `Downloading AI Depth Model (${pct}%)...`);
          } else if (item.status === "ready") {
            onProgress?.(0.85, "Depth model initialized");
          }
        },
      },
    );

    return depthEstimator;
  })();

  return depthModelPromise;
}

/**
 * Runs true Dense AI Monocular Depth Estimation via Depth Anything V2.
 */
export async function computeNeuralDepthAsync(
  crop: CropResult,
  onProgress?: (progress: number, stage: string) => void,
): Promise<Float32Array> {
  const { width: outW, height: outH, canvas, mask } = crop;

  try {
    onProgress?.(0.05, "Initializing Depth Anything V2...");
    const estimator = (await loadDepthAnythingPipeline(onProgress)) as (
      img: HTMLCanvasElement,
    ) => Promise<{ depth: { data: Float32Array | Uint8Array; width: number; height: number } }>;

    onProgress?.(0.88, "Synthesizing dense neural 3D depth field...");
    const result = await estimator(canvas);
    const rawDepth = result.depth;

    const srcW = rawDepth.width;
    const srcH = rawDepth.height;
    const srcData = rawDepth.data;

    // Find min and max for normalization
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < srcData.length; i++) {
      const v = srcData[i]!;
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }

    const range = Math.max(1e-5, maxVal - minVal);
    const depth = new Float32Array(outW * outH);

    // Bilinear resample & normalize to 0.0 (far) - 1.0 (near)
    for (let y = 0; y < outH; y++) {
      const v = (y / (outH - 1)) * (srcH - 1);
      const y0 = Math.floor(v);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const dy = v - y0;

      for (let x = 0; x < outW; x++) {
        const u = (x / (outW - 1)) * (srcW - 1);
        const x0 = Math.floor(u);
        const x1 = Math.min(srcW - 1, x0 + 1);
        const dx = u - x0;

        const val00 = (srcData[y0 * srcW + x0]! - minVal) / range;
        const val10 = (srcData[y0 * srcW + x1]! - minVal) / range;
        const val01 = (srcData[y1 * srcW + x0]! - minVal) / range;
        const val11 = (srcData[y1 * srcW + x1]! - minVal) / range;

        const top = val00 * (1 - dx) + val10 * dx;
        const bot = val01 * (1 - dx) + val11 * dx;
        let d = top * (1 - dy) + bot * dy;

        // Apply contrast curve to accentuate focal depth
        d = Math.pow(clamp(d, 0, 1), 0.85);

        // Modulate with foreground mask to prevent depth bleeding onto background
        const m = mask[y * outW + x] ?? 1.0;
        d = d * (0.2 + 0.8 * m);

        depth[y * outW + x] = d;
      }
    }

    onProgress?.(1.0, "Depth computation complete");
    return depth;
  } catch (err) {
    console.warn("[NeuralDepth] Depth Anything V2 error, using anatomical fallback:", err);
    return computeNeuralDepth(crop);
  }
}

/**
 * Fast synchronous fallback estimator using anatomical contours and shading cues.
 */
export function computeNeuralDepth(crop: CropResult): Float32Array {
  const { width: w, height: h, imageData, mask } = crop;
  const depth = new Float32Array(w * h);
  const data = imageData.data;

  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    lum[i] = (data[p]! * 0.299 + data[p + 1]! * 0.587 + data[p + 2]! * 0.114) / 255;
  }

  const cx = w * 0.5;
  const cy = h * 0.48;
  const rx = w * 0.42;
  const ry = h * 0.52;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const dy = (y - cy) / ry;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const dx = (x - cx) / rx;
      const distSq = dx * dx + dy * dy;
      const m = mask[idx] ?? 0;

      let baseProfile = Math.max(0, 1.0 - Math.min(1.0, distSq));
      if (y > cy + ry * 0.4) {
        const neckFactor = clamp((y - (cy + ry * 0.4)) / (h * 0.35), 0, 1);
        baseProfile *= 1.0 - neckFactor * 0.65;
      }

      const shadingVariation = (lum[idx]! - 0.5) * 0.1;
      let dVal = baseProfile * 0.7 + shadingVariation;
      dVal = clamp(dVal, 0.0, 1.0) * (0.35 + 0.65 * m);
      depth[idx] = dVal;
    }
  }

  return depth;
}
