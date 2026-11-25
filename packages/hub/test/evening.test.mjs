// The evening turn (LOOP.md part c, c.10 tests) and the move of the battle to 20:00 PT: throughOf for each order and shield
// kind, firedOf for n = 0..6, strike back closed by lastPairs, resultOf's order of rules, the lock at 19:45 PT in summer and
// winter, the switch night (2026-11-25) fires exactly once with a work window that has no gap and no overlap, the summary open
// rule, and the Tonight routes (orders, placement, strike back, refused after the lock; orders pay points).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const load = async f => { const o = await build({ entryPoints: [new URL("../src/" + f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false }); return import("data:text/javascript;base64," + Buffer.from(o.outputFiles[0].text).toString("base64")); };
const B = await load("battle.ts"), BH = await load("battlehub.ts"), AR = await load("armory.ts"), PT = await load("points.ts"), BC = await load("battleclient.ts");
const DAY = 86_400_000, H = 3600_000, M = 60_000;
const SW = Math.floor(Date.parse("2026-11-25T00:00:00Z") / DAY);
const iso = t => new Date(t).toISOString();

// ---------------------------------------------------------------- c.2 numbers
test("throughOf: every order with no shield, 50, 95 and the beginner dome (LOOP.md c.2)", () => {
  const T = (S, o, dome = false, pl = 0) => B.throughOf(S, pl, o, dome);
  assert.deepEqual([T(0, "atk"), T(0, "bal"), T(0, "tur")], [125, 100, 80], "no shield: All-in hits do 25% more, Turtle shows a 20% shield (c.2 release check 11-24: 25 -> 20)");
  assert.deepEqual([T(50, "atk"), T(50, "bal"), T(50, "tur")], [75, 50, 30]);
  assert.deepEqual([T(95, "atk"), T(95, "bal"), T(95, "tur")], [30, 5, 3], "never over 97% shield");
  assert.deepEqual([T(99, "atk", true), T(99, "bal", true), T(99, "tur", true)], [26, 1, 1], "dome: 74% All-in, else 99%");
  assert.equal(T(95, "bal", false, B.WAR.place.focus), 3, "a guarded 95% tower caps at 97%");
  assert.equal(T(80, "bal", false, B.WAR.place.rest), 30, "the other towers lose 10 points");
  assert.equal(B.placeTerm(-1, 0), 0); assert.equal(B.placeTerm(1, 1), 20); assert.equal(B.placeTerm(1, 0), -10);
  // shieldAt: Balanced over the whole city is the earned shield exactly (old nights are unchanged)
  for (const sh of [0, 0.5, 0.73, 0.95, 0.99]) assert.equal(B.shieldAt({ sh, beg: sh === 0.99 }, 0), sh);
  assert.equal(B.shieldAt({ sh: 0, beg: false, order: "atk" }, 0), -0.25);
  assert.equal(B.shieldAt({ sh: 0.8, beg: false, order: "tur", place: 2 }, 2), 0.97);
  assert.equal(B.shieldAt({ sh: 0.8, beg: false, order: "tur", place: 2 }, 0), 0.9);
  assert.equal(B.shieldAt({ sh: 0.99, beg: true, order: "atk", place: 1 }, 1), 0.74, "the dome is never placed");
  // a negative shield makes the hit bigger, a capped one never cancels it
  const k = o => B.strike({ raw: 0.1, st: 1, cd: 1, pc: 1, sh: o, load: 0.5, sp: 0, value: 1e7 });
  assert.equal(k(-0.25).f, 0.125); assert.equal(k(0).f, 0.1); assert.ok(k(0.97).f > 0);
});

test("firedOf: Turtle keeps every third missile home (largest first), ceil(2n/3) fire; reachOf: All-in +2", () => {
  const W = ["shell", "cruise", "rocket", "tactical", "shell", "rocket"];
  for (let n = 0; n <= 6; n++) {
    const a = { shots: W.slice(0, n) };
    assert.equal(B.firedOf(a, "tur").length, Math.ceil(2 * n / 3), "n=" + n);
    assert.equal(B.firedOf(a, "bal").length, n); assert.equal(B.firedOf(a, "atk").length, n);
  }
  assert.deepEqual(B.firedOf({ shots: ["shell", "cruise", "rocket", "tactical"] }, "tur"), ["cruise", "tactical", "shell"], "sorted by size, the third stays home");
  assert.equal(B.reachOf({ reach: 5 }, "atk"), 7, "may pass reachMax by 2"); assert.equal(B.reachOf({ reach: 3 }, "tur"), 3);
});

