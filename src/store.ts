// Persistence for stats and the open HUD pane id, in HERDR_PLUGIN_STATE_DIR.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./config.ts";
import { emptyStats } from "./game.ts";
import type { Stats } from "./game.ts";

const statsFile = () => path.join(stateDir(), "stats.json");
const hudFile = () => path.join(stateDir(), "hud.json");

function writeAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function loadStats(): Stats {
  try {
    const raw = JSON.parse(fs.readFileSync(statsFile(), "utf8"));
    if (raw?.version === 1) return { ...emptyStats(), ...raw };
  } catch {}
  return emptyStats();
}

export function saveStats(stats: Stats) {
  writeAtomic(statsFile(), JSON.stringify(stats, null, 2));
}

export function resetStats() {
  saveStats(emptyStats());
}

export function loadHudPaneId(): string | null {
  try {
    return JSON.parse(fs.readFileSync(hudFile(), "utf8")).pane_id ?? null;
  } catch {
    return null;
  }
}

export function saveHudPaneId(paneId: string | null) {
  if (paneId) writeAtomic(hudFile(), JSON.stringify({ pane_id: paneId, pid: process.pid }));
  else fs.rmSync(hudFile(), { force: true });
}
