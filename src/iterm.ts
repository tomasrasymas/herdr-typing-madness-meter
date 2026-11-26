// Starts iterm/bridge.py (iTerm2 Python API) and sends it effect commands.
// Optional: if the Python env isn't built or herdr isn't inside iTerm2, every
// method is a no-op.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

type RGB = [number, number, number];

/** How often to check whether iTerm2 is back after the bridge exits. */
const RESTART_MS = 3000;

function itermRunning(): boolean {
  return spawnSync("pgrep", ["-xq", "iTerm2"]).status === 0;
}

export function pluginRoot(): string {
  return process.env.HERDR_PLUGIN_ROOT ?? path.resolve(import.meta.dirname, "..");
}

export class ItermBridge {
  private child: ChildProcess | null = null;
  private ready = false;
  private lastTint = "";
  private lastTintAt = 0;
  private stopped = false;
  private restartTimer: NodeJS.Timeout | null = null;
  sessions = 0;

  /**
   * Starts the bridge, and keeps restarting it whenever it exits (iTerm2
   * quit or restarted) until stop(). The bridge only runs while iTerm2 does,
   * so the HUD never launches iTerm2 itself.
   */
  start(): boolean {
    const python = path.join(pluginRoot(), "bin", "pyenv", "bin", "python");
    const script = path.join(pluginRoot(), "iterm", "bridge.py");
    if (!fs.existsSync(python) || !fs.existsSync(script)) return false;
    this.stopped = false;
    this.spawnWhenIterm(python, script);
    return true;
  }

  private spawnWhenIterm(python: string, script: string) {
    this.restartTimer = null;
    if (this.stopped) return;
    if (!itermRunning()) {
      this.restartTimer = setTimeout(() => this.spawnWhenIterm(python, script), RESTART_MS);
      return;
    }
    // Own process group: when the HUD pane closes, herdr's hangup must not
    // kill the bridge before it restores the background. It exits on its own
    // right after, once it sees stdin close.
    const child = spawn(python, ["-I", script], { stdio: ["pipe", "pipe", "ignore"], detached: true });
    this.child = child;
    readline.createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.status === "ready") {
          // A fresh iTerm2 has no tint yet; let the next tint() resend it.
          this.lastTint = "";
          this.ready = true;
          this.sessions = msg.sessions ?? 0;
        }
      } catch {}
    });
    const restart = () => {
      if (this.child !== child) return;
      this.ready = false;
      this.child = null;
      if (!this.stopped) this.restartTimer = setTimeout(() => this.spawnWhenIterm(python, script), RESTART_MS);
    };
    child.on("exit", restart);
    child.on("error", restart);
  }

  private send(msg: object) {
    if (!this.ready || !this.child?.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  /** Background tint; amount 0..1 is quantized to 20 steps and rate-limited to ~10/s. */
  tint(rgb: RGB | null, amount: number) {
    const q = rgb ? Math.round(Math.min(1, Math.max(0, amount)) * 20) / 20 : 0;
    const key = rgb && q > 0 ? `${rgb.join(",")}@${q}` : "off";
    const now = Date.now();
    if (key === this.lastTint || now - this.lastTintAt < 100) return;
    this.lastTint = key;
    this.lastTintAt = now;
    this.send(key === "off" ? { tint: null } : { tint: rgb, amount: q });
  }

  flash(rgb: RGB, ms = 120) {
    this.send({ flash: rgb, ms });
  }

  badge(text: string, ms = 2000) {
    this.send({ badge: text, ms });
  }

  /** Closing stdin makes the bridge restore colors and badge, then exit. */
  stop() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.child?.stdin?.end();
  }
}
