/**
 * Caldera x Orpheus tie, Part 1 (Mike 2026-11-22; spec ~/growth/notes/specs/2026-11-22-caldera-orpheus-tie.md, design
 * Fable 11-22, products/caldera/reports/2026-11-22-orpheus-tie/TIE.md). Words are fixed.
 *
 * - First-value card: once per member, across both places: under the welcome strip on the owner's own page or city
 *   (?welcome=1, at "page") and under Congratulations on /settings?new=1 (Google sign-ups, at "settings"); email sign-ups
 *   that land on /settings?new=1 (designer / business pages) get it under the "Your page is live" line (at "email"). The first render
 *   marks it shown (tie_seen); "Not now" only removes it from the page.
 * - Events, per LA day in tie_counts: tie_show / tie_click by place (first_value, home). first_value shows are counted at
 *   render (owner-only pages, so no robots); clicks and the homepage block come in on POST /v1/tie. Robots (BOT_UA) and our
 *   own sessions (the founder, the operator's own addresses) are never counted.
 * - caldera-agg / Growth Engine read them as `.tie` (stats(): tie[day]["tie_show:first_value"] = n), also on
 *   GET /v1/admin/tie (founder) and `admin.js tie-stats [days]`.
 */
import type http from "node:http";
import { funnelDay } from "./funnel";
import { isOwnAddress } from "./own";

export const tieHref = (medium: string, campaign = "tie") => `https://useorpheus.com/?utm_source=caldera&utm_medium=${medium}&utm_campaign=${campaign}`;
export interface TieWords { h: string; body: string; btn: string; small: string }
export const TIE_WORDS: TieWords = { h: "Show your agents on your profile", body: "Run Claude agents? Orpheus puts every account on one board and moves idle agents to the one with the most room. Connect it and your profile shows your fleet.", btn: "Try Orpheus free", small: "7 days free. No card to start." };
/** Founding Fleet window words (Growth Engine 11-24, spec 2026-11-22-orpheus-founding-fleet.md section 5); `left` only from the live /api/fleet answer */
export const fleetWords = (left: number | null): TieWords => ({ h: "Founding Fleet: half off your first Orpheus year",
  body: "Run Claude agents? Orpheus puts every account on one board and moves idle agents to the one with the most room. The first 100 yearly members get half off their first year and a gold pin on the Caldera dev map." + (left !== null ? ` ${left} of 100 spots left.` : ""),
  btn: "Claim a Founding Fleet spot", small: "7 days free with no card. Add a card in the first 48 hours for 30 days. Ends Monday, Nov 30." });
export const FLEET_FROM = Date.parse("2026-11-27T08:00:00Z"), FLEET_TO = Date.parse("2026-12-01T08:00:00Z");   // Fri 11-27 00:00 PT to Mon 11-30 23:59 PT
/** the offer state from GET useorpheus.com/api/fleet, read at most every 5 minutes; any doubt = today's words */
export function fleetOffer(fetchFn: typeof fetch = fetch, now = () => Date.now()) {
  let cache: { at: number; open: boolean; left: number | null } = { at: 0, open: false, left: null }, busy = false;
  const refresh = async () => {
    if (busy) return; busy = true;
    try {
      const r = await fetchFn("https://useorpheus.com/api/fleet", { signal: AbortSignal.timeout(8000) } as any); const j: any = r.ok ? await r.json() : null;
      const open = !!j && j.state === "open", n = [j?.left, j?.spotsLeft, j?.spots_left, j?.remaining].find(v => Number.isInteger(v) && v >= 0 && v <= 100);
      cache = { at: now(), open, left: open && n !== undefined ? n : null };
    } catch { cache = { at: now(), open: false, left: null }; } finally { busy = false; }
  };
  return {
    refresh,
    /** null = today's words */
    words(): TieWords | null { const t = now(); if (t < FLEET_FROM || t >= FLEET_TO) return null; if (t - cache.at > 300_000) void refresh(); return cache.open ? fleetWords(cache.left) : null; },
  };
}
/** what the endpoint takes: first_value shows are counted at render only */
const TAKES = new Set(["tie_show:home", "tie_click:home", "tie_click:first_value"]);
const ATS = new Set(["page", "settings", "email"]);
const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
/** click beacon for an onclick (single quotes: it sits in a double-quoted attribute); the link still opens on its own */
const beacon = (api: string, at: string) => `try{navigator.sendBeacon('${api}/v1/tie',JSON.stringify({ev:'tie_click',place:'first_value',at:'${at}'}))}catch(e){}`;

