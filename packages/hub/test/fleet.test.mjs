// The Orpheus boost on Caldera (fleet.ts; design FLEET.md, Fable 11-24; spec 2026-11-22-orpheus-founding-fleet.md section 2):
// the profile badge and Agent fleet card, the owner's empty slot, the Settings row with Remove, the /link/orpheus states,
// the leaderboard badge (order unchanged), the /world and /people fleet rows, and the first-value card for email sign-ups.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { createHub } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// the pure builders are not exported from the server bundle: bundle the modules themselves
const mod = async (f) => { const out = await build({ entryPoints: [new URL(`../src/${f}`, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false, loader: { ".css": "text" } });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64")); };
const F = await mod("fleet.ts"), L = await mod("leaderboard.ts"), S = await mod("settings.ts"), W = await mod("world.ts");

const KEY = "ork_SECRET_fleet_1";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ID1 = "11111111-2222-4333-8444-555555555555", ID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const jwt = o => "x." + Buffer.from(JSON.stringify(o)).toString("base64url") + ".x";

async function boot({ key = KEY } = {}) {
  const d = __mkdtemp(path.join(os.tmpdir(), "caldera-fleet-"));
  fs.writeFileSync(path.join(d, "google-oauth.json"), JSON.stringify({ client_id: "cid.apps", client_secret: "shh" }));
  const st = { claims: {}, calls: [], reply: {} }, mails = [];
  const google = async (u) => String(u).includes("oauth2.googleapis.com/token") ? J({ id_token: jwt(st.claims) }) : J({}, 404);
  const orph = async (u, init = {}) => {
    const call = { url: String(u), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null }; st.calls.push(call);
    const r = st.reply[new URL(call.url).pathname]; if (!r) return J({}, 404);
    return typeof r === "function" ? r(call) : J(r.body, r.status ?? 200);
  };
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: google, orpheusFetch: orph, orpheusKey: key, founder: "fran-founder", limits: { newProfilesPerDay: 100 }, email: { send: async m => { mails.push(m); } } });
  const base = "http://127.0.0.1:" + await h.listen(0);
  return { h, st, mails, base, close: () => { h.server.closeAllConnections?.(); h.server.close(); } };
}
async function join(b, email, name) {
  const s = await fetch(b.base + "/auth/google", { redirect: "manual", headers: { "user-agent": UA } });
  const state = new URL(s.headers.get("location")).searchParams.get("state"), ck = s.headers.get("set-cookie").split(";")[0];
  b.st.claims = { iss: "https://accounts.google.com", aud: "cid.apps", nonce: state, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email, name };
  const r = await fetch(b.base + `/auth/google/callback?state=${state}&code=abc`, { redirect: "manual", headers: { cookie: ck, "user-agent": UA } });
  return r.headers.get("set-cookie").split(";")[0];
}
const req = (b, p, { method = "GET", cookie, body, origin = method === "POST" ? "http://hub.test" : undefined } = {}) =>
  fetch(b.base + p, { method, redirect: "manual", body, headers: { "user-agent": UA, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) } });
const get = async (b, p, cookie) => (await req(b, p, { cookie })).text();
const claim = (b, cookie, t = "tok-123") => req(b, "/link/orpheus", { method: "POST", cookie, body: "t=" + encodeURIComponent(t) });
const link = async (b, cookie, id, founding) => { b.st.reply["/api/tie/caldera/claim"] = { body: { id, founding_fleet: founding } }; const r = await claim(b, cookie); assert.equal(r.status, 200); return r; };
const rows = (b) => b.h.db.prepare("SELECT * FROM orpheus_links").all();
const list = (b, handle) => b.h.db.prepare("UPDATE profiles SET manifest=json_set(manifest,'$.body.listed',json('true')) WHERE handle=?").run(handle);
const feed = (fleet) => ({ v: 1, generated_at: "2026-11-24T01:05:00Z", week: { from: "2026-11-17", to: "2026-11-23" }, fleet });
const fr = (id, handle, o = {}) => ({ id, handle, founding_fleet: false, linked_at: "2026-11-24T00:00:00Z", agents_week: 3, accounts: 2, sessions_week: 1240, busiest_day: "Wed", ...o });

