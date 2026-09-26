import { useEffect, useRef, useState } from "react";
import {
  Compass,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Palette,
  Printer,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ParticleSet } from "@/lib/face-particles/types";
import type { PipelineCache } from "@/lib/face-particles/pipeline";
import {
  exportA4VectorSvg,
  printA4Direct,
  renderA4Canvas,
  type PrintPose,
  type PrintStyle,
} from "@/lib/face-particles/print";
import { downloadBlob, downloadText } from "@/lib/face-particles/record";

interface PrintDialogProps {
  open: boolean;
  onClose: () => void;
  particleSet: ParticleSet | null;
  pipelineCache?: PipelineCache | null;
  currentYaw: number;
  currentPitch: number;
  invert?: boolean;
}

export function PrintDialog({
  open,
  onClose,
  particleSet,
  pipelineCache,
  currentYaw,
  currentPitch,
  invert,
}: PrintDialogProps) {
  const [pose, setPose] = useState<PrintPose>("current");
  const [style, setStyle] = useState<PrintStyle>("mono");
  const [busy, setBusy] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewTimer = useRef<number | null>(null);

  const target = pipelineCache ?? particleSet;

  // Live A4 preview thumbnail generation
  useEffect(() => {
    if (!open || !target) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);

    previewTimer.current = window.setTimeout(async () => {
      try {
        // Render crisp thumbnail at A4 aspect ratio (280x396)
        const thumbCanvas = await renderA4Canvas(
          target,
          { pose, style, currentYaw, currentPitch },
          320,
          Math.round(320 / (2480 / 3508)),
        );
        setPreviewUrl(thumbCanvas.toDataURL("image/png"));
      } catch (err) {
        console.error("Preview render failed:", err);
      }
    }, 60);

    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [open, pose, style, target, currentYaw, currentPitch]);

  if (!open) return null;

  const handlePrintDirect = async () => {
    if (!target) return;
    setBusy("Generating 300 DPI A4 Masterwork...");
    try {
      const canvas = await renderA4Canvas(target, {
        pose,
        style,
        currentYaw,
        currentPitch,
      });
      await printA4Direct(canvas);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPng = async () => {
    if (!target) return;
    setBusy("Rendering 300 DPI A4 Image (2480×3508)...");
    try {
      const canvas = await renderA4Canvas(target, {
        pose,
        style,
        currentYaw,
        currentPitch,
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob failed"))), "image/png");
      });
      const filename = `face-particles-a4-${style}-${pose}.png`;
      downloadBlob(blob, filename);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadSvg = () => {
    if (!target) return;
    setBusy("Exporting Infinite-Detail Vector SVG...");
    try {
      const svg = exportA4VectorSvg(target, {
        pose,
        style,
        currentYaw,
        currentPitch,
      });
      const filename = `face-particles-vector-${style}-${pose}.svg`;
      downloadText(svg, filename, "image/svg+xml");
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={cn(
          "relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-[28px] border p-5 sm:p-6 shadow-2xl transition-colors",
          invert
            ? "border-neutral-200 bg-white text-neutral-900 shadow-neutral-900/10"
            : "border-border bg-bg-elevated text-fg",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "absolute right-4 top-4 p-1.5 rounded-full transition-colors z-10",
            invert
              ? "text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
              : "text-fg-subtle hover:text-fg hover:bg-bg-subtle",
          )}
          aria-label="Close dialog"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-2xl",
              invert ? "bg-neutral-900 text-white" : "bg-accent/20 text-accent",
            )}
          >
            <Printer className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-xl leading-tight">A4 Print & Vector Studio</h2>
            <p className={cn("text-xs", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Museum-grade positive stippling calibrated for A4 paper (300 DPI & Vector)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-5">
          {/* Live A4 Sheet Preview */}
          <div className="sm:col-span-5 flex flex-col items-center justify-center">
            <div
              className={cn(
                "relative w-full max-w-[200px] aspect-[210/297] rounded-lg border shadow-xl overflow-hidden flex items-center justify-center transition-all",
                invert ? "border-neutral-300 bg-white shadow-neutral-400/25" : "border-neutral-700 bg-white shadow-black/40",
              )}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="A4 Live Preview"
                  className="size-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-neutral-400">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-[11px]">Preparing Preview...</span>
                </div>
              )}
              <div className="absolute bottom-1 right-1.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-mono text-white/90 backdrop-blur-xs">
                A4 · 300 DPI
              </div>
            </div>
            <p className={cn("mt-2 text-center text-[11px]", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Full-bleed gallery framing (~88% coverage)
            </p>
          </div>

          {/* Configuration Controls */}
          <div className="sm:col-span-7 space-y-4">
            {/* Pose Selector */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Compass className="size-3.5 text-blue-500" />
                <span
                  className={cn(
                    "text-xs font-semibold uppercase tracking-[0.12em]",
                    invert ? "text-neutral-600" : "text-fg-subtle",
                  )}
                >
                  Select Portrait Pose
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: "current", label: "Current Pose", sub: "Live 3D angle on stage" },
                  { id: "frontal", label: "Frontal", sub: "Clean symmetric portrait" },
                  { id: "three_quarter_left", label: "3/4 Left", sub: "Fine-art gallery turn" },
                  { id: "three_quarter_right", label: "3/4 Right", sub: "Dynamic right turn" },
                  { id: "tilt", label: "Heroic Tilt", sub: "Upward angle perspective" },
                ].map((p) => {
                  const active = pose === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPose(p.id as PrintPose)}
                      className={cn(
                        "flex flex-col p-2 rounded-xl border text-left transition-all",
                        active
                          ? invert
                            ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                            : "border-accent bg-accent/20 text-fg font-medium"
                          : invert
                            ? "border-neutral-200 bg-neutral-50 hover:border-neutral-300 text-neutral-800"
                            : "border-border/60 bg-bg/30 hover:border-border text-fg-muted",
                      )}
                    >
                      <span className="text-xs font-semibold">{p.label}</span>
                      <span
                        className={cn(
                          "text-[10px] mt-0.5",
                          active ? (invert ? "text-neutral-300" : "text-fg-muted") : "text-fg-subtle",
                        )}
                      >
                        {p.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Palette Selector */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Palette className="size-3.5 text-purple-500" />
                <span
                  className={cn(
                    "text-xs font-semibold uppercase tracking-[0.12em]",
                    invert ? "text-neutral-600" : "text-fg-subtle",
                  )}
                >
                  Ink & Pigment Style
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  {
                    id: "mono",
                    label: "Carbon Ink",
                    sub: "India ink on white",
                  },
                  {
                    id: "color",
                    label: "Full Color",
                    sub: "Photographic pigments",
                  },
                  {
                    id: "hybrid",
                    label: "Hybrid Mix",
                    sub: "Color + ink accents",
                  },
                ].map((st) => {
                  const active = style === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStyle(st.id as PrintStyle)}
                      className={cn(
                        "flex flex-col p-2 rounded-xl border text-left transition-all",
                        active
                          ? invert
                            ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                            : "border-accent bg-accent/20 text-fg font-medium"
                          : invert
                            ? "border-neutral-200 bg-neutral-50 hover:border-neutral-300 text-neutral-800"
                            : "border-border/60 bg-bg/30 hover:border-border text-fg-muted",
                      )}
                    >
                      <span className="text-xs font-semibold">{st.label}</span>
                      <span
                        className={cn(
                          "text-[10px] mt-0.5 leading-tight",
                          active ? (invert ? "text-neutral-300" : "text-fg-muted") : "text-fg-subtle",
                        )}
                      >
                        {st.sub}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quality Note */}
            <div
              className={cn(
                "flex items-start gap-2 p-2.5 rounded-xl border text-xs leading-relaxed",
                invert
                  ? "border-neutral-200 bg-neutral-50 text-neutral-600"
                  : "border-border/60 bg-bg/40 text-fg-muted",
              )}
            >
              <Sparkles className="size-4 shrink-0 text-amber-500 mt-0.5" />
              <div>
                <strong className={invert ? "text-neutral-900" : "text-fg"}>Micro-Dot Positive Ink: </strong>
                Dots are refined to ~1.18px radius at 300 DPI, preserving paper highlights and velvety shadow gradations with no blotching.
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={Boolean(busy)}
            onClick={() => void handleDownloadSvg()}
          >
            <FileCode2 className="size-4 mr-1.5" />
            Vector SVG
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={Boolean(busy)}
            onClick={() => void handleDownloadPng()}
          >
            <ImageIcon className="size-4 mr-1.5" />
            300 DPI PNG
          </Button>
          <Button
            variant="primary"
            className={cn(
              "flex-[1.4]",
              invert ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-md" : "",
            )}
            disabled={Boolean(busy)}
            onClick={() => void handlePrintDirect()}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin mr-1.5" />
                {busy}
              </>
            ) : (
              <>
                <Printer className="size-4 mr-1.5" />
                Print A4 Sheet
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
