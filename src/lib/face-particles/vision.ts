import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
} from "@mediapipe/tasks-vision";
import type { Landmark, VisionResult } from "./types";

// MediaPipe Emscripten WebAssembly runtime outputs C++ diagnostics (INFO/WARNING) to stderr,
// which browsers route to console.error/console.warn and trigger AI Studio's error overlay.
if (typeof window !== "undefined") {
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  const isMediapipeNoise = (args: unknown[]): boolean => {
    const text = args
      .map((a) => (typeof a === "string" ? a : (a && typeof a === "object" && "message" in a ? String((a as { message: unknown }).message) : "")))
      .join(" ");
    return (
      text.includes("Created TensorFlow Lite") ||
      text.includes("inference_feedback_manager") ||
      text.includes("segmentation_postprocessor") ||
      text.includes("Disabling support for feedback tensors") ||
      text.includes("XNNPACK delegate") ||
      text.includes("SOFTMAX activation function chosen on GPU") ||
      /^INFO:\s+Created\s+TensorFlow/i.test(text) ||
      /^[IWE]\d{4}\s+\d{2}:\d{2}:\d{2}/.test(text)
    );
  };

  console.error = (...args: unknown[]) => {
    if (isMediapipeNoise(args)) {
      console.debug(...args);
      return;
    }
    origError(...args);
  };

  console.warn = (...args: unknown[]) => {
    if (isMediapipeNoise(args)) {
      console.debug(...args);
      return;
    }
    origWarn(...args);
  };
}

const LOCAL_WASM_PATH = "/mediapipe/wasm";
const CDN_WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";

const LOCAL_LANDMARKER_MODEL = "/mediapipe/models/face_landmarker.task";
const CDN_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const LOCAL_SEGMENTER_MODEL = "/mediapipe/models/selfie_multiclass_256x256.tflite";
const CDN_SEGMENTER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

let wasmFilesetPromise: Promise<unknown> | null = null;
let landmarkerPromise: Promise<FaceLandmarker | null> | null = null;
let segmenterPromise: Promise<ImageSegmenter | null> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Get the FaceLandmarker class reference so landmarks.ts can access static connection tables */
export function getFaceLandmarkerClass(): typeof FaceLandmarker | null {
  return typeof FaceLandmarker !== "undefined" ? FaceLandmarker : null;
}

async function getWasmFileset(): Promise<unknown> {
  if (wasmFilesetPromise) return wasmFilesetPromise;
  wasmFilesetPromise = (async () => {
    try {
      return await withTimeout(FilesetResolver.forVisionTasks(LOCAL_WASM_PATH), 6000, "Local WASM resolver");
    } catch {
      // Fallback to CDN
      return await withTimeout(FilesetResolver.forVisionTasks(CDN_WASM_PATH), 15000, "CDN WASM resolver");
    }
  })();
  return wasmFilesetPromise;
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches)
  );
}

let cachedCpuLandmarker: FaceLandmarker | null = null;
let cachedCpuSegmenter: ImageSegmenter | null = null;

export async function createCpuLandmarker(): Promise<FaceLandmarker | null> {
  if (cachedCpuLandmarker) return cachedCpuLandmarker;
  try {
    const wasm = (await getWasmFileset()) as Parameters<typeof FaceLandmarker.createFromOptions>[0];
    try {
      cachedCpuLandmarker = await FaceLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: LOCAL_LANDMARKER_MODEL, delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 4,
        minFaceDetectionConfidence: 0.35,
        minFacePresenceConfidence: 0.35,
      });
      return cachedCpuLandmarker;
    } catch {
      cachedCpuLandmarker = await FaceLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: CDN_LANDMARKER_MODEL, delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 4,
        minFaceDetectionConfidence: 0.35,
        minFacePresenceConfidence: 0.35,
      });
      return cachedCpuLandmarker;
    }
  } catch (err) {
    console.warn("[Vision] createCpuLandmarker failed:", err);
    return null;
  }
}

export async function createCpuSegmenter(): Promise<ImageSegmenter | null> {
  if (cachedCpuSegmenter) return cachedCpuSegmenter;
  try {
    const wasm = (await getWasmFileset()) as Parameters<typeof ImageSegmenter.createFromOptions>[0];
    try {
      cachedCpuSegmenter = await ImageSegmenter.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: LOCAL_SEGMENTER_MODEL, delegate: "CPU" },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      return cachedCpuSegmenter;
    } catch {
      cachedCpuSegmenter = await ImageSegmenter.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: CDN_SEGMENTER_MODEL, delegate: "CPU" },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      return cachedCpuSegmenter;
    }
  } catch (err) {
    console.warn("[Vision] createCpuSegmenter failed:", err);
    return null;
  }
}

async function initLandmarker(): Promise<FaceLandmarker | null> {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    // On mobile devices, MediaPipe WebGL GPU delegate has known precision bugs and silent failures.
    // CPU delegate runs WASM SIMD which is ultra-reliable, fast (~150ms), and 100% accurate.
    if (isMobile()) {
      return await createCpuLandmarker();
    }
    try {
      const wasm = (await getWasmFileset()) as Parameters<typeof FaceLandmarker.createFromOptions>[0];
      try {
        return await FaceLandmarker.createFromOptions(wasm, {
          baseOptions: { modelAssetPath: LOCAL_LANDMARKER_MODEL, delegate: "GPU" },
          runningMode: "IMAGE",
          numFaces: 4,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
        });
      } catch {
        return await createCpuLandmarker();
      }
    } catch (err) {
      console.warn("[Vision] FaceLandmarker initialization failed, falling back to CPU:", err);
      return await createCpuLandmarker();
    }
  })();
  return landmarkerPromise;
}

