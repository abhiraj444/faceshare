import type { AnimState, EffectName, ParticleSet, RenderTheme } from "./types";
import { ORBIT_LIMIT, POINT_SIZE_REF_N, TOUCH_RADIUS_FRAC, TOUCH_SLOTS } from "./config";
import {
  createMat4,
  lookAt,
  multiply,
  perspective,
  unprojectToZ0,
  clamp,
  invert,
} from "./math";
import { filterParticleSet, eraseParticlesAlongSegment } from "./eraser";
import { RENDER_FS, RENDER_VS, UPDATE_FS, UPDATE_VS } from "./shaders";

type TouchSlot = { x: number; y: number; z: number; w: number; vx: number; vy: number; id: number };

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Shader alloc failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "compile error";
    gl.deleteShader(sh);
    throw new Error(log);
  }
  return sh;
}

function link(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
  varyings?: string[],
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("Program alloc failed");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (varyings) gl.transformFeedbackVaryings(prog, varyings, gl.SEPARATE_ATTRIBS);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) ?? "link error";
    gl.deleteProgram(prog);
    throw new Error(log);
  }
  return prog;
}

export class ParticleEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext | null;
  readonly supported: boolean;
  onState?: (s: AnimState) => void;

  private set: ParticleSet | null = null;
  private drawCount = 0;
  private maxCount = 0;
  private ping = 0;
  private updateProg: WebGLProgram | null = null;
  private renderProg: WebGLProgram | null = null;
  private posBuf: [WebGLBuffer, WebGLBuffer] | null = null;
  private velBuf: [WebGLBuffer, WebGLBuffer] | null = null;
  private homeBuf: WebGLBuffer | null = null;
  private seedBuf: WebGLBuffer | null = null;
  private toneBuf: WebGLBuffer | null = null;
  private colorBuf: WebGLBuffer | null = null;
  private semanticBuf: WebGLBuffer | null = null;
  private vaoUpdate: [WebGLVertexArrayObject, WebGLVertexArrayObject] | null = null;
  private vaoRender: [WebGLVertexArrayObject, WebGLVertexArrayObject] | null = null;
  private tf: [WebGLTransformFeedback, WebGLTransformFeedback] | null = null;
  private uUpdate: Record<string, WebGLUniformLocation | null> = {};
  private uRender: Record<string, WebGLUniformLocation | null> = {};
  private pointRange: [number, number] = [1, 64];

  private raf = 0;
  private running = false;
  private lastT = 0;
  private acc = 0;
  private time = 0;
  private frameTimes: number[] = [];
  private renderScale = 1;
  private recordAspect: number | null = null;
  private recordDims: [number, number] | null = null;
  private refClientHeight = 720;

  yaw = 0;
  pitch = 0.04;
  private gyroYaw = 0;
  private gyroPitch = 0;
  private idleOrbit = true;
  userOrbit = false;
  private motionSensorEnabled = false;
  private slowSwayEnabled = true;

  theme = 0; // 0: particle, 1: water, 2: glass, 3: cosmic, 4: gold
  private currentCameraDist = 2.45;
  private userZoom = 1.0;

  size = 2;
  colorMode = 0;
  colorMix = 0.5;
  invert = 0;
  radiance = 1.15;
  assemble = 0;
  targetAssemble = 1;
  spring = 14;
  damp = 3.2;
  turb = 0.22;
  breath = 0.012;
  mode = 0;
  effectT = 0;
  effectAmp = 0;
  effectOrigin: [number, number] = [0, 0];
  private state: AnimState = "building";
  private effectTimer = 0;
  private effectName: EffectName | null = null;

  private touches: TouchSlot[] = Array.from({ length: TOUCH_SLOTS }, () => ({
    x: 0, y: 0, z: 1, w: 0, vx: 0, vy: 0, id: -1,
  }));
  private pointers = new Map<number, { x: number; y: number; t: number }>();
  private lastTap = 0;
  private viewProj = createMat4();
  private invViewProj = createMat4();
  private proj = createMat4();
  private view = createMat4();
  private tmpEye: [number, number, number] = [0, 0, 2.3];
  private progCamera: { yaw: number; pitch: number; distance: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private needsResize = true;
  private lastPinchDist = 0;

  // Hold-to-burst state
  private holdActive = false;
  private holdStartTime = 0;
  private holdOrigin: [number, number] = [0, 0];
  private holdMoved = false;
  private holdBurstCharging = false;
  private holdBurstProgress = 0;
  onHoldBurstProgress?: (progress: number, screenPos: [number, number]) => void;
  onHoldBurstTrigger?: (screenPos: [number, number]) => void;

  eraserActive = false;
  eraserSubmode: "brush" | "orbit" = "brush";
  eraserRadius = 40;
  private originalSet: ParticleSet | null = null;
  private keepMask: Uint8Array | null = null;
  private undoStack: Uint8Array[] = [];
  private lastErasePos: { x: number; y: number } | null = null;
  private onEraseStrokeProgress?: (erasedTotal: number) => void;
  private onEraseStrokeEnd?: (erasedTotal: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
      }) as WebGL2RenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) {
      try {
        gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
      } catch {
        gl = null;
      }
    }
    this.gl = gl;
    if (!gl) {
      this.supported = false;
      return;
    }

    try {
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[];
      this.pointRange = [range?.[0] ?? 1, range?.[1] ?? 64];
      this.updateProg = link(gl, UPDATE_VS, UPDATE_FS, ["vPos", "vVel"]);
      this.renderProg = link(gl, RENDER_VS, RENDER_FS);
      this.uUpdate = this.uniforms(this.updateProg, [
        "uDt", "uTime", "uSpring", "uDamp", "uAssemble", "uTurb",
        "uMode", "uEffectT", "uEffectAmp", "uEffectOrigin",
      ]);
      for (let i = 0; i < 5; i++) {
        this.uUpdate[`uTouch[${i}]`] = gl.getUniformLocation(this.updateProg, `uTouch[${i}]`);
        this.uUpdate[`uTouchVel[${i}]`] = gl.getUniformLocation(this.updateProg, `uTouchVel[${i}]`);
      }
      this.uRender = this.uniforms(this.renderProg, [
        "uViewProj", "uSize", "uDpr", "uPointRange", "uTime", "uBreath", "uColorMode", "uColorMix", "uInvert", "uDistScale", "uRadiance",
      ]);
      this.bindInput();

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => {
          this.needsResize = true;
        });
        this.resizeObserver.observe(this.canvas);
      }

      this.supported = true;
    } catch (err) {
      console.warn("[ParticleEngine] WebGL2 program initialization failed:", err);
      this.supported = false;
    }
  }

  private uniforms(prog: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
    const gl = this.gl!;
    const out: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const raw = Math.min(0.1, (now - this.lastT) / 1000);
      this.lastT = now;
      this.acc += raw;
      const step = 1 / 60;
      while (this.acc >= step) {
        this.simulate(step);
        this.acc -= step;
      }
      this.render();
      this.adapt(raw);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.unbindInput();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const gl = this.gl;
    if (!gl) return;
    const delBuf = (b: WebGLBuffer | null) => b && gl.deleteBuffer(b);
    if (this.posBuf) { delBuf(this.posBuf[0]); delBuf(this.posBuf[1]); }
    if (this.velBuf) { delBuf(this.velBuf[0]); delBuf(this.velBuf[1]); }
    delBuf(this.homeBuf); delBuf(this.seedBuf); delBuf(this.toneBuf); delBuf(this.colorBuf); delBuf(this.semanticBuf);
    if (this.updateProg) gl.deleteProgram(this.updateProg);
    if (this.renderProg) gl.deleteProgram(this.renderProg);
  }

  load(set: ParticleSet, opts?: { scatter?: boolean; isPruned?: boolean }): void {
    if (!opts?.isPruned) {
      this.originalSet = set;
      this.keepMask = new Uint8Array(set.count).fill(1);
      this.undoStack = [];
    }
    this.set = set;
    this.maxCount = set.count;
    this.drawCount = set.count;
    const gl = this.gl;
    if (!gl) return;

    const scatter = opts?.scatter !== false;
    const pos = new Float32Array(set.home.length);
    const vel = new Float32Array(set.home.length);
    if (scatter) {
      for (let i = 0; i < set.count; i++) {
        const s = set.seed[i] ?? 0;
        const a = s * Math.PI * 2;
        const r = 0.6 + (set.seed[(i + 3) % set.count] ?? 0.4) * 1.6;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = (s - 0.5) * 2.6;
        pos[i * 3 + 2] = Math.sin(a * 1.7) * r * 0.5;
      }
    } else {
      pos.set(set.home);
    }

    const buf = (data: ArrayBufferView, usage: number = gl.STATIC_DRAW) => {
      const b = gl.createBuffer();
      if (!b) throw new Error("buffer");
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data as unknown as BufferSource, usage);
      return b;
    };

    if (this.posBuf) { gl.deleteBuffer(this.posBuf[0]); gl.deleteBuffer(this.posBuf[1]); }
    if (this.velBuf) { gl.deleteBuffer(this.velBuf[0]); gl.deleteBuffer(this.velBuf[1]); }
    this.posBuf = [buf(pos, gl.DYNAMIC_COPY), buf(pos, gl.DYNAMIC_COPY)];
    this.velBuf = [buf(vel, gl.DYNAMIC_COPY), buf(vel, gl.DYNAMIC_COPY)];
    if (this.homeBuf) gl.deleteBuffer(this.homeBuf);
    if (this.seedBuf) gl.deleteBuffer(this.seedBuf);
    if (this.toneBuf) gl.deleteBuffer(this.toneBuf);
    if (this.colorBuf) gl.deleteBuffer(this.colorBuf);
    if (this.semanticBuf) gl.deleteBuffer(this.semanticBuf);
    this.homeBuf = buf(set.home);
    this.seedBuf = buf(set.seed);
    this.toneBuf = buf(set.tone);
    this.colorBuf = buf(set.color);
    this.semanticBuf = buf(set.semantic ?? new Uint8Array(set.count));

    const makeUpdateVao = (read: 0 | 1) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf![read]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.velBuf![read]);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.homeBuf);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return vao;
    };
    const makeRenderVao = (read: 0 | 1) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf![read]);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.toneBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuf);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 3, gl.UNSIGNED_BYTE, true, 0, 0);
      if (this.semanticBuf) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.semanticBuf);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.UNSIGNED_BYTE, false, 0, 0);
      }
      gl.bindVertexArray(null);
      return vao;
    };
    if (this.vaoUpdate) {
      gl.deleteVertexArray(this.vaoUpdate[0]);
      gl.deleteVertexArray(this.vaoUpdate[1]);
    }
    if (this.vaoRender) {
      gl.deleteVertexArray(this.vaoRender[0]);
      gl.deleteVertexArray(this.vaoRender[1]);
    }
    this.vaoUpdate = [makeUpdateVao(0), makeUpdateVao(1)];
    this.vaoRender = [makeRenderVao(0), makeRenderVao(1)];

    const makeTf = (write: 0 | 1) => {
      const tf = gl.createTransformFeedback()!;
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.posBuf![write]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, this.velBuf![write]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      return tf;
    };
    if (this.tf) {
      gl.deleteTransformFeedback(this.tf[0]);
      gl.deleteTransformFeedback(this.tf[1]);
    }
    this.tf = [makeTf(1), makeTf(0)];
    this.ping = 0;
  }

  setDrawCount(n: number): void {
    const limit = this.set ? this.set.count : (this.maxCount || n);
    this.drawCount = clamp(n | 0, 1000, limit);
  }

  setPointSize(px: number): void {
    this.size = px;
  }

  setColorMode(mode: boolean | number | "mono" | "hybrid" | "color"): void {
    if (typeof mode === "string") {
      this.colorMode = mode === "color" ? 1 : mode === "hybrid" ? 2 : 0;
    } else if (typeof mode === "number") {
      this.colorMode = mode;
    } else {
      this.colorMode = mode ? 1 : 0;
    }
  }

  setColorMix(mix: number): void {
    this.colorMix = clamp(mix, 0, 1);
  }

  setInvert(on: boolean): void {
    this.invert = on ? 1 : 0;
  }

  setRadiance(r: number): void {
    this.radiance = clamp(r, 0.4, 2.2);
  }

  getUserZoom(): number {
    return this.userZoom;
  }

  setUserZoom(z: number): void {
    this.userZoom = clamp(z, 0.6, 2.5);
  }

  setHoldBurstProgress(p: number, origin?: [number, number]): void {
    if (p <= 0) {
      if (this.holdBurstCharging && this.mode === 6 && this.effectT < 1.0) {
        this.mode = 0;
        this.effectAmp = 0;
        this.holdBurstCharging = false;
        this.holdBurstProgress = 0;
        this.onHoldBurstProgress?.(0, this.holdOrigin);
      }
      return;
    }
    this.holdBurstCharging = true;
    this.holdBurstProgress = clamp(p, 0, 1);
    this.mode = 6;
    this.effectAmp = 1.0;
    this.effectT = this.holdBurstProgress; // 0..1 = pre-burst kinetic shake
    if (origin) this.effectOrigin = origin;
    this.onHoldBurstProgress?.(this.holdBurstProgress, this.holdOrigin);
  }

  triggerBurst(origin?: [number, number]): void {
    this.mode = 6;
    this.effectOrigin = origin ?? [0, 0];
    this.effectAmp = 1.0;
    this.effectT = 1.0; // >= 1.0 triggers explosive shockwave blast
    this.effectTimer = 0;
    this.spring = 0.8;
    this.damp = 1.1;
    this.turb = 1.8;
    this.holdBurstCharging = false;
    this.holdBurstProgress = 0;
    this.onHoldBurstProgress?.(0, this.holdOrigin);
    this.setState("bursting");
    this.onHoldBurstTrigger?.(this.holdOrigin);
  }

  updateHomeZ(set: ParticleSet): void {
    const gl = this.gl;
    if (!gl || !this.homeBuf) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.homeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, set.home);
  }

  setEraserMode(active: boolean, submode: "brush" | "orbit" = "brush", radius = 40): void {
    this.eraserActive = active;
    this.eraserSubmode = submode;
    this.eraserRadius = radius;
    if (active) {
      this.idleOrbit = false;
      this.userOrbit = true;
    } else {
      this.lastErasePos = null;
    }
  }

  setEraserRadius(r: number): void {
    this.eraserRadius = Math.max(8, Math.min(250, r));
  }

  setEraserSubmode(mode: "brush" | "orbit"): void {
    this.eraserSubmode = mode;
    this.lastErasePos = null;
  }

  setOnEraseChange(cb: (erasedTotal: number) => void): void {
    this.onEraseStrokeEnd = cb;
  }

  setOnEraseProgress(cb: (erasedTotal: number) => void): void {
    this.onEraseStrokeProgress = cb;
  }

  pushUndoState(): void {
    if (!this.keepMask) return;
    if (this.undoStack.length >= 25) this.undoStack.shift();
    this.undoStack.push(new Uint8Array(this.keepMask));
  }

  undoErase(): boolean {
    if (this.undoStack.length === 0 || !this.originalSet || !this.keepMask) return false;
    const prev = this.undoStack.pop()!;
    this.keepMask.set(prev);
    const pruned = filterParticleSet(this.originalSet, this.keepMask);
    this.load(pruned, { scatter: false, isPruned: true });
    this.onEraseStrokeEnd?.(this.getErasedCount());
    return true;
  }

  resetErase(): void {
    if (!this.originalSet || !this.keepMask) return;
    this.undoStack = [];
    this.keepMask.fill(1);
    this.load(this.originalSet, { scatter: false });
    this.onEraseStrokeEnd?.(0);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  getErasedCount(): number {
    if (!this.originalSet || !this.set) return 0;
    return Math.max(0, this.originalSet.count - this.set.count);
  }

  performErase(x0: number, y0: number, x1: number, y1: number): void {
    if (!this.originalSet || !this.keepMask || !this.gl) return;
    const newlyErased = eraseParticlesAlongSegment(
      this.originalSet,
      this.keepMask,
      this.viewProj,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      { x: x0, y: y0 },
      { x: x1, y: y1 },
      this.eraserRadius,
    );

    if (newlyErased.length > 0) {
      const pruned = filterParticleSet(this.originalSet, this.keepMask);
      this.load(pruned, { scatter: false, isPruned: true });
      this.onEraseStrokeProgress?.(this.getErasedCount());
    }
  }

  play(name: EffectName): void {
    this.effectName = name;
    this.effectTimer = 0;
    if (name === "build") {
      this.assemble = 0;
      this.targetAssemble = 1;
      this.spring = 16;
      this.damp = 3.4;
      this.turb = 0.55;
      this.mode = 0;
      this.setState("building");
    } else if (name === "assemble") {
      this.targetAssemble = 1;
      this.spring = 18;
      this.damp = 3.6;
      this.turb = 0.2;
      this.mode = 0;
      this.setState("assembling");
    } else if (name === "disassemble") {
      this.targetAssemble = 0;
      this.mode = 4;
      this.effectAmp = 5.2;
      this.effectOrigin = [0, 0];
      this.turb = 1.35;
      this.spring = 1.6;
      this.damp = 1.2;
      this.setState("disassembling");
    } else if (name === "wind") {
      this.mode = 2; // traveling harmonic wave across particles
      this.effectAmp = 3.6;
      this.effectOrigin = [-1.5, 0]; // starts from left
      this.effectT = 0;
      this.setState("effect");
    } else if (name === "vortex") {
      this.mode = 1; // spiral vortex streams
      this.effectAmp = 2.8;
      this.effectOrigin = [0, 0.05];
      this.setState("effect");
    } else if (name === "ripple") {
      this.mode = 3;
      this.effectAmp = 4.6;
      this.effectT = 0;
      this.setState("effect");
    } else if (name === "fill") {
      this.assemble = 1;
      this.targetAssemble = 1;
      this.mode = 5; // celestial particle rain & fill
      this.effectAmp = 0;
      this.effectT = 0.75;
      this.spring = 15;
      this.damp = 3.2;
      this.turb = 0.18;
      this.scatterAbove();
      this.setState("filling");
    } else if (name === "burst") {
      this.triggerBurst([0, 0]);
    } else if (name === "idle") {
      this.targetAssemble = 1;
      this.mode = 0;
      this.setState("assembled");
    }
  }

  /** Scatter particles into organic fluid columns above visible canvas to cascade down */
  private scatterAbove(): void {
    const gl = this.gl;
    const set = this.set;
    if (!gl || !set || !this.posBuf || !this.velBuf) return;
    const n = set.count;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = set.seed[i] ?? 0;
      const s2 = set.seed[(i + 17) % n] ?? 0.5;
      // Disperse horizontally across wide range with fluid stream offsets
      const lateralDrift = (s - 0.5) * 0.35 + Math.sin(s2 * 12.0) * 0.12;
      pos[i * 3] = set.home[i * 3]! + lateralDrift;
      // Stagger vertical heights broadly so particles enter like rain over time, NOT as a concentrated clump
      pos[i * 3 + 1] = 0.70 + s * 0.95 + s2 * 0.45;
      pos[i * 3 + 2] = set.home[i * 3 + 2]! + (s - 0.5) * 0.35;
      vel[i * 3] = (s - 0.5) * 0.08;
      vel[i * 3 + 1] = -0.5 - s * 0.6;
      vel[i * 3 + 2] = (s2 - 0.5) * 0.06;
    }
    gl.bindVertexArray(null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    for (let b = 0; b < 2; b++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf[b]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.velBuf[b]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vel);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  snapshot(): Promise<Blob> {
    this.render();
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("snapshot failed"))), "image/png");
    });
  }

  getCanvasStream(fps = 30): MediaStream {
    return this.canvas.captureStream(fps);
  }

  lockIdleOrbit(lock: boolean): void {
    this.idleOrbit = !lock;
  }

  setRecordingAspect(aspect: number | null, width?: number, height?: number): void {
    this.recordAspect = aspect;
    if (aspect && width && height) {
      this.refClientHeight = this.canvas.clientHeight || 720;
      const gl = this.gl;
      if (gl) {
        const maxDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as [number, number] | null;
        if (maxDims) {
          const maxW = maxDims[0] || 4096;
          const maxH = maxDims[1] || 4096;
          if (width > maxW || height > maxH) {
            const scale = Math.min(maxW / width, maxH / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
        }
      }
      this.recordDims = [width, height];
    } else {
      this.recordDims = null;
    }
    this.resize();
  }

  getParticleSet(): ParticleSet | null {
    return this.set;
  }

  getOrbit(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  setTheme(_theme: RenderTheme | number): void {
    // Retained for contract compatibility - pure Gaussian particle stipple is used
  }

  resetOrbit(smooth = true): void {
    this.userZoom = 1.0;
    if (!smooth) {
      this.yaw = 0;
      this.pitch = 0.04;
      this.userOrbit = false;
      return;
    }
    const startYaw = this.yaw;
    const startPitch = this.pitch;
    const startTime = performance.now();
    const duration = 350;
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      this.yaw = startYaw * (1 - ease);
      this.pitch = 0.04 * ease + startPitch * (1 - ease);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.yaw = 0;
        this.pitch = 0.04;
        this.userOrbit = false;
      }
    };
    requestAnimationFrame(step);
  }

  setOrbit(yaw: number, pitch: number): void {
    this.yaw = clamp(yaw, -ORBIT_LIMIT, ORBIT_LIMIT);
    this.pitch = clamp(pitch, -ORBIT_LIMIT, ORBIT_LIMIT);
    this.userOrbit = true;
    this.idleOrbit = false;
  }

  setZoom(factor: number): void {
    this.userZoom = clamp(factor, 0.6, 2.5);
  }

  getZoom(): number {
    return this.userZoom;
  }

  private setState(s: AnimState): void {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  getState(): AnimState {
    return this.state;
  }

  private simulate(dt: number): void {
    this.time += dt;
    this.effectTimer += dt;
    this.assemble += (this.targetAssemble - this.assemble) * Math.min(1, dt * 1.35);

    // Hold-to-Burst: holding finger/mouse continuously charges kinetic shaking and bursts at ~3 seconds
    if (this.holdActive && !this.holdMoved && this.pointers.size === 1 && !this.eraserActive && this.state !== "bursting") {
      const elapsed = (performance.now() - this.holdStartTime) / 1000;
      if (elapsed > 0.35) {
        // Charging shake phase: 0.35s to 3.0s (ramp 0..1)
        const progress = Math.min(1.0, (elapsed - 0.35) / 2.65);
        const [wx, wy] = this.worldFromClient(this.holdOrigin[0], this.holdOrigin[1]);
        this.setHoldBurstProgress(progress, [wx, wy]);
        if (progress >= 1.0) {
          this.holdActive = false;
          this.triggerBurst([wx, wy]);
        }
      }
    } else if (this.holdBurstCharging && this.state !== "bursting") {
      this.setHoldBurstProgress(0);
    }

    if (this.state === "bursting") {
      this.effectTimer += dt;
      this.effectT = 1.0 + this.effectTimer;
      if (this.effectTimer > 2.6) {
        // Gracefully reconstruct back into assembled portrait
        this.mode = 0;
        this.effectAmp = 0;
        this.targetAssemble = 1;
        this.spring = 16;
        this.damp = 3.4;
        this.turb = 0.22;
        this.setState("assembling");
      }
    }

    if (this.state === "building" && this.assemble > 0.92) {
      this.turb = 0.18;
      this.setState("assembled");
    }
    if (this.state === "assembling" && this.assemble > 0.92) {
      this.turb = 0.18;
      this.mode = 0;
      this.setState("assembled");
    }
    if (this.state === "disassembling") {
      this.effectAmp *= Math.exp(-dt * 1.8);
      if (this.assemble < 0.08 && this.effectTimer > 1.5) {
        // Auto-reassemble after breaking apart
        this.targetAssemble = 1;
        this.spring = 16;
        this.damp = 3.4;
        this.turb = 0.35;
        this.mode = 0;
        this.effectAmp = 0;
        this.setState("assembling");
      }
    }
    if (this.state === "filling") {
      const sweepDuration = 3.6;
      const progress = Math.min(1.0, this.effectTimer / sweepDuration);
      // Sweep line descends from top of head (+0.75) down through chin (-0.65)
      const sweepY = 0.75 - progress * 1.40;
      this.effectT = sweepY;
      if (progress >= 1.0) {
        this.mode = 0;
        this.turb = 0.16;
        this.spring = 14;
        this.damp = 3.2;
        this.targetAssemble = 1;
        this.assemble = 1;
        this.setState("assembled");
      }
    }
    if (this.state === "effect") {
      if (this.mode === 2) {
        // Traveling harmonic wave sweeps horizontally across the face [-1.5 -> +1.5]
        this.effectOrigin[0] = -1.5 + this.effectTimer * 1.15;
      }
      if (this.mode === 3) this.effectT = this.effectTimer;
      if (this.effectTimer > 2.8) {
        this.mode = 0;
        this.effectAmp = 0;
        this.targetAssemble = 1;
        this.setState("assembled");
      }
    }
    if (this.state === "assembled") {
      this.turb = 0.16;
      this.breath = 0.012;
    }

    const gl = this.gl;
    if (!gl || !this.updateProg || !this.vaoUpdate || !this.tf || !this.set) return;

    const read = this.ping as 0 | 1;
    gl.useProgram(this.updateProg);
    gl.uniform1f(this.uUpdate.uDt, dt);
    gl.uniform1f(this.uUpdate.uTime, this.time);
    gl.uniform1f(this.uUpdate.uSpring, this.spring);
    gl.uniform1f(this.uUpdate.uDamp, this.damp);
    gl.uniform1f(this.uUpdate.uAssemble, this.assemble);
    gl.uniform1f(this.uUpdate.uTurb, this.turb);
    gl.uniform1f(this.uUpdate.uMode, this.mode);
    gl.uniform1f(this.uUpdate.uEffectT, this.effectT);
    gl.uniform1f(this.uUpdate.uEffectAmp, this.effectAmp);
    gl.uniform2f(this.uUpdate.uEffectOrigin, this.effectOrigin[0], this.effectOrigin[1]);
    for (let i = 0; i < TOUCH_SLOTS; i++) {
      const t = this.touches[i]!;
      gl.uniform4f(this.uUpdate[`uTouch[${i}]`] ?? null, t.x, t.y, t.z, t.w);
      gl.uniform2f(this.uUpdate[`uTouchVel[${i}]`] ?? null, t.vx, t.vy);
      t.vx *= Math.exp(-dt * 8);
      t.vy *= Math.exp(-dt * 8);
      if (t.id < 0) t.w *= Math.exp(-dt * 6);
    }

    gl.bindVertexArray(this.vaoUpdate[read]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf[read]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, Math.max(1000, this.drawCount));
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
    this.ping = 1 - read;
  }

  private resize(): void {
    const canvas = this.canvas;
    const gl = this.gl;
    if (!gl) return;
    if (this.recordDims) {
      const [w, h] = this.recordDims;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      return;
    }
    // High-performance mobile DPR cap (1.5x) eliminates mobile GPU fill-rate throttling
    const dpr = Math.min(1.5, typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
    const clientW = canvas.clientWidth || 360;
    const clientH = canvas.clientHeight || 640;
    const w = Math.max(1, Math.round(clientW * dpr));
    const h = Math.max(1, Math.round(clientH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
  }

  private camera(): void {
    const gl = this.gl!;
    const aspect = this.recordAspect ?? (gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight));
    const baseFov = (32 * Math.PI) / 180;
    perspective(this.proj, baseFov, aspect, 0.1, 20);
    // Slow, smooth sway from left to right and vice-versa
    // Uses a gentle sine wave oscillation (~10 second period)
    const swayY = this.slowSwayEnabled ? Math.sin(this.time * 0.42) * 0.16 : 0;
    const swayP = this.slowSwayEnabled ? Math.cos(this.time * 0.28) * 0.035 : 0;
    const idleY = this.idleOrbit && !this.userOrbit && !this.slowSwayEnabled
      ? Math.sin(this.time * 0.18) * 0.1
      : 0;
    const idleP = this.idleOrbit && !this.userOrbit && !this.slowSwayEnabled
      ? Math.cos(this.time * 0.13) * 0.03
      : 0;

    const activeGyroYaw = this.motionSensorEnabled ? this.gyroYaw : 0;
    const activeGyroPitch = this.motionSensorEnabled ? this.gyroPitch : 0;

    let yaw = clamp(this.yaw + activeGyroYaw + swayY + idleY, -ORBIT_LIMIT, ORBIT_LIMIT);
    let pitch = clamp(this.pitch + activeGyroPitch + swayP + idleP, -ORBIT_LIMIT, ORBIT_LIMIT);
    const baseDist = 2.45;
    // Scale camera distance on narrow / portrait mobile screens so particles are centered and never overflow horizontally
    const refAspect = 0.75;
    const aspectScale = aspect < refAspect ? refAspect / Math.max(0.35, aspect) : 1.0;
    let dist = (baseDist * aspectScale) / this.userZoom;

    if (this.progCamera) {
      yaw = this.progCamera.yaw;
      pitch = this.progCamera.pitch;
      dist = (this.progCamera.distance * aspectScale) / this.userZoom;
    }
    this.currentCameraDist = dist;

    this.tmpEye[0] = Math.sin(yaw) * Math.cos(pitch) * dist;
    this.tmpEye[1] = Math.sin(pitch) * dist;
    this.tmpEye[2] = Math.cos(yaw) * Math.cos(pitch) * dist;
    lookAt(this.view, this.tmpEye, [0, 0, 0], [0, 1, 0]);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
  }

  setProgrammaticCamera(pose: { yaw?: number; pitch?: number; distance?: number } | null): void {
    if (!pose) {
      this.progCamera = null;
    } else {
      this.progCamera = {
        yaw: pose.yaw ?? this.yaw,
        pitch: pose.pitch ?? this.pitch,
        distance: pose.distance ?? 2.45,
      };
    }
  }

  setForces(forces: {
    assemble?: number;
    turbulence?: number;
    vortex?: number;
    wind?: number;
    shockwave?: number;
    fill?: number;
  }): void {
    if (forces.assemble !== undefined) {
      this.assemble = forces.assemble;
      this.targetAssemble = forces.assemble;
    }
    if (forces.turbulence !== undefined) {
      this.turb = forces.turbulence;
    }
    if (forces.vortex !== undefined && forces.vortex > 0.05) {
      this.mode = 1;
      this.effectAmp = forces.vortex * 3.2;
      this.effectOrigin = [0, 0.05];
    } else if (forces.wind !== undefined && forces.wind > 0.05) {
      this.mode = 2; // traveling harmonic wave across particles
      this.effectAmp = forces.wind * 3.6;
      // Oscillate wave front across face during choreography
      this.effectOrigin = [Math.sin(this.time * 2.2) * 1.2, 0];
    } else if (forces.shockwave !== undefined && forces.shockwave > 0.05) {
      this.mode = 3;
      this.effectAmp = forces.shockwave * 4.8;
      this.effectT = (this.time * 0.8) % 1.6;
    } else if (forces.fill !== undefined && forces.fill > 0.05) {
      this.mode = 5;
      this.effectT = 0.70 - (this.time * 0.35) % 1.4;
    } else if (forces.assemble !== undefined && forces.assemble >= 0.95) {
      this.mode = 0;
    }
  }

  private render(): void {
    const gl = this.gl;
    if (!gl || !this.renderProg || !this.vaoRender) return;
    if (this.needsResize || this.recordDims) {
      this.resize();
      this.needsResize = false;
    }
    this.camera();
    if (this.invert) gl.clearColor(1.0, 1.0, 1.0, 1.0);
    else gl.clearColor(0.027, 0.027, 0.031, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.renderProg);
    gl.uniformMatrix4fv(this.uRender.uViewProj, false, this.viewProj);
    const n = Math.max(1000, this.drawCount);
    const size = this.size * Math.sqrt(POINT_SIZE_REF_N / n);
    
    const baseDpr = Math.min(1.5, typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
    // When recording to a fixed high-resolution buffer (e.g. 1080x1920), scale DPR so particles
    // retain identical visual size, density, and opacity as on the interactive canvas
    const dpr = this.recordDims
      ? this.recordDims[1] / Math.max(1, this.refClientHeight)
      : baseDpr;

    gl.uniform1f(this.uRender.uSize, size);
    gl.uniform1f(this.uRender.uDpr, dpr);
    gl.uniform2f(this.uRender.uPointRange, this.pointRange[0], this.pointRange[1]);
    gl.uniform1f(this.uRender.uTime, this.time);
    gl.uniform1f(this.uRender.uBreath, this.breath);
    gl.uniform1f(this.uRender.uColorMode, this.colorMode);
    gl.uniform1f(this.uRender.uColorMix, this.colorMix);
    gl.uniform1f(this.uRender.uInvert, this.invert);
    const distScale = 2.45 / Math.max(0.1, this.currentCameraDist);
    gl.uniform1f(this.uRender.uDistScale, distScale);
    gl.uniform1f(this.uRender.uRadiance, this.radiance);
    gl.bindVertexArray(this.vaoRender[this.ping as 0 | 1]);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
  }

  private adapt(_dt: number): void {
    // Keep quality intact on all devices
  }

  worldFromClient(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = 1 - ((clientY - r.top) / r.height) * 2;
    return unprojectToZ0(ndcX, ndcY, this.viewProj, this.invViewProj);
  }

  private bindInput(): void {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    c.addEventListener("contextmenu", this.onMenu);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("dblclick", this.onDblClick);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("deviceorientation", this.onOrient);
  }

  private unbindInput(): void {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("contextmenu", this.onMenu);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("dblclick", this.onDblClick);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("deviceorientation", this.onOrient);
  }

  private onMenu = (e: Event) => e.preventDefault();

  private onDblClick = () => {
    this.resetOrbit(true);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const zoomDelta = e.deltaY * -0.0015;
    this.userZoom = clamp(this.userZoom * (1 + zoomDelta), 0.6, 2.5);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "r" || e.key === "R") {
      this.resetOrbit(true);
    } else if (e.key === "ArrowLeft") {
      this.yaw = clamp(this.yaw - 0.04, -ORBIT_LIMIT, ORBIT_LIMIT);
      this.userOrbit = true;
      this.idleOrbit = false;
    } else if (e.key === "ArrowRight") {
      this.yaw = clamp(this.yaw + 0.04, -ORBIT_LIMIT, ORBIT_LIMIT);
      this.userOrbit = true;
      this.idleOrbit = false;
    } else if (e.key === "ArrowUp") {
      this.pitch = clamp(this.pitch - 0.03, -ORBIT_LIMIT, ORBIT_LIMIT);
      this.userOrbit = true;
      this.idleOrbit = false;
    } else if (e.key === "ArrowDown") {
      this.pitch = clamp(this.pitch + 0.03, -ORBIT_LIMIT, ORBIT_LIMIT);
      this.userOrbit = true;
      this.idleOrbit = false;
    }
  };

  private onDown = (e: PointerEvent) => {
    if (this.eraserActive) {
      if (this.eraserSubmode === "orbit") {
        this.userOrbit = true;
        this.idleOrbit = false;
        this.pointers.set(-2, { x: e.clientX, y: e.clientY, t: performance.now() });
        return;
      }
      // Brush mode: drag erases particles
      this.pushUndoState();
      const r = this.canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      this.lastErasePos = { x: sx, y: sy };
      this.performErase(sx, sy, sx, sy);
      return;
    }

    this.canvas.setPointerCapture(e.pointerId);
    const now = performance.now();

    // Double tap triggers instant reset to frontal orientation
    if (now - this.lastTap < 280 && this.pointers.size === 0) {
      this.resetOrbit(true);
      this.lastTap = 0;
      return;
    }
    this.lastTap = now;

    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
    if (this.pointers.size === 1) {
      this.holdOrigin = [e.clientX, e.clientY];
      this.holdStartTime = now;
      this.holdActive = true;
      this.holdMoved = false;
    } else {
      this.holdActive = false;
      this.setHoldBurstProgress(0);
    }
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.lastPinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
    }
    this.syncTouches();
  };

  private onMove = (e: PointerEvent) => {
    if (this.eraserActive) {
      if (this.eraserSubmode === "orbit") {
        const orbit = this.pointers.get(-2);
        if (orbit) {
          this.yaw = clamp(this.yaw + (e.clientX - orbit.x) * 0.005, -ORBIT_LIMIT, ORBIT_LIMIT);
          this.pitch = clamp(this.pitch + (e.clientY - orbit.y) * 0.004, -ORBIT_LIMIT, ORBIT_LIMIT);
          orbit.x = e.clientX;
          orbit.y = e.clientY;
        }
        return;
      }
      // Brush mode
      if (this.lastErasePos && (e.buttons & 1 || e.pointerType === "touch")) {
        const r = this.canvas.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        this.performErase(this.lastErasePos.x, this.lastErasePos.y, sx, sy);
        this.lastErasePos = { x: sx, y: sy };
      }
      return;
    }

    if (this.holdActive) {
      const dist = Math.hypot(e.clientX - this.holdOrigin[0], e.clientY - this.holdOrigin[1]);
      if (dist > 18) {
        this.holdMoved = true;
        this.setHoldBurstProgress(0);
      }
    }

    const p = this.pointers.get(e.pointerId);
    if (!p) return;

    // Two-finger pinch-zoom
    if (this.pointers.size >= 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const pts = [...this.pointers.values()];
      if (pts.length >= 2) {
        const currentDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (this.lastPinchDist > 0 && currentDist > 0) {
          const deltaScale = currentDist / this.lastPinchDist;
          this.userZoom = clamp(this.userZoom * deltaScale, 0.6, 2.5);
        }
        this.lastPinchDist = currentDist;
      }
      return;
    }

    // Single-finger: Smooth 3D Orbit
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    this.yaw = clamp(this.yaw + dx * 0.0045, -ORBIT_LIMIT, ORBIT_LIMIT);
    this.pitch = clamp(this.pitch + dy * 0.0035, -ORBIT_LIMIT, ORBIT_LIMIT);
    this.userOrbit = true;
    this.idleOrbit = false;
    p.x = e.clientX;
    p.y = e.clientY;
    this.syncTouches();
  };

  private onUp = (e: PointerEvent) => {
    if (this.eraserActive) {
      this.pointers.delete(-2);
      if (this.lastErasePos) {
        this.lastErasePos = null;
        this.onEraseStrokeEnd?.(this.getErasedCount());
      }
      return;
    }
    this.pointers.delete(e.pointerId);
    this.pointers.delete(-2);
    this.holdActive = false;
    if (this.holdBurstCharging && this.state !== "bursting") {
      this.setHoldBurstProgress(0);
    }
    if (this.pointers.size < 2) {
      this.lastPinchDist = 0;
    }
    this.syncTouches();
  };

  private syncTouches(): void {
    const radius = TOUCH_RADIUS_FRAC * 2.0;
    const ids = [...this.pointers.entries()].filter(([id]) => id >= 0);
    for (let i = 0; i < TOUCH_SLOTS; i++) {
      const slot = this.touches[i]!;
      const pair = ids[i];
      if (!pair) {
        slot.id = -1;
        continue;
      }
      const [id, p] = pair;
      const [x, y] = this.worldFromClient(p.x, p.y);
      if (slot.id === id) {
        slot.vx = (x - slot.x) * 28;
        slot.vy = (y - slot.y) * 28;
      }
      slot.id = id;
      slot.x = x;
      slot.y = y;
      slot.z = radius;
      slot.w = 2.8;
    }
  }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    this.gyroYaw = clamp((e.gamma / 45) * 0.18, -0.22, 0.22);
    this.gyroPitch = clamp(((e.beta - 45) / 45) * 0.14, -0.2, 0.2);
  };

  setMotionSensor(enabled: boolean): void {
    this.motionSensorEnabled = enabled;
    if (!enabled) {
      this.gyroYaw = 0;
      this.gyroPitch = 0;
    }
  }

  setSlowSway(enabled: boolean): void {
    this.slowSwayEnabled = enabled;
  }

  isMotionSensorEnabled(): boolean {
    return this.motionSensorEnabled;
  }

  isSlowSwayEnabled(): boolean {
    return this.slowSwayEnabled;
  }

  async requestGyro(): Promise<boolean> {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    try {
      if (typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        return res === "granted";
      }
      return true;
    } catch {
      return false;
    }
  }
}
