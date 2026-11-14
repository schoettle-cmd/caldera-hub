/**
 * The Leaderboard (Mike 2026-11-07: "Build leaderboard page on caldera as part of primary navigation" and "Post leaderboard
 * daily on caldera social feed for top developers"; design mjonesone.com/r-caldera-leaderboard-a7b14477).
 *
 * One ranking, the metric Caldera already lives by: a day's real code as the battles count it (battle.ts arsenal(): judged
 * human commits (40 a day) + 3 per merged PR (1 self-merged) + 8 per release + 2 per green CI day, the AI and streak
 * multipliers, capped at 60 a day) over the growth event log (growth.ts), which already applied the anti-gaming rules
 * (bots, empty and merge commits, reverts, forks, prereleases earn nothing; private repos count at 0.7, never by name).
 * A window's points are the sum of its days. Days are Pacific calendar days.
 *
 *   rankMembers(window, at?)  rows for every listed member, ranked: rank, handle, name, avatar, metric, prev (the window
 *                             before), trend, city tier (the plot's top lot), battle stats (tonight's ammo, hits landed in
 *                             the window; zero outside the battles), the link to their city
 *   GET /leaderboard?window=day|week|month|all   the page (the signed-in member's row highlighted, or shown under the list)
 *   GET /v1/leaderboard/rows?window=             the rows as JSON (public fields only; /v1/leaderboard itself is the profile scoreboard)
 *   dailyPost()  yesterday's top 10 to the feed at 09:00 Pacific, once a day (sysposts.ts), skipped under 3 shippers
 * Nothing here names a repo: counts and handles only.
 */
import crypto from "node:crypto";
import type http from "node:http";
import { DAY, dayOf, dayKey, TIER_NAMES, tierOf, type GEvent, type SimOut } from "./growth";
import { arsenal, battleStore, usdOf, fmtUsd } from "./battle";
import type { GrowthMember } from "./growthhub";

export type LbWindow = "day" | "week" | "month" | "all";
export const LB_DAYS: Record<LbWindow, number> = { day: 1, week: 7, month: 30, all: 0 };
export const LB_TOP = 10, POST_TOP = 10, POST_MIN = 3, POST_HOUR = 9;

