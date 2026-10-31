// One way in (2026-10-30): /join (the profile-type selector), the sign-up touchpoints for signed-out visitors (profile
// blur, people blur, nudge bars), per-touchpoint counts, and the Designer and Business email sign-ups.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";

let hub, base, dir; const mails = [], events = [];
const ORIGIN = "http://hub.test";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const get = (p, h = {}) => fetch(base + p, { redirect: "manual", headers: { "user-agent": CHROME, ...h } });
const form = (p, body, h = {}) => fetch(base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "user-agent": CHROME, ...h }, body: new URLSearchParams(body).toString() });
const cookieOf = r => (r.headers.getSetCookie?.() || [r.headers.get("set-cookie")]).filter(Boolean).map(x => x.split(";")[0]).join("; ");
const rows = (tp, ev) => hub.db.prepare("SELECT COUNT(*) n FROM gate_events WHERE tp=? AND ev=?").get(tp, ev).n;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-join-"));
  hub = createHub({ dataDir: dir, publicUrl: ORIGIN, limits: { newProfilesPerDay: 100 }, email: { send: async m => { mails.push(m); } }, onEvent: e => events.push(e) });
  base = "http://127.0.0.1:" + await hub.listen(0);
});
after(() => { hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/** sign up through a typed form and confirm; returns the owner cookie and where the confirm sent them */
async function signUp(kind, body, h = {}) {
  mails.length = 0;
  const r = await form(`/join/${kind}`, body, h);
  assert.match(await r.text(), /Check your email/);
  const link = mails[0].text.match(/https?:\/\/\S+start\/confirm\?t=\S+/)[0].replace(ORIGIN, base);
  const c = await form("/start/confirm", { t: new URL(link).searchParams.get("t") }, h);
  assert.equal(c.status, 302);
  return { cookie: cookieOf(c), to: c.headers.get("location") };
}

test("/join: three doors, each through /join/go", async () => {
  const html = await (await get("/join?tp=follow&from=nobody")).text();
  assert.match(html, /What do you make\?/);
  for (const d of ["code", "obsidian", "designer", "business"]) assert.match(html, new RegExp(`/join/go\\?door=${d}`));
  const go = async d => (await get(`/join/go?door=${d}&tp=follow`)).headers.get("location");
  assert.equal(await go("code"), "/auth/github"); assert.equal(await go("designer"), "/join/designer"); assert.equal(await go("business"), "/join/business");
  assert.match(await go("obsidian"), /#obsidian$/);
  assert.equal(await go("nope"), "/join");
  assert.equal(rows("follow", "click"), 1); assert.equal(rows("follow", "door"), 1, "one door per visitor per touchpoint per day");
});

test("touchpoint events: shown from pages (any origin), bots never counted, unknown touchpoints ignored", async () => {
  const ev = (body, ua = CHROME) => fetch(base + "/v1/gate/ev", { method: "POST", headers: { "content-type": "text/plain", "user-agent": ua }, body });
  const r = await ev("bar-feed:shown"); assert.equal(r.status, 204); assert.equal(r.headers.get("access-control-allow-origin"), "*");
  await ev("bar-feed:shown", BOT); await ev("made-up:shown"); await ev("bar-feed:signup");
  assert.equal(rows("bar-feed", "shown"), 1); assert.equal(rows("made-up", "shown"), 0); assert.equal(rows("bar-feed", "signup"), 0, "pages can only report shown");
});

test("Designer: sign up by email, credited to its touchpoint; themed page with the work; editor, images and limits", async () => {
  const j = await get("/join?tp=profile-blur&from=someone"), tpCookie = cookieOf(j);
  assert.match(tpCookie, /cal_tp=profile-blur/);
  const f = await (await get("/join/designer")).text(); assert.match(f, /Make your portfolio page/); assert.match(f, /#FF7A8A/);
  assert.match(await (await form("/join/designer", { name: "", email: "x@example.com" })).text(), /Add your name/);
  const { cookie, to } = await signUp("designer", { name: "Noor Test", headline: "Brand designer", a: "Brand identity, Motion", email: "test-designer@example.com" }, { cookie: tpCookie });
  assert.equal(to, "/settings?new=1#work");
  assert.equal(rows("profile-blur", "signup"), 1, "the signup is credited to the touchpoint that brought them");
  assert.equal(events.at(-1).type, "signup"); assert.equal(events.at(-1).kind, "designer", "the signup alert names the type");
  const own = cookie.split("; ").find(x => !x.startsWith("cal_tp")) || cookie;
  const set = await (await get("/settings?new=1", { cookie: own })).text();
  assert.match(set, /Your designer profile/); assert.match(set, /Portfolio \(0 of 24\)/); assert.match(set, /Add your work below/);
  const sv = await form("/settings/typed", { do: "fields", name: "Noor Test", headline: "Brand designer", disciplines: "Brand identity, Product UI", tools: "Figma", availability: "Two projects from Nov 15", clients: "Acme", open: "1" }, { cookie: own });
  assert.equal(sv.status, 303, "saved: redirect, so a reload never posts twice"); assert.match(sv.headers.get("location"), /^\/settings\?saved=1#typed$/);
  assert.match(await (await get("/settings?saved=1", { cookie: own })).text(), /Saved and republished/);
  for (const t of ["Northwind identity", "Pace app", "Harbor type", "Field notes"]) await form("/settings/typed", { do: "add-work", title: t, about: "A project" }, { cookie: own });
  const acct = hub.db.prepare("SELECT * FROM email_accounts WHERE handle='noor-test'").get(), pr = JSON.parse(acct.content);
  assert.equal(pr.kind, "designer"); assert.equal(pr.work.length, 4);
  // an image: JPEG with an EXIF block, which is stripped before it's stored
  const exif = Buffer.from("Exif\0\0GPS-SECRET-LOCATION"), app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, exif.length + 2]), exif]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);
  const up = b => fetch(base + "/settings/typed/img", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: own, "user-agent": CHROME }, body: JSON.stringify(b) });
  assert.equal((await up({ work: pr.work[0].id, data: jpg.toString("base64") })).status, 200);
  assert.equal((await up({ work: pr.work[0].id, data: Buffer.from("not an image").toString("base64") })).status, 400);
  assert.equal((await up({ work: "missing", data: jpg.toString("base64") })).status, 404);
  assert.equal((await up({ work: pr.work[0].id, data: Buffer.alloc(11 * 1024 * 1024, 1).toString("base64") })).status, 413, "over 10 MB");
  const imgName = JSON.parse(hub.db.prepare("SELECT content FROM email_accounts WHERE handle='noor-test'").get().content).work[0].images[0];
  const stored = fs.readFileSync(path.join(dir, "profiles", "noor-test", "img", "work", imgName));
  assert.ok(!stored.includes("GPS-SECRET"), "EXIF stripped");
  // the public page: their colors, badge, first row of work visible, the rest marked for the signed-out blur
  const page = await (await get("/@noor-test/")).text();
  assert.match(page, /--accent:#FF7A8A/); assert.match(page, /ct-badge">Designer/); assert.match(page, /Open for work/); assert.match(page, /Northwind identity/);
  assert.match(page, /img\/work\/[a-z0-9]+\.jpg/); assert.match(page, /class="ct cal-typed-more"/); assert.match(page, /Two projects from Nov 15/, "the text stays in the HTML");
  const city = await (await get("/@noor-test/city.html")).text(); assert.match(city, /Northwind identity/, "each project is a building");
  // limits: 24 projects, 12 images
  const full = { ...pr, work: Array.from({ length: 24 }, (_, i) => ({ id: "w" + i, title: "P" + i, images: [] })) };
  hub.db.prepare("UPDATE email_accounts SET content=? WHERE handle='noor-test'").run(JSON.stringify(full));
  assert.match(await (await form("/settings/typed", { do: "add-work", title: "One more" }, { cookie: own })).text(), /limit of 24 projects/);
  full.work[0].images = Array.from({ length: 12 }, (_, i) => `x${i}.jpg`);
  hub.db.prepare("UPDATE email_accounts SET content=? WHERE handle='noor-test'").run(JSON.stringify(full));
  assert.match(await (await up({ work: "w0", data: jpg.toString("base64") })).text(), /limit of 12 images/);
});

