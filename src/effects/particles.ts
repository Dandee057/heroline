import * as THREE from "three";
import type { EffectDef, Input } from "./types.ts";
import { NOISE } from "./shared.ts";

/**
 * Particle logo: a word (the brand name) made of thousands of glowing points. The word is drawn on a hidden
 * canvas and its filled pixels are sampled for target positions. Everything else happens on the GPU: the vertex
 * shader blends each point between its place in the word and a scattered cloud (scrolling down scatters it),
 * drifts it with noise, pushes it away from the pointer, and morphs between the old and new word when the text
 * changes. A click sends a shock wave through it.
 */

const vertex = /* glsl */ `
uniform float uTime, uScatter, uMorph, uSize, uPixel, uPush, uWave, uWaveTime;
uniform vec2 uMouse, uWaveAt;
attribute vec3 aFrom, aTarget, aCloud;
attribute float aSeed;
varying float vSeed;
varying float vMix;
${NOISE}
void main() {
  vec3 home = mix(aFrom, aTarget, smoothstep(0.0, 1.0, clamp(uMorph * 1.6 - aSeed * 0.6, 0.0, 1.0)));
  float s = smoothstep(0.0, 1.0, clamp(uScatter * 1.4 - aSeed * 0.4, 0.0, 1.0));
  vec3 p = mix(home, aCloud, s);
  // a little life even when settled
  float t = uTime * 0.25;
  p += vec3(snoise(vec3(p.xy * 1.6, t + aSeed * 9.0)), snoise(vec3(p.yx * 1.6, t + 3.1 + aSeed * 7.0)), 0.0) * (0.012 + s * 0.12);
  // push away from the pointer
  vec2 d = p.xy - uMouse;
  float r = length(d);
  p.xy += normalize(d + 1e-5) * uPush * 0.22 * exp(-r * r * 22.0);
  // the shock wave from a click: a ring expanding from where it happened
  float age = uTime - uWaveTime;
  float ring = exp(-pow((length(p.xy - uWaveAt) - age * 1.6) * 9.0, 2.0)) * exp(-age * 1.8) * uWave;
  p.xy += normalize(p.xy - uWaveAt + 1e-5) * ring * 0.12;
  p.z += ring * 0.3;

  vSeed = aSeed;
  vMix = clamp((p.x + 1.5) / 3.0, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixel * (0.55 + aSeed * 0.9) * (1.0 + ring * 1.5);
}
`;

const fragment = /* glsl */ `
uniform vec3 uA, uB;
uniform float uTime;
varying float vSeed;
varying float vMix;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d);
  float twinkle = 0.7 + 0.3 * sin(uTime * (1.5 + vSeed * 3.0) + vSeed * 40.0);
  vec3 col = mix(uA, uB, vMix);
  gl_FragColor = vec4(col * twinkle, a);
  #include <colorspace_fragment>
}
`;

