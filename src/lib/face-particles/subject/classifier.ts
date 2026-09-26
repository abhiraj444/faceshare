import type { VisionResult } from "../types";
import type { SubjectType } from "./subject-field";

export interface ClassifierOptions {
  explicitType?: SubjectType;
  isText?: boolean;
}

/**
 * SubjectClassifier (v2 Remediation §5.1):
 * Inspects the input and vision signals to route processing to the optimal SubjectAdapter.
 * User manual override takes precedence.
 */
export function classifySubject(
  source: HTMLCanvasElement | string,
  vision?: VisionResult,
  options?: ClassifierOptions,
): SubjectType {
  // Explicit manual selection takes immediate priority
  if (options?.explicitType) {
    return options.explicitType;
  }

  // String input is always typography/text
  if (typeof source === "string" || options?.isText) {
    return "text";
  }

  // Human face confirmed by MediaPipe Vision
  if (vision && vision.hasFace) {
    return "face";
  }

  // If no face was detected by MediaPipe, analyze canvas heuristics
  // (e.g. Aspect ratio, edge density, color contrast)
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "object";

  // Check if image looks like text/handwriting/drawing/logo
  try {
    const sampleW = Math.min(w, 256);
    const sampleH = Math.min(h, 256);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
    const n = sampleW * sampleH;

    // Sample border pixels to detect background
    let borderLumSum = 0;
    let borderCount = 0;
    for (let x = 0; x < sampleW; x += 4) {
      const topIdx = x * 4;
      const btmIdx = ((sampleH - 1) * sampleW + x) * 4;
      borderLumSum += (data[topIdx]! + data[topIdx + 1]! + data[topIdx + 2]!) / 3;
      borderLumSum += (data[btmIdx]! + data[btmIdx + 1]! + data[btmIdx + 2]!) / 3;
      borderCount += 2;
    }
    const borderAvgLum = borderLumSum / Math.max(1, borderCount);

    let satSum = 0;
    let fgPixels = 0;
    let _edgeContrastCount = 0;

    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const r = data[p]!;
      const g = data[p + 1]!;
      const b = data[p + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      satSum += max === 0 ? 0 : (max - min) / max;

      const lum = (r + g + b) / 3;
      if (Math.abs(lum - borderAvgLum) > 35) {
        fgPixels++;
      }
      if (i > 1 && Math.abs(lum - ((data[p - 4]! + data[p - 3]! + data[p - 2]!) / 3)) > 30) {
        _edgeContrastCount++;
      }
    }

    const avgSat = satSum / Math.max(1, n);
    const fgRatio = fgPixels / Math.max(1, n);

    // If image has light background (white paper / canvas) with dark handwriting or strokes,
    // or low saturation with sparse foreground (sketches, handwriting, text), route to text/graphic!
    if (borderAvgLum > 140 && fgRatio < 0.45) {
      return "text";
    }

    // High contrast monochrome line art or text on dark background
    if (avgSat < 0.12 && fgRatio > 0.01 && fgRatio < 0.45) {
      return "text";
    }

    // Photographic color images with high saturation and dense presence:
    if (avgSat > 0.18 && fgRatio > 0.25) {
      return "animal";
    }
  } catch {
    // Canvas read restriction fallback
  }

  return "object";
}
