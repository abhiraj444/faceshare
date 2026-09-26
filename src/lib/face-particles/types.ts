export type ColorMode = "mono" | "hybrid" | "color";
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
}

export interface ParticleSet {
  count: number;
  home: Float32Array;
  restZ: Float32Array;
  tone: Uint8Array;
  seed: Float32Array;
  color: Uint8Array;
  semantic?: Uint8Array;
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
