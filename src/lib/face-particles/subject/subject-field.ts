import type { CropResult } from "../types";

export type SubjectType = "face" | "animal" | "text" | "object";

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
  group: string;
}

export interface SubjectBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rollDeg: number;
}

/**
 * SubjectField - The subject-agnostic intermediate representation.
 * All adapters (face, animal, text, object) produce this exact structure,
 * allowing the downstream pipeline (weight fields, blue noise sampler,
 * WebGL physics, print & export) to operate uniformly across any subject.
 */
export interface SubjectField {
  subjectType: SubjectType;
  width: number;
  height: number;
  /** Normalized 0..1, per-pixel depth field */
  depthMap: Float32Array;
  /** 0..1 per-pixel confidence - low confidence regions get regularized */
  depthConfidence: Float32Array;
  /** Alpha 0..1, matting-quality segmentation mask */
  segMask: Float32Array;
  /** RGBA pixel buffer */
  colorMap: Uint8ClampedArray;
  /** Semantic landmarks, glyph anchors, or saliency peaks */
  controlPoints: ControlPoint[];
  /** Bounding box and orientation */
  boundingBox: SubjectBoundingBox;
  /** Downstream CropResult compatibility layer */
  crop: CropResult;
}
