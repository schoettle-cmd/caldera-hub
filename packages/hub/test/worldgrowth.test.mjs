import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

// growth.ts isn't exported from the server bundle: bundle the module itself
const out = await build({ entryPoints: [new URL("../src/growth.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const G = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const DAY = 86_400_000, TODAY = G.dayOf(Date.parse("2026-11-07T12:00:00Z"));
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
let seq = 0;
const ev = (p, k, day, o = {}) => { const t = day * DAY + 9 * 3600_000 + (seq++) * 1000; return { id: `${k}:${seq}`, p, k, repo: o.repo || "me/app", ts: o.ts ?? t, seen: o.seen ?? t, n: o.n ?? 1, v: o.v || "", ...(o.x ? { x: o.x } : {}) }; };
const commits = (p, day, n, o = {}) => Array.from({ length: n }, () => ev(p, "commit", day, o));

// ---------------------------------------------------------------- the economy
test("recency: today 1.0, a week 0.7, a month 0.3, 90 days and older 0; streak x1.1 at 7 days up to x1.5 at 30; AI x1.3 to x1.6", () => {
  near(G.recency(0), 1); near(G.recency(7), 0.7); near(G.recency(30), 0.3); near(G.recency(90), 0); assert.equal(G.recency(400), 0);
  assert.ok(G.recency(3) < 1 && G.recency(3) > 0.7 && G.recency(60) < 0.3 && G.recency(60) > 0);
  assert.equal(G.streakMult(0), 1); assert.equal(G.streakMult(6), 1); near(G.streakMult(7), 1.1); near(G.streakMult(30), 1.5); near(G.streakMult(100), 1.5);
  assert.ok(G.streakMult(18) > 1.1 && G.streakMult(18) < 1.5);
  assert.equal(G.aiMult(0), 1); near(G.aiMult(1), 1.3); near(G.aiMult(2), 1.4); near(G.aiMult(4), 1.6); near(G.aiMult(9), 1.6);
});

test("build points buy land: 25 a stage, each later lot in a ring 10% more, upgrades cost twice a stage; lots fill ring by ring", () => {
  near(G.stageCost(0), 25); near(G.stageCost(1), 25); near(G.stageCost(2), 27.5); near(G.stageCost(4), 25); near(G.stageCost(8), 25 * 1.1 ** 4);
  near(G.upgradeCost(2), 55);
  for (let i = 0; i < 200; i++) { const [a, b] = G.lotXY(i); assert.equal(G.lotIndex(a, b), i, `lot ${i}`); assert.equal(Math.max(a, b), Math.floor(Math.sqrt(i))); }
  assert.deepEqual([0, 1, 2, 3].map(G.lotXY), [[0, 0], [1, 0], [1, 1], [0, 1]], "a 2x2 plot");
});

test("five tiers: lot, houses (7-day streak), mid-rise (30 active days in 60), tower (5 merged PRs and a release in 30 days), campus (AI, 90 days)", () => {
  const base = { streak7In30: false, active60: 0, prs30: 0, rel30: 0, ai30: false, historyDays: 0 };
  assert.equal(G.eligibleTier(base), 1);
  assert.equal(G.eligibleTier({ ...base, streak7In30: true }), 2);
  assert.equal(G.eligibleTier({ ...base, streak7In30: true, active60: 30 }), 3);
  assert.equal(G.eligibleTier({ ...base, prs30: 5, rel30: 1 }), 4);
  assert.equal(G.eligibleTier({ ...base, prs30: 5, rel30: 0 }), 1, "a tower needs a release too");
  assert.equal(G.eligibleTier({ ...base, active60: 30, ai30: true, historyDays: 90 }), 5);
  assert.equal(G.eligibleTier({ ...base, active60: 30, ai30: true, historyDays: 89 }), 3, "campus needs 90 days of history");
  assert.equal(G.eligibleTier({ ...base, ai30: true, historyDays: 400 }), 1, "the AI boost alone is not a campus");
  assert.deepEqual([0, 13, 14, 59, 60, 180, 365, null].map(G.healthCode), [0, 0, 1, 1, 2, 3, 4, 4], "paused 14, dim 60, weathered 180, dormant 365");
});

test("simulation: daily commits zone, grade, frame and build lots; the plot grows a ring and the road moves out; land never shrinks", () => {
  const seeds = [{ p: "a", day: TODAY - 30, side: 2, lots: "0000" }];
  const events = []; for (let d = TODAY - 30; d <= TODAY; d++) events.push(...commits("a", d, 20));
  const s = G.simulate(seeds, events, TODAY).get("a");
  assert.ok(s.side >= 3, "a month of daily work grows the plot a ring: side " + s.side);
  const built = s.lots.split("").filter(c => +c >= 4).length;
  assert.ok(built >= 4, "the first 2x2 is built: " + s.lots);
  assert.ok(s.log.some(b => b[1] === -1), "the ring purchase is logged (the road ring moved out)");
  const order = s.log.filter(b => b[1] === 0).map(b => b[2]); assert.deepEqual(order.slice(0, 4), [1, 2, 3, 4], "a lot goes zoned, graded, frame, built");
  assert.ok(s.streak >= 30, "a 31-day streak");
  // land never shrinks: a floor larger than the simulated side keeps the land
  const f = G.simulate(seeds, events, TODAY, { floor: new Map([["a", s.side + 2]]) }).get("a");
  assert.equal(f.side, s.side + 2);
  // snapshots per day for the replay
  assert.ok(s.snaps.get(TODAY - 1) && s.snaps.get(TODAY - 30).side === 2);
});

test("recent daily work wins: the same commits in one burst long ago buy far less than a steady recent streak", () => {
  const seeds = [{ p: "steady", day: TODAY - 60, side: 2, lots: "0000" }, { p: "march", day: TODAY - 60, side: 2, lots: "0000" }];
  const events = [];
  for (let d = TODAY - 29; d <= TODAY; d++) events.push(...commits("steady", d, 10));
  events.push(...commits("march", TODAY - 59, 300));   // 300 commits on one day: capped at 40 commits and 60 points
  const r = G.simulate(seeds, events, TODAY);
  const pts = p => r.get(p).stats.reduce((s, x) => s + x.pts, 0);
  assert.ok(pts("march") <= 60 + 1e-9, "a very loud day is capped at 60 points: " + pts("march"));
  assert.ok(pts("steady") > 5 * pts("march"), "the steady streak earns far more");
  assert.equal(r.get("march").stats.find(x => x.d === TODAY - 59).c, 40, "commit cap: 40 a day");
  assert.ok(r.get("march").bank < 60, "surplus decays after 14 days");
  assert.equal(G.healthCode(r.get("march").idle), 1, "59 days quiet: crews paused (dimming starts at 60)");
  assert.equal(G.healthCode(r.get("steady").idle), 0);
});

test("late or backdated commits count less (recency at the time they are seen), the AI boost multiplies, the streak multiplies", () => {
  const seeds = [{ p: "a", day: TODAY - 1, side: 2, lots: "0000" }, { p: "b", day: TODAY - 1, side: 2, lots: "0000" }, { p: "c", day: TODAY - 1, side: 2, lots: "0000" }];
  const t = TODAY * DAY + 3600_000;
  const events = [ev("a", "commit", TODAY, { seen: t, ts: t }), ev("b", "commit", TODAY, { seen: t, ts: t - 30 * DAY }), ev("c", "commit", TODAY, { seen: t, ts: t, repo: "me/agent" })];
  const r = G.simulate(seeds, events, TODAY, { ai: new Map([["c", new Map([["me/agent", 2]])]]) });
  near(r.get("a").pointsToday, 1); near(r.get("b").pointsToday, 0.3); near(r.get("c").pointsToday, 1.4);
});

test("anti-gaming: reverts cancel what they revert, void events earn nothing, private counts weigh 0.7, repo returns diminish after 40", () => {
  const seeds = [{ p: "a", day: TODAY, side: 2, lots: "0000" }];
  const c1 = { ...ev("a", "commit", TODAY), id: "c:abcdef1234567" };
  const rv = { ...ev("a", "commit", TODAY, { v: "revert", x: { rv: "abcdef1" } }) };
  const r = G.simulate(seeds, [c1, rv, ev("a", "commit", TODAY, { v: "bot" }), ev("a", "commit", TODAY, { v: "empty" })], TODAY);
  assert.equal(r.get("a").pointsToday, 0, "a reverted commit and its revert earn nothing; bots and empty commits earn nothing");
  const p = G.simulate(seeds, [ev("a", "private", TODAY, { n: 10, repo: "private:x" })], TODAY);
  near(p.get("a").pointsToday, 7);
  const many = G.simulate([{ p: "a", day: TODAY, side: 2, lots: "0000" }], [ev("a", "commit", TODAY, { n: 50, repo: "me/one" })], TODAY);
  assert.equal(many.get("a").stats[0].c, 40, "member cap first");
  const cald = G.simulate(seeds, Array.from({ length: 9 }, () => ev("a", "post", TODAY)), TODAY);
  assert.equal(cald.get("a").pointsToday, 10, "Caldera activity: 3 a post, capped at 10 a day");
});

test("anti-gaming: commit, PR and star judgments", () => {
  const c = (o = {}) => ({ sha: "s1", commit: { message: "fix", tree: { sha: "t1" }, author: { email: "a@x.io", date: "2026-11-07T00:00:00Z" }, committer: { date: "2026-11-07T00:00:00Z" } }, author: { login: "rae" }, parents: [{ sha: "p0" }], ...o });
  assert.equal(G.judgeCommit(c(), "rae").v, "");
  assert.equal(G.judgeCommit(c({ author: { login: "dependabot[bot]" } }), "rae").v, "bot");
  assert.equal(G.judgeCommit(c({ author: { login: "renovate" } }), "rae").v, "bot");
  assert.equal(G.judgeCommit(c({ author: { login: "mallory" } }), "rae").v, "other");
  assert.equal(G.judgeCommit(c({ parents: [{ sha: "a" }, { sha: "b" }] }), "rae").v, "merge");
  const r = G.judgeCommit(c({ commit: { message: 'Revert "add x"\n\nThis reverts commit 0123456789abcdef.', tree: { sha: "t1" }, committer: { date: "2026-11-07T00:00:00Z" } } }), "rae");
  assert.deepEqual(r, { v: "revert", reverts: "0123456789abcdef" });
  assert.equal(G.judgeCommit(c({ stats: { total: 0 } }), "rae").v, "empty", "zero changed lines");
  assert.equal(G.judgeCommit(c(), "rae", {}, new Map([["p0", "t1"]])).v, "empty", "same tree as its parent: an empty commit");
  assert.equal(G.judgeCommit(c(), "rae", { fork: true, created: Date.parse("2026-11-08T00:00:00Z") }).v, "fork", "a fork's upstream history");
  assert.equal(G.judgeCommit(c(), "rae", { fork: true, created: Date.parse("2026-11-01T00:00:00Z") }).v, "", "the member's own commits on a fork count");
  assert.equal(G.prPoints({ author: "rae", mergedBy: "sam" }), 6);
  assert.equal(G.prPoints({ author: "rae", mergedBy: "rae" }), 2, "self-merged on a solo repo");
  assert.equal(G.prPoints({ author: "rae", mergedBy: "rae", ciPassed: true }), 6, "or after CI passed");
  assert.equal(G.prPoints({ author: "rae", mergedBy: "github-actions[bot]" }), 2, "a bot merge is not another account");
  const now = Date.parse("2026-11-07T00:00:00Z");
  assert.equal(G.youngAccount("2026-10-20T00:00:00Z", now), true); assert.equal(G.youngAccount("2020-01-01T00:00:00Z", now), false);
});

test("AI signals: topics, LLM SDK and ML dependencies, model files, AI Obsidian plugins, agents", () => {
  assert.equal(G.aiSignals({ repo: "x", topics: ["cli"], deps: ["react"], readme: "" }).n, 0);
  const s = G.aiSignals({ repo: "x", topics: ["llm", "mcp", "rag"], deps: ["@anthropic-ai/sdk", "openai", "react", "ai", "torch"], readme: "weights: model.safetensors" });
  assert.equal(s.n, 2 + 3 + 1, "at most 2 topics and 3 dependencies, plus model files: " + s.why.join(", "));
  assert.ok(G.aiSignals({ repo: "p", topics: ["obsidian-plugin"], deps: ["openai"] }, { agents: true }).why.includes("AI Obsidian plugin"));
});

test("daily drop: curated calendar plus derived drops from yesterday; today-in-your-city lines", () => {
  const sat = G.dayOf(Date.parse("2026-11-07T00:00:00Z"));
  const m = G.manifest(sat, G.derivedDrops([{ h: "nadia", name: "Nadia K", c: 38, rel: 1 }, { h: "oscar", name: "Oscar", c: 4, rel: 0 }], ["newbie"]));
  assert.equal(m.day, "2026-11-07"); assert.equal(m.season, "autumn");
  const kinds = m.drops.map(d => d.kind);
  for (const k of ["parade", "fireworks", "welcome", "airship", "wildlife", "festival", "market"]) assert.ok(kinds.includes(k), k);
  const par = m.drops.find(d => d.kind === "parade"); assert.equal(par.at, "@nadia"); assert.equal(par.banner, "Nadia shipped 38");
  assert.equal(m.drops.find(d => d.kind === "festival").name, "Lantern night");
  assert.deepEqual(G.curatedDrops(sat), G.curatedDrops(sat), "same day in, same drops out");
  const lines = G.todayLines("nadia", { w: { top: 1, z: 2 }, st: { hc: 0, thr: 1 } }, m);
  assert.ok(lines[0].startsWith("a parade for your 38 commits") && lines.includes("fireworks at dusk for your release") && lines.includes("lantern night at dusk"), lines.join(" | "));
});

test("webhook events: pushes judged per commit (bots, empty, duplicates, reverts), merged PRs, stars from young accounts", () => {
  const pf = l => ({ rae: "P1" })[l.toLowerCase()] || null, at = Date.now();
  const push = { repository: { full_name: "rae/app", private: false }, commits: [
    { id: "c1", author: { username: "rae" }, message: "work", distinct: true, modified: ["a.ts"], timestamp: new Date(at).toISOString() },
    { id: "c2", author: { username: "rae" }, message: "empty", distinct: true, timestamp: new Date(at).toISOString() },
    { id: "c3", author: { username: "dependabot[bot]" }, message: "bump", distinct: true, modified: ["p.json"], timestamp: new Date(at).toISOString() },
    { id: "c4", author: { username: "rae" }, message: "dup", distinct: false, modified: ["a.ts"], timestamp: new Date(at).toISOString() }] };
  const e = G.webhookEvents("push", push, pf, at);
  assert.deepEqual(e.map(x => [x.id, x.v]), [["c:c1", ""], ["c:c2", "empty"], ["c:c4", "dup"]], "a bot's commit is not even a member's event");
  assert.equal(G.webhookEvents("push", { ...push, repository: { full_name: "rae/secret", private: true } }, pf, at).length, 0, "private repos come only as counts from the plugin");
  const pr = G.webhookEvents("pull_request", { action: "closed", repository: { full_name: "rae/app" }, pull_request: { id: 9, merged: true, user: { login: "rae" }, merged_by: { login: "rae" }, merged_at: new Date(at).toISOString() } }, pf, at);
  assert.equal(pr[0].x.self, 1);
  const st = G.webhookEvents("star", { action: "created", repository: { full_name: "rae/app", owner: { login: "rae" } }, sender: { login: "newacct", created_at: new Date(at - 2 * DAY).toISOString() } }, pf, at);
  assert.equal(st[0].v, "young");
});

// ---------------------------------------------------------------- the live system: poll, tick, state API, page, drops, today, webhook, kill switch
async function hubWithMember(o = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-growth-")); dirs.push(d);
  const calls = [], now = Date.now(), iso = t => new Date(t).toISOString();
  const githubFetch = async (u) => { calls.push(String(u)); const url = new URL(String(u)), p = url.pathname;
    const commit = (sha, ago, extra = {}) => ({ sha, commit: { message: "work " + sha, tree: { sha: "t" + sha }, author: { email: "rae@x.io", date: iso(now - ago) }, committer: { date: iso(now - ago) } }, author: { login: "rae" }, parents: [{ sha: "p" + sha }], ...extra });
    const body = p === "/users/rae/repos" ? [{ full_name: "rae/app", name: "app", fork: false, private: false, archived: false, created_at: "2025-01-01T00:00:00Z", pushed_at: iso(now - 3600_000), stargazers_count: 0, topics: ["llm"] }]
      : p === "/repos/rae/app/commits" ? Array.from({ length: 60 }, (_, i) => commit("s" + i, (i % 30) * DAY + 3600_000)).concat([commit("bot1", DAY, { author: { login: "dependabot[bot]" } }), commit("m1", DAY, { parents: [{ sha: "a" }, { sha: "b" }] })])
      : p === "/repos/rae/app/releases" ? [{ id: 1, published_at: iso(now - 2 * DAY), draft: false, prerelease: false }]
      : p === "/search/issues" ? { total_count: 1, items: [{ id: 77, number: 3, repository_url: "https://api.github.com/repos/rae/app", pull_request: { merged_at: iso(now - 5 * DAY) } }] }
      : p === "/repos/rae/app/pulls/3" ? { merged_by: { login: "sam" }, merge_commit_sha: "mm" }
      : p === "/users/rae/events/public" ? []
      : /\/check-runs$/.test(p) ? { check_runs: [] } : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", etag: '"e1"' } }); };
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch, ...o });
  const base = "http://127.0.0.1:" + await h.listen(0);
  const rr = (name, pub, commits, week) => ({ name, project: "Work", public: pub, language: pub ? "TypeScript" : "Rust", commits, weeks: [1, 2, week], week, today: 0, pushed: new Date().toISOString(), ...(pub ? { url: `https://github.com/rae/${name}` } : {}) });
  const full = cityData([rr("app", true, 300, 4), rr("shop-secret", false, 900, 7)], () => ({ n: 0, paths: [] }), new Date().toISOString());
  const files = { "index.html": Buffer.from("<html><body>Rae</body></html>").toString("base64"), "city.html": Buffer.from(renderCity({ name: "Rae", handle: "rae" }, publicCity(full, ["Work"], "show"))).toString("base64") };
  const rae = C.newIdentity();
  const r = await fetch(`${base}/v1/profiles/${rae.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(rae, "profile.manifest", { name: "Rae", handle: "rae", boxKey: rae.boxPublic }), files }) });
  assert.equal(r.status, 200);
  return { h, base, calls, d, id: rae.id };
}

test("the live system: page loads never call GitHub; the tick backfills, simulates and serves day/week/month state; drops, today, webhook", async () => {
  const { h, base, calls, d, id } = await hubWithMember();
  try {
    const page = await (await fetch(base + "/world")).text();
    for (const v of ["now", "day", "week", "month"]) assert.ok(page.includes(`data-gview="${v}"`), "switcher: " + v);
    assert.ok(/<button type="button" data-gview="now" aria-pressed="true">/.test(page), "Now (the Current map) is the default");
    assert.ok(page.includes("window.CALDERA_GROWTH=") && page.includes('id="g-bar"') && page.includes("Turtle") && page.includes("Cheetah"), "state embedded, date bar with replay speeds");
    assert.ok(!page.includes('data-wview="expansion"'), "Expansion is gone");
    let s = await (await fetch(base + "/v1/world/state?window=week")).json();
    assert.equal(calls.length, 0, "page and state loads never call GitHub");
    assert.ok(s.members["@rae"], "the member has a plot before any poll (the 2x2 floor)");
    assert.equal(s.members["@rae"].k, 2);
    assert.equal((await fetch(base + "/v1/world/state?window=year")).status, 400);

    await h.admin.growth.tick({ maxPolls: 5, maxBackfills: 5 });
    assert.ok(calls.some(u => u.includes("/repos/rae/app/commits?author=rae")), "commits by the member, from public GitHub");
    const n = h.db.prepare("SELECT COUNT(*) n FROM growth_events WHERE kind='commit' AND void=''").get().n;
    assert.equal(n, 60, "60 earning commits; the bot's commit and the merge commit earn nothing");
    assert.equal(h.db.prepare("SELECT void FROM growth_events WHERE id='c:bot1'").get().void, "bot");
    assert.equal(h.db.prepare("SELECT void FROM growth_events WHERE id='c:m1'").get().void, "merge");
    assert.equal(h.db.prepare("SELECT x FROM growth_events WHERE id='pr:77'").get().x, '{"self":0}', "merged by another account: full points");
    const before = calls.length;
    for (const w of ["day", "week", "month"]) {
      s = await (await fetch(base + "/v1/world/state?window=" + w)).json();
      const m = s.members["@rae"];
      assert.equal(s.window, w); assert.ok(m.l.length === m.k * m.k && m.l0.length === m.k0 * m.k0, "lots now and at the window's start");
      assert.equal(m.hist.length, w === "day" ? 24 : w === "week" ? 28 : 30);
      if (w === "month") { assert.ok(m.w.c > 0 && m.g.length > 0 && m.k >= 2, "a month of commits bought land: " + JSON.stringify(m.w)); assert.ok(m.fx.some(f => f[0] === "rel"), "the release shows as a ribbon"); }
    }
    assert.equal(calls.length, before, "state reads never call GitHub");
    assert.ok(h.db.prepare("SELECT COUNT(*) n FROM growth_snap").get().n > 25, "daily snapshots stored for the replay");

    const dr = await (await fetch(base + "/v1/world/drops")).json();
    assert.ok(dr.day && Array.isArray(dr.drops) && dr.drops.some(x => x.kind === "airship"), "today's drop manifest");
    const td = await (await fetch(base + "/v1/world/today")).json();
    assert.equal(td.me, null, "signed out: the world's drops only"); assert.ok(td.drops.length > 0);

    // the webhook: off until a secret is configured; then signed payloads only
    const payload = JSON.stringify({ repository: { full_name: "rae/app", private: false }, commits: [{ id: "wh1", author: { username: "rae" }, message: "hook", distinct: true, modified: ["x"], timestamp: new Date().toISOString() }] });
    assert.equal((await fetch(base + "/hooks/github", { method: "POST", body: payload, headers: { "x-github-event": "push" } })).status, 404);
    fs.writeFileSync(path.join(d, "github-webhook.json"), JSON.stringify({ secret: "s3cret" }));
    assert.equal((await fetch(base + "/hooks/github", { method: "POST", body: payload, headers: { "x-github-event": "push", "x-hub-signature-256": "sha256=00" } })).status, 401);
    const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(payload).digest("hex");
    const ok = await (await fetch(base + "/hooks/github", { method: "POST", body: payload, headers: { "x-github-event": "push", "x-hub-signature-256": sig } })).json();
    assert.equal(ok.added, 1);

    // erasing a member removes their growth rows
    h.admin.growth.erase(id); assert.equal(h.db.prepare("SELECT COUNT(*) n FROM growth_events WHERE profile=?").get(id).n, 0);
  } finally { h.server?.close?.(); }
});

test("kill switch: growth off shows the Current map only, no state API", async () => {
  const { h, base } = await hubWithMember({ growth: false });
  try {
    const page = await (await fetch(base + "/world")).text();
    assert.ok(!page.includes("data-gview") && !page.includes("CALDERA_GROWTH=") && !page.includes('id="g-bar"'));
    assert.equal((await fetch(base + "/v1/world/state?window=day")).status, 404);
  } finally { h.server?.close?.(); }
});
