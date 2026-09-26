export type EasingType = "linear" | "easeInOutCubic" | "easeOutQuad" | "elastic" | "expo";

export interface ChoreographyBeat {
  id: string;
  name: string;
  atSeconds: number;
  duration: number;
  easing: EasingType;
  forces: {
    assemble?: number;
    turbulence?: number;
    vortex?: number;
    wind?: number;
    shockwave?: number;
    fill?: number;
  };
  camera?: {
    orbitDeg?: number;
    pitch?: number;
    distance?: number;
  };
}

export interface ChoreographyPreset {
  id: string;
  title: string;
  description: string;
  defaultDuration: number;
  beats: ChoreographyBeat[];
}

export function evaluateEasing(t: number, easing: EasingType): number {
  const c = Math.max(0, Math.min(1, t));
  switch (easing) {
    case "easeInOutCubic":
      return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
    case "easeOutQuad":
      return 1 - (1 - c) * (1 - c);
    case "expo":
      return c === 0 ? 0 : Math.pow(2, 10 * c - 10);
    case "elastic": {
      const c4 = (2 * Math.PI) / 3;
      return c === 0 ? 0 : c === 1 ? 1 : Math.pow(2, -10 * c) * Math.sin((c * 10 - 0.75) * c4) + 1;
    }
    case "linear":
    default:
      return c;
  }
}

/**
 * Authored Choreography Presets (v2 Remediation §4):
 * Cinematic animation timelines with camera motion paths and physics modulation.
 */
export const CHOREOGRAPHY_PRESETS: Record<string, ChoreographyPreset> = {
  break_reassemble: {
    id: "break_reassemble",
    title: "Disperse & Reform",
    description: "Elegant dispersal into curl turbulence followed by crystalline snap reassembly",
    defaultDuration: 14,
    beats: [
      {
        id: "hold",
        name: "Phase 1/4 · Cinematic Hold",
        atSeconds: 0,
        duration: 3.5,
        easing: "easeInOutCubic",
        forces: { assemble: 1.0, turbulence: 0.12 },
        camera: { orbitDeg: -8, pitch: 0.03, distance: 2.45 },
      },
      {
        id: "disperse",
        name: "Phase 2/4 · Fluid Dispersal",
        atSeconds: 3.5,
        duration: 4.0,
        easing: "easeOutQuad",
        forces: { assemble: 0.0, turbulence: 0.85, vortex: 0.4 },
        camera: { orbitDeg: 12, pitch: 0.08, distance: 2.65 },
      },
      {
        id: "reform",
        name: "Phase 3/4 · Harmonic Reassembly",
        atSeconds: 7.5,
        duration: 3.5,
        easing: "elastic",
        forces: { assemble: 1.0, turbulence: 0.18, vortex: 0.0 },
        camera: { orbitDeg: 0, pitch: 0.02, distance: 2.4 },
      },
      {
        id: "ripple_climax",
        name: "Phase 4/4 · Resonance Wave",
        atSeconds: 11.0,
        duration: 3.0,
        easing: "easeInOutCubic",
        forces: { assemble: 1.0, shockwave: 0.9, turbulence: 0.1 },
        camera: { orbitDeg: -4, pitch: 0.04, distance: 2.38 },
      },
    ],
  },
  fill_break: {
    id: "fill_break",
    title: "Celestial Rain & Settle",
    description: "Particles rain from above, settle layer by layer, and dissolve in wave ripple",
    defaultDuration: 16,
    beats: [
      {
        id: "rain",
        name: "Phase 1/4 · Raining from Above",
        atSeconds: 0,
        duration: 5.5,
        easing: "linear",
        forces: { fill: 1.0, assemble: 0.2, turbulence: 0.25 },
        camera: { orbitDeg: -15, pitch: -0.12, distance: 2.6 },
      },
      {
        id: "settle",
        name: "Phase 2/4 · Crystalline Settle",
        atSeconds: 5.5,
        duration: 3.5,
        easing: "easeInOutCubic",
        forces: { fill: 0.0, assemble: 1.0, turbulence: 0.08 },
        camera: { orbitDeg: 0, pitch: 0.02, distance: 2.4 },
      },
      {
        id: "burst",
        name: "Phase 3/4 · Wind Dispersal",
        atSeconds: 9.0,
        duration: 3.5,
        easing: "expo",
        forces: { assemble: 0.15, wind: 1.2, turbulence: 0.7 },
        camera: { orbitDeg: 14, pitch: 0.06, distance: 2.7 },
      },
      {
        id: "resolve",
        name: "Phase 4/4 · Return to Equilibrium",
        atSeconds: 12.5,
        duration: 3.5,
        easing: "easeInOutCubic",
        forces: { assemble: 1.0, wind: 0.0, turbulence: 0.12 },
        camera: { orbitDeg: 0, pitch: 0.02, distance: 2.42 },
      },
    ],
  },
  vortex_burst: {
    id: "vortex_burst",
    title: "Vortex Singularity",
    description: "Hypnotic cyclonic spiral pulling into singularity then cosmic shockwave",
    defaultDuration: 15,
    beats: [
      {
        id: "spiral_in",
        name: "Phase 1/4 · Cyclonic Spiral",
        atSeconds: 0,
        duration: 4.5,
        easing: "easeInOutCubic",
        forces: { vortex: 1.3, assemble: 0.2, turbulence: 0.4 },
        camera: { orbitDeg: -20, pitch: 0.12, distance: 2.8 },
      },
      {
        id: "singularity",
        name: "Phase 2/4 · Gravitational Compression",
        atSeconds: 4.5,
        duration: 2.5,
        easing: "expo",
        forces: { vortex: 1.8, assemble: 0.05, turbulence: 0.9 },
        camera: { orbitDeg: 0, pitch: 0.15, distance: 3.0 },
      },
      {
        id: "shockwave",
        name: "Phase 3/4 · Explosive Shockwave",
        atSeconds: 7.0,
        duration: 4.0,
        easing: "elastic",
        forces: { shockwave: 1.6, vortex: 0.0, assemble: 0.8 },
        camera: { orbitDeg: 10, pitch: -0.05, distance: 2.5 },
      },
      {
        id: "crystallize",
        name: "Phase 4/4 · Final Crystallization",
        atSeconds: 11.0,
        duration: 4.0,
        easing: "easeInOutCubic",
        forces: { assemble: 1.0, shockwave: 0.0, turbulence: 0.1 },
        camera: { orbitDeg: 0, pitch: 0.02, distance: 2.4 },
      },
    ],
  },
};
