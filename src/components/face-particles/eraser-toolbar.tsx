import React from "react";
import {
  Eraser,
  RotateCw,
  Undo2,
  RotateCcw,
  Check,
  Circle,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface EraserToolbarProps {
  active: boolean;
  submode: "brush" | "orbit";
  onSubmodeChange: (mode: "brush" | "orbit") => void;
  radius: number;
  onRadiusChange: (radius: number) => void;
  erasedCount: number;
  canUndo: boolean;
  onUndo: () => void;
  onReset: () => void;
  onDone: () => void;
}

const BRUSH_SIZES = [
  { label: "S", radius: 18, desc: "Fine detail" },
  { label: "M", radius: 40, desc: "Standard" },
  { label: "L", radius: 75, desc: "Broad" },
  { label: "XL", radius: 120, desc: "Sweep" },
];

export function EraserToolbar({
  active,
  submode,
  onSubmodeChange,
  radius,
  onRadiusChange,
  erasedCount,
  canUndo,
  onUndo,
  onReset,
  onDone,
}: EraserToolbarProps) {
  if (!active) return null;

  return (
    <div className="pointer-events-auto fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2.5 max-w-[95vw] w-[460px] animate-in fade-in slide-in-from-bottom-6 duration-300">
      {/* Main Glass Toolpanel */}
      <div className="w-full rounded-2xl border border-white/15 bg-neutral-950/85 backdrop-blur-xl shadow-2xl p-3.5 text-white flex flex-col gap-3">
        {/* Top Row: Mode Toggle & Status & Done */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
            <button
              type="button"
              onClick={() => onSubmodeChange("brush")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all",
                submode === "brush"
                  ? "bg-rose-500/25 text-rose-300 border border-rose-500/40 shadow-sm"
                  : "text-neutral-400 hover:text-white hover:bg-white/5",
              )}
            >
              <Eraser className="w-3.5 h-3.5" />
              Erase
            </button>
            <button
              type="button"
              onClick={() => onSubmodeChange("orbit")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all",
                submode === "orbit"
                  ? "bg-indigo-500/25 text-indigo-300 border border-indigo-500/40 shadow-sm"
                  : "text-neutral-400 hover:text-white hover:bg-white/5",
              )}
            >
              <RotateCw className="w-3.5 h-3.5" />
              Orbit View
            </button>
          </div>

          {/* Erased Counter */}
          <div className="text-[11px] font-mono text-neutral-300 px-2 py-1 rounded bg-white/5 border border-white/5 flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full", erasedCount > 0 ? "bg-amber-400 animate-pulse" : "bg-neutral-500")} />
            <span>{erasedCount.toLocaleString()} erased</span>
          </div>

          {/* Done Button */}
          <Button
            size="sm"
            onClick={onDone}
            className="h-8 px-3.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs shadow-md shadow-emerald-500/20 flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5 stroke-[3]" />
            Done
          </Button>
        </div>

        {/* Middle Row: Brush Sizes & Live Radius Slider */}
        <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex items-center justify-between text-xs text-neutral-300">
            <div className="flex items-center gap-1.5 font-medium">
              <Circle className="w-3.5 h-3.5 text-rose-400" />
              <span>Brush Size</span>
              <span className="font-mono text-[11px] text-neutral-400">({radius * 2}px)</span>
            </div>

            {/* Quick Size Presets */}
            <div className="flex items-center gap-1">
              {BRUSH_SIZES.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => onRadiusChange(b.radius)}
                  title={`${b.label}: ${b.desc} (${b.radius * 2}px)`}
                  className={cn(
                    "w-7 h-6 rounded text-[11px] font-bold transition-all",
                    radius === b.radius
                      ? "bg-white text-black shadow"
                      : "bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10",
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="px-1 py-1">
            <Slider
              value={[radius]}
              min={10}
              max={140}
              step={2}
              onValueChange={([val]) => val && onRadiusChange(val)}
              className="py-1"
            />
          </div>
        </div>

        {/* Bottom Row: Undo & Reset & Hint */}
        <div className="flex items-center justify-between border-t border-white/10 pt-2 text-xs">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!canUndo}
              onClick={onUndo}
              className="h-7 px-2.5 text-xs rounded-lg border-white/10 bg-white/5 hover:bg-white/10 text-neutral-200 disabled:opacity-35 flex items-center gap-1.5"
            >
              <Undo2 className="w-3 h-3" />
              Undo
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={erasedCount === 0}
              onClick={onReset}
              className="h-7 px-2.5 text-xs rounded-lg border-white/10 bg-white/5 hover:bg-white/10 text-neutral-200 disabled:opacity-35 flex items-center gap-1.5"
            >
              <RotateCcw className="w-3 h-3" />
              Reset All
            </Button>
          </div>

          <div className="text-[11px] text-neutral-400 flex items-center gap-1">
            <HelpCircle className="w-3 h-3 text-neutral-400" />
            <span>
              {submode === "brush" ? "Drag on screen to erase" : "Drag to inspect 3D angle"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
