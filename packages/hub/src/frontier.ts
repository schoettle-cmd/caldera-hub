/**
 * The Frontier (Mike 11-17, frontier-design.md D, E, G, H, I): a member adds a friend's GitHub and an unclaimed land appears
 * on the world's edge, built from public GitHub data only. The owner claims it by signing in with that GitHub (the numeric
 * id must match), and the member who added it earns 50 credits. Anyone can remove a land: at once by signing in, or by a
 * request with no sign-in (hidden at once, deleted after a person checks it).
 *
 * Caldera never contacts an unclaimed person: no email, DM, GitHub mention, issue or push. No email is read or stored.
 *
 *   GET  /v1/frontier/lookup?u=<login>   what adding would do (members only; 60 an hour)
 *   POST /v1/frontier/add {login}         add a land (members only; 20 a Pacific day; idempotent)
 *   GET  /v1/frontier/mine                the lands this member added (profile list)
 *   GET  /claim/<login>                   claim page (?go=1 after the GitHub sign-in claims it)
 *   GET  /claim/<login>/remove            remove page; POST act=remove (signed in) | act=hide (no sign-in)
 */
import crypto from "node:crypto";
import type http from "node:http";
import type { CityRepo } from "../../../../caldera/packages/plugin/src/city";
import { CLAIM_CSS, CLAIM_JS, GH_ICON, FLAG_ICON, WADD_CSS, ADD_CSS, ADD_JS } from "./frontierpage";

type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export const FRONTIER = { addsPerDay: 20, lookupsPerHour: 60, reward: 50, perLand: 8, hidesPerHour: 5 };
/** a GitHub username: 1 to 39 of [A-Za-z0-9-], no hyphen at either end, no "--" */
export const GH_LOGIN = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export type LandState = "live" | "hidden" | "claimed" | "removed";
export interface Land { lc: string; login: string; gh_id: number; name: string; repos: number; adder: string; ts: number; state: LandState; slot: number; claimed_by: string | null; claimed_ts: number | null; city: CityRepo[] }
const landOf = (r: any): Land => ({ lc: r.lc, login: r.login, gh_id: Number(r.gh_id), name: r.name || r.login, repos: r.repos || 0, adder: r.adder, ts: r.ts, state: r.state, slot: r.slot, claimed_by: r.claimed_by || null, claimed_ts: r.claimed_ts || null, city: (() => { try { return JSON.parse(r.city || "[]"); } catch { return []; } })() });
export const SYSTEM_ADDER = "caldera";
const sha = (s: string) => crypto.createHash("sha256").update("caldera-frontier:" + s).digest("hex");

/** midnight Pacific at or before `at` (the daily add limit resets then) */
export function pacificDayStart(at: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const g = (t: string) => Number(p.find(x => x.type === t)!.value);
  return at - ((g("hour") * 60 + g("minute")) * 60 + g("second")) * 1000 - (at % 1000);
}

