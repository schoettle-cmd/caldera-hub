import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

// The Frontier (Mike 11-17, frontier-design D-I): members add a friend's GitHub as an unclaimed land; the owner claims it
// with a matching GitHub sign-in (the adder earns 50); anyone can remove it. Public GitHub data only; nobody is contacted.
const out = await build({ entryPoints: [new URL("../src/frontier.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const F = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const sout = await build({ entryPoints: [new URL("../src/frontierseed.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", write: false });
const SEED = await import("data:text/javascript;base64," + Buffer.from(sout.outputFiles[0].text).toString("base64"));
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test("frontier: GitHub username rule, Pacific day start, the seed list", () => {
  for (const ok of ["a", "kestrel-dev", "A1-b2", "x".repeat(39)]) assert.ok(F.GH_LOGIN.test(ok), ok);
  for (const no of ["", "-a", "a-", "a--b", "a_b", "x".repeat(40), "a b"]) assert.ok(!F.GH_LOGIN.test(no), no);
  const t = Date.parse("2026-11-18T07:30:00Z"), s = F.pacificDayStart(t);   // 23:30 Pacific on the 17th
  assert.equal(new Date(s).toISOString(), "2026-11-17T08:00:00.000Z");
  assert.ok(SEED.FRONTIER_SEED.length >= 200 && SEED.FRONTIER_SEED.length <= 260, String(SEED.FRONTIER_SEED.length));
  assert.equal(new Set(SEED.FRONTIER_SEED.map(x => x.toLowerCase())).size, SEED.FRONTIER_SEED.length, "no duplicates");
  assert.ok(SEED.FRONTIER_SEED.every(x => F.GH_LOGIN.test(x)), "every seed is a valid username");
  // land buildings: public repos only, the busiest first, capped
  const R = F.landRepos([...Array(20)].map((_, i) => ({ name: "r" + i, commits: i, public: true, language: "Go" })).concat([{ name: "shop", kind: "app", commits: 999 }]), "kes");
  assert.equal(R.length, F.FRONTIER.perLand); assert.equal(R[0].name, "r19"); assert.ok(R.every(r => r.project === "@kes/GitHub" && !r.kind));
});

// GitHub, faked: three people, one organization; each person has two public repos
const USERS = { "kestrel-dev": { id: 9001, type: "User", name: "Kes Arroyo" }, hollis: { id: 9002, type: "User", name: "Hollis" }, marrow: { id: 9003, type: "User", name: "Marrow" },
  "caldera-labs": { id: 9100, type: "Organization", name: "Caldera Labs" } };
let ghCalls = 0;
async function gh(url) {
  ghCalls++;
  const u = new URL(String(url)), m = /^\/users\/([^/]+)(\/repos)?$/.exec(u.pathname), key = m && decodeURIComponent(m[1]).toLowerCase(), who = key && USERS[key];
  if (m && !who) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  if (m && !m[2]) return new Response(JSON.stringify({ login: key, id: who.id, type: who.type, name: who.name, public_repos: 2, email: "never@read.test" }), { status: 200 });
  if (m) return new Response(JSON.stringify(["alpha", "beta"].map((n, i) => ({ name: n, full_name: key + "/" + n, language: "Go", size: 100 + i, fork: false, private: false, archived: false, pushed_at: new Date().toISOString(), created_at: "2020-01-01T00:00:00Z", html_url: `https://github.com/${key}/${n}` }))), { status: 200 });
  return new Response("[]", { status: 200 });
}
async function hubWith(handles) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-frontier-")); dirs.push(d);
  const h = createHub({ dataDir: d, publicUrl: "https://hub.test", githubFetch: gh, growthPoll: false, email: { send: async () => {} } });
  const base = "http://127.0.0.1:" + await h.listen(0), ids = {};
  after(() => { h.server.closeAllConnections?.(); h.server.close(); h.privateServer?.close?.(); });
  for (const handle of handles) {
    const full = cityData([{ name: "app", project: "Work", public: true, language: "TypeScript", commits: 50, weeks: [1], week: 1, today: 0, pushed: new Date().toISOString() }], () => ({ n: 0, paths: [] }), new Date().toISOString());
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
  const get = async (w, p) => { const r = await fetch(base + p, { headers: { cookie: await cookie(w) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  /** a GitHub sign-in on this browser as `login` (the gh_accounts session cookie), linked to profile `pid` */
  const ghAs = (login, pid, handle) => {
    const t = crypto.randomBytes(12).toString("hex"), u = USERS[login];
    h.db.prepare("INSERT OR REPLACE INTO gh_accounts (gh_id, login, profile_id, handle, created) VALUES (?,?,?,?,?)").run(u.id, login, pid, handle, new Date().toISOString());
    h.db.prepare("INSERT INTO gh_sessions VALUES (?,?,?)").run(crypto.createHash("sha256").update(t).digest("hex"), u.id, Date.now() + 86_400_000);
    return "cal_s=" + t;
  };
  const page = async (p, ck = "", init = {}) => { const r = await fetch(base + p, { redirect: "manual", ...init, headers: { cookie: ck, ...(init.headers || {}) } }); return { status: r.status, html: await r.text(), loc: r.headers.get("location") }; };
  return { h, base, ids, as, get, ghAs, page, cookie };
}

test("live frontier: lookup states, add (idempotent, daily limit), world map, bombs on a land, claim pays the adder once, remove paths", async () => {
  const { h, base, ids, as, get, ghAs, page, cookie } = await hubWith(["ana", "bo"]);
  try {
    const FR = h.admin.frontier; assert.ok(FR);
    // lookups: members only; every state of D3
    assert.equal((await fetch(base + "/v1/frontier/lookup?u=hollis")).status, 401);
    const look = async u => (await get("ana", "/v1/frontier/lookup?u=" + encodeURIComponent(u))).body;
    assert.equal((await look("kestrl-dev")).st, "missing");
    assert.equal((await look("caldera-labs")).st, "org");
    assert.equal((await look("bo")).st, "member");
    const nw = await look("@Kestrel-Dev"); assert.equal(nw.st, "new"); assert.equal(nw.name, "Kes Arroyo"); assert.equal(nw.repos, 2); assert.equal(nw.left, 20);
    assert.ok(!JSON.stringify(nw).includes("never@read.test"), "no email, ever");
    // add: needs the same origin; then a land; adding again returns the same land
    assert.equal((await fetch(base + "/v1/frontier/add", { method: "POST", headers: { "content-type": "application/json", cookie: await cookie("ana"), origin: "https://evil.test" }, body: JSON.stringify({ login: "kestrel-dev" }) })).status, 403);
    let r = await as("ana", "/v1/frontier/add", { login: "kestrel-dev" });
    assert.equal(r.status, 200); assert.equal(r.body.st, "added"); assert.equal(r.body.claim, "https://hub.test/claim/kestrel-dev"); assert.equal(r.body.left, 19);
    r = await as("bo", "/v1/frontier/add", { login: "KESTREL-DEV" }); assert.equal(r.body.st, "land"); assert.equal(r.body.by, "@ana", "idempotent: the first adder keeps it");
    assert.equal((await look("kestrel-dev")).st, "land");
    assert.equal((await as("ana", "/v1/frontier/add", { login: "hollis" })).status, 200);
    // the daily limit (20 a Pacific day)
    h.db.prepare("UPDATE frontier_lands SET ts=? WHERE adder=?").run(Date.now(), ids.ana.id);
    for (let i = 0; i < 18; i++) h.db.prepare("INSERT INTO frontier_lands (lc, login, gh_id, adder, ts, state, slot, city) VALUES (?,?,?,?,?,?,?,?)").run("x" + i, "x" + i, 1e6 + i, ids.ana.id, Date.now(), "removed", 100 + i, "[]");
    r = await as("ana", "/v1/frontier/add", { login: "marrow" }); assert.equal(r.status, 429); assert.equal(r.body.st, "limit");
    h.db.prepare("DELETE FROM frontier_lands WHERE lc LIKE 'x%'").run();
    const mine = (await get("ana", "/v1/frontier/mine")).body; assert.deepEqual(mine.lands.map(l => l.login).sort(), ["hollis", "kestrel-dev"]);

    // the world map carries the lands as fogged districts on the edge, with who added them
    const w = await page("/world");
    assert.equal(w.status, 200);
    const data = JSON.parse(/window\.CALDERA_CITY\s*=\s*(\{.*?\});?<\/script>/s.exec(w.html)?.[1] || w.html.slice(w.html.indexOf('{"generated"'), w.html.indexOf('</script>', w.html.indexOf('{"generated"'))).replace(/;$/, ""));
    const ucd = data.districts.filter(d => d.uc);
    assert.deepEqual(ucd.map(d => d.nb).sort(), ["@hollis", "@kestrel-dev"]); assert.equal(ucd.find(d => d.nb === "@kestrel-dev").by, "@ana");
    assert.ok(ucd.every(d => d.repos.length === 2 && d.repos.every(x => x.public)));
    assert.equal(data.world.uc["@kestrel-dev"].by, "@ana");

    // Armory: a land is a target; a word can't name it; a removed land's bomb is refunded
    const BT = h.admin.battle;
    assert.ok(BT, "battles on"); {
      BT.optIn(ids.ana.id, { since: 0 });
      h.db.prepare("INSERT INTO ledger VALUES (?,?,?,?,?)").run(ids.ana.id, 200, "test", "", new Date().toISOString());
      const me = (await get("ana", "/v1/world/battle/me")).body;
      assert.ok(me.armory, "the Armory is open"); {
        assert.deepEqual(me.armory.lands, ["@hollis", "@kestrel-dev"]);
        assert.equal((await as("ana", "/v1/world/battle/armory", { bombs: [{ k: "nova", word: "hollis" }] })).status, 422, "a word can't name an unclaimed land");
        r = await as("ana", "/v1/world/battle/armory", { bombs: [{ k: "inferno", word: "hello", target: "@hollis" }, { k: "sparkler", word: "hi", target: "@kestrel-dev" }] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const bal = (await get("ana", "/v1/world/battle/me")).body.armory.balance;
        // path B: hidden at once, no sign-in; the bomb at it comes back
        let rm = await page("/claim/hollis/remove", "", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://hub.test" }, body: "act=hide&u=hollis&note=please" });
        assert.equal(rm.status, 200); assert.match(rm.html, /The land is hidden\. Your request is sent\./);
        assert.equal((await get("ana", "/v1/world/battle/me")).body.armory.balance, bal + 25, "refunded the inferno");
        assert.equal((await look("hollis")).st, "removed", "nobody can add it again");
        assert.equal((await page("/gh/hollis")).status, 410, "the /gh preview is hidden too");
        assert.ok(!(await page("/world")).html.includes('"nb":"@hollis"'), "off the map");
        assert.equal(FR.store.pending().length, 1); assert.equal(FR.store.pending()[0].note, "please");
        FR.store.confirm("hollis", Date.now()); assert.equal(FR.store.pending().length, 0);
        assert.equal(h.db.prepare("SELECT note FROM frontier_block WHERE note IS NOT NULL").all().length, 0, "the note is dropped once checked");
        // the night: the bomb at the land flies and hits it
        const night = me.armory.night; BT.resolve(night);
        const hit = h.db.prepare("SELECT * FROM battle_shots WHERE night=?").all(night).map(s => ({ ...s, x: JSON.parse(s.x || "null") })).filter(s => s.x && s.x.bk);
        assert.deepEqual(hit.map(s => [s.d, s.x.word]), [["uc:kestrel-dev", "HI"]]);
      }
    }

    // claim page before sign-in: the facts, the GitHub button, no email asked
    let cp = await page("/claim/kestrel-dev");
    assert.equal(cp.status, 200); assert.match(cp.html, /@kestrel-dev, this city is yours to claim\./); assert.match(cp.html, /href="\/auth\/github\?back=%2Fclaim%2Fkestrel-dev%3Fgo%3D1"/);
    assert.match(cp.html, /<dd>2 public repos as buildings/); assert.match(cp.html, /<a href="\/@ana\/">@ana<\/a> on /);
    assert.match(cp.html, /noindex/);
    // the wrong GitHub account: nothing changes
    const wrong = ghAs("marrow", null, null);
    cp = await page("/claim/kestrel-dev?go=1", wrong); assert.match(cp.html, /You signed in as @marrow\./); assert.equal(FR.store.get("kestrel-dev").state, "live");
    // the right account (a new member "kes" made by the GitHub sign-in): claimed, the adder paid once, a bell row, not in the battles
    const kes = C.newIdentity();
    await fetch(`${base}/v1/profiles/${kes.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(kes, "profile.manifest", { name: "Kes", handle: "kes", boxKey: kes.boxPublic }), files: { "index.html": Buffer.from("<html></html>").toString("base64") } }) });
    const right = ghAs("kestrel-dev", kes.id, "kes");
    cp = await page("/claim/kestrel-dev?go=1", right);
    assert.equal(cp.status, 200); assert.match(cp.html, /Your city is lit, @kestrel-dev\./); assert.match(cp.html, /<b>@ana<\/b> brought you to Caldera and earned 50 credits\./);
    const paid = () => h.db.prepare("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE who=? AND reason LIKE 'frontier:%'").get(ids.ana.id).s;
    assert.equal(paid(), 50);
    await page("/claim/kestrel-dev?go=1", right); assert.equal(paid(), 50, "paid once");
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM alerts WHERE target=? AND dkey='frontier:kestrel-dev'").get(ids.ana.id).n, 1);
    if (BT) assert.equal(h.db.prepare("SELECT out FROM battle_opt WHERE profile=?").get(kes.id)?.out, 1, "a claim does not join the battles");
    cp = await page("/claim/kestrel-dev", right); assert.equal(cp.status, 302); assert.equal(cp.loc, "/@kes/city.html", "their own old link goes to their city");
    cp = await page("/claim/kestrel-dev"); assert.match(cp.html, /This land is claimed\./);
    assert.equal((await get("bo", "/v1/frontier/lookup?u=kestrel-dev")).body.st, "member");
    // no land / removed
    cp = await page("/claim/nobody-here"); assert.equal(cp.status, 404); assert.match(cp.html, /Nobody added @nobody-here to the map\./);
    cp = await page("/claim/hollis"); assert.equal(cp.status, 404); assert.match(cp.html, /@hollis is not on Caldera\./);

    // path A: sign in as the owner, confirm, removed at once
    assert.equal((await as("bo", "/v1/frontier/add", { login: "marrow" })).status, 200);
    cp = await page("/claim/marrow/remove?go=1", wrong); assert.match(cp.html, /Remove your land now\?/);
    cp = await page("/claim/marrow/remove", wrong, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://hub.test" }, body: "act=remove" });
    assert.match(cp.html, /Your land is removed\./); assert.equal(FR.store.get("marrow").state, "removed"); assert.deepEqual(FR.store.get("marrow").city, []);
    assert.equal((await get("bo", "/v1/frontier/lookup?u=marrow")).body.st, "removed");
    // and a cross-site post changes nothing
    assert.equal((await page("/claim/kestrel-dev/remove", "", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.test" }, body: "act=hide&u=kestrel-dev" })).status, 403);
  } finally { h.server.close(); }
});

test("frontier: the seed adds as Caldera, skips orgs and missing names for good, and never contacts anyone", async () => {
  const { h } = await hubWith(["ana"]);
  try {
    const FR = h.admin.frontier, c0 = ghCalls;
    const n = await FR.seedSome(["caldera-labs", "no-such-person", "hollis", "kestrel-dev"], 5);
    assert.equal(n, 2);
    assert.deepEqual(FR.store.live().map(l => [l.login, l.adder]), [["hollis", "caldera"], ["kestrel-dev", "caldera"]]);
    const c1 = ghCalls; assert.equal(await FR.seedSome(["caldera-labs", "no-such-person", "hollis", "kestrel-dev"], 5), 0); assert.equal(ghCalls, c1, "skipped names are not looked up again");
    assert.ok(ghCalls > c0);
    assert.equal(FR.store.blocked("caldera-labs"), false, "a skipped seed is not on the do-not-add list");
  } finally { h.server.close(); }
});

test("frontier UI: the World add box, the Armory target picker, and the owner-only profile section", async () => {
  const { as, page, cookie } = await hubWith(["ana", "bo"]);
  assert.equal((await as("ana", "/v1/frontier/add", { login: "kestrel-dev" })).status, 200);
  const w = await page("/world");
  assert.match(w.html, /<form class="w-add" id="w-add"/);
  assert.match(w.html, /class="b-ar-tb"/, "the picker replaces the target select");
  assert.ok(!/<select id="b-ar-t-/.test(w.html));
  assert.match(w.html, /window\.CALDERA_ARMORY_TARGET = function/);
  assert.match(w.html, /function ucCard\(/, "the unclaimed card is in the renderer");
  const mine = await page("/@ana/", await cookie("ana"));
  assert.match(mine.html, /Put a friend on the map/);
  assert.match(mine.html, /@kestrel-dev<\/a> &middot; unclaimed/);
  const theirs = await page("/@ana/", await cookie("bo"));
  assert.ok(!/Put a friend on the map/.test(theirs.html), "only on your own profile");
  assert.ok(!/Put a friend on the map/.test((await page("/@ana/")).html), "not for visitors");
});

test("claim page CSS: the phone rules come after the desktop grid, so the page is one column at 390 px", async () => {
  const { CLAIM_CSS } = await import("../dist/frontierpage.js").catch(() => import("../src/frontierpage.ts"));
  const base = CLAIM_CSS.indexOf(".cl-main{display:grid"), ph = CLAIM_CSS.indexOf("@media (max-width:760px){.cl-main{grid-template-columns:minmax(0,1fr)");
  assert.ok(base > 0 && ph > base, "the 760 px rule must follow the base .cl-main rule");
});

test("claim page CSS: the full-width Claim button includes its padding (no 390 px side scroll)", async () => {
  const { CLAIM_CSS } = await import("../dist/frontierpage.js").catch(() => import("../src/frontierpage.ts"));
  assert.match(CLAIM_CSS, /\n\.cl-go\{box-sizing:border-box;max-width:100%;/);
  assert.ok(CLAIM_CSS.includes(".cl a.cl-go,.cl a.cl-go:visited{color:var(--on-accent)"), "the button text stays white, not link purple");
});
