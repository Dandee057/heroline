import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { EffectDef, Input } from "./types.ts";

/**
 * Text through glass: one huge word behind a slowly turning glass object that bends it. The word is drawn on a
 * canvas and shown on a plane at the back of the scene. The glass uses Three's physical transmission, which
 * renders the scene behind it to a texture and reads that texture through the surface's refraction, with
 * dispersion splitting the colours at the edges like a real prism. The glass drifts after the pointer.
 */

const SHAPES = [
  () => new THREE.TorusKnotGeometry(0.62, 0.24, 300, 48, 2, 3),
  () => new THREE.TorusGeometry(0.72, 0.3, 64, 160),
  () => new RoundedBoxGeometry(1.25, 1.25, 1.25, 8, 0.28),
  () => new THREE.IcosahedronGeometry(0.95, 0)
];

function wordTexture(word: string, ink: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2400; c.height = 900;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = ink; g.textAlign = "center"; g.textBaseline = "middle";
  let size = 620;
  const font = (s: number) => `900 ${s}px Inter, "Helvetica Neue", Arial, sans-serif`;
  g.font = font(size);
  while (g.measureText(word).width > c.width * 0.96 && size > 60) g.font = font((size -= 10));
  // tight letter spacing, like a poster
  (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${-size * 0.04}px`;
  // a fine dot grid behind the word, so the refraction has detail to bend even between the letters
  g.globalAlpha = 0.18;
  for (let y = 30; y < c.height; y += 44) for (let x = 30; x < c.width; x += 44) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  g.fillText(word, c.width / 2, c.height / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const glass: EffectDef = {
  id: "glass",
  name: "Text through glass",
  blurb: "A huge word bent and split into colours by a turning glass shape that follows the pointer.",
  how: "The word is drawn on a canvas and set on a plane behind the glass. MeshPhysicalMaterial transmission renders everything behind the glass to a texture and reads it back through the surface's refraction; dispersion splits the colours at the edges like a prism. The glass eases after the pointer and turns; scrolling lifts it out of the way.",
  hero: { eyebrow: "Lumen Optics", title: "", text: "Lenses ground to a thousandth of a millimetre, for cameras that see everything.", cta: "Explore lenses" },
  ink: "dark",
  layout: "bottom",
  params: [
    { key: "word", label: "Big word", type: "text", value: "CLARITY", max: 10 },
    { key: "ink", label: "Text", type: "color", value: "#141414" },
    { key: "bg", label: "Background", type: "color", value: "#ece8df" },
    { key: "shape", label: "Shape", type: "range", value: 0, min: 0, max: 3, step: 1 },
    { key: "disp", label: "Dispersion", type: "range", value: 3, min: 0, max: 8, step: 0.1 },
    { key: "thickness", label: "Thickness", type: "range", value: 1.2, min: 0.2, max: 3, step: 0.05 }
  ],
  create(ctx, values) {
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    const camera = new THREE.PerspectiveCamera(30, ctx.width / ctx.height, 0.1, 50);
    camera.position.set(0, 0, 7);

    // the background is a real plane, not scene.background, so the glass can see (and bend) it
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ toneMapped: false }));
    backdrop.position.z = -1.6;
    scene.add(backdrop);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }));
    back.position.z = -1.5;
    scene.add(back);

    const glassMat = new THREE.MeshPhysicalMaterial({
      transmission: 1, thickness: 1.2, roughness: 0.02, ior: 1.5, dispersion: 3,
      metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, color: "#ffffff", attenuationColor: "#e8f4ff", attenuationDistance: 3
    });
    const mesh = new THREE.Mesh(SHAPES[0](), glassMat);
    scene.add(mesh);
    scene.add(new THREE.DirectionalLight("#ffffff", 2).translateX(2).translateY(3).translateZ(4));

    let shape = 0, word = "", ink = "", bg = "";
    let tex: THREE.CanvasTexture | null = null;
    // size the word's plane to fill the view's width at its depth
    const fitBack = () => {
      const d = camera.position.z - back.position.z, h = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), w = h * camera.aspect;
      const pw = w * (camera.aspect < 0.8 ? 0.98 : 1), ph = pw * (900 / 2400);
      back.scale.set(pw, ph, 1);
      (backdrop.material as THREE.MeshBasicMaterial).color.set(bg || "#ece8df");
    };
    const pos = new THREE.Vector2(), goal = new THREE.Vector2();

    const effect = {
      render(t: number, dt: number, input: Input) {
        const slow = ctx.reduceMotion ? 0.25 : 1;
        const d = camera.position.z, hh = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), hw = hh * camera.aspect;
        goal.set(input.inside ? input.x * hw * 0.7 : Math.sin(t * 0.3) * hw * 0.25, input.inside ? input.y * hh * 0.6 : Math.cos(t * 0.23) * hh * 0.15);
        pos.lerp(goal, Math.min(1, dt * 2.2));
        mesh.position.set(pos.x, pos.y + input.scroll * hh * 1.4, 0.4);
        mesh.rotation.x += dt * 0.25 * slow;
        mesh.rotation.y += dt * 0.35 * slow;
        if (input.tap) mesh.rotation.z += 0.6;
        back.position.y = input.scroll * hh * 0.4;
        ctx.renderer.render(scene, camera);
      },
      resize(w: number, h: number) {
        camera.aspect = w / h;
        camera.fov = w / h < 0.8 ? 42 : 30;
        camera.updateProjectionMatrix();
        mesh.scale.setScalar(w / h < 0.8 ? 0.6 : 0.9);
        fitBack();
      },
      set(v: Record<string, string | number>) {
        const w = String(v.word).trim().toUpperCase().slice(0, 10) || " ";
        if (w !== word || v.ink !== ink || v.bg !== bg) {
          word = w; ink = String(v.ink); bg = String(v.bg);
          tex?.dispose();
          tex = wordTexture(word, ink, bg);
          (back.material as THREE.MeshBasicMaterial).map = tex;
          (back.material as THREE.MeshBasicMaterial).needsUpdate = true;
          fitBack();
        }
        const s = Math.round(Number(v.shape));
        if (s !== shape) { shape = s; mesh.geometry.dispose(); mesh.geometry = SHAPES[Math.max(0, Math.min(SHAPES.length - 1, s))](); }
        glassMat.dispersion = Number(v.disp);
        glassMat.thickness = Number(v.thickness);
      },
      dispose() { mesh.geometry.dispose(); glassMat.dispose(); tex?.dispose(); back.geometry.dispose(); (back.material as THREE.Material).dispose(); backdrop.geometry.dispose(); (backdrop.material as THREE.Material).dispose(); env.dispose(); }
    };
    effect.set(values);
    effect.resize(ctx.width, ctx.height);
    return effect;
  }
};
