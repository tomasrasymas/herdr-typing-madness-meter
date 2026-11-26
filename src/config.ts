// User config: $HERDR_PLUGIN_CONFIG_DIR/config.json (all keys optional).

import fs from "node:fs";
import path from "node:path";

export interface Config {
  /** Bundle ids of terminal apps whose keystrokes count. Empty = built-in list. */
  terminals: string[];
  /** Count keys no matter which app is frontmost. */
  allowAnyApp: boolean;
  /** Wiggle the typed pane's border on milestones. */
  jiggle: boolean;
  /** Border wiggle size in cells. */
  jiggleCells: number;
  /** Show "87 wpm x120" on the typed pane's border while typing. */
  badge: boolean;
  /** Toast on achievements and level-ups. */
  toasts: boolean;
  /** Move the HUD to the bottom of whichever tab becomes active. */
  follow: boolean;
  /** Color the focused pane's border by WPM (rewrites herdr's ui.accent). */
  borderColor: boolean;
  /** iTerm2 only: tint the herdr window's background as you type faster. */
  itermTint: boolean;
  /** iTerm2 only: flash the background on milestones. */
  itermFlash: boolean;
  /** iTerm2 only: show a shaking badge on milestones. */
  itermBadge: boolean;
  /** Rows the HUD asks for when it opens. */
  hudHeight: number;
  /** Max gap between keys before the combo breaks. */
  comboGapMs: number;
  /** Combo milestone (flash, badge, border wiggle) every this many keys. */
  comboMilestone: number;
  /** Minimum WPM for the green, yellow, orange and red speed tiers. */
  tierWpm: number[];
  /** Hex colors for those four tiers (border, iTerm2 tint, HUD WPM). */
  tierColors: string[];
  /** Every this many combo keys add ×0.5 to the XP multiplier. */
  comboStep: number;
  /** Cap for the XP multiplier. */
  maxMultiplier: number;
}

export const DEFAULT_CONFIG: Config = {
  terminals: [],
  allowAnyApp: false,
  jiggle: true,
  jiggleCells: 1,
  badge: true,
  toasts: true,
  follow: true,
  borderColor: true,
  itermTint: true,
  itermFlash: true,
  itermBadge: true,
  hudHeight: 4,
  comboGapMs: 1200,
  comboMilestone: 25,
  tierWpm: [25, 45, 65, 85],
  tierColors: ["#5fd787", "#ffd75f", "#ff8700", "#ff3030"],
  comboStep: 25,
  maxMultiplier: 5,
};

export function configDir(): string {
  return process.env.HERDR_PLUGIN_CONFIG_DIR ?? path.join(process.cwd(), ".config");
}

export function stateDir(): string {
  return process.env.HERDR_PLUGIN_STATE_DIR ?? path.join(process.cwd(), ".state");
}

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(configDir(), "config.json"), "utf8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
