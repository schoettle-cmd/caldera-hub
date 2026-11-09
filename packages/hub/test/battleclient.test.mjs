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