test("Business: companies, looking for, gold theme; 5 new message requests a day", async () => {
  const { cookie, to } = await signUp("business", { name: "Leo Test", headline: "Founder", a: "Routeline", b: "Founder and CEO", email: "test-business@example.com" });
  assert.equal(to, "/settings?new=1#companies"); assert.equal(events.at(-1).kind, "business");
  await form("/settings/typed", { do: "fields", name: "Leo Test", hiring: "Head of sales", raising: "Series A", sectors: "Logistics, B2B SaaS" }, { cookie });
  await form("/settings/typed", { do: "add-co", name: "Palletbase", role: "Co-founder", years: "2015 to 2019", exited: "1" }, { cookie });
  const page = await (await get("/@leo-test/")).text();
  assert.match(page, /--accent:#E8B44A/); assert.match(page, /ct-badge">Business/); assert.match(page, /Head of sales/); assert.match(page, /Routeline/); assert.match(page, /Palletbase/); assert.match(page, /Exited/);
  // cold messages: business accounts get 5 new requests a day (developers and designers 10)
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  for (let i = 0; i < 6; i++) { const id = C.newIdentity(), h = "cold-" + i;
    await post(`/v1/profiles/${id.id}/bundle`, { manifest: C.sign(id, "profile.manifest", { name: "Cold " + i, handle: h, boxKey: id.boxPublic }), files: { "index.html": Buffer.from("<html><body><h1>hi</h1></body></html>").toString("base64") } }); }
  hub.db.prepare("UPDATE profiles SET created='2020-01-01T00:00:00.000Z' WHERE handle='leo-test'").run();   // past the new-account wait
  const send = h => fetch(base + "/v1/messages/send", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie, "user-agent": CHROME }, body: JSON.stringify({ to: h, text: "Hello there" }) });
  const st = []; for (let i = 0; i < 6; i++) st.push((await send("cold-" + i)).status);
  assert.deepEqual(st.slice(0, 5).every(x => x === 200), true, "first five go: " + st); assert.equal(st[5], 429, "the sixth is refused");
});

