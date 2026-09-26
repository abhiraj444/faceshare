import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Aperture,
  Camera,
  Contrast,
  Download,
  Eraser,
  FlipHorizontal2,
  ImagePlus,
  Loader2,
  Printer,
  RotateCcw,
  ScanFace,
  Sliders,
  Smartphone,
  Sparkles,
  Type,
  Upload,
  Video,
  Waves,
  Wind,
  X,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { loadParams, SAMPLES, writeHash } from "@/lib/face-particles/config";
import { ParticleEngine } from "@/lib/face-particles/engine";
import { EraserToolbar } from "./eraser-toolbar";
import {
  generateFromFile,
  generateFromText,
  generateFromUrl,
  recrop,
  rebuildField,
  switchDepthMode,
  type PipelineCache,
} from "@/lib/face-particles/pipeline";
import { applyDepthScale, makeCloud } from "@/lib/face-particles/sampler";
import { downloadBlob, recordTimeline, type RecordOptions } from "@/lib/face-particles/record";
import { isModelCached, downloadAndCacheModel, getModelCacheSize } from "@/lib/face-particles/neural/model-cache";
import { preloadVision } from "@/lib/face-particles/vision";
import { RecordDialog } from "@/components/face-particles/record-dialog";
import { PrintDialog } from "@/components/face-particles/print-dialog";
import { TextDialog } from "@/components/face-particles/text-dialog";
import { ShareDialog } from "@/components/face-particles/share-dialog";
import { getSharedPortrait } from "@/lib/server-share";
import type { AnimState, EffectName, Params } from "@/lib/face-particles/types";

type Busy = { stage: string; fraction: number } | null;

