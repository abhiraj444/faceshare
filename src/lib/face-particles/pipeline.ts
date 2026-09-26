import type { CropResult, Params, ParticleSet, PipelineProgress, VisionResult } from "./types";
import { loadImage, loadUrl } from "./io";
import { analyze } from "./vision";
import { headCrop } from "./crop";
import { meshDomeDepth } from "./depth";
import { straightenFace } from "./straighten";
import { buildWeights } from "./weights";
import { applyDepthScale, sample } from "./sampler";
import { classifySubject } from "./subject/classifier";
import { buildAnimalSubject } from "./subject/animal-adapter";
import { buildObjectSubject } from "./subject/object-adapter";
import { buildTextSubject, type TextAdapterOptions } from "./subject/text-adapter";
import { buildGraphicSubject } from "./subject/graphic-adapter";
import type { SubjectField, SubjectType } from "./subject/subject-field";
import { preprocessImage } from "./preprocess";
import { computeNeuralDepth } from "./neural/depth-estimator";

export interface PipelineCache {
  source: HTMLCanvasElement;
  vision: VisionResult;
  crop: CropResult;
  depth: Float32Array;
  set: ParticleSet;
  subjectType?: SubjectType;
  subjectField?: SubjectField;
  depthMode?: "standard" | "neural";
  standardDepth?: Float32Array;
  neuralDepth?: Float32Array;
}

export async function generateFromFile(
  file: Blob,
  params: Params,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  onProgress?.({ stage: "Reading photo", fraction: 0.05 });
  const img = await loadImage(file);
  return generateFromCanvas(img, params, onProgress);
}

export async function generateFromUrl(
  url: string,
  params: Params,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  onProgress?.({ stage: "Loading portrait", fraction: 0.05 });
  const img = await loadUrl(url);
  return generateFromCanvas(img, params, onProgress);
}

export async function generateFromText(
  text: string,
  params: Params,
  options?: Partial<TextAdapterOptions>,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  onProgress?.({ stage: "Sculpting 3D typography", fraction: 0.2 });
  const subject = buildTextSubject({ text, ...options }, params);
  return generateFromSubjectField(subject, params, onProgress);
}

export async function generateFromSubjectField(
  subject: SubjectField,
  params: Params,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  onProgress?.({ stage: "Laying particle field", fraction: 0.65 });
  const maps = buildWeights(subject.crop, params);
  onProgress?.({ stage: "Sampling blue-noise particles", fraction: 0.85 });
  const set = sample(maps, subject.depthMap, subject.crop, params.particles);
  applyDepthScale(set, params.depth);
  onProgress?.({ stage: "Ready", fraction: 1 });

  return {
    source: subject.crop.canvas,
    vision: {
      hasFace: subject.subjectType === "face",
      landmarks: subject.crop.landmarks ?? [],
      classes: null,
      classW: 0,
      classH: 0,
      sourceW: subject.crop.width,
      sourceH: subject.crop.height,
      degraded: {
        landmarker: subject.subjectType !== "face",
        segmenter: false,
      },
    },
    crop: subject.crop,
    depth: subject.depthMap,
    set,
    subjectType: subject.subjectType,
    subjectField: subject,
    depthMode: "standard",
    standardDepth: subject.depthMap,
  };
}

export async function generateFromCanvas(
  rawImg: HTMLCanvasElement,
  params: Params,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  // Phase 1: Preprocessing & Noise Cleaning Pipeline
  onProgress?.({ stage: "Preprocessing: Denoise & exposure normalization", fraction: 0.1 });
  const { canvas: img } = preprocessImage(rawImg, {
    denoise: true,
    normalizeExposure: true,
    upscaleLowRes: true,
    minDimension: 512,
  });

  onProgress?.({ stage: "Analyzing subject", fraction: 0.2 });
  const vision = await analyze(img);

  // Subject Classifier: Face vs Text/Graphic vs Animal vs Object
  const subjectType = classifySubject(img, vision);

  if (subjectType === "text") {
    onProgress?.({ stage: "Detected graphic / text · Centering and sculpting 3D form", fraction: 0.4 });
    const graphicSubject = buildGraphicSubject(img, params);
    return generateFromSubjectField(graphicSubject, params, onProgress);
  }

  if (subjectType === "animal") {
    onProgress?.({ stage: "Detected pet / animal · Fitting volumetric dome", fraction: 0.4 });
    const animalSubject = buildAnimalSubject(img, params);
    return generateFromSubjectField(animalSubject, params, onProgress);
  }

  if (subjectType === "object") {
    onProgress?.({ stage: "Detected object · Computing saliency depth", fraction: 0.4 });
    const objectSubject = buildObjectSubject(img, params);
    return generateFromSubjectField(objectSubject, params, onProgress);
  }

  // Face Subject Pipeline with 4-Pass Straightening & Regularized Depth
  onProgress?.({ stage: "Straightening portrait", fraction: 0.35 });
  const straightened = await straightenFace(img, vision, params.straighten);
  const activeSource = straightened.source;
  const activeVision = straightened.vision;

  onProgress?.({ stage: "Framing face", fraction: 0.5 });
  const crop = headCrop(activeSource, activeVision, params);

  onProgress?.({ stage: "Sculpting geometric depth", fraction: 0.65 });
  const standardDepth = meshDomeDepth(crop);

  onProgress?.({ stage: "Laying particle field", fraction: 0.8 });
  const maps = buildWeights(crop, params);

  onProgress?.({ stage: "Sampling particles", fraction: 0.92 });
  const set = sample(maps, standardDepth, crop, params.particles);
  applyDepthScale(set, params.depth);

  onProgress?.({ stage: "Ready", fraction: 1 });
  return {
    source: activeSource,
    vision: activeVision,
    crop,
    depth: standardDepth,
    standardDepth,
    depthMode: "standard",
    set,
    subjectType: "face",
  };
}

export function switchDepthMode(
  cache: PipelineCache,
  mode: "standard" | "neural",
  params: Params,
): ParticleSet {
  cache.depthMode = mode;
  if (mode === "neural") {
    if (!cache.neuralDepth) {
      cache.neuralDepth = computeNeuralDepth(cache.crop);
    }
    cache.depth = cache.neuralDepth;
  } else {
    if (!cache.standardDepth) {
      cache.standardDepth = cache.subjectType && cache.subjectType !== "face" && cache.subjectField
        ? cache.subjectField.depthMap
        : meshDomeDepth(cache.crop);
    }
    cache.depth = cache.standardDepth;
  }
  return rebuildField(cache, params);
}

export function recrop(cache: PipelineCache, params: Params): ParticleSet {
  if (cache.subjectType && cache.subjectType !== "face") {
    return rebuildField(cache, params);
  }
  cache.crop = headCrop(cache.source, cache.vision, params);
  cache.standardDepth = meshDomeDepth(cache.crop);
  cache.neuralDepth = undefined; // Recompute lazily if switched
  cache.depth = cache.depthMode === "neural" ? computeNeuralDepth(cache.crop) : cache.standardDepth;
  return rebuildField(cache, params);
}

export function rebuildField(cache: PipelineCache, params: Params): ParticleSet {
  const maps = buildWeights(cache.crop, params);
  const set = sample(maps, cache.depth, cache.crop, params.particles);
  applyDepthScale(set, params.depth);
  cache.set = set;
  return set;
}
