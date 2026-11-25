// Starts iterm/bridge.py (iTerm2 Python API) and sends it effect commands.
// Optional: if the Python env isn't built or herdr isn't inside iTerm2, every
// method is a no-op.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

type RGB = [number, number, number];

export function pluginRoot(): string {
  return process.env.HERDR_PLUGIN_ROOT ?? path.resolve(import.meta.dirname, "..");
}

export class ItermBridge {
  private child: ChildProcess | null = null;
  private ready = false;
  private lastTint = "";
  private lastTintAt = 0;
  sessions = 0;

  start(): boolean {
    const python = path.join(pluginRoot(), "bin", "pyenv", "bin", "python");
    const script = path.join(pluginRoot(), "iterm", "bridge.py");
    if (!fs.existsSync(python) || !fs.existsSync(script)) return false;
    // Own process group: when the HUD pane closes, herdr's hangup must not
    // kill the bridge before it restores the background. It exits on its own
    // right after, once it sees stdin close.
    const child = spawn(python, ["-I", script], { stdio: ["pipe", "pipe", "ignore"], detached: true });
    this.child = child;
    readline.createInterface({ input: child.stdout! }).on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.status === "ready") {
          this.ready = true;
          this.sessions = msg.sessions ?? 0;
        }
      } catch {}
    });
    child.on("exit", () => {
      this.ready = false;
      this.child = null;
    });
    child.on("error", () => (this.child = null));
    return true;
  }

  private send(msg: object) {
    if (!this.ready || !this.child?.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  /** Background tint; amount 0..1 is quantized and rate-limited to ~10/s. */
  tint(rgb: RGB | null, amount: number) {
    const q = rgb ? Math.round(Math.min(1, Math.max(0, amount)) * 10) / 10 : 0;
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
    this.child?.stdin?.end();
  }
}
