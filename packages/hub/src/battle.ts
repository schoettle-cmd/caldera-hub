/**
 * Cities at war, mostly while you sleep (Mike 2026-11-07: "start battle builds and take live with choices on views"; approved
 * proposal mjonesone.com/r-caldera-growth-86be0fb2, section 5 "Later phase").
 *
 * An idle war on top of the growth simulation (growth.ts): it reads the same event log and the same daily snapshots, and it
 * never changes either. Destruction is a visual state over the earned state, never a change to it.
 *
 * Hard rules:
 * 1. Each day's code is that night's arsenal: arsenal(day) = min(60, sum over repos of (commits_w + 3 * merged PRs + 8 * releases
 *    + 2 * ci_green) * ai_mult * streak_mult). commits_w = judged human commits authored that day (bots, empty, merge, revert,
 *    fork-upstream commits never count; reverted commits are cancelled), 40 a day per member. Nothing banks beyond the night.
 * 2. Battles run on their own on the overnight tick (02:00 Pacific, 10:00 UTC). Nobody has to do anything.
 * 3. Cities always regenerate: 25% of each hit a day on its own, plus 1% per build point earned after it, to 100%. Opting out
 *    rebuilds instantly. Real land and data are never touched.
 * 4. Fairness: opt-in only (everyone else is a peaceful zone: no shots in or out); a beginner shield (100%) for 30 days after
 *    joining and until a member has 7 active days; streak shields (50% at 7 days, 95% at 30); per-capita strength and scoring;
 *    at most 2 facades lost a night and 30% of a plot's buildings a week; never hit by the same rival two nights running;
 *    quiet plots (14 days idle) can't be targeted.
 * 5. Manual fire is a bonus: aim up to 3 of tonight's shots at a rival. Auto-fire handles everything else.
 */
import { DAY, dayOf, dayKey, aiMult, streakMult, RULES, type GEvent, type SimOut } from "./growth";

// ---------------------------------------------------------------- the rules (first guesses, tuned on real data later)
export const WAR = {
  cap: 60, commitCap: 40, w: { pr: 3, pr_self: 1, release: 8, ci_green: 2 }, privateW: RULES.privateW,
  /** weapons, most expensive first: 3 orbital, 6 beam, 12 cannon or 24 catapult shots spend a full 60 */
  weapons: [{ k: "orbital", cost: 20, code: 7 }, { k: "beam", cost: 10, code: 6 }, { k: "cannon", cost: 5, code: 5 }, { k: "catapult", cost: 2.5, code: 0 }] as { k: Weapon; cost: number; code: number }[],
  /** damage points per facade */ facade: 10, nightCap: 2, weekCap: 0.3, autoRepair: 0.25, repairPerPt: 0.01,
  beginnerDays: 30, beginnerActive: 7, hourUtc: 10, manualCap: 3, seasonDays: 42, idleDays: 14,
};
export type Weapon = "orbital" | "beam" | "cannon" | "catapult";
/** the house rival: when an opted-in city has no fair human match, raiders come in from the sea (they never own land) */
export const RAIDERS = "~raiders";

/** The night battle for UTC day N happens at N 10:00 UTC (02:00 Pacific) and spends day N-1's arsenal. */
export const battleAt = (night: number) => night * DAY + WAR.hourUtc * 3600_000;
/** the latest night whose battle time has passed */
export const lastNight = (now: number) => { const d = dayOf(now); return now >= battleAt(d) ? d : d - 1; };

