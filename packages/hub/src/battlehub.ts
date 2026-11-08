/**
 * The battles, wired into the hub on top of the growth simulation (growthhub.ts): it rides the growth tick (no timer of its
 * own), reads the simulation's state and the event log, and keeps its own tables (battle.ts). Routes:
 *   GET  /v1/world/battle            the Battle view's public state (opted-in cities only; everyone else is a peaceful zone)
 *   GET  /v1/world/battle/me         the signed-in member: opt-in, shield, tonight's arsenal, rivals, last night's replay
 *   POST /v1/world/battle/opt        {war: true|false, waive?: bool}   join or leave (leaving rebuilds instantly)
 *   POST /v1/world/battle/aim        {target: "@h", off?: true}        manual fire, at most 3 shots tonight (optional bonus)
 *   POST /v1/world/battle/report     {freq: "daily"|"weekly"|"off"}    the battle-report email
 *   GET|POST /u/battle?t=            one-click unsubscribe (RFC 8058 POST from the List-Unsubscribe header)
 * Kill switches (in /opt/caldera-hub/.notify.env, then pm2 restart): CALDERA_BATTLE=0 turns battles off (no view, no nights);
 * the report email only sends with CALDERA_BATTLE_EMAIL=1 (off until Mike approves sending).
 */
import crypto from "node:crypto";
import type http from "node:http";
import { DAY, dayOf, dayKey, type GEvent, type SimOut } from "./growth";
import { WAR, RAIDERS, battleAt, lastNight, arsenal, shield, isBeginner, resolveNight, remaining, season, scoreOf, reportFor, mvpOf, battleEmail, worldLines, battleStore, targetable,
  type Fighter, type Shot, type Report, type ReportFreq } from "./battle";
import type { GrowthMember } from "./growthhub";

type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export interface BattleMail { to: string; subject: string; html: string; text: string; headers?: Record<string, string>; src?: string; kind?: string }
export interface BattleHubCtx {
  q: Q; hub: string; postal: string;
  growth: { sim: () => { sims: Map<string, SimOut>; events: GEvent[]; ai: Map<string, Map<string, number>> }; onTick: (fn: () => void | Promise<void>) => void };
  members: () => GrowthMember[];
  memberOf: (req: http.IncomingMessage) => string | null; sameOrigin: (req: http.IncomingMessage) => boolean; readBody: (req: http.IncomingMessage) => Promise<any>;
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  /** the HTML page shell the hub uses for its email landing pages */ page: (title: string, inner: string) => string;
  /** a member's confirmed, unsuppressed address (null: no address we may use) */ emailOf: (profileId: string) => string | null;
  send: (m: BattleMail) => Promise<unknown>;
  /** CALDERA_BATTLE_EMAIL=1: the report email may actually go out */ emailOn: () => boolean;
  /** team size, for per-capita strength and scoring (1 for a person) */ heads?: (profileId: string) => number;
  now?: () => number;
}

