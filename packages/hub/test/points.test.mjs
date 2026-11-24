// Caldera Points, phase 1 (LOOP.md part d, d.10 tests): a night pays one time; expiry uses the oldest points first; the 1 in
// 4 cut with 1, 2, 4 and 10 advertisers; a paused promotion starts again when the balance covers one day; the daily charge.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHub } from "../dist/server.js";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const load = async (f) => { const { build } = await import("esbuild"); const o = await build({ entryPoints: [new URL("../src/" + f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false }); return import("data:text/javascript;base64," + Buffer.from(o.outputFiles[0].text).toString("base64")); };
const PT = await load("points.ts"), PR = await load("promote.ts"), BT = await load("battle.ts");
const DAY = 86_400_000, LAUNCH = 20400;   // a launch night; seasons are 42 nights
const at = (night, h = 12) => night * DAY + h * 3600_000;

function setup(t0 = at(LAUNCH + 5)) {
  const db = new DatabaseSync(":memory:"), q = sql => db.prepare(sql), clock = { t: t0 };
  const P = PT.pointsStore(q, { now: () => clock.t, seasonOf: n => { const k = Math.max(0, n - LAUNCH); return { n: Math.floor(k / 42) + 1, from: LAUNCH + Math.floor(k / 42) * 42 }; } });
  return { q, P, clock };
}
const shot = (a, d, f, o = {}) => ({ k: 0, a, d, w: "shell", ammo: o.ammo || 1, roll: 0, f, lot: 0, t: 0, aim: 0, blocked: o.blocked ? 1 : 0, x: null });

test("a night pays one time: won +30 or held +20, never both; the fallen city and quiet cities get nothing", () => {
  const { P } = setup(), N = LAUNCH + 3;
  const shots = [shot("A", "B", 0.5), shot("B", "A", 0.1), shot("C", "B", 0.6), shot("C", "E", 0.01, { blocked: true, ammo: 10 }), shot("~raiders", "A", 0.05)];
  assert.equal(BT.resultOf("A", shots), "WON");
  assert.equal(BT.resultOf("B", shots), "FELL");
  assert.equal(BT.resultOf("E", shots), "HELD");
  assert.equal(BT.resultOf("Z", shots), "QUIET");
  const paid = P.awardNight(N, shots, () => []);
  assert.deepEqual(paid.map(p => p.owner + ":" + p.kind).sort(), ["A:won", "C:won", "E:held"]);
  assert.equal(P.balanceOf("A"), 30); assert.equal(P.balanceOf("E"), 20); assert.equal(P.balanceOf("B"), 0); assert.equal(P.balanceOf("~raiders"), 0);
  // the night resolved again (operator --force), or a different result: still one payment
  assert.deepEqual(P.awardNight(N, shots, () => []), []);
  assert.deepEqual(P.awardNight(N, [shot("E", "A", 0.9)], () => []), []);
  assert.equal(P.balanceOf("A"), 30); assert.equal(P.balanceOf("E"), 20);
  assert.equal(P.history("A")[0].note, "won");
});

test("a 7-night streak pays +100 on the 7th night in a row the city fought, one time", () => {
  const { P } = setup(at(LAUNCH + 20)), N = LAUNCH + 20, fights = n => n > N - 7 ? [shot("A", "B", 0.01)] : [];
  const paid = P.awardNight(N, fights(N), fights);
  assert.ok(paid.some(p => p.owner === "A" && p.kind === "streak" && p.amount === 100));
  assert.ok(paid.some(p => p.owner === "B" && p.kind === "streak"));   // hit 7 nights in a row: the city fought
  assert.deepEqual(P.awardNight(N, fights(N), fights).filter(p => p.kind === "streak"), []);
  const six = n => n > N - 5 ? [shot("C", "D", 0.01)] : [];   // tonight (N+1) and 5 nights before: 6 in a row
  assert.equal(P.awardNight(N + 1, six(N), six).filter(p => p.kind === "streak").length, 0);
});

test("orders and the podium pay one time each", () => {
  const { P } = setup();
  assert.equal(P.awardOrder("A", LAUNCH + 5, "build", "Merge a pull request"), true);
  assert.equal(P.awardOrder("A", LAUNCH + 5, "build", "Merge a pull request"), false);
  assert.equal(P.awardOrder("A", LAUNCH + 5, "fight", "Aim one shot at a rival"), true);
  assert.equal(P.awardOrder("A", LAUNCH + 5, "scout", "Watch last night's replay"), true);
  assert.equal(P.balanceOf("A"), 40);
  assert.equal(P.awardPodium("A", 1, 1), true); assert.equal(P.awardPodium("A", 1, 2), false);
  assert.equal(P.balanceOf("A"), 1040);
  assert.deepEqual(P.history("A").map(PT.ledgerWhat).sort(), ["Order: Aim one shot at a rival", "Order: Merge a pull request", "Order: Watch last night's replay", "Season 1 podium"]);
});