// ---------------------------------------------------------------- 1. the arsenal
export interface Arsenal { ammo: number; raw: number; c: number; pr: number; rel: number; ci: number; aiX: number; streakX: number; shots: Weapon[]; best: Weapon }
/** the best weapon a plot can fire: catapult (houses), cannon (mid-rise), beam tower (tower), orbital strike (campus) */
export function bestWeapon(lots: string): Weapon { let top = 0; for (const ch of lots) top = Math.max(top, Number(ch) || 0); return WAR.weapons.find(w => top >= w.code)!.k; }
/** spend the ammo, most expensive weapon the plot can fire first; leftovers under a catapult shot are lost (nothing banks) */
export function shotsFor(ammo: number, best: Weapon): Weapon[] {
  const out: Weapon[] = []; let left = ammo;
  for (const w of WAR.weapons.slice(WAR.weapons.findIndex(x => x.k === best))) while (left + 1e-9 >= w.cost) { out.push(w.k); left -= w.cost; }
  return out;
}
export const costOf = (w: Weapon | string) => WAR.weapons.find(x => x.k === w)?.cost || 0;

/** One member's arsenal for one UTC day, from the judged event log. `ai`: repo -> AI signal count. `reverted`: short shas. */
export function arsenal(events: GEvent[], day: number, o: { ai?: Map<string, number>; streak?: number; lots?: string; reverted?: Set<string> } = {}): Arsenal {
  const per = new Map<string, { c: number; pr: number; rel: number; ci: number }>();
  let commitsLeft = WAR.commitCap, c = 0, pr = 0, rel = 0, ci = 0;
  const list = events.filter(e => !e.v && dayOf(e.ts) === day && dayOf(e.seen) <= day + 1).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  for (const e of list) {
    const r = per.get(e.repo) || { c: 0, pr: 0, rel: 0, ci: 0 }; per.set(e.repo, r);
    if (e.k === "commit" || e.k === "private") {
      if (e.k === "commit" && o.reverted?.has(e.id.replace(/^c:/, "").slice(0, 7))) continue;   // a revert cancels the commit it reverts
      const u = Math.min(Math.max(0, Number(e.n) || 0), commitsLeft); commitsLeft -= u; if (u <= 0) continue;
      r.c += u * (e.k === "private" ? WAR.privateW : 1); c += u;
    } else if (e.k === "pr") { r.pr += e.x?.self ? WAR.w.pr_self : WAR.w.pr; pr++; }   // a self-merged PR on a solo repo counts a third
    else if (e.k === "release") { r.rel += WAR.w.release; rel++; }
    else if (e.k === "ci_green") { r.ci += WAR.w.ci_green; ci++; }
  }
  let raw = 0, aiX = 1;
  for (const [repo, r] of per) {
    const x = aiMult(o.ai?.get(repo.toLowerCase()) || 0); if (x > aiX && (r.c || r.pr || r.rel)) aiX = x;
    raw += (r.c + r.pr + r.rel + r.ci) * x;
  }
  const streakX = streakMult(o.streak || 0);
  const ammo = Math.round(Math.min(WAR.cap, raw * streakX) * 10) / 10, best = bestWeapon(o.lots || "");
  return { ammo, raw: Math.round(raw * 10) / 10, c, pr, rel, ci, aiX, streakX: Math.round(streakX * 100) / 100, shots: shotsFor(ammo, best), best };
}

// ---------------------------------------------------------------- 2. shields
/** 100% for beginners (30 days after joining, or fewer than 7 active days ever) unless waived; else 50% at a 7-day streak
 *  rising to 95% at 30; 0 below a week. */
export function shield(o: { streak: number; joinedDays: number; activeDays: number; waived?: boolean }): number {
  if (!o.waived && (o.joinedDays < WAR.beginnerDays || o.activeDays < WAR.beginnerActive)) return 1;
  const s = o.streak || 0; if (s < 7) return 0; if (s >= 30) return 0.95; return Math.round((0.5 + 0.45 * (s - 7) / 23) * 100) / 100;
}
export const isBeginner = (o: { joinedDays: number; activeDays: number; waived?: boolean }) => !o.waived && (o.joinedDays < WAR.beginnerDays || o.activeDays < WAR.beginnerActive);

