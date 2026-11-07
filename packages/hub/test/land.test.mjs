import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

// land.ts isn't exported from the server bundle: bundle the module itself
const out = await build({ entryPoints: [new URL("../src/land.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const L = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const DAY = 86_400_000, NOW = Date.parse("2026-11-06T12:00:00Z");
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test("land formula: score = 3 ln(1+C) + 2 ln(1+P) + ln(1+R) + 0.5 ln(1+S); side = clamp(2 + floor(score/7), 2, 8)", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(L.landScore(0, 0, 0, 0), 0);
  near(L.landScore(10, 1, 1, 0), 3 * Math.log(11) + 2 * Math.log(2) + Math.log(2));
  // the design's worked examples
  const ex = [[[0, 0, 1, 0], 2], [[10, 1, 1, 0], 3], [[40, 3, 2, 5], 4], [[300, 24, 6, 60], 5], [[1200, 80, 14, 400], 7], [[5000, 300, 40, 5000], 8]];
  for (const [[c, p, r, s], side] of ex) assert.equal(L.landSide(L.landScore(c, p, r, s)), side, `example ${c}/${p}/${r}/${s}`);
  assert.equal(L.landSide(-5), 2, "floor");
  assert.equal(L.landSide(6.99), 2); assert.equal(L.landSide(7), 3); assert.equal(L.landSide(41.99), 7); assert.equal(L.landSide(42), 8);
  assert.equal(L.landSide(1e9), 8, "cap");
  assert.equal(L.landScore(-3, NaN, undefined, -1), 0, "bad inputs count as nothing");
});

test("commit weight: 0.5 + 0.5 e^(-age/180d), recent work counts double; only the last 12 months count", () => {
  assert.equal(L.commitWeight(0), 1);
  assert.ok(Math.abs(L.commitWeight(180) - (0.5 + 0.5 / Math.E)) < 1e-12);
  assert.ok(L.commitWeight(30) > L.commitWeight(90) && L.commitWeight(364) > 0.5);
  const b = L.repoBuckets({ commits: 52, weeks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12] }, NOW);
  assert.equal(b.reduce((s, x) => s + x.n, 0), 52, "the 12-month total is kept");
  assert.equal(b.filter(x => x.exact).length, 1, "only the real commit weeks are exact");
  assert.ok(Math.abs(L.rawCommits(b, NOW) - 52) < 1e-9);
  assert.ok(L.weightedCommits(b, NOW) < 52 && L.weightedCommits(b, NOW) > 26);
  assert.ok(L.weightedCommits(b, NOW + 400 * DAY) < 1e-9, "a year and more later nothing counts");
  assert.equal(L.rawCommits(b, NOW - 30 * DAY), 40, "at an earlier date the recent week hasn't happened yet");
});

test("health: recency and frequency, five states", () => {
  const wk = k => NOW - k * 7 * DAY - DAY;
  assert.equal(L.healthAt([NOW - DAY, wk(1), wk(2)], NOW).state, 0, "this week and 3 of 4 weeks: thriving");
  assert.equal(L.healthAt([NOW - DAY], NOW).state, 1, "a fresh commit alone: active");
  assert.equal(L.healthAt([NOW - 25 * DAY], NOW).state, 1);
  assert.equal(L.healthAt([NOW - 100 * DAY], NOW).state, 2, "settled");
  assert.equal(L.healthAt([NOW - 200 * DAY], NOW).state, 3, "weathered");
  assert.equal(L.healthAt([NOW - 400 * DAY], NOW).state, 4, "dormant");
  assert.equal(L.healthAt([], NOW).state, 4);
  assert.equal(L.healthAt([NOW + DAY], NOW).state, 4, "the future doesn't count");
});

test("placement: the founder at the centre, everyone on the nearest free ground, never overlapping, deterministic", () => {
  const sides = [8, 2, 5, 2, 3, 7, 2, 2, 4, 6, 2, 2, 2, 8, 2];
  const pos = L.placeLand(sides, 3);
  assert.deepEqual(pos, L.placeLand(sides, 3), "same input, same island");
  assert.equal(pos.length, sides.length);
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
    const a = { ...pos[i], k: sides[i] }, b = { ...pos[j], k: sides[j] };
    const apart = a.x + a.k + 3 <= b.x || b.x + b.k + 3 <= a.x || a.y + a.k + 3 <= b.y || b.y + b.k + 3 <= a.y;
    assert.ok(apart, `plots ${i} and ${j} keep the 3-tile gap`);
  }
  // the island grows outward: on average later plots sit further from the founder's centre than earlier ones
  const c0 = { x: pos[0].x + sides[0] / 2, y: pos[0].y + sides[0] / 2 }, dist = i => Math.hypot(pos[i].x + sides[i] / 2 - c0.x, pos[i].y + sides[i] / 2 - c0.y);
  const early = [1, 2, 3, 4].map(dist).reduce((a, b) => a + b) / 4, late = [11, 12, 13, 14].map(dist).reduce((a, b) => a + b) / 4;
  assert.ok(late > early, `late ${late} > early ${early}`);
  // a newcomer takes the nearest free ground: right beside the founder, not far away
  assert.ok(dist(1) <= sides[0] / 2 + 3 + 2 + 1.5, "the second plot touches the founder's gap");
  assert.ok(Math.min(...pos.map(p => p.x)) === 3 && Math.min(...pos.map(p => p.y)) === 3, "shifted to start at (3, 3)");
});

const repo = (name, commits, weeks, pushedDaysAgo, createdDaysAgo) => ({ name, language: "TypeScript", commits, weeks, week: weeks[weeks.length - 1] || 0,
  pushed: new Date(NOW - pushedDaysAgo * DAY).toISOString(), created: new Date(NOW - createdDaysAgo * DAY).toISOString(), url: "https://github.com/ana/" + name });

test("a member's land: side from the formula, never shrinks, a replay that only steps up, floor for members without GitHub", () => {
  const day0 = NOW - 30 * DAY, days = 31;
  const busy = L.memberLand({ handle: "ana", name: "Ana", created: NOW - 20 * DAY, city: "x", at: NOW, caldera: [], gh: { p: 24, s: 60 },
    repos: [repo("api", 300, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 1, 300), repo("web", 80, [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 4], 2, 200), repo("cli", 10, [], 50, 60)] }, day0, days, NOW);
  assert.ok(busy.k >= 4 && busy.k <= 8, "a busy member has more than the floor");
  assert.equal(busy.k, Math.max(2, L.landSide(busy.sc)), "today's side is the formula's");
  assert.equal(busy.j, 10, "joined on day 11");
  assert.equal(busy.steps[0][0], 10, "the replay starts on the join day");
  for (let i = 1; i < busy.steps.length; i++) assert.ok(busy.steps[i][1] > busy.steps[i - 1][1], "the replay only steps up");
  assert.equal(busy.steps[busy.steps.length - 1][1], busy.k);
  assert.ok(busy.st <= 1, "pushed yesterday: thriving or active");
  assert.deepEqual(busy.bl.map(b => b.n), ["api", "web", "cli"], "buildings by commits");

  const quiet = L.memberLand({ handle: "bo", name: "Bo", created: day0, city: "x", at: NOW, caldera: [], sideMax: 6, repos: [repo("old", 3, [], 300, 900)] }, day0, days, NOW);
  assert.equal(quiet.k, 6, "land never shrinks: the stored side holds when the code goes quiet");
  assert.equal(quiet.st, 3, "it weathers instead");

  const none = L.memberLand({ handle: "cy", name: "Cy", created: NOW - 5 * DAY, city: "x", at: NOW, repos: [], caldera: [NOW - 5 * DAY, NOW - 2 * DAY] }, day0, days, NOW);
  assert.equal(none.k, 2, "no GitHub: the 2x2 floor");
  assert.equal(none.gh, 0);
  assert.equal(none.st, 1, "weathering by Caldera activity: active two days ago");
  assert.equal(none.bl.length, 0);
});

test("buildLand: founder first and at the centre, join order after, links by index, stack lines left out", () => {
  const mk = (handle, daysAgo) => ({ handle, name: handle, created: NOW - daysAgo * DAY, city: "c/" + handle, at: NOW, repos: [], caldera: [NOW - daysAgo * DAY] });
  const w = L.buildLand([mk("zed", 3), mk("mike", 20), mk("amy", 10)], { founder: "mike", now: NOW, links: [["@amy", "@zed", 0], ["@mike", "@amy", 1], ["@amy", "@zed", 4]] });
  assert.deepEqual(w.members.map(m => m.h), ["mike", "amy", "zed"]);
  assert.equal(w.days, 21); assert.equal(w.day0, new Date(NOW - 20 * DAY).toISOString().slice(0, 10));
  assert.deepEqual(w.links, [[1, 2, 0], [0, 1, 1]]);
  assert.deepEqual(w.members.map(m => m.j), [0, 10, 17]);
});

test("the World serves the Expansion view: toggle on the page, land JSON from the public city only, nightly job stores GitHub numbers", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-land-")); dirs.push(d);
  const calls = [];
  const githubFetch = async (u) => { calls.push(String(u)); const url = new URL(String(u));
    const body = url.pathname === "/search/issues" ? { total_count: 7 } : url.pathname === "/users/rae/repos" ? [{ name: "app", full_name: "rae/app", fork: false, private: false, archived: false, stargazers_count: 3 }, { name: "gone", full_name: "rae/gone", fork: false, private: false, archived: true, stargazers_count: 0 }, { name: "new", full_name: "rae/new", fork: false, private: false, archived: false, stargazers_count: 2, created_at: new Date(Date.now() - 30 * DAY).toISOString() }, { name: "oldie", full_name: "rae/oldie", fork: false, private: false, archived: false, stargazers_count: 9, created_at: "2020-01-01T00:00:00Z" }]
      : /\/repos\/rae\/(new|oldie)\/stargazers/.test(url.pathname) ? null
      : url.pathname === "/repos/rae/app/stargazers" ? [{ starred_at: new Date(Date.now() - 400 * DAY).toISOString() }, { starred_at: new Date(Date.now() - 20 * DAY).toISOString() }, { starred_at: new Date().toISOString() }] : {};
    return new Response(JSON.stringify(body ?? { message: "Requires authentication" }), { status: body === null ? 401 : 200, headers: { "content-type": "application/json" } }); };
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch });
  const base = "http://127.0.0.1:" + await h.listen(0);
  try {
    const rr = (name, pub, commits, week) => ({ name, project: "Work", public: pub, language: pub ? "TypeScript" : "Rust", commits, weeks: [1, 2, week], week, today: 0, pushed: new Date().toISOString(), ...(pub ? { url: `https://github.com/rae/${name}` } : {}) });
    const full = cityData([rr("app", true, 300, 4), rr("shop-secret", false, 900, 7)], () => ({ n: 0, paths: [] }), new Date().toISOString());
    const files = { "index.html": Buffer.from("<html><body>Rae</body></html>").toString("base64"), "city.html": Buffer.from(renderCity({ name: "Rae", handle: "rae" }, publicCity(full, ["Work"], "show"))).toString("base64") };
    const rae = C.newIdentity();
    const r = await fetch(`${base}/v1/profiles/${rae.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(rae, "profile.manifest", { name: "Rae", handle: "rae", boxKey: rae.boxPublic }), files }) });
    assert.equal(r.status, 200);

    const page = await (await fetch(base + "/world")).text();
    assert.ok(page.includes('data-wview="current"') && page.includes('data-wview="expansion"'), "Current | Expansion toggle");
    assert.ok(page.includes('id="land"') && page.includes("caldera.worldView"), "the land stage and the remembered choice");
    assert.ok(/<button type="button" data-wview="current" aria-pressed="true">/.test(page), "Current is the default");

    let land = await (await fetch(base + "/v1/world/land")).json();
    assert.equal(calls.length, 0, "page loads never call GitHub");
    const m = land.members.find(x => x.h === "rae");
    assert.ok(m, "the member is on the island");
    assert.deepEqual(m.bl.map(b => b.n), ["app"], "only public, named repos become buildings");
    assert.ok(!JSON.stringify(land).includes("shop-secret"), "a private repo never reaches the land map");
    assert.equal(m.p, 0, "no merged PRs before the nightly job");
    assert.ok(m.k >= 2 && m.k <= 8);

    const res = await h.admin.land({});
    assert.equal(res.checked, 1);
    assert.ok(calls.some(u => u.includes("/search/issues")) && calls.some(u => u.includes("author%3Arae")), "merged PRs from public search by login (from the public repo links)");
    land = await (await fetch(base + "/v1/world/land")).json();
    const m2 = land.members.find(x => x.h === "rae");
    assert.equal(m2.p, 7, "merged PRs stored by the nightly job");
    assert.equal(m2.s, 4, "stars gained in 12 months: dated stars, plus every star of a repo born this year when the dated list needs a token");
    assert.ok(m2.sc > m.sc);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM land_hist").get().n, 1, "tonight's side and state are stored");
    assert.equal(h.db.prepare("SELECT side FROM land_side").get().side, m2.k, "and the ratchet holds today's side");
  } finally { h.server?.close?.(); }
});