test("signed-out visitors get the profile blur; members, owners and crawlers don't", async () => {
  const anon = await (await get("/@noor-test/")).text();
  assert.match(anon, /__calGate2/); assert.match(anon, /"kind":"profile"/); assert.match(anon, /"h":"noor-test"/);
  const bot = await (await get("/@noor-test/", { "user-agent": BOT })).text();
  assert.doesNotMatch(bot, /__calGate2/, "crawlers see the whole page, no gate");
  assert.match(bot, /Northwind identity/);
  const { cookie } = await signUp("designer", { name: "Viewer Test", email: "test-viewer@example.com" });
  const member = await (await get("/@noor-test/", { cookie })).text();
  assert.doesNotMatch(member, /__calGate2/, "members see everything");
  const city = await (await get("/@noor-test/city.html")).text(); assert.match(city, /"kind":"city"/);
  assert.equal((await get("/me/city", { cookie })).headers.get("location"), "/@viewer-test/city.html", "/me/city: your own city");
  assert.equal((await get("/me/city")).headers.get("location"), "/signin");
});

test("hub pages: people, feed and world carry a touchpoint for signed-out people only; home, join, legal and guide never", async () => {
  for (const [p, k] of [["/feed", "feed"], ["/world", "world"]]) {
    const r = await get(p); if (r.status !== 200) continue;
    assert.match(await r.text(), new RegExp(`"kind":"${k}"`), p);
    assert.doesNotMatch(await (await get(p, { "user-agent": BOT })).text(), /__calGate2/, p + " (crawler)");
  }
  for (const p of ["/join", "/privacy", "/terms", "/guide", "/signin"]) { const t = await (await get(p)).text(); assert.doesNotMatch(t, /__calGate2/, p); }
});

test("the header's Get started goes to /join; the report counts by touchpoint", async () => {
  const j = await (await get("/join/designer")).text();
  assert.match(j, /href="[^"]*\/join\?tp=header"/);
  const rep = hub.admin["gates-report"](7), row = tp => rep.touchpoints.find(x => x.tp === tp);
  assert.equal(rep.days, 7);
  assert.equal(row("profile-blur").signup, 1); assert.equal(row("follow").click, 1); assert.equal(row("bar-feed").shown, 1);
});

test("the gate script and the sign-up panel parse as JavaScript, for every kind", async () => {
  const { gateScript } = await import("../dist/server.js").then(m => m).catch(() => ({}));
  const pages = [await (await get("/@noor-test/")).text(), await (await get("/@noor-test/city.html")).text(), await (await get("/world")).text(), await (await get("/feed")).text()];
  let n = 0;
  for (const html of pages) for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) { if (!/__calGate2|calGate/.test(m[1])) continue; new Function(m[1]); n++; }
  assert.ok(n >= 3, "checked " + n + " scripts");
  void gateScript;
});
