// Tracks herdr's UI-focused pane (exactly one pane in pane.list has
// focused: true). Refreshes from pane.list on focus/layout events, with a slow
// poll as a safety net for missed events.

import { listPanes, subscribe } from "./herdr.ts";
import type { HerdrEvent, PaneInfo, Subscription } from "./herdr.ts";

const EVENTS = [
  "pane.focused",
  "pane.closed",
  "pane.created",
  "pane.moved",
  "tab.focused",
  "tab.closed",
  "workspace.focused",
  "workspace.closed",
];

export class FocusTracker {
  focused: PaneInfo | null = null;
  /** Called for every subscribed event, after focus starts refreshing. */
  onEvent: ((ev: HerdrEvent) => void) | null = null;
  private sub: Subscription | null = null;
  private poll: NodeJS.Timeout | null = null;
  private refreshing = false;
  private again = false;
  private stopped = false;

  async start() {
    await this.refresh();
    this.connect();
    this.poll = setInterval(() => void this.refresh(), 2000);
  }

  stop() {
    this.stopped = true;
    this.sub?.close();
    if (this.poll) clearInterval(this.poll);
  }

  private connect() {
    if (this.stopped) return;
    this.sub = subscribe(
      EVENTS,
      (ev) => {
        void this.refresh();
        this.onEvent?.(ev);
      },
      () => {
        // Stream ended (events_lost, server restart): reconnect and re-read.
        if (this.stopped) return;
        setTimeout(() => {
          this.connect();
          void this.refresh();
        }, 1000);
      },
    );
  }

  /** Serialized refresh: one pane.list in flight, rerun if events arrived meanwhile. */
  async refresh() {
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.again = false;
        const panes = await listPanes().catch(() => null);
        if (panes) this.focused = panes.find((p) => p.focused) ?? null;
      } while (this.again);
    } finally {
      this.refreshing = false;
    }
  }
}
