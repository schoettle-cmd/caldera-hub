import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });   // temp hubs are removed after the file's tests, even when one fails

// caldera.social/gh/<login>: anyone's public GitHub as a city, README badges, member redirects, limits
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const UA = { "user-agent": "Mozilla/5.0" };
let calls = 0;
const fake = async (u) => { u = String(u); calls++;
  if (/\/users\/octo$/.test(u)) return J({ login: "Octo", type: "User", name: "Octo Cat", bio: "I build agents", html_url: "https://github.com/Octo", email: "secret@example.com" });
  if (/\/users\/acme$/.test(u)) return J({ login: "acme", type: "Organization", html_url: "https://github.com/acme" });
  if (/\/orgs\/acme\/repos\?/.test(u)) return J([{ name: "api", full_name: "acme/api", language: "Go", size: 500, fork: false, private: false, html_url: "https://github.com/acme/api", pushed_at: "2026-10-01T00:00:00Z" }]);
  if (/\/users\/bot1$/.test(u)) return J({ login: "bot1", type: "Bot", html_url: "https://github.com/bot1" });
  if (/\/users\/Octo\/repos\?/.test(u)) return J([
    { name: "agentkit", full_name: "Octo/agentkit", language: "TypeScript", size: 900, fork: false, private: false, html_url: "https://github.com/Octo/agentkit", description: "Agents <b>", pushed_at: "2026-10-01T00:00:00Z" },
    { name: "notes", full_name: "Octo/notes", language: "Python", size: 10, fork: false, private: false, html_url: "https://github.com/Octo/notes", pushed_at: "2026-09-01T00:00:00Z" },
    { name: "forked", full_name: "Octo/forked", language: "Go", size: 10, fork: true, private: false, html_url: "https://github.com/Octo/forked" }]);
  if (/\/repos\/Octo\/agentkit\/stats\/commit_activity/.test(u)) return J(Array.from({ length: 52 }, (_, i) => ({ total: i === 51 ? 4 : 2 })));
  if (/\/repos\/Octo\/notes\/stats\/commit_activity/.test(u)) return new Response("", { status: 202 });
  return J({ message: "Not Found" }, 404); };

async function setup() {
  const d = __mkdtemp(path.join(os.tmpdir(), "caldera-ghp-"));
  const sent = [];
  const hub = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: fake, limits: { newProfilesPerDay: 100 }, email: { send: async m => { sent.push(m); } } });
  const base = "http://127.0.0.1:" + await hub.listen(0);
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const get = (p, h = {}) => fetch(base + p, { headers: { ...UA, ...h }, redirect: "manual" });
  return { hub, d, base, post, get, sent };
}

test("/gh/<login>: a preview city from public data, cached, never the email; badges; org and unknown users", async () => {
  const S = await setup();
  try {
    const land = await S.get("/gh"); assert.equal(land.status, 200); assert.match(await land.text(), /See any GitHub as a city/);
    assert.equal((await S.get("/gh?u=https://github.com/octo")).headers.get("location"), "/gh/octo");
    const r0 = await S.get("/gh/octo"); assert.equal(r0.status, 301); assert.equal(r0.headers.get("location"), "/gh/Octo", "canonical case");
    const r = await S.get("/gh/Octo"); assert.equal(r.status, 200);
    const h = await r.text();
    assert.match(h, /@Octo's public GitHub as a city/); assert.match(h, /Claim it with GitHub/); assert.match(h, /og:image/);
    assert.match(h, /"name":"agentkit"/); assert.doesNotMatch(h, /forked/, "forks are left out");
    assert.match(h, /\/gh\/Octo\/badge\.svg\?style=card/); assert.match(h, /privacy@caldera\.social/);
    assert.doesNotMatch(h, /secret@example\.com/);
    const stored = fs.readFileSync(path.join(S.d, "gh-preview", "octo.json"), "utf8"); assert.doesNotMatch(stored, /secret@/, "never stores the email");
    assert.match(JSON.parse(stored).commits.toString(), /^107$/, "52 weeks of commits + the 202 repo counted as 1");
    const n = calls; await S.get("/gh/Octo"); assert.equal(calls, n, "served from cache");
    const b = await S.get("/gh/Octo/badge.svg"); assert.equal(b.status, 200); assert.match(b.headers.get("content-type"), /image\/svg\+xml/);
    const svg = await b.text(); assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/); assert.match(svg, /2 repos · 107 commits\/yr/);
    const card = await (await S.get("/gh/Octo/badge.svg?style=card")).text(); assert.match(card, /width="420" height="92"/); assert.match(card, /GitHub city on Caldera/);
    // organizations get a company city (no claim button); other account types are refused
    const org = await S.get("/gh/acme"); assert.equal(org.status, 200); const oh = await org.text();
    assert.match(oh, /acme\/api|>api</); assert.doesNotMatch(oh, /Claim it with GitHub/); assert.match(oh, /careers page/);
    assert.equal((await S.get("/gh/bot1")).status, 422);
    assert.equal((await S.get("/gh/nobody-here")).status, 404);
    assert.equal((await S.get("/gh/bad_login!")).status, 404);
  } finally { S.hub.server.close(); }
});

