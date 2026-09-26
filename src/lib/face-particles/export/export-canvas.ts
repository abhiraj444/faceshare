/**
 * ExportCanvas (v2 Remediation §3):
 * Decoupled off-screen render target manager.
 * Guarantees that video recording and still image exports are rendered from
 * a dedicated, pristine canvas without HUD overlays, DOM chrome, or debug labels.
 */

export interface ExportCanvasConfig {
  width: number;
  height: number;
  dpr?: number;
}

export class ExportCanvasManager {
  private canvas: HTMLCanvasElement;
  private audioCtx: AudioContext | null = null;
  private silentAudioTrack: MediaStreamTrack | null = null;

  constructor(config: ExportCanvasConfig = { width: 1080, height: 1920 }) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = config.width;
    this.canvas.height = config.height;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  setSize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Generates a silent audio track for the MediaStream.
   * CRITICAL FOR WHATSAPP STATUS / REELS:
   * WhatsApp on Android and iOS (and WhatsApp Web) frequently rejects video-only
   * streams or crashes the transcoder with "Can't send this video" if the MP4/WebM
   * container contains no audio track. Adding a valid silent WebAudio track
   * satisfies the WhatsApp A/V muxing pipeline.
   */
  getSilentAudioTrack(): MediaStreamTrack | null {
    if (this.silentAudioTrack && this.silentAudioTrack.readyState === "live") {
      return this.silentAudioTrack;
    }

    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return null;

      this.audioCtx = new AudioCtxClass();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      gain.gain.value = 0.00001; // Silent
      osc.connect(gain);

      const dst = this.audioCtx.createMediaStreamDestination();
      gain.connect(dst);
      osc.start();

      const tracks = dst.stream.getAudioTracks();
      if (tracks.length > 0) {
        this.silentAudioTrack = tracks[0]!;
        return this.silentAudioTrack;
      }
    } catch (e) {
      console.warn("Could not generate silent audio track for video container:", e);
    }
    return null;
  }

  dispose(): void {
    if (this.silentAudioTrack) {
      this.silentAudioTrack.stop();
      this.silentAudioTrack = null;
    }
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
