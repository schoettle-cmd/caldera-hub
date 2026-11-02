// An email-first member who connects GitHub (Settings, or a GitHub sign-in whose verified address is theirs) gets the
// GitHub account linked and its public repos as their city. It used to sign them in only, so "connect" changed nothing
// (Arsen Yeremin 2026-11-02: "Is github integration not working yet?").
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import crypto from "node:crypto";
import { createHub } from "../dist/server.js";
const ORIGIN = "http://hub.test";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
let hub, base, dir; const mails = [];
const form = (p, body, cookie = "") => fetch(base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body).toString() });
const linkIn = m => m.text.match(/https?:\/\/\S+/g).map(u => u.replace(ORIGIN, base));
const db = () => new (process.getBuiltinModule("node:sqlite").DatabaseSync)(path.join(dir, "hub.sqlite"));
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-ghconnect-"));
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.writeFileSync(path.join(dir, "github-app.json"), JSON.stringify({ id: 1, slug: "t", client_id: "cid", client_secret: "csec", pem: privateKey.export({ type: "pkcs1", format: "pem" }) }));
  const fake = async (u) => { u = String(u);
    if (u.endsWith("/access_token")) return J({ access_token: "tok-ars", token_type: "bearer", scope: "user:email" });
    if (u.endsWith("/user")) return J({ id: 991, login: "ArsDev", name: "Ars Dev", created_at: "2019-01-01T00:00:00Z", public_repos: 2, followers: 3, html_url: "https://github.com/ArsDev", avatar_url: "https://avatars.githubusercontent.com/u/991" });
    if (u.endsWith("/user/emails")) return J([{ email: "ars@realmail.test", primary: true, verified: true }]);
    if (/\/users\/arsdev$/i.test(u)) return J({ login: "ArsDev", type: "User", name: "Ars Dev", html_url: "https://github.com/ArsDev", public_repos: 2, followers: 3, created_at: "2019-01-01T00:00:00Z" });
    if (/\/users\/arsdev\/repos/i.test(u)) return J([{ name: "tool", full_name: "ArsDev/tool", fork: false, private: false, language: "Go", pushed_at: new Date().toISOString(), created_at: "2020-01-01T00:00:00Z", size: 10, html_url: "https://github.com/ArsDev/tool", stargazers_count: 4 },
      { name: "web", full_name: "ArsDev/web", fork: false, private: false, language: "TypeScript", pushed_at: new Date().toISOString(), created_at: "2021-01-01T00:00:00Z", size: 20, html_url: "https://github.com/ArsDev/web", stargazers_count: 1 }]);
    if (u.includes("avatars.githubusercontent.com")) return new Response(Buffer.from("png"));
    if (u.includes("/repos?") || u.includes("/events")) return J([]);
    return J({}, 404); };
  hub = createHub({ dataDir: dir, publicUrl: ORIGIN, githubFetch: fake, limits: { newProfilesPerDay: 100 }, email: { send: async m => { mails.push(m); } } });
  base = "http://127.0.0.1:" + await hub.listen(0);
});
after(() => { hub.server.closeAllConnections?.(); hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
test("email-first member connects GitHub: linked, city built, page links GitHub, told it worked", async () => {
  await form("/start", { text: "name: Ars Dev\nheadline: Builds tools", email: "ars@realmail.test" });
  const t = new URL(linkIn(mails.at(-1)).find(u => u.includes("/start/confirm"))).searchParams.get("t");
  const c = await form("/start/confirm", { t }); assert.equal(c.status, 302);
  const own = (c.headers.getSetCookie?.() || []).map(x => x.split(";")[0]).filter(x => !x.endsWith("=")).join("; ");
  const handle = db().prepare("SELECT handle FROM email_accounts LIMIT 1").get().handle;
  assert.equal((await fetch(base + `/@${handle}/city.html`)).status, 404, "no city before GitHub");
  const s = await fetch(base + "/auth/github", { redirect: "manual", headers: { cookie: own } });
  const st = new URL(s.headers.get("location")).searchParams.get("state");
  const ck = [own, ...(s.headers.getSetCookie?.() || []).map(x => x.split(";")[0])].join("; ");
  const cb = await fetch(base + `/auth/github/callback?state=${st}&code=ars`, { redirect: "manual", headers: { cookie: ck } });
  assert.equal(cb.status, 302); assert.match(cb.headers.get("location"), /gh=connected/);
  const d = db(); const link = d.prepare("SELECT login FROM gh_links WHERE gh_id=991").get(); d.close();
  assert.equal(link?.login, "ArsDev", "the GitHub account is linked to the email page");
  assert.equal((await fetch(base + `/@${handle}/city.html`)).status, 200, "the city is built");
  assert.match(await (await fetch(base + `/@${handle}/`)).text(), /github\.com\/ArsDev/, "the page links the GitHub account");
});
