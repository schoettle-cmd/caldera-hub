// The Battle view's replay controls (battleclient.ts): the speed the viewer picks is remembered per viewer in localStorage (and
// nothing breaks where storage is blocked), the bar is one compact row of 44 px targets, the page script parses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

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
  assert.ok(js.includes("speed = BSPD.load()"), "starts at the viewer's saved speed"); assert.ok(/api\(\)\.replay\(mode, \{ speed(: speed)?(, auto: !!auto)? \}\)/.test(js), "a replay starts at it");
  assert.ok(/speed = BSPD\.next\(speed\);\s*BSPD\.save\(speed\);\s*if \(A\(\) && A\(\)\.speed\) A\(\)\.speed\(speed\)/.test(js), "a tap on the speed button cycles, saves and applies at once");
  for (const k of ["prev", "pause", "skip", "speed", "fit", "follow", "stop"]) assert.ok(js.includes(`data-p="${k}"`), `a ${k} control`);
  assert.ok(/data-p="follow"[^>]*hidden/.test(js) && js.includes("fo.hidden = ph.follow !== false"), "Follow shows only once the viewer has moved the camera");
  assert.ok(js.includes("A().prev()") && js.includes("A().fit()") && js.includes("A().follow(true)"), "wired to the renderer API");
  const css = M.BATTLE_CSS, play = css.slice(css.indexOf(".b-play{"), css.indexOf(".b-chip i{"));
  assert.ok(/\.b-play \.b-pb button\{width:40px;height:40px\}/.test(css), "40 px tap targets on phones (Mike accepts density)"); assert.ok(/\.b-play \.b-pt\{flex:1 1 0;min-width:0/.test(play), "the text zone shrinks, the controls never leave the bar");
  const mq = css.slice(css.indexOf("@media (max-width:600px){.b-chip"));
  assert.ok(/html\.w-replay \.b-chip\{display:none\}/.test(css) && !/w-replay \.b-chip/.test(mq), "during a replay the status chip is gone at every width, not only on a phone (the bar says the same, and the chip sat on the Labels chip)");
  assert.ok(!/—/.test(js + css), "no em dashes");
});

test("11-13 pure city: the replay (and the demo) sets html.w-replay while it plays and clears it on End or when it finishes; it never writes the viewer's Labels or Friendships choice", async () => {
  const js = M.BATTLE_CLIENT_JS, play = js.slice(js.indexOf("function play(mode, auto)"), js.indexOf("function mine()")), stop = js.slice(js.indexOf("function stopPlay()"), js.indexOf("function play(mode, auto)"));
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

test("11-18 Armory panel: countdown format, Buy label states, CSS present, page script parses", () => {
  const src = M.battleClient.toString(), grab = name => { const i = src.indexOf("function " + name + "("); assert.ok(i > 0, name); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && !--d) break; } return src.slice(i, j + 1); };
  const mk = new Function("me", "cart", "armBusy", ["armSpan", "armCost", "armTotal", "armBuyLabel"].map(grab).join("\n") + ";return {armSpan:armSpan,armBuyLabel:armBuyLabel}");
  const me = { armory: { balance: 30, cap: 20, kinds: [{ k: "sparkler", cost: 5 }, { k: "inferno", cost: 25 }, { k: "nova", cost: 50 }] } };
  const f = (cart, busy = false) => mk(me, cart, busy);
  assert.equal(f([]).armSpan(5 * 3600_000 + 40 * 60_000), "5h 40m"); assert.equal(f([]).armSpan(42 * 60_000), "42m"); assert.equal(f([]).armSpan(30_000), "under 1m");
  assert.deepEqual(f([]).armBuyLabel(), ["Pick a bomb", false], "PAGE.md 5a: nothing picked");
  assert.deepEqual(f([{ k: "sparkler", word: "HI" }, { k: "sparkler", word: "" }]).armBuyLabel(), ["Add a word to bomb 2", false]);
  assert.deepEqual(f([{ k: "nova", word: "GG" }]).armBuyLabel(), ["Need 20 more credits", false]);
  assert.deepEqual(f([{ k: "sparkler", word: "HI" }]).armBuyLabel(), ["Buy 1 bomb for 5 credits", true]);
  assert.deepEqual(f([{ k: "sparkler", word: "HI" }, { k: "inferno", word: "SHIPIT" }]).armBuyLabel(), ["Buy 2 bombs for 30 credits", true]);
  assert.deepEqual(f([{ k: "sparkler", word: "HI" }], true).armBuyLabel(), ["Buying...", false]);
  for (const c of [".b-arm{", ".b-bc{", ".b-ar{", ".b-arm-buy{", ".b-flag{", ".b-flagq{"]) assert.ok(M.BATTLE_CSS.includes(c), c);
  assert.doesNotThrow(() => new Function(M.BATTLE_CLIENT_JS));
});

// ---------------------------------------------------------------- 11-20 the deck under the map (map-audit PAGE.md 5, Mike "yes do all")
const norm = (t) => String(t).replace(/\\'/g, "'").replace(/"/g, "'");   // esbuild rewrites quotes; compare quote-blind
const SRC = M.battleClient.toString();
const grabFn = (name, SRC = M.battleClient.toString()) => { const i = SRC.indexOf("function " + name + "("); assert.ok(i > 0, name); let d = 0, j = SRC.indexOf("{", i); for (; j < SRC.length; j++) { if (SRC[j] === "{") d++; else if (SRC[j] === "}" && !--d) break; } return SRC.slice(i, j + 1); };
const RULES = { weapons: [{ k: "shell", size: "S" }, { k: "rocket", size: "M" }, { k: "tactical", size: "L" }, { k: "cruise", size: "XL" }], dome: 0.99 };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