const fighter = (id, o = {}) => ({ id, h: id, ars: { shots: o.shots || ["rocket", "rocket", "rocket", "rocket", "rocket"], usd: 1e6, ammo: 20, reach: o.reach || 3, cepX: 1, n: {} }, sh: o.sh ?? 0, beg: !!o.beg, lots: "", towers: 3, tw: [60, 50, 40], side: 3, out7: 10, heads: 1, idle: null, ...(o.order ? { order: o.order } : {}), ...(o.place != null ? { place: o.place } : {}) });

test("strike back: a 4th aimed shot at the rival, closed when the member hit that city last night (lastPairs)", () => {
  const F = () => ["a", "b", "c", "d"].map(id => fighter(id));
  const aims = new Map([["a", ["c", "c", "d"]]]), strikes = new Map([["a", "b"]]);
  const r1 = B.resolveNight({ night: SW + 3, fighters: F(), aims, strikes });
  const aimedA = r1.shots.filter(s => s.a === "a" && s.aim);
  assert.equal(aimedA.length, 4); assert.equal(aimedA.filter(s => s.d === "b").length, 1, "one shot at the rival");
  assert.equal(r1.shots.filter(s => s.a === "a").length, 5, "one of the city's own missiles, not a new one");
  const r2 = B.resolveNight({ night: SW + 3, fighters: F(), aims, strikes, lastPairs: new Set(["a>b"]) });
  assert.equal(r2.shots.filter(s => s.a === "a" && s.aim).length, 3, "closed by lastPairs");
  // rivalOf: the city that dealt the most damage last night; canStrike false when the member hit it too
  const sh = (a, d, f, u) => ({ k: 0, a, d, w: "rocket", ammo: 1, roll: 0, f, lot: 0, t: 0, aim: 0, blocked: 0, x: { u, fu: 0 } });
  const last = [sh("b", "a", 0.1, 4e6), sh("c", "a", 0.1, 1e6), sh("~raiders", "a", 0.5, 9e7)];
  assert.deepEqual(B.rivalOf("a", last), { id: "b", usd: 4e6, canStrike: true });
  assert.equal(B.rivalOf("a", [...last, sh("a", "b", 0.2, 1)]).canStrike, false);
  assert.equal(B.rivalOf("z", last), null, "no rival when nothing hit the member");
  // a night with no orders is the night it always was
  const plain = B.resolveNight({ night: SW + 4, fighters: F() }), same = B.resolveNight({ night: SW + 4, fighters: F().map(f => ({ ...f, order: "bal", place: -1 })) });
  assert.deepEqual(same.shots, plain.shots);
  const turtle = B.resolveNight({ night: SW + 4, fighters: F().map(f => f.id === "a" ? { ...f, order: "tur" } : f) });
  assert.equal(turtle.shots.filter(s => s.a === "a").length, 4, "Turtle: 4 of 5 fire");
  const atk = B.resolveNight({ night: SW + 4, fighters: [...F(), fighter("e"), fighter("f")].map(f => f.id === "a" ? { ...f, order: "atk" } : f) });
  assert.equal(new Set(atk.shots.filter(s => s.a === "a").map(s => s.d)).size, 5, "All-in: reach 3 + 2");
});

test("resultOf: FELL, then WON, then HELD, then LOST; QUIET with no shots in or out", () => {
  const sh = (a, d, u, held = 0) => ({ k: 0, a, d, w: "rocket", ammo: 1, roll: 0, f: 0.1, lot: 0, t: 0, aim: 0, blocked: 0, x: { u, fu: 0, held, pot: u + held } });
  const S = [sh("a", "b", 10), sh("b", "a", 3), sh("c", "b", 50), sh("d", "e", 1, 9), sh("e", "f", 2)];
  assert.equal(B.resultOf("b", S), "FELL", "the fallen city, even though it dealt more than ...");
  assert.equal(B.resultOf("a", S), "WON");
  assert.equal(B.resultOf("f", S), "LOST", "took 2, held 0");
  assert.equal(B.resultOf("z", S), "QUIET");
  assert.equal(B.resultOf("e", [sh("d", "e", 1, 9)]), "FELL", "the only city hit falls");
  assert.equal(B.resultOf("e", [sh("d", "e", 1, 9), sh("x", "y", 5)]), "HELD", "shield held more than got through");
});

