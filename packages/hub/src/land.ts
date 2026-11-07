/**
 * The World's Expansion view (Mike 2026-11-06: "build it as a toggle between current and this expansion view"), from the
 * design study "Caldera land map: territory earned by code" (mjonesone.com/r-caldera-land-546f077b).
 *
 * - The island grows outward from the founder's plot; each member settles the nearest free ground, in join order.
 * - Plot side = clamp(2 + floor(score / 7), 2, 8) tiles, score = 3 ln(1+C) + 2 ln(1+P) + ln(1+R) + 0.5 ln(1+S):
 *   C commits in the last 12 months, each weighted 0.5 + 0.5 e^(-age/180d); P merged PRs; R repos with a commit; S stars gained.
 * - Land never shrinks (the side is a stored ratchet), it weathers: five health states from recency and frequency.
 * - Data: commits, repos and dates come from each member's PUBLIC city (the same GitHub fetch that builds cities); merged
 *   PRs and stars gained come from one nightly job over public GitHub. Nothing here calls GitHub on page load.
 * - Members without public GitHub get the 2x2 floor, and their land weathers with their public Caldera activity instead.
 * Only public repos with a name ever reach the map: padlocked, named-private repos and storefronts are left out.
 */
export const DAY = 86_400_000;
export const LAND_STATES = ["thriving", "active", "settled", "weathered", "dormant"] as const;
export type LandState = typeof LAND_STATES[number];

// ---------------------------------------------------------------- the formula
export function landScore(C: number, P: number, R: number, S: number): number {
  const l = (v: number) => Math.log1p(Math.max(0, Number(v) || 0));
  return 3 * l(C) + 2 * l(P) + l(R) + 0.5 * l(S);
}
export function landSide(score: number): number { return Math.max(2, Math.min(8, 2 + Math.floor((Number(score) || 0) / 7))); }
/** recent work counts double: a commit today weighs 1, one 180 days old about 0.68, a year old about 0.56 */
export function commitWeight(ageDays: number): number { return 0.5 + 0.5 * Math.exp(-Math.max(0, ageDays) / 180); }

/** A repo's commits as dated weekly buckets (t = the week's end). The 12 most recent weeks are exact (GitHub
 *  commit_activity, as the city has them); the rest of the 12-month total is spread evenly over the 40 weeks before. */
export interface Bucket { t: number; n: number; exact: boolean }
export function repoBuckets(r: { commits?: number; weeks?: number[] }, at: number): Bucket[] {
  const w = (Array.isArray(r.weeks) ? r.weeks : []).slice(-12).map(n => Math.max(0, Number(n) || 0));
  const known = w.reduce((a, b) => a + b, 0), total = Math.max(known, Math.max(0, Number(r.commits) || 0)), rest = total - known, out: Bucket[] = [];
  if (rest > 0) for (let i = 0; i < 40; i++) out.push({ t: at - (w.length + i) * 7 * DAY, n: rest / 40, exact: false });
  w.forEach((n, i) => { if (n > 0) out.push({ t: at - (w.length - 1 - i) * 7 * DAY, n, exact: true }); });
  return out;
}
/** C at time T: commits in the 12 months before T, each weighted by its age at T */
export function weightedCommits(b: Bucket[], T: number): number {
  let c = 0; for (const x of b) { if (x.t > T) continue; const age = (T - x.t) / DAY; if (age <= 365) c += x.n * commitWeight(age); } return c;
}
export function rawCommits(b: Bucket[], T: number): number {
  let c = 0; for (const x of b) if (x.t <= T && (T - x.t) / DAY <= 365) c += x.n; return c;
}

/** Health from recency and frequency: last activity within 7 days and 3 of the last 4 weeks active = thriving; 30 days
 *  active; 180 settled; 365 weathered; older (or nothing at all) dormant. */
export function healthAt(events: number[], T: number): { state: number; days: number | null; freq: number } {
  let last = -Infinity; for (const t of events) if (t <= T && t > last) last = t;
  if (last === -Infinity) return { state: 4, days: null, freq: 0 };
  const days = Math.floor((T - last) / DAY);
  let freq = 0; for (let k = 0; k < 4; k++) { const hi = T - k * 7 * DAY, lo = hi - 7 * DAY; if (events.some(t => t <= hi && t > lo)) freq++; }
  const state = days <= 7 && freq >= 3 ? 0 : days <= 30 ? 1 : days <= 180 ? 2 : days <= 365 ? 3 : 4;
  return { state, days, freq };
}

