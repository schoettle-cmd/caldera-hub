/**
 * Cities at war, mostly while you sleep (Mike 2026-11-07: "start battle builds and take live with choices on views"; approved
 * proposal mjonesone.com/r-caldera-growth-86be0fb2, section 5 "Later phase").
 *
 * An idle war on top of the growth simulation (growth.ts): it reads the same event log and the same daily snapshots, and it
 * never changes either. Destruction is a visual state over the earned state, never a change to it.
 *
 * Economics and physics (Mike 2026-11-13: "Why are you capping the commits at 40? ... let them have lots of ammunition and
 * enhance the damage ... every missile needs to create damage ... set the buildings on fire with smoke, so we have more damage
 * that basically tames down. Use real-world economics, real-world physics"; and "different levels of weapons ... small missiles,
 * medium missiles, and bigger missiles based on other variables"):
 * 1. A day's code is a munitions budget in dollars, with no ceiling: points = sum over repos of (commits + 3 * merged PRs
 *    + 8 * releases + 2 * green CI runs) * ai_mult * streak_mult, and every point is $50,000. Judged work only (bots, empty,
 *    merge, revert, fork-upstream commits never count; reverted commits are cancelled). Nothing banks beyond the night.
 * 2. The budget buys missiles at real-world-ish unit prices, heaviest unlocked size first: artillery shell (S, $100k, 5 kg
 *    TNT), guided rocket (M, $200k, 25 kg), tactical missile (L, $1M, 150 kg), cruise missile (XL, $2M, 450 kg). What a city
 *    may field: its tallest building sets the base size, a release in the last 30 days and a green CI run that day each move
 *    it up one. A streak buys guidance (GPS at 7 days, a terminal seeker at 30), AI signals tighten the aim, and each merged
 *    PR that day adds a rival within reach (3 to 5).
 * 3. Damage is blast physics: the miss distance is drawn from the weapon's CEP; peak overpressure falls with the scaled
 *    distance Z = R / W^(1/3) (Hopkinson-Cranz; Mills 1987 fit); the part of the building inside the radius where the blast
 *    still beats the structure's resistance (timber 35 kPa, masonry 50, steel frame 70, reinforced concrete 140) is destroyed,
 *    and is priced at the building's replacement value (floors x 400 m2 x $/m2 by construction). Every missile does damage
 *    (Mike 11-14: "every missile strike needs to create damage"): a near miss still breaks glass and cladding, and no hit does
 *    less than 0.1% of the building before the shield. A shield REDUCES a hit, never cancels it: it takes its own share off
 *    (the beginner dome 99%, streak shields 50% to 95%) and the rest lands as blast plus fire. A wrecked tower has less left
 *    to wreck, and a city under heavy fire has its crews out (civil defence: every missile coming in counts, shielded or not),
 *    so later hits do less, but never nothing: there are no caps that zero a shot.
 * 4. Every hit starts a fire. Some spread (by weapon). Fire adds damage for hours on an exponential burn-down (time constant
 *    1 hour: 63% of it in the first hour, out after about 4, embers and thin smoke until morning).
 * 5. Battles run on their own at 20:00 Pacific (04:00 UTC in winter, 03:00 in summer; nights up to 2026-11-24 ran at 10:00 UTC,
 *    LOOP.md part c). Defenses lock at 19:45 Pacific. Cities always regenerate: 25% of each hit a
 *    day on its own, plus 1% per build point earned after it. Opting out rebuilds instantly. Real land and data are never touched.
 * 6. Fairness: every city is in unless it opts out; a beginner shield (99%) for 30 days after joining and until a member has
 *    7 active days; streak shields (50% at 7 days, 95% at 30); per-capita strength and scoring; never hit by the same rival
 *    two nights running; quiet plots (14 days idle) can't be targeted. Manual fire: aim up to 3 of tonight's shots.
 */
import { DAY, dayOf, dayOf as dayOfUtc, dayKey, aiMult, streakMult, RULES, type GEvent, type SimOut } from "./growth";

// ---------------------------------------------------------------- the rules
export type Weapon = "shell" | "rocket" | "tactical" | "cruise";
/** tonight's orders (LOOP.md c.2): All-in attack, Balanced (the default), Turtle */
export type Order = "atk" | "bal" | "tur";
export interface WeaponSpec { k: Weapon; name: string; size: string; like: string; /** unit cost, $ */ cost: number; /** warhead, kg of TNT */ tnt: number; /** circular error probable, m, before guidance */ cep: number; /** chance the fire spreads */ fire: number; /** tech level needed, 0..3 */ tech: number }
export interface BuildClass { k: string; name: string; /** overpressure that wrecks it, kPa */ kpa: number; /** replacement cost, $ per m2 of floor */ sqm: number; /** fire load, 0..1 */ load: number; /** tallest map height (px) in this class */ maxH: number }
export const WAR = {
  /** the battle arsenal on the city's daily commit caps (spec 11-24 1b/1c): off by default (Mike 11-13: no cap); CALDERA_BATTLE_CAP=1 */
  cap: false as boolean,
  /** dollars of munitions per point of judged work: a commit is 1 point */ usd: 50_000,
  w: { pr: 3, pr_self: 1, release: 8, ci_green: 2 }, privateW: RULES.privateW,
  /** heaviest first */
  weapons: [
    { k: "cruise", name: "Cruise missile", size: "XL", like: "Tomahawk class", cost: 2_000_000, tnt: 450, cep: 10, fire: 0.6, tech: 3 },
    { k: "tactical", name: "Tactical missile", size: "L", like: "ATACMS class", cost: 1_000_000, tnt: 150, cep: 16, fire: 0.4, tech: 2 },
    { k: "rocket", name: "Guided rocket", size: "M", like: "GMLRS class", cost: 200_000, tnt: 25, cep: 12, fire: 0.25, tech: 1 },
    { k: "shell", name: "Artillery shell", size: "S", like: "155 mm class", cost: 100_000, tnt: 5, cep: 14, fire: 0.15, tech: 0 },
  ] as WeaponSpec[],
  /** construction by building height on the world map */
  classes: [
    { k: "timber", name: "Timber low-rise", kpa: 35, sqm: 2000, load: 1, maxH: 34 },
    { k: "masonry", name: "Masonry block", kpa: 50, sqm: 3000, load: 0.7, maxH: 60 },
    { k: "steel", name: "Steel-frame mid-rise", kpa: 70, sqm: 4000, load: 0.5, maxH: 100 },
    { k: "concrete", name: "Concrete tower", kpa: 140, sqm: 6000, load: 0.35, maxH: 1e9 },
  ] as BuildClass[],
  /** a building: 20 m x 20 m, 3.5 m floors, one floor per 4 px of map height */ footprint: 400, half: 10, floorM: 3.5, pxPerFloor: 4,
  /** fire: burn-down time constant (hours), share of the blast damage a contained / a spreading fire adds (times the fire load) */
  fire: { tauH: 1, small: 0.15, spread: 0.8, outH: 4, emberH: 8 },
  /** a near miss still breaks glass and cladding: up to this share of the building; and the least any hit does before the shield */ light: 0.005, floor: 0.001,
  /** the most any shield takes off a hit (the beginner dome): no shield is perfect, so every missile does damage (11-14) */ dome: 0.99,
  /** civil defence: damage scales by 1 / (1 + tonight / night + week / (week * towers)), in towers' worth; tonight counts
   *  every missile coming in before the shield (crews turn out for the sirens, not for what got through) */ soft: { night: 2, week: 0.3 },
  /** a tower can't lose more than this to stacked hits (what is rubble can't be wrecked again) */ stand: 0.95,
  /** guidance by streak days: the CEP multiplier */ guide: [{ streak: 30, x: 0.25, name: "Terminal seeker" }, { streak: 7, x: 0.5, name: "GPS" }, { streak: 0, x: 1, name: "Inertial" }],
  /** a release this recent moves the heaviest size up one */ relDays: 30, /** rivals within reach: 3, plus one per merged PR that day */ reach: 3, reachMax: 5,
  autoRepair: 0.25, repairPerPt: 0.01,
  /** hourUtc: the battle hour in UTC in winter (20:00 PST); the battle follows Pacific time (battleAt). lockMin: defenses and the
   *  Armory lock this many minutes before it (19:45 PT) */
  beginnerDays: 30, beginnerActive: 7, hourUtc: 4, lockMin: 15, manualCap: 3, seasonDays: 42, idleDays: 14,
  /** the evening turn (LOOP.md c.2): tonight's orders change reach, the shield (points of through%) and the missiles that fire */
  orders: { atk: { reach: 2, shield: -25, keep: 1 }, bal: { reach: 0, shield: 0, keep: 1 }, tur: { reach: 0, shield: 20, keep: 2 / 3 } } as Record<Order, { reach: number; shield: number; keep: number }>,
  /** shield placement: the guarded tower +20 points, each other tower -10 */ place: { focus: 20, rest: -10 },
  /** the most an earned shield shows (through% never under 3), and the most a hit can do (All-in with no shield: 125%) */ shieldCap: 97, throughMax: 125,
  /** the commander ranks by season score, $ (LOOP.md c.5) */
  ranks: [["Recruit", 0], ["Gunner", 1e6], ["Sergeant", 5e6], ["Lieutenant", 15e6], ["Captain", 40e6], ["Major", 100e6], ["Colonel", 250e6], ["General", 600e6]] as [string, number][],
  /** nights resolved before 2026-11-14 counted facades: one facade is scored as this many dollars, one old ammo point as usd */ legacyFacade: 5_000_000,
};
const LEGACY: Record<string, Weapon> = { orbital: "cruise", beam: "tactical", cannon: "rocket", catapult: "shell" };
export const weaponOf = (w: string): WeaponSpec => WAR.weapons.find(x => x.k === w) || WAR.weapons.find(x => x.k === LEGACY[w]) || WAR.weapons[WAR.weapons.length - 1]!;
/** the house rival: when an opted-in city has no fair human match, raiders come in from the sea (they never own land) */
export const RAIDERS = "~raiders";