test("rankOf, ordersFor and badgesFor (LOOP.md c.3, c.5)", () => {
  assert.deepEqual([0, 1e6, 39e6, 40e6, 6e8, 1e10].map(s => B.rankOf(s).name), ["Recruit", "Gunner", "Lieutenant", "Captain", "General", "General"]);
  const r = B.rankOf(70e6); assert.equal(r.level, 5); assert.equal(r.next, "Major"); assert.equal(r.toNext, 30e6); assert.equal(r.pct, 50);
  assert.equal(B.rankOf(7e8).toNext, null, "top rank");
  const O = B.ordersFor({ day: SW, prs14: 0, canPlace: false, battled: false });
  assert.deepEqual(O.map(o => o.text + " +" + o.points), ["Push one counted commit +20", O[1].text + " +10", "Open the season ranking +10"]);
  const days = [0, 1, 2].map(k => B.ordersFor({ day: SW + k, prs14: 2, canPlace: true, battled: true })[1].key);
  assert.deepEqual([...days].sort(), ["fight:aim", "fight:orders", "fight:place"], "Fight changes by day");
  for (let k = 0; k < 3; k++) assert.notEqual(B.ordersFor({ day: SW + k, prs14: 1, canPlace: false, battled: true })[1].key, "fight:place", "no shield: never the placement order");
  assert.equal(B.ordersFor({ day: SW, prs14: 1, canPlace: true, battled: true })[0].text, "Merge a pull request");
  const N = (night, res, out = 1) => ({ night, res, out });
  const b = B.badgesFor({ nights: [N(1, "LOST"), ...[2, 3, 4, 5, 6, 7, 8].map(n => N(n, n === 4 ? "WON" : "LOST")), N(9, "HELD", 0)], finals: [{ season: 1, rank: 2 }], founding: true });
  assert.deepEqual(b.map(x => x.name), ["First win", "7-night streak", "Shield held", "Season 1 podium", "Founding Fleet"]);
  assert.deepEqual(B.badgesFor({ nights: [1, 2, 3, 5, 6, 7, 8].map(n => N(n, "LOST")) }).map(x => x.name), [], "a gap breaks the streak");
});

// ---------------------------------------------------------------- the hour
test("the battle at 20:00 PT and the lock at 19:45 PT, in winter and in summer", () => {
  assert.equal(B.WAR.hourUtc, 4);
  const winter = Math.floor(Date.parse("2026-12-10T00:00:00Z") / DAY), summer = Math.floor(Date.parse("2027-07-10T00:00:00Z") / DAY);
  assert.equal(iso(B.battleAt(winter)), "2026-12-10T04:00:00.000Z", "20:00 PST on 12-09");
  assert.equal(iso(B.lockAt(winter)), "2026-12-10T03:45:00.000Z", "19:45 PST");
  assert.equal(iso(B.battleAt(summer)), "2027-07-10T03:00:00.000Z", "20:00 PDT on 07-09");
  assert.equal(iso(B.lockAt(summer)), "2027-07-10T02:45:00.000Z", "19:45 PDT");
  const spring = Math.floor(Date.parse("2027-03-15T00:00:00Z") / DAY);   // DST starts 2027-03-14
  assert.equal(iso(B.battleAt(spring)), "2027-03-15T03:00:00.000Z");
  assert.equal(iso(B.battleAt(SW - 1)), "2026-11-24T10:00:00.000Z", "nights before the switch keep 10:00 UTC");
  assert.equal(iso(B.battleAt(SW)), "2026-11-25T04:00:00.000Z", "the switch night: 20:00 PST on 11-24");
  // the Armory locks with the defenses; buying is refused from the lock until the battle
  const w = AR.armoryNow(B.lockAt(winter) - 1); assert.equal(w.state, "open"); assert.equal(w.lock, B.lockAt(winter));
  assert.equal(AR.armoryNow(B.lockAt(winter)).state, "locked"); assert.equal(AR.armoryNow(B.battleAt(winter)).night, winter + 1);
  // Pacific alerts: the open alert falls back to 8 AM (6 PM is under 4 hours before the lock), the reminder 1 hour before the lock
  assert.equal(iso(AR.openAlertAt(winter, "America/Los_Angeles")), "2026-12-09T16:00:00.000Z", "08:00 PST");
  assert.equal(iso(AR.remindAt(winter, "America/Los_Angeles")), "2026-12-10T02:45:00.000Z", "18:45 PST");
  assert.equal(iso(AR.openAlertAt(winter, "Europe/Berlin")), "2026-12-09T17:00:00.000Z", "18:00 CET");
  // points: the spend day turns with the battle
  assert.equal(PT.spendDayOf(B.battleAt(winter) - 1), winter - 1); assert.equal(PT.spendDayOf(B.battleAt(winter)), winter);
  assert.equal(PT.spendDayOf(B.battleAt(summer)), summer);
});

