// Caldera x Orpheus tie, Part 2 (orpheustie.ts; spec 2026-11-22-orpheus-founding-fleet.md section 2): the handle link
// (claim 200/409/410), unlink, the daily fleet feed (add/update/remove, bad feeds rejected), key absent = off, key never leaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHub } from "../dist/server.js";
import { ORPHEUS_HANDLE, parseFeed } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const KEY = "ork_SECRET_7f3a9c1e5b";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ID1 = "11111111-2222-4333-8444-555555555555", ID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", ID3 = "99999999-8888-4777-8666-555555555555";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const jwt = o => "x." + Buffer.from(JSON.stringify(o)).toString("base64url") + ".x";

// every console line while a test runs, to prove the key never reaches a log
const logged = [];
for (const k of ["log", "error", "warn", "info"]) { const o = console[k].bind(console); console[k] = (...a) => { logged.push(a.map(String).join(" ")); o(...a); }; }

async function boot({ key = KEY } = {}) {
  const d = __mkdtemp(path.join(os.tmpdir(), "caldera-orph-"));
  fs.writeFileSync(path.join(d, "google-oauth.json"), JSON.stringify({ client_id: "cid.apps", client_secret: "shh" }));
  const st = { claims: {}, calls: [], reply: {} };
  const google = async (u) => String(u).includes("oauth2.googleapis.com/token") ? J({ id_token: jwt(st.claims) }) : J({}, 404);
  const orph = async (u, init = {}) => {
    const call = { url: String(u), method: init.method || "GET", auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null };
    st.calls.push(call);
    const r = st.reply[new URL(call.url).pathname]; if (!r) return J({}, 404);
    if (r === "throw") throw new Error("network down");
    return typeof r === "function" ? r(call) : J(r.body, r.status ?? 200);
  };
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: google, orpheusFetch: orph, orpheusKey: key, founder: "fran-founder", limits: { newProfilesPerDay: 100 }, email: { send: async () => {} } });
  const base = "http://127.0.0.1:" + await h.listen(0);
  return { h, st, base, close: () => { h.server.closeAllConnections?.(); h.server.close(); } };
}
async function join(b, email, name) {
  const s = await fetch(b.base + "/auth/google", { redirect: "manual", headers: { "user-agent": UA } });
  const state = new URL(s.headers.get("location")).searchParams.get("state"), ck = s.headers.get("set-cookie").split(";")[0];
  b.st.claims = { iss: "https://accounts.google.com", aud: "cid.apps", nonce: state, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email, name };
  const r = await fetch(b.base + `/auth/google/callback?state=${state}&code=abc`, { redirect: "manual", headers: { cookie: ck, "user-agent": UA } });
  return r.headers.get("set-cookie").split(";")[0];
}
const req = (b, p, { method = "GET", cookie, body, origin = method === "POST" ? "http://hub.test" : undefined, ct = "application/x-www-form-urlencoded" } = {}) =>
  fetch(b.base + p, { method, redirect: "manual", body, headers: { "user-agent": UA, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body ? { "content-type": ct } : {}) } });
const claim = (b, cookie, t = "tok-123") => req(b, "/link/orpheus", { method: "POST", cookie, body: "t=" + encodeURIComponent(t) });
const rows = (b) => b.h.db.prepare("SELECT * FROM orpheus_links ORDER BY linked_at").all();
const tieToday = (b) => Object.values(b.h.admin.tieStats().tie)[0] || {};
/** what every test ends with: the key is in no response we read and no log line */
const bodies = [];
const text = async (r) => { const t = await r.text(); bodies.push(t, JSON.stringify([...r.headers])); return t; };
const noLeak = () => { for (const s of [...bodies, ...logged]) assert.ok(!s.includes(KEY), "key leaked: " + s.slice(0, 200)); };
const feed = (fleet, extra = {}) => ({ v: 1, generated_at: "2026-11-24T01:05:00Z", week: { from: "2026-11-17", to: "2026-11-23" }, fleet, ...extra });
const fr = (id, handle, o = {}) => ({ id, handle, founding_fleet: false, linked_at: "2026-11-24T00:00:00Z", agents_week: 3, accounts: 2, sessions_week: 40, busiest_day: "Tue", ...o });