// ---------------------------------------------------------------- 3. the night
/** A seeded random stream (mulberry32): the same night in, the same dice out. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export interface Fighter {
  id: string; h: string; ars: Arsenal; sh: number; beg: boolean;
  /** lot codes of the plot as it stands (only built lots, code 4+, can be hit) */ lots: string;
  side: number; /** points over the last 7 days, for matchmaking */ out7: number;
  /** team size: strength and score are per head, so a big team can't bully a solo builder */ heads: number;
  idle: number | null;
}
export interface Shot { k: number; a: string; d: string; w: Weapon; ammo: number; roll: number; f: number; lot: number; t: number; aim: 0 | 1; blocked: 0 | 1 }
export interface NightIn {
  night: number; fighters: Fighter[];
  /** pairs "a>d" that landed a hit on the previous night (nobody is hit by the same rival two nights running) */ lastPairs?: Set<string>;
  /** defender -> facades taken over the previous 6 nights (the weekly 30% cap) */ week?: Map<string, number>;
  /** attacker -> targets they aimed at tonight, in order (manual fire, at most 3 shots) */ aims?: Map<string, string[]>;
  /** defender -> lot index -> damage still showing from earlier nights (new hits spread to other lots first) */ open?: Map<string, Map<number, number>>;
}
export const band = (side: number) => side <= 3 ? 0 : side <= 5 ? 1 : side <= 8 ? 2 : 3;
export const builtLots = (lots: string) => { const out: number[] = []; for (let i = 0; i < lots.length; i++) if (Number(lots[i]) >= 4) out.push(i); return out; };
export const targetable = (f: Fighter) => (f.idle === null || f.idle < WAR.idleDays) && builtLots(f.lots).length > 0;

/** Resolve one night. Deterministic for the same input. Raiders stand in for a missing fair rival, with the night's median
 *  arsenal (at least a cannon's worth), and they fire back. */
