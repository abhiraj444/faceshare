import type { ParticleSet } from "./types";
import type { PipelineCache } from "./pipeline";
import { createMat4, lookAt, multiply, perspective, clamp } from "./math";
import { blurChannel, percentileMasked, dilate, type WeightMaps } from "./weights";
import { sample } from "./sampler";

export type PrintPose = "current" | "frontal" | "three_quarter_left" | "three_quarter_right" | "tilt";
export type PrintStyle = "mono" | "color" | "hybrid";

export interface PrintOptions {
  pose: PrintPose;
  style: PrintStyle;
  colorMix?: number;
  currentYaw?: number;
  currentPitch?: number;
  dpi?: number;
}

// A4 Dimensions at 300 DPI: 210mm x 297mm (Standard International Paper)
export const A4_WIDTH_300DPI = 2480;
export const A4_HEIGHT_300DPI = 3508;
export const A4_ASPECT = A4_WIDTH_300DPI / A4_HEIGHT_300DPI; // ~0.706955

function getPoseAngles(pose: PrintPose, currentYaw = 0, currentPitch = 0.04): { yaw: number; pitch: number } {
  switch (pose) {
    case "frontal":
      return { yaw: 0, pitch: 0.02 };
    case "three_quarter_left":
      return { yaw: -0.30, pitch: 0.04 };
    case "three_quarter_right":
      return { yaw: 0.30, pitch: 0.04 };
    case "tilt":
      return { yaw: 0, pitch: -0.20 };
    case "current":
    default:
      return { yaw: currentYaw, pitch: currentPitch };
  }
}

export interface ProjectedParticle {
  x: number;
  y: number;
  r: number;
  color: string;
  opacity: number;
}

/**
 * Generate a dedicated, print-optimized particle set engineered specifically for positive printing on white paper.
 * - Highlights (cheeks, forehead, teeth, nose bridge) are kept clean and luminous.
 * - Shadows (hair, cap, sunglasses frame, pupils, clothing) receive rich, velvety stippling without blotching.
 * - Completely eliminates hard edge boundaries or forehead cut lines.
 */
export function generatePrintSet(cache: PipelineCache, count = 75000): ParticleSet {
  const { crop, depth } = cache;
  const { width: w, height: h, imageData, mask, hairSkin, faceSkin } = crop;
  const px = imageData.data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (0.2126 * px[p]! + 0.7152 * px[p + 1]! + 0.0722 * px[p + 2]!) / 255;
  }

  // Calculate percentiles on hairSkin (entire subject including hat, hair, face, neck)
  let hasHairSkin = false;
  for (let i = 0; i < hairSkin.length; i++) {
    if (hairSkin[i]! > 0.3) {
      hasHairSkin = true;
      break;
    }
  }
  const toneMask = hasHairSkin ? hairSkin : faceSkin;
  const p5 = percentileMasked(lum, toneMask, 0.03);
  const p95 = Math.max(p5 + 0.05, percentileMasked(lum, toneMask, 0.97));

  // Positive ink tone: 0 = pure white paper highlight, 1 = maximum black ink in shadows
  const inkTone = new Float32Array(w * h);
  const invRange = 1 / (p95 - p5);
  for (let i = 0; i < lum.length; i++) {
    inkTone[i] = clamp(1.0 - (lum[i]! - p5) * invRange, 0, 1);
  }

  // Multi-scale Difference-of-Gaussians for razor-sharp edge stipples along glasses, hat brim, eyes, lips
  const blurA = blurChannel(inkTone, w, h, 1.0);
  const blurB = blurChannel(inkTone, w, h, 1.8);
  const edges = new Float32Array(w * h);
  for (let i = 0; i < edges.length; i++) {
    edges[i] = clamp(Math.abs(blurA[i]! - blurB[i]!) * 5.5, 0, 1);
  }

  const dil = dilate(mask, w, h, 3);
  const M = blurChannel(dil, w, h, Math.max(1.2, Math.min(w, h) * 0.02 * 0.65));
  // Continuous smooth skin blur eliminates any forehead or temple demarcation lines
  const smoothSkin = blurChannel(faceSkin, w, h, Math.max(8, Math.round(w * 0.035)));

  const weight = new Float32Array(w * h);
  for (let i = 0; i < weight.length; i++) {
    // Contrast curve calibrated for crisp, fine-art pointillism on paper
    const baseW = Math.pow(Math.max(inkTone[i]!, 1e-4), 1.12) * (1 + 1.25 * edges[i]!);
    // Delicate skin floor ensures smooth, subtle shading on skin highlights without turning muddy
    const effFloor = 0.03 + 0.045 * smoothSkin[i]!;
    weight[i] = Math.max(baseW, effFloor * (hairSkin[i] ?? 0)) * M[i]!;
  }

  const maps: WeightMaps = { weight, tone: inkTone, width: w, height: h };
  return sample(maps, depth, crop, count);
}

