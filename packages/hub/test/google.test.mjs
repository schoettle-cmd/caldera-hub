// Continue with Google: what Google verified goes through the same path as the email link. No file, no button.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHub } from "../dist/server.js";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const jwt = o => "x." + Buffer.from(JSON.stringify(o)).toString("base64url") + ".x";
async function boot(configured = true) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-google-"));
  if (configured) fs.writeFileSync(path.join(d, "google-oauth.json"), JSON.stringify({ client_id: "cid.apps", client_secret: "shh" }));
  const st = { claims: {}, calls: [] };
  const fake = async (u, init = {}) => { u = String(u); if (u.includes("oauth2.googleapis.com/token")) { st.calls.push(String(init.body)); return J({ id_token: jwt(st.claims) }); }
    if (/\/users\/octo$/i.test(u)) return J({ login: "Octo", type: "User", name: "Octo Cat", html_url: "https://github.com/Octo", public_repos: 1, followers: 1, created_at: "2019-01-01T00:00:00Z" });
    if (/\/users\/octo\/repos/i.test(u)) return J([{ name: "tool", full_name: "Octo/tool", fork: false, private: false, language: "Go", pushed_at: new Date().toISOString(), created_at: "2020-01-01T00:00:00Z", size: 10, html_url: "https://github.com/Octo/tool", stargazers_count: 1 }]);
    return J({}, 404); };
  let base = "http://hub.test";
  const h = createHub({ dataDir: d, publicUrl: base, githubFetch: fake, limits: { newProfilesPerDay: 100 }, email: { send: async () => {} } });
  base = "http://127.0.0.1:" + await h.listen(0);
  return { h, d, st, base };
}
async function signIn(b, claims, { query = "", cookieTweak } = {}) {
  const s = await fetch(b.base + "/auth/google" + query, { redirect: "manual" });
  assert.equal(s.status, 302);
  const to = new URL(s.headers.get("location")), cookie = s.headers.get("set-cookie").split(";")[0];
  const state = to.searchParams.get("state");
  b.st.claims = { iss: "https://accounts.google.com", aud: "cid.apps", nonce: state, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...claims };
  const r = await fetch(b.base + `/auth/google/callback?state=${state}&code=abc`, { redirect: "manual", headers: { cookie: cookieTweak ? cookieTweak(cookie) : cookie } });
  return { r, to };
}
const cookieOf = r => (r.headers.get("set-cookie") || "").split(";")[0];