/** the first night at 20:00 Pacific (LOOP.md part c, 2026-11-24): 2026-11-25, which runs at 20:00 PST on 11-24 (04:00 UTC 11-25) */
export const SWITCH_NIGHT = Math.floor(Date.parse("2026-11-25T00:00:00Z") / DAY);
/** offset of Pacific wall time from UTC at an instant (ms; -8 h or -7 h) */
export function ptOff(t: number): number {
  const p = PTF.formatToParts(new Date(t)), g = (k: string) => Number(p.find(x => x.type === k)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
}
const PTF = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const atMemo = new Map<number, number>();
/** The battle of night N (a UTC day number). Nights up to 2026-11-24 ran at N 10:00 UTC (02:00 Pacific). From 2026-11-25 on it
 *  is 20:00 Pacific on the evening before (N-1): 04:00 UTC in winter, 03:00 UTC in summer. Night N spends work day N-1 (bdOf). */
export function battleAt(night: number): number {
  if (night < SWITCH_NIGHT) return night * DAY + 10 * 3600_000;
  const hit = atMemo.get(night); if (hit !== undefined) return hit;
  const wall = (night - 1) * DAY + 20 * 3600_000; let t = wall - ptOff(wall); t = wall - ptOff(t);
  if (atMemo.size > 4000) atMemo.clear(); atMemo.set(night, t); return t;
}
/** when defenses (orders, shield placement, aims) and the Armory lock for night N: 19:45 Pacific; nights before the switch at the battle */
export const lockAt = (night: number) => night < SWITCH_NIGHT ? battleAt(night) : battleAt(night) - WAR.lockMin * 60_000;
/** the latest night whose battle time has passed */
export const lastNight = (now: number) => { const d = dayOf(now); return now >= battleAt(d) ? d : now >= battleAt(d - 1) ? d - 1 : d - 2; };
/** The work day an event at t counts for: night N spends work day N-1. Before 2026-11-24 00:00 UTC, the UTC day (as the nights
 *  then ran). From then on, the day ends at the lock: work up to 19:45 Pacific fires that night. So the switch night (2026-11-25)
 *  spends [2026-11-24 00:00 UTC, its lock at 19:45 PST = 03:45 UTC 11-25): no gap and no overlap with the 10:00 UTC night before. */
const CUT0 = (SWITCH_NIGHT - 1) * DAY;
export function bdOf(t: number): number {
  if (t < CUT0) return dayOf(t);
  const d = dayOf(t); return Math.max(SWITCH_NIGHT - 1, t < lockAt(d) ? d - 1 : d);
}

// ---------------------------------------------------------------- 1. buildings: construction, size and replacement value
export interface Tower { /** map height, px */ h: number; /** index into WAR.classes */ c: number; floors: number; /** m3 */ vol: number; /** replacement value, $ */ value: number }
/** the world map's height of a repo tower (city.ts bh(), world scale) */
export const towerH = (commits: number) => 14 + Math.min(110, Math.round(20 * Math.log2(1 + Math.max(0, commits) / 8)));
export function towerOf(h: number): Tower {
  const c = WAR.classes.findIndex(x => h <= x.maxH), floors = Math.max(2, Math.round(h / WAR.pxPerFloor));
  return { h, c, floors, vol: WAR.footprint * floors * WAR.floorM, value: floors * WAR.footprint * WAR.classes[c]!.sqm };
}
/** a city's repo towers as the world map keeps them (world.ts: top 30 by this week's and all-time commits), tallest first */
export function towersOf(repos: { commits?: number; week?: number; kind?: string }[]): number[] {
  return repos.filter(r => r && !r.kind).map(r => ({ s: (Number(r.week) || 0) * 20 + (Number(r.commits) || 0), h: towerH(Number(r.commits) || 0) })).sort((a, b) => b.s - a.s).slice(0, 30).map(r => r.h).sort((a, b) => b - a);
}

// ---------------------------------------------------------------- 2. blast physics
/** peak side-on overpressure (kPa) at scaled distance Z = R / W^(1/3) (m per kg^(1/3) of TNT): Mills (1987) */
export const overpressure = (Z: number) => { const z = Math.max(0.3, Z); return 1772 / z ** 3 - 114 / z ** 2 + 108 / z; };
/** the scaled distance where the blast has fallen to kpa (overpressure() falls all the way, so bisection) */
export function scaledDistance(kpa: number): number { let lo = 0.3, hi = 200; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (overpressure(m) > kpa) lo = m; else hi = m; } return (lo + hi) / 2; }
/** how far from the detonation a building of this construction is wrecked, m */
export const blastRadius = (tnt: number, kpa: number) => scaledDistance(kpa) * Math.cbrt(tnt);
/** the miss distance (m) for a uniform draw u: Rayleigh, half the shots inside the CEP */
export const missOf = (cep: number, u: number) => cep * Math.sqrt(Math.log2(1 / (1 - Math.min(0.999999, Math.max(0, u)))));
export interface Blast { /** share of the building destroyed by the blast, before shield and the rest */ raw: number; /** wreck radius, m */ r: number; /** metres from the wall (0 = it hit the building) */ wall: number; /** overpressure at the wall, kPa */ kpa: number }
/** One detonation against one building. The warhead goes off `miss` metres from the aim point (the middle of a 20 m wide
 *  building: inside 10 m it hits the building itself). Everything of the building inside the wreck radius is destroyed: a
 *  half sphere on a direct hit, the cap of the sphere that still reaches past the wall on a near miss. Beyond that, glass and
 *  cladding only (WAR.light at the building's resistance, less as the blast weakens). */
export function blast(tnt: number, t: Tower, miss: number): Blast {
  const cls = WAR.classes[t.c]!, r = blastRadius(tnt, cls.kpa), wall = Math.max(0, miss - WAR.half), reach = Math.max(0, r - wall);
  const vol = Math.PI * reach * reach * (3 * r - reach) / 3, kpa = overpressure(Math.max(1, wall) / Math.cbrt(tnt));
  return { raw: Math.max(Math.min(1, vol / t.vol), WAR.light * Math.min(1, kpa / cls.kpa)), r, wall, kpa };
}
/** fire: how much of a fire's total damage has burnt by `now` (exponential burn-down, time constant WAR.fire.tauH) */
export const burnt = (fi: number, at: number, now: number) => fi > 0 && now > at ? fi * (1 - Math.exp(-(now - at) / (WAR.fire.tauH * 3600_000))) : 0;

// ---------------------------------------------------------------- 3. the arsenal
export interface Arsenal { /** points (the leaderboard's metric) */ ammo: number; /** the munitions budget, $ */ usd: number; raw: number; c: number; pr: number; rel: number; ci: number; aiX: number; streakX: number;
  shots: Weapon[]; best: Weapon; /** 0..3 */ tech: number; /** why: base (tallest building), +1 release, +1 green CI */ techWhy: { base: number; rel: number; ci: number };
  /** guidance name and the CEP multiplier (guidance x AI targeting) */ guide: string; cepX: number; /** rivals within reach */ reach: number; /** missiles per size */ n: Record<Weapon, number>; /** budget left unspent, $ */ left: number }
/** the heaviest size a city may field. Base: the tallest building (plot: mid-rise 1, tower 2, campus 3; or its tallest repo
 *  tower's construction class); a release in the last 30 days and a green CI run that day each add one. */
export function techOf(o: { lots?: string; top?: number; rel30?: boolean; ci?: boolean }): { tech: number; base: number; rel: number; ci: number } {
  let top = 0; for (const ch of o.lots || "") top = Math.max(top, Number(ch) || 0);
  const base = Math.max(top >= 5 ? top - 4 : 0, o.top ? towerOf(o.top).c : 0), rel = o.rel30 ? 1 : 0, ci = o.ci ? 1 : 0;
  return { tech: Math.min(3, base + rel + ci), base, rel, ci };
}
export const bestWeapon = (tech: number): Weapon => WAR.weapons.find(w => tech >= w.tech)!.k;
/** spend the budget, heaviest unlocked size first; what is left under a shell's price is lost (nothing banks) */
export function shotsFor(usd: number, best: Weapon): Weapon[] {
  const out: Weapon[] = []; let left = usd;
  for (const w of WAR.weapons.slice(WAR.weapons.findIndex(x => x.k === best))) while (left + 1e-6 >= w.cost) { out.push(w.k); left -= w.cost; }
  return out;
}
export const costOf = (w: Weapon | string) => weaponOf(w).cost;
export const countOf = (shots: Weapon[]) => { const n = { shell: 0, rocket: 0, tactical: 0, cruise: 0 } as Record<Weapon, number>; for (const s of shots) n[s]++; return n; };

/** One member's arsenal for one UTC day, from the judged event log (all of the member's events: the release unlock looks back
 *  30 days). `ai`: repo -> AI signal count. `reverted`: short shas. `top`: the tallest repo tower's map height. Commits use the
 *  city's daily caps only when WAR.cap is on (CALDERA_BATTLE_CAP=1; Mike's 11-13 rule is no cap, the farm judge does the work). */
export function arsenal(events: GEvent[], day: number, o: { ai?: Map<string, number>; streak?: number; lots?: string; reverted?: Set<string>; top?: number; /** the daily commit caps; default WAR.cap */ cap?: boolean;
  /** the day an instant belongs to: the UTC day (default; the leaderboard shifts events to Pacific days) or the battles' work day (bdOf) */ dayOf?: (t: number) => number } = {}): Arsenal {
  const dayOf = o.dayOf || dayOfUtc;
  const per = new Map<string, { c: number; pr: number; rel: number; ci: number }>(), perRepo = new Map<string, number>();
  let c = 0, pr = 0, rel = 0, ci = 0, rel30 = false, cu = 0;
  for (const e of events) if (!e.v && e.k === "release" && dayOf(e.ts) <= day && dayOf(e.ts) > day - WAR.relDays) { rel30 = true; break; }
  const list = events.filter(e => !e.v && dayOf(e.ts) === day && dayOf(e.seen) <= day + 1).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  for (const e of list) {
    const r = per.get(e.repo) || { c: 0, pr: 0, rel: 0, ci: 0 }; per.set(e.repo, r);
    if (e.k === "commit" || e.k === "private") {
      if (e.k === "commit" && o.reverted?.has(e.id.replace(/^c:/, "").slice(0, 7))) continue;   // a revert cancels the commit it reverts
      const u = Math.max(0, Number(e.n) || 0); if (u <= 0) continue;
      let eff = u;
      if (o.cap ?? WAR.cap) {   // the city's daily caps (spec 2026-11-24 section 1b/1c): 40 a repo, then a fifth; 40 a day in all, public and private. OFF until Mike's yes (his 11-13 rule: no commit cap)
        const seen = perRepo.get(e.repo) || 0, full = Math.max(0, Math.min(u, RULES.repoSoft - seen)); perRepo.set(e.repo, seen + u);
        eff = Math.min(full + (u - full) * RULES.repoSoftW, Math.max(0, RULES.commitCap - cu)); cu += eff;
      }
      r.c += eff * (e.k === "private" ? WAR.privateW : 1); c += u;
    } else if (e.k === "pr") { r.pr += e.x?.self ? WAR.w.pr_self : WAR.w.pr; pr++; }   // a self-merged PR on a solo repo counts a third
    else if (e.k === "release") { r.rel += WAR.w.release; rel++; }
    else if (e.k === "ci_green") { r.ci += WAR.w.ci_green; ci++; }
  }
  let raw = 0, aiX = 1;
  for (const [repo, r] of per) {
    const x = aiMult(o.ai?.get(repo.toLowerCase()) || 0); if (x > aiX && (r.c || r.pr || r.rel)) aiX = x;
    raw += (r.c + r.pr + r.rel + r.ci) * x;
  }
  const streakX = streakMult(o.streak || 0), ammo = Math.round(raw * streakX * 10) / 10, usd = Math.round(ammo * WAR.usd);
  const tw = techOf({ lots: o.lots, top: o.top, rel30, ci: ci > 0 }), best = bestWeapon(tw.tech), shots = shotsFor(usd, best), g = WAR.guide.find(x => (o.streak || 0) >= x.streak)!;
  return { ammo, usd, raw: Math.round(raw * 10) / 10, c, pr, rel, ci, aiX, streakX: Math.round(streakX * 100) / 100, shots, best, tech: tw.tech, techWhy: { base: tw.base, rel: tw.rel, ci: tw.ci },
    guide: g.name, cepX: Math.round(g.x / aiX * 1000) / 1000, reach: Math.min(WAR.reachMax, WAR.reach + pr), n: countOf(shots), left: usd - shots.reduce((t, w) => t + costOf(w), 0) };
}

// ---------------------------------------------------------------- 4. shields
/** The share of each hit the shield takes off: the beginner dome (WAR.dome, 99%) for 30 days after joining, or fewer than 7
 *  active days ever, unless waived; else 50% at a 7-day streak rising to 95% at 30; 0 below a week. Never 100% (11-14). */
export function shield(o: { streak: number; joinedDays: number; activeDays: number; waived?: boolean }): number {
  if (!o.waived && (o.joinedDays < WAR.beginnerDays || o.activeDays < WAR.beginnerActive)) return WAR.dome;
  const s = o.streak || 0; if (s < 7) return 0; if (s >= 30) return 0.95; return Math.round((0.5 + 0.45 * (s - 7) / 23) * 100) / 100;
}
export const isBeginner = (o: { joinedDays: number; activeDays: number; waived?: boolean }) => !o.waived && (o.joinedDays < WAR.beginnerDays || o.activeDays < WAR.beginnerActive);

// ---------------------------------------------------------------- 4b. the evening turn (LOOP.md part c)
/** through% of a hit on one tower (LOOP.md c.2): clamp(100 - S - place - order, 3, 125). S: the earned shield in points (0, or
 *  50 to 95 by streak). place: the placement term (0 whole city, +20 the guarded tower, -10 each other tower while one is
 *  guarded). order: All-in -25, Balanced 0, Turtle +20 (25 before the c.2 release check, 11-24). The beginner dome: 99% for Balanced and Turtle, 74% for All-in, never
 *  placed. The shown shield is 100 - through%. */
export function throughOf(S: number, place: number, order: Order, dome: boolean): number {
  const ord = WAR.orders[order] || WAR.orders.bal, d = Math.round(WAR.dome * 100);
  if (dome) return order === "atk" ? 100 - (d + ord.shield) : 100 - d;
  return Math.min(WAR.throughMax, Math.max(100 - WAR.shieldCap, 100 - (S || 0) - (place || 0) - ord.shield));
}
/** the placement term for one tower: lot is the tower (0..2, tallest first); place the guarded tower, or -1 for the whole city */
export const placeTerm = (place: number | null | undefined, lot: number) => place == null || place < 0 ? 0 : lot === place ? WAR.place.focus : WAR.place.rest;
/** the share of a hit the shield takes off on one tower tonight (negative: hits do more). Balanced over the whole city is the
 *  earned shield exactly, so a night where nobody gives orders is the night it always was. */
export function shieldAt(d: { sh: number; beg: boolean; order?: Order; place?: number | null }, lot: number): number {
  const ord = d.order || "bal", placed = !d.beg && d.sh > 0 && d.place != null && d.place >= 0;
  if (ord === "bal" && !placed) return Math.min(1, Math.max(0, d.sh));
  const S = d.beg ? 0 : Math.round(Math.max(0, d.sh) * 100);
  return Math.round((1 - throughOf(S, placed ? placeTerm(d.place, lot) : 0, ord, d.beg) / 100) * 1e4) / 1e4;
}
/** the missiles that fire tonight: all of them, or with Turtle every third one (sorted largest first) stays home, so ceil(2n/3)
 *  fire. What stays home is not kept for the next day. */
