import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHub } from "../dist/server.js";

test("privacy: profile-view and sign-up-step visitor ids older than 14 days are re-keyed (counts kept, not traceable)", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-rekey-"));
  let h = createHub({ dataDir: d }); await h.listen(0); h.server.close();
  const db = new DatabaseSync(path.join(d, "hub.sqlite")), day = n => new Date(Date.now() - n * 86400000).toISOString();
  // an old day: one visitor seen twice, another once; a recent day keeps its ids
  for (const [ts, v] of [[day(20), "aaaaaaaaaaaaaaaa"], [day(20), "aaaaaaaaaaaaaaaa"], [day(20), "bbbbbbbbbbbbbbbb"], [day(2), "cccccccccccccccc"]])
    db.prepare("INSERT INTO page_views VALUES ('ana', 'index.html', ?, ?)").run(ts, v);
  const fday = n => new Date(Date.now() - n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  for (const [dd, v, st] of [[fday(30), "1111111111111111", "view"], [fday(30), "1111111111111111", "click"], [fday(30), "2222222222222222", "view"], [fday(1), "3333333333333333", "view"]])
    db.prepare("INSERT INTO funnel_events VALUES (?, ?, ?, '', ?)").run(dd, v, st, new Date().toISOString());
  db.close();
  h = createHub({ dataDir: d }); await h.listen(0);
  const db2 = new DatabaseSync(path.join(d, "hub.sqlite"));
  const pv = db2.prepare("SELECT ts, visitor FROM page_views ORDER BY ts").all();
  const old = pv.filter(r => r.ts < day(14)), recent = pv.filter(r => r.ts >= day(14));
  assert.ok(old.every(r => /^r[0-9a-f]{15}$/.test(r.visitor)), "old ids re-keyed");
  assert.equal(new Set(old.map(r => r.visitor)).size, 2, "the same visitor that day is still one visitor (counts unchanged)");
  assert.ok(!old.some(r => ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"].includes(r.visitor)));
  assert.deepEqual(recent.map(r => r.visitor), ["cccccccccccccccc"], "the last 14 days keep their ids (helicopters, 14-day stats)");
  assert.equal(db2.prepare("SELECT COUNT(DISTINCT visitor || substr(ts,1,10)) n FROM page_views").get().n, 3, "all-time unique visitor-days unchanged");
  const fe = db2.prepare("SELECT day, vid, step FROM funnel_events ORDER BY day, step").all();
  const fold = fe.filter(r => r.day === fday(30));
  assert.ok(fold.every(r => r.vid.startsWith("r")) && new Set(fold.map(r => r.vid)).size === 2, "funnel: re-keyed, per-day distinct visitors unchanged");
  assert.equal(fold.find(r => r.step === "view" && r.vid === fold.find(x => x.step === "click").vid)?.step, "view", "a visitor's steps that day still join up");
  assert.equal(fe.find(r => r.day === fday(1)).vid, "3333333333333333");
  db2.close(); h.server.close(); fs.rmSync(d, { recursive: true, force: true });
});
