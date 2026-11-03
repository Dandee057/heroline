import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { EffectDef, Input } from "./types.ts";
import { NOISE } from "./shared.ts";

/**
 * Morphing blob: a glossy, iridescent shape that never holds still. It's a finely divided sphere with Three's
 * physical material (clearcoat, iridescence, studio reflections), patched with onBeforeCompile so the vertex
 * shader moves every vertex along its normal by layered noise. Moving vertices breaks the lighting, so the
 * shader also rebuilds each normal from two nearby displaced points. The pointer pulls a bulge towards it, a
 * click sends a pulse through the surface, and scrolling makes it melt.
 */

const DISPLACE = /* glsl */ `
uniform float uTime, uAmp, uFreq, uPulse, uPulseTime;
uniform vec3 uPointer;
${NOISE}
vec3 displace(vec3 p) {
  vec3 n = normalize(p);
  float t = uTime * 0.35;
  float d = snoise(n * uFreq + t) * 0.7 + snoise(n * uFreq * 2.1 - t * 1.4) * 0.15;
  // a bulge towards the pointer
  d += smoothstep(0.55, 1.0, dot(n, normalize(uPointer + 1e-4))) * length(uPointer) * 0.45;
  // a ripple running out from the front after a click
  float age = uTime - uPulseTime;
  float ring = sin((acos(clamp(dot(n, vec3(0.0, 0.0, 1.0)), -1.0, 1.0)) - age * 2.4) * 10.0) * exp(-age * 1.6) * uPulse;
  d += ring * 0.06;
  return n * (1.0 + d * uAmp);
}
`;

export const blob: EffectDef = {
  id: "blob",
  name: "Morphing blob",
  blurb: "A glossy, iridescent shape that follows the pointer, ripples when clicked and melts as you scroll.",
  how: "A finely divided sphere with Three's MeshPhysicalMaterial (clearcoat, iridescence, reflections from a generated studio), patched with onBeforeCompile: the vertex shader moves each vertex by layered noise and rebuilds its normal from two neighbouring displaced points, so the lighting stays right. A pointer bulge and a click ripple are added in the same displacement function.",
  hero: { eyebrow: "Halo", title: "Calm, on demand.", text: "The meditation app that adapts to how you feel today.", cta: "Download free" },
  ink: "light",
  layout: "left",
  params: [
    { key: "tint", label: "Tint", type: "color", value: "#b9a7ff" },
    { key: "bg", label: "Background", type: "color", value: "#0e0b1c" },
    { key: "glow", label: "Glow", type: "color", value: "#5b3cff" },
    { key: "amp", label: "Wobble", type: "range", value: 0.2, min: 0, max: 0.8, step: 0.01 },
    { key: "freq", label: "Detail", type: "range", value: 1.05, min: 0.5, max: 4, step: 0.05 },
    { key: "shine", label: "Iridescence", type: "range", value: 1, min: 0, max: 1, step: 0.05 }
  ],
  create(ctx, values) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(values.bg as string);
    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(35, ctx.width / ctx.height, 0.1, 50);
    camera.position.set(0, 0, 6.2);

    const uniforms = {
      uTime: { value: 0 }, uAmp: { value: 0.3 }, uFreq: { value: 1.4 }, uPulse: { value: 0 }, uPulseTime: { value: -10 },
      uPointer: { value: new THREE.Vector3() }
    };
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.12, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [120, 520] });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\n" + DISPLACE)
        .replace("#include <beginnormal_vertex>", /* glsl */ `
          vec3 p0 = displace(position);
          vec3 tangentDir = normalize(cross(normal, abs(normal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 bitangentDir = normalize(cross(normal, tangentDir));
          vec3 p1 = displace(position + tangentDir * 0.01);
          vec3 p2 = displace(position + bitangentDir * 0.01);
          vec3 objectNormal = normalize(cross(p1 - p0, p2 - p0));
          if (dot(objectNormal, normal) < 0.0) objectNormal = -objectNormal;`)
        .replace("#include <begin_vertex>", "vec3 transformed = p0;");
    };
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, ctx.width < 700 ? 48 : 80), mat);
    scene.add(mesh);
    scene.add(new THREE.DirectionalLight("#ffffff", 1.6).translateX(3).translateY(4).translateZ(5));

    // a soft glow behind the blob
    const glowTex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const g = c.getContext("2d")!, grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.4, "rgba(255,255,255,0.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    glow.position.z = -2.5;
    scene.add(glow);

    let wide = ctx.width / ctx.height > 1.1, baseY = 0;
    const place = () => {
      // beside the text on wide screens, above it on phones (sized to fit the narrow view)
      const x = wide ? 1.25 * Math.min(1.6, camera.aspect) / 1.6 + 0.35 : 0;
      const y = wide ? 0 : 0.5;
      mesh.position.set(x, y, 0);
      mesh.scale.setScalar(wide ? 1.15 : Math.min(0.95, camera.aspect * 1.3));
      glow.position.x = x; glow.position.y = y;
      baseY = y;
    };
    place();
    const target = new THREE.Vector3();
    let current: Record<string, string | number> = values;

    const effect = {
      render(t: number, dt: number, input: Input) {
        const slow = ctx.reduceMotion ? 0.25 : 1;
        uniforms.uTime.value = t * slow;
        // the pointer, as a direction from the blob's centre in its own space (zero when it's away)
        target.set(input.x * camera.aspect * 2.2 - mesh.position.x, input.y * 2.2 - mesh.position.y, 1.2).multiplyScalar(input.inside ? 0.6 : 0);
        uniforms.uPointer.value.lerp(target, Math.min(1, dt * 4));
        if (input.tap) { uniforms.uPulse.value = 1; uniforms.uPulseTime.value = uniforms.uTime.value; }
        uniforms.uAmp.value += ((Number(current.amp) * (1 + input.scroll * 1.8)) - uniforms.uAmp.value) * Math.min(1, dt * 4);
        mesh.rotation.y += dt * 0.15 * slow;
        mesh.rotation.x = Math.sin(t * 0.2) * 0.2;
        mesh.position.y = baseY + input.scroll * 0.8;
        ctx.renderer.render(scene, camera);
      },
      resize(w: number, h: number) { camera.aspect = w / h; camera.updateProjectionMatrix(); wide = w / h > 1.1; place(); },
      set(v: Record<string, string | number>) {
        current = v;
        mat.color.set(v.tint as string);
        mat.iridescence = Number(v.shine);
        uniforms.uFreq.value = Number(v.freq);
        (scene.background as THREE.Color).set(v.bg as string);
        (glow.material as THREE.MeshBasicMaterial).color.set(v.glow as string);
      },
      dispose() { mesh.geometry.dispose(); mat.dispose(); env.dispose(); glowTex.dispose(); glow.geometry.dispose(); }
    };
    effect.set(values);
    uniforms.uAmp.value = Number(values.amp);
    return effect;
  }
};
