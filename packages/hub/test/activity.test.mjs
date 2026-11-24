// Settings > Activity (LOOP.md part e, spec 1e): the four counted numbers of the season, and one plain line per repo whose
// repeated automated commits (void 'farm') did not count. Owner only: no other page shows it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createHub } from "../dist/server.js";
const load = async (f) => { const { build } = await import("esbuild"); const o = await build({ entryPoints: [new URL("../src/" + f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false }); return import("data:text/javascript;base64," + Buffer.from(o.outputFiles[0].text).toString("base64")); };
const S = await load("settings.ts"), G = await load("growth.ts");
const DAY = 86400000;
const base = { commits: 318, prs: 14, releases: 2, ci: 96 };
const lines = (html) => (html.match(/did not count this season/g) || []).length;

test("card: nothing left out -> the four numbers and the link, no line", () => {
  const h = S.activityCard({ ...base, voided: [] });
  assert.match(h, /<p class="act-h">Counted this season<\/p>/);
  assert.match(h, /<dl class="act-n"><div><dt>Commits<\/dt><dd>318<\/dd><\/div><div><dt>Merged pull requests<\/dt><dd>14<\/dd><\/div><div><dt>Releases<\/dt><dd>2<\/dd><\/div><div><dt>Green CI runs<\/dt><dd>96<\/dd><\/div><\/dl>/);
  assert.equal(lines(h), 0); assert.doesNotMatch(h, /act-note/);
  assert.match(h, /<a href="\/guide#f-counted">How work is counted<\/a>/);
  assert.doesNotMatch(h, /No counted work yet/);
  // a repo with 0 voided gives no line either
  assert.equal(lines(S.activityCard({ ...base, voided: [{ repo: "you/x", n: 0 }] })), 0);
  assert.doesNotMatch(h, /farm|fraud|role="alert"/i, "plain text, no alarm words");
});

test("card: singular and plural lines, exact words, grey dot hidden", () => {
  const one = S.activityCard({ ...base, voided: [{ repo: "you/standings-bot", n: 1 }] });
  assert.match(one, /<p>1 commit from <code>you\/standings-bot<\/code> did not count this season\. It was a repeated automated commit\. Real work always counts\.<\/p>/);
  const many = S.activityCard({ ...base, voided: [{ repo: "you/standings-bot", n: 1212 }] });
  assert.match(many, /<p>1,212 commits from <code>you\/standings-bot<\/code> did not count this season\. They were repeated automated commits\. Real work always counts\.<\/p>/);
  assert.match(many, /<div class="act-note"><i aria-hidden="true"><\/i>/);
  assert.match(S.activityCard({ ...base, voided: [{ repo: "<b>x", n: 2 }] }), /<code>&lt;b&gt;x<\/code>/, "repo name escaped");
});

test("card: 3 repos -> 3 lines; 4 repos -> 3 lines and '1 more repo'; 5 -> '2 more repos'", () => {
  const r = (k) => Array.from({ length: k }, (_, i) => ({ repo: "you/r" + i, n: 100 - i }));
  const three = S.activityCard({ ...base, voided: r(3) }); assert.equal(lines(three), 3); assert.doesNotMatch(three, /The same is true/);
  const four = S.activityCard({ ...base, voided: r(4) }); assert.equal(lines(four), 3);
  assert.match(four, /<p>The same is true for 1 more repo\.<\/p>/); assert.doesNotMatch(four, /you\/r3/, "the smallest is not named");
  assert.match(S.activityCard({ ...base, voided: r(5) }), /<p>The same is true for 2 more repos\.<\/p>/);
});

test("card: no counted work yet -> zeros and the empty line", () => {
  for (const d of [null, { commits: 0, prs: 0, releases: 0, ci: 0, voided: [] }]) {
    const h = S.activityCard(d);
    assert.match(h, /<p class="act-foot">No counted work yet this season\. Work you push to a connected repo shows here\.<\/p>/);
    assert.equal((h.match(/<dd>0<\/dd>/g) || []).length, 4);
  }
});

test("store: counted = void '' in the season; voided = farm commits by repo, largest first (same as farmCounts)", () => {
  const db = new DatabaseSync(":memory:"), q = (s) => db.prepare(s), st = G.growthStore(q), T = 20770 * DAY;
  let i = 0; const add = (p, k, repo, ts, v = "", n = 1) => st.add({ id: "e" + i++, p, k, repo, ts, seen: ts, n, v });
  for (let j = 0; j < 5; j++) add("m", "commit", "you/app", T + j);
  add("m", "private", "you/secret", T, "", 3);
  add("m", "commit", "you/app", T, "empty"); add("m", "commit", "you/app", T - DAY, "");   // a void that is not farm; before the season
  add("m", "pr", "you/app", T); add("m", "pr", "you/app", T, "self-ci"); add("m", "release", "you/app", T); add("m", "release", "you/app", T, "prerelease"); add("m", "ci_green", "you/app", T);
  for (let j = 0; j < 4; j++) add("m", "commit", "you/bot-a", T + j, "farm");
  for (let j = 0; j < 7; j++) add("m", "commit", "you/bot-b", T + j, "farm");
  add("m", "commit", "you/bot-c", T - DAY, "farm");   // before the season
  add("other", "commit", "them/bot", T, "farm");
  const a = st.activity("m", T);
  assert.deepEqual({ ...a, voided: undefined }, { commits: 8, prs: 1, releases: 1, ci: 1, voided: undefined });
  assert.deepEqual(a.voided, [{ repo: "you/bot-b", n: 7 }, { repo: "you/bot-a", n: 4 }]);
  assert.deepEqual(st.farmCounts(T).filter(r => r.p === "m").map(r => ({ repo: r.repo, n: r.n })), a.voided, "the same count as farm-report");
});

// ---------------------------------------------------------------- the page: owner only
const tmp = []; after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const USERS = { octo: { id: 7, login: "Octo" }, newbie: { id: 8, login: "newbie" } };

test("Settings: the owner sees Activity (nav pill before Notifications, their own line); another member and visitors never do", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-activity-")); tmp.push(d);
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.writeFileSync(path.join(d, "github-app.json"), JSON.stringify({ id: 1, slug: "t", client_id: "cid", client_secret: "csec", pem: privateKey.export({ type: "pkcs1", format: "pem" }) }));
  let who = "octo";
  const fake = async (u, init = {}) => { u = String(u);
    if (u.endsWith("/access_token")) { who = JSON.parse(init.body || "{}").code; return J({ access_token: "tok-" + who, expires_in: 28800 }); }
    if (u.endsWith("/user")) { const x = USERS[who]; return J({ ...x, name: x.login, created_at: "2019-01-01T00:00:00Z", public_repos: 1, followers: 1, html_url: "https://github.com/" + x.login, avatar_url: "https://avatars.githubusercontent.com/u/1" }); }
    if (u.includes("avatars.githubusercontent.com")) return new Response(Buffer.from("png"));
    if (u.includes("/repos?") || u.includes("/events")) return J([]);
    return J({}, 404); };
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: fake, limits: { newProfilesPerDay: 100 } });
  const url = "http://127.0.0.1:" + await h.listen(0);
  const signIn = async (code) => {
    const a = await fetch(url + "/auth/github", { redirect: "manual" });
    const jar = (a.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).filter(c => !c.endsWith("="));
    const state = new URL(a.headers.get("location")).searchParams.get("state");
    const cb = await fetch(url + `/auth/github/callback?code=${code}&state=${state}`, { headers: { cookie: jar.join("; ") }, redirect: "manual" });
    return (cb.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).find(c => c.startsWith("cal_s="));
  };
  const waitFor = async (fn) => { for (let i = 0; i < 60; i++) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  try {
    const sN = await signIn("newbie"), sO = await signIn("octo");
    assert.ok(await waitFor(() => h.db.prepare("SELECT COUNT(*) n FROM profiles WHERE handle IN ('newbie','octo')").get().n === 2));
    const idN = h.db.prepare("SELECT id FROM profiles WHERE handle='newbie'").get().id;
    const ins = h.db.prepare("INSERT INTO growth_events VALUES (?,?,?,?,?,?,?,?,?)"), now = Date.now();
    for (let j = 0; j < 3; j++) ins.run("c:farm" + j, idN, "commit", "newbie/standings-bot", now - 60_000, now, 1, "farm", null);
    ins.run("c:real", idN, "commit", "newbie/app", now - 60_000, now, 1, "", null);
    const mine = await (await fetch(url + "/settings", { headers: { cookie: sN } })).text();
    assert.match(mine, /<a href="\/me\/building">What you&#39;re building<\/a><a href="#activity">Activity<\/a><a href="#notifications">Notifications<\/a>/);
    assert.match(mine, /<h2 class="set-h" id="activity">Activity<\/h2><p class="set-sub">What counted toward your city and your missiles this season\. Only you see this\.<\/p><section class="card act-card"/);
    assert.ok(mine.indexOf('id="activity"') < mine.indexOf('id="notifications"'), "before Notifications");
    assert.match(mine, /<dt>Commits<\/dt><dd>1<\/dd>/);
    assert.match(mine, /3 commits from <code>newbie\/standings-bot<\/code> did not count this season\./);
    const theirs = await (await fetch(url + "/settings", { headers: { cookie: sO } })).text();
    assert.match(theirs, /id="activity"/, "octo has its own card");
    assert.doesNotMatch(theirs, /standings-bot|did not count/, "never another member's line");
    for (const p of ["/@newbie/", "/people", "/leaderboard", "/feed"]) {
      const r = await fetch(url + p, { headers: { cookie: sO } }); const t = await r.text();
      assert.doesNotMatch(t, /act-card|did not count this season/, p);
    }
    assert.equal((await fetch(url + "/settings", { redirect: "manual" })).status, 302, "visitors go to sign in");
  } finally { h.server.close(); }
});
