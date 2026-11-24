// The homepage block "Last night's battle" (LOOP.md part b, homebattle.ts): a normal night, no battle last night, no battle
// ever, season end, the empty fleet slot, the same block in every arm of the homepage test, and the map's embed mode.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";
import { cityData, publicCity, renderCity } from "../../../../caldera/packages/plugin/test/city.build.mjs";

const mod = async f => { const o = await build({ entryPoints: [new URL("../src/" + f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
  return import("data:text/javascript;base64," + Buffer.from(o.outputFiles[0].text).toString("base64")); };
const HB = await mod("homebattle.ts"), HT = await mod("hometest.ts"), B = await mod("battle.ts");
const site = fileURLToPath(new URL("../../site/", import.meta.url)), INDEX = fs.readFileSync(path.join(site, "index.html"), "utf8");
const dirs = []; after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const DAY = 86_400_000, NOW = Date.parse("2026-11-24T18:48:00Z");

const night = (o = {}) => ({ night: "2026-11-24", last: true, winner: "@novak", cities: 96, hits: 56, usd: 287e6,
  tops: [{ h: "@novak", usd: 53e6, fired: 6, landed: 5 }, { h: "@tessera", usd: 41e6, fired: 9, landed: 6 }, { h: "@quill", usd: 22e6, fired: 4, landed: 4 }],
  hard: [{ h: "@harbor", usd: 48e6, hits: 7, held: 3e6, fell: true }, { h: "@lumen", usd: 31e6, hits: 5, held: 12e6, fell: false }],
  board: [{ h: "@novak", usd: 1.8e9, rank: 1, prev: 1 }, { h: "@tessera", usd: 4e8, rank: 2, prev: 4 }, { h: "@quill", usd: 3.47e8, rank: 3, prev: 2 }, { h: "@brandt", usd: 9.6e7, rank: 4, prev: null }],
  season: 1, week: 3, podium: null, next: NOW + (5 * 60 + 12) * 60_000, running: false, ...o });
const section = h => { const i = h.indexOf('<section class="ln"'); return i < 0 ? null : h.slice(i, h.indexOf("</script>", i) + 9); };

test("normal night: eyebrow, countdown, headline, totals, stage picture, lists with movement, visitor and member words", () => {
  const h = HB.homeBattle(INDEX, night(), null, { now: NOW }), s = section(h);
  assert.ok(s && !h.includes("<!--home-battle-->"), "the block replaces the marker");
  assert.ok(h.indexOf('<section class="ln"') > h.indexOf('class="hero home-hero"') && h.indexOf('<section class="ln"') < h.indexOf('class="world-tile"'), "directly under the hero, above the world tile");
  assert.ok(h.indexOf('id="how-battles-work"') > h.indexOf('class="world-tile"'), "the old explainer sits under the world tile");
  assert.match(h, /<p class="eyebrow">Every night at 20:00 Pacific<\/p>/);
  assert.equal((h.match(/id="battle"/g) || []).length, 1, "old #battle links land on the block");
  assert.match(s, /aria-labelledby="ln-h"/); assert.match(s, /Last night's battle \/ Nov 24<\/p>/);
  assert.match(s, /role="timer" aria-label="Next battle in 5 hours 12 minutes"[^>]*>Next battle in <b>5h 12m<\/b> <span aria-hidden="true">\/ 20:00 PT<\/span>/);
  assert.ok(!/ln-next soon/.test(s), "over an hour: neutral chip");
  assert.match(s, /<h2 id="ln-h">@novak won the night\.<\/h2>/);
  assert.match(s, /<p class="ln-sub">96 cities fought\. 56 missiles hit\. \$287M of damage, rebuilt by noon\.<\/p>/);
  assert.match(s, /<img src="\/v1\/world\/battle\/card\/2026-11-24\.png" width="1200" height="630" alt="Caldera battle, Nov 24\. @novak won the night\. Top attackers: @novak \$53M, @tessera \$41M, @quill \$22M\. Hit hardest: @harbor \$48M \(city down\), @lumen \$31M\. 96 cities fought, 56 missiles hit, \$287M of damage\. Next battle tonight at 20:00 PT\."/);
  assert.match(s, /<a href="\/world\?view=battle&amp;replay=1" aria-label="Watch the full replay"><img/);
  assert.match(s, /<button class="ln-pp" type="button" id="ln-pp" aria-pressed="true" hidden>Play<\/button><span id="ln-capt">Picture of the battle of Nov 24\.<\/span>/, "auto off: the still, a Play button (shown by the script)");
  assert.ok(!s.includes("<iframe"), "no replay frame until the viewer taps Play");
  assert.match(s, /var AUTO=0;/);
  assert.match(s, /Watch the full replay<\/a><a rel="nofollow" class="btn ghost" href="\/join\?tp=battle">Put your city in tonight's battle<\/a>/);
  assert.match(s, /Free\. Your GitHub becomes a city, and today's code becomes missiles\. Damage shows only on this map\./);
  assert.match(s, /<span>Winners<\/span><span>Damage dealt<\/span>/); assert.match(s, /href="\/@novak\/"><span class="rk">1<\/span>.*?@novak<small>5 of 6 missiles hit<\/small><\/span><span class="v">\$53M<\/span>/);
  assert.match(s, /<span>Hit hardest<\/span><span>Damage taken<\/span>/); assert.match(s, /@harbor<span class="ln-tag">City down<\/span><small>7 hits, shield held \$3M<\/small><\/span><span class="v d">\$48M<\/span>/);
  assert.match(s, /<span>Season 1, week 3<\/span><a href="\/leaderboard">Full ranking<\/a>/);
  assert.match(s, /aria-label="no change">=<\/span>/); assert.match(s, /aria-label="up 2">.*?2<\/span>/); assert.match(s, /aria-label="down 1">.*?1<\/span>/); assert.match(s, /aria-label="new">new<\/span>/);
  assert.equal((s.match(/<ol class="ln-list">/g) || []).length, 3, "the three boxes are lists");
  const m = section(HB.homeBattle(INDEX, night(), "member-id", { now: NOW }));
  assert.match(m, /<a class="btn ghost" href="\/world\?view=battle#tonight">Set tonight's defenses<\/a>/);
  assert.match(m, /Defenses lock at 19:45 PT\. Work you push before then becomes missiles\./);
  // under an hour, and running
  assert.match(section(HB.homeBattle(INDEX, night({ next: NOW + 42 * 60_000 }), null, { now: NOW })), /class="ln-next soon"[^>]*aria-label="Next battle in 42 minutes"[^>]*>Next battle in <b>42m<\/b>/);
  assert.match(section(HB.homeBattle(INDEX, night({ running: true }), null, { now: NOW })), /<span class="ln-next run" role="status"><b>Battle running\.<\/b> Results in a moment\.<\/span>/);
});

test("no battle last night, no battle ever", () => {
  const s = section(HB.homeBattle(INDEX, night({ last: false, night: "2026-11-22" }), null, { now: NOW }));
  assert.match(s, /Last battle \/ Nov 22<\/p>/);
  assert.match(s, /<p class="ln-sub">No battle last night\. This is the battle of Nov 22\. 96 cities fought\./);
  assert.match(s, /card\/2026-11-22\.png/);
  const h = HB.homeBattle(INDEX, null, null, { now: NOW });
  assert.equal(section(h), null, "no battle ever: no block");
  assert.ok(!h.includes("<!--home-battle-->") && h.includes('id="how-battles-work"'), "the old explainer stays");
  assert.equal(HB.homeBattle("<p>x</p>", night(), null), "<p>x</p>", "no marker: page unchanged");
});

test("season end: podium 2 / 1 / 3 and the words", () => {
  const s = section(HB.homeBattle(INDEX, night({ podium: [{ h: "@novak", usd: 1.8e9 }, { h: "@tessera", usd: 4e8 }, { h: "@quill", usd: 3.47e8 }] }), null, { now: NOW }));
  assert.match(s, /<span>Season 1 final<\/span><a href="\/leaderboard">Full ranking<\/a>/);
  assert.match(s, /<div class="ln-pod"><div><b>2<\/b><a href="\/@tessera\/">@tessera<\/a><span>\$400M<\/span><\/div><div class="p1"><b>1<\/b><a href="\/@novak\/">@novak<\/a><span>\$1\.8B<\/span><\/div><div><b>3<\/b><a href="\/@quill\/">@quill<\/a>/);
  assert.match(s, /The three winners keep a Season 1 badge\. Season 2 starts tonight\./);
  assert.ok(!s.includes("Season 1, week 3"), "the podium in place of the top 5");
});

test("fleet slot: the empty state now; a promotion through the hook later", () => {
  const s = section(HB.homeBattle(INDEX, night(), null, { now: NOW }));
  assert.match(s, /<aside class="pr-card empty" aria-label="Built by the fleet"><p class="pr-eb">Built by the fleet<\/p><div class="pr-main"><span class="pr-t">This spot shows a member's own project\.<\/span><span class="pr-l">Members earn Caldera Points in the battle and use them here\. Points are never sold\.<\/span><\/div><a class="btn small ghost" href="\/points">How points work<\/a><\/aside>/);
  const p = section(HB.homeBattle(INDEX, night(), null, { now: NOW, promo: () => '<aside class="pr-card">PROMO</aside>' }));
  assert.ok(p.includes('<aside class="pr-card">PROMO</aside>') && !p.includes("pr-card empty"));
  const q = section(HB.homeBattle(INDEX, night(), null, { now: NOW, promo: () => { throw new Error("x"); } }));
  assert.ok(q.includes("pr-card empty"), "a failing hook falls back to the empty card");
});

test("the block is the same string in every arm of the homepage test (and both hero-button arms)", () => {
  const blocks = new Set(), heads = new Set();
  for (const arm of Object.keys(HT.HOME_ARMS)) {
    const page = HT.armHome(INDEX, arm) || INDEX;
    for (const p of [page, HT.primaryHome(page) || page]) { const h = HB.homeBattle(p, night(), null, { now: NOW }); blocks.add(section(h)); heads.add(h.match(/<h1>[^<]*<\/h1>/)[0]); }
  }
  assert.equal(blocks.size, 1); assert.ok(heads.size > 1, "the arms still differ in the hero");
});

test("homeNight: winners by damage dealt, hit hardest by damage taken, raiders and non-members left out, city down", () => {
  const x = (u, held = 0) => ({ u, fu: 0, fi: 0, sp: 0, held });
  const S = [
    { k: 1, a: "A", d: "D", w: "rocket", f: .3, lot: 0, x: x(5e6, 1e6) }, { k: 2, a: "A", d: "D", w: "rocket", f: 0, lot: 0, x: x(0, 2e6) },
    { k: 3, a: "Bb", d: "A", w: "rocket", f: .2, lot: 0, x: x(9e6) }, { k: 4, a: B.RAIDERS, d: "D", w: "rocket", f: .4, lot: 0, x: x(20e6) },
    { k: 5, a: "ghost", d: "A", w: "rocket", f: .1, lot: 0, x: x(1e6) }];
  const r = HB.homeNight(S, id => ({ A: "@a", Bb: "@b", D: "@d" })[id] || null);
  assert.equal(r.winner, "@b"); assert.deepEqual(r.tops, [{ h: "@b", usd: 9e6, fired: 1, landed: 1 }, { h: "@a", usd: 5e6, fired: 2, landed: 1 }]);
  assert.deepEqual(r.hard, [{ h: "@d", usd: 25e6, hits: 2, held: 3e6, fell: true }, { h: "@a", usd: 10e6, hits: 2, held: 0, fell: false }]);
  assert.equal(r.hits, 4); assert.equal(r.usd, 35e6);
});

// ---------------------------------------------------------------- the live hub
async function hubWith(handles) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-homebattle-")); dirs.push(d);
  const h = createHub({ dataDir: d, siteDir: site, publicUrl: "https://hub.test", githubFetch: async () => new Response("[]", { status: 200 }), growthPoll: false, email: { send: async () => {} }, limits: { newProfilesPerDay: 100 } });
  const base = "http://127.0.0.1:" + await h.listen(0), ids = {};
  for (const handle of handles) {
    const rr = (name, commits) => ({ name, project: "Work", public: true, language: "TypeScript", commits, weeks: [1, 2, 3], week: 3, today: 0, pushed: new Date().toISOString(), url: `https://github.com/${handle}/${name}` });
    const full = cityData([rr("app", 300)], () => ({ n: 0, paths: [] }), new Date().toISOString());
    const files = { "index.html": Buffer.from(`<html><body>${handle}</body></html>`).toString("base64"), "city.html": Buffer.from(renderCity({ name: handle, handle }, publicCity(full, ["Work"], "show"))).toString("base64") };
    const id = C.newIdentity(); ids[handle] = id;
    const r = await fetch(`${base}/v1/profiles/${id.id}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: C.sign(id, "profile.manifest", { name: handle, handle, boxKey: id.boxPublic }), files }) });
    assert.equal(r.status, 200);
  }
  return { h, base, ids, close: () => { h.server.closeAllConnections?.(); h.server.close(); } };
}
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

test("live: no battle ever, then a night: the homepage block from real data in every arm; embed mode of the map", async () => {
  const { h, base, ids, close } = await hubWith(["rae", "sam"]);
  try {
    let page = await (await fetch(base + "/", { headers: { "user-agent": UA } })).text();
    assert.equal(section(page), null, "no battle ever: no block"); assert.ok(page.includes('id="how-battles-work"') && !page.includes("<!--home-battle-->"));
    const S = h.admin.battle.store, n = B.lastNight(Date.now()), t = B.battleAt(n);
    const shot = (k, a, d, f, u, held = 0) => ({ k, a: ids[a]?.id || a, d: ids[d].id, w: "rocket", ammo: 1, roll: 0, f, lot: 0, t: t + k * 1000, aim: 0, blocked: 0, x: { u, fu: 0, fi: 0, sp: 0, held } });
    S.saveNight(n - 1, { night: "x", fighters: [] }, [shot(1, "sam", "rae", .1, 1e6)], t - DAY);
    S.saveNight(n, { night: "x", fighters: [{ id: ids.rae.id }, { id: ids.sam.id }] }, [shot(1, "rae", "sam", .3, 7e6, 1e6), shot(2, "rae", "sam", 0, 0, 2e6), shot(3, "sam", "rae", .2, 2e6), shot(4, B.RAIDERS, "rae", .2, 3e6)], t);
    const blocks = new Set();
    for (let i = 0; i < 12; i++) {
      page = await (await fetch(base + "/", { headers: { "user-agent": UA + " v" + i } })).text();
      const s = section(page); assert.ok(s, "the block renders"); blocks.add(s.replace(/data-next="\d+"|Next battle in <b>[^<]*<\/b>|aria-label="Next battle in [^"]*"/g, ""));
    }
    assert.equal(blocks.size, 1, "the same block in every arm");
    const s = [...blocks][0];
    assert.match(s, /<h2 id="ln-h">@rae won the night\.<\/h2>/);
    assert.match(s, /2 cities fought\. 3 missiles hit\. \$12M of damage, rebuilt by noon\./);
    assert.match(s, new RegExp(`card/${new Date(n * DAY).toISOString().slice(0, 10)}\\.png`));
    assert.match(s, /@rae<small>1 of 2 missiles hit<\/small><\/span><span class="v">\$7M<\/span>/);
    assert.match(s, /@sam<span class="ln-tag">City down<\/span><small>1 hit, shield held \$3M<\/small><\/span><span class="v d">\$7M<\/span>/, "most damage taken falls");
    assert.match(s, /@rae<small>2 hits, shield held \$0<\/small><\/span><span class="v d">\$5M<\/span>/, "raiders' hits count on the defender");
    assert.match(s, /<span>Season \d+, week \d+<\/span>/); assert.match(s, /href="\/@rae\/"><span class="rk">1<\/span><span class="ln-mv" aria-label="new">new<\/span>/, "new on the board this night");
    assert.match(s, /Put your city in tonight's battle/);

    // the embed: only the map, framed by our own pages, sandboxed, no header, no sign-up gate
    const r = await fetch(base + "/world?view=battle&embed=1&replay=1", { headers: { "user-agent": UA } }), e = await r.text();
    assert.equal(r.status, 200); assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN"); assert.equal(r.headers.get("x-robots-tag"), "noindex");
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'self'; sandbox allow-scripts allow-same-origin/);
    assert.match(e, /<html lang="en" class="w-embed">/); assert.ok(e.includes("window.CALDERA_EMBED=1") && e.includes("html.w-embed .c-stage>:not(canvas){display:none!important}"));
    assert.ok(!e.includes('<header class="nav"'), "no site header"); assert.ok(e.includes("caldera-strike") && e.includes("caldera-end"), "the frame posts strikes and the end");
    const w = await fetch(base + "/world", { headers: { "user-agent": UA } }), wt = await w.text();
    assert.equal(w.headers.get("x-frame-options"), "DENY"); assert.match(w.headers.get("content-security-policy"), /frame-ancestors 'none'$/); assert.ok(!wt.includes("w-embed\""), "the normal map is unchanged");
  } finally { close(); }
});
