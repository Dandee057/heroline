import * as THREE from "three";
import type { EffectDef, Input } from "./types.ts";
import { NOISE } from "./shared.ts";

/**
 * Image hover distortion: product photos that ripple like liquid under the pointer. Each photo is a plane laid out
 * in pixels by an orthographic camera. Its fragment shader reads the photo through coordinates bent by noise near
 * the pointer, splits the red and blue channels by how fast the pointer is moving, and zooms in slightly while
 * hovered. Corners are rounded in the shader too (a rounded-rectangle distance), so the planes stay simple quads.
 */

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragment = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uMouse, uVel, uSize;
uniform float uHover, uTime, uImageAspect, uStrength, uSplit, uRadius, uReveal;
varying vec2 vUv;
${NOISE}

// cover-fit the photo in the card, like CSS object-fit: cover
vec2 cover(vec2 uv) {
  float planeAspect = uSize.x / uSize.y;
  vec2 s = planeAspect > uImageAspect ? vec2(1.0, uImageAspect / planeAspect) : vec2(planeAspect / uImageAspect, 1.0);
  return (uv - 0.5) * s + 0.5;
}

float roundedBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  vec2 px = (vUv - 0.5) * uSize;                                  // position in pixels from the card's centre
  float edge = roundedBox(px, uSize * 0.5, uRadius);
  if (edge > 0.0) discard;

  vec2 m = (uMouse - 0.5) * uSize;
  float dist = length(px - m) / min(uSize.x, uSize.y);
  float fall = smoothstep(0.55, 0.0, dist) * uHover;

  vec2 uv = cover(vUv);
  uv = (uv - 0.5) * (1.0 - 0.07 * uHover) + 0.5;                  // a gentle zoom while hovered
  float n1 = snoise(vec3(px * 0.008, uTime * 0.6)), n2 = snoise(vec3(px * 0.008 + 11.0, uTime * 0.6));
  vec2 bend = vec2(n1, n2) * 0.045 * uStrength * fall + uVel * 0.06 * fall;
  uv += bend;
  vec2 split = (uVel * 0.02 + bend * 0.5) * uSplit * fall;
  vec3 col = vec3(texture2D(uTex, uv + split).r, texture2D(uTex, uv).g, texture2D(uTex, uv - split).b);

  // the card wipes in from the bottom when the page opens
  float wipe = smoothstep(uReveal - 0.08, uReveal, 1.0 - vUv.y + 0.08);
  col += fall * 0.04;
  gl_FragColor = vec4(col, (1.0 - smoothstep(-1.5, 0.0, edge)) * (1.0 - wipe));
  #include <colorspace_fragment>
}
`;

const IMAGES = ["images/coral.jpg", "images/sage.jpg", "images/sand.jpg"];

export const distort: EffectDef = {
  id: "distort",
  name: "Image distortion",
  blurb: "Product photos that ripple like liquid under the pointer, with a colour split as it moves.",
  how: "Each photo is a plane in an orthographic camera laid out in pixels. Its fragment shader reads the photo through coordinates bent by simplex noise near the pointer, splits red and blue by pointer speed, zooms slightly on hover, and rounds its own corners with a rounded-rectangle distance function.",
  hero: { eyebrow: "Soundline", title: "Pick your finish.", text: "Three colours, one sound. Hover over a pair to take a closer look.", cta: "Shop headphones" },
  ink: "light",
  layout: "top",
  params: [
    { key: "bg", label: "Background", type: "color", value: "#0d0e11" },
    { key: "strength", label: "Ripple", type: "range", value: 1, min: 0, max: 2.5, step: 0.05 },
    { key: "split", label: "Colour split", type: "range", value: 1, min: 0, max: 3, step: 0.05 },
    { key: "radius", label: "Corners", type: "range", value: 18, min: 0, max: 60, step: 1 }
  ],
  async create(ctx, values) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(values.bg as string);
    const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
    const loader = new THREE.TextureLoader();
    const textures = await Promise.all(IMAGES.map((src) => loader.loadAsync(src)));
    const cards = textures.map((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.ShaderMaterial({
        vertexShader: vertex, fragmentShader: fragment, transparent: true,
        uniforms: {
          uTex: { value: tex }, uMouse: { value: new THREE.Vector2(0.5, 0.5) }, uVel: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) },
          uHover: { value: 0 }, uTime: { value: 0 }, uImageAspect: { value: tex.image.width / tex.image.height },
          uStrength: { value: 1 }, uSplit: { value: 1 }, uRadius: { value: 18 }, uReveal: { value: 0 }
        }
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      scene.add(mesh);
      return { mesh, mat, x: 0, y: 0, w: 1, h: 1 };
    });

    let W = ctx.width, H = ctx.height;
    // Lay the cards out in pixels: a row along the bottom on wide screens, a tighter row on phones
    const layout = () => {
      camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H; camera.updateProjectionMatrix();
      const phone = W < 700, gap = phone ? 10 : 22, pad = phone ? 16 : Math.max(32, W * 0.05);
      const cw = (W - pad * 2 - gap * 2) / 3, ch = Math.min(phone ? cw * 1.35 : cw * 0.78, H * (phone ? 0.3 : 0.5));
      cards.forEach((c, i) => {
        c.w = cw; c.h = ch; c.x = pad + i * (cw + gap); c.y = H - (phone ? 26 : pad * 0.8) - ch;
        c.mesh.scale.set(cw, ch, 1);
        c.mat.uniforms.uSize.value.set(cw, ch);
      });
    };
    layout();

    const effect = {
      render(t: number, dt: number, input: Input) {
        // pointer in pixels, from -1..1 (y up)
        const px = (input.x + 1) / 2 * W, py = (1 - input.y) / 2 * H;
        const k = Math.min(1, dt * 7);
        cards.forEach((c, i) => {
          const u = c.mat.uniforms, lift = input.scroll * H * 0.25 * (1 + i * 0.25);
          const y = c.y - lift;
          c.mesh.position.set(c.x + c.w / 2, -(y + c.h / 2), 0);
          const over = input.inside && px >= c.x && px <= c.x + c.w && py >= y && py <= y + c.h;
          u.uHover.value += ((over ? 1 : 0) - u.uHover.value) * k;
          if (over) u.uMouse.value.set((px - c.x) / c.w, 1 - (py - y) / c.h);
          u.uVel.value.lerp(new THREE.Vector2(over ? input.vx : 0, over ? input.vy : 0).clampLength(0, 3), k);
          u.uTime.value = t * (ctx.reduceMotion ? 0.3 : 1);
          u.uReveal.value = Math.min(1.2, ctx.reduceMotion ? 1.2 : (t - i * 0.12) * 1.1);
        });
        ctx.renderer.render(scene, camera);
      },
      resize(w: number, h: number) { W = w; H = h; layout(); },
      set(v: Record<string, string | number>) {
        (scene.background as THREE.Color).set(v.bg as string);
        for (const c of cards) {
          c.mat.uniforms.uStrength.value = Number(v.strength);
          c.mat.uniforms.uSplit.value = Number(v.split);
          c.mat.uniforms.uRadius.value = Number(v.radius);
        }
      },
      dispose() { for (const c of cards) { c.mat.dispose(); c.mesh.geometry.dispose(); } textures.forEach((t) => t.dispose()); }
    };
    effect.set(values);
    return effect;
  }
};
