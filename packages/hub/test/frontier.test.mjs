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
  assert.equal(R.length, F.FRONTIER.perLand); assert.equal(R[0].name, "r19");
  // Mike 11-20: old repos (no commits in the last year) still stand tall, by size
  assert.equal(F.landHeight({ commits: 1, size: 29400 }), 1470); assert.equal(F.landHeight({ commits: 500, size: 100 }), 500); assert.equal(F.landHeight({ commits: 0, size: 9e9 }), 3000);
  const T = F.landRepos([{ name: "old-big", commits: 1, size: 40000, public: true }, { name: "new-small", commits: 3, size: 10, public: true }], "kes"); assert.equal(T[0].name, "old-big"); assert.equal(T[0].commits, 2000); assert.ok(R.every(r => r.project === "@kes/GitHub" && !r.kind));
});

// GitHub, faked: three people, one organization; each person has two public repos
const USERS = { "kestrel-dev": { id: 9001, type: "User", name: "Kes Arroyo" }, hollis: { id: 9002, type: "User", name: "Hollis" }, marrow: { id: 9003, type: "User", name: "Marrow" },
  "caldera-labs": { id: 9100, type: "Organization", name: "Caldera Labs" },
  wren: { id: 9004, type: "User", name: "Wren", followers: 40 }, blank: { id: 9005, type: "User", name: "Blank", followers: 9000, repos: 0 } };   // wren: not famous; blank: no code
let ghCalls = 0;
async function gh(url) {
  ghCalls++;
  const u = new URL(String(url)), m = /^\/users\/([^/]+)(\/repos)?$/.exec(u.pathname), key = m && decodeURIComponent(m[1]).toLowerCase(), who = key && USERS[key];
  if (m && !who) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  if (m && !m[2]) return new Response(JSON.stringify({ login: key, id: who.id, type: who.type, name: who.name, public_repos: who.repos ?? 2, followers: who.followers ?? 9000, email: "never@read.test" }), { status: 200 });
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
    // gap 2: the reply carries the land, so the open world map draws it with no reload
    assert.equal(r.body.land.district.nb, "@kestrel-dev"); assert.equal(r.body.land.district.uc, 1); assert.ok(Array.isArray(r.body.land.district.repos) && r.body.land.district.repos.length <= 8); assert.equal(r.body.land.meta.by, "@ana");
    r = await as("bo", "/v1/frontier/add", { login: "KESTREL-DEV" }); assert.equal(r.body.st, "land"); assert.equal(r.body.by, "@ana", "idempotent: the first adder keeps it"); assert.equal(r.body.land.district.nb, "@kestrel-dev");
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
    // gap 1: the claimed land keeps its ring cell: the map gets the old slot and adder for the new member
    assert.deepEqual(FR.claimedSlots()["@kes"], { slot: FR.store.get("kestrel-dev").slot, by: "@ana" });
    assert.match((await page("/world")).html, /"fr":1/);
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
  const { as, page, cookie, base } = await hubWith(["ana", "bo"]);
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
  // gap 3: the profile button opens /add (top level, outside the sandbox) in a new tab
  assert.match(mine.html, /class="pf-add-b" href="https:\/\/hub\.test\/add" target="_blank"/);
  assert.match(mine.html, /\(opens in a new tab\)/);
  const out = await page("/add");
  assert.equal(out.status, 200); assert.match(out.html, /Put a friend on the map/); assert.match(out.html, /href="\/auth\/github\?back=%2Fadd"/); assert.ok(!/id="w-add"/.test(out.html), "signed out: no form");
  const ad = await page("/add", await cookie("ana"));
  assert.match(ad.html, /<form class="w-add ad-form" id="w-add"/); assert.match(ad.html, />Find<\/button>/);
  assert.match(ad.html, /19 of 20 left today/); assert.match(ad.html, /<b>@kestrel-dev<\/b><span class="ad-st">unclaimed<\/span>/);
  assert.match(ad.html, /class="cl-main ad-main"/, "two columns once there is a list");
  assert.match(ad.html, /\.ad-form\[hidden\],\.ad-done\[hidden\],\.ad-list\[hidden\]\{display:none\}/, "the form really hides after an add");
  assert.ok(ad.html.includes(".cl .cl-top a{color:var(--strong)}") && ad.html.includes(".w-add-r a{display:inline-flex;align-items:center}"), "Fable sign-off fixes");
  assert.match(ad.html, /\/v1\/frontier\/lookup\?u=/); assert.match(ad.html, /\.cl\{--text-muted:var\(--muted\)/, "token alias for the add box");
  // gap 2: the world map's live poll carries recent lands, so other members' adds appear on open maps
  const lv = await (await fetch(base + "/v1/world/live")).json();
  assert.ok(Array.isArray(lv.lands) && lv.lands.some(x => x.district.nb === "@kestrel-dev" && x.district.uc === 1));
});

