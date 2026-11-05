// Agency Super (caldera-signups, src/agencysuper.ts): ?asc= kept 30 days; fixed on the profile at creation through email
// (same device and another device), GitHub; one signed signup postback; bad ids ignored; the header backs it up in localStorage.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import crypto from "node:crypto"; import http from "node:http";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });   // temp hubs are removed after the file's tests, even when one fails
const ORIGIN = "http://hub.test", SECRET = "s3cret-test";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
let hub, base, dir, as, asUrl; const mails = [], posts = [];
const form = (p, body, cookie = "") => fetch(base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body) });
const linkIn = m => m.text.match(/https?:\/\/\S+/g).map(u => u.replace(ORIGIN, base));
const db = () => new (process.getBuiltinModule("node:sqlite").DatabaseSync)(path.join(dir, "hub.sqlite"));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
before(async () => {
  as = http.createServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { posts.push({ sig: req.headers["x-as-signature"], body: b }); res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); }); });
  await new Promise(r => as.listen(0, r)); asUrl = `http://127.0.0.1:${as.address().port}/api/fp/conversion`;
  process.env.AGENCYSUPER_URL = asUrl; process.env.AGENCYSUPER_SECRET = SECRET;
  const { createHub } = await import("../dist/server.js");
  dir = __mkdtemp(path.join(os.tmpdir(), "caldera-as-"));
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.writeFileSync(path.join(dir, "github-app.json"), JSON.stringify({ id: 1, slug: "t", client_id: "cid", client_secret: "csec", pem: privateKey.export({ type: "pkcs1", format: "pem" }) }));
  const fake = async (u) => { u = String(u);
    if (u.endsWith("/access_token")) return J({ access_token: "tok", token_type: "bearer", scope: "user:email" });
    if (u.endsWith("/user")) return J({ id: 4242, login: "PinDev", name: "Pin Dev", created_at: "2019-01-01T00:00:00Z", public_repos: 1, followers: 1, html_url: "https://github.com/PinDev", avatar_url: "https://avatars.githubusercontent.com/u/4242" });
    if (u.endsWith("/user/emails")) return J([{ email: "pin@realmail.test", primary: true, verified: true }]);
    if (/\/users\/pindev$/i.test(u)) return J({ login: "PinDev", type: "User", name: "Pin Dev", html_url: "https://github.com/PinDev", public_repos: 1, followers: 1, created_at: "2019-01-01T00:00:00Z" });
    if (u.includes("avatars.githubusercontent.com")) return new Response(Buffer.from("png"));
    if (u.includes("/repos") || u.includes("/events")) return J([]);
    return J({}, 404); };
  hub = createHub({ dataDir: dir, publicUrl: ORIGIN, githubFetch: fake, limits: { newProfilesPerDay: 100 }, email: { send: async m => { mails.push(m); } } });
  base = "http://127.0.0.1:" + await hub.listen(0);
});
after(() => { hub.server.closeAllConnections?.(); hub.server.close(); as.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("arrival: ?asc= sets a 30-day first-party cookie; a bad id is ignored; the header carries the localStorage backup", async () => {
  const { createHub } = await import("../dist/server.js");
  const d = __mkdtemp(path.join(os.tmpdir(), "caldera-as2-")), site = __mkdtemp(path.join(os.tmpdir(), "caldera-as2-site-"));
  fs.writeFileSync(path.join(site, "index.html"), `<!doctype html><html><head><title>x</title></head><body><header class="nav"><a class="brand" href="./">Caldera</a><nav><a href="/signin">Sign in</a></nav></header><main>x</main></body></html>`);
  const h = createHub({ dataDir: d, siteDir: site, publicUrl: ORIGIN, limits: { newProfilesPerDay: 100 } });
  const b2 = "http://127.0.0.1:" + await h.listen(0);
  try {
    const r = await fetch(b2 + "/?asc=pin_click_001", { redirect: "manual" });
    const ck = (r.headers.getSetCookie?.() || []).find(c => c.startsWith("asc="));
    assert.ok(ck, "cookie set"); assert.match(ck, /Max-Age=2592000/); assert.match(ck, /SameSite=Lax/);
    assert.match(await r.text(), /localStorage\.setItem\('asc'/, "the header backs it up in localStorage");
    const bad = await fetch(b2 + "/?asc=" + encodeURIComponent("<script>"), { redirect: "manual" });
    assert.ok(!(bad.headers.getSetCookie?.() || []).some(c => c.startsWith("asc=")), "bad id ignored");
  } finally { h.server.closeAllConnections?.(); h.server.close(); fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(site, { recursive: true, force: true }); }
});
test("email sign-up, same device: the click is fixed on the new profile and one signed signup postback goes out", async () => {
  await form("/start", { text: "name: Pin One\nheadline: Makes things", email: "one@realmail.test" }, "asc=pin_click_001");
  const t = new URL(linkIn(mails.at(-1)).find(u => u.includes("/start/confirm"))).searchParams.get("t");
  assert.equal((await form("/start/confirm", { t }, "asc=pin_click_001")).status, 302);
  await wait(2500);
  const d = db(); const c = d.prepare("SELECT c.asc, e.status, e.test FROM as_clicks c JOIN as_events e ON e.profile_id=c.profile_id").all(); d.close();
  assert.equal(c.length, 1); assert.equal(c[0].asc, "pin_click_001"); assert.equal(c[0].status, "sent"); assert.equal(c[0].test, 0);
  assert.equal(posts.length, 1);
  const b = JSON.parse(posts[0].body);
  assert.equal(posts[0].sig, "sha256=" + crypto.createHmac("sha256", SECRET).update(posts[0].body).digest("hex"));
  assert.equal(b.campaign, "caldera-signups"); assert.equal(b.event, "signup"); assert.equal(b.click_id, "pin_click_001"); assert.match(b.customer_ref, /^[0-9a-f]{64}$/);
  assert.ok(!/realmail|Pin One/.test(posts[0].body), "nothing personal sent");
});
test("email sign-up, other device: the link opened without the cookie still gets the click (kept with the address)", async () => {
  await form("/start", { text: "name: Pin Two\nheadline: Makes things", email: "two@realmail.test" }, "asc=pin_click_002");
  const t = new URL(linkIn(mails.at(-1)).find(u => u.includes("/start/confirm"))).searchParams.get("t");
  assert.equal((await form("/start/confirm", { t })).status, 302);
  const d = db(); const n = d.prepare("SELECT COUNT(*) n FROM as_clicks WHERE asc='pin_click_002'").get().n; d.close();
  assert.equal(n, 1);
});
test("GitHub sign-up with the cookie: fixed on the profile; no cookie = nothing", async () => {
  const s = await fetch(base + "/auth/github", { redirect: "manual", headers: { cookie: "asc=pin_click_003" } });
  const st = new URL(s.headers.get("location")).searchParams.get("state");
  const ck = ["asc=pin_click_003", ...(s.headers.getSetCookie?.() || []).map(x => x.split(";")[0])].join("; ");
  const cb = await fetch(base + `/auth/github/callback?state=${st}&code=pin`, { redirect: "manual", headers: { cookie: ck } });
  assert.equal(cb.status, 302);
  const d = db(); const n = d.prepare("SELECT COUNT(*) n FROM as_clicks WHERE asc='pin_click_003'").get().n, all = d.prepare("SELECT COUNT(*) n FROM as_clicks").get().n; d.close();
  assert.equal(n, 1); assert.equal(all, 3);
});
