import { useState } from "react";
import { Sparkles, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TextDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string, theme: "gold" | "cyberpunk" | "monochrome" | "emerald") => void;
  invert?: boolean;
}

export function TextDialog({ open, onClose, onSubmit, invert }: TextDialogProps) {
  const [text, setText] = useState("PARTICLES");
  const [theme, setTheme] = useState<"gold" | "cyberpunk" | "monochrome" | "emerald">("gold");

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSubmit(text.trim().toUpperCase(), theme);
    onClose();
  };

  const PRESETS = ["WHATSAPP", "COSMOS", "FUTURE", "ZEN", "HARMONY", "AURORA"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={cn(
          "relative w-full max-w-md rounded-[28px] border p-6 shadow-2xl transition-colors",
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

        <div className="flex items-center gap-2.5 mb-5">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-2xl",
              invert ? "bg-neutral-900 text-white" : "bg-accent/20 text-accent",
            )}
          >
            <Type className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-xl leading-tight">3D Particle Typography</h2>
            <p className={cn("text-xs", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Extrude words into interactive volumetric particles
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="text-particle-input"
              className={cn("block text-xs font-medium uppercase tracking-[0.12em] mb-1.5", invert ? "text-neutral-500" : "text-fg-subtle")}
            >
              Enter Text or Name
            </label>
            <input
              id="text-particle-input"
              type="text"
              maxLength={20}
              value={text}
              onChange={(e) => setText(e.target.value.toUpperCase())}
              placeholder="e.g. PARTICLES, STATUS, NAME"
              className={cn(
                "w-full rounded-xl border px-3.5 py-2.5 text-base font-semibold tracking-wider transition-colors outline-none focus:ring-2",
                invert
                  ? "border-neutral-200 bg-neutral-50 text-neutral-900 focus:ring-neutral-900 focus:border-neutral-900"
                  : "border-border bg-bg text-fg focus:ring-accent focus:border-accent",
              )}
            />
          </div>

          {/* Quick presets */}
          <div>
            <div className={cn("text-[11px] font-medium uppercase tracking-[0.1em] mb-1.5", invert ? "text-neutral-400" : "text-fg-subtle")}>
              Inspiration Words
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((word) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => setText(word)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
                    text === word
                      ? invert
                        ? "bg-neutral-900 text-white border-neutral-900"
                        : "bg-fg text-bg border-fg"
                      : invert
                        ? "bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300"
                        : "bg-bg-subtle text-fg-muted border-border hover:border-border-strong",
                  )}
                >
                  {word}
                </button>
              ))}
            </div>
          </div>

          {/* Color theme */}
          <div>
            <div className={cn("text-xs font-medium uppercase tracking-[0.12em] mb-1.5", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Color Theme
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "gold", label: "Golden Sun", desc: "Warm amber gradient" },
                { id: "cyberpunk", label: "Cyber Neon", desc: "Cyan & hot magenta" },
                { id: "emerald", label: "Emerald Ocean", desc: "Bioluminescent teal" },
                { id: "monochrome", label: "Pure Platinum", desc: "Monochrome silver" },
              ].map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => setTheme(th.id as typeof theme)}
                  className={cn(
                    "flex flex-col p-2.5 rounded-xl border text-left transition-all",
                    theme === th.id
                      ? invert
                        ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                        : "border-accent bg-accent/15 text-fg font-medium"
                      : invert
                        ? "border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800"
                        : "border-border/60 bg-bg/30 hover:border-border text-fg-muted",
                  )}
                >
                  <span className="text-xs font-semibold">{th.label}</span>
                  <span className={cn("text-[10px] mt-0.5", theme === th.id ? (invert ? "text-neutral-300" : "text-fg-muted") : "text-fg-subtle")}>
                    {th.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className={cn(
                "flex-[2]",
                invert ? "bg-neutral-900 text-white hover:bg-neutral-800" : "",
              )}
            >
              <Sparkles className="size-4 mr-1.5" />
              Sculpt Particles
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
