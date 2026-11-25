// HUD pane entrypoint. This process is the plugin's daemon: it owns the
// keytap helper, the herdr subscriptions and the game state, and everything
// stops when the HUD pane closes.

import fs from "node:fs";
import path from "node:path";
import { AccentController } from "./accent.ts";
import { setTierColors, setTierWpm, tierColor, tierFor, tintAmount } from "./tiers.ts";
import { loadConfig, stateDir } from "./config.ts";
import { ItermBridge } from "./iterm.ts";
import { FocusTracker } from "./focus.ts";
import { Game, emptyStats } from "./game.ts";
import type { GameEvent, KeyClass } from "./game.ts";
import { call, exportLayout, notify, paneLayout, setSplitRatio } from "./herdr.ts";
import { Jiggler, findParentSplit, findSiblingPane } from "./jiggle.ts";
import { startKeytap } from "./keytap.ts";
import type { TapStatus } from "./keytap.ts";
import { DIM, fg, renderFrame } from "./render.ts";
import type { Line } from "./render.ts";
import { loadHudPaneId, loadStats, saveHudPaneId, saveStats } from "./store.ts";

const FRAME_MS = 33;
const SAVE_DEBOUNCE_MS = 5000;
const BADGE_INTERVAL_MS = 500;
const RESET_FLAG = path.join(stateDir(), "reset-request");

const cfg = loadConfig();
setTierWpm(cfg.tierWpm);
setTierColors(cfg.tierColors);
const game = new Game(loadStats(), {
  comboGapMs: cfg.comboGapMs,
  comboMilestone: cfg.comboMilestone,
  comboStep: cfg.comboStep,
  maxMultiplier: cfg.maxMultiplier,
});
const focus = new FocusTracker();
const jiggler = new Jiggler({ cells: cfg.jiggleCells });
const accent = cfg.borderColor ? new AccentController() : null;
const iterm = new ItermBridge();
let tintTier = 0;
// The HUD's own pane. Cross-workspace moves assign a new public id, so this
// is updated after every follow.
let selfPane = process.env.HERDR_PANE_ID ?? null;
let selfTab: string | null = null;
/** The pane the HUD is split under; typing anywhere else makes it follow. */
let anchorPane: string | null = null;

let tapStatus: TapStatus = "starting";
let notice: { line: Line; until: number } | null = null;
let burst = 0;
let frame = 0;
let lastFrame = "";
let saveTimer: NodeJS.Timeout | null = null;
let lastBadgeAt = 0;
let typedPane: string | null = null;

// ---------------------------------------------------------------- input

function hudFocused(): boolean {
  return !!selfPane && focus.focused?.pane_id === selfPane;
}

function onKey(cls: KeyClass, t: number) {
  const target = focus.focused;
  if (!target || hudFocused()) return;
  typedPane = target.pane_id;
  if (cfg.follow && selfTab && target.pane_id !== anchorPane) void follow(target);
  handle(game.key(cls, t), target.pane_id);
  scheduleSave();
  if (cls === "char" || cls === "enter") maybeBadge(target.pane_id, t);
}

function show(line: Line, ms: number) {
  notice = { line, until: Date.now() + ms };
}

const FLASH_RGB: [number, number, number] = [255, 40, 70];

function celebrate(paneId: string | null, badge: string) {
  burst = 3;
  if (cfg.jiggle && paneId) void jiggler.jiggle(paneId);
  if (cfg.itermFlash) iterm.flash(FLASH_RGB);
  if (cfg.itermBadge) iterm.badge(badge);
}

function milestoneBadge(ev: Extract<GameEvent, { kind: "milestone" }>): string {
  if (ev.reason === "combo") return `COMBO ${ev.value}!`;
  if (ev.reason === "level") return `LEVEL ${ev.value}`;
  return `${ev.value} WPM!`;
}