// ---------------------------------------------------------------- the store
export function frontierStore(q: Q) {
  q(`CREATE TABLE IF NOT EXISTS frontier_lands (lc TEXT PRIMARY KEY, login TEXT, gh_id INTEGER, name TEXT, repos INTEGER, adder TEXT, ts INTEGER,
      state TEXT, slot INTEGER, claimed_by TEXT, claimed_ts INTEGER, city TEXT)`).run();
  q("CREATE INDEX IF NOT EXISTS frontier_lands_adder ON frontier_lands(adder, ts)").run();
  // the do-not-add list: hashes of the GitHub numeric id and of the lowercase login, nothing else. A pending request (no
  // sign-in) keeps the optional note until a person checks it; then the note is dropped.
  q("CREATE TABLE IF NOT EXISTS frontier_block (h TEXT PRIMARY KEY, state TEXT, ts INTEGER, note TEXT, lc TEXT)").run();
  q("CREATE TABLE IF NOT EXISTS frontier_skip (lc TEXT PRIMARY KEY)").run();   // seed names that can't be lands (an org, gone, a blocked word)
  q(`CREATE TABLE IF NOT EXISTS ledger (who TEXT, delta INTEGER, reason TEXT, ref TEXT, ts TEXT)`).run();
  const S = {
    get: (login: string): Land | null => { const r = q("SELECT * FROM frontier_lands WHERE lc=?").get(login.toLowerCase()); return r ? landOf(r) : null; },
    live: (): Land[] => (q("SELECT * FROM frontier_lands WHERE state='live' ORDER BY slot").all() as any[]).map(landOf),
    claimed: (): Land[] => (q("SELECT * FROM frontier_lands WHERE state='claimed' ORDER BY slot").all() as any[]).map(landOf),
    byAdder: (p: string): Land[] => (q("SELECT * FROM frontier_lands WHERE adder=? AND state IN ('live','claimed') ORDER BY ts DESC").all(p) as any[]).map(landOf),
    addsSince: (p: string, since: number): number => (q("SELECT COUNT(*) n FROM frontier_lands WHERE adder=? AND ts>=?").get(p, since) as any).n,
    blocked: (login: string, ghId?: number | null): boolean => !!q("SELECT 1 FROM frontier_block WHERE h=? OR h=?").get(sha("lg:" + login.toLowerCase()), ghId ? sha("id:" + ghId) : "-"),
    add: (l: { login: string; gh_id: number; name: string; repos: number; adder: string; city: CityRepo[] }, at: number): Land => {
      const lc = l.login.toLowerCase(), old = S.get(lc);
      if (old && old.state === "live") return old;
      // a slot is the land's place in line on the frontier (the map puts lower slots first); a removed land's row is reused
      const slot = old ? old.slot : (Number((q("SELECT MAX(slot) m FROM frontier_lands").get() as any).m) || 0) + 1;
      q("INSERT OR REPLACE INTO frontier_lands VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(lc, l.login, l.gh_id, l.name.slice(0, 80), l.repos, l.adder, at, "live", slot, null, null, JSON.stringify(l.city));
      return S.get(lc)!;
    },
    setCity: (login: string, city: CityRepo[], repos: number) => q("UPDATE frontier_lands SET city=?, repos=? WHERE lc=?").run(JSON.stringify(city), repos, login.toLowerCase()),
    /** a GitHub-verified claim: true the first time (the caller pays the adder) */
    claim: (login: string, p: string, at: number): boolean => q("UPDATE frontier_lands SET state='claimed', claimed_by=?, claimed_ts=? WHERE lc=? AND state IN ('live','hidden')").run(p, at, login.toLowerCase()).changes > 0,
    /** removed by the owner (signed in): the land data goes, the block stays */
    remove: (l: Land, at: number) => { q("UPDATE frontier_lands SET state='removed', city='[]', name=login, repos=0 WHERE lc=?").run(l.lc); S.block(l.lc, l.gh_id, "done", at, null); },
    /** a request with no sign-in: hidden now, deleted when a person confirms it */
    hide: (l: Land, at: number, note: string | null) => { q("UPDATE frontier_lands SET state='hidden' WHERE lc=? AND state='live'").run(l.lc); S.block(l.lc, l.gh_id, "pending", at, note); },
    block: (lc: string, ghId: number | null, state: "pending" | "done", at: number, note: string | null) => {
      q("INSERT OR REPLACE INTO frontier_block VALUES (?,?,?,?,?)").run(sha("lg:" + lc), state, at, note, state === "pending" ? lc : null);
      if (ghId) q("INSERT OR REPLACE INTO frontier_block VALUES (?,?,?,?,?)").run(sha("id:" + ghId), state, at, null, null);
    },
    /** a GitHub sign-in as that account lifts the block (coming back needs proof) */
    unblock: (lc: string, ghId: number) => q("DELETE FROM frontier_block WHERE h=? OR h=?").run(sha("lg:" + lc), sha("id:" + ghId)),
    /** operator: requests waiting for a person, oldest first */
    pending: () => (q("SELECT lc, ts, note FROM frontier_block WHERE state='pending' AND lc IS NOT NULL ORDER BY ts").all() as any[]),
    /** operator: confirm a request: delete the land data, keep only the hashes, drop the note */
    confirm: (login: string, at: number): boolean => {
      const l = S.get(login); if (!l) return false;
      q("UPDATE frontier_lands SET state='removed', city='[]', name=login, repos=0 WHERE lc=?").run(l.lc);
      q("UPDATE frontier_block SET state='done', note=NULL, lc=NULL WHERE h=? OR h=?").run(sha("lg:" + l.lc), sha("id:" + l.gh_id)); return true;
    },
    /** operator: a request that was not genuine: the land comes back */
    restore: (login: string): boolean => { const l = S.get(login); if (!l || l.state !== "hidden") return false; q("UPDATE frontier_lands SET state='live' WHERE lc=?").run(l.lc); S.unblock(l.lc, l.gh_id); return true; },
    skip: (lc: string) => q("INSERT OR IGNORE INTO frontier_skip VALUES (?)").run(lc.toLowerCase()),
    skipped: (lc: string): boolean => !!q("SELECT 1 FROM frontier_skip WHERE lc=?").get(lc.toLowerCase()),
    paid: (lc: string): boolean => !!q("SELECT 1 FROM ledger WHERE reason LIKE 'frontier:%' AND ref=?").get("land:" + lc),
    pay: (p: string, login: string, at: number) => q("INSERT INTO ledger VALUES (?,?,?,?,?)").run(p, FRONTIER.reward, `frontier: brought @${login}`, "land:" + login.toLowerCase(), new Date(at).toISOString()),
    /** a member deleting their account: their adds stay on the map as the system's, nothing names them */
    erase: (p: string) => q("UPDATE frontier_lands SET adder=? WHERE adder=?").run(SYSTEM_ADDER, p),
  };
  return S;
}
export type FrontierStore = ReturnType<typeof frontierStore>;

/** the land's buildings: its busiest public repos, capped (the frontier draws many lands) */
export function landRepos(repos: CityRepo[], login: string): CityRepo[] {
  return [...(repos || [])].filter(r => r && r.public !== false && !r.kind && !(r as any).locked)
    .sort((a, b) => (b.week || 0) * 20 + (b.commits || 0) - ((a.week || 0) * 20 + (a.commits || 0)) || String(a.name).localeCompare(String(b.name)))
    .slice(0, FRONTIER.perLand).map(r => ({ name: String(r.name).slice(0, 60), project: "@" + login + "/GitHub", public: true, language: r.language || "Other", commits: r.commits || 0, weeks: [], week: 0, today: 0,
      pushed: r.pushed, created: r.created, size: r.size, url: r.url, description: String(r.description || "").slice(0, 160) }) as CityRepo);
}

// ---------------------------------------------------------------- the routes and pages
export interface GhUser { status: number; id?: number; login?: string; type?: string; name?: string; repos?: number }
export interface FrontierCtx {
  q: Q; hub: () => string; now?: () => number;
  memberOf: (req: http.IncomingMessage) => string | null;
  handleOf: (profileId: string) => string | null;
  /** a member whose handle or linked GitHub login is this name */
  memberByName: (login: string) => { id: string; handle: string } | null;
  /** the GitHub account signed in on this browser (gh_accounts), if any */
  ghAccount: (req: http.IncomingMessage) => { gh_id: number; login: string; profile_id: string | null; handle: string | null } | null;
  ghUser: (login: string) => Promise<GhUser>;
  /** the public preview city (ghpreview.ts), cached a day */
  ghRepos: (login: string) => Promise<CityRepo[] | null>;
  sameOrigin: (req: http.IncomingMessage) => boolean; readBody: (req: http.IncomingMessage) => Promise<any>;
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  tooMany: (key: string, max: number, windowMs?: number) => boolean; ipOf: (req: http.IncomingMessage) => string;
  alertPost?: (o: { target: string; key: string; title: string; body: string; ctaLabel?: string; ctaUrl?: string; by?: string }) => void;
  /** a land left the map: bombs aimed at it get their credits back */ landGone?: (login: string) => void;
  /** a claim must not put the new member in the battles */ leaveBattles?: (profileId: string) => void;
  /** the world map changed (rebuild its cache) */ changed?: () => void;
  /** the member's accent colour for the lit-up moment */ accentOf?: (profileId: string) => string | null;
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** a small urlencoded (or JSON) form body, at most 4 KB */
async function formBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = []; let n = 0;
  try { for await (const ch of req) { n += (ch as Buffer).length; if (n > 4096) return {}; chunks.push(ch as Buffer); } } catch { return {}; }
  const t = Buffer.concat(chunks).toString("utf8");
  if (/json/.test(String(req.headers["content-type"] || ""))) { try { const j = JSON.parse(t); return j && typeof j === "object" ? j : {}; } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(t));
}
const dateOf = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

export function frontier(c: FrontierCtx) {
  const S = frontierStore(c.q), now = () => (c.now ? c.now() : Date.now());
  const adderName = (l: Land) => l.adder === SYSTEM_ADDER ? null : c.handleOf(l.adder);

  /** what adding this name would do: one of member | land | removed | blocked | org | missing | github | new (D3, E1) */
  async function look(raw: string): Promise<any> {
    const login = String(raw || "").trim().replace(/^@/, "");
    if (!GH_LOGIN.test(login)) return { st: "missing", login };
    const m = c.memberByName(login); if (m) return { st: "member", login, handle: m.handle };
    const l = S.get(login);
    if (l && l.state === "live") { const by = adderName(l); return { st: "land", login: l.login, by: by ? "@" + by : null, repos: l.repos, name: l.name }; }
    if (l && l.state === "claimed") { const h = l.claimed_by ? c.handleOf(l.claimed_by) : null; if (h) return { st: "member", login, handle: h }; }
    if (S.blocked(login)) return { st: "removed", login };
    const u = await c.ghUser(login).catch(() => ({ status: 502 } as GhUser));
    if (u.status === 404) return { st: "missing", login };
    if (u.status !== 200 || !u.id || !u.login) return { st: "github", login };
    if (u.type === "Organization") return { st: "org", login: u.login };
    if (u.type !== "User") return { st: "missing", login };
    if (S.blocked(u.login, u.id)) return { st: "removed", login: u.login };
    return { st: "new", login: u.login, id: u.id, name: u.name || u.login, repos: u.repos || 0 };
  }
  const left = (p: string) => Math.max(0, FRONTIER.addsPerDay - S.addsSince(p, pacificDayStart(now())));

  /** add a land (idempotent). `p` is the adder (a member id, or SYSTEM_ADDER for the seed list). */
  async function add(p: string, raw: string): Promise<{ status: number; body: any }> {
    const r = await look(raw);
    if (r.st === "land") return { status: 200, body: { ...r, ok: true, claim: c.hub() + "/claim/" + r.login, left: p === SYSTEM_ADDER ? null : left(p), land: landData(r.login) } };
    if (r.st !== "new") return { status: r.st === "github" ? 502 : r.st === "member" ? 409 : 422, body: r };
    if (p !== SYSTEM_ADDER && left(p) <= 0) return { status: 429, body: { st: "limit", login: r.login } };
    const repos = await c.ghRepos(r.login).catch(() => null);
    if (!repos) return { status: 502, body: { st: "github", login: r.login } };
    const l = S.add({ login: r.login, gh_id: r.id, name: r.name, repos: repos.length, adder: p, city: landRepos(repos, r.login) }, now());
    c.changed?.();
    console.log(`[frontier] ${p === SYSTEM_ADDER ? "seed" : "@" + (c.handleOf(p) || "?")} added @${l.login} (${l.repos} repos, slot ${l.slot})`);
    return { status: 200, body: { st: "added", ok: true, login: l.login, name: l.name, repos: l.repos, claim: c.hub() + "/claim/" + l.login, left: p === SYSTEM_ADDER ? null : left(p), land: landData(l.login) } };
  }

  /** the world map's frontier: live lands, as districts the renderer fogs (uc: 1), with who added them */
  function districts(): { name: string; label: string; nb: string; notes: number; repos: CityRepo[]; uc: 1; by: string | null; slot: number }[] {
    return S.live().map(districtOf);
  }
  function districtOf(l: Land) { const by = adderName(l);
    return { name: "@" + l.login + "/GitHub", label: "GitHub", nb: "@" + l.login, notes: 0, repos: l.city.map(r => ({ ...r, project: "@" + l.login + "/GitHub" })), uc: 1 as const, by: by ? "@" + by : null, slot: l.slot }; }
  function metaOf(l: Land) { const by = adderName(l); return { by: by ? "@" + by : null, at: l.ts, n: l.repos, name: l.name }; }
  /** gap 1 (MB 11-17): a claimed land keeps its ring cell. "@handle" -> its old slot and adder; the map lays that member out
   *  in the ring like a land, lit. */
  /** gap 2: lands added in the last 15 minutes, for the world map's live poll (other members' adds appear on open maps) */
  function recentLands(ms = 15 * 60_000) { const t = now() - ms; return S.live().filter(l => l.ts >= t).slice(-20).map(l => ({ district: districtOf(l), meta: metaOf(l) })); }
  function claimedSlots(): Record<string, { slot: number; by: string | null }> {
    const o: Record<string, { slot: number; by: string | null }> = {};
    for (const l of S.claimed()) { const h = l.claimed_by ? c.handleOf(l.claimed_by) : null; if (!h) continue; const by = adderName(l); o["@" + h] = { slot: l.slot, by: by ? "@" + by : null }; }
    return o;
  }
  /** gap 2: the add reply carries the land, so the open world map can draw it at once */
  function landData(login: string) { const l = S.get(login); return l && l.state === "live" ? { district: districtOf(l), meta: metaOf(l) } : null; }
  /** for the map card: who added it and when */
  function meta(): Record<string, { by: string | null; at: number; n: number; name: string }> {
    const o: Record<string, any> = {}; for (const l of S.live()) o["@" + l.login] = metaOf(l); return o;
  }

  // ---------------------------------------------------------------- claim
  function claimNow(l: Land, acct: { gh_id: number; profile_id: string | null; handle: string | null }): boolean {
    if (!acct.profile_id) return false;
    S.unblock(l.lc, l.gh_id);
    const first = S.claim(l.lc, acct.profile_id, now());
    if (!first) return false;
    try { c.leaveBattles?.(acct.profile_id); } catch (e: any) { console.error("[frontier] leave battles", e?.message); }
    c.landGone?.(l.login); c.changed?.();
    // the adder: +50 once per land, only on a real GitHub-verified claim, only if they are still a member
    const by = l.adder !== SYSTEM_ADDER ? c.handleOf(l.adder) : null;
    if (by && l.adder !== acct.profile_id && !S.paid(l.lc)) {
      S.pay(l.adder, l.login, now());
      c.alertPost?.({ target: l.adder, key: "frontier:" + l.lc, title: `@${l.login} claimed their land`, body: `You brought @${l.login} to Caldera. Their city is lit. **+${FRONTIER.reward} credits** are in your Armory balance.`,
        ctaLabel: "See their city", ctaUrl: `/@${acct.handle || l.login}/city.html`, by: "frontier" });
    }
    console.log(`[frontier] @${l.login} claimed their land${by ? ` (added by @${by}, +${FRONTIER.reward})` : ""}`);
    return true;
  }

  const shell = (title: string, inner: string, o: { art?: any; nar?: boolean } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500;600&display=swap">
<style>${CLAIM_CSS}</style></head><body class="cl${o.nar ? " one" : ""}"><div class="cl-top"><a href="/world" aria-label="Caldera world map"><i aria-hidden="true"></i>Caldera</a></div>${inner}
${o.art ? `<script>window.CL=${JSON.stringify(o.art).replace(/</g, "\\u003c")}</script><script>${CLAIM_JS}</script>` : ""}<div class="sr" aria-live="polite" id="cl-live"></div></body></html>`;
  const eyebrow = (t: string, cls = "") => `<span class="cl-eyebrow${cls ? " " + cls : ""}">${cls ? "" : FLAG_ICON}${esc(t)}</span>`;
  const signIn = (back: string) => `/auth/github?back=${encodeURIComponent(back)}`;
  const send = (res: http.ServerResponse, status: number, html: string) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" }); res.end(html); };
  const twoCol = (txt: string, art: boolean, cap: string) => `<main class="cl-main"><div class="cl-txt">${txt}</div>${art ? `<div class="cl-art"><canvas id="cl-cv" aria-label="The city, drawn from public GitHub repos"></canvas><span class="cl-cap" id="cl-cap">${esc(cap)}</span></div>` : ""}</main>`;
  const one = (txt: string) => `<main class="cl-one">${txt}</main>`;
  const seedOf = (lc: string) => parseInt(sha("seed:" + lc).slice(0, 6), 16) % 100000 + 11;

  function claimPage(res: http.ServerResponse, req: http.IncomingMessage, url: URL, login: string) {
    const l = S.get(login), acct = c.ghAccount(req), go = url.searchParams.get("go") === "1", u = l ? l.login : login, at = "@" + esc(u);
    if (!l || l.state === "removed" || l.state === "hidden") {
      const gone = !!l || S.blocked(login);
      // the owner coming back after a removal (claim at any time): a matching sign-in makes them a member and lifts the block
      if (l && acct && acct.gh_id === l.gh_id && go && acct.profile_id) { S.unblock(l.lc, l.gh_id); res.writeHead(302, { location: `/@${acct.handle}/city.html` }); res.end(); return; }
      return send(res, 404, shell("No land here", one(`<h1>No land here.</h1><p class="cl-lede">${gone ? `${at} is not on Caldera.` : `Nobody added ${at} to the map.`}</p>
<div class="cl-row">${gone ? `<a class="cl-go" href="/world">Go to the world map</a>` : `<a class="cl-go" href="/gh/${encodeURIComponent(u)}">See this GitHub as a city</a>`}</div>
${l ? `<p class="cl-fine">Is this your GitHub? <a href="${signIn(`/claim/${u}?go=1`)}">Claim it with GitHub</a>.</p>` : ""}`), { nar: true }));
    }
    if (l.state === "claimed") {
      const h = l.claimed_by ? c.handleOf(l.claimed_by) : null;
      if (acct && acct.profile_id && acct.profile_id === l.claimed_by && !go) { res.writeHead(302, { location: `/@${h}/city.html` }); res.end(); return; }
      if (acct && acct.profile_id && acct.profile_id === l.claimed_by && go) return donePage(res, l, h || u, acct.profile_id);
      return send(res, 200, shell("This land is claimed", one(`${eyebrow("Claimed", "lit")}<h1>This land is claimed.</h1><p class="cl-lede">${at} lives here now.</p><div class="cl-row"><a class="cl-go" href="/@${esc(h || u)}/city.html">See the city</a></div>`), { nar: true }));
    }
    const by = adderName(l), art = { seed: seedOf(l.lc), state: "before", col: "#8B6CF6" };
    if (acct && go) {
      if (acct.gh_id === l.gh_id && acct.profile_id) {
        claimNow(l, acct);
        return donePage(res, l, acct.handle || u, acct.profile_id);
      }
      if (acct.gh_id !== l.gh_id) return send(res, 200, shell("This land belongs to @" + u, twoCol(`${eyebrow("Unclaimed land")}<h1>This land belongs to ${at}.</h1>
<p class="cl-msg" role="alert"><b>You signed in as @${esc(acct.login)}.</b> Only ${at} can claim this land. Nothing changed.</p>
<div class="cl-row"><a class="cl-go" href="${signIn(`/claim/${u}?go=1`)}">${GH_ICON}Sign in as ${at}</a>${acct.handle ? `<a class="cl-go sec" href="/@${esc(acct.handle)}/city.html">See the city of @${esc(acct.login)}</a>` : ""}</div>
<p class="cl-fine">On GitHub, switch accounts first. Then tap the button again.</p>`, true, "Unclaimed · fogged, lights off"), { art }));
    }
    const msg = url.searchParams.get("cancel") ? `<p class="cl-msg" role="alert">Sign-in was cancelled. Nothing changed.</p>` : url.searchParams.get("err") ? `<p class="cl-msg" role="alert">Could not claim the land right now. Nothing changed. Try again.</p>` : "";
    send(res, 200, shell(`@${u}, this city is yours to claim`, twoCol(`${eyebrow("Unclaimed land")}<h1>${at}, this city is yours to claim.</h1>
<p class="cl-lede">A Caldera member added your GitHub to the world map. The city is built from your public repos. Claim it and the lights come on.</p>${msg}
<a class="cl-go" href="${signIn(`/claim/${u}?go=1`)}">${GH_ICON}Claim with GitHub</a>
<p class="cl-fine">GitHub confirms your username. Caldera does not ask for your email or your private repos. Claiming is free.</p>
<dl class="cl-facts"><dt>Shown now</dt><dd>${l.repos} public repo${l.repos === 1 ? "" : "s"} as buildings: name, size and language</dd><dt>Never shown</dt><dd>Email, private repos, anything not public on GitHub</dd>
<dt>Added by</dt><dd>${by ? `<a href="/@${esc(by)}/">@${esc(by)}</a>` : "Caldera"} on ${dateOf(l.ts)}</dd><dt>Battles</dt><dd>Members can aim at this land. Damage is for show and heals by the next day.</dd></dl>
<p class="cl-alt">Do not want this? <a href="/claim/${esc(u)}/remove">Remove my land</a></p>`, true, "Unclaimed · fogged, lights off"), { art }));
  }
  function donePage(res: http.ServerResponse, l: Land, handle: string, p: string) {
    const by = adderName(l), col = (c.accentOf?.(p) || "#8B6CF6").replace(/[^#0-9A-Fa-f]/g, "").slice(0, 7) || "#8B6CF6";
    send(res, 200, shell("Your city is lit", twoCol(`${eyebrow("Claimed", "lit")}<h1 tabindex="-1" id="cl-h">Your city is lit, @${esc(l.login)}.</h1>
<p class="cl-lede">It is on the world map now, in your colour. The damage from old battles is gone.</p>
<div class="cl-row"><a class="cl-go" href="/@${esc(handle)}/city.html">See my city</a><button type="button" class="cl-go sec" id="cl-again">Play it again</button></div>
<div class="cl-reward"><span><b>100 credits</b> are in your Armory to start.</span>${by && by !== handle ? `<span><b>@${esc(by)}</b> brought you to Caldera and earned ${FRONTIER.reward} credits.</span>` : ""}<span>Battles are your choice. You can join or leave them on the world map.</span></div>`, true, "Claimed · lit, flag in your colour"),
      { art: { seed: seedOf(l.lc), state: "done", col } }));
  }

  // ---------------------------------------------------------------- remove
  async function removePage(res: http.ServerResponse, req: http.IncomingMessage, url: URL, login: string) {
    const l = S.get(login), acct = c.ghAccount(req), u = l ? l.login : login, at = "@" + esc(u);
    if (req.method === "POST") {
      if (!c.sameOrigin(req)) return send(res, 403, shell("Not allowed", one(`<h1>Open this page again and retry.</h1>`), { nar: true }));
      const f = await formBody(req), act = String(f.act || "");
      if (act === "remove") {
        if (!l || !acct || acct.gh_id !== l.gh_id) return send(res, 403, shell("Nothing changed", one(`<h1>Nothing changed.</h1><p class="cl-lede">Sign in with GitHub as ${at} to remove this land.</p>`), { nar: true }));
        S.remove(l, now()); c.landGone?.(l.login); c.changed?.(); console.log(`[frontier] @${l.login} removed their land (signed in)`);
        return send(res, 200, shell("Your land is removed", one(`<span class="cl-eyebrow ok">Removed</span><h1 tabindex="-1">Your land is removed.</h1>
<p class="cl-lede">${at} is off the world map. Nobody can add this GitHub again. Caldera kept no account and no data about you, except a locked note that this username is not to be added.</p>
<p class="cl-fine">Changed your mind? Claim with GitHub at caldera.social/claim/${esc(u)} at any time.</p>`), { nar: true }));
      }
      if (act === "hide") {
        const name = String(f.u || "").trim().replace(/^@/, ""), note = String(f.note || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) || null, t = S.get(name);
        if (c.tooMany("frontier-hide:" + c.ipOf(req), FRONTIER.hidesPerHour, 3600_000)) return send(res, 429, shell("Too many requests", one(chooser(u, l, `<p class="cl-msg" role="alert">Too many requests from here. Try again in an hour.</p>`)), { nar: true }));
        if (!t || t.state !== "live") return send(res, 404, shell("No land", one(chooser(u, l, `<p class="cl-msg" role="alert">No land for that username. Check the spelling.</p>`)), { nar: true }));
        S.hide(t, now(), note); c.landGone?.(t.login); c.changed?.(); console.log(`[frontier] @${t.login} hidden by a removal request (pending a check)`);
        return send(res, 200, shell("The land is hidden", one(`${eyebrow("Hidden", "plain")}<h1 tabindex="-1">The land is hidden. Your request is sent.</h1>
<p class="cl-lede">Nobody can see or target the land of @${esc(t.login)} now. A person checks the request within 2 days and deletes the land.</p>
<p class="cl-fine">Caldera does not write to you. To see the result, open caldera.social/claim/${esc(t.login)}.</p>`), { nar: true }));
      }
      return send(res, 400, shell("Nothing changed", one(`<h1>Nothing changed.</h1>`), { nar: true }));
    }
    if (!l || l.state !== "live") return send(res, 404, shell("No land here", one(`<h1>No land here.</h1><p class="cl-lede">${at} is not on the map.</p><div class="cl-row"><a class="cl-go" href="/world">Go to the world map</a></div>`), { nar: true }));
    if (acct && url.searchParams.get("go") === "1") {
      if (acct.gh_id === l.gh_id) return send(res, 200, shell("Remove your land now?", one(`<span class="cl-eyebrow plain">Signed in as @${esc(acct.login)}</span><h1>Remove your land now?</h1>
<p class="cl-lede">The land and its ${l.repos} building${l.repos === 1 ? "" : "s"} are deleted from the map. Nobody can add ${at} again. You can undo this later only by claiming with GitHub.</p>
<form method="post" class="cl-row"><input type="hidden" name="act" value="remove"><button type="submit" class="cl-go danger">Remove my land</button><a class="cl-go sec" href="/claim/${esc(u)}">Keep it</a></form>
<p class="cl-fine">Or <a href="${signIn(`/claim/${u}?go=1`)}">claim it</a> and it becomes your city.</p>`), { nar: true }));
      return send(res, 200, shell("Remove @" + u, one(chooser(u, l, `<p class="cl-msg" role="alert">You signed in as @${esc(acct.login)}. Only ${at} can remove this land this way. Nothing changed. You can still send a request below.</p>`)), { nar: true }));
    }
    send(res, 200, shell("Remove @" + u + " from Caldera", one(chooser(u, l, "")), { nar: true }));
  }
  const chooser = (u: string, l: Land | null, msg: string) => `${eyebrow("Unclaimed land")}<h1>Remove @${esc(u)} from Caldera</h1>
<p class="cl-lede">The land was built from public GitHub data after a member added your username. You can take it off the map. Nobody can add it again.</p>${msg}
<a class="cl-go" href="${signIn(`/claim/${u}/remove?go=1`)}">${GH_ICON}Sign in with GitHub and remove it now</a>
<p class="cl-fine">GitHub confirms your username. Caldera deletes the land at once and keeps no account for you.</p>
<p class="cl-or">or without signing in</p>
<form class="cl-form" method="post"><input type="hidden" name="act" value="hide"><label for="rm-u">GitHub username<input id="rm-u" name="u" type="text" value="${esc(l ? l.login : u)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="39" required></label>
<label for="rm-n">Note <small>(optional)</small><input id="rm-n" name="note" type="text" maxlength="200" placeholder="Anything we should know"></label>
<button type="submit" class="cl-go sec">Hide this land and send the request</button></form>
<p class="cl-fine">The land is hidden at once. A person checks the request within 2 days and deletes the land. Caldera does not ask for your email and does not write to you.</p>`;

  // ---------------------------------------------------------------- routing
  async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname;
    if (p === "/v1/frontier/lookup" && req.method === "GET") {
      const me = c.memberOf(req); if (!me) { c.json(res, 401, { st: "signin" }); return true; }
      if (c.tooMany("frontier-look:" + me, FRONTIER.lookupsPerHour, 3600_000)) { c.json(res, 429, { st: "busy" }); return true; }
      const r = await look(url.searchParams.get("u") || "");
      c.json(res, r.st === "github" ? 502 : 200, { ...r, left: left(me) }); return true;
    }
    if (p === "/v1/frontier/add" && req.method === "POST") {
      if (!c.sameOrigin(req)) { c.json(res, 403, { error: "cross-site" }); return true; }
      const me = c.memberOf(req); if (!me) { c.json(res, 401, { st: "signin" }); return true; }
      const b = await c.readBody(req).catch(() => ({}));
      const r = await add(me, String(b?.login || "")); c.json(res, r.status, r.body); return true;
    }
    if (p === "/add" && req.method === "GET") { send(res, 200, addPage(c.memberOf(req))); return true; }
    if (p === "/v1/frontier/mine" && req.method === "GET") {
      const me = c.memberOf(req); if (!me) { c.json(res, 401, { st: "signin" }); return true; }
      c.json(res, 200, { left: left(me), lands: S.byAdder(me).slice(0, 50).map(l => ({ login: l.login, state: l.state, at: l.ts, claimed: l.claimed_ts, paid: l.state === "claimed" && S.paid(l.lc) ? FRONTIER.reward : 0 })) }); return true;
    }
    const m = /^\/claim\/([A-Za-z0-9-]{1,39})(\/remove)?\/?$/.exec(p);
    if (m && GH_LOGIN.test(m[1]!)) {
      if (m[2]) await removePage(res, req, url, m[1]!); else if (req.method === "GET") claimPage(res, req, url, m[1]!); else return false;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the seed list (about 200 well-known GitHubs, added by Caldera)
  let seeding = false;
  /** add the next few seeds that are not on the map yet; one GitHub look at a time, so the API budget is never in danger */
  async function seedSome(list: string[], n = 3): Promise<number> {
    if (seeding) return 0; seeding = true; let added = 0;
    try {
      for (const login of list) {
        if (added >= n) break;
        if (S.get(login) || S.skipped(login) || S.blocked(login) || c.memberByName(login)) continue;
        const r = await add(SYSTEM_ADDER, login);
        if (r.status === 502) break;   // GitHub is busy: try later
        if (r.status === 200) added++;
        else S.skip(login);   // an org, gone or a blocked name: never try it again
      }
    } finally { seeding = false; }
    return added;
  }

  /** /add (frontier-design J): the whole add flow on a top-level page, opened from the sandboxed profile in a new tab */
  function addPage(me: string | null): string {
    const head = eyebrow("The frontier") + `<h1>Put a friend on the map</h1><p class="cl-lede">Their city appears on the frontier, unclaimed. You earn ${FRONTIER.reward} credits when they claim it. Caldera does not contact them.</p>`;
    if (!me) return shell("Add a GitHub · Caldera", one(head + `<div class="cl-row"><a class="cl-go" href="${signIn("/add")}">${GH_ICON}Sign in with GitHub</a></div><p class="cl-fine">The land shows who added it.</p>`));
    const all = S.byAdder(me), n = left(me), day = (t: number | null) => t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }) : "";
    const rows = all.slice(0, 10).map(l => `<li><a class="ad-row" href="/world?focus=${encodeURIComponent(l.login)}"><b>@${esc(l.login)}</b>${l.state === "claimed"
      ? `<span class="ad-st ok">claimed${S.paid(l.lc) ? `, +${FRONTIER.reward} credits` : ""}</span><time>${esc(day(l.claimed_ts || l.ts))}</time>`
      : `<span class="ad-st">unclaimed</span><time>added ${esc(day(l.ts))}</time>`}</a></li>`).join("");
    const list = `<section class="ad-list" aria-labelledby="ad-h"${rows ? "" : " hidden"}><h2 class="ad-h" id="ad-h">GitHubs you added</h2><ul>${rows}</ul>${all.length > 10 ? `<p class="ad-more">And ${all.length - 10} more.</p>` : ""}</section>`;
    const off = n <= 0 ? " disabled" : "";
    const form = `<div class="ad"><form class="w-add ad-form" id="w-add" novalidate><div class="w-add-f"><div class="w-add-in"><span aria-hidden="true">@</span><label class="sr" for="w-add-u">GitHub username to add to the map</label><input id="w-add-u" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="39" placeholder="GitHub username" aria-describedby="w-add-h"${off}></div><button type="submit" class="w-add-b"${off}>Find</button></div>`
      + `<div class="ad-meta"><p class="w-add-h" id="w-add-h" hidden></p><p class="ad-left">${n} of ${FRONTIER.addsPerDay} left today</p></div>`
      + (n <= 0 ? `<p class="w-add-r" data-st="limit" role="alert"><span><b>You added 20 GitHubs today.</b> That is the daily limit. You can add more after midnight Pacific.</span></p>` : "") + `</form></div>`;
    const main = rows ? `<main class="cl-main ad-main"><div>${head}${form}</div>${list}</main>` : `<main class="cl-one">${head}${form}${list}</main>`;
    return shell("Add a GitHub · Caldera", main).replace("</head>", () => `<style>${WADD_CSS}${ADD_CSS}</style></head>`).replace("</body>", () => `<script>${ADD_JS}</script></body>`);
  }
  /** the owner's own profile (frontier-design E2): "Put a friend on the map" under the city, with the GitHubs they added.
   *  Profiles are sandboxed (no forms, no cookies), so the button opens the World map's add box. */
  function profileSection(html: string, owner: string): string {
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" } as any)[ch]);
    const all = S.byAdder(owner), day = (t: number | null) => t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }) : "";
    const rows = all.slice(0, 10).map(l => l.state === "claimed"
      ? `<li><a href="${esc(c.hub())}/world?focus=${encodeURIComponent(l.login)}">@${esc(l.login)}</a> &middot; <span class="pf-ok">claimed${S.paid(l.lc) ? `, +${FRONTIER.reward} credits` : ""}</span> &middot; ${esc(day(l.claimed_ts || l.ts))}</li>`
      : `<li><a href="${esc(c.hub())}/world?focus=${encodeURIComponent(l.login)}">@${esc(l.login)}</a> &middot; unclaimed &middot; added ${esc(day(l.ts))}</li>`).join("");
    const sec = `<section class="pf-add" aria-labelledby="pf-add-h"><style>.pf-add{margin:22px 0 26px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--bg-raised)}.pf-add h2{margin:0 0 4px;font-size:1.05rem;color:var(--text-strong)}.pf-add p{margin:0 0 10px;color:var(--text-muted);font-size:14px}.pf-add-b{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:999px;background:var(--accent-btn,var(--accent));color:var(--on-accent,#fff)!important;font-weight:600;font-size:14px;text-decoration:none!important}.pf-add-b:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.pf-add h3{margin:14px 0 6px;font-size:12.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted)}.pf-add ul{margin:0;padding:0;list-style:none;font-size:13.5px;display:grid;gap:4px}.pf-add .pf-ok{color:var(--success)}@media (max-width:600px){.pf-add-b{min-height:44px}}</style>`
      + `<h2 id="pf-add-h">Put a friend on the map</h2><p>Type a GitHub username. Their city appears on the frontier, unclaimed. You earn ${FRONTIER.reward} credits when they claim it.</p>`
      + `<a class="pf-add-b" href="${esc(c.hub())}/add" target="_blank" rel="noopener">Add a GitHub<svg viewBox="0 0 24 24" aria-hidden="true" width="13" height="13"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">(opens in a new tab)</span></a>`
      + (rows ? `<h3>GitHubs you added</h3><ul>${rows}</ul>${all.length > 10 ? `<p>And ${all.length - 10} more.</p>` : ""}` : "") + `</section>`;
    const m = /<a class="city-peek"[\s\S]*?<\/a>/.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + sec + html.slice(m.index + m[0].length);
    return /<\/main>/i.test(html) ? html.replace(/<\/main>/i, () => sec + "</main>") : html.replace(/<\/body>/i, () => sec + "</body>");
  }

  return { route, look, add, districts, meta, claimedSlots, landData, recentLands, addPage, store: S, seedSome, claimNow, profileSection, erase: (p: string) => S.erase(p) };
}