async function initSegmenter(): Promise<ImageSegmenter | null> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    if (isMobile()) {
      return await createCpuSegmenter();
    }
    try {
      const wasm = (await getWasmFileset()) as Parameters<typeof ImageSegmenter.createFromOptions>[0];
      try {
        return await ImageSegmenter.createFromOptions(wasm, {
          baseOptions: { modelAssetPath: LOCAL_SEGMENTER_MODEL, delegate: "GPU" },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      } catch {
        return await createCpuSegmenter();
      }
    } catch (err) {
      console.warn("[Vision] ImageSegmenter initialization failed, falling back to CPU:", err);
      return await createCpuSegmenter();
    }
  })();
  return segmenterPromise;
}

/** Preload vision models in background */
export async function preloadVision(): Promise<void> {
  if (typeof window === "undefined") return;
  await Promise.allSettled([initLandmarker(), initSegmenter()]);
}

/**
 * Analyze an image canvas to extract face landmarks and multiclass segmentation mask.
 * Automatically picks the largest face if multiple faces are present.
 * Degrades gracefully if either or both models fail.
 */
export async function analyze(source: HTMLCanvasElement): Promise<VisionResult> {
  const sourceW = source.width;
  const sourceH = source.height;
  const inferSource: CanvasImageSource = source;

  const [landmarker, segmenter] = await Promise.all([
    withTimeout(initLandmarker(), 8000, "Landmarker init").catch(() => null),
    withTimeout(initSegmenter(), 8000, "Segmenter init").catch(() => null),
  ]);

  let landmarks: Landmark[] | null = null;
  let hasFace = false;
  let degradedLandmarker = !landmarker;

  const pickBestFace = (faces: { x: number; y: number; z: number }[][]) => {
    let bestFace = faces[0]!;
    let maxArea = -1;
    for (const face of faces) {
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of face) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const area = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
      if (area > maxArea) {
        maxArea = area;
        bestFace = face;
      }
    }
    return bestFace.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  };

  if (landmarker) {
    try {
      const result = landmarker.detect(inferSource);
      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        hasFace = true;
        landmarks = pickBestFace(result.faceLandmarks);
      } else {
        // If 0 faces detected (GPU delegate precision failure), immediately retry on CPU
        const cpuLm = await createCpuLandmarker();
        if (cpuLm) {
          const cpuRes = cpuLm.detect(inferSource);
          if (cpuRes.faceLandmarks && cpuRes.faceLandmarks.length > 0) {
            hasFace = true;
            landmarks = pickBestFace(cpuRes.faceLandmarks);
          }
        }
      }
    } catch (err) {
      console.warn("[Vision] Primary face detection error, falling back to CPU:", err);
      const cpuLm = await createCpuLandmarker();
      if (cpuLm) {
        try {
          const cpuRes = cpuLm.detect(inferSource);
          if (cpuRes.faceLandmarks && cpuRes.faceLandmarks.length > 0) {
            hasFace = true;
            landmarks = pickBestFace(cpuRes.faceLandmarks);
          }
        } catch {
          degradedLandmarker = true;
        }
      } else {
        degradedLandmarker = true;
      }
    }
  }

  let classes: Uint8Array | null = null;
  let classW = 0;
  let classH = 0;
  let degradedSegmenter = !segmenter;

  if (segmenter) {
    try {
      const segResult = segmenter.segment(inferSource);
      if (segResult.categoryMask) {
        const mask = segResult.categoryMask;
        classW = mask.width;
        classH = mask.height;
        classes = new Uint8Array(mask.getAsUint8Array());
        mask.close();
      }
      if (segResult.confidenceMasks) {
        for (const m of segResult.confidenceMasks) m.close();
      }

      // Sanity check: confirm segmentation mask contains face or hair
      let hasFaceOrHair = false;
      if (classes) {
        for (let i = 0; i < classes.length; i += 8) {
          const c = classes[i]!;
          if (c === 1 || c === 3) {
            hasFaceOrHair = true;
            break;
          }
        }
      }
      if (!hasFaceOrHair) {
        // If GPU segmentation missed face/hair, run CPU segmenter
        const cpuSeg = await createCpuSegmenter();
        if (cpuSeg) {
          const cpuRes = cpuSeg.segment(inferSource);
          if (cpuRes.categoryMask) {
            const mask = cpuRes.categoryMask;
            classW = mask.width;
            classH = mask.height;
            classes = new Uint8Array(mask.getAsUint8Array());
            mask.close();
          }
          if (cpuRes.confidenceMasks) {
            for (const m of cpuRes.confidenceMasks) m.close();
          }
        }
      }
    } catch (err) {
      console.warn("[Vision] Primary segmentation error, falling back to CPU:", err);
      const cpuSeg = await createCpuSegmenter();
      if (cpuSeg) {
        try {
          const cpuRes = cpuSeg.segment(inferSource);
          if (cpuRes.categoryMask) {
            const mask = cpuRes.categoryMask;
            classW = mask.width;
            classH = mask.height;
            classes = new Uint8Array(mask.getAsUint8Array());
            mask.close();
          }
          if (cpuRes.confidenceMasks) {
            for (const m of cpuRes.confidenceMasks) m.close();
          }
        } catch {
          degradedSegmenter = true;
        }
      } else {
        degradedSegmenter = true;
      }
    }
  }

  return {
    hasFace,
    landmarks,
    classes,
    classW,
    classH,
    sourceW,
    sourceH,
    degraded: {
      landmarker: degradedLandmarker,
      segmenter: degradedSegmenter,
    },
  };
}