/** Filled pixels of `text` drawn big on a canvas, as points in a box `w` × `h` centred on 0. */
function sampleText(text: string, count: number, w: number, h: number): Float32Array {
  const c = document.createElement("canvas"), W = 1400, H = 500;
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  let size = 340;
  const font = (s: number) => `800 ${s}px Inter, "Helvetica Neue", Arial, sans-serif`;
  g.font = font(size);
  while (g.measureText(text).width > W * 0.94 && size > 40) g.font = font((size -= 10));
  g.fillText(text || " ", W / 2, H / 2 + size * 0.04);
  const data = g.getImageData(0, 0, W, H).data, filled: number[] = [];
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (data[(y * W + x) * 4 + 3] > 128) { filled.push(x, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  const out = new Float32Array(count * 3);
  if (!filled.length) return out;
  // fit the word's bounding box into w × h
  const s = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (let i = 0; i < count; i++) {
    const k = Math.floor(Math.random() * (filled.length / 2)) * 2;
    out[i * 3] = (filled[k] - cx + Math.random() * 2) * s;
    out[i * 3 + 1] = -(filled[k + 1] - cy + Math.random() * 2) * s;
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
  }
  return out;
}

export const particles: EffectDef = {
  id: "particles",
  name: "Particle logo",
  blurb: "Your name in thousands of glowing points. Scroll to scatter it, click for a shock wave.",
  how: "The word is drawn on a hidden canvas and its pixels sampled for target positions. One Points mesh, all motion in the vertex shader: each point blends between the word and a cloud (driven by scroll), drifts with simplex noise, is pushed away from the pointer and caught by click shock waves. Changing the text morphs the old word into the new one.",
  hero: { eyebrow: "Nova Labs", title: "Ideas, assembled.", text: "A product studio turning early ideas into launch-ready software.", cta: "See our work" },
  ink: "light",
  layout: "bottom",
  params: [
    { key: "word", label: "Logo text", type: "text", value: "NOVA", max: 12 },
    { key: "a", label: "Colour left", type: "color", value: "#5ee7ff" },
    { key: "b", label: "Colour right", type: "color", value: "#b07cff" },
    { key: "bg", label: "Background", type: "color", value: "#05060b" },
    { key: "size", label: "Point size", type: "range", value: 3, min: 1, max: 6, step: 0.1 }
  ],
  create(ctx, values) {
    const count = ctx.width < 700 ? 9000 : 22000;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(values.bg as string);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    const box = () => { const a = camera.right; return [Math.min(a * 1.5, 2.6), a < 0.8 ? 0.42 : 0.62] as const; };

    const geo = new THREE.BufferGeometry();
    const cloud = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 0.6 + Math.random() * 1.6, a = Math.random() * Math.PI * 2;
      cloud[i * 3] = Math.cos(a) * r * 1.6; cloud[i * 3 + 1] = Math.sin(a) * r; cloud[i * 3 + 2] = (Math.random() - 0.5) * 2;
      seed[i] = Math.random();
    }
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aCloud", new THREE.BufferAttribute(cloud, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setAttribute("aFrom", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aTarget", new THREE.BufferAttribute(new Float32Array(count * 3), 3));

    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uScatter: { value: 0 }, uMorph: { value: 1 }, uSize: { value: 2.2 }, uPixel: { value: ctx.renderer.getPixelRatio() },
        uPush: { value: 0 }, uMouse: { value: new THREE.Vector2(9, 9) }, uWave: { value: 0 }, uWaveTime: { value: -10 }, uWaveAt: { value: new THREE.Vector2() },
        uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }
      }
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    const u = mat.uniforms;

    let word = "", time = 0;
    const setWord = (w: string, instant: boolean) => {
      const from = geo.getAttribute("aFrom") as THREE.BufferAttribute, target = geo.getAttribute("aTarget") as THREE.BufferAttribute;
      // start the morph from wherever the points are heading now
      (from.array as Float32Array).set(instant ? new Float32Array(count * 3) : (target.array as Float32Array));
      const [bw, bh] = box();
      (target.array as Float32Array).set(sampleText(w, count, bw, bh));
      if (instant) (from.array as Float32Array).set(target.array as Float32Array);
      from.needsUpdate = target.needsUpdate = true;
      u.uMorph.value = instant ? 1 : 0;
    };
    const sizeCamera = (w: number, h: number) => {
      const a = w / h;
      camera.left = -a; camera.right = a; camera.top = 1; camera.bottom = -1; camera.updateProjectionMatrix();
    };
    sizeCamera(ctx.width, ctx.height);

    const effect = {
      render(t: number, dt: number, input: Input) {
        time = t * (ctx.reduceMotion ? 0.3 : 1);
        u.uTime.value = time;
        u.uMorph.value = Math.min(1, u.uMorph.value + dt * 0.9);
        u.uScatter.value += (Math.min(1, input.scroll * 1.6) - u.uScatter.value) * Math.min(1, dt * 6);
        u.uMouse.value.set(input.x * camera.right, input.y);
        u.uPush.value += ((input.inside ? 1 : 0) - u.uPush.value) * Math.min(1, dt * 5);
        if (input.tap) { u.uWaveAt.value.set(input.tap.x * camera.right, input.tap.y); u.uWaveTime.value = time; u.uWave.value = 1; }
        ctx.renderer.render(scene, camera);
      },
      resize(w: number, h: number) { sizeCamera(w, h); setWord(word, true); },
      set(v: Record<string, string | number>) {
        u.uA.value.set(v.a as string); u.uB.value.set(v.b as string); u.uSize.value = Number(v.size);
        (scene.background as THREE.Color).set(v.bg as string);
        const w = String(v.word).trim().toUpperCase().slice(0, 12) || " ";
        if (w !== word) { const first = !word; word = w; setWord(w, first); }
      },
      dispose() { geo.dispose(); mat.dispose(); }
    };
    effect.set(values);
    return effect;
  }
};
