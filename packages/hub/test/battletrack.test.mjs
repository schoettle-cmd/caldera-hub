// The battle mail's measurement (battletrack.ts): a row per sent mail, the open pixel, the click redirect (no open redirect),
// the unsubscribe mark and the per-night report.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

const load = async f => { const out = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64")); };
const T = await load("../src/battletrack.ts"), B = await load("../src/battle.ts");
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const DAY = 86_400_000;
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function rig() {
  const db = new DatabaseSync(":memory:"), q = s => db.prepare(s); let clock = Date.UTC(2026, 10, 25, 4, 10);
  return { q, BT: T.battleTrack({ q, hub: "https://hub.test", now: () => clock }), set: t => { clock = t; }, now: () => clock };
}
const res = () => { const r = { status: 0, headers: {}, body: null, writeHead(s, h) { r.status = s; r.headers = h || {}; }, end(b) { r.body = b; } }; return r; };
const get = (BT, p) => { const u = new URL("https://hub.test" + p), r = res(); const hit = BT.route({ method: "GET" }, r, u.pathname, u); return { hit, ...r }; };
const HTML = `<html><body><a href="https://hub.test/world?view=battle&amp;replay=1">Watch</a> <a href="https://hub.test/p/7?pl=mail">Promo</a> <a href="https://hub.test/u/battle?t=UN">Unsubscribe</a></body></html>`;

test("wrap: every link but the unsubscribe goes through the redirect; the pixel sits in the HTML", () => {
  const { BT } = rig(), w = BT.wrap(HTML, ["https://hub.test/u/battle?t=UN"]);
  assert.deepEqual(w.links, ["https://hub.test/world?view=battle&replay=1", "https://hub.test/p/7?pl=mail"]);
  assert.ok(w.html.includes(`href="https://hub.test/email/bgo?t=${w.token}&amp;u=${encodeURIComponent("https://hub.test/world?view=battle&replay=1")}"`));
  assert.ok(w.html.includes('href="https://hub.test/u/battle?t=UN"'), "unsubscribe stays direct");
  assert.ok(w.html.includes(`<img src="https://hub.test/email/bo.gif?t=${w.token}" width="1" height="1"`) && /bo\.gif[^<]*><\/body>/.test(w.html));
  assert.ok(w.html.includes(">Watch</a>") && w.html.includes(">Promo</a>"), "the words do not change");
});

test("record, pixel, click, refusal, unsubscribe and the report", () => {
  const { q, BT, set, now } = rig();
  const a = BT.wrap(HTML, ["https://hub.test/u/battle?t=UN"]), b = BT.wrap(HTML), c2 = BT.wrap(HTML);
  // a click before a row exists (the send failed): nothing recorded, safe landing
  let r = get(BT, `/email/bgo?t=${a.token}&u=${encodeURIComponent("https://evil.test/x")}`);
  assert.equal(r.status, 302); assert.equal(r.headers.location, "https://hub.test/world?view=battle");
  BT.record({ token: a.token, night: "2026-11-24", profile: "p1", freq: "daily", links: a.links });
  BT.record({ token: b.token, night: "2026-11-24", profile: "p2", freq: "weekly", links: b.links });
  BT.record({ token: c2.token, night: "2026-11-24", profile: "p3", freq: "daily", links: c2.links });
  assert.equal(q("SELECT COUNT(*) n FROM battle_mail").get().n, 3);
  // pixel
  r = get(BT, `/email/bo.gif?t=${a.token}`); assert.equal(r.status, 200); assert.equal(r.headers["content-type"], "image/gif");
  get(BT, `/email/bo.gif?t=${a.token}`); get(BT, `/email/bo.gif?t=nope-nope-nope`);
  let row = q("SELECT * FROM battle_mail WHERE token=?").get(a.token); assert.equal(row.opens, 2); assert.ok(row.opened);
  // click: the stored original, a 302 to it (the promo's own /p/ counting runs on arrival)
  r = get(BT, `/email/bgo?t=${a.token}&u=${encodeURIComponent("https://hub.test/p/7?pl=mail")}`);
  assert.equal(r.status, 302); assert.equal(r.headers.location, "https://hub.test/p/7?pl=mail");
  get(BT, `/email/bgo?t=${a.token}&u=${encodeURIComponent("https://hub.test/world?view=battle&replay=1")}`);
  row = q("SELECT * FROM battle_mail WHERE token=?").get(a.token); assert.equal(row.clicks, 2); assert.ok(row.clicked);
  // a foreign URL is refused: no redirect there, no click counted
  r = get(BT, `/email/bgo?t=${b.token}&u=${encodeURIComponent("https://evil.test/phish")}`);
  assert.equal(r.headers.location, "https://hub.test/world?view=battle");
  r = get(BT, `/email/bgo?t=${b.token}&u=${encodeURIComponent("//evil.test/x")}`); assert.equal(r.headers.location, "https://hub.test/world?view=battle");
  r = get(BT, `/email/bgo?t=${b.token}&u=${encodeURIComponent("javascript:alert(1)")}`); assert.equal(r.headers.location, "https://hub.test/world?view=battle");
  assert.equal(q("SELECT clicks FROM battle_mail WHERE token=?").get(b.token).clicks, 0);
  // a hub URL that was not in the mail is allowed (own origin)
  r = get(BT, `/email/bgo?t=${b.token}&u=${encodeURIComponent("https://hub.test/leaderboard")}`); assert.equal(r.headers.location, "https://hub.test/leaderboard");
  // unsubscribe marks the newest row within 7 days; older rows do not count
  BT.unsub("p2"); assert.ok(q("SELECT unsub FROM battle_mail WHERE token=?").get(b.token).unsub);
  set(now() + 8 * DAY); BT.unsub("p3"); assert.equal(q("SELECT unsub FROM battle_mail WHERE token=?").get(c2.token).unsub, null, "older than 7 days");
  set(now() - 8 * DAY);
  assert.deepEqual(BT.report(14), [{ night: "2026-11-24", sent: 3, opened: 2, openPct: 66.7, clicked: 2, clickPct: 66.7, unsub: 1, unsubPct: 33.3, opens: 2, clicks: 3, weekly: 1 }]);
});

// ---------------------------------------------------------------- the live hub: sendReports writes the row, /u/battle marks unsub
test("live: a sent battle mail has a row, a pixel and wrapped links; unsubscribe marks it", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-btrack-")); dirs.push(d);
  const sent = [];
  const h = createHub({ dataDir: d, publicUrl: "https://hub.test", githubFetch: async () => new Response("[]", { status: 200 }), growthPoll: false, email: { send: async m => { sent.push(m); } } });
  const base = "http://127.0.0.1:" + await h.listen(0), ids = {};
  try {
    for (const handle of ["ana", "bo"]) {
      const rr = (name, commits) => ({ name, project: "Work", public: true, language: "TypeScript", commits, weeks: [1, 2, 3], week: 3, today: 0, pushed: new Date().toISOString(), url: `https://github.com/${handle}/${name}` });
      const full = cityData([rr("app", 300)], () => ({ n: 0, paths: [] }), new Date().toISOString());
      const files = { "index.html": Buffer.from(`<html><body>${handle}</body></html>`).toString("base64"), "city.html": Buffer.from(renderCity({ name: handle, handle }, publicCity(full, ["Work"], "show"))).toString("base64") };
      const id = C.newIdentity(); ids[handle] = id;
      const r = await fetch(`${base}/v1/profiles/${id.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(id, "profile.manifest", { name: handle, handle, boxKey: id.boxPublic }), files }) });
      assert.equal(r.status, 200);
    }
    const today = Math.floor(Date.now() / DAY), ins = h.db.prepare("INSERT OR IGNORE INTO growth_events VALUES (?,?,?,?,?,?,?,?,?)");
    for (const [handle, id] of Object.entries(ids)) for (let dd = today - 40; dd <= today; dd++) for (let k = 0; k < 20; k++) { const t = dd * DAY + 3600_000 + k * 60_000; ins.run(`c:${handle}${dd}x${k}`, id.id, "commit", `${handle}/app`, t, t, 1, "", null); }
    h.admin.growth.recompute();
    const B2 = h.admin.battle, n = B.lastNight(Date.now()), day = new Date(n * DAY).toISOString().slice(0, 10);
    for (const w of ["ana", "bo"]) B2.optIn(ids[w].id, { since: 0, waive: true });
    B2.resolve(n);
    h.db.prepare("INSERT OR REPLACE INTO email_subs (owner, email, hash, confirmed, token, created) VALUES (?,?,?,?,?,?)").run(ids.ana.id, h.admin.seal("ana@x.io"), "h1", 1, "t1", new Date().toISOString());
    // the switch off: composed only, no row
    delete process.env.CALDERA_BATTLE_EMAIL; await B2.sendReports({ force: true });
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM battle_mail").get().n, 0, "no send, no row");
    process.env.CALDERA_BATTLE_EMAIL = "1";
    await B2.sendReports({ force: true });
    const m = sent.filter(x => x.src === "battle-report"); assert.equal(m.length, 1);
    const row = h.db.prepare("SELECT * FROM battle_mail").get();
    assert.equal(row.night, day); assert.equal(row.profile, ids.ana.id); assert.equal(row.freq, "daily"); assert.ok(row.sent); assert.equal(row.opens, 0);
    assert.ok(m[0].html.includes(`/email/bo.gif?t=${row.token}`), "the pixel is in the HTML");
    assert.ok(!m[0].text.includes("bo.gif") && !m[0].text.includes("/email/bgo"), "the text part is unchanged");
    const hrefs = [...m[0].html.matchAll(/href="([^"]+)"/g)].map(x => x[1].replace(/&amp;/g, "&"));
    const unsub = hrefs.filter(u => u.includes("/u/battle?t="));
    assert.equal(unsub.length, 1, "the unsubscribe link stays direct");
    assert.ok(hrefs.filter(u => !u.includes("/u/battle?t=")).every(u => u.startsWith(`https://hub.test/email/bgo?t=${row.token}&u=`)), "every other link is wrapped");
    assert.ok(hrefs.some(u => decodeURIComponent(u).includes("/world?view=battle&replay=1")), "the replay link");
    assert.ok(m[0].headers["List-Unsubscribe"].includes("/u/battle?t="), "the header is not wrapped");
    // over HTTP: pixel, click 302 to the original, foreign refused
    assert.equal((await fetch(`${base}/email/bo.gif?t=${row.token}`)).status, 200);
    const orig = JSON.parse(row.links)[0];
    let r = await fetch(`${base}/email/bgo?t=${row.token}&u=${encodeURIComponent(orig)}`, { redirect: "manual" });
    assert.equal(r.status, 302); assert.equal(r.headers.get("location"), orig);
    r = await fetch(`${base}/email/bgo?t=${row.token}&u=${encodeURIComponent("https://evil.test/")}`, { redirect: "manual" });
    assert.equal(r.headers.get("location"), "https://hub.test/world?view=battle");
    let row2 = h.db.prepare("SELECT * FROM battle_mail").get(); assert.equal(row2.opens, 1); assert.equal(row2.clicks, 1); assert.ok(row2.clicked);
    // the gift mail's routes still answer
    assert.equal((await fetch(`${base}/email/o.gif?t=x`)).status, 200);
    // one-click unsubscribe (RFC 8058 POST) marks the row
    r = await fetch(base + new URL(unsub[0]).pathname + new URL(unsub[0]).search, { method: "POST" }); assert.equal(r.status, 200);
    row2 = h.db.prepare("SELECT * FROM battle_mail").get(); assert.ok(row2.unsub);
    assert.equal(B2.store.opt(ids.ana.id).report, "off");
    const rep = B2.track.report(7); assert.equal(rep.length, 1); assert.equal(rep[0].sent, 1); assert.equal(rep[0].unsubPct, 100); assert.equal(rep[0].openPct, 100);
    assert.ok(!JSON.stringify(rep).includes("ana"), "counts only");
  } finally { delete process.env.CALDERA_BATTLE_EMAIL; h.server?.close?.(); }
});