test("/gh/<login> of a member goes to their real city; member badges; fresh builds are limited per visitor", async () => {
  const S = await setup();
  try {
    const id = C.newIdentity();
    await S.post(`/v1/profiles/${id.id}/bundle`, { manifest: C.sign(id, "profile.manifest", { name: "Ann", handle: "ann", boxKey: id.boxPublic, links: [["GitHub", "https://github.com/ann-gh"]] }),
      files: { "index.html": Buffer.from("<html><head></head><body>ann</body></html>").toString("base64"),
        "city.html": Buffer.from(`<html><body><script type="application/json" id="city-data">${JSON.stringify({ private: false, districts: [{ name: "Web", notes: 0, repos: [{ name: "site", project: "Web", public: true, language: "HTML", commits: 30, weeks: [], week: 1, today: 0 }] }] })}</script></body></html>`).toString("base64") } });
    S.hub.db.prepare("INSERT INTO gh_links VALUES (?,?,?,?)").run(77, "ann-gh", id.id, new Date().toISOString());   // a verified link (a bare listing doesn't count)
    const r = await S.get("/gh/ann-gh"); assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/@ann/city.html");
    const mb = await S.get("/@ann/badge.svg"); assert.equal(mb.status, 200); assert.match(await mb.text(), /1 repo · 30 commits\/yr/);
    assert.match(await (await S.get("/gh/ann-gh/badge.svg")).text(), /@ann/, "a member's login badge shows their real city");
    let last = 0; for (let i = 0; i < 21; i++) last = (await S.get(`/gh/ghost-${i}`)).status;
    assert.equal(last, 429, "21st fresh build in an hour from one visitor waits");
  } finally { S.hub.server.close(); }
});

