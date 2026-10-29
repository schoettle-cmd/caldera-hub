import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cleanImage, sniff } from "../dist/images.js";

let hub, base, dir; const sent = [];
const UA = { "user-agent": "Mozilla/5.0" };
const ids = { mike: C.newIdentity(), ana: C.newIdentity(), cy: C.newIdentity() };
const post = (p, body, token) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const form = (p, data) => fetch(base + p, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() });
async function login(id) {
  const { body } = await post("/v1/auth/challenge", { id: id.id });
  return (await post("/v1/auth/verify", C.sign(id, "message", { nonce: body.nonce }))).body.token;
}
const ownerPage = async cookie => (await fetch(`${base}/@mike/`, { headers: { ...UA, cookie } })).text();

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-signincode-"));
  hub = createHub({ dataDir: dir, publicUrl: "https://hub.test", limits: { newProfilesPerDay: 100 }, email: { send: async m => { sent.push(m); } } });
  base = "http://127.0.0.1:" + await hub.listen(0);
  for (const who of ["mike", "ana", "cy"]) {
    const m = C.sign(ids[who], "profile.manifest", { name: who, handle: who, boxKey: ids[who].boxPublic });
    await post(`/v1/profiles/${ids[who].id}/bundle`, { manifest: m, files: { "index.html": Buffer.from("<html><head></head><body><p>hi</p></body></html>").toString("base64") } });
  }
  // mike has a confirmed summary address; cy has none
  await post(`/v1/owner/${ids.mike.id}/email`, { email: "mike@realmail.org" }, await login(ids.mike));
  const link = sent[0].text.match(/https:\/\/hub\.test(\/v1\/email\/confirm\?t=[\w-]+)/)[1];
  await fetch(base + link, { method: "POST" }); sent.length = 0;
});
after(() => { hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });


const codeOf = m => m.subject.match(/(\d{6})$/)[1];
test("email me a code: the code signs in on this device, once; the link then dies too", async () => {
  sent.length = 0;
  const page = await (await form("/signin/email", { email: "mike@realmail.org" })).text();   // general /signin, no ?h=
  assert.match(page, /autocomplete="one-time-code"/); assert.match(page, /inputmode="numeric"/);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sent.length, 1); const code = codeOf(sent[0]), c = new URL(sent[0].text.match(/(https:\/\/hub\.test\/signin\/link\?c=[\w-]+)/)[1]).searchParams.get("c");
  const ok = await form("/signin/code", { email: "Mike@RealMail.org", code: code.slice(0, 3) + " " + code.slice(3) });
  assert.equal(ok.status, 303); assert.equal(ok.headers.get("location"), "/@mike/");
  assert.match(await ownerPage((ok.headers.get("set-cookie") || "").split(";")[0]), /data-state="own"/);
  assert.equal((await form("/signin/code", { email: "mike@realmail.org", code })).status, 200, "single use: back to the code page");
  assert.equal((await form("/signin/link", { c })).status, 400, "using the code killed the link");
});

test("email me a code: using the link kills the code; unknown addresses get the same page and no mail", async () => {
  sent.length = 0;
  const a = await (await form("/signin/email", { email: "nobody@realmail.org" })).text();
  await form("/signin/email", { email: "mike@realmail.org" }); await new Promise(r => setTimeout(r, 50));
  assert.match(a, /Check your email/); assert.equal(sent.length, 1, "only the member's address gets mail");
  const code = codeOf(sent[0]), c = new URL(sent[0].text.match(/(https:\/\/hub\.test\/signin\/link\?c=[\w-]+)/)[1]).searchParams.get("c");
  assert.equal((await form("/signin/link", { c })).status, 303);
  const r = await form("/signin/code", { email: "mike@realmail.org", code });
  assert.equal(r.status, 200); assert.equal(r.headers.get("set-cookie"), null);
});

test("email me a code: five wrong codes kill the code", async () => {
  sent.length = 0;
  hub.db.prepare("DELETE FROM signin_codes").run();
  await form("/signin/email", { email: "mike@realmail.org" }); await new Promise(r => setTimeout(r, 50));
  const code = codeOf(sent[0]), wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
  for (let i = 0; i < 5; i++) assert.match(await (await form("/signin/code", { email: "mike@realmail.org", code: wrong })).text(), /didn&#39;t work|didn't work|expired/);
  const r = await form("/signin/code", { email: "mike@realmail.org", code });
  assert.equal(r.status, 200); assert.equal(r.headers.get("set-cookie"), null, "the right code is dead after 5 misses");
});