test("the switch night: lastNight turns exactly at each battle and no night is skipped or doubled", () => {
  let prev = B.lastNight(Date.parse("2026-11-23T12:00:00Z")), turns = [];
  for (let t = Date.parse("2026-11-23T12:00:00Z"); t <= Date.parse("2026-11-27T12:00:00Z"); t += M) {
    const n = B.lastNight(t); if (n !== prev) { assert.equal(n, prev + 1, "one night at a time at " + iso(t)); turns.push([n, t]); prev = n; }
  }
  assert.deepEqual(turns.map(([n, t]) => [n - SW, iso(t)]), [[-1, "2026-11-24T10:00:00.000Z"], [0, "2026-11-25T04:00:00.000Z"], [1, "2026-11-26T04:00:00.000Z"], [2, "2026-11-27T04:00:00.000Z"]]);
});

test("the work window: every minute counts for exactly one night; the switch night spends 11-24 00:00 UTC to its 19:45 PT lock", () => {
  const span = new Map();
  for (let t = Date.parse("2026-11-22T00:00:00Z"); t < Date.parse("2026-11-28T00:00:00Z"); t += M) {
    const night = B.bdOf(t) + 1, s = span.get(night) || { from: t, to: t };
    assert.ok(!span.size || night >= Math.max(...span.keys()), "the night only moves forward at " + iso(t));
    s.to = t; span.set(night, s);
  }
  const at = n => span.get(n);
  assert.equal(iso(at(SW - 1).from), "2026-11-23T00:00:00.000Z"); assert.equal(iso(at(SW - 1).to), "2026-11-23T23:59:00.000Z", "the 10:00 UTC night of 11-24: UTC day 11-23");
  assert.equal(iso(at(SW).from), "2026-11-24T00:00:00.000Z"); assert.equal(iso(at(SW).to), "2026-11-25T03:44:00.000Z", "the switch night: to 19:44 PST");
  assert.equal(iso(at(SW + 1).from), "2026-11-25T03:45:00.000Z", "work after the lock counts for tomorrow's battle");
  assert.equal(iso(at(SW + 1).to), "2026-11-26T03:44:00.000Z");
  // the arsenal reads the same window
  const ev = (iso2, n = 1) => { const t = Date.parse(iso2); return { id: "c:" + iso2, p: "a", k: "commit", repo: "me/app", ts: t, seen: t, n, v: "" }; };
  const E = [ev("2026-11-23T23:00:00Z", 1), ev("2026-11-24T05:00:00Z", 2), ev("2026-11-25T03:40:00Z", 4), ev("2026-11-25T03:50:00Z", 8)];
  const c = night => B.arsenal(E, night - 1, { dayOf: B.bdOf }).c;
  assert.deepEqual([c(SW - 1), c(SW), c(SW + 1)], [1, 6, 8]);
});