// ---------------------------------------------------------------- placement
/** Frontier placement: in join order, each plot takes the free square nearest the centre, keeping `gap` tiles from every
 *  plot already placed (room for the road ring and a strip of green). The first plot (the founder) sits at the centre.
 *  Returns top-left tile coordinates, shifted so the island starts at (3, 3). Deterministic. */
export function placeLand(sides: number[], gap = 3): { x: number; y: number }[] {
  const rects: { x: number; y: number; k: number }[] = [], out: { x: number; y: number }[] = [];
  const area = sides.reduce((s, k) => s + (k + gap) * (k + gap), 0), R = Math.ceil(Math.sqrt(area)) + 10;
  const cand: [number, number][] = [];
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) cand.push([x, y]);
  cand.sort((a, b) => (Math.hypot(a[0] + .5, a[1] + .5) - Math.hypot(b[0] + .5, b[1] + .5)) || (a[0] + a[1] - b[0] - b[1]) || (a[0] - b[0]));
  for (const k of sides) {
    let done = false;
    for (const [cx, cy] of cand) {
      const rx = cx - Math.floor(k / 2), ry = cy - Math.floor(k / 2);
      let ok = true;
      for (const o of rects) if (!(rx + k + gap <= o.x || o.x + o.k + gap <= rx || ry + k + gap <= o.y || o.y + o.k + gap <= ry)) { ok = false; break; }
      if (ok) { rects.push({ x: rx, y: ry, k }); out.push({ x: rx, y: ry }); done = true; break; }
    }
    if (!done) { const x = R + 2 + rects.length * (8 + gap); rects.push({ x, y: 0, k }); out.push({ x, y: 0 }); }   // never: R covers every plot
  }
  if (!out.length) return out;
  const mx = Math.min(...out.map(p => p.x)), my = Math.min(...out.map(p => p.y));
  return out.map(p => ({ x: p.x - mx + 3, y: p.y - my + 3 }));
}

// ---------------------------------------------------------------- one member's land over time
export interface LandRepo { name: string; language?: string; commits?: number; weeks?: number[]; week?: number; pushed?: string; created?: string; url?: string }
export interface LandIn {
  handle: string; name: string; created: number; city: string;
  /** public, named repos from their public city, and when that city was built */
  repos: LandRepo[]; at: number;
  /** nightly public-GitHub extras: merged PRs and stars gained in 12 months, archived repo names */
  gh?: { p: number; s: number; archived?: string[] } | null;
  /** public Caldera activity times (joined, profile updated, posts, comments): the meter for members without GitHub */
  caldera: number[];
  /** the stored ratchet (land never shrinks) and nightly history, day (YYYY-MM-DD) -> side, state */
  sideMax?: number; hist?: Record<string, { side: number; state: number }>;
}
export interface LandOut {
  h: string; n: string; u: string; j: number; k: number; x: number; y: number; gh: 0 | 1;
  st: number; d: number | null; f: number; c: number; p: number; r: number; s: number; sc: number;
  steps: [number, number][]; hs: [number, number][];
  bl: { n: string; l: string; c: number; w: number; a: 0 | 1; b: number; u?: string; last: number | null }[];
}
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const str = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);

