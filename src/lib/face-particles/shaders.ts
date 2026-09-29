export const UPDATE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aVel;
layout(location = 2) in vec3 aHome;
layout(location = 3) in float aSeed;
layout(location = 4) in float aSemantic;

uniform float uDt, uTime, uSpring, uDamp, uAssemble, uTurb;
uniform vec4 uTouch[5]; // x, y, z, strength
uniform vec2 uTouchVel[5];
uniform float uMode;
uniform float uEffectT;
uniform float uEffectAmp;
uniform vec2 uEffectOrigin;
uniform float uCount;
uniform float uRegionDelay[5]; // disassemble delay per semantic region (0..4)

out vec3 vPos;
out vec3 vVel;

// Fast harmonic 3D organic turbulence
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
  int sem = clamp(int(aSemantic), 0, 4);
  float regDelay = uRegionDelay[sem];

  // P4.1 Progressive Assembly: Importance-first rank ordering
  float rank = float(gl_VertexID) / max(1.0, uCount);
  float s_i = mix(aSeed, rank, 0.85);

  // Mode 5: Celestial Fill / Stream
  if (uMode > 4.5 && uMode < 5.5) {
    float stagger = s_i * 0.28;
    float reach = smoothstep(uEffectT - 0.16 + stagger, uEffectT + 0.10 + stagger, aHome.y);
    vec3 springForce = (aHome - aPos) * (uSpring * 1.85);
    float sway = sin(uTime * 4.5 + s_i * 32.0) * 0.25;
    float streamZ = (aHome.z - aPos.z) * 4.5;
    vec3 streamForce = vec3(
      (aHome.x - aPos.x) * 4.5 + sway,
      -2.4 - s_i * 1.2,
      streamZ
    );
    f += mix(streamForce, springForce, reach);
  } else if (uMode > 5.5 && uMode < 6.5) {
    if (uEffectT < 1.0) {
      f += (aHome - aPos) * uSpring;
    } else {
      float burstAge = uEffectT - 1.0;
      float returnFactor = smoothstep(0.25, 2.2, burstAge);
      float perParticleDelay = smoothstep(s_i * 0.35, s_i * 0.35 + 0.65, returnFactor);
      vec3 springForce = (aHome - aPos) * (uSpring * (0.15 + 1.25 * perParticleDelay));
      f += springForce;
    }
  } else if (uMode > 6.5 && uMode < 7.5) {
    // Mode 7: Semantic Memory Dissolve
    // Disassembles background -> hair -> clothes -> skin -> identity features last
    float eff = clamp(uEffectT, 0.0, 1.0);
    float activeT = smoothstep(regDelay, min(1.0, regDelay + 0.45), eff);
    vec3 driftDir = vec3(sin(s_i * 20.0 + uTime * 0.5), cos(s_i * 15.0 + uTime * 0.4) - 0.5, sin(s_i * 10.0) * 0.5);
    vec3 targetPos = mix(aHome, aHome + driftDir * 1.8, activeT);
    f += (targetPos - aPos) * uSpring;
  } else {
    // Standard harmonic spring with progressive emergence & arrival swirl
    float k = smoothstep(s_i * 0.45, s_i * 0.45 + 0.55, uAssemble);
    
    // Arrival swirl: subtle curvature around Y axis during assembly
    float swirlAngle = (1.0 - uAssemble) * 0.6 * (1.0 - s_i);
    float cosA = cos(swirlAngle);
    float sinA = sin(swirlAngle);
    vec3 swirledHome = vec3(
      aHome.x * cosA - aHome.z * sinA,
      aHome.y,
      aHome.x * sinA + aHome.z * cosA
    );

    f += (swirledHome - aPos) * (uSpring * (0.65 + 0.70 * k));
  }

  // P4.3 3D Distance Unprojected Multi-Touch & Depth Dents
  for (int i = 0; i < 5; i++) {
    if (uTouch[i].w < 0.01) continue;
    vec3 touchPos3D = uTouch[i].xyz;
    vec3 d3 = aPos - touchPos3D;
    float rz = max(uTouch[i].z, 0.0001);
    float distSq = dot(d3, d3);
    float g = exp(-distSq / (rz * rz * 1.5));
    vec3 nrm = d3 * inversesqrt(distSq + 1e-6);
    
    // Radial displacement + velocity + negative Z depth press
    f += nrm * (g * uTouch[i].w * 3.5);
    f.xy += uTouchVel[i] * g * 2.5;
    f.z -= g * uTouch[i].w * 1.5; // Press dent into surface depth
  }

  // Base ambient 3D organic turbulence
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
      float particlePhase = sin(r * 12.0 - uTime * 6.0 + s_i * 6.28) * 0.35;
      f.xy += (tangent * 4.2 + radial * (1.2 + particlePhase)) * uEffectAmp * falloff;
      f.z += sin(r * 8.0 + s_i * 10.0) * uEffectAmp * 0.5 * falloff;
    }
  }
  // Mode 2: Traveling Harmonic Wave
  else if (uMode > 1.5 && uMode < 2.5) {
    float waveFront = uEffectOrigin.x;
    float distToFront = aPos.x - waveFront;
    float envelope = exp(-pow(distToFront * 3.2, 2.0));
    float phase = distToFront * 14.0 - uTime * 8.0 + s_i * 4.0;
    f.z += sin(phase) * (uEffectAmp * 2.6) * envelope;
    f.y += cos(phase * 0.7) * (uEffectAmp * 1.2) * envelope;
    f.x += sin(phase * 0.5) * (uEffectAmp * 0.8) * envelope;
  }
  // Mode 3: Resonance Ripple
  else if (uMode > 2.5 && uMode < 3.5) {
    vec2 delta = aPos.xy - uEffectOrigin;
    float r = length(delta);
    float ringRadius = uEffectT * 1.4;
    float dr = r - ringRadius;
    float envelope = exp(-pow(dr * 12.0, 2.0)) * exp(-uEffectT * 1.2);
    float rippleZ = sin(dr * 34.0 - uEffectT * 18.0);
    vec2 radialDir = r > 1e-4 ? delta / r : vec2(0.0, 1.0);
    f.z += rippleZ * uEffectAmp * 3.2 * envelope;
    f.xy += radialDir * (envelope * uEffectAmp * 1.8);
  }
  // Mode 4: Atmospheric Wind
  else if (uMode > 3.5 && uMode < 4.5) {
    float windSpeed = 3.5 * uEffectAmp;
    vec3 windDir = normalize(vec3(1.0, 0.2, 0.15));
    float turbVal = sin(aPos.y * 4.0 + uTime * 3.0 + s_i * 6.28) * 0.6;
    f += (windDir * windSpeed + vec3(0.0, turbVal, 0.0)) * (0.4 + 0.6 * s_i);
  }
  // Mode 6: Radial Explosion / Burst
  else if (uMode > 5.5 && uMode < 6.5) {
    if (uEffectT < 1.0) {
      float charge = clamp(uEffectT, 0.0, 1.0);
      float vibrateAmp = pow(charge, 1.6) * uEffectAmp * 15.0;
      vec3 vibration = vec3(
        sin(uTime * 68.0 + s_i * 37.0),
        cos(uTime * 60.0 + s_i * 29.0),
        sin(uTime * 76.0 + s_i * 43.0)
      ) * vibrateAmp;
      f += vibration;
    } else {
      float burstAge = uEffectT - 1.0;
      vec3 d = aPos - vec3(uEffectOrigin, 0.0);
      float dist = length(d);
      float theta = s_i * 6.2831853;
      float phi = (fract(s_i * 137.5) - 0.5) * 3.14159;
      vec3 randomSphereDir = vec3(cos(theta) * cos(phi), sin(phi), sin(theta) * cos(phi));
      vec3 dir = dist > 1e-3 ? normalize(d) : randomSphereDir;
      float blastPower = exp(-burstAge * 2.2) * uEffectAmp * 34.0;
      vec3 fluidSwirl = fastTurbulence(aPos * 2.0, uTime * 2.6 + s_i * 22.0) * (blastPower * 0.4);
      f += (dir * blastPower + fluidSwirl);
    }
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
layout(location = 5) in float aSize;
layout(location = 6) in vec2 aNormal;

uniform mat4 uViewProj;
uniform mat4 uView;
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
uniform float uSizeVariation;

// Depth of Field
uniform float uFocusZ;
uniform float uAperture;
uniform float uMaxBokeh;

// Normal Relighting
uniform float uRelight;
uniform vec3 uLightDir;

out float vBright;
out vec3 vColor;

void main() {
  vec3 p = aPos;
  int sem = clamp(int(aSemantic), 0, 4);

  // Subtle natural micro-breathing
  p.z += sin(uTime * 1.57 + aSeed * 6.28318) * uBreath;

  gl_Position = uViewProj * vec4(p, 1.0);

  // Depth attenuation and camera distance scale
  float depthScale = 0.75 + 0.25 * (1.0 - clamp(p.z * 0.85 + 0.35, 0.0, 1.0));
  float distScale = clamp(uDistScale, 0.52, 1.55);
  
  // Clean point size calculation with subtle size variation
  float radScale = mix(1.0, 0.75 + 0.5 * aSize, uSizeVariation);
  float size = uSize * uDpr * depthScale * distScale * radScale;
  gl_PointSize = clamp(size, uPointRange.x, uPointRange.y);

  float tone = aTone;
  float rad = clamp(uRadiance, 0.5, 2.5);

  // 100% faithful true original photo color reproduction
  // Linear channel scaling preserves exact hue angle and saturation
  vec3 exactColor = clamp(aColor * rad, 0.0, 1.0);

  vec3 col;
  float b = 0.95;

  // 0.0 = Mono, 1.0 = Color, 2.0 = Hybrid
  if (uColorMode > 0.5 && uColorMode < 1.5) {
    col = exactColor;
    b = 0.95;
  } else if (uColorMode < 0.5) {
    // Monochrome Mode: Clean silver on dark
    if (uInvert < 0.5) {
      col = vec3(1.0);
      b = clamp((0.40 + 0.60 * tone) * rad * (0.85 + 0.15 * depthScale), 0.08, 1.0);
    } else {
      col = vec3(0.04, 0.04, 0.05);
      b = clamp((0.75 + 0.25 * tone) * rad * (0.85 + 0.15 * depthScale), 0.1, 1.0);
    }
  } else {
    // Hybrid Mode: Subtle blend between exact photo and silver
    float isCol = step(aSeed, clamp(uColorMix, 0.05, 0.95));
    if (uInvert < 0.5) {
      col = mix(vec3(1.0), exactColor, isCol);
      float monoB = (0.40 + 0.60 * tone) * rad;
      b = clamp(mix(monoB, 0.95, isCol), 0.08, 1.0);
    } else {
      vec3 inkBlack = vec3(0.04, 0.04, 0.05);
      col = mix(inkBlack, exactColor, isCol);
      float monoB = (0.75 + 0.25 * tone) * rad;
      b = clamp(mix(monoB, 0.95, isCol), 0.1, 1.0);
    }
  }

  // Eye catch-light shimmer on identity region (sem == 4)
  if (sem == 4) {
    b *= 0.94 + 0.08 * sin(uTime * 3.1 + aSeed * 6.28);
  }

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

  // Crisp, radiant Gaussian stipple falloff in premultiplied alpha
  float a = clamp(exp(-r2 * 2.8) * vBright, 0.0, 1.0);
  fragColor = vec4(vColor * a, a);
}
`;
