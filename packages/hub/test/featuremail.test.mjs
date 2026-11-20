// The weekly "What's new" feature email (Growth Engine spec 2026-11-20): Growth Engine's edition is sent as written, with
// only %%UNSUB_URL%% and %%WHY_LINE%% filled, inside its window, once per address and edition, never to opted-out,
// suppressed, own or test addresses; the one-click "no product news" route works by POST.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createHub } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const HTML = `<!doctype html><html><body><p>New this week: <a href="https://caldera.social/world?utm_campaign=feature_weekly_caldera&utm_content=2026-11-23">the World</a></p><p>%%WHY_LINE%%</p><p><a href="%%UNSUB_URL%%">Unsubscribe</a> %%UNSUB_URL%%</p></body></html>`;
const TEXT = `New this week: the World https://caldera.social/world?utm_campaign=feature_weekly_caldera&utm_content=2026-11-23\n\n%%WHY_LINE%%\nUnsubscribe: %%UNSUB_URL%%\n`;
function edition(dir, o = {}) {
  const now = Date.now();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "caldera.json"), JSON.stringify({ edition: o.edition || "2026-11-23", send_from: new Date(o.from ?? now - 3600_000).toISOString(), expires: new Date(o.to ?? now + 3600_000).toISOString(), subject: "New on Caldera: the World", preheader: "x", features: [] }));
  fs.writeFileSync(path.join(dir, "caldera.html"), HTML);
  fs.writeFileSync(path.join(dir, "caldera.txt"), "Subject: New on Caldera: the World\n\n" + TEXT);
}
function setup(env = {}) {
  const d = __mkdtemp(path.join(os.tmpdir(), "cal-feat-")), ed = path.join(d, "feature_mail"), sent = [];
  process.env.CALDERA_FEATURE_MAIL_DIR = ed;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const hub = createHub({ dataDir: d, publicUrl: "https://hub.test", email: { send: async (m) => { sent.push(m); } } });
  // addresses are sealed with the hub's key, as the hub does (rows written directly, so test domains can be seeded too)
  const key = fs.readFileSync(path.join(d, "private.key"));
  const seal = (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv); const ct = Buffer.concat([c.update(s, "utf8"), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64"); };
  // a confirmed daily-summary subscriber
  const sub = async (owner, email) => { const e = email.toLowerCase();
    hub.db.prepare("INSERT INTO email_subs (owner, email, hash, confirmed, token, created) VALUES (?,?,?,?,?,?)").run(owner, seal(e), hub.mail.hashOf(e), 1, "tok-" + owner, new Date().toISOString()); };
  // an email-page account
  const page = (id, email, nudgeOff = 0) => {
    const sealed = seal(email.toLowerCase());
    hub.db.prepare("INSERT INTO email_accounts (profile_id, handle, email_hash, email_sealed, key_sealed, content, log, created, updated, nudge_off) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, id.replace(/\W/g, ""), "h-" + id, sealed, "", "{}", "[]", new Date().toISOString(), new Date().toISOString(), nudgeOff);
  };
  return { d, ed, hub, sent, sub, page, close: () => { hub.server.close(); for (const k of Object.keys(env)) delete process.env[k]; } };
}

test("feature mail: nothing outside the window, nothing without a valid edition", async () => {
  const t = setup();
  try {
    await t.sub("cal:a", "ann@realmail.org");
    let r = await t.hub.featureMail.run(); assert.equal(r.edition, null); assert.equal(t.sent.length, 0, "no edition files: nothing");
    edition(t.ed, { from: Date.now() + 3600_000, to: Date.now() + 7200_000 });
    r = await t.hub.featureMail.run(); assert.equal(r.inWindow, false); assert.equal(t.sent.length, 0, "before send_from");
    edition(t.ed, { from: Date.now() - 7200_000, to: Date.now() - 3600_000 });
    r = await t.hub.featureMail.run(); assert.equal(r.inWindow, false); assert.equal(t.sent.length, 0, "after expires");
    edition(t.ed); fs.writeFileSync(path.join(t.ed, "caldera.txt"), "no subject line\n\nbody");
    r = await t.hub.featureMail.run(); assert.equal(r.edition, null); assert.equal(t.sent.length, 0, "invalid txt: nothing");
    edition(t.ed);
    r = await t.hub.featureMail.run(); assert.equal(r.sent, 1); assert.equal(t.sent.length, 1, "inside the window it goes");
  } finally { t.close(); }
});

test("feature mail: one copy per address and edition, reruns never resend; a new edition goes again", async () => {
  const t = setup();
  try {
    edition(t.ed);
    await t.sub("cal:a", "ann@realmail.org"); t.page("cal:p1", "ANN@realmail.org"); t.page("cal:p2", "pat@realmail.org");
    let r = await t.hub.featureMail.run();
    assert.equal(r.sent, 2); assert.equal(r.skipped.duplicate, 1, "same address on a page account: one copy");
    assert.deepEqual(t.sent.map(m => m.to).sort(), ["ann@realmail.org", "pat@realmail.org"]);
    r = await t.hub.featureMail.run(); assert.equal(r.sent, 0); assert.equal(r.skipped.already_sent, 2); assert.equal(t.sent.length, 2, "rerun sends nothing");
    const [a, b] = await Promise.all([t.hub.featureMail.run(), t.hub.featureMail.run()]); assert.equal(a.sent + b.sent, 0);
    edition(t.ed, { edition: "2026-11-30" });
    r = await t.hub.featureMail.run(); assert.equal(r.sent, 2, "next week's edition goes out"); assert.equal(t.sent.length, 4);
    const m = t.sent[0];
    assert.equal(m.src, "feature_weekly"); assert.equal(m.kind, "marketing");
    assert.match(m.idempotencyKey, /^feature_weekly:2026-11-23:cal:/);
    assert.match(m.headers["List-Unsubscribe"], /^<https:\/\/hub\.test\/v1\/email\/news-off\?t=[\w-]+>$/);
    assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  } finally { t.close(); }
});

test("feature mail: only the two slots change; subject, copy, HTML and links are as written", async () => {
  const t = setup();
  try {
    edition(t.ed); await t.sub("cal:a", "ann@realmail.org");
    await t.hub.featureMail.run();
    const m = t.sent[0], un = /<(.*)>/.exec(m.headers["List-Unsubscribe"])[1];
    assert.ok(!un.includes("ann") && !un.includes("realmail"), "the link does not carry the address");
    const why = "You get this because you have a Caldera account. It comes once a week, only when something new shipped.";
    assert.equal(m.subject, "New on Caldera: the World");
    assert.equal(m.html, HTML.split("%%WHY_LINE%%").join(why).split("%%UNSUB_URL%%").join(un.replace(/&/g, "&amp;")));
    assert.equal(m.text, TEXT.split("%%WHY_LINE%%").join(why).split("%%UNSUB_URL%%").join(un));
    assert.ok(!/%%/.test(m.html + m.text), "no slot left");
    assert.ok(!/src=feature_weekly/.test(m.html), "links are not re-tagged");
  } finally { t.close(); }
});

test("feature mail: opted-out, suppressed, own and test addresses and nudge_off pages get nothing; dry run counts", async () => {
  const t = setup({ CALDERA_OWN_EMAILS: "mike@ownmail.org", CALDERA_TEST_DOMAINS: "robots.dev" });
  try {
    edition(t.ed);
    await t.sub("cal:ok", "ok@realmail.org");
    await t.sub("cal:own", "mike+x@ownmail.org");
    await t.sub("cal:ex", "who@example.com");
    await t.sub("cal:tst", "bot@robots.dev");
    await t.sub("cal:ct", "me+caldtest1@realmail.org");
    await t.sub("cal:sup", "bounced@realmail.org"); t.hub.db.prepare("INSERT INTO email_suppress VALUES (?,?,?)").run(t.hub.mail.hashOf("bounced@realmail.org"), "bounce", new Date().toISOString());
    t.page("cal:off", "nudgeoff@realmail.org", 1);
    t.page("cal:out", "out@realmail.org");
    // out@ opted out of product news earlier (one-click POST with its token)
    const url = t.hub.featureMail.unsubUrl(t.hub.mail.hashOf("out@realmail.org")), port = await t.hub.listen(0);
    const r0 = await fetch(`http://127.0.0.1:${port}${new URL(url).pathname}${new URL(url).search}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(r0.status, 200);
    const dry = await t.hub.featureMail.dryRun();
    assert.equal(dry.eligible, 1); assert.equal(t.sent.length, 0, "dry run sends nothing");
    assert.deepEqual(dry.skipped, { own: 2, test: 2, suppressed: 1, opted_out: 1 });
    const r = await t.hub.featureMail.run();
    assert.equal(r.sent, 1); assert.deepEqual(t.sent.map(m => m.to), ["ok@realmail.org"]);
  } finally { t.close(); }
});

test("feature mail: news-off GET only shows a button, POST opts out (idempotent), the next edition skips them", async () => {
  const t = setup();
  try {
    edition(t.ed); await t.sub("cal:a", "ann@realmail.org");
    await t.hub.featureMail.run(); assert.equal(t.sent.length, 1);
    const un = new URL(/<(.*)>/.exec(t.sent[0].headers["List-Unsubscribe"])[1]), port = await t.hub.listen(0), at = `http://127.0.0.1:${port}${un.pathname}${un.search}`;
    const g = await fetch(at); assert.equal(g.status, 200); assert.match(await g.text(), /method="post"/);
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) n FROM feature_people WHERE optout IS NOT NULL").get().n, 0, "GET changes nothing");
    for (let i = 0; i < 2; i++) { const p = await fetch(at, { method: "POST" }); assert.equal(p.status, 200); assert.match(await p.text(), /won't get/); }
    assert.equal(t.hub.db.prepare("SELECT COUNT(*) n FROM feature_people WHERE optout IS NOT NULL").get().n, 1);
    const bad = await fetch(`http://127.0.0.1:${port}/v1/email/news-off?t=nope`, { method: "POST" }); assert.equal(bad.status, 200);
    edition(t.ed, { edition: "2026-11-30" });
    const r = await t.hub.featureMail.run(); assert.equal(r.sent, 0); assert.equal(r.skipped.opted_out, 1); assert.equal(t.sent.length, 1);
    assert.equal(t.hub.mail.status("cal:a").confirmed, true, "the daily summary is not touched");
  } finally { t.close(); }
});

test("feature mail through Resend: guard kind marketing, Idempotency-Key sent; a guard 'no' or no answer skips and retries later", async () => {
  let mode = "ok"; const checks = [];
  const g = http.createServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { checks.push(JSON.parse(b));
    if (mode === "down") { res.destroy(); return; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(mode === "block" ? { ok: false, reasons: ["cap"] } : { ok: true })); }); });
  await new Promise(r => g.listen(0, "127.0.0.1", r));
  const prevGuard = process.env.MAILGUARD, prevUrl = process.env.MAILGUARD_URL;
  process.env.MAILGUARD_URL = `http://127.0.0.1:${g.address().port}/mailguard/check`; delete process.env.MAILGUARD;
  const d = __mkdtemp(path.join(os.tmpdir(), "cal-feat-r-")), ed = path.join(d, "feature_mail"); process.env.CALDERA_FEATURE_MAIL_DIR = ed;
  const real = globalThis.fetch, hits = [];
  globalThis.fetch = async (u, o) => { if (String(u).startsWith("https://api.resend.com/")) { hits.push(o); return new Response("{}", { status: 200 }); } return real(u, o); };
  const hub = createHub({ dataDir: d, publicUrl: "https://hub.test", email: { resendKey: "re_test" } });
  try {
    const key = fs.readFileSync(path.join(d, "private.key")), iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv), ct = Buffer.concat([c.update("ann@realmail.org", "utf8"), c.final()]);
    hub.db.prepare("INSERT INTO email_subs (owner, email, hash, confirmed, token, created) VALUES (?,?,?,?,?,?)").run("cal:a", Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64"), hub.mail.hashOf("ann@realmail.org"), 1, "tok", new Date().toISOString());
    edition(ed);
    mode = "block"; let r = await hub.featureMail.run(); assert.equal(r.sent, 0); assert.equal(r.skipped.guard, 1); assert.equal(hits.length, 0);
    mode = "down"; r = await hub.featureMail.run(); assert.equal(r.sent, 0); assert.equal(hits.length, 0, "no answer: held");
    mode = "ok"; r = await hub.featureMail.run(); assert.equal(r.sent, 1); assert.equal(hits.length, 1, "sent once the guard says yes");
    const last = checks[checks.length - 1]; assert.equal(last.kind, "marketing"); assert.equal(last.template, "feature_weekly"); assert.equal(last.has_list_unsubscribe, true);
    assert.equal(hits[0].headers["idempotency-key"], "feature_weekly:2026-11-23:cal:a");
    const body = JSON.parse(hits[0].body); assert.equal(body.from, "Caldera <hello@caldera.social>"); assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  } finally {
    globalThis.fetch = real; g.closeAllConnections?.(); g.close(); hub.server.close();
    if (prevGuard === undefined) delete process.env.MAILGUARD; else process.env.MAILGUARD = prevGuard;
    if (prevUrl === undefined) delete process.env.MAILGUARD_URL; else process.env.MAILGUARD_URL = prevUrl;
  }
});
