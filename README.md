# Typing Madness Meter

A [herdr](https://herdr.dev) plugin that measures how mad your typing gets and turns it into a game.

```
  92 WPM ▕████████████░░░░░░░░▏ peak 104   COMBO 143 ×3.5   ACC 97%   ✦  ·   ✧    *  ✦
 LV 7 Keyboard Warrior ▕██████░░░░░░░░░░░░░░▏ 412/1,500 XP   today 4,321 chars   ·  ✦    +
 ⚑ COMBO 150!
```

- **HUD:** a small pane under the one you type in shows live WPM, combo, multiplier, accuracy, XP and level. Sparks fly after the text, and the HUD shakes harder the faster you type.
- **Speed colors:** the border of the pane you're typing in turns green, then yellow, orange and red as your WPM climbs. Inside iTerm2, the herdr window's background also warms up with your speed.
- **Milestones:** every 25-key combo, level-up and new WPM record wiggles the typed pane's border. Inside iTerm2 it also flashes the background and shows a shaking badge (`COMBO 150!`). Level-ups, records and achievements pop a toast.
- **Live badge:** while you type, the pane's border title shows `87 wpm · 120 combo`.
- **Stats:** levels, ranks, achievements, daily totals and a streak, kept between sessions.

## Requirements

- macOS
- [herdr](https://herdr.dev) 0.9.5 or newer
- Node 23.6 or newer on your `PATH`. The plugin runs its TypeScript directly, with no npm dependencies.
- Xcode command line tools (`xcode-select --install`), to build the small key-counting helper
- Optional, for the iTerm2 effects:
  - iTerm2 with its Python API enabled (Settings › General › Magic › Enable Python API)
  - python3

## Install

```sh
herdr plugin install tomasrasymas/herdr-typing-madness-meter
```

herdr shows you the plugin's source and build commands before installing. The build (`scripts/build.sh`) does two things:
- Compiles the key counter.
- If iTerm2 and python3 are present, creates a private Python environment for the iTerm2 effects in the plugin folder.

Then open the HUD:

```sh
herdr plugin action invoke typing-madness-meter.toggle
```

### Allow key counting

The first time, macOS may ask for **Input Monitoring**. If the HUD shows a ⚠ permission message:
1. Open System Settings › Privacy & Security › Input Monitoring.
2. Enable your terminal app (iTerm2, Ghostty, …).
3. Close and reopen the HUD.

macOS credits the permission to the terminal that runs herdr, not to the plugin.

### Keyboard shortcuts (recommended)

Add these to `~/.config/herdr/config.toml`, then run `herdr server reload-config`:

```toml
[[keys.command]]
key = "prefix+t"
type = "plugin_action"
command = "typing-madness-meter.toggle"
description = "typing HUD"

[[keys.command]]
key = "prefix+T"
type = "plugin_action"
command = "typing-madness-meter.stats"
description = "typing stats"
```

### Update or uninstall

```sh
herdr plugin update typing-madness-meter
herdr plugin uninstall typing-madness-meter
```

Your stats and config are kept across updates and reinstalls.

## Use

| Action | What it does |
|---|---|
| `typing-madness-meter.toggle` | Opens the HUD (the "Typing Madness Meter" pane) under the focused pane, or closes it. |
| `typing-madness-meter.stats` | Opens a popup with your level, bests, streak, a 14-day chart and achievements. Any key closes it. |
| `typing-madness-meter.reset` | Clears all stats. |

- Keys count toward whichever herdr pane has focus. Keys typed while the HUD itself is focused don't count.
- Press `q` in the HUD to close it.
- **The HUD follows you.** When you start typing in another pane, it moves under that pane without taking focus. That works in the same tab, another tab or another workspace. It moves when you type, not when you switch, so clicking around doesn't rearrange anything.

## Levels and ranks

You earn XP for every character you type. Your level comes from total XP: reaching level *n* takes **100 × n²** XP. There is no maximum level, and your rank changes at these levels:

| Rank | From level | Total XP | ≈ characters at a ×3 multiplier |
|---|---:|---:|---:|
| Hunt & Peck | 0 | 0 | 0 |
| Home Row Hero | 3 | 900 | 300 |
| Keyboard Warrior | 6 | 3,600 | 1,200 |
| Combo Crusher | 10 | 10,000 | 3,300 |
| Terminal Speedster | 15 | 22,500 | 7,500 |
| Clackmaster | 22 | 48,400 | 16,100 |
| Keyboard Demon | 30 | 90,000 | 30,000 |

## Scoring

- **WPM:** (characters ÷ 5) per minute over a rolling 10-second window. Enter counts as a character. A WPM counts toward records only with at least 25 characters in the window, so short bursts don't set fake records.
- **Combo:** characters typed with gaps shorter than 1.2 seconds. A longer pause breaks it. Backspace doesn't break the combo but lowers accuracy. Arrows, Ctrl shortcuts and other keys keep a combo alive without adding to it. Cmd shortcuts aren't counted at all.
- **Multiplier:** starts at ×1. Every 25 combo keys add ×0.5, up to ×5 (×1.5 at 25, ×3 at 100, ×5 at 200).
- **XP per character:** multiplier × accuracy, where accuracy is the share of your last 200 keys that weren't Backspace. Fast, clean, unbroken typing levels up quickest.
- **Milestones:** every 25 combo, each level-up and each new best WPM (in steps of 5) trigger the wiggle, flash and badge.

### Achievements

| Achievement | How to unlock |
|---|---|
| First Steps | Type 100 characters |
| Cruising | Reach 60 WPM |
| Ton Up | Reach 100 WPM |
| Ludicrous Speed | Reach 140 WPM |
| Combo Starter | Hit a 100 combo |
| Unbroken | Hit a 500 combo |
| Flow State | Hit a 1000 combo |
| Marathon | Type 10,000 characters in one day |
| Habit Forming | Type 500+ characters 7 days in a row |
| Night Owl | Type 200 characters between 2 and 5 AM |

## Configuration

All settings are optional. Create `config.json` in the plugin's config folder:

```sh
open "$(herdr plugin config-dir typing-madness-meter)"
```

Settings are read when the HUD starts. Toggle the HUD off and on after changing them. Leave out any key to keep its default.

### Speed colors

```json
{
  "tierWpm": [25, 45, 65, 85],
  "tierColors": ["#5fd787", "#ffd75f", "#ff8700", "#ff3030"],
  "borderColor": true,
  "itermTint": true
}
```

| Key | Default | Meaning |
|---|---|---|
| `tierWpm` | `[25, 45, 65, 85]` | Minimum WPM for each of the four speed tiers. Must be four increasing numbers. Lower them to see colors sooner, raise them to make red harder to reach. |
| `tierColors` | green, yellow, orange, red | Hex colors (`#rrggbb`) for those four tiers. Used for the pane border, the iTerm2 tint and the HUD's WPM number. Below the first tier, nothing is colored. |
| `borderColor` | `true` | Color the border of the pane you're typing in. |
| `itermTint` | `true` | iTerm2 only. Tint the herdr window's background toward the tier color. It gets stronger the faster you type. |

For example, to go from cool blue to hot pink, starting at 20 WPM:

```json
{
  "tierWpm": [20, 40, 60, 80],
  "tierColors": ["#5fafff", "#af87ff", "#ff5fd7", "#ff0087"]
}
```

### Score

```json
{
  "comboGapMs": 1200,
  "comboStep": 25,
  "maxMultiplier": 5,
  "comboMilestone": 25
}
```

| Key | Default | Meaning |
|---|---|---|
| `comboGapMs` | `1200` | Longest pause, in milliseconds, before the combo breaks. Raise it for a more forgiving combo. |
| `comboStep` | `25` | Combo keys needed for each extra ×0.5 on the multiplier. Lower it to earn XP faster. |
| `maxMultiplier` | `5` | Highest the multiplier can go. |
| `comboMilestone` | `25` | A combo milestone (wiggle, flash, badge) fires every this many keys. |

Changing the scoring rules doesn't recalculate XP you've already earned.

### Effects and behavior

| Key | Default | Meaning |
|---|---|---|
| `jiggle` | `true` | Wiggle the typed pane's border on milestones. |
| `jiggleCells` | `1` | How far the border wiggles, in cells. |
| `itermFlash` | `true` | iTerm2 only. Flash the background on milestones. |
| `itermBadge` | `true` | iTerm2 only. Show a shaking badge (`COMBO 150!`) on milestones. |
| `badge` | `true` | Show `87 wpm · 120 combo` on the typed pane's border title. |
| `toasts` | `true` | Toast on level-ups, records and achievements. |
| `follow` | `true` | Move the HUD under whichever pane you start typing in. |
| `hudHeight` | `6` | HUD height in rows. |
| `terminals` | built-in list | Bundle ids of terminal apps whose keys count. By default: iTerm2, Ghostty, Terminal, WezTerm, kitty, Alacritty and Warp. |
| `allowAnyApp` | `false` | Count keys no matter which app is frontmost. |

## How the effects work, and what they touch

- **Border color:** herdr has no API for changing colors at runtime. To color the focused pane's border, the HUD temporarily adds a line ending in `# typing-madness-meter` under `[ui]` in your herdr `config.toml`, then reloads the config.
  - A reload takes about 50ms and happens at most once every 0.8s, only when your speed tier changes.
  - If you already set `accent` there, it is commented out as `# typing-madness-meter-off: …` and restored exactly.
  - The line is removed again 3 seconds after you stop typing and when the HUD closes. If a crash leaves it behind, the next HUD start removes it.
  - Set `"borderColor": false` and the plugin never touches the file.
- **iTerm2 effects:** these only change the current session's colors and badge, never your saved profile. When the HUD closes, the bridge (`iterm/bridge.py`) restores everything from the saved profile.
- **Shake:** herdr can't move panes, so the HUD shakes its own content. The typed pane's border wiggles one cell for about 160ms, which briefly resizes that pane. A pane alone in its tab has no border to wiggle.

## Privacy

- The key counter (`native/keytap/main.swift`) never reports which key you pressed. Each key press becomes one of `char`, `backspace`, `enter` or `other` before it leaves the helper.
- Cmd shortcuts are ignored, and nothing is counted unless a terminal app is frontmost.
- Stats stay on your machine, in `$HERDR_PLUGIN_STATE_DIR/stats.json`. Nothing is sent anywhere.

## Limitations

- Keys count for herdr's focused pane whenever an allowed terminal app is frontmost, even if the front window is a different terminal window, not herdr.
- The background tint and flash apply to the whole herdr window in iTerm2, not to a single pane.

## Development

```sh
git clone https://github.com/tomasrasymas/herdr-typing-madness-meter
cd herdr-typing-madness-meter
sh scripts/build.sh
herdr plugin link "$PWD"

npm install        # only for type checking
npm test           # node --test, no herdr needed
npm run typecheck
```

`src/hud.ts` is the long-running process. It owns the key counter, the iTerm2 bridge, the herdr event subscription and the game state, and everything stops when the HUD pane closes. `src/game.ts`, `src/tiers.ts`, `src/jiggle.ts`, `src/accent.ts` and `src/render.ts` hold the logic and are unit-tested.

Notes on herdr 0.9.5's API that shaped the design:

- Plugins get no keystroke or output events. `events.subscribe` only covers lifecycle events, and `events.wait` only matches agent status. That's why the plugin uses a native key counter.
- A socket connection serves exactly one request, then closes. Subscriptions are the exception.
- Exactly one pane in `pane.list` has `focused: true`: the UI-focused pane across the session.
- `layout.export` wraps its tree in `result.layout`. `layout.set_split_ratio` paths are booleans from the root: `false` = first child, `true` = second.
- `pane.report_metadata`'s `ttl_ms` expires the title as well as the tokens.
- Wrapping the shell (`terminal.default_shell`) to read keys would hide agent processes from herdr's detection, so the plugin doesn't do that.

## License

MIT. See [LICENSE](LICENSE).