test("no credentials: no button and no route", async () => {
  const b = await boot(false);
  try {
    assert.doesNotMatch(await (await fetch(b.base + "/signin")).text(), /Continue with Google/);
    assert.doesNotMatch(await (await fetch(b.base + "/join")).text(), /auth\/google/);
    assert.equal((await fetch(b.base + "/auth/google", { redirect: "manual" })).status, 404);
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("asks Google for name and email only; the button shows", async () => {
  const b = await boot();
  try {
    assert.match(await (await fetch(b.base + "/signin")).text(), /Continue with Google/);
    assert.match(await (await fetch(b.base + "/join")).text(), /Or continue with Google/);
    const { to } = await signIn(b, { email: "a@example.com", name: "Ada" });
    assert.equal(to.hostname, "accounts.google.com"); assert.equal(to.searchParams.get("scope"), "openid email profile");
    assert.match(to.searchParams.get("redirect_uri"), /\/auth\/google\/callback$/);
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("new person gets a signed-in page; signing in again is the same page and keeps its name", async () => {
  const b = await boot();
  try {
    const one = await signIn(b, { email: "Ada@Example.com", name: "Ada Lovelace" });
    assert.equal(one.r.status, 302); assert.equal(one.r.headers.get("location"), "/settings?new=1");
    const c = cookieOf(one.r); assert.ok(c, "signed in");
    const set = await fetch(b.base + "/settings?new=1", { headers: { cookie: c } }); assert.equal(set.status, 200);
    assert.equal((await fetch(b.base + "/@ada-lovelace/")).status, 200);
    const two = await signIn(b, { email: "ada@example.com", name: "Someone Else" });
    assert.match(two.r.headers.get("location"), /^\/@ada-lovelace\//);
    assert.doesNotMatch(await (await fetch(b.base + "/@ada-lovelace/")).text(), /Someone Else/);
    assert.equal((await fetch(b.base + "/@someone-else/")).status, 404);
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("goes back to the page that asked", async () => {
  const b = await boot();
  try {
    const { r } = await signIn(b, { email: "b@example.com", name: "Bo" }, { query: "?back=%2Ffeed" });
    assert.equal(r.headers.get("location"), "/feed");
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
for (const [name, claims] of [["unverified email", { email: "c@example.com", email_verified: false }], ["another app's token", { email: "c@example.com", aud: "other" }], ["wrong issuer", { email: "c@example.com", iss: "https://evil.example" }], ["expired", { email: "c@example.com", exp: 1 }], ["wrong nonce", { email: "c@example.com", nonce: "nope" }]])
  test(`refused: ${name}, and no page is made`, async () => {
    const b = await boot();
    try { const { r } = await signIn(b, { name: "C", ...claims }); assert.equal(r.status, 400); assert.ok(!cookieOf(r).startsWith("cal_")); assert.equal((await fetch(b.base + "/@c/")).status, 404); } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
  });
test("refused: state doesn't match its cookie, or no cookie", async () => {
  const b = await boot();
  try {
    const { r } = await signIn(b, { email: "d@example.com" }, { cookieTweak: () => "cal_gs=forged" }); assert.equal(r.status, 400);
    assert.equal((await fetch(b.base + "/auth/google/callback?state=x&code=y", { redirect: "manual" })).status, 400);
    assert.equal(b.st.calls.length, 0, "no call to Google without a good state");
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("cancelled at Google: back to sign in", async () => {
  const b = await boot();
  try { const r = await fetch(b.base + "/auth/google/callback?error=access_denied", { redirect: "manual" }); assert.equal(r.headers.get("location"), "/signin"); } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});

const hubDb = b => { const { DatabaseSync } = process.getBuiltinModule("node:sqlite"); return new DatabaseSync(path.join(b.d, fs.readdirSync(b.d).find(f => /^hub\.(sqlite|db)$/.test(f)) || "hub.sqlite")); };
const UA = { headers: { "user-agent": "Mozilla/5.0" } };
test("Google-first is off by default: preview, career and join unchanged, ?gf=1 previews it, the flag turns it on", async () => {
  const b = await boot();
  try {
    const off = await (await fetch(b.base + "/gh/octo", UA)).text();
    assert.match(off, /Claim it with GitHub/); assert.doesNotMatch(off, /Save your scan with Google/);
    assert.doesNotMatch(await (await fetch(b.base + "/join", UA)).text(), /door=google/);
    const pv = await (await fetch(b.base + "/gh/octo?gf=1", UA)).text();
    assert.match(pv, /auth\/google\?gh=Octo/); assert.match(pv, /use GitHub<\/a> or/); assert.doesNotMatch(pv, /Claim it with GitHub/);
    assert.match(await (await fetch(b.base + "/join?gf=1", UA)).text(), /door=google/);
    fs.writeFileSync(path.join(b.d, "google-first.json"), JSON.stringify({ on: true }));
    assert.match(await (await fetch(b.base + "/gh/octo", UA)).text(), /Save your scan with Google/);
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("the flag alone does nothing without a Google client", async () => {
  const b = await boot(false);
  try {
    fs.writeFileSync(path.join(b.d, "google-first.json"), JSON.stringify({ on: true }));
    assert.doesNotMatch(await (await fetch(b.base + "/gh/octo", UA)).text(), /Save your scan with Google/);
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("from a preview: the page keeps that city, unverified, and offers Connect GitHub; no Daily or weekly email", async () => {
  const b = await boot();
  try {
    const { r } = await signIn(b, { email: "o@example.com", name: "Olive Oak" }, { query: "?gh=Octo" });
    assert.equal(r.headers.get("location"), "/settings?new=1");
    const c = cookieOf(r), set = await (await fetch(b.base + "/settings?new=1", { headers: { cookie: c } })).text();
    assert.match(set, /Now make it official/); assert.match(set, /Congratulations, your account&#39;s created|Congratulations, your account's created/); assert.match(set, /Skip for now/); assert.match(set, /Verify @Octo/); assert.match(set, /Connect GitHub/); assert.match(set, /Coming soon/);
    const db = hubDb(b), acct = db.prepare("SELECT content, nudge_off, profile_id FROM email_accounts WHERE handle='olive-oak'").get();
    assert.equal(JSON.parse(acct.content).ghPublic.login, "Octo"); assert.equal(JSON.parse(acct.content).via, "google"); assert.equal(acct.nudge_off, 1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'email_sub%'").all();
    for (const t of tables) { const n = db.prepare(`SELECT COUNT(*) n FROM ${t.name} WHERE confirmed IS NOT NULL`).get().n; assert.equal(n, 0, "nobody subscribed: " + t.name); }
    db.close();
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("signing in again with ?gh= never changes an existing page", async () => {
  const b = await boot();
  try {
    await signIn(b, { email: "p@example.com", name: "Pat Plain" });
    const { r } = await signIn(b, { email: "p@example.com", name: "Pat Plain" }, { query: "?gh=Octo" });
    assert.match(r.headers.get("location"), /^\/@pat-plain\//);
    const db = hubDb(b), row = db.prepare("SELECT content FROM email_accounts WHERE handle='pat-plain'").get(); assert.equal(JSON.parse(row.content).ghPublic, undefined); db.close();
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
test("designer and business doors keep their type; a bad gh or type is ignored", async () => {
  const b = await boot();
  try {
    const go = await fetch(b.base + "/join/go?door=google&type=designer&from=mike", { redirect: "manual" });
    assert.equal(go.headers.get("location"), "/auth/google?type=designer&invite=mike");
    await signIn(b, { email: "d1@example.com", name: "Dee Sign" }, { query: "?type=designer" });
    await signIn(b, { email: "d2@example.com", name: "Bea Biz" }, { query: "?type=business" });
    await signIn(b, { email: "d3@example.com", name: "Eve Odd" }, { query: "?type=admin&gh=../x" });
    const db = hubDb(b), kind = h => JSON.parse(db.prepare("SELECT content FROM email_accounts WHERE handle=?").get(h).content);
    assert.equal(kind("dee-sign").kind, "designer"); assert.equal(kind("bea-biz").kind, "business");
    assert.equal(kind("eve-odd").kind, undefined); assert.equal(kind("eve-odd").ghPublic, undefined); db.close();
  } finally { b.h.server.closeAllConnections?.(); b.h.server.close(); }
});