function handle(events: GameEvent[], paneId: string | null) {
  for (const ev of events) {
    switch (ev.kind) {
      case "milestone":
        celebrate(paneId, milestoneBadge(ev));
        if (ev.reason === "combo") {
          show([{ t: ` ⚑ COMBO ${ev.value}! `, s: fg(201, true) }], 1500);
        } else if (ev.reason === "level") {
          const rank = game.live(Date.now()).rank;
          show([{ t: ` ▲ LEVEL UP → ${ev.value} · ${rank}`, s: fg(141, true) }], 3000);
          if (cfg.toasts) void notify(`Level ${ev.value}`, rank);
        } else {
          show([{ t: ` ★ NEW RECORD ${ev.value} WPM`, s: fg(220, true) }], 3000);
          if (cfg.toasts) void notify(`New record: ${ev.value} WPM`);
        }
        break;
      case "achievement":
        celebrate(paneId, `★ ${ev.title}`);
        show(
          [
            { t: " ★ ACHIEVEMENT ", s: fg(220, true) },
            { t: `${ev.title} — ${ev.description}`, s: fg(220) },
          ],
          4000,
        );
        if (cfg.toasts) void notify(`Achievement: ${ev.title}`, ev.description);
        break;
      case "combo_break":
        if (ev.combo >= 30) show([{ t: ` ✗ combo broken at ${ev.combo}`, s: fg(203) }], 1500);
        break;
    }
  }
}

function maybeBadge(paneId: string, t: number) {
  if (!cfg.badge || t - lastBadgeAt < BADGE_INTERVAL_MS) return;
  lastBadgeAt = t;
  const live = game.live(t);
  void call("pane.report_metadata", {
    pane_id: paneId,
    source: "plugin:typing-madness-meter",
    title: `${live.wpm} wpm · ${live.combo} combo`,
    ttl_ms: 4000,
  }).catch(() => {});
}

// ---------------------------------------------------------------- persistence

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveStats(game.stats);
    } catch {}
  }, SAVE_DEBOUNCE_MS);
}

function checkResetRequest() {
  if (!fs.existsSync(RESET_FLAG)) return;
  fs.rmSync(RESET_FLAG, { force: true });
  game.stats = emptyStats();
  game.sessionPeakWpm = 0;
  saveStats(game.stats);
  show([{ t: " stats reset", s: DIM }], 2000);
}

// ---------------------------------------------------------------- speed colors

/** Border color (herdr accent) and background tint (iTerm2) follow WPM. */
function speedColors(wpm: number, heat: number, idleMs: number) {
  accent?.update(wpm, idleMs);
  if (!cfg.itermTint) return;
  tintTier = idleMs > 3000 ? 0 : tierFor(wpm, tintTier);
  iterm.tint(tierColor(tintTier).rgb, tintAmount(wpm, heat));
}

// ---------------------------------------------------------------- rendering

function statusLine(): Line | null {
  switch (tapStatus) {
    case "no_permission":
      return [
        { t: " ⚠ Grant Input Monitoring to your terminal app: ", s: fg(214, true) },
        { t: "System Settings › Privacy & Security › Input Monitoring", s: fg(214) },
      ];
    case "missing":
      return [{ t: " ⚠ keytap helper not built: run sh scripts/build-keytap.sh", s: fg(214, true) }];
    case "tap_failed":
      return [{ t: " ⚠ could not start the keyboard tap", s: fg(214, true) }];
    case "exited":
      return [{ t: " ⚠ keytap helper stopped; reopen the HUD", s: fg(214, true) }];
    default:
      return null;
  }
}

function draw() {
  const t = Date.now();
  handle(game.tick(t), typedPane);
  if (frame % 30 === 0) checkResetRequest();
  frame++;

  const live = game.live(t);
  if (frame % 3 === 0) speedColors(live.wpm, live.heat, live.idleMs);
  const amp = Math.min(3, live.heat * 1.6 + burst);
  burst *= 0.88;
  if (burst < 0.05) burst = 0;
  const dx = Math.round((Math.random() * 2 - 1) * amp);
  const dy = amp > 1.2 && Math.random() < 0.3 ? 1 : 0;

  let message = statusLine();
  if (!message && notice && notice.until > t) message = notice.line;
  if (!message && hudFocused()) {
    message = [{ t: " HUD focused: keys typed here don't count (q closes the HUD)", s: DIM }];
  }

  const out = renderFrame({
    live,
    message,
    shake: { dx, dy },
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 6,
    frame: amp > 0.05 ? frame : 0,
  });
  if (out !== lastFrame) {
    process.stdout.write(out);
    lastFrame = out;
  }
}

// ---------------------------------------------------------------- follow

let following = false;
let lastFollowAttempt = 0;
const FOLLOW_MIN_INTERVAL_MS = 800;

interface MoveResult {
  changed: boolean;
  pane: { pane_id: string; tab_id: string };
}

