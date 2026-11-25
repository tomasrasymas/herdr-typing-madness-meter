// Action: open the HUD under the focused pane, or close it if it is open.

import { call, listPanes } from "../herdr.ts";
import { openHud, paneAlive } from "../open.ts";
import { loadHud, saveHud } from "../store.ts";

async function main() {
  const existing = loadHud()?.pane_id;
  // Clear the record first: a closed HUD with no record stays closed.
  saveHud(null);
  if (existing && (await paneAlive(existing))) {
    await call("plugin.pane.close", { pane_id: existing });
    console.log(`closed Typing Madness Meter ${existing}`);
    return;
  }

  const target = process.env.HERDR_PANE_ID ?? (await listPanes()).find((p) => p.focused)?.pane_id;
  if (!target) throw new Error("no focused pane to attach the Typing Madness Meter to");
  const paneId = await openHud(target);
  console.log(`opened Typing Madness Meter ${paneId} under ${target}`);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