export function FaceParticlesApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const cacheRef = useRef<PipelineCache | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const paramsRef = useRef<Params>(loadParams());
  const rebuildTimer = useRef<number>(0);

  const [params, setParams] = useState<Params>(() => paramsRef.current);
  const [hero, setHero] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [activeTab, setActiveTab] = useState<"style" | "depth" | "sensors">("style");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [glOk, setGlOk] = useState(true);
  const [engineVersion, setEngineVersion] = useState(0);
  const [anim, setAnim] = useState<AnimState>("building");
  const [recording, setRecording] = useState<string | null>(null);
  const [hasPortrait, setHasPortrait] = useState(false);
  const [visionReady, setVisionReady] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [isRecording916, setIsRecording916] = useState(false);
  const [depthMode, setDepthMode] = useState<"standard" | "neural">("standard");
  const [modelCached, setModelCached] = useState(false);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [showNeuralPrompt, setShowNeuralPrompt] = useState(false);

  // Eraser Tool State
  const [eraserActive, setEraserActive] = useState(false);
  const [eraserSubmode, setEraserSubmode] = useState<"brush" | "orbit">("brush");
  const [eraserRadius, setEraserRadius] = useState(40);
  const [erasedCount, setErasedCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Active Main Animation Setting (synced to video recording)
  const [activeAnimation, setActiveAnimation] = useState<"break" | "wind" | "ripple" | "fill" | "idle">("break");

  // Share & Hold-to-Burst states
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [currentStudyId, setCurrentStudyId] = useState<string | null>(null);
  const [holdBurstProgress, setHoldBurstProgress] = useState(0);
  const [holdBurstPos, setHoldBurstPos] = useState<[number, number] | null>(null);
  const [burstToast, setBurstToast] = useState(false);
  const [sharedBanner, setSharedBanner] = useState<string | null>(null);

  useEffect(() => {
    let unmounted = false;
    void (async () => {
      const cached = await isModelCached();
      if (unmounted) return;
      setModelCached(cached);
      if (!cached) {
        // Start non-blocking background download only after user has finished initial interaction
        window.setTimeout(async () => {
          if (unmounted) return;
          setDownloadingModel(true);
          const ok = await downloadAndCacheModel((p) => {
            if (!unmounted) setDownloadProgress(p.percent);
          });
          if (unmounted) return;
          setDownloadingModel(false);
          if (ok) {
            setModelCached(true);
          }
        }, 8000);
      }
    })();
    return () => {
      unmounted = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: ParticleEngine | null = null;
    try {
      engine = new ParticleEngine(canvas);
      engineRef.current = engine;
      engine.onState = setAnim;
      engine.setOnEraseChange((total) => {
        setErasedCount(total);
        setCanUndo(engine?.canUndo() ?? false);
        const finalSet = engine?.getParticleSet();
        if (finalSet && cacheRef.current) {
          cacheRef.current.set = finalSet;
        }
      });
      engine.setOnEraseProgress((total) => {
        setErasedCount(total);
        setCanUndo(engine?.canUndo() ?? false);
      });
      engine.onHoldBurstProgress = (p, screenPos) => {
        setHoldBurstProgress(p);
        setHoldBurstPos(p > 0 ? screenPos : null);
        if (p > 0 && typeof navigator !== "undefined" && navigator.vibrate) {
          if (Math.random() < p * 0.35) {
            navigator.vibrate(10);
          }
        }
      };
      engine.onHoldBurstTrigger = () => {
        setHoldBurstProgress(0);
        setHoldBurstPos(null);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([60, 40, 120]);
        }
        setBurstToast(true);
        window.setTimeout(() => setBurstToast(false), 2600);
      };
      setGlOk(engine.supported);
      if (engine.supported) {
        engine.load(makeCloud(24000));
        engine.play("idle");
        engine.assemble = 1;
        engine.targetAssemble = 1;
        engine.start();
      }
      // Preload MediaPipe FaceLandmarker and Segmenter in background so uploads are instant
      void preloadVision();
    } catch (e) {
      console.warn("[App] WebGL2 engine initialization failed:", e);
      setGlOk(false);
    }

    return () => {
      engine?.dispose();
    };
  }, [engineVersion]);

  useEffect(() => {
    paramsRef.current = params;
    writeHash(params);
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDrawCount(params.particles);
    engine.setPointSize(params.size);
    engine.setColorMode(params.colorStyle ?? (params.color ? "color" : "mono"));
    engine.setColorMix(params.colorMix ?? 0.5);
    engine.setInvert(params.invert);
    engine.setRadiance(params.radiance ?? 1.0);
    engine.setTheme(params.renderTheme ?? "particle");
  }, [params]);

  const runSource = useCallback(async (job: () => Promise<PipelineCache>, hideHero = true) => {
    setError(null);
    setBusy({ stage: "Starting", fraction: 0.02 });
    try {
      const cache = await job();
      cacheRef.current = cache;
      const engine = engineRef.current;
      if (!engine) return;
      engine.load(cache.set);
      engine.setDrawCount(paramsRef.current.particles);
      engine.setPointSize(paramsRef.current.size);
      engine.setColorMode(paramsRef.current.colorStyle ?? (paramsRef.current.color ? "color" : "mono"));
      engine.setColorMix(paramsRef.current.colorMix ?? 0.5);
      engine.setInvert(paramsRef.current.invert);
      engine.setRadiance(paramsRef.current.radiance ?? 1.0);
      engine.setTheme(paramsRef.current.renderTheme ?? "particle");
      engine.play("build");
      setHasPortrait(true);
      setVisionReady(true);
      setDepthMode("standard");
      if (modelCached && cache.subjectType === "face") {
        window.setTimeout(() => setShowNeuralPrompt(true), 1200);
      }
      if (hideHero) setHero(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build this portrait.");
    } finally {
      setBusy(null);
    }
  }, [modelCached]);

  const handleDepthModeChange = (mode: "standard" | "neural") => {
    const engine = engineRef.current;
    const cache = cacheRef.current;
    if (!engine || !cache) return;

    setDepthMode(mode);
    setBusy({ stage: mode === "neural" ? "Applying HD Neural Depth" : "Restoring Geometric Relief", fraction: 0.6 });
    window.setTimeout(() => {
      try {
        const set = switchDepthMode(cache, mode, paramsRef.current);
        engine.load(set, { scatter: false });
        engine.setDrawCount(paramsRef.current.particles);
        engine.play("assemble");
        setNotification(
          mode === "neural"
            ? "✨ HD Neural Depth applied! You can revert anytime in the Depth panel."
            : "Reverted to Standard Geometric dome.",
        );
        window.setTimeout(() => setNotification(null), 4500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not change depth mode");
      } finally {
        setBusy(null);
      }
    }, 50);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setCurrentStudyId(null);
    void runSource(() => generateFromFile(file, paramsRef.current, setBusy));
  };

  const onSample = (src: string) => {
    const s = SAMPLES.find((x) => x.src === src);
    setCurrentStudyId(s?.id ?? null);
    void runSource(() => generateFromUrl(src, paramsRef.current, setBusy));
  };

  // Detect and resolve shared 3D structure links (?share=...) or direct studies (?study=...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get("share");
    const studyId = urlParams.get("study");

    if (shareId) {
      void (async () => {
        setBusy({ stage: "Loading shared 3D structure", fraction: 0.1 });
        try {
          let data: any = null;
          try {
            data = await getSharedPortrait({ data: shareId });
          } catch (e) {
            console.warn("Server share retrieval error:", e);
          }

          if (!data) {
            const raw = localStorage.getItem(`shared_portrait_${shareId}`);
            if (raw) {
              try { data = JSON.parse(raw); } catch { /* ignore */ }
            }
          }

          // Zero-config URL fallback: if no DB response, reconstruct from inline URL params
          if (!data && studyId) {
            let inlineParams: any = null;
            const pStr = urlParams.get("p");
            if (pStr) {
              try { inlineParams = JSON.parse(decodeURIComponent(pStr)); } catch { /* ignore */ }
            }
            data = {
              studyId,
              params: inlineParams,
              yaw: urlParams.get("yaw") != null ? Number(urlParams.get("yaw")) : 0,
              pitch: urlParams.get("pitch") != null ? Number(urlParams.get("pitch")) : 0.04,
              zoom: urlParams.get("zoom") != null ? Number(urlParams.get("zoom")) : 1.0,
            };
          }

          if (data) {
            if (data.params) {
              setParams((p) => ({ ...p, ...data.params }));
              paramsRef.current = { ...paramsRef.current, ...data.params };
            }

            if (data.studyId) {
              const s = SAMPLES.find((x) => x.id === data.studyId);
              if (s) {
                setCurrentStudyId(s.id);
                await runSource(() => generateFromUrl(s.src, paramsRef.current, setBusy));
              }
            } else if (data.imageData) {
              setCurrentStudyId(null);
              await runSource(() => generateFromUrl(data.imageData, paramsRef.current, setBusy));
            }

            const engine = engineRef.current;
            if (engine) {
              if (data.yaw != null) engine.yaw = data.yaw;
              if (data.pitch != null) engine.pitch = data.pitch;
              if (data.zoom != null) engine.setUserZoom(data.zoom);
            }

            setSharedBanner(`Viewing shared structure: ${data.title ?? "3D Portrait"}`);
            window.setTimeout(() => setSharedBanner(null), 5000);
          }
        } catch (e) {
          console.error("Failed to load shared portrait:", e);
        } finally {
          setBusy(null);
        }
      })();
    } else if (studyId) {
      const s = SAMPLES.find((x) => x.id === studyId);
      if (s) {
        setCurrentStudyId(s.id);
        void runSource(() => generateFromUrl(s.src, paramsRef.current, setBusy));
      }
    }
  }, [runSource]);

  const patch = (partial: Partial<Params>) => {
    setParams((p) => {
      const next = { ...p, ...partial };
      paramsRef.current = next;
      const engine = engineRef.current;
      const cache = cacheRef.current;
      if (!engine || !cache) return next;

      if (partial.particles != null) {
        if (cache.set && next.particles > cache.set.count) {
          const newSet = rebuildField(cache, next);
          engine.load(newSet, { scatter: false });
        }
        engine.setDrawCount(next.particles);
      }
      if (partial.colorStyle != null) engine.setColorMode(next.colorStyle);
      else if (partial.color != null) engine.setColorMode(next.color);
      if (partial.colorMix != null) engine.setColorMix(next.colorMix);
      if (partial.invert != null) {
        engine.setInvert(next.invert);
      }
      if (partial.radiance != null) {
        engine.setRadiance(next.radiance ?? 1.0);
      }
      if (partial.depth != null) {
        applyDepthScale(cache.set, next.depth);
        engine.updateHomeZ(cache.set);
      }
      if (partial.motionSensor != null) {
        engine.setMotionSensor(Boolean(next.motionSensor));
      }
      if (partial.slowSway != null) {
        engine.setSlowSway(Boolean(next.slowSway));
      }

      const fieldKeys: (keyof Params)[] = [
        "contrast", "detail", "feature", "floor", "softness", "invert", "removeBg",
      ];
      const needsField = fieldKeys.some((k) => k in partial);
      const needsCrop = "straighten" in partial;

      if (needsCrop || needsField) {
        window.clearTimeout(rebuildTimer.current);
        rebuildTimer.current = window.setTimeout(() => {
          setBusy({ stage: "Updating the field", fraction: 0.5 });
          try {
            const set = needsCrop ? recrop(cache, paramsRef.current) : rebuildField(cache, paramsRef.current);
            engine.load(set, { scatter: false });
            engine.setDrawCount(paramsRef.current.particles);
            engine.play("assemble");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Update failed");
          } finally {
            setBusy(null);
          }
        }, 90);
      }
      return next;
    });
  };

  const play = (name: EffectName) => {
    if (name === "disassemble" || name === "assemble" || name === "build") {
      setActiveAnimation("break");
    } else if (name === "wind") {
      setActiveAnimation("wind");
    } else if (name === "ripple") {
      setActiveAnimation("ripple");
    } else if (name === "fill") {
      setActiveAnimation("fill");
    } else if (name === "idle") {
      setActiveAnimation("idle");
    }
    engineRef.current?.play(name);
  };

  const onTextSubmit = (text: string, theme: "gold" | "cyberpunk" | "monochrome" | "emerald") => {
    void runSource(() => generateFromText(text, paramsRef.current, { colorTheme: theme }, setBusy));
  };

  const handleStartRecord = async (options: RecordOptions) => {
    const engine = engineRef.current;
    if (!engine || recording) return;
    if (options.aspect916) setIsRecording916(true);
    setRecording("Preparing Recording...");
    setHero(false);
    setSheet(false);
    try {
      const blob = await recordTimeline(engine, options, (label) => setRecording(label));
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const suffix = options.aspect916 ? "-9x16-whatsapp" : "";
      downloadBlob(blob, `face-particles${suffix}.${ext}`);
      setNotification(`Video export ready (${ext.toUpperCase()})! Formatted with audio track for WhatsApp Status.`);
      window.setTimeout(() => setNotification(null), 6500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record.");
    } finally {
      setIsRecording916(false);
      setRecording(null);
    }
  };

  const onSaveStill = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const blob = await engine.snapshot();
      const filename = params.invert ? "face-particles-print.png" : "face-particles.png";
      downloadBlob(blob, filename);
    } catch {
      setError("Could not save a still.");
    }
  };

  const toggleEraser = useCallback(() => {
    setEraserActive((prev) => {
      const next = !prev;
      engineRef.current?.setEraserMode(next, eraserSubmode, eraserRadius);
      if (!next) {
        setCursorPos(null);
        const finalSet = engineRef.current?.getParticleSet();
        if (finalSet && cacheRef.current) {
          cacheRef.current.set = finalSet;
        }
      } else {
        setSheet(false);
        setHero(false);
      }
      return next;
    });
  }, [eraserSubmode, eraserRadius]);

  const handleSubmodeChange = useCallback((mode: "brush" | "orbit") => {
    setEraserSubmode(mode);
    engineRef.current?.setEraserSubmode(mode);
  }, []);

  const handleRadiusChange = useCallback((r: number) => {
    setEraserRadius(r);
    engineRef.current?.setEraserRadius(r);
  }, []);

  const handleUndo = useCallback(() => {
    engineRef.current?.undoErase();
    setCanUndo(engineRef.current?.canUndo() ?? false);
    setErasedCount(engineRef.current?.getErasedCount() ?? 0);
    const finalSet = engineRef.current?.getParticleSet();
    if (finalSet && cacheRef.current) {
      cacheRef.current.set = finalSet;
    }
  }, []);

  const handleReset = useCallback(() => {
    engineRef.current?.resetErase();
    setCanUndo(false);
    setErasedCount(0);
    const finalSet = engineRef.current?.getParticleSet();
    if (finalSet && cacheRef.current) {
      cacheRef.current.set = finalSet;
    }
  }, []);

  const handleDone = useCallback(() => {
    setEraserActive(false);
    engineRef.current?.setEraserMode(false);
    setCursorPos(null);
    const finalSet = engineRef.current?.getParticleSet();
    if (finalSet && cacheRef.current) {
      cacheRef.current.set = finalSet;
    }
    setNotification("3D sculpt updated! Unwanted particles removed across all views and exports.");
    window.setTimeout(() => setNotification(null), 4000);
  }, []);

  return (
    <main
      className={cn(
        "relative h-dvh w-full overflow-hidden transition-colors duration-300",
        params.invert ? "bg-white text-neutral-900" : "bg-bg text-fg",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center overflow-hidden",
          eraserActive && eraserSubmode === "brush" ? "cursor-none" : "cursor-grab active:cursor-grabbing",
        )}
        onPointerMove={(e) => {
          if (eraserActive && eraserSubmode === "brush") {
            setCursorPos({ x: e.clientX, y: e.clientY });
          }
        }}
        onPointerLeave={() => setCursorPos(null)}
      >
        <canvas
          ref={canvasRef}
          className={cn(
            "touch-none",
            isRecording916
              ? "relative aspect-[9/16] h-full max-h-[100dvh] max-w-[calc(100dvh*9/16)] shadow-2xl rounded-2xl border border-white/20"
              : "size-full",
          )}
          aria-label="Particle portrait stage"
        />
      </div>

      {/* Floating Eraser Brush Indicator */}
      {cursorPos && eraserActive && eraserSubmode === "brush" && (
        <div
          className="pointer-events-none fixed z-50 rounded-full border-2 border-rose-400 bg-rose-500/20 shadow-[0_0_16px_rgba(244,63,94,0.45)] -translate-x-1/2 -translate-y-1/2 transition-none"
          style={{
            left: cursorPos.x,
            top: cursorPos.y,
            width: eraserRadius * 2,
            height: eraserRadius * 2,
          }}
        />
      )}

      {!glOk && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg px-8 text-center">
          <div className="max-w-sm">
            <h1 className="font-display text-3xl">This device cannot draw particles</h1>
            <p className="mt-3 text-sm text-fg-muted">
              Face Particles needs WebGL2, which this browser does not expose or was temporarily lost.
            </p>
            <button
              type="button"
              onClick={() => setEngineVersion((v) => v + 1)}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg hover:bg-bg-elevated/80 transition-all cursor-pointer"
            >
              Retry Canvas
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(1.25rem,env(safe-area-inset-top))] z-20 flex justify-center px-4">
          <div
            className={cn(
              "flex items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-2.5 text-sm shadow-lg backdrop-blur-md",
              params.invert
                ? "border-neutral-300 bg-white/90 text-neutral-800"
                : "border-border bg-bg-elevated/90 text-fg-muted",
            )}
          >
            <Loader2 className="size-4 animate-spin text-accent" />
            <span>{busy.stage}</span>
            <span className="tabular-nums text-fg-subtle">{Math.round(busy.fraction * 100)}%</span>
          </div>
        </div>
      )}

      {recording && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(1.25rem,env(safe-area-inset-top))] z-30 flex justify-center px-4">
          <div className="flex items-center gap-2.5 rounded-full border border-red-500/40 bg-red-950/85 px-4 py-2 text-xs font-semibold text-red-100 shadow-2xl backdrop-blur-md animate-pulse">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
            </span>
            <span>Recording · {recording}</span>
          </div>
        </div>
      )}

      {notification && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(1.25rem,env(safe-area-inset-top))] z-40 flex justify-center px-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/90 px-4 py-2 text-xs font-medium text-emerald-100 shadow-2xl backdrop-blur-md">
            <span>✓</span>
            <span>{notification}</span>
          </div>
        </div>
      )}

      {showNeuralPrompt && depthMode === "standard" && hasPortrait && !recording && !busy && (
        <div className="absolute inset-x-0 top-[max(4.25rem,calc(env(safe-area-inset-top)+3rem))] z-40 flex justify-center px-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div
            className={cn(
              "flex items-center gap-3 rounded-2xl border px-3.5 py-2 text-xs shadow-2xl backdrop-blur-md max-w-md w-full justify-between",
              params.invert
                ? "border-neutral-300 bg-white/95 text-neutral-900 shadow-neutral-950/10"
                : "border-accent/40 bg-bg-elevated/95 text-fg shadow-black/40",
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Sparkles className="size-4 shrink-0 text-accent animate-pulse" />
              <div className="min-w-0">
                <p className="font-semibold leading-tight truncate">HD Neural Depth Ready</p>
                <p className={cn("text-[11px] truncate", params.invert ? "text-neutral-500" : "text-fg-subtle")}>
                  Cached locally in browser. Apply volumetric AI relief?
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="primary"
                className="h-7 text-xs px-2.5"
                onClick={() => {
                  setShowNeuralPrompt(false);
                  handleDepthModeChange("neural");
                }}
              >
                Apply HD
              </Button>
              <button
                type="button"
                onClick={() => setShowNeuralPrompt(false)}
                className={cn(
                  "p-1 rounded-md text-xs",
                  params.invert ? "text-neutral-500 hover:text-neutral-900" : "text-fg-subtle hover:text-fg",
                )}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto">
          <p
            className={cn(
              "font-display text-xl tracking-tight transition-colors",
              params.invert ? "text-neutral-900" : "text-fg",
            )}
          >
            Face Particles
          </p>
          <p
            className={cn(
              "text-[11px] uppercase tracking-[0.18em] transition-colors",
              params.invert ? "text-neutral-600 font-semibold" : "text-fg-subtle",
            )}
          >
            On-device
          </p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          {!hero && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="New photo"
              onClick={() => setHero(true)}
              className={
                params.invert
                  ? "border-neutral-300 bg-white/85 text-neutral-900 shadow-sm hover:bg-white backdrop-blur-md"
                  : ""
              }
            >
              <ImagePlus className="size-5" />
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            aria-label="3D Typography"
            title="Sculpt 3D Typography Particles"
            onClick={() => setTextDialogOpen(true)}
            className={
              params.invert
                ? "border-neutral-300 bg-white/85 text-neutral-900 shadow-sm hover:bg-white backdrop-blur-md"
                : ""
            }
          >
            <Type className="size-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Eraser Tool"
            title="Erase unwanted particles (brush tool)"
            disabled={!hasPortrait}
            onClick={toggleEraser}
            className={cn(
              eraserActive
                ? "bg-rose-500/25 text-rose-300 border-rose-500/50 shadow-md ring-1 ring-rose-500/40"
                : params.invert
                  ? "border-neutral-300 bg-white/85 text-neutral-900 shadow-sm hover:bg-white backdrop-blur-md"
                  : "",
            )}
          >
            <Eraser className="size-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Save still"
            title={params.invert ? "Export print-ready artwork (PNG)" : "Save still image (PNG)"}
            disabled={!hasPortrait}
            onClick={() => void onSaveStill()}
            className={
              params.invert
                ? "border-neutral-300 bg-white/85 text-neutral-900 shadow-sm hover:bg-white backdrop-blur-md"
                : ""
            }
          >
            <Download className="size-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="A4 Print & Vector Studio"
            title="Open A4 Print & Vector Studio"
            disabled={!hasPortrait}
            onClick={() => setPrintDialogOpen(true)}
            className={
              params.invert
                ? "border-neutral-300 bg-white/85 text-neutral-900 shadow-sm hover:bg-white backdrop-blur-md"
                : ""
            }
          >
            <Printer className="size-5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Share 3D Structure"
            title="Share exact 3D structure link"
            disabled={!hasPortrait}
            onClick={() => setShareDialogOpen(true)}
            className={cn(
              params.invert
                ? "border-neutral-300 bg-white/85 text-indigo-600 shadow-sm hover:bg-white backdrop-blur-md"
                : "text-indigo-400 hover:text-indigo-300 border-indigo-500/30 bg-indigo-500/10",
            )}
          >
            <Share2 className="size-5" />
          </Button>
          <Button
            variant="primary"
            size="icon"
            aria-label="Record Video (9:16 Status / Reels)"
            title="Record Video (9:16 Status / Reels)"
            disabled={!hasPortrait || Boolean(recording)}
            onClick={() => setRecordDialogOpen(true)}
            className={
              params.invert ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-sm" : ""
            }
          >
            {recording ? <Loader2 className="size-5 animate-spin" /> : <Video className="size-5" />}
          </Button>
        </div>
      </header>

      {hero && (
        <section className="absolute inset-x-0 bottom-0 z-10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-16 bg-gradient-to-t from-bg via-bg/85 to-transparent">
          <div className="mx-auto max-w-md rounded-[28px] border border-border bg-bg-elevated/85 p-5">
            <h1 className="font-display text-[2rem] leading-tight tracking-tight">
              A portrait that comes apart in your hands.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Photos stay on this device. Drag through the cloud, then make it yours.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <Button className="w-full" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />
                Upload
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => camRef.current?.click()}>
                <Camera className="size-4" />
                Camera
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => setTextDialogOpen(true)}>
                <Type className="size-4" />
                3D Words
              </Button>
            </div>
            <p className="mt-4 text-[11px] uppercase tracking-[0.16em] text-fg-subtle">Try a study</p>
            <div className="mt-2 flex gap-3">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSample(s.src)}
                  className="group flex flex-1 flex-col items-center gap-1.5"
                >
                  <span className="block aspect-[3/4] w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-subtle">
                    <img
                      src={s.src}
                      alt={s.label}
                      className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  </span>
                  <span className="text-xs text-fg-muted">{s.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-fg-subtle">
              {visionReady ? "Vision models ready" : "Loading face analysis in the background"}
            </p>
          </div>
        </section>
      )}

      {!hero && hasPortrait && !recording && !eraserActive && (
        <>
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 flex justify-center px-3 transition-opacity duration-200",
              sheet ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          >
            <div
              className={cn(
                "pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full border p-1 shadow-lg backdrop-blur-xl transition-colors",
                params.invert
                  ? "border-neutral-300/90 bg-white/90 text-neutral-800 shadow-neutral-200/50"
                  : "border-border bg-bg-elevated/90 text-fg-muted",
              )}
            >
              {(
                [
                  ["disassemble", "Break", Aperture],
                  ["wind", "Wave", Wind],
                  ["ripple", "Ripple", Contrast],
                  ["fill", "Fill", ScanFace],
                  ["burst", "Burst", Sparkles],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => play(id)}
                  title={id === "burst" ? "Explosive particle burst (or press & hold 3D structure for 3s)" : undefined}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                    params.invert
                      ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
                      : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                    (anim === "effect" || anim === "bursting") && (params.invert ? "text-neutral-950 font-semibold" : "text-fg"),
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}

              <div
                className={cn(
                  "my-1.5 w-px self-stretch",
                  params.invert ? "bg-neutral-200" : "bg-border/60",
                )}
              />

              <button
                type="button"
                onClick={() => {
                  const currentMode = params.colorStyle ?? (params.color ? "color" : "mono");
                  const nextMode = currentMode === "mono" ? "color" : currentMode === "color" ? "hybrid" : "mono";
                  patch({
                    colorStyle: nextMode,
                    color: nextMode !== "mono",
                  });
                  setNotification(`Palette: ${nextMode.toUpperCase()}`);
                  window.setTimeout(() => setNotification(null), 2500);
                }}
                title="Cycle Palette (Mono / Color / Hybrid)"
                className={cn(
                  "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  params.invert
                    ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                )}
              >
                <Sparkles className="size-3.5 text-accent" />
                <span>
                  {params.colorStyle === "color" || (!params.colorStyle && params.color)
                    ? "Color"
                    : params.colorStyle === "hybrid"
                      ? "Hybrid"
                      : "Mono"}
                </span>
              </button>

              <div
                className={cn(
                  "my-1.5 w-px self-stretch",
                  params.invert ? "bg-neutral-200" : "bg-border/60",
                )}
              />

              <button
                type="button"
                onClick={() => {
                  const nextSway = !(params.slowSway ?? true);
                  patch({ slowSway: nextSway });
                  setNotification(nextSway ? "Gentle sway enabled" : "Gentle sway paused");
                  window.setTimeout(() => setNotification(null), 2500);
                }}
                title={params.slowSway ?? true ? "Pause sway" : "Resume slow sway"}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  (params.slowSway ?? true)
                    ? params.invert
                      ? "bg-neutral-100 text-neutral-950 font-semibold"
                      : "bg-accent/15 text-fg font-semibold"
                    : params.invert
                      ? "text-neutral-500 hover:text-neutral-800"
                      : "text-fg-subtle hover:text-fg",
                )}
              >
                <Waves className="size-3.5 text-accent" />
                <span>{(params.slowSway ?? true) ? "Swaying" : "Static"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  engineRef.current?.resetOrbit(true);
                  setNotification("Aligned 3D portrait to front center");
                  window.setTimeout(() => setNotification(null), 2000);
                }}
                title="Align 3D structure straight front (or double-click canvas, or press 'R')"
                className={cn(
                  "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  params.invert
                    ? "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
                    : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                )}
              >
                <RotateCcw className="size-3.5 text-accent" />
                <span className="hidden sm:inline">Align Front</span>
                <span className="sm:hidden">Align</span>
              </button>

              <div
                className={cn(
                  "my-1.5 w-px self-stretch",
                  params.invert ? "bg-neutral-200" : "bg-border/60",
                )}
              />

              <button
                type="button"
                onClick={() => setSheet((s) => !s)}
                title={sheet ? "Close Parameters Panel" : "Open Parameters Panel"}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  sheet
                    ? params.invert
                      ? "bg-neutral-900 text-white font-semibold"
                      : "bg-fg text-bg font-semibold"
                    : params.invert
                      ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
                      : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                )}
              >
                <Sliders className="size-3.5 text-accent" />
                <span>Controls</span>
              </button>
            </div>
          </div>

          {/* Responsive Controls & Parameters Inspector Panel */}
          <div
            className={cn(
              "pointer-events-auto z-30 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              // Mobile: compact bottom drawer with live peek translucency
              "fixed inset-x-0 bottom-0 flex justify-center",
              // Desktop: docked cleanly to the right side, leaving 100% of the 3D canvas unobstructed!
              "md:fixed md:inset-x-auto md:right-5 md:top-20 md:bottom-6 md:w-88 md:max-w-sm md:flex-col md:justify-start",
              sheet
                ? "translate-y-0 md:translate-x-0 md:opacity-100 md:pointer-events-auto"
                : "translate-y-[calc(100%-3rem)] md:translate-x-[calc(100%+3rem)] md:translate-y-0 md:opacity-0 md:pointer-events-none",
            )}
          >
            <div
              onPointerDown={(e) => {
                if ((e.target as HTMLElement)?.closest?.('[role="slider"], [data-radix-slider-thumb]')) {
                  setIsScrubbing(true);
                }
              }}
              onPointerUp={() => setIsScrubbing(false)}
              onPointerCancel={() => setIsScrubbing(false)}
              className={cn(
                "flex w-full max-w-lg md:max-w-none flex-col max-h-[min(52dvh,430px)] md:max-h-[calc(100vh-6.5rem)] rounded-t-[28px] md:rounded-2xl border shadow-2xl backdrop-blur-xl transition-all duration-200",
                isScrubbing ? "opacity-30 md:opacity-90" : "opacity-100",
                params.invert
                  ? "border-neutral-300/80 bg-white/92 text-neutral-900 shadow-neutral-900/10"
                  : "border-border bg-bg-elevated/92 text-fg",
              )}
            >
              {/* Header with drag handle on mobile, title and close button on desktop */}
              <div
                className={cn(
                  "shrink-0 flex w-full flex-col items-center pb-2 pt-2.5 transition-colors border-b px-4",
                  params.invert
                    ? "text-neutral-700 border-neutral-200"
                    : "text-fg-muted border-border/40",
                )}
              >
                {/* Mobile Drag handle */}
                <button
                  type="button"
                  onClick={() => setSheet((s) => !s)}
                  className="md:hidden flex flex-col items-center w-full focus:outline-none"
                  aria-expanded={sheet}
                >
                  <span
                    className={cn(
                      "mb-1.5 h-1.5 w-12 rounded-full",
                      params.invert ? "bg-neutral-300" : "bg-border-strong",
                    )}
                  />
                </button>

                {/* Header row */}
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="size-3.5 text-accent" />
                    <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                      Structure & Parameters
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isScrubbing && (
                      <span className="text-[10px] text-accent animate-pulse font-medium">
                        Live Preview
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSheet(false)}
                      className={cn(
                        "rounded-md p-1 transition-colors hover:text-fg",
                        params.invert ? "hover:bg-neutral-100 text-neutral-600" : "hover:bg-bg-subtle text-fg-subtle",
                      )}
                      title="Close controls"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Category Navigation Tabs */}
                <div
                  className={cn(
                    "grid grid-cols-3 gap-1 rounded-lg border p-0.5 mt-2.5 w-full",
                    params.invert ? "border-neutral-200 bg-neutral-100" : "border-border/60 bg-bg/50",
                  )}
                >
                  {(
                    [
                      ["style", "Style & Tone"],
                      ["depth", "Depth & Form"],
                      ["sensors", "Sensors"],
                    ] as const
                  ).map(([id, label]) => {
                    const active = activeTab === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setActiveTab(id)}
                        className={cn(
                          "rounded-md py-1 text-[11px] font-medium transition-all text-center",
                          active
                            ? params.invert
                              ? "bg-white text-neutral-950 font-semibold shadow-xs"
                              : "bg-bg-elevated text-fg font-semibold shadow-xs"
                            : params.invert
                              ? "text-neutral-500 hover:text-neutral-800"
                              : "text-fg-subtle hover:text-fg",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tabbed Content Area */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 touch-pan-y">
                {activeTab === "style" && (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-xs font-medium uppercase tracking-[0.14em]",
                          params.invert ? "text-neutral-500" : "text-fg-subtle",
                        )}
                      >
                        Particle Palette
                      </span>
                      <div className="w-32">
                        <ToggleRow
                          label="Invert"
                          icon={<FlipHorizontal2 className="size-3.5" />}
                          checked={params.invert}
                          onCheckedChange={(v) => patch({ invert: v })}
                          invert={params.invert}
                        />
                      </div>
                    </div>

                    <div
                      className={cn(
                        "grid grid-cols-3 gap-1 rounded-xl border p-1",
                        params.invert
                          ? "border-neutral-200 bg-neutral-100"
                          : "border-border bg-bg-subtle",
                      )}
                    >
                      {(
                        [
                          ["mono", "Mono", "B&W"],
                          ["hybrid", "Hybrid", "Color + B&W"],
                          ["color", "Color", "Full RGB"],
                        ] as const
                      ).map(([mode, label, sub]) => {
                        const currentMode = params.colorStyle ?? (params.color ? "color" : "mono");
                        const active = currentMode === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              patch({
                                colorStyle: mode,
                                color: mode !== "mono",
                              })
                            }
                            className={cn(
                              "flex flex-col items-center justify-center rounded-lg py-1.5 px-1 text-center transition-all",
                              active
                                ? params.invert
                                  ? "bg-white text-neutral-950 shadow-sm font-semibold border border-neutral-300"
                                  : "bg-bg-elevated text-fg shadow-sm font-semibold border border-border/80"
                                : params.invert
                                  ? "text-neutral-600 hover:bg-white/60 hover:text-neutral-900"
                                  : "text-fg-muted hover:bg-bg/50 hover:text-fg",
                            )}
                          >
                            <span className="text-xs">{label}</span>
                            <span
                              className={cn(
                                "text-[10px] tracking-tight",
                                params.invert ? "text-neutral-500" : "text-fg-subtle",
                              )}
                            >
                              {sub}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {(params.colorStyle ?? (params.color ? "color" : "mono")) === "hybrid" && (
                      <div
                        className={cn(
                          "mt-1 rounded-xl border p-2.5",
                          params.invert
                            ? "border-neutral-200 bg-neutral-50"
                            : "border-border/60 bg-bg/60",
                        )}
                      >
                        <Field
                          label="Hybrid Color Ratio (Photographic vs Silver)"
                          value={`${Math.round((params.colorMix ?? 0.5) * 100)}% Color · ${Math.round((1 - (params.colorMix ?? 0.5)) * 100)}% Silver`}
                          invert={params.invert}
                        >
                          <Slider
                            min={0.1}
                            max={0.9}
                            step={0.05}
                            value={[params.colorMix ?? 0.5]}
                            onValueChange={([v]) => patch({ colorMix: v ?? 0.5 })}
                            invert={params.invert}
                          />
                        </Field>
                        <p
                          className={cn(
                            "mt-1 text-[11px]",
                            params.invert ? "text-neutral-500" : "text-fg-subtle",
                          )}
                        >
                          Seamlessly blends photographic skin and facial colors with silver monochrome particles.
                        </p>
                      </div>
                    )}

                    <Field
                      label={params.invert ? "Ink Contrast & Brightness" : "Brightness & Exposure"}
                      value={`${Math.round((params.radiance ?? 1.0) * 100)}%`}
                      invert={params.invert}
                    >
                      <Slider
                        min={0.5}
                        max={1.8}
                        step={0.05}
                        value={[params.radiance ?? 1.0]}
                        onValueChange={([v]) => patch({ radiance: v ?? 1.0 })}
                        invert={params.invert}
                      />
                    </Field>
                    <p
                      className={cn(
                        "-mt-1 text-[11px] leading-relaxed",
                        params.invert ? "text-neutral-500" : "text-fg-subtle",
                      )}
                    >
                      {params.invert
                        ? "Scales ink exposure cleanly on white paper without altering original tones."
                        : "100% matches exact original photo colors; adjust to brighten or darken with zero color shift."}
                    </p>

                    <Field label="Particles" value={`${Math.round(params.particles / 1000)}k`} invert={params.invert}>
                      <Slider
                        min={10000}
                        max={60000}
                        step={2000}
                        value={[params.particles]}
                        onValueChange={([v]) => patch({ particles: v ?? params.particles })}
                        invert={params.invert}
                      />
                    </Field>
                    <Field label="Point Size" value={params.size.toFixed(1)} invert={params.invert}>
                      <Slider
                        min={1.2}
                        max={3.5}
                        step={0.1}
                        value={[params.size]}
                        onValueChange={([v]) => patch({ size: v ?? params.size })}
                        invert={params.invert}
                      />
                    </Field>
                  </div>
                )}

                {activeTab === "depth" && (
                  <div className="flex flex-col gap-2.5">
                    {/* 3D Relief Engine Architecture */}
                    <div
                      className={cn(
                        "rounded-xl border p-2.5 transition-all",
                        params.invert
                          ? "border-neutral-200 bg-neutral-50/80"
                          : "border-border/70 bg-bg-elevated/50",
                      )}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span
                          className={cn(
                            "text-[11px] font-semibold uppercase tracking-[0.14em]",
                            params.invert ? "text-neutral-700" : "text-fg-muted",
                          )}
                        >
                          3D Relief Engine
                        </span>
                        <span
                          className={cn(
                            "text-[10px]",
                            modelCached
                              ? "text-emerald-500 font-medium"
                              : downloadingModel
                                ? "text-accent font-medium animate-pulse"
                                : "text-fg-subtle",
                          )}
                        >
                          {modelCached
                            ? `✓ Cached locally (${getModelCacheSize()})`
                            : downloadingModel
                              ? `Downloading AI (${downloadProgress ?? 0}%)`
                              : "Fast dome"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDepthModeChange("standard")}
                          className={cn(
                            "rounded-lg py-1.5 px-2 text-xs font-medium border transition-all text-center flex items-center justify-center gap-1.5",
                            depthMode === "standard"
                              ? params.invert
                                ? "border-neutral-400 bg-white text-neutral-950 font-semibold shadow-xs"
                                : "border-accent bg-accent/20 text-fg font-semibold shadow-xs"
                              : params.invert
                                ? "border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                                : "border-border/60 text-fg-muted hover:border-border",
                          )}
                        >
                          <span>Standard Dome</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDepthModeChange("neural")}
                          className={cn(
                            "rounded-lg py-1.5 px-2 text-xs font-medium border transition-all text-center flex items-center justify-center gap-1.5",
                            depthMode === "neural"
                              ? params.invert
                                ? "border-neutral-400 bg-white text-neutral-950 font-semibold shadow-xs"
                                : "border-accent bg-accent/20 text-fg font-semibold shadow-xs"
                              : params.invert
                                ? "border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                                : "border-border/60 text-fg-muted hover:border-border",
                          )}
                        >
                          <Sparkles className="size-3 text-accent" />
                          <span>HD Neural Depth</span>
                        </button>
                      </div>
                      {depthMode === "neural" && (
                        <div className="mt-2 flex items-center justify-between text-[11px]">
                          <span className={params.invert ? "text-neutral-500" : "text-fg-subtle"}>
                            Volumetric anatomical surface
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDepthModeChange("standard")}
                            className={cn(
                              "underline font-medium hover:opacity-80 transition-opacity",
                              params.invert ? "text-neutral-900" : "text-accent",
                            )}
                          >
                            Revert to standard
                          </button>
                        </div>
                      )}
                    </div>

                    <Field label="Depth" value={params.depth.toFixed(2)} invert={params.invert}>
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={[params.depth]}
                        onValueChange={([v]) => patch({ depth: v ?? params.depth })}
                        invert={params.invert}
                      />
                    </Field>
                    <Field label="Contrast" value={params.contrast.toFixed(2)} invert={params.invert}>
                      <Slider
                        min={0.6}
                        max={2}
                        step={0.05}
                        value={[params.contrast]}
                        onValueChange={([v]) => patch({ contrast: v ?? params.contrast })}
                        invert={params.invert}
                      />
                    </Field>
                    <Field label="Detail" value={params.detail.toFixed(2)} invert={params.invert}>
                      <Slider
                        min={0}
                        max={2}
                        step={0.05}
                        value={[params.detail]}
                        onValueChange={([v]) => patch({ detail: v ?? params.detail })}
                        invert={params.invert}
                      />
                    </Field>
                    <Field label="Features" value={params.feature.toFixed(2)} invert={params.invert}>
                      <Slider
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={[params.feature]}
                        onValueChange={([v]) => patch({ feature: v ?? params.feature })}
                        invert={params.invert}
                      />
                    </Field>
                    <Field label="Shadow lift (Floor)" value={params.floor.toFixed(2)} invert={params.invert}>
                      <Slider
                        min={0}
                        max={0.3}
                        step={0.01}
                        value={[params.floor]}
                        onValueChange={([v]) => patch({ floor: v ?? params.floor })}
                        invert={params.invert}
                      />
                    </Field>
                    <Field label="Silhouette" value={params.softness.toFixed(2)} invert={params.invert}>
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={[params.softness]}
                        onValueChange={([v]) => patch({ softness: v ?? params.softness })}
                        invert={params.invert}
                      />
                    </Field>
                  </div>
                )}

                {activeTab === "sensors" && (
                  <div className="flex flex-col gap-2.5">
                    <div className="grid grid-cols-2 gap-3">
                      <ToggleRow
                        label="Straighten"
                        checked={params.straighten}
                        onCheckedChange={(v) => patch({ straighten: v })}
                        invert={params.invert}
                      />
                      <ToggleRow
                        label="Cut background"
                        checked={params.removeBg}
                        onCheckedChange={(v) => patch({ removeBg: v })}
                        invert={params.invert}
                      />
                    </div>

                    {/* Motion & Proximity / Gyro Controls */}
                    <div
                      className={cn(
                        "mt-1.5 rounded-xl border p-2.5 transition-all",
                        params.invert
                          ? "border-neutral-200 bg-neutral-50/80"
                          : "border-border/70 bg-bg-elevated/50",
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={cn(
                            "text-[11px] font-semibold uppercase tracking-[0.14em]",
                            params.invert ? "text-neutral-700" : "text-fg-muted",
                          )}
                        >
                          Motion & View
                        </span>
                        <span
                          className={cn(
                            "text-[10px]",
                            params.motionSensor ? "text-accent font-medium" : "text-fg-subtle",
                          )}
                        >
                          {params.motionSensor ? "Tilt Sensor ON" : "Tilt Sensor OFF"}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <ToggleRow
                          label="Slow sway (left ↔ right)"
                          icon={<Waves className="size-3.5 text-accent shrink-0" />}
                          checked={params.slowSway ?? true}
                          onCheckedChange={(v) => patch({ slowSway: v })}
                          invert={params.invert}
                        />
                        <ToggleRow
                          label="Device tilt / motion sensor"
                          icon={<Smartphone className="size-3.5 text-accent shrink-0" />}
                          checked={params.motionSensor ?? false}
                          onCheckedChange={async (v) => {
                            if (v && engineRef.current) {
                              const allowed = await engineRef.current.requestGyro();
                              if (!allowed) {
                                setNotification("Device motion permission was not granted.");
                                window.setTimeout(() => setNotification(null), 3000);
                                return;
                              }
                            }
                            patch({ motionSensor: v });
                            setNotification(
                              v
                                ? "Device tilt sensor enabled."
                                : "Device tilt disabled. Face will continue gentle slow sway.",
                            );
                            window.setTimeout(() => setNotification(null), 3000);
                          }}
                          invert={params.invert}
                        />
                      </div>
                      <p
                        className={cn(
                          "mt-2 text-[10px] leading-relaxed",
                          params.invert ? "text-neutral-500" : "text-fg-subtle",
                        )}
                      >
                        Keep tilt sensor off to avoid shaking when holding your device. The face will gently sway smoothly on its own.
                      </p>
                    </div>

                    {/* 3D Structure Alignment & Orbit */}
                    <div
                      className={cn(
                        "mt-1.5 rounded-xl border p-2.5 transition-all",
                        params.invert
                          ? "border-neutral-200 bg-neutral-50/80"
                          : "border-border/70 bg-bg-elevated/50",
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={cn(
                            "text-[11px] font-semibold uppercase tracking-[0.14em]",
                            params.invert ? "text-neutral-700" : "text-fg-muted",
                          )}
                        >
                          3D Alignment & Angle
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            engineRef.current?.resetOrbit(true);
                            setNotification("Aligned to straight front");
                            window.setTimeout(() => setNotification(null), 2000);
                          }}
                          className="h-7 text-xs gap-1.5 px-2.5"
                        >
                          <RotateCcw className="size-3" />
                          Align Front
                        </Button>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className={params.invert ? "text-neutral-600" : "text-fg-subtle"}>Rotate Left / Right</span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (engineRef.current) {
                                  engineRef.current.yaw -= 0.12;
                                  engineRef.current.userOrbit = true;
                                }
                              }}
                              className={cn(
                                "px-2 py-0.5 text-xs rounded border transition-colors",
                                params.invert ? "border-neutral-200 hover:bg-neutral-100" : "border-border hover:bg-bg-subtle",
                              )}
                            >
                              ◀ -15°
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (engineRef.current) {
                                  engineRef.current.yaw += 0.12;
                                  engineRef.current.userOrbit = true;
                                }
                              }}
                              className={cn(
                                "px-2 py-0.5 text-xs rounded border transition-colors",
                                params.invert ? "border-neutral-200 hover:bg-neutral-100" : "border-border hover:bg-bg-subtle",
                              )}
                            >
                              +15° ▶
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className={params.invert ? "text-neutral-600" : "text-fg-subtle"}>Tilt Up / Down</span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (engineRef.current) {
                                  engineRef.current.pitch -= 0.08;
                                  engineRef.current.userOrbit = true;
                                }
                              }}
                              className={cn(
                                "px-2 py-0.5 text-xs rounded border transition-colors",
                                params.invert ? "border-neutral-200 hover:bg-neutral-100" : "border-border hover:bg-bg-subtle",
                              )}
                            >
                              ▲ Up
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (engineRef.current) {
                                  engineRef.current.pitch += 0.08;
                                  engineRef.current.userOrbit = true;
                                }
                              }}
                              className={cn(
                                "px-2 py-0.5 text-xs rounded border transition-colors",
                                params.invert ? "border-neutral-200 hover:bg-neutral-100" : "border-border hover:bg-bg-subtle",
                              )}
                            >
                              ▼ Down
                            </button>
                          </div>
                        </div>
                      </div>

                      <div
                        className={cn(
                          "mt-2.5 rounded-lg p-2 text-[10px] leading-relaxed border",
                          params.invert ? "bg-white border-neutral-200 text-neutral-600" : "bg-bg-subtle/80 border-border/50 text-fg-subtle",
                        )}
                      >
                        <div className="font-semibold text-fg mb-0.5">Desktop & Mobile Gestures:</div>
                        <ul className="list-disc pl-3.5 space-y-0.5">
                          <li><strong>Desktop:</strong> Right-click drag or Shift+drag anywhere on portrait to freely orbit.</li>
                          <li><strong>Desktop:</strong> Scroll wheel to zoom. Double-click or press <kbd className="px-1 py-0.5 rounded border bg-bg-muted font-mono">R</kbd> to align front.</li>
                          <li><strong>Mobile:</strong> Use 2 fingers to drag & align the 3D head angle.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Eraser Tool Floating Interactive Toolbar */}
      <EraserToolbar
        active={eraserActive}
        submode={eraserSubmode}
        onSubmodeChange={handleSubmodeChange}
        radius={eraserRadius}
        onRadiusChange={handleRadiusChange}
        erasedCount={erasedCount}
        canUndo={canUndo}
        onUndo={handleUndo}
        onReset={handleReset}
        onDone={handleDone}
      />

      {recording && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex justify-center">
          <div className="rounded-full border border-border bg-bg-elevated/90 px-4 py-2 text-xs uppercase tracking-[0.18em] text-fg-muted">
            Recording · {recording}
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-4 top-[5.5rem] z-30 mx-auto max-w-md rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <RecordDialog
        open={recordDialogOpen}
        onClose={() => setRecordDialogOpen(false)}
        onStart={handleStartRecord}
        invert={params.invert}
        currentAnimation={activeAnimation}
      />

      <TextDialog
        open={textDialogOpen}
        onClose={() => setTextDialogOpen(false)}
        onSubmit={onTextSubmit}
        invert={params.invert}
      />

      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        particleSet={cacheRef.current?.set ?? engineRef.current?.getParticleSet() ?? null}
        pipelineCache={cacheRef.current}
        currentYaw={engineRef.current?.getOrbit().yaw ?? 0}
        currentPitch={engineRef.current?.getOrbit().pitch ?? 0.04}
        invert={params.invert}
      />

      <ShareDialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        params={params}
        currentStudyId={currentStudyId}
        canvas={canvasRef.current}
        sourceCanvas={cacheRef.current?.crop?.canvas ?? null}
        cameraPose={{
          yaw: engineRef.current?.yaw ?? 0,
          pitch: engineRef.current?.pitch ?? 0.04,
          zoom: engineRef.current?.getUserZoom() ?? 1.0,
        }}
      />

      {/* Hold-to-Burst dynamic charge indicator */}
      {holdBurstProgress > 0 && holdBurstPos && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
          style={{ left: holdBurstPos[0], top: holdBurstPos[1] }}
        >
          <div className="relative flex items-center justify-center size-20">
            <div
              className="absolute inset-0 rounded-full bg-gradient-to-r from-amber-500/30 via-rose-500/30 to-purple-500/30 blur-md animate-pulse"
              style={{ transform: `scale(${1 + holdBurstProgress * 0.8})` }}
            />
            <svg className="size-20 -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="32"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                className="text-white/20"
              />
              <circle
                cx="40"
                cy="40"
                r="32"
                stroke="currentColor"
                strokeWidth="5"
                fill="none"
                strokeDasharray={201}
                strokeDashoffset={201 * (1 - holdBurstProgress)}
                strokeLinecap="round"
                className="text-amber-400 transition-all duration-75"
              />
            </svg>
            <span className="absolute text-[11px] font-bold text-white drop-shadow">
              {Math.round(holdBurstProgress * 100)}%
            </span>
          </div>
          <span className="mt-1 px-2.5 py-0.5 rounded-full bg-black/80 text-[11px] font-medium text-amber-300 backdrop-blur-md border border-amber-500/30 shadow-lg">
            Holding to burst...
          </span>
        </div>
      )}

      {/* Burst notification toast */}
      {burstToast && (
        <div className="pointer-events-none fixed top-20 inset-x-0 z-50 flex justify-center animate-in zoom-in-95 duration-200">
          <div className="px-4 py-2 rounded-full bg-gradient-to-r from-amber-600 via-rose-600 to-purple-600 text-white font-semibold text-sm shadow-2xl flex items-center gap-2 border border-white/20">
            <span>💥 3D Structure Burst!</span>
          </div>
        </div>
      )}

      {/* Shared structure loaded banner */}
      {sharedBanner && (
        <div className="pointer-events-none fixed top-16 inset-x-0 z-40 flex justify-center px-4 animate-in slide-in-from-top-2 duration-300">
          <div className="px-4 py-2 rounded-xl bg-indigo-950/90 text-indigo-200 border border-indigo-500/40 backdrop-blur-md shadow-xl text-xs font-medium flex items-center gap-2">
            <Share2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{sharedBanner}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 ml-2">Interactive 3D</span>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  children,
  invert,
}: {
  label: string;
  value: string;
  children: ReactNode;
  invert?: boolean;
}) {
  return (
    <label className="mb-2 block">
      <span
        className={cn(
          "mb-1 flex items-center justify-between text-xs font-medium transition-colors",
          invert ? "text-neutral-700" : "text-fg-muted",
        )}
      >
        {label}
        <span
          className={cn(
            "tabular-nums transition-colors",
            invert ? "text-neutral-600 font-semibold" : "text-fg-subtle",
          )}
        >
          {value}
        </span>
      </span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  icon,
  invert,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  icon?: ReactNode;
  invert?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex h-11 items-center justify-between rounded-[var(--radius-md)] border px-3 text-sm transition-colors",
        invert
          ? "border-neutral-300 bg-white text-neutral-900 shadow-xs"
          : "border-border bg-bg text-fg",
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 transition-colors",
          invert ? "text-neutral-800 font-medium" : "text-fg-muted",
        )}
      >
        {icon}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} invert={invert} />
    </label>
  );
}
