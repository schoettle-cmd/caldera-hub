/**
 * Sign-up and sign-in flows, one shape for every way in (Mike 2026-11-02: "make sure they're all measured"). Read by caldera-agg
 * as `.flows` for the Growth tab: flows[LA day]["door:method"] = {start, auth_ok, auth_fail, created, first_value}.
 *
 * - method: google | github | email | obsidian. door: where the person started (home, preview, career, join, join-designer,
 *   join-business, join-developer, signin, start, gate, external, direct, obsidian).
 * - A person is the funnel's one-day visitor hash (no cookie, nothing personal). Crawlers and scripts are never counted.
 * - start: began that flow. For Google and GitHub (2026-11-03, Growth Engine: datacenter scripts and crawlers wearing browser
 *   agents opened members' Message gates every hour and inflated starts with no sign-in behind them): only a navigation a
 *   person activated counts at once (Sec-Fetch-User: ?1, sent by Chrome 76+, Firefox 90+, Safari 16.4+). Any other start
 *   is held as start_unv with its door, and becomes a start only if that person reaches the callback (auth_ok/auth_fail). A sign-in that arrives with no recorded start (an email link opened elsewhere, a bookmark, a
 *   link from another site) gets its start recorded then, under the door "external", so start >= auth_ok always.
 * - auth_ok / auth_fail: finished or failed sign-in. created: a new account. Existing members signing in are auth_ok only.
 * - first_value: a new account that made the page its own the same day: connected GitHub (a GitHub sign-up does at once),
 *   published from Obsidian (an Obsidian sign-up does at once), connected Obsidian, added content to the page, or a photo.
 * - Our own addresses and test accounts are marked excluded for that person and day, and every row of theirs is left out.
 */
import type http from "node:http";
import { funnelDay } from "./funnel";

export type Method = "google" | "github" | "email" | "obsidian";
const OWN = /^(schoettle|mjonesoneinsta)(\+[^@]*)?@gmail\.com$|@(science-inc|mjonesone)\.com$|@example\.(com|org|net)$/i;
export const isOwnAddress = (email: string) => OWN.test(String(email || "").trim());

/** where this person started, from the page that sent them (same-site navigations carry the full URL) */
export function doorOf(req: http.IncomingMessage, url?: URL, ownHost = ""): string {
  const t = url?.searchParams.get("type"); if (t === "designer" || t === "business") return "join-" + t;
  const fr = url?.searchParams.get("from"); if (fr === "signin" || fr === "gate") return fr;   // /signin sends no referrer (on purpose): its buttons say so
  let ref: URL | null = null; try { ref = new URL(String(req.headers.referer || "")); } catch { /* none */ }
  if (!ref) return "direct";
  if (ref.host !== ownHost && ref.host !== String(req.headers.host || "")) return "external";
  const p = ref.pathname;
  if (p === "/") return "home";
  if (/^\/gh\/[^/]+\/career/.test(p)) return "career";
  if (/^\/gh\/[^/]+/.test(p) || (p === "/join/developer" && ref.searchParams.get("gh"))) return "preview";
  if (p === "/join/designer" || p === "/join/business" || p === "/join/developer") return "join-" + p.split("/")[2];
  if (p === "/join" || p === "/join/go") return "join";
  if (p === "/signin" || p.startsWith("/signin/")) return "signin";
  if (p === "/start" || p.startsWith("/start/")) return "start";
  if (/^\/(@|messages|feed|people|world)/.test(p)) return "gate";
  return "other";
}

/** a navigation the person activated (a click or a key), as modern browsers report it */
export const humanClick = (req: http.IncomingMessage) => req.headers["sec-fetch-user"] === "?1";

