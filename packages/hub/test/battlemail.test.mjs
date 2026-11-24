// The battle mail and its picture (LOOP.md part a, spec 11-24 section 2): the result word (section 0), the night summary,
// the subject for each result, the first-mail line one time, the alt text of both variants, the SVG for 1, 2, 3 rows and a
// 39-character handle, the PNG with the repo's fonts, the picture routes, og:image on the replay link, default daily, and the
// Settings rows for a member with no email.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { Resvg } from "@resvg/resvg-js";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

const load = async f => { const out = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64")); };
const B = await load("../src/battle.ts"), K = await load("../src/battlecard.ts");
const FONTS = K.cardFonts(new URL("../fonts/", import.meta.url).pathname);
const DAY = 86_400_000;
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const X = (u, held = 0) => ({ u, fi: 0, fu: 0, sp: 0, m: 1, cep: 1, r: 1, kpa: 1, c: 0, fl: 1, v: 1, sh: 0, cd: 1, st: 1, pc: 1, raw: 1, held });
const shot = (a, d, u, o = {}) => ({ k: 0, a, d, w: "rocket", ammo: 2e5, roll: 0, f: o.f ?? (u > 0 ? 0.01 : 0), lot: 0, t: 0, aim: 0, blocked: 0, x: X(u, o.held || 0) });

// ---------------------------------------------------------------- section 0: one result word
test("resultOf: FELL, then WON (dealt > taken), HELD (hit, shield held >= taken), LOST, QUIET (nothing in or out)", () => {
  const night = [shot("a", "b", 900), shot("a", "c", 100, { held: 50 }), shot("c", "a", 50), shot("b", "d", 10, { held: 40 })];
  assert.equal(B.fallenOf(night), "b");
  assert.equal(B.resultOf("b", night), "FELL", "the fallen city falls, whatever else is true");
  assert.equal(B.resultOf("a", night), "WON", "dealt $1,000 > took $50");
  assert.equal(B.resultOf("d", night), "HELD", "hit for $10, the shield held $40");
  assert.equal(B.resultOf("c", night), "LOST", "dealt $50, took $100, the shield held $50");
  assert.equal(B.resultOf("z", night), "QUIET");
  assert.equal(B.resultFrom({ fell: false, dealt: 0, taken: 0, held: 0, shotsIn: 0, shotsOut: 2 }), "LOST", "fired, nothing landed, nothing came in");
  assert.equal(B.resultFrom({ fell: false, dealt: 5, taken: 5, held: 5, shotsIn: 1, shotsOut: 1 }), "HELD", "a tie on dollars with the shield holding as much");
  assert.equal(B.resultFrom({ fell: true, dealt: 0, taken: 0, held: 0, shotsIn: 0, shotsOut: 0 }), "QUIET", "no shots, no result");
});

test("nightSummary: top attackers by damage dealt (the first is the winner), hit hardest by damage taken, the card's three numbers; raiders only when nobody else fired", () => {
  const night = [shot("a", "b", 900), shot("a", "c", 100), shot("c", "a", 300), shot("~raiders", "a", 5000), shot("c", "~raiders", 50), shot("b", "c", 0)];
  const s = B.nightSummary(night, { night: "2026-11-24", cities: 3 });
  assert.equal(s.winner, "a", "raiders are left out though they dealt $5,000"); assert.deepEqual(s.tops.map(t => t.id), ["a", "c", "b"]);
  assert.deepEqual(s.tops[0], { id: "a", usd: 1000, fired: 2, landed: 2 }); assert.deepEqual(s.tops[2], { id: "b", usd: 0, fired: 1, landed: 0 });
  assert.deepEqual(s.hard.map(t => [t.id, t.usd, t.down]), [["a", 5300, true], ["b", 900, false], ["c", 100, false]]);
  assert.equal(s.cities, 3); assert.equal(s.hits, 5); assert.equal(s.usd, 6350);
  assert.equal(B.nightSummary([shot("~raiders", "a", 10)], { night: "x", cities: 1 }).winner, "~raiders", "only raiders fired");
  assert.equal(B.nightSummary([], { night: "x", cities: 0 }), null);
});

// ---------------------------------------------------------------- the mail
const W = { built: [], hit: [["@lumen", 3e7]], attackers: [], rebuilds: [], rivalry: null, season: { n: 1, week: 3 } };
const R = { night: "2026-11-24", h: "sam", peace: false, raids: [{ from: "@lumen", t: 0, shots: 1, landed: 1, f: 0.1 }], taken: 0.1, tiers: 1, rebuilt: 50, fired: 9, landed: 6, on: ["@harbor"], dealt: 0.4,
  takenUsd: 4e6, dealtUsd: 14e6, fires: 0, heldUsd: 9e6, mvp: null, shield: 0.8, streak: 12, built: 2, ammo: 22, usd: 1.1e6 };
const O = { name: "Sam Lee", hub: "https://caldera.social/", unsub: "https://caldera.social/u/battle?t=x", postal: "mjonesone, LLC, 450 S Melrose Dr, Vista, CA 92081", card: "https://caldera.social/v1/world/battle/card/2026-11-24/sam.png", alt: "Caldera battle, Nov 24.", rank: 12, move: 3, winner: "@novak", date: "Nov 24" };
test("subject for each result (LOOP.md a.2), ASCII, the winner's own subject, weekly", () => {
  const subj = (res, extra = {}) => B.battleEmail(R, W, { ...O, res, ...extra }).subject;
  assert.equal(subj("WON"), "Last night: @novak won, your city won too");
  assert.equal(subj("HELD"), "Last night: @novak won, your city held");
  assert.equal(subj("LOST"), "Last night: @novak won, your city lost");
  assert.equal(subj("FELL"), "Last night: @novak won, your city fell");
  assert.equal(subj("WON", { mine: true }), "Last night: your city won the battle");
  assert.equal(B.battleEmail(R, W, { ...O, res: "WON", weekly: true, week: { n: 5, w: 3, lots: 14, dealt: 31e6, took: 9e6 } }).subject, "Last week: 5 battles, your city won 3");
  for (const r of ["WON", "HELD", "LOST", "FELL"]) assert.ok(/^[\x20-\x7e]+$/.test(subj(r)));
});
test("the mail: picture and two buttons first, the report, rank line, preheader, footer; tables and inline styles; light only", () => {
  const m = B.battleEmail(R, W, { ...O, res: "WON" });
  assert.equal(m.preheader, "Dealt $14M, took $4M, shield held $9M. Season rank 12. Next battle tonight at 20:00 PT.");
  const h = m.html, at = s => { const i = h.indexOf(s); assert.ok(i >= 0, "html has: " + s); return i; };
  assert.ok(at('<meta name="color-scheme" content="light only">') < at("Nightly battle, Nov 24"));
  assert.ok(at('<img src="https://caldera.social/v1/world/battle/card/2026-11-24/sam.png" width="560" height="294" alt="Caldera battle, Nov 24."') < at(">Watch the replay</a>"));
  assert.ok(at(">Watch the replay</a>") < at(">Set tonight&#39;s defenses</a>".replace("&#39;", "'")) && at(">Set tonight's defenses</a>") < at("Hey Sam,") && at("Hey Sam,") < at("YOUR CITY") && at("YOUR CITY") < at("TODAY IN THE WORLD"));
  at('href="https://caldera.social/world?view=battle&amp;replay=1"'); at('href="https://caldera.social/world?view=battle#tonight"');
  at("Armed by 19:45 PT: 9 missiles bought with a $1.1M budget (the day's work)."); at("Salvo at 20:00 PT: 9 fired, 6 landed on @harbor, $14M of damage."); at("Season rank 12, up 3."); at("Shield 80% (12-day streak).");
  at("Season 1, week 3."); at("You get this because your city is in the Caldera battle."); at(">Daily, weekly or off</a>"); at(">Unsubscribe</a>"); at("Vista, CA 92081");
  assert.ok(!/<style|class=/.test(h), "inline styles only"); assert.ok((h.match(/<table role="presentation"/g) || []).length >= 3, "layout tables are presentation");
  assert.ok(!h.includes("BUILT BY THE FLEET") && !h.includes("FINAL"), "no promotion, no podium: no empty boxes");
  assert.ok(B.battleEmail(R, W, { ...O, res: "LOST", move: -2 }).text.includes("Season rank 12, down 2."));
  assert.ok(B.battleEmail(R, W, { ...O, res: "HELD", move: 0 }).text.includes("Season rank 12, no change."));
  assert.ok(B.battleEmail(R, W, { ...O, res: "FELL" }).text.includes("Your shield took $9M off. Your city fell. Cranes rebuild overnight"));
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(m.text), "text is ASCII");
  const nr = B.battleEmail({ ...R, fired: 0 }, W, { ...O, res: "HELD" }).text; assert.ok(nr.includes("Nothing armed by 19:45 PT: no work counted that day."));
});
test("first-mail line only when o.first; weekly line; podium and promoted card when given", () => {
  const line = "You get this after each nightly battle.";
  const f = B.battleEmail(R, W, { ...O, res: "WON", first: true });
  assert.ok(f.text.startsWith(line + " Weekly or off: https://caldera.social/world?view=battle#reports"));
  assert.ok(f.html.indexOf(line) >= 0 && f.html.indexOf(line) < f.html.indexOf("Nightly battle,"), "the grey line above the wordmark row");
  assert.ok(!B.battleEmail(R, W, { ...O, res: "WON" }).html.includes(line) && !B.battleEmail(R, W, { ...O, res: "WON" }).text.includes(line));
  const wk = B.battleEmail(R, W, { ...O, res: "WON", weekly: true, week: { n: 5, w: 3, lots: 14, dealt: 31e6, took: 9e6 } });
  assert.ok(wk.text.includes("Hey Sam,\n\nThis week: 5 battles, your city won 3. 14 lots built, $31M of damage dealt, $9M taken (all rebuilt on its own).\n\nYOUR CITY"), wk.text);
  const pd = B.battleEmail(R, W, { ...O, res: "WON", podium: [{ h: "@novak", usd: 1.8e9 }, { h: "@tessera", usd: 4e8 }, { h: "@quill", usd: 3.47e8 }] });
  for (const s of ["SEASON 1 FINAL", "@novak", "$1.8B", "$347M", "The three winners keep a Season 1 badge. Season 2 starts tonight at 20:00 PT.", ">Full ranking</a>"]) assert.ok(pd.html.includes(s), s);
  const pr = B.battleEmail(R, W, { ...O, res: "WON", promo: { title: "tidepool: a <tiny> job queue", line: "One file.", handle: "okafor", url: "https://caldera.social/p/x", report: "https://caldera.social/points/report?ad=x" } });
  for (const s of ["BUILT BY THE FLEET", "tidepool: a &lt;tiny&gt; job queue", "Promoted by @okafor with Caldera Points.", ">View project</a>", ">Report</a>"]) assert.ok(pr.html.includes(s), s);
});

