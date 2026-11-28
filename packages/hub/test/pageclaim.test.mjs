// Connect Obsidian: a page moves into a vault at the same address, the key leaves the hub only after the plugin confirms, no second page.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });   // temp hubs are removed after the file's tests, even when one fails
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const jwt = o => "x." + Buffer.from(JSON.stringify(o)).toString("base64url") + ".x";
async function boot({ flag = { obsidian: true } } = {}) {
  const d = __mkdtemp(path.join(os.tmpdir(), "caldera-claim-")); fs.writeFileSync(path.join(d, "google-oauth.json"), JSON.stringify({ client_id: "cid", client_secret: "s" }));
  if (flag) fs.writeFileSync(path.join(d, "google-first.json"), JSON.stringify(flag));
  const st = { claims: {} }; const fake = async u => String(u).includes("oauth2.googleapis.com/token") ? J({ id_token: jwt(st.claims) }) : J({}, 404);
  const pub = "http://hub.test", h = createHub({ dataDir: d, publicUrl: pub, githubFetch: fake, limits: { newProfilesPerDay: 100 }, email: { send: async m => { st.mails.push(m); } } }); st.mails = [];
  return { h, d, st, pub, base: "http://127.0.0.1:" + await h.listen(0) };
}
const stop = b => { b.h.server.closeAllConnections?.(); b.h.server.close(); };
async function google(b, email, name, kind = "") {
  const s = await fetch(b.base + "/auth/google" + (kind ? "?type=" + kind : ""), { redirect: "manual" }), state = new URL(s.headers.get("location")).searchParams.get("state");
  b.st.claims = { iss: "https://accounts.google.com", aud: "cid", nonce: state, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email, name };
  const r = await fetch(b.base + `/auth/google/callback?state=${state}&code=a`, { redirect: "manual", headers: { cookie: s.headers.get("set-cookie").split(";")[0] } });
  return { r, own: r.headers.get("set-cookie").split(";")[0] };
}
const issue = async (b, own) => { const r = await fetch(b.base + "/settings/obsidian", { method: "POST", redirect: "manual", headers: { cookie: own, origin: b.pub } }); const t = await r.text(); return { status: r.status, text: t, code: (t.match(/CAL-P-[\w-]+/) || [])[0] }; };
const post = (b, p, code) => fetch(b.base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
const db = b => new (process.getBuiltinModule("node:sqlite").DatabaseSync)(path.join(b.d, "hub.sqlite"));

test("the switch is off: no button and no code", async () => { const b = await boot({ flag: null }); try { const { own } = await google(b, "a@example.com", "Ann Off");
  assert.doesNotMatch(await (await fetch(b.base + "/settings", { headers: { cookie: own } })).text(), /Connect Obsidian/);
  assert.equal((await issue(b, own)).code, undefined); } finally { stop(b); } });
test("signed out or from another site: no code", async () => { const b = await boot(); try { const { own } = await google(b, "b@example.com", "Bo Site");
  assert.equal((await fetch(b.base + "/settings/obsidian", { method: "POST", redirect: "manual" })).status, 302);
  const r = await fetch(b.base + "/settings/obsidian", { method: "POST", headers: { cookie: own, origin: "https://evil.example" } }); assert.doesNotMatch(await r.text(), /CAL-P-/); } finally { stop(b); } });
test("full path: same id and address, hub keeps the key until confirm, then it's gone and the email still signs in, no second page", async () => { const b = await boot(); try {
  const { own } = await google(b, "c@example.com", "Cy Vault"); const { code } = await issue(b, own); assert.match(code, /^CAL-P-/);
  const d0 = db(b), before = d0.prepare("SELECT profile_id, handle FROM email_accounts WHERE handle='cy-vault'").get();
  assert.equal(d0.prepare("SELECT COUNT(*) n FROM page_claims WHERE code_hash=?").get(code).n, 0, "code stored hashed");
  const c1 = await (await post(b, "/v1/page/claim", code)).json(); assert.equal(c1.identity.id, before.profile_id); assert.equal(c1.handle, "cy-vault"); assert.equal(c1.page.name, "Cy Vault");
  assert.equal((await post(b, "/v1/page/claim", code)).status, 200, "a lost reply can be retried");
  assert.ok(d0.prepare("SELECT key_sealed k FROM email_accounts WHERE profile_id=?").get(before.profile_id).k, "still hosted before confirm");
  assert.equal((await post(b, "/v1/page/claim/confirm", code)).status, 200);
  const after = d0.prepare("SELECT key_sealed k, claimed FROM email_accounts WHERE profile_id=?").get(before.profile_id); assert.equal(after.k, ""); assert.ok(after.claimed);
  assert.equal((await post(b, "/v1/page/claim", code)).status, 404, "code dead after confirm");
  const again = await google(b, "c@example.com", "Cy Vault"); assert.match(again.r.headers.get("location"), /^\/@cy-vault\//);
  assert.equal(d0.prepare("SELECT COUNT(*) n FROM email_accounts").get().n, 1, "no second page");
  assert.equal((await fetch(b.base + "/@cy-vault/")).status, 200); d0.close();
} finally { stop(b); } });
test("bad, GitHub-style or wrong codes change nothing; the old endpoint refuses page codes", async () => { const b = await boot(); try {
  const { own } = await google(b, "d@example.com", "Di Safe"); const { code } = await issue(b, own);
  for (const x of ["CAL-P-wrongwrongwrong", "CAL-abcdef", "", "x"]) { assert.equal((await post(b, "/v1/page/claim", x)).status, 404); assert.equal((await post(b, "/v1/page/claim/confirm", x)).status, 404); }
  assert.equal((await post(b, "/v1/github/claim", code)).status, 404, "an old plugin can't take it");
  const d0 = db(b); assert.ok(d0.prepare("SELECT key_sealed k FROM email_accounts WHERE handle='di-safe'").get().k); d0.close();
} finally { stop(b); } });
test("a new code kills the old one; designer pages aren't offered it", async () => { const b = await boot(); try {
  const { own } = await google(b, "e@example.com", "Ed Twice"); const one = await issue(b, own), two = await issue(b, own);
  assert.equal((await post(b, "/v1/page/claim", one.code)).status, 404); assert.equal((await post(b, "/v1/page/claim", two.code)).status, 200);
  const de = await google(b, "f@example.com", "Fay Draw", "designer"); assert.equal((await issue(b, de.own)).code, undefined);
} finally { stop(b); } });
test("after the move the vault's signed publish updates the same page, and the owner's settings still open", async () => { const b = await boot(); try {
  const { own } = await google(b, "g@example.com", "Gus Vault"); const { code } = await issue(b, own);
  const c1 = await (await post(b, "/v1/page/claim", code)).json(); await post(b, "/v1/page/claim/confirm", code);
  const m = C.sign(c1.identity, "profile.manifest", { name: "Gus From Vault", handle: c1.handle, boxKey: c1.identity.boxPublic, headline: "from my vault", links: [], sections: [], files: {}, updated: new Date().toISOString() });
  const pub = await fetch(b.base + `/v1/profiles/${encodeURIComponent(c1.identity.id)}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: m, files: { "index.html": "<!doctype html><title>x</title><h1>Gus From Vault</h1>" } }) });
  assert.equal(pub.status, 200, await pub.clone().text());
  assert.match(await (await fetch(b.base + "/@gus-vault/")).text(), /Gus From Vault/);
  const set = await fetch(b.base + "/settings", { redirect: "manual", headers: { cookie: own } }); assert.equal(set.status, 200, "settings " + set.status + " " + set.headers.get("location"));
  assert.doesNotMatch(await set.text(), /Now make it official/);
} finally { stop(b); } });
test("the claim says which photo to bring, only when there is one", async () => { const b = await boot(); try {
  const { own } = await google(b, "h@example.com", "Hal Photo"); const none = await issue(b, own);
  assert.equal((await (await post(b, "/v1/page/claim", none.code)).json()).page.photoExt, "");
  const d0 = db(b), id = d0.prepare("SELECT profile_id p FROM email_accounts WHERE handle='hal-photo'").get().p; d0.close();
  const dir = path.join(b.d, "uploads", "email", id.replace(/[^A-Za-z0-9]/g, "_")); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "photo.png"), "x");
  const two = await issue(b, own); assert.equal((await (await post(b, "/v1/page/claim", two.code)).json()).page.photoExt, "png");
} finally { stop(b); } });

// daily feature caldera-obsidian-connect-on (11-28): email pages get their own "Use Obsidian?" card; one Obsidian action per screen
async function emailPage(b, email, name) {
  const form = (p, body) => fetch(b.base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: b.pub }, body: new URLSearchParams(body).toString() });
  await form("/start", { text: `name: ${name}\nheadline: I make tools\nabout: Ten years of kitchens.\nprojects:\n- Menu | a planner`, email });
  const t = b.st.mails[b.st.mails.length - 1].text.match(/start\/confirm\?t=(\S+)/)[1];
  const c = await form("/start/confirm", { t: new URL(b.base + "/start/confirm?t=" + t).searchParams.get("t") });
  return (c.headers.getSetCookie?.() || [c.headers.get("set-cookie")]).map(x => x.split(";")[0]).join("; ");
}
test("switch on: email pages get the Use Obsidian? card and a working code; Google pages keep one row, no card", async () => { const b = await boot(); try {
  const own = await emailPage(b, "e@example.com", "Eve Mail"), page = await (await fetch(b.base + "/settings", { headers: { cookie: own } })).text();
  assert.match(page, /id="obsidian"><h2>Use Obsidian\?<\/h2>/); assert.equal((page.match(/action="\/settings\/obsidian"/g) || []).length, 1);
  assert.doesNotMatch(page, /Use GitHub or Obsidian\? Connecting them later/, "the old 'later' line goes when the card shows");
  const r = await issue(b, own); assert.match(r.code, /^CAL-P-/); assert.match(r.text, /obsidian\.md\/download/); assert.match(r.text, /Community plugins &gt; Browse/);
  const g = (await google(b, "g@example.com", "Gus Goo")).own, gp = await (await fetch(b.base + "/settings", { headers: { cookie: g } })).text();
  assert.match(gp, /id="richer"/); assert.doesNotMatch(gp, /id="obsidian"/); assert.equal((gp.match(/action="\/settings\/obsidian"/g) || []).length, 1);
  assert.match(gp, /It moves into your vault; you edit it there/); assert.doesNotMatch(gp, /flex-wrap:nowrap/, "rows wrap on a phone");
} finally { stop(b); } });
test("switch off: email pages keep the old line and no card", async () => { const b = await boot({ flag: { on: true } }); try {
  const own = await emailPage(b, "f@example.com", "Fay Off"), page = await (await fetch(b.base + "/settings", { headers: { cookie: own } })).text();
  assert.doesNotMatch(page, /id="obsidian"|Connect Obsidian/); assert.match(page, /Use GitHub or Obsidian\? Connecting them later/);
} finally { stop(b); } });