test("link: signed out goes through sign-in with the token kept; signed in confirms, POST claims, 200 stores and redirects", async () => {
  const b = await boot();
  try {
    let r = await req(b, "/link/orpheus?t=tok-123");
    assert.equal(r.status, 303); assert.equal(r.headers.get("location"), "/signin?back=%2Flink%2Forpheus");
    assert.match(r.headers.get("set-cookie"), /^cal_orph=tok-123; Path=\/link\/orpheus; Max-Age=1800; HttpOnly; SameSite=Lax/);
    // the sign-in page carries back=/link/orpheus on every route (GitHub, Google, email code)
    const si = await text(await req(b, "/signin?back=%2Flink%2Forpheus"));
    assert.match(si, /\/auth\/github\?back=%2Flink%2Forpheus/); assert.match(si, /name="back" value="\/link\/orpheus"/);
    const c = await join(b, "ada@mail.test", "Ada Lovelace");
    // back from sign-in: no ?t= any more, the cookie holds it
    const page = await text(await req(b, "/link/orpheus", { cookie: c + "; cal_orph=tok-123" }));
    assert.match(page, /Link this Orpheus workspace to @ada-lovelace/); assert.match(page, /<form class="lk-act" id="lk-form" method="post" action="\/link\/orpheus"/); assert.match(page, /data-orpheus-link="confirm"/); assert.match(page, />Link workspace<\/button>/); assert.match(page, /name="t" value="tok-123"/);
    assert.equal(b.st.calls.length, 0, "a GET never claims");
    b.st.reply["/api/tie/caldera/claim"] = { body: { id: ID1, founding_fleet: true } };
    r = await claim(b, c);
    // the Linked page (FLEET.md piece 5): then the profile after 2 seconds; founding gets the gold line
    assert.equal(r.status, 200); assert.match(r.headers.get("set-cookie"), /cal_orph=; .*Max-Age=0/);
    { const t = await text(r); assert.match(t, /data-orpheus-link="linked"/); assert.match(t, /<meta http-equiv="refresh" content="2;url=\/@ada-lovelace\/\?linked=orpheus">/); assert.match(t, /You are in the Founding Fleet/); }
    const call = b.st.calls[0];
    assert.equal(call.url, "https://useorpheus.com/api/tie/caldera/claim"); assert.equal(call.method, "POST"); assert.equal(call.auth, "Bearer " + KEY);
    assert.deepEqual(call.body, { t: "tok-123", handle: "ada-lovelace" });
    const pid = rows(b)[0].profile;
    assert.deepEqual(b.h.orpheus.fleetOf(pid), { handle: "ada-lovelace", founding: true, linkedAt: rows(b)[0].linked_at, agentsWeek: 0, accounts: 0, sessionsWeek: 0, busiestDay: null, syncedAt: null });
    assert.equal(tieToday(b)["tie_link:orpheus"], 1);
    // public world JSON: handle + founding only, and only for listed members (a new Google page starts unlisted)
    const w = JSON.parse(await text(await req(b, "/v1/world")));
    assert.deepEqual(w.orpheus, [], "unlisted page: not public");
    assert.deepEqual(b.h.orpheus.publicList(() => true), [{ handle: "ada-lovelace", founding: true }], "no counts in the public list");
    // cross-site POST refused, no call
    const n = b.st.calls.length;
    assert.equal((await req(b, "/link/orpheus", { method: "POST", cookie: c, body: "t=x", origin: "https://evil.test" })).status, 403);
    assert.equal(b.st.calls.length, n);
    noLeak();
  } finally { b.close(); }
});

