import { BLUE_NOISE_SIZE } from "./config";

let cached: Float32Array | null = null;

function blur(src: Float32Array, n: number, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = new Float32Array(radius * 2 + 1);
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp((-0.5 * i * i) / (sigma * sigma));
    kernel[i + radius] = v;
    ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = (x + k + n) % n;
        acc += src[y * n + xx] * kernel[k + radius];
      }
      tmp[y * n + x] = acc;
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = (y + k + n) % n;
        acc += tmp[yy * n + x] * kernel[k + radius];
      }
      out[y * n + x] = acc;
    }
  }
  return out;
}

/** Void-and-cluster-ish rank texture via high-pass + ranking (Ulichney-style). */
export function getBlueNoise(): Float32Array {
  if (cached) return cached;
  const n = BLUE_NOISE_SIZE;
  const size = n * n;
  const values = new Float32Array(size);
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < size; i++) values[i] = rnd();
  for (let iter = 0; iter < 6; iter++) {
    const b = blur(values, n, 1.15);
    for (let i = 0; i < size; i++) values[i] -= b[i] * 0.85;
  }
  const idx = new Uint32Array(size);
  for (let i = 0; i < size; i++) idx[i] = i;
  idx.sort((a, b) => values[a] - values[b]);
  const out = new Float32Array(size);
  const denom = Math.max(1, size - 1);
  for (let i = 0; i < size; i++) out[idx[i]] = i / denom;
  cached = out;
  return out;
}

export function blueAt(noise: Float32Array, x: number, y: number): number {
  const n = BLUE_NOISE_SIZE;
  const xx = ((x % n) + n) % n;
  const yy = ((y % n) + n) % n;
  return noise[yy * n + xx];
}
