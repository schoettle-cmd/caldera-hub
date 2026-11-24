/**
 * Caldera Points, phase 1 (LOOP.md part d; spec 2026-11-24 section 5): "Promote your project", the promoted card in each
 * place, the counts, the operator review queue, and the pages /points, /points/promote, /points/counts.
 * Phase 2 (net.js, the README badge, host earnings, /points/embed) is not built: Growth Engine starts it after 14 days of
 * phase 1, so no page here links to it.
 *
 * Rules (spec section 5): a member promotes ONE of their own projects (a public repo, the product link on their profile, or
 * their Caldera profile). No third-party, paid, adult, gambling, crypto-token or misleading ads. Every ad is reviewed by the
 * operator before it shows (admin.js promos), every card carries "Promoted by @{handle} with Caldera Points" and a Report
 * link (admin.js promo-reports). Points have no cash value, are never sold and cannot be sent to another member.
 *
 * Showings: for each place, one live promotion is drawn at random with weight = its daily bid, each owner's share cut to 1 in
 * 4 at most (the rest of the showings show nothing, so with 1 advertiser 3 in 4 page views have no card). A promotion only
 * draws while its owner's balance covers one more day; it starts again by itself when it does. Points are taken one time a
 * day, at 20:00 PT (04:00 UTC), for each day the promotion was shown (a counted view). Counts are numbers by day and place;
 * the one-a-day-per-person check keeps a daily salted hash for 3 days, never a name or an address.
 *
 * Routes:
 *   GET  /points, /points/promote, /points/counts      the member's pages (sign in first)
 *   GET  /points/report?id=                            the report sheet (anyone)
 *   POST /v1/points/promote {action, kind, target, title, line, bid}   submit | takeback | save | pause | resume
 *   POST /v1/points/report  {id, reason}
 *   GET  /v1/points/card?pl=people                     the card for the static People page ({html, css}; html "" = none)
 *   GET  /p/{id}?pl={place}                            counts the click, then sends the reader to the project
 */
import crypto from "node:crypto";
import type http from "node:http";
import { DAY } from "./growth";
import { POINTS, spendDayOf, ledgerWhat, type PointsStore } from "./points";

type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clean = (v: unknown, max: number) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const PLACES = ["home", "mail", "feed", "people"] as const;
export type Place = typeof PLACES[number];
export const PLACE_LABEL: Record<Place, string> = { home: "Homepage", mail: "Battle mail", feed: "Feed", people: "People" };
/** the operator's fixed list (LOOP.md d.4) */
export const REJECT_REASONS: Record<string, string> = { mine: "the project is not yours", claim: "the line makes a claim the project page does not show",
  adult: "adult, gambling or crypto-token project", link: "the link does not open" };
/** the reader's report sheet (LOOP.md d.5) */
export const REPORT_REASONS: Record<string, string> = { mine: "Not their own project", claim: "Misleading claim", adult: "Adult, gambling or crypto-token", other: "Something else" };
export const TITLE_MAX = 40, LINE_MAX = 90;

/** Each bid's share of the showings: proportional to the bid, no share above `cap`; what the cap cuts goes to the others while
 *  they are under it, and the rest of the showings show no card (1 advertiser: 25%; 2: 25% + 25%; 4 or more: they fill 100%). */
export function shares(bids: number[], cap = POINTS.cap): number[] {
  const out = bids.map(() => 0), order = bids.map((b, i) => [Math.max(0, b), i] as [number, number]).sort((a, b) => b[0] - a[0]);
  let rem = 1, restW = order.reduce((t, [b]) => t + b, 0);
  for (let k = 0; k < order.length; k++) {
    const [b, i] = order[k]!; if (restW <= 0) break;
    const s = rem * b / restW;
    if (s > cap) { out[i] = cap; rem -= cap; restW -= b; continue; }
    for (let j = k; j < order.length; j++) out[order[j]![1]] = rem * order[j]![0] / restW;
    break;
  }
  return out;
}

export interface PromoRow { id: number; owner: string; kind: "repo" | "site" | "profile"; target: string; title: string; line: string; bid: number; status: string; reason: string | null; created: number; live_since: number | null; updated: number }
export interface Viewer { id?: string | null; key?: string; bot?: boolean }
export interface PromoChoice { kind: "repo" | "site" | "profile"; target: string; label: string; sub: string }

export interface PointsHubCtx {
  q: Q; hub: string; P: PointsStore; now?: () => number; rng?: () => number;
  memberOf: (req: http.IncomingMessage) => string | null; sameOrigin: (req: http.IncomingMessage) => boolean;
  readBody: (req: http.IncomingMessage) => Promise<any>; json: (res: http.ServerResponse, status: number, body: unknown) => void;
  /** the site header placeholder (HEADER_MARK: the hub swaps in the real header for the viewer) */ header: () => string;
  profile: (id: string) => { handle?: string; name?: string } | null;
  avatar: (id: string) => string | null;
  /** the member's own public, non-fork repos with stars (from the growth poller), best first */ reposOf: (id: string) => { full: string; stars: number }[];
  /** the product link on the member's Caldera profile (https), or null */ productLink: (id: string) => string | null;
  alert?: (o: { target: string; key: string; title: string; body: string; ctaLabel?: string; ctaUrl?: string; by?: string }) => void;
  viewerOf: (req: http.IncomingMessage) => Viewer;
  tooMany: (key: string, max: number) => boolean;
}

