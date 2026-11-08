// Email link tags (Mike 11-08): the mailer sends the html the shared mail guard tagged (es_* + utm on caldera.social links,
// href only); the text part stays as written.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHub } from "../dist/server.js";

test("the guard's tagged html is what goes to Resend; the text part is unchanged", async () => {
  const tagged = '<a href="https://caldera.social/?src=email-invite&es_src=email&es_p=caldera_member_invite&es_s=email-invite">Open</a>';
  const g = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, id: 7, html: tagged })); }); });
  await new Promise(r => g.listen(0, "127.0.0.1", r)); process.env.MAILGUARD_URL = `http://127.0.0.1:${g.address().port}/mailguard/check`; delete process.env.MAILGUARD;
  const sent = [], real = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).includes("resend")) { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ id: "x" }), text: async () => "" }; } return real(u, o); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cal-et-"));
  const hub = createHub({ dataDir: dir, publicUrl: "https://hub.test", email: { resendKey: "re_test" } });
  try {
    const mail = hub.mail || hub.email;
    await mail.note({ to: "a@x.test", subject: "Hi", title: "Hi", html: '<p>Hello</p>', text: "Hello", src: "email-invite" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].html, tagged);
    assert.equal(sent[0].text.includes("es_src"), false, "the visible text never carries the tags");
  } finally { globalThis.fetch = real; g.closeAllConnections?.(); g.close(); hub.server?.close?.(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.MAILGUARD_URL; }
});
