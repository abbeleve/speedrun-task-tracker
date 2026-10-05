// The intro's 3D shot (see intro.ts for the script). It is loaded on demand —
// three.js is a large library, and nothing else in the app needs it — and
// drawn into a canvas of its own, frame by frame, from the intro's clock.
//
// It keeps to one colour and white: a stopwatch of pale, matte solids builds
// itself while the camera swings round it, and the palette's hue is only the
// bead that draws the bezel, the hand, and the lap it fills in. A slow drift
// of pale blocks and dust, fading into the night, gives the move its depth.
//
// It has to start at once, on every reload, and a shader program costs
// ~0.1 s to compile on some drivers, so the shot is drawn with four of them
// and no post-processing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  TICK_COUNT,
  WATCH_RADIUS,
  cameraPose,
  cameraPosition,
  clamp01,
  easeOutBack,
  easeOutCubic,
  floatingBlocks,
  holeRadiusPx,
  introBackground,
  introFrame,
  restDistance,
  seededRandom,
  tickProgress,
} from './intro';
import type { IntroFrame } from './intro';

const FOV = 55;
const TAU = Math.PI * 2;

// The lamp, fixed in the world — high on the right, in front — so the light
// turns across the watch as the camera swings round it.
const LIGHT = new THREE.Vector3(0.55, 0.75, 0.6).normalize();

export interface IntroSceneOptions {
  width: number; // CSS pixels
  height: number;
  pixelRatio: number;
  base: string; // the palette's colour, '#rrggbb' — the one colour in the shot
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

// The solids — the watch's parts and the drifting blocks: their tone, lit by
// the lamp and a soft sky, with a small highlight and a faint rim, fading
// into the night with distance. A sweep cuts a part off past an angle,
// clockwise from twelve in its own plane, which is how the bezel is drawn.
const SOLID_VERTEX = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vLocal;
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
    vLocal = position.xy;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
  }
`;

const SOLID_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLight; // view space
  uniform vec3 uFog;
  uniform vec2 uFogRange;
  uniform float uSweep;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec2 vLocal;
  const float TAU = 6.28318530718;
  void main() {
    float a = atan(vLocal.x, vLocal.y);
    if (a < 0.0) a += TAU;
    if (a > uSweep * TAU) discard;
    // The inside of a part cut open by the sweep is lit as a surface too.
    vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 v = normalize(vView);
    vec3 albedo = uColor * vColor;
    float diffuse = max(dot(n, uLight), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    float spec = pow(max(dot(n, normalize(uLight + v)), 0.0), 56.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 c = albedo * (0.14 + 0.12 * sky + 0.74 * diffuse + 0.3 * rim) + spec * 0.35;
    float fog = smoothstep(uFogRange.x, uFogRange.y, length(vView));
    gl_FragColor = vec4(mix(c, uFog, fog), 1.0);
    #include <colorspace_fragment>
  }
`;

// The flat parts — the glass, the lap's fill and the go's ring: one colour,
// swept round from twelve like the bezel, and with a tail, fading back from
// the head of the sweep, for the lap.
const FLAT_VERTEX = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLAT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uSweep;
  uniform float uTail;
  varying vec2 vLocal;
  const float TAU = 6.28318530718;
  void main() {
    float a = atan(vLocal.x, vLocal.y);
    if (a < 0.0) a += TAU;
    float end = uSweep * TAU;
    if (a > end) discard;
    float k = mix(1.0, 0.18 + 0.82 * a / max(end, 0.0001), uTail);
    gl_FragColor = vec4(uColor, uOpacity * k);
    #include <colorspace_fragment>
  }
`;

// The dust: soft pale motes drifting on their own, smaller and fainter with
// distance.
const DUST_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  uniform float uMaxSize;
  uniform vec2 uFogRange;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.xy += 0.25 * vec2(sin(uTime * 0.5 + aSeed * 40.0), cos(uTime * 0.4 + aSeed * 23.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    gl_PointSize = clamp(0.035 * uScale / depth, 1.0, uMaxSize);
    vAlpha = 0.5 * (1.0 - smoothstep(uFogRange.x, uFogRange.y, depth)) * smoothstep(0.4, 2.5, depth);
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(uColor, smoothstep(0.5, 0.1, d) * vAlpha);
    #include <colorspace_fragment>
  }
`;

