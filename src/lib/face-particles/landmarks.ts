import type { Connection } from "./types";

export const IDX = {
  rightEyeOuter: 33,
  leftEyeOuter: 263,
  noseTip: 1,
  chin: 152,
  forehead: 10,
  mouthRight: 61,
  mouthLeft: 291,
} as const;

const loop = (ids: number[]): Connection[] => {
  const out: Connection[] = [];
  for (let i = 0; i < ids.length; i++) {
    out.push({ start: ids[i]!, end: ids[(i + 1) % ids.length]! });
  }
  return out;
};

/** Compact fallback contours if MediaPipe connection tables are unavailable. */
export const FALLBACK_CONNECTIONS: Record<string, Connection[]> = {
  lips: loop([
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
  ]),
  leftEye: loop([263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]),
  rightEye: loop([33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]),
  leftBrow: [
    { start: 276, end: 283 },
    { start: 283, end: 282 },
    { start: 282, end: 295 },
    { start: 295, end: 285 },
    { start: 300, end: 293 },
    { start: 293, end: 334 },
    { start: 334, end: 296 },
    { start: 296, end: 336 },
  ],
  rightBrow: [
    { start: 46, end: 53 },
    { start: 53, end: 52 },
    { start: 52, end: 65 },
    { start: 65, end: 55 },
    { start: 70, end: 63 },
    { start: 63, end: 105 },
    { start: 105, end: 66 },
    { start: 66, end: 107 },
  ],
  leftIris: loop([473, 474, 475, 476]),
  rightIris: loop([468, 469, 470, 471]),
  oval: loop([
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
    148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ]),
};

export function featureGroups(mp: {
  FACE_LANDMARKS_LIPS: Connection[];
  FACE_LANDMARKS_LEFT_EYE: Connection[];
  FACE_LANDMARKS_RIGHT_EYE: Connection[];
  FACE_LANDMARKS_LEFT_EYEBROW: Connection[];
  FACE_LANDMARKS_RIGHT_EYEBROW: Connection[];
  FACE_LANDMARKS_LEFT_IRIS: Connection[];
  FACE_LANDMARKS_RIGHT_IRIS: Connection[];
  FACE_LANDMARKS_FACE_OVAL: Connection[];
} | null): { name: string; connections: Connection[] }[] {
  if (mp) {
    return [
      { name: "lips", connections: mp.FACE_LANDMARKS_LIPS },
      { name: "leftEye", connections: mp.FACE_LANDMARKS_LEFT_EYE },
      { name: "rightEye", connections: mp.FACE_LANDMARKS_RIGHT_EYE },
      { name: "leftBrow", connections: mp.FACE_LANDMARKS_LEFT_EYEBROW },
      { name: "rightBrow", connections: mp.FACE_LANDMARKS_RIGHT_EYEBROW },
      { name: "leftIris", connections: mp.FACE_LANDMARKS_LEFT_IRIS },
      { name: "rightIris", connections: mp.FACE_LANDMARKS_RIGHT_IRIS },
    ];
  }
  return Object.entries(FALLBACK_CONNECTIONS)
    .filter(([k]) => k !== "oval")
    .map(([name, connections]) => ({ name, connections }));
}
