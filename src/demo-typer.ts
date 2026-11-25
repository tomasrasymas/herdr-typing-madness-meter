// Demo pane: a fake editor that "types" a code snippet by itself and feeds
// each keystroke to a demo-mode HUD over a local socket. Used to record the
// README demo without real typing. Real stats are never touched.

import net from "node:net";
import { demoSocketPath } from "./demo-feed.ts";
import { call } from "./herdr.ts";
import type { KeyClass } from "./game.ts";

const SNIPPET = `// Typing Madness Meter: how mad is your typing?
export function madness(wpm: number, combo: number): string {
  if (wpm > 100 && combo > 200) return "keyboard demon";
  if (wpm > 65) return "on fire";
  if (wpm > 45) return "warming up";
  return "hunt and peck";
}

const today = madness(120, 250);
console.log(\`today you are a \${today}\`);
`;

/** Typing speed (WPM) by elapsed seconds: a ramp, a pause, then a burst. */
export const PROFILE: { until: number; wpm: number | null }[] = [
  { until: 5, wpm: 25 },
  { until: 10, wpm: 45 },
  { until: 15, wpm: 65 },
  { until: 22, wpm: 95 },
  { until: 23.6, wpm: null }, // pause: the combo breaks
  { until: 34, wpm: 125 },
];

export function wpmAt(seconds: number): number | null | undefined {
  return PROFILE.find((p) => seconds < p.until)?.wpm;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(demoSocketPath());
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}

async function connectWithRetry(timeoutMs: number): Promise<net.Socket | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      return await connect();
    } catch {
      await sleep(200);
    }
  }
  return null;
}

const out = (s: string) => process.stdout.write(s);
const ESC = "\x1b[";

function header(status: string) {
  out(`${ESC}H${ESC}2K${ESC}1;38;5;201m demo.ts ${ESC}0m${ESC}2m— ${status}${ESC}0m\r\n${ESC}2K\r\n`);
}

async function main() {
  out(`${ESC}?1049h${ESC}2J${ESC}?25l`);
  header("waiting for the Typing Madness Meter…");
  const sock = await connectWithRetry(15_000);
  const send = (msg: object) => sock?.write(JSON.stringify(msg) + "\n");
  const key = (c: KeyClass) => send({ c });

  header("typing…");
  out(`${ESC}3;1H`);
  await sleep(1200);

  const start = Date.now();
  let i = 0;
  let typed = 0;
  while (true) {
    const elapsed = (Date.now() - start) / 1000;
    const wpm = wpmAt(elapsed);
    if (wpm === undefined) break;
    if (wpm === null) {
      await sleep(100);
      continue;
    }
    // Every ~45 chars, make a typo and fix it.
    if (typed > 0 && typed % 45 === 0 && SNIPPET[i % SNIPPET.length] !== "\n") {
      out("x");
      key("char");
      await sleep(180);
      out("\b \b");
      key("backspace");
      await sleep(120);
    }
    const ch = SNIPPET[i % SNIPPET.length];
    i++;
    typed++;
    if (ch === "\n") {
      out(`${ESC}K\r\n`);
      key("enter");
    } else {
      out(`${ESC}38;5;252m${ch}${ESC}0m`);
      key("char");
    }
    // Wrap back to the top when the snippet runs out of screen.
    if (i % SNIPPET.length === 0) {
      out(`${ESC}3;1H${ESC}J`);
    }
    const cps = (wpm * 5) / 60;
    const jitter = 0.7 + Math.random() * 0.6;
    await sleep((1000 / cps) * jitter);
  }

  header("done");
  send({ done: true });
  await sleep(2500);
  sock?.end();
  const back = process.env.TMM_DEMO_RETURN_TAB;
  if (back) await call("tab.focus", { tab_id: back }).catch(() => {});
  out(`${ESC}0m${ESC}?25h${ESC}?1049l`);
  process.exit(0);
}

if (import.meta.main) {
  process.on("SIGHUP", () => process.exit(0));
  void main();
}