// ---------------------------------------------------------------------------------------------- styles (mockup d, .pt-* and .pr-*)
/** the promoted card (Feed, People, homepage): own tokens fall back to the site's */
export const PR_CSS = `:root{--pt:#4FB89A}:root[data-theme="light"]{--pt:#0E6E54}
.pr-box{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--bg-raised);text-align:left}
.pr-eb{margin:0 0 8px;font:500 12px var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.pr-main{display:grid;grid-template-columns:36px minmax(0,1fr);gap:2px 12px;align-items:center;min-height:44px;color:var(--text)!important;text-decoration:none!important}
.pr-main .av{grid-row:1/3;width:36px;height:36px;border-radius:50%;overflow:hidden;display:grid;place-items:center;font:600 15px var(--font-body,'IBM Plex Sans',sans-serif);color:#fff;background:#5A6478}
.pr-main .av img{width:100%;height:100%;object-fit:cover;display:block}
.pr-t{font-weight:600;color:var(--text-strong);overflow-wrap:anywhere}.pr-l{font-size:14.5px;color:var(--text);overflow-wrap:anywhere}
.pr-by{margin:8px 0 0;font-size:12.5px;color:var(--text-muted)}.pr-by a{color:var(--accent-text)}.pr-by a.rep{margin-left:10px;color:var(--text-muted);text-decoration:underline}
.pr-box :focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

const PT_CSS = `<style>${PR_CSS}
.ep{max-width:760px;margin:0 auto;padding:28px 16px 64px}
.ep h1{font:600 clamp(1.6rem,3vw,2.2rem)/1.15 var(--font-display,'Source Serif 4',Georgia,serif);color:var(--text-strong);margin:0 0 6px}
.ep .lede{color:var(--text-muted);margin:0 0 20px;max-width:60ch}
.ep .set-h{font:600 1.05rem var(--font-body,'IBM Plex Sans',sans-serif);color:var(--text-strong);margin:30px 0 4px}
.ep .set-sub{margin:0 0 8px;color:var(--text-muted);font-size:14px}
.ep .card{background:var(--bg-raised);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0}
.ep .mut{color:var(--text-muted);font-size:13.5px}.ep .fine{font-size:12.5px}
.ep .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}
.ep .btn{justify-content:center;border:1px solid var(--accent-btn,var(--accent));cursor:pointer;font:600 15px var(--font-body,'IBM Plex Sans',sans-serif);color:var(--on-accent,#fff)!important}
.ep .btn.ghost{background:transparent;border-color:var(--line-strong);color:var(--text-strong)!important}.ep .btn.small{min-height:38px;padding:0 16px;font-size:14px}
.ep .btn:disabled{opacity:.5;cursor:default}
.ep :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pt-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 18px;border-bottom:1px solid var(--line)}
.pt-tabs a{padding:10px 12px;font-size:14.5px;font-weight:500;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-1px;text-decoration:none}
.pt-tabs a[aria-current]{color:var(--text-strong);border-color:var(--accent)}
.pt-bal{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:end}
.pt-n{font:600 clamp(40px,9vw,64px)/1 var(--font-display,'Source Serif 4',Georgia,serif);color:var(--text-strong)}
.pt-n small{font:500 15px var(--font-mono,'IBM Plex Mono',monospace);color:var(--pt);margin-left:8px}
.pt-exp{grid-column:1/-1;margin:0;font-size:14px;color:var(--text-muted)}.pt-exp.soon{color:var(--warn,#E0A63C)}
:root[data-theme="light"] .pt-exp.soon{color:#8A5A00}
.pt-law{margin:14px 0 0;padding:12px 14px;border-left:3px solid var(--pt);background:var(--bg);border-radius:0 8px 8px 0;font-size:14px}
.pt-law b{color:var(--text-strong)}
.pt-t{width:100%;border-collapse:collapse;font-size:14.5px}
.pt-t th{font:500 12px var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);text-align:left;padding:6px 0;border-bottom:1px solid var(--line-strong)}
.pt-t td{padding:9px 0;border-bottom:1px solid var(--line);vertical-align:top}.pt-t tr:last-child td{border-bottom:0}
.pt-t .n{text-align:right;font:600 14px var(--font-mono,'IBM Plex Mono',monospace);white-space:nowrap;color:var(--text-strong)}.pt-t .n.plus{color:var(--pt)}.pt-t .n.minus{color:var(--text-muted)}
.pt-t td small{display:block;color:var(--text-muted);font-size:12.5px}
.pt-t td.d{color:var(--text-muted);white-space:nowrap;padding-right:14px}
.pt-opt{display:grid;grid-template-columns:20px minmax(0,1fr);gap:0 10px;align-items:start;min-height:44px;padding:10px 12px;margin-top:6px;border:1px solid var(--line);border-radius:10px;cursor:pointer;background:var(--bg)}
.pt-opt input{margin:4px 0 0;accent-color:var(--accent)}.pt-opt b{font-weight:600;color:var(--text-strong);overflow-wrap:anywhere}.pt-opt small{grid-column:2;color:var(--text-muted);font-size:13px;overflow-wrap:anywhere}
.pt-opt:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}
.pt-f{display:block;margin-top:12px}.pt-f>span{display:flex;justify-content:space-between;font-size:13.5px;font-weight:500;margin-bottom:4px}.pt-f>span i{font:500 12px var(--font-mono,'IBM Plex Mono',monospace);font-style:normal;color:var(--text-muted)}
.pt-f input{width:100%;box-sizing:border-box;min-height:44px;padding:0 12px;border:1px solid var(--line-strong);border-radius:10px;background:var(--bg);color:var(--text-strong);font:16px var(--font-body,'IBM Plex Sans',sans-serif)}
.pt-bid{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:8px}
.pt-stp{display:inline-flex;align-items:center;border:1px solid var(--line-strong);border-radius:12px;overflow:hidden;background:var(--bg)}
.pt-stp button{width:44px;height:44px;border:0;background:none;color:var(--text-strong);font:600 18px var(--font-mono,'IBM Plex Mono',monospace);cursor:pointer}.pt-stp button:disabled{opacity:.35;cursor:default}
.pt-stp output{min-width:70px;text-align:center;font:600 18px var(--font-mono,'IBM Plex Mono',monospace);color:var(--text-strong)}
.pt-est{flex:1;min-width:200px;margin:0;font-size:14px}
.pt-st{display:grid;grid-template-columns:10px minmax(0,1fr);gap:4px 10px;align-items:baseline;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
.pt-st i{width:10px;height:10px;border-radius:50%;background:var(--text-muted);align-self:center}
.pt-st.live i{background:var(--success,#3FB97F)}.pt-st.rev i{background:var(--warn,#E0A63C)}.pt-st.no i{background:var(--danger,#F0716A)}
.pt-st b{color:var(--text-strong)}.pt-st p{grid-column:2;margin:0;font-size:14px;color:var(--text-muted)}
.pt-err{color:var(--danger,#F0716A);font-size:14px;margin:8px 0 0}
@media (max-width:700px){.pt-bal{grid-template-columns:1fr}.pt-bal .btn{justify-self:start}}
@media (max-width:520px) and (min-width:440px){.ep{padding-top:18px;font-size:14.5px}.pt-t{font-size:13.5px}.ep .card{padding:14px}}
</style>`;

const LAW = `<p class="pt-law"><b>Caldera Points have no cash value.</b> They can only be used for promotion on Caldera and its ad network. You cannot buy, sell, send or exchange points.</p>`;
const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtDay = (d: Date | number) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtPtDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

// ---------------------------------------------------------------------------------------------- the store
export function promoteStore(q: Q, P: PointsStore, now: () => number) {
  q(`CREATE TABLE IF NOT EXISTS promotions (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT UNIQUE, kind TEXT, target TEXT, title TEXT, line TEXT, bid INTEGER, status TEXT, reason TEXT, created INTEGER, live_since INTEGER, updated INTEGER)`).run();
  q(`CREATE TABLE IF NOT EXISTS promo_counts (promo INTEGER, day INTEGER, place TEXT, views INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, PRIMARY KEY (promo, day, place))`).run();
  q(`CREATE TABLE IF NOT EXISTS promo_seen (promo INTEGER, day INTEGER, place TEXT, ev TEXT, who TEXT, PRIMARY KEY (promo, day, place, ev, who))`).run();
  q(`CREATE TABLE IF NOT EXISTS promo_days (promo INTEGER, day INTEGER, charged INTEGER DEFAULT 0, amount INTEGER DEFAULT 0, PRIMARY KEY (promo, day))`).run();
  q(`CREATE TABLE IF NOT EXISTS promo_reports (promo INTEGER, who TEXT, reason TEXT, ts INTEGER, PRIMARY KEY (promo, who))`).run();
  const rowOf = (r: any): PromoRow | null => r ? { ...r, id: Number(r.id), bid: Number(r.bid), created: Number(r.created), live_since: r.live_since == null ? null : Number(r.live_since), updated: Number(r.updated) } : null;
  const hashWho = (day: number, who: string) => crypto.createHash("sha256").update(`promo:${day}:${who}`).digest("base64url").slice(0, 16);
  const S = {
    get: (id: number) => rowOf(q("SELECT * FROM promotions WHERE id=?").get(id)),
    of: (owner: string) => rowOf(q("SELECT * FROM promotions WHERE owner=?").get(owner)),
    live: (): PromoRow[] => (q("SELECT * FROM promotions WHERE status='live' ORDER BY id").all() as any[]).map(r => rowOf(r)!),
    queue: (): PromoRow[] => (q("SELECT * FROM promotions WHERE status='review' ORDER BY updated").all() as any[]).map(r => rowOf(r)!),
    /** write the owner's one promotion (one row per owner: a new ad replaces the old one) */
    put(owner: string, o: { kind: string; target: string; title: string; line: string; bid: number; status: string; reason?: string | null; live_since?: number | null }) {
      const t = now(), cur = S.of(owner);
      if (cur) q("UPDATE promotions SET kind=?, target=?, title=?, line=?, bid=?, status=?, reason=?, live_since=?, updated=? WHERE id=?").run(o.kind, o.target, o.title, o.line, o.bid, o.status, o.reason ?? null, o.live_since === undefined ? cur.live_since : o.live_since, t, cur.id);
      else q("INSERT INTO promotions (owner, kind, target, title, line, bid, status, reason, created, live_since, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(owner, o.kind, o.target, o.title, o.line, o.bid, o.status, o.reason ?? null, t, o.live_since ?? null, t);
      return S.of(owner)!;
    },
    setStatus(id: number, status: string, o: { reason?: string | null; live_since?: number | null; bid?: number } = {}) {
      const r = S.get(id); if (!r) return null;
      q("UPDATE promotions SET status=?, reason=?, live_since=?, bid=?, updated=? WHERE id=?").run(status, o.reason === undefined ? r.reason : o.reason, o.live_since === undefined ? r.live_since : o.live_since, o.bid ?? r.bid, now(), id);
      return S.get(id);
    },
    /** uncharged days the promotion was shown, and whether it was shown today */
    owed(id: number, today = spendDayOf(now())) {
      const n = Number((q("SELECT COUNT(*) n FROM promo_days WHERE promo=? AND charged=0").get(id) as any).n) || 0;
      return { days: n, today: !!q("SELECT 1 FROM promo_days WHERE promo=? AND day=?").get(id, today) };
    },
    /** does the owner's balance cover what is owed plus one more day? (a paused-for-points promotion starts again by itself) */
    covers(r: PromoRow): boolean { const o = S.owed(r.id); return P.balanceOf(r.owner) >= r.bid * (o.days + (o.today ? 0 : 1)); },
    /** a counted event, one per person a day and place; returns true when it counted */
    count(id: number, place: Place, ev: "v" | "c", who: string, day = spendDayOf(now())): boolean {
      const r = q("INSERT OR IGNORE INTO promo_seen VALUES (?,?,?,?,?)").run(id, day, place, ev, hashWho(day, who));
      if (!Number(r.changes)) return false;
      q(`INSERT INTO promo_counts (promo, day, place, views, clicks) VALUES (?,?,?,?,?) ON CONFLICT (promo, day, place) DO UPDATE SET ${ev === "v" ? "views=views+1" : "clicks=clicks+1"}`).run(id, day, place, ev === "v" ? 1 : 0, ev === "c" ? 1 : 0);
      if (ev === "v") q("INSERT OR IGNORE INTO promo_days (promo, day) VALUES (?,?)").run(id, day);
      return true;
    },
    counts(id: number, sinceDay: number): Record<string, { views: number; clicks: number }> {
      const out: Record<string, { views: number; clicks: number }> = {};
      for (const r of q("SELECT place, SUM(views) v, SUM(clicks) c FROM promo_counts WHERE promo=? AND day>=? GROUP BY place").all(id, sinceDay) as any[]) out[r.place] = { views: Number(r.v) || 0, clicks: Number(r.c) || 0 };
      return out;
    },
    /** 20:00 PT: one charge for each past day a promotion was shown (idempotent per promotion and day) */
    spendDaily(): { charged: number; points: number } {
      const today = spendDayOf(now()); let charged = 0, points = 0;
      for (const d of q("SELECT promo, day FROM promo_days WHERE charged=0 AND day<? ORDER BY day").all(today) as any[]) {
        const r = S.get(Number(d.promo));
        const took = r ? P.spend(r.owner, r.bid, "promo", `${r.id}:${d.day}`, `Promotion: ${r.title}, 1 day`) : 0;
        q("UPDATE promo_days SET charged=1, amount=? WHERE promo=? AND day=?").run(took, d.promo, d.day); charged++; points += took;
      }
      return { charged, points };
    },
    report(id: number, who: string, reason: string): boolean { return Number(q("INSERT OR IGNORE INTO promo_reports VALUES (?,?,?,?)").run(id, crypto.createHash("sha256").update("report:" + who).digest("base64url").slice(0, 16), reason, now()).changes) > 0; },
    reports: () => (q("SELECT promo, reason, COUNT(*) n, MAX(ts) last FROM promo_reports GROUP BY promo, reason ORDER BY last DESC").all() as any[]).map(r => ({ promo: Number(r.promo), reason: r.reason, n: Number(r.n), last: new Date(Number(r.last)).toISOString() })),
    prune: () => q("DELETE FROM promo_seen WHERE day<?").run(spendDayOf(now()) - 3),
    erase(owner: string) { const r = S.of(owner); if (!r) return; for (const t of ["promo_counts", "promo_seen", "promo_days", "promo_reports"]) q(`DELETE FROM ${t} WHERE promo=?`).run(r.id); q("DELETE FROM promotions WHERE id=?").run(r.id); },
  };
  return S;
}
export type PromoteStore = ReturnType<typeof promoteStore>;

// ---------------------------------------------------------------------------------------------- the module
export function pointsHub(c: PointsHubCtx) {
  const now = () => (c.now ? c.now() : Date.now());
  const rng = c.rng || Math.random;
  const P = c.P, S = promoteStore(c.q, P, now);
  const hub = c.hub.replace(/\/$/, "");
  const handleOf = (id: string) => String(c.profile(id)?.handle || "");

  const hrefOf = (r: PromoRow) => r.kind === "repo" ? `https://github.com/${r.target}` : r.kind === "site" ? r.target : `${hub}/@${handleOf(r.owner)}/`;
  const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  /** what a member may promote: their own public repos, the product link on their profile, their Caldera profile */
  function choicesOf(id: string): PromoChoice[] {
    const h = handleOf(id), out: PromoChoice[] = [];
    let repos: { full: string; stars: number }[] = []; try { repos = c.reposOf(id) || []; } catch { /* none */ }
    for (const r of repos.slice(0, 12)) out.push({ kind: "repo", target: r.full, label: r.full, sub: `Public repo${r.stars ? `, ${fmtN(r.stars)} star${r.stars === 1 ? "" : "s"}` : ""}. Links to github.com/${r.full}` });
    let site: string | null = null; try { site = c.productLink(id); } catch { /* none */ }
    if (site) out.push({ kind: "site", target: site, label: "Your product page", sub: `The link on your Caldera profile: ${domainOf(site)}` });
    if (h) out.push({ kind: "profile", target: h, label: "Your Caldera profile", sub: `caldera.social/@${h}` });
    return out;
  }

  // ------------------------------------------------------------ the pick and the card
  /** draw the promotion for one showing in a place, and count the view (not for bots or the owner). null: no card */
  function pick(place: Place, v: Viewer = {}): PromoRow | null {
    const pool = S.live().filter(r => S.covers(r) && handleOf(r.owner));
    if (!pool.length) return null;
    const sh = shares(pool.map(r => r.bid)); let x = rng(), chosen: PromoRow | null = null;
    for (let i = 0; i < pool.length; i++) { if (x < sh[i]!) { chosen = pool[i]!; break; } x -= sh[i]!; }
    if (!chosen) return null;
    const who = v.id || v.key;
    if (who && !v.bot && v.id !== chosen.owner) S.count(chosen.id, place, "v", who);
    return chosen;
  }
  /** the data of a drawn card, for places that draw their own markup (the battle mail's table version) */
  function promoPick(place: Place, v: Viewer = {}) {
    const r = pick(place, v); if (!r) return null;
    const h = handleOf(r.owner), av = c.avatar(r.owner);
    return { id: r.id, title: r.title, line: r.line, handle: h, avatar: av ? hub + av : null, href: `${hub}/p/${r.id}?pl=${place}`, profile: `${hub}/@${h}/`, report: `${hub}/points/report?id=${r.id}` };
  }
  function cardHtml(r: { id: number; title: string; line: string; owner: string }, place: Place | "preview", abs = false): string {
    const h = handleOf(r.owner), av = c.avatar(r.owner), base = abs ? hub : "";
    const pic = av ? `<img src="${esc(base + av)}" alt="" width="36" height="36" loading="lazy">` : esc((h || "?").charAt(0).toUpperCase());
    const href = place === "preview" ? "#" : `${base}/p/${r.id}?pl=${place}`;
    return `<aside class="pr-box" aria-label="Promoted project"><p class="pr-eb">Built by the fleet</p><a class="pr-main" href="${href}" rel="sponsored noopener"${place === "preview" ? ' data-pv-link' : ""}><span class="av" aria-hidden="true">${pic}</span><span class="pr-t" data-pv-t>${esc(r.title)}</span><span class="pr-l" data-pv-l>${esc(r.line)}</span></a>`
      + `<p class="pr-by">Promoted by <a href="${base}/@${esc(h)}/">@${esc(h)}</a> with Caldera Points<a class="rep" href="${place === "preview" ? "#" : `${base}/points/report?id=${r.id}`}">Report</a></p></aside>`;
  }
  /** the shared card for a place (Feed, People, the homepage): "" when no promotion is live for it */
  function promoCard(place: Place, v: Viewer = {}, o: { abs?: boolean } = {}): string {
    const r = pick(place, v); return r ? cardHtml(r, place, o.abs) : "";
  }

  // ------------------------------------------------------------ pages
  const shell = (title: string, inner: string, js = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} - Caldera</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap">
<link rel="stylesheet" href="/assets/theme.css"><link rel="stylesheet" href="/assets/site.css">${PT_CSS}</head><body>${c.header()}<main class="ep">${inner}</main><footer class="footer"><span>&copy; 2026 mjonesone, LLC</span><span><a href="/guide">Guide</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></span></footer>${js ? `<script>${js}</script>` : ""}<script src="/assets/site.js" defer></script></body></html>`;
  const send = (res: http.ServerResponse, status: number, html: string) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" }); res.end(html); };
  const tabs = (cur: string) => `<nav class="pt-tabs" aria-label="Caldera Points">${[["/points", "Wallet"], ["/points/promote", "Promote your project"], ["/points/counts", "Counts"]]
    .map(([h, l]) => `<a href="${h}"${h === cur ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;

  const EARN: [string, string, string][] = [["A won night", "Your city dealt more damage than it took.", "+" + POINTS.won], ["A held night", "Your shield held more than got through.", "+" + POINTS.held],
    ["Order: Build", "One counted piece of work, for example a merged pull request.", "+" + POINTS.order.build], ["Order: Fight", "One move in the Tonight card.", "+" + POINTS.order.fight],
    ["Order: Scout", "Watch last night's replay.", "+" + POINTS.order.scout], ["A 7-night streak", "Each 7 nights in a row that your city fought.", "+" + POINTS.streak],
    ["Season podium", "Place 1, 2 or 3 at the end of a season.", POINTS.podium.map(fmtN).join(" / ")]];

  function walletPage(me: string): string {
    const bal = P.balanceOf(me), ex = P.expiringOf(me), hist = P.history(me, 30);
    let exp = "";
    if (bal <= 0) exp = `<p class="pt-exp">No points yet. Your first order pays ${POINTS.order.fight} to ${POINTS.order.build} points today.</p>`;
    else if (ex[0] && ex[0].days <= 14) exp = `<p class="pt-exp soon">${fmtN(ex[0].n)} points expire on ${fmtDay(ex[0].date)} (end of season ${ex[0].ends}). Use them before then.</p>`;
    else if (ex[0]) exp = `<p class="pt-exp">${fmtN(ex[0].n)} points expire on ${fmtDay(ex[0].date)} (end of season ${ex[0].ends}).${ex[1] ? ` The other ${fmtN(ex.slice(1).reduce((t, e) => t + e.n, 0))} expire on ${fmtDay(ex[1].date)} (end of season ${ex[1].ends}).` : ""}</p>`;
    const rows = hist.map(r => `<tr><td class="d">${fmtPtDay(r.ts)}</td><td>${esc(ledgerWhat(r))}</td><td class="n ${r.amount > 0 ? "plus" : "minus"}">${r.amount > 0 ? "+" : "-"}${fmtN(Math.abs(r.amount))}</td></tr>`).join("");
    return shell("Caldera Points", `${tabs("/points")}<h1>Caldera Points</h1><p class="lede">You earn points by work and by the nightly battle. You use them to show your own project to other members. Points are never sold.</p>
<section class="card" aria-label="Your balance"><div class="pt-bal"><div class="pt-n">${fmtN(Math.max(0, bal))}<small>points</small></div><a class="btn" href="/points/promote">Promote your project</a>${exp}</div>${LAW}</section>
<h2 class="set-h">How you earn</h2><p class="set-sub">Only work and play earn points. Points from a season expire at the end of the next season.</p>
<section class="card"><table class="pt-t"><thead><tr><th scope="col">For</th><th scope="col" class="n">Points</th></tr></thead><tbody>${EARN.map(e => `<tr><td>${e[0]}<small>${e[1]}</small></td><td class="n plus">${e[2]}</td></tr>`).join("")}</tbody></table></section>
<h2 class="set-h">Last 30 days</h2>
<section class="card">${rows ? `<table class="pt-t"><thead><tr><th scope="col">Day</th><th scope="col">What</th><th scope="col" class="n">Points</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="mut" style="margin:0">Nothing yet. Points you earn and use show here.</p>`}</section>
<p class="mut fine">Armory credits are a different thing. Credits buy bombs in the battle. Points buy promotion.</p>`);
  }

  /** the display state: draft (none, taken back), rev, live, out (live but the balance does not cover a day), paused, no */
  function stateOf(r: PromoRow | null): "draft" | "rev" | "live" | "out" | "paused" | "no" {
    if (!r || r.status === "draft") return "draft";
    if (r.status === "review") return "rev";
    if (r.status === "rejected") return "no";
    if (r.status === "paused") return "paused";
    return S.covers(r) ? "live" : "out";
  }
  function othersBids(me: string) { return S.live().filter(r => r.owner !== me && S.covers(r)).map(r => r.bid); }

  function promotePage(me: string): string {
    const r = S.of(me), st = stateOf(r), bal = P.balanceOf(me), ch = choicesOf(me);
    const bid = r?.bid || 40, lock = st === "rev", dis = lock ? " disabled" : "";
    let sel = r ? ch.findIndex(x => x.kind === r.kind && x.target === r.target) : 0; if (sel < 0) sel = 0;
    const title = r?.title || "", line = r?.line || "";
    const status = {
      draft: "", rev: `<div class="pt-st rev" role="status"><i></i><b>In review</b><p>We check each promotion before it shows. You get a bell alert when it is approved. No points are used until then.</p></div>`,
      live: `<div class="pt-st live" role="status"><i></i><b>Live since ${r?.live_since ? fmtPtDay(r.live_since) : ""}</b><p>${r?.bid} points a day. Shown on the homepage, in the battle mail, in the Feed and in People.</p></div>`,
      out: `<div class="pt-st no" role="status"><i></i><b>Paused: not enough points</b><p>You have ${fmtN(bal)} points and your bid is ${r?.bid} a day. It starts again by itself when your balance covers one day.</p></div>`,
      paused: `<div class="pt-st" role="status"><i></i><b>Paused</b><p>You paused this promotion. No points are used while it is paused.</p></div>`,
      no: `<div class="pt-st no" role="status"><i></i><b>Not approved</b><p>Reason: ${esc(r?.reason || "")}. Change the ad and submit it again. No points were used.</p></div>`,
    }[st];
    const opts = ch.map((x, i) => `<label class="pt-opt"><input type="radio" name="pj" value="${i}"${i === sel ? " checked" : ""}${dis}><b>${esc(x.label)}</b><small>${esc(x.sub)}</small></label>`).join("");
    const short = bal < bid;
    const buttons = st === "live" || st === "out" ? `<button class="btn" type="button" data-act="save">Save the new bid</button><button class="btn ghost" type="button" data-act="pause">Pause</button><span class="mut fine">A new title or line goes to review again.</span>`
      : st === "paused" ? `<button class="btn" type="button" data-act="resume">Start again</button><button class="btn ghost" type="button" data-act="save">Save the new bid</button><span class="mut fine">A new title or line goes to review again.</span>`
      : st === "rev" ? `<button class="btn" type="button" disabled>In review</button><button class="btn ghost" type="button" data-act="takeback">Take it back</button>`
      : `<button class="btn" type="button" data-act="submit"${short ? " disabled" : ""}>Submit for review</button><span class="mut fine" data-sub-hint>${short ? `Earn points first: a won night pays ${POINTS.won}.` : "No points are used until it is approved and shown."}</span>`;
    const data = JSON.stringify({ bal, bid, others: othersBids(me), min: POINTS.bid.min, max: POINTS.bid.max, step: POINTS.bid.step, cap: POINTS.cap, st, ch: ch.map(x => ({ kind: x.kind, target: x.target })), won: POINTS.won }).replace(/</g, "\\u003c");
    const preview = cardHtml({ id: r?.id || 0, title: title || "Your title", line: line || "Your one line", owner: me }, "preview");
    return shell("Promote your project", `${tabs("/points/promote")}<h1>Promote your project</h1><p class="lede">Show one of your own projects to other members. You pay with Caldera Points, by the day.</p>${status}
<h2 class="set-h">1. Your project</h2><p class="set-sub">One project at a time. It must be yours.</p>
<div role="radiogroup" aria-label="Your project">${opts}</div>
<h2 class="set-h">2. Your ad</h2><p class="set-sub">Say what it does. Make no claim that your project page does not show.</p>
<label class="pt-f"><span>Title <i id="c-t">${title.length} / ${TITLE_MAX}</i></span><input id="f-t" maxlength="${TITLE_MAX}" value="${esc(title)}" aria-describedby="c-t" autocomplete="off"${dis}></label>
<label class="pt-f"><span>One line <i id="c-l">${line.length} / ${LINE_MAX}</i></span><input id="f-l" maxlength="${LINE_MAX}" value="${esc(line)}" aria-describedby="c-l" autocomplete="off"${dis}></label>
<h2 class="set-h">3. Daily bid</h2><p class="set-sub">${POINTS.bid.min} to ${POINTS.bid.max} points a day. A higher bid shows more often. No member gets more than 1 in 4 showings.</p>
<div class="pt-bid"><span class="pt-stp"><button type="button" data-bid="-1" aria-label="Lower the bid by ${POINTS.bid.step}"${bid <= POINTS.bid.min || lock ? " disabled" : ""}>-</button><output id="o-bid" aria-label="Daily bid in points">${bid}</output><button type="button" data-bid="1" aria-label="Raise the bid by ${POINTS.bid.step}"${bid >= POINTS.bid.max || lock ? " disabled" : ""}>+</button></span>
<p class="pt-est" id="est" aria-live="polite"></p></div>
<p class="mut fine" style="margin-top:8px">Points are taken one time a day, at 20:00 PT, for each day your promotion was shown. You can pause at any time.</p>${LAW}
<h2 class="set-h">Preview</h2><p class="set-sub">The same card shows on the homepage, in the battle mail, in the Feed and in People.</p>${preview}
<div class="card" style="background:var(--bg)"><b style="color:var(--text-strong)">The rules</b><p class="mut" style="margin:6px 0 0">Your own project only. No ads for other people or companies. No paid placements. No adult, gambling or crypto-token projects. No misleading claims. Every card carries your handle and a Report link.</p></div>
<div class="row">${buttons}</div><p class="pt-err" id="err" role="alert" hidden></p>`, PROMOTE_JS.replace("__DATA__", () => data));
  }

  function countsPage(me: string): string {
    const r = S.of(me), since = spendDayOf(now()) - 6, cn = r ? S.counts(r.id, since) : {};
    const any = Object.values(cn).some(x => x.views || x.clicks);
    if (!r || (!any && r.status !== "live")) return shell("Counts", `${tabs("/points/counts")}<h1>Counts</h1><p class="lede">How often your promotion was shown and opened. Counts only: no names, no profiles.</p>
<section class="card"><p class="mut" style="margin:0">No counts yet. They start when your promotion is approved and shown.</p><div class="row"><a class="btn small" href="/points/promote">Promote your project</a></div></section>${LAW}`);
    const rows = PLACES.map(pl => { const x = cn[pl] || { views: 0, clicks: 0 };
      return `<tr><td${pl === "mail" ? ' title="Mails sent with your card."' : ""}>${PLACE_LABEL[pl]}</td><td class="n">${fmtN(x.views)}</td><td class="n">${fmtN(x.clicks)}</td></tr>`; }).join("");
    const tv = PLACES.reduce((t, pl) => t + (cn[pl]?.views || 0), 0), tc = PLACES.reduce((t, pl) => t + (cn[pl]?.clicks || 0), 0);
    const used = P.spentSince(me, "promo", `${r.id}:`, now() - 7 * DAY);
    return shell("Counts", `${tabs("/points/counts")}<h1>Counts</h1><p class="lede">How often your promotion was shown and opened. Counts only: no names, no profiles.</p>
<section class="card"><p class="mut" style="margin:0 0 8px">${esc(r.title)}. Last 7 days.</p><table class="pt-t"><thead><tr><th scope="col">Place</th><th scope="col" class="n">Views</th><th scope="col" class="n">Clicks</th></tr></thead><tbody>${rows}<tr><td><b style="color:var(--text-strong)">All places</b></td><td class="n">${fmtN(tv)}</td><td class="n">${fmtN(tc)}</td></tr></tbody></table></section>
<p class="mut fine">A view counts one time a day for each person. Bots and your own views do not count. Points used in these 7 days: ${fmtN(used)}.</p>${LAW}`);
  }

  function reportPage(id: number): string {
    const r = S.get(id);
    if (!r) return shell("Report this promotion", `<h1>Report this promotion</h1><p class="lede">This promotion is not here any more.</p>`);
    const opts = Object.entries(REPORT_REASONS).map(([k, l], i) => `<label class="pt-opt"><input type="radio" name="rp" value="${k}"${i ? "" : " checked"}><b style="font-weight:500">${l}</b></label>`).join("");
    return shell("Report this promotion", `<div class="card"><h1 style="font-size:1.4rem">Report this promotion</h1><p class="mut" style="margin:6px 0 10px">Tell us what is wrong. We look at each report.</p>
<p class="mut" style="margin:0 0 6px">${esc(r.title)}. Promoted by @${esc(handleOf(r.owner))} with Caldera Points</p>
<div role="radiogroup" aria-label="Reason">${opts}</div>
<div class="row"><button class="btn small" type="button" id="rp-go">Send report</button><span class="mut fine" id="rp-note" role="status">The member does not see who sent it.</span></div></div>`,
      `(function(){var b=document.getElementById('rp-go'),n=document.getElementById('rp-note');b.addEventListener('click',function(){var c=document.querySelector('input[name=rp]:checked');b.disabled=true;
fetch('/v1/points/report',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({id:${id},reason:c?c.value:'other'})}).then(function(r){if(r.ok){n.textContent='Sent. Thank you.';}else{b.disabled=false;n.textContent='Could not send. Try again.';}},function(){b.disabled=false;n.textContent='Could not send. Try again.';})})})();`);
  }

  // ------------------------------------------------------------ actions
  function act(me: string, b: any): { status: number; body: any } {
    const a = String(b?.action || ""), cur = S.of(me), st = stateOf(cur);
    if (a === "takeback") { if (!cur || st !== "rev") return { status: 409, body: { error: "nothing in review" } }; S.setStatus(cur.id, "draft"); return { status: 200, body: { ok: true, state: "draft" } }; }
    if (a === "pause") { if (!cur || (st !== "live" && st !== "out")) return { status: 409, body: { error: "not live" } }; S.setStatus(cur.id, "paused"); return { status: 200, body: { ok: true, state: "paused" } }; }
    if (a === "resume") { if (!cur || st !== "paused") return { status: 409, body: { error: "not paused" } }; S.setStatus(cur.id, "live"); return { status: 200, body: { ok: true, state: stateOf(S.get(cur.id)) } }; }
    const bid = Number(b?.bid);
    if (!Number.isInteger(bid) || bid < POINTS.bid.min || bid > POINTS.bid.max || bid % POINTS.bid.step) return { status: 400, body: { error: `the bid is ${POINTS.bid.min} to ${POINTS.bid.max} points a day, in steps of ${POINTS.bid.step}` } };
    const choice = choicesOf(me).find(x => x.kind === b?.kind && x.target === b?.target);
    if (!choice) return { status: 400, body: { error: "pick one of your own projects" } };
    const title = clean(b?.title, TITLE_MAX), line = clean(b?.line, LINE_MAX);
    if (!title || !line) return { status: 400, body: { error: "write a title and one line" } };
    if (a === "submit") {
      if (st === "rev" || st === "live" || st === "out" || st === "paused") return { status: 409, body: { error: "you have a promotion already: one at a time" } };
      if (P.balanceOf(me) < bid) return { status: 400, body: { error: `You have ${P.balanceOf(me)} points. You need ${bid} for one day.` } };
      S.put(me, { kind: choice.kind, target: choice.target, title, line, bid, status: "review", reason: null, live_since: null });
      return { status: 200, body: { ok: true, state: "rev" } };
    }
    if (a === "save") {
      if (!cur || (st !== "live" && st !== "out" && st !== "paused")) return { status: 409, body: { error: "not live" } };
      const changed = cur.title !== title || cur.line !== line || cur.kind !== choice.kind || cur.target !== choice.target;
      if (changed) { S.put(me, { kind: choice.kind, target: choice.target, title, line, bid, status: "review", reason: null, live_since: null }); return { status: 200, body: { ok: true, state: "rev" } }; }
      S.setStatus(cur.id, cur.status, { bid }); return { status: 200, body: { ok: true, state: stateOf(S.get(cur.id)) } };
    }
    return { status: 400, body: { error: "unknown action" } };
  }

  // ------------------------------------------------------------ operator (admin.js promos, promo-reports)
  const admin = {
    queue: () => S.queue().map(r => ({ id: r.id, handle: "@" + handleOf(r.owner), kind: r.kind, target: r.target, href: hrefOf(r), title: r.title, line: r.line, bid: r.bid, sent: new Date(r.updated).toISOString(), balance: P.balanceOf(r.owner) })),
    approve(id: number) {
      const r = S.get(id); if (!r || r.status !== "review") return { error: "not in review" };
      S.setStatus(id, "live", { reason: null, live_since: now() });
      try { c.alert?.({ target: r.owner, key: "promo-approved:" + id, title: "Your promotion is approved", body: `"${r.title}" now shows to other members. ${r.bid} points a day.`, ctaLabel: "See the counts", ctaUrl: "/points/counts", by: "points" }); } catch { /* the bell never blocks */ }
      return { ok: true, id, status: "live" };
    },
    reject(id: number, key: string) {
      const why = REJECT_REASONS[key]; if (!why) return { error: "reason: " + Object.keys(REJECT_REASONS).join(" | ") };
      const r = S.get(id); if (!r || (r.status !== "review" && r.status !== "live" && r.status !== "paused")) return { error: "not in review or live" };
      S.setStatus(id, "rejected", { reason: why, live_since: null }); return { ok: true, id, status: "rejected", reason: why };
    },
    reports: () => S.reports().map(x => { const r = S.get(x.promo); return { ...x, handle: r ? "@" + handleOf(r.owner) : null, title: r?.title || null, status: r?.status || "gone" }; }),
  };

  /** the timer: charge yesterday's showings at 20:00 PT, expire old seasons, drop old per-person checks */
  function tick() {
    const out = { spend: S.spendDaily(), expired: P.expire() }; S.prune();
    if (out.spend.charged || out.expired) console.log(`[points] charged ${out.spend.charged} promotion days (${out.spend.points} points), expired ${out.expired} points`);
    return out;
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL, p: string): Promise<boolean> {
    const GET = req.method === "GET";
    if (GET && (p === "/points" || p === "/points/" || p === "/points/promote" || p === "/points/counts")) {
      const me = c.memberOf(req);
      if (!me) { res.writeHead(302, { location: "/signin?back=" + encodeURIComponent(p), "cache-control": "no-store" }); res.end(); return true; }
      send(res, 200, p === "/points/promote" ? promotePage(me) : p === "/points/counts" ? countsPage(me) : walletPage(me)); return true;
    }
    if (GET && p === "/points/report") { send(res, 200, reportPage(Number(url.searchParams.get("id")) || 0)); return true; }
    if (GET && p === "/v1/points/card") {
      const pl = url.searchParams.get("pl") as Place; if (!PLACES.includes(pl) || pl === "mail") { c.json(res, 400, { error: "place" }); return true; }
      res.setHeader("cache-control", "private, no-store");
      const html = promoCard(pl, c.viewerOf(req)); c.json(res, 200, { html, css: html ? PR_CSS : "" }); return true;
    }
    const m = p.match(/^\/p\/(\d{1,9})$/);
    if (m && GET) {
      const r = S.get(Number(m[1])); if (!r || r.status === "draft") { res.writeHead(302, { location: "/", "cache-control": "no-store" }); res.end(); return true; }
      const pl = url.searchParams.get("pl") as Place, v = c.viewerOf(req), who = v.id || v.key;
      if (PLACES.includes(pl) && who && !v.bot && v.id !== r.owner && !c.tooMany("promo-click:" + who, 60)) S.count(r.id, pl, "c", who);
      res.writeHead(302, { location: hrefOf(r), "cache-control": "no-store", "referrer-policy": "origin" }); res.end(); return true;
    }
    if (p === "/v1/points/promote" && req.method === "POST") {
      const me = c.memberOf(req); if (!me) { c.json(res, 401, { error: "sign in first" }); return true; }
      if (!c.sameOrigin(req)) { c.json(res, 403, { error: "cross-site request refused" }); return true; }
      const b = await c.readBody(req).catch(() => null); const r = act(me, b); c.json(res, r.status, r.body); return true;
    }
    if (p === "/v1/points/report" && req.method === "POST") {
      if (!c.sameOrigin(req)) { c.json(res, 403, { error: "cross-site request refused" }); return true; }
      const b = await c.readBody(req).catch(() => null) as any, v = c.viewerOf(req), who = v.id || v.key || "";
      const r = S.get(Number(b?.id) || 0), reason = REPORT_REASONS[String(b?.reason || "")] ? String(b.reason) : "";
      if (!r || !reason) { c.json(res, 400, { error: "pick a reason" }); return true; }
      if (!who || v.bot || c.tooMany("promo-report:" + who, 10)) { c.json(res, 429, { error: "too many reports" }); return true; }
      S.report(r.id, who, reason); c.json(res, 200, { ok: true }); return true;
    }
    return false;
  }

  return { route, promoCard, promoPick, cardHtml, tick, admin, store: S, points: P, choicesOf, stateOf, act, erase: (id: string) => { S.erase(id); P.erase(id); } };
}

/** the promote form: counters, the bid stepper with the share and days estimate, the live preview, the actions */
const PROMOTE_JS = `(function(){var D=__DATA__;var $=function(s){return document.querySelector(s)};
var t=$('#f-t'),l=$('#f-l'),o=$('#o-bid'),est=$('#est'),err=$('#err'),bid=D.bid;
function shares(b,cap){var out=b.map(function(){return 0}),ord=b.map(function(x,i){return [Math.max(0,x),i]}).sort(function(a,c){return c[0]-a[0]}),rem=1,rw=ord.reduce(function(s,x){return s+x[0]},0);
for(var k=0;k<ord.length;k++){if(rw<=0)break;var s=rem*ord[k][0]/rw;if(s>cap){out[ord[k][1]]=cap;rem-=cap;rw-=ord[k][0];continue}for(var j=k;j<ord.length;j++)out[ord[j][1]]=rem*ord[j][0]/rw;break}return out}
function draw(){o.textContent=bid;var bs=document.querySelectorAll('[data-bid]');bs[0].disabled=D.st==='rev'||bid<=D.min;bs[1].disabled=D.st==='rev'||bid>=D.max;
if(D.bal<bid){est.textContent='You have '+D.bal+' points. You need '+bid+' for one day.'}else{var p=Math.round(shares(D.others.concat([bid]),D.cap).pop()*100),d=Math.floor(D.bal/bid);est.innerHTML='About <b>'+p+'%</b> of showings at today\\'s bids. Your '+D.bal+' points last <b>'+d+' day'+(d===1?'':'s')+'</b>.'}
var sb=document.querySelector('[data-act=submit]'),hint=document.querySelector('[data-sub-hint]');if(sb){sb.disabled=D.bal<bid;if(hint)hint.textContent=D.bal<bid?'Earn points first: a won night pays '+D.won+'.':'No points are used until it is approved and shown.'}}
document.querySelectorAll('[data-bid]').forEach(function(b){b.addEventListener('click',function(){bid=Math.max(D.min,Math.min(D.max,bid+D.step*(+b.getAttribute('data-bid'))));draw()})});
function pv(){$('[data-pv-t]').textContent=t.value||'Your title';$('[data-pv-l]').textContent=l.value||'Your one line';$('#c-t').textContent=t.value.length+' / '+t.maxLength;$('#c-l').textContent=l.value.length+' / '+l.maxLength}
t.addEventListener('input',pv);l.addEventListener('input',pv);document.querySelectorAll('[data-pv-link],.pr-box .rep').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault()})});
document.querySelectorAll('[data-act]').forEach(function(b){b.addEventListener('click',function(){var c=document.querySelector('input[name=pj]:checked'),ch=c?D.ch[+c.value]:null;err.hidden=true;b.disabled=true;
fetch('/v1/points/promote',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({action:b.getAttribute('data-act'),kind:ch&&ch.kind,target:ch&&ch.target,title:t.value,line:l.value,bid:bid})})
.then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){if(x.ok){location.reload();return}b.disabled=false;err.textContent=x.j.error||'Could not save. Try again.';err.hidden=false},function(){b.disabled=false;err.textContent='Could not save. Try again.';err.hidden=false})})});
draw()})();`;
