// The intro's 3D shot (see intro.ts for the script). It is loaded on demand —
// three.js is a large library, and nothing else in the app needs it — and
// drawn into a canvas of its own, frame by frame, from the intro's clock.
//
// It has to start at once, on every reload, and a shader program costs
// ~0.1 s to compile on some drivers, so the shot is drawn with six of them
// and no post-processing: the glow is painted in (a halo under the watch's
// particles, soft shockwaves, the overlay's flash) rather than bloomed.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  FLIGHT_LENGTH,
  HELIX_RADIUS,
  PART_INDEX,
  WATCH_RADIUS,
  FACE_RADIUS,
  cameraDistance,
  helixBlocks,
  holeRadiusPx,
  introBackground,
  introFrame,
  restDistance,
  seededRandom,
  watchPoints,
} from './intro';
import type { IntroFrame } from './intro';
import { TASK_COLORS } from './types';

const FOV = 55;

// How long the star field runs ahead of the camera, and how far streaks
// stretch at full warp.
const FIELD_LENGTH = 160;
const STREAK_LENGTH = 16;

export interface IntroSceneOptions {
  width: number; // CSS pixels
  height: number;
  pixelRatio: number;
  base: string; // the palette's colours, '#rrggbb'
  accent: string;
}

export interface IntroSceneFrame extends IntroFrame {
  // The opening in the dial, in CSS pixels from the middle of the screen.
  holeRadius: number;
  // 0 → 1: the go's flash, for the overlay to paint over the canvas.
  flash: number;
}

export interface IntroScene {
  canvas: HTMLCanvasElement;
  // The watch's radius on screen while it rests, CSS pixels — the caption
  // sits under it.
  watchRadius: () => number;
  // Shader programs compiled ahead, so the first frames do not stall.
  warmUp: () => Promise<void>;
  // Moves everything to time t and, unless told not to, renders the frame.
  draw: (t: number, render?: boolean) => IntroSceneFrame;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

const STREAK_VERTEX = /* glsl */ `
  attribute float aTail;
  attribute vec3 aColor;
  uniform float uCamZ;
  uniform float uStretch;
  uniform float uLength;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    // The field wraps round the camera, so it never runs out.
    float rel = mod(p.z - uCamZ, uLength) - uLength;
    p.z = uCamZ + rel - aTail * uStretch;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = -rel / uLength;
    vAlpha = (1.0 - aTail) * smoothstep(1.0, 0.55, depth) * smoothstep(0.0, 0.03, depth);
    vColor = aColor;
  }
`;

const STREAK_FRAGMENT = /* glsl */ `
  uniform float uGain;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor * uGain, vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STAR_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  uniform float uCamZ;
  uniform float uLength;
  uniform float uSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float rel = mod(p.z - uCamZ, uLength) - uLength;
    p.z = uCamZ + rel;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize;
    float depth = -rel / uLength;
    vAlpha = smoothstep(1.0, 0.5, depth) * smoothstep(0.0, 0.05, depth);
    vColor = aColor;
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The task blocks: their own colour, lit by a lamp over the camera's
// shoulder, with a glossy highlight and a rim of light round the edges — the
// look of a studio-lit material, at a fraction of its compile time.
const BLOCK_VERTEX = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 mv = modelViewMatrix * local;
    gl_Position = projectionMatrix * mv;
    vNormal = normalize(normalMatrix * n);
    vView = -mv.xyz;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
  }
`;

const BLOCK_FRAGMENT = /* glsl */ `
  uniform vec3 uLight; // view space
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float diffuse = max(dot(n, uLight), 0.0);
    float spec = pow(max(dot(n, normalize(uLight + v)), 0.0), 40.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
    vec3 c = vColor * (0.3 + 0.7 * diffuse) + spec * 0.8 + vColor * rim * 1.1;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The watch's particles. Each one flies from its place among the stars to its
// place on the watch on a slice of the gathering clock of its own, swirling
// round the axis as it comes; the hand turns with the lap, the dial fills
// behind the hand, and at the go the hub and the hand fly apart.
const WATCH_VERTEX = /* glsl */ `
  attribute vec3 aStart;
  attribute vec4 aInfo; // delay, size, part, random
  attribute float aAngle;
  uniform float uTime;
  uniform float uMorph;
  uniform float uLap;
  uniform float uBurst;
  uniform float uScale;
  uniform float uMaxSize;
  // 1 for the particles themselves; the halo under them draws each one
  // larger and fainter.
  uniform float uSizeK;
  uniform float uAlphaK;
  uniform vec3 uStar;
  uniform vec3 uBezel;
  uniform vec3 uBack;
  uniform vec3 uTick;
  uniform vec3 uTrim;
  uniform vec3 uHub;
  uniform vec3 uHand;
  uniform vec3 uFill;
  varying vec3 vColor;
  varying float vAlpha;