test("link: 409 handle_taken, 410 expired, other answers = error; nothing stored, nothing counted", async () => {
  const b = await boot();
  try {
    const c = await join(b, "bo@mail.test", "Bo Diddley");
    for (const [reply, status, st] of [[{ status: 409, body: { error: "handle_taken" } }, 409, "handle_taken"], [{ status: 410, body: { error: "expired" } }, 410, "expired"],
      [{ status: 400, body: {} }, 502, "error"], [{ status: 200, body: { id: "not-a-uuid", founding_fleet: true } }, 502, "error"], [{ status: 200, body: { id: ID1 } }, 502, "error"], ["throw", 502, "error"]]) {
      b.st.reply["/api/tie/caldera/claim"] = reply;
      const r = await claim(b, c), t = await text(r);
      assert.equal(r.status, status, st); assert.match(t, new RegExp(`data-orpheus-link="${st}"`));
    }
    assert.equal(rows(b).length, 0); assert.equal(tieToday(b)["tie_link:orpheus"], undefined);
    // a bad token never reaches Orpheus
    const n = b.st.calls.length;
    for (const t of ["", "a b", "x".repeat(201)]) { const r = await claim(b, c, t); assert.equal(r.status, 400); }
    assert.equal(b.st.calls.length, n);
    assert.equal((await req(b, "/link/orpheus")).status, 400, "no token, no cookie");
    noLeak();
  } finally { b.close(); }
});

test("handle regex as shown on Caldera; the founder's own claim is not counted", async () => {
  for (const ok of ["ada-lovelace", "A_b.c-1", "x", "a".repeat(40)]) assert.ok(ORPHEUS_HANDLE.test(ok), ok);
  for (const bad of ["", "a".repeat(41), "a b", "ada/lovelace", "@ada", "aé"]) assert.ok(!ORPHEUS_HANDLE.test(bad), bad);
  const b = await boot();
  try {
    const f = await join(b, "fran@mail.test", "Fran Founder");
    b.st.reply["/api/tie/caldera/claim"] = { body: { id: ID2, founding_fleet: false } };
    assert.equal((await claim(b, f)).status, 200);
    assert.equal(rows(b).length, 1); assert.equal(tieToday(b)["tie_link:orpheus"], undefined, "our own session");
  } finally { b.close(); }
});

test("unlink: the owner's POST deletes the row and tells Orpheus; a failed call still deletes here and is retried with the pull", async () => {
  const b = await boot();
  try {
    const c = await join(b, "cy@mail.test", "Cy Young");
    b.st.reply["/api/tie/caldera/claim"] = { body: { id: ID1, founding_fleet: false } };
    await claim(b, c); assert.equal(rows(b).length, 1);
    assert.equal((await req(b, "/settings/orpheus/unlink", { method: "POST", cookie: c, origin: "https://evil.test" })).status, 403);
    assert.equal((await req(b, "/settings/orpheus/unlink", { method: "POST" })).status, 401);
    b.st.reply["/api/tie/caldera/unlink"] = { body: { ok: true } };
    let r = await req(b, "/settings/orpheus/unlink", { method: "POST", cookie: c, body: "{}", ct: "application/json" });
    assert.equal(r.status, 200); assert.deepEqual(JSON.parse(await text(r)), { ok: true, unlinked: true });
    assert.equal(rows(b).length, 0);
    const u = b.st.calls.at(-1); assert.equal(u.url, "https://useorpheus.com/api/tie/caldera/unlink"); assert.deepEqual(u.body, { id: ID1 }); assert.equal(u.auth, "Bearer " + KEY);
    // again, Orpheus down: deleted here anyway, logged without the key, retried by the next pull
    await claim(b, c); assert.equal(rows(b).length, 1);
    b.st.reply["/api/tie/caldera/unlink"] = { status: 500, body: {} };
    r = await req(b, "/settings/orpheus/unlink", { method: "POST", cookie: c });
    assert.equal(r.status, 303); assert.equal(r.headers.get("location"), "/settings#conn-orpheus");
    assert.equal(rows(b).length, 0);
    assert.ok(logged.some(l => /orpheus tie unlink failed status 500/.test(l)));
    // the next pull retries the unlink and does not add the link back from the feed
    b.st.reply["/api/tie/caldera/unlink"] = { body: { ok: true } };
    b.st.reply["/api/tie/caldera/feed"] = { body: feed([fr(ID1, "cy-young")]) };
    const p = await b.h.admin.orpheusPull();
    assert.equal(p.ok, true); assert.equal(p.retried, 1); assert.equal(p.added, 0); assert.equal(rows(b).length, 0);
    noLeak();
  } finally { b.close(); }
});

