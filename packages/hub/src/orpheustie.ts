/**
 * Caldera x Orpheus tie, Part 2: the handle link (spec ~/growth/notes/specs/2026-11-22-orpheus-founding-fleet.md section 2;
 * replaces part 2 of 2026-11-22-caldera-orpheus-tie.md). Server side only: the look of the fleet (pins, badge, card) comes later.
 *
 * - LINK: Orpheus opens /link/orpheus?t=<token> (opaque, <=200 chars, 30 min, one use). The token waits in a short cookie
 *   (path /link/orpheus, 30 min) so it survives every sign-in route (GitHub, Google, email code: each takes back=/link/orpheus).
 *   Signed in, GET shows "Link this Orpheus workspace to @handle" and a POST button; the POST (same origin only) claims it
 *   server to server: POST {ORPHEUS}/api/tie/caldera/claim {t, handle} -> 200 {id, founding_fleet} | 409 handle_taken | 410 expired.
 * - UNLINK: POST /settings/orpheus/unlink (owner, same origin) deletes the local row at once and tells Orpheus
 *   (POST /api/tie/caldera/unlink {id}); a failed call is kept in orpheus_unlinked and retried with each feed pull.
 * - FEED: once a day after 01:00 UTC (and `admin.js orpheus-pull`): GET /api/tie/caldera/feed. Strict types, unknown fields
 *   ignored, at most 5000 rows; a bad feed changes nothing. An id missing from the feed is removed here.
 * - Events: a successful claim counts "tie_link:orpheus" in tie_counts (tie.ts), our own sessions left out.
 * Key: CALDERA_ORPHEUS_TIE_KEY. Empty = the feature is off (no calls). The key is never logged and never in a response.
 */
import type http from "node:http";

export const ORPHEUS_HANDLE = /^[A-Za-z0-9_.-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[\x21-\x7e]{1,200}$/;
const COOKIE = "cal_orph";
export const FLEET_MAX = 5000;
const FEED_MAX_BYTES = 4 * 1024 * 1024;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

export interface Fleet { handle: string; founding: boolean; linkedAt: string; agentsWeek: number; accounts: number; sessionsWeek: number; busiestDay: string | null }
export interface FeedRow { id: string; handle: string; founding_fleet: boolean; linked_at: string; agents_week: number; accounts: number; sessions_week: number; busiest_day: string | null }

const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e9;
const isoish = (v: unknown, max = 40) => typeof v === "string" && v.length > 0 && v.length <= max && !Number.isNaN(Date.parse(v));
/** strict check of the daily feed: null = reject the whole feed (nothing is changed); unknown fields are dropped */
export function parseFeed(j: any): { generatedAt: string; week: { from: string; to: string }; fleet: FeedRow[] } | null {
  if (!j || typeof j !== "object" || Array.isArray(j) || j.v !== 1 || !isoish(j.generated_at)) return null;
  const w = j.week; if (!w || typeof w !== "object" || !isoish(w.from) || !isoish(w.to)) return null;
  if (!Array.isArray(j.fleet) || j.fleet.length > FLEET_MAX) return null;
  const fleet: FeedRow[] = [], ids = new Set<string>();
  for (const r of j.fleet) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    if (typeof r.id !== "string" || !UUID.test(r.id) || ids.has(r.id.toLowerCase())) return null;
    if (typeof r.handle !== "string" || !ORPHEUS_HANDLE.test(r.handle) || typeof r.founding_fleet !== "boolean" || !isoish(r.linked_at)) return null;
    if (!count(r.agents_week) || !count(r.accounts) || !count(r.sessions_week)) return null;
    if (!(r.busiest_day === null || r.busiest_day === undefined || (typeof r.busiest_day === "string" && /^[A-Za-z0-9 ,:-]{1,32}$/.test(r.busiest_day)))) return null;
    ids.add(r.id.toLowerCase());
    fleet.push({ id: r.id.toLowerCase(), handle: r.handle, founding_fleet: r.founding_fleet, linked_at: r.linked_at, agents_week: r.agents_week, accounts: r.accounts, sessions_week: r.sessions_week, busiest_day: r.busiest_day ?? null });
  }
  return { generatedAt: j.generated_at, week: { from: w.from, to: w.to }, fleet };
}

