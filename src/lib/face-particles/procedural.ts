/** Academic head study painted in canvas — instant demo, no network. */
export function paintStudy(preset: 0 | 1 | 2 = 0): HTMLCanvasElement {
  const w = 768;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  const skins: [number, number, number][] = [
    [196, 149, 118],
    [92, 62, 46],
    [232, 201, 176],
  ];
  const hairs: [number, number, number][] = [
    [28, 22, 18],
    [18, 14, 12],
    [62, 42, 28],
  ];
  const skin = skins[preset]!;
  const hair = hairs[preset]!;

  ctx.fillStyle = "#070708";
  ctx.fillRect(0, 0, w, h);

  const cx = 384;
  const cy = 430;
  const faceRx = 168;
  const faceRy = 218;

  const shade = (r: number, g: number, b: number, k: number) =>
    `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

  // Neck
  const neck = ctx.createLinearGradient(cx, 620, cx, 980);
  neck.addColorStop(0, shade(skin[0], skin[1], skin[2], 0.72));
  neck.addColorStop(1, shade(skin[0], skin[1], skin[2], 0.4));
  ctx.fillStyle = neck;
  ctx.beginPath();
  ctx.ellipse(cx, 820, 86, 180, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.fillStyle = shade(skin[0], skin[1], skin[2], 0.78);
  ctx.beginPath();
  ctx.ellipse(cx - faceRx + 8, cy + 20, 28, 48, -0.15, 0, Math.PI * 2);
  ctx.ellipse(cx + faceRx - 8, cy + 20, 28, 48, 0.15, 0, Math.PI * 2);
  ctx.fill();

  // Hair back
  ctx.fillStyle = shade(hair[0], hair[1], hair[2], 1);
  ctx.beginPath();
  if (preset === 1) {
    ctx.ellipse(cx, cy - 40, 210, 230, 0, 0, Math.PI * 2);
  } else if (preset === 2) {
    ctx.ellipse(cx, cy - 10, 200, 250, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(cx, cy + 40, 220, 280, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Face
  const face = ctx.createRadialGradient(cx - 50, cy - 70, 20, cx, cy, 240);
  face.addColorStop(0, shade(skin[0], skin[1], skin[2], 1.12));
  face.addColorStop(0.45, shade(skin[0], skin[1], skin[2], 1));
  face.addColorStop(1, shade(skin[0], skin[1], skin[2], 0.55));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(cx, cy, faceRx, faceRy, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair bangs / top
  ctx.fillStyle = shade(hair[0], hair[1], hair[2], 1.05);
  ctx.beginPath();
  ctx.ellipse(cx, cy - 150, 170, 90, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  if (preset === 0) {
    ctx.beginPath();
    ctx.moveTo(cx - 160, cy - 40);
    ctx.quadraticCurveTo(cx - 200, 900, cx - 90, 980);
    ctx.quadraticCurveTo(cx - 40, 700, cx - 150, cy);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 160, cy - 40);
    ctx.quadraticCurveTo(cx + 210, 900, cx + 100, 980);
    ctx.quadraticCurveTo(cx + 50, 700, cx + 150, cy);
    ctx.fill();
  }

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(80,40,30,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx - 68, cy - 18, 48, 28, 0.1, 0, Math.PI * 2);
  ctx.ellipse(cx + 68, cy - 18, 48, 28, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eyes
  const drawEye = (ex: number, ey: number) => {
    ctx.fillStyle = shade(skin[0], skin[1], skin[2], 1.05);
    ctx.beginPath();
    ctx.ellipse(ex, ey, 38, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f3efe8";
    ctx.beginPath();
    ctx.ellipse(ex, ey, 32, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = preset === 1 ? "#2a1c12" : "#3b2a1c";
    ctx.beginPath();
    ctx.ellipse(ex, ey + 1, 14, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0a09";
    ctx.beginPath();
    ctx.ellipse(ex, ey + 1, 6, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(ex - 4, ey - 3, 3.2, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  drawEye(cx - 62, cy - 8);
  drawEye(cx + 62, cy - 8);

  // Brows
  ctx.strokeStyle = shade(hair[0], hair[1], hair[2], 1.2);
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 96, cy - 42);
  ctx.quadraticCurveTo(cx - 62, cy - 58, cx - 28, cy - 40);
  ctx.moveTo(cx + 96, cy - 42);
  ctx.quadraticCurveTo(cx + 62, cy - 58, cx + 28, cy - 40);
  ctx.stroke();

  // Nose
  ctx.strokeStyle = shade(skin[0], skin[1], skin[2], 0.55);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + 2, cy - 8);
  ctx.quadraticCurveTo(cx + 18, cy + 50, cx - 6, cy + 78);
  ctx.stroke();
  ctx.fillStyle = shade(skin[0], skin[1], skin[2], 0.5);
  ctx.beginPath();
  ctx.ellipse(cx - 12, cy + 80, 7, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 10, cy + 80, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(cx - 8, cy + 30, 6, 22, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  ctx.fillStyle = shade(skin[0] * 0.9, skin[1] * 0.55, skin[2] * 0.55, 1);
  ctx.beginPath();
  ctx.ellipse(cx, cy + 128, 36, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(skin[0] * 0.5, skin[1] * 0.3, skin[2] * 0.3, 1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy + 128);
  ctx.quadraticCurveTo(cx, cy + 136, cx + 34, cy + 128);
  ctx.stroke();

  // Cheek form
  ctx.fillStyle = "rgba(160,70,60,0.12)";
  ctx.beginPath();
  ctx.ellipse(cx - 78, cy + 58, 40, 22, 0.2, 0, Math.PI * 2);
  ctx.ellipse(cx + 78, cy + 58, 40, 22, -0.2, 0, Math.PI * 2);
  ctx.fill();

  if (preset === 1) {
    ctx.fillStyle = shade(hair[0], hair[1], hair[2], 1.1);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 155, 70, 48, 0, 0, Math.PI);
    ctx.fill();
  }

  // Soft grain
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = ((i * 1103515245 + 12345) >>> 0) % 13;
    d[i] = Math.min(255, d[i]! + n - 6);
    d[i + 1] = Math.min(255, d[i + 1]! + n - 6);
    d[i + 2] = Math.min(255, d[i + 2]! + n - 6);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
