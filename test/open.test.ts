import assert from "node:assert/strict";
import { test } from "node:test";
import { lostHome } from "../src/open.ts";

const rec = { pane_id: "w2:p9", tab_id: "w2:t3", workspace_id: "w2" };

test("reopens when the HUD's own tab closes", () => {
  assert.equal(lostHome(rec, "tab_closed", { tab_id: "w2:t3", workspace_id: "w2" }), true);
});

test("ignores other tabs closing", () => {
  assert.equal(lostHome(rec, "tab_closed", { tab_id: "w2:t4", workspace_id: "w2" }), false);
});

test("reopens when the HUD's workspace closes, not another one", () => {
  assert.equal(lostHome(rec, "workspace_closed", { workspace_id: "w2" }), true);
  assert.equal(lostHome(rec, "workspace_closed", { workspace_id: "w5" }), false);
});

test("never matches a record without a home", () => {
  const bare = { pane_id: "w2:p9" };
  assert.equal(lostHome(bare, "tab_closed", {}), false);
  assert.equal(lostHome(bare, "workspace_closed", {}), false);
});

test("ignores other events", () => {
  assert.equal(lostHome(rec, "pane_closed", { tab_id: "w2:t3", workspace_id: "w2" }), false);
});