export function memberLand(m: LandIn, day0: number, days: number, now: number): Omit<LandOut, "x" | "y"> {
  const repos = m.repos.filter(r => r && r.name);
  const archived = new Set((m.gh?.archived || []).map(s => s.toLowerCase()));
  const buckets = repos.map(r => repoBuckets(r, m.at));
  const all = buckets.flat();
  const pushedT = repos.map(r => { const t = Date.parse(r.pushed || ""); return Number.isFinite(t) && t <= now ? t : NaN; });
  const createdT = repos.map(r => { const t = Date.parse(r.created || ""); return Number.isFinite(t) && t <= now ? t : NaN; });
  const live = repos.map((r, i) => (Number(r.commits) || 0) > 0 || Number.isFinite(pushedT[i]!));
  const gh = repos.length > 0 && live.some(Boolean);
  const allArchived = gh && repos.every((r, i) => !live[i] || archived.has(r.name.toLowerCase()));
  // activity events: exact commit weeks, pushes and repo births for GitHub members; public Caldera activity otherwise
  const events = gh ? [...all.filter(b => b.exact).map(b => Math.min(b.t, m.at)), ...pushedT.filter(Number.isFinite), ...createdT.filter(Number.isFinite)]
    : m.caldera.filter(t => Number.isFinite(t) && t <= now);
  const rawNow = rawCommits(all, now) || 0, P = Math.max(0, m.gh?.p || 0), S = Math.max(0, m.gh?.s || 0);
  const scoreAt = (T: number) => {
    if (!gh) return 0;
    const frac = rawNow > 0 ? Math.min(1, rawCommits(all, T) / rawNow) : 1;
    const R = repos.filter((r, i) => {
      const born = createdT[i]!, last = pushedT[i]!;
      if (Number.isFinite(born) && born > T) return false;
      return buckets[i]!.some(b => b.t <= T && (T - b.t) / DAY <= 365) || (Number.isFinite(last) && last <= T && (T - last) / DAY <= 365);
    }).length;
    return landScore(weightedCommits(all, T), P * frac, R, S * frac);
  };
  const scNow = scoreAt(now), hNow = healthAt(events, now), stNow = allArchived ? 4 : hNow.state;
  // the replay: one value per day from the member's join day to today, as change points. The side is a running maximum
  // (land never shrinks), so today's side is the largest of tonight's score, the stored ratchet and every earlier day.
  const j = Math.max(0, Math.min(days - 1, Math.floor((m.created - day0) / DAY)));
  const runs: number[] = [];
  let run = 2;
  const every = Math.max(1, Math.ceil(days / 120));   // a long history is sampled (at most ~120 score evaluations per member)
  for (let d = j; d < days; d++) {
    const T = d === days - 1 ? now : day0 + (d + 1) * DAY - 1, h = m.hist?.[dayKey(T)];
    if ((d - j) % every === 0 || d === days - 1) run = Math.max(run, gh ? landSide(scoreAt(T)) : 2);
    run = Math.max(run, h?.side || 0); runs.push(run);
  }
  const kNow = Math.max(run, m.sideMax || 2);
  const steps: [number, number][] = [], hs: [number, number][] = [];
  for (let d = j; d < days; d++) {
    const T = d === days - 1 ? now : day0 + (d + 1) * DAY - 1, h = m.hist?.[dayKey(T)];
    const k = d === days - 1 ? kNow : runs[d - j]!;
    const st = d === days - 1 ? stNow : h ? h.state : healthAt(events, T).state;
    if (!steps.length || steps[steps.length - 1]![1] !== k) steps.push([d, k]);
    if (!hs.length || hs[hs.length - 1]![1] !== st) hs.push([d, st]);
  }
  const order = repos.map((r, i) => ({ r, i })).sort((a, b) => (Number(b.r.commits) || 0) - (Number(a.r.commits) || 0) || a.r.name.localeCompare(b.r.name)).slice(0, 64);
  const bl = order.map(({ r, i }) => ({
    n: str(r.name, 60), l: str(r.language || "Other", 30), c: Math.max(0, Math.round(Number(r.commits) || 0)), w: Math.max(0, Math.round(Number(r.week) || 0)),
    a: (archived.has(r.name.toLowerCase()) ? 1 : 0) as 0 | 1,
    b: Number.isFinite(createdT[i]!) ? Math.floor((createdT[i]! - day0) / DAY) : -1,
    ...(typeof r.url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(r.url) ? { u: r.url } : {}),
    last: Number.isFinite(pushedT[i]!) ? Math.floor((now - pushedT[i]!) / DAY) : null,
  }));
  const R = gh ? repos.filter((r, i) => buckets[i]!.some(b => (now - b.t) / DAY <= 365) || (Number.isFinite(pushedT[i]!) && (now - pushedT[i]!) / DAY <= 365)).length : 0;
  return { h: m.handle, n: str(m.name, 80), u: m.city, j, k: kNow, gh: gh ? 1 : 0, st: stNow, d: hNow.days, f: hNow.freq,
    c: Math.round(rawNow), p: Math.round(P), r: R, s: Math.round(S), sc: Math.round(scNow * 10) / 10, steps, hs, bl };
}

