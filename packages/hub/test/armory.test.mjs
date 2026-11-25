import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

// The Armory (Mike 11-17/11-18): custom bombs with a word, bought with help credits; one "Armory open" alert a day at 6 PM in
// each player's own time zone, a reminder before lock, and a daily battle reward for every city that fires.
const out = await build({ entryPoints: [new URL("../src/armory.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const A = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const bout = await build({ entryPoints: [new URL("../src/battle.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const B = await import("data:text/javascript;base64," + Buffer.from(bout.outputFiles[0].text).toString("base64"));
const DAY = 86_400_000, H = 3600_000;
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const lh = (t, tz) => A.localHour(t, tz);

test("armory: the window runs from the last battle to the next, so it is open at 6 PM everywhere", () => {
  const n = B.lastNight(Date.parse("2026-11-18T12:00:00Z")) + 1, w = A.armoryWindow(n);
  assert.equal(w.open, B.battleAt(n - 1)); assert.equal(w.lock, B.battleAt(n)); assert.equal(w.lock - w.open, DAY);
  assert.equal(new Date(w.lock).toISOString().slice(11, 16), "10:00", "locks at 10:00 UTC (2:00 AM Pacific)");
  const now = Date.parse("2026-11-18T03:00:00Z"), cur = A.armoryNow(now);
  assert.ok(now >= cur.open && now < cur.lock && cur.state === "open");
  assert.deepEqual(A.ARMORY.types.map(t => t.k), ["sparkler", "thunderbolt", "inferno", "nova"]);
});

test("armory: the open alert is 6 PM local; 8 AM where 6 PM is under 4 hours before lock; the reminder never during the night", () => {
  const n = B.lastNight(Date.parse("2026-11-18T12:00:00Z")) + 1, lock = B.battleAt(n);
  const cases = { "America/Los_Angeles": [18, 21.5], "America/New_York": [18, 21.5], "Europe/London": [18, 9], "Asia/Tokyo": [8, 18], "Australia/Sydney": [8, 20] };
  for (const [tz, [o, r]] of Object.entries(cases)) {
    const at = A.openAlertAt(n, tz), rm = A.remindAt(n, tz);
    assert.ok(at < lock && at >= lock - DAY, tz + " open alert inside the window");
    assert.equal(lh(at, tz), o, `${tz} open alert at ${o}:00 local`);
    if (r === null) assert.equal(rm, null); else { assert.ok(rm && rm < lock && rm > at, tz + " reminder after the open alert, before lock"); assert.equal(lh(rm, tz), r, `${tz} reminder at ${r} local`); }
    if (rm) assert.ok(lh(rm, tz) >= 8 && lh(rm, tz) < 22, tz + ": never between 10 PM and 8 AM");
  }
  assert.equal(A.cleanTz("Europe/London"), "Europe/London"); assert.equal(A.cleanTz("Not/AZone"), null); assert.equal(A.cleanTz("<script>"), null);
  assert.match(A.clockIn(lock, "America/New_York"), /^5:00\sAM$/);
});

test("armory: alertDue sends one open alert, then one reminder, only to players who can and did not buy", () => {
  const n = B.lastNight(Date.parse("2026-11-18T12:00:00Z")) + 1, tz = "America/New_York";
  const base = { tz, open: true, remind: true, sentOpen: 0, sentRemind: 0, balance: 50, bought: 0, war: true };
  const oa = A.openAlertAt(n, tz), ra = A.remindAt(n, tz);
  assert.equal(A.alertDue({ ...base, now: oa - 60_000 }), null, "not before 6 PM");
  assert.deepEqual(A.alertDue({ ...base, now: oa + 60_000 }), { kind: "open", night: n });
  assert.equal(A.alertDue({ ...base, now: oa + 60_000, sentOpen: n }), null, "once per night");
  assert.deepEqual(A.alertDue({ ...base, now: ra + 60_000, sentOpen: n }), { kind: "remind", night: n });
  assert.equal(A.alertDue({ ...base, now: ra + 60_000, sentOpen: n, sentRemind: n }), null);
  assert.equal(A.alertDue({ ...base, now: oa + 60_000, bought: 2 }), null, "already bought");
  assert.equal(A.alertDue({ ...base, now: oa + 60_000, balance: 4 }), null, "nothing to buy");
  assert.equal(A.alertDue({ ...base, now: oa + 60_000, open: false }), null, "switch off");
  assert.equal(A.alertDue({ ...base, now: oa + 60_000, war: false }), null, "left the battles");
  assert.deepEqual(A.alertDue({ ...base, now: ra + 60_000, open: false }), { kind: "remind", night: n }, "the switches are independent");
});

test("armory: alert and email copy (ASCII email, local lock time plus Pacific once, reward line only when paid)", () => {
  const n = B.lastNight(Date.parse("2026-11-18T12:00:00Z")) + 1, lock = B.battleAt(n);
  const t = A.alertText("open", { lock, tz: "America/New_York", balance: 120, reward: 10 });
  assert.equal(t.title, "Your Armory is open"); assert.ok(t.title.length <= 40 && t.push.length <= 110, t.push);
  assert.ok(t.body.includes("**5:00 AM**") && t.body.includes("+10 from the last battle") && t.ctaUrl === "/world#armory");
  const e = A.armoryEmail({ name: "Ana Lopez", lock, tz: "America/New_York", balance: 120, reward: 10, hub: "https://caldera.social", unsubArmory: "https://caldera.social/u/armory?t=x", unsubAll: "https://caldera.social/v1/email/unsub?t=y", postal: "1 Main St" });
  assert.equal(e.subject, "Your Armory is open until 5:00 AM");
  for (const s of [e.subject, e.text, e.html]) assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(s), "ASCII only");
  assert.ok(e.text.startsWith("Hey Ana,") && e.text.includes("Locks: 5:00 AM your time (2:00 AM Pacific)") && e.text.includes("Last battle: +10 credits"));
  assert.ok(e.html.includes('href="https://caldera.social/world#armory"') && e.html.includes("u/armory?t=x") && e.html.includes("v1/email/unsub?t=y"));
  for (const nm of ["", "  ", "李雷", "🚀", "@"]) {   // no usable name: no greeting line (Growth Engine 11-25)
    const x = A.armoryEmail({ name: nm, lock, tz: "Europe/London", balance: 5, reward: 0, hub: "https://h", unsubArmory: "u", unsubAll: "v", postal: "p" });
    assert.ok(x.text.startsWith("Your Armory is open"), JSON.stringify(nm) + ": " + x.text.slice(0, 20)); assert.ok(!/Hey|Hi\b/.test(x.html), nm);
  }
  assert.ok(A.armoryEmail({ name: "@ana_dev", lock, tz: "Europe/London", balance: 5, reward: 0, hub: "https://h", unsubArmory: "u", unsubAll: "v", postal: "p" }).text.startsWith("Hey ana_dev,\n"));
  assert.ok(!A.armoryEmail({ name: "Ana", lock, tz: "Europe/London", balance: 5, reward: 0, hub: "https://h", unsubArmory: "u", unsubAll: "v", postal: "p" }).text.includes("Last battle"));
});

test("armory: the battle report email names custom bombs (ASCII), and the subject leads with them", () => {
  const r = { h: "@rae", peace: false, raids: [{ from: "@ana", t: 0 }], taken: 1, takenUsd: 1e6, heldUsd: 0, tiers: 1, fires: 0, fired: 4, landed: 3, on: ["@bo"], dealt: 1, dealtUsd: 2e6, shield: .2, streak: 3, built: 2, ammo: 10, usd: 5e5, mvp: null,
    bombs: [{ k: "inferno", word: "SHIPIT", from: "@ana", hit: 1 }], mine: { n: 4, hit: 3, top: { k: "nova", word: "LGTM", on: "@bo" } } };
  const w = { built: [], hit: [], attackers: [], rebuilds: [], rivalry: null, season: { n: 1, week: 1 } };
  assert.equal(B.battleSubject(r), '@ana hit you with an Inferno ("SHIPIT")');
  assert.equal(B.battleSubject({ ...r, bombs: [...r.bombs, { k: "nova", word: "GG", from: "@bo", hit: 1 }] }), "2 custom bombs hit your city last night");
  const e = B.battleEmail(r, w, { name: "Rae", hub: "https://caldera.social", unsub: "u", postal: "p" });
  assert.ok(e.text.includes('Custom bombs on you: 1. Inferno "SHIPIT" from @ana.') && e.text.includes('Your bombs: 4 flew, 3 hit. Nova "LGTM" hit @bo.') && e.text.includes("#armory"), e.text);
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(e.text));
  const plain = B.battleEmail({ ...r, bombs: [], mine: null }, w, { name: "Rae", hub: "https://h", unsub: "u", postal: "p" });
  assert.ok(!plain.text.includes("Custom bombs") && !plain.text.includes("#armory"), "no Armory lines without bombs");
});

// ---------------------------------------------------------------- the live hub
async function hubWith(handles) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-armory-")); dirs.push(d);
  const sent = [];
  const h = createHub({ dataDir: d, publicUrl: "https://hub.test", githubFetch: async () => new Response("[]", { status: 200 }), growthPoll: false, email: { send: async m => { sent.push(m); } } });
  const base = "http://127.0.0.1:" + await h.listen(0), ids = {};
  for (const handle of handles) {
    const rr = (name, commits) => ({ name, project: "Work", public: true, language: "TypeScript", commits, weeks: [1, 2, 3], week: 3, today: 0, pushed: new Date().toISOString(), url: `https://github.com/${handle}/${name}` });
    const full = cityData([rr("app", 300)], () => ({ n: 0, paths: [] }), new Date().toISOString());
    const files = { "index.html": Buffer.from(`<html><body>${handle}</body></html>`).toString("base64"), "city.html": Buffer.from(renderCity({ name: handle, handle }, publicCity(full, ["Work"], "show"))).toString("base64") };
    const id = C.newIdentity(); ids[handle] = id;
    const r = await fetch(`${base}/v1/profiles/${id.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(id, "profile.manifest", { name: handle, handle, boxKey: id.boxPublic }), files }) });
    assert.equal(r.status, 200);
  }
  const post = (p, body, hd = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...hd }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const cookies = {};
  const cookie = async w => {
    if (cookies[w]) return cookies[w];
    const ch = (await post("/v1/auth/challenge", { id: ids[w].id })).body, tok = (await post("/v1/auth/verify", C.sign(ids[w], "message", { nonce: ch.nonce }))).body.token;
    const { body } = await post(`/v1/owner/${ids[w].id}/link`, {}, { authorization: "Bearer " + tok });
    const r = await fetch(body.url.replace("https://hub.test", base), { redirect: "manual" });
    return (cookies[w] = (r.headers.get("set-cookie") || "").split(";")[0]);
  };
  const as = async (w, p, body) => post(p, body, { cookie: await cookie(w), origin: "https://hub.test" });
  const get = async (w, p) => (await fetch(base + p, { headers: { cookie: await cookie(w) } })).json();
  return { h, base, ids, as, get, cookie, sent };
}
function work(h, ids) {
  const today = Math.floor(Date.now() / DAY), ins = h.db.prepare("INSERT OR IGNORE INTO growth_events VALUES (?,?,?,?,?,?,?,?,?)");
  for (const [handle, id] of Object.entries(ids)) for (let d = today - 40; d <= today; d++) for (let k = 0; k < 20; k++) { const t = d * DAY + H + k * 60_000; ins.run(`c:${handle}${d}x${k}`, id.id, "commit", `${handle}/app`, t, t, 1, "", null); }
  // and work in the open window of the next night (since the 20:00 PT move its work day starts at 03:45 UTC, after the hour above)
  for (const [handle, id] of Object.entries(ids)) for (let k = 0; k < 20; k++) { const t = Date.now() - (k + 1) * 60_000; ins.run(`c:${handle}now${k}`, id.id, "commit", `${handle}/app`, t, t, 1, "", null); }
  h.admin.growth.recompute();
}

test("live armory: buy all-or-nothing, the bombs fly with their words, refunds, the daily reward, hidden words, alerts once, settings", async () => {
  delete process.env.CALDERA_ARMORY_EMAIL;
  const { h, base, ids, as, get, sent } = await hubWith(["rae", "sam"]);
  try {
    work(h, ids);
    const BT = h.admin.battle; for (const w of ["rae", "sam"]) BT.optIn(ids[w].id, { since: 0 });
    let me = await get("rae", "/v1/world/battle/me");
    const start = me.armory.balance;   // the welcome credits
    h.db.prepare("INSERT INTO ledger VALUES (?,?,?,?,?)").run(ids.rae.id, 100 - start, "test", "", new Date().toISOString());
    me = await get("rae", "/v1/world/battle/me");
    assert.ok(me.armory, "the Armory in /me"); assert.equal(me.armory.balance, 100); assert.deepEqual(me.armory.targets, ["@sam"]);
    assert.ok(me.armory.now >= me.armory.opensAt && me.armory.now < me.armory.locksAt);

    // no word filter (Mike 11-18 "No boundaries"); a too-long word charges nothing, and says which row
    let r = await as("rae", "/v1/world/battle/armory", { bombs: [{ k: "inferno", word: "shipit" }, { k: "sparkler", word: "thirteenchars" }] });
    assert.equal(r.status, 422); assert.deepEqual(r.body.rows.map(x => x.i), [1]); assert.match(r.body.error, /Nothing was charged/);
    assert.equal((await get("rae", "/v1/world/battle/me")).armory.balance, 100);
    assert.equal((await as("rae", "/v1/world/battle/armory", { bombs: [{ k: "nova", word: "   " }] })).status, 422, "an empty word");
    assert.equal((await as("rae", "/v1/world/battle/armory", { bombs: [{ k: "nova", word: "GG", target: "@nobody" }] })).status, 422, "unknown target");
    // too expensive: 402 with the balance
    r = await as("rae", "/v1/world/battle/armory", { bombs: [{ k: "nova", word: "A" }, { k: "nova", word: "B" }, { k: "nova", word: "C" }] });
    assert.equal(r.status, 402); assert.equal(r.body.balance, 100);
    // a good order, with an idempotency key: a double tap charges once
    const order = { key: "tap-1", bombs: [{ k: "inferno", word: "shipit", target: "@sam" }, { k: "sparkler", word: "lgtm" }] };
    r = await as("rae", "/v1/world/battle/armory", order); assert.equal(r.status, 200); assert.equal(r.body.balance, 70);
    assert.equal((await as("rae", "/v1/world/battle/armory", order)).body.balance, 70, "same key, same result, charged once");
    me = await get("rae", "/v1/world/battle/me");
    assert.deepEqual(me.armory.bought.map(b => [b.k, b.word, b.target]), [["inferno", "SHIPIT", "@sam"], ["sparkler", "LGTM", null]]);

    // the night runs: both bombs fly as extra shots with their words; every city that fired gets the battle reward once
    const night = me.armory.night, before = h.db.prepare("SELECT COUNT(*) n FROM battle_shots").get().n;
    BT.resolve(night);
    const shots = h.db.prepare("SELECT * FROM battle_shots WHERE night=?").all(night).map(s => ({ ...s, x: JSON.parse(s.x || "null") }));
    const bombs = shots.filter(s => s.x && s.x.bk);
    assert.deepEqual(bombs.map(s => [s.x.bk, s.x.word, s.a === ids.rae.id, s.d === ids.sam.id]).sort(), [["inferno", "SHIPIT", true, true], ["sparkler", "LGTM", true, true]]);
    assert.ok(bombs.every(s => s.w === (s.x.bk === "inferno" ? "tactical" : "shell")), "each flies as its mapped weapon");
    assert.ok(h.db.prepare("SELECT COUNT(*) n FROM battle_shots").get().n > before);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM armory_bombs WHERE state='fired'").get().n, 2);
    const reward = w => h.db.prepare("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE who=? AND reason='battle reward'").get(ids[w].id).s;
    assert.equal(reward("rae"), 10); assert.equal(reward("sam"), 10);
    BT.resolve(night, { force: true }); assert.equal(reward("rae"), 10, "the reward is once per night, even if the night runs again");

    // a hidden word shows as the bomb's name, for everyone
    const bid = bombs.find(s => s.x.bk === "inferno").x.bid;
    assert.equal((await as("rae", "/v1/world/battle/report-word", { bid })).status, 400, "not your own word");
    assert.equal((await as("sam", "/v1/world/battle/report-word", { bid })).body.reports, 1);
    BT.armory.hide(bid, true);

    // refunds: a bomb at a city that left the battles before the night does not hit someone else
    h.db.prepare("INSERT INTO ledger VALUES (?,?,?,?,?)").run(ids.rae.id, 100, "test", "", new Date().toISOString());
    assert.equal((await as("rae", "/v1/world/battle/armory", { bombs: [{ k: "thunderbolt", word: "zap", target: "@sam" }] })).status, 200);
    const bal0 = (await get("rae", "/v1/world/battle/me")).armory.balance;
    assert.equal((await as("sam", "/v1/world/battle/opt", { war: false })).status, 200);
    BT.resolve(night, { force: true });
    assert.equal((await get("rae", "/v1/world/battle/me")).armory.balance, bal0 + 12, "refunded");

    // alerts: at most one row per player per night, however often the tick runs; no email while the switch is off
    await BT.armoryAlerts(); await BT.armoryAlerts();
    const rows = h.db.prepare("SELECT target, COUNT(*) n FROM alerts WHERE dkey LIKE 'armory:%' GROUP BY target, dkey").all();
    assert.ok(rows.every(x => x.n === 1), JSON.stringify(rows));
    assert.equal(sent.filter(m => m.src === "armory-open").length, 0, "no Armory email until CALDERA_ARMORY_EMAIL=1");
    // settings: time zone and the two switches
    assert.equal((await as("rae", "/v1/world/battle/tz", { tz: "Europe/London" })).body.ok, true);
    assert.equal((await as("rae", "/v1/world/battle/tz", { tz: "Mars/Base" })).body.ok, false);
    assert.deepEqual((await as("rae", "/v1/world/battle/notify", { armoryRemind: false })).body, { open: true, remind: false });
    me = await get("rae", "/v1/world/battle/me");
    assert.equal(me.armory.tz, "Europe/London"); assert.deepEqual(me.armory.alerts, { open: true, remind: false });
    const html = BT.settingsHtml(ids.rae.id);
    assert.ok(html.includes('id="sw-armory-open"') && html.includes('aria-checked="false"') && html.includes("Your time zone: London"));
    // one-click unsubscribe from Armory email
    const tok = h.db.prepare("SELECT token FROM armory_prefs WHERE p=?").get(ids.rae.id).token;
    assert.equal((await fetch(base + "/u/armory?t=" + tok, { method: "POST" })).status, 200);
    assert.equal(h.db.prepare("SELECT mail_on FROM armory_prefs WHERE p=?").get(ids.rae.id).mail_on, 0);
  } finally { h.server.close(); }
});
