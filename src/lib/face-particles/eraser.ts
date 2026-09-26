import type { ParticleSet } from "./types";

export interface ErasePoint {
  x: number;
  y: number;
}

/**
 * Creates a filtered ParticleSet containing only particles where keepMask[i] !== 0.
 */
export function filterParticleSet(set: ParticleSet, keepMask: Uint8Array): ParticleSet {
  let kept = 0;
  const n = set.count;
  for (let i = 0; i < n; i++) {
    if (keepMask[i] !== 0) kept++;
  }

  const home = new Float32Array(kept * 3);
  const restZ = new Float32Array(kept);
  const tone = new Uint8Array(kept);
  const seed = new Float32Array(kept);
  const color = new Uint8Array(kept * 3);

  let dst = 0;
  for (let src = 0; src < n; src++) {
    if (keepMask[src] === 0) continue;
    home[dst * 3] = set.home[src * 3]!;
    home[dst * 3 + 1] = set.home[src * 3 + 1]!;
    home[dst * 3 + 2] = set.home[src * 3 + 2]!;
    restZ[dst] = set.restZ[src]!;
    tone[dst] = set.tone[src]!;
    seed[dst] = set.seed[src]!;
    color[dst * 3] = set.color[src * 3]!;
    color[dst * 3 + 1] = set.color[src * 3 + 1]!;
    color[dst * 3 + 2] = set.color[src * 3 + 2]!;
    dst++;
  }

  return { count: kept, home, restZ, tone, seed, color };
}

/**
 * Projects 3D particles to 2D screen coordinates and marks particles
 * inside the eraser brush circle/capsule as erased (keepMask[i] = 0).
 * Returns the array of particle indices that were newly erased in this stroke.
 */
export function eraseParticlesAlongSegment(
  set: ParticleSet,
  keepMask: Uint8Array,
  viewProj: Float32Array,
  canvasW: number,
  canvasH: number,
  p0: ErasePoint,
  p1: ErasePoint,
  radiusPx: number,
): number[] {
  const m = viewProj;
  const n = set.count;
  const home = set.home;
  const r2 = radiusPx * radiusPx;

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const segLen2 = dx * dx + dy * dy;

  const newlyErased: number[] = [];

  for (let i = 0; i < n; i++) {
    if (keepMask[i] === 0) continue;

    const x = home[i * 3]!;
    const y = home[i * 3 + 1]!;
    const z = home[i * 3 + 2]!;

    // Project to clip space
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;

    // Ignore particles behind the camera plane
    if (cw <= 0.001) continue;

    const ndcX = cx / cw;
    const ndcY = cy / cw;

    // Viewport bounds check with safety margin
    if (ndcX < -1.4 || ndcX > 1.4 || ndcY < -1.4 || ndcY > 1.4) continue;

    const sx = (ndcX * 0.5 + 0.5) * canvasW;
    const sy = (1.0 - (ndcY * 0.5 + 0.5)) * canvasH;

    // Distance to point or capsule line segment
    let dist2 = 0;
    if (segLen2 < 1e-4) {
      const px = sx - p0.x;
      const py = sy - p0.y;
      dist2 = px * px + py * py;
    } else {
      // Project (sx, sy) onto segment p0->p1
      const t = Math.max(0, Math.min(1, ((sx - p0.x) * dx + (sy - p0.y) * dy) / segLen2));
      const projX = p0.x + t * dx;
      const projY = p0.y + t * dy;
      const px = sx - projX;
      const py = sy - projY;
      dist2 = px * px + py * py;
    }

    if (dist2 <= r2) {
      keepMask[i] = 0;
      newlyErased.push(i);
    }
  }

  return newlyErased;
}
