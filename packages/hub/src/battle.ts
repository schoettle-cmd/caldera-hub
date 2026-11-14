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
 *    and is priced at the building's replacement value (floors x 400 m2 x $/m2 by construction). Every missile that lands does
 *    damage: a near miss still breaks glass and cladding. A shield scales the damage down (a 100% shield takes the hit on the
 *    dome), a wrecked tower has less left to wreck, and a city under heavy fire has its crews out (civil defence), so later
 *    hits do less, but never nothing: there are no caps that zero a shot.
 * 4. Every hit starts a fire. Some spread (by weapon). Fire adds damage for hours on an exponential burn-down (time constant
 *    1 hour: 63% of it in the first hour, out after about 4, embers and thin smoke until morning).
 * 5. Battles run on their own on the overnight tick (02:00 Pacific, 10:00 UTC). Cities always regenerate: 25% of each hit a
 *    day on its own, plus 1% per build point earned after it. Opting out rebuilds instantly. Real land and data are never touched.
 * 6. Fairness: every city is in unless it opts out; a beginner shield (100%) for 30 days after joining and until a member has
 *    7 active days; streak shields (50% at 7 days, 95% at 30); per-capita strength and scoring; never hit by the same rival
 *    two nights running; quiet plots (14 days idle) can't be targeted. Manual fire: aim up to 3 of tonight's shots.
 */
import { DAY, dayOf, dayKey, aiMult, streakMult, RULES, type GEvent, type SimOut } from "./growth";

// ---------------------------------------------------------------- the rules
export type Weapon = "shell" | "rocket" | "tactical" | "cruise";
export interface WeaponSpec { k: Weapon; name: string; size: string; like: string; /** unit cost, $ */ cost: number; /** warhead, kg of TNT */ tnt: number; /** circular error probable, m, before guidance */ cep: number; /** chance the fire spreads */ fire: number; /** tech level needed, 0..3 */ tech: number }
export interface BuildClass { k: string; name: string; /** overpressure that wrecks it, kPa */ kpa: number; /** replacement cost, $ per m2 of floor */ sqm: number; /** fire load, 0..1 */ load: number; /** tallest map height (px) in this class */ maxH: number }
export const WAR = {
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
  /** a near miss still breaks glass and cladding: up to this share of the building; and the least any landed hit does */ light: 0.005, floor: 0.001,
  /** civil defence: damage scales by 1 / (1 + tonight / night + week / (week * towers)), in towers' worth */ soft: { night: 2, week: 0.3 },
  /** a tower can't lose more than this to stacked hits (what is rubble can't be wrecked again) */ stand: 0.95,
  /** guidance by streak days: the CEP multiplier */ guide: [{ streak: 30, x: 0.25, name: "Terminal seeker" }, { streak: 7, x: 0.5, name: "GPS" }, { streak: 0, x: 1, name: "Inertial" }],
  /** a release this recent moves the heaviest size up one */ relDays: 30, /** rivals within reach: 3, plus one per merged PR that day */ reach: 3, reachMax: 5,
  autoRepair: 0.25, repairPerPt: 0.01,
  beginnerDays: 30, beginnerActive: 7, hourUtc: 10, manualCap: 3, seasonDays: 42, idleDays: 14,
  /** nights resolved before 2026-11-14 counted facades: one facade is scored as this many dollars, one old ammo point as usd */ legacyFacade: 5_000_000,
};
const LEGACY: Record<string, Weapon> = { orbital: "cruise", beam: "tactical", cannon: "rocket", catapult: "shell" };
export const weaponOf = (w: string): WeaponSpec => WAR.weapons.find(x => x.k === w) || WAR.weapons.find(x => x.k === LEGACY[w]) || WAR.weapons[WAR.weapons.length - 1]!;
/** the house rival: when an opted-in city has no fair human match, raiders come in from the sea (they never own land) */
export const RAIDERS = "~raiders";

