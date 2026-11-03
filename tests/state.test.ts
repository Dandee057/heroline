import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, defaults, encode, parseValue } from "../src/state.ts";
import type { EffectDef } from "../src/effects/types.ts";

// Stand-in effects with the same kinds of settings as the real ones (the real ones import three.js and the DOM)
const fake = (id: string): EffectDef => ({
  id, name: id, blurb: "", how: "", ink: "light", layout: "left",
  hero: { eyebrow: "Brand", title: "Title", text: "Text", cta: "Go" },
  params: [
    { key: "a", label: "A", type: "color", value: "#112233" },
    { key: "speed", label: "Speed", type: "range", value: 1, min: 0, max: 3, step: 0.05 },
    { key: "shape", label: "Shape", type: "range", value: 0, min: 0, max: 3, step: 1 },
    { key: "word", label: "Word", type: "text", value: "NOVA", max: 12 }
  ],
  create: () => { throw new Error("not in tests"); }
});
const EFFECTS = [fake("liquid"), fake("glass")];

test("an empty address gives the first effect with its defaults", () => {
  const s = decode("", EFFECTS);
  assert.equal(s.fx, "liquid");
  assert.deepEqual(s.values, defaults(EFFECTS[0]));
  assert.deepEqual(s.hero, EFFECTS[0].hero);
});

test("settings survive a round trip through the address", () => {
  const s = { fx: "glass", values: { a: "#ff00aa", speed: 2.35, shape: 2, word: "HELLO" }, hero: { eyebrow: "Acme", title: "Big | news", text: "Words", cta: "Buy" } };
  const back = decode(encode(s, EFFECTS), EFFECTS);
  assert.equal(back.fx, "glass");
  assert.deepEqual(back.values, s.values);
  assert.deepEqual(back.hero, { ...s.hero, title: "Big / news" }); // the separator can't appear inside a field
});

test("only changed settings go in the link", () => {
  const url = encode({ fx: "liquid", values: { ...defaults(EFFECTS[0]), speed: 2 }, hero: { ...EFFECTS[0].hero } }, EFFECTS);
  assert.equal(url, "?fx=liquid&speed=2");
});

test("bad values from the address fall back to the defaults", () => {
  const s = decode("?fx=nope&a=zzz&speed=banana&shape=9&word=" + "X".repeat(40), EFFECTS);
  assert.equal(s.fx, "liquid");
  assert.equal(s.values.a, "#112233");
  assert.equal(s.values.speed, 1);
  assert.equal(s.values.shape, 3);           // clamped to the range
  assert.equal(String(s.values.word).length, 12);
});

test("ranges snap to their step", () => {
  const p = EFFECTS[0].params[1];
  assert.equal(parseValue(p, "1.234"), 1.25);
  assert.equal(parseValue(p, "-4"), 0);
});