// ---------------------------------------------------------------- Pacific days
const PT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const offCache = new Map<number, number>();
/** UTC minus Pacific wall time at `t`: 8h in winter, 7h in summer */
export function pacificOffsetMs(t: number): number {
  const h = Math.floor(t / 3600_000); const c = offCache.get(h); if (c !== undefined) return c;
  const p: Record<string, string> = {}; for (const x of PT.formatToParts(new Date(h * 3600_000))) p[x.type] = x.value;
  const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  const off = Math.round((h * 3600_000 - local) / 60_000) * 60_000;
  if (offCache.size > 5000) offCache.clear(); offCache.set(h, off); return off;
}
/** a timestamp whose UTC fields read as Pacific wall time */
export const toPacific = (t: number) => t - pacificOffsetMs(t);
/** the Pacific calendar day of `t`, as a day number (dayKey() names it) */
export const pacificDay = (t: number) => dayOf(toPacific(t));
export const pacificHour = (t: number) => new Date(toPacific(t)).getUTCHours();
/** "Thu, Nov 6" for a day number */
export const dayLabel = (d: number) => new Date(d * DAY).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDay = (d: number) => new Date(d * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// ---------------------------------------------------------------- the ranking (pure)
export interface LbMemberIn {
  id: string; handle: string; name: string; avatar: string | null; url: string;
  /** this member's judged events (growth log) */ events: GEvent[];
  /** repo -> AI signal count */ ai?: Map<string, number>;
  /** the streak standing on a Pacific day */ streak?: (pDay: number) => number;
  /** lot codes of the plot now (the city tier is the top lot) */ lots?: string;
  /** in the battles */ war?: boolean; /** dollars of battle damage dealt on nights [from, to] */ dmg?: (from: number, to: number) => number;
  /** hits landed over nights [from, to] */ hits?: (from: number, to: number) => number;
}
export interface LbRow {
  rank: number; id: string; handle: string; name: string; avatar: string | null; url: string;
  /** points in the window */ metric: number; /** the window before, same length (0 for all-time) */ prev: number; /** metric - prev (null for all-time) */ trend: number | null;
  /** days with points in the window */ active: number; tier: number; tierName: string;
  battle: { in: boolean; ammo: number; hits: number; /** dollars of damage dealt in the window */ usd: number };
}
const r1 = (x: number) => Math.round(x * 10) / 10;
/** events shifted to Pacific wall time and bucketed by Pacific day, so arsenal()'s UTC-day filter sees Pacific days */
function buckets(events: GEvent[]): Map<number, GEvent[]> {
  const out = new Map<number, GEvent[]>();
  for (const e of events) { if (e.v) continue; const s = { ...e, ts: toPacific(e.ts), seen: toPacific(e.seen) }; const d = dayOf(s.ts); if (!out.has(d)) out.set(d, []); out.get(d)!.push(s); }
  return out;
}
/** one member's points on one Pacific day: the battle arsenal for that day */
export function dayPoints(events: GEvent[], pDay: number, o: { ai?: Map<string, number>; streak?: number } = {}): number {
  const b = buckets(events).get(pDay); return b ? arsenal(b, pDay, { ai: o.ai, streak: o.streak, reverted: revertedOf(events) }).ammo : 0;
}
const revertedOf = (events: GEvent[]) => { const s = new Set<string>(); for (const e of events) if (e.x?.rv) s.add(e.x.rv.slice(0, 7)); return s; };
/** the window [d0, d1] (Pacific days) that ends on pToday */
export function windowOf(win: LbWindow, pToday: number, first = pToday): { d0: number; d1: number } {
  const n = LB_DAYS[win]; return n ? { d0: pToday - n + 1, d1: pToday } : { d0: Math.min(first, pToday), d1: pToday };
}
export function rankRows(ms: LbMemberIn[], win: LbWindow, pToday: number): LbRow[] {
  const rows: LbRow[] = [];
  for (const m of ms) {
    const bk = buckets(m.events), rv = revertedOf(m.events), days = [...bk.keys()];
    const first = days.length ? Math.min(...days) : pToday;
    const pts = (d: number) => { const b = bk.get(d); return b ? arsenal(b, d, { ai: m.ai, streak: m.streak?.(d) || 0, reverted: rv }).ammo : 0; };
    const sum = (d0: number, d1: number) => { let t = 0, a = 0; for (const d of days) if (d >= d0 && d <= d1) { const p = pts(d); t += p; if (p > 0) a++; } return { t, a }; };
    const { d0, d1 } = windowOf(win, pToday, first), cur = sum(d0, d1), n = d1 - d0 + 1;
    const prev = win === "all" ? 0 : sum(d0 - n, d0 - 1).t;
    let top = 0; for (const ch of m.lots || "") top = Math.max(top, Number(ch) || 0);
    const tier = top >= 4 ? tierOf(top) : top > 0 ? 1 : 0;
    rows.push({ rank: 0, id: m.id, handle: m.handle, name: m.name, avatar: m.avatar, url: m.url, metric: r1(cur.t), prev: r1(prev), trend: win === "all" ? null : r1(cur.t - prev), active: cur.a,
      tier, tierName: TIER_NAMES[tier] || "", battle: { in: !!m.war, ammo: m.war ? r1(pts(pToday)) : 0, hits: m.war && m.hits ? m.hits(d0 + 1, win === "all" ? 1e9 : d1 + 1) : 0, usd: m.war && m.dmg ? m.dmg(d0 + 1, win === "all" ? 1e9 : d1 + 1) : 0 } });
  }
  rows.sort((a, b) => b.metric - a.metric || b.active - a.active || b.prev - a.prev || a.handle.localeCompare(b.handle));
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}

// ---------------------------------------------------------------- the daily post (Caldera's own voice, no sign-off)
export function dailyPostText(rows: LbRow[], pDay: number, hub: string): string {
  const H = hub.replace(/\/$/, ""), top = rows.filter(r => r.metric > 0).slice(0, POST_TOP);
  const pts = (n: number) => { const k = Math.round(n); return `${k} pt${k === 1 ? "" : "s"}`; };
  const change = (r: LbRow) => { if (r.prev <= 0) return "new on the board"; const d = Math.round((r.trend || 0)); return d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : "same as the day before"; };
  const L = [`Top builders yesterday, ${dayLabel(pDay).replace(",", "")}`, ...top.map(r => `${r.rank}. @${r.handle} ${pts(r.metric)}, ${change(r)}`), "",
    `Points are the day's real code: commits, merged PRs, releases and green CI, counted the way the battles load their guns. Full board: ${H}/leaderboard The world: ${H}/world`];
  return L.join("\n");
}

// ---------------------------------------------------------------- the page
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const LB_CSS = `
.lb-main{max-width:980px;margin:0 auto;padding:10px 20px 40px}@media (max-width:600px){.lb-main{padding:8px 16px 32px}}
.lb-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px 18px;margin:18px 0 14px}
.lb-head h1{font:600 clamp(26px,3.4vw,34px)/1.1 var(--font-display,'Source Serif 4',Georgia,serif);margin:0;color:var(--text-strong,#F2F2F5);letter-spacing:-.01em;text-wrap:balance}
.lb-head p{margin:6px 0 0;color:var(--text-muted,#8A8A93);max-width:62ch;font-size:15px}
.lb-tabs{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--line,#2A2A2E);background:var(--bg-raised,#232327);flex:none;max-width:100%}
.lb-tabs a{font:600 13px/1 var(--font-body,'IBM Plex Sans',sans-serif);display:inline-flex;align-items:center;min-height:34px;padding:0 13px;border-radius:999px;color:var(--text-muted,#8A8A93);white-space:nowrap;text-decoration:none}
.lb-tabs a[aria-current="page"]{background:#8B6CF6;color:#fff}.lb-tabs a:not([aria-current]):hover{color:var(--text-strong,#F2F2F5)}.lb-tabs a:focus-visible{outline:2px solid #B9A6FF;outline-offset:2px}
@media (pointer:coarse){.lb-tabs a{min-height:40px}}
.lb-sub{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0 0 10px;font:500 12px/1.4 var(--font-mono,'IBM Plex Mono',monospace);color:var(--text-muted,#8A8A93)}.lb-sub b{color:var(--text-strong,#F2F2F5);font-weight:600}
.lb-panel{background:#0F1016;border:1px solid var(--line,#2A2A2E);border-radius:12px;overflow:hidden}.lb-tbl{overflow-x:auto}
.lb-panel table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
.lb-panel th{font:500 11px/1.3 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.06em;text-transform:uppercase;color:#8A8A93;text-align:left;padding:12px 10px 9px;border-bottom:1px solid #2A2A2E}
.lb-panel td{padding:0;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:middle}.lb-panel tr:last-child td{border-bottom:0}
.lb-panel td>a,.lb-panel td>span{display:flex;align-items:center;min-height:56px;padding:8px 10px;text-decoration:none}
.lb-panel tbody tr:hover td{background:#16171F}
.lb-r{width:44px}.lb-r span{justify-content:center;font:600 15px var(--font-mono,'IBM Plex Mono',monospace);color:#8A8A93}
tr.lb-top1 .lb-r span{color:#F2C46D}tr.lb-top2 .lb-r span,tr.lb-top3 .lb-r span{color:#F2F2F5}
.lb-who a{gap:10px;color:#F2F2F5;font-weight:600}.lb-who a:hover .lb-h{text-decoration:underline}
.lb-av{flex:none;width:32px;height:32px;border-radius:50%;background:#3A2F5C;color:#D6CBFF;display:grid;place-items:center;font-size:13px;font-weight:600;overflow:hidden}.lb-av img{width:100%;height:100%;object-fit:cover}
.lb-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lb-nm small{display:block;font:400 12.5px/1.3 var(--font-body,'IBM Plex Sans',sans-serif);color:#8A8A93}
.lb-num,.lb-tr,.lb-tier,.lb-war{text-align:right}.lb-num span,.lb-tr span,.lb-tier span,.lb-war span{justify-content:flex-end}
.lb-num span{font:600 16px var(--font-mono,'IBM Plex Mono',monospace);color:#F2F2F5}
.lb-tr span{font:500 13px var(--font-mono,'IBM Plex Mono',monospace)}.lb-tr .up{color:#4FB89A}.lb-tr .down{color:#FB7185}.lb-tr .flat,.lb-tr .none{color:#8A8A93}.lb-tr .new{color:#B9A6FF}
.lb-tr i{font-style:normal;display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;margin-right:6px}.lb-tr .up i{border-bottom:6px solid currentColor}.lb-tr .down i{border-top:6px solid currentColor}
.lb-tier span{font:500 13px var(--font-body,'IBM Plex Sans',sans-serif);color:#DADADF;gap:8px}.lb-sq{width:10px;height:10px;border-radius:2px;background:#5A5A66;flex:none}
.lb-tier[data-t="2"] .lb-sq{background:#6E5BC2}.lb-tier[data-t="3"] .lb-sq{background:#8B6CF6}.lb-tier[data-t="4"] .lb-sq{background:#B9A6FF}.lb-tier[data-t="5"] .lb-sq{background:#F2C46D}
.lb-war span{font:500 12.5px var(--font-mono,'IBM Plex Mono',monospace);color:#3DF2FF;gap:10px}.lb-war .off{color:#8A8A93}.lb-war b{font-weight:600}.lb-dot{width:7px;height:7px;border-radius:50%;background:#3DF2FF;box-shadow:0 0 8px #3DF2FF;flex:none}
tr.lb-me td{background:#2A2440}tr.lb-me td:first-child{box-shadow:inset 3px 0 0 #8B6CF6}tr.lb-me .lb-who a{color:#B9A6FF}
.lb-you{font:600 10.5px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.06em;text-transform:uppercase;color:#fff;background:#8B6CF6;border-radius:4px;padding:3px 6px;margin-left:8px;flex:none}
tr.lb-gap td{height:14px;border:0;background:var(--bg,#1C1C1F)}tr.lb-gap td span{min-height:0;padding:0;justify-content:center;font:500 11px var(--font-mono,'IBM Plex Mono',monospace);color:#8A8A93;letter-spacing:.1em}
.lb-empty{padding:28px 16px;text-align:center;color:#8A8A93;font-size:14.5px}.lb-empty a{color:#B9A6FF}
.lb-foot{display:flex;flex-wrap:wrap;gap:6px 18px;margin:12px 0 0;font-size:13px;color:var(--text-muted,#8A8A93)}.lb-foot a{color:var(--accent-text,#B9A6FF)}
@media (max-width:640px){.lb-tier,.lb-war{display:none}.lb-nm small{display:none}.lb-panel td>a,.lb-panel td>span{min-height:52px;padding:6px 8px}.lb-num span{font-size:15px}}
`;
const TREND_HEAD: Record<LbWindow, string> = { day: "vs yesterday", week: "vs last week", month: "vs last month", all: "" };
const TAB: [LbWindow, string][] = [["day", "Today"], ["week", "Week"], ["month", "Month"], ["all", "All-time"]];
export function leaderboardPage(rows: LbRow[], o: { win: LbWindow; me: string | null; hub: string; nav: string; pToday: number; at: number }): string {
  const hub = o.hub.replace(/\/$/, ""), shipped = rows.filter(r => r.metric > 0), list = rows.slice(0, LB_TOP),   // always the top 10 (Mike 11-08): who shipped first, then the next members by rank at 0
    me = o.me ? rows.find(r => r.id === o.me) || null : null;
  const total = Math.round(shipped.reduce((t, r) => t + r.metric, 0));
  const { d0, d1 } = windowOf(o.win, o.pToday);
  const when = o.win === "day" ? `${dayLabel(d1)} (Pacific), so far` : o.win === "all" ? "Since the first commit on record" : `${shortDay(d0)} to ${shortDay(d1)} (Pacific)`;
  const av = (r: LbRow) => `<span class="lb-av">${r.avatar ? `<img src="${esc(r.avatar)}" alt="" loading="lazy">` : esc((r.name || r.handle).charAt(0).toUpperCase())}</span>`;
  const trend = (r: LbRow) => r.trend === null ? `<span class="none">&ndash;</span>` : r.prev <= 0 && r.metric > 0 ? `<span class="new">new</span>` : r.trend > 0 ? `<span class="up"><i></i>+${r.trend.toFixed(1)}</span>` : r.trend < 0 ? `<span class="down"><i></i>${r.trend.toFixed(1)}</span>` : `<span class="flat">0.0</span>`;
  const row = (r: LbRow, mine: boolean) => `<tr class="${r.rank <= 3 ? `lb-top${r.rank}` : ""}${mine ? " lb-me" : ""}"${mine ? ' aria-current="true"' : ""}><td class="lb-r"><span>${r.rank}</span></td>`
    + `<td class="lb-who"><a href="${esc(r.url)}">${av(r)}<span class="lb-nm"><span class="lb-h">@${esc(r.handle)}</span>${r.name && r.name !== "@" + r.handle && r.name !== r.handle ? `<small>${esc(r.name)}</small>` : ""}</span>${mine ? `<span class="lb-you">you</span>` : ""}</a></td>`
    + `<td class="lb-num"><span>${r.metric.toFixed(1)}</span></td><td class="lb-tr">${trend(r)}</td>`
    + `<td class="lb-tier" data-t="${r.tier}"><span>${r.tier ? `<i class="lb-sq"></i>${esc(r.tierName)}` : `<span style="color:#8A8A93">no plot yet</span>`}</span></td>`
    + `<td class="lb-war">${r.battle.in ? `<span><i class="lb-dot"></i><b>${fmtUsd(Math.round(r.battle.ammo) * 50000)} budget</b> ${r.battle.hits} hit${r.battle.hits === 1 ? "" : "s"}${r.battle.usd > 0 ? `, ${fmtUsd(r.battle.usd)} damage` : ""}</span>` : `<span class="off">peaceful</span>`}</td></tr>`;
  const body = list.length ? `<div class="lb-tbl"><table><thead><tr><th class="lb-r">#</th><th>Developer</th><th class="lb-num">Points</th><th class="lb-tr">${TREND_HEAD[o.win]}</th><th class="lb-tier">City</th><th class="lb-war">Battle</th></tr></thead><tbody>`
    + list.map(r => row(r, !!me && r.id === me.id)).join("")
    + (me && !list.some(r => r.id === me.id) ? `<tr class="lb-gap"><td colspan="6"><span>&middot; &middot; &middot;</span></td></tr>${row(me, true)}` : "")
    + `</tbody></table></div>`
    : `<div class="lb-empty">${o.win === "day" ? "Nobody has shipped yet today (Pacific). The board fills as commits land." : "Nothing on the board for this window yet."} <a href="${hub}/world">See the world</a></div>`;
  const tabs = TAB.map(([k, l]) => `<a href="${hub}/leaderboard${k === "day" ? "" : "?window=" + k}"${k === o.win ? ' aria-current="page"' : ""}>${l}</a>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Caldera leaderboard: who shipped the most</title>
<meta name="description" content="Caldera's developers ranked by the day's real code: commits, merged PRs, releases and green CI. Today, this week, this month, all-time.">
<meta property="og:title" content="Caldera leaderboard"><meta property="og:description" content="Who shipped the most, by real code."><meta property="og:image" content="${hub}/og.jpg"><meta property="og:url" content="${hub}/leaderboard">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="canonical" href="${hub}/leaderboard${o.win === "day" ? "" : "?window=" + o.win}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/theme.css"><link rel="stylesheet" href="/assets/site.css"><style>${LB_CSS}</style></head><body>
${o.nav}
<main class="lb-main">
<div class="lb-head"><div><h1>Leaderboard</h1><p>Who shipped the most. Points are real code: commits, merged PRs, releases and green CI, counted the way the World grows and the battles load. Bots, empty and merge commits never count.</p></div>
<nav class="lb-tabs" aria-label="Window">${tabs}</nav></div>
<div class="lb-sub"><span>${esc(when)}</span><span><b>${shipped.length}</b> member${shipped.length === 1 ? "" : "s"} shipped</span><span><b>${total.toLocaleString("en-US")}</b> points</span><span>Updates every 15 minutes</span></div>
<div class="lb-panel">${body}</div>
<div class="lb-foot"><span>A row opens that member's city.</span><span>Private repos count, never by name.</span><span>Yesterday's top ${POST_TOP} is posted to the <a href="${hub}/feed?type=agents">Feed</a> at 9:00 Pacific.</span><span><a href="${hub}/world">The world</a></span></div>
</main><footer class="footer"><span>&copy; 2026 mjonesone, LLC</span><span><a href="/guide">Guide</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></span></footer>
</body></html>`;
}

// ---------------------------------------------------------------- the hub module
type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export interface LbCtx {
  q: Q; hub: string;
  sim: () => { sims: Map<string, SimOut>; events: GEvent[]; ai: Map<string, Map<string, number>> };
  members: () => GrowthMember[];
  avatar: (profileId: string) => string | null;
  systemPost: (key: string, text: string, links?: string[]) => { posted: boolean; id?: string; reason?: string };
  memberOf: (req: http.IncomingMessage) => string | null;
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  /** the page's header slot (the hub swaps THE header in) */ nav: () => string;
  /** CALDERA_LEADERBOARD_POST=0: the page stays, the daily post stops */ postOn?: () => boolean;
  now?: () => number;
}
export function leaderboard(c: LbCtx) {
  const now = () => (c.now ? c.now() : Date.now()), hub = c.hub.replace(/\/$/, "");
  const S = battleStore(c.q, () => crypto.randomBytes(18).toString("base64url"));
  let cache: { key: string; at: number; rows: LbRow[] } | null = null;
  function inputs(): LbMemberIn[] {
    const { sims, events, ai } = c.sim(), ms = c.members(), evBy = new Map<string, GEvent[]>();
    for (const e of events) { if (!evBy.has(e.p)) evBy.set(e.p, []); evBy.get(e.p)!.push(e); }
    const war = new Set(S.opts().filter(o => o.war).map(o => o.p));
    let shots: (import("./battle").Shot & { night: number })[] | null = null;
    const hitsOf = (id: string) => (from: number, to: number) => { if (!shots) shots = S.shots(0, 1e9); let n = 0; for (const s of shots) if (s.a === id && s.f > 0 && s.night >= from && s.night <= to) n++; return n; };
    const dmgOf = (id: string) => (from: number, to: number) => { if (!shots) shots = S.shots(0, 1e9); let n = 0; for (const s of shots) if (s.a === id && s.night >= from && s.night <= to) n += usdOf(s); return n; };
    return ms.map(m => { const sim = sims.get(m.id);
      return { id: m.id, handle: m.handle, name: m.name, avatar: c.avatar(m.id), url: m.city ? `${hub}/@${m.handle}/city.html` : `${hub}/@${m.handle}/`, events: evBy.get(m.id) || [], ai: ai.get(m.id),
        streak: (d: number) => (sim?.snaps.get(d) || sim?.snaps.get(d - 1))?.streak ?? sim?.streak ?? 0, lots: sim?.lots || "", war: war.has(m.id), hits: hitsOf(m.id), dmg: dmgOf(m.id) }; });
  }
  /** rows for the window ending on Pacific day `pDay` (default: today) */
  function rankFor(win: LbWindow, pDay = pacificDay(now())): LbRow[] {
    const key = `${win}:${pDay}`; if (cache && cache.key === key && now() - cache.at < 60_000) return cache.rows;
    const rows = rankRows(inputs(), win, pDay); cache = { key, at: now(), rows }; return rows;
  }
  const rankMembers = (win: LbWindow, at = now()) => rankFor(win, pacificDay(at));
  const pub = (r: LbRow) => { const { id, ...rest } = r; void id; return rest; };
  /** yesterday's (Pacific) top 10 to the feed, once: {dry} composes only; {day} another Pacific day; {force} posts under 3 shippers */
  function dailyPost(o: { dry?: boolean; day?: number; force?: boolean } = {}): { posted: boolean; key: string; id?: string; reason?: string; dry?: boolean; text: string } {
    const day = o.day ?? pacificDay(now()) - 1, rows = rankRows(inputs(), "day", day), shipped = rows.filter(r => r.metric > 0);
    const text = dailyPostText(rows, day, hub), key = "leaderboard:" + dayKey(day);
    if (shipped.length < POST_MIN && !o.force) return { posted: false, key, reason: `only ${shipped.length} shipped on ${dayKey(day)} (needs ${POST_MIN})`, text };
    if (o.dry) return { posted: false, key, dry: true, text };
    return { ...c.systemPost(key, text, [`${hub}/leaderboard`, `${hub}/world`]), key, text };
  }
  let done = -1;
  /** on the growth tick: from 09:00 Pacific, post yesterday's board once; a skip for too few shippers is retried until noon */
  function tick() {
    if (c.postOn && !c.postOn()) return;
    const t = now(), pd = pacificDay(t); if (pacificHour(t) < POST_HOUR || done === pd) return;
    try { const r = dailyPost(); if (r.posted || r.reason === "already posted" || pacificHour(t) >= 12) done = pd; if (r.posted) console.log(`[leaderboard] posted ${r.key} as ${r.id}`); }
    catch (e: any) { console.error("[leaderboard] post", e?.message); }
  }
  const winOf = (url: URL): LbWindow | null => { const w = String(url.searchParams.get("window") || "day"); return (w in LB_DAYS) ? w as LbWindow : null; };
  async function route(req: http.IncomingMessage, res: http.ServerResponse, p: string, url: URL): Promise<boolean> {
    if (req.method !== "GET") return false;
    if (p === "/v1/leaderboard/rows") {
      const w = winOf(url); if (!w) { c.json(res, 400, { error: "window must be day, week, month or all" }); return true; }
      const t = now(), rows = rankFor(w); res.setHeader("cache-control", "public, max-age=60");
      c.json(res, 200, { at: new Date(t).toISOString(), window: w, day: dayKey(pacificDay(t)), rows: rows.filter(r => r.metric > 0).slice(0, 100).map(pub) }); return true;
    }
    if (p === "/leaderboard" || p === "/leaderboard/") {
      const w = winOf(url) || "day", t = now();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", vary: "Cookie",
        "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
      res.end(leaderboardPage(rankFor(w), { win: w, me: c.memberOf(req), hub, nav: c.nav(), pToday: pacificDay(t), at: t })); return true;
    }
    return false;
  }
  return { rankMembers, rankFor, dailyPost, tick, route, invalidate: () => { cache = null; } };
}