export function firedOf(a: { shots: Weapon[] }, order: Order = "bal"): Weapon[] {
  const home = 1 - ((WAR.orders[order] || WAR.orders.bal).keep ?? 1); if (home <= 0) return a.shots.slice();
  // largest first; spread the missiles that stay home evenly (keep 2/3: every third one)
  return [...a.shots].sort((x, y) => costOf(y) - costOf(x)).filter((_, i) => Math.floor((i + 1) * home + 1e-9) === Math.floor(i * home + 1e-9));
}
/** rivals within reach tonight: the earned reach, plus 2 for All-in attack (it may pass reachMax by 2) */
export const reachOf = (a: { reach: number }, order: Order = "bal") => (a.reach || WAR.reach) + (WAR.orders[order] || WAR.orders.bal).reach;
/** A member's rival for tonight (LOOP.md c.2/c.4): the city that dealt the most damage (usdOf) to the member last night; raiders
 *  and Frontier lands are never a rival. canStrike: false when the member also hit that city last night (nobody is hit by the
 *  same rival two nights running). null: nothing hit the member. */
export function rivalOf(id: string, lastShots: Shot[]): { id: string; usd: number; canStrike: boolean } | null {
  const by = new Map<string, number>();
  for (const s of lastShots) if (s.d === id && s.a !== id && s.a !== RAIDERS && !s.a.startsWith("uc:") && !s.a.startsWith("~")) by.set(s.a, (by.get(s.a) || 0) + usdOf(s));
  const top = [...by.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (!top) return null;
  return { id: top[0], usd: top[1], canStrike: !lastShots.some(s => s.a === id && s.d === top[0] && s.f > 0) };
}
/** the commander rank for a season score (LOOP.md c.5): level 1 to 8, the name, the next rank and the dollars still to go */
export function rankOf(score: number): { level: number; name: string; score: number; at: number; next: string | null; nextAt: number | null; toNext: number | null; pct: number } {
  const R = WAR.ranks; let i = 0; for (let k = 0; k < R.length; k++) if ((score || 0) >= R[k]![1]) i = k;
  const nx = R[i + 1] || null, at = R[i]![1];
  return { level: i + 1, name: R[i]![0], score: Math.max(0, Math.round(score || 0)), at, next: nx ? nx[0] : null, nextAt: nx ? nx[1] : null, toNext: nx ? Math.max(0, nx[1] - (score || 0)) : null,
    pct: nx ? Math.max(0, Math.min(100, Math.round(100 * ((score || 0) - at) / (nx[1] - at)))) : 100 };
}
/** Today's orders (LOOP.md c.3): one Build, one Fight, one Scout. day: the orders' day (lastNight: they start again at 20:00 PT).
 *  Build: merge a pull request, or one counted commit for a member with no merged PR in 14 days. Fight changes by day (aim,
 *  orders, shield placement; the placement order only with a streak shield). Scout: the replay, or the season ranking when
 *  there was no battle last night. */
export type OrderKey = "build:pr" | "build:commit" | "fight:aim" | "fight:orders" | "fight:place" | "scout:replay" | "scout:season";
export function ordersFor(o: { day: number; prs14: number; canPlace: boolean; battled: boolean }): { kind: "build" | "fight" | "scout"; key: OrderKey; text: string; points: number }[] {
  const P = { build: 20, fight: 10, scout: 10 };
  const f = (["fight:aim", "fight:orders", "fight:place"] as OrderKey[])[((o.day % 3) + 3) % 3]!, fight: OrderKey = f === "fight:place" && !o.canPlace ? "fight:aim" : f;
  const T: Record<OrderKey, string> = { "build:pr": "Merge a pull request", "build:commit": "Push one counted commit", "fight:aim": "Aim one shot at a rival", "fight:orders": "Choose tonight's orders",
    "fight:place": "Place your shield", "scout:replay": "Watch last night's replay", "scout:season": "Open the season ranking" };
  const b: OrderKey = o.prs14 > 0 ? "build:pr" : "build:commit", sc: OrderKey = o.battled ? "scout:replay" : "scout:season";
  return [{ kind: "build", key: b, text: T[b], points: P.build }, { kind: "fight", key: fight, text: T[fight], points: P.fight }, { kind: "scout", key: sc, text: T[sc], points: P.scout }];
}
/** The badges of a member (LOOP.md c.5), in the order they show. nights: the member's stored nights, oldest first (res: the
 *  result word; out: shots fired). finals: the member's place at the end of each finished season. founding: the Founding Fleet. */
export function badgesFor(o: { nights: { night: number; res: Result; out: number }[]; finals?: { season: number; rank: number }[]; founding?: boolean }): { k: string; name: string; gold?: 1 }[] {
  const out: { k: string; name: string; gold?: 1 }[] = [], N = [...o.nights].sort((a, b) => a.night - b.night);
  if (N.some(n => n.res === "WON")) out.push({ k: "win", name: "First win" });
  let run = 0, best = 0, prev = -2; for (const n of N) { if (n.out > 0) { run = n.night === prev + 1 ? run + 1 : 1; prev = n.night; best = Math.max(best, run); } }
  if (best >= 7) out.push({ k: "streak7", name: "7-night streak" });
  if (N.some(n => n.res === "HELD")) out.push({ k: "held", name: "Shield held" });
  for (const f of [...(o.finals || [])].sort((a, b) => a.season - b.season)) {
    if (f.rank === 1) out.push({ k: "s" + f.season + ":1", name: `Season ${f.season} champion` });
    else if (f.rank <= 3) out.push({ k: "s" + f.season + ":3", name: `Season ${f.season} podium` });
    else if (f.rank <= 10) out.push({ k: "s" + f.season + ":10", name: `Season ${f.season} top 10` });
  }
  if (o.founding) out.push({ k: "founding", name: "Founding Fleet", gold: 1 });
  return out;
}

// ---------------------------------------------------------------- 5. the night
/** A seeded random stream (mulberry32): the same night in, the same dice out. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export interface Fighter {
  id: string; h: string; ars: Arsenal; sh: number; beg: boolean;
  /** lot codes of the plot as it stands */ lots: string;
  /** the city's buildings on the world map (repo towers): the only things a shot can hit; 0 = never a target (Mike 11-08: no green-space hits) */ towers: number;
  /** their map heights, tallest first (construction and value come from the height); absent: mid-rise blocks */ tw?: number[];
  side: number; /** points over the last 7 days, for matchmaking */ out7: number;
  /** team size: strength and score are per head, so a big team can't bully a solo builder */ heads: number;
  idle: number | null;
  /** tonight's orders (default Balanced) and the guarded tower (0..2; -1 or absent: the whole city), LOOP.md c.2 */ order?: Order; place?: number | null;
}
/** the working of one shot, kept with it so the page can show the sum: u $ of blast damage, fi the share of the tower the
 *  fire will take (fu in $), sp 1 = the fire spread, m metres off the aim point, cep the CEP it flew with, r the wreck radius
 *  (m), kpa the overpressure at the wall, c the construction class, fl floors, v the building's value ($), sh the share the
 *  shield took off, cd civil defence (x), st how much of the tower still stood (x), pc team share (x), raw the blast's share
 *  before those. With a shield: pot the blast $ without it, held the blast $ it took off (pot - u). Nights before 11-15: a
 *  blocked shot (100% shield) did nothing and pot was all of it. */
export interface ShotX { u: number; fi: number; fu: number; sp: 0 | 1; m: number; cep: number; r: number; kpa: number; c: number; fl: number; v: number; sh: number; cd: number; st: number; pc: number; raw: number; pot?: number; held?: number;
  /** an Armory bomb (armory.ts): its type key, the word that rises over the hit, and the bomb's row id */ bk?: string; word?: string; bid?: number }
/** f = the share of the tower the blast destroyed (1 = the whole tower); ammo = the missile's price, $ (points before 11-14) */
export interface Shot { k: number; a: string; d: string; w: Weapon; ammo: number; roll: number; f: number; lot: number; t: number; aim: 0 | 1; blocked: 0 | 1; x?: ShotX | null }
export interface NightIn {
  night: number; fighters: Fighter[];
  /** pairs "a>d" that landed a hit on the previous night (nobody is hit by the same rival two nights running) */ lastPairs?: Set<string>;
  /** defender -> towers' worth taken over the previous 6 nights (civil defence) */ week?: Map<string, number>;
  /** attacker -> targets they aimed at tonight, in order (manual fire, at most 3 shots) */ aims?: Map<string, string[]>;
  /** attacker -> the rival they strike back at tonight: one more aimed shot (the 4th), only when lastPairs allows it */ strikes?: Map<string, string>;
  /** defender -> lot index -> damage still showing from earlier nights (a wrecked tower has less left to wreck) */ open?: Map<string, Map<number, number>>;
  /** Armory bombs bought for this night (armory.ts). They fly after every normal shot, so a night nobody buys for is unchanged.
   *  target: a fighter id, or null for a random rival of the buyer */
  bombs?: NightBomb[];
  /** Frontier lands (frontier.ts): only an Armory bomb aimed at one can hit it. They fire nothing, have no shield and are
   *  nobody's rival. Ids are "uc:<login>". */ lands?: Fighter[];
}
export interface NightBomb { id: number; a: string; w: Weapon; k: string; word: string; target: string | null }
export const band = (side: number) => side <= 3 ? 0 : side <= 5 ? 1 : side <= 8 ? 2 : 3;
export const builtLots = (lots: string) => { const out: number[] = []; for (let i = 0; i < lots.length; i++) if (Number(lots[i]) >= 4) out.push(i); return out; };
export const targetable = (f: Fighter) => (f.idle === null || f.idle < WAR.idleDays) && (f.towers || 0) > 0;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4, r6 = (x: number) => Math.round(x * 1e6) / 1e6, r1 = (x: number) => Math.round(x * 10) / 10;
/** One detonation after the defences (11-14, Mike: "every missile strike needs to create damage"). The blast's share of the
 *  building (raw), times what still stands (st), civil defence (cd) and team share (pc), is at least WAR.floor: that is what
 *  the missile would do (pre). The shield takes its share off (ab = the shield, at most WAR.dome) and the rest lands:
 *  f = pre x (1 - ab). The fire burns on what landed: fi = f x the building's fire load x (spread 80% or contained 15%).
 *  Dollars: u = f x value (at least $1), fu = fi x value; with a shield, pot = pre x value and held = pot - u. f is never 0. */
export function strike(o: { raw: number; st: number; cd: number; pc: number; sh: number; load: number; sp: 0 | 1; value: number }) {
  const ab = Math.min(WAR.dome, Math.max(1 - WAR.throughMax / 100, o.sh || 0)), pre = Math.max(WAR.floor, o.raw * o.st * o.cd * o.pc), fire = o.load * (o.sp ? WAR.fire.spread : WAR.fire.small);
  const f = Math.max(1e-6, r6(pre * (1 - ab))), fi = r6(f * fire), u = Math.max(1, Math.round(f * o.value)), fu = Math.round(fi * o.value);
  const pot = Math.round(pre * o.value);
  return { ab, pre, f, fi, u, fu, pot, held: Math.max(0, pot - u), /** towers' worth coming in before the shield (civil defence) */ incoming: pre * (1 + fire) };
}
/** the raiders' ship, for shots fired out to sea: a masonry hull the size of a small block */
const SHIP = towerOf(40);
/** A night's stored shots run again through strike() with the same geometry and shields (operator dry run: what tonight's
 *  rules would have made of them). Civil defence is rebuilt in the resolver's firing order (attackers by id, heaviest
 *  first): each shot's stored cd gives the week's share, and tonight's share counts every missile coming in. */
