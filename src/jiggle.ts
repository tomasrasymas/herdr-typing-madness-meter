// Border jiggle: briefly wiggle the split that directly contains a pane.
//
// herdr has no way to translate a pane, so the closest thing to a "shake" is
// nudging the split ratio by one cell back and forth, then restoring it. Each
// frame resizes the pane's PTY, so callers keep this short and rare.

import type { LayoutNode, Rect } from "./herdr.ts";
import { exportLayout, paneLayout, setSplitRatio } from "./herdr.ts";

export interface SplitTarget {
  /** herdr split path: false = first child, true = second child. */
  path: boolean[];
  direction: "right" | "down";
  ratio: number;
  /** Size of the split along its axis, in cells. */
  extent: number;
  /** Which child the pane is: false = first (left/top), true = second. */
  side: boolean;
}

/** Find the innermost split whose direct child is `paneId`. */
export function findParentSplit(root: LayoutNode, paneId: string, area: Rect): SplitTarget | null {
  const walk = (node: LayoutNode, rect: Rect, path: boolean[]): SplitTarget | null => {
    if (node.type !== "split") return null;
    const horizontal = node.direction === "right";
    const extent = horizontal ? rect.width : rect.height;
    const firstSize = Math.round(extent * node.ratio);
    const firstRect: Rect = horizontal
      ? { ...rect, width: firstSize }
      : { ...rect, height: firstSize };
    const secondRect: Rect = horizontal
      ? { ...rect, x: rect.x + firstSize, width: rect.width - firstSize }
      : { ...rect, y: rect.y + firstSize, height: rect.height - firstSize };
    for (const [child, childRect, side] of [
      [node.first, firstRect, false],
      [node.second, secondRect, true],
    ] as const) {
      if (child.type === "pane" && child.pane_id === paneId) {
        return { path, direction: node.direction, ratio: node.ratio, extent, side };
      }
      const found = walk(child, childRect, [...path, side]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, area, []);
}

/**
 * The pane `paneId` hangs under: the single pane directly above it in a
 * "down" split. Null when it sits beside a pane (a "right" split), above one,
 * under a nested split, or alone. That happens when the pane it was under
 * closes and herdr hands its space to the HUD.
 */
export function findAnchorPane(root: LayoutNode, paneId: string): string | null {
  if (root.type !== "split") return null;
  const { first, second } = root;
  if (second.type === "pane" && second.pane_id === paneId) {
    return root.direction === "down" && first.type === "pane" ? (first.pane_id ?? null) : null;
  }
  if (first.type === "pane" && first.pane_id === paneId) return null;
  return findAnchorPane(first, paneId) ?? findAnchorPane(second, paneId);
}

/** Ratios to step through: +1 cell, -1 cell, +half cell, original. */
export function jiggleFrames(target: SplitTarget, cells = 1): number[] {
  const d = cells / Math.max(1, target.extent);
  const clamp = (r: number) => Math.min(0.95, Math.max(0.05, r));
  return [target.ratio + d, target.ratio - d, target.ratio + d / 2, target.ratio].map(clamp);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Jiggler {
  private busy = false;
  private lastAt = 0;
  cooldownMs: number;
  frameMs: number;
  cells: number;

  constructor(opts: { cooldownMs?: number; frameMs?: number; cells?: number } = {}) {
    this.cooldownMs = opts.cooldownMs ?? 2000;
    this.frameMs = opts.frameMs ?? 40;
    this.cells = opts.cells ?? 1;
  }

  get active() {
    return this.busy;
  }

  async jiggle(paneId: string): Promise<boolean> {
    const now = Date.now();
    if (this.busy || now - this.lastAt < this.cooldownMs) return false;
    this.busy = true;
    this.lastAt = now;
    try {
      const snapshot = await paneLayout(paneId);
      if (snapshot.zoomed) return false;
      const { root } = await exportLayout(snapshot.tab_id);
      const target = findParentSplit(root, paneId, snapshot.area);
      if (!target) return false;
      // The last frame is the original ratio, so the layout always ends where
      // it started. The whole animation takes about 4 frames (~160ms).
      for (const ratio of jiggleFrames(target, this.cells)) {
        await setSplitRatio(snapshot.tab_id, target.path, ratio);
        await sleep(this.frameMs);
      }
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }
}