/** a battle hub on an in-memory database with a fake clock and 3 members with work every hour */
function hubAt(t0) {
  const db = new DatabaseSync(":memory:"), q = sql => db.prepare(sql), clock = { t: t0 }, ticks = [], nights = [];
  const ids = ["a", "b", "c"], E = [];
  for (const p of ids) for (let t = Date.parse("2026-11-20T00:00:00Z"); t < Date.parse("2026-11-28T00:00:00Z"); t += H) E.push({ id: `c:${p}${t}`, p, k: "commit", repo: p + "/app", ts: t, seen: t, n: 1, v: "" });
  const members = ids.map((id, i) => ({ id, handle: id + "x", name: id, created: Date.parse("2026-09-01T00:00:00Z"), login: id, city: { districts: [{ repos: [{ name: id + "/app", commits: 400 - i * 50, week: 3 }, { name: id + "/web", commits: 120, week: 1 }, { name: id + "/cli", commits: 60, week: 1 }] }] } }));
  const stats = Array.from({ length: 120 }, (_, k) => ({ d: SW - 100 + k, pts: 5, c: 5, pr: 0, rel: 0, st: 0, z: 0, top: 1, up: 0, ring: 0, ai: 0, nc: 0 }));
  const sim = p => ({ side: 4, lots: "4444", bank: 0, streak: p === "a" ? 20 : 3, tier: 0, idle: null, stats, snaps: new Map() });
  const P = PT.pointsStore(q, { now: () => clock.t, seasonOf: n => ({ n: 1, from: SW - 20 }) });
  const res = () => { const r = { status: 0, body: null }; return r; };
  const hub = BH.battleHub({ q, hub: "https://hub.test", postal: "x", now: () => clock.t,
    growth: { sim: () => ({ sims: new Map(ids.map(p => [p, sim(p)])), events: E.filter(e => e.ts <= clock.t), ai: new Map() }), onTick: fn => ticks.push(fn) },
    members: () => members, memberOf: req => req.who || null, sameOrigin: () => true, readBody: async req => req.body || {},
    json: (r, s, b) => { r.status = s; r.body = b; }, page: (t, h) => h, emailOf: () => null, send: async () => true, emailOn: () => false,
    onNight: n => nights.push([n, clock.t]), points: () => P });
  hub.store.setMeta("launch", String(SW - 20));
  const call = async (who, path, body) => { const r = res(); await hub.route({ method: "POST", who, body }, r, path, new URL("https://hub.test" + path)); return r; };
  return { hub, clock, ticks, nights, call, P, db };
}

test("the switch night fires exactly once; the tick resolves each night once, right after 20:00 PT", async () => {
  const { hub, clock, ticks, nights } = hubAt(Date.parse("2026-11-24T09:00:00Z"));
  const log = console.log; console.log = () => {};
  try {
    for (; clock.t <= Date.parse("2026-11-26T06:00:00Z"); clock.t += 15 * M) for (const fn of ticks) await fn();
  } finally { console.log = log; }
  assert.deepEqual(nights.map(([n, t]) => [n - SW, iso(t)]), [[-1, "2026-11-24T10:00:00.000Z"], [0, "2026-11-25T04:00:00.000Z"], [1, "2026-11-26T04:00:00.000Z"]], "one resolve per night, at its battle time");
  // the switch night spent [11-24 00:00 UTC, 11-25 03:45 UTC): 27 hours and 45 minutes of hourly commits (28 events)
  const meta = hub.store.night(SW), m = meta.fighters.find(f => f.id === "a");
  assert.equal(m.c, 28); assert.equal(hub.store.night(SW + 1).fighters.find(f => f.id === "a").c, 24, "a normal day: 24 hourly commits");
  assert.equal(hub.store.night(SW - 1).fighters.find(f => f.id === "a").c, 24, "the 10:00 UTC night of 11-24 spent UTC day 11-23");
});

