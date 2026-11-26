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
 * Where the HUD docks in a tab: the widest pane touching the tab's bottom
 * edge (leftmost on a tie). herdr can only split inside a pane, so this gives
 * a full-width strip whenever the bottom row is a single pane.
 */
export function bottomPane(panes: { pane_id: string; rect: Rect }[], area: Rect): string | null {
  const bottom = area.y + area.height;
  const row = panes.filter((p) => p.rect.y + p.rect.height >= bottom);
  row.sort((a, b) => b.rect.width - a.rect.width || a.rect.x - b.rect.x);
  return row[0]?.pane_id ?? null;
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
