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
  const fake = async (u, init = {}) => { u = String(u); if (u.includes("oauth2.googleapis.com/token")) { st.calls.push(String(init.body)); return J({ id_token: jwt(st.claims) }); } return J({}, 404); };
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
