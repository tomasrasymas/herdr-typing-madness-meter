import assert from "node:assert/strict";
import { test } from "node:test";
import { MARK, inject, strip } from "../src/accent.ts";

const plain = "onboarding = false\n\n[ui.sound]\nenabled = false\n";

test("inject appends a [ui] table when there is none, strip removes it exactly", () => {
  const out = inject(plain, "#ff8700");
  assert.match(out, /\[ui\] # typing-madness-meter\naccent = "#ff8700" # typing-madness-meter\n$/);
  assert.equal(strip(out), plain);
});

test("inject into an existing [ui] table disables the user's accent and restores it", () => {
  const cfg = 'x = 1\n[ui]\nsidebar_width = 30\naccent = "blue"\n[ui.sound]\naccent = "keep"\n';
  const out = inject(cfg, "#5fd787");
  const lines = out.split("\n");
  assert.equal(lines[2], `accent = "#5fd787" ${MARK}`);
  assert.ok(lines.includes('# typing-madness-meter-off: accent = "blue"'));
  // accent inside a different table is untouched
  assert.ok(lines.includes('accent = "keep"'));
  assert.equal(strip(out), cfg);
});

test("re-injecting replaces the previous color instead of stacking", () => {
  const once = inject(plain, "#5fd787");
  const twice = inject(once, "#ff3030");
  assert.equal((twice.match(/typing-madness-meter\n/g) ?? []).length, 2);
  assert.doesNotMatch(twice, /5fd787/);
  assert.equal(strip(twice), plain);
});

test("a file without a trailing newline round-trips", () => {
  const cfg = "onboarding = false";
  assert.equal(strip(inject(cfg, "#ffd75f")), cfg);
});
