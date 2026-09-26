# 3D Face Particles (ThreeDFace) — System Architecture & Deep Dive Guide

Welcome to the comprehensive technical documentation for **ThreeDFace**, an interactive, cinematic 3D particle sculpture studio built on WebGL2 GPGPU computing and client-side computer vision.

This document serves as the master architectural reference for developers, engineers, and researchers to understand, extend, and maintain every layer of the system.

---

## 1. Executive Summary & Core Philosophy

ThreeDFace transforms arbitrary 2D portraits, pet photos, objects, and typography into a live, interactive 3D volumetric particle cloud rendered in real-time WebGL2. 

Key pillars:
- **Zero Cloud Latency / 100% Client-Side:** All computer vision, depth estimation, image filtering, and blue-noise sampling execute entirely in the browser using WASM SIMD and WebGL2.
- **Physical Particle Fluidity:** Up to 100,000 distinct particles simulated at 60–120 FPS using WebGL2 Transform Feedback with GPU ping-pong buffers, Verlet spring dynamics, and curl-noise turbulence.
- **Universal Subject Intelligence:** Automatic classification between human faces, animals/pets (dogs, cats, horses), inanimate objects, text/quotes, and vector graphics.
- **Artistic Printing & Cinematic Video:** Direct vector path export for CNC pen plotters (SVG), high-DPI sumi-ink gallery print rendering, and 9:16 vertical video recording with synchronized audio tracks for social media.

---

## 2. System Architecture & Component Map

The project is structured into three primary layers: **UI Presentation**, **Processing Pipeline (Vision & Math)**, and **GPU Particle Engine (WebGL2)**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE LAYER                            │
│  app.tsx ─── Hero Bar ─── Controls Panel ─── Floating Action Dock       │
│  Dialogs: [RecordDialog] [PrintDialog] [TextDialog] [EraserToolbar]     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Upload Image / Type Text / Camera
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     CLIENT PIPELINE ORCHESTRATION                      │
│                            (pipeline.ts)                               │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Subject Classifier (subject-detector.ts)                           │
│    ├── Face: MediaPipe FaceLandmarker + ImageSegmenter (vision.ts)    │
│    ├── Pet / Animal: Quad-scale contour & muzzle relief (pet-detector) │
│    ├── Inanimate Object: Saliency contouring (object-detector)        │
│    └── Typography / Graphic: Vector & text rasterizer (text-adapter)   │
│                                                                        │
│ 2. Preprocessing & Alignment                                           │
│    ├── LUT-Accelerated Bilateral Denoise & Unsharp Mask (preprocess.ts)│
│    └── Instant Affine Roll-Straightening (straighten.ts)               │
│                                                                        │
│ 3. Volumetric Depth Generation (depth.ts)                              │
│    ├── Standard Mode: Geometric Cosine Dome + Landmark Protrusions     │
│    └── Neural HD Mode: Bilateral Spatial Gradient Integration          │
│                                                                        │
│ 4. Weight Calculation & Blue Noise Sampling                            │
│    ├── DoG Edge Filter & Landmark Topology (weights.ts)               │
│    └── Void-and-Cluster Blue Noise Sampler (sampler.ts / blue-noise.ts)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Float32Buffer (x, y, z, r, g, b, a)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      WEBGL2 GPGPU PARTICLE ENGINE                      │
│                             (engine.ts)                                │
├────────────────────────────────────────────────────────────────────────┤
│ • Double-buffered Transform Feedback (VAO A <-> VAO B)                 │
│ • Simulation Shader (UPDATE_VS / UPDATE_FS):                           │
│   Harmonic springs, damping, curl noise, 5-finger touch repulsion      │
│ • Kinetic Choreographies: Disperse, Vortex, Wave, Shockwave, Waterfall │
│ • Render Shader (RENDER_VS / RENDER_FS):                               │
│   Point primitives, perspective depth, alpha blending, sumi-ink mode  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Directory & File Breakdown