type Uniform<T> = { value: T };

export function createIntroScene(options: IntroSceneOptions): IntroScene {
  let { width, height } = options;
  const pixelRatio = Math.min(options.pixelRatio, 2);
  const small = Math.min(width, height) < 600;
  const random = seededRandom(0x5eed);
  const R = WATCH_RADIUS;

  const white = new THREE.Color('#ffffff');
  const sky = new THREE.Color(introBackground(options.base));
  // What the watch and the blocks are made of: white, cooled a touch towards
  // the palette.
  const pale = new THREE.Color('#e6e9ee').lerp(new THREE.Color(options.base), 0.05);
  const dim = pale.clone().multiplyScalar(0.5);
  // The palette's hue, lifted a little so it reads on a night of its own hue.
  const hue = new THREE.Color(options.base).lerp(white, 0.1);
  const glassColor = sky.clone().lerp(pale, 0.01);

  const canvas = document.createElement('canvas');
  canvas.className = 'intro-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  // No tone mapping: the colours are kept in range by hand, so the fog fades
  // into exactly the clear colour — which is exactly the overlay's.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(sky, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.05, 200);
  let rest = restDistance(width / height, FOV);

  // The lamp, turned into the camera's view every frame, and the fog, which
  // begins a little behind the resting watch.
  const lightView = new THREE.Vector3();
  const fogRange = new THREE.Vector2();
  const placeFog = () => fogRange.set(rest + 3, rest + 26);
  placeFog();

  const solid = (color: THREE.Color, sweep: Uniform<number> = { value: 1 }, side: THREE.Side = THREE.FrontSide) =>
    new THREE.ShaderMaterial({
      vertexShader: SOLID_VERTEX,
      fragmentShader: SOLID_FRAGMENT,
      uniforms: {
        uColor: { value: color },
        uLight: { value: lightView },
        uFog: { value: sky },
        uFogRange: { value: fogRange },
        uSweep: sweep,
      },
      side,
    });

  const flat = (color: THREE.Color, opacity: number, sweep: Uniform<number> = { value: 1 }, transparent = true) =>
    new THREE.ShaderMaterial({
      vertexShader: FLAT_VERTEX,
      fragmentShader: FLAT_FRAGMENT,
      uniforms: { uColor: { value: color }, uOpacity: { value: opacity }, uSweep: sweep, uTail: { value: 0 } },
      transparent,
      depthWrite: !transparent,
      side: THREE.DoubleSide,
    });

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  // ── the stopwatch ────────────────────────────────────────────────────
  const watch = new THREE.Group();
  scene.add(watch);

  // The bezel, drawn round from twelve by a bead of the palette's colour,
  // with the glass wiped in behind it; a pale cap rounds off the end it
  // started from until the ring closes.
  const TUBE = 0.15;
  const sweep = { value: 0 };
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(R, TUBE, 24, 180), solid(pale, sweep, THREE.DoubleSide));
  const bead = new THREE.Mesh(new THREE.SphereGeometry(TUBE * 1.3, 24, 16), solid(hue));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(TUBE, 24, 16), solid(pale));
  cap.position.set(0, R, 0);
  // The glass is the one opaque flat part, so whatever drifts behind the
  // watch stays behind it.
  const glass = new THREE.Mesh(new THREE.CircleGeometry(R - TUBE * 0.5, 128), flat(glassColor, 1, sweep, false));
  glass.position.z = -0.02;
  watch.add(bezel, bead, cap, glass);

  // Sixty ticks; every fifth is a long one.
  const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), solid(white), TICK_COUNT);
  ticks.frustumCulled = false;
  watch.add(ticks);

  // The lap's fill: a band of the palette's colour behind the ticks.
  const lapSweep = { value: 0 };
  const bandMaterial = flat(hue, 0.7, lapSweep);
  const band = new THREE.Mesh(new THREE.RingGeometry(0.79 * R, 0.935 * R, 180, 1), bandMaterial);
  band.position.z = 0.01;
  watch.add(band);

  // The crown on its stem, and a pusher either side of it at ten and two.
  // They drop in together; only the crown clicks.
  const top = new THREE.Group();
  const crown = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 20), solid(pale));
  stem.position.y = R + 0.3;
  const button = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.4, 6, 20), solid(pale));
  button.rotation.z = Math.PI / 2;
  button.position.y = R + 0.6;
  crown.add(stem, button);
  top.add(crown);
  for (const side of [-1, 1]) {
    const a = side * 0.72;
    const pusher = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.16, 4, 16), solid(pale));
    pusher.position.set(Math.sin(a) * (R + 0.26), Math.cos(a) * (R + 0.26), 0);
    pusher.rotation.z = -a;
    top.add(pusher);
  }
  watch.add(top);

  // The hub, and the hand: a needle pointing at twelve, tapering to its tip,
  // with a short tail below the hub.
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 32), solid(pale));
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.16;
  const handGeometry = new THREE.BoxGeometry(0.095, 0.9 * R, 0.05, 1, 6, 1);
  handGeometry.translate(0, 0.29 * R, 0);
  const handPositions = handGeometry.attributes.position;
  for (let i = 0; i < handPositions.count; i++) {
    const along = clamp01(handPositions.getY(i) / (0.74 * R));
    handPositions.setX(i, handPositions.getX(i) * (1 - 0.6 * along));
  }
  handGeometry.computeVertexNormals();
  const hand = new THREE.Mesh(handGeometry, solid(hue));
  hand.position.z = 0.1;
  watch.add(hub, hand);

  // The go's ring, running out from the bezel.
  const pulseMaterial = flat(hue, 0);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 180, 1), pulseMaterial);
  watch.add(pulse);

  // ── the drift round it ───────────────────────────────────────────────
  const field = new THREE.Group();
  scene.add(field);
  const blocks = floatingBlocks(small ? 12 : 16, random);
  const blockMesh = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 0.3, 0.62, 2, 0.08), solid(white), blocks.length);
  blockMesh.frustumCulled = false;
  blocks.forEach((b, i) => blockMesh.setColorAt(i, tint.copy(pale).multiplyScalar(b.shade)));
  field.add(blockMesh);

  const dustCount = small ? 160 : 260;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustSeeds = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPositions.set([(random() - 0.5) * 36, (random() - 0.5) * 28, -16 + random() * 26], i * 3);
    dustSeeds[i] = random();
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(dustSeeds, 1));
  const pointScale = () => (height * pixelRatio) / (2 * Math.tan((FOV * Math.PI) / 360));
  const dustUniforms = {
    uTime: { value: 0 },
    uScale: { value: pointScale() },
    uMaxSize: { value: 3 * pixelRatio },
    uFogRange: { value: fogRange },
    uColor: { value: pale },
  };
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.ShaderMaterial({
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: dustUniforms,
      transparent: true,
      depthWrite: false,
    })
  );
  dust.frustumCulled = false;
  scene.add(dust);

  const resize = (w: number, h: number) => {
    width = w;
    height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    rest = restDistance(w / h, FOV);
    placeFog();
    renderer.setSize(w, h, false);
    dustUniforms.uScale.value = pointScale();
  };

  const watchRadius = () =>
    (WATCH_RADIUS / rest / Math.tan((FOV * Math.PI) / 360)) * (height / 2);

  const draw = (t: number, render = true): IntroSceneFrame => {
    const f = introFrame(t);

    // The camera swings round from its opening angle, rolling level as it
    // comes, and settles square on before the dive.
    const pose = cameraPose(f, rest);
    camera.position.set(...cameraPosition(pose));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, pose.lookY, 0);
    camera.rotateZ(pose.roll);
    camera.updateMatrixWorld();
    lightView.copy(LIGHT).transformDirection(camera.matrixWorldInverse);

    // The bezel and the glass, as far round as the bead has drawn them. The
    // bead shrinks away as the ring closes.
    sweep.value = f.bezel;
    bezel.visible = glass.visible = f.bezel > 0;
    bead.visible = f.bezel > 0 && f.bezel < 1;
    cap.visible = bead.visible;
    const head = f.bezel * TAU;
    bead.position.set(Math.sin(head) * R, Math.cos(head) * R, 0);
    bead.scale.setScalar(Math.max(1e-4, Math.min(1, (1 - f.bezel) * 8)));

    // The ticks pop up round the dial and drop onto it; then the hand lights
    // each one it passes, brightest just behind it.
    const lapAngle = f.lap * TAU;
    for (let i = 0; i < TICK_COUNT; i++) {
      const p = tickProgress(f.ticks, i);
      const a = (i / TICK_COUNT) * TAU;
      const long = i % 5 === 0;
      const behind = lapAngle - a;
      const lit = f.lap > 0 && behind >= 0;
      const flare = lit ? Math.exp(-behind * 5) : 0;
      const r = (long ? 0.86 : 0.895) * R;
      const length = (long ? 0.36 : 0.15) * easeOutBack(p) * (1 + flare * 0.4);
      dummy.position.set(Math.sin(a) * r, Math.cos(a) * r, 0.05 + (1 - easeOutCubic(p)) * 0.8);
      dummy.rotation.set(0, 0, -a);
      dummy.scale.set((long ? 0.08 : 0.04) * Math.min(1, p * 3) + 1e-4, length + 1e-4, long ? 0.06 : 0.04);
      dummy.updateMatrix();
      ticks.setMatrixAt(i, dummy.matrix);
      if (lit) tint.copy(white).multiplyScalar(1 + flare);
      else tint.copy(long ? pale : dim);
      ticks.setColorAt(i, tint);
    }
    ticks.instanceMatrix.needsUpdate = true;
    if (ticks.instanceColor) ticks.instanceColor.needsUpdate = true;

    // The crown falls in from above the frame and bounces to rest, then
    // clicks down to start the lap, and again to stop it.
    top.visible = f.crown > 0;
    top.position.y = (1 - easeOutBack(f.crown)) * 3.2;
    crown.position.y = -0.14 * f.press;

    const grow = Math.max(easeOutBack(f.hand), 1e-4);
    hub.visible = hand.visible = f.hand > 0;
    hub.scale.setScalar(grow);
    hand.scale.set(1, grow, 1);
    // Clockwise is a negative turn about +z.
    hand.rotation.z = -lapAngle;

    // The fill trails the hand like a comet's tail, and at the go it lights
    // all the way round.
    lapSweep.value = f.lap;
    band.visible = f.lap > 0;
    bandMaterial.uniforms.uTail.value = 1 - clamp01(f.pulse * 5);

    pulse.visible = f.pulse > 0 && f.pulse < 1;
    pulse.scale.setScalar(R * (1 + easeOutCubic(f.pulse) * 2.6));
    pulseMaterial.uniforms.uOpacity.value = 0.9 * (1 - f.pulse) ** 2;

    // The blocks bob and turn, and the whole drift wheels slowly round.
    blocks.forEach((b, i) => {
      dummy.position.set(b.x, b.y + Math.sin(t * 0.7 + b.tilt[0]) * 0.15, b.z);
      dummy.rotation.set(b.tilt[0] + t * b.spin, b.tilt[1] + t * b.spin * 0.6, b.tilt[2]);
      dummy.scale.set(b.length, 1, 1);
      dummy.updateMatrix();
      blockMesh.setMatrixAt(i, dummy.matrix);
    });
    blockMesh.instanceMatrix.needsUpdate = true;
    field.rotation.z = t * 0.05;
    dustUniforms.uTime.value = t;

    if (render) renderer.render(scene, camera);
    return {
      ...f,
      holeRadius: holeRadiusPx(f, pose.distance, height, FOV),
      flash: f.pulse > 0 ? 0.5 * (1 - f.pulse) ** 3 : 0,
    };
  };

  // Every program the shot needs, compiled off the main thread where the
  // browser can (KHR_parallel_shader_compile), then drawn once with
  // everything showing — most of the watch is hidden at the start, and a
  // program's first use would otherwise stall the frame it appears in.
  const warmUp = async () => {
    draw(0, false);
    scene.traverse((obj) => {
      obj.visible = true;
    });
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
    ticks.dispose();
    blockMesh.dispose();
    renderer.dispose();
    // The canvas leaves with the overlay; give its context back now rather
    // than whenever the collector gets to it.
    renderer.forceContextLoss();
  };

  return { canvas, watchRadius, warmUp, draw, resize, dispose };
}