test("feed: add / update / remove per id; bad feeds change nothing", async () => {
  const b = await boot();
  try {
    const c1 = await join(b, "di@mail.test", "Di Prima"), c2 = await join(b, "ed@mail.test", "Ed Ruscha");
    await join(b, "flo@mail.test", "Flo Kennedy");
    b.st.reply["/api/tie/caldera/claim"] = { body: { id: ID1, founding_fleet: false } }; await claim(b, c1);
    b.st.reply["/api/tie/caldera/claim"] = { body: { id: ID2, founding_fleet: false } }; await claim(b, c2);
    // update ID1, drop ID2 (removed at Orpheus), add ID3 (a link Orpheus has for a member we did not store), ignore unknown fields
    b.st.reply["/api/tie/caldera/feed"] = { body: feed([fr(ID1, "di-prima", { founding_fleet: true, agents_week: 7, accounts: 3, sessions_week: 120, busiest_day: "Wed", secret_thing: "x" }), fr(ID3, "flo-kennedy", { linked_at: "2026-11-25T00:00:00Z" })], { extra: 1 }) };
    const p = await b.h.admin.orpheusPull();
    assert.deepEqual(p, { ok: true, added: 1, updated: 1, removed: 1, retried: 0 });
    const call = b.st.calls.at(-1); assert.equal(call.url, "https://useorpheus.com/api/tie/caldera/feed"); assert.equal(call.method, "GET"); assert.equal(call.auth, "Bearer " + KEY);
    const di = b.h.orpheus.fleetList().find(f => f.handle === "di-prima");
    assert.deepEqual({ ...di, profileId: undefined, linkedAt: undefined, syncedAt: undefined }, { handle: "di-prima", founding: true, linkedAt: undefined, agentsWeek: 7, accounts: 3, sessionsWeek: 120, busiestDay: "Wed", syncedAt: undefined, profileId: undefined });
    assert.deepEqual(b.h.orpheus.fleetList().map(f => f.handle), ["flo-kennedy", "di-prima"], "newest first");
    assert.equal(rows(b).find(r => r.id === ID2), undefined);
    assert.ok(!("secret_thing" in rows(b)[0]));
    // bad feeds: rejected whole, nothing changes
    const before = JSON.stringify(rows(b));
    const bads = [
      { v: 2, generated_at: "2026-11-24T01:00:00Z", week: { from: "a", to: "b" }, fleet: [] }, feed("nope"), feed([fr(ID1, "di-prima", { agents_week: -1 })]), feed([fr(ID1, "di-prima", { accounts: 1.5 })]),
      feed([fr(ID1, "di prima")]), feed([fr("x", "di-prima")]), feed([fr(ID1, "di-prima", { founding_fleet: "yes" })]), feed([fr(ID1, "di-prima"), fr(ID1, "di-prima")]),
      feed([fr(ID1, "di-prima", { busiest_day: "<script>" })]), feed(Array.from({ length: 5001 }, (_, i) => fr(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "h" + i))), null, [],
    ];
    for (const bad of bads) { b.st.reply["/api/tie/caldera/feed"] = { body: bad }; const r = await b.h.admin.orpheusPull(); assert.equal(r.ok, false, JSON.stringify(bad)?.slice(0, 80)); assert.equal(r.error, "bad feed"); }
    b.st.reply["/api/tie/caldera/feed"] = { status: 500, body: {} }; assert.equal((await b.h.admin.orpheusPull()).ok, false);
    b.st.reply["/api/tie/caldera/feed"] = () => new Response("not json", { status: 200 }); assert.equal((await b.h.admin.orpheusPull()).ok, false);
    assert.equal(JSON.stringify(rows(b)), before, "nothing changed");
    assert.equal(parseFeed(feed([fr(ID1, "x")])).fleet.length, 1); assert.equal(parseFeed({ ...feed([]), v: "1" }), null);
    noLeak();
  } finally { b.close(); }
});

