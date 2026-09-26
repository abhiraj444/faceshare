export async function loadImage(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      // Robust fallback for mobile browsers where createImageBitmap has issues
      bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not decode image photo."));
        };
        img.src = url;
      });
    }
  }
  const maxEdge = 1024;
  const bw = bitmap.width;
  const bh = bitmap.height;
  const scale = Math.min(1, maxEdge / Math.max(bw, bh));
  const w = Math.max(1, Math.round(bw * scale));
  const h = Math.max(1, Math.round(bh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a 2D canvas.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap && typeof (bitmap as ImageBitmap).close === "function") {
    (bitmap as ImageBitmap).close();
  }
  return canvas;
}

export async function loadUrl(url: string): Promise<HTMLCanvasElement> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Could not load image (${res.status}).`);
  return loadImage(await res.blob());
}

export function canvasFromImageData(data: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = data.width;
  c.height = data.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas.");
  ctx.putImageData(data, 0, 0);
  return c;
}
