// Armory gift emails (Mike 11-18, "for the armoury"): a bomb aimed at a member's city sends email 1 at once (live countdown
// GIF, start time as text in their time zone); email 2 the next day only if the battle summary names them. Once per gift,
// capped, only to reachable members, logged sent / opened / clicked per step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const mod = async f => { const out = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64")); };
const GM = await mod("../src/giftmail.ts"), AR = await mod("../src/armory.ts"), GIF = await mod("../src/gif.ts");
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

const H = 3_600_000, DAY = 86_400_000;
function rig(o = {}) {
  const db = new DatabaseSync(":memory:"), q = s => db.prepare(s);
  const A = AR.armoryStore(q), sent = [];
  let clock = o.now ?? Date.UTC(2026, 10, 18, 18, 0);   // 10:00 PT on Nov 18
  const night = Math.floor(clock / DAY) + 1;   // tonight's battle: 10:00 UTC Nov 19 (02:00 PT), salvo on the map 20:00 PT Nov 19
  const people = { s: { handle: "sender", name: "Sam Sender", email: "s@x.test" }, r: { handle: "rae", name: "Rae Lee", email: "r@x.test" }, k: { handle: "kai", name: "Kai", email: null }, t: { handle: "tok", name: "To", email: "t@x.test", tz: "Asia/Tokyo" } };
  const prefs = { r: { mail: true } };
  let mailOn = true, summary = null, ran = false;
  const G = GM.giftMail({ q, hub: "https://hub.test", now: () => clock, postal: "PO", A, battleAt: n => n * DAY + 10 * H, ran: () => ran, summary: () => summary,
    emailOf: id => people[id]?.email || null, prefs: id => ({ tz: people[id]?.tz || "America/Los_Angeles", mail: prefs[id]?.mail !== false, token: "tk-" + id }),
    mailOn: () => mailOn, handle: id => "@" + (people[id]?.handle || id), nameOf: id => people[id]?.name || "", send: async m => { sent.push(m); return true; },
    unsubAll: id => "https://hub.test/v1/email/unsub?t=all-" + id, fmtUsd: n => "$" + Math.round(n / 1000) + "K" });
  const buy = (p, items) => { const r = A.buy(p, night, items, clock); assert.ok(r.ok, JSON.stringify(r)); return r.ids.map(i => A.get(i)); };
  q("INSERT INTO ledger VALUES ('s', 1000, 'test', 'x', '2026-01-01')").run(); q("INSERT INTO ledger VALUES ('r', 1000, 'test', 'x', '2026-01-01')").run();
  return { db, q, A, G, sent, night, buy, people, prefs, set: v => { if ("now" in v) clock = v.now; if ("mailOn" in v) mailOn = v.mailOn; if ("summary" in v) summary = v.summary; if ("ran" in v) ran = v.ran; }, now: () => clock };
}
const res = () => { const r = { status: 0, headers: {}, body: null, writeHead(s, h) { r.status = s; r.headers = h || {}; }, end(b) { r.body = b; } }; return r; };
const get = async (G, path) => { const u = new URL("https://hub.test" + path), r = res(); const hit = await G.route({ method: "GET" }, r, u.pathname, u); return { hit, ...r }; };

test("salvoAt: 20:00 local on the day that plays the night", () => {
  const battle = Date.UTC(2026, 10, 19, 10);   // 02:00 PT Nov 19, 19:00 Tokyo Nov 19
  assert.equal(new Date(AR.salvoAt(battle, "America/Los_Angeles")).toISOString(), "2026-11-20T04:00:00.000Z", "20:00 PT Nov 19");
  assert.equal(new Date(AR.salvoAt(battle, "Asia/Tokyo")).toISOString(), "2026-11-19T11:00:00.000Z", "20:00 JST Nov 19: the first 20:00 at or after the battle (19:00 JST)");
  // from 2026-11-25 the battle is at 20:00 PT: the Pacific map fires it live, Europe that evening
  const b2 = Date.parse("2026-11-27T04:00:00Z");
  assert.equal(new Date(AR.salvoAt(b2, "America/Los_Angeles")).toISOString(), "2026-11-27T04:00:00.000Z", "live at 20:00 PT");
  assert.equal(new Date(AR.salvoAt(b2, "Europe/Berlin")).toISOString(), "2026-11-27T19:00:00.000Z", "20:00 CET the same day");
  assert.equal(new Date(AR.salvoAt(battle, "Europe/London")).toISOString(), "2026-11-19T20:00:00.000Z");
});