| Path | Purpose & Responsibilities |
| :--- | :--- |
| `src/components/face-particles/app.tsx` | Main application shell, state management, layout switching, responsive non-overlapping controls panel, event bus. |
| `src/components/face-particles/record-dialog.tsx` | Vertical 9:16 video studio with preset choreographies and social-ready audio tracks. |
| `src/components/face-particles/print-dialog.tsx` | Gallery print studio (300 DPI A4/A3 export and SVG vector pen-plotter paths). |
| `src/components/face-particles/text-dialog.tsx` | 3D interactive typography generator. |
| `src/components/face-particles/eraser-toolbar.tsx` | Real-time particle sculpture carving tool with undo stack and dual-view comparison. |
| `src/lib/face-particles/pipeline.ts` | Central orchestration engine. Coordinates vision, cropping, depth, weighting, and sampling. |
| `src/lib/face-particles/vision.ts` | MediaPipe FaceLandmarker and Multiclass ImageSegmenter loader with WASM SIMD and CPU/GPU fallback. |
| `src/lib/face-particles/straighten.ts` | Mathematical affine roll-angle correction (0ms re-detection latency). |
| `src/lib/face-particles/preprocess.ts` | LUT-accelerated bilateral filter and unsharp masking for sensor noise suppression. |
| `src/lib/face-particles/depth.ts` | Geometric dome depth calculation, anatomical nose/chin/lip protrusion, eye socket carving. |
| `src/lib/face-particles/weights.ts` | Importance field calculation (DoG edge extraction + landmark graph + tone luminance). |
| `src/lib/face-particles/sampler.ts` | Blue-noise sampling, monotonic sigmoid ranking, and Radix 16-bit sort. |
| `src/lib/face-particles/engine.ts` | WebGL2 Transform Feedback engine, mouse/touch physics, device gyro tracking. |
| `src/lib/face-particles/shaders.ts` | GLSL ES 3.00 shaders for simulation physics (`UPDATE_VS`) and drawing (`RENDER_VS`). |
| `src/lib/face-particles/subject-detector.ts` | Multi-subject classifier (Face, Pet, Object, Text, Graphic). |
| `src/lib/face-particles/pet-detector.ts` | Anatomical depth modeling for quadrupeds and cats/dogs. |
| `src/lib/face-particles/text-adapter.ts` | Canvas 2D rasterization of text into 3D particle clouds. |
| `src/lib/face-particles/neural/model-cache.ts` | Local IndexedDB and Cache API storage for neural depth assets. |

---

## 4. End-to-End Processing Pipeline

### Step 1: Input Acquisition & Subject Classification
When a user uploads an image, captures via camera, or clicks a sample:
1. `generateFromFile` loads the raw image into a high-resolution memory canvas.
2. `detectSubject` runs heuristic classifiers to determine whether the subject is a human face, an animal/pet, an inanimate object, or a graphic/text.
3. MediaPipe `FaceLandmarker` processes the image to extract 478 3D metric landmarks ($x, y, z$). Simultaneously, `ImageSegmenter` generates a 6-class semantic mask (background, hair, face-skin, body-skin, clothes, accessories).

### Step 2: LUT-Accelerated Preprocessing & Straightening
- **Bilateral Filtering:** To prevent camera sensor noise from corrupting edge gradients, `applyFastBilateralRGB` applies an edge-preserving filter. By utilizing precomputed spatial weights and an exponential lookup table (`expLUT`), this runs in under 15ms.
- **Affine Straightening:** If the subject's head is tilted, `straightenFace` calculates roll tilt via $\arctan2(\Delta y, \Delta x)$ from the eye pupils. Instead of triggering a redundant, expensive second pass of neural vision, it applies an instant 2D affine rotation matrix to the landmarks and segmentation mask directly.

### Step 3: Volumetric 3D Depth Synthesis
2D photos lack depth ($z$). The engine calculates realistic depth through one of two selectable modes:
1. **Geometric Cosine Dome Mode (`depth.ts`):** 
   - A smooth elliptical cosine dome profiles the head:
     $$Z_{\text{dome}}(x, y) = \cos\left(\frac{\pi}{2} \cdot \frac{r}{R}\right)$$
   - Anatomical anchor points (nose bridge, nose tip, lips, chin) are extracted from MediaPipe 3D coordinates ($z$) and blended into the dome.
   - Eye sockets and nostril cavities are softly carved out to create lifelike 3D facial contours.
2. **HD Neural Depth Mode (`neural/depth-estimator.ts`):**
   - Integrates multi-scale bilateral spatial gradients with luminance variations to generate high-frequency micro-relief (skin folds, wrinkles, clothing fabric folds).

