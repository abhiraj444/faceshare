import { useEffect, useRef, useState } from "react";

interface SharedParticleLoaderProps {
  isReady: boolean;
  onFinish?: () => void;
}

interface SphereParticle {
  x: number;
  y: number;
  z: number;
  baseR: number;
  seed: number;
  size: number;
  alpha: number;
  driftSpeed: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

interface TextParticle {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  size: number;
  alpha: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export function SharedParticleLoader({
  isReady,
  onFinish,
}: SharedParticleLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const isReadyRef = useRef(isReady);
  const lastSampledText = useRef("");

  isReadyRef.current = isReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let sphereYaw = 0;
    let spherePitch = 0.08;
    let burstAge = 0;
    let finishedTriggered = false;

    // Continuous float counter for the percentage (1.0 to 100.0)
    let currentPctFloat = 1.0;

    // Canvas size
    let width = 0;
    let height = 0;
    let sphereRadius = 180;

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.round(rect.width * dpr);
      height = Math.round(rect.height * dpr);
      canvas.width = width;
      canvas.height = height;

      // Fills half the screen (diameter ≈ 80-85% of screen width on mobile, or 42% of min dimension)
      const minDim = Math.min(width, height) / dpr;
      sphereRadius = minDim * 0.42;
    }

    resize();
    window.addEventListener("resize", resize);

    // Generate volumetric, somewhat randomized monochrome sphere particles
    const SPHERE_COUNT = 3200;
    const sphereParticles: SphereParticle[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < SPHERE_COUNT; i++) {
      // Natural non-uniform angular jitter for "somewhat random" organic look
      const t = i / SPHERE_COUNT;
      const phi = Math.acos(1 - 2 * t) + (Math.random() - 0.5) * 0.12;
      const theta = goldenAngle * i + (Math.random() - 0.5) * 0.25;

      // Volumetric cloud thickness: particles are dispersed with natural Gaussian depth around sphere radius
      const radialNoise = (Math.random() - 0.5) * 0.35 + (Math.random() - 0.5) * 0.2;
      const r = (1.0 + radialNoise) * (0.9 + Math.random() * 0.2);

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);

      sphereParticles.push({
        x,
        y,
        z,
        baseR: r,
        seed: Math.random() * Math.PI * 2,
        size: 0.9 + Math.random() * 1.5,
        alpha: 0.25 + Math.random() * 0.65,
        driftSpeed: 0.4 + Math.random() * 0.8,
      });
    }

    // Text particle pool for monochrome 3D percentage text
    let textParticles: TextParticle[] = [];

    // Offscreen canvas for sampling monochrome percentage text
    const offscreen = document.createElement("canvas");
    offscreen.width = 320;
    offscreen.height = 160;
    const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

