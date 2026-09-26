import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

interface SharedParticleLoaderProps {
  progress: number; // 0 to 1
  isReady: boolean;
  title?: string;
  onFinish?: () => void;
}

interface SphereParticle {
  x: number;
  y: number;
  z: number;
  baseRadius: number;
  seed: number;
  color: string;
  size: number;
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
  color: string;
  size: number;
  alpha: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

const PALETTE = [
  "#00f5ff", // electric cyan
  "#818cf8", // indigo
  "#c084fc", // violet
  "#f472b6", // pink
  "#38bdf8", // sky
  "#34d399", // emerald
  "#fbbf24", // gold
];

export function SharedParticleLoader({
  progress,
  isReady,
  title = "3D Particle Portrait",
  onFinish,
}: SharedParticleLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displayPct, setDisplayPct] = useState(0);
  const [exploding, setExploding] = useState(false);
  const progressRef = useRef(progress);
  const displayPctRef = useRef(0);
  const isReadyRef = useRef(isReady);
  const lastSampledText = useRef("");

  progressRef.current = progress;
  isReadyRef.current = isReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    let sphereYaw = 0;
    let spherePitch = 0.2;
    let burstAge = 0;
    let finishedTriggered = false;

    // Generate 3D sphere particles using Fibonacci spherical distribution
    const SPHERE_COUNT = 2200;
    const sphereRadius = Math.min(160, Math.min(window.innerWidth, window.innerHeight) * 0.22);
    const sphereParticles: SphereParticle[] = [];

    for (let i = 0; i < SPHERE_COUNT; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / SPHERE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = sphereRadius * (0.95 + Math.random() * 0.1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      const color = PALETTE[i % PALETTE.length];
      sphereParticles.push({
        x,
        y,
        z,
        baseRadius: r,
        seed: Math.random() * 6.28,
        color,
        size: 1.2 + Math.random() * 1.6,
      });
    }

    // Text particle pool
    let textParticles: TextParticle[] = [];

    // Helper to rasterize percentage text into 3D particles
    const offscreen = document.createElement("canvas");
    offscreen.width = 280;
    offscreen.height = 140;
    const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

    function sampleTextParticles(text: string) {
      if (!offCtx) return;
      offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
      offCtx.font = "900 52px system-ui, -apple-system, 'SF Pro Display', sans-serif";
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.fillStyle = "#ffffff";
      offCtx.fillText(text, offscreen.width / 2, offscreen.height / 2);

      const imgData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
      const data = imgData.data;
      const w = offscreen.width;
      const h = offscreen.height;

      const newTargets: { x: number; y: number; z: number; color: string }[] = [];
      const step = 4; // grid sampling density

      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const idx = (y * w + x) * 4;
          const alpha = data[idx + 3];
          if (alpha > 120) {
            const relX = (x - w / 2) * 1.15;
            const relY = (y - h / 2) * 1.15;
            // 3D curvature across text
            const relZ = Math.cos((relX / (w * 0.5)) * 1.2) * 16 - 8;
            // Color gradient across the text: Cyan -> Purple -> Coral
            const u = x / w;
            const col = u < 0.4 ? "#00f5ff" : u < 0.75 ? "#c084fc" : "#f472b6";
            newTargets.push({ x: relX, y: relY, z: relZ, color: col });
          }
        }
      }

      // Reconcile text particle pool
      while (textParticles.length < newTargets.length) {
        const t = newTargets[textParticles.length];
        textParticles.push({
          x: t.x + (Math.random() - 0.5) * 40,
          y: t.y + (Math.random() - 0.5) * 40,
          z: t.z + (Math.random() - 0.5) * 40,
          tx: t.x,
          ty: t.y,
          tz: t.z,
          color: t.color,
          size: 2.2 + Math.random() * 1.4,
          alpha: 1,
        });
      }

      for (let i = 0; i < newTargets.length; i++) {
        textParticles[i].tx = newTargets[i].x;
        textParticles[i].ty = newTargets[i].y;
        textParticles[i].tz = newTargets[i].z;
        textParticles[i].color = newTargets[i].color;
      }