test("Tonight routes: orders, placement and strike back save until 19:45 PT, then refuse with locked; orders pay points", async () => {
  const { hub, clock, ticks, call, P } = hubAt(Date.parse("2026-11-26T05:00:00Z"));
  const log = console.log; console.log = () => {};
  try {
    for (const fn of ticks) await fn();   // night SW+1 resolves (the tick ran late; still inside 20 hours)
    clock.t = Date.parse("2026-11-26T18:00:00Z");   // 10:00 PST, the turn for night SW+2
    const me0 = hub.me("a"); assert.ok(me0.tonight && !me0.tonight.locked && me0.tonight.order === "bal", JSON.stringify(me0.tonight));
    assert.equal(me0.tonight.towers.length, 3); assert.equal(me0.tonight.towers[0].name, "app");
    assert.equal(me0.tonight.lockAt, B.lockAt(SW + 2)); assert.equal(iso(me0.tonight.lockAt), "2026-11-27T03:45:00.000Z");
    assert.equal(me0.orders.length, 3); assert.equal(me0.rank.name, me0.rank.name && B.rankOf(me0.rank.score).name);
    let r = await call("a", "/v1/world/battle/tonight", { order: "tur" }); assert.equal(r.status, 200); assert.equal(r.body.tonight.order, "tur");
    assert.equal(r.body.tonight.work.fired, Math.ceil(2 * r.body.tonight.work.missiles / 3));
    r = await call("a", "/v1/world/battle/tonight", { order: "nope" }); assert.equal(r.status, 400);
    r = await call("a", "/v1/world/battle/tonight", { place: 1 }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.tonight.place, 1);
    assert.deepEqual(r.body.tonight.through, [Math.round(100 * B.shieldAt({ sh: hub.me("a").shield, beg: false, order: "tur", place: 1 }, 0)), 97, Math.round(100 * B.shieldAt({ sh: hub.me("a").shield, beg: false, order: "tur", place: 1 }, 2))]);
    r = await call("b", "/v1/world/battle/tonight", { place: 0 }); assert.equal(r.status, 409, "no streak shield: nothing to place");
    const riv = B.rivalOf("a", hub.store.shots(SW + 1));
    r = await call("a", "/v1/world/battle/tonight", { strike: true });
    if (riv && riv.canStrike) { assert.equal(r.status, 200); assert.equal(r.body.tonight.strike, true); } else assert.equal(r.status, 409);
    // the Fight order of the day paid if it was the orders or the placement; points show in me
    const day = SW + 1, fight = B.ordersFor({ day, prs14: 0, canPlace: true, battled: true })[1];
    if (fight.key !== "fight:aim") assert.equal(P.hasOrder("a", day, "fight"), true, "Fight paid by the server");
    r = await call("a", "/v1/world/battle/order-done", { kind: "scout" }); assert.equal(r.status, 200); assert.equal(r.body.paid, true);
    r = await call("a", "/v1/world/battle/order-done", { kind: "build" }); assert.equal(r.status, 400, "Build and Fight are set by the server");
    assert.ok(hub.me("a").orders.find(o => o.kind === "scout").done);
    // the lock
    clock.t = B.lockAt(SW + 2);
    r = await call("a", "/v1/world/battle/tonight", { order: "atk" }); assert.equal(r.status, 409); assert.equal(r.body.error, "locked");
    r = await call("a", "/v1/world/battle/aim", { target: "@bx" }); assert.equal(r.status, 409); assert.equal(r.body.error, "locked");
    assert.equal(hub.me("a").tonight.locked, true);
    // the night uses the order and the placement; the next turn is Balanced again, the placement stays
    clock.t = B.battleAt(SW + 2) + M; for (const fn of ticks) await fn();
    const f = hub.store.night(SW + 2).fighters.find(x => x.id === "a"); assert.equal(f.o, "tur"); assert.equal(f.pl, 1);
    const me2 = hub.me("a"); assert.equal(me2.tonight.order, "bal"); assert.equal(me2.tonight.place, 1);
    // the summary card: seen one time a day on every device
    assert.equal(me2.last.seen, 0); r = await call("a", "/v1/world/battle/seen", { date: me2.last.key }); assert.equal(r.status, 200); assert.equal(hub.me("a").last.seen, 1);
  } finally { console.log = log; }
});

test("the summary open rule (LOOP.md c.10): once a day, never during a replay, a battle or for a visitor", () => {
  const L = BC.eveningLib ? (0, eval)("(" + BC.eveningLib + ")()") : null;
  assert.ok(L, "eveningLib is exported as source");
  const me = { h: "@a", war: 1, last: { seen: 0, res: "WON", key: "2026-11-26" } }, ok = o => L.summaryOpen({ me, replay: false, board: false, running: false, search: "", ...o });
  assert.equal(ok({}), true);
  assert.equal(ok({ me: { ...me, last: { ...me.last, seen: 1 } } }), false, "seen today");
  assert.equal(ok({ replay: true }), false); assert.equal(ok({ board: true }), false); assert.equal(ok({ running: true }), false);
  assert.equal(ok({ search: "?view=battle&replay=1" }), false, "a replay link");
  assert.equal(ok({ me: null }), false, "signed out"); assert.equal(ok({ me: { h: "@a", war: 1, last: null } }), false, "no night");
  assert.equal(ok({ me: { ...me, last: { ...me.last, res: "QUIET" } } }), true, "a quiet night still opens (its own words)");
  assert.equal(ok({ search: "?summary=1", me: { ...me, last: { ...me.last, seen: 1 } } }), true, "summary=1 opens it again");
});

