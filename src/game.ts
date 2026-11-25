// Pure typing game engine: no I/O, time is always passed in.

export type KeyClass = "char" | "backspace" | "enter" | "other";

export interface DayStats {
  chars: number;
  keys: number;
  xp: number;
  bestWpm: number;
  bestCombo: number;
}

export interface Stats {
  version: 1;
  totalChars: number;
  totalKeys: number;
  totalXp: number;
  bestWpm: number;
  bestCombo: number;
  days: Record<string, DayStats>;
  /** Achievement id -> unlock time (ms since epoch). */
  achievements: Record<string, number>;
}

export function emptyStats(): Stats {
  return { version: 1, totalChars: 0, totalKeys: 0, totalXp: 0, bestWpm: 0, bestCombo: 0, days: {}, achievements: {} };
}

export type GameEvent =
  | { kind: "milestone"; reason: "combo" | "level" | "record"; value: number }
  | { kind: "achievement"; id: string; title: string; description: string }
  | { kind: "combo_break"; combo: number };

export interface Live {
  wpm: number;
  sessionPeakWpm: number;
  combo: number;
  multiplier: number;
  accuracy: number;
  level: number;
  rank: string;
  /** XP earned inside the current level, and the XP the level needs. */
  levelXp: number;
  levelSpan: number;
  /** 0..1 typing intensity, drives the HUD shake. */
  heat: number;
  today: DayStats;
  idleMs: number;
}

export interface GameConfig {
  /** Max gap between keys before the combo breaks. */
  comboGapMs: number;
  /** A combo milestone (flash, badge, wiggle) fires every this many keys. */
  comboMilestone: number;
  /** Every this many combo keys add ×0.5 to the XP multiplier. */
  comboStep: number;
  /** Cap for the XP multiplier. */
  maxMultiplier: number;
}

export const DEFAULT_GAME_CONFIG: GameConfig = { comboGapMs: 1200, comboMilestone: 25, comboStep: 25, maxMultiplier: 5 };

const WPM_WINDOW_MS = 10_000;
const WPM_MIN_SPAN_MS = 2_000;
/** Chars needed inside the window before a WPM counts toward records. */
const WPM_QUALIFY_CHARS = 25;
const ACCURACY_WINDOW = 200;
const HEAT_PER_CHAR = 0.07;
const HEAT_TAU_MS = 700;

export const RANKS: [number, string][] = [
  [0, "Hunt & Peck"],
  [3, "Home Row Hero"],
  [6, "Keyboard Warrior"],
  [10, "Combo Crusher"],
  [15, "Terminal Speedster"],
  [22, "Clackmaster"],
  [30, "Keyboard Demon"],
];

/** Total XP required to reach `level`. */
export function xpForLevel(level: number): number {
  return 100 * level * level;
}

export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

export function rankFor(level: number): string {
  let name = RANKS[0][1];
  for (const [min, rank] of RANKS) if (level >= min) name = rank;
  return name;
}

export function multiplierFor(combo: number, step = 25, max = 5): number {
  return Math.min(Math.max(1, max), 1 + Math.floor(combo / Math.max(1, step)) * 0.5);
}

