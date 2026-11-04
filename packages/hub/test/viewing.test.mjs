import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";

test("viewing: current viewers of a profile (helicopters) - page views and heartbeats count, the caller and bots don't, ids are opaque", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-view-"));
  const h = createHub({ dataDir: d });
  const base = "http://127.0.0.1:" + await h.listen(0);
  const post = (p, b) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }));
  const ana = C.newIdentity(), html = Buffer.from("<html><body>c</body></html>").toString("base64");
  await post(`/v1/profiles/${ana.id}/bundle`, { manifest: C.sign(ana, "profile.manifest", { name: "ana", handle: "ana", boxKey: ana.boxPublic }), files: { "index.html": html, "city.html": html } });
  const UA1 = "Mozilla/5.0 (Macintosh) Safari/605 viewer-one", UA2 = "Mozilla/5.0 (iPhone) Safari/605 viewer-two";
  const beat = ua => fetch(base + "/v1/viewing/ana", { method: "POST", headers: { "user-agent": ua } }).then(r => r.json());
  assert.deepEqual(await beat(UA1), { n: 0, ids: [] }, "alone: nobody else, no helicopters");
  // someone else opens the profile page (a page view)
  await fetch(base + "/@ana/", { headers: { "user-agent": UA2 } });
  const one = await beat(UA1);
  assert.equal(one.n, 1); assert.match(one.ids[0], /^[a-f0-9]{10}$/);
  const two = await beat(UA2);
  assert.equal(two.n, 1, "the other viewer sees viewer one, not themselves");
  assert.notEqual(two.ids[0], one.ids[0]);
  assert.equal((await beat(UA1)).ids[0], one.ids[0], "stable id while they stay");
  await fetch(base + "/v1/viewing/ana", { method: "POST", headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
  assert.equal((await beat(UA1)).n, 1, "bots are never viewers");
  const w = await (await fetch(base + "/v1/viewing")).json();
  assert.deepEqual(w.m, { "@ana": 2 });
  assert.equal((await fetch(base + "/v1/viewing/nobody", { method: "POST" })).status, 404);
  const g = await (await fetch(base + "/v1/viewing/ana", { headers: { "user-agent": "Mozilla/5.0 x-three" } })).json();
  assert.equal(g.n, 2, "a GET only reads");
  h.server.close(); fs.rmSync(d, { recursive: true, force: true });
});