test("the Tonight card's words: the lock line in PT (and the viewer's clock), the work line, the result words", () => {
  const L = (0, eval)("(" + BC.eveningLib + ")()"), lk = Date.parse("2026-12-10T03:45:00Z"), st = Date.parse("2026-12-10T04:00:00Z");
  const open = L.tnSub({ now: lk - 5 * H, lockAt: lk, startAt: st });
  assert.match(open[0], /^Defenses lock at 19:45 PT( \(\d\d:\d\d your time\))?\. Your city fires by itself at 20:00 PT\.$/); assert.equal(open[1], "");
  assert.deepEqual(L.tnSub({ now: lk - 37 * M, lockAt: lk, startAt: st }), ["Last hour. Defenses lock in 37m, at 19:45 PT.", "hot"]);
  assert.deepEqual(L.tnSub({ now: lk + M, lockAt: lk, startAt: st }), ["Locked at 19:45 PT. Your city fires by itself at 20:00 PT.", ""]);
  assert.deepEqual(L.tnSub({ now: st + M, lockAt: lk, startAt: st }), ["The replay opens when the battle ends.", ""]);
  const sl = Date.parse("2027-07-10T02:45:00Z"); assert.equal(L.ptClock(sl), "19:45", "summer time too");
  assert.equal(L.workWords({ commits: 6, prs: 1, releases: 0, ci: 0 }), "6 commits, 1 merged PR"); assert.equal(L.workWords({ commits: 1, prs: 2, releases: 1, ci: 1 }), "1 commit, 2 merged PRs, 1 release, green CI");
  assert.deepEqual(["WON", "HELD", "LOST", "FELL", "QUIET"].map(L.resCard), ["Your city won", "Your shield held", "Your city lost", "Your city fell", "Quiet night for your city"]);
  assert.deepEqual(L.resBig("QUIET"), ["quiet", "Quiet", "night"]); assert.deepEqual([3, -6, 0].map(L.moveWords), ["up 3", "down 6", "no change"]);
  // the page script parses and carries the design's words; the CSS has the new classes
  const js = BC.BATTLE_CLIENT_JS, n = t => String(t).replace(/\\'/g, "'").replace(/"/g, "'"); new Function(js);
  for (const t of ["Your work today", "No counted work yet today = <b>0 missiles</b>", "Work you push now counts for tomorrow's battle.", "turtle: 1 in 3 stays home", " aimed, rest auto", "Missiles aim at your three tallest towers. Cover all of them, or guard one harder.",
    "Your beginner dome covers every tower. You can place a shield when the dome ends.", "No shield yet. A 7-day streak raises one. You are at ", "Aim up to ", " shots. The rest pick a fair rival by themselves. You reach ", "You have no missiles yet. Your aims stay ready for the work you push.",
    "Strike back = 1 extra aimed shot at your rival.", "Strike back set", ". The strike back does not use your ", " aimed here.", "Remove the strike back at ", " last night. No city is hit by the same rival two nights in a row.", "Pick one. Rivals see your orders only in the replay.", "Reach 2 more rivals", "25 points more of every hit gets through",
    "Your reach and your shield as you earned them", "20 points less of every hit gets through", "1 missile in 3 stays home and is not kept", "You can change all of this until ", "Armory: add a bomb", "You can set the next night after this battle.", "Not saved. Try again.",
    "Today's orders", " of 3 done", "New orders at 20:00 PT. Orders pay Caldera Points. Points buy promotion for your project and have no cash value.", " earned", "Back to my city", "Cranes rebuild your towers. Whole by noon.", "Rank up: ", " of 8. Your season score passed ",
    "New badge: ", " is your rival tonight", "Caldera Points", "Set tonight's defenses", "Watch the replay", "Share my city's night", "You see this one time a day. It is always in the 'Last night' card.", "No missiles in or out. Your city fired nothing because no work counted that day.",
    "The link opens the replay at your city. The picture shows on X, LinkedIn, Slack and Discord.", "Save story size (9:16)", "Save picture", "Your summary", " cities fought, ", " missiles hit, ", "The top three at the end of the season keep a season badge.", " more season score for ", "Top rank of the season.", "A badge never changes a score.", "/points"])
    assert.ok(n(js).includes(n(t)), "copy: " + t);
  assert.ok(!/2am|in the morning replay|ready in the morning/.test(js), "no 2am words");
  for (const c of [".b-rank{", ".b-pts b{", ".b-work{", ".b-steps{", ".b-step{", ".b-opt{", ".b-sh{", ".b-all,", ".b-twr{", ".b-step>p.b-fact{", ".b-rvs{", ".b-rvs .b-rv{", ".b-stp{", ".b-aim{", ".b-lk{", ".b-fb{", ".b-foot{", ".b-lock{", ".b-orow{", ".b-lvl{", ".b-bdgs{", ".b-bdg{", ".b-pod{", ".b-row3{", ".b-sum{", ".b-sum-in{", ".b-x{", ".b-res{", ".b-f3{", ".b-up{", ".b-plist{", ".b-story{"])
    assert.ok(BC.BATTLE_CSS.includes(c), c);
  assert.ok(/\.b-sum\{[^}]*position:fixed;inset:0/.test(BC.BATTLE_CSS), "the summary is opaque and fixed over the page");
  const mk = BC.battleMarkup(); assert.ok(mk.includes('data-b="orders"') && mk.includes('data-b="seasonhead"'));
});