/** Place 1: the row under the welcome strip (sandboxed page, inline styles, dark only). api = the hub's origin; null = no beacon. */
export function tieBanner(href: string, api: string | null, closeJs = "this.parentNode.remove()", w: TieWords = TIE_WORDS): string {
  const click = api !== null ? ` onclick="${attr(beacon(api, "page"))}"` : "";
  return `<div id="cb-tie" data-tie="page" style="position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 52px 10px 16px;background:#120E22;border-bottom:1px solid #2A2244;font:400 13px/1.45 'IBM Plex Sans',Arial,sans-serif;color:#ABA3C6">`
    + `<span style="flex:1 1 340px;min-width:0;max-width:820px"><b style="display:block;font-weight:600;color:#DDD6F3">${w.h}</b>${w.body}</span>`
    + `<span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px 12px"><a href="${attr(href)}" target="_blank" rel="noopener"${click} style="display:inline-flex;align-items:center;box-sizing:border-box;min-height:40px;padding:0 16px;border:1px solid #5B4A99;border-radius:999px;color:#C9B8FF;font-weight:600;text-decoration:none;white-space:nowrap">${w.btn}</a><span style="font-size:12px;color:#8F88AB">${w.small}</span></span>`
    + `<button type="button" aria-label="Not now" title="Not now" onclick="${attr(closeJs)}" style="position:absolute;top:4px;right:6px;width:40px;height:40px;padding:0;border:0;background:none;cursor:pointer;color:#8F88AB;font:400 18px/1 Arial,sans-serif">&times;</button></div>`;
}
/** Place 2: the card under Congratulations on /settings?new=1 (same origin; styles in emailpages STYLE). */
export function tieCard(href: string, counted: boolean, at: "settings" | "email" = "settings", w: TieWords = TIE_WORDS): string {
  const click = counted ? ` onclick="${attr(beacon("", at))}"` : "";
  return `<section class="card tie" id="tie" data-tie="${at}" aria-label="Orpheus"><h2>${w.h}</h2><p class="mut">${w.body}</p><div class="row"><a class="btn small ghost" href="${attr(href)}" target="_blank" rel="noopener"${click}>${w.btn}</a><span class="mut fine">${w.small}</span></div><button type="button" class="tie-x" aria-label="Not now" title="Not now" onclick="this.parentNode.remove()">&times;</button></section>`;
}

export function tie(c: { q: (sql: string) => any; botUa: RegExp; ipOf: (r: http.IncomingMessage) => string; tooMany: (k: string, max: number) => boolean;
  memberOf: (r: http.IncomingMessage) => string | null; founder: () => string | null; emailOf: (id: string) => string | null }) {
  const { q } = c;
  q("CREATE TABLE IF NOT EXISTS tie_seen (owner TEXT PRIMARY KEY, ts TEXT, at TEXT)").run();
  q("CREATE TABLE IF NOT EXISTS tie_counts (day TEXT, ev TEXT, place TEXT, at TEXT, n INTEGER, PRIMARY KEY (day, ev, place, at))").run();
  const bump = (ev: string, place: string, at = "") => { try { q("INSERT INTO tie_counts VALUES (?,?,?,?,1) ON CONFLICT(day, ev, place, at) DO UPDATE SET n=n+1").run(funnelDay(), ev, place, at); } catch (e: any) { console.error("tie", e?.message); } };
  /** our own sessions: the founder and the operator's own addresses (own.ts) */
  const own = (id: string | null) => { if (!id) return false; if (id === c.founder()) return true; try { const e = c.emailOf(id); return !!e && isOwnAddress(e); } catch { return false; } };
  return {
    own,
    /** count one event (Part 2: tie_link:orpheus from orpheustie.ts); the caller leaves our own sessions out */
    count: (ev: string, place: string) => bump(ev, place),
    /** the first render for this member marks the card shown (once, both places) and counts the show; null = already shown */
    take(owner: string, at: "page" | "settings" | "email"): { counted: boolean } | null {
      try { if (!q("INSERT OR IGNORE INTO tie_seen VALUES (?,?,?)").run(owner, new Date().toISOString(), at).changes) return null; } catch { return null; }
      const counted = !own(owner); if (counted) bump("tie_show", "first_value", at); return { counted };
    },
    /** POST /v1/tie, text/plain JSON {ev, place, at?}: 400 for unknown values, 204 otherwise (robots, our own and floods dropped quietly) */
    async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
      const done = (s = 204) => { res.writeHead(s, { "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(); };
      let s = ""; for await (const ch of req) { s += ch; if (s.length > 300) return done(413); }
      let b: any; try { b = JSON.parse(s); } catch { return done(400); }
      const ev = String(b?.ev || ""), place = String(b?.place || ""), at = place === "first_value" && ATS.has(String(b?.at)) ? String(b.at) : "";
      if (!TAKES.has(ev + ":" + place)) return done(400);
      const ua = String(req.headers["user-agent"] || "");
      if (!ua || c.botUa.test(ua) || c.tooMany("tie-ip:" + c.ipOf(req), 40) || own(c.memberOf(req))) return done();
      bump(ev, place, at); done();
    },
    /** daily counts for Growth: tie[day]["ev:place"], and tie_at[day]["ev:first_value:page|settings"] */
    stats(days = 30) {
      const tie: Record<string, Record<string, number>> = {}, tie_at: Record<string, Record<string, number>> = {};
      for (const r of q("SELECT day, ev, place, at, n FROM tie_counts WHERE day >= ? ORDER BY day").all(funnelDay(Date.now() - days * 86_400_000)) as any[]) {
        const d = tie[r.day] || (tie[r.day] = {}), k = `${r.ev}:${r.place}`; d[k] = (d[k] || 0) + r.n;
        if (r.at) (tie_at[r.day] || (tie_at[r.day] = {}))[`${k}:${r.at}`] = r.n;
      }
      return { tie, tie_at };
    },
  };
}
export type Tie = ReturnType<typeof tie>;