/** The night battle for UTC day N happens at N 10:00 UTC (02:00 Pacific) and spends day N-1's arsenal. */
export const battleAt = (night: number) => night * DAY + WAR.hourUtc * 3600_000;
/** the latest night whose battle time has passed */
export const lastNight = (now: number) => { const d = dayOf(now); return now >= battleAt(d) ? d : d - 1; };

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
 *  30 days). `ai`: repo -> AI signal count. `reverted`: short shas. `top`: the tallest repo tower's map height. No ceiling. */
export function arsenal(events: GEvent[], day: number, o: { ai?: Map<string, number>; streak?: number; lots?: string; reverted?: Set<string>; top?: number } = {}): Arsenal {
  const per = new Map<string, { c: number; pr: number; rel: number; ci: number }>();
  let c = 0, pr = 0, rel = 0, ci = 0, rel30 = false;
  for (const e of events) if (!e.v && e.k === "release" && dayOf(e.ts) <= day && dayOf(e.ts) > day - WAR.relDays) { rel30 = true; break; }
  const list = events.filter(e => !e.v && dayOf(e.ts) === day && dayOf(e.seen) <= day + 1).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  for (const e of list) {
    const r = per.get(e.repo) || { c: 0, pr: 0, rel: 0, ci: 0 }; per.set(e.repo, r);
    if (e.k === "commit" || e.k === "private") {
      if (e.k === "commit" && o.reverted?.has(e.id.replace(/^c:/, "").slice(0, 7))) continue;   // a revert cancels the commit it reverts
      const u = Math.max(0, Number(e.n) || 0); if (u <= 0) continue;
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
  const streakX = streakMult(o.streak || 0), ammo = Math.round(raw * streakX * 10) / 10, usd = Math.round(ammo * WAR.usd);
  const tw = techOf({ lots: o.lots, top: o.top, rel30, ci: ci > 0 }), best = bestWeapon(tw.tech), shots = shotsFor(usd, best), g = WAR.guide.find(x => (o.streak || 0) >= x.streak)!;
  return { ammo, usd, raw: Math.round(raw * 10) / 10, c, pr, rel, ci, aiX, streakX: Math.round(streakX * 100) / 100, shots, best, tech: tw.tech, techWhy: { base: tw.base, rel: tw.rel, ci: tw.ci },
    guide: g.name, cepX: Math.round(g.x / aiX * 1000) / 1000, reach: Math.min(WAR.reachMax, WAR.reach + pr), n: countOf(shots), left: usd - shots.reduce((t, w) => t + costOf(w), 0) };
}

// ---------------------------------------------------------------- 4. shields
/** 100% for beginners (30 days after joining, or fewer than 7 active days ever) unless waived; else 50% at a 7-day streak
 *  rising to 95% at 30; 0 below a week. */
export function shield(o: { streak: number; joinedDays: number; activeDays: number; waived?: boolean }): number {
  if (!o.waived && (o.joinedDays < WAR.beginnerDays || o.activeDays < WAR.beginnerActive)) return 1;
  const s = o.streak || 0; if (s < 7) return 0; if (s >= 30) return 0.95; return Math.round((0.5 + 0.45 * (s - 7) / 23) * 100) / 100;
}
export const isBeginner = (o: { joinedDays: number; activeDays: number; waived?: boolean }) => !o.waived && (o.joinedDays < WAR.beginnerDays || o.activeDays < WAR.beginnerActive);

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
}
/** the working of one shot, kept with it so the page can show the sum: u $ of blast damage, fi the share of the tower the
 *  fire will take (fu in $), sp 1 = the fire spread, m metres off the aim point, cep the CEP it flew with, r the wreck radius
 *  (m), kpa the overpressure at the wall, c the construction class, fl floors, v the building's value ($), sh the shield, cd
 *  civil defence (x), st how much of the tower still stood (x), pc team share (x), raw the blast's share before those, pot the
 *  $ a 100% shield held off */
export interface ShotX { u: number; fi: number; fu: number; sp: 0 | 1; m: number; cep: number; r: number; kpa: number; c: number; fl: number; v: number; sh: number; cd: number; st: number; pc: number; raw: number; pot?: number }
/** f = the share of the tower the blast destroyed (1 = the whole tower); ammo = the missile's price, $ (points before 11-14) */
export interface Shot { k: number; a: string; d: string; w: Weapon; ammo: number; roll: number; f: number; lot: number; t: number; aim: 0 | 1; blocked: 0 | 1; x?: ShotX | null }
export interface NightIn {
  night: number; fighters: Fighter[];
  /** pairs "a>d" that landed a hit on the previous night (nobody is hit by the same rival two nights running) */ lastPairs?: Set<string>;
  /** defender -> towers' worth taken over the previous 6 nights (civil defence) */ week?: Map<string, number>;
  /** attacker -> targets they aimed at tonight, in order (manual fire, at most 3 shots) */ aims?: Map<string, string[]>;
  /** defender -> lot index -> damage still showing from earlier nights (a wrecked tower has less left to wreck) */ open?: Map<string, Map<number, number>>;
}
export const band = (side: number) => side <= 3 ? 0 : side <= 5 ? 1 : side <= 8 ? 2 : 3;
export const builtLots = (lots: string) => { const out: number[] = []; for (let i = 0; i < lots.length; i++) if (Number(lots[i]) >= 4) out.push(i); return out; };
export const targetable = (f: Fighter) => (f.idle === null || f.idle < WAR.idleDays) && (f.towers || 0) > 0;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4, r1 = (x: number) => Math.round(x * 10) / 10;
/** the raiders' ship, for shots fired out to sea: a masonry hull the size of a small block */
const SHIP = towerOf(40);
/** the dollars a shot did: blast plus the whole fire; nights before 11-14 (no working kept) at the legacy rate */
export const usdOf = (s: Shot) => s.x ? s.x.u + s.x.fu : Math.round(s.f * WAR.legacyFacade);
/** the share of the tower a shot has taken by `now`: the blast, plus the fire so far */
export const dmgAt = (s: Shot, now: number) => s.f + (s.x ? burnt(s.x.fi, s.t, now) : 0);
/** blast and the whole fire, in towers' worth */
export const dmgAll = (s: Shot) => s.f + (s.x ? s.x.fi : 0);

/** Resolve one night. Deterministic for the same input. Raiders stand in for a missing fair rival, with the night's median
 *  budget (at least $500k, rockets at most), and they fire back. */
export function resolveNight(o: NightIn): { shots: Shot[]; raiders: string[] } {
  const R = rng("night:" + o.night), T0 = battleAt(o.night), shots: Shot[] = [];
  const F = [...o.fighters].sort((a, b) => a.id < b.id ? -1 : 1), byId = new Map(F.map(f => [f.id, f] as [string, Fighter]));
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
    return c.sort((x, y) => score(a, x) + jitter.get(x.id)! - (score(a, y) + jitter.get(y.id)!) || (x.id < y.id ? -1 : 1)).slice(0, a.ars.reach || WAR.reach);
  };
  const fire = (aId: string, pc: number, cepX: number, w: Weapon, d: Fighter | null, aim: 0 | 1) => {
    const wp = weaponOf(w), miss = missOf(wp.cep * cepX, R()), uFire = R(), t = T0 + Math.floor(R() * 40 * 60_000);
    // lot = which of the defender's buildings the shot is aimed at: an index into its repo towers, tallest first (the map
    // sorts the same way); the least-hit of the top three, so hits spread and stack visibly. A shield-stopped shot still
    // aims at a building, so the map can burst it on the dome over that tower, never over grass.
    let lot = -1, tower = SHIP, st = 1, cd = 1, sh = 0; const m = d ? lotDmg.get(d.id) || new Map<number, number>() : null;
    if (d && m) {
      lotDmg.set(d.id, m);
      const n = Math.max(1, d.towers || 0), cand = [0, 1, 2].filter(i => i < n).sort((x, y) => (m.get(x) || 0) - (m.get(y) || 0) || x - y);
      lot = cand[Math.floor(R() * cand.length)]!; tower = towerOf(d.tw?.[lot] ?? d.tw?.[d.tw.length - 1] ?? 60); sh = Math.min(1, Math.max(0, d.sh));
      st = 1 - Math.min(WAR.stand, m.get(lot) || 0);
      cd = 1 / (1 + (taken.get(d.id) || 0) / WAR.soft.night + (o.week?.get(d.id) || 0) / Math.max(1, WAR.soft.week * n));
    }
    const b = blast(wp.tnt, tower, miss), cls = WAR.classes[tower.c]!, blocked = sh >= 1, pot = b.raw * st * cd * pc;
    const f = blocked ? 0 : r4(Math.max(WAR.floor, pot * (1 - sh))), sp = uFire < wp.fire ? 1 : 0, fi = blocked ? 0 : r4(f * cls.load * (sp ? WAR.fire.spread : WAR.fire.small));
    const x: ShotX = { u: Math.round(f * tower.value), fi, fu: Math.round(fi * tower.value), sp: blocked ? 0 : sp as 0 | 1, m: r1(miss), cep: r1(wp.cep * cepX), r: r1(b.r), kpa: Math.round(b.kpa), c: tower.c, fl: tower.floors, v: tower.value,
      sh, cd: Math.round(cd * 100) / 100, st: Math.round(st * 100) / 100, pc: Math.round(pc * 100) / 100, raw: r4(b.raw), ...(blocked ? { pot: Math.round(Math.max(WAR.floor, pot) * tower.value) } : {}) };
    if (d && m && f > 0) { m.set(lot, (m.get(lot) || 0) + f + fi); taken.set(d.id, (taken.get(d.id) || 0) + f + fi); }
    shots.push({ k: shots.length, a: aId, d: d ? d.id : RAIDERS, w, ammo: wp.cost, roll: 0, f, lot, t, aim, blocked: blocked ? 1 : 0, x });
  };
  const raided: string[] = [], rArs: number[] = F.map(f => f.ars.usd).filter(x => x > 0).sort((a, b) => a - b), armed = rArs.length;
  const med = Math.max(500_000, rArs.length ? rArs[Math.floor(rArs.length / 2)]! : 500_000);
  for (const a of F) {
    const pc = 1 / Math.max(1, a.heads), rivals = rivalsOf(a);
    const aimed = (o.aims?.get(a.id) || []).map(id => byId.get(id)).filter((t): t is Fighter => !!t && t.id !== a.id && targetable(t) && !o.lastPairs?.has(a.id + ">" + t.id)).slice(0, WAR.manualCap);
    // city vs city: every shot goes to another city, spread round-robin over the night's rivals (a city never targets itself)
    a.ars.shots.forEach((w, i) => fire(a.id, pc, a.ars.cepX || 1, w, i < aimed.length ? aimed[i]! : rivals.length ? rivals[(i - aimed.length) % rivals.length]! : null, i < aimed.length ? 1 : 0));
    if (!rivals.length && targetable(a) && armed < 2) {   // a lone armed city with nobody to fight: raiders from the sea (they fire with the night's median budget)
      raided.push(a.id);
      for (const w of shotsFor(med, "rocket")) fire(RAIDERS, 1, 1, w, a, 0);
    }
  }
  shots.sort((x, y) => x.t - y.t || x.k - y.k); shots.forEach((s, i) => s.k = i);
  return { shots, raiders: raided };
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
/** dollars of damage dealt (blast and fire), plus half of what a full shield held off, per head */
export function scoreOf(shots: Shot[], heads: (id: string) => number): Map<string, number> {
  const s = new Map<string, number>();
  for (const x of shots) {
    if (x.a !== RAIDERS) s.set(x.a, (s.get(x.a) || 0) + usdOf(x) / Math.max(1, heads(x.a)));
    if (x.d !== RAIDERS && x.blocked) s.set(x.d, (s.get(x.d) || 0) + 0.5 * (x.x ? x.x.pot || 0 : x.ammo / 10 * WAR.legacyFacade) / Math.max(1, heads(x.d)));
  }
  for (const [k, v] of s) s.set(k, Math.round(v));
  return s;
}

// ---------------------------------------------------------------- 8. "What your city did last night"
export interface Report {
  night: string; h: string; peace: boolean;
  raids: { from: string; t: number; shots: number; landed: number; f: number }[];
  /** towers' worth taken (blast and fire) */ taken: number; /** towers hit */ tiers: number; rebuilt: number; fired: number; landed: number; on: string[]; /** towers' worth dealt */ dealt: number;
  /** dollars of damage taken and dealt, and how many of my towers caught a spreading fire */ takenUsd: number; dealtUsd: number; fires: number;
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
    takenUsd: mine.reduce((t, s) => t + usdOf(s), 0), dealtUsd: out.reduce((t, s) => t + usdOf(s), 0), fires: burning.size,
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
export function battleSubject(r: Report): string {
  if (r.peace) return `Your city today: peaceful zone, ${r.built} lot${r.built === 1 ? "" : "s"} built`;
  if (!r.raids.length) return `Your city today: ${r.fired} missile${r.fired === 1 ? "" : "s"} stacked, no hits on your towers`;
  const who = r.raids.map(x => x.from).slice(0, 2).join(" and ");
  return r.taken > 0 ? `Your city today: hit by ${who}, cranes rebuild tonight` : `Your city today: ${who} stopped by your shield`;
}
/** Plain, short, ASCII, in the day's vocabulary (stacked at noon, the 20:00 salvo, towers hit, cranes overnight), one link
 *  to the replay (plus the controls). Peaceful zones get the build lines only. */
export function battleEmail(r: Report, w: WorldLines, o: { name: string; hub: string; unsub: string; postal: string; weekly?: boolean }): { subject: string; text: string; html: string } {
  const first = (o.name || r.h).replace(/^@/, "").trim().split(/\s+/)[0] || r.h, hub = o.hub.replace(/\/$/, ""), n1 = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const L: string[] = [`Hey ${first},`, "", "YOUR CITY"];
  if (r.peace) { L.push(`Peaceful zone: no missiles in or out.`, r.built ? `${n1(r.built, "lot")} built yesterday.` : "No new lots yesterday."); }
  else {
    L.push(r.fired ? `Stacked at noon: ${n1(r.fired, "missile")} bought with a ${fmtUsd(r.usd)} budget (yesterday's code).` : "Nothing stacked at noon: no code counted yesterday.");
    if (r.fired) L.push(`Salvo at 20:00: ${r.fired} fired, ${r.landed} landed${r.on.length ? " on " + r.on.slice(0, 3).join(", ") : ""}${r.dealtUsd > 0 ? `, ${fmtUsd(r.dealtUsd)} of damage` : ""}.`);
    if (!r.raids.length) L.push("No missiles came your way.");
    else L.push(r.taken > 0 ? `Hits on your towers: ${fmtUsd(r.takenUsd)} of damage from ${r.raids.map(x => x.from).join(", ")}${r.tiers ? ` (${n1(r.tiers, "tower")} hit${r.fires ? `, ${r.fires} caught fire` : ""})` : ""}. Cranes rebuild overnight, whole by noon.` : `Your shield held: ${r.raids.map(x => x.from).join(", ")} fired at you, nothing landed.`);
    L.push(`Shield ${Math.round(r.shield * 100)}%${r.streak ? ` (${r.streak}-day streak)` : ""}.`);
    if (r.mvp) L.push(`MVP: ${r.mvp.repo}, ${n1(r.mvp.bricks, "brick")} laid.`);
  }
  L.push(`Watch the replay: ${hub}/world?view=battle&replay=1`, "", "TODAY IN THE WORLD");
  const list = (xs: [string, number][], f: (n: number) => string) => xs.map(([h, n]) => `${h} ${f(n)}`).join(", ");
  if (w.stacked && w.stacked.length) L.push(`Most ammo stacked: ${list(w.stacked, n => n1(n, "missile"))}`);
  if (w.built.length) L.push(`Built the most: ${list(w.built, n => n1(n, "lot"))}`);
  if (!r.peace) {
    if (w.hit.length) L.push(`Towers hit the hardest: ${list(w.hit, n => `(${fmtUsd(n)})`)}`);
    if (w.attackers.length) L.push(`Most hits landed: ${list(w.attackers, n => n1(n, "hit"))}`);
    if (w.rivalry) L.push(`Rivalry of the day: ${w.rivalry[0]} vs ${w.rivalry[1]}${w.rivalry[2] > 1 ? `, ${w.rivalry[2]} days running` : ""}`);
    L.push("Cranes rebuild every tower overnight; by noon the world stands as it did.");
  }
  L.push(`Season ${w.season.n}, week ${w.season.week}. Leaderboard: ${hub}/leaderboard`, `Daily / Weekly / Off: ${hub}/world?view=battle#reports`, `Unsubscribe: ${o.unsub}`, "", o.postal);
  const text = L.join("\n").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const html = `<!doctype html><html><body style="margin:0;padding:20px 14px;background:#fff;color:#24222B;font:15px/1.55 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;white-space:pre-wrap">${esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#6E4FE0">$1</a>')}</div></body></html>`;
  return { subject: battleSubject(r).replace(/[^\x20-\x7e]/g, ""), text, html };
}
/** The daily feed post, in Caldera's own voice (no sign-off): who stacked the most, the salvo, the towers hit, the cranes,
 *  the replay and the leaderboard. null when there was no battle that day. */
export function battleSummary(shots: Shot[], o: { night: string; handle: (id: string) => string; hub: string }): string | null {
  if (!shots.length) return null;
  const hub = o.hub.replace(/\/$/, ""), n1 = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`, d = new Date(o.night + "T12:00:00Z"), MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const stacked = new Map<string, number>(), hit = new Map<string, { f: number; towers: Set<number> }>(), total = shots.reduce((t, s) => t + usdOf(s), 0);
  for (const s of shots) { if (s.a !== RAIDERS) stacked.set(s.a, (stacked.get(s.a) || 0) + 1); if (s.f > 0 && s.d !== RAIDERS) { const h = hit.get(s.d) || { f: 0, towers: new Set<number>() }; h.f += usdOf(s); if (s.lot >= 0) h.towers.add(s.lot); hit.set(s.d, h); } }
  const top = [...stacked.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3), landed = shots.filter(s => s.f > 0).length, raiders = shots.filter(s => s.a === RAIDERS).length;
  const L = [`Battle day, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}.`];
  L.push(top.length ? `Most ammo stacked: ${top.map(([id, n]) => `${o.handle(id)} ${n1(n, "missile")}`).join(", ")}${raiders ? `; raiders from the sea brought ${raiders}` : ""}.` : `Only raiders from the sea fired today (${n1(raiders, "missile")}).`);
  L.push(`The 20:00 salvo: ${n1(shots.length, "missile")}, ${landed} landed${total > 0 ? `, ${fmtUsd(total)} of damage` : ""}.`);
  L.push(hit.size ? `Towers hit: ${[...hit.entries()].sort((a, b) => b[1].f - a[1].f).slice(0, 4).map(([id, h]) => `${o.handle(id)} (${n1(h.towers.size, "tower")}, ${fmtUsd(h.f)})`).join("; ")}.` : "No towers hit: every shield held.");
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
export interface OptRow { p: string; war: 0 | 1; /** 1 = chose to leave the battles (every city is in unless it opts out) */ out: 0 | 1; since: number; waive: 0 | 1; report: ReportFreq; token: string; sent: string | null }
export function battleStore(q: Q, newToken: () => string) {
  q(`CREATE TABLE IF NOT EXISTS battle_opt (profile TEXT PRIMARY KEY, war INTEGER, since INTEGER, waive INTEGER, report TEXT, token TEXT UNIQUE, sent TEXT, at INTEGER)`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_aims (night INTEGER, attacker TEXT, target TEXT, ts INTEGER, PRIMARY KEY (night, attacker, target))`).run();
  q(`CREATE TABLE IF NOT EXISTS battle_nights (night INTEGER PRIMARY KEY, at INTEGER, json TEXT)`).run();
  try { q("ALTER TABLE battle_opt ADD COLUMN out INTEGER").run(); } catch { /* already there */ }   // Mike 11-08: every city is a combatant; out = chose to leave
  q(`CREATE TABLE IF NOT EXISTS battle_shots (night INTEGER, k INTEGER, a TEXT, d TEXT, w TEXT, ammo REAL, roll INTEGER, f REAL, lot INTEGER, t INTEGER, aim INTEGER, blocked INTEGER, PRIMARY KEY (night, k))`).run();
  q(`CREATE INDEX IF NOT EXISTS battle_shots_d ON battle_shots (d, night)`).run();
  try { q("ALTER TABLE battle_shots ADD COLUMN x TEXT").run(); } catch { /* already there */ }   // 11-13: the working of each shot (ShotX)
  q(`CREATE TABLE IF NOT EXISTS battle_meta (k TEXT PRIMARY KEY, v TEXT)`).run();
  const map = (r: any): OptRow => ({ p: r.profile, war: r.war ? 1 : 0, out: r.out ? 1 : 0, since: r.since || 0, waive: r.waive ? 1 : 0, report: (["daily", "weekly"].includes(r.report) ? r.report : "off") as ReportFreq, token: r.token, sent: r.sent || null });
  const opt = (p: string): OptRow | null => { const r = q("SELECT * FROM battle_opt WHERE profile=?").get(p); return r ? map(r) : null; };
  const ensure = (p: string): OptRow => { if (!opt(p)) q("INSERT OR IGNORE INTO battle_opt (profile, war, since, waive, report, token, sent, at, out) VALUES (?,?,?,?,?,?,?,?,?)").run(p, 1, 0, 0, "off", newToken(), null, Date.now(), 0); return opt(p)!; };
  const shotRow = (r: any): Shot => ({ k: r.k, a: r.a, d: r.d, w: r.w, ammo: r.ammo, roll: r.roll, f: r.f, lot: r.lot, t: r.t, aim: r.aim ? 1 : 0, blocked: r.blocked ? 1 : 0, x: (() => { try { return r.x ? JSON.parse(r.x) : null; } catch { return null; } })() });
  return {
    opt, ensure,
    opts: (): OptRow[] => (q("SELECT * FROM battle_opt").all() as any[]).map(map),
    setWar: (p: string, on: boolean, at: number) => { ensure(p); q("UPDATE battle_opt SET war=?, since=?, at=?, out=? WHERE profile=?").run(on ? 1 : 0, on ? at : 0, at, on ? 0 : 1, p); },
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
        for (const s of shots) q("INSERT INTO battle_shots (night, k, a, d, w, ammo, roll, f, lot, t, aim, blocked, x) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(n, s.k, s.a, s.d, s.w, s.ammo, s.roll, s.f, s.lot, s.t, s.aim, s.blocked, s.x ? JSON.stringify(s.x) : null);
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