test("deck markup: Tonight card (#armory) and Last night card in one grid, then one tab panel with #shots #season #arsenals kept", () => {
  const m = M.battleMarkup();
  assert.ok(m.includes('id="b-bar"') && m.includes('class="b-deck"') && m.includes('class="b-grid"'), "the deck replaces the bar, same id for the switcher");
  assert.ok(/<section class="b-card b-tn" id="armory" data-b="me"/.test(m), "the Tonight card keeps #armory links working");
  assert.ok(m.includes('data-b="last"'), "the Last night card");
  assert.ok(m.includes('role="tablist"') && (m.match(/role="tab"/g) || []).length === 3 && (m.match(/role="tabpanel"/g) || []).length === 3);
  for (const id of ["shots", "season", "arsenals"]) assert.ok(m.includes(`role="tabpanel" id="${id}"`), "tab panel #" + id);
  assert.ok(/data-tab="shots" aria-controls="shots" aria-selected="true"/.test(m), "Shot by shot is open by default");
  for (const t of ["Shot by shot", "Shots", "Season ranking", "Season", "Arming today", "Arming"]) assert.ok(m.includes(">" + t + "<"), "tab label " + t);
  assert.ok(!/b-stats|data-b="next"|data-bl=|<details/.test(m), "no stats line, no pills, no details lists in the deck");
});