export function battleHub(c: BattleHubCtx) {
  const S = battleStore(c.q, () => crypto.randomBytes(18).toString("base64url"));
  const now = () => (c.now ? c.now() : Date.now());
  const heads = (id: string) => Math.max(1, c.heads ? c.heads(id) || 1 : 1);
  if (!S.meta("launch")) S.setMeta("launch", String(lastNight(now())));
  const launch = () => Number(S.meta("launch")) || lastNight(now());
  let cache: { at: number; v: any } | null = null;

  // ---------------------------------------------------------------- inputs from the growth simulation
  function ctxFor() {
    const { sims, events, ai } = c.growth.sim();
    const ms = c.members(), byId = new Map(ms.map(m => [m.id, m] as [string, GrowthMember])), evBy = new Map<string, GEvent[]>();
    const reverted = new Set<string>(); for (const e of events) if (e.x?.rv) reverted.add(e.x.rv.slice(0, 7));
    for (const e of events) { if (!evBy.has(e.p)) evBy.set(e.p, []); evBy.get(e.p)!.push(e); }
    const handle = (id: string) => id === RAIDERS ? "raiders from the sea" : "@" + (byId.get(id)?.handle || "someone");
    const pts = (id: string) => { const sim = sims.get(id); const m = new Map((sim?.stats || []).map(s => [s.d, s.pts] as [number, number])); return (d: number) => m.get(d) || 0; };
    return { sims, events, ai, ms, byId, evBy, reverted, handle, pts };
  }
  type Ctx = ReturnType<typeof ctxFor>;
  function snapOf(sim: SimOut, day: number) { return sim.snaps.get(day) || sim.snaps.get(day - 1) || { side: sim.side, lots: sim.lots, streak: sim.streak, tier: sim.tier, idle: sim.idle, bank: sim.bank }; }
  function fighterOf(x: Ctx, m: GrowthMember, day: number, waive: boolean): Fighter | null {
    const sim = x.sims.get(m.id); if (!sim) return null;
    const sn = snapOf(sim, day), active = sim.stats.filter(s => s.d <= day && s.pts > 0).length;
    const ars = arsenal(x.evBy.get(m.id) || [], day, { ai: x.ai.get(m.id), streak: sn.streak, lots: sn.lots, reverted: x.reverted });
    const o = { streak: sn.streak, joinedDays: day + 1 - dayOf(m.created || now()), activeDays: active, waived: waive };
    return { id: m.id, h: m.handle, ars, sh: shield(o), beg: isBeginner(o), lots: sn.lots, side: sn.side, out7: sim.stats.filter(s => s.d > day - 7 && s.d <= day).reduce((t, s) => t + s.pts, 0), heads: heads(m.id), idle: sn.idle };
  }
  /** damage still showing per defender and lot at a time, from the last 4 nights (only for members still opted in) */
  function openDamage(x: Ctx, at: number, warOn: Set<string>): Map<string, Map<number, number>> {
    const out = new Map<string, Map<number, number>>(), n = lastNight(at - 1);
    for (const s of S.shots(n - 4, n)) {
      if (s.f <= 0 || s.lot < 0 || !warOn.has(s.d) || s.t > at) continue;
      const r = remaining(s.f, s.t, at, x.pts(s.d)); if (r <= 0.005) continue;
      const m = out.get(s.d) || new Map<number, number>(); out.set(s.d, m); m.set(s.lot, (m.get(s.lot) || 0) + r);
    }
    return out;
  }
  const warSet = (at: number) => new Set(S.opts().filter(o => o.war && o.since < at).map(o => o.p));

  // ---------------------------------------------------------------- the night
  function resolve(night: number, o: { force?: boolean } = {}) {
    if (S.hasNight(night) && !o.force) return S.night(night);
    const x = ctxFor(), T = battleAt(night), on = warSet(T), opts = new Map(S.opts().map(r => [r.p, r] as [string, any]));
    const fighters = x.ms.filter(m => on.has(m.id)).map(m => fighterOf(x, m, night - 1, !!opts.get(m.id)?.waive)).filter((f): f is Fighter => !!f);
    const prev = S.shots(night - 1), lastPairs = new Set(prev.filter(s => s.f > 0).map(s => s.a + ">" + s.d));
    const week = new Map<string, number>(); for (const s of S.shots(night - 6, night - 1)) if (s.f > 0) week.set(s.d, (week.get(s.d) || 0) + s.f);
    const r = resolveNight({ night, fighters, lastPairs, week, aims: S.aims(night), open: openDamage(x, T, on) });
    const meta = { night: dayKey(night), at: T, raiders: r.raiders, fighters: fighters.map(f => ({ id: f.id, h: f.h, ammo: f.ars.ammo, shots: f.ars.shots.length, best: f.ars.best, sh: f.sh, beg: f.beg ? 1 : 0, c: f.ars.c, pr: f.ars.pr, rel: f.ars.rel, ai: f.ars.aiX, st: f.ars.streakX })) };
    S.saveNight(night, meta, r.shots, now());
    S.prune(night - 120); cache = null;
    console.log(`[battle] night ${dayKey(night)}: ${fighters.length} cities, ${r.shots.length} shots, ${r.shots.filter(s => s.f > 0).length} landed, raiders ${r.raiders.length}`);
    return meta;
  }
  /** on each growth tick: resolve the night once its time has passed (a hub that was down more than 20 hours skips it: no
   *  retroactive damage), then the report email when it's on and past 9am Pacific */
  async function tick() {
    const n = lastNight(now());
    if (!S.hasNight(n) && now() - battleAt(n) < 20 * 3600_000) { try { resolve(n); } catch (e: any) { console.error("[battle] resolve", e?.message); } }
    if (c.emailOn() && now() >= battleAt(n) + 7 * 3600_000) { try { await sendReports(); } catch (e: any) { console.error("[battle] email", e?.message); } }
  }
  c.growth.onTick(tick);

  // ---------------------------------------------------------------- the public state for the Battle view
  function state() {
    if (cache && now() - cache.at < 60_000) return cache.v;
    const x = ctxFor(), at = now(), n = lastNight(at), on = warSet(Infinity), opts = new Map(S.opts().map(r => [r.p, r] as [string, any])), today = dayOf(at);
    const open = new Map<string, [number, number, number, number, string][]>();
    for (const s of S.shots(n - 4, n)) {
      if (s.f <= 0 || s.lot < 0 || !on.has(s.d)) continue;   // opting out rebuilds instantly
      const r = remaining(s.f, s.t, at, x.pts(s.d)); if (r <= 0.005) continue;
      const h = "@" + (x.byId.get(s.d)?.handle || ""); if (!open.has(h)) open.set(h, []);
      open.get(h)!.push([s.lot, Math.round(r * 100) / 100, s.f, s.t, x.handle(s.a)]);
    }
    const members: Record<string, any> = {};
    for (const m of x.ms) {
      if (!on.has(m.id)) continue;
      const f = fighterOf(x, m, today, !!opts.get(m.id)?.waive); if (!f) continue;
      const h = "@" + m.handle, last = S.shots(n).filter(s => s.d === m.id && s.f > 0), taken = last.reduce((t, s) => t + s.f, 0), left = last.reduce((t, s) => t + remaining(s.f, s.t, at, x.pts(m.id)), 0);
      members[h] = { sh: f.sh, beg: f.beg ? 1 : 0, ammo: f.ars.ammo, best: f.ars.best, shots: f.ars.shots.length, hits: open.get(h) || [], reb: taken > 0 ? Math.round(100 * (1 - left / taken)) : 100, tgt: targetable(f) ? 1 : 0 };
    }
    const row = (s: any) => [x.handle(s.a), x.handle(s.d), s.w, s.f, s.t, s.lot, s.blocked, s.aim], shots = S.shots(n).map(row), prevShots = S.shots(n - 1).filter(s => s.night === n - 1).map(row);
    const se = season(n, launch()), sc = scoreOf(S.shots(se.from, n), heads);
    const board = [...sc.entries()].filter(([id]) => on.has(id)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([id, v]) => [x.handle(id), v]);
    // the renderer fires the night resolved before each local noon from 12:00 to 24:00 and repairs it the next morning, so it also needs the night before (citybattle.ts)
    const v = { at: new Date(at).toISOString(), night: dayKey(n), t0: battleAt(n), next: battleAt(n + 1), prev: { night: dayKey(n - 1), t0: battleAt(n - 1), shots: prevShots }, season: { n: se.n, week: se.week }, members, shots, board, raiders: (S.night(n)?.raiders || []).map((id: string) => x.handle(id)), cities: Object.keys(members).length };
    cache = { at, v }; return v;
  }

  // ---------------------------------------------------------------- one member
  function reportOf(x: Ctx, m: GrowthMember, night: number): Report {
    const sim = x.sims.get(m.id), day = night - 1, sn = sim ? snapOf(sim, dayOf(now())) : null, opt = S.opt(m.id), peace = !(opt?.war && opt.since < battleAt(night));
    const st = sim?.stats.find(s => s.d === day), f = fighterOf(x, m, dayOf(now()), !!opt?.waive);
    const meta = S.night(night)?.fighters?.find((y: any) => y.id === m.id);
    return reportFor(m.id, m.handle, peace ? [] : S.shots(night), { night, now: now(), peace, pts: x.pts(m.id), handle: x.handle, mvp: mvpOf(x.evBy.get(m.id) || [], day),
      shield: f?.sh ?? 0, streak: sn?.streak || 0, built: st ? st.top : 0, ammo: meta?.ammo || 0 });
  }
  function me(id: string) {
    const x = ctxFor(), m = x.byId.get(id); if (!m) return null;
    const opt = S.ensure(id), n = lastNight(now()), today = dayOf(now()), f = fighterOf(x, m, today, !!opt.waive);
    const on = warSet(Infinity), rivals = x.ms.filter(o => o.id !== id && on.has(o.id)).map(o => fighterOf(x, o, today, !!S.opt(o.id)?.waive)).filter((y): y is Fighter => !!y && targetable(y))
      .sort((a, b) => Math.abs(a.side - (f?.side || 2)) - Math.abs(b.side - (f?.side || 2)) || a.h.localeCompare(b.h)).slice(0, 12).map(y => ({ h: "@" + y.h, sh: y.sh, beg: y.beg ? 1 : 0 }));
    const nights = S.night(n) ? reportOf(x, m, n) : null;
    return { h: "@" + m.handle, war: opt.war, waive: opt.waive, report: opt.report, email: !!c.emailOf(id), emailLive: c.emailOn(),
      arsenal: f ? { ammo: f.ars.ammo, c: f.ars.c, pr: f.ars.pr, rel: f.ars.rel, ci: f.ars.ci, ai: f.ars.aiX, streak: f.ars.streakX, best: f.ars.best, shots: f.ars.shots.length } : null,
      shield: f?.sh ?? 0, beginner: f?.beg ? 1 : 0, next: battleAt(n + 1), aims: S.aimsOf(n + 1, id).map(t => x.handle(t)), aimCap: WAR.manualCap, rivals, last: nights };
  }
  function weekNote(x: Ctx, m: GrowthMember, n: number): string {
    const sh = S.shots(n - 6, n), took = sh.filter(s => s.d === m.id).reduce((t, s) => t + s.f, 0), dealt = sh.filter(s => s.a === m.id).reduce((t, s) => t + s.f, 0);
    const built = (x.sims.get(m.id)?.stats || []).filter(s => s.d >= n - 7 && s.d < n).reduce((t, s) => t + s.top, 0);
    return `This week: ${built} lot${built === 1 ? "" : "s"} built, ${Math.round(dealt * 10) / 10} facades dealt, ${Math.round(took * 10) / 10} taken (all rebuilt on their own).`;
  }

  // ---------------------------------------------------------------- the battle-report email (opt-in; sends only with CALDERA_BATTLE_EMAIL=1)
  const unsubUrl = (t: string) => `${c.hub.replace(/\/$/, "")}/u/battle?t=${t}`;
  function compose(x: Ctx, m: GrowthMember, night: number, weekly: boolean) {
    const r = reportOf(x, m, night), opt = S.ensure(m.id), shots = S.shots(night), on = warSet(Infinity);
    const built = x.ms.map(o => [x.handle(o.id), x.sims.get(o.id)?.stats.find(s => s.d === night - 1)?.top || 0] as [string, number]).filter(y => y[1] > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const reb = x.ms.filter(o => on.has(o.id)).map(o => { const mine = shots.filter(s => s.d === o.id && s.f > 0), t = mine.reduce((a, s) => a + s.f, 0), l = mine.reduce((a, s) => a + remaining(s.f, s.t, now(), x.pts(o.id)), 0);
      return [x.handle(o.id), t > 0 ? Math.round(100 * (1 - l / t)) : -1] as [string, number]; }).filter(y => y[1] >= 0).sort((a, b) => b[1] - a[1]);
    const pairsByNight = [1, 2, 3, 4, 5, 6].map(k => new Set(S.shots(night - k).filter(s => s.a !== RAIDERS && s.d !== RAIDERS).map(s => [s.a, s.d].sort().join("|"))));
    const se = season(night, launch()), w = worldLines(shots, { handle: x.handle, built, rebuilt: reb, pairsByNight, season: se });
    const mail = battleEmail(r, w, { name: m.name, hub: c.hub, unsub: unsubUrl(opt.token), postal: c.postal, weekly });
    if (weekly) mail.text = mail.text.replace("\n\nYOUR CITY\n", `\n\n${weekNote(x, m, night)}\n\nYOUR CITY\n`);
    const quiet = !r.raids.length && !r.fired && !r.built;
    return { r, mail, quiet };
  }
  /** One pass: every member with the report on gets last night's report once (weekly: on Mondays, Pacific). dry: compose only. */
  async function sendReports(o: { dry?: boolean; only?: string; force?: boolean } = {}) {
    const n = lastNight(now()), x = ctxFor(), day = dayKey(n), monday = new Date(now() - 8 * 3600_000).getUTCDay() === 1, out: any[] = [];
    if (!S.hasNight(n)) return { sent: 0, out: [{ skip: "no battle yet tonight" }] };
    for (const opt of S.opts()) {
      if (opt.report === "off" || (o.only && opt.p !== o.only)) continue;
      if (!o.force && opt.sent === day) continue;
      if (opt.report === "weekly" && !monday && !o.force) continue;
      const m = x.byId.get(opt.p); if (!m) continue;
      const to = c.emailOf(opt.p); if (!to) { out.push({ h: m.handle, skip: "no confirmed email" }); continue; }
      const { mail, quiet } = compose(x, m, n, opt.report === "weekly");
      if (quiet && opt.report === "daily" && !o.force) { out.push({ h: m.handle, skip: "nothing to report" }); continue; }
      if (o.dry || !c.emailOn()) { out.push({ h: m.handle, dry: true, subject: mail.subject, text: mail.text }); continue; }
      const un = unsubUrl(opt.token);
      const ok = await c.send({ to, subject: mail.subject, html: mail.html, text: mail.text, src: "battle-report", kind: "daily", headers: { "List-Unsubscribe": `<${un}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }).catch((e: any) => { console.error("[battle] send", e?.message); return false; });
      if (ok !== false) { S.markSent(opt.p, day); out.push({ h: m.handle, sent: true, subject: mail.subject }); } else out.push({ h: m.handle, blocked: true });
    }
    return { sent: out.filter(y => y.sent).length, out };
  }

  // ---------------------------------------------------------------- routes
  async function route(req: http.IncomingMessage, res: http.ServerResponse, p: string, url: URL): Promise<boolean> {
    if (req.method === "GET" && p === "/v1/world/battle") { res.setHeader("cache-control", "public, max-age=60"); c.json(res, 200, state()); return true; }
    if (p === "/u/battle" && (req.method === "GET" || req.method === "POST")) {
      const t = (url.searchParams.get("t") || "").replace(/[^\w-]/g, "");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      if (req.method === "GET") { res.end(c.page("Stop battle reports", `<form method="post" action="/u/battle?t=${t}"><p>Stop sending Caldera battle reports to this address. Your city stays in the battles; you can leave them from the World's Battle view.</p><button type="submit" style="font:600 15px/1 sans-serif;padding:12px 18px;border-radius:999px;border:0;background:#6E4FE0;color:#fff;cursor:pointer">Unsubscribe</button></form>`)); return true; }
      const row = t ? S.byToken(t) : null; if (row) S.setReport(row.p, "off");   // idempotent; also the RFC 8058 one-click POST
      res.end(c.page("You're unsubscribed", "<p>No more battle reports. You can turn them back on any time from the World's Battle view.</p>")); return true;
    }
    if (!p.startsWith("/v1/world/battle/")) return false;
    const id = c.memberOf(req);
    if (req.method === "GET" && p === "/v1/world/battle/me") { res.setHeader("cache-control", "private, no-store"); c.json(res, 200, id ? me(id) : { h: null }); return true; }
    if (req.method !== "POST") return false;
    if (!c.sameOrigin(req)) { c.json(res, 403, { error: "cross-site request refused" }); return true; }
    if (!id) { c.json(res, 401, { error: "sign in first" }); return true; }
    let b: any = {}; try { b = await c.readBody(req); } catch { c.json(res, 400, { error: "bad body" }); return true; }
    if (p === "/v1/world/battle/opt") {
      if (typeof b.war === "boolean") S.setWar(id, b.war, now());
      if (typeof b.waive === "boolean") S.setWaive(id, b.waive);
      cache = null; c.json(res, 200, me(id)); return true;
    }
    if (p === "/v1/world/battle/aim") {
      const opt = S.opt(id); if (!opt?.war) { c.json(res, 409, { error: "join the battles first" }); return true; }
      const x = ctxFor(), h = String(b.target || "").replace(/^@/, "").toLowerCase(), t = x.ms.find(m => m.handle.toLowerCase() === h);
      const night = lastNight(now()) + 1;
      if (!t || t.id === id || !S.opt(t.id)?.war) { c.json(res, 400, { error: "that city isn't in the battles" }); return true; }
      if (b.off) S.unaim(night, id, t.id);
      else { if (S.aimsOf(night, id).length >= WAR.manualCap) { c.json(res, 409, { error: `you've aimed all ${WAR.manualCap} shots for tonight` }); return true; } S.aim(night, id, t.id, now()); }
      c.json(res, 200, me(id)); return true;
    }
    if (p === "/v1/world/battle/report") {
      const f = String(b.freq || "") as ReportFreq; if (!["daily", "weekly", "off"].includes(f)) { c.json(res, 400, { error: "freq must be daily, weekly or off" }); return true; }
      if (f !== "off" && !c.emailOf(id)) { c.json(res, 409, { error: "confirm an email first", url: "/settings" }); return true; }
      S.setReport(id, f); c.json(res, 200, me(id)); return true;
    }
    return false;
  }
  return { route, tick, resolve, state, me, sendReports, store: S, erase: (id: string) => { S.erase(id); cache = null; },
    /** operator: opt a member in; since (ms) backdates it so a seed night can include them */
    optIn: (id: string, o: { waive?: boolean; since?: number } = {}) => { S.setWar(id, true, o.since ?? now()); if (o.waive !== undefined) S.setWaive(id, o.waive); cache = null; } };
}
