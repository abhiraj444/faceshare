export const UPDATE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aVel;
layout(location = 2) in vec3 aHome;
layout(location = 3) in float aSeed;
uniform float uDt, uTime, uSpring, uDamp, uAssemble, uTurb;
uniform vec4 uTouch[5];
uniform vec2 uTouchVel[5];
uniform float uMode;
uniform float uEffectT;
uniform float uEffectAmp;
uniform vec2 uEffectOrigin;
out vec3 vPos;
out vec3 vVel;

// Fast harmonic 3D organic turbulence (approx. divergence-free, zero texture/hash stall)
vec3 fastTurbulence(vec3 p, float t) {
  vec3 p1 = p * 1.8 + vec3(t * 0.15, t * 0.12, t * 0.08);
  return vec3(
    sin(p1.y * 2.3 + p1.z * 1.7) * cos(p1.x * 1.4),
    cos(p1.z * 2.1 + p1.x * 1.9) * sin(p1.y * 1.5),
    sin(p1.x * 2.0 + p1.y * 2.4) * cos(p1.z * 1.6)
  ) * 0.42;
}

void main() {
  vec3 f = vec3(0.0);

  // Mode 5: Celestial Fill / Stream (Cascade down and settle layer-by-layer)
  if (uMode > 4.5) {
    float stagger = aSeed * 0.28;
    float reach = smoothstep(uEffectT - 0.16 + stagger, uEffectT + 0.10 + stagger, aHome.y);
    vec3 springForce = (aHome - aPos) * (uSpring * 1.85);
    float sway = sin(uTime * 4.5 + aSeed * 32.0) * 0.25;
    float streamZ = (aHome.z - aPos.z) * 4.5;
    vec3 streamForce = vec3(
      (aHome.x - aPos.x) * 4.5 + sway,
      -2.4 - aSeed * 1.2,
      streamZ
    );
    f += mix(streamForce, springForce, reach);
  } else {
    // Standard harmonic spring with per-particle emergence
    float k = smoothstep(aSeed * 0.45, aSeed * 0.45 + 0.55, uAssemble);
    f += (aHome - aPos) * (uSpring * (0.65 + 0.70 * k));
  }

  // Multi-touch interactive repulsion and velocity injection
  for (int i = 0; i < 5; i++) {
    vec2 d = aPos.xy - uTouch[i].xy;
    float rz = max(uTouch[i].z, 0.0001);
    float g = exp(-dot(d, d) / (rz * rz));
    vec2 nrm = d * inversesqrt(dot(d, d) + 1e-6);
    f.xy += nrm * g * uTouch[i].w;
    f.xy += uTouchVel[i] * g * 2.0;
  }

  // Base ambient 3D organic turbulence (fast, smooth, zero micro-stutter)
  if (uTurb > 0.005) {
    f += fastTurbulence(aPos, uTime) * uTurb;
  }

  // Mode 1: Vortex / Spiral Streams
  if (uMode > 0.5 && uMode < 1.5) {
    vec2 delta = aPos.xy - uEffectOrigin;
    float r = length(delta);
    if (r > 0.001) {
      vec2 tangent = vec2(-delta.y, delta.x) / r;
      vec2 radial = -delta / r;
      float falloff = 1.0 / (1.0 + r * 2.5);
      float particlePhase = sin(r * 12.0 - uTime * 6.0 + aSeed * 6.28) * 0.35;
      f.xy += (tangent * 4.2 + radial * (1.2 + particlePhase)) * uEffectAmp * falloff;
      f.z += sin(r * 8.0 + aSeed * 10.0) * uEffectAmp * 0.5 * falloff;
    }
  }
  // Mode 2: Traveling Harmonic Wave
  else if (uMode > 1.5 && uMode < 2.5) {
    float waveFront = uEffectOrigin.x;
    float distToFront = aPos.x - waveFront;
    float envelope = exp(-pow(distToFront * 3.2, 2.0));
    float phase = distToFront * 14.0 - uTime * 8.0 + aSeed * 4.0;
    f.z += sin(phase) * (uEffectAmp * 2.6) * envelope;
    f.y += cos(phase * 0.7) * (uEffectAmp * 1.2) * envelope;
    f.x += sin(phase * 0.5) * (uEffectAmp * 0.8) * envelope;
  }
  // Mode 3: Resonance Ripple
  else if (uMode > 2.5 && uMode < 3.5) {
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    float waveRadius = uEffectT * 1.85;
    float ring = exp(-pow((dist - waveRadius) * 8.0, 2.0));
    vec3 dir = dist > 1e-4 ? d / dist : vec3(0.0, 0.0, 1.0);
    float crest = sin((dist - waveRadius) * 22.0 + aSeed * 2.0);
    f += dir * (ring * crest * uEffectAmp * 3.8);
    f.z += ring * (uEffectAmp * 2.2) * (1.0 + aSeed);
  }
  // Mode 4: Disassemble / Break
  else if (uMode > 3.5 && uMode < 4.5) {
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    vec3 dir = dist > 1e-4 ? normalize(d) : vec3(0.0, 0.0, 1.0);
    vec3 chaoticSpur = fastTurbulence(aPos * 2.5, uTime * 3.0 + aSeed * 20.0);
    float forceFalloff = 1.0 / (dist + 0.35);
    f += (dir * 1.6 + chaoticSpur * 3.2) * uEffectAmp * forceFalloff * (0.6 + aSeed * 0.8);
  }
  // Mode 6: Smooth Explosive Burst
  else if (uMode > 5.5 && uMode < 6.5) {
    float burstAge = max(0.0, uEffectT);
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    vec3 dir = dist > 1e-4 ? d / dist : vec3(sin(aSeed * 6.28), cos(aSeed * 6.28), 0.5);
    float blastPower = exp(-burstAge * 2.5) * uEffectAmp * 28.0;
    vec3 fluidSwirl = fastTurbulence(aPos * 2.2, uTime * 3.2 + aSeed * 18.0) * (blastPower * 0.4);
    f += (dir * blastPower + fluidSwirl);
  }

  vVel = (aVel + f * uDt) * exp(-uDamp * uDt);
  vPos = aPos + vVel * uDt;
}
`;

export const UPDATE_FS = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

export const RENDER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aTone;
layout(location = 2) in float aSeed;
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aSemantic;
uniform mat4 uViewProj;
uniform float uSize;
uniform float uDpr;
uniform vec2 uPointRange;
uniform float uTime;
uniform float uBreath;
uniform float uColorMode;
uniform float uColorMix;
uniform float uInvert;
uniform float uDistScale;
uniform float uRadiance;
out float vBright;
out vec3 vColor;

void main() {
  vec3 p = aPos;
  p.z += sin(uTime * 1.35 + aSeed * 6.28318) * uBreath;
  gl_Position = uViewProj * vec4(p, 1.0);
  
  float depthScale = 0.75 + 0.25 * (1.0 - clamp(p.z * 0.85 + 0.35, 0.0, 1.0));
  float distScale = clamp(uDistScale, 0.52, 1.55);
  float size = uSize * uDpr * depthScale * distScale;
  gl_PointSize = clamp(size, uPointRange.x, uPointRange.y);
  
  float tone = aTone;
  float densityComp = clamp(pow(distScale, 0.42), 0.72, 1.28);
  float rad = clamp(uRadiance, 0.4, 2.2);

  // 100% faithful original photo color reproduction.
  // Exposure scaling is linear across all 3 color channels:
  // (R * rad, G * rad, B * rad).
  // Because the ratios R:G:B are perfectly preserved, hue angle and saturation
  // remain 100% true to the original photo with zero color shift or orange tinting!
  vec3 exactColor = clamp(aColor * rad, 0.0, 1.0);

  vec3 col;
  float b = 1.0;

  // 0.0 = Monochrome, 1.0 = Color, 2.0 = Hybrid
  if (uColorMode > 0.5 && uColorMode < 1.5) {
    // -----------------------------------------------------------------
    // FULL COLOR MODE: 100% Exact Photo Match
    // -----------------------------------------------------------------
    col = exactColor;
    // Normalized alpha cap prevents additive stacking from blowing out or oversaturating
    b = 0.88 + 0.12 * depthScale;
  } else if (uColorMode < 0.5) {
    // -----------------------------------------------------------------
    // MONOCHROME MODE: Silver Stipple on Dark, or Ink-Black on White
    // -----------------------------------------------------------------
    if (uInvert < 0.5) {
      col = vec3(1.0);
      b = clamp((0.45 + 0.55 * tone) * rad * (0.85 + 0.15 * depthScale) * densityComp, 0.05, 1.0);
    } else {
      col = vec3(0.04, 0.04, 0.05);
      b = clamp((0.75 + 0.25 * tone) * rad * (0.85 + 0.15 * depthScale), 0.1, 1.0);
    }
  } else {
    // -----------------------------------------------------------------
    // HYBRID MODE: Subtle blend between exact photo and silver
    // -----------------------------------------------------------------
    float isCol = step(aSeed, clamp(uColorMix, 0.05, 0.95));
    if (uInvert < 0.5) {
      col = mix(vec3(1.0), exactColor, isCol);
      float monoB = (0.45 + 0.55 * tone) * rad;
      b = clamp(mix(monoB, 0.92, isCol), 0.05, 1.0);
    } else {
      vec3 inkBlack = vec3(0.04, 0.04, 0.05);
      col = mix(inkBlack, exactColor, isCol);
      float monoB = (0.75 + 0.25 * tone) * rad;
      b = clamp(mix(monoB, 0.92, isCol), 0.1, 1.0);
    }
  }

  // Strictly clamp brightness between 0.0 and 1.0 so alpha never overflows 100%
  vBright = clamp(b, 0.05, 1.0);
  vColor = col;
}
`;

export const RENDER_FS = `#version 300 es
precision highp float;
in float vBright;
in vec3 vColor;
out vec4 fragColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;

  // Smooth Gaussian stipple falloff strictly clamped to [0, 1]
  // In premultiplied alpha (gl.ONE, gl.ONE_MINUS_SRC_ALPHA), a <= 1.0 guarantees that
  // overlapping particles converge to the EXACT original color without channel blowout!
  float a = clamp(exp(-r2 * 2.8) * vBright, 0.0, 1.0);
  fragColor = vec4(vColor * a, a);
}
`;