export interface LandWorld { at: string; day0: string; days: number; members: LandOut[]; links: [number, number, number][] }
/** The whole island: members in join order (founder first), their land and replay, placed on the frontier. */
export function buildLand(ms: LandIn[], o: { founder?: string | null; now?: number; links?: [string, string, number, string?][] }): LandWorld {
  const now = o.now ?? Date.now();
  const order = [...ms].sort((a, b) => Number(b.handle === o.founder) - Number(a.handle === o.founder) || a.created - b.created || a.handle.localeCompare(b.handle));
  const first = order.length ? Math.min(...order.map(m => Math.min(m.created, now))) : now;
  const day0 = Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth(), new Date(first).getUTCDate());
  const days = Math.max(1, Math.floor((now - day0) / DAY) + 1);
  const lands = order.map(m => memberLand(m, day0, days, now));
  const pos = placeLand(lands.map(l => l.k));
  const idx = new Map(order.map((m, i) => ["@" + m.handle, i] as [string, number])), links: [number, number, number][] = [];
  for (const [a, b, kind] of o.links || []) { const x = idx.get(a), y = idx.get(b); if (x !== undefined && y !== undefined && x !== y && kind !== 4) links.push([x, y, kind]); }
  return { at: new Date(now).toISOString(), day0: new Date(day0).toISOString().slice(0, 10), days, members: lands.map((l, i) => ({ ...l, x: pos[i]!.x, y: pos[i]!.y })), links: links.slice(0, 300) };
}

