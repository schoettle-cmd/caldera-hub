/**
 * The growth simulation, wired into the hub: the 15-minute tick (ingest, poll GitHub, re-run the simulation), the state
 * API the World's renderer reads, the daily drop manifest, "today in your city", and the optional GitHub App webhook.
 * Kill switches (in /opt/caldera-hub/.notify.env, then pm2 restart): CALDERA_GROWTH=0 turns the whole thing off (the World
 * shows the Current map only); CALDERA_GROWTH_POLL=0 stops GitHub polling and keeps everything else.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import { DAY, dayOf, dayKey, growthStore, githubPoller, simulate, memberView, manifest, derivedDrops, todayLines, aiSignals, aiMult, webhookEvents,
  WINDOW_DAYS, type GEvent, type Seed, type SimOut, type Window, type MemberView, type Manifest } from "./growth";

type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export interface GrowthMember { id: string; handle: string; name: string; created: number; login: string | null; city: any }
export interface GrowthHubCtx {
  q: Q; fetch: typeof fetch;
  /** listed members in World order (the same order the map lays them out in) */ members: () => GrowthMember[];
  token: (profileId: string) => Promise<string | null>;
  /** the Expansion view's stored side (land never lost: it seeds the plot) */ landSide: (profileId: string) => number | null;
  memberOf: (req: http.IncomingMessage) => string | null;
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  dataDir: string; poll: boolean; pause?: number; now?: () => number;
}
export function growthHub(c: GrowthHubCtx) {
  const S = growthStore(c.q);
  const now = () => (c.now ? c.now() : Date.now());
  const POLL = githubPoller({ S, fetch: c.fetch, token: c.token, pause: c.pause, now });
  let sims: Map<string, SimOut> = new Map(), events: GEvent[] = [], seeds: Seed[] = [], simAt = 0, simDay = -1;
  const views = new Map<string, unknown>();

  // ---------------------------------------------------------------- seeds: the Expansion land carries over as built houses
  function ensureSeeds(ms: GrowthMember[]) {
    const have = new Set(S.seeds().map(s => s.p)), today = dayOf(now());
    for (const m of ms) {
      if (have.has(m.id)) continue;
      const side = c.landSide(m.id);
      if (side && side >= 2) S.seed({ p: m.id, day: today - 90, side, lots: "4".repeat(side * side) }, "expansion");
      else S.seed({ p: m.id, day: Math.min(today, dayOf(m.created || now())) - 90, side: 2, lots: "0000" }, "new");   // the 90 days before joining count too (the backfill reads them)
    }
  }
  // ---------------------------------------------------------------- inputs that need no GitHub: Caldera activity, private counts
  function ingestLocal(ms: GrowthMember[]) {
    const ids = new Set(ms.map(m => m.id)), since = new Date(now() - 3 * DAY).toISOString(), first = !c.q("SELECT 1 FROM growth_events WHERE kind IN ('post','comment','note','agent') LIMIT 1").get();
    const from = first ? new Date(now() - 90 * DAY).toISOString() : since;
    const scan = (sql: string, k: string, idf: (r: any) => string, who: (r: any) => string, when: (r: any) => number) => {
      try { for (const r of c.q(sql).all(from) as any[]) { const p = who(r), t = when(r); if (!ids.has(p) || !Number.isFinite(t)) continue; S.add({ id: idf(r), p, k, repo: "caldera", ts: t, seen: t, n: 1, v: "" }); } } catch (e: any) { console.error("growth ingest", k, e?.message); }
    };
    scan("SELECT id, author, ts FROM posts WHERE ts >= ? AND (status IS NULL OR status NOT IN ('hidden','deleted'))", "post", r => "post:" + r.id, r => r.author, r => Date.parse(r.ts));
    scan("SELECT id, author, ts FROM post_comments WHERE ts >= ? AND (status IS NULL OR status NOT IN ('hidden','deleted'))", "comment", r => "cm:" + r.id, r => r.author, r => Date.parse(r.ts));
    scan("SELECT owner, slug, updated FROM garden_notes WHERE updated >= ?", "note", r => `note:${r.owner}:${r.slug}`, r => r.owner, r => Date.parse(r.updated));
    scan("SELECT id, owner, ts FROM agent_posts WHERE ts >= ? AND (status IS NULL OR status NOT IN ('hidden','deleted'))", "agent", r => "ap:" + r.id, r => r.owner, r => Date.parse(r.ts));
    // private repos: counts only, from the member's own published city (named, anonymous or hidden as they chose), hashed ids
    const at = now();
    for (const m of ms) {
      const repos = (m.city?.districts || []).flatMap((d: any) => d.repos || []).filter((r: any) => r && (r.priv || r.locked) && !r.kind);
      if (!repos.length) continue;
      const cur: Record<string, number> = {}; for (const r of repos) { const k = r.locked ? "locked" : "n:" + String(r.name).toLowerCase(); cur[k] = (cur[k] || 0) + Math.max(0, Number(r.commits) || 0); }
      const prevRow = S.poll(m.id); let prev: Record<string, number> | null = null; try { prev = prevRow?.priv ? JSON.parse(prevRow.priv) : null; } catch { prev = null; }
      if (prev) for (const [k, n] of Object.entries(cur)) {
        const dlt = n - (prev[k] ?? n); if (dlt <= 0) continue;
        const h = crypto.createHash("sha256").update(m.id + "|" + k).digest("hex").slice(0, 12);
        S.add({ id: `pv:${m.id}:${h}:${Math.floor(at / 60000)}`, p: m.id, k: "private", repo: "private:" + h, ts: at, seen: at, n: Math.min(40, dlt), v: "" });
      }
      S.savePoll(m.id, { priv: JSON.stringify(cur) });
    }
  }
  // ---------------------------------------------------------------- AI signals, nightly, from the public repo signals the hub already keeps
  function scanAi(ms: GrowthMember[]) {
    for (const m of ms) {
      const logins = new Set<string>(); if (m.login) logins.add(m.login.toLowerCase());
      for (const r of (m.city?.districts || []).flatMap((d: any) => d.repos || [])) { const x = typeof r.url === "string" && r.public ? /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\//.exec(r.url) : null; if (x) logins.add(x[1].toLowerCase()); }
      const agentRepos = new Set<string>(); try { for (const a of c.q("SELECT repo FROM agents WHERE owner=? AND ts >= ?").all(m.id, new Date(now() - 30 * DAY).toISOString()) as any[]) if (a.repo) agentRepos.add(String(a.repo).toLowerCase().split("/").pop()!); } catch { /* no agents */ }
      const out: Record<string, [number, string[]]> = {};
      for (const lg of logins) {
        for (const r of c.q("SELECT repo, signals FROM tag_repo_cache WHERE lower(repo) LIKE ? ESCAPE '\\'").all(lg.replace(/[\\%_]/g, x => "\\" + x) + "/%") as any[]) {
          let s: any = null; try { s = JSON.parse(r.signals); } catch { continue; }
          const full = String(r.repo).toLowerCase(), sig = aiSignals(s, { agents: agentRepos.has(full.split("/").pop()!) });
          if (sig.n > 0) out[full] = [sig.n, sig.why];
        }
      }
      S.saveAi(m.id, out);
    }
  }
  // ---------------------------------------------------------------- the simulation, re-run from the seeds over the whole log
  function neighbours(ms: GrowthMember[]): Map<string, string[]> {
    const cols = Math.max(1, Math.ceil(Math.sqrt(ms.length * 1.3))), pos = ms.map((m, i) => [i % cols, Math.floor(i / cols)]);
    const out = new Map<string, string[]>();
    ms.forEach((m, i) => out.set(m.id, ms.filter((_, j) => Math.abs(pos[i]![0]! - pos[j]![0]!) + Math.abs(pos[i]![1]! - pos[j]![1]!) === 1).map(o => o.id)));
    return out;
  }
  let lastFull = -1;
  function recompute(ms = c.members()) {
    ensureSeeds(ms);
    const ids = new Set(ms.map(m => m.id));
    seeds = S.seeds().filter(s => ids.has(s.p)); events = S.events(0).filter(e => ids.has(e.p));
    const since = new Map<string, number>();
    for (const m of ms) { let t = m.created || now(); for (const r of (m.city?.districts || []).flatMap((d: any) => d.repos || [])) { const x = Date.parse(r?.created || ""); if (Number.isFinite(x) && x < t) t = x; } since.set(m.id, t); }
    const today = dayOf(now());
    sims = simulate(seeds, events, today, { ai: S.ai(), neighbours: neighbours(ms), since, floor: S.floor(), joined: new Map(ms.map(m => [m.id, dayOf(m.created || now())] as [string, number])) });
    const full = lastFull !== today;
    c.q("BEGIN").run();
    try { for (const [p, sim] of sims) S.saveSnaps(p, sim, full ? -Infinity : today - 1); if (full) S.prune(today - 400); c.q("COMMIT").run(); }
    catch (e) { try { c.q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
    if (full) lastFull = today;
    simAt = now(); simDay = today; views.clear();
  }
  function fresh() { if (!simAt || now() - simAt > 15 * 60_000 || dayOf(now()) !== simDay) recompute(); }

  // ---------------------------------------------------------------- the state API
  function state(win: Window) {
    fresh();
    const key = "s:" + win; if (views.has(key)) return views.get(key) as any;
    const ms = c.members(), byId = new Map(seeds.map(s => [s.p, s] as [string, Seed])), aiW = S.aiWhy();
    const evBy = new Map<string, GEvent[]>(); const t0 = (dayOf(now()) - WINDOW_DAYS[win] + 1) * DAY;
    for (const e of events) if (e.seen >= t0 - DAY) { if (!evBy.has(e.p)) evBy.set(e.p, []); evBy.get(e.p)!.push(e); }
    const members: Record<string, MemberView> = {}, totals = { c: 0, z: 0, top: 0, rel: 0, pr: 0, up: 0, ring: 0, pts: 0, members: 0, active: 0 };
    for (const m of ms) {
      const sim = sims.get(m.id); if (!sim) continue;
      const r = aiW.get(m.id); let ai: any = null; if (r) { let best: [number, string[]] | null = null; for (const v of Object.values(r)) if (!best || v[0] > best[0]) best = v; if (best) ai = { x: aiMult(best[0]), n: best[0], why: best[1] }; }
      const mv = memberView(m.handle, sim, evBy.get(m.id) || [], win, now(), ai, byId.get(m.id));
      members["@" + m.handle] = mv;
      totals.c += mv.w.c; totals.z += mv.w.z; totals.top += mv.w.top; totals.rel += mv.w.rel; totals.pr += mv.w.pr; totals.up += mv.w.up; totals.ring += mv.w.ring; totals.pts += mv.w.pts; totals.members++; if (mv.w.pts > 0) totals.active++;
    }
    totals.pts = Math.round(totals.pts);
    const out = { at: new Date(simAt).toISOString(), window: win, from: dayKey(dayOf(now()) - WINDOW_DAYS[win] + 1), to: dayKey(dayOf(now())), t0, members, totals };
    views.set(key, out); return out;
  }
  // ---------------------------------------------------------------- the daily drop
  function drops(day = dayOf(now())): Manifest {
    const k = dayKey(day), saved = S.drops(k); if (saved) return saved;
    fresh();
    const ms = c.members(), y = day - 1;
    const yest = ms.map(m => { const st = sims.get(m.id)?.stats.find(s => s.d === y); return { h: m.handle, name: m.name, c: Math.round(st?.c || 0), rel: st?.rel || 0 }; });
    const joined = ms.filter(m => dayOf(m.created) === y).map(m => m.handle);
    const mf = manifest(day, derivedDrops(yest, joined));
    if (day <= dayOf(now())) S.saveDrops(mf);
    return mf;
  }
  function today(req: http.IncomingMessage) {
    const id = c.memberOf(req), m = id ? c.members().find(x => x.id === id) : null;
    const mf = drops(); if (!m) return { me: null, day: mf.day, drops: mf.drops };
    const mv = (state("day").members as Record<string, MemberView>)["@" + m.handle] || null;
    return { me: "@" + m.handle, name: m.name, day: mf.day, lines: todayLines(m.handle, mv, mf), drops: mf.drops };
  }
  // ---------------------------------------------------------------- the tick
  let running = false, lastAi = -1;
  const after: (() => void | Promise<void>)[] = [];
  async function tick(o: { maxPolls?: number; maxBackfills?: number } = {}) {
    if (running) return; running = true;
    try {
      const ms = c.members(); ensureSeeds(ms); ingestLocal(ms);
      if (lastAi !== dayOf(now())) { try { scanAi(ms); } catch (e: any) { console.error("growth ai", e?.message); } lastAi = dayOf(now()); }
      if (c.poll) {
        let polls = o.maxPolls ?? 12, backfills = o.maxBackfills ?? 3;
        const due = ms.filter(m => m.login).map(m => ({ m, row: S.poll(m.id) })).sort((a, b) => (Number(a.row?.at) || 0) - (Number(b.row?.at) || 0));
        for (const { m, row } of due) {
          const back = !row?.backfilled; if (!back && row?.at && now() - Number(row.at) < 55 * 60_000) continue;
          if (back ? backfills-- <= 0 : polls-- <= 0) continue;
          try { await POLL.poll({ id: m.id, login: m.login! }); } catch (e: any) { if (e?.stop) { console.error("growth poll: rate limited"); break; } console.error("growth poll", m.handle, e?.message); }
        }
      }
      recompute(c.members());
      drops();
      for (const fn of after) { try { await fn(); } catch (e: any) { console.error("growth after-tick", e?.message); } }   // the battles ride this tick
    } finally { running = false; }
  }
  function schedule() {
    const t0 = setTimeout(() => { void tick().catch(e => console.error("growth tick", e?.message)); const t = setInterval(() => void tick().catch(e => console.error("growth tick", e?.message)), 15 * 60_000); t.unref?.(); }, 60_000); t0.unref?.();
  }
  // ---------------------------------------------------------------- the GitHub App webhook (off until data/github-webhook.json has a secret)
  function secret(): string | null { try { return JSON.parse(fs.readFileSync(c.dataDir + "/github-webhook.json", "utf8")).secret || null; } catch { return null; } }
  async function hook(req: http.IncomingMessage, res: http.ServerResponse) {
    const sec = secret(); if (!sec) return c.json(res, 404, { error: "not configured" });
    const raw = await rawBody(req), sig = String(req.headers["x-hub-signature-256"] || "");
    const want = "sha256=" + crypto.createHmac("sha256", sec).update(raw).digest("hex");
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return c.json(res, 401, { error: "bad signature" });
    let body: any = null; try { body = JSON.parse(raw); } catch { return c.json(res, 400, { error: "bad json" }); }
    const logins = new Map(c.members().filter(m => m.login).map(m => [m.login!.toLowerCase(), m.id] as [string, string]));
    let n = 0; for (const e of webhookEvents(String(req.headers["x-github-event"] || ""), body, l => logins.get(l.toLowerCase()) || null, now())) if (S.add(e)) n++;
    return c.json(res, 200, { ok: true, added: n });
  }
  async function rawBody(req: http.IncomingMessage): Promise<string> { const ch: Buffer[] = []; let n = 0; for await (const x of req) { n += (x as Buffer).length; if (n > 5e6) throw new Error("too large"); ch.push(x as Buffer); } return Buffer.concat(ch).toString("utf8"); }
  async function route(req: http.IncomingMessage, res: http.ServerResponse, p: string, url: URL): Promise<boolean> {
    if (req.method === "GET" && p === "/v1/world/state") {
      const w = String(url.searchParams.get("window") || "day") as Window;
      if (!(w in WINDOW_DAYS)) { c.json(res, 400, { error: "window must be day, week or month" }); return true; }
      res.setHeader("cache-control", "public, max-age=60"); c.json(res, 200, state(w)); return true;
    }
    if (req.method === "GET" && p === "/v1/world/drops") {
      const d = String(url.searchParams.get("day") || ""), day = /^\d{4}-\d{2}-\d{2}$/.test(d) ? dayOf(Date.parse(d + "T00:00:00Z")) : dayOf(now());
      if (day > dayOf(now()) + 1 || day < dayOf(now()) - 400) { c.json(res, 404, { error: "no drop for that day" }); return true; }
      res.setHeader("cache-control", "public, max-age=300"); c.json(res, 200, drops(day)); return true;
    }
    if (req.method === "GET" && p === "/v1/world/today") { res.setHeader("cache-control", "private, no-store"); c.json(res, 200, today(req)); return true; }
    if (req.method === "POST" && p === "/hooks/github") { await hook(req, res); return true; }
    return false;
  }
  /** the simulation as it stands (fresh within 15 minutes), for the battles: they read it, never change it */
  const sim = () => { fresh(); return { sims, events, ai: S.ai() }; };
  return { route, tick, schedule, recompute, state, drops, today, store: S, poller: POLL, sim, onTick: (fn: () => void | Promise<void>) => { after.push(fn); }, erase: (id: string) => { S.erase(id); views.clear(); simAt = 0; } };
}
