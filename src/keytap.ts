// Spawns the native keytap helper and turns its NDJSON into callbacks.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { KeyClass } from "./game.ts";

export type TapStatus = "starting" | "ready" | "no_permission" | "tap_failed" | "missing" | "exited";

export interface KeytapOptions {
  terminals: string[];
  allowAnyApp: boolean;
  onKey: (cls: KeyClass, t: number) => void;
  onStatus: (status: TapStatus) => void;
}

export function keytapBinary(): string {
  const root = process.env.HERDR_PLUGIN_ROOT ?? path.resolve(import.meta.dirname, "..");
  return path.join(root, "bin", "keytap.app", "Contents", "MacOS", "keytap");
}

export function startKeytap(opts: KeytapOptions): ChildProcess | null {
  const bin = keytapBinary();
  if (!fs.existsSync(bin)) {
    opts.onStatus("missing");
    return null;
  }
  const args: string[] = [];
  if (opts.allowAnyApp) args.push("--allow-any");
  else if (opts.terminals.length) args.push("--allow", opts.terminals.join(","));

  // stdin stays a pipe: the helper exits when we close it or die.
  const child = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"] });
  opts.onStatus("starting");
  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.status) opts.onStatus(msg.status as TapStatus);
    else if (msg.c) opts.onKey(msg.c as KeyClass, msg.t ?? Date.now());
  });
  child.on("exit", () => opts.onStatus("exited"));
  child.on("error", () => opts.onStatus("tap_failed"));
  return child;
}