// ---------------------------------------------------------------- storage and the nightly public-GitHub job
type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export interface LandJobCtx {
  q: Q; fetch: typeof fetch;
  /** listed members with their GitHub login (if any) */
  members: () => { id: string; handle: string; login: string | null }[];
  /** a member's own token, else any working token, else null (unauthenticated, slower) */
  token: (profileId: string) => Promise<string | null>;
  /** ms between GitHub calls (0 in tests) */ pause?: number;
  /** after a run: recompute everyone's land and store tonight's sides and states */ persist: () => void;
}
export function landStore(q: Q) {
  q(`CREATE TABLE IF NOT EXISTS land_gh (profile TEXT PRIMARY KEY, login TEXT, p INTEGER, s INTEGER, archived TEXT, at TEXT)`).run();
  q(`CREATE TABLE IF NOT EXISTS land_side (profile TEXT PRIMARY KEY, side INTEGER, at TEXT)`).run();
  q(`CREATE TABLE IF NOT EXISTS land_hist (profile TEXT, day TEXT, side INTEGER, state INTEGER, PRIMARY KEY (profile, day))`).run();
  return {
    gh: (id: string) => { const r = q("SELECT * FROM land_gh WHERE profile=?").get(id) as any; return r ? { p: r.p || 0, s: r.s || 0, archived: JSON.parse(r.archived || "[]") as string[] } : null; },
    sideMax: (id: string) => (q("SELECT side FROM land_side WHERE profile=?").get(id) as any)?.side || 2,
    hist: (id: string) => Object.fromEntries((q("SELECT day, side, state FROM land_hist WHERE profile=?").all(id) as any[]).map(r => [r.day, { side: r.side, state: r.state }])),
    save: (id: string, side: number, state: number, at: number) => {
      q("INSERT INTO land_side VALUES (?,?,?) ON CONFLICT(profile) DO UPDATE SET side=MAX(side, excluded.side), at=excluded.at").run(id, side, new Date(at).toISOString());
      q("INSERT OR REPLACE INTO land_hist VALUES (?,?,?,?)").run(id, dayKey(at), side, state);
    },
    erase: (id: string) => { for (const t of ["land_gh", "land_side", "land_hist"]) q(`DELETE FROM ${t} WHERE profile=?`).run(id); },
  };
}
export function landJob(c: LandJobCtx) {
  const S = landStore(c.q);
  const sleep = (ms: number) => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
  async function gh(token: string | null, p: string, accept = "application/vnd.github+json"): Promise<{ status: number; body: any; link: string }> {
    const r = await c.fetch("https://api.github.com" + p, { headers: { accept, "user-agent": "caldera-hub", ...(token ? { authorization: "Bearer " + token } : {}) }, signal: AbortSignal.timeout(15000) });
    let body: any = null; try { body = await r.json(); } catch { /* empty */ }
    return { status: r.status, body, link: r.headers.get("link") || "" };
  }
  /** merged PRs, stars gained (12 months) and archived repos for one public login */
  async function extras(login: string, token: string | null, now: number) {
    const since = new Date(now - 365 * DAY), sinceDay = since.toISOString().slice(0, 10), wait = c.pause ?? (token ? 2500 : 7000);
    const sr = await gh(token, `/search/issues?q=${encodeURIComponent(`author:${login} type:pr is:merged merged:>=${sinceDay}`)}&per_page=1`);
    if (sr.status === 403 || sr.status === 429) throw Object.assign(new Error("rate limited"), { stop: true });
    const p = sr.status === 200 ? Math.max(0, Number(sr.body?.total_count) || 0) : null;
    await sleep(wait);
    const rr = await gh(token, `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`);
    if (rr.status === 403 || rr.status === 429) throw Object.assign(new Error("rate limited"), { stop: true });
    const repos = rr.status === 200 && Array.isArray(rr.body) ? rr.body.filter((r: any) => !r.fork && !r.private) : [];
    const archived = repos.filter((r: any) => r.archived).map((r: any) => String(r.name)).slice(0, 100);
    let s = 0;
    for (const r of repos.filter((r: any) => (r.stargazers_count || 0) > 0).sort((a: any, b: any) => b.stargazers_count - a.stargazers_count).slice(0, 5)) {
      const pages = Math.ceil(r.stargazers_count / 100);
      for (let pg = pages, k = 0; pg >= 1 && k < 3; pg--, k++) {
        await sleep(wait / 3);
        const st = await gh(token, `/repos/${r.full_name}/stargazers?per_page=100&page=${pg}`, "application/vnd.github.star+json");
        if (st.status !== 200 || !Array.isArray(st.body)) break;
        const recent = st.body.filter((x: any) => Date.parse(x.starred_at) >= since.getTime()).length; s += recent;
        if (recent < st.body.length) break;   // this page reaches back past 12 months: done with this repo
      }
    }
    return { p, s, archived };
  }
  let running = false;
  async function run(o: { dry?: boolean; only?: string } = {}): Promise<{ checked: number; failed: number; stopped: boolean }> {
    if (running) return { checked: 0, failed: 0, stopped: false }; running = true;
    let checked = 0, failed = 0, stopped = false;
    try {
      for (const m of c.members()) {
        if (o.only && m.handle !== o.only) continue;
        if (!m.login) continue;
        try {
          const token = await c.token(m.id).catch(() => null), x = await extras(m.login, token, Date.now());
          const prev = S.gh(m.id);
          if (!o.dry) c.q("INSERT OR REPLACE INTO land_gh VALUES (?,?,?,?,?,?)").run(m.id, m.login, x.p ?? prev?.p ?? 0, x.s, JSON.stringify(x.archived), new Date().toISOString());
          checked++;
        } catch (e: any) { failed++; if (e?.stop) { stopped = true; break; } console.error("land", m.handle, e?.message); }
        await sleep(c.pause ?? 3000);
      }
      if (!o.dry) { c.persist(); c.q("INSERT INTO hub_meta VALUES ('land_run', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(new Date().toISOString()); }
    } finally { running = false; }
    return { checked, failed, stopped };
  }
  /** nightly, around 02:00 Pacific (10:00 UTC); a hub that has never run it runs it 10 minutes after start */
  function schedule() {
    const last = () => Date.parse((c.q("SELECT v FROM hub_meta WHERE k='land_run'").get() as any)?.v || "") || 0;
    const tick = () => { const h = new Date().getUTCHours(), since = Date.now() - last(); if (!last() || (h === 10 && since > 20 * 3600_000) || since > 30 * 3600_000) void run().catch(e => console.error("land job", e?.message)); };
    const t0 = setTimeout(() => { tick(); const t = setInterval(tick, 15 * 60_000); t.unref?.(); }, 10 * 60_000); t0.unref?.();
  }
  return { run, schedule, store: S };
}
