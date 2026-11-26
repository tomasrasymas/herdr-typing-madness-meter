// HUD pane entrypoint. This process is the plugin's daemon: it owns the
// keytap helper, the herdr subscriptions and the game state, and everything
// stops when the HUD pane closes.

import fs from "node:fs";
import path from "node:path";
import { AccentController } from "./accent.ts";
import { idleFade, setTierColors, setTierWpm, speedTier, tierColor, tintAmount } from "./tiers.ts";
import { loadConfig, stateDir } from "./config.ts";
import { ItermBridge } from "./iterm.ts";
import { FocusTracker } from "./focus.ts";
import { Game, emptyStats } from "./game.ts";
import type { GameEvent, KeyClass } from "./game.ts";
import { call, exportLayout, listPanes, notify, paneLayout, setSplitRatio } from "./herdr.ts";
import type { HerdrEvent, LayoutNode } from "./herdr.ts";
import { Jiggler, bottomPane, findParentSplit } from "./jiggle.ts";
import { leftmost, ratioPaths, rebuildMoves, withoutPane } from "./dock.ts";
import { startKeytap } from "./keytap.ts";
import type { TapStatus } from "./keytap.ts";
import { DIM, fg, renderFrame } from "./render.ts";
import type { Line } from "./render.ts";
import { loadHud, loadStats, saveHud, saveStats as storeStats } from "./store.ts";
import { startDemoFeed } from "./demo-feed.ts";
import type { Stats } from "./game.ts";

// Demo mode (TMM_DEMO=1, opened by the demo action): keys come from the
// self-typing demo pane instead of the keyboard, stats start fresh and are
// never saved, and the HUD never moves or touches the real HUD's state.
const DEMO = process.env.TMM_DEMO === "1";
const saveStats = (stats: Stats) => {
  if (!DEMO) storeStats(stats);
};
/** Record where the HUD lives, so the toggle and the reopen hook can find it. */
const saveHome = () => {
  if (!DEMO && selfPane) saveHud({ pane_id: selfPane, tab_id: selfTab, workspace_id: selfWorkspace });
};
/** Forget the HUD: it was closed on purpose and should stay closed. */
const forgetHome = () => {
  if (!DEMO && selfPane && loadHud()?.pane_id === selfPane) saveHud(null);
};
/** Fresh demo stats, a few XP short of level 3 so a level-up shows early. */
function demoStats(): Stats {
  return { ...emptyStats(), totalXp: 860 };
}

const FRAME_MS = 33;
const SAVE_DEBOUNCE_MS = 5000;
const BADGE_INTERVAL_MS = 500;
const RESET_FLAG = path.join(stateDir(), "reset-request");

const cfg = loadConfig();
setTierWpm(cfg.tierWpm);
setTierColors(cfg.tierColors);
const game = new Game(DEMO ? demoStats() : loadStats(), {
  comboGapMs: cfg.comboGapMs,
  comboMilestone: cfg.comboMilestone,
  comboStep: cfg.comboStep,
  maxMultiplier: cfg.maxMultiplier,
});
const focus = new FocusTracker();
const jiggler = new Jiggler({ cells: cfg.jiggleCells });
const accent = cfg.borderColor ? new AccentController() : null;
const iterm = new ItermBridge();
/** The speed tier every color shows: WPM number, border and tint. */
let tier = 0;
// The HUD's own pane. Cross-workspace moves assign a new public id, so this
// is updated after every move.
let selfPane = process.env.HERDR_PANE_ID ?? null;
let selfTab: string | null = null;
let selfWorkspace: string | null = process.env.HERDR_WORKSPACE_ID ?? null;

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
  if (cfg.follow && !DEMO && selfTab && target.tab_id !== selfTab) scheduleDock(0);
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
  if (DEMO || !fs.existsSync(RESET_FLAG)) return;
  fs.rmSync(RESET_FLAG, { force: true });
  game.stats = emptyStats();
  game.sessionPeakWpm = 0;
  saveStats(game.stats);
  show([{ t: " stats reset", s: DIM }], 2000);
}

// ---------------------------------------------------------------- speed colors

/** Border color (herdr accent) and background tint (iTerm2) show the speed tier. */
function speedColors(wpm: number, heat: number, idleMs: number) {
  accent?.setTier(tier);
  if (!cfg.itermTint) return;
  // Once you stop, the tint fades out over the last stretch before the tier
  // (and with it the border) switches off.
  iterm.tint(tierColor(tier).rgb, tintAmount(wpm, heat) * idleFade(idleMs));
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
      return [{ t: " ⚠ keytap helper stopped; reopen the Typing Madness Meter", s: fg(214, true) }];
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
  tier = speedTier(live.wpm, live.idleMs, tier);
  if (frame % 3 === 0) speedColors(live.wpm, live.heat, live.idleMs);
  const amp = Math.min(3, live.heat * 1.6 + burst);
  burst *= 0.88;
  if (burst < 0.05) burst = 0;
  const dx = Math.round((Math.random() * 2 - 1) * amp);
  const dy = amp > 1.2 && Math.random() < 0.3 ? 1 : 0;

  let message = statusLine();
  if (!message && notice && notice.until > t) message = notice.line;
  if (!message && hudFocused()) {
    message = [{ t: " Typing Madness Meter focused: keys typed here don't count (q closes it)", s: DIM }];
  }

  const out = renderFrame({
    live,
    message,
    shake: { dx, dy },
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 6,
    frame: amp > 0.05 ? frame : 0,
    tier,
  });
  if (out !== lastFrame) {
    process.stdout.write(out);
    lastFrame = out;
  }
}

