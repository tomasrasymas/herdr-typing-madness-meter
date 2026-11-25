// Demo-mode key source for the HUD: a local socket the self-typing demo pane
// connects to. Each line is {"c": "<key class>"} or {"done": true}.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { stateDir } from "./config.ts";
import type { KeyClass } from "./game.ts";

export const demoSocketPath = () => path.join(stateDir(), "demo.sock");

export function startDemoFeed(onKey: (cls: KeyClass, t: number) => void, onDone: () => void): net.Server {
  const file = demoSocketPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  const server = net.createServer((conn) => {
    readline.createInterface({ input: conn }).on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.done) onDone();
        else if (msg.c) onKey(msg.c as KeyClass, Date.now());
      } catch {}
    });
  });
  server.listen(file);
  process.on("exit", () => fs.rmSync(file, { force: true }));
  return server;
}
