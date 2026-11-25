// Minimal herdr socket client.
//
// herdr speaks newline-delimited JSON over a Unix socket and closes the
// connection after one response, so every call opens its own connection.
// Subscriptions are the exception: the connection stays open and herdr pushes
// one {"event": ..., "data": ...} line per event.

import net from "node:net";
import os from "node:os";
import path from "node:path";

export const SOCKET_PATH =
  process.env.HERDR_SOCKET_PATH ?? path.join(os.homedir(), ".config", "herdr", "herdr.sock");

export class HerdrError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

let seq = 0;

export function call<T = any>(method: string, params: object = {}, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `ts_${process.pid}_${++seq}`;
    const sock = net.createConnection(SOCKET_PATH);
    let buf = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new HerdrError("timeout", `${method} timed out`))),
      timeoutMs,
    );
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify({ id, method, params }) + "\n"));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const msg = JSON.parse(buf.slice(0, nl));
      if (msg.error) finish(() => reject(new HerdrError(msg.error.code, msg.error.message)));
      else finish(() => resolve(msg.result as T));
    });
    sock.on("error", (err) => finish(() => reject(err)));
    sock.on("close", () => finish(() => reject(new HerdrError("closed", `${method}: connection closed`))));
  });
}

export interface HerdrEvent {
  /** Event kind with dots, e.g. "pane.focused". */
  kind: string;
  data: any;
}

export interface Subscription {
  close(): void;
}

/**
 * Open a long-lived subscription. `onEvent` receives each pushed event;
 * `onEnd` fires once when the stream ends for any reason (including
 * `events_lost`), after which the caller should resubscribe and re-read state.
 */
export function subscribe(
  types: string[],
  onEvent: (ev: HerdrEvent) => void,
  onEnd: (err?: Error) => void,
): Subscription {
  const id = `ts_sub_${process.pid}_${++seq}`;
  const sock = net.createConnection(SOCKET_PATH);
  let buf = "";
  let ended = false;
  const end = (err?: Error) => {
    if (ended) return;
    ended = true;
    sock.destroy();
    onEnd(err);
  };
  sock.setEncoding("utf8");
  sock.on("connect", () => {
    const params = { subscriptions: types.map((type) => ({ type })) };
    sock.write(JSON.stringify({ id, method: "events.subscribe", params }) + "\n");
  });
  sock.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.error) return end(new HerdrError(msg.error.code, msg.error.message));
      if (msg.event) onEvent({ kind: String(msg.event).replace("_", "."), data: msg.data });
    }
  });
  sock.on("error", (err) => end(err));
  sock.on("close", () => end());
  return { close: () => end() };
}

// Typed helpers for the calls this plugin uses.

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  focused: boolean;
  agent?: string | null;
  agent_status?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSnapshot {
  tab_id: string;
  workspace_id: string;
  zoomed: boolean;
  area: Rect;
  focused_pane_id: string;
  panes: { pane_id: string; rect: Rect; focused: boolean }[];
  splits: { id: string; direction: "right" | "down"; ratio: number; rect: Rect }[];
}

export type LayoutNode =
  | { type: "pane"; pane_id?: string }
  | { type: "split"; direction: "right" | "down"; ratio: number; first: LayoutNode; second: LayoutNode };

export async function listPanes(): Promise<PaneInfo[]> {
  const r = await call<{ panes: PaneInfo[] }>("pane.list");
  return r.panes;
}

export async function paneLayout(paneId: string): Promise<LayoutSnapshot> {
  const r = await call<{ layout: LayoutSnapshot }>("pane.layout", { pane_id: paneId });
  return r.layout;
}

export async function exportLayout(tabId: string): Promise<{ root: LayoutNode; zoomed: boolean }> {
  const r = await call<{ layout: { root: LayoutNode; zoomed: boolean } }>("layout.export", { tab_id: tabId });
  return r.layout;
}

export async function setSplitRatio(tabId: string, splitPath: boolean[], ratio: number): Promise<void> {
  await call("layout.set_split_ratio", { tab_id: tabId, path: splitPath, ratio });
}

export async function notify(title: string, body?: string): Promise<void> {
  await call("notification.show", { title, body: body ?? null, sound: "none" }).catch(() => {});
}
