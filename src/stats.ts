// Stats popup entrypoint: a static summary that closes on any key.

import { ACHIEVEMENTS, dayKey, levelForXp, rankFor, streakDays } from "./game.ts";
import type { Stats } from "./game.ts";
import { DIM, fg, renderLine } from "./render.ts";
import type { Line } from "./render.ts";
import { loadStats } from "./store.ts";

const BARS = "▁▂▃▄▅▆▇█";
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function statsLines(stats: Stats, now: number): Line[] {
  const level = levelForXp(stats.totalXp);
  const days: { key: string; chars: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d.getTime());
    days.push({ key, chars: stats.days[key]?.chars ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.chars));
  // Each day is a 3-cell column: a 2-cell bar over its 2-digit day number.
  const bars = days
    .map((d) => (d.chars ? BARS[Math.min(7, Math.floor((d.chars / max) * 7.999))].repeat(2) : "  "))
    .join(" ");
  const labels = days.map((d) => d.key.slice(-2)).join(" ");
  const today = stats.days[dayKey(now)];
  const unlocked = ACHIEVEMENTS.filter((a) => stats.achievements[a.id]).length;

  const lines: Line[] = [
    [{ t: " TYPING MADNESS METER", s: fg(201, true) }, { t: " · stats", s: DIM }],
    [],
    [
      { t: ` Level ${level}`, s: fg(141, true) },
      { t: ` · ${rankFor(level)}`, s: fg(141) },
      { t: `    XP ${fmt(stats.totalXp)}`, s: DIM },
    ],
    [
      { t: " Best WPM " },
      { t: String(stats.bestWpm), s: fg(220, true) },
      { t: "   Best combo " },
      { t: fmt(stats.bestCombo), s: fg(208, true) },
      { t: "   Streak " },
      { t: `${streakDays(stats, now)} days`, s: fg(114, true) },
    ],
    [
      { t: ` Total ${fmt(stats.totalChars)} chars`, s: DIM },
      { t: `   Today ${fmt(today?.chars ?? 0)} chars · best ${today?.bestWpm ?? 0} wpm`, s: DIM },
    ],
    [],
    [{ t: " Last 14 days", s: fg(250, true) }, { t: `  (max ${fmt(max)} chars/day)`, s: DIM }],
    [{ t: ` ${bars}`, s: fg(114) }],
    [{ t: ` ${labels}`, s: DIM }],
    [],
    [{ t: ` Achievements ${unlocked}/${ACHIEVEMENTS.length}`, s: fg(250, true) }],
  ];
  for (const a of ACHIEVEMENTS) {
    const at = stats.achievements[a.id];
    lines.push(
      at
        ? [
            { t: " ★ ", s: fg(220, true) },
            { t: a.title, s: fg(220, true) },
            { t: ` — ${a.description}  ${dayKey(at)}`, s: DIM },
          ]
        : [{ t: ` ☆ ${a.title} — ${a.description}`, s: DIM }],
    );
  }
  return lines;
}

function draw() {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  const lines = statsLines(loadStats(), Date.now());
  lines.push([], [{ t: " press any key to close", s: DIM }]);
  const rows = lines.slice(0, height).map((l) => `${renderLine(l, 0, width)}\x1b[K`);
  process.stdout.write(`\x1b[H${rows.join("\r\n")}\x1b[J`);
}

if (import.meta.main) {
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  const quit = () => {
    process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
    process.exit(0);
  };
  draw();
  process.stdout.on("resize", draw);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.once("data", quit);
  process.on("SIGHUP", quit);
  process.on("SIGTERM", quit);
}