test("delete account: the link row goes and Orpheus is told", async () => {
  const b = await boot();
  try {
    const c = await join(b, "gus@mail.test", "Gus Grissom");
    b.st.reply["/api/tie/caldera/claim"] = { body: { id: ID1, founding_fleet: false } }; await claim(b, c);
    b.st.reply["/api/tie/caldera/unlink"] = { body: { ok: true } };
    const pid = rows(b)[0].profile;
    b.h.admin.remove("gus-grissom", "test");
    assert.equal(rows(b).length, 0); assert.equal(b.h.orpheus.fleetOf(pid), null);
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(b.st.calls.at(-1).body, { id: ID1 });
    noLeak();
  } finally { b.close(); }
});

test("key absent: the feature is off, no calls to Orpheus", async () => {
  const b = await boot({ key: "" });
  try {
    const c = await join(b, "hal@mail.test", "Hal Abelson");
    const r = await req(b, "/link/orpheus?t=tok-1", { cookie: c }), t = await text(r);
    assert.equal(r.status, 503); assert.match(t, /Linking is not available right now/); assert.match(t, /data-orpheus-link="off"/); assert.equal(r.headers.get("set-cookie"), null);
    assert.equal((await claim(b, c)).status, 503);
    assert.deepEqual(await b.h.admin.orpheusPull(), { ok: false, error: "off" });
    assert.equal(b.st.calls.length, 0);
    assert.deepEqual(JSON.parse(await (await req(b, "/v1/world")).text()).orpheus, []);
  } finally { b.close(); }
});

test("feed guard (Orpheus Dev 11-24): a pull that keeps under half of 4+ links is held until a later day says the same; small drops apply at once", async () => {
  const b = await boot();
  try {
    const names = [["ann", "Ann Lee"], ["bo", "Bo Diaz"], ["cy", "Cy Twombly"], ["di", "Di Prima"], ["ed", "Ed Ruscha"]];
    for (const [u, n] of names) await join(b, `${u}@mail.test`, n);
    const ids = names.map((_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`), hs = ["ann-lee", "bo-diaz", "cy-twombly", "di-prima", "ed-ruscha"];
    b.st.reply["/api/tie/caldera/feed"] = { body: feed(ids.map((id, i) => fr(id, hs[i]))) };
    assert.equal((await b.h.admin.orpheusPull()).added, 5);
    const n = () => b.h.db.prepare("SELECT COUNT(*) n FROM orpheus_links").get().n;
    b.st.reply["/api/tie/caldera/feed"] = { body: feed(ids.slice(0, 4).map((id, i) => fr(id, hs[i]))) };
    assert.equal((await b.h.admin.orpheusPull()).removed, 1, "one removal applies at once"); assert.equal(n(), 4);
    b.st.reply["/api/tie/caldera/feed"] = { body: feed([]) };
    const held = await b.h.admin.orpheusPull(); assert.equal(held.ok, false); assert.equal(held.error, "held: mass drop"); assert.equal(n(), 4, "old pins stay");
    assert.equal((await b.h.admin.orpheusPull()).ok, false, "same day: still held");
    b.h.db.prepare("UPDATE hub_meta SET v='2026-01-01' WHERE k='orpheus_drop'").run();
    const later = await b.h.admin.orpheusPull(); assert.equal(later.ok, true); assert.equal(later.removed, 4); assert.equal(n(), 0, "a later day says the same: applied");
  } finally { b.h.server?.close?.(); }
});