test("World page shell (map audit 11-20, PAGE.md 3, 5d, 6): one header row, the Add a friend popover, the Extras row, the legend sheet", async () => {
  const { page, cookie } = await hubWith(["ana", "bo"]);
  const w = (await page("/world", await cookie("ana"))).html;
  const head = w.match(/<div class="w-head">[\s\S]*?<div class="w-maps">/)[0];
  // header row: title, one sentence per mode, How battles work, Add a friend (D4: the time switch moved onto the map)
  assert.match(head, /^<div class="w-head"><h1>The world<\/h1><p class="w-sent">/);
  assert.ok(!head.includes("data-gview") && !head.includes("data-gmode"), "D4: no time or mode switch in the header");
  assert.match(head, /<span class="w-battle-only">Every city fires at 20:00\.<span class="w-xl"> Cranes rebuild the hits by noon\.<\/span><\/span>/);
  assert.match(head, /<span class="w-now-only">2 cities on one map\.<span class="w-xl"> Tap a name to fly there\.<\/span><\/span>/);
  assert.match(head, /<span class="w-grow-only">Purple outlines are new in this window\.<\/span>/);
  assert.match(head, /<a class="w-how-a" href="\/world\?view=battle&amp;how" data-whow>How battles work<\/a>/);
  for (const gone of ["Cities at war", "Growth from code", "rays of light", "salvo", "Add to the map", "w-add-h\">Add a friend's GitHub"]) assert.ok(!head.includes(gone), "not in the header: " + gone);
  // the popover
  assert.match(head, /<button type="button" class="w-addb" aria-label="Add a friend" title="Add a friend" aria-haspopup="dialog" aria-expanded="false" aria-controls="w-addp">/);
  assert.match(head, /<div class="w-addp" id="w-addp" role="dialog" aria-labelledby="w-addp-t" hidden><h2 id="w-addp-t">Add a friend's GitHub<\/h2><form class="w-add" id="w-add" novalidate>/);
  assert.match(head, /<label class="sr" for="w-add-u">GitHub username of your friend<\/label>/);
  assert.match(head, /placeholder="GitHub username"/);
  assert.match(head, /<button type="submit" class="w-add-b">Add as my friend<\/button>/);
  assert.match(head, />Their city appears at the edge of the map\. It is theirs when they claim it, and then you are friends\. Caldera does not contact them\.<\/p>/);
  assert.match(head, /<div class="w-add-so" hidden><p>Sign in to add a friend\.<\/p><a class="w-add-b" href="\/auth\/github\?back=%2Fworld">Sign in with GitHub<\/a><\/div>/, "signed-out content");
  // the add sends friend:true (the server adds a well-known GitHub as a plain land), and the strings follow PAGE.md 3
  assert.match(w, /body:JSON\.stringify\(\{login:l,friend:true\}\)/);
  for (const s of ["is on the map.</b>", "data-again>Add another</button>", "is on Caldera.</b>", "<b>No GitHub user named @'+e(L)+'.</b> Check the spelling.')", "<b>You added 20 GitHubs today.</b> Add more after midnight Pacific.", "<b>Could not reach GitHub.</b> <button type=\"button\" data-retry>Try again</button>", "<b>Sign in to add a friend.</b>", "has no public code yet."])
    assert.ok(w.includes(s), "string: " + s);
  assert.match(w, /window\.CALDERA_WADD_OPEN=function\(\)\{pop\(true\)\};if\(location\.hash==='#add'\)/, "#add opens the popover");
  assert.match(w, /if\(e\.key==='Escape'&&P&&!P\.hidden\)\{pop\(false,true\)\}/, "Esc closes it and focus goes back to the button");
  assert.match(w, /\.w-addp\{position:absolute;right:0;top:calc\(100% \+ 8px\);z-index:70;width:320px;/);
  assert.match(w, /@media \(max-width:699px\)\{[^@]*\.w-addp\{position:fixed;left:0;right:0;bottom:0;/, "a bottom sheet on phones");
  // How battles work: the battle client's own sheet, with the old Battle paragraph as its first paragraph
  assert.match(w, /var o=document\.querySelector\('\[data-bhow\]'\);if\(typeof window\.CALDERA_BATTLE_HOW==='function'\)/);
  assert.match(w, /var INTRO="Cities at war: every city in the battles/);
  // Extras row at the bottom, then the Power up panel (closed) and the legend sheet
  assert.match(w, /<section class="w-extras" aria-labelledby="w-ex-h"><h2 class="w-exh" id="w-ex-h">Extras<\/h2><div class="w-ex"><span><b>Power up your map\.<\/b> One prompt for your AI: drones, live visitors, private repos\.<\/span><button type="button" class="w-ex-a" data-wpu aria-controls="power-up" aria-expanded="false">Open<\/button><\/div><div class="w-ex"><span><b>Orpheus\.<\/b> More agents, more commits, more missiles\.<\/span><a class="w-ex-a" href="https:\/\/useorpheus\.com\/\?utm_source=caldera&amp;utm_medium=world" target="_blank" rel="noopener[^"]*">Try Orpheus free<\/a><\/div><\/section>/);
  assert.ok(w.indexOf('class="w-extras"') > w.indexOf('id="b-bar"'), "Extras come after the battle deck");
  assert.ok(!w.includes('class="w-foot"') && !w.includes('class="w-orph"'), "the old legend line and Orpheus box are gone");
  assert.match(w, /<button id="t-what" type="button" aria-haspopup="dialog" aria-controls="w-lgd" title="What am I looking at\?">What am I looking at\?<\/button>/, "in the map tools, so the Layers panel carries it");
  const lg = w.match(/<aside class="w-lgd"[\s\S]*?<\/aside>/)[0];
  assert.match(lg, /role="dialog" aria-labelledby="w-lgd-t"/); assert.match(lg, /Rays of light are friendships\./); assert.match(lg, /Dashed coral lines: builds with a similar stack\./);
  assert.match(lg, /Padlocked buildings are private repos: size only, never names\./); assert.match(lg, /Only people listed in <a href="\/people">People<\/a> appear\./);
  // signed out: the same shell; the popover shows its signed-out part (the header says data-state="out")
  const out = (await page("/world")).html;
  assert.match(out, /<div class="w-add-so" hidden>/); assert.match(out, /if\(SO&&hb&&hb\.getAttribute\('data-state'\)==='out'\)\{SO\.hidden=false;if\(F\)F\.hidden=true\}/);
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

test("frontier (Mike 11-20): only famous GitHubs, or a member's friend (a claim makes them friends); no code, no land; Caldera's own non-famous lands are pruned", async () => {
  const { h, base, ids, as, get, ghAs, page } = await hubWith(["ana"]);
  try {
    const FR = h.admin.frontier;
    assert.equal((await get("ana", "/v1/frontier/lookup?u=wren")).body.famous, false); assert.equal((await get("ana", "/v1/frontier/lookup?u=hollis")).body.famous, true);
    assert.equal((await get("ana", "/v1/frontier/lookup?u=blank")).body.st, "nocode");
    let r = await as("ana", "/v1/frontier/add", { login: "wren" }); assert.equal(r.status, 422); assert.equal(r.body.st, "friend", "not famous: only as a friend");
    assert.equal(FR.store.get("wren"), null, "nothing added");
    r = await as("ana", "/v1/frontier/add", { login: "blank", friend: true }); assert.equal(r.status, 422); assert.equal(r.body.st, "nocode");
    r = await as("ana", "/v1/frontier/add", { login: "wren", friend: true }); assert.equal(r.status, 200); assert.equal(r.body.st, "added"); assert.equal(FR.store.get("wren").friend, true);
    r = await as("ana", "/v1/frontier/add", { login: "hollis" }); assert.equal(r.status, 200); assert.equal(FR.store.get("hollis").friend, false, "famous: a plain land");
    // wren claims: wren and ana become friends
    const w = C.newIdentity();
    await fetch(`${base}/v1/profiles/${w.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(w, "profile.manifest", { name: "Wren", handle: "wren", boxKey: w.boxPublic }), files: { "index.html": Buffer.from("<html></html>").toString("base64") } }) });
    const cp = await page("/claim/wren?go=1", ghAs("wren", w.id, "wren")); assert.equal(cp.status, 200);
    assert.equal(FR.store.get("wren").state, "claimed");
    assert.ok(h.db.prepare("SELECT 1 FROM friends WHERE a=? AND b=?").get(w.id, ids.ana.id) && h.db.prepare("SELECT 1 FROM friends WHERE a=? AND b=?").get(ids.ana.id, w.id), "friends both ways");
    // the seed: never a non-famous name; Caldera's own non-famous or code-less lands are pruned, not blocked
    assert.equal(await FR.seedSome(["marrow", "kestrel-dev"], 5), 2);
    USERS.marrow.followers = 12;
    FR.store.add({ login: "blank", gh_id: 9005, name: "Blank", repos: 0, adder: "caldera", city: [] }, Date.now());
    const pr = await FR.pruneSeeds(); assert.deepEqual(pr.pruned.sort(), ["blank", "marrow"]);
    assert.deepEqual(FR.store.live().map(l => l.login).sort(), ["hollis", "kestrel-dev"]);
    assert.equal(FR.store.blocked("marrow"), false, "pruned, not blocked: a member can still add them as a friend");
    assert.equal(await FR.seedSome(["wren2", "marrow"], 5), 0, "a pruned seed is not added again");
    delete USERS.marrow.followers;
  } finally { h.server.close(); }
});
