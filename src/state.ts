import type { EffectDef, Param, ParamValues } from "./effects/types.ts";

/**
 * The page's settings live in the URL, so a visitor (or a client) can restyle an effect and send the link:
 *   ?fx=liquid&a=1b1036&b=6b3cff&speed=1.5&h=Studio%20Flux|Brands%20that%20move.|…|Start%20a%20project
 * Anything missing or invalid falls back to the effect's defaults.
 */

export interface HeroText { eyebrow: string; title: string; text: string; cta: string }
export interface PageState { fx: string; values: ParamValues; hero: HeroText }

const HEX = /^[0-9a-f]{6}$/i;
const HERO_KEYS: (keyof HeroText)[] = ["eyebrow", "title", "text", "cta"];
const HERO_MAX: Record<keyof HeroText, number> = { eyebrow: 40, title: 60, text: 160, cta: 30 };

export const defaults = (def: EffectDef): ParamValues => Object.fromEntries(def.params.map((p) => [p.key, p.value]));

/** A value from the URL, checked against its parameter; undefined if it isn't usable. */
export function parseValue(p: Param, raw: string | null): string | number | undefined {
  if (raw == null) return undefined;
  if (p.type === "color") return HEX.test(raw) ? "#" + raw.toLowerCase() : undefined;
  if (p.type === "range") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    const stepped = Math.round((n - p.min) / p.step) * p.step + p.min;
    return Math.min(p.max, Math.max(p.min, Number(stepped.toFixed(6))));
  }
  return raw.slice(0, p.max);
}

export function decode(search: string, effects: EffectDef[]): PageState {
  const q = new URLSearchParams(search);
  const def = effects.find((e) => e.id === q.get("fx")) ?? effects[0];
  const values = defaults(def);
  for (const p of def.params) {
    const v = parseValue(p, q.get(p.key));
    if (v !== undefined) values[p.key] = v;
  }
  const hero: HeroText = { ...def.hero };
  const h = q.get("h");
  if (h != null) {
    const parts = h.split("|");
    HERO_KEYS.forEach((k, i) => { if (parts[i] !== undefined) hero[k] = parts[i].slice(0, HERO_MAX[k]); });
  }
  return { fx: def.id, values, hero };
}

/** Only what differs from the defaults goes in the link, so links stay short. */
export function encode(state: PageState, effects: EffectDef[]): string {
  const def = effects.find((e) => e.id === state.fx) ?? effects[0];
  const q = new URLSearchParams({ fx: def.id });
  for (const p of def.params) {
    const v = state.values[p.key];
    if (v === undefined || v === p.value) continue;
    q.set(p.key, p.type === "color" ? String(v).replace("#", "") : String(v));
  }
  if (HERO_KEYS.some((k) => state.hero[k] !== def.hero[k])) q.set("h", HERO_KEYS.map((k) => state.hero[k].replace(/\|/g, "/")).join("|"));
  return "?" + q.toString();
}