export function dayKey(t: number): string {
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function emptyDay(): DayStats {
  return { chars: 0, keys: 0, xp: 0, bestWpm: 0, bestCombo: 0 };
}

interface AchievementDef {
  id: string;
  title: string;
  description: string;
  check: (g: Game, t: number) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_steps", title: "First Steps", description: "Type 100 characters", check: (g) => g.stats.totalChars >= 100 },
  { id: "wpm_60", title: "Cruising", description: "Reach 60 WPM", check: (g) => g.stats.bestWpm >= 60 },
  { id: "wpm_100", title: "Ton Up", description: "Reach 100 WPM", check: (g) => g.stats.bestWpm >= 100 },
  { id: "wpm_140", title: "Ludicrous Speed", description: "Reach 140 WPM", check: (g) => g.stats.bestWpm >= 140 },
  { id: "combo_100", title: "Combo Starter", description: "Hit a 100 combo", check: (g) => g.stats.bestCombo >= 100 },
  { id: "combo_500", title: "Unbroken", description: "Hit a 500 combo", check: (g) => g.stats.bestCombo >= 500 },
  { id: "combo_1000", title: "Flow State", description: "Hit a 1000 combo", check: (g) => g.stats.bestCombo >= 1000 },
  { id: "day_10k", title: "Marathon", description: "Type 10,000 characters in one day", check: (g, t) => (g.stats.days[dayKey(t)]?.chars ?? 0) >= 10_000 },
  { id: "streak_7", title: "Habit Forming", description: "Type 500+ characters 7 days in a row", check: (g, t) => streakDays(g.stats, t) >= 7 },
  {
    id: "night_owl",
    title: "Night Owl",
    description: "Type 200 characters between 2 and 5 AM",
    check: (g, t) => {
      const h = new Date(t).getHours();
      return h >= 2 && h < 5 && g.nightChars >= 200;
    },
  },
];

/** Consecutive days (ending today or yesterday) with at least 500 chars. */
export function streakDays(stats: Stats, t: number): number {
  const day = new Date(t);
  day.setHours(12, 0, 0, 0);
  if ((stats.days[dayKey(day.getTime())]?.chars ?? 0) < 500) day.setDate(day.getDate() - 1);
  let streak = 0;
  while ((stats.days[dayKey(day.getTime())]?.chars ?? 0) >= 500) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

export class Game {
  stats: Stats;
  config: GameConfig;
  combo = 0;
  sessionPeakWpm = 0;
  nightChars = 0;
  private charTimes: number[] = [];
  private accuracyWindow: boolean[] = [];
  private lastKeyAt = 0;
  private heat = 0;
  private heatAt = 0;
  private xpFraction = 0;

  constructor(stats: Stats = emptyStats(), config: Partial<GameConfig> = {}) {
    this.stats = stats;
    this.config = { ...DEFAULT_GAME_CONFIG, ...config };
  }

  key(cls: KeyClass, t: number): GameEvent[] {
    const events: GameEvent[] = [];
    events.push(...this.tick(t));
    const day = (this.stats.days[dayKey(t)] ??= emptyDay());
    this.stats.totalKeys++;
    day.keys++;
    this.lastKeyAt = t;

    if (cls === "other") return events;

    if (cls === "backspace") {
      this.pushAccuracy(false);
      return events;
    }

    // char or enter: a productive keystroke.
    this.pushAccuracy(true);
    this.combo++;
    this.charTimes.push(t);
    this.stats.totalChars++;
    day.chars++;
    const h = new Date(t).getHours();
    if (h >= 2 && h < 5) this.nightChars++;

    this.decayHeat(t);
    this.heat = Math.min(1, this.heat + HEAT_PER_CHAR);

    const levelBefore = levelForXp(this.stats.totalXp);
    this.xpFraction += multiplierFor(this.combo, this.config.comboStep, this.config.maxMultiplier) * this.accuracy();
    const gained = Math.floor(this.xpFraction);
    this.xpFraction -= gained;
    this.stats.totalXp += gained;
    day.xp += gained;
    const levelAfter = levelForXp(this.stats.totalXp);
    if (levelAfter > levelBefore) events.push({ kind: "milestone", reason: "level", value: levelAfter });

    if (this.combo % Math.max(1, this.config.comboMilestone) === 0) events.push({ kind: "milestone", reason: "combo", value: this.combo });
    if (this.combo > day.bestCombo) day.bestCombo = this.combo;
    if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;

    const wpm = this.wpm(t);
    if (this.qualifies(t)) {
      if (wpm > this.sessionPeakWpm) this.sessionPeakWpm = wpm;
      if (wpm > day.bestWpm) day.bestWpm = wpm;
      if (wpm > this.stats.bestWpm) {
        // Only celebrate records that move by at least 5 WPM to avoid spam.
        if (Math.floor(wpm / 5) > Math.floor(this.stats.bestWpm / 5) && this.stats.bestWpm > 0) {
          events.push({ kind: "milestone", reason: "record", value: wpm });
        }
        this.stats.bestWpm = wpm;
      }
    }

    events.push(...this.checkAchievements(t));
    return events;
  }

  /** Advance time without a key: breaks stale combos. */
  tick(t: number): GameEvent[] {
    if (this.combo > 0 && t - this.lastKeyAt > this.config.comboGapMs) {
      const combo = this.combo;
      this.combo = 0;
      return [{ kind: "combo_break", combo }];
    }
    return [];
  }

  wpm(t: number): number {
    while (this.charTimes.length && t - this.charTimes[0] > WPM_WINDOW_MS) this.charTimes.shift();
    const n = this.charTimes.length;
    if (n === 0) return 0;
    const span = Math.min(WPM_WINDOW_MS, Math.max(WPM_MIN_SPAN_MS, t - this.charTimes[0]));
    return Math.round((n / 5) * (60_000 / span));
  }

  accuracy(): number {
    const n = this.accuracyWindow.length;
    if (n === 0) return 1;
    return this.accuracyWindow.filter(Boolean).length / n;
  }

  live(t: number): Live {
    this.decayHeat(t);
    const level = levelForXp(this.stats.totalXp);
    const base = xpForLevel(level);
    return {
      wpm: this.wpm(t),
      sessionPeakWpm: this.sessionPeakWpm,
      combo: this.combo,
      multiplier: multiplierFor(this.combo, this.config.comboStep, this.config.maxMultiplier),
      accuracy: this.accuracy(),
      level,
      rank: rankFor(level),
      levelXp: this.stats.totalXp - base,
      levelSpan: xpForLevel(level + 1) - base,
      heat: this.heat,
      today: this.stats.days[dayKey(t)] ?? emptyDay(),
      idleMs: this.lastKeyAt ? t - this.lastKeyAt : Infinity,
    };
  }

  private qualifies(t: number): boolean {
    this.wpm(t);
    return this.charTimes.length >= WPM_QUALIFY_CHARS;
  }

  private pushAccuracy(ok: boolean) {
    this.accuracyWindow.push(ok);
    if (this.accuracyWindow.length > ACCURACY_WINDOW) this.accuracyWindow.shift();
  }

  private decayHeat(t: number) {
    if (this.heatAt) this.heat *= Math.exp(-(t - this.heatAt) / HEAT_TAU_MS);
    this.heatAt = t;
  }

  private checkAchievements(t: number): GameEvent[] {
    const out: GameEvent[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.stats.achievements[a.id]) continue;
      if (a.check(this, t)) {
        this.stats.achievements[a.id] = t;
        out.push({ kind: "achievement", id: a.id, title: a.title, description: a.description });
      }
    }
    return out;
  }
}
