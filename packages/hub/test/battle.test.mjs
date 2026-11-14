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

// ---------------------------------------------------------------- 1. the arsenal: a budget, no ceiling
test("arsenal(day): points = sum over repos (commits + 3 PRs + 8 releases + 2 ci_green) x ai_mult x streak_mult, $50,000 a point, no cap", () => {
  const base = [...many("commit", D, 5), ev("pr", D), ev("release", D), ev("ci_green", D)];
  const a = B.arsenal(base, D);
  near(a.ammo, 5 + 3 + 8 + 2); assert.equal(a.c, 5); assert.equal(a.pr, 1); assert.equal(a.rel, 1); assert.equal(a.ci, 1);
  assert.equal(a.usd, 18 * 50_000, "a commit is $50k of munitions, a PR $150k, a release $400k, a green CI run $100k");
  near(B.arsenal(base, D, { ai: new Map([["me/app", 1]]) }).ammo, 18 * 1.3, 0.05);
  near(B.arsenal(base, D, { ai: new Map([["me/app", 9]]) }).ammo, 18 * 1.6, 0.05);
  near(B.arsenal(base, D, { streak: 7 }).ammo, 18 * 1.1, 0.05);
  near(B.arsenal(base, D, { streak: 30 }).ammo, 18 * 1.5, 0.05);
  // AI weighting is per repo: only the AI repo's output is multiplied
  const two = [...many("commit", D, 10, { repo: "me/llm" }), ...many("commit", D, 10, { repo: "me/site" })];
  near(B.arsenal(two, D, { ai: new Map([["me/llm", 3]]) }).ammo, 10 * 1.5 + 10, 0.05);
  // Mike 11-13: "Why are you capping the commits at 40? ... let them have lots of ammunition": no commit cap, no ammo cap
  const big = B.arsenal(many("commit", D, 400), D);
  assert.equal(big.c, 400); assert.equal(big.ammo, 400); assert.equal(big.usd, 20_000_000); assert.equal(big.shots.length, 200, "400 commits buy 200 shells on a plot with no tall building");
  const twice = B.arsenal(many("commit", D, 800), D);
  assert.equal(twice.shots.length, 2 * big.shots.length, "twice the commits, twice the missiles: no diminishing returns in the budget");
  assert.equal(B.arsenal([...many("commit", D, 40), ...many("release", D, 6)], D, { streak: 40 }).ammo, 132, "(40 + 48) x 1.5, where the old rules stopped at 60");
});

