import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/game.ts";
import { hudLines, lineWidth, renderFrame, renderLine } from "../src/render.ts";
import type { Line } from "../src/render.ts";
import { statsLines } from "../src/stats.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

test("renderLine shifts right and clips to width", () => {
  const line: Line = [{ t: "hello" }, { t: " world", s: "1" }];
  assert.equal(strip(renderLine(line, 2, 8)), "  hello ");
  assert.equal(strip(renderLine(line, -3, 20)), "lo world");
});

test("HUD lines never exceed the pane width", () => {
  const g = new Game();
  let t = Date.now();
  for (let i = 0; i < 300; i++) g.key("char", (t += 80));
  for (const width of [40, 80, 120]) {
    const view = { live: g.live(t), message: null, shake: { dx: 3, dy: 1 }, width, height: 7, frame: 5 };
    for (const line of hudLines(view)) {
      assert.ok(strip(renderLine(line, 3, width)).length <= width);
    }
    const rows = strip(renderFrame(view)).split("\r\n");
    assert.equal(rows.length, 7);
  }
});

test("HUD shows WPM and combo", () => {
  const g = new Game();
  let t = Date.now();
  for (let i = 0; i < 60; i++) g.key("char", (t += 100));
  const [wpmLine] = hudLines({ live: g.live(t), message: null, shake: { dx: 0, dy: 0 }, width: 120, height: 7, frame: 0 });
  const text = strip(renderLine(wpmLine, 0, 120));
  assert.match(text, /\d+ WPM/);
  assert.match(text, /COMBO 60/);
  assert.equal(lineWidth(wpmLine), text.length);
});

test("sparks sit after the text on the first two lines, with no spark row", () => {
  const g = new Game();
  let t = Date.now();
  for (let i = 0; i < 40; i++) g.key("char", (t += 50));
  const lines = hudLines({ live: g.live(t), message: null, shake: { dx: 0, dy: 0 }, width: 140, height: 7, frame: 3 });
  assert.equal(lines.length, 3);
  const first = strip(renderLine(lines[0], 0, 140));
  const tail = first.slice(first.indexOf("ACC") + 8);
  assert.match(tail, /[·✦✧*+˙]/);
  assert.ok(first.length <= 140);
});

test("stats popup renders from stats", () => {
  const g = new Game();
  let t = Date.now();
  for (let i = 0; i < 200; i++) g.key("char", (t += 90));
  const text = statsLines(g.stats, t).map((l) => strip(renderLine(l, 0, 200))).join("\n");
  assert.match(text, /Best WPM \d+/);
  assert.match(text, /★ First Steps/);
});
