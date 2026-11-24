/**
 * The battles, wired into the hub on top of the growth simulation (growthhub.ts): it rides the growth tick (no timer of its
 * own), reads the simulation's state and the event log, and keeps its own tables (battle.ts). Routes:
 *   GET  /v1/world/battle            the Battle view's public state (every city is in the battles unless it opted out: Mike 11-08, "this is a battle between cities")
 *   GET  /v1/world/battle/me         the signed-in member: opt-in, shield, tonight's arsenal, rivals, last night's replay
 *   POST /v1/world/battle/opt        {war: true|false, waive?: bool}   join or leave (leaving rebuilds instantly)
 *   POST /v1/world/battle/aim        {target: "@h", off?: true}        manual fire, at most 3 shots tonight (optional bonus)
 *   POST /v1/world/battle/report     {freq: "daily"|"weekly"|"off"}    the battle-report email
 *   GET|POST /u/battle?t=            one-click unsubscribe (RFC 8058 POST from the List-Unsubscribe header)
 * Kill switches (in the hub's environment, then restart it): CALDERA_BATTLE=0 turns battles off (no view, no nights);
 * the report email only sends with CALDERA_BATTLE_EMAIL=1 (off until Mike approves sending).
 */
import crypto from "node:crypto";
import type http from "node:http";
import { DAY, dayOf, dayKey, type GEvent, type SimOut } from "./growth";
import { WAR, RAIDERS, battleAt, lastNight, arsenal, shield, towersOf, dmgAt, dmgAll, usdOf, fallenOf, heldOf, restrike, fmtUsd, summaryNames, scaledDistance, isBeginner, resolveNight, remaining, season, scoreOf, reportFor, mvpOf, battleEmail, battleSummary, worldLines, battleStore, targetable,
  type Fighter, type Shot, type Report, type ReportFreq } from "./battle";
import type { GrowthMember } from "./growthhub";
import { giftMail } from "./giftmail";
import { ARMORY, bombOf, armoryNow, armoryStore, armoryPrefs, alertDue, alertText, armoryEmail, checkWord, cleanTz, clockIn, openAlertAt, remindAt, type BombKind } from "./armory";

type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export interface BattleMail { to: string; subject: string; html: string; text: string; headers?: Record<string, string>; src?: string; kind?: string }
export interface BattleHubCtx {
  q: Q; hub: string; postal: string;
  growth: { sim: () => { sims: Map<string, SimOut>; events: GEvent[]; ai: Map<string, Map<string, number>> }; onTick: (fn: () => void | Promise<void>) => void;
    /** the farm recount reads the event log and AI map directly */ store?: { events: (since?: number) => GEvent[]; ai: () => Map<string, Map<string, number>> } };
  members: () => GrowthMember[];
  memberOf: (req: http.IncomingMessage) => string | null; sameOrigin: (req: http.IncomingMessage) => boolean; readBody: (req: http.IncomingMessage) => Promise<any>;
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  /** the HTML page shell the hub uses for its email landing pages */ page: (title: string, inner: string) => string;
  /** a member's confirmed, unsuppressed address (null: no address we may use) */ emailOf: (profileId: string) => string | null;
  send: (m: BattleMail) => Promise<unknown>;
  /** CALDERA_BATTLE_EMAIL=1: the report email may actually go out */ emailOn: () => boolean;
  /** the feed's system voice (sysposts.ts): idempotent by key; absent until the feed plumbing is wired */ systemPost?: (key: string, text: string, links?: string[]) => { posted: boolean; id?: string };
  /** team size, for per-capita strength and scoring (1 for a person) */ heads?: (profileId: string) => number;
  /** a personal bell alert (alerts.ts); `key` folds repeats into one row */ alertPost?: (o: { target: string; key: string; title: string; body: string; ctaLabel?: string; ctaUrl?: string; by?: string }) => void;
  /** the one-click unsubscribe-from-all link for a member */ unsubAll?: (profileId: string) => string | null;
  /** CALDERA_ARMORY_EMAIL=1: the once-a-day "Armory open" email may go out (off until Mike approves sending) */ armoryEmailOn?: () => boolean;
  /** Frontier lands (frontier.ts) on the map now: Armory bombs can aim at them */ lands?: () => { login: string; repos: any[] }[];
  /** the feed post id written for a sysposts key ("battle:<day>"), for the gift email's summary link */ sysPosted?: (key: string) => string | null;
  /** SVG -> PNG (cards.ts toPng), for the bomb images in the gift email */ png?: (svg: string, width: number) => Promise<Buffer>;
  /** a member's public avatar path on the hub ("/@h/avatar.png"), or null: the battle deck shows it next to their name (Mike 11-20) */ avatar?: (profileId: string) => string | null;
  /** after a night is saved (Caldera Points, points.ts awardNight): the night, its shots, and an earlier night's stored shots */ onNight?: (night: number, shots: Shot[], prior: (n: number) => Shot[]) => void;
  now?: () => number;
}