test("expiry: points of season n go at the end of season n+1, and spending uses the oldest points first", () => {
  const { P, clock } = setup(at(LAUNCH + 5));
  P.earn("A", "night", "s1", 100, "won");                      // season 1
  clock.t = at(LAUNCH + 50); P.earn("A", "night", "s2", 100, "won");   // season 2
  assert.deepEqual(P.buckets("A"), [{ season: 1, n: 100 }, { season: 2, n: 100 }]);
  const ex = P.expiringOf("A"); assert.equal(ex[0].ends, 2); assert.equal(ex[1].ends, 3);
  assert.equal(P.spend("A", 150, "promo", "1:20450", "Promotion: x, 1 day"), 150);
  assert.deepEqual(P.buckets("A"), [{ season: 2, n: 50 }]);   // season 1 was used first
  assert.equal(P.spend("A", 150, "promo", "1:20450", "again"), 0);   // one charge per ref
  assert.equal(P.history("A")[0].amount, -150);   // a spend over two seasons is one row on the wallet
  clock.t = at(LAUNCH + 90); assert.equal(P.expire(), 0);   // season 3: season 1 is empty already
  assert.equal(P.balanceOf("A"), 50);
  clock.t = at(LAUNCH + 130); assert.equal(P.expire(), 50); assert.equal(P.expire(), 0);   // season 4: season 2 expires, one time
  assert.equal(P.balanceOf("A"), 0);
  assert.equal(PT.ledgerWhat(P.history("A", 200)[0]), "Expired");
});

test("the 1 in 4 cut with 1, 2, 4 and 10 advertisers", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(PR.shares([200])[0], 0.25);                                     // 1: shown in 1 of 4 page views, the rest show no card
  PR.shares([20, 200]).forEach(s => near(s, 0.25));                     // 2: both capped
  const four = PR.shares([200, 20, 50, 30]); four.forEach(s => near(s, 0.25)); near(four.reduce((a, b) => a + b), 1);
  const ten = PR.shares([200, 20, 20, 20, 20, 20, 20, 20, 20, 20]);
  near(ten[0], 0.25); for (const s of ten.slice(1)) near(s, 0.75 / 9); near(ten.reduce((a, b) => a + b), 1);
  const mixed = PR.shares([100, 100, 50, 50, 20, 20, 20, 20, 10, 10]);
  assert.ok(Math.max(...mixed) <= 0.25 + 1e-12); near(mixed.reduce((a, b) => a + b), 1);
  near(mixed[2] / mixed[4], 50 / 20);                                   // under the cap, shares follow the bids
});

function hubFor(o = {}) {
  const { q, P, clock } = setup(o.t0);
  let r = 0; const seq = o.rng || (() => r);
  const H = PR.pointsHub({ q, hub: "https://caldera.test", P, now: () => clock.t, rng: () => seq(),
    memberOf: () => null, sameOrigin: () => true, readBody: async () => ({}), json: () => {}, header: () => "", profile: id => ({ handle: id.toLowerCase() }),
    avatar: () => null, reposOf: id => [{ full: id.toLowerCase() + "/tool", stars: 3 }], productLink: () => null, viewerOf: () => ({}), tooMany: () => false });
  return { H, P, clock, setR: v => { r = v; } };
}
const live = (H, owner, bid) => { H.store.put(owner, { kind: "repo", target: owner.toLowerCase() + "/tool", title: owner + " tool", line: "It does one thing.", bid, status: "review" }); return H.admin.approve(H.store.of(owner).id); };

test("a promotion paused for points starts again by itself when the balance covers one day", () => {
  const { H, P } = hubFor();
  P.earn("A", "night", "1", 30, "won");
  assert.equal(live(H, "A", 40).status, "live");
  assert.equal(H.stateOf(H.store.of("A")), "out");
  assert.equal(H.promoCard("feed", { key: "reader" }), "");             // not shown while it cannot pay for a day
  P.earn("A", "night", "2", 20, "held");                                // 50 points now cover a 40-point day
  assert.equal(H.stateOf(H.store.of("A")), "live");
  const card = H.promoCard("feed", { key: "reader" });
  assert.match(card, /Built by the fleet/); assert.match(card, /Promoted by <a href="\/@a\/">@a<\/a> with Caldera Points/); assert.match(card, />Report</);
  assert.match(card, /href="\/p\/\d+\?pl=feed"/);
});

