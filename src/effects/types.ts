import type * as THREE from "three";

/**
 * Every hero effect is a small module behind this interface. The app owns the renderer, the hero text on top and
 * the customise panel; an effect owns its own scene, camera and shaders, and is told about input every frame.
 */

/** A setting the visitor can change in the customise panel. Colours are "#rrggbb"; ranges are numbers. */
export type Param =
  | { key: string; label: string; type: "color"; value: string }
  | { key: string; label: string; type: "range"; value: number; min: number; max: number; step: number }
  | { key: string; label: string; type: "text"; value: string; max: number };

export type ParamValues = Record<string, string | number>;

/** Pointer and scroll, normalised. Pointer is -1..1 across the canvas (y up), velocity in those units per second. */
export interface Input {
  x: number; y: number;
  vx: number; vy: number;
  /** Whether the pointer is over the hero (false on touch screens between taps). */
  inside: boolean;
  /** 0 at the top of the page, 1 once the hero has scrolled out of view. */
  scroll: number;
  /** A tap or click this frame, in the same units, or null. */
  tap: { x: number; y: number } | null;
}

export interface EffectContext {
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
  /** True when the visitor asked for less motion: effects keep their look but slow right down. */
  reduceMotion: boolean;
}

export interface Effect {
  /** Draw a frame. `t` is seconds since the effect started, `dt` the time since the last frame. */
  render(t: number, dt: number, input: Input): void;
  resize(width: number, height: number): void;
  /** Called when a setting changes. */
  set(values: ParamValues): void;
  dispose(): void;
}

export interface EffectDef {
  id: string;
  name: string;
  /** One line for the switcher. */
  blurb: string;
  /** What's going on technically, for the "how it works" panel. */
  how: string;
  /** Default hero text for this effect, so each one looks like a real site. */
  hero: { eyebrow: string; title: string; text: string; cta: string };
  /** Light or dark hero text over this effect. */
  ink: "light" | "dark";
  /** Where the hero text sits, so it doesn't cover the effect's subject. */
  layout: "left" | "top" | "bottom";
  params: Param[];
  create(ctx: EffectContext, values: ParamValues): Effect | Promise<Effect>;
}