export function resolveNight(o: NightIn): { shots: Shot[]; raiders: string[] } {
  const R = rng("night:" + o.night), T0 = battleAt(o.night), shots: Shot[] = [];
  const F = [...o.fighters].sort((a, b) => a.id < b.id ? -1 : 1), byId = new Map(F.map(f => [f.id, f] as [string, Fighter]));
  const targets = F.filter(targetable);
  const taken = new Map<string, number>(), weekCap = (f: Fighter) => WAR.weekCap * builtLots(f.lots).length;
  const lotDmg = new Map<string, Map<number, number>>();
  for (const [d, m] of o.open || []) lotDmg.set(d, new Map(m));
  const score = (a: Fighter, t: Fighter) => Math.abs(band(a.side) - band(t.side)) * 3 + Math.abs(Math.log2(1 + a.out7) - Math.log2(1 + t.out7)) + (t.beg ? 4 : 0);
  const rivalOf = (a: Fighter): Fighter | null => {
    const c = targets.filter(t => t.id !== a.id && !o.lastPairs?.has(a.id + ">" + t.id));
    if (!c.length) return null;
    const jitter = new Map(c.map(t => [t.id, rng(`m:${o.night}:${a.id}:${t.id}`)() * 0.5] as [string, number]));
    return c.sort((x, y) => score(a, x) + jitter.get(x.id)! - (score(a, y) + jitter.get(y.id)!) || (x.id < y.id ? -1 : 1))[0]!;
  };
  const fire = (aId: string, pc: number, w: Weapon, d: Fighter | null, aim: 0 | 1) => {
    const roll = 1 + Math.floor(R() * 6), cost = costOf(w), t = T0 + Math.floor(R() * 40 * 60_000);
    if (!d) { shots.push({ k: shots.length, a: aId, d: RAIDERS, w, ammo: cost, roll, f: Math.round(cost * pc * roll / 6 / WAR.facade * 100) / 100, lot: -1, t, aim, blocked: 0 }); return; }
    const raw = cost * pc * (1 - d.sh) * roll / 6 / WAR.facade;
    const room = Math.max(0, Math.min(WAR.nightCap - (taken.get(d.id) || 0), weekCap(d) - (o.week?.get(d.id) || 0) - (taken.get(d.id) || 0)));
    const f = Math.round(Math.min(raw, room) * 100) / 100;
    let lot = -1;
    if (f > 0) {
      const m = lotDmg.get(d.id) || new Map<number, number>(); lotDmg.set(d.id, m);
      const lots = builtLots(d.lots).sort((x, y) => (m.get(x) || 0) - (m.get(y) || 0) || Number(d.lots[y]) - Number(d.lots[x]) || x - y);
      lot = lots[Math.floor(R() * Math.min(3, lots.length))]!;
      m.set(lot, (m.get(lot) || 0) + f); taken.set(d.id, (taken.get(d.id) || 0) + f);
    }
    shots.push({ k: shots.length, a: aId, d: d.id, w, ammo: cost, roll, f, lot, t, aim, blocked: d.sh >= 1 ? 1 : 0 });
  };
  const raided: string[] = [], rArs: number[] = F.map(f => f.ars.ammo).filter(x => x > 0).sort((a, b) => a - b);
  const med = Math.max(10, rArs.length ? rArs[Math.floor(rArs.length / 2)]! : 10);
  for (const a of F) {
    const pc = 1 / Math.max(1, a.heads), rival = rivalOf(a);
    const aimed = (o.aims?.get(a.id) || []).map(id => byId.get(id)).filter((t): t is Fighter => !!t && t.id !== a.id && targetable(t) && !o.lastPairs?.has(a.id + ">" + t.id)).slice(0, WAR.manualCap);
    a.ars.shots.forEach((w, i) => fire(a.id, pc, w, i < aimed.length ? aimed[i]! : rival, i < aimed.length ? 1 : 0));
    if (!rival && targetable(a)) {   // nobody fair to fight: raiders from the sea (they fire with the night's median arsenal)
      raided.push(a.id);
      for (const w of shotsFor(med, "cannon")) fire(RAIDERS, 1, w, a, 0);
    }
  }
  shots.sort((x, y) => x.t - y.t || x.k - y.k); shots.forEach((s, i) => s.k = i);
  return { shots, raiders: raided };
}

// ---------------------------------------------------------------- 4. regeneration (always, with zero player action)
/** Damage still showing from one hit at time `now`: 25% of it repairs each day on its own, plus 1% per build point earned
 *  after the hit (`pts`: UTC day -> build points that day; the hit day counts for the part of the day after the hit). */
export function remaining(f: number, at: number, now: number, pts: (d: number) => number): number {
  if (f <= 0 || now <= at) return Math.max(0, f);
  let p = 0; const d0 = dayOf(at), d1 = dayOf(now);
  for (let d = d0; d <= d1; d++) { const from = Math.max(at, d * DAY), to = Math.min(now, (d + 1) * DAY); if (to > from) p += (pts(d) || 0) * (to - from) / DAY; }
  const fr = WAR.autoRepair * (now - at) / DAY + WAR.repairPerPt * p;
  return Math.max(0, f * (1 - fr));
}
/** hours until a hit is whole on its own (no points): 4 days */
export const wholeAfterDays = () => 1 / WAR.autoRepair;

// ---------------------------------------------------------------- 5. the season and per-capita scoring
export function season(night: number, launch: number) { const k = Math.max(0, night - launch); return { n: Math.floor(k / WAR.seasonDays) + 1, week: Math.floor((k % WAR.seasonDays) / 7) + 1, from: launch + Math.floor(k / WAR.seasonDays) * WAR.seasonDays }; }
/** facades landed, plus half the damage a shield held off, per head */
export function scoreOf(shots: Shot[], heads: (id: string) => number): Map<string, number> {
  const s = new Map<string, number>();
  for (const x of shots) {
    if (x.a !== RAIDERS) s.set(x.a, (s.get(x.a) || 0) + x.f / Math.max(1, heads(x.a)));
    if (x.d !== RAIDERS && x.blocked) s.set(x.d, (s.get(x.d) || 0) + 0.5 * x.ammo / WAR.facade / Math.max(1, heads(x.d)));
  }
  for (const [k, v] of s) s.set(k, Math.round(v * 100) / 100);
  return s;
}

