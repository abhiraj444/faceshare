import type { ParticleEngine } from "./engine";
import type { EffectName } from "./types";
import { CHOREOGRAPHY_PRESETS, evaluateEasing, type ChoreographyPreset } from "./export/choreography";
import { ExportCanvasManager } from "./export/export-canvas";

/**
 * Prioritized MIME candidates optimized for WhatsApp Status & Instagram Reels:
 * WhatsApp Status requires H.264 (AVC1 Baseline/Main) with an accompanying audio track.
 * Without an audio track or with incompatible profiles, WhatsApp's mobile app
 * rejects the video with "Can't send this video".
 */
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2", // H.264 Baseline Profile + AAC
  "video/mp4;codecs=avc1.42001E,mp4a.40.2", // H.264 Constrained Baseline + AAC
  "video/mp4;codecs=avc1.4d001f,mp4a.40.2", // H.264 Main Profile + AAC
  "video/mp4;codecs=avc1.42E01E",           // H.264 Baseline
  "video/mp4;codecs=avc1",                  // H.264 generic
  "video/mp4",                              // MP4 default
  "video/webm;codecs=h264",                 // WebM container with H.264
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function isMp4Supported(): boolean {
  if (typeof MediaRecorder === "undefined") return false;
  return (
    MediaRecorder.isTypeSupported("video/mp4;codecs=avc1") ||
    MediaRecorder.isTypeSupported("video/mp4")
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RecordSequenceType =
  | "break"
  | "wind"
  | "ripple"
  | "fill"
  | "all"
  | "idle"
  | "break_reassemble"
  | "fill_break"
  | "vortex_burst"
  | "custom";

export interface RecordOptions {
  aspect916?: boolean;
  sequence?: RecordSequenceType;
  animation?: EffectName | "all" | "idle";
  customEffects?: EffectName[];
  durationSeconds?: number;
  colorMode?: "original" | "color" | "mono";
  forceColor?: boolean;
  resolution?: "1080p" | "720p";
}

export interface RecordResult {
  blob: Blob;
  mimeType: string;
  isMp4: boolean;
  filename: string;
  durationSeconds: number;
}

export async function recordTimeline(
  engine: ParticleEngine,
  options: RecordOptions | number = {},
  onTick?: (label: string) => void,
): Promise<Blob> {
  const res = await recordTimelineExtended(engine, options, onTick);
  return res.blob;
}

/**
 * High-compatibility recorder with WhatsApp Status audio-track fix,
 * cinematic camera paths, and choreography beats.
 */
export async function recordTimelineExtended(
  engine: ParticleEngine,
  options: RecordOptions | number = {},
  onTick?: (label: string) => void,
): Promise<RecordResult> {
  const opts: RecordOptions = typeof options === "number" ? { durationSeconds: options } : options;
  const aspect916 = opts.aspect916 ?? true;
  const sequence = opts.sequence === "break_reassemble" ? "break" : (opts.sequence ?? "break");
  const colorChoice = opts.colorMode ?? (opts.forceColor ? "color" : "original");
  const duration = opts.durationSeconds ?? 12;

  const mime = pickMime();
  if (mime === null) throw new Error("Recording is not supported in this browser.");

  // Save previous state to restore upon completion
  const prevColorMode = engine.colorMode;
  if (colorChoice === "color") {
    engine.colorMode = 1;
  } else if (colorChoice === "mono") {
    engine.colorMode = 0;
  }

  const rawChoice = opts.animation || (opts.sequence as string) || "break";
  const animChoice = rawChoice === "break_reassemble" ? "break" : rawChoice;
  const isSingleMainAnim = ["break", "wind", "ripple", "fill", "all", "idle"].includes(animChoice);

  // Set 9:16 WhatsApp Status / Reels format (1080x1920 or 720x1280)
  const is720p = opts.resolution === "720p";
  const targetW = is720p ? 720 : 1080;
  const targetH = is720p ? 1280 : 1920;

  if (aspect916) {
    engine.setRecordingAspect(9 / 16, targetW, targetH);
  }

  // Only lock idle orbit if a choreographed programmatic camera path is used
  if (!isSingleMainAnim) {
    engine.lockIdleOrbit(true);
  }

  // Initialize export canvas manager for clean audio muxing
  const exportManager = new ExportCanvasManager({ width: targetW, height: targetH });
  const videoStream = engine.getCanvasStream(30);

  // CRITICAL WHATSAPP FIX: Mux silent audio track so WhatsApp does not reject video
  const silentAudioTrack = exportManager.getSilentAudioTrack();
  const streamTracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
  if (silentAudioTrack) {
    streamTracks.push(silentAudioTrack);
  }
  const combinedStream = new MediaStream(streamTracks);

  const recorder = mime
    ? new MediaRecorder(combinedStream, {
        mimeType: mime,
        videoBitsPerSecond: is720p ? 4_500_000 : 7_500_000,
        audioBitsPerSecond: 64_000,
      })
    : new MediaRecorder(combinedStream);

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const isMp4 = mime.startsWith("video/mp4");
  const extension = isMp4 ? "mp4" : "webm";
  const filename = `face-particles-whatsapp-${Date.now()}.${extension}`;

  const done = new Promise<RecordResult>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Recorder failed"));
    recorder.onstop = () => {
      const outputBlob = new Blob(chunks, { type: recorder.mimeType || (isMp4 ? "video/mp4" : "video/webm") });
      resolve({
        blob: outputBlob,
        mimeType: recorder.mimeType || outputBlob.type,
        isMp4,
        filename,
        durationSeconds: duration,
      });
    };
  });

  recorder.start(250);

  // Execute choreography timeline with programmatic camera motion
  const startTime = performance.now();
  const totalMs = duration * 1000;
  let animId: number | null = null;

  try {
    if (isSingleMainAnim) {
      if (animChoice === "break") {
        // Break and reassemble smoothly
        onTick?.("Break & Disperse");
        engine.play("disassemble");
        // Halfway through, reassemble
        const halfMs = Math.round(totalMs * 0.45);
        await wait(halfMs);
        onTick?.("Smooth Reassemble");
        engine.play("assemble");
        const remainingMs = totalMs - (performance.now() - startTime);
        if (remainingMs > 0) await wait(remainingMs);
      } else if (animChoice === "wind") {
        // Wave animation
        onTick?.("Particle Wave");
        engine.play("wind");
        const loopInterval = 3200;
        while (performance.now() - startTime < totalMs - 500) {
          await wait(Math.min(loopInterval, totalMs - (performance.now() - startTime)));
          if (performance.now() - startTime < totalMs - 1000) {
            engine.play("wind");
          }
        }
        const remainingMs = totalMs - (performance.now() - startTime);
        if (remainingMs > 0) await wait(remainingMs);
      } else if (animChoice === "ripple") {
        // Ripple animation
        onTick?.("Particle Ripple");
        engine.play("ripple");
        const loopInterval = 3000;
        while (performance.now() - startTime < totalMs - 500) {
          await wait(Math.min(loopInterval, totalMs - (performance.now() - startTime)));
          if (performance.now() - startTime < totalMs - 1000) {
            engine.play("ripple");
          }
        }
        const remainingMs = totalMs - (performance.now() - startTime);
        if (remainingMs > 0) await wait(remainingMs);
      } else if (animChoice === "fill") {
        // Fill animation
        onTick?.("Particle Fill");
        engine.play("fill");
        const remainingMs = totalMs - (performance.now() - startTime);
        if (remainingMs > 0) await wait(remainingMs);
      } else if (animChoice === "all") {
        // Play all 4 main animations sequentially: Break -> Wave -> Ripple -> Fill
        const sequenceList: { name: EffectName; label: string }[] = [
          { name: "disassemble", label: "Break & Disperse" },
          { name: "wind", label: "Particle Wave" },
          { name: "ripple", label: "Particle Ripple" },
          { name: "fill", label: "Particle Fill" },
        ];
        const stepMs = Math.floor(totalMs / sequenceList.length);
        for (let i = 0; i < sequenceList.length; i++) {
          const item = sequenceList[i]!;
          onTick?.(item.label);
          engine.play(item.name);
          if (item.name === "disassemble") {
            // Give time to disperse and start coming back
            await wait(Math.floor(stepMs * 0.55));
            engine.play("assemble");
            await wait(stepMs - Math.floor(stepMs * 0.55));
          } else {
            await wait(stepMs);
          }
        }
      } else if (animChoice === "idle") {
        // Clean, pure 3D sway without disruptive effects
        onTick?.("Pure 3D Portrait");
        engine.play("idle");
        const remainingMs = totalMs - (performance.now() - startTime);
        if (remainingMs > 0) await wait(remainingMs);
      }
    } else {
      const preset: ChoreographyPreset | undefined = CHOREOGRAPHY_PRESETS[sequence];

      if (preset && preset.beats.length > 0) {
        // Run continuous camera & force animation loop
        const runTimelineLoop = () => {
          const elapsedSec = (performance.now() - startTime) / 1000;
          if (elapsedSec >= duration) return;

          // Find active beat and previous beat for smooth continuous interpolation
          let activeIdx = 0;
          for (let i = 0; i < preset.beats.length; i++) {
            if (elapsedSec >= preset.beats[i]!.atSeconds) {
              activeIdx = i;
            }
          }
          const activeBeat = preset.beats[activeIdx]!;
          const prevBeat = activeIdx > 0 ? preset.beats[activeIdx - 1]! : null;

          const beatElapsed = Math.max(0, elapsedSec - activeBeat.atSeconds);
          const beatT = Math.min(1, beatElapsed / Math.max(0.1, activeBeat.duration));
          const easedT = evaluateEasing(beatT, activeBeat.easing);

          // Apply smooth camera path between previous beat target and active beat target
          if (activeBeat.camera) {
            const fromYaw = prevBeat?.camera ? ((prevBeat.camera.orbitDeg || 0) * Math.PI) / 180 : 0;
            const toYaw = ((activeBeat.camera.orbitDeg || 0) * Math.PI) / 180;
            const fromPitch = prevBeat?.camera?.pitch ?? 0.02;
            const toPitch = activeBeat.camera.pitch ?? 0.02;
            const fromDist = prevBeat?.camera?.distance ?? 2.45;
            const toDist = activeBeat.camera.distance ?? 2.45;

            const currentYaw = fromYaw + (toYaw - fromYaw) * easedT;
            const currentPitch = fromPitch + (toPitch - fromPitch) * easedT;
            const currentDist = fromDist + (toDist - fromDist) * easedT;

            engine.setProgrammaticCamera({
              yaw: currentYaw,
              pitch: currentPitch,
              distance: currentDist,
            });
          }

          // Apply forces
          engine.setForces(activeBeat.forces);

          animId = requestAnimationFrame(runTimelineLoop);
        };

        runTimelineLoop();

        // Tick update notifications for UI
        for (const beat of preset.beats) {
          const beatStartMs = beat.atSeconds * 1000;
          const nowMs = performance.now() - startTime;
          if (beatStartMs > nowMs) {
            await wait(beatStartMs - nowMs);
          }
          onTick?.(beat.name);
        }

        const remainingMs = totalMs - (performance.now() - startTime);
        if (remainingMs > 0) {
          await wait(remainingMs);
        }
      } else {
        // Custom effects fallback
        const effects =
          opts.customEffects && opts.customEffects.length > 0
            ? opts.customEffects
            : (["disassemble", "ripple"] as EffectName[]);
        const stepMs = Math.round(totalMs / effects.length);
        for (let i = 0; i < effects.length; i++) {
          const eff = effects[i]!;
          onTick?.(`Effect ${i + 1}/${effects.length} · ${eff.toUpperCase()}`);
          engine.play(eff);
          await wait(stepMs);
        }
      }
    }
  } finally {
    if (animId !== null) cancelAnimationFrame(animId);
    recorder.stop();
    engine.setProgrammaticCamera(null);
    engine.lockIdleOrbit(false);
    if (aspect916) {
      engine.setRecordingAspect(null);
    }
    if (colorChoice !== "original") {
      engine.colorMode = prevColorMode;
    }
    combinedStream.getTracks().forEach((t) => t.stop());
    exportManager.dispose();
  }

  return done;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mimeType = "image/svg+xml"): void {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(blob, filename);
}