export function battleHub(c: BattleHubCtx) {
  const S = battleStore(c.q, () => crypto.randomBytes(18).toString("base64url"));
  const now = () => (c.now ? c.now() : Date.now());
  const heads = (id: string) => Math.max(1, c.heads ? c.heads(id) || 1 : 1);
  if (!S.meta("launch")) S.setMeta("launch", String(lastNight(now())));
  const launch = () => Number(S.meta("launch")) || lastNight(now());
  let cache: { at: number; v: any } | null = null;
  const A = armoryStore(c.q), PR = armoryPrefs(c.q, () => crypto.randomBytes(18).toString("base64url"));
  const idem = new Map<string, { at: number; v: any }>();   // Buy taps by idempotency key (10 minutes)
  // the Armory gift emails (giftmail.ts): a bomb aimed at a member's city tells them; the summary names them the next day
  const G = giftMail({ q: c.q, hub: c.hub, now: () => now(), postal: c.postal, A, battleAt, ran: n => S.hasNight(n),
    summary: n => { const id = c.sysPosted?.("battle:" + dayKey(n)); if (!id) return null; const s = summaryNames(S.shots(n));
      return { postId: id, top: s.top, hit: s.hit.map(([k, h]) => [k, { f: h.f, towers: h.towers.size }] as [string, { f: number; towers: number }]) }; },
    emailOf: id => c.emailOf(id), prefs: id => { const p = PR.ensure(id); return { tz: p.tz, mail: !!p.mail, token: p.token }; },
    mailOn: () => !!c.armoryEmailOn?.(), handle: id => ctxFor().handle(id), nameOf: id => { const m = ctxFor().byId.get(id); return String(m?.name || m?.handle || ""); },
    send: m => c.send(m), unsubAll: id => c.unsubAll?.(id) || null, fmtUsd, png: c.png });

  // ---------------------------------------------------------------- inputs from the growth simulation
  function ctxFor() {
    const { sims, events, ai } = c.growth.sim();
    const ms = c.members(), byId = new Map(ms.map(m => [m.id, m] as [string, GrowthMember])), evBy = new Map<string, GEvent[]>();
    const reverted = new Set<string>(); for (const e of events) if (e.x?.rv) reverted.add(e.x.rv.slice(0, 7));
    for (const e of events) { if (!evBy.has(e.p)) evBy.set(e.p, []); evBy.get(e.p)!.push(e); }
    const handle = (id: string) => id === RAIDERS ? "raiders from the sea" : id.startsWith("uc:") ? "@" + id.slice(3) : "@" + (byId.get(id)?.handle || "someone");
    const pts = (id: string) => { const sim = sims.get(id); const m = new Map((sim?.stats || []).map(s => [s.d, s.pts] as [number, number])); return (d: number) => m.get(d) || 0; };
    return { sims, events, ai, ms, byId, evBy, reverted, handle, pts };
  }
  type Ctx = ReturnType<typeof ctxFor>;
  /** Frontier lands as targets only: no arsenal, no shield, never idle; damage is for show (frontier-design F8) */
  function landsNow(): Fighter[] {
    let L: { login: string; repos: any[] }[] = []; try { L = c.lands ? c.lands() : []; } catch (e: any) { console.error("[battle] lands", e?.message); }
    return L.map(l => { const tw = towersOf(l.repos || []);
      return { id: "uc:" + l.login, h: l.login, ars: { shots: [], usd: 0, ammo: 0, n: 0, cepX: 1, reach: 0 } as any, sh: 0, beg: false, lots: "", towers: tw.length, tw, side: 0, out7: 0, heads: 1, idle: null } as Fighter; });
  }
  function snapOf(sim: SimOut, day: number) { return sim.snaps.get(day) || sim.snaps.get(day - 1) || { side: sim.side, lots: sim.lots, streak: sim.streak, tier: sim.tier, idle: sim.idle, bank: sim.bank }; }
  function fighterOf(x: Ctx, m: GrowthMember, day: number, waive: boolean): Fighter | null {
    const sim = x.sims.get(m.id); if (!sim) return null;
    const sn = snapOf(sim, day), active = sim.stats.filter(s => s.d <= day && s.pts > 0).length;
    const tw = towersOf((m.city?.districts || []).flatMap((d: any) => d.repos || []));   // repo towers on the world map, tallest first: the only targets
    const ars = arsenal(x.evBy.get(m.id) || [], day, { ai: x.ai.get(m.id), streak: sn.streak, lots: sn.lots, reverted: x.reverted, top: tw[0] });
    const o = { streak: sn.streak, joinedDays: day + 1 - dayOf(m.created || now()), activeDays: active, waived: waive };
    return { id: m.id, h: m.handle, ars, sh: shield(o), beg: isBeginner(o), lots: sn.lots, towers: tw.length, tw, side: sn.side, out7: sim.stats.filter(s => s.d > day - 7 && s.d <= day).reduce((t, s) => t + s.pts, 0), heads: heads(m.id), idle: sn.idle };
  }
  /** damage still showing per defender and lot at a time, from the last 4 nights (only for members still opted in) */
  function openDamage(x: Ctx, at: number, warOn: Set<string>): Map<string, Map<number, number>> {
    const out = new Map<string, Map<number, number>>(), n = lastNight(at - 1);
    for (const s of S.shots(n - 4, n)) {
      if (s.f <= 0 || s.lot < 0 || !warOn.has(s.d) || s.t > at) continue;
      const r = remaining(dmgAt(s, at), s.t, at, x.pts(s.d)); if (r <= 0.0005) continue;
      const m = out.get(s.d) || new Map<number, number>(); out.set(s.d, m); m.set(s.lot, (m.get(s.lot) || 0) + r);
    }
    return out;
  }
  /** the cities in the battles: every member, minus those who chose to leave (battle_opt.out). at: kept for the signature */
  const warSet = (at: number, x: Ctx = ctxFor()) => { const outs = new Set(S.opts().filter(o => o.out).map(o => o.p)); return new Set(x.ms.map(m => m.id).filter(id => !outs.has(id))); };

  // ---------------------------------------------------------------- the night
  /** dry: resolve the night with today's rules and return it without saving anything (operator check) */
  function resolve(night: number, o: { force?: boolean; dry?: boolean } = {}): any {
    if (S.hasNight(night) && !o.force && !o.dry) return S.night(night);
    const x = ctxFor(), T = battleAt(night), on = warSet(T, x), opts = new Map(S.opts().map(r => [r.p, r] as [string, any]));
    const fighters = x.ms.filter(m => on.has(m.id)).map(m => fighterOf(x, m, night - 1, !!opts.get(m.id)?.waive)).filter((f): f is Fighter => !!f);
    const prev = S.shots(night - 1), lastPairs = new Set(prev.filter(s => s.f > 0).map(s => s.a + ">" + s.d));
    const week = new Map<string, number>(); for (const s of S.shots(night - 6, night - 1)) if (s.f > 0) week.set(s.d, (week.get(s.d) || 0) + dmgAll(s));
    const bombs = A.live(night).filter(b => b.state === "paid").map(b => ({ id: b.id, a: b.p, w: bombOf(b.kind)!.w, k: b.kind, word: b.word, target: b.target }));
    const r = resolveNight({ night, fighters, lastPairs, week, aims: S.aims(night), open: openDamage(x, T, on), bombs, lands: landsNow() });
    const meta = { night: dayKey(night), at: T, raiders: r.raiders, fighters: fighters.map(f => ({ id: f.id, h: f.h, ammo: f.ars.ammo, usd: f.ars.usd, n: f.ars.n, tech: f.ars.tech, guide: f.ars.guide, shots: f.ars.shots.length, best: f.ars.best, sh: f.sh, beg: f.beg ? 1 : 0, c: f.ars.c, pr: f.ars.pr, rel: f.ars.rel, ai: f.ars.aiX, st: f.ars.streakX })) };
    if (o.dry) return { ...meta, dry: true, shots: r.shots.map(s => ({ a: x.handle(s.a), d: x.handle(s.d), w: s.w, f: s.f, usd: usdOf(s), held: heldOf(s), sh: s.x?.sh || 0 })) };
    S.saveNight(night, meta, r.shots, now());
    // the Armory: mark what flew, refund what could not, and pay the daily battle reward to every city that fired
    for (const f of r.fired) A.fired(f.id, f.k);
    for (const id of r.unfired) A.refund(id, "could not fire", now());
    for (const id of new Set(r.shots.map(s => s.a))) if (x.byId.has(id)) A.reward(id, night, now());
    try { c.onNight?.(night, r.shots, n => S.shots(n)); } catch (e: any) { console.error("[points] night", e?.message); }
    S.prune(night - 120); cache = null;
    console.log(`[battle] night ${dayKey(night)}: ${fighters.length} cities, ${r.shots.length} shots, ${r.shots.filter(s => s.f > 0).length} landed, ${fmtUsd(r.shots.reduce((t, s) => t + usdOf(s), 0))} damage, raiders ${r.raiders.length}`);
    return meta;
  }
  /** on each growth tick: resolve the night once its time has passed (a hub that was down more than 20 hours skips it: no
   *  retroactive damage), then the report email when it's on and past 9am Pacific */
  async function tick() {
    const n = lastNight(now());
    if (!S.hasNight(n) && now() - battleAt(n) < 20 * 3600_000) { try { resolve(n); } catch (e: any) { console.error("[battle] resolve", e?.message); } }
    // bombs of a night that will never run (the hub was down, or it is long past) get their credits back
    try { for (const b of A.stale(S.hasNight(n) || now() - battleAt(n) >= 20 * 3600_000 ? n : n - 1)) A.refund(b.id, "the night did not run", now()); } catch (e: any) { console.error("[armory] refund", e?.message); }
    try { await armoryAlerts(); } catch (e: any) { console.error("[armory] alerts", e?.message); }
    // 20:30 Pacific, after the day's salvo on the map (12:00 drop, 20:00 salvo, local): the report email and the feed summary
    if (now() >= battleAt(n) + 18.5 * 3600_000) {
      if (c.emailOn()) { try { await sendReports(); } catch (e: any) { console.error("[battle] email", e?.message); } }
      if (c.systemPost) { try { postSummary(); } catch (e: any) { console.error("[battle] summary", e?.message); } }
    }
    try { await G.tick(); } catch (e: any) { console.error("[gift] tick", e?.message); }   // gift email 2: the morning after, if the summary names them
  }
  c.growth.onTick(tick);

  // ---------------------------------------------------------------- the public state for the Battle view
  function state() {
    if (cache && now() - cache.at < 60_000) return cache.v;
    const x = ctxFor(), at = now(), n = lastNight(at), on = warSet(Infinity, x), opts = new Map(S.opts().map(r => [r.p, r] as [string, any])), today = dayOf(at);
    const open = new Map<string, [number, number, number, number, string][]>();
    for (const s of S.shots(n - 4, n)) {
      if (s.f <= 0 || s.lot < 0 || !on.has(s.d)) continue;   // opting out rebuilds instantly
      const r = remaining(dmgAt(s, at), s.t, at, x.pts(s.d)); if (r <= 0.0005) continue;
      const h = "@" + (x.byId.get(s.d)?.handle || ""); if (!open.has(h)) open.set(h, []);
      open.get(h)!.push([s.lot, Math.round(r * 1e4) / 1e4, s.f, s.t, x.handle(s.a)]);
    }
    const members: Record<string, any> = {};
    for (const m of x.ms) {
      if (!on.has(m.id)) continue;
      const f = fighterOf(x, m, today, !!opts.get(m.id)?.waive); if (!f) continue;
      const h = "@" + m.handle, last = S.shots(n).filter(s => s.d === m.id && s.f > 0), taken = last.reduce((t, s) => t + dmgAt(s, at), 0), left = last.reduce((t, s) => t + remaining(dmgAt(s, at), s.t, at, x.pts(m.id)), 0);
      // nx: the arsenal that fires at `next` while it is not today's (00:00 to 10:00 UTC: yesterday's), for the map's Armory yard
      const fy = at < battleAt(today) ? fighterOf(x, m, today - 1, !!opts.get(m.id)?.waive) : null;
      members[h] = { sh: f.sh, beg: f.beg ? 1 : 0, ammo: f.ars.ammo, usd: f.ars.usd, n: f.ars.n, ...(fy ? { nx: fy.ars.n } : {}), tech: f.ars.tech, guide: f.ars.guide, cep: f.ars.cepX, reach: f.ars.reach, best: f.ars.best, shots: f.ars.shots.length, hits: open.get(h) || [], reb: taken > 0 ? Math.round(100 * (1 - left / taken)) : 100, tgt: targetable(f) ? 1 : 0 };
    }
    const hid = A.hiddenIds([...S.shots(n), ...S.shots(n - 1)].map(s => s.x?.bid).filter((v): v is number => v != null));
    const xOut = (s: any) => s.x && s.x.bid != null && hid.has(s.x.bid) ? { ...s.x, word: (bombOf(s.x.bk)?.name || "").toUpperCase(), hid: 1 } : s.x || null;   // a hidden word shows as the bomb's name (armory-design B8)
    const row = (s: any) => [x.handle(s.a), x.handle(s.d), s.w, s.f, s.t, s.lot, s.blocked, s.aim, xOut(s)], shots = S.shots(n).map(row), prevShots = S.shots(n - 1).filter(s => s.night === n - 1).map(row);
    const se = season(n, launch()), fr = S.fair(), sc = scoreOf(S.shots(se.from, n), heads, (nn, id) => fr.get(nn + "|" + id) ?? 1), night = S.shots(n);
    // the rules, as numbers, for the page's "How damage works" sheet (one source: battle.ts WAR)
    const rules = { usd: WAR.usd, w: WAR.w, weapons: WAR.weapons, classes: WAR.classes.map(k => ({ k: k.k, name: k.name, kpa: k.kpa, sqm: k.sqm, load: k.load, z: Math.round(scaledDistance(k.kpa) * 100) / 100 })), fire: WAR.fire, guide: WAR.guide, soft: WAR.soft,
      light: WAR.light, floor: WAR.floor, dome: WAR.dome, half: WAR.half, footprint: WAR.footprint, floorM: WAR.floorM, relDays: WAR.relDays, reach: WAR.reach, reachMax: WAR.reachMax, autoRepair: WAR.autoRepair, repairPerPt: WAR.repairPerPt };
    const board = [...sc.entries()].filter(([id]) => on.has(id)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10).map(([id, v]) => [x.handle(id), v]);
    // the renderer fires the night resolved before each local noon from 12:00 to 24:00 and repairs it the next morning, so it also needs the night before (citybattle.ts)
    const fall = (ss: Shot[]) => { const f = fallenOf(ss); return f ? x.handle(f) : null; };   // the city that falls at the end of each night's replay (Mike 11-14)
    const v = { at: new Date(at).toISOString(), night: dayKey(n), t0: battleAt(n), next: battleAt(n + 1), fallen: fall(night), prev: { night: dayKey(n - 1), t0: battleAt(n - 1), shots: prevShots, fallen: fall(S.shots(n - 1)) }, season: { n: se.n, week: se.week }, members, shots, board, rules, usd: night.reduce((t, s) => t + usdOf(s), 0), held: night.reduce((t, s) => t + heldOf(s), 0), fires: night.filter(s => s.x?.sp).length, raiders: (S.night(n)?.raiders || []).map((id: string) => x.handle(id)), cities: Object.keys(members).length, people: peopleOf(x) };
    cache = { at, v }; return v;
  }

  /** every listed member by "@handle": their public avatar path, or "" (the deck draws an initial). Only listed members, only the
   *  avatar their public page already shows: a name in the deck links to /@handle/ only when it is a member (Mike 11-20) */
  function peopleOf(x: Ctx): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of x.ms) { let a: string | null = null; try { a = c.avatar ? c.avatar(m.id) : null; } catch { a = null; } out["@" + m.handle] = a && /^\/@[\w.-]+\/[^\s"'<>]+$/.test(a) ? a : ""; }
    return out;
  }
  // ---------------------------------------------------------------- one member
  function reportOf(x: Ctx, m: GrowthMember, night: number): Report {
    const sim = x.sims.get(m.id), day = night - 1, sn = sim ? snapOf(sim, dayOf(now())) : null, opt = S.opt(m.id), peace = !!opt?.out;
    const st = sim?.stats.find(s => s.d === day), f = fighterOf(x, m, dayOf(now()), !!opt?.waive);
    const meta = S.night(night)?.fighters?.find((y: any) => y.id === m.id);
    return reportFor(m.id, m.handle, peace ? [] : S.shots(night), { night, now: now(), peace, pts: x.pts(m.id), handle: x.handle, mvp: mvpOf(x.evBy.get(m.id) || [], day),
      shield: f?.sh ?? 0, streak: sn?.streak || 0, built: st ? st.top : 0, ammo: meta?.ammo || 0, usd: meta?.usd });
  }
  function me(id: string) {
    const x = ctxFor(), m = x.byId.get(id); if (!m) return null;
    const opt = S.ensure(id), n = lastNight(now()), today = dayOf(now()), f = fighterOf(x, m, today, !!opt.waive);
    const on = warSet(Infinity, x), rivals = x.ms.filter(o => o.id !== id && on.has(o.id)).map(o => fighterOf(x, o, today, !!S.opt(o.id)?.waive)).filter((y): y is Fighter => !!y && targetable(y))
      .sort((a, b) => Math.abs(a.side - (f?.side || 2)) - Math.abs(b.side - (f?.side || 2)) || a.h.localeCompare(b.h)).slice(0, 12).map(y => ({ h: "@" + y.h, sh: y.sh, beg: y.beg ? 1 : 0 }));
    const nights = S.night(n) ? reportOf(x, m, n) : null;
    return { h: "@" + m.handle, war: on.has(id) ? 1 : 0, waive: opt.waive, report: opt.report, email: !!c.emailOf(id), emailLive: c.emailOn(),
      arsenal: f ? { usd: f.ars.usd, n: f.ars.n, tech: f.ars.tech, why: f.ars.techWhy, guide: f.ars.guide, cep: f.ars.cepX, reach: f.ars.reach, left: f.ars.left, ammo: f.ars.ammo, c: f.ars.c, pr: f.ars.pr, rel: f.ars.rel, ci: f.ars.ci, ai: f.ars.aiX, streak: f.ars.streakX, best: f.ars.best, shots: f.ars.shots.length } : null,
      shield: f?.sh ?? 0, beginner: f?.beg ? 1 : 0, next: battleAt(n + 1), aims: S.aimsOf(n + 1, id).map(t => x.handle(t)), aimCap: WAR.manualCap, rivals, last: nights ? { ...nights, ...lastBombs(x, id, n) } : null,
      armory: on.has(id) ? armoryOf(x, id) : null };
  }
  /** the Armory panel's state for one member (armory-design A7) */
  function armoryOf(x: Ctx, id: string) {
    const w = armoryNow(now()), on = warSet(Infinity, x), pr = PR.ensure(id), n = lastNight(now());
    const targets = x.ms.filter(o => o.id !== id && on.has(o.id)).map(o => "@" + o.handle).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    return { opensAt: w.open, locksAt: w.lock, now: now(), night: w.night, balance: A.balance(id), cap: ARMORY.perNight, wordMax: ARMORY.wordMax,
      kinds: ARMORY.types.map(t => ({ k: t.k, name: t.name, cost: t.cost, line: t.line })),
      bought: A.of(w.night, id).filter(b => b.state !== "refunded").map(b => ({ id: b.id, k: b.kind, word: b.word, target: b.target ? x.handle(b.target) : null })),
      targets, lands: landsNow().filter(l => (l.towers || 0) > 0).map(l => "@" + l.h).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
      reward: A.rewarded(id, n), tz: pr.tz, alerts: { open: pr.open, remind: pr.remind } };
  }
  /** recap rows (armory-design C1): custom bombs that hit you last night, and how yours did */
  function lastBombs(x: Ctx, id: string, n: number) {
    const sh = S.shots(n).filter(s => s.x?.bk), hid = A.hiddenIds(sh.map(s => s.x!.bid!).filter(v => v != null));
    const word = (s: Shot) => hid.has(s.x!.bid!) ? (bombOf(s.x!.bk!)?.name || "").toUpperCase() : s.x!.word || "";
    const cost = (s: Shot) => bombOf(s.x!.bk!)?.cost || 0, hit = (s: Shot) => s.f > 0 && !s.blocked && !((s.x?.sh || 0) >= 1);
    const onMe = sh.filter(s => s.d === id).sort((a, b) => cost(b) - cost(a)), mine = sh.filter(s => s.a === id).sort((a, b) => cost(b) - cost(a)), top = mine.find(hit);
    return { bombs: onMe.map(s => ({ k: s.x!.bk!, word: word(s), from: x.handle(s.a), hit: hit(s) ? 1 : 0 })),
      mine: mine.length ? { n: mine.length, hit: mine.filter(hit).length, top: top ? { k: top.x!.bk!, word: word(top), on: x.handle(top.d) } : null } : null,
      reward: A.rewarded(id, n) };
  }
  /** "Armory open" alerts and the reminder, on the growth tick (about every 15 minutes) */
  async function armoryAlerts() {
    const x = ctxFor(), on = warSet(Infinity, x), at = now(), n = lastNight(at), mailOn = !!c.armoryEmailOn?.();
    if (!c.alertPost) return { sent: 0 };
    let sent = 0;
    for (const m of x.ms) {
      if (!on.has(m.id)) continue;
      const pr = PR.ensure(m.id), w = armoryNow(at), bal = A.balance(m.id);
      const due = alertDue({ now: at, tz: pr.tz, open: pr.open, remind: pr.remind, sentOpen: pr.sentOpen, sentRemind: pr.sentRemind, balance: bal, bought: A.held(w.night, m.id), war: true });
      if (!due || !PR.claim(m.id, due.kind, due.night)) continue;
      const reward = A.rewarded(m.id, n), t = alertText(due.kind, { lock: w.lock, tz: pr.tz, balance: bal, reward });
      c.alertPost({ target: m.id, key: "armory:" + due.night, title: t.title, body: t.body, ctaLabel: t.ctaLabel, ctaUrl: t.ctaUrl, by: "armory" }); sent++;
      if (due.kind === "open" && mailOn && pr.mail) {
        const to = c.emailOf(m.id); if (!to) continue;
        const un = `${c.hub.replace(/\/$/, "")}/u/armory?t=${pr.token}`, mail = armoryEmail({ name: m.name || m.handle, lock: w.lock, tz: pr.tz, balance: bal, reward, hub: c.hub, unsubArmory: un, unsubAll: c.unsubAll?.(m.id) || un, postal: c.postal });
        await c.send({ to, subject: mail.subject, html: mail.html, text: mail.text, src: "armory-open", kind: "armory", headers: { "List-Unsubscribe": `<${un}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }).catch((e: any) => console.error("[armory] send", e?.message));
      }
    }
    return { sent };
  }
  /** the Battles group in Settings > Notifications (frontier-design C) */
  function settingsHtml(id: string): string {
    const x = ctxFor(); if (!warSet(Infinity, x).has(id)) return "";
    const pr = PR.ensure(id), w = armoryNow(now()), short = new Date(openAlertAt(w.night, pr.tz)).getTime() && clockIn(openAlertAt(w.night, pr.tz), pr.tz);
    const city = pr.tz.split("/").pop()!.replace(/_/g, " "), e = (t: string) => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
    const sw = (k: string, label: string, on: boolean, d: string) => `<div class="st-row"><label for="sw-${k}">${label}</label><button type="button" class="st-sw" id="sw-${k}" role="switch" aria-checked="${on}" data-k="${k}" aria-describedby="d-${k}"></button><p id="d-${k}">${d}</p></div>`;
    return `<style>.st-g{margin:14px 0 0;padding:14px 16px;border:1px solid var(--line,#2A2A2F);border-radius:12px}.st-gh{margin:0 0 6px;font:600 15px/1.3 inherit}.st-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"l s" "d d";align-items:center;gap:2px 12px;min-height:60px;padding:8px 0;border-top:1px solid var(--line,#2A2A2F)}.st-row:first-of-type{border-top:0}.st-row label{grid-area:l;font-weight:600}.st-row p{grid-area:d;margin:0;font-size:13px;opacity:.75}
.st-sw{grid-area:s;position:relative;width:48px;height:28px;border-radius:999px;border:0;background:#8A8A94;cursor:pointer}.st-sw::before{content:"";position:absolute;inset:-8px -2px}.st-sw::after{content:"";position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .15s}.st-sw[aria-checked="true"]{background:#6E4FE0}.st-sw[aria-checked="true"]::after{transform:translateX(20px)}.st-sw:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}.st-sw[aria-busy="true"]{opacity:.6}
.st-foot{display:grid;gap:4px;margin-top:8px;font-size:12.5px;opacity:.75}.st-err{color:#E5484D;font-size:13px;margin:6px 0 0}@media (prefers-reduced-motion:reduce){.st-sw::after{transition:none}}</style>
<div class="st-g" role="group" aria-labelledby="st-battles"><h3 class="st-gh" id="st-battles">Battles</h3>
${sw("armory-open", "Armory open", pr.open, `One alert a day at ${e(short || "6:00 PM")} your time, when you can pick bombs for the next battle.`)}
${sw("armory-remind", "Reminder before lock", pr.remind, "One more alert 1 hour before the Armory locks, only if you picked no bombs. Never during your night.")}
<div class="st-foot"><span>Sent to: the bell${c.emailOf(id) ? ". Armory open also goes to your Caldera email" : ". Caldera email is off, so no Armory email"}.</span><span>Your time zone: ${e(city)}. The Armory locks at ${e(clockIn(w.lock, pr.tz))}.</span></div>
<p class="st-err" role="alert" hidden></p></div>
<script>(function(){var g=document.getElementById('st-battles').parentNode,er=g.querySelector('.st-err');g.querySelectorAll('.st-sw').forEach(function(b){b.onclick=function(){var on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',on);b.setAttribute('aria-busy','true');er.hidden=true;
var body={};body[b.dataset.k==='armory-open'?'armoryOpen':'armoryRemind']=on;fetch('/v1/world/battle/notify',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)}).then(function(r){if(!r.ok)throw 0}).catch(function(){b.setAttribute('aria-checked',!on);er.textContent='Could not save. Your setting did not change. Try again.';er.hidden=false}).then(function(){b.removeAttribute('aria-busy')})}})})();</script>`;
  }
  function weekNote(x: Ctx, m: GrowthMember, n: number): string {
    const sh = S.shots(n - 6, n), took = sh.filter(s => s.d === m.id).reduce((t, s) => t + usdOf(s), 0), dealt = sh.filter(s => s.a === m.id).reduce((t, s) => t + usdOf(s), 0);
    const built = (x.sims.get(m.id)?.stats || []).filter(s => s.d >= n - 7 && s.d < n).reduce((t, s) => t + s.top, 0);
    return `This week: ${built} lot${built === 1 ? "" : "s"} built, ${fmtUsd(dealt)} of damage dealt, ${fmtUsd(took)} taken (all rebuilt on its own).`;
  }

  // ---------------------------------------------------------------- the battle-report email (opt-in; sends only with CALDERA_BATTLE_EMAIL=1)
  const unsubUrl = (t: string) => `${c.hub.replace(/\/$/, "")}/u/battle?t=${t}`;
  function compose(x: Ctx, m: GrowthMember, night: number, weekly: boolean) {
    const r = { ...reportOf(x, m, night), ...lastBombs(x, m.id, night) }, opt = S.ensure(m.id), shots = S.shots(night), on = warSet(Infinity, x);
    const built = x.ms.map(o => [x.handle(o.id), x.sims.get(o.id)?.stats.find(s => s.d === night - 1)?.top || 0] as [string, number]).filter(y => y[1] > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const reb = x.ms.filter(o => on.has(o.id)).map(o => { const mine = shots.filter(s => s.d === o.id && s.f > 0), t = mine.reduce((a, s) => a + dmgAt(s, now()), 0), l = mine.reduce((a, s) => a + remaining(dmgAt(s, now()), s.t, now(), x.pts(o.id)), 0);
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

  /** the daily feed post, once per battle day (sysposts key battle:<night>); dry: the text only */
  function postSummary(o: { dry?: boolean } = {}) {
    const n = lastNight(now()), x = ctxFor(); if (!S.hasNight(n)) return { skip: "no battle yet" };
    const text = battleSummary(S.shots(n), { night: dayKey(n), handle: x.handle, hub: c.hub }); if (!text) return { skip: "no missiles today", night: dayKey(n) };
    if (o.dry || !c.systemPost) return { dry: true, night: dayKey(n), text };
    return { night: dayKey(n), ...c.systemPost("battle:" + dayKey(n), text, [c.hub.replace(/\/$/, "") + "/world?view=battle&replay=1"]) };
  }

  // ---------------------------------------------------------------- routes
  async function route(req: http.IncomingMessage, res: http.ServerResponse, p: string, url: URL): Promise<boolean> {
    if (p.startsWith("/email/")) return G.route(req, res, p, url);
    if (req.method === "GET" && p === "/v1/world/battle") { res.setHeader("cache-control", "public, max-age=60"); c.json(res, 200, state()); return true; }
    if (p === "/u/battle" && (req.method === "GET" || req.method === "POST")) {
      const t = (url.searchParams.get("t") || "").replace(/[^\w-]/g, "");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      if (req.method === "GET") { res.end(c.page("Stop battle reports", `<form method="post" action="/u/battle?t=${t}"><p>Stop sending Caldera battle reports to this address. Your city stays in the battles; you can leave them from the World's Battle view.</p><button type="submit" style="font:600 15px/1 sans-serif;padding:12px 18px;border-radius:999px;border:0;background:#6E4FE0;color:#fff;cursor:pointer">Unsubscribe</button></form>`)); return true; }
      const row = t ? S.byToken(t) : null; if (row) S.setReport(row.p, "off");   // idempotent; also the RFC 8058 one-click POST
      res.end(c.page("You're unsubscribed", "<p>No more battle reports. You can turn them back on any time from the World's Battle view.</p>")); return true;
    }
    if (p === "/u/armory" && (req.method === "GET" || req.method === "POST")) {
      const t = (url.searchParams.get("t") || "").replace(/[^\w-]/g, ""), row = t ? PR.byToken(t) : null;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      if (req.method === "GET") { res.end(c.page("Stop Armory emails", `<form method="post" action="/u/armory?t=${t}"><p>Stop the daily "Armory open" email to this address. The alert in your bell stays; you can change both in Settings.</p><button type="submit" style="font:600 15px/1 sans-serif;padding:12px 20px;border-radius:999px;border:0;background:#6E4FE0;color:#fff">Stop Armory emails</button></form>`)); return true; }
      if (row) PR.set(row.p, { mail: false });
      res.end(c.page("You're unsubscribed", "<p>No more Armory emails. The alert in your bell stays. You can turn the email back on in Settings.</p>")); return true;
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
      // the same rule as the picker's rivals and the night itself (Mike 11-22: "It's letting me choose cities not in the battle"):
      // every city is in unless it left, and a target must be hittable (towers, not idle)
      const x = ctxFor(), on = warSet(Infinity, x); if (!on.has(id)) { c.json(res, 409, { error: "join the battles first" }); return true; }
      const h = String(b.target || "").replace(/^@/, "").toLowerCase(), t = x.ms.find(m => m.handle.toLowerCase() === h);
      const night = lastNight(now()) + 1, tf = t && t.id !== id && on.has(t.id) ? fighterOf(x, t, dayOf(now()), !!S.opt(t.id)?.waive) : null;
      if (!t || (!b.off && (!tf || !targetable(tf))) || (b.off && t.id === id)) { c.json(res, 400, { error: "that city isn't in tonight's battle" }); return true; }
      if (b.off) S.unaim(night, id, t.id);
      else { if (S.aimsOf(night, id).length >= WAR.manualCap) { c.json(res, 409, { error: `you've aimed all ${WAR.manualCap} shots for tonight` }); return true; } S.aim(night, id, t.id, now()); }
      c.json(res, 200, me(id)); return true;
    }
    if (p === "/v1/world/battle/tz") { const z = cleanTz(b.tz); if (z) PR.setTz(id, z); c.json(res, 200, { ok: !!z }); return true; }
    if (p === "/v1/world/battle/notify") { PR.set(id, { open: typeof b.armoryOpen === "boolean" ? b.armoryOpen : undefined, remind: typeof b.armoryRemind === "boolean" ? b.armoryRemind : undefined }); const pr = PR.ensure(id); c.json(res, 200, { open: pr.open, remind: pr.remind }); return true; }
    if (p === "/v1/world/battle/armory") return buy(res, id, b);
    if (p === "/v1/world/battle/report-word") {
      const bid = Number(b.bid), row = Number.isInteger(bid) ? A.get(bid) : null;
      if (!row || row.state !== "fired") { c.json(res, 404, { error: "no such word" }); return true; }
      if (row.p === id) { c.json(res, 400, { error: "that's your own word" }); return true; }
      const n2 = A.report(bid, id, now()); cache = null; c.json(res, 200, { ok: true, reports: n2 }); return true;
    }
    if (p === "/v1/world/battle/report") {
      const f = String(b.freq || "") as ReportFreq; if (!["daily", "weekly", "off"].includes(f)) { c.json(res, 400, { error: "freq must be daily, weekly or off" }); return true; }
      if (f !== "off" && !c.emailOf(id)) { c.json(res, 409, { error: "confirm an email first", url: "/settings" }); return true; }
      S.setReport(id, f); c.json(res, 200, me(id)); return true;
    }
    return false;
  }
  /** Buy (armory-design A7): all or nothing; any refused word charges nothing; one result per idempotency key */
  function buy(res: http.ServerResponse, id: string, b: any): true {
    const key = typeof b.key === "string" ? id + ":" + b.key.slice(0, 64) : null, at = now();
    for (const [k, v] of idem) if (at - v.at > 600_000) idem.delete(k);
    if (key && idem.has(key)) { const v = idem.get(key)!.v; c.json(res, v.status, v.body); return true; }
    const done = (status: number, body: any) => { if (key) idem.set(key, { at, v: { status, body } }); c.json(res, status, body); return true as const; };
    const x = ctxFor(), on = warSet(Infinity, x); if (!on.has(id)) return done(409, { error: "Join the battles first." });
    const list = Array.isArray(b.bombs) ? b.bombs.slice(0, ARMORY.perNight + 1) : []; if (!list.length) return done(400, { error: "Add a bomb to start." });
    const lands = landsNow(), handles = [...x.ms.map(m => m.handle), ...lands.map(l => l.h)], byH = new Map(x.ms.map(m => [m.handle.toLowerCase(), m.id] as [string, string]));
    const rows: { i: number; error: string }[] = [], items: { kind: BombKind; word: string; target: string | null; named?: boolean }[] = [];
    list.forEach((it: any, i: number) => {
      const kind = String(it?.k || ""); if (!bombOf(kind)) { rows.push({ i, error: "Pick a bomb." }); return; }
      const w = checkWord(String(it?.word || "").toUpperCase(), handles); if (!w.ok) { rows.push({ i, error: w.why }); return; }
      let target: string | null = null; const th = String(it?.target || "").replace(/^@/, "").toLowerCase();
      if (th) { const tid = byH.get(th) || lands.find(l => l.h.toLowerCase() === th && (l.towers || 0) > 0)?.id; if (!tid || tid === id || (!tid.startsWith("uc:") && !on.has(tid))) { rows.push({ i, error: "That city isn't in the next battle. Pick another target." }); return; } target = tid; }
      items.push({ kind: kind as BombKind, word: w.word.toUpperCase(), target, named: !!(b.showName ?? b.show) && !!target && !target.startsWith("uc:") });
    });
    if (rows.length) return done(422, { error: "Nothing was charged. Change the marked word and tap Buy again.", rows });
    const w = armoryNow(at), r = A.buy(id, w.night, items, at);
    if (!r.ok) { const cap = /at most/.test(r.error); return done(cap ? 409 : 402, { error: cap ? `You have ${ARMORY.perNight} bombs for tonight. That is the most per night.` : `Your balance is now ${r.balance} credits. Remove a bomb or pick a smaller one.`, balance: r.balance, cap }); }
    console.log(`[armory] ${x.handle(id)} bought ${items.length} for night ${w.night} (${items.map(i => i.kind).join(",")})`);
    // gift emails go after the reply: a slow mail service never holds up the Buy tap
    try { const rows = r.ids.map(i => A.get(i)).filter(Boolean) as any[]; G.afterBuy(id, w.night, rows).catch((e: any) => console.error("[gift] after buy", e?.message)); } catch (e: any) { console.error("[gift] after buy", e?.message); }
    return done(200, { ok: true, ids: r.ids, balance: r.balance, me: me(id) });
  }
  /** operator check: a night's stored shots run again through today's strike math (same geometry, shields and order). save:
   *  store them as the night (the same missiles, attackers, targets and times; the night's meta keeps its fighters and gets
   *  restruck = when). Nothing is sent: the report email and the feed post only go from the tick, once per night. */
  function restrikeNight(night: number, o: { save?: boolean } = {}) {
    const x = ctxFor(), old = S.shots(night), now2 = restrike(old);
    if (o.save && old.length) { S.saveNight(night, { ...(S.night(night) || { night: dayKey(night), at: battleAt(night) }), restruck: now() }, now2.map(({ night: _n, ...s }: any) => s), now()); cache = null; }
    return { night: dayKey(night), n: old.length, old: old.reduce((t, s) => t + usdOf(s), 0), new: now2.reduce((t, s) => t + usdOf(s), 0),
      shots: now2.map((s, i) => ({ a: x.handle(s.a), d: x.handle(s.d), w: s.w, old: usdOf(old[i]!), new: usdOf(s), held: heldOf(s), sh: s.x?.sh || 0 })) };
  }
  /** a Frontier land left the map (claimed, removed or hidden): bombs aimed at it for the coming battle get their credits back */
  function landGone(login: string) {
    const t = "uc:" + login.toLowerCase(), w = armoryNow(now());
    for (const b of A.live(w.night)) if (b.state === "paid" && b.target && b.target.toLowerCase() === t) A.refund(b.id, "the land left the map", now());
    cache = null;
  }
  /** a member who just claimed a Frontier land is not put in the battles (frontier-design H5) */
  const leave = (id: string) => { S.setWar(id, false, now()); cache = null; };
  /** The farm recount (Mike 11-24, spec section 1d): for each stored night from `from`, the share of each fighter's budget that
   *  real work earned (the re-judged, capped count over the old count). The season score weights that night's damage by it;
   *  shots and replays stay as they were. apply = write the shares. Counts and shares only. */
  function fairRecount(from: number, apply: boolean): { night: number; id: string; x: number }[] {
    if (!c.growth.store) return [];
    const events = c.growth.store.events((from - 32) * DAY), ai = c.growth.store.ai(), reverted = new Set<string>(), evBy = new Map<string, GEvent[]>();
    for (const e of events) { if (e.x?.rv) reverted.add(e.x.rv.slice(0, 7)); if (!evBy.has(e.p)) evBy.set(e.p, []); evBy.get(e.p)!.push(e); }
    const out: { night: number; id: string; x: number }[] = [], last = lastNight(now());
    for (let n = from; n <= last; n++) {
      const j = S.night(n); if (!j) continue;
      for (const f of j.fighters || []) {
        if (!(Number(f.usd) > 0)) continue;
        const ev = evBy.get(f.id) || [], o = { ai: ai.get(f.id), reverted };
        const before = arsenal(ev.map(e => e.v === "farm" ? { ...e, v: "" } : e), n - 1, { ...o, cap: false }).raw, after = arsenal(ev, n - 1, o).raw;
        const x = before > 0 ? Math.round(Math.min(1, after / before) * 1000) / 1000 : 1;
        if (apply) S.setFair(n, f.id, x);
        if (x < 1) out.push({ night: n, id: f.id, x });
      }
    }
    if (apply) cache = null;
    return out;
  }
  return { route, tick, resolve, restrikeNight, fairRecount, state, me, postSummary, sendReports, store: S, armory: A, prefs: PR, armoryAlerts, gift: G, settingsHtml, landGone, leave, erase: (id: string) => { S.erase(id); A.erase(id); PR.erase(id); cache = null; },
    /** operator: opt a member in; since (ms) backdates it so a seed night can include them */
    optIn: (id: string, o: { waive?: boolean; since?: number } = {}) => { S.setWar(id, true, o.since ?? now()); if (o.waive !== undefined) S.setWaive(id, o.waive); cache = null; } };
}
