// Action: open the HUD under the focused pane, or close it if it is open.

import { call, listPanes } from "../herdr.ts";
import { loadHudPaneId, saveHudPaneId } from "../store.ts";

const pluginId = process.env.HERDR_PLUGIN_ID ?? "typing-madness-meter";

async function hudAlive(paneId: string): Promise<boolean> {
  try {
    await call("pane.get", { pane_id: paneId });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const existing = loadHudPaneId();
  if (existing && (await hudAlive(existing))) {
    await call("plugin.pane.close", { pane_id: existing });
    saveHudPaneId(null);
    console.log(`closed HUD ${existing}`);
    return;
  }
  saveHudPaneId(null);

  const target = process.env.HERDR_PANE_ID ?? (await listPanes()).find((p) => p.focused)?.pane_id;
  if (!target) throw new Error("no focused pane to attach the HUD to");

  const r = await call<{ plugin_pane: { pane: { pane_id: string } } }>("plugin.pane.open", {
    plugin_id: pluginId,
    entrypoint: "hud",
    placement: "split",
    direction: "down",
    target_pane_id: target,
    focus: false,
  });
  const paneId = r.plugin_pane.pane.pane_id;
  saveHudPaneId(paneId);
  console.log(`opened HUD ${paneId} under ${target}`);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