test("anti-gaming: only today's judged human work loads the guns; empty, bot, fork, revert, prerelease earn nothing", () => {
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

test("weapon sizes: shell S, rocket M, tactical L, cruise XL; the budget buys the heaviest unlocked size first; unlocks come from the tallest building, releases, green CI, streak, AI and PRs", () => {
  assert.deepEqual(B.WAR.weapons.map(w => [w.k, w.size, w.cost, w.tnt]), [["cruise", "XL", 2_000_000, 450], ["tactical", "L", 1_000_000, 150], ["rocket", "M", 200_000, 25], ["shell", "S", 100_000, 5]]);
  assert.deepEqual([3, 2, 1, 0].map(B.bestWeapon), ["cruise", "tactical", "rocket", "shell"]);
  assert.deepEqual(B.shotsFor(3_300_000, "cruise"), ["cruise", "tactical", "rocket", "shell"], "heaviest first, the change steps down");
  assert.deepEqual(B.shotsFor(3_300_000, "rocket").length, 17, "a city without the tech buys 16 rockets and a shell with the same money");
  assert.deepEqual(B.shotsFor(99_999, "cruise"), [], "under a shell's price: nothing");
  // tech: the tallest building sets the base (plot lot or repo tower), a release in 30 days and a green CI run today each add one
  assert.equal(B.techOf({ lots: "4444" }).tech, 0); assert.equal(B.techOf({ lots: "5444" }).tech, 1); assert.equal(B.techOf({ lots: "6" }).tech, 2); assert.equal(B.techOf({ lots: "7" }).tech, 3);
  assert.equal(B.techOf({ lots: "4", top: 120 }).tech, 3, "a 120 px concrete repo tower is as good as a campus lot");
  assert.equal(B.techOf({ lots: "4", top: 50 }).tech, 1);
  assert.deepEqual(B.techOf({ lots: "5", rel30: true, ci: true }), { tech: 3, base: 1, rel: 1, ci: 1 });
  assert.equal(B.techOf({ lots: "7", rel30: true, ci: true }).tech, 3, "never above cruise");
  const day = many("commit", D, 60);
  assert.equal(B.arsenal(day, D, { lots: "4" }).best, "shell");
  assert.equal(B.arsenal([...day, ev("ci_green", D)], D, { lots: "4" }).best, "rocket", "tested code moves up a size");
  assert.equal(B.arsenal([...day, ev("ci_green", D), ev("release", D - 20)], D, { lots: "4" }).best, "tactical", "a release in the last 30 days moves up another");
  assert.equal(B.arsenal([...day, ev("release", D - 31)], D, { lots: "4" }).best, "shell", "an older release doesn't");
  const a = B.arsenal([...day, ev("ci_green", D), ev("release", D - 20)], D, { lots: "4" });
  assert.deepEqual(a.n, { shell: 1, rocket: 0, tactical: 3, cruise: 0 }, "62 points = $3.1M: three tactical missiles and a shell with the change"); assert.equal(a.left, 0);
  // guidance by streak, targeting by AI, reach by PRs
  assert.equal(B.arsenal(day, D).cepX, 1); assert.equal(B.arsenal(day, D).guide, "Inertial");
  assert.equal(B.arsenal(day, D, { streak: 7 }).cepX, 0.5); assert.equal(B.arsenal(day, D, { streak: 30 }).guide, "Terminal seeker");
  near(B.arsenal(day, D, { streak: 30, ai: new Map([["me/app", 9]]) }).cepX, 0.25 / 1.6, 1e-3);
  assert.equal(B.arsenal(day, D).reach, 3); assert.equal(B.arsenal([...day, ev("pr", D)], D).reach, 4); assert.equal(B.arsenal([...day, ...many("pr", D, 6)], D).reach, 5);
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

// ---------------------------------------------------------------- 2. buildings and blast physics
test("buildings: construction by height, value = floors x 400 m2 x $/m2", () => {
  assert.deepEqual(B.WAR.classes.map(c => [c.k, c.kpa, c.sqm]), [["timber", 35, 2000], ["masonry", 50, 3000], ["steel", 70, 4000], ["concrete", 140, 6000]]);
  assert.deepEqual([20, 34, 35, 60, 61, 100, 101, 124].map(h => B.towerOf(h).c), [0, 0, 1, 1, 2, 2, 3, 3]);
  const t = B.towerOf(120); assert.equal(t.floors, 30); assert.equal(t.value, 30 * 400 * 6000); assert.equal(t.vol, 400 * 30 * 3.5);
  assert.equal(B.towerOf(20).value, 5 * 400 * 2000, "a 5-floor timber block: $4M");
  assert.equal(B.towerH(0), 14); assert.equal(B.towerH(8), 34); assert.equal(B.towerH(1e9), 124, "the world map's own heights");
  assert.deepEqual(B.towersOf([{ commits: 8 }, { commits: 500 }, { commits: 0, kind: "app" }, { commits: 56 }]), [B.towerH(500), B.towerH(56), B.towerH(8)], "tallest first, storefronts are not targets");
});

test("blast: overpressure falls with scaled distance (Hopkinson-Cranz, Mills 1987); bigger warheads and softer buildings mean more damage; a miss does less but never nothing", () => {
  near(B.overpressure(1), 1766, 1); near(B.overpressure(3), 1772 / 27 - 114 / 9 + 36, 1e-9); assert.ok(B.overpressure(2) > B.overpressure(4) && B.overpressure(4) > B.overpressure(8));
  for (const kpa of [35, 50, 70, 140]) near(B.overpressure(B.scaledDistance(kpa)), kpa, 1e-6);
  // cube-root scaling: 8 times the TNT doubles the radius
  near(B.blastRadius(200, 70) / B.blastRadius(25, 70), 2, 1e-9);
  assert.ok(B.blastRadius(25, 35) > B.blastRadius(25, 140), "timber is wrecked farther out than concrete");
  const tower = B.towerOf(120), house = B.towerOf(20), raw = (w, t, miss = 0) => B.blast(B.weaponOf(w).tnt, t, miss).raw;
  const d = ["shell", "rocket", "tactical", "cruise"].map(w => raw(w, tower));
  assert.ok(d[0] < d[1] && d[1] < d[2] && d[2] < d[3], "S < M < L < XL on the same tower: " + d.map(x => x.toFixed(4)));
  near(d[2] / d[1], 6, 1e-6); near(d[3] / d[2], 3, 1e-6); assert.equal(d[0], 0.005, "a shell on a concrete tower: the facade floor, half a percent");   // a direct hit wrecks a half sphere: volume goes with the TNT
  near(d[3], 2 / 3 * Math.PI * B.blastRadius(450, 140) ** 3 / tower.vol, 1e-9);
  assert.ok(raw("shell", house) > 10 * raw("shell", tower), "the same shell does far more to a timber block");
  assert.equal(raw("cruise", house), 1, "a cruise missile levels it (and no more than that: overkill buys nothing)");
  // misses: inside 10 m it still hits the building; past the wall the damage falls off; far out only glass and cladding
  assert.equal(raw("rocket", tower, 9), raw("rocket", tower, 0));
  const m = [0, 12, 14, 16, 30, 80].map(x => raw("rocket", tower, x));
  for (let i = 1; i < m.length; i++) assert.ok(m[i] <= m[i - 1] && m[i] > 0, "falls with the miss distance, never zero: " + m.map(x => x.toExponential(2)));
  assert.ok(m[5] > 0 && m[5] < 0.005 && m[4] <= 0.005, "a far miss breaks glass only");
  // CEP: half the shots land inside it
  near(B.missOf(10, 0.5), 10, 1e-9); assert.equal(B.missOf(10, 0), 0); assert.ok(B.missOf(10, 0.99) > 25);
  // fire: exponential burn-down, time constant 1 hour
  near(B.burnt(1, 0, 3600_000), 1 - 1 / Math.E, 1e-9); assert.ok(B.burnt(1, 0, 4 * 3600_000) > 0.98); assert.equal(B.burnt(1, 0, 0), 0);
});

// ---------------------------------------------------------------- 3. battle resolution
const ARS = (usd, best = "rocket", o = {}) => ({ ammo: usd / 50_000, usd, shots: B.shotsFor(usd, best), best, cepX: o.cepX ?? 1, reach: o.reach ?? 3 });
const F = (id, o = {}) => ({ id, h: id, towers: o.towers ?? 3, tw: o.tw, ars: ARS(o.usd ?? 3_000_000, o.best, o), sh: o.sh ?? 0, beg: !!o.beg, lots: o.lots || "5555444400000000", side: o.side || 4, out7: o.out7 ?? 100, heads: o.heads || 1, idle: o.idle ?? 0 });

test("resolution: deterministic; every missile that lands does damage (no zero-damage hits), in dollars, with a fire", () => {
  const fs2 = [F("a"), F("b"), F("c", { usd: 500_000 })];
  const r1 = B.resolveNight({ night: D, fighters: fs2 }), r2 = B.resolveNight({ night: D, fighters: fs2 });
  assert.deepEqual(r1, r2, "same night in, same battle out");
  assert.ok(r1.shots.length > 0 && r1.shots.every(s => ["a", "b", "c"].includes(s.a) && ["a", "b", "c"].includes(s.d)), "nobody outside the fighters is ever in a shot");
  assert.ok(new Set(r1.shots.map(s => s.x.m)).size > 3, "the miss distances vary");
  for (const s of r1.shots) {
    assert.ok(s.t >= B.battleAt(D) && s.t < B.battleAt(D) + 41 * 60_000, "shots between 02:00 and 02:40 Pacific");
    assert.ok(s.lot >= 0 && s.lot < fs2.find(f => f.id === s.d).towers, "hits land on one of the defender's buildings");
    assert.ok(s.f >= 0.001 && s.x.u > 0 && s.x.fi > 0 && s.x.fu > 0, "Mike 11-13: every missile needs to create damage, and sets the building burning: " + JSON.stringify(s));
    assert.equal(s.x.u, Math.round(s.f * s.x.v)); assert.equal(B.usdOf(s), s.x.u + s.x.fu);
  }
  assert.notDeepEqual(B.resolveNight({ night: D + 1, fighters: fs2 }).shots.map(s => s.x.m), r1.shots.map(s => s.x.m), "another night, other dice");
});

test("no caps that zero a shot: a city under very heavy fire, with a full week behind it and wrecked towers, still takes visible damage from every hit; more budget always means more damage", () => {
  const open = new Map([["b", new Map([[0, 0.99], [1, 0.99], [2, 0.99]])]]);
  const r = B.resolveNight({ night: D, fighters: [F("a", { usd: 40_000_000 }), F("b", { usd: 0 })], week: new Map([["b", 50]]), open });
  const onB = r.shots.filter(s => s.d === "b"); assert.equal(onB.length, 200);
  assert.ok(onB.every(s => s.f >= 0.001 && s.x.u >= 1000), "the 200th rocket still breaks something: " + JSON.stringify(onB[199]));
  assert.ok(onB.some(s => s.x.cd < 0.2) && onB.some(s => s.x.st <= 0.05), "civil defence and wreckage scale the damage down, they never stop it");
  const dmg = usd => B.resolveNight({ night: D, fighters: [F("a", { usd }), F("b", { usd: 0 })] }).shots.reduce((t, s) => t + B.usdOf(s), 0);
  const steps = [200_000, 1_000_000, 5_000_000, 25_000_000, 125_000_000].map(dmg);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1], "more budget, more damage, with no ceiling: " + steps);
  // the old rules stopped at 2 facades a night: 25 cruise missiles go well past that
  const heavy = B.resolveNight({ night: D, fighters: [F("a", { usd: 50_000_000, best: "cruise" }), F("b", { usd: 0, tw: [120, 110, 105] })] }).shots;
  assert.ok(heavy.reduce((t, s) => t + B.dmgAll(s), 0) > 2, "towers' worth taken in one night: " + heavy.reduce((t, s) => t + B.dmgAll(s), 0));
});

test("sizes do different damage, guidance matters, shields scale it, and a spreading fire adds most", () => {
  const total = (o, d = {}) => { let t = 0, n = 0; for (let k = 0; k < 40; k++) { const r = B.resolveNight({ night: D + k, fighters: [F("a", o), F("b", { usd: 0, tw: [120, 120, 120], ...d })] }); for (const s of r.shots) { t += s.x.u; n++; } } return t / n; };
  const per = ["shell", "rocket", "tactical", "cruise"].map(w => total({ usd: 20 * B.costOf(w), best: w }));
  assert.ok(per[0] < per[1] && per[1] < per[2] && per[2] < per[3], "average $ per hit rises with the size: " + per.map(Math.round));
  assert.ok(total({ usd: 4_000_000, best: "rocket", cepX: 0.25 }) > 1.5 * total({ usd: 4_000_000, best: "rocket", cepX: 1 }), "a terminal seeker lands far more of the blast than inertial guidance");
  near(total({ usd: 4_000_000 }, { sh: 0.5 }) / total({ usd: 4_000_000 }), 0.5, 0.12);
  const all = []; for (let k = 0; k < 30; k++) all.push(...B.resolveNight({ night: D + k, fighters: [F("a", { usd: 10_000_000, best: "cruise" }), F("b", { usd: 0, tw: [50, 50, 50] })] }).shots);
  const sp = all.filter(s => s.x.sp), small = all.filter(s => !s.x.sp);
  assert.ok(sp.length > all.length * 0.4 && small.length > all.length * 0.2, "a cruise missile's fire spreads about 60% of the time: " + sp.length + "/" + all.length);
  for (const s of all) near(s.x.fi / s.f, 0.7 * (s.x.sp ? 0.8 : 0.15), 0.02);   // masonry fire load 0.7
  const s0 = all[0]; near(B.dmgAt(s0, s0.t + 3600_000), s0.f + s0.x.fi * (1 - 1 / Math.E), 1e-9); near(B.dmgAt(s0, s0.t + 24 * 3600_000), B.dmgAll(s0), 1e-6);
});

test("buildings only: every hit lands on one of the defender's repo towers (tallest first, least hit of the top three), a city with no buildings is never a target, for many cities and days", () => {
  const towns = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => F(id, { towers: i === 6 ? 0 : 1 + (i % 4), usd: 1_000_000 + i * 500_000 }));
  for (let n = D; n < D + 12; n++) {
    const r = B.resolveNight({ night: n, fighters: towns });
    for (const s of r.shots) { const d = towns.find(t => t.id === s.d); assert.ok(d && d.towers > 0, "never a city without buildings: " + s.d); assert.ok(s.lot >= 0 && s.lot < d.towers, `aim index ${s.lot} is one of ${d.towers} buildings`); assert.notEqual(s.a, s.d); }
    assert.ok(!r.shots.some(s => s.d === "g"), "g has no buildings and is never hit");
  }
  const lone = B.resolveNight({ night: D, fighters: [F("a"), F("g", { towers: 0 })] });
  assert.ok(lone.shots.every(s => s.d !== "g"), "no green-space hits even when the only other city is empty");
});

test("city vs city: a city never targets itself, its shots spread over the rivals in reach (3, more with merged PRs), raiders only when fewer than two cities are armed", () => {
  const fs = [F("a"), F("b"), F("c"), F("d"), F("e", { usd: 0 }), F("g"), F("h", { reach: 5 })];
  const r = B.resolveNight({ night: D, fighters: fs });
  assert.ok(r.shots.length > 0 && r.shots.every(s => s.a !== s.d), "no self-hits");
  for (const a of ["a", "b", "c", "d"]) { const ts = new Set(r.shots.filter(s => s.a === a).map(s => s.d)); assert.ok(ts.size === 3 && !ts.has(a), a + " spreads over three rivals: " + [...ts]); }
  assert.equal(new Set(r.shots.filter(s => s.a === "h").map(s => s.d)).size, 5, "merged PRs put two more rivals in reach");
  assert.ok(r.shots.every(s => s.a !== B.RAIDERS && s.d !== B.RAIDERS) && r.raiders.length === 0, "no raiders when cities can fight each other");
  assert.equal(r.shots.filter(s => s.a === "e").length, 0, "a city with no budget does not fire");
  const lone = B.resolveNight({ night: D, fighters: [F("a"), F("b", { usd: 0, idle: 30 })] });
  assert.ok(lone.shots.some(s => s.a === B.RAIDERS && s.d === "a" && s.f > 0), "a lone armed city gets raiders from the sea, and they hit the city");
  assert.ok(lone.shots.filter(s => s.a === "a").every(s => s.d === B.RAIDERS && s.x.u > 0), "and its own missiles hit the raiders' ship");
  assert.deepEqual(B.resolveNight({ night: D, fighters: fs }), r, "deterministic per day");
});

test("fairness: never the same rival two nights running, quiet plots untargetable, a beginner shield takes the hit on the dome, per-capita strength and scoring", () => {
  const r2 = B.resolveNight({ night: D, fighters: [F("a"), F("b"), F("c", { side: 9, out7: 1 })], lastPairs: new Set(["a>b"]) });
  assert.ok(!r2.shots.some(s => s.a === "a" && s.d === "b"), "a doesn't hit b again");
  const r3 = B.resolveNight({ night: D, fighters: [F("a"), F("q", { idle: 20, usd: 0 })] });
  assert.ok(!r3.shots.some(s => s.d === "q"), "the quiet plot is never targeted");
  assert.ok(r3.shots.some(s => s.a === "a" && s.d === B.RAIDERS) && r3.shots.some(s => s.a === B.RAIDERS && s.d === "a"), "a fights the raiders");
  const r4 = B.resolveNight({ night: D, fighters: [F("a"), F("n", { sh: 1, beg: true })] });
  const onN = r4.shots.filter(s => s.d === "n"); assert.ok(onN.length > 0 && onN.every(s => s.f === 0 && s.blocked === 1 && s.lot >= 0 && s.x.pot > 0 && s.x.u === 0 && s.x.fi === 0), "the beginner shield holds, over a tower, and the shot knows what it would have done");
  const one = heads => B.resolveNight({ night: D, fighters: [F("t", { heads, usd: 1_000_000 }), F("v", { usd: 0 })] }).shots.filter(s => s.a === "t").reduce((x, s) => x + s.f, 0);
  assert.ok(one(10) < one(1) / 4, "a 10-person team hits with a fraction of the strength per head");
  const X = (u, o = {}) => ({ u, fi: 0, fu: 0, ...o });
  const sc = B.scoreOf([{ a: "t", d: "v", f: 0.1, ammo: 200000, blocked: 0, x: X(4_000_000) }, { a: "u", d: "v", f: 0.1, ammo: 200000, blocked: 0, x: X(1_000_000, { fu: 500_000 }) }, { a: "u", d: "w", f: 0, ammo: 200000, blocked: 1, x: X(0, { pot: 800_000 }) }, { a: "old", d: "v", f: 1.5, ammo: 5, blocked: 0 }], id => id === "t" ? 4 : 1);
  assert.equal(sc.get("t"), 1_000_000, "per head"); assert.equal(sc.get("u"), 1_500_000, "blast and fire"); assert.equal(sc.get("w"), 400_000, "half of what the shield held off");
  assert.equal(sc.get("old"), 7_500_000, "a night from before 11-14 scores its facades at $5M each");
});

test("manual fire: up to 3 aimed shots go where aimed, invalid aims are ignored, the rest auto-fire", () => {
  const fs3 = [F("a", { usd: 2_400_000, best: "shell" }), F("b", { side: 2, out7: 1 }), F("c", { side: 4 }), F("p", { idle: 30 })];
  const r = B.resolveNight({ night: D, fighters: fs3, aims: new Map([["a", ["b", "b", "b", "b", "p", "zz"]]]) });
  const a = r.shots.filter(s => s.a === "a"); assert.equal(a.length, 24);
  assert.equal(a.filter(s => s.aim).length, 3, "3 aimed shots at most"); assert.ok(a.filter(s => s.aim).every(s => s.d === "b"));
  assert.ok(!a.some(s => s.d === "p"), "an aim at a quiet plot is ignored");
});

// ---------------------------------------------------------------- 4. regeneration (always)
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

// ---------------------------------------------------------------- 5. the report and the email
test("report and email: what my city did last night, in dollars; subject formula; ASCII; peaceful zones get build lines only; unsubscribe + postal", () => {
  const X = (u, fu, sp) => ({ u, fi: fu / 48e6, fu, sp, m: 3, cep: 6, r: 7.4, kpa: 900, c: 3, fl: 20, v: 48e6, sh: 0, cd: 1, st: 1, pc: 1, raw: u / 48e6 });
  const at = B.battleAt(D), shots = [{ k: 0, a: "o", d: "n", w: "rocket", ammo: 200000, roll: 0, f: 0.025, lot: 3, t: at + 14 * 60000, aim: 0, blocked: 0, x: X(1_200_000, 300_000, 1) }, { k: 1, a: "n", d: "q", w: "tactical", ammo: 1e6, roll: 0, f: 0.1, lot: 1, t: at + 20 * 60000, aim: 0, blocked: 0, x: X(4_800_000, 200_000, 0) }, { k: 2, a: "n", d: "q", w: "tactical", ammo: 1e6, roll: 0, f: 0, lot: 0, t: at + 21 * 60000, aim: 0, blocked: 1, x: { ...X(0, 0, 0), sh: 1, pot: 5e6 } }];
  const handle = id => "@" + ({ o: "oscar", n: "nadia", q: "quinn" }[id] || id);
  const r = B.reportFor("n", "nadia", shots, { night: D, now: at + 7 * 3600_000, peace: false, pts: () => 0, handle, mvp: { repo: "build-bot", bricks: 38 }, shield: 0.92, streak: 14, built: 2, ammo: 40, usd: 2_000_000 });
  assert.equal(r.raids.length, 1); assert.equal(r.raids[0].from, "@oscar"); assert.equal(r.takenUsd, 1_500_000); assert.equal(r.dealtUsd, 5_000_000); assert.equal(r.tiers, 1); assert.equal(r.fires, 1); assert.equal(r.fired, 2); assert.equal(r.landed, 1); assert.deepEqual(r.on, ["@quinn"]);
  assert.ok(r.rebuilt > 0 && r.rebuilt < 100, "partly rebuilt by 9am: " + r.rebuilt);
  assert.equal(B.battleSubject(r), "Your city today: hit by @oscar, cranes rebuild tonight");
  assert.equal(B.battleSubject({ ...r, taken: 0 }), "Your city today: @oscar stopped by your shield");
  assert.equal(B.battleSubject({ ...r, raids: [] }), "Your city today: 2 missiles stacked, no hits on your towers");
  assert.equal(B.battleSubject({ ...r, peace: true, built: 3 }), "Your city today: peaceful zone, 3 lots built");
  const w = B.worldLines(shots, { handle, built: [["@mike", 11]], rebuilt: [["@nadia", 61]], pairsByNight: [], season: { n: 1, week: 1 } });
  const m = B.battleEmail(r, w, { name: "Nadia K", hub: "https://caldera.social", unsub: "https://caldera.social/u/battle?t=x", postal: "mjonesone, LLC, 450 S Melrose Dr, Vista, CA 92081" });
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(m.text) && /^[\x20-\x7e]*$/.test(m.subject), "plain ASCII");
  for (const s of ["Hey Nadia,", "YOUR CITY", "Stacked at noon: 2 missiles bought with a $2M budget", "Salvo at 20:00: 2 fired, 1 landed on @quinn, $5M of damage.", "Hits on your towers: $1.5M of damage from @oscar (1 tower hit, 1 caught fire). Cranes rebuild overnight, whole by noon.", "MVP: build-bot, 38 bricks laid.", "Watch the replay: https://caldera.social/world?view=battle&replay=1", "TODAY IN THE WORLD", "Most ammo stacked: @nadia 2 missiles, @oscar 1 missile", "Built the most: @mike 11 lots", "Towers hit the hardest: @quinn ($5M), @nadia ($1.5M)", "Most hits landed: @nadia 1 hit", "Leaderboard: https://caldera.social/leaderboard", "Season 1, week 1", "Daily / Weekly / Off:", "Unsubscribe: https://caldera.social/u/battle?t=x", "Vista, CA"]) assert.ok(m.text.includes(s), "email has: " + s + "\n" + m.text);
  const peace = B.battleEmail({ ...r, peace: true, raids: [] }, w, { name: "Nadia", hub: "https://caldera.social", unsub: "u", postal: "P" });
  assert.ok(!/attack|raid|hit|damage|salvo/i.test(peace.text.replace(/Hey Nadia[\s\S]*?YOUR CITY/, "")), "a peaceful zone never reads about attacks");
  const sum = B.battleSummary(shots, { night: "2026-11-08", handle, hub: "https://caldera.social/" });
  for (const t of ["Battle day, Nov 8.", "Most ammo stacked: @nadia 2 missiles, @oscar 1 missile.", "The 20:00 salvo: 3 missiles, 2 landed, $6.5M of damage.", "Towers hit: @quinn (1 tower, $5M); @nadia (1 tower, $1.5M).", "Cranes rebuild overnight", "Replay: https://caldera.social/world?view=battle&replay=1", "Leaderboard: https://caldera.social/leaderboard"]) assert.ok(sum.includes(t), "summary: " + t + "\n" + sum);
  assert.equal(B.battleSummary([], { night: "2026-11-08", handle, hub: "h" }), null, "no battle, no post");
  assert.deepEqual([999, 1500, 25_000, 340_000, 1_250_000, 2_000_000, 3.2e9].map(B.fmtUsd), ["$999", "$1.5k", "$25k", "$340k", "$1.3M", "$2M", "$3.2B"]);
  assert.equal(B.mvpOf([ev("commit", D, { repo: "me/build-bot" }), ev("commit", D, { repo: "me/build-bot" }), ev("private", D, { repo: "private:ab", n: 1 })], D).repo, "build-bot");
  assert.equal(B.mvpOf([ev("private", D, { repo: "private:ab", n: 9 })], D).repo, "a private repo", "private repos stay nameless");
});

