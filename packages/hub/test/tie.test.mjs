// Caldera x Orpheus tie, Part 1 (tie.ts; Mike 11-22, design TIE.md): the first-value card once per member across the page
// and /settings?new=1, tie_show / tie_click per day with robots and our own sessions left out, and the homepage button.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHub } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HREF = "https://useorpheus.com/?utm_source=caldera&amp;utm_medium=first_value&amp;utm_campaign=tie";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const jwt = o => "x." + Buffer.from(JSON.stringify(o)).toString("base64url") + ".x";
async function boot() {
  const d = __mkdtemp(path.join(os.tmpdir(), "caldera-tie-"));
  fs.writeFileSync(path.join(d, "google-oauth.json"), JSON.stringify({ client_id: "cid.apps", client_secret: "shh" }));
  const st = { claims: {} };
  const fake = async (u) => String(u).includes("oauth2.googleapis.com/token") ? J({ id_token: jwt(st.claims) }) : J({}, 404);
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: fake, founder: "fran-founder", limits: { newProfilesPerDay: 100 }, email: { send: async () => {} } });
  const base = "http://127.0.0.1:" + await h.listen(0);
  return { h, st, base, close: () => { h.server.closeAllConnections?.(); h.server.close(); } };
}
/** a new Google member: returns their owner cookie (they land on /settings?new=1) */
async function join(b, email, name) {
  const s = await fetch(b.base + "/auth/google", { redirect: "manual", headers: { "user-agent": UA } });
  const state = new URL(s.headers.get("location")).searchParams.get("state"), ck = s.headers.get("set-cookie").split(";")[0];
  b.st.claims = { iss: "https://accounts.google.com", aud: "cid.apps", nonce: state, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email, name };
  const r = await fetch(b.base + `/auth/google/callback?state=${state}&code=abc`, { redirect: "manual", headers: { cookie: ck, "user-agent": UA } });
  assert.equal(r.headers.get("location"), "/settings?new=1");
  return r.headers.get("set-cookie").split(";")[0];
}
const get = (b, p, cookie) => fetch(b.base + p, { headers: { "user-agent": UA, ...(cookie ? { cookie } : {}) } }).then(r => r.text());
const ev = (b, body, { ua = UA, cookie } = {}) => fetch(b.base + "/v1/tie", { method: "POST", headers: { "content-type": "text/plain", "user-agent": ua, ...(cookie ? { cookie } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) }).then(r => r.status);
const today = (b) => Object.values(b.h.admin.tieStats().tie)[0] || {};

test("settings?new=1: the card shows once under Congratulations, then never again (not on the page either)", async () => {
  const b = await boot();
  try {
    const c = await join(b, "ada@mail.test", "Ada Lovelace");
    const one = await get(b, "/settings?new=1", c);
    assert.match(one, /Congratulations, your account(&#39;|')s created<\/h2>[\s\S]*?<\/section><section class="card tie" id="tie" data-tie="settings"/, "right under Congratulations");
    assert.ok(one.includes(`href="${HREF}"`), "utm_medium=first_value, utm_campaign=tie");
    for (const w of ["Show your agents on your profile", "Try Orpheus free", "7 days free. No card to start.", "Orpheus puts every account on one board and moves idle agents to the one with the most room. Connect it and your profile shows your fleet."]) assert.ok(one.includes(w), w);
    assert.match(one, /class="btn small ghost"[^>]*onclick="try\{navigator\.sendBeacon\('\/v1\/tie',JSON\.stringify\(\{ev:'tie_click',place:'first_value',at:'settings'\}\)\)\}catch\(e\)\{\}"/);
    assert.match(one, /\.ep \.card\.tie\{/);
    assert.doesNotMatch(await get(b, "/settings?new=1", c), /data-tie=/, "second visit: gone");
    assert.doesNotMatch(await get(b, "/@ada-lovelace/?welcome=1", c), /cb-tie/, "once per member across both places");
    assert.equal(today(b)["tie_show:first_value"], 1);
    assert.equal(Object.values(b.h.admin.tieStats().tie_at)[0]["tie_show:first_value:settings"], 1);
  } finally { b.close(); }
});

test("own page ?welcome=1: the tie row under the welcome strip, once; visitors never see it", async () => {
  const b = await boot();
  try {
    const c = await join(b, "bo@mail.test", "Bo Diddley");
    assert.doesNotMatch(await get(b, "/@bo-diddley/?welcome=1"), /cb-tie/, "a visitor");
    const one = await get(b, "/@bo-diddley/?welcome=1", c);
    assert.match(one, /<div id="cb-wel"[\s\S]*?<\/button><\/div><div id="cb-tie" data-tie="page"/, "strip, then the tie row");
    assert.ok(one.includes(`href="${HREF}"`));
    assert.ok(one.includes(`onclick="try{navigator.sendBeacon('http://hub.test/v1/tie',JSON.stringify({ev:'tie_click',place:'first_value',at:'page'}))}catch(e){}"`), "click beacon to the hub");
    assert.match(one, /aria-label="Not now" title="Not now" onclick="this\.parentNode\.remove\(\)"/);
    const two = await get(b, "/@bo-diddley/?welcome=1", c);
    assert.match(two, /cb-wel/); assert.doesNotMatch(two, /cb-tie/, "second render: gone");
    assert.doesNotMatch(await get(b, "/settings?new=1", c), /data-tie=/);
    assert.equal(today(b)["tie_show:first_value"], 1);
  } finally { b.close(); }
});

test("/v1/tie counts a person, drops robots and the founder, refuses unknown values", async () => {
  const b = await boot();
  try {
    assert.equal(await ev(b, { ev: "tie_show", place: "home" }), 204);
    assert.equal(await ev(b, { ev: "tie_click", place: "home" }), 204);
    assert.equal(await ev(b, { ev: "tie_click", place: "first_value", at: "page" }), 204);
    let t = today(b); assert.deepEqual([t["tie_show:home"], t["tie_click:home"], t["tie_click:first_value"]], [1, 1, 1]);
    for (const ua of ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Mozilla/5.0 (compatible; Googlebot/2.1)", "node", ""])
      assert.equal(await ev(b, { ev: "tie_show", place: "home" }, { ua }), 204);
    assert.equal(today(b)["tie_show:home"], 1, "robots not counted");
    // the founder (CALDERA_FOUNDER): their page shows the card but neither the show nor their clicks count
    const f = await join(b, "fran@mail.test", "Fran Founder");
    const page = await get(b, "/settings?new=1", f);
    assert.match(page, /data-tie="settings"/); assert.doesNotMatch(page, /sendBeacon/, "no click beacon for our own session");
    assert.equal(await ev(b, { ev: "tie_click", place: "home" }, { cookie: f }), 204);
    t = today(b); assert.equal(t["tie_click:home"], 1, "founder click dropped"); assert.equal(t["tie_show:first_value"], undefined, "founder show not counted");
    // our own addresses (own.ts: example.com is reserved) are left out the same way
    const o = await join(b, "me@example.com", "Own Person");
    const op = await get(b, "/@own-person/?welcome=1", o); assert.match(op, /id="cb-tie"/); assert.doesNotMatch(op, /sendBeacon/);
    assert.equal(today(b)["tie_show:first_value"], undefined);
    for (const bad of [{ ev: "tie_show", place: "first_value" }, { ev: "tie_view", place: "home" }, { ev: "tie_click", place: "footer" }, { ev: "tie_click" }, "not json"])
      assert.equal(await ev(b, bad), 400, JSON.stringify(bad));
    // the founder reads the counts; nobody else does
    const r = await fetch(b.base + "/v1/admin/tie", { headers: { cookie: f, "user-agent": UA } }); assert.equal(r.status, 200);
    assert.equal(Object.values((await r.json()).tie)[0]["tie_click:home"], 1);
    assert.equal((await fetch(b.base + "/v1/admin/tie", { headers: { "user-agent": UA } })).status, 403);
  } finally { b.close(); }
});

test("homepage: Get Orpheus carries utm_campaign=tie; the footer link is unchanged", () => {
  const h = fs.readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
  assert.ok(h.includes('<a class="btn orph-btn" href="https://useorpheus.com/?utm_source=caldera&amp;utm_medium=home&amp;utm_campaign=tie" target="_blank" rel="noopener noreferrer">Get Orpheus</a>'));
  assert.ok(h.includes('<a href="https://useorpheus.com/?utm_source=caldera&utm_medium=footer" target="_blank" rel="noopener noreferrer">Orpheus</a>'));
  assert.equal((h.match(/utm_campaign=tie/g) || []).length, 1, "only the button");
  assert.match(h, /esTrace\(ev,\{place:'home'\}\)/); assert.match(h, /sendBeacon\('\/v1\/tie'/); assert.match(h, /IntersectionObserver/);
});
