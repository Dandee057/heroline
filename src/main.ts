import * as THREE from "three";
import "./style.css";
import type { Effect, EffectDef, Input, Param, ParamValues } from "./effects/types.ts";
import { liquid } from "./effects/liquid.ts";
import { particles } from "./effects/particles.ts";
import { distort } from "./effects/distort.ts";
import { blob } from "./effects/blob.ts";
import { glass } from "./effects/glass.ts";
import { decode, defaults, encode, type HeroText, type PageState } from "./state.ts";

/**
 * The page: one WebGL renderer behind the hero, the effect switcher, the hero text, and the customise panel.
 * Effects are swapped in and out behind the same renderer; their settings and the hero text live in the URL.
 */

export const EFFECTS: EffectDef[] = [liquid, particles, distort, blob, glass];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hero = $("hero"), canvas = $<HTMLCanvasElement>("gl");

let renderer: THREE.WebGLRenderer | null = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
} catch { document.documentElement.classList.add("no-webgl"); }

let state: PageState = decode(location.search, EFFECTS);
let def = EFFECTS.find((e) => e.id === state.fx)!;
let effect: Effect | null = null;
let started = performance.now();
let loading = 0; // guards against a slow effect finishing after the visitor has already switched again

/* ---------- Size ---------- */

let W = 1, H = 1;
function size(): void {
  W = hero.clientWidth; H = hero.clientHeight;
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, W < 700 ? 2 : 1.6));
  renderer.setSize(W, H, false);
  effect?.resize(W, H);
}
addEventListener("resize", size);

/* ---------- Switching effects ---------- */

async function show(next: EffectDef, s: PageState, push = true): Promise<void> {
  const ticket = ++loading;
  def = next; state = s;
  syncChrome();
  if (push) history.replaceState(null, "", encode(state, EFFECTS) + location.hash);
  if (!renderer) return;
  canvas.classList.add("swap");
  const made = await next.create({ renderer, width: W, height: H, reduceMotion }, state.values);
  if (ticket !== loading) { made.dispose(); return; }
  effect?.dispose();
  effect = made;
  effect.resize(W, H);
  started = performance.now();
  requestAnimationFrame(() => canvas.classList.remove("swap"));
}

/* ---------- The hero text, the switcher and the panel ---------- */

const tabs = $("tabs"), cards = $("cards");
EFFECTS.forEach((e, i) => {
  const b = document.createElement("button");
  b.type = "button"; b.dataset.fx = e.id; b.textContent = e.name;
  b.setAttribute("aria-label", `${i + 1}: ${e.name}`);
  b.addEventListener("click", () => pick(e));
  tabs.append(b);

  const li = document.createElement("li");
  li.innerHTML = `<button type="button"><span class="n">0${i + 1}</span><b></b><span class="blurb"></span><span class="how"></span></button>`;
  li.querySelector("b")!.textContent = e.name;
  li.querySelector(".blurb")!.textContent = e.blurb;
  li.querySelector(".how")!.textContent = e.how;
  li.querySelector("button")!.addEventListener("click", () => { pick(e); scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }); });
  cards.append(li);
});

function pick(e: EffectDef): void {
  if (e.id === def.id) return;
  void show(e, { fx: e.id, values: defaults(e), hero: { ...e.hero } });
}

function syncChrome(): void {
  const i = EFFECTS.indexOf(def);
  document.body.dataset.layout = def.layout;
  document.body.dataset.ink = def.ink;
  document.body.dataset.fx = def.id;
  tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fx === def.id)));
  cards.querySelectorAll("li").forEach((li, k) => li.classList.toggle("on", k === i));
  $("fx-index").textContent = `0${i + 1} / 0${EFFECTS.length}`;
  $("fx-name").textContent = def.name;
  $("fx-blurb").textContent = def.blurb;
  writeHero(state.hero);
  buildParams();
  for (const k of ["eyebrow", "title", "text", "cta"] as (keyof HeroText)[]) ($<HTMLInputElement>("t-" + k)).value = state.hero[k];
  $("t-title").closest("label")!.toggleAttribute("hidden", def.hero.title === "" && state.hero.title === "");
}

function writeHero(h: HeroText): void {
  $("h-eyebrow").textContent = h.eyebrow;
  $("h-title").textContent = h.title;
  $("h-title").hidden = !h.title;
  $("h-text").textContent = h.text;
  $("h-cta").textContent = h.cta;
}

/** The panel's controls for the current effect. */
function buildParams(): void {
  const form = $("params");
  form.innerHTML = "";
  const legend = document.createElement("p");
  legend.className = "legend"; legend.textContent = def.name;
  form.append(legend);
  for (const p of def.params) form.append(control(p));
}

function control(p: Param): HTMLElement {
  const label = document.createElement("label");
  label.className = "ctl " + p.type;
  const name = document.createElement("span");
  name.textContent = p.label;
  const input = document.createElement("input");
  input.name = p.key;
  const out = document.createElement("output");
  if (p.type === "color") { input.type = "color"; input.value = String(state.values[p.key]); }
  else if (p.type === "range") {
    input.type = "range"; input.min = String(p.min); input.max = String(p.max); input.step = String(p.step);
    input.value = String(state.values[p.key]); out.textContent = fmt(Number(input.value), p.step);
  } else { input.type = "text"; input.maxLength = p.max; input.value = String(state.values[p.key]); }
  input.addEventListener("input", () => {
    state.values[p.key] = p.type === "range" ? Number(input.value) : input.value;
    if (p.type === "range") out.textContent = fmt(Number(input.value), p.step);
    applySettings();
  });
  label.append(name, input);
  if (p.type === "range") label.append(out);
  return label;
}
const fmt = (n: number, step: number) => (step >= 1 ? String(Math.round(n)) : n.toFixed(2));

