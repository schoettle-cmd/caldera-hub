import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHub } from "../dist/server.js";

test("live traffic: per-visitor rows are deleted after 14 days (privacy policies promise nothing kept past 14 days)", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-ret-"));
  let h = createHub({ dataDir: d }); await h.listen(0); h.server.close();
  const db = new DatabaseSync(path.join(d, "hub.sqlite")), iso = days => new Date(Date.now() - days * 86400000).toISOString();
  for (const [ts, v] of [[iso(20), "old"], [iso(15), "old2"], [iso(13), "keep"], [iso(0), "now"]]) db.prepare("INSERT INTO traffic (key, ts, kind, visitor, host) VALUES ('k', ?, 'view', ?, 'x.com')").run(ts, v);
  db.close();
  h = createHub({ dataDir: d }); await h.listen(0);
  const db2 = new DatabaseSync(path.join(d, "hub.sqlite"));
  assert.deepEqual(db2.prepare("SELECT visitor FROM traffic ORDER BY ts").all().map(r => r.visitor), ["keep", "now"]);
  db2.close(); h.server.close(); fs.rmSync(d, { recursive: true, force: true });
});