export function restrike(shots: Shot[]): Shot[] {
  const rank = (w: string) => WAR.weapons.findIndex(x => x.k === weaponOf(w).k), order = shots.map((s, i) => i).sort((i, j) => { const a = shots[i]!, b = shots[j]!; return a.a < b.a ? -1 : a.a > b.a ? 1 : rank(a.w) - rank(b.w) || a.t - b.t; });
  const oldT = new Map<string, number>(), newT = new Map<string, number>(), out: Shot[] = shots.map(s => ({ ...s }));
  for (const i of order) {
    const s = shots[i]!, x = s.x; if (!x) continue;
    const week = Math.max(0, 1 / (x.cd || 1) - 1 - (oldT.get(s.d) || 0) / WAR.soft.night), cd = s.d === RAIDERS ? 1 : 1 / (1 + week + (newT.get(s.d) || 0) / WAR.soft.night);
    const cls = WAR.classes[x.c] || WAR.classes[0]!, k = strike({ raw: x.raw, st: x.st, cd, pc: x.pc, sh: x.sh, load: cls.load, sp: x.sp, value: x.v });
    oldT.set(s.d, (oldT.get(s.d) || 0) + s.f + x.fi); newT.set(s.d, (newT.get(s.d) || 0) + k.incoming);
    const { pot: _p, held: _h, ...rest } = x;
    out[i] = { ...s, f: k.f, blocked: 0, x: { ...rest, u: k.u, fi: k.fi, fu: k.fu, sh: k.ab, cd: Math.round(cd * 100) / 100, ...(k.ab > 0 ? { pot: k.pot, held: k.held } : {}) } };
  }
  return out;
}
/** the dollars a shot did: blast plus the whole fire; nights before 11-14 (no working kept) at the legacy rate */
export const usdOf = (s: Shot) => s.x ? s.x.u + s.x.fu : Math.round(s.f * WAR.legacyFacade);
/** the share of the tower a shot has taken by `now`: the blast, plus the fire so far */
export const dmgAt = (s: Shot, now: number) => s.f + (s.x ? burnt(s.x.fi, s.t, now) : 0);
/** blast and the whole fire, in towers' worth */
export const dmgAll = (s: Shot) => s.f + (s.x ? s.x.fi : 0);
/** The city that falls at the end of the night (Mike 11-14: "One city should be totally destroyed by the end of every battle,
 *  like in tiny little bit blocks, similar to the way things break up in Tron"): the defender that took the most damage that
 *  night in dollars (blast plus the whole fire, usdOf), the raiders' fleet included; ties go to more hits taken, then the id.
 *  null on a night with no shots. A battle-layer climax only: the replay and the Battle view show the city derezzed until the
 *  cranes rebuild it (whole by noon); the earned city, its land and its data are never touched. */
export function fallenOf(shots: Shot[]): string | null {
  const m = new Map<string, { usd: number; n: number }>();
  for (const s of shots) { const r = m.get(s.d) || { usd: 0, n: 0 }; r.usd += usdOf(s); r.n++; m.set(s.d, r); }
  const top = [...m.entries()].sort((a, b) => b[1].usd - a[1].usd || b[1].n - a[1].n || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0];
  return top ? top[0] : null;
}

/** Resolve one night. Deterministic for the same input. Raiders stand in for a missing fair rival, with the night's median
 *  budget (at least $500k, rockets at most), and they fire back. */
export function resolveNight(o: NightIn): { shots: Shot[]; raiders: string[]; fired: { id: number; k: number }[]; unfired: number[] } {
  const R = rng("night:" + o.night), T0 = battleAt(o.night), shots: Shot[] = [];
  const F = [...o.fighters].sort((a, b) => a.id < b.id ? -1 : 1), byId = new Map(F.map(f => [f.id, f] as [string, Fighter]));
  const landById = new Map((o.lands || []).map(f => [f.id, f] as [string, Fighter]));
  const targets = F.filter(targetable);
  const taken = new Map<string, number>();
  const lotDmg = new Map<string, Map<number, number>>();
  for (const [d, m] of o.open || []) lotDmg.set(d, new Map(m));
  const score = (a: Fighter, t: Fighter) => Math.abs(band(a.side) - band(t.side)) * 3 + Math.abs(Math.log2(1 + a.out7) - Math.log2(1 + t.out7)) + (t.beg ? 4 : 0);
  /** the night's rivals of a city: the fairest other cities within reach (never itself, never last night's victim), seeded per day */
  const rivalsOf = (a: Fighter): Fighter[] => {
    const c = targets.filter(t => t.id !== a.id && !o.lastPairs?.has(a.id + ">" + t.id));
    if (!c.length) return [];
    const jitter = new Map(c.map(t => [t.id, rng(`m:${o.night}:${a.id}:${t.id}`)() * 0.5] as [string, number]));
    return c.sort((x, y) => score(a, x) + jitter.get(x.id)! - (score(a, y) + jitter.get(y.id)!) || (x.id < y.id ? -1 : 1)).slice(0, reachOf(a.ars, a.order));
  };
  const fire = (aId: string, pc: number, cepX: number, w: Weapon, d: Fighter | null, aim: 0 | 1) => {
    const wp = weaponOf(w), miss = missOf(wp.cep * cepX, R()), uFire = R(), t = T0 + Math.floor(R() * 40 * 60_000);
    // lot = which of the defender's buildings the shot is aimed at: an index into its repo towers, tallest first (the map
    // sorts the same way); the least-hit of the top three, so hits spread and stack visibly. A shielded shot aims at a
    // building too: the map flashes the dome over that tower and the part that gets through lands on it, never on grass.
    let lot = -1, tower = SHIP, st = 1, cd = 1, sh = 0; const m = d ? lotDmg.get(d.id) || new Map<number, number>() : null;
    if (d && m) {
      lotDmg.set(d.id, m);
      const n = Math.max(1, d.towers || 0), cand = [0, 1, 2].filter(i => i < n).sort((x, y) => (m.get(x) || 0) - (m.get(y) || 0) || x - y);
      lot = cand[Math.floor(R() * cand.length)]!; tower = towerOf(d.tw?.[lot] ?? d.tw?.[d.tw.length - 1] ?? 60); sh = shieldAt(d, lot);   // tonight's orders and placement (LOOP.md c.2)
      st = 1 - Math.min(WAR.stand, m.get(lot) || 0);
      cd = 1 / (1 + (taken.get(d.id) || 0) / WAR.soft.night + (o.week?.get(d.id) || 0) / Math.max(1, WAR.soft.week * n));
    }
    const b = blast(wp.tnt, tower, miss), cls = WAR.classes[tower.c]!, sp = (uFire < wp.fire ? 1 : 0) as 0 | 1;
    const k = strike({ raw: b.raw, st, cd, pc, sh, load: cls.load, sp, value: tower.value });
    const x: ShotX = { u: k.u, fi: k.fi, fu: k.fu, sp, m: r1(miss), cep: r1(wp.cep * cepX), r: r1(b.r), kpa: Math.round(b.kpa), c: tower.c, fl: tower.floors, v: tower.value,
      sh: k.ab, cd: Math.round(cd * 100) / 100, st: Math.round(st * 100) / 100, pc: Math.round(pc * 100) / 100, raw: r4(b.raw), ...(k.ab > 0 ? { pot: k.pot, held: k.held } : {}) };
    // what landed wrecks the tower; civil defence counts everything that came in (the sirens go off for a shielded hit too)
    if (d && m) { m.set(lot, (m.get(lot) || 0) + k.f + k.fi); taken.set(d.id, (taken.get(d.id) || 0) + k.incoming); }
    shots.push({ k: shots.length, a: aId, d: d ? d.id : RAIDERS, w, ammo: wp.cost, roll: 0, f: k.f, lot, t, aim, blocked: 0, x });
  };
  const raided: string[] = [], rArs: number[] = F.map(f => f.ars.usd).filter(x => x > 0).sort((a, b) => a - b), armed = rArs.length;
  const med = Math.max(500_000, rArs.length ? rArs[Math.floor(rArs.length / 2)]! : 500_000);
  for (const a of F) {
    const pc = 1 / Math.max(1, a.heads), rivals = rivalsOf(a);
    const ok = (t: Fighter | undefined): t is Fighter => !!t && t.id !== a.id && targetable(t) && !o.lastPairs?.has(a.id + ">" + t.id);
    const aimed = (o.aims?.get(a.id) || []).map(id => byId.get(id)).filter(ok).slice(0, WAR.manualCap);
    const sb = o.strikes?.get(a.id), sbt = sb ? byId.get(sb) : undefined; if (ok(sbt)) aimed.push(sbt);   // strike back: a 4th aimed shot, one of the city's own missiles
    // city vs city: every shot goes to another city, spread round-robin over the night's rivals (a city never targets itself)
    firedOf(a.ars, a.order).forEach((w, i) => fire(a.id, pc, a.ars.cepX || 1, w, i < aimed.length ? aimed[i]! : rivals.length ? rivals[(i - aimed.length) % rivals.length]! : null, i < aimed.length ? 1 : 0));
    if (!rivals.length && targetable(a) && armed < 2) {   // a lone armed city with nobody to fight: raiders from the sea (they fire with the night's median budget)
      raided.push(a.id);
      for (const w of shotsFor(med, "rocket")) fire(RAIDERS, 1, 1, w, a, 0);
    }
  }
  // Armory bombs: after every normal shot (their own random stream, so the normal night is the same with or without them).
  // A bomb whose buyer is not fighting tonight, or that has no valid target, does not fire: the caller refunds it.
  const unfired: number[] = [], BR = rng("bombs:" + o.night);
  for (const bm of o.bombs || []) {
    const a = byId.get(bm.a); if (!a) { unfired.push(bm.id); continue; }
    let d: Fighter | null = bm.target ? byId.get(bm.target) || landById.get(bm.target) || null : null;
    if (d && (d.id === a.id || !targetable(d))) d = null;
    if (!d && bm.target) { unfired.push(bm.id); continue; }   // a named target that left the battles: refund rather than hit someone else
    if (!d) { const rv = rivalsOf(a); if (!rv.length) { unfired.push(bm.id); continue; } d = rv[Math.floor(BR() * rv.length)]!; }
    const n0 = shots.length; fire(a.id, 1 / Math.max(1, a.heads), a.ars.cepX || 1, bm.w, d, bm.target ? 1 : 0);
    const sh = shots[n0]!; sh.x = { ...(sh.x as ShotX), bk: bm.k, word: bm.word, bid: bm.id };
  }
  shots.sort((x, y) => x.t - y.t || x.k - y.k); shots.forEach((s, i) => s.k = i);
  return { shots, raiders: raided, fired: shots.filter(s => s.x?.bid != null).map(s => ({ id: s.x!.bid!, k: s.k })), unfired };
}

// ---------------------------------------------------------------- 6. regeneration (always, with zero player action)
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