    function sampleTextParticles(text: string) {
      if (!offCtx) return;
      offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
      offCtx.font = "900 68px 'Outfit', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif";
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.fillStyle = "#ffffff";
      offCtx.fillText(text, offscreen.width / 2, offscreen.height / 2);

      const imgData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
      const data = imgData.data;
      const w = offscreen.width;
      const h = offscreen.height;

      const newTargets: { x: number; y: number; z: number }[] = [];
      const step = 4; // grid density

      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const idx = (y * w + x) * 4;
          const alpha = data[idx + 3];
          if (alpha > 128) {
            // Center around (0,0,0)
            const relX = (x - w / 2) * 1.15;
            const relY = (y - h / 2) * 1.15;
            // Slight 3D convex curvature across numbers
            const relZ = Math.cos((relX / (w * 0.45)) * 1.2) * 14;
            newTargets.push({ x: relX, y: relY, z: relZ });
          }
        }
      }

      // Reconcile particle pool smoothly
      while (textParticles.length < newTargets.length) {
        const t = newTargets[textParticles.length];
        textParticles.push({
          x: t.x + (Math.random() - 0.5) * 30,
          y: t.y + (Math.random() - 0.5) * 30,
          z: t.z + (Math.random() - 0.5) * 30,
          tx: t.x,
          ty: t.y,
          tz: t.z,
          size: 1.8 + Math.random() * 1.2,
          alpha: 0.95,
        });
      }

      for (let i = 0; i < newTargets.length; i++) {
        textParticles[i].tx = newTargets[i].x;
        textParticles[i].ty = newTargets[i].y;
        textParticles[i].tz = newTargets[i].z;
      }

      if (textParticles.length > newTargets.length) {
        textParticles = textParticles.slice(0, newTargets.length);
      }
    }

    sampleTextParticles("1%");

    let lastTime = performance.now();

    function render(time: number) {
      const dt = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;

      // CONTINUOUS PERCENTAGE INCREASE:
      // It constantly ticks every single frame without stuttering or stopping.
      if (!isReadyRef.current) {
        // While waiting for data: advances smoothly from 1% up toward 95%
        // Easing curve: faster at start, smoothly tapering, always advancing at least 8% per second
        const remaining = 95 - currentPctFloat;
        const rate = Math.max(7.5, remaining * 1.45);
        currentPctFloat = Math.min(95.5, currentPctFloat + rate * dt);
      } else {
        // Data is ready: smoothly accelerates through the remaining numbers to 100%
        const rate = Math.max(35, (100.5 - currentPctFloat) * 7.0);
        currentPctFloat = Math.min(100, currentPctFloat + rate * dt);
      }

      const displayInt = Math.max(1, Math.min(100, Math.floor(currentPctFloat)));
      const textStr = `${displayInt}%`;

      if (textStr !== lastSampledText.current) {
        lastSampledText.current = textStr;
        sampleTextParticles(textStr);
      }

      // When reaching 100%, trigger smooth shockwave dispersion bloom and transition
      if (currentPctFloat >= 99.8 && !finishedTriggered) {
        setFadingOut(true);
        burstAge += dt;
        if (burstAge > 0.5) {
          finishedTriggered = true;
          onFinish?.();
          return;
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Continuous 3D rotation (yaw & gentle pitch wobble)
      sphereYaw += dt * (burstAge > 0 ? 1.8 : 0.65);
      spherePitch = Math.sin(time * 0.0006) * 0.12;

      const cosY = Math.cos(sphereYaw);
      const sinY = Math.sin(sphereYaw);
      const cosP = Math.cos(spherePitch);
      const sinP = Math.sin(spherePitch);

      const fov = 420 * dpr;
      const currentRadius = sphereRadius * dpr;

      // 1. Render 3D MONOCHROME Sphere Particles
      for (let i = 0; i < sphereParticles.length; i++) {
        const p = sphereParticles[i];

        let px = p.x * currentRadius;
        let py = p.y * currentRadius;
        const pz = p.z * currentRadius;

        // Dispersion physics on complete
        if (burstAge > 0) {
          if (p.vx === undefined) {
            const mag = Math.hypot(p.x, p.y, p.z) || 1;
            const blastSpeed = (450 + Math.random() * 550) * dpr;
            p.vx = (p.x / mag) * blastSpeed;
            p.vy = (p.y / mag) * blastSpeed;
            p.vz = (p.z / mag) * blastSpeed;
          }
          p.x += (p.vx * dt) / currentRadius;
          p.y += (p.vy * dt) / currentRadius;
          p.z += (p.vz * dt) / currentRadius;
        } else {
          // Subtle organic drift / pulsation
          const drift = Math.sin(time * 0.0015 * p.driftSpeed + p.seed) * 4 * dpr;
          px += drift * 0.6;
          py += drift * 0.4;
        }

        // 3D Matrix Rotation
        const x1 = px * cosY + pz * sinY;
        const z1 = -px * sinY + pz * cosY;
        const y2 = py * cosP - z1 * sinP;
        const z2 = py * sinP + z1 * cosP;

        const depth = z2 + 480 * dpr;
        if (depth <= 10) continue;

        const scale = fov / depth;
        const sx = cx + x1 * scale;
        const sy = cy + y2 * scale;

        // Depth perspective alpha & size (pure monochrome stipple)
        const depthNorm = Math.max(0, Math.min(1, (z2 + currentRadius) / (currentRadius * 2)));
        let alpha = p.alpha * (0.2 + depthNorm * 0.8);
        if (burstAge > 0) {
          alpha *= Math.max(0, 1 - burstAge * 2.2);
        }

        const pointSize = Math.max(0.8, p.size * scale * (burstAge > 0 ? 1.3 : 1));

        // Draw crisp monochrome particle
        ctx.fillStyle = `rgba(242, 240, 236, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, pointSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Render 3D MONOCHROME Percentage Text Particles
      // Oscillates subtly in sync with sphere rotation
      const tYaw = Math.sin(time * 0.0009) * 0.08;
      const tPitch = Math.cos(time * 0.0008) * 0.05;
      const tCosY = Math.cos(tYaw);
      const tSinY = Math.sin(tYaw);
      const tCosP = Math.cos(tPitch);
      const tSinP = Math.sin(tPitch);

      for (let i = 0; i < textParticles.length; i++) {
        const tp = textParticles[i];

        if (burstAge > 0) {
          if (tp.vx === undefined) {
            tp.vx = (Math.random() - 0.5) * 600 * dpr;
            tp.vy = (Math.random() - 0.5) * 600 * dpr;
            tp.vz = (Math.random() - 0.5) * 600 * dpr;
          }
          tp.x += tp.vx * dt;
          tp.y += tp.vy * dt;
          tp.z += tp.vz * dt;
        } else {
          // Spring smoothly to target
          tp.x += (tp.tx * dpr - tp.x) * Math.min(1, dt * 16);
          tp.y += (tp.ty * dpr - tp.y) * Math.min(1, dt * 16);
          tp.z += (tp.tz * dpr - tp.z) * Math.min(1, dt * 16);
        }

        // Apply 3D perspective
        const tx1 = tp.x * tCosY + tp.z * tSinY;
        const tz1 = -tp.x * tSinY + tp.z * tCosY;
        const ty2 = tp.y * tCosP - tz1 * tSinP;
        const tz2 = tp.y * tSinP + tz1 * tCosP;

        const depth = tz2 + 480 * dpr;
        if (depth <= 10) continue;

        const scale = fov / depth;
        const sx = cx + tx1 * scale;
        const sy = cy + ty2 * scale;

        const pSize = Math.max(1.2, tp.size * scale * dpr);
        let alpha = tp.alpha;
        if (burstAge > 0) {
          alpha *= Math.max(0, 1 - burstAge * 2.0);
        }

        // Soft halo
        ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.2).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, pSize * 2.0, 0, Math.PI * 2);
        ctx.fill();

        // Core bright point
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, pSize, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [onFinish]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[#070708] transition-opacity duration-400 select-none pointer-events-none ${
        fadingOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* 3D Monochrome Volumetric Sphere + 3D Monochrome Particle Text */}
      <canvas
        ref={canvasRef}
        className="w-full h-full absolute inset-0 block"
      />
    </div>
  );
}