test("email 1: a bomb at a member's city, once per gift, named only when the buyer chose to", async () => {
  const R = rig();
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "GG", target: "r" }, { kind: "sparkler", word: "HI", target: "r" }])), 1, "two bombs at one city = one gift email");
  const m = R.sent[0];
  assert.equal(m.to, "r@x.test"); assert.equal(m.src, "armory-gift-1"); assert.match(m.subject, /^Someone bought you/, "the buyer did not show their name");
  assert.ok(!m.text.includes("@sender") && !m.html.includes("@sender"), "no sender anywhere when hidden");
  assert.match(m.subject, /2 bombs$/); assert.match(m.text, /^Hey Rae,/); assert.match(m.text, /They chose not to show their name/);
  assert.match(m.text, /GG/); assert.match(m.text, /HI/);
  assert.match(m.text, /8:00\s?PM/, "the start as text, in the recipient's time zone");
  assert.match(m.headers["List-Unsubscribe"], /\/u\/armory\?t=tk-r/); assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const tok = R.q("SELECT token, status, sent FROM gift_mail WHERE step=1").get(); assert.equal(tok.status, "sent"); assert.ok(tok.sent);
  assert.ok(m.html.includes(`/email/countdown.gif?b=${R.night}&amp;t=${tok.token}`), "the live countdown GIF");
  // the same buyer, the same city, the same night: no second email
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "inferno", word: "AGAIN", target: "r", named: true }])), 0);
  // a buyer who shows their name
  const R2 = rig(); await R2.G.afterBuy("s", R2.night, R2.buy("s", [{ kind: "nova", word: "GG", target: "r", named: true }]));
  assert.match(R2.sent[0].subject, /^@sender bought you a Nova/);
});

test("email 1: who never gets one", async () => {
  const R = rig();
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "X", target: null }])), 0, "a random target");
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "X", target: "uc:torvalds" }])), 0, "an unclaimed land: never contacted");
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "X", target: "s" }])), 0, "the buyer's own city");
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "X", target: "k" }])), 0, "no confirmed address");
  R.prefs.r = { mail: false };
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "X", target: "r" }])), 0, "the Armory email switch is off");
  R.prefs.r = { mail: true }; R.set({ mailOn: false });
  assert.equal(await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "X", target: "r" }])), 0, "CALDERA_ARMORY_EMAIL is off");
  assert.equal(R.sent.length, 0);
  // the cap: at most 3 gift emails per recipient per night
  const C = rig(); for (const p of ["a", "b", "c", "d"]) { C.q(`INSERT INTO ledger VALUES ('${p}', 100, 't', 'x', '2026-01-01')`).run(); await C.G.afterBuy(p, C.night, C.buy(p, [{ kind: "sparkler", word: "Y", target: "r" }])); }
  assert.equal(C.sent.length, GM.GIFT_CAP);
});