// ---------------------------------------------------------------- 7. the season and per-capita scoring
export function season(night: number, launch: number) { const k = Math.max(0, night - launch); return { n: Math.floor(k / WAR.seasonDays) + 1, week: Math.floor((k % WAR.seasonDays) / 7) + 1, from: launch + Math.floor(k / WAR.seasonDays) * WAR.seasonDays }; }
/** $1,234,567 -> "$1.2M" */
export const fmtUsd = (n: number) => { const a = Math.abs(n); return a >= 1e9 ? `$${Math.round(n / 1e8) / 10}B` : a >= 1e6 ? `$${Math.round(n / 1e5) / 10}M` : a >= 1e4 ? `$${Math.round(n / 1e3)}k` : a >= 1e3 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`; };
/** the blast dollars a shield took off a shot: held (11-15 on), or all of pot on a blocked shot from before */
export const heldOf = (s: Shot) => s.x ? s.x.held ?? (s.blocked ? s.x.pot || 0 : 0) : s.blocked ? s.ammo / 10 * WAR.legacyFacade : 0;
/** dollars of damage dealt (blast and fire), plus half of what your shield held off, per head */
export function scoreOf(shots: (Shot & { night?: number })[], heads: (id: string) => number, fair: (night: number, id: string) => number = () => 1): Map<string, number> {
  const s = new Map<string, number>();
  for (const x of shots) {
    if (x.a !== RAIDERS) s.set(x.a, (s.get(x.a) || 0) + usdOf(x) * (x.night === undefined ? 1 : fair(x.night, x.a)) / Math.max(1, heads(x.a)));   // fair: the farm recount's share of that night's budget
    const h = x.d !== RAIDERS ? heldOf(x) : 0; if (h > 0) s.set(x.d, (s.get(x.d) || 0) + 0.5 * h / Math.max(1, heads(x.d)));
  }
  for (const [k, v] of s) s.set(k, Math.round(v));
  return s;
}

// ---------------------------------------------------------------- 8. "What your city did last night"
export interface Report {
  /** the Armory (armory-design C): custom bombs that hit you, and how yours did */ bombs?: { k: string; word: string; from: string; hit: number }[]; mine?: { n: number; hit: number; top: { k: string; word: string; on: string } | null } | null;
  night: string; h: string; peace: boolean;
  raids: { from: string; t: number; shots: number; landed: number; f: number }[];
  /** towers' worth taken (blast and fire) */ taken: number; /** towers hit */ tiers: number; rebuilt: number; fired: number; landed: number; on: string[]; /** towers' worth dealt */ dealt: number;
  /** dollars of damage taken and dealt, and how many of my towers caught a spreading fire */ takenUsd: number; dealtUsd: number; fires: number;
  /** blast dollars my shield took off the hits on me */ heldUsd: number;
  mvp: { repo: string; bricks: number } | null; shield: number; streak: number; built: number; ammo: number; /** the night's munitions budget, $ */ usd: number;
}
/** handles: id -> handle (RAIDERS -> "raiders from the sea") */
export function reportFor(id: string, h: string, shots: Shot[], o: { night: number; now: number; peace: boolean; pts: (d: number) => number; handle: (id: string) => string;
  mvp: { repo: string; bricks: number } | null; shield: number; streak: number; built: number; ammo: number; usd?: number }): Report {
  const mine = shots.filter(s => s.d === id), out = shots.filter(s => s.a === id), raids = new Map<string, Report["raids"][number]>();
  for (const s of mine) { const r = raids.get(s.a) || { from: o.handle(s.a), t: s.t, shots: 0, landed: 0, f: 0 }; r.shots++; if (s.f > 0) { r.landed++; r.f += dmgAll(s); } r.t = Math.min(r.t, s.t); raids.set(s.a, r); }
  const taken = mine.reduce((t, s) => t + dmgAll(s), 0), sofar = mine.reduce((t, s) => t + dmgAt(s, o.now), 0), left = mine.reduce((t, s) => t + remaining(dmgAt(s, o.now), s.t, o.now, o.pts), 0);
  const perLot = new Map<number, number>(); for (const s of mine) if (s.lot >= 0) perLot.set(s.lot, (perLot.get(s.lot) || 0) + s.f);
  const burning = new Set<number>(); for (const s of mine) if (s.f > 0 && s.x?.sp) burning.add(s.lot);
  return { night: dayKey(o.night), h, peace: o.peace, raids: [...raids.values()].map(r => ({ ...r, f: Math.round(r.f * 100) / 100 })).sort((a, b) => a.t - b.t),
    taken: Math.round(taken * 100) / 100, tiers: [...perLot.values()].filter(f => f > 0).length, rebuilt: sofar > 0 ? Math.round(100 * (1 - left / sofar)) : 100,
    fired: out.length, landed: out.filter(s => s.f > 0).length, on: [...new Set(out.filter(s => s.f > 0).map(s => o.handle(s.d)))], dealt: Math.round(out.reduce((t, s) => t + dmgAll(s), 0) * 100) / 100,
    takenUsd: mine.reduce((t, s) => t + usdOf(s), 0), dealtUsd: out.reduce((t, s) => t + usdOf(s), 0), fires: burning.size, heldUsd: mine.reduce((t, s) => t + heldOf(s), 0),
    mvp: o.mvp, shield: o.shield, streak: o.streak, built: o.built, ammo: o.ammo, usd: o.usd ?? Math.round(o.ammo * WAR.usd) };
}
/** the repo that laid the most bricks (counted commits) on a day; private repos stay nameless */
export function mvpOf(events: GEvent[], day: number): { repo: string; bricks: number } | null {
  const n = new Map<string, number>();
  for (const e of events) if (!e.v && (e.k === "commit" || e.k === "private") && dayOf(e.ts) === day) n.set(e.repo, (n.get(e.repo) || 0) + (Number(e.n) || 1));
  const top = [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return top ? { repo: top[0].startsWith("private:") || top[0] === "caldera" ? "a private repo" : top[0].split("/").pop()!, bricks: Math.round(top[1]) } : null;
}

// ---------------------------------------------------------------- 9. the battle-report email (opt-in; sending stays off until Mike says go)
export interface WorldLines { built: [string, number][]; hit: [string, number][]; attackers: [string, number][]; rebuilds: [string, number][]; stacked?: [string, number][]; rivalry: [string, string, number] | null; season: { n: number; week: number } }
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" });
const bName = (k: string) => k.charAt(0).toUpperCase() + k.slice(1), bq = (b: { k: string; word: string }) => `${bName(b.k)} "${b.word}"`;
const an = (k: string) => (/^[aeiou]/i.test(k) ? "an " : "a ") + bName(k);
export function battleSubject(r: Report): string {
  const hb = (r.bombs || []).filter(b => b.hit);
  if (hb.length >= 2) return `${hb.length} custom bombs hit your city last night`;
  if (hb.length === 1) return `${hb[0]!.from} hit you with ${an(hb[0]!.k)} ("${hb[0]!.word}")`;
  if (r.peace) return `Your city today: peaceful zone, ${r.built} lot${r.built === 1 ? "" : "s"} built`;
  if (!r.raids.length) return `Your city today: ${r.fired} missile${r.fired === 1 ? "" : "s"} stacked, no hits on your towers`;
  const who = r.raids.map(x => x.from).slice(0, 2).join(" and ");
  if (r.taken > 0 && r.heldUsd > r.takenUsd) return `Your city today: hit by ${who}, your shield cut it to ${fmtUsd(r.takenUsd)}`;
  return r.taken > 0 ? `Your city today: hit by ${who}, cranes rebuild tonight` : `Your city today: ${who} stopped by your shield`;
}
// ---------------------------------------------------------------- 9b. one night, one result word (LOOP.md section 0)
/** A member's night in one word, used by the mail, the picture, the cards and the points. The first that is true:
 *  FELL (the city is the night's fallenOf), WON (dealt > taken), HELD (shots came in and the shield held >= taken),
 *  LOST (any other night with shots in or out), QUIET (no shots in and none out). Dollars are usdOf / heldOf. */
export type Result = "FELL" | "WON" | "HELD" | "LOST" | "QUIET";
export function resultFrom(o: { fell: boolean; dealt: number; taken: number; held: number; shotsIn: number; shotsOut: number }): Result {
  if (!o.shotsIn && !o.shotsOut) return "QUIET";
  if (o.fell) return "FELL";
  if (o.dealt > o.taken) return "WON";
  if (o.shotsIn > 0 && o.held >= o.taken) return "HELD";
  return "LOST";
}
/** one city's night from the night's shots: its result word and its dollars */
export function nightOf(id: string, shots: Shot[]): { res: Result; dealt: number; took: number; held: number; shotsIn: number; shotsOut: number } {
  let dealt = 0, took = 0, held = 0, shotsIn = 0, shotsOut = 0;
  for (const s of shots) { if (s.a === id) { shotsOut++; dealt += usdOf(s); } if (s.d === id) { shotsIn++; took += usdOf(s); held += heldOf(s); } }
  const res = resultFrom({ fell: (shotsIn > 0 || shotsOut > 0) && fallenOf(shots) === id, dealt, taken: took, held, shotsIn, shotsOut });
  return { res, dealt, took, held, shotsIn, shotsOut };
}
/** the result word of one city for the night (pure; LOOP.md section 0) */
export const resultOf = (id: string, shots: Shot[]): Result => nightOf(id, shots).res;

/** The night in numbers, one source for the "Last night" card, the mail, the picture and the homepage block (LOOP.md section 0
 *  data rule): cities that fought, missiles that hit, total damage; the top 3 attackers by damage dealt (the first is the winner
 *  of the night) and the 3 cities hit hardest by damage taken. Raiders from the sea are left out of both lists, unless nobody
 *  else fired: then they are the only attacker. Ids, not handles. null on a night with no shots. */
export interface NightSum { night: string; cities: number; hits: number; usd: number; held: number; fallen: string | null; winner: string | null;
  tops: { id: string; usd: number; fired: number; landed: number }[]; hard: { id: string; usd: number; hits: number; held: number; down: boolean }[] }
export function nightSummary(shots: Shot[], o: { night: string; cities: number }): NightSum | null {
  if (!shots.length) return null;
  const att = new Map<string, { usd: number; fired: number; landed: number }>(), def = new Map<string, { usd: number; hits: number; held: number }>();
  for (const s of shots) {
    const a = att.get(s.a) || { usd: 0, fired: 0, landed: 0 }; a.usd += usdOf(s); a.fired++; if (s.f > 0) a.landed++; att.set(s.a, a);
    const d = def.get(s.d) || { usd: 0, hits: 0, held: 0 }; d.usd += usdOf(s); if (s.f > 0) d.hits++; d.held += heldOf(s); def.set(s.d, d);
  }
  const cmp = (x: [string, { usd: number }], y: [string, { usd: number }]) => y[1].usd - x[1].usd || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  const people = [...att.entries()].filter(([k]) => k !== RAIDERS), fallen = fallenOf(shots);
  const tops = (people.length ? people : [...att.entries()]).sort((x, y) => cmp(x, y) || y[1].landed - x[1].landed).slice(0, 3).map(([id, v]) => ({ id, usd: v.usd, fired: v.fired, landed: v.landed }));
  const hard = [...def.entries()].filter(([k, v]) => k !== RAIDERS && v.usd > 0).sort(cmp).slice(0, 3).map(([id, v]) => ({ id, usd: v.usd, hits: v.hits, held: v.held, down: id === fallen }));
  return { night: o.night, cities: o.cities, hits: shots.filter(s => s.f > 0).length, usd: shots.reduce((t, s) => t + usdOf(s), 0), held: shots.reduce((t, s) => t + heldOf(s), 0), fallen, winner: tops[0]?.id ?? null, tops, hard };
}

/** night n's battle ran on a Sunday evening, Pacific (WEEKLY.md 6.4: the weekly mail's day; the day of the battle, not of the send) */
export function sundayNight(n: number): boolean { const t = battleAt(n); return new Date(t + ptOff(t)).getUTCDay() === 0; }
/** The week up to night key `key` (WEEKLY.md 6.1): the 7 nights key-6 .. key, as night keys (the daily mail's dates).
 *  "2026-11-30" -> "Nov 24-30"; across two months "Nov 28-Dec 4". */
export function weekRange(key: string): string {
  const e = new Date(String(key) + "T12:00:00Z"); if (isNaN(+e)) return String(key ?? "");
  const s = new Date(+e - 6 * DAY), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear() ? `${M[s.getUTCMonth()]} ${s.getUTCDate()}-${e.getUTCDate()}` : `${M[s.getUTCMonth()]} ${s.getUTCDate()}-${M[e.getUTCMonth()]} ${e.getUTCDate()}`;
}
/** The week in numbers (WEEKLY.md 2 and 6.1), from the shots of up to 7 nights: battles (nights with shots), missiles that hit,
 *  total damage; the top 3 attackers by dollars dealt (the first is the winner of the week) and the 3 cities hit hardest by
 *  dollars taken. The raiders rule and the tie order of nightSummary. hits = shots with f > 0; nights = nights the city fired
 *  (tops) or took a hit (hard); fell = nights the city was that night's fallenOf. Ids, not handles. null: no night has shots. */
export interface WeekSum { battles: number; hits: number; usd: number; tops: { id: string; usd: number; hits: number; nights: number }[]; hard: { id: string; usd: number; hits: number; nights: number; fell: number }[] }
export function weekSummary(nights: { night: string | number; shots: Shot[] }[]): WeekSum | null {
  const att = new Map<string, { usd: number; hits: number; n: Set<string> }>(), def = new Map<string, { usd: number; hits: number; n: Set<string>; fell: number }>();
  let battles = 0, hits = 0, usd = 0;
  for (const nt of nights) {
    if (!nt.shots.length) continue;
    battles++; const k = String(nt.night), fallen = fallenOf(nt.shots);
    for (const s of nt.shots) {
      const u = usdOf(s); usd += u; if (s.f > 0) hits++;
      const a = att.get(s.a) || { usd: 0, hits: 0, n: new Set<string>() }; a.usd += u; if (s.f > 0) a.hits++; a.n.add(k); att.set(s.a, a);
      const d = def.get(s.d) || { usd: 0, hits: 0, n: new Set<string>(), fell: 0 }; d.usd += u; if (s.f > 0) { d.hits++; d.n.add(k); } def.set(s.d, d);
    }
    if (fallen) { const d = def.get(fallen); if (d) d.fell++; }
  }
  if (!battles) return null;
  const cmp = (x: [string, { usd: number }], y: [string, { usd: number }]) => y[1].usd - x[1].usd || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  const people = [...att.entries()].filter(([k]) => k !== RAIDERS);
  const tops = (people.length ? people : [...att.entries()]).sort(cmp).slice(0, 3).map(([id, v]) => ({ id, usd: v.usd, hits: v.hits, nights: v.n.size }));
  const hard = [...def.entries()].filter(([k, v]) => k !== RAIDERS && v.usd > 0).sort(cmp).slice(0, 3).map(([id, v]) => ({ id, usd: v.usd, hits: v.hits, nights: v.n.size, fell: v.fell }));
  return { battles, hits, usd, tops, hard };
}

// ---------------------------------------------------------------- 9c. the battle email (LOOP.md part a; spec 11-24 section 2)
const RES_WORD: Record<Result, string> = { WON: "won", HELD: "held", LOST: "lost", FELL: "fell", QUIET: "was quiet" };
/** "Last night: @{winner} won, your city {won too|held|lost|fell}"; the member is the winner: "Last night: your city won the
 *  battle". Weekly (WEEKLY.md 3.1): top = the winner of the week ("@h" or "raiders from the sea"), mine = the member is it. ASCII. */
export function loopSubject(o: { res: Result; winner: string | null; mine: boolean; weekly?: { n: number; w: number; fought: number; top: string | null; mine: boolean } | null }): string {
  if (o.weekly) {
    const k = o.weekly, n1 = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const s = !k.top ? `Last week: ${n1(k.n, "battle")}, your city ${k.fought ? `won ${k.w}` : "was not hit"}` : k.mine ? "Last week: your city won the week"
      : !k.fought ? `Last week: ${k.top} won, your city was not hit` : k.w ? `Last week: ${k.top} won, your city won ${k.w} of ${n1(k.fought, "night")}` : `Last week: ${k.top} won, your city fought ${n1(k.fought, "night")}`;
    return s.replace(/[^\x20-\x7e]/g, "");
  }
  if (o.mine) return "Last night: your city won the battle";
  const word = o.res === "WON" ? (o.winner ? "won too" : "won") : RES_WORD[o.res];
  return (o.winner ? `Last night: ${o.winner} won, your city ${word}` : `Last night: your city ${word}`).replace(/[^\x20-\x7e]/g, "");
}
export interface MailOpts {
  name: string; hub: string; unsub: string; postal: string; weekly?: boolean;
  /** this member got no battle mail before: the first-mail line */ first?: boolean;
  /** the 1200x630 picture's URL (battlecard.ts), and its alt text */ card?: string | null; alt?: string;
  /** one promoted card (part d), or null: no card and no empty box */ promo?: { title: string; line: string; handle: string; url: string; report: string } | null;
  /** the season's final top 3 (the mail after the last battle of a season), or null */ podium?: { h: string; usd: number }[] | null;
  /** season rank after the night, and its move since the night before (+ up, - down) */ rank?: number | null; move?: number;
  /** the result word and the night's winner ("@h"; mine = the member is the winner) for the subject */ res?: Result; winner?: string | null; mine?: boolean;
  /** weekly: battles in the week, nights the city won, nights it fought, lots built, dollars dealt and taken, and the season
   *  rank move of the week (rank 7 nights before minus rank now; null: no rank then) */ week?: { n: number; w: number; fought: number; lots: number; dealt: number; took: number; move: number | null } | null;
  /** weekly (WEEKLY.md 3.3): the world's week; the top 3 of the season board */
  world?: { range: string; battles: number; hits: number; usd: number; tops: { h: string; usd: number }[]; hard: { h: string; usd: number; fell: number }[]; leaders: { h: string; usd: number }[] } | null;
  /** weekly: why this member gets it (a daily member after a quiet Sunday, or a member who chose weekly) */ why?: "quiet" | "chose";
  /** the day of the night, for the wordmark row ("Nov 24") */ date?: string;
}
/** The battle mail: the picture and the two buttons first (Replay is easy to find), then the report as today, the podium at a
 *  season end, one promoted card, the footer. HTML: tables and inline styles only, light only. Text: the order of today.
 *  Weekly (o.weekly with o.week and o.world): the week in one mail (WEEKLY.md 3.3), the same shell, podium, card and footer. */
export function battleEmail(r: Report, w: WorldLines, o: MailOpts): { subject: string; text: string; html: string; preheader: string } {
  const first = (o.name || r.h).replace(/^@/, "").trim().split(/\s+/)[0] || r.h, hub = o.hub.replace(/\/$/, ""), n1 = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const replay = `${hub}/world?view=battle&replay=1`, tonight = `${hub}/world?view=battle#tonight`, prefs = `${hub}/world?view=battle#reports`;
  const weekly = !!(o.weekly && o.week && o.world);
  const pod = o.podium && o.podium.length ? o.podium.slice(0, 3) : null, sn = w.season.n;
  const podEnd = `The three winners keep a Season ${sn} badge. Season ${sn + 1} starts ${weekly ? "Monday" : "tonight"} at 20:00 PT.`;
  // html helpers (LOOP.md a.1; mailHtml() of the mockups)
  const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif", A = (u: string, t: string, col = "#6E4FE0") => `<a href="${esc(u)}" style="color:${col}">${t}</a>`;
  const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, m => `<a href="${m}" style="color:#6E4FE0">${m}</a>`);
  const P = (t: string) => `<p style="margin:0 0 10px">${t}</p>`, H = (t: string) => `<p style="margin:22px 0 8px;font:700 12px/1.3 ${FONT};letter-spacing:1.2px;color:#6B6878">${t}</p>`;
  const btn = (u: string, t: string, solid: boolean) => `<a href="${esc(u)}" style="display:inline-block;margin:0 8px 8px 0;padding:13px 22px;border-radius:999px;border:1px solid ${solid ? "#6D4AE8" : "#CFCBDD"};background:${solid ? "#6D4AE8" : "#ffffff"};color:${solid ? "#ffffff" : "#24222B"};font:600 15px/1.2 ${FONT};text-decoration:none">${t}</a>`;
  const td = "padding:7px 0;border-top:1px solid #EEECF4", PODC = ["#B07A0E", "#6B6878", "#9C5A2E"];
  const podHtml = pod ? `${H(`SEASON ${sn} FINAL`)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
${pod.map((p, i) => `<tr><td width="34" style="${td};font:700 18px/1 ${FONT};color:${PODC[i]}">${i + 1}</td><td style="${td};font-weight:600">${esc(p.h)}</td><td align="right" style="${td};font-weight:600">${esc(fmtUsd(p.usd))}</td></tr>`).join("")}</table>
${P(`<span style="color:#6B6878;font-size:13.5px">${esc(podEnd)} ${A(hub + "/leaderboard", "Full ranking")}</span>`)}` : "";
  const pr = o.promo, adHtml = pr ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border:1px solid #E4E2EC;border-radius:10px"><tr><td style="padding:14px 16px">
