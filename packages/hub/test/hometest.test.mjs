// Homepage message A/B (home1): both arms serve, the showcase arm swaps only the copy, each view is recorded per arm,
// crawlers get control and are not counted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHub } from "../dist/server.js";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../site");
let hub, base, dir;
const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-site": "none", accept: "text/html" };
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-home-"));
  hub = createHub({ dataDir: dir, siteDir: site, publicUrl: "http://hub.test", limits: { newProfilesPerDay: 100 } });
  base = "http://127.0.0.1:" + await hub.listen(0);
});
after(() => { hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("home1: both arms serve, only the copy differs, views recorded per arm", async () => {
  const seen = { a: 0, b: 0 };
  for (let i = 0; i < 24; i++) {
    const r = await fetch(base + "/", { headers: { ...NAV, "user-agent": CHROME + " v" + i } });
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "private, max-age=0");
    const h = await r.text();
    assert.match(h, /<title>Caldera - the social network for GitHub and Obsidian<\/title>/);   // SEO unchanged
    assert.match(h, /href="\/auth\/github"/); assert.match(h, /action="\/gh"/);                 // same sign-up paths
    if (h.includes("<h1>Show your work as a living city.</h1>")) { seen.b++; assert.doesNotMatch(h, /<h1>The social network/); assert.match(h, /Build your city, two ways\./); }
    else { seen.a++; assert.match(h, /<h1>The social network for GitHub and Obsidian\.<\/h1>/); }
  }
  assert.ok(seen.a > 0 && seen.b > 0, JSON.stringify(seen));
  const rows = Object.fromEntries(hub.db.prepare("SELECT step, COUNT(*) n FROM funnel_events WHERE step IN ('home-a','home-b','view') GROUP BY step").all().map(r => [r.step, r.n]));
  assert.equal(rows["home-a"], seen.a); assert.equal(rows["home-b"], seen.b); assert.equal(rows.view, 24);
});

test("home1: crawlers always get control and are not counted", async () => {
  const before = hub.db.prepare("SELECT COUNT(*) n FROM funnel_events").get().n;
  for (let i = 0; i < 6; i++) {
    const h = await (await fetch(base + "/", { headers: { "user-agent": "Googlebot/2.1 x" + i } })).text();
    assert.match(h, /<h1>The social network for GitHub and Obsidian\.<\/h1>/);
  }
  assert.equal(hub.db.prepare("SELECT COUNT(*) n FROM funnel_events").get().n, before);
});