export function orpheusTie(c: {
  q: (sql: string) => any; key: () => string; fetch: typeof fetch; base?: string; secure: boolean;
  memberOf: (r: http.IncomingMessage) => string | null; sameOrigin: (r: http.IncomingMessage) => boolean;
  profile: (id: string) => any; byHandle: (h: string) => any; hidden: (pr: any) => boolean;
  page: (title: string, body: string) => string; tooMany: (k: string, max: number) => boolean;
  /** tie.ts: count an event (our own sessions already left out by the caller) and tell our own sessions apart */
  count: (ev: string, place: string) => void; own: (id: string) => boolean;
}) {
  const { q } = c, BASE = (c.base || "https://useorpheus.com").replace(/\/$/, "");
  q(`CREATE TABLE IF NOT EXISTS orpheus_links (id TEXT PRIMARY KEY, profile TEXT UNIQUE, handle TEXT, founding INTEGER, linked_at TEXT,
    agents_week INTEGER, accounts INTEGER, sessions_week INTEGER, busiest_day TEXT, week_from TEXT, week_to TEXT, synced_at TEXT)`).run();
  q("CREATE TABLE IF NOT EXISTS orpheus_unlinked (id TEXT PRIMARY KEY, at TEXT, tries INTEGER)").run();
  q("CREATE TABLE IF NOT EXISTS hub_meta (k TEXT PRIMARY KEY, v TEXT)").run();
  const on = () => !!c.key();
  /** never let the key reach a log line */
  const log = (...a: unknown[]) => { const k = c.key(); console.error("orpheus tie", ...a.map(x => { const s = String(x); return k ? s.split(k).join("[key]") : s; })); };

  async function call(method: "GET" | "POST", path: string, body?: unknown, ms = 10_000): Promise<{ status: number; json: any }> {
    const r = await c.fetch(BASE + path, { method, redirect: "error", signal: AbortSignal.timeout(ms),
      headers: { authorization: "Bearer " + c.key(), accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const cl = Number(r.headers.get("content-length") || 0); if (cl > FEED_MAX_BYTES) return { status: 502, json: null };
    const txt = await r.text(); if (txt.length > FEED_MAX_BYTES) return { status: 502, json: null };
    let j: any = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
    return { status: r.status, json: j };
  }

  async function remoteUnlink(id: string): Promise<boolean> {
    if (!on()) return false;
    try { const r = await call("POST", "/api/tie/caldera/unlink", { id }); if (r.status === 200 && r.json?.ok === true) return true; log("unlink failed", "status " + r.status); }
    catch (e: any) { log("unlink failed", e?.name || "error", e?.message || ""); }
    return false;
  }
  /** delete here at once; tell Orpheus best effort, and keep a failed call to retry with the next pull */
  async function unlinkRow(id: string) {
    q("DELETE FROM orpheus_links WHERE id=?").run(id);
    if (!on()) { q("INSERT OR IGNORE INTO orpheus_unlinked VALUES (?,?,0)").run(id, new Date().toISOString()); return; }
    if (await remoteUnlink(id)) q("DELETE FROM orpheus_unlinked WHERE id=?").run(id);
    else q("INSERT INTO orpheus_unlinked VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET tries=tries+1").run(id, new Date().toISOString());
  }

  const rowOf = (profileId: string) => q("SELECT * FROM orpheus_links WHERE profile=?").get(profileId) as any;
  const fleetFromRow = (r: any): Fleet => {
    const pr = c.profile(r.profile);
    return { handle: pr?.handle || r.handle, founding: !!r.founding, linkedAt: r.linked_at, agentsWeek: r.agents_week ?? 0, accounts: r.accounts ?? 0, sessionsWeek: r.sessions_week ?? 0, busiestDay: r.busiest_day ?? null };
  };

  /** the feed: add / update per link id, remove ids Orpheus no longer has; a bad feed changes nothing */
  async function pull(): Promise<{ ok: boolean; error?: string; added?: number; updated?: number; removed?: number; retried?: number }> {
    if (!on()) return { ok: false, error: "off" };
    // unlinks that failed before: try again; those ids are never added back from this feed (it may predate the unlink)
    const gone = new Set((q("SELECT id FROM orpheus_unlinked").all() as any[]).map(x => String(x.id).toLowerCase()));
    let retried = 0;
    for (const u of q("SELECT id FROM orpheus_unlinked ORDER BY at LIMIT 200").all() as any[]) if (await remoteUnlink(u.id)) { q("DELETE FROM orpheus_unlinked WHERE id=?").run(u.id); retried++; }
    let r: { status: number; json: any };
    try { r = await call("GET", "/api/tie/caldera/feed", undefined, 30_000); } catch (e: any) { log("feed failed", e?.name || "error", e?.message || ""); return { ok: false, error: "fetch" }; }
    if (r.status !== 200) { log("feed failed", "status " + r.status); return { ok: false, error: "status " + r.status }; }
    const f = parseFeed(r.json); if (!f) { log("feed rejected: bad shape"); return { ok: false, error: "bad feed" }; }
    const now = new Date().toISOString(), seen = new Set(f.fleet.map(x => x.id));
    let added = 0, updated = 0, removed = 0;
    const tx = (fn: () => void) => { q("BEGIN").run(); try { fn(); q("COMMIT").run(); } catch (e) { q("ROLLBACK").run(); throw e; } };
    tx(() => {
      for (const x of f.fleet) {
        const vals = [x.founding_fleet ? 1 : 0, x.linked_at, x.agents_week, x.accounts, x.sessions_week, x.busiest_day, f.week.from, f.week.to, now];
        const have = q("SELECT id FROM orpheus_links WHERE id=?").get(x.id) as any;
        if (have) { q("UPDATE orpheus_links SET founding=?, linked_at=?, agents_week=?, accounts=?, sessions_week=?, busiest_day=?, week_from=?, week_to=?, synced_at=? WHERE id=?").run(...vals, x.id); updated++; continue; }
        // a link Orpheus has that we do not (a claim answered but not stored here): add it when the handle is a live member
        // without a link; never one we unlinked here and could not tell Orpheus yet
        if (gone.has(x.id)) continue;
        const pr = c.byHandle(x.handle.toLowerCase()); if (!pr?.id || c.hidden(pr) || rowOf(pr.id)) continue;
        q("INSERT INTO orpheus_links VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(x.id, pr.id, pr.handle, ...vals); added++;
      }
      for (const row of q("SELECT id FROM orpheus_links").all() as any[]) if (!seen.has(String(row.id).toLowerCase())) { q("DELETE FROM orpheus_links WHERE id=?").run(row.id); removed++; }
      q("INSERT INTO hub_meta VALUES ('orpheus_pull', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(now);
    });
    return { ok: true, added, updated, removed, retried };
  }

  const head = (res: http.ServerResponse, status: number, extra: Record<string, string | string[]> = {}) =>
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", ...extra });
  const cookie = (v: string, age: number) => `${COOKIE}=${v}; Path=/link/orpheus; Max-Age=${age}; HttpOnly; SameSite=Lax${c.secure ? "; Secure" : ""}`;
  const tokenFromCookie = (req: http.IncomingMessage) => { const m = String(req.headers.cookie || "").match(/(?:^|;\s*)cal_orph=([^;]*)/); if (!m) return ""; try { const t = decodeURIComponent(m[1]!); return TOKEN.test(t) ? t : ""; } catch { return ""; } };
  /** a plain text page; data-orpheus-link names the state for the later design and the tests */
  const say = (res: http.ServerResponse, status: number, st: string, title: string, text: string, extra: Record<string, string | string[]> = {}) => { head(res, status, extra); res.end(c.page(title, `<p data-orpheus-link="${esc(st)}">${esc(text)}</p>`)); };
  const STATES = {
    off: [503, "Not available yet", "Linking Orpheus to Caldera is not available yet. Try again soon."],
    missing: [400, "Link not found", "This link has no code. Open it again from Orpheus settings."],
    handle_taken: [409, "Already linked", "Your Caldera handle is already linked to another Orpheus workspace. Unlink it there first."],
    expired: [410, "Link expired", "This link expired or was already used. Open a new one from Orpheus settings."],
    error: [502, "Could not link", "Something went wrong while linking. Open a new link from Orpheus settings and try again."],
  } as const;
  const state = (res: http.ServerResponse, s: keyof typeof STATES, extra: Record<string, string | string[]> = {}) => { const [st, t, x] = STATES[s]; say(res, st, s, t, x, extra); };
  const form = async (req: http.IncomingMessage) => { let s = ""; for await (const ch of req) { s += ch; if (s.length > 4096) break; } return new URLSearchParams(s); };

  /** GET|POST /link/orpheus, POST /settings/orpheus/unlink; false = not ours */
  async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL, p: string): Promise<boolean> {
    if (p === "/link/orpheus" && req.method === "GET") {
      if (!on()) { state(res, "off"); return true; }
      const qt = url.searchParams.get("t"), t = qt !== null ? (TOKEN.test(qt) ? qt : "") : tokenFromCookie(req);
      if (!t) { state(res, "missing"); return true; }
      const keep: Record<string, string> = qt !== null ? { "set-cookie": cookie(encodeURIComponent(t), 1800) } : {};
      const me = c.memberOf(req), pr = me ? c.profile(me) : null;
      if (!pr?.handle) { res.writeHead(303, { location: "/signin?back=%2Flink%2Forpheus", "cache-control": "no-store", "referrer-policy": "no-referrer", ...keep }); res.end(); return true; }
      if (!ORPHEUS_HANDLE.test(pr.handle) || c.hidden(pr)) { state(res, "error"); return true; }
      head(res, 200, keep);
      res.end(c.page("Link Orpheus", `<form method="post" action="/link/orpheus" data-orpheus-link="confirm"><input type="hidden" name="t" value="${esc(t)}"><p>Link this Orpheus workspace to @${esc(pr.handle)}</p><button class="btn" type="submit">Link to @${esc(pr.handle)}</button></form><p><a href="/@${esc(pr.handle)}/">Not now</a></p>`));
      return true;
    }
    if (p === "/link/orpheus" && req.method === "POST") {
      if (!c.sameOrigin(req)) { say(res, 403, "error", "Could not link", "Open the link again from Orpheus settings."); return true; }
      if (!on()) { state(res, "off"); return true; }
      const me = c.memberOf(req), pr = me ? c.profile(me) : null;
      if (!me || !pr?.handle) { res.writeHead(303, { location: "/signin?back=%2Flink%2Forpheus", "cache-control": "no-store" }); res.end(); return true; }
      const f = await form(req), t = String(f.get("t") || "");
      if (!TOKEN.test(t)) { state(res, "missing"); return true; }
      if (!ORPHEUS_HANDLE.test(pr.handle) || c.hidden(pr)) { state(res, "error"); return true; }
      if (c.tooMany("orpheus-claim:" + me, 20)) { state(res, "error"); return true; }
      const clear = { "set-cookie": cookie("", 0) };
      let r: { status: number; json: any };
      try { r = await call("POST", "/api/tie/caldera/claim", { t, handle: pr.handle }); } catch (e: any) { log("claim failed", e?.name || "error", e?.message || ""); state(res, "error"); return true; }
      if (r.status === 409) { state(res, "handle_taken", clear); return true; }
      if (r.status === 410) { state(res, "expired", clear); return true; }
      const id = r.json?.id, founding = r.json?.founding_fleet;
      if (r.status !== 200 || typeof id !== "string" || !UUID.test(id) || typeof founding !== "boolean") { log("claim failed", "status " + r.status); state(res, "error", clear); return true; }
      // one handle per account: a new link for this member replaces the old one here
      const old = rowOf(me); if (old && old.id !== id.toLowerCase()) q("DELETE FROM orpheus_links WHERE id=?").run(old.id);
      q("DELETE FROM orpheus_unlinked WHERE id=?").run(id.toLowerCase());
      q(`INSERT INTO orpheus_links (id, profile, handle, founding, linked_at, agents_week, accounts, sessions_week, busiest_day) VALUES (?,?,?,?,?,0,0,0,NULL)
        ON CONFLICT(id) DO UPDATE SET profile=excluded.profile, handle=excluded.handle, founding=excluded.founding`).run(id.toLowerCase(), me, pr.handle, founding ? 1 : 0, new Date().toISOString());
      if (!c.own(me)) c.count("tie_link", "orpheus");
      res.writeHead(303, { location: `/@${pr.handle}/`, "cache-control": "no-store", ...clear }); res.end(); return true;
    }
    if (p === "/settings/orpheus/unlink" && req.method === "POST") {
      const wantsJson = /json/.test(String(req.headers["content-type"] || "")) || /json/.test(String(req.headers.accept || ""));
      const out = (status: number, body: any) => { if (wantsJson) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); } else if (status === 200) { res.writeHead(303, { location: "/settings", "cache-control": "no-store" }); res.end(); } else say(res, status, "error", "Could not unlink", body.error); };
      if (!c.sameOrigin(req)) { out(403, { error: "wrong origin" }); return true; }
      const me = c.memberOf(req); if (!me) { out(401, { error: "Sign in first." }); return true; }
      for await (const _ of req) { /* drain */ }
      const row = rowOf(me); if (row) await unlinkRow(row.id);
      out(200, { ok: true, unlinked: !!row }); return true;
    }
    return false;
  }

  return {
    on, route, pull,
    /** the member's fleet for the profile card, or null */
    fleetOf(profileId: string): Fleet | null { const r = rowOf(profileId); return r ? fleetFromRow(r) : null; },
    /** every linked member, newest link first */
    fleetList(): (Fleet & { profileId: string })[] { return (q("SELECT * FROM orpheus_links ORDER BY linked_at DESC").all() as any[]).map(r => ({ ...fleetFromRow(r), profileId: r.profile })); },
    /** public: handle + founding flag only (no counts), for members the World lists */
    publicList(listed: (handle: string) => boolean): { handle: string; founding: boolean }[] {
      return this.fleetList().filter(f => listed(f.handle)).map(f => ({ handle: f.handle, founding: f.founding }));
    },
    /** delete account: the row goes now, Orpheus is told best effort */
    erase(profileId: string) { const r = rowOf(profileId); if (r) void unlinkRow(r.id).catch(e => log("erase", e?.message)); },
    /** once a day after 01:00 UTC; a failed pull is tried again at most once an hour */
    schedule() {
      let lastTry = 0;
      const tick = () => {
        if (!on()) return; const d = new Date(); if (d.getUTCHours() < 1) return;
        const last = String((q("SELECT v FROM hub_meta WHERE k='orpheus_pull'").get() as any)?.v || "");
        if (last.slice(0, 10) === d.toISOString().slice(0, 10) || Date.now() - lastTry < 3600_000) return;
        lastTry = Date.now(); void pull().then(r => { if (!r.ok) log("pull", r.error); }).catch(e => log("pull", e?.message));
      };
      const t0 = setTimeout(() => { tick(); const t = setInterval(tick, 15 * 60_000); t.unref?.(); }, 2 * 60_000); t0.unref?.();
    },
  };
}
export type OrpheusTie = ReturnType<typeof orpheusTie>;
