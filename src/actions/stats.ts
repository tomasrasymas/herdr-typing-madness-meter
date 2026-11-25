// Action: open the stats popup.

import { call } from "../herdr.ts";

const pluginId = process.env.HERDR_PLUGIN_ID ?? "typing-madness-meter";

call("plugin.pane.open", { plugin_id: pluginId, entrypoint: "stats", placement: "popup" }).catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
