// Owner decisions D3 to D7 of the 11-20 map audit (Mike: yes to all). D4: the time views leave the page header; World | Battle is
// a switch on the map and Now / Day / Week / Month the Time row of Layers. D6: the replay bar has a Sound button (M key).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";

const SRC = fs.readFileSync(new URL("../dist/server.js", import.meta.url), "utf8");
const load = async (f) => { const o = await build({ entryPoints: [new URL("../src/" + f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false }); return import("data:text/javascript;base64," + Buffer.from(o.outputFiles[0].text).toString("base64")); };
const W = await load("world.ts"), GC = await load("growthclient.ts"), BC = fs.readFileSync(new URL("../src/battleclient.ts", import.meta.url), "utf8");

test("D4 markup: World | Battle switch on the map, the Time row in the toolbar for Layers; rays start off (D5)", () => {
  assert.match(W.MODE_HTML, /^<div class="w-mode" role="group" aria-label="Map mode"><button type="button" data-gmode="world" aria-pressed="true">World<\/button><button type="button" data-gmode="battle" aria-pressed="false">Battle<\/button><\/div>$/);
  assert.match(W.TIME_HTML, /^<div class="c-lrow w-time" role="group" aria-labelledby="w-time-l"><span id="w-time-l">Time<\/span>/);
  for (const v of ["now", "day", "week", "month"]) assert.ok(W.TIME_HTML.includes(`data-gview="${v}"`));
  assert.ok(!W.TIME_HTML.includes('data-gview="battle"'));
  assert.match(SRC, /<canvas id="city" aria-label="Isometric world map of \$\{n\} member cities"><\/canvas>\$\{BT2? \? MODE_HTML : ""\}/);
  assert.match(SRC, /<div class="c-tools">\$\{G2? \? TIME_HTML : ""\}<button id="t-labels"/);
  assert.match(SRC, /<button id="t-fr" aria-pressed="false"/, "D5: Friendships starts off");
});

test("D4 CSS: phone header is one 44px row; the switch sits top left with the status chip beside it (L, M)", () => {
  const css = W.WORLD_CSS;
  assert.ok(!css.includes(".w-head .w-view"), "no time switch in the header");
  assert.match(css, /@media \(max-width:699px\)\{[^]*?\.w-head\{height:44px;padding:2px 0;gap:10px\}/);
  assert.match(css, /\.w-mode\{position:absolute;left:12px;top:12px;z-index:7;/);
  assert.match(css, /\.w-mode button\[aria-pressed="true"\]\{background:#F4F6FA;color:#0B0D13\}/, "selected segment white");
  assert.match(css, /html\.w-battle \.w-main \.c-stage:has\(\.w-mode\) \.b-chip\{left:136px;top:12px/);
  assert.match(css, /html\.w-battle \.w-main \.c-stage:has\(\.w-mode\) \.b-chip\{left:12px;top:52px;bottom:auto;max-width:calc\(100% - 24px\)\}/, "phone: the chip sits under the switch (BATTLE.md U2, the bottom edge is for Replay)");
  assert.match(css, /\.c-tools>\.w-time\{display:none\}/, "hidden until the renderer moves it into Layers");
  assert.match(css, /html\.w-replay \.w-mode,html\.w-replay \.w-main \.g-today\{display:none\}/, "the theater shows only the replay");
  assert.match(W.CARD_CLEAR_JS, /'\.b-chip,\.w-mode,\.w-of-chip,\.c-tools,/, "the city card opens under the switch");
});

// a small fake page for growthClient(): buttons with attributes and click handlers
function fakePage(url) {
  const mk = (attr, v) => { const a = { [attr]: v, "aria-pressed": "false" }, h = []; return { getAttribute: (k) => (k in a ? a[k] : null), setAttribute: (k, x) => { a[k] = String(x); }, addEventListener: (t, f) => h.push(f), click: () => h.forEach(f => f()), pressed: () => a["aria-pressed"] }; };
  const views = ["now", "day", "week", "month"].map(v => mk("data-gview", v)), modes = ["world", "battle"].map(v => mk("data-gmode", v));
  const store = {}, calls = [], cls = new Set();
  const G = { window: {}, location: { href: url }, history: { state: null, replaceState: (s, t, u) => { G.location.href = "http://x" + u; } } };
  G.window.CALDERA_GROWTH = { totals: {}, window: "day", from: "2026-11-20", to: "2026-11-20" }; G.window.CALDERA_BATTLE = {};
  G.window.CALDERA_GROWTH_API = { view: (v) => calls.push("view:" + v), cursor() {}, drops() {} };
  G.window.CALDERA_BATTLE_UI = { show: () => calls.push("show"), hide: () => calls.push("hide") };
  G.document = { documentElement: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } }, getElementById: () => null, querySelector: () => null,
    querySelectorAll: (s) => (s === "[data-gview]" ? views : s === "[data-gmode]" ? modes : []) };
  G.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  G.fetch = () => Promise.resolve({ ok: true, json: () => ({ totals: {}, window: "week", from: "2026-11-14", to: "2026-11-20" }) });
  G.performance = { now: () => 0 }; G.requestAnimationFrame = () => 0; G.cancelAnimationFrame = () => {};
  return { G, views, modes, store, calls };
}
function run(P) { const f = new Function("window", "document", "location", "history", "localStorage", "fetch", "performance", "requestAnimationFrame", "cancelAnimationFrame", "URL", "(" + GC.growthClient.toString() + ")();");
  const g = P.G; f(g.window, g.document, g.location, g.history, g.localStorage, g.fetch, g.performance, g.requestAnimationFrame, g.cancelAnimationFrame, URL); }

test("D4 behaviour: World | Battle switches mode, World returns to the last time view, Time buttons keep ?view links", () => {
  const P = fakePage("http://x/world"); run(P);
  const [now, day] = P.views, [world, battle] = P.modes;
  assert.equal(world.pressed(), "true"); assert.equal(battle.pressed(), "false"); assert.equal(now.pressed(), "true");
  day.click(); assert.equal(day.pressed(), "true"); assert.equal(world.pressed(), "true"); assert.match(P.G.location.href, /view=day/);
  battle.click(); assert.equal(battle.pressed(), "true"); assert.equal(world.pressed(), "false"); assert.match(P.G.location.href, /view=battle/); assert.ok(P.calls.includes("show"));
  assert.equal(day.pressed(), "false", "no time view pressed in Battle");
  world.click(); assert.equal(world.pressed(), "true"); assert.equal(day.pressed(), "true", "back to Day, the last time view"); assert.match(P.G.location.href, /view=day/);
  world.click(); assert.equal(day.pressed(), "true", "World while in World changes nothing");
  assert.equal(P.store["caldera.worldView"], "day");
});

test("D4 behaviour: a ?view=battle link opens in Battle with the switch on Battle", () => {
  const P = fakePage("http://x/world?view=battle"); run(P);
  assert.equal(P.modes[1].pressed(), "true"); assert.equal(P.modes[0].pressed(), "false");
});

test("D6: Sound sits in the replay bar's menu, wired to the renderer's sound(); M toggles it", () => {
  assert.match(BC, /role="menuitemcheckbox" data-p="snd" aria-checked="true" aria-label="Sound" title="Sound \(M\)"/);
  assert.match(BC, /hudEl\.querySelector\('\[data-p="snd"\]'\)\.onclick = function \(\) \{ if \(A\(\) && A\(\)\.sound\) A\(\)\.sound\(!A\(\)\.sound\(\)\); refresh\(\); \}/);
  assert.match(BC, /e\.key === 'm' \|\| e\.key === 'M' \? 'snd'/);
  assert.match(BC, /bIco\(son \? 'snd' : 'muted'\) \+ '<span>Sound<\/span><em>' \+ \(son \? 'On' : 'Off'\)/);
});

test("Mike 11-21: Full screen is the viewer's own choice (menu item, F key, Exit icon while on); End leaves it; nothing forces it", () => {
  assert.match(BC, /role="menuitem" data-p="full" aria-label="Full screen" title="Full screen \(F\)"><\/button>/);
  assert.match(BC, /data-p="unfull" aria-label="Exit full screen" title="Exit full screen \(F\)" hidden>/);
  assert.match(BC, /hudEl\.querySelector\('\[data-p="full"\]'\)\.onclick = function \(\) \{ if \(A\(\) && A\(\)\.full\) \{ A\(\)\.full\(!A\(\)\.full\(\)\);/);
  assert.match(BC, /e\.key === 'f' \|\| e\.key === 'F' \? 'full'/);
  assert.match(BC, /function stopPlay\(\) \{ var had = !!hudEl; try \{ if \(api\(\) && api\(\)\.full && api\(\)\.full\(\)\) api\(\)\.full\(false\);/);
  assert.match(BC, /document\.addEventListener\('fullscreenchange', fsSync\)/);
});

test("Mike 11-21: compact replay bar: only Prev, Play/Pause, Next, More and End in view; Speed, Fit, Sound, Full screen in one menu", () => {
  const pb = BC.slice(BC.indexOf('<div class="b-pb">'), BC.indexOf('<div class="b-menu"'));
  const inBar = [...pb.matchAll(/data-p="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(inBar, ["follow", "prev", "pause", "skip", "unfull", "more", "stop"]);
  const menu = BC.slice(BC.indexOf('<div class="b-menu"'), BC.indexOf("var A = function () { return api(); }"));
  assert.deepEqual([...menu.matchAll(/data-p="(\w+)"/g)].map(m => m[1]), ["pic", "speed", "fit", "snd", "full", "math", "flagm"], "BATTLE.md (11-24): Save strike picture first; the hit line and the report flag move in on small panes");
  assert.doesNotMatch(pb, />(Prev|Pause|Next|End|Fit|Sound)</, "icon controls, no text buttons");
  assert.match(BC, /st === 'beat' \|\| st === 'pre' \? ph\.beat \+ '\/' \+ ph\.beats/, "short beat 5/7");
  assert.match(BC, /e\.target\.closest\('\.b-menu'\)\)\) return;/, "keys inside the menu do not pause");
});
