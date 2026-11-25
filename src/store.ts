// Persistence for stats and the open HUD's location, in HERDR_PLUGIN_STATE_DIR.

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

/** Where the open HUD lives. Kept after its tab closes so a hook can reopen it. */
export interface HudRecord {
  pane_id: string;
  tab_id?: string | null;
  workspace_id?: string | null;
  pid?: number;
}

export function loadHud(): HudRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(hudFile(), "utf8"));
    return typeof raw?.pane_id === "string" ? raw : null;
  } catch {
    return null;
  }
}

export function saveHud(rec: Omit<HudRecord, "pid"> | null, pid = process.pid) {
  if (rec) writeAtomic(hudFile(), JSON.stringify({ ...rec, pid }));
  else fs.rmSync(hudFile(), { force: true });
}