  const float TAU = 6.28318530718;

  vec2 rotate(vec2 v, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
  }

  void main() {
    float part = aInfo.z;
    float seed = aInfo.w;
    float spread = 0.5;
    float p = clamp((uMorph - aInfo.x * spread) / (1.0 - spread), 0.0, 1.0);
    float e = 1.0 - pow(1.0 - p, 3.0);

    vec3 target = position;
    bool hand = part > 5.5;
    bool core = part > 4.5; // the hub and the hand
    // Clockwise is a negative turn about +z.
    if (hand) target.xy = rotate(target.xy, -uLap * TAU);

    vec3 pos = mix(aStart, target, e);
    pos.xy = rotate(pos.xy, (1.0 - e) * (2.2 + seed * 2.4));
    // Once landed, a faint shimmer keeps the watch alive.
    pos += e * 0.015 * vec3(sin(uTime * 3.1 + seed * 40.0), cos(uTime * 2.7 + seed * 31.0), 0.0);

    // The go: the core flies apart towards the camera, scattering every way
    // (the hand would otherwise leave as one beam), and the rest shrugs.
    vec2 out2 = normalize(target.xy + vec2(0.0001, 0.0002));
    if (core) out2 = rotate(out2, (seed - 0.5) * 5.0);
    float kick = core ? 3.5 + seed * 6.0 : 0.25 * seed;
    pos.xy += out2 * uBurst * kick;
    pos.z += core ? uBurst * (2.0 + seed * 5.0) : 0.0;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uMaxSize, uSizeK * aInfo.y * uScale / -mv.z);

    vec3 c = uBezel;
    if (part > 0.5) c = uBack;
    if (part > 1.5) c = uTick;
    if (part > 2.5) c = uTrim;
    if (part > 4.5) c = uHub;
    if (hand) c = uHand;
    // The lap fills the bezel and the ticks it has passed.
    bool fillable = part < 0.5 || (part > 1.5 && part < 2.5);
    if (fillable && aAngle < uLap * TAU) c = mix(c, uFill, 0.85);
    // A head on the needle.
    if (hand && position.y > ${(WATCH_RADIUS * 0.6).toFixed(3)}) c *= 1.6;

    vColor = mix(uStar, c, e);
    float near = smoothstep(0.25, 1.6, -mv.z);
    vAlpha = uAlphaK * mix(0.3, 1.0, e) * near * (core ? 1.0 - uBurst : 1.0);
  }
