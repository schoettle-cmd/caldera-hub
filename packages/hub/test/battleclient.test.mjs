// The Battle view's replay controls (battleclient.ts): the speed the viewer picks is remembered per viewer in localStorage (and
// nothing breaks where storage is blocked), the bar is one compact row of 44 px targets, the page script parses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({ entryPoints: [new URL("../src/battleclient.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const M = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const L = M.battleSpeedLib();
const fakeStore = (init = {}) => { const d = { ...init }; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } }; };

test("speed: only 0.5x, 1x and 2x exist; the control cycles 0.5x -> 1x -> 2x -> 0.5x; labels read 0.5x, 1x, 2x", () => {
  assert.deepEqual(L.SPEEDS, [0.5, 1, 2]);
  assert.deepEqual([0.5, 1, 2, 3, 0, -1, "2", "0.5", "x", null, undefined, NaN, Infinity].map(L.ok), [0.5, 1, 2, 1, 1, 1, 2, 0.5, 1, 1, 1, 1, 1]);
  assert.deepEqual([0.5, 1, 2].map(L.next), [1, 2, 0.5]); assert.equal(L.next("junk"), 2, "a bad speed counts as 1x, so the next is 2x");
  assert.deepEqual([0.5, 1, 2].map(L.label), ["0.5x", "1x", "2x"]);
});

test("speed persistence: the choice is saved per viewer and read back; 1x for a first visit; junk or blocked storage means 1x and never throws", () => {
  const s = fakeStore();
  assert.equal(L.load(s), 1, "first visit: 1x");
  assert.equal(L.save(2, s), true); assert.equal(s.d[L.KEY], "2"); assert.equal(L.load(s), 2, "next visit: 2x");
  assert.equal(L.save(0.5, s), true); assert.equal(L.load(s), 0.5);
  assert.equal(L.save(7, s), true); assert.equal(s.d[L.KEY], "1", "a bad value is stored as 1x"); assert.equal(L.load(s), 1);
  for (const junk of ["", "fast", "NaN", "3", "-1", "{}", "null"]) assert.equal(L.load(fakeStore({ [L.KEY]: junk })), 1, `junk ${JSON.stringify(junk)} reads as 1x`);
  // storage that throws on every read and write (private windows, blocked site data), and one whose accessor itself throws
  const bad = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); } };
  assert.equal(L.load(bad), 1); assert.equal(L.save(2, bad), false, "a failed write is reported, not thrown");
  assert.equal(L.load(undefined), 1, "no localStorage at all (node): 1x"); assert.equal(L.save(2, undefined), false);
  // the real thing: the page's localStorage global
  globalThis.localStorage = fakeStore(); try { assert.equal(L.save(2), true); assert.equal(L.load(), 2); } finally { delete globalThis.localStorage; }
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError: the operation is insecure"); } });
  try { assert.equal(L.load(), 1); assert.equal(L.save(2), false); } finally { delete globalThis.localStorage; }
});