test("deck CSS: L 1fr | 420, M (Duo) 1fr | 272 and dense, S one column; cards, tiles and tabs per the spec", () => {
  const css = M.BATTLE_CSS;
  assert.ok(css.includes(".b-grid{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:var(--gap);align-items:start}"));
  const mM = css.slice(css.indexOf("@media (min-width:700px) and (max-width:899px){")), mS = css.slice(css.indexOf("@media (max-width:699px){"));
  assert.ok(mM.includes(".b-grid{grid-template-columns:minmax(0,1fr) 272px}") && mM.includes(".b-tiles{grid-template-columns:repeat(4,minmax(0,1fr))"), "M: 272 px Last night column, four tiles in a row");
  assert.ok(mS.includes(".b-grid{grid-template-columns:minmax(0,1fr)}") && mS.includes(".b-ch1 .b-cred{display:none}") && mS.includes(".b-arm-buy{width:100%}"), "S: one column, no credits chip in the head, full-width Buy");
  assert.ok(css.includes(".b-card{background:#14171E;border:1px solid var(--rule);border-radius:14px;padding:16px") && css.includes(".b-tn{border-color:rgba(139,108,246,.38)}"));
  assert.ok(/\.b-big\{font:700 34px\/1 var\(--disp\)/.test(css) && /\.b-tile b\{display:block;font:700 26px/.test(css) && /\.b-nums b\{display:block;font:700 30px/.test(css));
  assert.ok(css.includes(".b-tabrow button[aria-selected=\"true\"]{color:var(--ink);border-bottom-color:var(--cy)}"));
  assert.ok(css.includes(".b-pop.sheet{position:fixed;left:0;right:0;bottom:0"), "popovers are bottom sheets on phones");
  assert.ok(/prefers-reduced-motion:no-preference\)\{\.b-pop\{animation/.test(css), "popovers slide only without reduced motion");
  assert.ok(!/\.b-recap|\.b-bar\{|\.b-stats|\.b-ars\{/.test(css), "the old bar, stats line, arsenal cards and morning card are gone");
});

test("deck words: none of the retired words in what people read; the morning overlay and its key are gone", () => {
  const js = M.BATTLE_CLIENT_JS, nj = norm(js);
  for (const w of [/salvo/i, /Guidance/, /\bGPS\b/, /Inertial/, /Munitions/i, /per head/, /resolves/, /'x' \+ a\./, /Arsenals building/, /Season leaderboard/, /What your city did last night/, /Demo replay<\/button>/, /How damage works<\/button>/])
    assert.ok(!w.test(js + M.battleMarkup()), "retired: " + w);
  assert.ok(!js.includes("caldera.world.recap") && !js.includes("function recap("), "the morning card and its key are deleted");
  for (const t of ["Battle starts in ", "Your bombs lock then. Your city fires by itself.", "Last hour. Your bombs lock at ", "Bombs are locked. The replay is ready in the morning.", "The Armory opens again after the battle.", "No custom bombs tonight.",
    "Your city is out of the battles", "No shots in or out. Rejoin and it fights by itself each night.", "Rejoin the battles", "Put your city in the fight. Your GitHub becomes a city, and today\\'s code becomes missiles. Damage shows only on this map.", "Add your city",
    "Your firepower", "from today\\'s code", "to spend on missiles", "blocked from each hit", "beginner shield, first 30 days", "auto, a fair rival", "Choose a target", "Aim up to ", "Aim a missile", "No rivals in reach yet. Your missiles find a fair match by themselves.",
    "Add a bomb with your word on it. Everyone sees the word in the replay.", "+ Add", "Your word", "Random rival", "Show my name.", "Up to ", " bombs a night. Credits have no cash value.", "Loaded for tonight", "Battle settings", "Battle report email", "Beginner shield", "Leave the battles", "Your city rebuilds at once. You can rejoin at any time.",
    "No battle last night", "No city had missiles. Watch a demo to see how a battle looks.", "Watch a demo battle", "cities fought", "Your city", "Hits on you", "Your shield blocked", "You hit", "Rebuilt so far", "Reward", "Copy link", "Copied", "Show all ", "Cranes rebuild until <b>12:00</b>", "<b>Battle running</b>", "missile", " loaded", "Starts in <b>"])
    assert.ok(nj.includes(norm(t)), "copy: " + t);
  assert.ok(/try \{\s*var tv = localStorage\.getItem\(TKEY\)/.test(nj) && /if \(save\)\s*try \{\s*localStorage\.setItem\(TKEY, k\)/.test(nj) && nj.includes("'caldera.world.tab'"), "the tab choice is saved per viewer, inside try/catch");
  for (const l of ["damage", "attacks", "shields"]) assert.ok(nj.includes(`data-bl='${l}'`), "the Layers popover keeps the " + l + " toggle");
  assert.ok(nj.includes("data-bl='replay'") && nj.includes("data-bdemo"), "Replay and Watch a demo battle stay wired to the replay");
});

test("Tonight tiles: Aim words from the miss multiplier, the work line, the Missiles line with sizes or the unlock hint", () => {
  const f = new Function("rules", [grabFn("aimOf"), grabFn("aimLine"), grabFn("workLine"), "var SZN = { S: 'small', M: 'medium', L: 'large', XL: 'extra large' };", grabFn("missLine")].join("\n") + ";return {aimOf:aimOf,aimLine:aimLine,workLine:workLine,missLine:missLine}")(() => RULES);
  assert.deepEqual([1, 1.2, 0.99, 0.75, 0.74, 0.5, 0.49, 0.25, null].map(f.aimOf), ["Standard", "Standard", "Steady", "Steady", "Sharp", "Sharp", "Pinpoint", "Pinpoint", "Standard"]);
  assert.equal(f.aimLine(0.5), "50% fewer misses"); assert.equal(f.aimLine(1), "normal misses"); assert.equal(f.aimLine(0.25), "75% fewer misses");
  assert.equal(f.workLine({ shots: 4, c: 88, rel: 1, streak: 1.27, ai: 1 }), "88 commits, 1 release, +27% streak bonus");
  assert.equal(f.workLine({ shots: 2, c: 1, pr: 3, ci: 1, ai: 1.6, streak: 1 }), "1 commit, 3 pull requests, green CI, +60% AI bonus");
  assert.equal(f.workLine({ shots: 0, c: 0 }), "Push code today to load missiles."); assert.equal(f.workLine(null), "Push code today to load missiles.");
  assert.equal(f.missLine({ tech: 3, n: { cruise: 2, rocket: 2, shell: 0 } }), "2 extra large, 2 medium", "biggest first, zero counts left out");
  assert.equal(f.missLine({ tech: 1, why: { rel: 0 }, n: { rocket: 1 } }), "Ship a release for the next size");
  assert.equal(f.missLine({ tech: 2, why: { rel: 1, ci: 0 } }), "A green CI run today unlocks the next size");
  assert.equal(f.missLine({ tech: 2, why: { rel: 1, ci: 1 } }), "A taller building unlocks the next size");
});

test("Tonight head and order line: the one clock in the title, cyan in the last hour; Balance / Order ... left / ... short", () => {
  const f = new Function("lockAt", "esc", [grabFn("armClock"), grabFn("armSpan"), grabFn("clockTitle"), grabFn("openSub"), "function hhmm(t){return 'x'}"].join("\n") + ";return {clockTitle:clockTitle,openSub:openSub}")(() => Date.UTC(2026, 10, 21, 10), esc);
  assert.equal(f.clockTitle(12 * 3600_000 + 36 * 60_000), 'Battle starts in <b data-arm="clock" role="timer" aria-live="off">12h 36m</b>');
  assert.match(f.clockTitle(42 * 60_000), /class="last">42m<\/b>$/, "under an hour: the time turns cyan");
  assert.equal(f.clockTitle(0), "Battle running"); assert.equal(f.clockTitle(-5), "Battle running");
  assert.equal(f.openSub(5 * 3600_000), "Your bombs lock then. Your city fires by itself."); assert.match(f.openSub(30 * 60_000), /^Last hour\. Your bombs lock at .+\.$/);
  const mk = (cart, bal) => new Function("me", "cart", [grabFn("armCost"), grabFn("armTotal"), grabFn("armSum")].join("\n") + ";return armSum()")({ armory: { balance: bal, kinds: [{ k: "sparkler", cost: 5 }, { k: "thunderbolt", cost: 12 }, { k: "nova", cost: 50 }] } }, cart);
  assert.equal(mk([], 315), "Balance <b>315</b>");
  assert.equal(mk([{ k: "sparkler" }, { k: "thunderbolt" }], 315), "Order <b>17</b> credits · <b>298</b> left");
  assert.equal(mk([{ k: "nova" }, { k: "nova" }], 88), 'Order <b>100</b> credits · <b class="neg">12</b> short');
});

test("Last night: Your city rows from me.last (reusing the morning card's facts), a row with nothing to say is left out", () => {
  const yc = (me) => new Function("me", "esc", "usd", "BNAME", "who", grabFn("yourCity") + ";return yourCity()")(me, esc, (n) => "$" + (n / 1e6).toFixed(1) + "M", { sparkler: "Sparkler" }, (h) => esc(h));
  const full = yc({ war: 1, last: { raids: [{ from: "@a", landed: 1 }, { from: "@b", landed: 1 }], takenUsd: 1.9e6, heldUsd: 4.4e6, bombs: [{ k: "sparkler", word: "HELLO", from: "@meldav" }], fired: 3, landed: 2, on: ["@bartlett-labs"], dealtUsd: 12.9e6, mine: { n: 2, hit: 1 }, mvp: { repo: "app", bricks: 4 }, taken: 0.3, rebuilt: 74, reward: 10 } });
  for (const t of ['<dt>Hits on you</dt><dd><span class="gd">2</span> · $1.9M damage</dd>', '<dt>Your shield blocked</dt><dd><span class="cy">$4.4M</span></dd>', "<dt>Custom bombs on you</dt><dd>1: Sparkler &quot;HELLO&quot; from @meldav</dd>",
    '<dt>You hit</dt><dd>@bartlett-labs · <span class="gd">$12.9M</span></dd>', "<dt>Your bombs</dt><dd>2 flew, 1 hit</dd>", "<dt>Top builder</dt><dd>app, 4 bricks</dd>", '<dt>Rebuilt so far</dt><dd><span class="gr">74%</span></dd>', "<dt>Reward</dt><dd>+10 credits</dd>"])
    assert.ok(full.includes(t), t);
  assert.ok(full.startsWith('<h3 class="b-ych"><i aria-hidden="true"></i>Your city</h3>'));
  const quiet = yc({ war: 1, last: { raids: [], fired: 0, landed: 0, taken: 0, reward: 0 } });
  assert.ok(quiet.includes("<dt>Hits on you</dt><dd>none</dd>") && quiet.includes("<dt>You hit</dt><dd>You had no missiles</dd>"));
  for (const t of ["Your shield blocked", "Custom bombs", "Your bombs", "Top builder", "Rebuilt so far", "Reward"]) assert.ok(!quiet.includes(t), "left out: " + t);
  assert.ok(yc({ war: 1, last: { raids: [{ from: "@a", landed: 0 }], fired: 2, landed: 0 } }).includes("none: your shield blocked them</dd><dt>You hit</dt><dd>No hits: shields blocked them"));
  assert.equal(yc(null), "", "signed out: numbers only"); assert.equal(yc({ war: 0, last: {} }), "", "out of the battles: numbers only");
});

test("popovers and tabs: one at a time, Esc and a tap outside close, focus returns; arrow keys move between tabs; #reports opens Battle settings", () => {
  const js = readFileSync(new URL("../src/battleclient.ts", import.meta.url), "utf8");   // the source: esbuild splits lines
  assert.ok(/popEl\.setAttribute\('role', 'dialog'\); popEl\.setAttribute\('aria-labelledby', 'b-pop-t'\)/.test(js), "a labelled dialog");
  assert.ok(/e\.key === 'Escape' && popEl\) \{ e\.preventDefault\(\); popClose\(true\)/.test(js) && js.includes("addEventListener('pointerdown'"), "Esc (focus back) and a tap outside close it");
  assert.ok(js.includes("var sheet = window.innerWidth < 700; popEl.classList.toggle('sheet', sheet)"), "a bottom sheet under 700 px");
  assert.ok(/e\.key === 'ArrowRight' \? \(i \+ 1\) % 3 : e\.key === 'ArrowLeft'/.test(js) && js.includes("e.key === 'Home'"), "arrow keys, Home and End in the tab row");
  assert.ok(js.includes("location.hash === '#reports'") && js.includes("popOpen('set'"), "the report email's #reports link opens Battle settings");
  assert.ok(js.includes("window.CALDERA_BATTLE_HOW = function () { openHow(null); return true; };"), "the header link's hook opens the How sheet");
  assert.ok(/data-bhow aria-haspopup="dialog"/.test(M.battleMarkup()), "a [data-bhow] opener stays in the deck");
  // the gear holds the report email, the beginner shield and Leave; the target button holds the aim list (the old b-fire)
  const setH = grabFn("setHtml", js), aimH = grabFn("aimHtml", js), pw = grabFn("popWire", js);
  assert.ok(setH.includes("reportHtml()") && setH.includes("b-waive") && setH.includes("b-leave"));
  assert.ok(aimH.includes("b-doaim") && aimH.includes("b-unaim") && aimH.includes("cap + ' of ' + cap + ' aimed'"));
  assert.ok(pw.includes("act('/v1/world/battle/aim', { target: s.value })") && pw.includes("act('/v1/world/battle/opt', { war: false })") && pw.includes("act('/v1/world/battle/report'"), "same endpoints as before");
});

// ---------------------------------------------------------------- 11-20 people in the deck: avatar + name link to the Caldera profile (Mike)
test("people in the deck: members get an avatar and a /@handle/ link; raiders and unclaimed lands stay plain; rows keep their own button", () => {
  const people = { "@ana": "/@ana/avatar.png", "@bo": "" };
  const lib = new Function("data", "esc", "document", [grabFn("pOf"), grabFn("avHtml"), grabFn("who"), "var openShot = -1, more = {};", grabFn("wOf"), grabFn("rules"), grabFn("nameOf"), grabFn("shotUsd"),
    "function hhmm(){return '20:00'} function usd(n){return '$'+n} function shotHtml(){return ''}", grabFn("shotRow")].join("\n") + ";return {who:who,avHtml:avHtml,shotRow:shotRow}")({ people, rules: RULES }, esc, {});
  const a = lib.who("@ana", "a");
  assert.equal(a, '<a class="b-who" href="/@ana/"><img class="b-av" src="/@ana/avatar.png" width="20" height="20" loading="lazy" decoding="async" alt="" data-i="A"><span class="a">@ana</span></a>', "avatar + name in one link to the profile");
  assert.equal(lib.who("@bo"), '<a class="b-who" href="/@bo/"><i class="b-av b-avi" aria-hidden="true">B</i><span>@bo</span></a>', "no photo: an initial circle");
  assert.equal(lib.who("@torvalds"), "@torvalds", "an unclaimed land (not a member): no link, no avatar");
  assert.equal(lib.who("raiders", "a", "Raiders"), '<span class="a">Raiders</span>', "sea raiders: plain, keeps the attacker underline class");
  assert.equal(lib.avHtml("@torvalds"), "");
  assert.ok(!lib.who("@a\"><x", "a").includes("<x"), "escaped");
  const row = lib.shotRow(["@ana", "@bo", "rocket", 0.1, Date.now(), 0, 0, 0, null], 3);
  assert.ok(row.includes('<button type="button" class="b-hit0" data-shot="3" aria-expanded="false" aria-label="@ana fired at @bo: how the damage was worked out"></button>'), "the row's own button opens the worked example");
  assert.ok(row.includes('<a class="b-who" href="/@ana/">') && row.includes('<span class="a">@ana</span></a> → <a class="b-who" href="/@bo/">') && row.includes('<span class="d">@bo</span>'), "attacker and defender link, underline classes kept");
  assert.ok(!/<button[^>]*>[^]*<a /.test(row.replace(/<\/button>[^]*$/, "")), "no link inside a button");
  const raid = lib.shotRow(["raiders", "@ana", "shell", 0.1, 0, 0, 0, 0, null], 0);
  assert.ok(raid.includes('<span class="a">Raiders</span> → <a class="b-who" href="/@ana/">'));
});

test("people in the deck: every list uses who() or an avatar; links sit outside the row buttons; CSS sizes and fallback", () => {
  const js = readFileSync(new URL("../src/battleclient.ts", import.meta.url), "utf8");
  for (const f of ["lists", "yourCity", "armBody", "aimHtml", "fireHtml"]) assert.ok(/who\(/.test(grabFn(f, js)), f + " links people");
  assert.ok(/avHtml\(x\.h\)/.test(grabFn("pList", js)) && /avHtml\(r\.target\)/.test(grabFn("armBody", js)), "picker options and the target button show the avatar (they pick, so no link)");
  const L = grabFn("lists", js);
  assert.ok(L.includes(`class="b-hit0" data-fly="' + esc(r[0])`) && L.includes(`class="b-hit0" data-fly="' + esc(k)`), "Season and Arming rows keep the fly-to button");
  assert.ok(js.includes("document.addEventListener('error'") && js.includes("'b-av b-avi'"), "a broken avatar turns into the initial");
  const css = M.BATTLE_CSS;
  assert.ok(css.includes(".b-av{flex:none;width:20px;height:20px;border-radius:50%"), "20 px round avatars");
  const mM = css.slice(css.indexOf("@media (min-width:700px) and (max-width:899px){")), mS = css.slice(css.indexOf("@media (max-width:699px){"));
  assert.ok(mM.includes(".b-av{width:16px;height:16px"), "16 px on Duo");
  assert.ok(mS.includes(".b-rk li,.b-al li{min-height:44px}"), "44 px rows on phones");
  assert.ok(css.includes(".b-hit0{position:absolute;inset:0") && css.includes(".b-who{pointer-events:auto"), "the row button covers the row, the link sits on top");
  assert.ok(!/\.b-sl button/.test(css), "the shot row is no longer one big button");
});

// ---------------------------------------------------------------- 11-21 the Armory yard on the map (plugin cityarmory.ts)
test("armory yard: a tap on your own yard opens the Armory panel in the Battle view; anyone else's falls back to the card", () => {
  const js = readFileSync(new URL("../src/battleclient.ts", import.meta.url), "utf8"), fn = js.slice(js.indexOf("window.CALDERA_ARMORY_OPEN = function"), js.indexOf("window.CALDERA_BATTLE_UI ="));
  assert.ok(fn.includes("if (!armOwner || armOwner !== h) { if (fallback) fallback(); return; }"), "not yours (or signed out): the card");
  assert.ok(fn.includes("u.hash = 'armory'") && fn.includes("render.did = 0") && fn.includes("document.querySelector('[data-gmode=\"battle\"]')"), "yours: the Battle view with #armory scrolled into view");
  assert.ok(fn.includes("fetch('/v1/world/battle/me'") && fn.includes("m.war ? m.h : ''"), "asks who you are once");
});

// ---- viewer power-ups v1 (map-audit DESIGN.md item 10, mockup 05; Mike D1 11-20: cosmetic, free, local to the viewer)
test("power-ups: 3 slots (repair crate 1, fireworks 2, cheer 3), 3 charges each, 1 back every 8 s; 1 drop per 1.5 s, 20 per replay", () => {
  const P = M.powerupLib(); assert.deepEqual(P.KINDS.map((k) => [k.k, k.key, k.name, k.col]), [["heal", "1", "Repair crate", "#4BE38A"], ["fw", "2", "Fireworks", "#FFC83D"], ["cheer", "3", "Cheer", "#FF7BD0"]]);
  assert.equal(P.kind("2").k, "fw"); assert.equal(P.kind("cheer").key, "3"); assert.equal(P.kind("9"), null);
  const s = P.fresh(); assert.deepEqual(P.KINDS.map((k) => P.view(s, k.k, 0, null).state), ["ready", "ready", "ready"]);
  assert.equal(P.view(s, "heal", 0, "heal").state, "armed");
  assert.equal(P.use(s, "heal", 1000), true); assert.equal(P.left(s, "heal", 1000), 2);
  assert.equal(P.why(s, "heal", 2000), "wait", "under 1.5 s since the last drop"); assert.equal(P.use(s, "fw", 2400), false, "the gap is for every slot");
  assert.equal(P.canArm(s, "heal", 2000), true, "a slot can still be armed while waiting");
  let v = P.view(s, "heal", 5000, null); assert.equal(v.state, "cool"); assert.equal(v.sec, 4); assert.ok(Math.abs(v.p - .5) < 1e-9, "half the sweep done");
  assert.equal(P.use(s, "heal", 2500), true); assert.equal(P.use(s, "heal", 4000), true); assert.equal(P.left(s, "heal", 4000), 0);
  assert.equal(P.why(s, "heal", 6000), "empty"); assert.equal(P.view(s, "heal", 6000, "heal").state, "empty", "no charge: never armed"); assert.equal(P.canArm(s, "heal", 6000), false);
  assert.equal(P.left(s, "heal", 9000), 1, "8 s after the first use: one back"); assert.equal(P.left(s, "heal", 17000), 2); assert.equal(P.left(s, "heal", 25000), 3); assert.equal(P.left(s, "heal", 99000), 3, "never more than 3");
  assert.equal(P.view(s, "heal", 99000, null).state, "ready");
  const c = P.fresh(); let t = 0, n = 0; while (n < 40 && t < 1e6) { const k = P.KINDS[n % 3].k; if (P.use(c, k, t)) n++; t += 1500; if (P.why(c, k, t) === "cap") break; }
  assert.equal(c.used, 20, "20 drops per replay"); assert.equal(P.why(c, "fw", t + 1e5), "cap"); assert.equal(P.hint(c, "fw", t), "More next replay");
  assert.ok(P.KINDS.every((k) => P.view(c, k.k, t + 1e5, null).state === "empty"), "after 20 every slot reads Empty");
  assert.equal(P.fresh().used, 0, "a new replay starts fresh");
  assert.equal(P.hint(P.fresh(), "heal", 0), "Tap the map to drop a repair crate · 3 left");
  assert.equal(P.toast("heal", "@bartlett-labs"), "You sent a repair crate to @bartlett-labs"); assert.equal(P.toast("fw", "ana"), "You sent fireworks to @ana"); assert.equal(P.toast("cheer", null), "You sent a cheer");
});

test("power-ups: the tray only in a replay, keys 1 2 3 and Esc in the replay key handler (never inside the menu or an input), the tap from city.ts, no network or storage", () => {
  const js = M.BATTLE_CLIENT_JS; new Function(js);
  const N = (x) => String(x).replace(/\s+/g, "").replace(/"/g, "'"), J = N(js), has = (frag) => J.includes(N(frag));
  const a = J.indexOf("varpuEl=null"), b = J.indexOf("functionhudOff()"); assert.ok(a > 0 && b > a, "the tray block");
  const tray = J.slice(a, b), lib = N(M.powerupLib.toString());
  for (const bad of ["fetch(", "post(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "WebSocket"]) { assert.ok(!tray.includes(bad), `no ${bad} in the tray`); assert.ok(!lib.includes(bad), `no ${bad} in the lib`); }
  assert.ok(has("(function(BSPD,BPU){") && has("function powerupLib()"), "the lib ships ahead of the client as BPU");
  assert.ok(has("stage.appendChild(hudEl); fsSync(); puOn(); }"), "the tray is made with the replay bar"); assert.ok(has("function hudOff() { puOff();"), "and goes with it");
  assert.ok(tray.includes("api().drop") && tray.includes("window.CALDERA_BATTLE_TAP=puTap"), "drops through the plugin API from the map tap");
  const k0 = J.indexOf("/^[123]$/.test(e.key)"), kd = J.slice(J.lastIndexOf("addEventListener('keydown'", k0), k0 + 300);
  assert.ok(k0 > 0 && kd.includes("closest('.b-menu')") && kd.includes("INPUT|TEXTAREA|SELECT"), "keys are ignored in the menu and inputs");
  assert.ok(kd.includes("puToggle(BPU.kind(e.key).k)") && kd.includes("e.key==='Escape'&&puDisarm()"), "1 2 3 arm, Esc disarms");
  assert.ok(tray.includes("puEl.classList.toggle('mhide',!!(m&&!m.hidden))"), "hidden while the bar's menu is open"); assert.ok(has("mb.setAttribute('aria-expanded', String(!!open)); puPlace();"), "at once when it opens");
  assert.ok(tray.includes("s.bottom-b.top+8"), "lifted above the replay bar when they meet");
  for (const k of ["data-pu=", "class='b-pukey'", "class='b-pucd'", "class='b-pupips'", "aria-pressed", "b-puhint", "b-putoast", "b-puret"]) assert.ok(tray.includes(N(k)), `markup ${k}`);
  const css = M.BATTLE_CSS;
  assert.ok(/\.b-puslot\{[^}]*width:56px;height:56px[^}]*border-radius:14px/.test(css), "56 px slots, radius 14"); assert.ok(/max-width:899px\)\{\.b-puslot\{width:48px;height:48px\}/.test(css), "48 px on Duo and phone");
  assert.ok(/\.b-putray\{display:flex;gap:8px/.test(css)); assert.ok(css.includes(".b-puslot.armed{") && css.includes("translateY(-4px)") && css.includes(".b-puslot.cool::after") && css.includes("conic-gradient") && /\.b-puslot\.empty\{border-style:dashed/.test(css), "Ready, Armed, Recharging, Empty");
  assert.ok(/max-width:600px\)\{\.b-pu\{right:10px;bottom:68px\}/.test(css), "phone: right aligned above the one-row bar (BATTLE.md U3)"); assert.ok(/@media \(max-width:1009px\)\{\.b-pu\{bottom:68px\}\}/.test(css), "601 to 1009 px: above the bar, never on it"); assert.ok(css.includes(".b-pu.mhide{visibility:hidden}"));
  assert.ok(/\.b-puret\{[^}]*width:64px;height:32px[^}]*dashed/.test(css), "the 64 x 32 dashed reticle"); assert.ok(/prefers-reduced-motion:reduce\)\{\.b-puslot\{transition:none\}/.test(css));
});

// ---- the leaderboard at the end of the replay (LEADERBOARD.md, Fable design 11-21; Mike 11-21; plugin citycard.ts bLb*)
test("leaderboard: while the results board shows (html.w-board) the replay bar and the power-up tray hide, no replay key acts behind it, and its buttons reuse play() and stopPlay()", () => {
  const js = M.BATTLE_CLIENT_JS; new Function(js);
  const N = (x) => String(x).replace(/\s+/g, "").replace(/"/g, "'"), J = N(js), css = M.BATTLE_CSS;
  const hide = css.slice(css.indexOf("html.w-board .b-play"), css.indexOf("}", css.indexOf("html.w-board .b-play")) + 1);
  for (const k of [".b-play", ".b-pu", ".b-puret", ".b-putoast"]) assert.ok(hide.includes("html.w-board " + k + ",") || hide.includes("html.w-board " + k + "{"), `hides ${k}`);
  assert.ok(hide.includes("opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s"), "a 150 ms fade, then gone and not clickable");
  const k0 = J.indexOf("/^[123]$/.test(e.key)"), kd = J.slice(J.lastIndexOf("addEventListener('keydown'", k0), k0 + 400);
  assert.ok(kd.indexOf("contains('w-board')") > 0 && kd.indexOf("contains('w-board')") < kd.indexOf("/^[123]$/"), "F, M, 1 2 3, arrows and Space do nothing behind the board (the plugin's board handles Esc, R and S)");
  const play = J.slice(J.indexOf("functionplay(mode,auto){"), J.indexOf("functionmine()"));
  assert.ok(play.includes(N("api().boardHooks({ again: function (demo) { play(demo ? 'demo' : void 0); }, exit: function () { stopPlay(); }, add: '/#start', signedIn: function () { return !!me; } })")), "Watch again = play() in the same mode, Exit = stopPlay(), Add your city = the /world action");
  assert.ok(play.indexOf("boardHooks") < play.indexOf("api().replay(mode"), "the hooks are in place before the replay starts");
  const hud = J.slice(J.indexOf("functionhud(ph){"), J.indexOf("varpuEl=null"));
  assert.ok(hud.includes(N("if (ph.board) { menuSet(false); puDisarm(); if (playing) { clearTimeout(playing); playing = null; } }")), "the menu closes, an armed power-up disarms, and no safety-net timer takes the board away");
  assert.ok(/if \(!p2 \|\| !p2\.replay\) \{\s*stopPlay\(\)/.test(js) || J.includes("if(!p2||!p2.replay){stopPlay()"), "the poll still ends a replay that ended (Exit) through stopPlay");
});

test("Leaderboard: the map tool buttons hide while the board shows (they covered its top on phones)", () => {
  assert.match(M.BATTLE_CSS, /html\.w-board \.c-tools\{display:none!important\}/);
});

test("armWho stays a function: no var of the same name overwrites it (armory panel threw 'armWho is not a function', 11-22)", () => {
  const src = readFileSync(new URL("../src/battleclient.ts", import.meta.url), "utf8");
  assert.ok(/\bfunction armWho\(/.test(src));
  assert.ok(!/\b(var|let|const) armWho\b|\barmWho\s*=[^=]/.test(src), "armWho is never assigned");
});

// ---- the battle screen (BATTLE.md, Fable design 11-24): the Replay button on the map, the one-row bar, the progress line, Save in the menu
test("BATTLE.md U2: mapReplay() show rule: only in the idle Battle view; not in World view, a replay, on the board or while the battle runs; the demo when no battle last night", () => {
  const R = L.mapRp, base = { on: true, replay: false, board: false, running: false, shots: 12 };
  assert.deepEqual(R(base), { demo: false, label: "Replay last night", aria: "Replay last night’s battle", title: "Replay last night (R)" });
  assert.deepEqual(R({ ...base, shots: 0 }), { demo: true, label: "Watch a demo battle", aria: "Watch a demo battle", title: "Watch a demo battle (R)" }, "no battle last night: today's demo words");
  for (const k of ["replay", "board", "running"]) assert.equal(R({ ...base, [k]: true }), null, `not ${k}`);
  assert.equal(R({ ...base, on: false }), null, "not in World view"); assert.equal(R(null), null);
  const js = M.BATTLE_CLIENT_JS, N = (x) => String(x).replace(/\s+/g, "").replace(/"/g, "'"), J = N(js);
  assert.ok(J.includes(N("function chipTick() {\n    mapReplay();")), "called from chipTick (also in World view, to hide it)");
  assert.ok(J.includes(N("rpEl.className = 'b-rp b-rp-map'")) && J.includes(N("rpEl.setAttribute('data-bl', 'replay')")) && J.includes(N("rpEl.setAttribute('data-bdemo', '')")), "one white pill, data-bl=replay or data-bdemo");
  assert.ok(J.includes(N("if (rpEl.hasAttribute('data-bdemo')) play('demo'); else setLayer('replay', true);")), "the click does what the card's button does");
  assert.ok(J.includes(N("running: !!lockAt() && left <= 0 && !reb")), "'Battle running' as the chip says it");
  const stop = J.slice(J.indexOf("functionstopPlay(){"), J.indexOf("functionplay(mode,auto){"));
  assert.ok(stop.startsWith(N("function stopPlay() { var had = !!hudEl;")) && stop.includes(N("if (had) { var rb = mapReplay(); if (rb) try { rb.focus({ preventScroll: true }); }")), "after End or Exit the button gets the focus");
  const css = M.BATTLE_CSS;
  assert.ok(/\.b-rp-map\{position:absolute;left:50%;bottom:14px;transform:translateX\(-50%\);z-index:7;height:44px/.test(css), "bottom centre, 44 px");
  assert.ok(css.includes("html.w-replay .b-rp-map,html.w-board .b-rp-map,html:not(.w-battle) .b-rp-map{display:none}"));
  assert.ok(/@media \(max-width:600px\)\{\.b-rp\{height:44px;border-radius:22px\}\.b-rp-map kbd\{display:none\}\}/.test(css), "no key cap on small panes");
  assert.ok(/\.b-rp\{[^}]*background:#F4F6FA;color:#0B0D13/.test(css), "white, not a purple label pill");
});

test("BATTLE.md U2 and section 8: the Last night card's Replay is the white pill and comes first; key R starts from the idle view, S saves during a replay", () => {
  const js = M.BATTLE_CLIENT_JS, N = (x) => String(x).replace(/\s+/g, "").replace(/"/g, "'"), J = N(js);
  const lr = J.slice(J.indexOf("functionlastRender(){"), J.indexOf("functionpost(path,body){"));
  assert.ok(lr.includes(N(`<div class="b-lbtn"><button type="button" class="b-rp" data-bl="replay"`)) && lr.includes(N(`<div class="b-lbtn"><button type="button" class="b-rp" data-bdemo`)), "first, white");
  assert.ok(!lr.includes(N(`class="b-gb" data-bl="replay"`)) && lr.includes(N(`class="b-gb b-share"`)), "Copy link and Layers stay outline");
  const r0 = J.indexOf(N("if (e.key !== 'r' && e.key !== 'R' ||")), rk = J.slice(r0, r0 + 600); assert.ok(r0 > 0);
  assert.ok(rk.includes("INPUT|TEXTAREA|SELECT") && rk.includes(N("if (!on || cl.contains('w-replay') || cl.contains('w-board') || popEl) return;")) && rk.includes(N("var b = mapReplay(); if (!b) return; e.preventDefault(); b.click();")), "R: Battle view on, no replay, no board, no field");
  assert.ok(J.includes(N("e.key === 's' || e.key === 'S' ? 'pic'")), "S clicks Save strike picture inside the replay key handler (which ignores the board and fields)");
});

test("BATTLE.md U3/U7/U8: the progress line, the new menu rows, 2/7 paused; one row of 50 px at 600 px and under; the chip under the switch", () => {
  const js = M.BATTLE_CLIENT_JS, N = (x) => String(x).replace(/\s+/g, "").replace(/"/g, "'"), J = N(js), css = M.BATTLE_CSS;
  assert.ok(J.includes(N(`hudEl.innerHTML = '<div class="b-prog" aria-hidden="true"></div><div class="b-pt">`)), "the progress line is the first child of the bar, not read");
  const ph = { stage: "beat", t: 1500, strikes: [[0, 1000], [1000, 3000], [3000, 5000]] };
  assert.deepEqual(L.prog(ph), [1, .25, 0], "done white, the current fills with the clock, the rest empty"); assert.deepEqual(L.prog(ph, true), [1, 0, 0], "reduced motion: in steps");
  for (const st of ["fall", "wide", "rebuild"]) assert.deepEqual(L.prog({ ...ph, stage: st }), [1, 1, 1], st); assert.deepEqual(L.prog({ stage: "pre", t: -5, strikes: [[0, 10]] }), [0]); assert.deepEqual(L.prog(null), []);
  assert.ok(J.includes(N(`data-p="pic" aria-disabled="true" title="Save a picture of the strike that landed last (S)" hidden>' + bIco('pic') + '<span>Save strike picture</span><kbd>S</kbd>`)), "Save strike picture, key S, dimmed until a strike landed");
  assert.ok(J.includes(N("pc.hidden = pk === 'off' || !pk; pc.setAttribute('aria-disabled', String(pk !== 'ready'));")) && J.includes(N("if (A() && A().savePic) A().savePic();")), "hidden where the page cannot save");
  assert.ok(J.includes(N(`data-p="math" class="s-only" hidden>' + bIco('math') + '<span>How this hit was counted</span>`)) && J.includes(N(`data-p="flagm" class="s-only" hidden>`)) && J.includes(N("var fw = 'Report the word ' + hs[8].word;")), "small panes: the hit line and the flag move into More");
  assert.ok(J.includes(N("if (pz) { beat += ', paused'; sbeat += ' paused'; }")), "2/7 paused, read as Strike 2 of 7, paused");
  const mq = css.slice(css.indexOf("@media (max-width:600px){.b-play{"), css.indexOf("\n", css.indexOf("@media (max-width:600px){.b-play{")));
  assert.ok(mq.includes(".b-play{left:10px;right:10px;bottom:10px;transform:none;width:auto;min-height:50px;gap:4px;padding:4px 5px}") && !mq.includes(".b-play{left:10px;right:10px;bottom:10px;transform:none;width:auto;flex-direction:column"), "one row, 50 px");
  assert.ok(mq.includes('.b-play [data-p="label"],.b-play .b-hit,.b-play .b-flag{display:none}') && mq.includes(".b-play .b-menu .s-only{display:flex}") && mq.includes('.b-play .b-pb [data-p="follow"]{width:40px;padding:0'), "no label or hit line in the bar; Follow is a 40 px icon");
  assert.ok(mq.includes(".b-play:has(.b-flagq){flex-direction:column;align-items:stretch"), "the report question keeps its stacked layout");
  assert.ok(/\.b-play \.b-prog\{position:absolute;left:12px;right:12px;top:-1px;height:3px;display:flex;gap:3px;pointer-events:none\}/.test(css) && css.includes("transform:scaleX(var(--p,0))"));
  assert.ok(css.includes("@media (max-width:600px){.b-chip{top:52px;bottom:auto;left:12px}"), "small panes: the chip under the switch");
  assert.ok(css.includes(".c-stage.c-full .bcall{top:calc(12px + env(safe-area-inset-top,0px))}"), "full screen: the callout clears the notch");
  assert.ok(!/—/.test(js + css), "no em dashes");
});
