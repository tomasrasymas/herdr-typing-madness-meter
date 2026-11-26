// Planning how to put the HUD in a full-width strip at the bottom of a tab.
//
// herdr only splits inside a pane, so a pane can't be added along a whole
// tab's bottom edge. To get `down(<the tab's layout>, HUD)`, the HUD goes
// under the tab's first pane while it is alone in the tab, and the other panes
// are moved back in, splitting their way out to the original layout. Moves
// within a workspace keep pane ids and running processes.

import type { LayoutNode } from "./herdr.ts";

type Split = Extract<LayoutNode, { type: "split" }>;

export function leaves(node: LayoutNode): string[] {
  if (node.type === "pane") return node.pane_id ? [node.pane_id] : [];
  return [...leaves(node.first), ...leaves(node.second)];
}

export function leftmost(node: LayoutNode): string | null {
  return leaves(node)[0] ?? null;
}

/** The layout with `paneId` taken out, its sibling taking its place. */
export function withoutPane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === "pane") return node.pane_id === paneId ? null : node;
  const first = withoutPane(node.first, paneId);
  const second = withoutPane(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export interface RebuildMove {
  pane: string;
  /** Split this pane... */
  target: string;
  /** ...in this direction; the moved pane becomes the second child. */
  split: "right" | "down";
}

/**
 * Moves that grow a tab holding only `leftmost(tree)` back into `tree`.
 * Each split is made top-down: the pane occupying a split's whole region is
 * always the leftmost leaf of its first child.
 */
export function rebuildMoves(tree: LayoutNode): RebuildMove[] {
  const moves: RebuildMove[] = [];
  const walk = (node: LayoutNode) => {
    if (node.type !== "split") return;
    const target = leftmost(node.first);
    const pane = leftmost(node.second);
    if (target && pane) moves.push({ pane, target, split: node.direction });
    walk(node.first);
    walk(node.second);
  };
  walk(tree);
  return moves;
}

/** The split ratios of `tree`, with paths for layout.set_split_ratio. */
export function ratioPaths(tree: LayoutNode, prefix: boolean[] = []): { path: boolean[]; ratio: number }[] {
  if (tree.type !== "split") return [];
  const node = tree as Split;
  return [
    { path: prefix, ratio: node.ratio },
    ...ratioPaths(node.first, [...prefix, false]),
    ...ratioPaths(node.second, [...prefix, true]),
  ];
}
