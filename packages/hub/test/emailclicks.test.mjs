// Email click-through per member: a signed-in member arriving with ?src=email-<kind> is recorded once per day per kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "@caldera/core";
import crypto from "node:crypto";
import { createHub } from "../dist/server.js";

test("email_clicks: a signed-in member's click from an email is recorded once per day; anonymous clicks are not", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-ec-"));
  const hub = createHub({ dataDir: d, publicUrl: "http://hub.test", limits: { newProfilesPerDay: 100 } });
  try {
    const base = "http://127.0.0.1:" + await hub.listen(0);
    const id = C.newIdentity();
    const post = (p, body, token) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }).then(r => r.json());
    const m = C.sign(id, "profile.manifest", { name: "Ann", handle: "ann", boxKey: id.boxPublic });
    await post(`/v1/profiles/${id.id}/bundle`, { manifest: m, files: { "index.html": Buffer.from("<html><body>hi</body></html>").toString("base64") } });
    const tok = "t-" + Math.random().toString(36).slice(2);
    hub.db.prepare("INSERT INTO owner_sessions (token_hash, owner, created, expires) VALUES (?,?,?,?)").run(crypto.createHash("sha256").update(tok).digest("hex"), id.id, new Date().toISOString(), Date.now() + 3600e3);
    const UA = { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" };
    await fetch(base + "/feed?src=email-digest", { headers: UA });   // anonymous
    assert.equal(hub.db.prepare("SELECT COUNT(*) n FROM email_clicks").get().n, 0);
    const SIGNED = { ...UA, cookie: "cal_own=" + tok };
    await fetch(base + "/feed?src=email-digest", { headers: SIGNED });
    await fetch(base + "/people?src=email-digest", { headers: SIGNED });   // same day, same kind: one row
    await fetch(base + "/feed?src=email-weekly", { headers: SIGNED });
    await fetch(base + "/feed?src=homescreen", { headers: SIGNED });       // not an email
    assert.deepEqual(hub.db.prepare("SELECT owner, src FROM email_clicks ORDER BY src").all().map(r => [r.owner, r.src]), [[id.id, "email-digest"], [id.id, "email-weekly"]]);
  } finally { hub.server.close(); fs.rmSync(d, { recursive: true, force: true }); }
});
