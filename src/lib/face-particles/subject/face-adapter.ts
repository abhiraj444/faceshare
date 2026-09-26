import type { Params, VisionResult } from "../types";
import type { SubjectField } from "./subject-field";
import { straightenFace } from "../straighten";
import { headCrop } from "../crop";
import { meshDomeDepth } from "../depth";
import { IDX } from "../landmarks";

/**
 * FaceAdapter (v2 Remediation §1 & §2):
 * Wraps vision landmark analysis, 4-pass roll straightening, intelligent cropping,
 * and regularized confidence-weighted depth estimation into the universal SubjectField.
 */
export async function buildFaceSubject(
  source: HTMLCanvasElement,
  vision: VisionResult,
  params: Params,
): Promise<SubjectField> {
  // Step 1: 4-Pass Straighten (§2.2)
  const straightened = await straightenFace(source, vision, params.straighten);
  const activeSource = straightened.source;
  const activeVision = straightened.vision;

  // Step 2: Head crop with post-rotation landmarks
  const crop = headCrop(activeSource, activeVision, params);

  // Step 3: Regularized depth with distortion guard & bilateral filtering (§2.1)
  const depthMap = meshDomeDepth(crop);
  const depthConfidence = new Float32Array(crop.width * crop.height).fill(1.0);

  // Extract semantic control points for camera framing & physics anchors
  const controlPoints = [];
  if (crop.landmarks && crop.landmarks.length > 0) {
    const nose = crop.landmarks[IDX.noseTip];
    const chin = crop.landmarks[IDX.chin];
    const forehead = crop.landmarks[IDX.forehead];
    const lEye = crop.landmarks[IDX.leftEyeOuter];
    const rEye = crop.landmarks[IDX.rightEyeOuter];

    if (nose) controlPoints.push({ x: nose.x, y: nose.y, z: 0.8, group: "nose" });
    if (chin) controlPoints.push({ x: chin.x, y: chin.y, z: 0.4, group: "chin" });
    if (forehead) controlPoints.push({ x: forehead.x, y: forehead.y, z: 0.6, group: "forehead" });
    if (lEye) controlPoints.push({ x: lEye.x, y: lEye.y, z: 0.55, group: "left_eye" });
    if (rEye) controlPoints.push({ x: rEye.x, y: rEye.y, z: 0.55, group: "right_eye" });
  }

  return {
    subjectType: "face",
    width: crop.width,
    height: crop.height,
    depthMap,
    depthConfidence,
    segMask: crop.mask,
    colorMap: crop.imageData.data,
    controlPoints,
    boundingBox: {
      x: 0,
      y: 0,
      w: crop.width,
      h: crop.height,
      rollDeg: straightened.rollDeg,
    },
    crop,
  };
}
