// Shared mail guard (Growth Engine 2026-11-04): every Caldera email is checked first. Blocked = not sent; no answer within
// 2 s = sign-in mail and the daily summary still go, the rest is held.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHub } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });   // temp hubs are removed after the file's tests, even when one fails

test("the guard decides: blocked mail is not sent; on no answer only auth and daily go", async () => {
  let mode = "ok"; const checks = [];
  const g = http.createServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { checks.push(JSON.parse(b)); if (mode === "slow") return setTimeout(() => res.end("{}"), 3000);
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(mode === "block" ? { ok: false, reasons: ["repeat"] } : { ok: true })); }); });
  await new Promise(r => g.listen(0, "127.0.0.1", r)); process.env.MAILGUARD_URL = `http://127.0.0.1:${g.address().port}/mailguard/check`; delete process.env.MAILGUARD;
  const sent = [], real = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).includes("resend")) { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: "x" }), text: async () => "" }; } return real(u, o); };
  const dir = __mkdtemp(path.join(os.tmpdir(), "cal-mg-"));
  const hub = createHub({ dataDir: dir, publicUrl: "https://hub.test", email: { resendKey: "re_test" } });
  try {
    const mail = hub.mail || hub.email;
    assert.ok(mail && mail.note, "hub exposes the mailer");
    await mail.note({ to: "a@x.test", subject: "Hi", title: "Hi", html: "<p>Hello</p>", text: "Hello", src: "email-invite" });
    assert.equal(sent.length, 1); assert.equal(checks[0].product, "caldera"); assert.equal(checks[0].kind, "transactional");
    mode = "block"; await mail.note({ to: "a@x.test", subject: "Hi", title: "Hi", html: "<p>Hello</p>", text: "Hello", src: "email-invite" }); assert.equal(sent.length, 1);
    mode = "slow"; await mail.note({ to: "a@x.test", subject: "Hi", title: "Hi", html: "<p>Hello</p>", text: "Hello", src: "email-reconnect" }); assert.equal(sent.length, 1, "marketing held");
    await mail.note({ to: "a@x.test", subject: "Code", title: "Code", html: "<p>123</p>", text: "123", src: "signin-code" }); assert.equal(sent.length, 2, "sign-in still goes");
  } finally { globalThis.fetch = real; g.closeAllConnections?.(); g.close(); hub.server?.close?.(); fs.rmSync(dir, { recursive: true, force: true }); }
});
