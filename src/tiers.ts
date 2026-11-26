// Speed tiers shared by the HUD's WPM color, the focused-pane border color
// and the iTerm2 background tint. Tier 0 = "not fast yet" (no effect);
// tiers 1-4 are green, yellow, orange and red by default.

export type RGB = [number, number, number];

export interface TierColor {
  hex: string | null;
  rgb: RGB | null;
}

/** Minimum WPM for tiers 1..4. */
export const DEFAULT_TIER_WPM = [25, 45, 65, 85];
/** Colors for tiers 1..4. */
export const DEFAULT_TIER_COLORS = ["#5fd787", "#ffd75f", "#ff8700", "#ff3030"];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildColors(hexes: string[]): TierColor[] {
  return [{ hex: null, rgb: null }, ...hexes.map((hex) => ({ hex: hex.toLowerCase(), rgb: hexToRgb(hex) }))];
}

let tierWpm = DEFAULT_TIER_WPM;
let colors = buildColors(DEFAULT_TIER_COLORS);

/** Override the thresholds (from config). Ignores malformed input. */
export function setTierWpm(mins: unknown) {
  if (
    Array.isArray(mins) &&
    mins.length === 4 &&
    mins.every((n, i) => typeof n === "number" && n > 0 && (i === 0 || n > mins[i - 1]))
  ) {
    tierWpm = mins as number[];
  }
}

/** Override the four tier colors (from config). Ignores malformed input. */
export function setTierColors(hexes: unknown) {
  if (Array.isArray(hexes) && hexes.length === 4 && hexes.every((h) => typeof h === "string" && HEX.test(h))) {
    colors = buildColors(hexes as string[]);
  }
}

export function tierWpmMins(): number[] {
  return tierWpm;
}

export function tierColor(tier: number): TierColor {
  return colors[Math.max(0, Math.min(colors.length - 1, tier))];
}

/** Tier for a WPM with no hysteresis. */
export function tierIndex(wpm: number, mins = tierWpm): number {
  let tier = 0;
  for (let i = 0; i < mins.length; i++) if (wpm >= mins[i]) tier = i + 1;
  return tier;
}

const HYSTERESIS_WPM = 4;

/** Tier for a WPM, dropping a tier only once WPM falls 4 below its floor. */
export function tierFor(wpm: number, current: number, mins = tierWpm): number {
  const tier = tierIndex(wpm, mins);
  if (tier < current && wpm >= mins[current - 1] - HYSTERESIS_WPM) return current;
  return tier;
}

/** Speed colors (border and tint) switch off this long after the last key. */
export const COLOR_IDLE_MS = 6000;
/** The tint eases out over the last stretch of that, so it ends with the border. */
export const TINT_FADE_MS = 2500;
export const TINT_FADE_DELAY_MS = COLOR_IDLE_MS - TINT_FADE_MS;

/** 1 while typing, easing smoothly to 0 once you stop. */
export function idleFade(idleMs: number): number {
  if (idleMs <= TINT_FADE_DELAY_MS) return 1;
  const x = Math.min(1, (idleMs - TINT_FADE_DELAY_MS) / TINT_FADE_MS);
  return 1 - x * x * (3 - 2 * x); // smoothstep, reversed
}

/**
 * The one speed tier the HUD's WPM color, the border and the tint all show:
 * it follows your speed (with hysteresis) and drops to 0 once you've been
 * idle for COLOR_IDLE_MS.
 */
export function speedTier(wpm: number, idleMs: number, current: number): number {
  return idleMs > COLOR_IDLE_MS ? 0 : tierFor(wpm, current);
}

/** How strong the background tint is: typing burst or sustained speed, whichever is higher. */
export function tintAmount(wpm: number, heat: number, mins = tierWpm): number {
  return Math.min(1, Math.max(heat, wpm / mins[mins.length - 1]));
}
