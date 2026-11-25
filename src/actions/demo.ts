// Action: open a self-running demo in a new tab. A fake editor types by
// itself and a demo-mode HUD reacts to it, with fresh stats that are never
// saved. Both panes close when the demo ends.

import { call, listPanes } from "../herdr.ts";

const pluginId = process.env.HERDR_PLUGIN_ID ?? "typing-madness-meter";

async function main() {
  const focused = (await listPanes()).find((p) => p.focused);
  const workspace = process.env.HERDR_WORKSPACE_ID ?? focused?.workspace_id ?? null;
  const editor = await call<{ plugin_pane: { pane: { pane_id: string; tab_id: string } } }>("plugin.pane.open", {
    plugin_id: pluginId,
    entrypoint: "demo",
    placement: "tab",
    workspace_id: workspace,
    // The demo pane switches back to this tab when it finishes.
    env: focused ? { TMM_DEMO_RETURN_TAB: focused.tab_id } : {},
    focus: true,
  });
  const editorPane = editor.plugin_pane.pane.pane_id;
  // Opening with focus doesn't switch the visible tab; tab.focus does.
  await call("tab.focus", { tab_id: editor.plugin_pane.pane.tab_id });
  await call("plugin.pane.open", {
    plugin_id: pluginId,
    entrypoint: "hud",
    placement: "split",
    direction: "down",
    target_pane_id: editorPane,
    env: { TMM_DEMO: "1" },
    focus: false,
  });
  console.log(`demo running in ${editorPane}`);
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
