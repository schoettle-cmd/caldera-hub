// Growth Engine's shared learning loop (Mike 11-06: "We need all these self-learning"). Before a digest goes out the hub asks
// 127.0.0.1:4835/learn/arm for an arm: no answer = our own mail, holdout = no mail, an arm = its subject plus utm_campaign,
// utm_content and an opaque lt token on every link back to us, and "learn" in the mail guard's body (the guard counts the send).
// Clicks and goals come back as fire-and-forget events with the member's address, looked up from the token, never from the URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";

const listen = (srv) => new Promise(r => srv.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${srv.address().port}`)));
const until = async (fn, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };

// a fake Growth Engine: /learn/* and /mailguard/* on one port, every body recorded
function engine() {
  const calls = []; let mode = "arm";
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => {
    const body = b ? JSON.parse(b) : {}; calls.push({ path: req.url, body }); res.setHeader("content-type", "application/json");
    if (req.url === "/mailguard/check") return res.end(JSON.stringify({ ok: true, reasons: [], id: calls.length }));
    if (req.url === "/learn/arm") {
      if (mode === "holdout") return res.end(JSON.stringify({ ok: true, arm: "holdout", holdout: true, subject: null, cta: null, preheader: null }));
      if (mode === "unknown") return res.end(JSON.stringify({ ok: false, reason: "unknown_program" }));
      return res.end(JSON.stringify({ ok: true, program: body.program, arm: "b", holdout: false, subject: "See what's new on your Caldera page", cta: null, preheader: null,
        learn: { program: body.program, arm: "b" }, utm: { utm_campaign: body.program, utm_content: "b" } }));
    }
    res.end(JSON.stringify({ ok: true }));
  }); });
  return { srv, calls, set: m => { mode = m; } };
}

async function setup(learnUrl) {
  const E = engine(), eurl = await listen(E.srv);
  process.env.MAILGUARD_URL = `${eurl}/mailguard/check`; delete process.env.MAILGUARD; delete process.env.LEARN;
  const sent = [], real = globalThis.fetch; let resendFails = false;
  globalThis.fetch = async (u, o) => { if (String(u).startsWith("https://api.resend.com/")) { if (resendFails) return new Response('{"message":"invalid"}', { status: 422 }); sent.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); } return real(u, o); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cal-learn-"));
  const hub = createHub({ dataDir: dir, publicUrl: "http://hub.test", limits: { newProfilesPerDay: 100, writesPerMinute: 1000, perMinute: 5000 },
    email: { resendKey: "re_test", learnUrl: learnUrl === undefined ? eurl : learnUrl } });
  const base = "http://127.0.0.1:" + await hub.listen(0);
  const post = (p, body, h = {}) => real(base + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
  const ann = C.newIdentity(), bo = C.newIdentity();
  for (const [id, name, handle] of [[ann, "Ann Lee", "ann"], [bo, "Bo", "bo"]]) {
    const m = C.sign(id, "profile.manifest", { name, handle, boxKey: id.boxPublic });
    await post(`/v1/profiles/${id.id}/bundle`, { manifest: m, files: { "index.html": Buffer.from("<html><body>hi</body></html>").toString("base64") } });
  }
  hub.db.prepare("INSERT INTO email_suggest VALUES (?,?,?,?,?,?)").run(ann.id, "x", hub.mail.hashOf("ann@realmail.org"), 1, "test", new Date().toISOString());
  await hub.mail.subscribe(ann.id, "ann@realmail.org");   // GitHub-verified address: confirmed at once, no mail
  assert.equal(hub.mail.status(ann.id).confirmed, true);
  await post("/v1/envelopes", C.sign(bo, "friend.request", { to: ann.id, note: "hello" }));   // something happened: Ann has a new follower
  const tok = "t-" + crypto.randomBytes(8).toString("hex");
  hub.db.prepare("INSERT INTO owner_sessions (token_hash, owner, created, expires) VALUES (?,?,?,?)").run(crypto.createHash("sha256").update(tok).digest("hex"), ann.id, new Date().toISOString(), Date.now() + 3600e3);
  const done = () => { globalThis.fetch = real; E.srv.closeAllConnections?.(); E.srv.close(); hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { E, sent, hub, base, real, ann, bo, ownCookie: "cal_own=" + tok, done, failResend: v => { resendFails = v; } };
}
const UA = { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" };

test("learning API down: the digest still goes out with our own subject and no utm", async () => {
  const S = await setup("http://127.0.0.1:9");   // nothing listens there
  try {
    const r = await S.hub.mail.runDigest(true);
    assert.equal(r.sent, 1); assert.equal(S.sent.length, 1);
    assert.match(S.sent[0].subject, /^Caldera: /);
    assert.ok(!/utm_campaign|[?&]lt=/.test(S.sent[0].html + S.sent[0].text), "no learning params");
    const g = S.E.calls.filter(c => c.path === "/mailguard/check").at(-1).body; assert.equal(g.learn, undefined, "no learn object without an arm");
    assert.equal(S.hub.db.prepare("SELECT COUNT(*) n FROM learn_sends").get().n, 0);
  } finally { S.done(); }
});

test("unknown program (ok:false): our normal mail", async () => {
  const S = await setup(); S.E.set("unknown");
  try {
    assert.equal((await S.hub.mail.runDigest(true)).sent, 1);
    assert.match(S.sent[0].subject, /^Caldera: /); assert.ok(!/utm_campaign/.test(S.sent[0].html));
  } finally { S.done(); }
});

test("holdout: no mail, last_sent untouched", async () => {
  const S = await setup(); S.E.set("holdout");
  try {
    const r = await S.hub.mail.runDigest(true);
    assert.equal(r.sent, 0); assert.equal(S.sent.length, 0);
    assert.equal(S.hub.db.prepare("SELECT last_sent FROM email_subs WHERE owner=?").get(S.ann.id).last_sent, null);
    assert.equal(S.E.calls.filter(c => c.path === "/mailguard/check").length, 0, "never reaches the guard");
  } finally { S.done(); }
});

test("an arm: its subject, the utm pair and an opaque token on every own link, learn in the guard body; click and goal come back", async () => {
  const S = await setup();
  try {
    assert.equal((await S.hub.mail.runDigest(true)).sent, 1);
    const m = S.sent[0];
    const armCall = S.E.calls.find(c => c.path === "/learn/arm").body;
    assert.deepEqual(armCall, { program: "caldera_daily", to: "ann@realmail.org", vars: { first_name: "Ann" } });
    assert.equal(m.subject, "See what's new on your Caldera page");
    const g = S.E.calls.filter(c => c.path === "/mailguard/check").at(-1).body;
    assert.deepEqual(g.learn, { program: "caldera_daily", arm: "b" }, "learn object in the guard body");
    assert.equal(g.subject, m.subject);
    // every link back to the hub that carries src= also carries the utm pair and the token; one-time and legal links are untouched
    const own = [...m.html.matchAll(/href="(http:\/\/hub\.test[^"]*)"/g)].map(x => x[1].replace(/&amp;/g, "&"));
    const tagged = own.filter(u => /[?&]src=/.test(u));
    assert.ok(tagged.length >= 2, "own links are tagged");
    for (const u of tagged) { const q = new URL(u).searchParams; assert.equal(q.get("utm_campaign"), "caldera_daily", u); assert.equal(q.get("utm_content"), "b", u); assert.match(q.get("lt"), /^[\w-]{16}$/); }
    assert.ok(own.filter(u => /\/v1\/email\/unsub|\/privacy|\/terms/.test(u)).every(u => !/utm_/.test(u)), "unsubscribe and legal links untouched");
    assert.ok(/utm_campaign=caldera_daily&utm_content=b&lt=/.test(m.text), "plain-text links too");
    assert.ok(!/ann(%40|@)realmail/.test(own.join(" ")), "no address in any URL");
    const lt = new URL(tagged[0]).searchParams.get("lt");
    assert.equal(S.hub.db.prepare("SELECT program, arm, owner FROM learn_sends WHERE token=?").get(lt).owner, S.ann.id);
    // a signed-out click: the token ties it to Ann's address
    const before = S.E.calls.length;
    const r = await S.real(`${S.base}/feed?src=email-digest&utm_campaign=caldera_daily&utm_content=b&lt=${lt}`, { headers: UA });
    assert.equal(r.status, 200);
    assert.ok(await until(() => S.E.calls.slice(before).some(c => c.path === "/learn/event")));
    const ev = S.E.calls.slice(before).find(c => c.path === "/learn/event").body;
    assert.equal(ev.program, "caldera_daily"); assert.equal(ev.type, "click"); assert.equal(ev.to, "ann@realmail.org"); assert.ok(ev.ip); assert.match(ev.ua, /Safari/);
    // the goal: a signed-in return visit, once
    const b2 = S.E.calls.length;
    await S.real(`${S.base}/feed`, { headers: { ...UA, cookie: S.ownCookie } });
    await S.real(`${S.base}/feed`, { headers: { ...UA, cookie: S.ownCookie } });
    assert.ok(await until(() => S.E.calls.slice(b2).some(c => c.path === "/learn/event")));
    await new Promise(r => setTimeout(r, 150));
    const goals = S.E.calls.slice(b2).filter(c => c.path === "/learn/event").map(c => c.body);
    assert.deepEqual(goals, [{ program: "caldera_daily", to: "ann@realmail.org", type: "goal", name: "return_visit" }], "one goal per send");
    // a forged or unknown token with no sign-in: nothing is sent
    const b3 = S.E.calls.length;
    await S.real(`${S.base}/feed?utm_campaign=caldera_daily&utm_content=b&lt=nottherealtoken`, { headers: UA });
    await new Promise(r => setTimeout(r, 150));
    assert.equal(S.E.calls.slice(b3).filter(c => c.path === "/learn/event").length, 0);
  } finally { S.done(); }
});

test("a learning API that never answers: the digest goes after the 2 s timeout, and pages never wait on events", async () => {
  const hang = http.createServer(() => { /* never answers */ }); const hurl = await listen(hang);
  const S = await setup(hurl);
  try {
    const t0 = Date.now(); assert.equal((await S.hub.mail.runDigest(true)).sent, 1); const took = Date.now() - t0;
    assert.ok(took >= 1900 && took < 6000, `waited for the arm about 2 s (${took} ms)`);
    assert.match(S.sent[0].subject, /^Caldera: /, "our own subject");
    // a signed-in click with a campaign: the event goes to the hanging API in the background; the page answers at once
    const t = Date.now(); const r = await S.real(`${S.base}/feed?utm_campaign=caldera_daily&utm_content=b`, { headers: { ...UA, cookie: S.ownCookie } });
    assert.equal(r.status, 200); assert.ok(Date.now() - t < 1500, "page not blocked");
  } finally { S.done(); hang.closeAllConnections?.(); hang.close(); }
});

test("new-member email: the goal is following the member it introduced", async () => {
  const S = await setup();
  try {
    S.hub.db.prepare("INSERT INTO learn_sends VALUES (?,?,?,?,?,?,NULL)").run("tok-newmember-1", "caldera_new_member", "b", S.ann.id, "bo", new Date().toISOString());
    const before = S.E.calls.length;
    const r = await S.real(`${S.base}/v1/friend/bo`, { method: "POST", headers: { ...UA, cookie: S.ownCookie, origin: "http://hub.test", "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200, await r.text());
    assert.ok(await until(() => S.E.calls.slice(before).some(c => c.path === "/learn/event")));
    assert.deepEqual(S.E.calls.slice(before).find(c => c.path === "/learn/event").body, { program: "caldera_new_member", to: "ann@realmail.org", type: "goal", name: "follow" });
  } finally { S.done(); }
});

test("provider refuses the send: the guard check is released, so it doesn't count", async () => {
  const S = await setup(); S.failResend(true);
  try {
    const r = await S.hub.mail.runDigest(true); assert.equal(r.sent, 0); assert.equal(r.errors, 1);
    assert.ok(await until(() => S.E.calls.some(c => c.path === "/mailguard/release")));
    const chk = S.E.calls.filter(c => c.path === "/mailguard/check").length;
    assert.equal(S.E.calls.find(c => c.path === "/mailguard/release").body.id, S.E.calls.findLastIndex(c => c.path === "/mailguard/check") + 1);
    assert.ok(chk >= 1);
    assert.equal(S.hub.db.prepare("SELECT COUNT(*) n FROM learn_sends").get().n, 0, "no token stored for a mail that never went");
  } finally { S.done(); }
});