// ---------------------------------------------------------------- docking
//
// The HUD lives at the bottom of the active tab. Switching tabs brings it
// along; moving between panes inside a tab leaves it alone. If a layout change
// leaves it somewhere else (its anchor closed, a split moved it up), it
// re-docks at the bottom of its own tab.

let docking = false;
let lastDockAttempt = 0;
const DOCK_MIN_INTERVAL_MS = 800;
/** Wait for focus to settle, so flipping through tabs moves the HUD once. */
const FOCUS_SETTLE_MS = 150;
let dockTimer: NodeJS.Timeout | null = null;

/** Once focus settles, dock in the focused tab if that's not where the HUD is. */
function scheduleDock(delay = FOCUS_SETTLE_MS) {
  if (!cfg.follow || DEMO) return;
  if (dockTimer) clearTimeout(dockTimer);
  dockTimer = setTimeout(() => {
    dockTimer = null;
    const target = focus.focused;
    if (!selfTab || !target || target.pane_id === selfPane || target.tab_id === selfTab) return;
    const wait = lastDockAttempt + DOCK_MIN_INTERVAL_MS - Date.now();
    if (docking || wait > 0) return scheduleDock(Math.max(wait, FOCUS_SETTLE_MS));
    void dock(target.tab_id, target.workspace_id).then(() => {
      // Focus moved to yet another tab while we were moving: catch up.
      const now = focus.focused;
      if (now && now.tab_id !== target.tab_id && now.tab_id !== selfTab) scheduleDock();
    });
  }, delay);
}

interface MoveResult {
  changed: boolean;
  pane: { pane_id: string; tab_id: string; workspace_id?: string };
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
    selfWorkspace = result.pane.workspace_id ?? selfWorkspace;
  }
  return result;
}

/** Move any pane (not just the HUD); throws if herdr didn't move it. */
async function moveOther(paneId: string, destination: object, focusIt = false) {
  const r = await call<{ move_result?: MoveResult } & MoveResult>("pane.move", {
    pane_id: paneId,
    destination,
    focus: focusIt,
  });
  if (!(r.move_result ?? r).changed) throw new Error(`could not move ${paneId}`);
}

/**
 * Put the HUD in a full-width strip at the bottom of `tabId`.
 *
 * - If the tab's bottom row is one full-width pane, the HUD just splits it.
 * - Otherwise the tab is rebuilt as down(<its layout>, HUD): the HUD parks
 *   in a holding tab, the tab's other panes join it there, the HUD goes under
 *   the one pane left, and the others move back in, recreating the original
 *   splits. Processes keep running and pane ids don't change; focus returns
 *   to the pane you were in. The holding tab closes by itself once empty.
 */
async function dock(tabId: string, workspaceId: string | null) {
  if (!selfPane || docking) return;
  docking = true;
  lastDockAttempt = Date.now();
  const home = selfTab;
  let holding: string | null = null;
  let tree: LayoutNode | null = null;
  try {
    const exported = await exportLayout(tabId);
    if (exported.zoomed) return; // herdr refuses moves in zoomed tabs
    tree = withoutPane(exported.root, selfPane);
    const first = tree && leftmost(tree);
    if (!tree || !first) return; // nothing to dock under

    const snap = await paneLayout(first);
    const others = snap.panes.filter((p) => p.pane_id !== selfPane);
    const bottom = bottomPane(others, snap.area);
    const bottomRect = others.find((p) => p.pane_id === bottom)?.rect;
    const simple = !!bottom && bottomRect?.width === snap.area.width;

    if (simple && tabId !== selfTab) {
      if (!(await movePane({ type: "tab", tab_id: tabId, target_pane_id: bottom, split: "down" })).changed) return;
    } else {
      // Park the HUD in a fresh tab; it doubles as the holding tab.
      if (!(await movePane({ type: "new_tab", workspace_id: workspaceId ?? selfWorkspace })).changed) return;
      holding = selfTab;
      if (simple) {
        await movePane({ type: "tab", tab_id: tabId, target_pane_id: bottom, split: "down" });
      } else {
        const focused = focus.focused?.tab_id === tabId ? focus.focused.pane_id : null;
        const moves = rebuildMoves(tree);
        for (const m of moves) {
          await moveOther(m.pane, { type: "tab", tab_id: holding, target_pane_id: selfPane, split: "right" });
        }
        if (!(await movePane({ type: "tab", tab_id: tabId, target_pane_id: first, split: "down" })).changed) {
          throw new Error("could not dock");
        }
        for (const m of moves) {
          await moveOther(m.pane, { type: "tab", tab_id: tabId, target_pane_id: m.target, split: m.split }, m.pane === focused);
        }
        for (const r of ratioPaths(tree, [false])) await setSplitRatio(tabId, r.path, r.ratio).catch(() => {});
      }
      holding = null;
    }
    saveHome();
    lastFrame = "";
    await sizeSelf().catch(() => {});
  } catch {
    await recover(tabId, holding, home, tree);
  } finally {
    docking = false;
  }
}

