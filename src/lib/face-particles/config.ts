import type { Params } from "./types";

export const WORKING_W = 768;
export const WORKING_H = 1024;
export const N_MAX = 75_000;
export const N_DEFAULT = 32_000;
export const POINT_SIZE_REF_N = 32_000;
export const TOUCH_SLOTS = 5;
export const ORBIT_LIMIT = (25 * Math.PI) / 180;
export const TOUCH_RADIUS_FRAC = 0.12;
export const BLUE_NOISE_SIZE = 128;

export const DEFAULT_PARAMS: Params = {
  particles: N_DEFAULT,
  size: 2.2,
  contrast: 1.2,
  detail: 0.8,
  feature: 0.5,
  floor: 0.08,
  softness: 0.4,
  depth: 0.5,
  color: false,
  colorStyle: "mono",
  colorMix: 0.5,
  invert: false,
  straighten: true,
  removeBg: true,
  radiance: 1.0,
  motionSensor: false, // Disabled by default per user request; device tilt won't shake portrait
  slowSway: true, // Smooth continuous left-to-right gentle sway
  renderTheme: "particle",
};

const HASH_KEYS: (keyof Params)[] = [
  "particles",
  "size",
  "contrast",
  "detail",
  "feature",
  "floor",
  "softness",
  "depth",
  "color",
  "colorStyle",
  "colorMix",
  "invert",
  "straighten",
  "removeBg",
  "radiance",
  "motionSensor",
  "slowSway",
  "renderTheme",
];

export function defaultParticleCount(): number {
  return N_DEFAULT;
}

export function workingSize(): { w: number; h: number } {
  return { w: WORKING_W, h: WORKING_H };
}

export function parseHash(): Partial<Params> {
  if (typeof window === "undefined") return {};
  const raw = window.location.hash.replace(/^#/, "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<Params>;
    const out: Partial<Params> = {};
    for (const k of HASH_KEYS) {
      if (k in parsed) (out as Record<string, unknown>)[k] = parsed[k];
    }
    return out;
  } catch {
    return {};
  }
}

export function writeHash(params: Params): void {
  if (typeof window === "undefined") return;
  const slim: Record<string, unknown> = {};
  for (const k of HASH_KEYS) slim[k] = params[k];
  const next = `#${encodeURIComponent(JSON.stringify(slim))}`;
  if (window.location.hash !== next) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
  }
}

export function loadParams(): Params {
  const hash = parseHash();
  const colorStyle = hash.colorStyle ?? (hash.color ? "color" : "mono");
  const color = colorStyle !== "mono";
  return {
    ...DEFAULT_PARAMS,
    particles: defaultParticleCount(),
    ...hash,
    colorStyle,
    color,
  };
}

export const SAMPLES = [
  { id: "amara", src: "/samples/amara.jpg", label: "Amara" },
  { id: "kofi", src: "/samples/kofi.jpg", label: "Kofi" },
  { id: "mei", src: "/samples/mei.jpg", label: "Mei" },
] as const;