test("views count one time a day per person (not the owner, not bots); points are taken one time at 20:00 PT for each day shown", () => {
  const { H, P, clock } = hubFor({ t0: at(LAUNCH + 5, 20) });   // 20:00 UTC = noon PT
  P.earn("A", "night", "1", 200, "won"); live(H, "A", 50);
  H.promoCard("feed", { key: "r1" }); H.promoCard("feed", { key: "r1" }); H.promoCard("people", { key: "r1" });
  H.promoCard("feed", { id: "A" }); H.promoCard("feed", { key: "bot", bot: true });
  const id = H.store.of("A").id, day = PT.spendDayOf(clock.t);
  assert.deepEqual(H.store.counts(id, day), { feed: { views: 1, clicks: 0 }, people: { views: 1, clicks: 0 } });
  assert.deepEqual(H.tick().spend, { charged: 0, points: 0 });          // before 20:00 PT
  clock.t = at(LAUNCH + 6, 3.9); assert.equal(H.tick().spend.charged, 0);   // 19:54 PT
  clock.t = at(LAUNCH + 6, 4.1);                                        // 20:06 PT
  assert.deepEqual(H.tick().spend, { charged: 1, points: 50 }); assert.deepEqual(H.tick().spend, { charged: 0, points: 0 });
  assert.equal(P.balanceOf("A"), 150);
  assert.equal(PT.ledgerWhat(P.history("A")[0]), "Promotion: A tool, 1 day");
});

test("one promotion per owner; own projects only; the bid is 20 to 200 in steps of 10; reviewed before it shows", () => {
  const { H, P } = hubFor();
  const ad = { kind: "repo", target: "b/tool", title: "B tool", line: "It does one thing.", bid: 40 };
  assert.equal(H.act("B", { action: "submit", ...ad }).status, 400);   // no points
  P.earn("B", "night", "1", 100, "won");
  assert.equal(H.act("B", { action: "submit", ...ad, target: "someone/else" }).status, 400);
  assert.equal(H.act("B", { action: "submit", ...ad, bid: 45 }).status, 400);
  assert.equal(H.act("B", { action: "submit", ...ad, bid: 210 }).status, 400);
  assert.equal(H.act("B", { action: "submit", ...ad }).status, 200);
  assert.equal(H.act("B", { action: "submit", ...ad }).status, 409);    // one at a time
  assert.equal(H.promoCard("feed", { key: "r" }), "");                   // in review: not shown
  assert.equal(H.admin.queue().length, 1);
  assert.equal(H.admin.reject(H.store.of("B").id, "nope").error !== undefined, true);
  assert.equal(H.admin.reject(H.store.of("B").id, "claim").reason, "the line makes a claim the project page does not show");
  assert.equal(H.stateOf(H.store.of("B")), "no");
  assert.equal(H.act("B", { action: "submit", ...ad }).status, 200);
  H.admin.approve(H.store.of("B").id);
  assert.equal(H.act("B", { action: "save", ...ad, bid: 60 }).body.state, "live");
  assert.equal(H.store.of("B").bid, 60);
  assert.equal(H.act("B", { action: "save", ...ad, bid: 60, title: "New words" }).body.state, "rev");   // new words: review again
});

