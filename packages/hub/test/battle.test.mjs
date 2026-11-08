import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

const out = await build({ entryPoints: [new URL("../src/battle.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const B = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const DAY = 86_400_000, D = Math.floor(Date.parse("2026-11-06T12:00:00Z") / DAY);
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
let seq = 0;
const ev = (k, day, o = {}) => { const t = day * DAY + 9 * 3600_000 + (seq++) * 1000; return { id: o.id || `${k}:${seq}`, p: o.p || "a", k, repo: o.repo || "me/app", ts: o.ts ?? t, seen: o.seen ?? t, n: o.n ?? 1, v: o.v || "", ...(o.x ? { x: o.x } : {}) }; };
const many = (k, day, n, o = {}) => Array.from({ length: n }, () => ev(k, day, o));

// ---------------------------------------------------------------- 1. the arsenal
test("arsenal(day) = min(60, sum over repos (commits_w + 3 PRs + 8 releases + 2 ci_green) x ai_mult x streak_mult)", () => {
  const base = [...many("commit", D, 5), ev("pr", D), ev("release", D), ev("ci_green", D)];
  const a = B.arsenal(base, D);
  near(a.ammo, 5 + 3 + 8 + 2); assert.equal(a.c, 5); assert.equal(a.pr, 1); assert.equal(a.rel, 1); assert.equal(a.ci, 1);
  near(B.arsenal(base, D, { ai: new Map([["me/app", 1]]) }).ammo, 18 * 1.3, 0.05);
  near(B.arsenal(base, D, { ai: new Map([["me/app", 9]]) }).ammo, 18 * 1.6, 0.05);
  near(B.arsenal(base, D, { streak: 7 }).ammo, 18 * 1.1, 0.05);
  near(B.arsenal(base, D, { streak: 30 }).ammo, 18 * 1.5, 0.05);
  // AI weighting is per repo: only the AI repo's output is multiplied
  const two = [...many("commit", D, 10, { repo: "me/llm" }), ...many("commit", D, 10, { repo: "me/site" })];
  near(B.arsenal(two, D, { ai: new Map([["me/llm", 3]]) }).ammo, 10 * 1.5 + 10, 0.05);
  // the cap
  assert.equal(B.arsenal([...many("commit", D, 40), ...many("release", D, 6)], D, { streak: 40 }).ammo, 60);
});

test("anti-gaming: only today's judged human work loads the guns; 40 commits a day; empty, bot, fork, revert, prerelease earn nothing", () => {
  assert.equal(B.arsenal(many("commit", D, 100), D).c, 40, "40 commits a day per member");
  assert.equal(B.arsenal(many("commit", D, 100), D).ammo, 40);
  const voids = ["bot", "empty", "merge", "fork", "other", "dup"].map(v => ev("commit", D, { v })).concat([ev("release", D, { v: "prerelease" }), ev("star", D), ev("newrepo", D), ev("post", D, { repo: "caldera" })]);
  assert.equal(B.arsenal(voids, D).ammo, 0, "voided commits, prereleases, stars, new (forked) repos and posts load nothing");
  const old = ev("commit", D - 3, { seen: D * DAY + 3600_000 });   // an old commit pushed today
  assert.equal(B.arsenal([old], D).ammo, 0, "commits authored on other days don't count (today only)");
  const c = ev("commit", D, { id: "c:abcdef1234" });
  assert.equal(B.arsenal([c], D, { reverted: new Set(["abcdef1"]) }).ammo, 0, "a revert cancels the commit it reverts");
  near(B.arsenal([ev("pr", D, { x: { self: 1 } })], D).ammo, 1, 1e-9);
  near(B.arsenal([ev("private", D, { n: 10 })], D).ammo, 7, 1e-9);
  assert.equal(B.arsenal(many("commit", D, 3), D + 1).ammo, 0, "nothing banks beyond the night");
});

test("weapons: 3 orbital, 6 beam, 12 cannon or 24 catapult shots spend 60; the plot's top building sets the best weapon", () => {
  assert.deepEqual(["7", "6", "5", "4", "0"].map(B.bestWeapon), ["orbital", "beam", "cannon", "catapult", "catapult"]);
  assert.equal(B.shotsFor(60, "orbital").length, 3); assert.equal(B.shotsFor(60, "beam").length, 6); assert.equal(B.shotsFor(60, "cannon").length, 12); assert.equal(B.shotsFor(60, "catapult").length, 24);
  assert.deepEqual(B.shotsFor(37.5, "orbital"), ["orbital", "beam", "cannon", "catapult"], "most expensive first, the rest steps down");
  assert.deepEqual(B.shotsFor(2, "orbital"), [], "under a catapult shot: nothing");
});

test("shields: beginner 100% for 30 days and until 7 active days (waivable); 50% at a 7-day streak to 95% at 30", () => {
  assert.equal(B.shield({ streak: 0, joinedDays: 3, activeDays: 50 }), 1);
  assert.equal(B.shield({ streak: 20, joinedDays: 100, activeDays: 4 }), 1);
  assert.equal(B.shield({ streak: 0, joinedDays: 3, activeDays: 2, waived: true }), 0);
  assert.equal(B.shield({ streak: 6, joinedDays: 100, activeDays: 40 }), 0);
  assert.equal(B.shield({ streak: 7, joinedDays: 100, activeDays: 40 }), 0.5);
  assert.equal(B.shield({ streak: 30, joinedDays: 100, activeDays: 40 }), 0.95);
  const s18 = B.shield({ streak: 18, joinedDays: 100, activeDays: 40 }); assert.ok(s18 > 0.5 && s18 < 0.95);
});

// ---------------------------------------------------------------- 2. battle resolution
const F = (id, o = {}) => ({ id, h: id, ars: { ammo: o.ammo ?? 60, shots: B.shotsFor(o.ammo ?? 60, o.best || "cannon"), best: o.best || "cannon" }, sh: o.sh ?? 0, beg: !!o.beg, lots: o.lots || "5555444400000000", side: o.side || 4, out7: o.out7 ?? 100, heads: o.heads || 1, idle: o.idle ?? 0 });

test("resolution: deterministic, dice in the damage, only opted-in fighters, caps of 2 facades a night", () => {
  const fs2 = [F("a"), F("b"), F("c", { ammo: 10 })];
  const r1 = B.resolveNight({ night: D, fighters: fs2 }), r2 = B.resolveNight({ night: D, fighters: fs2 });
  assert.deepEqual(r1, r2, "same night in, same battle out");
  assert.ok(r1.shots.length > 0 && r1.shots.every(s => ["a", "b", "c"].includes(s.a) && ["a", "b", "c"].includes(s.d)), "nobody outside the fighters is ever in a shot");
  assert.ok(r1.shots.some(s => s.roll !== r1.shots[0].roll), "the dice vary");
  for (const d of ["a", "b", "c"]) assert.ok(r1.shots.filter(s => s.d === d).reduce((t, s) => t + s.f, 0) <= 2 + 1e-9, "at most 2 facades a night on " + d);
  for (const s of r1.shots) { assert.ok(s.t >= B.battleAt(D) && s.t < B.battleAt(D) + 41 * 60_000, "shots between 02:00 and 02:40 Pacific"); if (s.f > 0) assert.ok(Number(fs2.find(f => f.id === s.d).lots[s.lot]) >= 4, "hits land on built lots"); }
  assert.notDeepEqual(B.resolveNight({ night: D + 1, fighters: fs2 }).shots.map(s => s.roll), r1.shots.map(s => s.roll), "another night, other dice");
});

test("fairness: weekly 30% cap, never the same rival two nights running, quiet plots untargetable, beginner shield holds, per-capita strength", () => {
  // weekly cap: 8 built lots -> 2.4 facades a week; 2.0 already taken -> 0.4 left tonight
  const r = B.resolveNight({ night: D, fighters: [F("a"), F("b", { lots: "4444444400000000" })], week: new Map([["b", 2.0]]) });
  near(Math.min(0.4, r.shots.filter(s => s.d === "b").reduce((t, s) => t + s.f, 0)), r.shots.filter(s => s.d === "b").reduce((t, s) => t + s.f, 0), 0.011);
  // same rival two nights running: a hit b last night -> a goes for c tonight
  const r2 = B.resolveNight({ night: D, fighters: [F("a"), F("b"), F("c", { side: 9, out7: 1 })], lastPairs: new Set(["a>b"]) });
  assert.ok(!r2.shots.some(s => s.a === "a" && s.d === "b"), "a doesn't hit b again");
  // quiet plots (14+ days idle) are not targets; with nobody else, raiders come in from the sea
  const r3 = B.resolveNight({ night: D, fighters: [F("a"), F("q", { idle: 20, ammo: 0 })] });
  assert.ok(!r3.shots.some(s => s.d === "q"), "the quiet plot is never targeted");
  assert.ok(r3.shots.some(s => s.a === "a" && s.d === B.RAIDERS) && r3.shots.some(s => s.a === B.RAIDERS && s.d === "a"), "a fights the raiders");
  // beginner shield 100%: hits are held off
  const r4 = B.resolveNight({ night: D, fighters: [F("a"), F("n", { sh: 1, beg: true })] });
  const onN = r4.shots.filter(s => s.d === "n"); assert.ok(onN.length > 0 && onN.every(s => s.f === 0 && s.blocked === 1), "the beginner shield holds");
  // per capita: a 10-person team hits with a tenth of the strength
  const solo = B.resolveNight({ night: D, fighters: [F("t", { heads: 1, ammo: 10 }), F("v", { ammo: 0 })] }).shots.filter(s => s.a === "t");
  const team = B.resolveNight({ night: D, fighters: [F("t", { heads: 10, ammo: 10 }), F("v", { ammo: 0 })] }).shots.filter(s => s.a === "t");
  near(team.reduce((x, s) => x + s.f, 0) * 10, solo.reduce((x, s) => x + s.f, 0), 0.06);
  const sc = B.scoreOf([{ a: "t", d: "v", f: 1, ammo: 5, blocked: 0 }, { a: "u", d: "v", f: 1, ammo: 5, blocked: 0 }], id => id === "t" ? 4 : 1);
  assert.equal(sc.get("t"), 0.25); assert.equal(sc.get("u"), 1, "scoring is per head");
});

test("manual fire: up to 3 aimed shots go where aimed, invalid aims are ignored, the rest auto-fire", () => {
  const fs3 = [F("a", { ammo: 60, best: "catapult" }), F("b", { side: 2, out7: 1 }), F("c", { side: 4 }), F("p", { idle: 30 })];
  const r = B.resolveNight({ night: D, fighters: fs3, aims: new Map([["a", ["b", "b", "b", "b", "p", "zz"]]]) });
  const a = r.shots.filter(s => s.a === "a"); assert.equal(a.length, 24);
  assert.equal(a.filter(s => s.aim).length, 3, "3 aimed shots at most"); assert.ok(a.filter(s => s.aim).every(s => s.d === "b"));
  assert.ok(!a.some(s => s.d === "p"), "an aim at a quiet plot is ignored");
});

// ---------------------------------------------------------------- 3. regeneration (always)
test("regeneration: 25% a day on its own (whole in 4 days, zero action), plus 1% per build point after the hit, never below 0", () => {
  const at = B.battleAt(D), none = () => 0;
  near(B.remaining(2, at, at, none), 2); near(B.remaining(2, at, at + DAY, none), 1.5); near(B.remaining(2, at, at + 2 * DAY, none), 1);
  assert.equal(B.remaining(2, at, at + 4 * DAY, none), 0, "an absent owner is whole within four days");
  assert.equal(B.remaining(2, at, at + 40 * DAY, none), 0);
  const busy = d => d === D ? 60 : 0;   // 60 points across the hit day: the part after 10:00 UTC counts
  const left = B.remaining(1, at, (D + 1) * DAY, busy); near(left, 1 - 0.25 * 14 / 24 - 0.01 * 60 * 14 / 24, 1e-6);
  assert.ok(left < B.remaining(1, at, (D + 1) * DAY, none), "coding speeds up the rebuild");
  assert.equal(B.remaining(1, at, at + DAY, () => 500), 0, "never negative");
  assert.equal(B.wholeAfterDays(), 4);
});

// ---------------------------------------------------------------- 4. the report and the email
test("report and email: what my city did last night; subject formula; ASCII; peaceful zones get build lines only; unsubscribe + postal", () => {
  const at = B.battleAt(D), shots = [{ k: 0, a: "o", d: "n", w: "cannon", ammo: 5, roll: 6, f: 1.2, lot: 3, t: at + 14 * 60000, aim: 0, blocked: 0 }, { k: 1, a: "n", d: "q", w: "beam", ammo: 10, roll: 4, f: 0.6, lot: 1, t: at + 20 * 60000, aim: 0, blocked: 0 }, { k: 2, a: "n", d: "q", w: "beam", ammo: 10, roll: 1, f: 0, lot: -1, t: at + 21 * 60000, aim: 0, blocked: 0 }];
  const handle = id => "@" + ({ o: "oscar", n: "nadia", q: "quinn" }[id] || id);
  const r = B.reportFor("n", "nadia", shots, { night: D, now: at + 7 * 3600_000, peace: false, pts: () => 0, handle, mvp: { repo: "build-bot", bricks: 38 }, shield: 0.92, streak: 14, built: 2, ammo: 20 });
  assert.equal(r.raids.length, 1); assert.equal(r.raids[0].from, "@oscar"); near(r.taken, 1.2); assert.equal(r.tiers, 1); assert.equal(r.fired, 2); assert.equal(r.landed, 1); assert.deepEqual(r.on, ["@quinn"]);
  assert.ok(r.rebuilt > 0 && r.rebuilt < 100, "partly rebuilt by 9am: " + r.rebuilt);
  assert.equal(B.battleSubject(r), "Your city today: hit by @oscar, cranes rebuild tonight");
  assert.equal(B.battleSubject({ ...r, taken: 0 }), "Your city today: @oscar stopped by your shield");
  assert.equal(B.battleSubject({ ...r, raids: [] }), "Your city today: 2 missiles stacked, no hits on your towers");
  assert.equal(B.battleSubject({ ...r, peace: true, built: 3 }), "Your city today: peaceful zone, 3 lots built");
  const w = B.worldLines(shots, { handle, built: [["@mike", 11]], rebuilt: [["@nadia", 61]], pairsByNight: [], season: { n: 1, week: 1 } });
  const m = B.battleEmail(r, w, { name: "Nadia K", hub: "https://caldera.social", unsub: "https://caldera.social/u/battle?t=x", postal: "mjonesone, LLC, 450 S Melrose Dr, Vista, CA 92081" });
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(m.text) && /^[\x20-\x7e]*$/.test(m.subject), "plain ASCII");
  for (const s of ["Hey Nadia,", "YOUR CITY", "Stacked at noon: 2 missiles from 20 ammo", "Salvo at 20:00: 2 fired, 1 landed on @quinn.", "Hits on your towers: 1.2 facades from @oscar (1 tower lost the top floors). Cranes rebuild overnight, whole by noon.", "MVP: build-bot, 38 bricks laid.", "Watch the replay: https://caldera.social/world?view=battle&replay=1", "TODAY IN THE WORLD", "Most ammo stacked: @nadia 2 missiles, @oscar 1 missile", "Built the most: @mike 11 lots", "Most hits landed: @nadia 1 hit", "Leaderboard: https://caldera.social/leaderboard", "Season 1, week 1", "Daily / Weekly / Off:", "Unsubscribe: https://caldera.social/u/battle?t=x", "Vista, CA"]) assert.ok(m.text.includes(s), "email has: " + s);
  const peace = B.battleEmail({ ...r, peace: true, raids: [] }, w, { name: "Nadia", hub: "https://caldera.social", unsub: "u", postal: "P" });
  assert.ok(!/attack|raid|hit|facade|salvo/i.test(peace.text.replace(/Hey Nadia[\s\S]*?YOUR CITY/, "")), "a peaceful zone never reads about attacks");
  const sum = B.battleSummary(shots, { night: "2026-11-08", handle, hub: "https://caldera.social/" });
  for (const t of ["Battle day, Nov 8.", "Most ammo stacked: @nadia 2 missiles, @oscar 1 missile.", "The 20:00 salvo: 3 missiles, 2 landed.", "Towers hit: @nadia (1 tower, 1.2 facades); @quinn (1 tower, 0.6 facades).", "Cranes rebuild overnight", "Replay: https://caldera.social/world?view=battle&replay=1", "Leaderboard: https://caldera.social/leaderboard"]) assert.ok(sum.includes(t), "summary: " + t);
  assert.equal(B.battleSummary([], { night: "2026-11-08", handle, hub: "h" }), null, "no battle, no post");
  assert.equal(B.mvpOf([ev("commit", D, { repo: "me/build-bot" }), ev("commit", D, { repo: "me/build-bot" }), ev("private", D, { repo: "private:ab", n: 1 })], D).repo, "build-bot");
  assert.equal(B.mvpOf([ev("private", D, { repo: "private:ab", n: 9 })], D).repo, "a private repo", "private repos stay nameless");
});

// ---------------------------------------------------------------- 5. the live hub: opt-in, peaceful zones, state, nights, opt-out, email off, unsubscribe, kill switch
async function hubWith(handles, o = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-battle-")); dirs.push(d);
  const sent = [];
  const h = createHub({ dataDir: d, publicUrl: "https://hub.test", githubFetch: async () => new Response("[]", { status: 200 }), growthPoll: false, email: { send: async m => { sent.push(m); } }, ...o });
  const base = "http://127.0.0.1:" + await h.listen(0), ids = {};
  for (const handle of handles) {
    const rr = (name, commits) => ({ name, project: "Work", public: true, language: "TypeScript", commits, weeks: [1, 2, 3], week: 3, today: 0, pushed: new Date().toISOString(), url: `https://github.com/${handle}/${name}` });
    const full = cityData([rr("app", 300)], () => ({ n: 0, paths: [] }), new Date().toISOString());
    const files = { "index.html": Buffer.from(`<html><body>${handle}</body></html>`).toString("base64"), "city.html": Buffer.from(renderCity({ name: handle, handle }, publicCity(full, ["Work"], "show"))).toString("base64") };
    const id = C.newIdentity(); ids[handle] = id;
    const r = await fetch(`${base}/v1/profiles/${id.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(id, "profile.manifest", { name: handle, handle, boxKey: id.boxPublic }), files }) });
    assert.equal(r.status, 200);
  }
  const post = (p, body, hd = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...hd }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const cookies = {};
  const cookie = async w => {
    if (cookies[w]) return cookies[w];
    const ch = (await post("/v1/auth/challenge", { id: ids[w].id })).body, tok = (await post("/v1/auth/verify", C.sign(ids[w], "message", { nonce: ch.nonce }))).body.token;
    const { body } = await post(`/v1/owner/${ids[w].id}/link`, {}, { authorization: "Bearer " + tok });
    const r = await fetch(body.url.replace("https://hub.test", base), { redirect: "manual" });
    return (cookies[w] = (r.headers.get("set-cookie") || "").split(";")[0]);
  };
  const as = async (w, p, body) => post(p, body, { cookie: await cookie(w), origin: "https://hub.test" });
  return { h, base, ids, post, as, cookie, sent };
}
/** a month of steady daily work for each member, straight into the growth log, so plots have built lots to fight over */
function work(h, ids) {
  const today = Math.floor(Date.now() / DAY), ins = h.db.prepare("INSERT OR IGNORE INTO growth_events VALUES (?,?,?,?,?,?,?,?,?)");
  for (const [handle, id] of Object.entries(ids)) for (let d = today - 40; d <= today; d++) for (let k = 0; k < 20; k++) { const t = d * DAY + 3600_000 + k * 60_000; ins.run(`c:${handle}${d}x${k}`, id.id, "commit", `${handle}/app`, t, t, 1, "", null); }
  h.admin.growth.recompute();
}

test("live: Battle is one more view (Now stays the default); opt-in only; peaceful zones; nights; opt-out rebuilds instantly; report email built but off; unsubscribe", async () => {
  delete process.env.CALDERA_BATTLE_EMAIL;
  const { h, base, ids, post, as, cookie, sent } = await hubWith(["rae", "sam", "pat"]);
  try {
    const page = await (await fetch(base + "/world")).text();
    for (const v of ["now", "day", "week", "month", "battle"]) assert.ok(page.includes(`data-gview="${v}"`), "switcher: " + v);
    assert.ok(/<button type="button" data-gview="now" aria-pressed="true">/.test(page), "Now stays the default");
    for (const l of ["damage", "attacks", "shields", "replay"]) assert.ok(page.includes(`data-bl="${l}"`), "layer toggle: " + l);
    assert.ok(page.includes("window.CALDERA_BATTLE=") && page.includes('id="b-bar"') && page.includes("window.CALDERA_BATTLE_API"), "battle state, bar and renderer layer");
    assert.ok(page.includes("'battle']") && page.includes("searchParams.get('view')"), "?view=battle is read (shareable)");

    // nobody is in the battles until they opt in
    let s = await (await fetch(base + "/v1/world/battle")).json();
    assert.equal(s.cities, 0); assert.deepEqual(s.members, {});
    assert.equal((await post("/v1/world/battle/opt", { war: true }, { origin: "https://hub.test" })).status, 401, "sign in first");
    assert.equal((await post("/v1/world/battle/opt", { war: true }, { cookie: await cookie("rae"), origin: "https://evil.test" })).status, 403, "cross-site refused");
    work(h, ids);
    for (const w of ["rae", "sam"]) { const r = await as(w, "/v1/world/battle/opt", { war: true, waive: true }); assert.equal(r.status, 200); assert.equal(r.body.war, 1); }
    s = await (await fetch(base + "/v1/world/battle")).json();
    assert.deepEqual(Object.keys(s.members).sort(), ["@rae", "@sam"], "only opted-in cities are in the battles; @pat is a peaceful zone");
    const me = (await as("rae", "/v1/world/battle/opt", {})).body;
    assert.ok(me.arsenal && me.arsenal.ammo > 0 && me.arsenal.c === 20, "tonight's arsenal from today's real commits: " + JSON.stringify(me.arsenal));
    assert.deepEqual(me.rivals.map(r => r.h), ["@sam"]);
    assert.equal((await as("rae", "/v1/world/battle/aim", { target: "@pat" })).status, 400, "a peaceful zone can't be aimed at");
    for (let i = 0; i < 3; i++) assert.equal((await as("rae", "/v1/world/battle/aim", { target: "@sam" })).status, 200);
    assert.equal((await as("rae", "/v1/world/battle/aim", { target: "@sam" })).status, 200, "aiming the same rival again is idempotent");

    // last night's battle (opt-ins backdated so they count for it)
    const B2 = h.admin.battle, n = B.lastNight(Date.now());
    for (const w of ["rae", "sam"]) B2.optIn(ids[w].id, { since: 0 });
    const meta = B2.resolve(n);
    assert.deepEqual(meta.fighters.map(f => f.h).sort(), ["rae", "sam"]);
    const shots = h.db.prepare("SELECT * FROM battle_shots WHERE night=?").all(n);
    assert.ok(shots.length > 0 && shots.every(x => x.a !== ids.pat.id && x.d !== ids.pat.id), "no shots in or out of a peaceful zone");
    assert.deepEqual(B2.resolve(n), meta, "a night resolves once");
    s = await (await fetch(base + "/v1/world/battle")).json();
    assert.ok(s.shots.length === shots.length && s.shots.every(x => ["@rae", "@sam"].includes(x[0]) && ["@rae", "@sam"].includes(x[1])));
    const hitOn = ["@rae", "@sam"].find(k => s.members[k].hits.length);
    assert.ok(hitOn, "the night left damage to see");
    const last = (await (await fetch(base + "/v1/world/battle/me", { headers: { cookie: await cookie("rae") } })).json()).last;
    assert.ok(last && last.night === new Date(n * DAY).toISOString().slice(0, 10) && typeof last.rebuilt === "number", "the morning replay data: " + JSON.stringify(last));
    // earned state untouched: the growth state is the same whether or not the battle happened
    const g = await (await fetch(base + "/v1/world/state?window=day")).json(); assert.ok(g.members[hitOn].l.includes("4") || /[4-7]/.test(g.members[hitOn].l), "the earned plot keeps its buildings");

    // leaving rebuilds instantly
    const loser = hitOn.slice(1);
    await as(loser, "/v1/world/battle/opt", { war: false });
    s = await (await fetch(base + "/v1/world/battle")).json();
    assert.ok(!s.members[hitOn], "out of the battles: no damage shows");

    // the report email: needs a confirmed email, and never sends while CALDERA_BATTLE_EMAIL is not 1
    assert.equal((await as("rae", "/v1/world/battle/report", { freq: "daily" })).status, 409, "confirm an email first");
    B2.store.setReport(ids.rae.id, "daily");
    const res = await B2.sendReports({ force: true });
    assert.equal(sent.filter(m => m.src === "battle-report").length, 0, "built but off: nothing is sent");
    assert.ok(res.out.every(x => !x.sent));
    // one-click unsubscribe (GET shows the button, POST turns it off)
    const tok = B2.store.opt(ids.rae.id).token;
    assert.ok((await (await fetch(base + "/u/battle?t=" + tok)).text()).includes("Unsubscribe"));
    assert.equal(B2.store.opt(ids.rae.id).report, "daily", "a GET (link scanner) doesn't unsubscribe");
    await fetch(base + "/u/battle?t=" + tok, { method: "POST" });
    assert.equal(B2.store.opt(ids.rae.id).report, "off");
    // erasing a member removes their battle rows
    B2.erase(ids.sam.id); assert.equal(h.db.prepare("SELECT COUNT(*) n FROM battle_shots WHERE d=?").get(ids.sam.id).n, 0);
  } finally { h.server?.close?.(); }
});

test("email on (CALDERA_BATTLE_EMAIL=1): a member with the report on and a confirmed address gets one ASCII report with one-click unsubscribe headers", async () => {
  const { h, ids, sent } = await hubWith(["ana", "bo"]);
  try {
    work(h, ids);
    const B2 = h.admin.battle, n = B.lastNight(Date.now());
    for (const w of ["ana", "bo"]) { B2.optIn(ids[w].id, { since: 0, waive: true }); }
    B2.resolve(n);
    h.db.prepare("INSERT OR REPLACE INTO email_subs (owner, email, hash, confirmed, token, created) VALUES (?,?,?,?,?,?)").run(ids.ana.id, h.admin.seal("ana@x.io"), "h", 1, "t", new Date().toISOString());
    process.env.CALDERA_BATTLE_EMAIL = "1";
    B2.store.setReport(ids.ana.id, "daily");
    const r = await B2.sendReports({ force: true });
    const mine = sent.filter(m => m.src === "battle-report");
    {
      assert.equal(mine.length, 1, JSON.stringify(r));
      assert.equal(mine[0].to, "ana@x.io"); assert.ok(/^Your city today: /.test(mine[0].subject));
      assert.ok(mine[0].headers["List-Unsubscribe"].includes("/u/battle?t=") && mine[0].headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
      assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(mine[0].text));
      await B2.sendReports(); assert.equal(sent.filter(m => m.src === "battle-report").length, 1, "one send per member per day");
    }
  } finally { delete process.env.CALDERA_BATTLE_EMAIL; h.server?.close?.(); }
});

test("kill switch: battles off shows no Battle view and no battle API", async () => {
  const { h, base } = await hubWith(["kim"], { battle: false });
  try {
    const page = await (await fetch(base + "/world")).text();
    assert.ok(!page.includes('data-gview="battle"') && !page.includes("window.CALDERA_BATTLE=") && !page.includes('id="b-bar"'));
    assert.ok(page.includes('data-gview="day"'), "the growth views stay");
    assert.equal((await fetch(base + "/v1/world/battle")).status, 404);
  } finally { h.server?.close?.(); }
});