/** A dock failed midway: bring stranded panes and the HUD back, best effort. */
async function recover(tabId: string, holding: string | null, home: string | null, tree: LayoutNode | null) {
  if (holding) {
    const anchor = tree && leftmost(tree);
    const stranded = (await listPanes().catch(() => [])).filter((p) => p.tab_id === holding && p.pane_id !== selfPane);
    for (const p of stranded) {
      await moveOther(p.pane_id, { type: "tab", tab_id: tabId, target_pane_id: anchor ?? undefined, split: "right" }).catch(
        () => {},
      );
    }
  }
  if (selfTab === holding || (home && selfTab !== home && selfTab !== tabId)) {
    await movePane({ type: "tab", tab_id: home && home !== holding ? home : tabId, split: "down" }).catch(() => {});
  }
}

/** Re-dock unless the HUD is a full-width strip at the bottom of its tab. */
async function checkDocked() {
  if (!cfg.follow || DEMO || docking || !selfPane || !selfTab) return;
  const snap = await paneLayout(selfPane);
  const me = snap.panes.find((p) => p.pane_id === selfPane);
  if (!me) return;
  if (snap.panes.length === 1) {
    // Everything else in this tab closed: go to the tab you're in, if any.
    const f = focus.focused;
    if (f && f.tab_id !== selfTab) void dock(f.tab_id, f.workspace_id);
    return;
  }
  const atBottom = me.rect.y + me.rect.height >= snap.area.y + snap.area.height;
  const fullWidth = me.rect.x === snap.area.x && me.rect.width === snap.area.width;
  if (atBottom && fullWidth) {
    // A closed neighbor's space goes to the HUD: shrink back to size.
    if (me.rect.height > cfg.hudHeight + 1) await sizeSelf().catch(() => {});
    return;
  }
  void dock(selfTab, selfWorkspace);
}

function onLayoutEvent(_ev: HerdrEvent) {
  if (!docking) void checkDocked().catch(() => {});
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

/** `keepHome`: herdr hung up on the HUD; leave the record for the close hooks. */
function cleanup(keepHome = false) {
  if (cleaned) return;
  cleaned = true;
  try {
    saveStats(game.stats);
  } catch {}
  if (!keepHome) forgetHome();
  accent?.restoreSync();
  iterm.stop();
  focus.stop();
  tap?.stdin?.end();
  tap?.kill();
  process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
}

function exit(keepHome = false) {
  cleanup(keepHome);
  process.exit(0);
}

/**
 * herdr hangs up on the HUD both when its own pane is closed and when its
 * whole tab or workspace goes, and it can't answer questions while doing so.
 * Keep the record either way: the pane.closed hook clears it when it was the
 * HUD's own pane, and the tab.closed hook reopens the HUD otherwise.
 */
function onHangup() {
  exit(true);
}

async function main() {
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  process.on("SIGINT", () => exit());
  for (const sig of ["SIGTERM", "SIGHUP"] as const) process.on(sig, onHangup);
  process.on("exit", () => cleanup());
  process.stdout.on("resize", () => (lastFrame = ""));

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on("data", (d) => {
      const s = d.toString();
      if (s === "q" || s === "\x03") exit();
    });
  }

  if (selfPane) {
    const pane = await call<{ pane: { tab_id: string; workspace_id: string } }>("pane.get", { pane_id: selfPane })
      .then((r) => r.pane)
      .catch(() => null);
    selfTab = pane?.tab_id ?? process.env.HERDR_TAB_ID ?? null;
    selfWorkspace = pane?.workspace_id ?? selfWorkspace;
    saveHome();
  }
  focus.onEvent = onLayoutEvent;
  focus.onFocusChange = () => scheduleDock();
  await focus.start();
  void sizeSelf().catch(() => {});
  await checkDocked().catch(() => {});
  accent?.recover();
  if (cfg.itermTint || cfg.itermFlash || cfg.itermBadge) iterm.start();

  if (DEMO) {
    tapStatus = "ready";
    startDemoFeed(onKey, () => {
      show([{ t: " ✓ demo complete", s: fg(114, true) }], 3000);
      setTimeout(exit, 2000);
    });
  } else {
    tap = startKeytap({
      terminals: cfg.terminals,
      allowAnyApp: cfg.allowAnyApp,
      onKey,
      onStatus: (s) => (tapStatus = s),
    });
  }

  setInterval(draw, FRAME_MS);
}

void main();
