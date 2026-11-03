import * as THREE from "three";
import type { EffectDef, Input } from "./types.ts";
import { NOISE, color, fullscreen } from "./shared.ts";

/**
 * Liquid gradient: four brand colours flowing like slow paint. The picture is one fragment shader: domain-warped
 * noise (noise fed back into its own coordinates, twice) picks a blend between the colours at every pixel. The
 * pointer leaves a trail of swirls: the last few positions are passed in as uniforms, each one twisting the
 * coordinates around it and fading with age.
 */

const TRAIL = 10;

const fragment = /* glsl */ `
precision highp float;
uniform float uTime, uAspect, uSpeed, uGrain, uScale;
uniform vec3 uA, uB, uC, uD;
uniform vec3 uTrail[${TRAIL}]; // x, y, age (0 = just now, 1 = gone)
varying vec2 vUv;
${NOISE}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);

  // swirls where the pointer has been: rotate the space around each point, less as it ages
  for (int i = 0; i < ${TRAIL}; i++) {
    vec3 tr = uTrail[i];
    if (tr.z >= 1.0) continue;
    vec2 d = p - vec2(tr.x * uAspect * 0.5, tr.y * 0.5);
    float fall = exp(-dot(d, d) * 18.0) * (1.0 - tr.z);
    float a = fall * 2.2;
    p = vec2(tr.x * uAspect * 0.5, tr.y * 0.5) + mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
  }

  float t = uTime * 0.05 * uSpeed;
  vec2 q = p * uScale * 0.55;
  // domain warping: the noise moves the coordinates the next noise is read at
  vec2 w1 = vec2(snoise(vec3(q, t)), snoise(vec3(q + 5.2, t * 1.1)));
  vec2 w2 = vec2(snoise(vec3(q + 1.1 * w1 + vec2(1.7, 9.2), t * 1.3)), snoise(vec3(q + 1.1 * w1 + vec2(8.3, 2.8), t * 0.9)));
  float n = fbm(vec3(q + 1.2 * w2, t * 0.7));

  vec3 col = mix(uA, uB, smoothstep(-0.6, 0.6, n + w2.y * 0.4));
  col = mix(col, uC, smoothstep(0.35, 1.1, w2.x + n * 0.5) * 0.9);
  col = mix(col, uD, smoothstep(0.45, 1.0, w1.x * w2.y + 0.4) * 0.75);
  // a soft sheen along the folds, then film grain so the gradient never bands
  col += smoothstep(0.75, 1.0, 1.0 - abs(n * 2.0 - 0.4)) * 0.05;
  col += (hash(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain * 0.08;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const liquid: EffectDef = {
  id: "liquid",
  name: "Liquid gradient",
  blurb: "Brand colours flowing like slow paint. Move the pointer to stir it.",
  how: "One fragment shader. Domain-warped simplex noise (noise read at coordinates moved by more noise, twice) chooses the blend between four colours at every pixel. The last ten pointer positions are uniforms; each one rotates the space around it, fading with age, which leaves a trail of swirls.",
  hero: { eyebrow: "Studio Flux", title: "Brands that move.", text: "We build identities and websites for companies that don't sit still.", cta: "Start a project" },
  ink: "light",
  layout: "left",
  params: [
    { key: "a", label: "Base", type: "color", value: "#1b1036" },
    { key: "b", label: "Flow", type: "color", value: "#6b3cff" },
    { key: "c", label: "Highlight", type: "color", value: "#ff6b9a" },
    { key: "d", label: "Accent", type: "color", value: "#ffb36b" },
    { key: "speed", label: "Speed", type: "range", value: 1, min: 0, max: 3, step: 0.05 },
    { key: "scale", label: "Zoom", type: "range", value: 1, min: 0.4, max: 3, step: 0.05 },
    { key: "grain", label: "Grain", type: "range", value: 0.5, min: 0, max: 1, step: 0.05 }
  ],
  create(ctx, values) {
    const trail = Array.from({ length: TRAIL }, () => new THREE.Vector3(0, 0, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, depthTest: false,
      uniforms: {
        uTime: { value: 0 }, uAspect: { value: ctx.width / ctx.height }, uSpeed: { value: 1 }, uGrain: { value: 0.5 }, uScale: { value: 1 },
        uA: { value: color("#000") }, uB: { value: color("#000") }, uC: { value: color("#000") }, uD: { value: color("#000") },
        uTrail: { value: trail }
      }
    });
    const { scene, camera } = fullscreen(mat);
    let next = 0, since = 0;
    const u = mat.uniforms;
    const effect = {
      render(t: number, dt: number, input: Input) {
        u.uTime.value = t * (ctx.reduceMotion ? 0.25 : 1);
        for (const p of trail) p.z = Math.min(1, p.z + dt * 0.45);
        // drop a new swirl every so often while the pointer moves
        since += dt;
        const moving = Math.hypot(input.vx, input.vy) > 0.15;
        if (input.inside && moving && since > 0.06) {
          trail[next].set(input.x, input.y, 0);
          next = (next + 1) % TRAIL; since = 0;
        }
        if (input.tap) { trail[next].set(input.tap.x, input.tap.y, 0); next = (next + 1) % TRAIL; }
        ctx.renderer.render(scene, camera);
      },
      resize(w: number, h: number) { u.uAspect.value = w / h; },
      set(v: Record<string, string | number>) {
        u.uA.value.set(v.a as string); u.uB.value.set(v.b as string); u.uC.value.set(v.c as string); u.uD.value.set(v.d as string);
        u.uSpeed.value = Number(v.speed); u.uScale.value = Number(v.scale); u.uGrain.value = Number(v.grain);
      },
      dispose() { mat.dispose(); scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
    };
    effect.set(values);
    return effect;
  }
};
