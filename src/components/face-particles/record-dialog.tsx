import { useState, useEffect } from "react";
import {
  Clock,
  Smartphone,
  Video,
  X,
  Aperture,
  Wind,
  Contrast,
  ScanFace,
  Layers,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { RecordOptions, RecordSequenceType } from "@/lib/face-particles/record";

interface RecordDialogProps {
  open: boolean;
  onClose: () => void;
  onStart: (options: RecordOptions) => void;
  invert?: boolean;
  currentAnimation?: RecordSequenceType;
}

export function RecordDialog({ open, onClose, onStart, invert, currentAnimation }: RecordDialogProps) {
  const [selectedAnimation, setSelectedAnimation] = useState<RecordSequenceType>(currentAnimation || "break");
  const [duration, setDuration] = useState<number>(12);
  const [aspect916, setAspect916] = useState<boolean>(true);
  const [resolution, setResolution] = useState<"1080p" | "720p">("1080p");
  const [colorChoice, setColorChoice] = useState<"original" | "color" | "mono">("original");

  useEffect(() => {
    if (open && currentAnimation) {
      setSelectedAnimation(currentAnimation);
    }
  }, [open, currentAnimation]);

  if (!open) return null;

  const handleStart = () => {
    onStart({
      aspect916,
      sequence: selectedAnimation,
      resolution,
      durationSeconds: duration,
      colorMode: colorChoice,
      forceColor: colorChoice === "color",
    });
    onClose();
  };

  const animationOptions = [
    {
      id: "break" as const,
      label: "Break",
      desc: "Disperses apart and reassembles smoothly",
      icon: Aperture,
      defDur: 12,
    },
    {
      id: "wind" as const,
      label: "Wave",
      desc: "Smooth harmonic traveling particle wave",
      icon: Wind,
      defDur: 12,
    },
    {
      id: "ripple" as const,
      label: "Ripple",
      desc: "Expansive spherical particle shockwave",
      icon: Contrast,
      defDur: 12,
    },
    {
      id: "fill" as const,
      label: "Fill",
      desc: "Cascades gently from top to bottom",
      icon: ScanFace,
      defDur: 12,
    },
    {
      id: "all" as const,
      label: "All Effects",
      desc: "Plays Break, Wave, Ripple, and Fill in sequence",
      icon: Layers,
      defDur: 24,
    },
    {
      id: "idle" as const,
      label: "Pure 3D Sway",
      desc: "Clean volumetric sway without disruption",
      icon: Sparkles,
      defDur: 12,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={cn(
          "relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[28px] border p-6 shadow-2xl transition-colors",
          invert
            ? "border-neutral-200 bg-white text-neutral-900 shadow-neutral-900/10"
            : "border-border bg-bg-elevated text-fg",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "absolute right-4 top-4 p-1.5 rounded-full transition-colors",
            invert ? "text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100" : "text-fg-subtle hover:text-fg hover:bg-bg-subtle",
          )}
          aria-label="Close dialog"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-2xl",
              invert ? "bg-neutral-900 text-white" : "bg-accent/20 text-accent",
            )}
          >
            <Video className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-xl leading-tight">Export Video</h2>
            <p className={cn("text-xs", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Record the portrait animation as high-definition MP4
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Main Animation Mode Selector */}
          <div>
            <div className={cn("text-xs font-semibold uppercase tracking-[0.12em] mb-1.5", invert ? "text-neutral-600" : "text-fg-subtle")}>
              Select Animation
            </div>
            <div className="grid grid-cols-2 gap-2">
              {animationOptions.map((opt) => {
                const active = selectedAnimation === opt.id;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSelectedAnimation(opt.id);
                      if (opt.id === "all") setDuration(24);
                      else if (duration > 16) setDuration(12);
                    }}
                    className={cn(
                      "flex flex-col p-2.5 rounded-xl border text-left transition-all",
                      active
                        ? invert
                          ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                          : "border-accent bg-accent/20 text-fg font-medium ring-1 ring-accent/50"
                        : invert
                          ? "border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800"
                          : "border-border/60 bg-bg/30 hover:border-border text-fg-muted",
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn("size-4", active ? (invert ? "text-white" : "text-accent") : "text-fg-subtle")} />
                        <span className="text-xs font-semibold">{opt.label}</span>
                      </div>
                      {opt.id === currentAnimation && (
                        <span
                          className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider",
                            active
                              ? "bg-white/20 text-white"
                              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                          )}
                        >
                          Main
                        </span>
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-[10px] mt-1 leading-snug",
                        active ? (invert ? "text-neutral-300" : "text-fg/80") : (invert ? "text-neutral-500" : "text-fg-subtle"),
                      )}
                    >
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Format & Aspect Toggle */}
          <div>
            <label
              className={cn(
                "flex items-center justify-between p-3 rounded-xl border transition-colors",
                invert ? "border-neutral-200 bg-neutral-50" : "border-border/60 bg-bg/40",
              )}
            >
              <div className="flex items-center gap-2.5">
                <Smartphone className="size-4 text-emerald-500" />
                <div>
                  <div className="text-xs font-semibold">9:16 Fullscreen Vertical</div>
                  <div className={cn("text-[11px]", invert ? "text-neutral-500" : "text-fg-subtle")}>
                    Optimized for WhatsApp Status, Stories & Reels
                  </div>
                </div>
              </div>
              <Switch checked={aspect916} onCheckedChange={setAspect916} invert={invert} />
            </label>
          </div>

          {/* Resolution Picker */}
          <div>
            <div className={cn("text-xs font-medium uppercase tracking-[0.12em] mb-1.5", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Resolution
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "1080p", label: "1080p Ultra HD", sub: aspect916 ? "1080 × 1920 (Sharpest)" : "1920 × 1080" },
                { id: "720p", label: "720p Fast", sub: aspect916 ? "720 × 1280 (Fast)" : "1280 × 720" },
              ].map((res) => {
                const active = resolution === res.id;
                return (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => setResolution(res.id as "1080p" | "720p")}
                    className={cn(
                      "flex flex-col p-2 rounded-xl border text-left transition-all",
                      active
                        ? invert
                          ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                          : "border-accent bg-accent/15 text-fg font-medium"
                        : invert
                          ? "border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800"
                          : "border-border/60 bg-bg/30 hover:border-border text-fg-muted",
                    )}
                  >
                    <span className="text-xs font-semibold">{res.label}</span>
                    <span className={cn("text-[10px] mt-0.5", active ? (invert ? "text-neutral-300" : "text-fg/80") : (invert ? "text-neutral-500" : "text-fg-subtle"))}>
                      {res.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Particle Appearance */}
          <div>
            <div className={cn("text-xs font-medium uppercase tracking-[0.12em] mb-1.5", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Particle Palette
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "original", label: "Match Display", desc: "Current view" },
                { id: "color", label: "Vibrant Color", desc: "Photo hues" },
                { id: "mono", label: "Monochrome", desc: "Pure silver" },
              ].map((opt) => {
                const active = colorChoice === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setColorChoice(opt.id as "original" | "color" | "mono")}
                    className={cn(
                      "flex flex-col p-2 rounded-xl border text-left transition-all",
                      active
                        ? invert
                          ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                          : "border-accent bg-accent/15 text-fg font-medium"
                        : invert
                          ? "border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800"
                          : "border-border/60 bg-bg/30 hover:border-border text-fg-muted",
                    )}
                  >
                    <span className="text-xs font-semibold">{opt.label}</span>
                    <span className={cn("text-[10px] mt-0.5", active ? (invert ? "text-neutral-300" : "text-fg/80") : (invert ? "text-neutral-500" : "text-fg-subtle"))}>
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Duration Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className={cn("text-xs font-medium uppercase tracking-[0.12em]", invert ? "text-neutral-500" : "text-fg-subtle")}>
                Video Duration
              </span>
              <span className={cn("text-xs font-semibold tabular-nums flex items-center gap-1", invert ? "text-neutral-700" : "text-fg")}>
                <Clock className="size-3.5" />
                {duration}s
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[8, 12, 16, 24].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDuration(s)}
                  className={cn(
                    "py-1.5 rounded-lg border text-xs font-semibold transition-all",
                    duration === s
                      ? invert
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-accent bg-accent/20 text-fg"
                      : invert
                        ? "border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-700"
                        : "border-border/60 bg-bg/40 hover:bg-bg text-fg-muted",
                  )}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Start CTA */}
        <div className="mt-6 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className={cn(
              "flex-[2]",
              invert ? "bg-neutral-900 text-white hover:bg-neutral-800" : "",
            )}
            onClick={handleStart}
          >
            <Video className="size-4 mr-1.5" />
            Export MP4 ({duration}s)
          </Button>
        </div>
      </div>
    </div>
  );
}
