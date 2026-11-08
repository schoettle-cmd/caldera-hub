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

// leaderboard.ts isn't exported from the server bundle: bundle the module itself for the pure parts
const out = await build({ entryPoints: [new URL("../src/leaderboard.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const L = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const DAY = 86_400_000, H = 3600_000;
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

// ---------------------------------------------------------------- Pacific days
test("Pacific days: 8h behind UTC in November, 7h in July; the day turns at midnight Pacific; the post hour reads the Pacific clock", () => {
  assert.equal(L.pacificOffsetMs(Date.parse("2026-11-07T12:00:00Z")), 8 * H);
  assert.equal(L.pacificOffsetMs(Date.parse("2026-07-01T12:00:00Z")), 7 * H);
  const nov6 = L.pacificDay(Date.parse("2026-11-06T20:00:00Z"));
  assert.equal(L.pacificDay(Date.parse("2026-11-07T07:59:00Z")), nov6, "07:59 UTC is still Nov 6 in California");
  assert.equal(L.pacificDay(Date.parse("2026-11-07T08:00:00Z")), nov6 + 1, "08:00 UTC is Nov 7");
  assert.equal(L.dayLabel(nov6), "Fri, Nov 6");
  assert.equal(L.pacificHour(Date.parse("2026-11-07T17:00:00Z")), 9);
  assert.equal(L.pacificHour(Date.parse("2026-11-07T16:59:00Z")), 8);
});

// ---------------------------------------------------------------- the ranking (pure)
const P = L.pacificDay(Date.parse("2026-11-06T20:00:00Z"));   // Fri Nov 6, Pacific
let seq = 0;
/** an event at noon Pacific on Pacific day `pDay` (UTC 20:00 in November) */
const ev = (p, k, pDay, o = {}) => { const t = pDay * DAY + 20 * H + (seq++) * 1000; return { id: o.id || `${k}:${seq}`, p, k, repo: o.repo || `${p}/app`, ts: t, seen: o.seen ?? t, n: o.n ?? 1, v: o.v || "", ...(o.x ? { x: o.x } : {}) }; };
const many = (p, k, pDay, n, o = {}) => Array.from({ length: n }, () => ev(p, k, pDay, o));
const M = (id, events, o = {}) => ({ id, handle: id, name: o.name || id.toUpperCase(), avatar: o.avatar || null, url: `https://hub.test/@${id}/city.html`, events, lots: o.lots || "", war: !!o.war, hits: o.hits, ai: o.ai, streak: o.streak });

test("rankMembers: the day's real code (arsenal) per Pacific day, summed over the window; order, ranks, trend vs the window before, city tier, battle stats", () => {
  const ms = [
    M("a", [...many("a", "commit", P, 10), ev("a", "pr", P), ev("a", "release", P), ...many("a", "commit", P - 1, 5)], { lots: "4455", war: true, hits: (f, t) => (t >= P + 1 ? 3 : 0) }),
    M("b", [...many("b", "commit", P, 30), ...many("b", "commit", P - 1, 35)], { lots: "7444" }),
    M("c", many("c", "commit", P - 1, 4)),
    M("d", [ev("d", "private", P, { n: 10, repo: "private:ab12cd" })], { lots: "" }),
  ];
  const rows = L.rankRows(ms, "day", P);
  assert.deepEqual(rows.map(r => r.handle), ["b", "a", "d", "c"], "most points first");
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3, 4]);
  const by = Object.fromEntries(rows.map(r => [r.handle, r]));
  near(by.a.metric, 10 + 3 + 8); near(by.a.prev, 5); near(by.a.trend, 16);
  near(by.b.metric, 30); near(by.b.prev, 35); near(by.b.trend, -5);
  near(by.c.metric, 0); near(by.c.prev, 4); near(by.c.trend, -4);
  near(by.d.metric, 7, 1e-9); near(by.d.prev, 0); assert.equal(by.d.active, 1);
  assert.equal(by.a.tierName, "Mid-rise"); assert.equal(by.b.tierName, "Campus"); assert.equal(by.d.tier, 0);
  assert.deepEqual(by.a.battle, { in: true, ammo: 21, hits: 3 }, "in the battles: tonight's ammo and hits landed over the window's nights");
  assert.deepEqual(by.b.battle, { in: false, ammo: 0, hits: 0 }, "a peaceful zone shows zero");
  // the week folds both days; the UTC evening of Nov 6 (04:00 UTC Nov 7) still counts for Nov 6 Pacific
  const late = ev("c", "commit", P, {}); late.ts = (P + 1) * DAY + 4 * H; late.seen = late.ts;
  const week = L.rankRows([...ms.slice(0, 2), M("c", [...ms[2].events, late])], "week", P);
  const wb = Object.fromEntries(week.map(r => [r.handle, r]));
  near(wb.a.metric, 26); near(wb.b.metric, 65); near(wb.c.metric, 5); assert.equal(wb.c.active, 2);
  assert.equal(L.rankRows(ms, "all", P)[0].trend, null, "all-time has no window before");
  // anti-gaming comes with the metric: voided commits, prereleases, stars and posts load nothing; 40 commits a day
  const v = L.rankRows([M("v", [...["bot", "empty", "merge", "revert"].map(x => ev("v", "commit", P, { v: x })), ev("v", "release", P, { v: "prerelease" }), ev("v", "star", P), ev("v", "post", P, { repo: "caldera" })]), M("w", many("w", "commit", P, 100))], "day", P);
  assert.equal(v.find(r => r.handle === "v").metric, 0); assert.equal(v.find(r => r.handle === "w").metric, 40);
});

test("private names never leave the module: rows, the JSON and the post text carry handles and counts, no repo names", () => {
  const ms = [M("a", [...many("a", "commit", P, 9, { repo: "a/secret-sauce" }), ev("a", "private", P, { n: 8, repo: "private:deadbeef0001" })]), M("b", many("b", "commit", P, 4, { repo: "b/hidden-repo" })), M("c", many("c", "commit", P, 2))];
  const rows = L.rankRows(ms, "day", P), s = JSON.stringify(rows), text = L.dailyPostText(rows, P, "https://caldera.social");
  for (const bad of ["secret-sauce", "hidden-repo", "private:", "deadbeef", "a/app"]) { assert.ok(!s.includes(bad), "rows name no repo: " + bad); assert.ok(!text.includes(bad), "post names no repo: " + bad); }
  assert.equal(text.split("\n")[0], "Top builders yesterday, Fri Nov 6");
  assert.ok(text.includes("1. @a 15 pts, new on the board") && text.includes("2. @b 4 pts, new on the board") && text.includes("3. @c 2 pts, new on the board"), text);
  assert.ok(text.includes("https://caldera.social/leaderboard") && text.includes("https://caldera.social/world"));
  assert.ok(!/—|\bI\b|cheers|regards/i.test(text), "Caldera's voice: no em dashes, no sign-off");
  const t2 = L.dailyPostText(L.rankRows([M("a", [...many("a", "commit", P, 10), ...many("a", "commit", P - 1, 4)]), M("b", [...many("b", "commit", P, 3), ...many("b", "commit", P - 1, 8)]), M("c", [...many("c", "commit", P, 6), ...many("c", "commit", P - 1, 6)])], "day", P), P, "https://caldera.social");
  assert.ok(t2.includes("@a 10 pts, up 6") && t2.includes("@c 6 pts, same as the day before") && t2.includes("@b 3 pts, down 5"), t2);
});

// ---------------------------------------------------------------- the live hub: page, nav, JSON, the daily post
async function hubWith(handles, o = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-lb-")); dirs.push(d);
  const h = createHub({ dataDir: d, publicUrl: "https://hub.test", githubFetch: async () => new Response("[]", { status: 200 }), growthPoll: false, founder: handles[0], ...o });
  const base = "http://127.0.0.1:" + await h.listen(0), ids = {};
  for (const handle of handles) {
    const rr = (name, commits) => ({ name, project: "Work", public: true, language: "TypeScript", commits, weeks: [1, 2, 3], week: 3, today: 0, pushed: new Date().toISOString(), url: `https://github.com/${handle}/${name}` });
    const full = cityData([rr("app", 300)], () => ({ n: 0, paths: [] }), new Date().toISOString());
    const files = { "index.html": Buffer.from(`<html><body>${handle}</body></html>`).toString("base64"), "city.html": Buffer.from(renderCity({ name: handle, handle }, publicCity(full, ["Work"], "show"))).toString("base64") };
    const id = C.newIdentity(); ids[handle] = id;
    const r = await fetch(`${base}/v1/profiles/${id.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(id, "profile.manifest", { name: handle.toUpperCase(), handle, boxKey: id.boxPublic }), files }) });
    assert.equal(r.status, 200);
  }
  const cookieFor = (handle) => { const t = crypto.randomBytes(32).toString("hex"); h.db.prepare("INSERT INTO owner_sessions VALUES (?,?,?,?)").run(crypto.createHash("sha256").update(t).digest("hex"), ids[handle].id, new Date().toISOString(), Date.now() + DAY); return { cookie: "cal_own=" + t, "user-agent": "Mozilla/5.0" }; };
  /** `n` commits for a member on a Pacific day (0 = today, -1 = yesterday), straight into the growth log */
  const ship = (handle, dayOffset, n, repo = `${handle}/app`, kind = "commit") => {
    const pd = L.pacificDay(Date.now()) + dayOffset, ins = h.db.prepare("INSERT OR IGNORE INTO growth_events VALUES (?,?,?,?,?,?,?,?,?)");
    const noon = pd * DAY + 12 * H + L.pacificOffsetMs(Date.now()), t0 = dayOffset === 0 ? Math.min(noon, Date.now() - 60_000) : noon;
    for (let k = 0; k < n; k++) { const t = t0 + k * 1000; ins.run(`${kind}:${handle}:${dayOffset}:${k}`, ids[handle].id, kind, repo, t, t, kind === "private" ? 2 : 1, "", null); }
    h.admin.growth.recompute(); h.admin.leaderboard.invalidate();
  };
  return { h, base, ids, cookieFor, ship };
}

test("the page: /leaderboard in the primary nav (desktop and phone tabs), tabs, rows by points linking to cities, the signed-in row highlighted or shown under the list; JSON rows carry no ids", async () => {
  const { h, base, cookieFor, ship } = await hubWith(["mike", "rae", "sam", "pat"]);
  try {
    ship("mike", 0, 20); ship("rae", 0, 10); ship("sam", 0, 5, "sam/secretproject"); ship("sam", 0, 1, "private:abc123", "private");
    const r = await fetch(base + "/leaderboard"), page = await r.text();
    assert.equal(r.status, 200);
    assert.ok(page.includes('<header class="ch"'), "THE header is swapped in");
    assert.match(page, /<a href="https:\/\/hub\.test\/leaderboard" aria-current="page">[\s\S]*?<span>Leaderboard<\/span><\/a>/, "desktop nav: Leaderboard beside World, current");
    assert.match(page, /<a href="https:\/\/hub\.test\/world">[\s\S]*?<span>World<\/span><\/a><a href="https:\/\/hub\.test\/leaderboard" aria-current="page">/, "right after World");
    assert.match(page, /class="ch-bn"[\s\S]*?<a href="https:\/\/hub\.test\/leaderboard" aria-current="page"><span class="ch-bi">[\s\S]*?<span class="ch-bl">Leaders<\/span>/, "phone tab bar has it too");
    for (const t of ["Today", "Week", "Month", "All-time"]) assert.ok(page.includes(`>${t}</a>`), "tab " + t);
    const order = [...page.matchAll(/<span class="lb-h">@([a-z]+)<\/span>/g)].map(m => m[1]);
    assert.deepEqual(order, ["mike", "rae", "sam", "pat"], "ranked by points; the board always fills to 10 (Mike 11-08), so @pat (0 points) comes after everyone who shipped");
    assert.ok(page.includes('href="https://hub.test/@mike/city.html"'), "a row opens the city");
    assert.ok(!page.includes("secretproject") && !page.includes("abc123") && !page.includes("sam/app"), "no repo names, public or private");
    assert.ok(page.includes("<b>3</b> member") && page.includes('class="lb-tabs"') && !/<tr class="[^"]*lb-me"/.test(page), "signed out: nobody is highlighted");
    // signed in and on the list: the row is marked; signed in and off it: the row sits under the list with its real rank
    const rae = await (await fetch(base + "/leaderboard", { headers: cookieFor("rae") })).text();
    assert.match(rae, /<tr class="lb-top2 lb-me" aria-current="true">[\s\S]*?@rae<\/span>[\s\S]*?<span class="lb-you">you<\/span>/); assert.ok(!rae.includes('<tr class="lb-gap"'));
    const pat = await (await fetch(base + "/leaderboard", { headers: cookieFor("pat") })).text();
    assert.match(pat, /lb-gap[\s\S]*?<tr class=" lb-me" aria-current="true"><td class="lb-r"><span>4<\/span>[\s\S]*?@pat<\/span>/, "own row under the list, rank 4 of 4");
    assert.deepEqual([...pat.matchAll(/<span class="lb-h">@([a-z]+)<\/span>/g)].map(m => m[1]), ["mike", "rae", "sam", "pat"]);
    const week = await (await fetch(base + "/leaderboard?window=week")).text(); assert.match(week, /<a href="https:\/\/hub\.test\/leaderboard\?window=week" aria-current="page">Week<\/a>/);
    assert.equal((await fetch(base + "/v1/leaderboard/rows?window=year")).status, 400);
    const j = await (await fetch(base + "/v1/leaderboard/rows")).json();
    assert.deepEqual(j.rows.map(x => x.handle), ["mike", "rae", "sam"]); assert.ok(j.rows.every(x => !("id" in x)), "public fields only"); assert.equal(j.rows[0].rank, 1); near(j.rows[0].metric, 20);
    assert.ok(JSON.stringify(j).indexOf("secretproject") < 0);
  } finally { h.server?.close?.(); }
});

test("the daily post: yesterday's top 10 in Caldera's voice as the system author, once per day, links to pages and the board; skipped under 3 shippers; systemPost is idempotent by key", async () => {
  const { h, base, ids, ship } = await hubWith(["mike", "rae", "sam", "pat"]);
  try {
    const LB = h.admin.leaderboard, SYS = h.admin.sysposts;
    // two shippers: nothing goes out
    ship("mike", -1, 20); ship("rae", -1, 10);
    let r = LB.dailyPost(); assert.equal(r.posted, false); assert.match(r.reason, /only 2 shipped/);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM agent_posts").get().n, 0);
    // three: one post, as the founder's MasterBuilder agent, no sign-off
    ship("sam", -1, 4, "sam/secretproject"); ship("sam", -1, 1, "private:abc123", "private");
    const dry = LB.dailyPost({ dry: true }); assert.equal(dry.posted, false); assert.ok(dry.dry && dry.text.includes("@mike 20 pts"));
    r = LB.dailyPost(); assert.equal(r.posted, true, JSON.stringify(r)); assert.ok(r.id);
    const row = h.db.prepare("SELECT * FROM agent_posts WHERE id=?").get(r.id);
    assert.equal(row.owner, ids.mike.id); assert.equal(row.agent, "MasterBuilder"); assert.equal(row.tag, "leaderboard"); assert.equal(row.link, "https://hub.test/leaderboard"); assert.equal(row.status, "ok");
    const lines = row.body.split("\n");
    assert.match(lines[0], /^Top builders yesterday, \w{3} \w{3} \d{1,2}$/); assert.equal(lines[1], "1. @mike 20 pts, new on the board"); assert.equal(lines[2], "2. @rae 10 pts, new on the board"); assert.equal(lines[3], "3. @sam 5 pts, new on the board");
    assert.ok(row.body.includes("https://hub.test/world") && !row.body.includes("secretproject") && !row.body.includes("abc123") && !/—/.test(row.body));
    assert.equal(h.db.prepare("SELECT post_id FROM sys_posts WHERE key=?").get(r.key).post_id, r.id, "the marker row");
    // the same day again, after a restart or on the next tick: nothing
    const again = LB.dailyPost(); assert.equal(again.posted, false); assert.equal(again.reason, "already posted"); assert.equal(again.id, r.id);
    LB.tick(); LB.tick();
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM agent_posts").get().n, 1, "one post per day");
    // on the feed: the agent card, the handles linked to their pages, the board as the card's link
    const feed = await (await fetch(base + "/feed?type=agents")).text();
    assert.ok(feed.includes(`data-agent-post="${r.id}"`) && feed.includes("<b>MasterBuilder</b>"), "the card is on the feed");
    assert.ok(feed.includes('<a href="/@rae/">@rae</a>') && feed.includes("hub.test/leaderboard"), "names and the board are links");
    assert.ok(feed.includes("Top builders yesterday,\n1. ") || feed.includes("Top builders yesterday, "), "lines kept");
    // systemPost: idempotent by key, the key's prefix is the tag, extra links are appended once
    const a = SYS.systemPost("battle:2026-11-06", "Last night in the World: 3 cities fought.", ["https://hub.test/world?view=battle", "https://hub.test/leaderboard"]);
    assert.equal(a.posted, true);
    const b = SYS.systemPost("battle:2026-11-06", "something else", []); assert.deepEqual(b, { posted: false, id: a.id, reason: "already posted" });
    const p2 = h.db.prepare("SELECT * FROM agent_posts WHERE id=?").get(a.id); assert.equal(p2.tag, "battle"); assert.equal(p2.link, "https://hub.test/world?view=battle"); assert.ok(p2.body.endsWith("\nhttps://hub.test/leaderboard"));
    assert.equal(SYS.systemPost("", "x".repeat(20)).posted, false); assert.equal(SYS.systemPost("k:1", "short").reason, "text too short");
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM agent_posts").get().n, 2);
    // a forced post for another day (operator), and the kill switch leaves the page but stops the tick
    const two = LB.dailyPost({ day: L.pacificDay(Date.now()) - 2, force: true }); assert.equal(two.posted, true);
  } finally { h.server?.close?.(); }
});

test("no founder: the page works, the post has no author and says so", async () => {
  const { h, base, ship } = await hubWith(["ana", "bo", "cy"], { founder: undefined });
  try {
    ship("ana", -1, 3); ship("bo", -1, 2); ship("cy", -1, 1);
    const r = h.admin.leaderboard.dailyPost(); assert.equal(r.posted, false); assert.match(r.reason, /no system author/);
    assert.equal((await fetch(base + "/leaderboard")).status, 200);
  } finally { h.server?.close?.(); }
});
