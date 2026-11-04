// Sign-up flows (flows.ts): every way in records start, auth_ok/auth_fail, created and first value under door:method,
// our own addresses and same-day deletions stay out, crawlers never count.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";

const ORIGIN = "http://hub.test";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const jwt = o => "x." + Buffer.from(JSON.stringify(o)).toString("base64url") + ".x";
let hub, base, dir, claims = {}; const mails = [];
const fake = async (u) => { u = String(u);
  if (u.includes("oauth2.googleapis.com/token")) return J({ id_token: jwt(claims) });
  if (/\/users\/octo$/i.test(u)) return J({ login: "Octo", type: "User", name: "Octo Cat", html_url: "https://github.com/Octo", public_repos: 1, followers: 1, created_at: "2019-01-01T00:00:00Z" });
  if (/\/users\/octo\/repos/i.test(u)) return J([{ name: "tool", full_name: "Octo/tool", fork: false, private: false, language: "Go", pushed_at: new Date().toISOString(), created_at: "2020-01-01T00:00:00Z", size: 10, html_url: "https://github.com/Octo/tool", stargazers_count: 1 }]);
  return J({}, 404); };
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-flows-"));
  fs.writeFileSync(path.join(dir, "google-oauth.json"), JSON.stringify({ client_id: "cid", client_secret: "s" }));
  hub = createHub({ dataDir: dir, publicUrl: ORIGIN, githubFetch: fake, trustProxy: true, limits: { newProfilesPerDay: 100 }, email: { send: async m => { mails.push(m); } } });
  base = "http://127.0.0.1:" + await hub.listen(0);
});
after(() => { hub.server.closeAllConnections?.(); hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
// each "person" is a different IP, so a different one-day visitor
const H = (ip, extra = {}) => ({ "user-agent": UA, "x-real-ip": ip, "x-forwarded-for": ip, ...extra });
const db = () => new (process.getBuiltinModule("node:sqlite").DatabaseSync)(path.join(dir, "hub.sqlite"));
const flows = () => { const d = db(), out = {};
  const ex = new Set(d.prepare("SELECT vid FROM flow_excluded").all().map(r => r.vid));
  for (const r of d.prepare("SELECT vid, flow, ev FROM flow_events").all()) { if (ex.has(r.vid)) continue; (out[r.flow] ??= {})[r.ev] = ((out[r.flow] ??= {})[r.ev] || 0) + 1; }
  d.close(); return out; };
async function google(ip, email, name, q = "", referer = "") {
  const s = await fetch(base + "/auth/google" + q, { redirect: "manual", headers: H(ip, referer ? { referer: ORIGIN + referer } : {}) });
  const state = new URL(s.headers.get("location")).searchParams.get("state");
  claims = { iss: "https://accounts.google.com", aud: "cid", nonce: state, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email, name };
  const r = await fetch(base + `/auth/google/callback?state=${state}&code=a`, { redirect: "manual", headers: H(ip, { cookie: s.headers.get("set-cookie").split(";")[0] }) });
  return { r, own: (r.headers.get("set-cookie") || "").split(";")[0] };
}

test("Google from a preview: start, auth_ok, created; adding content is first value; signing in again is auth_ok only", async () => {
  const { own } = await google("10.0.0.1", "ann@real.test", "Ann Real", "?gh=Octo", "/gh/Octo");
  let f = flows()["preview:google"]; assert.deepEqual([f.start, f.auth_ok, f.created, f.first_value], [1, 1, 1, undefined]);
  const up = await fetch(base + "/settings/page", { method: "POST", redirect: "manual", headers: H("10.0.0.1", { cookie: own, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ do: "replace", text: "name: Ann Real\nabout: I build things.\n" }).toString() });
  assert.ok([200, 303].includes(up.status));
  assert.equal(flows()["preview:google"].first_value, 1);
  await google("10.0.0.2", "ann@real.test", "Ann Real", "", "/signin");
  f = flows()["signin:google"]; assert.deepEqual([f.start, f.auth_ok, f.created], [1, 1, undefined]);
});
test("Google failures count as auth_fail, cancel too", async () => {
  await fetch(base + "/auth/google", { redirect: "manual", headers: H("10.0.0.3", { referer: ORIGIN + "/join" }) });
  await fetch(base + "/auth/google/callback?error=access_denied", { redirect: "manual", headers: H("10.0.0.3") });
  const f = flows()["join:google"]; assert.equal(f.start, 1); assert.equal(f.auth_fail, 1); assert.equal(f.auth_ok, undefined);
});
test("designer door keeps its type", async () => {
  await google("10.0.0.4", "dee@real.test", "Dee Draw", "?type=designer", "/join");
  assert.equal(flows()["join-designer:google"].created, 1);
});
test("email sign-up: start at /start, created at confirm; a link opened elsewhere still counts, as external", async () => {
  await fetch(base + "/start", { method: "POST", redirect: "manual", headers: H("10.0.0.5", { origin: ORIGIN, referer: ORIGIN + "/start", "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ text: "name: Eve Mail\nabout: hi\n", email: "eve@real.test" }).toString() });
  assert.equal(flows()["start:email"].start, 1);
  const t = mails[mails.length - 1].text.match(/start\/confirm\?t=([\w-]+)/)[1];
  const c = await fetch(base + "/start/confirm", { method: "POST", redirect: "manual", headers: H("10.0.0.6", { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ t }).toString() });
  assert.equal(c.status, 302);
  const f = flows()["external:email"]; assert.deepEqual([f.start, f.auth_ok, f.created], [1, 1, 1]);
});
test("email code sign-in for a member: start at /signin, a wrong code fails, the right one is auth_ok", async () => {
  await fetch(base + "/signin/email", { method: "POST", redirect: "manual", headers: H("10.0.0.7", { origin: ORIGIN, referer: ORIGIN + "/signin", "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ email: "eve@real.test" }).toString() });
  const code = mails[mails.length - 1].subject.match(/(\d{6})/)?.[1]; assert.ok(code, "a code was mailed");
  const send = c => fetch(base + "/signin/code", { method: "POST", redirect: "manual", headers: H("10.0.0.7", { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ email: "eve@real.test", code: c }).toString() });
  await send(code === "000000" ? "111111" : "000000"); assert.equal((await send(code)).status, 303);
  const f = flows()["signin:email"]; assert.deepEqual([f.start, f.auth_fail, f.auth_ok, f.created], [1, 1, 1, undefined]);
});
test("Obsidian: a vault's first publish is the whole flow and its first value", async () => {
  const id = C.newIdentity();
  const m = C.sign(id, "profile.manifest", { name: "Vic Vault", handle: "vic-vault", boxKey: id.boxPublic, headline: "", links: [], sections: [], files: {}, updated: new Date().toISOString() });
  const r = await fetch(base + `/v1/profiles/${encodeURIComponent(id.id)}/bundle`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "obsidian/1.8 Electron" }, body: JSON.stringify({ manifest: m, files: { "index.html": "<!doctype html><title>v</title>" } }) });
  assert.equal(r.status, 200);
  const f = flows()["obsidian:obsidian"]; assert.deepEqual([f.start, f.auth_ok, f.created, f.first_value], [1, 1, 1, 1]);
});
test("left out: our own addresses, a page deleted the same day, and crawlers", async () => {
  await google("10.0.0.8", "mjonesoneinsta@gmail.com", "Test Me", "", "/join");
  const { own } = await google("10.0.0.9", "gone@real.test", "Gus Gone", "", "/start");
  await fetch(base + "/settings/page", { method: "POST", redirect: "manual", headers: H("10.0.0.9", { cookie: own, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ do: "delete", sure: "on" }).toString() });
  await fetch(base + "/auth/google", { redirect: "manual", headers: { "user-agent": "Googlebot/2.1", "x-real-ip": "10.0.0.10", referer: ORIGIN + "/join" } });
  const f = flows();
  assert.equal(f["join:google"].start, 1, "only the earlier real person, not ours and not the crawler");
  assert.equal(f["start:google"], undefined, "deleted the same day");
});
test("the sign-in page's cards say where they are: signin, or gate when a page sent them", async () => {
  const si = await (await fetch(base + "/signin", { headers: H("10.0.1.1") })).text();
  assert.match(si, /auth\/google\?from=signin/);
  const g = await (await fetch(base + "/signin?back=%2Fmessages%2F%40someone", { headers: H("10.0.1.1") })).text();
  if (/Sign up with Google/.test(g)) assert.match(g, /from=gate/);
  await fetch(base + "/auth/google?from=gate", { redirect: "manual", headers: H("10.0.1.2", { "sec-fetch-user": "?1", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" }) });
  assert.equal(flows()["gate:google"].start, 1);
});

// 2026-11-03 (Growth Engine): scripts wearing browser agents opened every member's Message gate and inflated starts
test("an OAuth start counts at once only for a person's click; others count only if they reach the callback; crawlers get 403", async () => {
  // no user activation and no callback (a script following a gate link): held, not a start
  await fetch(base + "/auth/google", { redirect: "manual", headers: H("10.0.2.1", { referer: ORIGIN + "/" }) });
  let f = flows()["home:google"] || {}; assert.equal(f.start, undefined); assert.equal(f.start_unv, 1);
  // also without user activation, but the person does come back from Google: counted, under its door
  await fetch(base + "/auth/google?type=business", { redirect: "manual", headers: H("10.0.2.2") });
  assert.equal((flows()["join-business:google"] || {}).start, undefined);
  await fetch(base + "/auth/google/callback?error=access_denied", { redirect: "manual", headers: H("10.0.2.2") });
  f = flows()["join-business:google"]; assert.equal(f.start, 1); assert.equal(f.auth_fail, 1);
  // a bare hit claiming a click but sent from no page of ours (Sec-Fetch-Site none: proxy scanners, 11-04): held, not a start
  const was = flows()["signin:google"] || {};
  await fetch(base + "/auth/google?from=signin", { redirect: "manual", headers: H("10.0.2.5", { "sec-fetch-user": "?1", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" }) });
  f = flows()["signin:google"] || {}; assert.equal(f.start, was.start); assert.equal(f.start_unv, (was.start_unv || 0) + 1);
  // a real click on our page (Sec-Fetch-User: ?1, same-origin) counts at once
  await fetch(base + "/auth/google", { redirect: "manual", headers: H("10.0.2.3", { referer: ORIGIN + "/people", "sec-fetch-user": "?1", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" }) });
  assert.equal(flows()["gate:google"].start, 2);   // the earlier gate test's click plus this one
  // crawlers (robots.txt disallows /auth/) never start OAuth
  for (const ua of ["Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "\\x22Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36\\x22"]) {
    const r = await fetch(base + "/auth/github?back=%2F", { redirect: "manual", headers: { ...H("10.0.2.4"), "user-agent": ua } });
    assert.equal(r.status, 403, ua);
  }
});