// ---------------------------------------------------------------------------------------------- the pages, through the hub
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const jwt = o => "x." + Buffer.from(JSON.stringify(o)).toString("base64url") + ".x";
test("the pages: sign in first; wallet, promote and counts carry the rule box; no phase 2 tab; the account menu row", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-points-")); __tmpDirs.push(d);
  fs.writeFileSync(path.join(d, "google-oauth.json"), JSON.stringify({ client_id: "cid.apps", client_secret: "shh" }));
  const st = { claims: {} };
  const h = createHub({ dataDir: d, publicUrl: "http://hub.test", githubFetch: async u => String(u).includes("oauth2.googleapis.com/token") ? J({ id_token: jwt(st.claims) }) : J({}, 404), limits: { newProfilesPerDay: 100 }, email: { send: async () => {} } });
  const base = "http://127.0.0.1:" + await h.listen(0);
  try {
    const r0 = await fetch(base + "/points", { redirect: "manual", headers: { "user-agent": UA } });
    assert.equal(r0.status, 302); assert.equal(r0.headers.get("location"), "/signin?back=%2Fpoints");
    const s = await fetch(base + "/auth/google", { redirect: "manual", headers: { "user-agent": UA } });
    const state = new URL(s.headers.get("location")).searchParams.get("state"), ck = s.headers.get("set-cookie").split(";")[0];
    st.claims = { iss: "https://accounts.google.com", aud: "cid.apps", nonce: state, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, email: "pat@example.com", name: "Pat" };
    const cb = await fetch(base + `/auth/google/callback?state=${state}&code=abc`, { redirect: "manual", headers: { cookie: ck, "user-agent": UA } });
    const cookie = cb.headers.get("set-cookie").split(";")[0];
    const get = p => fetch(base + p, { headers: { "user-agent": UA, cookie } }).then(r => r.text());
    const w = await get("/points");
    assert.match(w, /<h1>Caldera Points<\/h1>/); assert.match(w, /No points yet\. Your first order pays 10 to 20 points today\./);
    assert.match(w, /<b>Caldera Points have no cash value\.<\/b> They can only be used for promotion on Caldera and its ad network\. You cannot buy, sell, send or exchange points\./);
    assert.match(w, /Nothing yet\. Points you earn and use show here\./); assert.match(w, /aria-current="page">Wallet</);
    assert.doesNotMatch(w, /Show the fleet on your site|\/points\/embed/);
    assert.match(w, /href="http:\/\/hub\.test\/points"[^>]*>.*Caldera Points/);   // the account menu row
    const p = await get("/points/promote");
    assert.match(p, /Submit for review<\/button>/); assert.match(p, /Earn points first: a won night pays 30\./); assert.match(p, /Caldera Points have no cash value/);
    assert.match(p, /aria-describedby="c-t"/); assert.match(p, /<output id="o-bid"/);
    const c = await get("/points/counts");
    assert.match(c, /No counts yet\. They start when your promotion is approved and shown\./); assert.match(c, /Caldera Points have no cash value/);
    const sub = await fetch(base + "/v1/points/promote", { method: "POST", headers: { "user-agent": UA, cookie, origin: "http://hub.test", "content-type": "application/json" }, body: JSON.stringify({ action: "submit", kind: "profile", target: "x", title: "t", line: "l", bid: 40 }) });
    assert.equal(sub.status, 400);
    const card = await fetch(base + "/v1/points/card?pl=people", { headers: { "user-agent": UA } }).then(r => r.json());
    assert.deepEqual(card, { html: "", css: "" });
    assert.equal((await fetch(base + "/p/999?pl=feed", { redirect: "manual", headers: { "user-agent": UA } })).status, 302);
    // a live promotion: submit over HTTP, approve as the operator, then the card in People and in the Feed
    const handle = (p.match(/caldera\.social\/@([a-z0-9-]+)/) || [])[1]; assert.ok(handle);
    const db = new DatabaseSync(path.join(d, "hub.sqlite")); const id = db.prepare("SELECT id FROM profiles WHERE handle=?").get(handle).id; db.close();
    const PTS = h.admin.points; PTS.points.earn(id, "night", "1", 100, "won");
    const ok = await fetch(base + "/v1/points/promote", { method: "POST", headers: { "user-agent": UA, cookie, origin: "http://hub.test", "content-type": "application/json" }, body: JSON.stringify({ action: "submit", kind: "profile", target: handle, title: "Pat's page", line: "What I build.", bid: 40 }) });
    assert.equal(ok.status, 200);
    assert.match(await get("/points/promote"), /<b>In review<\/b>/);
    assert.equal(PTS.admin.queue()[0].handle, "@" + handle);
    assert.equal(PTS.admin.approve(PTS.admin.queue()[0].id).status, "live");
    assert.match(await get("/points/promote"), /<b>Live since [A-Z][a-z]{2} \d{1,2}<\/b><p>40 points a day\./);
    let pc = { html: "" }, tries = 0;   // 1 advertiser: about 1 in 4 page views draw the card
    while (!pc.html && tries++ < 80) pc = await fetch(base + "/v1/points/card?pl=people", { headers: { "user-agent": UA } }).then(r => r.json());
    assert.ok(pc.css.includes(".pr-box")); assert.ok(tries > 0);
    {
      assert.match(pc.html, new RegExp(`Promoted by <a href="/@${handle}/">@${handle}</a> with Caldera Points`));
      const go = await fetch(base + pc.html.match(/href="(\/p\/\d+\?pl=people)"/)[1], { redirect: "manual", headers: { "user-agent": UA } });
      assert.equal(go.headers.get("location"), `http://hub.test/@${handle}/`);
    }
    const rep = await fetch(base + "/v1/points/report", { method: "POST", headers: { "user-agent": UA, origin: "http://hub.test", "content-type": "application/json" }, body: JSON.stringify({ id: PTS.store.of(id).id, reason: "claim" }) });
    assert.equal(rep.status, 200); assert.equal(PTS.admin.reports()[0].reason, "claim");
    assert.match(await get("/points/report?id=" + PTS.store.of(id).id), /Report this promotion[\s\S]*Not their own project[\s\S]*The member does not see who sent it\./);
  } finally { h.server.closeAllConnections?.(); h.server.close(); }
});