// ---------------------------------------------------------------- 6. the live hub: opt-in, peaceful zones, state, nights, opt-out, email off, unsubscribe, kill switch
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

test("live: Battle is one more view (Now stays the default); every city is in unless it opts out; nights; opt-out rebuilds instantly; report email built but off; unsubscribe", async () => {
  delete process.env.CALDERA_BATTLE_EMAIL;
  const { h, base, ids, post, as, cookie, sent } = await hubWith(["rae", "sam", "pat"]);
  try {
    const page = await (await fetch(base + "/world")).text();
    for (const v of ["now", "day", "week", "month", "battle"]) assert.ok(page.includes(`data-gview="${v}"`), "switcher: " + v);
    assert.ok(/<button type="button" data-gview="now" aria-pressed="true">/.test(page), "Now stays the default");
    for (const l of ["damage", "attacks", "shields", "replay"]) assert.ok(page.includes(`data-bl="${l}"`), "layer toggle: " + l);
    assert.ok(page.includes("window.CALDERA_BATTLE=") && page.includes('id="b-bar"') && page.includes("window.CALDERA_BATTLE_API"), "battle state, bar and renderer layer");
    assert.ok(page.includes("'battle']") && page.includes("searchParams.get('view')"), "?view=battle is read (shareable)");

    // every city is in the battles (Mike 11-08: "this is a battle between cities"); leaving is the choice
    let s = await (await fetch(base + "/v1/world/battle")).json();
    assert.equal(s.cities, 3); assert.deepEqual(Object.keys(s.members).sort(), ["@pat", "@rae", "@sam"]);
    assert.equal((await post("/v1/world/battle/opt", { war: true }, { origin: "https://hub.test" })).status, 401, "sign in first");
    assert.equal((await post("/v1/world/battle/opt", { war: true }, { cookie: await cookie("rae"), origin: "https://evil.test" })).status, 403, "cross-site refused");
    work(h, ids);
    for (const w of ["rae", "sam"]) { const r = await as(w, "/v1/world/battle/opt", { war: true, waive: true }); assert.equal(r.status, 200); assert.equal(r.body.war, 1); }
    assert.equal((await as("pat", "/v1/world/battle/opt", { war: false })).body.war, 0, "@pat leaves");
    s = await (await fetch(base + "/v1/world/battle")).json();
    assert.deepEqual(Object.keys(s.members).sort(), ["@rae", "@sam"], "a city that left is a peaceful zone; everyone else fights");
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