async function movePane(destination: object): Promise<MoveResult> {
  const r = await call<{ move_result?: MoveResult } & MoveResult>("pane.move", {
    pane_id: selfPane,
    destination,
    focus: false,
  });
  const result = r.move_result ?? r;
  if (result.changed) {
    selfPane = result.pane.pane_id;
    selfTab = result.pane.tab_id;
  }
  return result;
}

/** Re-read which pane the HUD sits under, from the live layout. */
async function refreshAnchor() {
  if (!selfTab || !selfPane) return;
  const { root } = await exportLayout(selfTab);
  anchorPane = findSiblingPane(root, selfPane);
}

/**
 * Move the HUD under the pane being typed in when it isn't already there.
 * Triggered by typing rather than focus, so browsing panes and workspaces
 * doesn't reshuffle layouts.
 *
 * herdr refuses pane.move within one tab, so a same-tab follow parks the HUD
 * in a temporary tab and moves it back under the target. The temporary tab
 * closes by itself when the HUD leaves it, and focus never changes.
 */
async function follow(target: { pane_id: string; tab_id: string; workspace_id: string }) {
  const now = Date.now();
  if (!selfPane || following || now - lastFollowAttempt < FOLLOW_MIN_INTERVAL_MS) return;
  following = true;
  lastFollowAttempt = now;
  const home = selfTab;
  const into = { type: "tab", tab_id: target.tab_id, target_pane_id: target.pane_id, split: "down" };
  try {
    // The layout may have changed (e.g. the old anchor closed) since we
    // last looked; skip the move if the HUD is already under the target.
    await refreshAnchor().catch(() => {});
    if (anchorPane === target.pane_id) return;
    if (target.tab_id === selfTab) {
      const out = await movePane({ type: "new_tab", workspace_id: target.workspace_id });
      if (!out.changed) return; // zoomed tab: retry on a later keystroke
      const back = await movePane(into).catch(() => null);
      if (!back?.changed && home) {
        // Couldn't land under the target: at least return to the original tab.
        await movePane({ type: "tab", tab_id: home, split: "down" }).catch(() => {});
        return;
      }
    } else {
      const moved = await movePane(into);
      if (!moved.changed) return;
    }
    anchorPane = target.pane_id;
    saveHudPaneId(selfPane);
    lastFrame = "";
    await sizeSelf().catch(() => {});
  } catch {
    // Leave the HUD where it is; a later keystroke retries.
  } finally {
    following = false;
  }
}

// ---------------------------------------------------------------- lifecycle

/** Shrink the HUD's split to cfg.hudHeight rows. */
async function sizeSelf() {
  if (!selfPane) return;
  const snap = await paneLayout(selfPane);
  const { root } = await exportLayout(snap.tab_id);
  const split = findParentSplit(root, selfPane, snap.area);
  if (!split || split.direction !== "down") return;
  const share = Math.min(0.5, cfg.hudHeight / split.extent);
  await setSplitRatio(snap.tab_id, split.path, split.side ? 1 - share : share);
}

let tap: ReturnType<typeof startKeytap> = null;
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    saveStats(game.stats);
  } catch {}
  if (selfPane && loadHudPaneId() === selfPane) saveHudPaneId(null);
  accent?.restoreSync();
  iterm.stop();
  focus.stop();
  tap?.stdin?.end();
  tap?.kill();
  process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
}

function exit() {
  cleanup();
  process.exit(0);
}

async function main() {
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, exit);
  process.on("exit", cleanup);
  process.stdout.on("resize", () => (lastFrame = ""));

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on("data", (d) => {
      const s = d.toString();
      if (s === "q" || s === "\x03") exit();
    });
  }

  if (selfPane) {
    saveHudPaneId(selfPane);
    selfTab = await call<{ pane: { tab_id: string } }>("pane.get", { pane_id: selfPane })
      .then((r) => r.pane.tab_id)
      .catch(() => process.env.HERDR_TAB_ID ?? null);
  }
  await focus.start();
  void sizeSelf().catch(() => {});
  await refreshAnchor().catch(() => {});
  accent?.recover();
  if (cfg.itermTint || cfg.itermFlash || cfg.itermBadge) iterm.start();

  tap = startKeytap({
    terminals: cfg.terminals,
    allowAnyApp: cfg.allowAnyApp,
    onKey,
    onStatus: (s) => (tapStatus = s),
  });

  setInterval(draw, FRAME_MS);
}

void main();