// ---------------------------------------------------------------- 3 + 4: profile badge, Agent fleet card, empty slot
test("profile: a linked member's badge and Agent fleet card for every viewer; gold for the Founding Fleet; counts after the feed", async () => {
  const b = await boot();
  try {
    const a = await join(b, "ada@mail.test", "Ada Lovelace"), c = await join(b, "cy@mail.test", "Cy Twombly");
    await link(b, a, ID1, false);
    // a signed-out visitor and another member see the same badge and card
    for (const who of [undefined, c]) {
      const p = await get(b, "/@ada-lovelace/", who);
      assert.match(p, /data-tie="badge" title="Runs on Orpheus"/); assert.doesNotMatch(p, /Founding Fleet/);
      assert.match(p, /<span class="caret">\|<\/span> <a href="https:\/\/useorpheus\.com\/\?utm_source=caldera&amp;utm_medium=profile&amp;utm_campaign=tie&amp;ref=ada-lovelace"/, "badge after the name, profile link with ref");
      assert.match(p, /id="cb-fleet" data-tie="fleet"/); assert.match(p, /Agent fleet/); assert.match(p, /First counts within a day/);
      assert.doesNotMatch(p, /fleet-empty/);
    }
    // the daily feed: counts, the busiest weekday, Founding Fleet now gold
    b.st.reply["/api/tie/caldera/feed"] = { body: feed([fr(ID1, "ada-lovelace", { founding_fleet: true })]) };
    assert.equal((await b.h.admin.orpheusPull()).ok, true);
    const p = await get(b, "/@ada-lovelace/");
    assert.match(p, /title="Founding Fleet\. Runs on Orpheus"/); assert.match(p, /#F2CB6B/); assert.match(p, />Founding Fleet<\/span><\/a>/);
    assert.match(p, />1,240<\/b><span[^>]*>sessions</); assert.match(p, />Wed<\/b><span[^>]*>busiest day</); assert.match(p, /Updated [A-Z][a-z]{2} \d+/);
    assert.match(p, />3<\/b><span[^>]*>agents run this week</); assert.match(p, />2<\/b><span[^>]*>accounts</);
    // never a name, a limit, a key or a cost
    assert.ok(!p.includes(KEY));
  } finally { b.close(); }
});

test("profile: not linked = nothing for visitors and other members; the owner alone gets the empty slot", async () => {
  const b = await boot();
  try {
    const bo = await join(b, "bo@mail.test", "Bo Diddley"), c = await join(b, "cy@mail.test", "Cy Twombly");
    const own = await get(b, "/@bo-diddley/", bo);
    assert.match(own, /id="cb-fleet" data-tie="fleet-empty"/); assert.match(own, /Connect Orpheus to show your agents/); assert.match(own, /Only you see this/);
    assert.match(own, /utm_medium=profile&amp;utm_campaign=tie&amp;ref=bo-diddley/);
    assert.doesNotMatch(own, /data-tie="badge"/);
    for (const who of [undefined, c]) { const p = await get(b, "/@bo-diddley/", who); assert.doesNotMatch(p, /cb-fleet|data-tie="badge"|Runs on Orpheus|Connect Orpheus/); }
  } finally { b.close(); }
});

test("Agent fleet card: hidden when the counts are older than 8 days (the badge stays); weekday only", () => {
  const f = { handle: "ada", founding: false, linkedAt: "2026-11-01T00:00:00Z", agentsWeek: 4, accounts: 2, sessionsWeek: 9, busiestDay: "2026-11-18", syncedAt: "2026-11-20T09:00:00Z" };
  const now = Date.parse("2026-11-24T12:00:00Z");
  assert.match(F.fleetCard(f, now), />Wed<\/b>/, "a date becomes its weekday");
  assert.equal(F.fleetCard(f, Date.parse("2026-11-29T12:00:00Z")), "");
  const html = '<h1 class="title">Ada<span class="caret">|</span></h1><!--caldera:owner-->';
  const stale = F.fleetProfile(html, f, { owner: false, handle: "ada", now: Date.parse("2026-11-29T12:00:00Z") });
  assert.match(stale, /data-tie="badge"/); assert.doesNotMatch(stale, /cb-fleet/);
  assert.equal(F.fleetProfile(html, null, { owner: false, handle: "ada" }), html, "unlinked visitor: unchanged");
});

// ---------------------------------------------------------------- 6: Settings row, Remove posts to unlink
test("settings: the Orpheus row (Not linked, then Linked with Remove); Remove posts to /settings/orpheus/unlink and the boost goes", async () => {
  const b = await boot();
  try {
    const a = await join(b, "ada@mail.test", "Ada Lovelace");
    let s = await get(b, "/settings", a);
    assert.match(s, /id="conn-orpheus"/); assert.match(s, /<b>Orpheus<\/b><span>Not linked<\/span>/); assert.match(s, /Try Orpheus free/);
    assert.doesNotMatch(s, /\/settings\/orpheus\/unlink/);
    await link(b, a, ID1, true);
    s = await get(b, "/settings", a);
    assert.match(s, /<span class="conn-dot on" role="img" aria-label="Connected"><\/span><span class="conn-t"><b>Orpheus<\/b><span>Linked as @ada-lovelace &middot; Founding Fleet<\/span>/);
    assert.match(s, /<button type="button" class="btn small ghost" data-of="ask" aria-controls="of-un-c">Remove<\/button>/);
    assert.match(s, /<div class="of-set-c" id="of-un-c" role="group" aria-labelledby="of-un-t" hidden><b id="of-un-t">Remove the Orpheus link\?<\/b>/);
    assert.match(s, /<form method="post" action="\/settings\/orpheus\/unlink"><button class="btn small of-danger" type="submit">Remove link<\/button><\/form><button type="button" class="btn small ghost" data-of="keep">Keep<\/button>/);
    assert.match(s, /data-of/); assert.match(s, /\.of-set-c\{/);
    // Remove link: the form's POST
    b.st.reply["/api/tie/caldera/unlink"] = { body: { ok: true } };
    const r = await req(b, "/settings/orpheus/unlink", { method: "POST", cookie: a, body: "" });
    assert.equal(r.status, 303); assert.equal(r.headers.get("location"), "/settings#conn-orpheus");
    assert.equal(rows(b).length, 0);
    assert.deepEqual(b.st.calls.at(-1).body, { id: ID1 });
    s = await get(b, "/settings", a); assert.match(s, /<span>Not linked<\/span>/);
    const p = await get(b, "/@ada-lovelace/"); assert.doesNotMatch(p, /data-tie="badge"|data-tie="fleet"/);
  } finally { b.close(); }
});

test("settings (GitHub pages, github.ts): the Connections panel carries the Orpheus row after Obsidian", () => {
  const base = { hosted: true, github: { on: true, login: "ada" }, obsidian: { on: false }, live: false, agents: false, email: false };
  const P = conn => S.connectionsPanel({ pub: "https://caldera.social", handle: "ada", conn, sites: [], livePrompt: "", agentPrompt: "" });
  const off = P({ ...base, orpheus: { handle: "ada", fleet: null } });
  assert.ok(off.indexOf('id="conn-obsidian"') < off.indexOf('id="conn-orpheus"'), "after Obsidian");
  assert.match(off, /<span>Not linked<\/span>/);
  const on = P({ ...base, orpheus: { handle: "ada", fleet: { founding: false } } });
  assert.match(on, /Linked as @ada<\/span>/); assert.match(on, /action="\/settings\/orpheus\/unlink"/); assert.match(on, /data-of/);
  assert.doesNotMatch(P(base), /conn-orpheus/, "no link data: no row");
  assert.match(S.SETTINGS_CSS, /\.of-set-a/);
});

// ---------------------------------------------------------------- 5: the link page states
test("link page: signed-out note, Confirm, Linked (gold line for the Founding Fleet), and the error states end with Nothing changed", async () => {
  const b = await boot();
  try {
    let r = await req(b, "/link/orpheus?t=tok-123");
    assert.equal(r.status, 303); assert.equal(r.headers.get("location"), "/signin?back=%2Flink%2Forpheus");
    assert.match(await get(b, "/signin?back=%2Flink%2Forpheus"), /<div class="card" role="status">Sign in to link your Orpheus workspace\.<\/div>/);
    const a = await join(b, "ada@mail.test", "Ada Lovelace");
    // Confirm
    const cf = await get(b, "/link/orpheus?t=tok-123", a);
    assert.match(cf, /<div data-orpheus-link="confirm"><div class="lk-pair" data-s="confirm" aria-hidden="true">/);
    assert.match(cf, /<h1>Link this Orpheus workspace to @ada-lovelace<\/h1>/);
    assert.match(cf, /Counts only: agents run this week, accounts, sessions and the busiest day\./); assert.match(cf, /Account, project or machine names\. Limits, keys or costs\./);
    assert.match(cf, /<button class="btn" type="submit">Link workspace<\/button><a class="btn ghost" href="\/@ada-lovelace\/">Not now<\/a>/);
    assert.match(cf, /<a class="lk-alt" href="\/signout\?back=%2Flink%2Forpheus">Use another account<\/a>/);
    assert.match(cf, /\.si \.lk-pair\{/); assert.match(cf, /lk-form/); assert.match(cf, /Linking&hellip;/, "the Linking state on submit");
    // Use another account: sign out, then back to sign-in for the link
    const so = await req(b, "/signout?back=%2Flink%2Forpheus", { method: "POST", cookie: a });
    assert.equal(so.status, 303); assert.equal(so.headers.get("location"), "/signin?back=%2Flink%2Forpheus");
    // Linked, not founding: no gold line
    const bo = await join(b, "bo@mail.test", "Bo Diddley");
    r = await link(b, bo, ID2, false); let t = await r.text();
    assert.match(t, /data-orpheus-link="linked"/); assert.match(t, /<h1>Linked to @bo-diddley<\/h1>/); assert.doesNotMatch(t, /<p class="lk-gold">/);
    assert.match(t, /content="2;url=\/@bo-diddley\/\?linked=orpheus"/);
    // the errors
    const cy = await join(b, "cy@mail.test", "Cy Twombly");
    const cases = [
      [{ status: 409, body: { error: "handle_taken" } }, 409, "handle_taken", /<h1>@cy-twombly is linked to another Orpheus workspace<\/h1>/],
      [{ status: 409, body: { error: "workspace_taken", handle: "di-prima" } }, 409, "taken_other", /<h1>This workspace is linked to @di-prima<\/h1>/],
      [{ status: 410, body: { error: "expired" } }, 410, "expired", /<a class="btn" href="https:\/\/useorpheus\.com\/app\/members\.html#caldera"[^>]*>Open Orpheus settings<\/a>/],
      [{ status: 500, body: {} }, 502, "error", /<h1>Linking is not available right now<\/h1>/],
    ];
    for (const [reply, status, st, re] of cases) {
      b.st.reply["/api/tie/caldera/claim"] = reply;
      const x = await claim(b, cy), h = await x.text();
      assert.equal(x.status, status, st); assert.match(h, new RegExp(`data-orpheus-link="${st}"`)); assert.match(h, re); assert.match(h, /Nothing changed\./);
      assert.match(h, /data-s="off"/);
    }
    assert.equal(rows(b).length, 1, "only Bo's link");
  } finally { b.close(); }
});

test("link page: Linked shows the Founding Fleet line; switch off = Not available", async () => {
  const b = await boot();
  try {
    const a = await join(b, "ada@mail.test", "Ada Lovelace");
    const t = await (await link(b, a, ID1, true)).text();
    assert.match(t, /<p class="lk-gold">.*You are in the Founding Fleet\. Your map pin is gold\.<\/p>/);
  } finally { b.close(); }
  const o = await boot({ key: "" });
  try {
    const a = await join(o, "ada@mail.test", "Ada Lovelace");
    const r = await req(o, "/link/orpheus?t=tok-1", { cookie: a }), h = await r.text();
    assert.equal(r.status, 503); assert.match(h, /data-orpheus-link="off"/); assert.match(h, /Nothing changed\. Try again in a few minutes\./);
  } finally { o.close(); }
});

// ---------------------------------------------------------------- 3: leaderboard badge, order unchanged
const row = (rank, id, o = {}) => ({ rank, id, handle: id, name: id, avatar: null, url: `/@${id}/city.html`, metric: 10 - rank, prev: 0, trend: null, active: 1, tier: 1, tierName: "Camp", battle: { in: false, ammo: 0, hits: 0, usd: 0 }, ...o });
const order = (html) => [...html.matchAll(/<span class="lb-h">@([a-z-]+)<\/span>/g)].map(m => m[1]);
test("leaderboard: the badge sits in the row (gold for the Founding Fleet); order, ranks and scores never change", () => {
  const rows = [row(1, "cy"), row(2, "ada"), row(3, "bo"), row(4, "di")];
  const o = { win: "week", me: null, hub: "https://caldera.social", nav: "", pToday: 20000, at: Date.now() };
  const plain = L.leaderboardPage(rows, o), lv = { ada: 2, di: 1 };
  const withB = L.leaderboardPage(rows, { ...o, orph: id => lv[id] || 0 });
  assert.deepEqual(order(withB), order(plain)); assert.deepEqual(order(withB), ["cy", "ada", "bo", "di"]);
  const strip = h => h.replace(/<span class="of-b[^"]*"[^>]*>.*?<\/span><\/span>/g, "").replace(/<style>[\s\S]*?<\/style>/, "").replace(/<span class="lb-key">.*?<\/span>/, "");
  assert.equal(strip(withB), strip(plain), "the badge is the only change");
  assert.match(withB, /<span class="lb-h">@ada<\/span><\/span><span class="of-b gold" title="Founding Fleet\. Runs on Orpheus">/);
  assert.match(withB, /<span class="lb-h">@di<\/span><\/span><span class="of-b" title="Runs on Orpheus">/);
  assert.doesNotMatch(withB, /@cy<\/span><\/span><span class="of-b/); assert.doesNotMatch(withB, /@bo<\/span><\/span><span class="of-b/);
  assert.match(withB, /Runs on Orpheus\. A badge never changes rank\./);
  assert.doesNotMatch(L.leaderboardPage(rows, { ...o, orph: () => 0 }), /class="of-b|class="lb-key"/, "no linked member: no badge, no key");
});

// ---------------------------------------------------------------- 1 + 2: /world toggle and row
const wm = (handle, o = {}) => ({ handle, name: handle, headline: "", page: `/@${handle}/`, city: `/@${handle}/city.html`, friends: 0, isNew: false, groups: [], ...o });
const world = (hs) => ({ at: "2026-11-24T00:00:00Z", members: hs.map(h => wm(h)), city: { name: "world", districts: [], openBase: "" }, links: [], start: null, topics: [] });
test("/world: the Orpheus fleet row (newest first, gold chips), the Layers toggle and the pin data; nothing without a fleet", () => {
  const fleet = [{ handle: "bo", founding: false, avatar: null, name: "Bo" }, { handle: "ada", founding: true, avatar: "/@ada/img/a.png", name: "Ada" }, { handle: "zed", founding: false, avatar: null }];
  const h = W.worldPage(world(["ada", "bo", "cy"]), { hub: "https://caldera.social", nav: "", fleet, viewer: "cy" });
  const rowAt = h.indexOf('<div class="of-row" id="of-row" data-tie="fleet-row">');
  assert.ok(rowAt > h.indexOf('<div class="w-head">') && rowAt < h.indexOf('<div class="w-maps">'), "between the head and the map");
  assert.match(h, /<button type="button" class="of-row-l" id="of-only" aria-pressed="false" title="Show only the Orpheus fleet on the map">.*Orpheus fleet<b>2<\/b><\/button>/);
  assert.ok(h.indexOf('data-h="bo"') < h.indexOf('data-h="ada"'), "newest link first");
  assert.match(h, /<a class="of-chip" role="listitem" href="\/world\?focus=bo" data-h="bo"><i>B<\/i>@bo<\/a>/);
  assert.match(h, /<a class="of-chip gold" role="listitem" href="\/world\?focus=ada" data-h="ada" title="Founding Fleet"><i><img src="\/@ada\/img\/a\.png" alt=""><\/i>@ada<svg/);
  assert.doesNotMatch(h, /data-h="zed"/, "only members on this map");
  assert.match(h, /<a class="of-row-a" href="https:\/\/useorpheus\.com\/\?utm_source=caldera&amp;utm_medium=map&amp;utm_campaign=tie&amp;ref=cy" target="_blank" rel="noopener">Try Orpheus free<\/a>/);
  assert.match(h, /<button id="t-orph" aria-pressed="false" aria-label="Orpheus fleet" title="Show only members who run Orpheus">/);
  assert.ok(h.indexOf('id="t-topics"') < h.indexOf('id="t-orph"'), "after Topics");
  const data = JSON.parse(h.match(/<script type="application\/json" id="city-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.world.m["@ada"].orph, 2); assert.equal(data.world.m["@bo"].orph, 1); assert.equal(data.world.m["@cy"].orph, undefined);
  assert.match(h, /\.w-of-chip\{/); assert.match(h, /CALDERA_FLEET/);
  const none = W.worldPage(world(["ada", "bo"]), { hub: "https://caldera.social", nav: "", fleet: [] });
  assert.doesNotMatch(none, /id="of-row"|<button id="t-orph"|\.w-of-chip\{position/);
  assert.doesNotMatch(W.worldPage(world(["ada"]), { hub: "https://caldera.social", nav: "", fleet, viewer: null }), /utm_campaign=tie&amp;ref=/, "signed out: no ref");
});

test("/world and /v1/directory: listed fleet members only; the People row data and the card badge; the order never changes", async () => {
  const b = await boot();
  try {
    const a = await join(b, "ada@mail.test", "Ada Lovelace"), bo = await join(b, "bo@mail.test", "Bo Diddley"); await join(b, "cy@mail.test", "Cy Twombly");
    await link(b, a, ID1, true); await link(b, bo, ID2, false);
    let d = await (await req(b, "/v1/directory")).json();
    assert.deepEqual(d.fleet, [], "a new Google page starts unlisted: not in the row");
    list(b, "ada-lovelace"); list(b, "bo-diddley"); list(b, "cy-twombly");
    const plain = d;
    d = await (await req(b, "/v1/directory?sort=new", { cookie: a })).json();
    assert.deepEqual(d.fleet.map(f => [f.handle, f.founding]), [["bo-diddley", false], ["ada-lovelace", true]], "newest link first");
    assert.equal(d.me, "ada-lovelace");
    assert.equal(d.profiles.find(p => p.handle === "ada-lovelace").orph, 2); assert.equal(d.profiles.find(p => p.handle === "bo-diddley").orph, 1);
    assert.equal(d.profiles.find(p => p.handle === "cy-twombly").orph, undefined);
    assert.ok(!JSON.stringify(d).match(/agents_?week|sessions|accounts/i), "no counts in public JSON");
    void plain;
    // the sort ignores the badge: the same order with and without a fleet
    const before = (await (await req(b, "/v1/directory")).json()).profiles.map(p => p.handle);
    b.h.db.prepare("DELETE FROM orpheus_links").run();
    const after = (await (await req(b, "/v1/directory")).json()).profiles.map(p => p.handle);
    assert.deepEqual(after, before);
  } finally { b.close(); }
});

test("/people: the row sits between the head and the tools, filled from v1/directory; the card badge; site.css has the styles", () => {
  const site = new URL("../../site/", import.meta.url).pathname;
  const html = fs.readFileSync(path.join(site, "people.html"), "utf8"), css = fs.readFileSync(path.join(site, "assets/site.css"), "utf8");
  assert.ok(html.indexOf('class="people-head"') < html.indexOf('id="of-slot"') && html.indexOf('id="of-slot"') < html.indexOf('class="people-tools"'));
  assert.match(html, /ofRow\(d\.fleet, d\.fleetTotal, d\.me\)/);
  assert.match(html, /<span class="of-row-l">' \+ OFM\(14\) \+ 'Orpheus fleet<b>/);
  assert.match(html, /utm_medium=people&utm_campaign=tie/);
  assert.match(html, /if \(p\.orph\) \{ var ow = el\("div", "pcard-of"\); ow\.innerHTML = ofBadge\(p\.orph === 2\); top\.appendChild\(ow\); \}/);
  for (const s of [".of-b{", ".of-row{", ".of-chip{", ".people .of-row{", ".pcard-of{"]) assert.ok(css.includes(s), s);
  // run the page's row builder: hidden with no fleet, chips to /@h/
  const i = html.indexOf("var OFM ="), j = html.indexOf("function card(p)");
  const slot = { innerHTML: "x" };
  const fns = new Function("document", html.slice(i, j) + ";return {ofRow:ofRow,ofBadge:ofBadge}")({ getElementById: () => slot });
  fns.ofRow([], 0, null); assert.equal(slot.innerHTML, "");
  fns.ofRow([{ handle: "ada", founding: true, avatar: null, name: "Ada" }], 1, "cy");
  assert.match(slot.innerHTML, /<a class="of-chip gold" role="listitem" href="\/@ada\/" data-h="ada" title="Founding Fleet"><i>A<\/i>@ada<svg/);
  assert.match(slot.innerHTML, /ref=cy/);
  assert.equal(fns.ofBadge(true), F.fleetBadge(true)); assert.equal(fns.ofBadge(false), F.fleetBadge(false));
});

// ---------------------------------------------------------------- the first-value card for email sign-ups (at "email")
test("email sign-up: the first-value card on the first page after the email, once per member, counted at email", async () => {
  const b = await boot();
  try {
    const form = (p, body, cookie = "") => fetch(b.base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://hub.test", "user-agent": UA, ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body).toString() });
    const fields = { name: "Noor Fleet", headline: "Brand designer", a: "Brand identity", email: "noor@mail.test" }, stampOf = h => h.match(/name="stamp" value="([^"]+)"/)[1];
    let pg = await (await form("/join/designer", { ...fields, stamp: stampOf(await (await fetch(b.base + "/join/designer", { headers: { "user-agent": UA } })).text()) })).text();
    if (!/Check your email/.test(pg)) pg = await (await form("/join/designer", { ...fields, stamp: stampOf(pg) })).text();   // under 4 s: one more tap
    assert.match(pg, /Check your email/);
    const t = new URL(b.mails.at(-1).text.match(/https?:\/\/\S+start\/confirm\?t=\S+/)[0]).searchParams.get("t");
    const c = await form("/start/confirm", { t });
    assert.equal(c.status, 302); assert.equal(c.headers.get("location"), "/settings?new=1#work");
    const ck = c.headers.get("set-cookie").split(";")[0];
    const one = await get(b, "/settings?new=1", ck);
    assert.match(one, /<section class="card tie" id="tie" data-tie="email" aria-label="Orpheus"><h2>Show your agents on your profile<\/h2>/);
    assert.match(one, /utm_medium=first_value/); assert.match(one, /at:'email'/);
    assert.doesNotMatch(await get(b, "/settings?new=1", ck), /id="tie"/, "once per member");
    const day = Object.values(b.h.admin.tieStats().tie_at)[0] || {};
    assert.equal(day["tie_show:first_value:email"], 1);
    // the click beacon is accepted at email
    const r = await fetch(b.base + "/v1/tie", { method: "POST", headers: { "content-type": "text/plain", "user-agent": UA }, body: JSON.stringify({ ev: "tie_click", place: "first_value", at: "email" }) });
    assert.equal(r.status, 204);
  } finally { b.close(); }
});
