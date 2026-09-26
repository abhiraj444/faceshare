import type { VisionResult } from "../types";
import type { SubjectType } from "./subject-field";
import type { BackgroundCleanResult } from "../background-cleaner";

export interface ClassifierOptions {
  explicitType?: SubjectType;
  isText?: boolean;
  bgCleanResult?: BackgroundCleanResult;
}

/**
 * SubjectClassifier:
 * Inspects the input, vision signals, and background cleaning results
 * to route processing to the optimal SubjectAdapter:
 * - "face": Human portrait confirmed by MediaPipe Vision
 * - "text": Signatures, fingerprints, handwriting, line-art, logos, sketches on paper/void
 * - "animal": Dogs, cats, pets, wildlife with volumetric head/muzzle
 * - "object": Still life, sculptures, products, vehicles, architecture
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

  // Document/graphic detected by primary background cleaner (signatures, fingerprints, sketches)
  if (options?.bgCleanResult?.isDocumentOrGraphic) {
    return "text";
  }

  // Human face confirmed by MediaPipe Vision
  if (vision && vision.hasFace) {
    return "face";
  }

  // If no face was detected by MediaPipe, analyze canvas heuristics
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "object";

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

    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const r = data[p]!;
      const g = data[p + 1]!;
      const b = data[p + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      satSum += max === 0 ? 0 : (max - min) / max;

      const lum = (r + g + b) / 3;
      if (Math.abs(lum - borderAvgLum) > 28) {
        fgPixels++;
      }
    }

    const avgSat = satSum / Math.max(1, n);
    const fgRatio = fgPixels / Math.max(1, n);

    // Signatures, fingerprints, stamps, or drawings on paper (light background with low color saturation)
    if (borderAvgLum > 110 && avgSat < 0.3) {
      return "text";
    }

    // High contrast monochrome line art, fingerprints, or text on dark background
    if (avgSat < 0.14 && fgRatio > 0.005 && fgRatio < 0.75) {
      return "text";
    }

    // Photographic color images with high saturation (pets, animals)
    if (avgSat > 0.16 && fgRatio > 0.2) {
      return "animal";
    }
  } catch {
    // Canvas read restriction fallback
  }

  return "object";
}