let urlTimer = 0;
function applySettings(): void {
  effect?.set(state.values);
  writeHero(state.hero);
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => history.replaceState(null, "", encode(state, EFFECTS) + location.hash), 250);
}

for (const k of ["eyebrow", "title", "text", "cta"] as (keyof HeroText)[]) {
  $<HTMLInputElement>("t-" + k).addEventListener("input", (e) => { state.hero[k] = (e.target as HTMLInputElement).value; applySettings(); });
}

const panel = $("panel"), openBtn = $("open-panel");
function setPanel(open: boolean): void {
  panel.hidden = !open;
  openBtn.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("panel-open", open);
  if (open) (panel.querySelector("input") as HTMLInputElement | null)?.focus({ preventScroll: true });
}
openBtn.addEventListener("click", () => setPanel(panel.hidden !== false));
$("close-panel").addEventListener("click", () => { setPanel(false); openBtn.focus(); });
$("reset").addEventListener("click", () => void show(def, { fx: def.id, values: defaults(def), hero: { ...def.hero } }));
$("copy-link").addEventListener("click", async () => {
  const url = location.origin + location.pathname + encode(state, EFFECTS);
  try { await navigator.clipboard.writeText(url); toast("Link copied: it opens this hero with your settings"); }
  catch { prompt("Copy this link:", url); }
});

let toastTimer = 0;
function toast(msg: string): void {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("on"), 2600);
}

addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= EFFECTS.length) pick(EFFECTS[n - 1]);
  else if (e.key === "Escape" && !panel.hidden) setPanel(false);
});

/* ---------- Pointer and scroll ---------- */

const input: Input = { x: 0, y: 0, vx: 0, vy: 0, inside: false, scroll: 0, tap: null };
let lastMove = { x: 0, y: 0, t: performance.now() };
const toLocal = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1), over: e.clientY >= r.top && e.clientY <= r.bottom };
};
// the hero's own controls shouldn't count as touching the effect
const onUi = (e: Event) => !!(e.target as HTMLElement).closest?.(".bar, .panel, .copy a, .copy button");
addEventListener("pointermove", (e) => {
  const p = toLocal(e), now = performance.now(), dt = Math.max(0.008, (now - lastMove.t) / 1000);
  input.vx = input.vx * 0.6 + ((p.x - lastMove.x) / dt) * 0.4;
  input.vy = input.vy * 0.6 + ((p.y - lastMove.y) / dt) * 0.4;
  lastMove = { x: p.x, y: p.y, t: now };
  input.x = p.x; input.y = p.y;
  input.inside = p.over && (e.pointerType === "mouse" || e.buttons > 0) && !onUi(e);
}, { passive: true });
addEventListener("pointerdown", (e) => {
  const p = toLocal(e);
  if (!p.over || onUi(e)) return;
  input.x = p.x; input.y = p.y; lastMove = { x: p.x, y: p.y, t: performance.now() };
  input.tap = { x: p.x, y: p.y };
  if (e.pointerType !== "mouse") input.inside = true;
});
addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") input.inside = false; });
document.addEventListener("pointerleave", () => { input.inside = false; });
addEventListener("blur", () => { input.inside = false; });

/* ---------- The frame loop: only while the hero is on screen ---------- */

let visible = true, live = true;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 }).observe(hero);

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.scroll = Math.min(1, Math.max(0, scrollY / Math.max(1, H)));
  // the pointer's speed dies away when it stops moving
  if (now - lastMove.t > 60) { input.vx *= 0.85; input.vy *= 0.85; }
  document.body.style.setProperty("--scroll", input.scroll.toFixed(3));
  if (live && effect && visible && !document.hidden) effect.render((now - started) / 1000, dt, input);
  input.tap = null;
}

/* ---------- Start ---------- */

size();
void show(def, state, false);
requestAnimationFrame(frame);

// ?debug: lets automated tests drive the page
if (new URLSearchParams(location.search).has("debug")) {
  (window as unknown as { heroline: object }).heroline = {
    state: () => state, ready: () => !!effect && !canvas.classList.contains("swap"),
    pick: (id: string) => pick(EFFECTS.find((e) => e.id === id)!),
    pointer: (x: number, y: number, inside = true) => { input.x = x; input.y = y; input.inside = inside; },
    tap: (x: number, y: number) => { input.tap = { x, y }; },
    set: (values: ParamValues) => { Object.assign(state.values, values); applySettings(); },
    /** For recording a video: stop the live loop, then draw exact frames at a given time with a given input. */
    capture: () => { live = false; },
    shoot: (t: number, dt: number, inp: Partial<Input>) => {
      Object.assign(input, { tap: null }, inp);
      document.body.style.setProperty("--scroll", input.scroll.toFixed(3));
      effect?.render(t, dt, input);
      input.tap = null;
    }
  };
}