test("battle client script: parses, reads the saved speed at start, starts replays at it, saves a change; one compact bar of 44 px controls", () => {
  const js = M.BATTLE_CLIENT_JS; new Function(js);
  assert.ok(js.includes("speed = BSPD.load()"), "starts at the viewer's saved speed"); assert.ok(/api\(\)\.replay\(mode, \{ speed(: speed)? \}\)/.test(js), "a replay starts at it");
  assert.ok(/speed = BSPD\.next\(speed\);\s*BSPD\.save\(speed\);\s*if \(A\(\) && A\(\)\.speed\) A\(\)\.speed\(speed\)/.test(js), "a tap on the speed button cycles, saves and applies at once");
  for (const k of ["prev", "pause", "skip", "speed", "fit", "follow", "stop"]) assert.ok(js.includes(`data-p="${k}"`), `a ${k} control`);
  assert.ok(/data-p="follow"[^>]*hidden/.test(js) && js.includes("fo.hidden = ph.follow !== false"), "Follow shows only once the viewer has moved the camera");
  assert.ok(js.includes("A().prev()") && js.includes("A().fit()") && js.includes("A().follow(true)"), "wired to the renderer API");
  const css = M.BATTLE_CSS, play = css.slice(css.indexOf(".b-play{"), css.indexOf(".b-chip i{"));
  assert.ok(/\.b-play button\{[^}]*min-height:44px;min-width:44px/.test(play), "44 px tap targets"); assert.ok(/\.b-play \.b-pb\{display:flex;flex-wrap:wrap/.test(play), "one bar that wraps rather than overflows a narrow phone");
  const mq = css.slice(css.indexOf("@media (max-width:600px)"));
  assert.ok(/html\.w-replay \.b-chip\{display:none\}/.test(css) && !/w-replay \.b-chip/.test(mq), "during a replay the status chip is gone at every width, not only on a phone (the bar says the same, and the chip sat on the Labels chip)");
  assert.ok(!/—/.test(js + css), "no em dashes");
});

test("11-13 pure city: the replay (and the demo) sets html.w-replay while it plays and clears it on End or when it finishes; it never writes the viewer's Labels or Friendships choice", async () => {
  const js = M.BATTLE_CLIENT_JS, play = js.slice(js.indexOf("function play(mode)"), js.indexOf("function mine()")), stop = js.slice(js.indexOf("function stopPlay()"), js.indexOf("function play(mode)"));
  assert.ok(play.includes("classList.add('w-replay')") || play.includes('classList.add("w-replay")'), "play() sets the class the city renderer's PURE flag keys on");
  assert.ok(stop.includes("classList.remove('w-replay')") || stop.includes('classList.remove("w-replay")'), "stopPlay() clears it, so labels and rays come back");
  assert.ok(/if \(!p2 \|\| !p2\.replay\) \{\s*stopPlay\(\)/.test(play), "a replay that runs out ends through stopPlay too");
  assert.ok(!/caldera-world-labels|caldera-world-rays/.test(js), "the battle client never touches the saved toggles");
  // the world page the hub serves carries the renderer side (bundled from ../caldera)
  const cb = await build({ entryPoints: [new URL("../../../../caldera/packages/plugin/src/city.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
  const { CITY_JS, CITY_CSS } = await import("data:text/javascript;base64," + Buffer.from(cb.outputFiles[0].text).toString("base64"));
  assert.ok(CITY_JS.includes("function LBL(){return labels&&!PURE}") && CITY_JS.includes("contains('w-replay')") && CITY_CSS.includes("html.w-replay .c-live"), "the city renderer hides labels, rays and map text while html.w-replay is set");
});

test("11-15 replay wording: a shielded hit reads 'shield cut it to $X' (never 'shield held'), an open hit '-$X', a night from before 11-15 keeps 'shield held'", () => {
  const js = M.BATTLE_CLIENT_JS, grab = (name) => { const i = js.indexOf("function " + name + "("); assert.ok(i >= 0, name); let d = 0, j = js.indexOf("{", i); for (; j < js.length; j++) { if (js[j] === "{") d++; else if (js[j] === "}" && --d === 0) break; } return js.slice(i, j + 1); };
  const hitLine = new Function(grab("usd") + "\n" + grab("hitLine") + "\nreturn hitLine;")();
  assert.equal(hitLine({ d: "@jgeofil", sh: 0.99, usd: 27_014, to: 99.6, fire: false }), "@jgeofil: shield cut it to $27k, 100% standing");
  assert.equal(hitLine({ d: "@mike", sh: 0.56, usd: 488_659, to: 99.2, fire: true }), "@mike: shield cut it to $489k, on fire, 99% standing");
  assert.equal(hitLine({ d: "@orion", sh: 0, usd: 1_200_000, to: 87, fire: false }), "@orion -$1.2M, 87% standing");
  assert.equal(hitLine({ d: "raiders from the sea", sh: 0, usd: 4_000, to: 100 }), "The raiders -$4k, 100% standing");
  assert.equal(hitLine({ d: "@jgeofil", shield: true, pot: 2_667_675, usd: 0, to: 100 }), "@jgeofil: shield held, $2.7M stopped", "old nights read as they were");
  assert.ok(!/shield held/.test(hitLine({ d: "@a", sh: 0.99, usd: 304, to: 100 })));
  // the per-shot breakdown and the explainer say shields reduce damage, with the math
  for (const t of ["Without a shield", "% off: ", " held", "that got through", "A shield cuts a hit down. It never stops it", "damage = what the missile would do x (1 - shield)", "no strike comes to $0"]) assert.ok(js.includes(t), "copy: " + t);
  assert.ok(!js.includes("stops everything for your first 30 days"), "the old beginner-shield line is gone");
  assert.ok(/hb\.classList\.toggle\(["']sh["']/.test(js), "a shielded hit line is styled as a shield cut");
});