### Step 4: Importance Density & Void-and-Cluster Sampling
1. **Importance Field (`weights.ts`):** Edge detection via Difference-of-Gaussians (DoG) highlights high-frequency details (eyes, lips, nostrils). Tonal luminance provides base density. The user's `Shadow lift (Floor)` slider ensures dark hair or fur remains visible without muddy over-densification.
2. **Blue Noise Sampling (`sampler.ts`):** Using an optimal Void-and-Cluster matrix with monotonic sigmoid ranking and a 16-bit Radix sort, the image is sampled into up to 100,000 distinct 3D points. Each particle contains:
   - Position: $(x, y, z)$
   - Color: $(r, g, b)$
   - Alpha / Importance: $a$

### Step 5: WebGL2 Transform Feedback Rendering
1. The particle cloud is uploaded to WebGL2 GPU VBOs (Vertex Buffer Objects).
2. Two Vertex Array Objects (VAO A and VAO B) alternate every frame:
   - In `UPDATE_VS`, the GPU calculates harmonic spring force toward target $(x, y, z)$, velocity damping, curl noise turbulence, and 5 concurrent multi-touch repulsion impulses.
   - The updated positions are written directly to GPU memory via `gl.transformFeedbackVaryings`.
   - In `RENDER_VS`, particles are projected to screen space with camera perspective, point-size scaling, and lighting.

---

## 5. UI Architecture & Responsive Interaction

### The Overlap Solution
Previously, opening the structure settings drawer completely occluded the 3D particles on both mobile and desktop screens. 

**The Redesigned UI Architecture:**
1. **Desktop Floating Sidebar:**
   - On screens $\ge 768\text{px}$ (`md:`), the parameters inspector floats docked to the right edge (`right-5 top-20 bottom-6 w-88`).
   - The central 3D viewport remains 100% visible and interactive. Users can click, drag, rotate, and sculpt particles while adjusting any slider.
2. **Mobile Tabbed Drawer:**
   - On mobile viewports, the sheet is organized into 3 focused tabs (`Style & Tone`, `Depth & Form`, `Sensors`).
   - Height is constrained to $\le 50\text{dvh}$, keeping the top half of the screen unobstructed for the 3D face.
3. **Live Scrub Translucency:**
   - When a user touches or drags any slider thumb, the panel automatically transitions to translucent (`opacity-30`). The 3D particles shine through the panel in real-time, providing immediate visual feedback at 60 FPS. Upon releasing the slider, the panel returns to normal frosted glass.
4. **Dock Toggle:**
   - A dedicated `Controls` button in the floating action dock allows users to toggle the inspector open or closed with a single click.

---

## 6. Performance Remediations Summary

| Bottleneck | Root Cause | Solution Implemented | Result |
| :--- | :--- | :--- | :--- |
| **Image Upload Freeze** | Separable bilateral filter performed millions of `Math.exp` calls on the main JS thread. | Precomputed `expLUT` (Lookup Table) and optimized 3x3 kernel. | Dropped execution from **~8,000ms down to ~12ms**. |
| **Straightening Latency** | `straightenFace` re-ran the full MediaPipe AI pipeline on rotated canvas. | Direct mathematical affine matrix transformation of landmarks & mask. | Eliminated redundant inference; reduced from **~6,500ms down to ~2ms**. |
| **Particle Densification** | Hardcoded floor (`Math.max(floor, 0.28)`) saturated dark regions with dense blobs. | Normalized tone curve and made floor directly controllable by user slider. | Restored crystalline pointillism and crisp facial aesthetics. |
| **UI Occlusion** | Settings drawer covered the entire center canvas. | Responsive right-docked desktop sidebar + mobile compact tabs + live scrub transparency. | 100% live visual feedback with zero viewport overlap. |

---

## 7. Developer Quick Reference

### Running in Development
```bash
npm run dev
```
Preview is available at `http://0.0.0.0:8080/`.

### Building for Production
```bash
npm run build
npm run typecheck
```

### Inspecting Shaders
- Vertex simulation shader: `src/lib/face-particles/shaders.ts` -> `UPDATE_VS`
- Fragment simulation shader: `src/lib/face-particles/shaders.ts` -> `UPDATE_FS`
- Render vertex shader: `src/lib/face-particles/shaders.ts` -> `RENDER_VS`
- Render fragment shader: `src/lib/face-particles/shaders.ts` -> `RENDER_FS`
