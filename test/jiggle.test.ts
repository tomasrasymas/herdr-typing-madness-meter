import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutNode } from "../src/herdr.ts";
import { findAnchorPane, findParentSplit, jiggleFrames } from "../src/jiggle.ts";

const area = { x: 0, y: 0, width: 200, height: 50 };

// [ p1 | [ p2 / [ p3 | p4 ] ] ]
const tree: LayoutNode = {
  type: "split",
  direction: "right",
  ratio: 0.5,
  first: { type: "pane", pane_id: "w1:p1" },
  second: {
    type: "split",
    direction: "down",
    ratio: 0.6,
    first: { type: "pane", pane_id: "w1:p2" },
    second: {
      type: "split",
      direction: "right",
      ratio: 0.25,
      first: { type: "pane", pane_id: "w1:p3" },
      second: { type: "pane", pane_id: "w1:p4" },
    },
  },
};

test("root child resolves to the root split", () => {
  assert.deepEqual(findParentSplit(tree, "w1:p1", area), {
    path: [],
    direction: "right",
    ratio: 0.5,
    extent: 200,
    side: false,
  });
});

test("nested panes resolve to their innermost split with extents", () => {
  assert.deepEqual(findParentSplit(tree, "w1:p2", area), {
    path: [true],
    direction: "down",
    ratio: 0.6,
    extent: 50,
    side: false,
  });
  assert.deepEqual(findParentSplit(tree, "w1:p4", area), {
    path: [true, true],
    direction: "right",
    ratio: 0.25,
    extent: 100,
    side: true,
  });
});

test("lone pane and unknown pane have no split", () => {
  assert.equal(findParentSplit({ type: "pane", pane_id: "w1:p1" }, "w1:p1", area), null);
  assert.equal(findParentSplit(tree, "w9:p9", area), null);
});

test("anchor is the single pane directly above", () => {
  // [ p1 / hud ]
  const under: LayoutNode = {
    type: "split",
    direction: "down",
    ratio: 0.9,
    first: { type: "pane", pane_id: "w1:p1" },
    second: { type: "pane", pane_id: "w1:hud" },
  };
  assert.equal(findAnchorPane(under, "w1:hud"), "w1:p1");
  // nested: [ p1 | [ p2 / hud ] ]
  assert.equal(
    findAnchorPane({ type: "split", direction: "right", ratio: 0.5, first: { type: "pane", pane_id: "w1:p1" }, second: under }, "w1:hud"),
    "w1:p1",
  );
});

test("no anchor beside, above, under a split, or alone", () => {
  // The pane the HUD was under closed: [ p1 | hud ] leaves it full height.
  const beside: LayoutNode = {
    type: "split",
    direction: "right",
    ratio: 0.5,
    first: { type: "pane", pane_id: "w1:p1" },
    second: { type: "pane", pane_id: "w1:hud" },
  };
  assert.equal(findAnchorPane(beside, "w1:hud"), null);
  // [ hud / p1 ]
  assert.equal(
    findAnchorPane({ type: "split", direction: "down", ratio: 0.5, first: { type: "pane", pane_id: "w1:hud" }, second: { type: "pane", pane_id: "w1:p1" } }, "w1:hud"),
    null,
  );
  // p3 sits under a nested split in the shared tree, p2 above one
  assert.equal(findAnchorPane(tree, "w1:p4"), null);
  assert.equal(findAnchorPane(tree, "w1:p2"), null);
  assert.equal(findAnchorPane({ type: "pane", pane_id: "w1:hud" }, "w1:hud"), null);
});

test("frames wiggle one cell and end on the original ratio", () => {
  const frames = jiggleFrames({ path: [], direction: "right", ratio: 0.5, extent: 200, side: false });
  assert.deepEqual(frames, [0.505, 0.495, 0.5025, 0.5]);
});

test("frames are clamped away from the edges", () => {
  const frames = jiggleFrames({ path: [], direction: "down", ratio: 0.96, extent: 10, side: false }, 2);
  assert.ok(frames.every((r) => r >= 0.05 && r <= 0.95));
});
