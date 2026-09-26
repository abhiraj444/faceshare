import { useState, useEffect } from "react";
import { Copy, Check, Share2, ExternalLink, Loader2, Sparkles, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Params, ParticleSet } from "@/lib/face-particles/types";
import { saveSharedPortrait } from "@/lib/server-share";
import { serializeParticleSet } from "@/lib/face-particles/serialize";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  params: Params;
  currentStudyId: string | null;
  canvas: HTMLCanvasElement | null;
  sourceCanvas: HTMLCanvasElement | null;
  particleSet: ParticleSet | null;
  cameraPose: { yaw: number; pitch: number; zoom: number };
}

export function ShareDialog({
  open,
  onClose,
  params,
  currentStudyId,
  canvas,
  sourceCanvas,
  particleSet,
  cameraPose,
}: ShareDialogProps) {
  const [shareUrl, setShareUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewThumb, setPreviewThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setLoading(true);

    const generateLink = async () => {
      try {
        // Snapshot thumbnail for dialog
        if (canvas) {
          try {
            setPreviewThumb(canvas.toDataURL("image/jpeg", 0.7));
          } catch {
            // ignore
          }
        }

        const shareId = "sp_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).slice(-4);

        let imageData: string | undefined = undefined;
        // If custom user image (not a built-in study), capture downscaled JPEG
        if (!currentStudyId && sourceCanvas) {
          try {
            const maxDim = 512;
            const w = sourceCanvas.width;
            const h = sourceCanvas.height;
            const scale = Math.min(1, maxDim / Math.max(w, h));
            const smallCanvas = document.createElement("canvas");
            smallCanvas.width = Math.round(w * scale);
            smallCanvas.height = Math.round(h * scale);
            const ctx = smallCanvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(sourceCanvas, 0, 0, smallCanvas.width, smallCanvas.height);
              imageData = smallCanvas.toDataURL("image/jpeg", 0.82);
            }
          } catch (e) {
            console.warn("Failed to downscale source image for share:", e);
          }
        }

        // Serialize exact 3D particle positions, colors, tones & depth losslessly
        let particleData: string | undefined = undefined;
        if (particleSet && particleSet.count > 0) {
          try {
            particleData = await serializeParticleSet(particleSet);
          } catch (e) {
            console.warn("Failed to serialize 3D particle structure for share:", e);
          }
        }

        // Persist via server function
        const payload = {
          id: shareId,
          title: currentStudyId ? `3D Portrait - ${currentStudyId}` : "Custom 3D Structure",
          studyId: currentStudyId ?? undefined,
          imageData,
          particleData,
          params: { ...params } as Record<string, unknown>,
          yaw: cameraPose.yaw,
          pitch: cameraPose.pitch,
          zoom: cameraPose.zoom,
        };

        // Save to DB
        await saveSharedPortrait({ data: payload });

        // Also cache locally for instant same-browser retrieval
        try {
          localStorage.setItem(`shared_portrait_${shareId}`, JSON.stringify(payload));
        } catch {
          // ignore
        }

        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const encodedParams = encodeURIComponent(JSON.stringify(params));
        const yawVal = cameraPose.yaw.toFixed(3);
        const pitchVal = cameraPose.pitch.toFixed(3);
        const zoomVal = cameraPose.zoom.toFixed(2);

        const url = currentStudyId
          ? `${origin}/?study=${encodeURIComponent(currentStudyId)}&p=${encodedParams}&yaw=${yawVal}&pitch=${pitchVal}&zoom=${zoomVal}&share=${shareId}`
          : `${origin}/?share=${shareId}`;

        setShareUrl(url);
      } catch (err) {
        console.error("Error generating share link:", err);
      } finally {
        setLoading(false);
      }
    };

    generateLink();
  }, [open, currentStudyId, canvas, sourceCanvas, particleSet, params, cameraPose]);

  if (!open) return null;

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    }
  };

  const handleNativeShare = async () => {
    if (!shareUrl) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Interactive 3D Particle Portrait",
          text: "Experience this interactive 3D particle structure! Drag to rotate, touch, shake, and burst.",
          url: shareUrl,
        });
      } catch {
        // user cancelled or failed
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={cn(
          "w-full max-w-md rounded-2xl border p-5 shadow-2xl transition-all",
          params.invert
            ? "border-neutral-300 bg-white text-neutral-900 shadow-neutral-400/20"
            : "border-border/80 bg-neutral-950/95 text-fg shadow-black/80",
        )}
      >
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-400 border border-indigo-500/30">
              <Share2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Share 3D Structure</h2>
              <p className={cn("text-xs", params.invert ? "text-neutral-500" : "text-fg-subtle")}>
                Anyone with this link can interact with this exact portrait.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={cn(
              "rounded-lg p-1.5 transition-colors",
              params.invert ? "hover:bg-neutral-100 text-neutral-500" : "hover:bg-neutral-800 text-fg-muted",
            )}
          >
            ✕
          </button>
        </div>

        {/* Preview card */}
        <div className="my-4 flex items-center gap-3.5 p-3 rounded-xl border border-border/50 bg-black/30">
          {previewThumb ? (
            <img
              src={previewThumb}
              alt="Structure preview"
              className="w-16 h-16 rounded-lg object-cover border border-white/10 shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-indigo-400 animate-pulse" />
            </div>
          )}
          <div className="min-w-0 flex-1 text-xs space-y-1">
            <div className="font-medium truncate flex items-center gap-1.5">
              <span>{currentStudyId ? `Study: ${currentStudyId.toUpperCase()}` : "Custom 3D Structure"}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                {particleSet ? `${particleSet.count.toLocaleString()} pts` : `${Math.round(params.particles / 1000)}k pts`}
              </span>
            </div>
            <div className={cn("text-[11px] truncate", params.invert ? "text-neutral-500" : "text-fg-subtle")}>
              Theme: {params.renderTheme ?? "particle"} · Style: {params.colorStyle ?? "mono"} · Exposure: {Math.round((params.radiance ?? 1.0) * 100)}%
            </div>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400">
              <Globe className="w-3 h-3" />
              <span>100% Lossless 3D particle structure (instant load)</span>
            </div>
          </div>
        </div>

        {/* Link box */}
        <div className="space-y-2">
          <label className={cn("text-xs font-medium", params.invert ? "text-neutral-700" : "text-fg-muted")}>
            Shareable URL
          </label>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex-1 px-3 py-2 text-xs font-mono rounded-xl border truncate select-all",
                params.invert
                  ? "bg-neutral-100 border-neutral-300 text-neutral-800"
                  : "bg-neutral-900 border-border/80 text-fg-muted",
              )}
            >
              {loading ? (
                <span className="flex items-center gap-2 text-fg-subtle">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating link...
                </span>
              ) : (
                shareUrl
              )}
            </div>
            <Button
              onClick={handleCopy}
              disabled={loading || !shareUrl}
              className={cn(
                "shrink-0 gap-1.5 font-medium shadow-sm transition-all",
                copied
                  ? "bg-emerald-600 hover:bg-emerald-600 text-white"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white",
              )}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
          {typeof navigator !== "undefined" && "share" in navigator && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNativeShare}
              disabled={loading || !shareUrl}
              className="text-xs gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share via Apps</span>
            </Button>
          )}

          <a
            href={shareUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 ml-auto p-1.5 rounded transition-colors",
              (!shareUrl || loading) && "pointer-events-none opacity-50",
            )}
          >
            <span>Open & Test Link</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