<p style="margin:0 0 6px;font:700 11px/1.3 ${FONT};letter-spacing:1.2px;color:#6B6878">BUILT BY THE FLEET</p>
<p style="margin:0 0 2px;font:600 16px/1.35 ${FONT}"><a href="${esc(pr.url)}" style="color:#24222B;text-decoration:none">${esc(pr.title)}</a></p>
<p style="margin:0 0 8px;color:#4A4758">${esc(pr.line)}</p>
<p style="margin:0;font-size:12.5px;color:#6B6878">Promoted by @${esc(pr.handle.replace(/^@/, ""))} with Caldera Points. ${A(pr.url, "View project")} &nbsp; ${A(pr.report, "Report", "#6B6878")}</p></td></tr></table>` : "";
  const img = (alt0: string) => o.card ? `<a href="${esc(replay)}" style="display:block;background:#0B0D13;border-radius:10px;color:#F4F6FA;font-size:14px;text-decoration:none"><img src="${esc(o.card)}" width="560" height="294" alt="${esc(o.alt || alt0)}" style="display:block;width:100%;height:auto;border:0;border-radius:10px;color:#F4F6FA;background:#0B0D13;font:14px/1.4 sans-serif"></a>` : "";
  const footHtml = `<p style="margin:26px 0 0;padding:14px 0 0;border-top:1px solid #EEECF4;font-size:12.5px;line-height:1.7;color:#6B6878">Season ${sn}, week ${w.season.week}. ${A(hub + "/leaderboard", "Leaderboard")}<br>You get this because your city is in the Caldera battle. ${A(prefs, "Daily, weekly or off")} &nbsp; ${A(o.unsub, "Unsubscribe")}<br>${esc(o.postal)}</p>`;
  const footText = ["", `Season ${sn}, week ${w.season.week}. Leaderboard: ${hub}/leaderboard`, `You get this because your city is in the Caldera battle. Daily, weekly or off: ${prefs}`, `Unsubscribe: ${o.unsub}`, "", o.postal];
  const tailText = (T: string[]) => {
    if (pod) T.push("", `SEASON ${sn} FINAL`, ...pod.map((p, i) => `${i + 1} ${p.h} ${fmtUsd(p.usd)}`), `${podEnd} Full ranking: ${hub}/leaderboard`);
    if (o.promo) T.push("", "BUILT BY THE FLEET", `${o.promo.title}: ${o.promo.url}`, o.promo.line, `Promoted by @${o.promo.handle.replace(/^@/, "")} with Caldera Points. Report: ${o.promo.report}`);
    T.push(...footText); return T.join("\n").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
  };
  const shell = (subject: string, preheader: string, firstHtml: string, head: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:20px 14px;background:#ffffff;color:#24222B;font:15px/1.55 ${FONT}">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px"><tr><td style="text-align:left">
${firstHtml}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px"><tr><td style="font:700 18px/1.2 Georgia,'Times New Roman',serif;color:#24222B">Caldera</td><td align="right" style="font-size:13px;color:#6B6878">${esc(head)}</td></tr></table>
${body}
${podHtml}${adHtml}
${footHtml}
</td></tr></table></td></tr></table></body></html>`;

  if (weekly) {
    // ---------------------------------------------------------------- the weekly mail (WEEKLY.md 3; words() of the mockup)
    const k = o.week!, wd = o.world!, RANGE = wd.range.toUpperCase(), fought = k.fought > 0, why = o.why || "chose";
    const top = wd.tops[0]?.h ?? null;
    const lots = k.lots > 0 ? (fought ? ` ${n1(k.lots, "lot")} built.` : ` You built ${n1(k.lots, "lot")}.`) : "";
    const city = fought ? `Your city fought in ${k.fought} of ${n1(k.n, "battle")}${k.w ? ` and won ${k.w}` : ""}. It dealt ${fmtUsd(k.dealt)} of damage and took ${fmtUsd(k.took)} (all rebuilt on its own).${lots}`
      : `A calm week for your city: no missiles came your way in ${n1(k.n, "battle")}, and it fired none.${lots}`;
    const invite = fought ? "The next battle is Monday at 20:00 PT. Defenses lock at 19:45 PT." : "Monday's battle is at 20:00 PT. Set your defenses, and the code you push before 19:45 PT becomes your missiles.";
    const rank = !o.rank ? null : `Season rank ${o.rank}${fought && k.move != null ? (k.move > 0 ? `, up ${k.move} in the week` : k.move < 0 ? `, down ${-k.move} in the week` : ", no change in the week") : ""}.`;
    const world = [`${n1(wd.battles, "battle")}, ${n1(wd.hits, "missile")} hit, ${fmtUsd(wd.usd)} of damage.`];
    if (wd.tops.length) world.push(`Most damage dealt: ${wd.tops.map(t => `${t.h} (${fmtUsd(t.usd)})`).join(", ")}`);
    if (wd.hard.length) world.push(`Hit the hardest: ${wd.hard.map(t => `${t.h} (${fmtUsd(t.usd)}${t.fell ? `, fell on ${n1(t.fell, "night")}` : ""})`).join(", ")}`);
    if (!pod && wd.leaders.length) world.push(`Season ${sn} top ${Math.min(3, wd.leaders.length)}: ${wd.leaders.slice(0, 3).map(t => `${t.h} ${fmtUsd(t.usd)}`).join(", ")}`);
    const firstL = !o.first ? null : why === "chose" ? ["You get this each Sunday after the battle.", "Daily or off"] : ["You get a mail after each battle your city fights, and this summary after a quiet Sunday.", "Weekly or off"];
    const lead = why === "quiet" ? "Sunday night was quiet for your city, so here is the whole week in one mail." : null;
    const subject = loopSubject({ res: o.res || "QUIET", winner: null, mine: false, weekly: { n: k.n, w: k.w, fought: k.fought, top, mine: !!o.mine } });
    const preheader = fought ? `Dealt ${fmtUsd(k.dealt)}, took ${fmtUsd(k.took)} in ${n1(k.fought, "night")}.${o.rank ? ` Season rank ${o.rank}.` : ""} Next battle Monday at 20:00 PT.`
      : `No missiles came your way in ${n1(k.n, "battle")}. Next battle Monday at 20:00 PT. Set your defenses by 19:45 PT.`;
    const T: string[] = [];
    if (firstL) T.push(`${firstL[0]} ${firstL[1]}: ${prefs}`, "");
    T.push(`Hey ${first},`, ""); if (lead) T.push(lead, "");
    T.push(`YOUR CITY, ${RANGE}`, city, invite); if (rank) T.push(rank);
    T.push(`Set tonight's defenses: ${tonight}`, `Watch the replay: ${replay}`, "", `THE WORLD, ${RANGE}`, ...world);
    const text = tailText(T);
    const firstHtml = firstL ? `<p style="margin:0 0 14px;font-size:13px;color:#6B6878">${esc(firstL[0])} ${A(prefs, firstL[1])}.</p>` : "";
    const body = `${img(`Caldera week in battle, ${wd.range}.`)}
<div style="padding:16px 0 4px">${btn(tonight, "Set tonight's defenses", true)}${btn(replay, "Watch the replay", false)}</div>
${P(`Hey ${esc(first)},`)}${lead ? P(esc(lead)) : ""}
${H(`YOUR CITY, ${esc(RANGE)}`)}${P(esc(city))}${P(`${esc(invite)} ${A(tonight, "Set tonight's defenses")}`)}${rank ? P(esc(rank)) : ""}
${H(`THE WORLD, ${esc(RANGE)}`)}${world.map(l => P(esc(l))).join("")}`;
    return { subject: subject.replace(/[^\x20-\x7e]/g, ""), text, html: shell(subject, preheader, firstHtml, `Week in battle, ${wd.range}`, body), preheader };
  }

  const res = o.res || "LOST", mv = o.move || 0;
  const rankLine = o.rank ? `Season rank ${o.rank}${mv > 0 ? `, up ${mv}` : mv < 0 ? `, down ${-mv}` : ", no change"}.` : null;
  // YOUR CITY
  const C: string[] = [];
  if (r.peace) { C.push(`Peaceful zone: no missiles in or out.`, r.built ? `${n1(r.built, "lot")} built yesterday.` : "No new lots yesterday."); }
  else {
    C.push(r.fired ? `Armed by 19:45 PT: ${n1(r.fired, "missile")} bought with a ${fmtUsd(r.usd)} budget (the day's work).` : "Nothing armed by 19:45 PT: no work counted that day.");
    if (r.fired) C.push(`Salvo at 20:00 PT: ${r.fired} fired, ${r.landed} landed${r.on.length ? " on " + r.on.slice(0, 3).join(", ") : ""}${r.dealtUsd > 0 ? `, ${fmtUsd(r.dealtUsd)} of damage` : ""}.`);
    if (!r.raids.length) C.push("No missiles came your way.");
    else C.push(r.taken > 0 ? `Hits on your towers: ${fmtUsd(r.takenUsd)} of damage from ${r.raids.map(x => x.from).join(", ")}${r.tiers ? ` (${n1(r.tiers, "tower")} hit${r.fires ? `, ${r.fires} caught fire` : ""})` : ""}.${r.heldUsd > 0 ? ` Your shield took ${fmtUsd(r.heldUsd)} off.` : ""}${res === "FELL" ? " Your city fell." : ""} Cranes rebuild overnight, whole by noon.` : `Your shield held: ${r.raids.map(x => x.from).join(", ")} fired at you, nothing landed.`);
    const bs = r.bombs || [];
    if (bs.length) C.push(`Custom bombs on you: ${bs.length}. ${bs.slice(0, 5).map(b => `${bq(b)} from ${b.from}`).join(", ")}${bs.length > 5 ? `, and ${bs.length - 5} more` : ""}.`);
    if (r.mine) C.push(`Your bombs: ${r.mine.n} flew, ${r.mine.hit ? `${r.mine.hit} hit.${r.mine.top ? ` ${bq(r.mine.top)} hit ${r.mine.top.on}.` : ""}` : "none hit: shields held."}`);
    if (bs.length || r.mine) C.push(`Armory for the next battle: ${hub}/world?view=battle#armory`);
    C.push(`Shield ${Math.round(r.shield * 100)}%${r.streak ? ` (${r.streak}-day streak)` : ""}.`);
    if (rankLine) C.push(rankLine);
    if (r.mvp) C.push(`MVP: ${r.mvp.repo}, ${n1(r.mvp.bricks, "brick")} laid.`);
  }
  // TODAY IN THE WORLD
  const W: string[] = [], list = (xs: [string, number][], f: (n: number) => string) => xs.map(([h, n]) => `${h} ${f(n)}`).join(", ");
  if (w.stacked && w.stacked.length) W.push(`Most ammo stacked: ${list(w.stacked, n => n1(n, "missile"))}`);
  if (w.built.length) W.push(`Built the most: ${list(w.built, n => n1(n, "lot"))}`);
  if (!r.peace) {
    if (w.hit.length) W.push(`Towers hit the hardest: ${list(w.hit, n => `(${fmtUsd(n)})`)}`);
    if (w.attackers.length) W.push(`Most hits landed: ${list(w.attackers, n => n1(n, "hit"))}`);
    if (w.rivalry) W.push(`Rivalry of the day: ${w.rivalry[0]} vs ${w.rivalry[1]}${w.rivalry[2] > 1 ? `, ${w.rivalry[2]} days running` : ""}`);
    W.push("Cranes rebuild every tower overnight; by noon the world stands as it did.");
  }
  // text: the order of today
  const T: string[] = [];
  if (o.first) T.push(`You get this after each nightly battle. Weekly or off: ${prefs}`, "");
  T.push(`Hey ${first},`, "");
  T.push("YOUR CITY", ...C, `Watch the replay: ${replay}`, `Set tonight's defenses: ${tonight}`, "", "TODAY IN THE WORLD", ...W);
  const text = tailText(T);
  const subject = (o.res ? loopSubject({ res, winner: o.winner ?? null, mine: !!o.mine }) : battleSubject(r)).replace(/[^\x20-\x7e]/g, "");
  const preheader = `Dealt ${fmtUsd(r.dealtUsd)}, took ${fmtUsd(r.takenUsd)}, shield held ${fmtUsd(r.heldUsd)}.${o.rank ? ` Season rank ${o.rank}.` : ""} Next battle tonight at 20:00 PT.`;
  const firstHtml = o.first ? `<p style="margin:0 0 14px;font-size:13px;color:#6B6878">You get this after each nightly battle. ${A(prefs, "Weekly or off")}.</p>` : "";
  const body = `${img("Caldera battle, last night.")}
<div style="padding:16px 0 4px">${btn(replay, "Watch the replay", true)}${btn(tonight, "Set tonight's defenses", false)}</div>
${P(`Hey ${esc(first)},`)}
${H("YOUR CITY")}${C.map(l => P(linkify(l))).join("")}
${H("TODAY IN THE WORLD")}${W.map(l => P(linkify(l))).join("")}`;
  return { subject, text, html: shell(subject, preheader, firstHtml, `Nightly battle, ${o.date || dateLong(r.night)}`, body), preheader };
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-24" -> "Nov 24" */
export const dateLong = (key: string) => { const d = new Date(String(key) + "T12:00:00Z"); return isNaN(+d) ? String(key ?? "") : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
/** The daily feed post, in Caldera's own voice (no sign-off): who stacked the most, the salvo, the towers hit, the cranes,
 *  the replay and the leaderboard. null when there was no battle that day. */
/** Who the daily summary names, from the same numbers it prints: the top 3 by ammo stacked, the top 4 cities hit. */
export function summaryNames(shots: Shot[]): { top: [string, number][]; hit: [string, { f: number; towers: Set<number> }][] } {
  const stacked = new Map<string, number>(), hit = new Map<string, { f: number; towers: Set<number> }>();
  for (const s of shots) { if (s.a !== RAIDERS) stacked.set(s.a, (stacked.get(s.a) || 0) + 1); if (s.f > 0 && s.d !== RAIDERS) { const h = hit.get(s.d) || { f: 0, towers: new Set<number>() }; h.f += usdOf(s); if (s.lot >= 0) h.towers.add(s.lot); hit.set(s.d, h); } }
  return { top: [...stacked.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3), hit: [...hit.entries()].sort((a, b) => b[1].f - a[1].f).slice(0, 4) };
}
export function battleSummary(shots: Shot[], o: { night: string; handle: (id: string) => string; hub: string }): string | null {
  if (!shots.length) return null;
  const hub = o.hub.replace(/\/$/, ""), n1 = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`, d = new Date(o.night + "T12:00:00Z"), MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const total = shots.reduce((t, s) => t + usdOf(s), 0), named = summaryNames(shots), top = named.top, hitTop = named.hit;
  const landed = shots.filter(s => s.f > 0).length, raiders = shots.filter(s => s.a === RAIDERS).length, held = shots.reduce((t, s) => t + heldOf(s), 0);
  const L = [`Battle day, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}.`];
  L.push(top.length ? `Most ammo stacked: ${top.map(([id, n]) => `${o.handle(id)} ${n1(n, "missile")}`).join(", ")}${raiders ? `; raiders from the sea brought ${raiders}` : ""}.` : `Only raiders from the sea fired today (${n1(raiders, "missile")}).`);
  L.push(`The 20:00 salvo: ${n1(shots.length, "missile")}, ${landed} landed${total > 0 ? `, ${fmtUsd(total)} of damage` : ""}${landed && held > 0 ? ` (shields took ${fmtUsd(held)} off)` : ""}.`);
  L.push(hitTop.length ? `Towers hit: ${hitTop.map(([id, h]) => `${o.handle(id)} (${n1(h.towers.size, "tower")}, ${fmtUsd(h.f)})`).join("; ")}.` : "No towers hit: every shield held.");
  L.push("Cranes rebuild overnight; by noon every tower stands as it did.", `Replay: ${hub}/world?view=battle&replay=1`, `Leaderboard: ${hub}/leaderboard`);
  return L.join("\n").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}
/** The world section of the email, from the night's shots and yesterday's growth stats */
export function worldLines(shots: Shot[], o: { handle: (id: string) => string; built: [string, number][]; rebuilt: [string, number][]; pairsByNight: Set<string>[]; season: { n: number; week: number } }): WorldLines {
  const hit = new Map<string, number>(), att = new Map<string, number>(), pair = new Map<string, number>(), stk = new Map<string, number>();
  for (const s of shots) { if (s.a !== RAIDERS) stk.set(s.a, (stk.get(s.a) || 0) + 1); if (s.d !== RAIDERS && s.f > 0) hit.set(s.d, (hit.get(s.d) || 0) + usdOf(s)); if (s.a !== RAIDERS && s.f > 0) att.set(s.a, (att.get(s.a) || 0) + 1);
    if (s.a !== RAIDERS && s.d !== RAIDERS) { const k = [s.a, s.d].sort().join("|"); pair.set(k, (pair.get(k) || 0) + 1); } }
  const top = (m: Map<string, number>): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([k, v]) => [o.handle(k), Math.round(v * 10) / 10]);   // hit: dollars
  let rivalry: [string, string, number] | null = null;
  const best = [...pair.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (best) { const [a, b] = best[0].split("|"); let n = 1; for (const s of o.pairsByNight) { if (s.has(best[0])) n++; else break; } rivalry = [o.handle(a!), o.handle(b!), n]; }
  return { built: o.built.slice(0, 3), hit: top(hit), attackers: top(att), rebuilds: o.rebuilt.slice(0, 3), stacked: top(stk), rivalry, season: o.season };
}

// ---------------------------------------------------------------- storage
type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export type ReportFreq = "off" | "daily" | "weekly";
export interface OptRow { p: string; war: 0 | 1; /** 1 = chose to leave the battles (every city is in unless it opts out) */ out: 0 | 1; since: number; waive: 0 | 1; report: ReportFreq; token: string; sent: string | null;
  /** 1 = the member chose a frequency (or unsubscribed); 0 = never chose, so the mail is daily (spec 11-24 section 2) */ chose: 0 | 1; /** the night key of the first battle mail sent, or null (the first-mail line) */ first: string | null }
/** The frequency that applies (spec 11-24 section 2): a member who never chose gets the daily mail; weekly and off choices stay. */
export const freqOf = (o: Pick<OptRow, "report" | "chose"> | null | undefined): ReportFreq => !o ? "daily" : o.chose || o.report !== "off" ? o.report : "daily";
export function battleStore(q: Q, newToken: () => string) {
  q(`CREATE TABLE IF NOT EXISTS battle_opt (profile TEXT PRIMARY KEY, war INTEGER, since INTEGER, waive INTEGER, report TEXT, token TEXT UNIQUE, sent TEXT, at INTEGER)`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_aims (night INTEGER, attacker TEXT, target TEXT, ts INTEGER, PRIMARY KEY (night, attacker, target))`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_nights (night INTEGER PRIMARY KEY, at INTEGER, json TEXT)`).run();
  try { q("ALTER TABLE battle_opt ADD COLUMN out INTEGER").run(); } catch { /* already there */ }   // Mike 11-08: every city is a combatant; out = chose to leave
  try { q("ALTER TABLE battle_opt ADD COLUMN chose INTEGER").run(); } catch { /* already there */ }   // 11-24: a member who never chose gets the daily mail
  try { q("ALTER TABLE battle_opt ADD COLUMN first TEXT").run(); } catch { /* already there */ }   // 11-24: the night of the first battle mail (LOOP.md a.2 first-mail line)
  q(`CREATE TABLE IF NOT EXISTS battle_shots (night INTEGER, k INTEGER, a TEXT, d TEXT, w TEXT, ammo REAL, roll INTEGER, f REAL, lot INTEGER, t INTEGER, aim INTEGER, blocked INTEGER, PRIMARY KEY (night, k))`).run();
  q(`CREATE INDEX IF NOT EXISTS battle_shots_d ON battle_shots (d, night)`).run();
  try { q("ALTER TABLE battle_shots ADD COLUMN x TEXT").run(); } catch { /* already there */ }   // 11-13: the working of each shot (ShotX)
  q(`CREATE TABLE IF NOT EXISTS battle_meta (k TEXT PRIMARY KEY, v TEXT)`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_fair (night INTEGER, profile TEXT, x REAL, PRIMARY KEY (night, profile))`).run();   // the farm recount (11-24): share of a past night's budget that real work earned
  // the evening turn (LOOP.md c.10): aims as a list (the same rival can take up to 3 shots), tonight's orders and strike back per
  // member per night, the guarded tower per member (it stays until the member changes it), the summary card seen, the rank list
  q(`CREATE TABLE IF NOT EXISTS battle_aimq (night INTEGER, attacker TEXT, k INTEGER, target TEXT, ts INTEGER, PRIMARY KEY (night, attacker, k))`).run();
  if (!(q("SELECT 1 FROM battle_meta WHERE k='aimq'").get())) { q("INSERT OR IGNORE INTO battle_aimq SELECT night, attacker, rowid, target, ts FROM battle_aims").run(); q("INSERT OR REPLACE INTO battle_meta VALUES ('aimq','1')").run(); }
  q(`CREATE TABLE IF NOT EXISTS battle_turn (night INTEGER, profile TEXT, ord TEXT, ord_at INTEGER, strike TEXT, at INTEGER, PRIMARY KEY (night, profile))`).run();
  try { q("ALTER TABLE battle_opt ADD COLUMN place INTEGER").run(); } catch { /* already there */ }
  try { q("ALTER TABLE battle_opt ADD COLUMN place_at INTEGER").run(); } catch { /* already there */ }
  q(`CREATE TABLE IF NOT EXISTS battle_seen (profile TEXT, night INTEGER, at INTEGER, PRIMARY KEY (profile, night))`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_ranks (night INTEGER, profile TEXT, rank INTEGER, score REAL, PRIMARY KEY (night, profile))`).run();
  const map = (r: any): OptRow => ({ p: r.profile, war: r.war ? 1 : 0, out: r.out ? 1 : 0, since: r.since || 0, waive: r.waive ? 1 : 0, report: (["daily", "weekly"].includes(r.report) ? r.report : "off") as ReportFreq, token: r.token, sent: r.sent || null, chose: r.chose ? 1 : 0, first: r.first || null });
  const opt = (p: string): OptRow | null => { const r = q("SELECT * FROM battle_opt WHERE profile=?").get(p); return r ? map(r) : null; };
  const ensure = (p: string): OptRow => { if (!opt(p)) q("INSERT OR IGNORE INTO battle_opt (profile, war, since, waive, report, token, sent, at, out) VALUES (?,?,?,?,?,?,?,?,?)").run(p, 1, 0, 0, "off", newToken(), null, Date.now(), 0); return opt(p)!; };
  const shotRow = (r: any): Shot => ({ k: r.k, a: r.a, d: r.d, w: r.w, ammo: r.ammo, roll: r.roll, f: r.f, lot: r.lot, t: r.t, aim: r.aim ? 1 : 0, blocked: r.blocked ? 1 : 0, x: (() => { try { return r.x ? JSON.parse(r.x) : null; } catch { return null; } })() });
  return {
    opt, ensure,
    opts: (): OptRow[] => (q("SELECT * FROM battle_opt").all() as any[]).map(map),
    setWar: (p: string, on: boolean, at: number) => { ensure(p); q("UPDATE battle_opt SET war=?, since=?, at=?, out=? WHERE profile=?").run(on ? 1 : 0, on ? at : 0, at, on ? 0 : 1, p); },
    setWaive: (p: string, on: boolean) => { ensure(p); q("UPDATE battle_opt SET waive=? WHERE profile=?").run(on ? 1 : 0, p); },
    setReport: (p: string, f: ReportFreq) => { ensure(p); q("UPDATE battle_opt SET report=?, chose=1 WHERE profile=?").run(f, p); },
    markFirst: (p: string, day: string) => q("UPDATE battle_opt SET first=? WHERE profile=? AND first IS NULL").run(day, p),
    byToken: (t: string): OptRow | null => { const r = q("SELECT * FROM battle_opt WHERE token=?").get(t); return r ? map(r) : null; },
    markSent: (p: string, day: string) => q("UPDATE battle_opt SET sent=? WHERE profile=?").run(day, p),
    aims: (night: number): Map<string, string[]> => { const m = new Map<string, string[]>(); for (const r of q("SELECT * FROM battle_aimq WHERE night=? ORDER BY ts, k").all(night) as any[]) { if (!m.has(r.attacker)) m.set(r.attacker, []); m.get(r.attacker)!.push(r.target); } return m; },
    aimsOf: (night: number, p: string): string[] => (q("SELECT target FROM battle_aimq WHERE night=? AND attacker=? ORDER BY ts, k").all(night, p) as any[]).map(r => r.target),
    /** one more shot at a target (a list: the same rival may take several) */
    aim: (night: number, p: string, target: string, at: number) => { const k = Number((q("SELECT COALESCE(MAX(k),0) k FROM battle_aimq WHERE night=? AND attacker=?").get(night, p) as any).k) + 1; q("INSERT INTO battle_aimq VALUES (?,?,?,?,?)").run(night, p, k, target, at); },
    /** one shot less at a target (the newest); all: every shot at it */
    unaim: (night: number, p: string, target: string, all = false) => all ? q("DELETE FROM battle_aimq WHERE night=? AND attacker=? AND target=?").run(night, p, target)
      : q("DELETE FROM battle_aimq WHERE night=? AND attacker=? AND k=(SELECT MAX(k) FROM battle_aimq WHERE night=? AND attacker=? AND target=?)").run(night, p, night, p, target),
    /** tonight's orders and strike back (LOOP.md c.2) of one member for night n; absent: Balanced, no strike back */
    turn: (night: number, p: string): { ord: Order; ordAt: number | null; strike: string | null; at: number | null } => { const r = q("SELECT * FROM battle_turn WHERE night=? AND profile=?").get(night, p) as any;
      return { ord: (["atk", "bal", "tur"].includes(r?.ord) ? r.ord : "bal") as Order, ordAt: r?.ord_at ?? null, strike: r?.strike || null, at: r?.at ?? null }; },
    turns: (night: number): Map<string, { ord: Order; strike: string | null }> => new Map((q("SELECT * FROM battle_turn WHERE night=?").all(night) as any[]).map(r => [r.profile, { ord: (["atk", "bal", "tur"].includes(r.ord) ? r.ord : "bal") as Order, strike: r.strike || null }] as [string, { ord: Order; strike: string | null }])),
    setTurn: (night: number, p: string, o: { ord?: Order; strike?: string | null }, at: number) => {
      q("INSERT OR IGNORE INTO battle_turn (night, profile, ord, ord_at, strike, at) VALUES (?,?,?,?,?,?)").run(night, p, "bal", null, null, at);
      if (o.ord) q("UPDATE battle_turn SET ord=?, ord_at=?, at=? WHERE night=? AND profile=?").run(o.ord, at, at, night, p);
      if (o.strike !== undefined) q("UPDATE battle_turn SET strike=?, at=? WHERE night=? AND profile=?").run(o.strike, at, night, p);
    },
    /** the guarded tower (0..2) or -1 for the whole city; it stays until the member changes it */
    place: (p: string): { place: number; at: number | null } => { const r = q("SELECT place, place_at FROM battle_opt WHERE profile=?").get(p) as any; return { place: r?.place == null ? -1 : Number(r.place), at: r?.place_at ?? null }; },
    setPlace: (p: string, place: number, at: number) => { ensure(p); q("UPDATE battle_opt SET place=?, place_at=? WHERE profile=?").run(place < 0 ? null : place, at, p); },
    seen: (p: string, night: number) => !!q("SELECT 1 FROM battle_seen WHERE profile=? AND night=?").get(p, night),
    setSeen: (p: string, night: number, at: number) => q("INSERT OR IGNORE INTO battle_seen VALUES (?,?,?)").run(p, night, at),
    /** the season rank list stored after a night (prevRank, "up 3"); null: not stored */
    ranks: (night: number): Map<string, number> | null => { const r = q("SELECT profile, rank FROM battle_ranks WHERE night=?").all(night) as any[]; return r.length ? new Map(r.map(x => [x.profile, Number(x.rank)] as [string, number])) : null; },
    setRanks: (night: number, rows: [string, number, number][]) => { q("DELETE FROM battle_ranks WHERE night=?").run(night); for (const [p, rank, score] of rows) q("INSERT INTO battle_ranks VALUES (?,?,?,?)").run(night, p, rank, score); },
    dropRanks: (from = -1) => q("DELETE FROM battle_ranks WHERE night>=?").run(from),
    night: (n: number): any | null => { const r = q("SELECT json FROM battle_nights WHERE night=?").get(n); try { return r ? JSON.parse(r.json) : null; } catch { return null; } },
    hasNight: (n: number) => !!q("SELECT 1 FROM battle_nights WHERE night=?").get(n),
    saveNight: (n: number, meta: unknown, shots: Shot[], at: number) => {
      q("BEGIN").run();
      try {
        q("DELETE FROM battle_shots WHERE night=?").run(n);
        for (const s of shots) q("INSERT INTO battle_shots (night, k, a, d, w, ammo, roll, f, lot, t, aim, blocked, x) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(n, s.k, s.a, s.d, s.w, s.ammo, s.roll, s.f, s.lot, s.t, s.aim, s.blocked, s.x ? JSON.stringify(s.x) : null);
        q("INSERT OR REPLACE INTO battle_nights VALUES (?,?,?)").run(n, at, JSON.stringify(meta));
        q("COMMIT").run();
      } catch (e) { try { q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
    },
    shots: (from: number, to = from): (Shot & { night: number })[] => (q("SELECT * FROM battle_shots WHERE night >= ? AND night <= ? ORDER BY night, k").all(from, to) as any[]).map(r => ({ ...shotRow(r), night: r.night })),
    meta: (k: string): string | null => (q("SELECT v FROM battle_meta WHERE k=?").get(k) as any)?.v ?? null,
    setMeta: (k: string, v: string) => q("INSERT OR REPLACE INTO battle_meta VALUES (?,?)").run(k, v),
    fair: (): Map<string, number> => new Map((q("SELECT night, profile, x FROM battle_fair").all() as any[]).map(r => [r.night + "|" + r.profile, Number(r.x)] as [string, number])),
    setFair: (night: number, p: string, x: number) => q("INSERT OR REPLACE INTO battle_fair VALUES (?,?,?)").run(night, p, x),
    erase: (p: string) => { q("DELETE FROM battle_opt WHERE profile=?").run(p); q("DELETE FROM battle_aims WHERE attacker=? OR target=?").run(p, p); q("DELETE FROM battle_aimq WHERE attacker=? OR target=?").run(p, p);
      q("DELETE FROM battle_turn WHERE profile=? OR strike=?").run(p, p); q("DELETE FROM battle_seen WHERE profile=?").run(p); q("DELETE FROM battle_ranks WHERE profile=?").run(p); q("UPDATE battle_shots SET a='~gone' WHERE a=?").run(p); q("DELETE FROM battle_shots WHERE d=?").run(p); },
    prune: (beforeNight: number) => { q("DELETE FROM battle_shots WHERE night < ?").run(beforeNight); q("DELETE FROM battle_nights WHERE night < ?").run(beforeNight); q("DELETE FROM battle_aims WHERE night < ?").run(beforeNight); q("DELETE FROM battle_aimq WHERE night < ?").run(beforeNight); q("DELETE FROM battle_turn WHERE night < ?").run(beforeNight); q("DELETE FROM battle_seen WHERE night < ?").run(beforeNight); q("DELETE FROM battle_ranks WHERE night < ?").run(beforeNight); },
  };
}
export type BattleStore = ReturnType<typeof battleStore>;
export type { SimOut };