export function flows(c: { q: (sql: string) => any; vid: (req: http.IncomingMessage) => string | null; emailOf: (owner: string) => string | null }) {
  const { q } = c;
  q("CREATE TABLE IF NOT EXISTS flow_events (day TEXT, vid TEXT, flow TEXT, ev TEXT, ts TEXT, PRIMARY KEY (day, vid, flow, ev))").run();
  q("CREATE TABLE IF NOT EXISTS flow_doors (day TEXT, vid TEXT, method TEXT, door TEXT, PRIMARY KEY (day, vid, method))").run();
  q("CREATE TABLE IF NOT EXISTS flow_created (owner TEXT PRIMARY KEY, day TEXT, vid TEXT, flow TEXT)").run();
  q("CREATE TABLE IF NOT EXISTS flow_excluded (day TEXT, vid TEXT, why TEXT, PRIMARY KEY (day, vid))").run();
  // retention: same as the funnel's sign-up steps (90 days, Privacy Policy); the created link is only needed on its day
  const prune = () => { try { const cut = funnelDay(Date.now() - 90 * 86_400_000), two = funnelDay(Date.now() - 2 * 86_400_000);
    for (const t of ["flow_events", "flow_doors", "flow_excluded"]) q(`DELETE FROM ${t} WHERE day < ?`).run(cut);
    q("DELETE FROM flow_created WHERE day < ?").run(two); } catch { /* best effort */ } };
  prune(); setInterval(prune, 6 * 3600_000).unref();
  const put = (day: string, vid: string, flow: string, ev: string) => q("INSERT OR IGNORE INTO flow_events VALUES (?,?,?,?,?)").run(day, vid, flow, ev, new Date().toISOString());
  const safe = (fn: () => void) => { try { fn(); } catch (e: any) { console.error("flows", e?.message); } };   // counting never breaks a request
  const flowFor = (day: string, vid: string, method: Method) => {
    const d = (q("SELECT door FROM flow_doors WHERE day=? AND vid=? AND method=?").get(day, vid, method) as any)?.door;
    if (d) { put(day, vid, `${d}:${method}`, "start"); return `${d}:${method}`; }   // a held (start_unv) start counts once they reach the callback
    q("INSERT OR IGNORE INTO flow_doors VALUES (?,?,?,?)").run(day, vid, method, "external"); put(day, vid, `external:${method}`, "start");
    return `external:${method}`;
  };
  const exclude = (day: string, vid: string, owner: string | null | undefined) => {
    if (!owner) return; const em = c.emailOf(owner);
    if (em && isOwnAddress(em)) q("INSERT OR IGNORE INTO flow_excluded VALUES (?,?,?)").run(day, vid, "own address");
  };
  return {
    /** began a flow; the first door of the day wins, so a second click from elsewhere doesn't move them */
    start(req: http.IncomingMessage, method: Method, door: string) {
      safe(() => { const vid = c.vid(req); if (!vid) return; const day = funnelDay();
        q("INSERT OR IGNORE INTO flow_doors VALUES (?,?,?,?)").run(day, vid, method, door);
        if ((method === "google" || method === "github") && !humanClick(req)) { const d = (q("SELECT door FROM flow_doors WHERE day=? AND vid=? AND method=?").get(day, vid, method) as any)?.door || door; put(day, vid, `${d}:${method}`, "start_unv"); return; }
        put(day, vid, flowFor(day, vid, method), "start"); });
    },
    fail(req: http.IncomingMessage, method: Method) {
      safe(() => { const vid = c.vid(req); if (!vid) return; const day = funnelDay(); put(day, vid, flowFor(day, vid, method), "auth_fail"); });
    },
    /** signed in; created = a new account */
    ok(req: http.IncomingMessage, method: Method, owner: string | null | undefined, created: boolean) {
      safe(() => { const vid = c.vid(req); if (!vid) return; const day = funnelDay(), flow = flowFor(day, vid, method);
        put(day, vid, flow, "auth_ok"); exclude(day, vid, owner);
        if (created && owner) { put(day, vid, flow, "created"); q("INSERT OR IGNORE INTO flow_created VALUES (?,?,?,?)").run(owner, day, vid, flow); } });
    },
    /** an Obsidian vault published a new page: the whole flow at once, and its first value */
    obsidian(owner: string) {
      safe(() => { const day = funnelDay(), vid = "obs:" + owner.slice(-16), flow = "obsidian:obsidian";
        for (const ev of ["start", "auth_ok", "created", "first_value"]) put(day, vid, flow, ev);
        q("INSERT OR IGNORE INTO flow_created VALUES (?,?,?,?)").run(owner, day, vid, flow); exclude(day, vid, owner); });
    },
    /** a new account made its page its own (see the header); counted once, only on the day it was created */
    firstValue(owner: string | null | undefined) {
      safe(() => { if (!owner) return; const r = q("SELECT day, vid, flow FROM flow_created WHERE owner=?").get(owner) as any;
        if (r && r.day === funnelDay()) put(r.day, r.vid, r.flow, "first_value"); });
    },
    /** an account deleted the day it was made (tests, mostly) stops counting */
    erased(owner: string) { safe(() => { const r = q("SELECT day, vid FROM flow_created WHERE owner=?").get(owner) as any; if (r) q("INSERT OR IGNORE INTO flow_excluded VALUES (?,?,?)").run(r.day, r.vid, "deleted"); q("DELETE FROM flow_created WHERE owner=?").run(owner); }); },   // the id itself goes with the account
    /** a test session, by hand */
    excludeVid(day: string, vid: string, why: string) { q("INSERT OR IGNORE INTO flow_excluded VALUES (?,?,?)").run(day, vid, why); },
  };
}
