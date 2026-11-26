import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutNode } from "../src/herdr.ts";
import { bottomPane, findParentSplit, jiggleFrames } from "../src/jiggle.ts";

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

test("frames wiggle one cell and end on the original ratio", () => {
  const frames = jiggleFrames({ path: [], direction: "right", ratio: 0.5, extent: 200, side: false });
  assert.deepEqual(frames, [0.505, 0.495, 0.5025, 0.5]);
});

test("frames are clamped away from the edges", () => {
  const frames = jiggleFrames({ path: [], direction: "down", ratio: 0.96, extent: 10, side: false }, 2);
  assert.ok(frames.every((r) => r >= 0.05 && r <= 0.95));
});

// ---------------------------------------------------------------- bottomPane

const AREA = { x: 0, y: 0, width: 100, height: 50 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

test("bottomPane: a single pane is the bottom", () => {
  assert.equal(bottomPane([{ pane_id: "a", rect: AREA }], AREA), "a");
});

test("bottomPane: picks the full-width bottom row under a split top", () => {
  const panes = [
    { pane_id: "tl", rect: rect(0, 0, 50, 25) },
    { pane_id: "tr", rect: rect(50, 0, 50, 25) },
    { pane_id: "bottom", rect: rect(0, 25, 100, 25) },
  ];
  assert.equal(bottomPane(panes, AREA), "bottom");
});

test("bottomPane: side-by-side columns pick the widest, then the leftmost", () => {
  const wide = [
    { pane_id: "left", rect: rect(0, 0, 30, 50) },
    { pane_id: "right", rect: rect(30, 0, 70, 50) },
  ];
  assert.equal(bottomPane(wide, AREA), "right");
  const even = [
    { pane_id: "left", rect: rect(0, 0, 50, 50) },
    { pane_id: "right", rect: rect(50, 0, 50, 50) },
  ];
  assert.equal(bottomPane(even, AREA), "left");
});

test("bottomPane: panes above the bottom edge never win", () => {
  const panes = [
    { pane_id: "top", rect: rect(0, 0, 100, 40) },
    { pane_id: "small-bottom", rect: rect(0, 40, 20, 10) },
  ];
  assert.equal(bottomPane(panes, AREA), "small-bottom");
  assert.equal(bottomPane([], AREA), null);
});
