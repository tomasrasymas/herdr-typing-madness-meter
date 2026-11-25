// Event hook for pane.closed, tab.closed and workspace.closed.
//
// herdr kills the HUD along with its tab or workspace, and the HUD can't tell
// that apart from its own pane being closed (both are a hangup), so it keeps
// its record (hud.json) on any hangup and this hook sorts it out:
// - pane.closed for the HUD's own pane: closed on purpose, forget it.
// - tab.closed / workspace.closed for the HUD's home: it died as collateral,
//   reopen it under the pane that now has focus.
// Closing a tab emits only tab.closed, never pane.closed for its panes.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "../config.ts";
import { listPanes } from "../herdr.ts";
import { lostHome, openHud, paneAlive, pidAlive } from "../open.ts";
import { loadHud, saveHud } from "../store.ts";

const LOCK = path.join(stateDir(), "closed-hook.lock");
const LOCK_STALE_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One hook at a time: a workspace close can fire several at once. */
function lock(): boolean {
  try {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(LOCK).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(LOCK, { force: true });
        return lock();
      }
    } catch {}
    return false;
  }
}

/** Wait up to `ms` for a process to exit; true if it did. */
async function waitExit(pid: number | undefined, ms: number): Promise<boolean> {
  for (let waited = 0; pidAlive(pid); waited += 100) {
    if (waited >= ms) return false;
    await sleep(100);
  }
  return true;
}

/** The HUD's pane closed. Forget it, unless the HUD lives on (a move that changed its id). */
async function onPaneClosed(paneId: string) {
  const rec = loadHud();
  if (rec?.pane_id !== paneId) return;
  if (!(await waitExit(rec.pid, 3000))) return;
  if (loadHud()?.pane_id === paneId) saveHud(null);
}

/** The HUD's tab or workspace closed with it: reopen it under the focused pane. */
async function onHomeClosed(kind: string, data: { tab_id?: string; workspace_id?: string }) {
  if (!loadHud()) return;
  // A HUD moving between tabs saves its new home right after the move; give
  // that a moment so a tab it just left isn't mistaken for its home.
  await sleep(300);
  if (!lock()) return;
  try {
    const rec = loadHud();
    if (!rec || !lostHome(rec, kind, data)) return;
    if (await paneAlive(rec.pane_id)) return;
    const target = (await listPanes()).find((p) => p.focused)?.pane_id;
    if (!target) return;
    const paneId = await openHud(target);
    console.log(`reopened Typing Madness Meter ${paneId} under ${target}`);
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

async function main() {
  const ev = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON ?? "{}");
  const kind = String(ev.event ?? "");
  const data = ev.data ?? {};
  if (kind === "pane_closed") await onPaneClosed(String(data.pane_id ?? ""));
  else await onHomeClosed(kind, data);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
