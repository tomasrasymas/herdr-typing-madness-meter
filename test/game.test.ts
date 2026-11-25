import assert from "node:assert/strict";
import { test } from "node:test";
import { Game, emptyStats, levelForXp, multiplierFor, rankFor, streakDays, xpForLevel, dayKey } from "../src/game.ts";
import type { GameEvent } from "../src/game.ts";

const T0 = new Date(2026, 10, 25, 14, 0, 0).getTime();

/** Type `n` chars at a fixed interval, returning all events. */
function typeChars(g: Game, n: number, intervalMs: number, start = T0): { events: GameEvent[]; end: number } {
  const events: GameEvent[] = [];
  let t = start;
  for (let i = 0; i < n; i++) {
    events.push(...g.key("char", t));
    t += intervalMs;
  }
  return { events, end: t - intervalMs };
}

test("WPM: 100ms per char over 10s is 120 WPM", () => {
  const g = new Game();
  const { end } = typeChars(g, 101, 100);
  // 101 chars in the 10s window: (101 / 5) * (60000 / 10000) = 121.2
  assert.equal(g.wpm(end), 121);
});

test("WPM: chars older than the 10s window drop out", () => {
  const g = new Game();
  const { end } = typeChars(g, 50, 100);
  assert.equal(g.wpm(end + 20_000), 0);
});

test("WPM: short bursts use a 2s minimum span instead of spiking", () => {
  const g = new Game();
  const { end } = typeChars(g, 5, 10);
  // 5 chars in 40ms would be 1500 WPM; floored span gives 30.
  assert.equal(g.wpm(end), 30);
});

test("combo grows with steady typing and breaks after the gap", () => {
  const g = new Game();
  const { end } = typeChars(g, 40, 150);
  assert.equal(g.combo, 40);
  const events = g.tick(end + 1300);
  assert.deepEqual(events, [{ kind: "combo_break", combo: 40 }]);
  assert.equal(g.combo, 0);
});

test("a key after the gap starts a new combo and reports the break", () => {
  const g = new Game();
  const { end } = typeChars(g, 10, 100);
  const events = g.key("char", end + 5000);
  assert.ok(events.some((e) => e.kind === "combo_break" && e.combo === 10));
  assert.equal(g.combo, 1);
});

test("combo milestone fires every 25 chars by default", () => {
  const g = new Game();
  const { events } = typeChars(g, 100, 100);
  const combos = events.filter((e) => e.kind === "milestone" && e.reason === "combo").map((e) => (e as any).value);
  assert.deepEqual(combos, [25, 50, 75, 100]);
});

test("combo milestone interval is configurable", () => {
  const g = new Game(undefined, { comboGapMs: 1200, comboMilestone: 40 });
  const { events } = typeChars(g, 100, 100);
  const combos = events.filter((e) => e.kind === "milestone" && e.reason === "combo").map((e) => (e as any).value);
  assert.deepEqual(combos, [40, 80]);
});

test("backspace lowers accuracy but keeps the combo", () => {
  const g = new Game();
  typeChars(g, 9, 100);
  g.key("backspace", T0 + 1000);
  assert.equal(g.combo, 9);
  assert.equal(g.accuracy(), 0.9);
});

test("other keys count as keys but not chars", () => {
  const g = new Game();
  g.key("other", T0);
  assert.equal(g.stats.totalKeys, 1);
  assert.equal(g.stats.totalChars, 0);
  assert.equal(g.combo, 0);
});

test("XP uses the combo multiplier", () => {
  assert.equal(multiplierFor(0), 1);
  assert.equal(multiplierFor(25), 1.5);
  assert.equal(multiplierFor(100), 3);
  assert.equal(multiplierFor(10_000), 5);
  const g = new Game();
  typeChars(g, 50, 100);
  // 24 chars at 1x, 25 at 1.5x, 1 at 2x = 24 + 37.5 + 2 = 63.5
  assert.equal(g.stats.totalXp, 63);
});

test("scoring is configurable: combo step and max multiplier", () => {
  assert.equal(multiplierFor(20, 10, 5), 2);
  assert.equal(multiplierFor(1000, 10, 3), 3);
  const g = new Game(undefined, { comboStep: 10, maxMultiplier: 2 });
  typeChars(g, 40, 100);
  // 9 chars ×1, 10 ×1.5, 21 ×2 (capped) = 9 + 15 + 42 = 66
  assert.equal(g.stats.totalXp, 66);
});

test("level curve and ranks", () => {
  assert.equal(xpForLevel(3), 900);
  assert.equal(levelForXp(899), 2);
  assert.equal(levelForXp(900), 3);
  assert.equal(rankFor(0), "Hunt & Peck");
  assert.equal(rankFor(12), "Combo Crusher");
  assert.equal(rankFor(99), "Keyboard Demon");
});

test("level-up milestone fires when XP crosses a level", () => {
  const g = new Game();
  const { events } = typeChars(g, 120, 100);
  assert.ok(events.some((e) => e.kind === "milestone" && e.reason === "level" && e.value === 1));
});

test("achievements unlock once", () => {
  const g = new Game();
  const { events } = typeChars(g, 150, 100);
  const firsts = events.filter((e) => e.kind === "achievement" && e.id === "first_steps");
  assert.equal(firsts.length, 1);
  assert.ok(g.stats.achievements.first_steps);
  assert.ok(g.stats.achievements.combo_100);
  assert.ok(g.stats.achievements.wpm_60);
});

test("WPM records need enough chars in the window", () => {
  const g = new Game();
  typeChars(g, 10, 50);
  assert.equal(g.stats.bestWpm, 0);
  typeChars(g, 40, 50, T0 + 500);
  assert.ok(g.stats.bestWpm > 0);
});

test("day stats are keyed by local date", () => {
  const g = new Game();
  typeChars(g, 3, 100);
  assert.equal(g.stats.days[dayKey(T0)].chars, 3);
});

test("streak counts consecutive 500-char days ending today or yesterday", () => {
  const stats = emptyStats();
  const day = (offset: number) => {
    const d = new Date(T0);
    d.setDate(d.getDate() - offset);
    return dayKey(d.getTime());
  };
  for (const o of [1, 2, 3]) stats.days[day(o)] = { chars: 600, keys: 600, xp: 0, bestWpm: 0, bestCombo: 0 };
  assert.equal(streakDays(stats, T0), 3);
  stats.days[day(0)] = { chars: 700, keys: 700, xp: 0, bestWpm: 0, bestCombo: 0 };
  assert.equal(streakDays(stats, T0), 4);
  stats.days[day(2)].chars = 10;
  assert.equal(streakDays(stats, T0), 2);
});

test("heat rises while typing and decays when idle", () => {
  const g = new Game();
  const { end } = typeChars(g, 30, 60);
  const hot = g.live(end).heat;
  assert.ok(hot > 0.5, `heat ${hot}`);
  assert.ok(g.live(end + 3000).heat < 0.05);
});
