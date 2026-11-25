// Opening and probing the HUD pane, shared by the toggle action and the
// reopen hook.

import { call } from "./herdr.ts";
import { saveHud } from "./store.ts";
import type { HudRecord } from "./store.ts";

const pluginId = process.env.HERDR_PLUGIN_ID ?? "typing-madness-meter";

export async function paneAlive(paneId: string): Promise<boolean> {
  try {
    await call("pane.get", { pane_id: paneId });
    return true;
  } catch {
    return false;
  }
}

interface OpenedPane {
  pane_id: string;
  tab_id?: string;
  workspace_id?: string;
}

/** Open the HUD in a split under `target` without taking focus, and record it. */
export async function openHud(target: string): Promise<string> {
  const r = await call<{ plugin_pane: { pane: OpenedPane } }>("plugin.pane.open", {
    plugin_id: pluginId,
    entrypoint: "hud",
    placement: "split",
    direction: "down",
    target_pane_id: target,
    focus: false,
  });
  const pane = r.plugin_pane.pane;
  // The HUD process rewrites this with its own pid once it starts.
  saveHud({ pane_id: pane.pane_id, tab_id: pane.tab_id ?? null, workspace_id: pane.workspace_id ?? null }, 0);
  return pane.pane_id;
}

export function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

/** Did this event take the HUD's home with it? */
export function lostHome(rec: HudRecord, kind: string, data: { tab_id?: string; workspace_id?: string }): boolean {
  if (kind === "tab_closed") return !!rec.tab_id && data.tab_id === rec.tab_id;
  if (kind === "workspace_closed") return !!rec.workspace_id && data.workspace_id === rec.workspace_id;
  return false;
}
