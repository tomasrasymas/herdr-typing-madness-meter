import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayoutNode } from "../src/herdr.ts";
import { leaves, leftmost, ratioPaths, rebuildMoves, withoutPane } from "../src/dock.ts";
import type { RebuildMove } from "../src/dock.ts";

const P = (pane_id: string): LayoutNode => ({ type: "pane", pane_id });
const S = (direction: "right" | "down", first: LayoutNode, second: LayoutNode, ratio = 0.5): LayoutNode => ({
  type: "split",
  direction,
  ratio,
  first,
  second,
});

/** Replay moves on a tree that starts as a single pane, the way herdr splits. */
function replay(start: string, moves: RebuildMove[]): LayoutNode {
  let root: LayoutNode = P(start);
  const splitAt = (node: LayoutNode, m: RebuildMove): LayoutNode => {
    if (node.type === "pane") return node.pane_id === m.target ? S(m.split, node, P(m.pane)) : node;
    return { ...node, first: splitAt(node.first, m), second: splitAt(node.second, m) };
  };
  for (const m of moves) root = splitAt(root, m);
  return root;
}

/** Same shape and panes, ignoring ratios. */
function shape(node: LayoutNode): string {
  return node.type === "pane" ? String(node.pane_id) : `${node.direction}(${shape(node.first)},${shape(node.second)})`;
}

test("withoutPane removes the HUD and collapses its split", () => {
  const tab = S("right", S("down", P("a"), P("hud")), P("b"));
  assert.equal(shape(withoutPane(tab, "hud")!), "right(a,b)");
  assert.equal(withoutPane(P("hud"), "hud"), null);
  assert.equal(shape(withoutPane(S("down", P("a"), P("hud")), "hud")!), "a");
});

test("leaves and leftmost walk first children first", () => {
  const tree = S("right", S("down", P("a"), P("b")), P("c"));
  assert.deepEqual(leaves(tree), ["a", "b", "c"]);
  assert.equal(leftmost(tree), "a");
});

test("rebuildMoves recreates the layout from its leftmost pane", () => {
  const trees = [
    S("right", P("a"), P("b")),
    S("right", S("down", P("a"), P("b")), P("c")),
    S("down", S("right", P("a"), P("b")), S("right", P("c"), S("down", P("d"), P("e")))),
    S("right", P("a"), S("right", P("b"), S("down", P("c"), P("d")))),
  ];
  for (const tree of trees) {
    const rebuilt = replay(leftmost(tree)!, rebuildMoves(tree));
    assert.equal(shape(rebuilt), shape(tree));
  }
});

test("a single pane needs no moves", () => {
  assert.deepEqual(rebuildMoves(P("a")), []);
});

test("ratioPaths lists every split with its path", () => {
  const tree = S("right", S("down", P("a"), P("b"), 0.3), P("c"), 0.6);
  assert.deepEqual(ratioPaths(tree, [false]), [
    { path: [false], ratio: 0.6 },
    { path: [false, false], ratio: 0.3 },
  ]);
});