test("email 2: the next morning, only when the summary names them, once", async () => {
  const R = rig(); await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "nova", word: "GG", target: "r" }]));
  const salvo = AR.salvoAt(R.night * DAY + 10 * H, "America/Los_Angeles");
  R.set({ ran: true, summary: { postId: "p123", top: [["x", 9]], hit: [["y", { f: 41000, towers: 2 }]] } });
  R.set({ now: salvo + 13 * H }); assert.equal(await R.G.tick(), 0, "not named: no email 2");
  R.set({ summary: { postId: "p123", top: [["x", 9]], hit: [["r", { f: 41000, towers: 2 }]] } });
  R.set({ now: salvo + 2 * H }); assert.equal(await R.G.tick(), 0, "too soon: that night, not the next day");
  R.set({ now: salvo + 13 * H }); assert.equal(await R.G.tick(), 1, "09:00 PT the next day");
  const m = R.sent.at(-1); assert.equal(m.src, "armory-gift-2"); assert.match(m.text, /2 towers hit/); assert.match(m.text, /\$41K/);
  assert.equal(m.subject, "Your city made the battle summary"); assert.match(m.text, /A Nova from someone, with the word GG/, "the gift bomb, unnamed");
  assert.ok(m.html.includes("/email/go?t=") && decodeURIComponent(m.html).includes("/feed/p/p123"), "links to the summary post through the click log");
  assert.equal(await R.G.tick(), 0, "once"); assert.equal(R.sent.filter(x => x.src === "armory-gift-2").length, 1);
});

test("tracking: the countdown opens, the pixel opens, clicks redirect only to our pages; stats per step", async () => {
  const R = rig(); await R.G.afterBuy("s", R.night, R.buy("s", [{ kind: "thunderbolt", word: "ZAP", target: "r" }]));
  const t = R.q("SELECT token FROM gift_mail").get().token;
  const g = await get(R.G, `/email/countdown.gif?b=${R.night}&t=${t}`);
  assert.equal(g.status, 200); assert.equal(g.headers["content-type"], "image/gif"); assert.match(g.headers["cache-control"], /no-store/);
  assert.equal(g.body.subarray(0, 6).toString(), "GIF89a"); assert.equal(g.body.at(-1), 0x3b);
  assert.equal(R.q("SELECT opens FROM gift_mail").get().opens, 1);
  const c = await get(R.G, `/email/go?t=${t}&u=${encodeURIComponent("/world?view=battle")}`);
  assert.equal(c.status, 302); assert.equal(c.headers.location, "https://hub.test/world?view=battle&src=email-armory-gift-1");
  const evil = await get(R.G, `/email/go?t=${t}&u=${encodeURIComponent("//evil.test/x")}`); assert.match(evil.headers.location, /^https:\/\/hub\.test\/world/);
  const ab = await get(R.G, `/email/go?t=${t}&u=${encodeURIComponent("https://evil.test")}`); assert.match(ab.headers.location, /^https:\/\/hub\.test\//);
  const row = R.q("SELECT opened, clicked, clicks FROM gift_mail").get(); assert.ok(row.opened && row.clicked); assert.equal(row.clicks, 3);
  assert.equal((await get(R.G, "/email/o.gif?t=nope")).status, 200, "an unknown token still gets the pixel");
  const st = R.G.stats("2000-01-01"); assert.equal(st.length, 1); assert.deepEqual([st[0].step, st[0].sent, st[0].opened, st[0].clicked], [1, 1, 1, 1]);
  R.G._claim("test:1", 1, R.night, "s", "r"); R.q("UPDATE gift_mail SET status='sent', sent='2026-11-18' WHERE gift='test:1'").run();
  assert.equal(R.G.stats("2000-01-01").reduce((t, r) => t + r.sent, 0), 1, "test sends are not counted");
});

test("the countdown GIF: one frame a second to the start; after the start, one still frame", () => {
  const R = rig(), start = R.now() + 90_000;
  const frames = n => { let k = 0; for (let i = 0; i < n.length - 2; i++) if (n[i] === 0x21 && n[i + 1] === 0xf9 && n[i + 2] === 4) k++; return k; };
  assert.equal(frames(R.G.countdownGif(start + 3600_000, R.now())), 121, "120 seconds, then the held clock frame");
  assert.equal(frames(R.G.countdownGif(start, R.now())), 92, "90..0, then BATTLE ON");
  assert.equal(frames(R.G.countdownGif(start, start + 1000)), 1, "running: one still frame");
  assert.equal(frames(R.G.countdownGif(start, start + 3600_000)), 1, "over: one still frame");
  const cv = new GIF.Canvas(4, 2); cv.rect(1, 0, 2, 2, 1); assert.deepEqual([...cv.px], [0, 1, 1, 0, 0, 1, 1, 0]);
});
