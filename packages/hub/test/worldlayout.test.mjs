// Mike 11-19 (Duo landscape 868x669 with the tab bar): status pill under the tools, last-night card inside the map with
// its rows scrolling, LIVE panel out of the way, bottom sheet on phones, map down to just above the tab bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const SRC = fs.readFileSync(new URL("../dist/server.js", import.meta.url), "utf8");
const BATTLE_CSS = SRC, WORLD_FIT_JS = SRC;

test("battle overlays: pill row under the tools; the morning card is gone (its rows are the Last night card, PAGE.md P4)", () => {
  assert.match(BATTLE_CSS, /@media \(min-width:601px\)\{\.b-chip\{top:48px;max-width:min\(360px,calc\(100% - 20px\)\)/);
  assert.ok(!SRC.includes(".b-recap{") && !SRC.includes("className = 'b-recap'") && !SRC.includes("caldera.world.recap"), "no morning overlay and no key for it");
  assert.match(BATTLE_CSS, /\.c-stage:has\(\.b-chip\) \.g-today\{top:80px/);
});

test("world fit: with a tab bar the map stops above it, leaving 50px of the deck in Battle mode (map audit 11-20)", () => {
  assert.doesNotMatch(WORLD_FIT_JS, /@media \(min-width:601px\) and \(max-height:760px\)/, "one header row: no one-line-intro rule");
  assert.match(WORLD_FIT_JS, /if\(!bb\|\|innerWidth<700\)/, "M and L only; under 700px the CSS sets the height");
  assert.match(WORLD_FIT_JS, /deck=R\.classList\.contains\('w-battle'\)\?58:10,h=Math\.round\(innerHeight-top-bb-deck\)/);
  assert.match(WORLD_FIT_JS, /if\(h<380\)h=Math\.round\(innerHeight-nh-bb-16\)/);
  assert.match(WORLD_FIT_JS, /if\(st\.classList\.contains\('c-full'\)\)return/);
  assert.match(WORLD_FIT_JS, /attributeFilter:\['class'\]/, "refits when the mode changes");
});

test("world map height: the top of the Tonight card shows on the first screen (PAGE.md section 4)", () => {
  assert.match(SRC, /\.w-main \.c-stage:not\(\.c-full\)\{height:calc\(100vh - 130px\);height:calc\(100svh - 130px\);min-height:460px\}/, "L, World mode");
  assert.match(SRC, /html\.w-battle \.w-main \.c-stage:not\(\.c-full\)\{height:calc\(100vh - 200px\);height:calc\(100svh - 200px\);min-height:460px\}/, "L, Battle");
  assert.match(SRC, /@media \(min-width:700px\) and \(max-width:899px\)\{[^@]*html\.w-battle \.w-main \.c-stage:not\(\.c-full\)\{height:calc\(100vh - 212px\);height:calc\(100svh - 212px\);min-height:380px\}/, "M, Battle");
  assert.match(SRC, /@media \(max-width:699px\)\{[^@]*html\.w-battle \.w-main \.c-stage:not\(\.c-full\)\{height:calc\(100vh - 228px\);height:calc\(100svh - 228px\);min-height:400px\}/, "S, Battle");
  assert.match(SRC, /html\.ch-duo-outer\.w-battle \.w-main \.c-stage:not\(\.c-full\)\{height:calc\(100svh - 212px\);min-height:380px\}/, "Duo with the tab bar");
});