// ---------------------------------------------------------------- the picture
const night = (k = 3, long = false) => ({ night: "2026-11-24", season: 1, week: 3, cities: 96, hits: 56, usd: 287e6,
  tops: [["@" + (long ? "a".repeat(39) : "novak"), 53e6, 6, 5], ["@tessera", 41e6, 9, 6], ["@quill", 22e6, 4, 4]].slice(0, k).map(([h, usd, fired, landed]) => ({ h, usd, fired, landed })),
  hard: [["@harbor", 48e6, 7, 3e6, true], ["@lumen", 31e6, 5, 12e6, false], ["@okafor", 19e6, 3, 0, false]].slice(0, k).map(([h, usd, hits, held, down]) => ({ h, usd, hits, held, down })) });
const ME = { h: "@sam", res: "WON", dealt: 14e6, took: 4e6, held: 9e6, rank: 12, move: 3 };
test("alt text for each variant (LOOP.md a.3)", () => {
  assert.equal(K.battleCardAlt(night(), ME), "Caldera battle, Nov 24. @novak won the night. Top attackers: @novak $53M, @tessera $41M, @quill $22M. Hit hardest: @harbor $48M (city down), @lumen $31M, @okafor $19M. 96 cities fought, 56 missiles hit, $287M of damage. Your city @sam won: dealt $14M, took $4M, shield held $9M. Season rank 12, up 3.");
  assert.ok(K.battleCardAlt(night(), { ...ME, res: "FELL", move: -6 }).endsWith("Your city @sam fell: dealt $14M, took $4M, shield held $9M. Season rank 12, down 6."));
  assert.ok(K.battleCardAlt(night(), { ...ME, res: "HELD", move: 0 }).endsWith("Season rank 12, no change."));
  assert.equal(K.battleCardAlt(night(1), null), "Caldera battle, Nov 24. @novak won the night. Top attackers: @novak $53M. Hit hardest: @harbor $48M (city down). 96 cities fought, 56 missiles hit, $287M of damage. Next battle tonight at 20:00 PT.");
});
test("the SVG is valid XML for 1, 2 and 3 rows and a 39-character handle; result words, move triangles, no arrow glyphs; avatars embed over the letter circle", () => {
  for (const k of [1, 2, 3]) for (const me of [ME, null]) {
    const svg = K.battleCardSvg(night(k), me); assert.doesNotThrow(() => new Resvg(svg), `rows ${k} ${me ? "member" : "generic"}`);
    assert.equal((svg.match(/missiles hit<\/text>/g) || []).length, k, "draws only the rows that exist");
  }
  const long = K.battleCardSvg(night(3, true), { ...ME, h: "@" + "b".repeat(39) });
  assert.doesNotThrow(() => new Resvg(long)); assert.ok(long.includes("A".repeat(20) + "..") && long.includes('font-size="78"'), "headline cut at 20 with .., 78 px");
  assert.ok(long.includes(">" + "B".repeat(12) + "<"), "the band handle is cut at 12");
  assert.ok(K.battleCardSvg(night(), ME).includes('font-size="100"'), "a short handle is 100 px");
  for (const [res, col] of [["WON", "#4BE38A"], ["HELD", "#3DF2FF"], ["LOST", "#FF6A3D"], ["FELL", "#FF4D5E"]]) { const s = K.battleCardSvg(night(), { ...ME, res }); assert.ok(s.includes(`fill="${col}">${res}</text>`), res); }
  assert.ok(K.battleCardSvg(night(), ME).includes('d="M0 12 L8 0 L16 12 Z"') && K.battleCardSvg(night(), { ...ME, move: -2 }).includes('d="M0 0 L16 0 L8 12 Z"') && !K.battleCardSvg(night(), { ...ME, move: 0 }).includes("L8 12 Z"));
  assert.ok(K.battleCardSvg(night(), ME).includes(">CITY DOWN</tspan>"));
  const gen = K.battleCardSvg(night(), null); for (const s of ["NEXT BATTLE", "TONIGHT 20:00 PT", "Your GitHub becomes a city.", "ADD YOUR CITY"]) assert.ok(gen.includes(s), s);
  assert.ok(!/[←-⇿▲▼]/.test(K.battleCardSvg(night(), ME) + gen), "no arrow characters");
  const png1 = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  const withAv = K.battleCardSvg({ ...night(), tops: night().tops.map(t => ({ ...t, av: png1 })) }, { ...ME, av: "javascript:alert(1)" });
  assert.equal((withAv.match(/<image /g) || []).length, 3, "data: PNGs embed; anything else is dropped"); assert.ok(withAv.includes('clip-path="url(#av0)"'));
  assert.equal(K.avatarUri(Buffer.from("<svg/>")), null, "only PNG or JPEG"); assert.ok(K.avatarUri(Buffer.from([0xff, 0xd8, 0xff, 0])).startsWith("data:image/jpeg;base64,"));
  assert.ok(!K.battleCardSvg({ ...night(), tops: [{ h: "@x&<y>", usd: 1, fired: 1, landed: 1 }] }, null).includes("x&<y>"), "text is escaped");
});
test("fetchAvatar: a slow or failed fetch gives null quickly, never throws", async () => {
  const t0 = Date.now();
  assert.equal(await K.fetchAvatar("https://x.test/a.png", 50, (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted"))))), null);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await K.fetchAvatar("https://x.test/a.png", 50, async () => { throw new Error("down"); }), null);
  assert.equal(await K.fetchAvatar("https://x.test/a.png", 50, async () => new Response("no", { status: 404 })), null);
});
test("PNG: the repo's four OFL fonts load and the picture renders at 1200x630", async () => {
  assert.equal(FONTS.length, 4, "fonts/ holds Saira Extra Condensed 900, Barlow Condensed 600 and 700, IBM Plex Mono 500");
  const r = new Resvg(K.battleCardSvg(night(), ME), { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: "Barlow Condensed" } });
  const img = r.render(); assert.equal(img.width, 1200); assert.equal(img.height, 630);
  const png = Buffer.from(img.asPng()); assert.ok(png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
});

test("freqOf: a member who never chose gets the daily mail; weekly and off choices stay", () => {
  assert.equal(B.freqOf(null), "daily"); assert.equal(B.freqOf({ report: "off", chose: 0 }), "daily");
  assert.equal(B.freqOf({ report: "off", chose: 1 }), "off"); assert.equal(B.freqOf({ report: "weekly", chose: 0 }), "weekly"); assert.equal(B.freqOf({ report: "weekly", chose: 1 }), "weekly");
});

// ---------------------------------------------------------------- the live hub
async function hubWith(handles) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-bmail-")); dirs.push(d);
  const sent = [];
  const h = createHub({ dataDir: d, publicUrl: "https://hub.test", githubFetch: async () => new Response("[]", { status: 200 }), growthPoll: false, email: { send: async m => { sent.push(m); } } });
  const base = "http://127.0.0.1:" + await h.listen(0), ids = {};
  for (const handle of handles) {
    const rr = (name, commits) => ({ name, project: "Work", public: true, language: "TypeScript", commits, weeks: [1, 2, 3], week: 3, today: 0, pushed: new Date().toISOString(), url: `https://github.com/${handle}/${name}` });
    const full = cityData([rr("app", 300)], () => ({ n: 0, paths: [] }), new Date().toISOString());
    const files = { "index.html": Buffer.from(`<html><body>${handle}</body></html>`).toString("base64"), "city.html": Buffer.from(renderCity({ name: handle, handle }, publicCity(full, ["Work"], "show"))).toString("base64") };
    const id = C.newIdentity(); ids[handle] = id;
    const r = await fetch(`${base}/v1/profiles/${id.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(id, "profile.manifest", { name: handle, handle, boxKey: id.boxPublic }), files }) });
    assert.equal(r.status, 200);
  }
  const today = Math.floor(Date.now() / DAY), ins = h.db.prepare("INSERT OR IGNORE INTO growth_events VALUES (?,?,?,?,?,?,?,?,?)");
  for (const [handle, id] of Object.entries(ids)) for (let dd = today - 40; dd <= today; dd++) for (let k = 0; k < 20; k++) { const t = dd * DAY + 3600_000 + k * 60_000; ins.run(`c:${handle}${dd}x${k}`, id.id, "commit", `${handle}/app`, t, t, 1, "", null); }
  h.admin.growth.recompute();
  return { h, base, ids, sent };
}
const confirm = (h, id, email) => h.db.prepare("INSERT OR REPLACE INTO email_subs (owner, email, hash, confirmed, token, created) VALUES (?,?,?,?,?,?)").run(id, h.admin.seal(email), "h" + id.slice(0, 6), 1, "t" + id.slice(0, 6), new Date().toISOString());

test("live: default daily for members who never chose, the first-mail line one time, the picture routes, og:image on the replay link; nothing sends with the switch off", async () => {
  delete process.env.CALDERA_BATTLE_EMAIL;
  const { h, base, ids, sent } = await hubWith(["ana", "bo"]);
  try {
    const B2 = h.admin.battle, n = B.lastNight(Date.now()), day = new Date(n * DAY).toISOString().slice(0, 10);
    for (const w of ["ana", "bo"]) B2.optIn(ids[w].id, { since: 0, waive: true });
    B2.resolve(n);
    confirm(h, ids.ana.id, "ana@x.io");
    // the switch is off: composed, never sent
    let r = await B2.sendReports({ force: true });
    assert.equal(sent.filter(m => m.src === "battle-report").length, 0, "CALDERA_BATTLE_EMAIL is off: nothing is sent");
    assert.ok(r.out.some(x => x.h === "ana" && x.dry), "ana never chose: daily by default " + JSON.stringify(r.out));
    assert.ok(r.out.some(x => x.h === "bo" && x.skip === "no confirmed email"));
    // the summary is the "Last night" card's: state() reads the same numbers
    const st = await (await fetch(base + "/v1/world/battle")).json(), sum = B2.summaryOf(n);
    assert.equal(st.usd, sum.usd); assert.equal(st.cities, sum.cities); assert.equal(st.shots.filter(s => s[3] > 0).length, sum.hits);
    // the pictures
    const g = await fetch(`${base}/v1/world/battle/card/${day}.png`);
    assert.equal(g.status, 200); assert.equal(g.headers.get("content-type"), "image/png"); assert.ok(/max-age=\d{6}/.test(g.headers.get("cache-control")));
    const gb = Buffer.from(await g.arrayBuffer()); assert.ok(gb.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM battle_cards WHERE night=?").get(n).n, 1, "rendered one time and stored");
    assert.ok(Buffer.from(await (await fetch(`${base}/v1/world/battle/card/${day}.png`)).arrayBuffer()).equals(gb), "the stored picture again");
    assert.equal((await fetch(`${base}/v1/world/battle/card/${day}/ana.png`)).status, 200);
    assert.equal((await fetch(`${base}/v1/world/battle/card/${day}/nobody.png`)).status, 404);
    assert.equal((await fetch(`${base}/v1/world/battle/card/2020-01-01.png`)).status, 404, "no night, no picture");
    // og:image on the replay link
    const page = await (await fetch(base + "/world?view=battle&replay=1")).text();
    assert.ok(page.includes(`<meta property="og:image" content="https://hub.test/v1/world/battle/card/${day}.png">`) && /<meta property="og:image:alt" content="Caldera battle, [A-Z][a-z]{2} \d+\./.test(page) && page.includes("Next battle tonight at 20:00 PT."), "generic picture and alt");
    const mine = await (await fetch(base + "/world?view=battle&replay=1&city=ana")).text();
    assert.ok(mine.includes(`/v1/world/battle/card/${day}/ana.png">`) && mine.includes("Your city @ana "), "member picture with &city=");
    assert.ok((await (await fetch(base + "/world")).text()).includes('content="https://hub.test/og.jpg"'), "the plain /world keeps its picture");
    // the switch on: one mail, the first-mail line one time
    process.env.CALDERA_BATTLE_EMAIL = "1";
    r = await B2.sendReports({ force: true });
    let m = sent.filter(x => x.src === "battle-report");
    assert.equal(m.length, 1, JSON.stringify(r)); assert.equal(m[0].to, "ana@x.io");
    assert.ok(/^Last night: /.test(m[0].subject), m[0].subject);
    assert.ok(m[0].text.startsWith("You get this after each nightly battle.") && m[0].html.includes(`/v1/world/battle/card/${day}/ana.png`), "first mail: the line and the picture");
    assert.equal(B2.store.opt(ids.ana.id).first, day);
    await B2.sendReports({ force: true }); m = sent.filter(x => x.src === "battle-report");
    assert.equal(m.length, 2); assert.ok(!m[1].text.includes("You get this after each nightly battle.") && !m[1].html.includes("You get this after each nightly battle."), "the line shows one time");
    // a member who chose off keeps it
    B2.store.setReport(ids.ana.id, "off"); await B2.sendReports({ force: true });
    assert.equal(sent.filter(x => x.src === "battle-report").length, 2, "off stays off");
    assert.equal((await B2.mailTest(ids.ana.id)).html.includes("<!doctype html>"), true, "the operator test composes without sending");
    assert.equal(sent.filter(x => x.src === "battle-report").length, 2);
  } finally { delete process.env.CALDERA_BATTLE_EMAIL; h.server?.close?.(); }
});

test("Settings > Notifications > Battles: a member with no confirmed email sees the two rows; with an email they are gone", async () => {
  const { h, ids } = await hubWith(["cy"]);
  try {
    const html = h.admin.battle.settingsHtml(ids.cy.id);
    for (const s of ["No battle mail yet", "You have no confirmed email. Add one to get the winners and your city's result after each battle.", ">Add an email</a>", "Last night", "The same report is here each day, with the replay.", ">Open the summary</a>"]) assert.ok(html.includes(s), s);
    assert.equal((html.match(/class="st-row"/g) || []).length, 4, "two switch rows and the two new rows");
    confirm(h, ids.cy.id, "cy@x.io");
    assert.ok(!h.admin.battle.settingsHtml(ids.cy.id).includes("No battle mail yet"));
  } finally { h.server?.close?.(); }
});
