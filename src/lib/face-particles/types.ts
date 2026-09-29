export type ColorMode = "mono" | "hybrid" | "color" | "dither";
export type RenderTheme = "particle" | "water" | "glass" | "cosmic" | "gold";

export interface Params {
  particles: number;
  size: number;
  contrast: number;
  detail: number;
  feature: number;
  floor: number;
  softness: number;
  depth: number;
  color: boolean;
  colorStyle: ColorMode;
  colorMix: number;
  invert: boolean;
  straighten: boolean;
  removeBg: boolean;
  radiance?: number;
  motionSensor?: boolean;
  slowSway?: boolean;
  renderTheme?: RenderTheme;
  // Upgrade Spec additions:
  toneLift?: number;         // 0..1 CLAHE tone lift (default 1.0)
  sizeVariation?: number;    // 0..1 per-particle density-based radius variation (default 0.6)
  dofAperture?: number;      // 0..2 Depth of Field aperture (default 0.8)
  relight?: number;          // 0..0.5 Normal-based relighting intensity (default 0.22)
  bloom?: boolean;           // Bloom toggle (default auto/false)
  adaptiveSampling?: boolean;// Analysis-by-synthesis adaptive pass (default true)
  breathing?: boolean;       // Organic idle micro-breathing (default true)
  autoHD?: boolean;          // Auto-apply Depth Anything V2 morph if available (default true)
  zScale?: number;           // Depth scale multiplier (default 0.65)
  focusZ?: number;           // Focal depth plane
}

export interface ParticleSet {
  count: number;
  home: Float32Array;        // 3 floats per particle: x, y, z
  restZ: Float32Array;
  tone: Uint8Array;
  seed: Float32Array;
  color: Uint8Array;         // 3 bytes per particle: r, g, b
  semantic?: Uint8Array;
  // Upgrade Spec additions:
  size?: Uint8Array;         // 1 byte per particle: normalized 0..255 radius scale
  normal?: Int8Array;        // 2 bytes per particle: nx, ny (reconstruct nz)
  region?: Uint8Array;       // 1 byte: 0 other, 1 hair, 2 skin, 3 clothes, 4 identity feature
  z1?: Float32Array;         // 1 float per particle: fused neural depth morph target
  normal1?: Int8Array;       // 2 bytes per particle: fused neural normal
  focusZ?: number;           // View-space focus plane depth
  metrics?: {
    mae: number;
    ssim: number;
    deltaE_roi?: number;
  };
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Connection {
  start: number;
  end: number;
}

export interface VisionResult {
  hasFace: boolean;
  landmarks: Landmark[] | null;
  /** Class id per source pixel: 0 bg, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 other */
  classes: Uint8Array | null;
  classW: number;
  classH: number;
  sourceW: number;
  sourceH: number;
  degraded: {
    landmarker: boolean;
    segmenter: boolean;
  };
}

export interface CropResult {
  canvas: HTMLCanvasElement;
  imageData: ImageData;
  width: number;
  height: number;
  landmarks: Landmark[] | null;
  /** 0..1 head membership, crop resolution */
  mask: Float32Array;
  /** 1 inside hair or skin */
  hairSkin: Float32Array;
  /** 1 inside face-skin (for auto-exposure) */
  faceSkin: Float32Array;
  iod: number;
  hasFace: boolean;
}

export interface PipelineProgress {
  stage: string;
  fraction: number;
}

export type EffectName =
  | "build"
  | "assemble"
  | "disassemble"
  | "wind"
  | "vortex"
  | "ripple"
  | "fill"
  | "burst"
  | "idle";

export type AnimState =
  | "building"
  | "assembled"
  | "disassembling"
  | "scattered"
  | "assembling"
  | "filling"
  | "bursting"
  | "effect";