test("'Email me my city' for everyone (save1 ended 4d09685); the email carries the city link, claim button and badge", async () => {
  const sent = [], d = __mkdtemp(path.join(os.tmpdir(), "caldera-save-"));
  let hub;
  try {
    hub = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: fake, limits: { newProfilesPerDay: 100 }, email: { send: async m => { sent.push(m); } } });
    const base = "http://127.0.0.1:" + await hub.listen(0);
    const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-site": "none", accept: "text/html" };
    const CH = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
    await fetch(base + "/gh/octo", { headers: { "user-agent": "Mozilla/5.0" }, redirect: "manual" });   // the stub answers /users/octo; caches Octo
    let a = 0, b = 0, bUa = "";
    for (let i = 0; i < 20; i++) {
      const r = await fetch(base + "/gh/Octo", { headers: { ...NAV, "user-agent": CH + " s" + i } }); assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "private, max-age=0");
      const h = await r.text(); assert.match(h, /Claim it with GitHub/);
      assert.match(h, /name="city" value="Octo"/); assert.match(h, /name="website"/);
      if (h.includes("Email me my city")) { b++; bUa = CH + " s" + i; } else if (h.includes("Show my career read")) a++; else assert.fail("no email box");
    }
    assert.equal(a + b, 20, "every visitor gets an email box: the city (cg1 a) or the career read (cg1 b)"); assert.ok(b > 0);
    const bot = await (await fetch(base + "/gh/Octo", { headers: { "user-agent": "Googlebot/2.1" } })).text();
    assert.doesNotMatch(bot, /Email me my city/);
    const r = await fetch(base + "/signin/signup-email", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://hub.test", ...NAV, "user-agent": bUa }, body: new URLSearchParams({ email: "dev@person.dev", city: "Octo", website: "" }).toString() });
    assert.match(await r.text(), /Your city is on its way/);
    assert.equal(sent.length, 1); assert.match(sent[0].subject, /Your GitHub city: @Octo/);
    assert.match(sent[0].text, /http:\/\/hub\.test\/gh\/Octo/); assert.match(sent[0].text, /auth\/github\?back=%2Fgh%2FOcto/); assert.match(sent[0].text, /badge\.svg\?style=card/);
    assert.deepEqual(hub.db.prepare("SELECT detail FROM funnel_events WHERE step='email-start'").all().map(x => x.detail), ["city"]);
  } finally { hub?.server.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test("/gh/<login>/career: free evaluation from public data, noindex, not a rating, orgs and unknowns handled", async () => {
  const S = await setup();
  try {
    assert.equal((await S.get("/gh/octo/career")).headers.get("location"), "/gh/Octo/career", "canonical case keeps the page");
    const r = await S.get("/gh/Octo/career?full=1"); assert.equal(r.status, 200);
    const h = await r.text();
    assert.match(h, /<h1>Octo builds like (an Explorer|a Steady Maintainer)\.<\/h1>/); assert.match(h, /noindex/); assert.match(h, /isn't a rating/);
    assert.match(h, /Frontend or full-stack engineer/, "TypeScript led"); assert.match(h, /TypeScript leads your public work/); assert.match(h, /public repos/);
    assert.match(h, /Put this on my free profile/); assert.match(h, /Share this read/); assert.match(h, /career%3Fs%3D1/); assert.match(h, /og:title" content="Octo builds like/); assert.doesNotMatch(h, /secret@example\.com/); assert.doesNotMatch(h, /forked/);
    const sky = await S.get("/gh/Octo/skyline.svg"); assert.equal(sky.status, 200); assert.match(await sky.text(), /<rect/);
    assert.match(await (await S.get("/gh/Octo")).text(), /\/gh\/Octo\/career/, "preview links to it");
    assert.equal((await S.get("/gh/acme/career")).headers.get("location"), "/gh/acme", "orgs get the city");
    assert.doesNotMatch(await (await S.get("/gh/acme")).text(), /career read/i);
    assert.equal((await S.get("/gh/nobody-here/career")).status, 404);
  } finally { S.hub.server.close(); }
});

test("cg1: arm b holds back the rest of the read until an email, sends the existing city mail once, and bots get it open", async () => {
  const S = await setup();
  try {
    const CH = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
    const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-site": "none", accept: "text/html" };
    await S.get("/gh/octo");
    let gated = "", open = 0, ua = "";
    for (let i = 0; i < 30; i++) {
      const u = CH + " c" + i, r = await fetch(S.base + "/gh/Octo/career", { headers: { ...NAV, "user-agent": u } }); assert.equal(r.headers.get("cache-control"), "private, max-age=0");
      const h = await r.text();
      if (h.includes("See the rest of this read")) { gated = h; ua = u; } else { open++; assert.match(h, /Jobs this work fits/); }
    }
    assert.ok(gated && open, "both arms served");
    assert.match(gated, /builds like/); assert.match(gated, /skyline\.svg/); assert.doesNotMatch(gated, /Jobs this work fits/); assert.doesNotMatch(gated, /Do these next/);
    assert.match(gated, /once\. No mailing list\./, "says what the email is for");
    assert.doesNotMatch(await (await fetch(S.base + "/gh/Octo/career", { headers: { "user-agent": "Googlebot/2.1" } })).text(), /See the rest of this read/);
    const r = await fetch(S.base + "/signin/signup-email", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://hub.test", ...NAV, "user-agent": ua }, body: new URLSearchParams({ email: "dev@person.dev", city: "Octo", from: "career" }) });
    assert.equal(r.status, 303); assert.equal(r.headers.get("location"), "/gh/Octo/career?full=1");
    assert.equal(S.sent.length, 1); assert.match(S.sent[0].subject, /Your GitHub city: @Octo/);
    assert.match(await (await fetch(S.base + "/gh/Octo/career?full=1", { headers: { ...NAV, "user-agent": ua } })).text(), /Jobs this work fits/);
    const n = Object.fromEntries(S.hub.db.prepare("SELECT step, COUNT(*) n FROM funnel_events WHERE step LIKE 'cg-%' GROUP BY 1").all().map(x => [x.step, x.n]));
    assert.equal(n["cg-email"], 1); assert.ok(n["cg-a"] > 0 && n["cg-b"] > 0);
  } finally { S.hub.server.close(); }
});

test("email sign-up with a public GitHub: the city comes along, labeled unverified, without any claim on the account", async () => {
  const S = await setup(); process.env.TYPED_MIN_MS = "0";
  try {
    const CH = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
    const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-site": "none", accept: "text/html", "user-agent": CH };
    assert.match(await (await fetch(S.base + "/gh/octo", { headers: NAV, redirect: "follow" })).text(), /join\/developer\?gh=Octo/, "preview offers it");
    const form = await (await fetch(S.base + "/join/developer?gh=octo", { headers: NAV })).text();
    assert.match(form, /name="gh" value="Octo"/); assert.match(form, /no GitHub connection/); assert.match(form, /unverified city/);
    const stamp = form.match(/name="stamp" value="([^"]+)"/)[1];
    const post = (body) => fetch(S.base + "/join/developer", { method: "POST", redirect: "manual", headers: { ...NAV, "content-type": "application/x-www-form-urlencoded", origin: "http://hub.test" }, body: new URLSearchParams(body) });
    const r = await post({ name: "Someone", email: "someone@gmail.com", gh: "Octo", stamp }); assert.equal(r.status, 200);
    assert.equal(S.sent.length, 1);
    const t = S.sent[0].text.match(/t=([A-Za-z0-9_-]+)/)[1];
    const c = await fetch(S.base + "/start/confirm", { method: "POST", redirect: "manual", headers: { ...NAV, "content-type": "application/x-www-form-urlencoded", origin: "http://hub.test" }, body: new URLSearchParams({ t }) });
    assert.equal(c.status, 302); assert.match(c.headers.get("location"), /city\.html/, "goes straight to the city");
    const h = c.headers.get("location").match(/@([a-z0-9-]+)\//)[1];
    const page = await (await fetch(S.base + `/@${h}/city.html`, { headers: NAV })).text();
    assert.match(page, /Unverified city/); assert.match(page, /public GitHub URL for @Octo/); assert.match(page, /agentkit/i, "the real public repos");
    const man = JSON.parse(fs.readFileSync(path.join(S.d, "profiles", h, "caldera.json"), "utf8"));
    assert.doesNotMatch(JSON.stringify(man.body?.links ?? man.links ?? []), /github\.com\/Octo/i, "no claim on the account");
    assert.match(await (await fetch(S.base + "/gh/Octo", { headers: NAV })).text(), /Claim it with GitHub/, "/gh/Octo stays neutral: the real owner can still claim it");
    assert.equal(S.hub.db.prepare("SELECT detail FROM funnel_events WHERE step='email-created'").get().detail, "gh");
    assert.equal(S.hub.db.prepare("SELECT COUNT(*) n FROM gh_links").get().n, 0);
  } finally { delete process.env.TYPED_MIN_MS; S.hub.server.close(); }
});