// ---------------------------------------------------------------- 6. "What your city did last night"
export interface Report {
  night: string; h: string; peace: boolean;
  raids: { from: string; t: number; shots: number; landed: number; f: number }[];
  taken: number; tiers: number; rebuilt: number; fired: number; landed: number; on: string[]; dealt: number;
  mvp: { repo: string; bricks: number } | null; shield: number; streak: number; built: number; ammo: number;
}
/** handles: id -> handle (RAIDERS -> "raiders from the sea") */
export function reportFor(id: string, h: string, shots: Shot[], o: { night: number; now: number; peace: boolean; pts: (d: number) => number; handle: (id: string) => string;
  mvp: { repo: string; bricks: number } | null; shield: number; streak: number; built: number; ammo: number }): Report {
  const mine = shots.filter(s => s.d === id), out = shots.filter(s => s.a === id), raids = new Map<string, Report["raids"][number]>();
  for (const s of mine) { const r = raids.get(s.a) || { from: o.handle(s.a), t: s.t, shots: 0, landed: 0, f: 0 }; r.shots++; if (s.f > 0) { r.landed++; r.f += s.f; } r.t = Math.min(r.t, s.t); raids.set(s.a, r); }
  const taken = mine.reduce((t, s) => t + s.f, 0), left = mine.reduce((t, s) => t + remaining(s.f, s.t, o.now, o.pts), 0);
  const perLot = new Map<number, number>(); for (const s of mine) if (s.lot >= 0) perLot.set(s.lot, (perLot.get(s.lot) || 0) + s.f);
  return { night: dayKey(o.night), h, peace: o.peace, raids: [...raids.values()].map(r => ({ ...r, f: Math.round(r.f * 100) / 100 })).sort((a, b) => a.t - b.t),
    taken: Math.round(taken * 100) / 100, tiers: [...perLot.values()].filter(f => f >= 0.5).length, rebuilt: taken > 0 ? Math.round(100 * (1 - left / taken)) : 100,
    fired: out.length, landed: out.filter(s => s.f > 0).length, on: [...new Set(out.filter(s => s.f > 0).map(s => o.handle(s.d)))], dealt: Math.round(out.reduce((t, s) => t + s.f, 0) * 100) / 100,
    mvp: o.mvp, shield: o.shield, streak: o.streak, built: o.built, ammo: o.ammo };
}
/** the repo that laid the most bricks (counted commits) on a day; private repos stay nameless */
export function mvpOf(events: GEvent[], day: number): { repo: string; bricks: number } | null {
  const n = new Map<string, number>();
  for (const e of events) if (!e.v && (e.k === "commit" || e.k === "private") && dayOf(e.ts) === day) n.set(e.repo, (n.get(e.repo) || 0) + (Number(e.n) || 1));
  const top = [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return top ? { repo: top[0].startsWith("private:") || top[0] === "caldera" ? "a private repo" : top[0].split("/").pop()!, bricks: Math.round(top[1]) } : null;
}

// ---------------------------------------------------------------- 7. the battle-report email (opt-in; sending stays off until Mike says go)
export interface WorldLines { built: [string, number][]; hit: [string, number][]; attackers: [string, number][]; rebuilds: [string, number][]; rivalry: [string, string, number] | null; season: { n: number; week: number } }
const fmtF = (f: number) => { const r = Math.round(f * 10) / 10; return r === 1 ? "1 facade" : `${r} facades`; };
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" });
export function battleSubject(r: Report): string {
  if (r.peace || !r.raids.length) return `Your city last night: no raids, ${r.built} lot${r.built === 1 ? "" : "s"} built`;
  const who = r.raids.map(x => x.from).slice(0, 2).join(" and ");
  return r.taken > 0 ? `Your city last night: hit by ${who}, ${r.rebuilt}% rebuilt` : `Your city last night: held off ${who}, ${r.rebuilt}% rebuilt`;
}
/** Plain, short, ASCII, one link to the replay (plus the controls). Peaceful zones get the build and rebuild lines only. */
export function battleEmail(r: Report, w: WorldLines, o: { name: string; hub: string; unsub: string; postal: string; weekly?: boolean }): { subject: string; text: string; html: string } {
  const first = (o.name || r.h).replace(/^@/, "").trim().split(/\s+/)[0] || r.h, hub = o.hub.replace(/\/$/, "");
  const L: string[] = [`Hey ${first},`, "", "YOUR CITY"];
  if (r.peace) { L.push(`Peaceful zone: no raids in or out.`, r.built ? `${r.built} lot${r.built === 1 ? "" : "s"} built yesterday.` : "No new lots yesterday."); }
  else {
    if (!r.raids.length) L.push("No raids on your city.");
    else L.push(`Raided ${r.raids.length === 1 ? "once" : r.raids.length + " times"} (${r.raids.map(x => `${x.from}, ${hhmm(x.t)}`).join("; ")}). ${r.taken > 0 ? `${fmtF(r.taken)} hit${r.tiers ? `, ${r.tiers} tier${r.tiers === 1 ? "" : "s"} down` : ""}.` : "Your shield held."}`);
    if (r.taken > 0) L.push(`Rebuilt ${r.rebuilt}% by 9am. Shield ${Math.round(r.shield * 100)}%${r.streak ? ` (${r.streak}-day streak)` : ""}.`);
    else L.push(`Shield ${Math.round(r.shield * 100)}%${r.streak ? ` (${r.streak}-day streak)` : ""}.`);
    if (r.fired) L.push(`Your towers fired ${r.fired}, landed ${r.landed}${r.on.length ? " on " + r.on.slice(0, 3).join(", ") : ""}.`);
    if (r.mvp) L.push(`MVP: ${r.mvp.repo}, ${r.mvp.bricks} brick${r.mvp.bricks === 1 ? "" : "s"} laid.`);
  }
  L.push(`Watch the replay: ${hub}/world?view=battle&replay=${r.night}`, "", "LAST NIGHT IN THE WORLD");
  const list = (xs: [string, number][], f: (n: number) => string) => xs.map(([h, n]) => `${h} ${f(n)}`).join(", ");
  if (w.built.length) L.push(`Built the most: ${list(w.built, n => `${n} lot${n === 1 ? "" : "s"}`)}`);
  if (!r.peace) {
    if (w.hit.length) L.push(`Hit the hardest: ${list(w.hit, n => `(${fmtF(n)})`)}`);
    if (w.attackers.length) L.push(`Top attackers: ${list(w.attackers, n => `${n} hit${n === 1 ? "" : "s"}`)}`);
    if (w.rebuilds.length) L.push(`Biggest rebuilds: ${list(w.rebuilds, n => `${n}%`)}`);
    if (w.rivalry) L.push(`Rivalry of the night: ${w.rivalry[0]} vs ${w.rivalry[1]}${w.rivalry[2] > 1 ? `, ${w.rivalry[2]} nights running` : ""}`);
  }
  L.push(`Season ${w.season.n}, week ${w.season.week}. Leaderboard: ${hub}/world?view=battle#season`, `Daily / Weekly / Off: ${hub}/world?view=battle#reports`, `Unsubscribe: ${o.unsub}`, "", o.postal);
  const text = L.join("\n").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const html = `<!doctype html><html><body style="margin:0;padding:20px 14px;background:#fff;color:#24222B;font:15px/1.55 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;white-space:pre-wrap">${esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#6E4FE0">$1</a>')}</div></body></html>`;
  return { subject: battleSubject(r).replace(/[^\x20-\x7e]/g, ""), text, html };
}
/** The world section of the email, from the night's shots and yesterday's growth stats */
export function worldLines(shots: Shot[], o: { handle: (id: string) => string; built: [string, number][]; rebuilt: [string, number][]; pairsByNight: Set<string>[]; season: { n: number; week: number } }): WorldLines {
  const hit = new Map<string, number>(), att = new Map<string, number>(), pair = new Map<string, number>();
  for (const s of shots) { if (s.d !== RAIDERS && s.f > 0) hit.set(s.d, (hit.get(s.d) || 0) + s.f); if (s.a !== RAIDERS && s.f > 0) att.set(s.a, (att.get(s.a) || 0) + 1);
    if (s.a !== RAIDERS && s.d !== RAIDERS) { const k = [s.a, s.d].sort().join("|"); pair.set(k, (pair.get(k) || 0) + 1); } }
  const top = (m: Map<string, number>): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([k, v]) => [o.handle(k), Math.round(v * 10) / 10]);
  let rivalry: [string, string, number] | null = null;
  const best = [...pair.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (best) { const [a, b] = best[0].split("|"); let n = 1; for (const s of o.pairsByNight) { if (s.has(best[0])) n++; else break; } rivalry = [o.handle(a!), o.handle(b!), n]; }
  return { built: o.built.slice(0, 3), hit: top(hit), attackers: top(att), rebuilds: o.rebuilt.slice(0, 3), rivalry, season: o.season };
}

// ---------------------------------------------------------------- storage
type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export type ReportFreq = "off" | "daily" | "weekly";
export interface OptRow { p: string; war: 0 | 1; since: number; waive: 0 | 1; report: ReportFreq; token: string; sent: string | null }
export function battleStore(q: Q, newToken: () => string) {
  q(`CREATE TABLE IF NOT EXISTS battle_opt (profile TEXT PRIMARY KEY, war INTEGER, since INTEGER, waive INTEGER, report TEXT, token TEXT UNIQUE, sent TEXT, at INTEGER)`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_aims (night INTEGER, attacker TEXT, target TEXT, ts INTEGER, PRIMARY KEY (night, attacker, target))`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_nights (night INTEGER PRIMARY KEY, at INTEGER, json TEXT)`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_shots (night INTEGER, k INTEGER, a TEXT, d TEXT, w TEXT, ammo REAL, roll INTEGER, f REAL, lot INTEGER, t INTEGER, aim INTEGER, blocked INTEGER, PRIMARY KEY (night, k))`).run();
  q(`CREATE INDEX IF NOT EXISTS battle_shots_d ON battle_shots (d, night)`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_meta (k TEXT PRIMARY KEY, v TEXT)`).run();
  const map = (r: any): OptRow => ({ p: r.profile, war: r.war ? 1 : 0, since: r.since || 0, waive: r.waive ? 1 : 0, report: (["daily", "weekly"].includes(r.report) ? r.report : "off") as ReportFreq, token: r.token, sent: r.sent || null });
  const opt = (p: string): OptRow | null => { const r = q("SELECT * FROM battle_opt WHERE profile=?").get(p); return r ? map(r) : null; };
  const ensure = (p: string): OptRow => { if (!opt(p)) q("INSERT OR IGNORE INTO battle_opt VALUES (?,?,?,?,?,?,?,?)").run(p, 0, 0, 0, "off", newToken(), null, Date.now()); return opt(p)!; };
  const shotRow = (r: any): Shot => ({ k: r.k, a: r.a, d: r.d, w: r.w, ammo: r.ammo, roll: r.roll, f: r.f, lot: r.lot, t: r.t, aim: r.aim ? 1 : 0, blocked: r.blocked ? 1 : 0 });
  return {
    opt, ensure,
    opts: (): OptRow[] => (q("SELECT * FROM battle_opt").all() as any[]).map(map),
    setWar: (p: string, on: boolean, at: number) => { ensure(p); q("UPDATE battle_opt SET war=?, since=?, at=? WHERE profile=?").run(on ? 1 : 0, on ? at : 0, at, p); },
    setWaive: (p: string, on: boolean) => { ensure(p); q("UPDATE battle_opt SET waive=? WHERE profile=?").run(on ? 1 : 0, p); },
    setReport: (p: string, f: ReportFreq) => { ensure(p); q("UPDATE battle_opt SET report=? WHERE profile=?").run(f, p); },
    byToken: (t: string): OptRow | null => { const r = q("SELECT * FROM battle_opt WHERE token=?").get(t); return r ? map(r) : null; },
    markSent: (p: string, day: string) => q("UPDATE battle_opt SET sent=? WHERE profile=?").run(day, p),
    aims: (night: number): Map<string, string[]> => { const m = new Map<string, string[]>(); for (const r of q("SELECT * FROM battle_aims WHERE night=? ORDER BY ts").all(night) as any[]) { if (!m.has(r.attacker)) m.set(r.attacker, []); m.get(r.attacker)!.push(r.target); } return m; },
    aimsOf: (night: number, p: string): string[] => (q("SELECT target FROM battle_aims WHERE night=? AND attacker=? ORDER BY ts").all(night, p) as any[]).map(r => r.target),
    aim: (night: number, p: string, target: string, at: number) => q("INSERT OR IGNORE INTO battle_aims VALUES (?,?,?,?)").run(night, p, target, at),
    unaim: (night: number, p: string, target: string) => q("DELETE FROM battle_aims WHERE night=? AND attacker=? AND target=?").run(night, p, target),
    night: (n: number): any | null => { const r = q("SELECT json FROM battle_nights WHERE night=?").get(n); try { return r ? JSON.parse(r.json) : null; } catch { return null; } },
    hasNight: (n: number) => !!q("SELECT 1 FROM battle_nights WHERE night=?").get(n),
    saveNight: (n: number, meta: unknown, shots: Shot[], at: number) => {
      q("BEGIN").run();
      try {
        q("DELETE FROM battle_shots WHERE night=?").run(n);
        for (const s of shots) q("INSERT INTO battle_shots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(n, s.k, s.a, s.d, s.w, s.ammo, s.roll, s.f, s.lot, s.t, s.aim, s.blocked);
        q("INSERT OR REPLACE INTO battle_nights VALUES (?,?,?)").run(n, at, JSON.stringify(meta));
        q("COMMIT").run();
      } catch (e) { try { q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
    },
    shots: (from: number, to = from): (Shot & { night: number })[] => (q("SELECT * FROM battle_shots WHERE night >= ? AND night <= ? ORDER BY night, k").all(from, to) as any[]).map(r => ({ ...shotRow(r), night: r.night })),
    meta: (k: string): string | null => (q("SELECT v FROM battle_meta WHERE k=?").get(k) as any)?.v ?? null,
    setMeta: (k: string, v: string) => q("INSERT OR REPLACE INTO battle_meta VALUES (?,?)").run(k, v),
    erase: (p: string) => { q("DELETE FROM battle_opt WHERE profile=?").run(p); q("DELETE FROM battle_aims WHERE attacker=? OR target=?").run(p, p); q("UPDATE battle_shots SET a='~gone' WHERE a=?").run(p); q("DELETE FROM battle_shots WHERE d=?").run(p); },
    prune: (beforeNight: number) => { q("DELETE FROM battle_shots WHERE night < ?").run(beforeNight); q("DELETE FROM battle_nights WHERE night < ?").run(beforeNight); q("DELETE FROM battle_aims WHERE night < ?").run(beforeNight); },
  };
}
export type BattleStore = ReturnType<typeof battleStore>;
export type { SimOut };
