import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TIER_COLORS,
  DEFAULT_TIER_WPM,
  hexToRgb,
  setTierColors,
  setTierWpm,
  tierColor,
  tierFor,
  tierIndex,
  tierWpmMins,
  tintAmount,
  idleFade,
  TINT_FADE_DELAY_MS,
  TINT_FADE_MS,
  COLOR_IDLE_MS,
  speedTier,
} from "../src/tiers.ts";
import { wpmStyle } from "../src/render.ts";

test("custom tier colors drive the border hex, tint rgb and HUD style", () => {
  setTierColors(["#000001", "#000002", "#000003", "#Ff0000"]);
  assert.equal(tierColor(4).hex, "#ff0000");
  assert.deepEqual(tierColor(4).rgb, [255, 0, 0]);
  assert.equal(tierColor(0).hex, null);
  assert.equal(wpmStyle(4, true), "1;38;2;255;0;0");
  assert.equal(wpmStyle(0), "38;5;250");
  setTierColors(["red", "#00ff00", "#0000ff", "#ffffff"]); // not hex: ignored
  assert.equal(tierColor(1).hex, "#000001");
  setTierColors(DEFAULT_TIER_COLORS);
  assert.deepEqual(hexToRgb("#5fd787"), [95, 215, 135]);
});

test("default tiers start at 25 WPM", () => {
  assert.deepEqual(DEFAULT_TIER_WPM, [25, 45, 65, 85]);
  assert.equal(tierIndex(24), 0);
  assert.equal(tierIndex(25), 1);
  assert.equal(tierIndex(50), 2);
  assert.equal(tierIndex(70), 3);
  assert.equal(tierIndex(90), 4);
});

test("tiers drop only after falling 4 WPM below the floor", () => {
  assert.equal(tierFor(43, 2), 2); // 45 floor, within 4
  assert.equal(tierFor(40, 2), 1);
  assert.equal(tierFor(90, 1), 4); // going up is immediate
});

test("tint reaches full strength at the top tier even without a burst", () => {
  assert.equal(tintAmount(85, 0), 1);
  assert.ok(Math.abs(tintAmount(42.5, 0) - 0.5) < 1e-9);
  assert.equal(tintAmount(10, 0.9), 0.9);
});

test("custom thresholds from config, malformed ones ignored", () => {
  setTierWpm([10, 20, 30, 40]);
  assert.deepEqual(tierWpmMins(), [10, 20, 30, 40]);
  setTierWpm([50, 40, 30, 20]); // not increasing
  setTierWpm("fast"); // wrong type
  assert.deepEqual(tierWpmMins(), [10, 20, 30, 40]);
  setTierWpm(DEFAULT_TIER_WPM);
});

test("the tint holds, then fades smoothly, ending as the border switches off", () => {
  assert.equal(TINT_FADE_DELAY_MS + TINT_FADE_MS, COLOR_IDLE_MS);
  assert.equal(idleFade(0), 1);
  assert.equal(idleFade(TINT_FADE_DELAY_MS), 1);
  assert.equal(idleFade(TINT_FADE_DELAY_MS + TINT_FADE_MS), 0);
  assert.equal(idleFade(60_000), 0);
  const mid = idleFade(TINT_FADE_DELAY_MS + TINT_FADE_MS / 2);
  assert.ok(Math.abs(mid - 0.5) < 1e-9);
  // Never jumps: each 100ms frame changes the fade by well under a third.
  let prev = 1;
  for (let t = 0; t <= TINT_FADE_DELAY_MS + TINT_FADE_MS; t += 100) {
    const f = idleFade(t);
    assert.ok(f <= prev && prev - f < 0.15, `fade at ${t}ms: ${prev} -> ${f}`);
    prev = f;
  }
});

test("one speed tier for every color: follows speed, drops to 0 when idle", () => {
  assert.equal(speedTier(90, 0, 0), 4);
  assert.equal(speedTier(83, 500, 4), 4); // hysteresis: holds red just under 85
  assert.equal(speedTier(70, 500, 4), 3);
  assert.equal(speedTier(90, COLOR_IDLE_MS, 4), 4);
  assert.equal(speedTier(90, COLOR_IDLE_MS + 1, 4), 0);
});
