// Mike 11-19 (Duo landscape 868x669 with the tab bar): status pill under the tools, last-night card inside the map with
// its rows scrolling, LIVE panel out of the way, bottom sheet on phones, map down to just above the tab bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const SRC = fs.readFileSync(new URL("../dist/server.js", import.meta.url), "utf8");
const BATTLE_CSS = SRC, WORLD_FIT_JS = SRC;

test("battle overlays: pill row under the tools, card fits the map", () => {
  assert.match(BATTLE_CSS, /@media \(min-width:601px\)\{\.b-chip\{top:48px;max-width:min\(360px,calc\(100% - 20px\)\)/);
  assert.match(BATTLE_CSS, /\.b-recap\{top:48px;max-height:calc\(100% - 58px\)\}/);
  assert.match(BATTLE_CSS, /\.b-recap dl\{flex:0 1 auto;min-height:0;overflow-y:auto/);
  assert.match(BATTLE_CSS, /\.c-stage:has\(\.b-recap\) \.c-live,\.c-stage:has\(\.b-recap\) \.c-hint\{display:none\}/);
  assert.match(BATTLE_CSS, /@media \(max-width:600px\)\{\.b-recap\{left:8px;right:8px;bottom:8px;top:auto;width:auto;max-height:62%\}\}/);
  assert.match(BATTLE_CSS, /\.c-stage:has\(\.b-chip\) \.g-today\{top:80px/);
});

test("world fit: short screens get a one-line intro; with a tab bar the map stops above it", () => {
  assert.match(WORLD_FIT_JS, /@media \(min-width:601px\) and \(max-height:760px\)/);
  assert.match(WORLD_FIT_JS, /innerHeight-top-bb-10/);
  assert.match(WORLD_FIT_JS, /if\(h<380\)h=Math\.round\(innerHeight-nh-bb-16\)/);
  assert.match(WORLD_FIT_JS, /if\(st\.classList\.contains\('c-full'\)\)return/);
});