`;

const WATCH_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, a * a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createIntroScene(options: IntroSceneOptions): IntroScene {
  let { width, height } = options;
  const pixelRatio = Math.min(options.pixelRatio, 2);
  const small = Math.min(width, height) < 600;
  const random = seededRandom(0x5eed);

  const base = new THREE.Color(options.base);
  const accent = new THREE.Color(options.accent);
  const white = new THREE.Color('#ffffff');
  const light = base.clone().lerp(white, 0.45);

  const canvas = document.createElement('canvas');
  canvas.className = 'intro-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  // Neutral keeps the palette's hues and only rolls off the brightest
  // overlaps; the sky is the clear colour, so it is exactly the overlay's.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(introBackground(options.base), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 400);
  let rest = restDistance(width / height, FOV);

  // ── the star field: streaks at warp, points at rest ──────────────────
  const starCount = small ? 900 : 1600;
  const heads = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < starCount; i++) {
    const a = random() * Math.PI * 2;
    const r = 3 + Math.sqrt(random()) * 34;
    heads.set([Math.sin(a) * r, Math.cos(a) * r, random() * FIELD_LENGTH], i * 3);
    const pick = random();
    tint.copy(pick < 0.55 ? white : pick < 0.85 ? light : accent).multiplyScalar(0.6 + random() * 0.8);
    starColors.set([tint.r, tint.g, tint.b], i * 3);
  }

  const streakPositions = new Float32Array(starCount * 6);
  const streakColors = new Float32Array(starCount * 6);
  const streakTail = new Float32Array(starCount * 2);
  for (let i = 0; i < starCount; i++) {
    streakPositions.set(heads.subarray(i * 3, i * 3 + 3), i * 6);
    streakPositions.set(heads.subarray(i * 3, i * 3 + 3), i * 6 + 3);
    streakColors.set(starColors.subarray(i * 3, i * 3 + 3), i * 6);
    streakColors.set(starColors.subarray(i * 3, i * 3 + 3), i * 6 + 3);
    streakTail[i * 2 + 1] = 1;
  }
  const streakGeometry = new THREE.BufferGeometry();
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  streakGeometry.setAttribute('aColor', new THREE.BufferAttribute(streakColors, 3));
  streakGeometry.setAttribute('aTail', new THREE.BufferAttribute(streakTail, 1));
  const streakUniforms = {
    uCamZ: { value: 0 },
    uStretch: { value: 0 },
    uLength: { value: FIELD_LENGTH },
    uGain: { value: 1.6 },
  };
  const streaks = new THREE.LineSegments(
    streakGeometry,
    new THREE.ShaderMaterial({
      vertexShader: STREAK_VERTEX,
      fragmentShader: STREAK_FRAGMENT,
      uniforms: streakUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  streaks.frustumCulled = false;
  scene.add(streaks);

  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(heads, 3));
  starGeometry.setAttribute('aColor', new THREE.BufferAttribute(starColors, 3));
  const starUniforms = {
    uCamZ: streakUniforms.uCamZ,
    uLength: { value: FIELD_LENGTH },
    uSize: { value: 2.2 * pixelRatio },
  };
  const stars = new THREE.Points(
    starGeometry,
    new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: starUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  stars.frustumCulled = false;
  scene.add(stars);

  // ── the helix of task blocks ─────────────────────────────────────────
  const blockColors = [...TASK_COLORS, options.base, options.accent];
  const blocks = helixBlocks(small ? 40 : 52, 6, FLIGHT_LENGTH - 6, blockColors, random);
  const blockGeometry = new RoundedBoxGeometry(1, 0.3, 0.62, 3, 0.09);
  const blockMaterial = new THREE.ShaderMaterial({
    vertexShader: BLOCK_VERTEX,
    fragmentShader: BLOCK_FRAGMENT,
    uniforms: { uLight: { value: new THREE.Vector3(0.45, 0.6, 0.66).normalize() } },
  });
  const helix = new THREE.InstancedMesh(blockGeometry, blockMaterial, blocks.length);
  const blockColor = blocks.map((b) => new THREE.Color(b.color));
  const dummy = new THREE.Object3D();
  const placeBlocks = () => {
    blocks.forEach((b, i) => {
      dummy.position.set(Math.sin(b.angle) * HELIX_RADIUS, Math.cos(b.angle) * HELIX_RADIUS, rest + b.distance);
      dummy.rotation.set(0, 0, -b.angle);
      dummy.scale.set(b.length, 1, 1);
      dummy.updateMatrix();
      helix.setMatrixAt(i, dummy.matrix);
      helix.setColorAt(i, blockColor[i]);
    });
    helix.instanceMatrix.needsUpdate = true;
    if (helix.instanceColor) helix.instanceColor.needsUpdate = true;
  };
  placeBlocks();
  scene.add(helix);
  const lit = new THREE.Color();

  // ── the stopwatch ────────────────────────────────────────────────────
  const watch = new THREE.Group();
  scene.add(watch);

  const points = watchPoints(small ? 5200 : 9500, random);
  const n = points.length;
  const target = new Float32Array(n * 3);
  const start = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  const angle = new Float32Array(n);
  points.forEach((pt, i) => {
    target.set([pt.x, pt.y, pt.z], i * 3);
    // They start out as stars all round the watch, some behind the camera's
    // resting point, so they stream past it on their way in.
    const a = random() * Math.PI * 2;
    const r = 3 + Math.sqrt(random()) * 17;
    start.set([Math.sin(a) * r, Math.cos(a) * r, -25 + random() * 70], i * 3);
    const part = PART_INDEX[pt.part];
    const size = pt.part === 'hub' ? 0.08 : pt.part === 'back' ? 0.035 : 0.035 + random() * 0.025;
    // The bezel lands first, the hand last.
    const order = pt.part === 'hand' ? 0.55 + random() * 0.45 : random() * 0.85;
    info.set([order, size, part, random()], i * 4);
    angle[i] = pt.angle;
  });
  const watchGeometry = new THREE.BufferGeometry();
  watchGeometry.setAttribute('position', new THREE.BufferAttribute(target, 3));
  watchGeometry.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  watchGeometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  watchGeometry.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1));
  const glow = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);
  const watchUniforms = {
    uTime: { value: 0 },
    uMorph: { value: 0 },
    uLap: { value: 0 },
    uBurst: { value: 0 },
    uScale: { value: 1 },
    uMaxSize: { value: 48 * pixelRatio },
    uSizeK: { value: 1 },
    uAlphaK: { value: 1 },
    uStar: { value: glow(white, 0.55) },
    uBezel: { value: glow(light, 0.5) },
    uBack: { value: glow(base, 0.3) },
    uTick: { value: glow(light.clone().lerp(white, 0.6), 0.75) },
    uTrim: { value: glow(light, 0.6) },
    uHub: { value: glow(white, 1.6) },
    uHand: { value: glow(accent, 1.4) },
    uFill: { value: glow(accent.clone().lerp(white, 0.15), 0.8) },
  };
  const watchMaterial = (sizeK: number, alphaK: number) =>
    new THREE.ShaderMaterial({
      vertexShader: WATCH_VERTEX,
      fragmentShader: WATCH_FRAGMENT,
      // The same clock for both; only the size and the strength differ.
      uniforms: { ...watchUniforms, uSizeK: { value: sizeK }, uAlphaK: { value: alphaK } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  // Every particle over a wide, faint glow of its own.
  const halo = new THREE.Points(watchGeometry, watchMaterial(5, 0.07));
  const particles = new THREE.Points(watchGeometry, watchMaterial(1, 1));
  for (const p of [halo, particles]) {
    p.frustumCulled = false;
    watch.add(p);
  }

  // The dark glass of the face, which becomes the window onto the app.
  const faceMaterial = new THREE.MeshBasicMaterial({
    color: base.clone().lerp(new THREE.Color('#000000'), 0.97),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const face = new THREE.Mesh(new THREE.CircleGeometry(FACE_RADIUS * 1.02, 96), faceMaterial);
  face.position.z = -0.08;
  // Behind the hand and the hub, whatever the transparent sort decides.
  face.renderOrder = -1;
  watch.add(face);

  // Two shockwaves at the go, the second a beat behind the first: soft
  // bands, brightest a little inside their rim and fading out both ways.
  const shockGeometry = new THREE.RingGeometry(0.972, 1.012, 160, 2);
  const ringColor = glow(light.clone().lerp(white, 0.35), 1.5);
  const shockShade = new Float32Array(shockGeometry.attributes.position.count * 3);
  for (let i = 0; i < shockGeometry.attributes.position.count; i++) {
    const r = Math.hypot(shockGeometry.attributes.position.getX(i), shockGeometry.attributes.position.getY(i));
    const c = r > 0.98 && r < 1.005 ? ringColor : new THREE.Color(0, 0, 0);
    shockShade.set([c.r, c.g, c.b], i * 3);
  }
  shockGeometry.setAttribute('color', new THREE.BufferAttribute(shockShade, 3));
  const shocks = [0, 0.12].map((delay) => {
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(shockGeometry, material);
    ring.visible = false;
    watch.add(ring);
    return { ring, material, delay };
  });

  const pointScale = () => (height * pixelRatio) / (2 * Math.tan((FOV * Math.PI) / 360));

  const resize = (w: number, h: number) => {
    width = w;
    height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    rest = restDistance(w / h, FOV);
    placeBlocks();
    renderer.setSize(w, h, false);
    watchUniforms.uScale.value = pointScale();
  };
  watchUniforms.uScale.value = pointScale();

  const watchRadius = () =>
    (WATCH_RADIUS / rest / Math.tan((FOV * Math.PI) / 360)) * (height / 2);

  const draw = (t: number, render = true): IntroSceneFrame => {
    const f = introFrame(t);
    const distance = cameraDistance(f, rest);

    // The camera rolls as it corkscrews down the helix, and levels out as it
    // arrives.
    const roll = (1 - f.flight) * 1.4;
    camera.position.set(0, 0, distance);
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.lookAt(0, 0, 0);

    streakUniforms.uCamZ.value = distance;
    streakUniforms.uStretch.value = f.warp * STREAK_LENGTH;
    streaks.visible = f.warp > 0.01;

    // Each block flares as the camera passes it, and dims again behind it.
    blocks.forEach((b, i) => {
      const passed = distance - (rest + b.distance);
      const flare = passed < 0 && passed > -6 ? (1 + passed / 6) ** 2 : 0;
      helix.setColorAt(i, lit.copy(blockColor[i]).multiplyScalar(1 + flare * 3.5));
    });
    if (helix.instanceColor) helix.instanceColor.needsUpdate = true;
    helix.visible = f.flight < 0.995;

    // The watch turns to face the camera as it gathers, then just breathes.
    const sway = Math.sin(t * 1.4) * 0.05 * (1 - f.lap);
    watch.rotation.set(-f.tilt * 0.4, f.tilt * 0.95 + sway, 0);

    watchUniforms.uTime.value = t;
    watchUniforms.uMorph.value = f.morph;
    watchUniforms.uLap.value = f.lap;
    watchUniforms.uBurst.value = f.burst;
    // The glass settles in once the bezel round it has mostly landed.
    faceMaterial.opacity = 0.75 * Math.min(1, Math.max(0, f.morph * 2 - 0.8));

    for (const s of shocks) {
      const k = Math.max(0, Math.min(1, (f.shock * 0.7 - s.delay) / 0.7));
      s.ring.visible = k > 0 && k < 1;
      s.ring.scale.setScalar(WATCH_RADIUS * (1 + k * 3.2));
      s.material.opacity = (1 - k) ** 2.2;
    }

    if (render) renderer.render(scene, camera);
    return {
      ...f,
      holeRadius: holeRadiusPx(f, distance, height, FOV),
      flash: f.shock > 0 ? (1 - f.shock) ** 3 : 0,
    };
  };

  // Every program the shot needs, compiled off the main thread where the
  // browser can (KHR_parallel_shader_compile), then drawn once with
  // everything showing — the shockwaves are hidden until the go, and a
  // program's first use would otherwise stall that very frame.
  const warmUp = async () => {
    draw(0, false);
    for (const s of shocks) s.ring.visible = true;
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    draw(0);
  };

  const dispose = () => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    helix.dispose();
    renderer.dispose();
    // The canvas leaves with the overlay; give its context back now rather
    // than whenever the collector gets to it.
    renderer.forceContextLoss();
  };

  return { canvas, watchRadius, warmUp, draw, resize, dispose };
}
