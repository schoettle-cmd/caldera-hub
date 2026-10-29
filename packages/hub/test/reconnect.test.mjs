// A member's GitHub sign-in died (GitHub refuses the refresh token): the account is flagged once, skipped by refreshes,
// cleared by signing in again; the one-time reconnect email goes out only when turned on, once, and can be unsubscribed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createHub } from "../dist/server.js";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
function hubWith(reconnect) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-reconnect-"));
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.writeFileSync(path.join(d, "github-app.json"), JSON.stringify({ id: 1, slug: "t", client_id: "cid", client_secret: "csec", pem: privateKey.export({ type: "pkcs1", format: "pem" }) }));
  const state = { dead: false, short: false, refreshes: 0 }, sent = [];
  const fake = async (u, init = {}) => { u = String(u);
    if (u.endsWith("/access_token")) { const b = JSON.parse(init.body || "{}");
      if (b.grant_type === "refresh_token") { state.refreshes++; return state.dead ? J({ error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." }) : J({ access_token: "tok2", refresh_token: "r2", expires_in: 28800 }); }
      return J({ access_token: "tok1", refresh_token: "r1", expires_in: state.short ? 1 : 28800 }); }
    if (u.endsWith("/user")) return J({ id: 8, login: "newbie", name: "Newbie", created_at: "2019-01-01T00:00:00Z", public_repos: 1, followers: 1, html_url: "https://github.com/newbie", avatar_url: "https://avatars.githubusercontent.com/u/1" });
    if (u.includes("avatars.githubusercontent.com")) return new Response(Buffer.from("png"));
    if (/\/repos\?|\/events/.test(u)) return J([]);
    return J({}, 404); };
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: fake, limits: { newProfilesPerDay: 100 }, email: { send: async m => { sent.push(m); }, reconnect } });
  return { h, d, state, sent };
}
async function signIn(base, code = "newbie") {
  const a = await fetch(base + "/auth/github", { redirect: "manual" });
  const jar = (a.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).filter(c => !c.endsWith("="));
  const st = new URL(a.headers.get("location")).searchParams.get("state");
  return fetch(base + `/auth/github/callback?code=${code}&state=${st}`, { headers: { cookie: jar.join("; ") }, redirect: "manual" });
}
// sign up (the page builds), then sign in again with a token GitHub will refuse to refresh, then a page view checks GitHub
async function killSignIn(h, base, state) {
  await signIn(base);
  await until(() => h.db.prepare("SELECT p.handle FROM gh_accounts g JOIN profiles p ON p.id=g.profile_id WHERE g.gh_id=8").get()?.handle);
  state.short = true; state.dead = true; await signIn(base);
  const handle = h.db.prepare("SELECT p.handle FROM gh_accounts g JOIN profiles p ON p.id=g.profile_id WHERE g.gh_id=8").get().handle;
  await fetch(base + `/@${handle}/`, { headers: { "user-agent": "Mozilla/5.0" } });
  return handle;
}
const until = async (f, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise(r => setTimeout(r, 50)); } };

test("dead GitHub sign-in: flagged once, skipped, cleared by signing in again; reconnect email once, only when on", async () => {
  const { h, d, state, sent } = hubWith(true);
  try {
    const base = "http://127.0.0.1:" + await h.listen(0);
    const handle = await killSignIn(h, base, state);
    const acct = () => h.db.prepare("SELECT reconnect, reconnect_mailed, profile_id FROM gh_accounts WHERE gh_id=8").get();
    await until(() => acct()?.reconnect);   // the page view's token refresh was refused
    const pid = acct().profile_id, n0 = state.refreshes;
    await fetch(base + `/@${handle}/`, { headers: { "user-agent": "Mozilla/5.0" } }); await new Promise(r => setTimeout(r, 200));
    assert.equal(state.refreshes, n0, "a flagged account is not retried");
    assert.deepEqual(h.reconnect.stats(), { flagged: 1, reachable: 0 }, "no address yet");
    h.mail.suggest(pid, "nb@realmail.dev", true, "github");
    assert.deepEqual(h.reconnect.stats(), { flagged: 1, reachable: 1 });
    assert.equal(await h.reconnect.sweep(), 1); assert.equal(await h.reconnect.sweep(), 0, "never twice");
    assert.equal(sent.length, 1); assert.equal(sent[0].to, "nb@realmail.dev");
    assert.equal(sent[0].subject, "Your Caldera city stopped updating: reconnect GitHub");
    assert.match(sent[0].text, new RegExp(`/auth/github\\?back=%2F%40${handle}%2F`)); assert.match(sent[0].text, /Read-only/);
    assert.match(sent[0].headers["List-Unsubscribe"], /invite-unsub\?t=/);
    // signing in with GitHub again clears the flag
    state.dead = false; state.short = false; await signIn(base);
    await until(() => !acct().reconnect);
    // the unsubscribe link suppresses the address
    const un = sent[0].headers["List-Unsubscribe"].slice(1, -1).replace("http://hub.test", base);
    assert.equal((await fetch(un, { method: "POST" })).status, 200);
    h.db.prepare("UPDATE gh_accounts SET reconnect='2026-10-29T00:00:00Z', reconnect_mailed=NULL WHERE gh_id=8").run();
    assert.deepEqual(h.reconnect.stats(), { flagged: 1, reachable: 0 }, "unsubscribed address is never emailed");
  } finally { h.server.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test("reconnect email stays off unless turned on", async () => {
  const { h, d, sent, state } = hubWith(false);
  try {
    const base = "http://127.0.0.1:" + await h.listen(0);
    await killSignIn(h, base, state);
    await until(() => h.db.prepare("SELECT reconnect FROM gh_accounts WHERE gh_id=8").get()?.reconnect);
    const pid = h.db.prepare("SELECT profile_id FROM gh_accounts WHERE gh_id=8").get().profile_id;
    h.mail.suggest(pid, "nb@realmail.dev", true, "github");
    assert.equal(await h.reconnect.sweep(), 0); assert.equal(sent.filter(m => /reconnect GitHub/.test(m.subject)).length, 0);
  } finally { h.server.close(); fs.rmSync(d, { recursive: true, force: true }); }
});
