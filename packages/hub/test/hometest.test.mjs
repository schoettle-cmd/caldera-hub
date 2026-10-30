// Homepage message test (home2, 10 arms): every arm serves, swaps only the hero copy, each view is recorded per arm,
// crawlers get control and are not counted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHub } from "../dist/server.js";
const HEADS = { a: "The social network for GitHub and Obsidian.", b: "Show your work as a living city.", c: "Your GitHub, as a city.", d: "A portfolio that builds itself from your GitHub.", e: "Watch your AI agents build, live.", f: "Meet developers by what they actually build.", g: "Your contribution graph, but 3D and alive.", h: "What does your code look like as a city?", i: "Build in public without writing a single post.", j: "Your code and your notes, one living profile." };

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

test("home2: all ten arms serve, only the copy differs, views recorded per arm", async () => {
  const seen = {};
  for (let i = 0; i < 160; i++) {
    const r = await fetch(base + "/", { headers: { ...NAV, "user-agent": CHROME + " v" + i } });
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "private, max-age=0");
    const h = await r.text();
    assert.match(h, /<title>Caldera - the social network for GitHub and Obsidian<\/title>/);   // SEO unchanged
    assert.match(h, /href="\/auth\/github"/); assert.match(h, /action="\/gh"/);                 // same sign-up paths
    const arm = Object.keys(HEADS).filter(k => h.includes("<h1>" + HEADS[k] + "</h1>"));
    assert.equal(arm.length, 1, "exactly one headline"); seen[arm[0]] = (seen[arm[0]] || 0) + 1;
    if (arm[0] === "b") assert.match(h, /Build your city, two ways\./); else assert.match(h, /Two doors, one network\./);
  }
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(HEADS), JSON.stringify(seen));
  const rows = Object.fromEntries(hub.db.prepare("SELECT step, COUNT(*) n FROM funnel_events WHERE step LIKE 'h2-%' OR step='view' GROUP BY step").all().map(r => [r.step, r.n]));
  for (const k of Object.keys(HEADS)) assert.equal(rows["h2-" + k], seen[k], k);
  assert.equal(rows.view, 160);
});

test("home2: crawlers always get control and are not counted", async () => {
  const before = hub.db.prepare("SELECT COUNT(*) n FROM funnel_events").get().n;
  for (let i = 0; i < 6; i++) {
    const h = await (await fetch(base + "/", { headers: { "user-agent": "Googlebot/2.1 x" + i } })).text();
    assert.match(h, /<h1>The social network for GitHub and Obsidian\.<\/h1>/);
  }
  assert.equal(hub.db.prepare("SELECT COUNT(*) n FROM funnel_events").get().n, before);
});