      // Trim excess smoothly
      if (textParticles.length > newTargets.length) {
        textParticles = textParticles.slice(0, newTargets.length);
      }
    }

    // Initial sample
    sampleTextParticles("0%");

    // Resize handling
    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    let lastTime = performance.now();

    function render(time: number) {
      const dt = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;

      // Smooth progress calculation
      const targetPct = isReadyRef.current ? 100 : Math.min(96, Math.max(10, Math.round(progressRef.current * 100)));
      displayPctRef.current += (targetPct - displayPctRef.current) * Math.min(1, dt * 5.5);
      const roundedPct = Math.min(100, Math.round(displayPctRef.current));
      setDisplayPct(roundedPct);

      const textStr = `${roundedPct}%`;
      if (textStr !== lastSampledText.current) {
        lastSampledText.current = textStr;
        sampleTextParticles(textStr);
      }

      // Check if finished and trigger explosion
      if (isReadyRef.current && roundedPct >= 99 && !finishedTriggered) {
        setExploding(true);
        burstAge += dt;
        if (burstAge > 0.6) {
          finishedTriggered = true;
          onFinish?.();
          return;
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Rotation angles
      sphereYaw += dt * (burstAge > 0 ? 3.0 : 0.85);
      spherePitch = Math.sin(time * 0.0008) * 0.25;

      const cosY = Math.cos(sphereYaw);
      const sinY = Math.sin(sphereYaw);
      const cosP = Math.cos(spherePitch);
      const sinP = Math.sin(spherePitch);

      const fov = 380 * dpr;

      // 1. Draw 3D outer sphere particles
      for (let i = 0; i < sphereParticles.length; i++) {
        const p = sphereParticles[i];

        // Explosion velocity
        if (burstAge > 0) {
          if (p.vx === undefined) {
            const mag = Math.hypot(p.x, p.y, p.z) || 1;
            const speed = 400 + Math.random() * 600;
            p.vx = (p.x / mag) * speed;
            p.vy = (p.y / mag) * speed;
            p.vz = (p.z / mag) * speed;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
        } else {
          // Subtle pulsation
          const pulse = Math.sin(time * 0.003 + p.seed) * 3;
          const curR = p.baseRadius + pulse;
          const mag = Math.hypot(p.x, p.y, p.z) || 1;
          p.x = (p.x / mag) * curR;
          p.y = (p.y / mag) * curR;
          p.z = (p.z / mag) * curR;
        }

        // 3D rotation
        const x1 = p.x * cosY + p.z * sinY;
        const z1 = -p.x * sinY + p.z * cosY;
        const y2 = p.y * cosP - z1 * sinP;
        const z2 = p.y * sinP + z1 * cosP;

        const depth = z2 + 350;
        if (depth <= 10) continue;

        const scale = fov / depth;
        const sx = cx + x1 * scale;
        const sy = cy + y2 * scale;

        // Depth-based opacity & size
        const depthAlpha = Math.max(0.12, Math.min(0.9, (z2 + sphereRadius) / (sphereRadius * 2)));
        const finalAlpha = burstAge > 0 ? depthAlpha * Math.max(0, 1 - burstAge * 1.8) : depthAlpha;
        const pSize = Math.max(1, p.size * scale * (burstAge > 0 ? 1.5 : 1));

        ctx.globalAlpha = finalAlpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, pSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Draw 3D colored particle text in the center
      // The text faces camera but oscillates gently in 3D
      const textYaw = Math.sin(time * 0.0012) * 0.12;
      const textPitch = Math.cos(time * 0.001) * 0.08;
      const tCosY = Math.cos(textYaw);
      const tSinY = Math.sin(textYaw);
      const tCosP = Math.cos(textPitch);
      const tSinP = Math.sin(textPitch);

      for (let i = 0; i < textParticles.length; i++) {
        const tp = textParticles[i];

        if (burstAge > 0) {
          if (tp.vx === undefined) {
            tp.vx = (Math.random() - 0.5) * 800;
            tp.vy = (Math.random() - 0.5) * 800;
            tp.vz = (Math.random() - 0.5) * 800;
          }
          tp.x += tp.vx * dt;
          tp.y += tp.vy * dt;
          tp.z += tp.vz * dt;
        } else {
          // Smooth spring to target
          tp.x += (tp.tx - tp.x) * Math.min(1, dt * 14);
          tp.y += (tp.ty - tp.y) * Math.min(1, dt * 14);
          tp.z += (tp.tz - tp.z) * Math.min(1, dt * 14);
        }

        // Apply subtle 3D tilt
        const tx1 = tp.x * tCosY + tp.z * tSinY;
        const tz1 = -tp.x * tSinY + tp.z * tCosY;
        const ty2 = tp.y * tCosP - tz1 * tSinP;
        const tz2 = tp.y * tSinP + tz1 * tCosP;

        const depth = tz2 + 350;
        if (depth <= 10) continue;

        const scale = fov / depth;
        const sx = cx + tx1 * scale;
        const sy = cy + ty2 * scale;

        const pSize = Math.max(1.4, tp.size * scale * (burstAge > 0 ? 1.4 : 1));
        const finalAlpha = burstAge > 0 ? Math.max(0, 1 - burstAge * 1.7) : 0.95;

        // Glow ring
        ctx.globalAlpha = finalAlpha * 0.35;
        ctx.fillStyle = tp.color;
        ctx.beginPath();
        ctx.arc(sx, sy, pSize * 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Bright particle core
        ctx.globalAlpha = finalAlpha;
        ctx.beginPath();
        ctx.arc(sx, sy, pSize, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1.0;
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
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/92 backdrop-blur-2xl transition-opacity duration-500 ${
        exploding ? "opacity-0 pointer-events-none scale-105" : "opacity-100"
      }`}
    >
      {/* 3D Particle Sphere + 3D Particle Text Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full absolute inset-0 pointer-events-none"
      />

      {/* Floating Info Pill under 3D Rotating Sphere */}
      <div className="relative z-10 flex flex-col items-center gap-3.5 mt-[230px] px-6 text-center select-none pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-950/60 shadow-[0_0_24px_rgba(99,102,241,0.25)] backdrop-blur-md">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
          <span className="text-xs font-semibold tracking-wider uppercase bg-gradient-to-r from-cyan-400 via-indigo-300 to-pink-400 bg-clip-text text-transparent">
            {isReady ? "Matrix Assembled" : "Reconstructing 3D Particles"}
          </span>
          <span className="text-[11px] font-mono font-bold text-cyan-300 ml-1">
            {displayPct}%
          </span>
        </div>

        <p className="text-xs text-neutral-400 font-medium tracking-tight">
          Streaming lossless 3D coordinates & depth layers
        </p>

        {/* Glowing Progress Track */}
        <div className="w-48 h-1 rounded-full bg-neutral-900 overflow-hidden border border-white/10 shadow-inner">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-pink-500 transition-all duration-150 ease-out shadow-[0_0_12px_rgba(99,102,241,0.6)]"
            style={{ width: `${Math.max(5, displayPct)}%` }}
          />
        </div>

        <div className="text-[10px] text-neutral-500 font-mono tracking-widest uppercase">
          {title}
        </div>
      </div>
    </div>
  );
}