/**
 * Projects 3D particles onto 2D A4 page coordinates with mathematical precision.
 * Centers and scales the portrait to fill ~88% of the A4 page with gallery margins.
 */
export function projectParticlesToA4(
  input: ParticleSet | PipelineCache,
  options: PrintOptions,
  canvasW = A4_WIDTH_300DPI,
  canvasH = A4_HEIGHT_300DPI,
): ProjectedParticle[] {
  // If pipeline cache is provided, generate a dedicated print-optimized particle set
  const set: ParticleSet = "crop" in input ? generatePrintSet(input) : input;

  const { yaw, pitch } = getPoseAngles(options.pose, options.currentYaw, options.currentPitch);
  const aspect = canvasW / canvasH;

  const proj = createMat4();
  const view = createMat4();
  const viewProj = createMat4();

  const baseFov = (32 * Math.PI) / 180;
  const fov = 2 * Math.atan(Math.tan(baseFov / 2) * (0.86 / Math.max(0.45, aspect)));
  perspective(proj, fov, aspect, 0.1, 20);

  const dist = 2.45;
  const eye: [number, number, number] = [
    Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  ];
  lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
  multiply(viewProj, proj, view);

  const m = viewProj;
  const n = set.count;
  const home = set.home;
  const seed = set.seed;
  const color = set.color;

  const ndcX = new Float32Array(n);
  const ndcY = new Float32Array(n);
  const valid = new Uint8Array(n);

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;

  for (let i = 0; i < n; i++) {
    const x = home[i * 3]!;
    const y = home[i * 3 + 1]!;
    const z = home[i * 3 + 2]!;

    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;

    if (cw > 0.01) {
      const invW = 1 / cw;
      const nx = cx * invW;
      const ny = cy * invW;
      ndcX[i] = nx;
      ndcY[i] = ny;
      valid[i] = 1;

      // Filter extreme outliers for tight, elegant gallery framing
      if (Math.abs(nx) < 1.4 && Math.abs(ny) < 1.6) {
        minX = Math.min(minX, nx);
        maxX = Math.max(maxX, nx);
        minY = Math.min(minY, ny);
        maxY = Math.max(maxY, ny);
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    minX = -0.7; maxX = 0.7; minY = -0.9; maxY = 0.9;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const portraitAspect = spanX / Math.max(0.01, spanY);

  // Target portrait to fill ~88% of A4 printable area with gallery margins
  const marginFrac = 0.06;
  const targetAreaW = canvasW * (1 - marginFrac * 2);
  const targetAreaH = canvasH * (1 - marginFrac * 2);

  let scale: number;
  if (targetAreaW / targetAreaH > portraitAspect) {
    scale = targetAreaH / spanY;
  } else {
    scale = targetAreaW / spanX;
  }

  const centerNdcX = (minX + maxX) / 2;
  const centerNdcY = (minY + maxY) / 2;
  const pageCenterX = canvasW / 2;
  const pageCenterY = canvasH / 2;

  const out: ProjectedParticle[] = [];
  const colorMix = options.colorMix ?? 0.5;
  const style = options.style;

  // Refined base dot radius at 300 DPI (~1.18px radius = 2.36px diameter)
  // Perfectly mimics a fine-tip 005 / 01 Sakura Pigma Micron pen without blotching
  const baseDotR = (canvasW / 2480) * 1.18;

  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;

    const px = pageCenterX + (ndcX[i]! - centerNdcX) * scale;
    // Flip Y because in NDC +1 is top, in canvas +1 is bottom
    const py = pageCenterY - (ndcY[i]! - centerNdcY) * scale;

    if (px < -20 || px > canvasW + 20 || py < -20 || py > canvasH + 20) continue;

    const cr = color[i * 3]!;
    const cg = color[i * 3 + 1]!;
    const cb = color[i * 3 + 2]!;

    // True photographic luminance to modulate ink density and size on white paper
    const lum = (0.2126 * cr + 0.7152 * cg + 0.0722 * cb) / 255;
    const inkDensity = clamp(1.0 - lum, 0, 1);
    const s = seed[i]!;

    // Subtly modulate dot size and opacity with ink density for rich stipple gradation
    const r = baseDotR * (0.80 + 0.35 * inkDensity);
    const opacity = 0.72 + 0.28 * inkDensity;

    // Rich photographic pigments enhanced for paper print contrast
    const pr = clamp(Math.round(Math.pow(cr / 255, 1.08) * 0.94 * 255), 0, 255);
    const pg = clamp(Math.round(Math.pow(cg / 255, 1.08) * 0.94 * 255), 0, 255);
    const pb = clamp(Math.round(Math.pow(cb / 255, 1.08) * 0.94 * 255), 0, 255);

    let colStr: string;
    if (style === "mono") {
      // Carbon India ink
      colStr = "#09090b";
    } else if (style === "color") {
      colStr = `rgb(${pr},${pg},${pb})`;
    } else {
      // Hybrid: Interweave carbon ink with vibrant source color
      const isColor = s < colorMix;
      colStr = isColor ? `rgb(${pr},${pg},${pb})` : "#09090b";
    }

    out.push({
      x: Math.round(px * 10) / 10,
      y: Math.round(py * 10) / 10,
      r: Math.round(r * 100) / 100,
      color: colStr,
      opacity: Math.round(opacity * 100) / 100,
    });
  }

  return out;
}

/**
 * Render directly mapped particles onto an ultra-high resolution 300 DPI A4 Canvas.
 */
export async function renderA4Canvas(
  input: ParticleSet | PipelineCache,
  options: PrintOptions,
  width = A4_WIDTH_300DPI,
  height = A4_HEIGHT_300DPI,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("Could not create A4 print canvas");

  // Pure white paper background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const particles = projectParticlesToA4(input, options, width, height);

  // Group by color and opacity to minimize state changes for blazing fast rasterization
  const groups = new Map<string, { x: number; y: number; r: number }[]>();
  for (const p of particles) {
    const key = `${p.color}|${p.opacity}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(p);
  }

  for (const [key, group] of groups.entries()) {
    const sep = key.indexOf("|");
    const col = key.substring(0, sep);
    const op = parseFloat(key.substring(sep + 1));
    ctx.fillStyle = col;
    ctx.globalAlpha = op;
    ctx.beginPath();
    for (const p of group) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  return canvas;
}

/**
 * Export mathematical vector SVG of particles on an A4 page.
 * Infinitely sharp vector circles suitable for professional vector plotters, fine-art printing, and Illustrator.
 */
export function exportA4VectorSvg(
  input: ParticleSet | PipelineCache,
  options: PrintOptions,
  width = A4_WIDTH_300DPI,
  height = A4_HEIGHT_300DPI,
): string {
  const particles = projectParticlesToA4(input, options, width, height);

  const groups = new Map<string, { x: number; y: number; r: number }[]>();
  for (const p of particles) {
    const key = `${p.color}|${p.opacity}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(p);
  }

  const svgParts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="210mm" height="297mm">`,
    `  <rect width="100%" height="100%" fill="#ffffff"/>`,
  ];

  for (const [key, group] of groups.entries()) {
    const sep = key.indexOf("|");
    const col = key.substring(0, sep);
    const op = key.substring(sep + 1);
    svgParts.push(`  <g fill="${col}" fill-opacity="${op}">`);
    for (const p of group) {
      svgParts.push(`    <circle cx="${p.x}" cy="${p.y}" r="${p.r}"/>`);
    }
    svgParts.push(`  </g>`);
  }

  svgParts.push(`</svg>`);
  return svgParts.join("\n");
}

/**
 * Triggers native browser print dialog specifically formatted for physical A4 paper.
 */
export async function printA4Direct(canvas: HTMLCanvasElement): Promise<void> {
  const dataUrl = canvas.toDataURL("image/png");

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";

  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    window.print();
    return;
  }

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Face Particles - Fine Art A4 Print</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }
          *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            background: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
          }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" alt="A4 Particle Portrait" />
      </body>
    </html>
  `);
  doc.close();

  const img = doc.querySelector("img");
  const doPrint = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 4000);
  };

  if (img?.complete) {
    setTimeout(doPrint, 250);
  } else if (img) {
    img.onload = () => setTimeout(doPrint, 250);
    img.onerror = () => {
      document.body.removeChild(iframe);
      window.print();
    };
  } else {
    setTimeout(doPrint, 250);
  }
}
