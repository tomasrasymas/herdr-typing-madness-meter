// Pure HUD renderer: state in, ANSI frame out.
//
// Every glyph used here is single-width, so a line's visible width equals
// its character count and horizontal shake can shift lines by plain offsets.

import type { Live } from "./game.ts";
import { tierColor, tierIndex } from "./tiers.ts";

export interface Segment {
  t: string;
  /** SGR parameters, e.g. "1;38;5;196". Empty = default style. */
  s?: string;
}

export type Line = Segment[];

export interface HudView {
  live: Live;
  /** Notice shown on the message row (achievement, combo break, status). */
  message: Line | null;
  shake: { dx: number; dy: number };
  width: number;
  height: number;
  /** Seed for the spark row, so frames differ while typing. */
  frame: number;
  /** Speed tier for the WPM color, shared with the border and tint. Defaults to the raw WPM's tier. */
  tier?: number;
}

const ESC = "\x1b[";

export function fg(n: number, bold = false): string {
  return `${bold ? "1;" : ""}38;5;${n}`;
}

export const DIM = "2";

/** SGR foreground for a WPM: gray below the first tier, else the tier's 24-bit color. */
/** Style for the WPM number and bar in a speed tier's color (grey for tier 0). */
export function wpmStyle(tier: number, bold = false): string {
  const { rgb } = tierColor(tier);
  const color = rgb ? `38;2;${rgb[0]};${rgb[1]};${rgb[2]}` : "38;5;250";
  return bold ? `1;${color}` : color;
}

function bar(fraction: number, width: number, style: string): Segment[] {
  const f = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(f * width);
  return [
    { t: "▕", s: DIM },
    { t: "█".repeat(filled), s: style },
    { t: "░".repeat(width - filled), s: fg(238) },
    { t: "▏", s: DIM },
  ];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function lineWidth(line: Line): number {
  return line.reduce((n, seg) => n + seg.t.length, 0);
}

/** Render a line shifted by dx and clipped to width. */
export function renderLine(line: Line, dx: number, width: number): string {
  let out = "";
  let col = 0;
  if (dx > 0) {
    out += " ".repeat(Math.min(dx, width));
    col = Math.min(dx, width);
  }
  let skip = dx < 0 ? -dx : 0;
  for (const seg of line) {
    let text = seg.t;
    if (skip) {
      const cut = Math.min(skip, text.length);
      text = text.slice(cut);
      skip -= cut;
    }
    if (!text) continue;
    const room = width - col;
    if (room <= 0) break;
    if (text.length > room) text = text.slice(0, room);
    out += seg.s ? `${ESC}${seg.s}m${text}${ESC}0m` : text;
    col += text.length;
  }
  return out;
}

/** `cells` columns of sparks whose density follows typing heat. */
export function sparkFill(heat: number, cells: number, seedBase: number): Segment[] {
  if (cells <= 0) return [];
  const glyphs = ["·", "✦", "✧", "*", "+", "˙"];
  const colors = [196, 202, 208, 214, 220, 226, 51, 201];
  const count = Math.floor(heat * cells * 0.35);
  const out: Segment[] = Array.from({ length: cells }, () => ({ t: " " }));
  let seed = (seedBase * 2654435761) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < count; i++) {
    const at = Math.floor(rand() * cells);
    out[at] = { t: glyphs[Math.floor(rand() * glyphs.length)], s: fg(colors[Math.floor(rand() * colors.length)], true) };
  }
  return out;
}

/** Append sparks to the free space after a line's text. */
function withSparks(line: Line, heat: number, width: number, seed: number): Line {
  const gap = 3;
  return [...line, { t: " ".repeat(gap) }, ...sparkFill(heat, width - lineWidth(line) - gap - 1, seed)];
}

export function hudLines(view: HudView): Line[] {
  const { live, width } = view;
  const wide = width >= 90;
  const tier = view.tier ?? tierIndex(live.wpm);
  const wpmS = wpmStyle(tier);
  const comboC = live.multiplier >= 4 ? 201 : live.multiplier >= 2.5 ? 208 : live.multiplier >= 1.5 ? 221 : 250;

  const wpmLine: Line = [
    { t: " " },
    { t: String(live.wpm).padStart(3), s: wpmStyle(tier, true) },
    { t: " WPM ", s: wpmS },
    ...bar(live.wpm / 100, wide ? 20 : 10, wpmS),
    { t: ` peak ${live.sessionPeakWpm}`, s: DIM },
    { t: "   COMBO ", s: fg(comboC) },
    { t: String(live.combo), s: fg(comboC, true) },
    { t: ` ×${live.multiplier.toFixed(1)}`, s: fg(comboC) },
  ];
  if (wide) wpmLine.push({ t: `   ACC ${Math.round(live.accuracy * 100)}%`, s: DIM });

  const levelLine: Line = [
    { t: " " },
    { t: `LV ${live.level}`, s: fg(141, true) },
    { t: ` ${live.rank} `, s: fg(141) },
    ...bar(live.levelSpan ? live.levelXp / live.levelSpan : 0, wide ? 20 : 10, fg(141)),
    { t: ` ${fmt(live.levelXp)}/${fmt(live.levelSpan)} XP`, s: DIM },
  ];
  if (wide) levelLine.push({ t: `   today ${fmt(live.today.chars)} chars · best ${live.today.bestWpm} wpm`, s: DIM });

  const message: Line = view.message ?? (
    live.idleMs > 5000
      ? [{ t: " waiting for keys… focus a pane and start typing", s: DIM }]
      : []
  );

  return [
    withSparks(wpmLine, live.heat, width, view.frame),
    withSparks(levelLine, live.heat, width, view.frame + 7919),
    message,
  ];
}

/** Full frame: cursor home, each row cleared, synchronized output. */
export function renderFrame(view: HudView): string {
  const lines = hudLines(view);
  const { width, height, shake } = view;
  const top = height >= lines.length + 2 ? 1 : 0;
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    const i = r - top - shake.dy;
    rows.push(i >= 0 && i < lines.length ? renderLine(lines[i], shake.dx, width) : "");
  }
  return `${ESC}?2026h${ESC}H${rows.map((r) => `${r}${ESC}K`).join("\r\n")}${ESC}J${ESC}?2026l`;
}
