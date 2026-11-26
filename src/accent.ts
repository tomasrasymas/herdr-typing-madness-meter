// Focused-pane border color by typing speed.
//
// herdr has no runtime theme API, but `ui.accent` colors the focused pane's
// border and `server.reload_config` applies a config change in ~50ms. So we
// add a marked `accent` line to the user's config.toml, reload, and remove it
// again when typing stops or the HUD exits. Every injected line ends with
// MARK, and any accent the user already had is commented out with OFF and
// restored byte-for-byte, so strip(inject(x)) === x.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { call } from "./herdr.ts";
import { tierColor } from "./tiers.ts";

export const MARK = "# typing-madness-meter";
export const OFF = "# typing-madness-meter-off: ";

const isHeader = (line: string) => /^\s*\[/.test(line);
const isUiHeader = (line: string) => /^\s*\[ui\]\s*(#.*)?$/.test(line);

/** Remove everything typing-madness-meter added and restore lines it disabled. */
export function strip(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimEnd().endsWith(MARK))
    .map((line) => (line.startsWith(OFF) ? line.slice(OFF.length) : line))
    .join("\n");
}

/** Config text with `ui.accent` set to `color`. */
export function inject(text: string, color: string): string {
  const lines = strip(text).split("\n");
  const accentLine = `accent = "${color}" ${MARK}`;
  const header = lines.findIndex(isUiHeader);
  if (header >= 0) {
    for (let i = header + 1; i < lines.length && !isHeader(lines[i]); i++) {
      if (/^\s*accent\s*=/.test(lines[i])) lines[i] = OFF + lines[i];
    }
    lines.splice(header + 1, 0, accentLine);
    return lines.join("\n");
  }
  // No [ui] table: append one. TOML allows [ui] after [ui.sound]. Only
  // marked lines are added (no blank separator) so strip() is exact.
  const body = lines.join("\n");
  const block = `[ui] ${MARK}\n${accentLine}`;
  if (body === "" || body.endsWith("\n")) return `${body}${block}\n`;
  return `${body}\n${block}`;
}

export function configPath(): string {
  return process.env.HERDR_CONFIG_PATH ?? path.join(os.homedir(), ".config", "herdr", "config.toml");
}

export class AccentController {
  tier = 0;
  private file: string;
  private minIntervalMs: number;
  private lastApply = 0;
  private pending: NodeJS.Timeout | null = null;
  private applying = false;
  private disabled = false;

  constructor(file = configPath(), minIntervalMs = 800) {
    this.file = file;
    this.minIntervalMs = minIntervalMs;
  }

  /** Remove leftovers from a previous run that crashed while colored. */
  recover() {
    this.restoreSync();
  }

  /** Call often with the current speed tier; writes only on change, at most every 800ms. */
  setTier(target: number) {
    if (this.disabled) return;
    if (target === this.tier) return;
    this.tier = target;
    this.schedule();
  }

  private schedule() {
    if (this.pending || this.applying) return;
    const wait = Math.max(0, this.lastApply + this.minIntervalMs - Date.now());
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.apply();
    }, wait);
  }

  private async apply() {
    this.applying = true;
    const tier = this.tier;
    try {
      const current = fs.readFileSync(this.file, "utf8");
      const color = tierColor(tier).hex;
      const next = color ? inject(current, color) : strip(current);
      if (next !== current) {
        fs.writeFileSync(this.file, next);
        const r = await call<{ status: string; diagnostics: string[] }>("server.reload_config");
        if (r.status !== "applied") {
          // herdr rejected the config: put the user's file back and stop.
          fs.writeFileSync(this.file, strip(next));
          await call("server.reload_config").catch(() => {});
          this.disabled = true;
        }
      }
    } catch {
      // Missing config file or server hiccup: try again on the next change.
    } finally {
      this.lastApply = Date.now();
      this.applying = false;
      // The tier may have moved while we were writing.
      if (this.tier !== tier) this.schedule();
    }
  }

  /** Synchronous cleanup for process exit. */
  restoreSync() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    try {
      const current = fs.readFileSync(this.file, "utf8");
      const clean = strip(current);
      if (clean === current) return;
      fs.writeFileSync(this.file, clean);
      spawnSync(process.env.HERDR_BIN_PATH ?? "herdr", ["server", "reload-config"], { stdio: "ignore", timeout: 3000 });
    } catch {}
    this.tier = 0;
  }
}