test("standing: the rank name and the badges for the leaderboard row and the profile head (c.5); Founding Fleet stays the Orpheus badge", async () => {
  const L = await load("leaderboard.ts");
  const { hub, clock, ticks } = hubAt(Date.parse("2026-11-24T09:00:00Z"));
  const log = console.log; console.log = () => {};
  try { for (; clock.t <= Date.parse("2026-11-26T06:00:00Z"); clock.t += 15 * M) for (const fn of ticks) await fn(); } finally { console.log = log; }
  const st = hub.standing("a"), me = hub.me("a");
  assert.ok(st, "a member in the battles has a standing"); assert.equal(st.rank, me.rank.name); assert.equal(st.level, me.rank.level);
  assert.ok(Array.isArray(st.badges)); assert.equal(hub.standing("nobody"), null, "outside the battles: nothing");
  const sx = { rank: "Captain", level: 5, badges: [{ k: "win", name: "First win" }, { k: "founding", name: "Founding Fleet", gold: 1 }] };
  const row = { rank: 1, id: "a", handle: "ax", name: "a", avatar: null, url: "/@ax/city.html", metric: 3, prev: 0, trend: null, active: 1, tier: 1, tierName: "Camp", battle: { in: true, ammo: 1, hits: 0, usd: 0 } };
  const o = { win: "week", me: null, hub: "https://caldera.social", nav: "", pToday: 20000, at: Date.now() };
  const html = L.leaderboardPage([row], { ...o, standing: () => sx });
  assert.match(html, /<span class="lb-rk">Captain<\/span><span class="lb-bd"><svg[^]*?<\/svg>First win<\/span><\/span>/);
  assert.doesNotMatch(html, /lb-bd gold/, "Founding Fleet is not shown twice");
  assert.doesNotMatch(L.leaderboardPage([row], { ...o, standing: () => null }), /class="lb-st"/);
  assert.doesNotMatch(L.leaderboardPage([row], { ...o, standing: () => { throw new Error("x"); } }), /class="lb-st"/, "a fault never breaks the page");
  const ph = L.profileStanding(sx); assert.match(ph, /data-tie="battle-rank"/); assert.match(ph, />Captain<\/span>/); assert.match(ph, /First win<\/span>/); assert.doesNotMatch(ph, /class=/);
});

test("orderCheck (c.2 release check): runs the resolved nights again per order, dry; counts each member's best order", async () => {
  const { hub, clock, ticks, db } = hubAt(Date.parse("2026-11-24T09:00:00Z"));
  const log = console.log; console.log = () => {};
  try { for (; clock.t <= Date.parse("2026-11-27T06:00:00Z"); clock.t += 15 * M) for (const fn of ticks) await fn(); } finally { console.log = log; }
  const before = db.prepare("SELECT COUNT(*) n FROM battle_shots").get().n, r = hub.orderCheck(14);
  assert.deepEqual(r.nights.map(n => n - SW), [-1, 0, 1, 2]); assert.equal(r.members, 3);
  assert.equal(r.best.atk + r.best.bal + r.best.tur + r.best.same, 3); assert.equal(r.ok, r.share.atk <= .5 && r.share.bal <= .5 && r.share.tur <= .5);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM battle_shots").get().n, before, "writes nothing");
});
