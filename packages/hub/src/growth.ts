/**
 * The World's time views (Mike 2026-11-07, approved proposal "Caldera growth views: day, week, month",
 * mjonesone.com/r-caldera-growth-86be0fb2, directions A "Zoned to grow" + D "Commit rain").
 *
 * One map (the Current map), four windows (Now, Day, Week, Month), one ledger:
 * - Real work becomes dated events in an append-only log (GitHub polling, an optional GitHub App webhook, public Caldera
 *   activity, private-repo counts from the member's own published city). Anti-gaming rules are applied when an event is
 *   judged (bots, empty and merge commits, reverts, forks, young stargazers, self-merged PRs) and when it is folded (caps).
 * - A simulation folds the log, day by day, into build points (recency weight, streak and AI multipliers, neighbour bonus,
 *   a 60-point daily cap) and spends them automatically: each lot is bought in four stages (zoned, graded, frame, built),
 *   later lots in a ring cost 10% more each, built lots climb five tiers (lot, houses, mid-rise, tower, solar/AI campus).
 *   Surplus banks for 14 days, then decays 10% a day. Land never shrinks; idle plots pause, dim, weather and go dormant.
 * - Every 15 minutes the hub re-runs the simulation from the seeds over the whole log (it is deterministic and cheap), keeps
 *   the state in memory for /v1/world/state, and stores the day's snapshot and purchase log for the replay.
 * - The daily drop: a small JSON manifest per day (derived from yesterday's log, plus a curated calendar) that the renderer
 *   reads at load. No code deploy per day.
 * Nothing here calls GitHub on a page load. Only public data, or counts, ever reach the map.
 */
export const DAY = 86_400_000;
export const dayOf = (t: number) => Math.floor(t / DAY);
export const dayKey = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

// ---------------------------------------------------------------- the rules (first guesses, tuned on real data later)
export const RULES = {
  stageCost: 25, ringStep: 1.1, upgradeX: 2, dayCap: 60, commitCap: 40, repoSoft: 40, repoSoftW: 0.2,
  starCap: 20, issueCap: 5, calderaCap: 10, vaultCap: 10, bankDays: 14, bankDecay: 0.9, zoneAt: 0.6, neighbour: 1.05,
  privateW: 0.7, maxSide: 16, stormAt: 50, minSide: 2,
  pts: { commit: 1, private: 1, pr: 6, pr_self: 2, release: 15, ci_green: 2, star: 0.5, newcontrib: 10, issue: 2, post: 3, comment: 1, note: 2, agent: 1, vault: 0.5, newrepo: 0, ci_red: 0 } as Record<string, number>,
};
export type Kind = "commit" | "private" | "pr" | "release" | "ci_green" | "ci_red" | "star" | "newcontrib" | "issue" | "post" | "comment" | "note" | "agent" | "vault" | "newrepo";
const GITHUB_KINDS = new Set(["commit", "pr", "release", "ci_green", "star", "newcontrib", "issue"]);

/** a commit today counts 1.0, a week old 0.7, a month old 0.3, older than 90 days 0 (linear in between) */
export function recency(ageDays: number): number {
  const a = Math.max(0, Number(ageDays) || 0);
  if (a <= 7) return 1 - 0.3 * a / 7;
  if (a <= 30) return 0.7 - 0.4 * (a - 7) / 23;
  if (a <= 90) return 0.3 - 0.3 * (a - 30) / 60;
  return 0;
}
/** a daily streak multiplies the day's points: x1.1 at 7 days, rising to x1.5 at 30 */
export function streakMult(s: number): number { return s < 7 ? 1 : s >= 30 ? 1.5 : 1.1 + 0.4 * (s - 7) / 23; }
/** AI and next-gen boost: one public signal x1.3, each more +0.1, at most x1.6 */
export function aiMult(signals: number): number { return signals <= 0 ? 1 : Math.min(1.6, 1.2 + 0.1 * signals); }

// ---------------------------------------------------------------- AI signals (public only)
const AI_TOPICS = /^(llm|llms|agents?|ai-agents?|agentic|machine-learning|deep-learning|ml|ai|artificial-intelligence|rag|retrieval-augmented-generation|mcp|model-context-protocol|openai|anthropic|claude|gpt|chatgpt|langchain|generative-ai|genai|nlp|transformers|pytorch|tensorflow|computer-vision|embeddings|vector-database|huggingface|ollama|vllm|diffusion|stable-diffusion|reinforcement-learning)$/i;
const AI_DEPS = /^(openai|@openai\/.*|anthropic|@anthropic-ai\/.*|ai|@ai-sdk\/.*|langchain.*|@langchain\/.*|langgraph|llama-index.*|llama_index|llamaindex|torch|pytorch|torchvision|jax|flax|transformers|@huggingface\/.*|huggingface[-_]hub|sentence-transformers|vllm|ollama|tensorflow|keras|@modelcontextprotocol\/.*|mcp|fastmcp|google-generativeai|@google\/genai|google-genai|groq|groq-sdk|mistralai|@mistralai\/.*|cohere|cohere-ai|replicate|together|litellm|dspy|dspy-ai|instructor|openai-agents|@openai\/agents|crewai|autogen|pyautogen|diffusers|accelerate|peft|trl|xformers|onnxruntime|tiktoken|chromadb|pinecone.*|@pinecone-database\/.*|qdrant-client|weaviate-client|faiss.*|lancedb|mlx|mlx-lm|llama-cpp-python|node-llama-cpp)$/i;
const MODEL_FILES = /\.(gguf|safetensors|onnx|ckpt)\b|huggingface\.co\/(?!docs)/i;
export interface RepoSig { repo: string; topics?: string[]; deps?: string[]; readme?: string }
/** count a repo's AI signals: topics (at most 2), LLM SDK / ML dependencies (at most 3), model or dataset files (1),
 *  an Obsidian plugin that uses AI (1), agents reporting from it through the drone feed (1). */
export function aiSignals(s: RepoSig | null | undefined, extra: { agents?: boolean } = {}): { n: number; why: string[] } {
  const why: string[] = [];
  const topics = (s?.topics || []).map(t => String(t).toLowerCase());
  topics.filter(t => AI_TOPICS.test(t)).slice(0, 2).forEach(t => why.push("topic " + t));
  const deps = [...new Set((s?.deps || []).map(d => String(d).toLowerCase()))].filter(d => AI_DEPS.test(d));
  deps.slice(0, 3).forEach(d => why.push("uses " + d));
  if (MODEL_FILES.test(String(s?.readme || ""))) why.push("model files");
  if (topics.includes("obsidian-plugin") && deps.length) why.push("AI Obsidian plugin");
  if (extra.agents) why.push("agents report from it");
  return { n: why.length, why };
}

// ---------------------------------------------------------------- anti-gaming
export const BOT = /\[bot\]$|^(dependabot|renovate|github-actions|greenkeeper|snyk-bot|imgbot|allcontributors|codecov|mergify|pre-commit-ci|semantic-release-bot|deepsource-autofix|web-flow|actions-user|copilot-swe-agent)$/i;
export interface GhCommit { sha: string; commit?: { message?: string; tree?: { sha?: string }; author?: { email?: string; date?: string }; committer?: { date?: string; email?: string } }; author?: { login?: string } | null; committer?: { login?: string } | null; parents?: { sha: string }[]; stats?: { total?: number }; files?: unknown[] }
/** Judge one commit: "" when it earns, else why not. trees: sha -> tree sha for the commits fetched alongside (an empty
 *  commit has its parent's tree). repo: is it a fork, and when was it created (a fork's commits before that are upstream's). */
export function judgeCommit(c: GhCommit, login: string, repo: { fork?: boolean; created?: number } = {}, trees: Map<string, string> = new Map()): { v: string; reverts?: string } {
  const who = String(c.author?.login || "");
  const msg = String(c.commit?.message || "");
  if (BOT.test(who) || /\[bot\]@|^\d+\+[^@]*\[bot\]@/.test(String(c.commit?.author?.email || ""))) return { v: "bot" };
  if (who && login && who.toLowerCase() !== login.toLowerCase()) return { v: "other" };
  if ((c.parents || []).length > 1) return { v: "merge" };
  const rv = /^Revert ".*"/.test(msg) ? /This reverts commit ([0-9a-f]{7,40})/.exec(msg) : null;
  if (rv) return { v: "revert", reverts: rv[1] };
  if (c.stats && (Number(c.stats.total) || 0) === 0) return { v: "empty" };
  if (Array.isArray(c.files) && c.files.length === 0 && c.stats) return { v: "empty" };
  const p0 = c.parents?.[0]?.sha, tree = c.commit?.tree?.sha;
  if (p0 && tree && trees.get(p0) === tree) return { v: "empty" };
  const t = Date.parse(c.commit?.committer?.date || c.commit?.author?.date || "");
  if (repo.fork && repo.created && Number.isFinite(t) && t < repo.created) return { v: "fork" };
  return { v: "" };
}
/** PR points: merged by another account, or after CI passed = 6; self-merged on a solo repo = 2 */
export function prPoints(o: { author: string; mergedBy?: string | null; ciPassed?: boolean }): number {
  const other = !!o.mergedBy && o.mergedBy.toLowerCase() !== o.author.toLowerCase() && !BOT.test(o.mergedBy);
  return other || o.ciPassed ? RULES.pts.pr : RULES.pts.pr_self;
}
/** stars from accounts under 30 days old are ignored */
export function youngAccount(created: string | number | undefined, at: number): boolean {
  const t = typeof created === "number" ? created : Date.parse(String(created || ""));
  return !Number.isFinite(t) || at - t < 30 * DAY;
}

// ---------------------------------------------------------------- plot geometry: lots fill the plot ring by ring
/** Lot index -> cell (a, b) in the plot. Ring r (r = side - 1) holds 2r + 1 lots: the new column, the corner, the new row. */
export function lotXY(i: number): [number, number] {
  const r = Math.floor(Math.sqrt(i)), o = i - r * r;
  return o < r ? [r, o] : o === r ? [r, r] : [o - r - 1, r];
}
export function lotIndex(a: number, b: number): number { const r = Math.max(a, b); return r * r + (a === r ? (b < r ? b : r) : r + 1 + a); }
export function ringOffset(i: number): number { const r = Math.floor(Math.sqrt(i)); return i - r * r; }
export function stageCost(i: number): number { return RULES.stageCost * Math.pow(RULES.ringStep, ringOffset(i)); }
export function upgradeCost(i: number): number { return RULES.upgradeX * stageCost(i); }
/** lot codes: 0 spare, 1 zoned, 2 graded, 3 frame, 4 houses, 5 mid-rise, 6 tower, 7 campus. Tier = code - 2 once built. */
export const TIER_NAMES = ["", "Lot", "Houses", "Mid-rise", "Tower", "Campus"];
export const tierOf = (code: number) => code >= 4 ? code - 2 : code > 0 ? 1 : 0;

// ---------------------------------------------------------------- health and tiers
/** 0 building, 1 paused (14 days idle), 2 dim (60), 3 weathered (180), 4 dormant (365) */
export function healthCode(idleDays: number | null): number {
  if (idleDays === null) return 4;
  return idleDays >= 365 ? 4 : idleDays >= 180 ? 3 : idleDays >= 60 ? 2 : idleDays >= 14 ? 1 : 0;
}
export interface TierIn { streak7In30: boolean; active60: number; prs30: number; rel30: number; ai30: boolean; historyDays: number }
/** 1 lot (any work); 2 houses (a 7-day streak in the last 30 days); 3 mid-rise (30 active days in 60); 4 tower (5 merged
 *  PRs in 30 days and a release); 5 campus (AI boost active, 90 days of history, and mid-rise or tower work). */
export function eligibleTier(t: TierIn): number {
  const t3 = t.active60 >= 30, t4 = t.prs30 >= 5 && t.rel30 >= 1;
  if (t.ai30 && t.historyDays >= 90 && (t3 || t4)) return 5;
  if (t4) return 4; if (t3) return 3; if (t.streak7In30) return 2; return 1;
}

// ---------------------------------------------------------------- the simulation
export interface GEvent { id: string; p: string; k: Kind | string; repo: string; ts: number; seen: number; n: number; v: string; x?: { rv?: string; self?: 0 | 1 } }
export interface Seed { p: string; day: number; side: number; lots: string; since?: number }
export interface DayStat { d: number; pts: number; c: number; pr: number; rel: number; st: number; z: number; top: number; up: number; ring: number; ai: number; nc: number }
export interface Snap { side: number; lots: string; bank: number; streak: number; tier: number; idle: number | null }
/** one purchase: [time ms, lot index (-1: the plot grew a ring, value = new side), new code] */
export type Buy = [number, number, number];
export interface SimOut { side: number; lots: string; bank: number; streak: number; tier: number; idle: number | null; lastActive: number | null; first: number | null; pointsToday: number; aiRepos: number; stats: DayStat[]; snaps: Map<number, Snap>; log: Buy[] }
export interface SimCtx {
  /** profile -> repo (lowercase owner/name or hashed id) -> AI signal count */ ai?: Map<string, Map<string, number>>;
  /** profile -> neighbouring profiles on the map */ neighbours?: Map<string, string[]>;
  /** profile -> the earliest public history (ms), for the campus tier's 90 days */ since?: Map<string, number>;
  /** profile -> the largest side ever shown (land never shrinks) */ floor?: Map<string, number>;
  /** profile -> the day they joined (a new member with no work yet is not dormant) */ joined?: Map<string, number>;
}
interface MState { p: string; side: number; lots: number[]; bank: { d: number; a: number }[]; streak: number; lastActive: number | null; first: number | null;
  active: number[]; prDays: number[]; relDays: number[]; aiDays: number[]; streak7: number | null; upNext: boolean; tier: number; stats: DayStat[]; snaps: Map<number, Snap>; log: Buy[] }

const bankSum = (m: MState) => m.bank.reduce((s, x) => s + x.a, 0);
function pay(m: MState, cost: number) { let left = cost; while (left > 1e-9 && m.bank.length) { const b = m.bank[0]!; const t = Math.min(b.a, left); b.a -= t; left -= t; if (b.a <= 1e-9) m.bank.shift(); } }
function nextBuy(m: MState): { i: number; cost: number; to: number; up?: 1 } | { ring: 1; cost: 0 } | null {
  const n = m.side * m.side;
  for (let i = 0; i < n; i++) { const c = m.lots[i]!; if (c >= 1 && c <= 3) return { i, cost: stageCost(i), to: c + 1 }; }
  let spare = -1, upI = -1, upC = 99;
  for (let i = 0; i < n; i++) { const c = m.lots[i]!; if (c === 0 && spare < 0) spare = i; if (c >= 4 && c < 7 && tierOf(c) < m.tier && c < upC) { upC = c; upI = i; } }
  if (upI >= 0 && (m.upNext || spare < 0)) return { i: upI, cost: upgradeCost(upI), to: upC + 1, up: 1 };
  if (spare >= 0) return { i: spare, cost: stageCost(spare), to: 1 };
  if (m.side < RULES.maxSide) return { ring: 1, cost: 0 };
  return null;
}
function spend(m: MState, t: number, st: DayStat) {
  for (let guard = 0; guard < 400; guard++) {
    const b = nextBuy(m); if (!b) return;
    if ("ring" in b) { m.side++; while (m.lots.length < m.side * m.side) m.lots.push(0); m.log.push([t, -1, m.side]); st.ring++; continue; }
    if (bankSum(m) + 1e-9 < b.cost) return;
    pay(m, b.cost); const was = m.lots[b.i]!; m.lots[b.i] = b.to; m.log.push([t, b.i, b.to]);
    if (b.up) { st.up++; m.upNext = false; } else { if (was === 0) st.z++; if (b.to === 4) { st.top++; m.upNext = true; } }
  }
}
const count = (days: number[], from: number, to: number) => { let n = 0; for (const d of days) if (d >= from && d <= to) n++; return n; };

/** Fold the log into every member's plot, day by day from their seed to `today` (UTC day numbers). Deterministic. */
export function simulate(seeds: Seed[], events: GEvent[], today: number, ctx: SimCtx = {}): Map<string, SimOut> {
  const byP = new Map<string, GEvent[]>();
  const reverted = new Set<string>();
  for (const e of events) if (e.x?.rv) reverted.add(e.x.rv.slice(0, 7));
  for (const e of events) { if (!byP.has(e.p)) byP.set(e.p, []); byP.get(e.p)!.push(e); }
  for (const l of byP.values()) l.sort((a, b) => a.seen - b.seen || (a.id < b.id ? -1 : 1));
  const ms = new Map<string, MState>(), seedOf = new Map(seeds.map(s => [s.p, s] as [string, Seed]));
  const start = seeds.length ? Math.min(...seeds.map(s => s.day)) : today;
  const cursor = new Map<string, number>();
  const thriving = (m: MState, d: number) => count(m.active, d - 7, d - 1) >= 5;
  for (let d = start; d <= today; d++) {
    const prevThriving = new Map<string, boolean>(); for (const [p, m] of ms) prevThriving.set(p, thriving(m, d));
    for (const s of seeds) {
      if (s.day > d) continue;
      let m = ms.get(s.p);
      if (!m) {
        const side = Math.max(RULES.minSide, Math.min(RULES.maxSide, s.side | 0)), lots = Array.from({ length: side * side }, (_, i) => Math.max(0, Math.min(7, Number(s.lots[i]) || 0)));
        m = { p: s.p, side, lots, bank: [], streak: 0, lastActive: null, first: null, active: [], prDays: [], relDays: [], aiDays: [], streak7: null, upNext: true, tier: 1, stats: [], snaps: new Map(), log: [] };
        ms.set(s.p, m);
      }
      // the day starts: surplus older than 14 days decays 10%, a dormant plot's tiers settle back towards houses, tiers re-earned
      for (const b of m.bank) if (d - b.d >= RULES.bankDays) b.a *= RULES.bankDecay;
      m.bank = m.bank.filter(b => b.a > 0.01);
      const ref = Math.max(m.lastActive ?? -Infinity, ctx.joined?.get(s.p) ?? -Infinity), idle = Number.isFinite(ref) ? d - ref : null;
      if (idle !== null && idle >= 365 && (idle - 365) % 30 === 0) for (let i = 0; i < m.lots.length; i++) if (m.lots[i]! > 4) m.lots[i]!--;
      const hist = Math.max(m.first === null ? 0 : d - m.first, ctx.since?.has(s.p) ? Math.floor((d * DAY - ctx.since.get(s.p)!) / DAY) : 0);
      m.tier = eligibleTier({ streak7In30: m.streak7 !== null && d - m.streak7 <= 30, active60: count(m.active, d - 60, d - 1), prs30: count(m.prDays, d - 30, d - 1), rel30: count(m.relDays, d - 30, d - 1), ai30: count(m.aiDays, d - 30, d - 1) > 0, historyDays: hist });
      const nb = (ctx.neighbours?.get(s.p) || []).some(o => prevThriving.get(o)) ? RULES.neighbour : 1;
      const st: DayStat = { d, pts: 0, c: 0, pr: 0, rel: 0, st: 0, z: 0, top: 0, up: 0, ring: 0, ai: 0, nc: 0 };
      const list = byP.get(s.p) || []; let k = cursor.get(s.p) || 0;
      const perRepo = new Map<string, number>(); let commitU = 0, stars = 0, issues = 0, cald = 0, vault = 0, dayPts = 0, active = false;
      const ai = ctx.ai?.get(s.p);
      while (k < list.length && dayOf(list[k]!.seen) <= d) {
        const e = list[k++]!;
        if (dayOf(e.seen) < d || e.v) continue;
        if (e.k === "commit" && reverted.has(e.id.replace(/^c:/, "").slice(0, 7))) continue;   // a revert cancels the commit it reverts
        let base = 0, units = Math.max(0, Number(e.n) || 0);
        switch (e.k) {
          case "commit": case "private": {
            const r = perRepo.get(e.repo) || 0, full = Math.max(0, Math.min(units, RULES.repoSoft - r)), eff = full + (units - full) * RULES.repoSoftW;   // repo-level diminishing returns after 40 a day
            perRepo.set(e.repo, r + units);
            const u = Math.min(eff, Math.max(0, RULES.commitCap - commitU)); commitU += u;
            base = u * (e.k === "private" ? RULES.privateW : RULES.pts.commit); st.c += u; break;
          }
          case "pr": base = e.x?.self ? RULES.pts.pr_self : RULES.pts.pr; break;
          case "star": { const u = Math.min(units || 1, Math.max(0, RULES.starCap - stars)); stars += u; base = u * RULES.pts.star; break; }
          case "issue": if (issues < RULES.issueCap) { issues++; base = RULES.pts.issue; } break;
          case "post": case "comment": case "note": case "agent": { const b = Math.min(RULES.pts[e.k] || 0, Math.max(0, RULES.calderaCap - cald)); cald += b; base = b; break; }
          case "vault": { const u = Math.min(units || 1, Math.max(0, RULES.vaultCap - vault)); vault += u; base = u * RULES.pts.vault; break; }
          default: base = (RULES.pts[e.k] || 0) * (units || 1);
        }
        if (base <= 0) continue;
        if (!active) { active = true; m.streak = m.lastActive === d - 1 ? m.streak + 1 : m.lastActive === d ? m.streak : 1; m.lastActive = d; if (m.first === null) m.first = d; }
        const aiN = GITHUB_KINDS.has(e.k) && ai ? (ai.get(e.repo.toLowerCase()) || 0) : 0;
        let pts = base * recency((e.seen - e.ts) / DAY) * aiMult(aiN) * streakMult(m.streak) * nb;
        pts = Math.min(pts, RULES.dayCap - dayPts); if (pts <= 0) continue;   // a loud day cannot buy a ring
        dayPts += pts; st.pts += pts; if (aiN > 0) st.ai += pts;
        if (e.k === "pr") st.pr++; else if (e.k === "release") st.rel++; else if (e.k === "star") st.st++; else if (e.k === "newcontrib") st.nc++;
        const last = m.bank[m.bank.length - 1]; if (last && last.d === d) last.a += pts; else m.bank.push({ d, a: pts });
        spend(m, e.seen, st);
      }
      cursor.set(s.p, k);
      if (active) { m.active.push(d); if (st.pr) m.prDays.push(...Array(st.pr).fill(d)); if (st.rel) m.relDays.push(d); if (st.ai > 0) m.aiDays.push(d); if (m.streak >= 7) m.streak7 = d; }
      m.active = m.active.filter(x => x > d - 61); m.prDays = m.prDays.filter(x => x > d - 31); m.relDays = m.relDays.filter(x => x > d - 31); m.aiDays = m.aiDays.filter(x => x > d - 31);
      if (!active && d < today) m.streak = 0;   // a missed day ends the streak (today still has time)
      m.stats.push(st);
      m.snaps.set(d, { side: m.side, lots: m.lots.join(""), bank: Math.round(bankSum(m) * 10) / 10, streak: m.streak, tier: m.tier, idle: idleOf(m, d) });
    }
  }
  function idleOf(m: MState, d: number): number | null { const ref = Math.max(m.lastActive ?? -Infinity, ctx.joined?.get(m.p) ?? -Infinity); return Number.isFinite(ref) ? Math.max(0, d - ref) : null; }
  const out = new Map<string, SimOut>();
  for (const [p, m] of ms) {
    const fl = ctx.floor?.get(p) || 0;
    if (fl > m.side) { m.side = Math.min(RULES.maxSide, fl); while (m.lots.length < m.side * m.side) m.lots.push(4); }   // land never shrinks
    const last = m.stats[m.stats.length - 1];
    out.set(p, { side: m.side, lots: m.lots.join(""), bank: Math.round(bankSum(m) * 10) / 10, streak: m.lastActive !== null && today - m.lastActive <= 1 ? m.streak : 0, tier: m.tier,
      idle: idleOf(m, today), lastActive: m.lastActive, first: m.first, pointsToday: last && last.d === today ? Math.round(last.pts * 10) / 10 : 0,
      aiRepos: [...(ctx.ai?.get(p)?.values() || [])].filter(n => n > 0).length, stats: m.stats, snaps: m.snaps, log: m.log });
    void seedOf;
  }
  return out;
}

// ---------------------------------------------------------------- windows: what the state API serves
export type Window = "now" | "day" | "week" | "month";
export const WINDOW_DAYS: Record<Window, number> = { now: 1, day: 1, week: 7, month: 30 };
export interface MemberView {
  h: string; k: number; l: string; k0: number; l0: string; g: Buy[];
  st: { pts: number; bank: number; streak: number; tier: number; idle: number | null; hc: number; ai: [number, number, string[]] | null; thr: 0 | 1 };
  w: { pts: number; c: number; pr: number; rel: number; st: number; z: number; top: number; up: number; ring: number; nc: number };
  hist: number[]; fx: [string, number, string?][];
}
/** One member's view of a window: the plot now and at the window's start, the purchases inside it, the window's totals,
 *  the points over time (24 hourly buckets for a day, 28 six-hour buckets for a week, 30 daily for a month), and events. */
export function memberView(h: string, sim: SimOut, events: GEvent[], win: Window, now: number, ai: { x: number; n: number; why: string[] } | null, seed?: Seed | null): MemberView {
  const today = dayOf(now), nd = WINDOW_DAYS[win], d0 = today - nd + 1, t0 = d0 * DAY;
  const before = sim.snaps.get(d0 - 1);
  const g = sim.log.filter(b => b[0] >= t0);
  let k0 = sim.side, l0 = sim.lots;
  if (before) { k0 = before.side; l0 = before.lots; }
  else if (seed && seed.day >= d0) { k0 = seed.side; l0 = seed.lots.slice(0, seed.side * seed.side); }   // joined inside the window
  const w = { pts: 0, c: 0, pr: 0, rel: 0, st: 0, z: 0, top: 0, up: 0, ring: 0, nc: 0 };
  for (const s of sim.stats) if (s.d >= d0) { w.pts += s.pts; w.c += s.c; w.pr += s.pr; w.rel += s.rel; w.st += s.st; w.z += s.z; w.top += s.top; w.up += s.up; w.ring += s.ring; w.nc += s.nc; }
  w.pts = Math.round(w.pts * 10) / 10; w.c = Math.round(w.c);
  const nb = win === "week" ? 28 : win === "month" ? 30 : 24, span = nd * DAY / nb, hist = Array(nb).fill(0) as number[];
  const fx: [string, number, string?][] = [];
  const mine = events.filter(e => e.seen >= t0 && !e.v);
  const daily = new Map<number, number>();
  for (const e of mine) {
    if (e.k === "commit" || e.k === "private") { const b = Math.min(nb - 1, Math.floor((e.seen - t0) / span)); hist[b]! += e.n || 1; daily.set(dayOf(e.seen), (daily.get(dayOf(e.seen)) || 0) + (e.n || 1)); }
    if (e.k === "release") fx.push(["rel", e.seen, e.repo.split("/").pop()]);
    else if (e.k === "newrepo") fx.push(["new", e.seen]);
    else if (e.k === "newcontrib") fx.push(["par", e.seen]);
  }
  for (const [d, n] of daily) if (n >= RULES.stormAt) fx.push(["storm", d * DAY + 12 * 3600_000]);
  const red = events.filter(e => (e.k === "ci_red" || e.k === "ci_green") && now - e.seen < DAY).sort((a, b) => b.seen - a.seen)[0];
  if (red && red.k === "ci_red" && now - red.ts > 3600_000) fx.push(["fire", red.ts, red.repo.split("/").pop()]);
  const thr = sim.stats.slice(-7).filter(s => s.pts > 0).length >= 5 ? 1 : 0;
  return { h, k: sim.side, l: sim.lots, k0, l0, g: g.map(b => [b[0], b[1], b[2]] as Buy), hist: hist.map(n => Math.round(n)),
    st: { pts: sim.pointsToday, bank: sim.bank, streak: sim.streak, tier: sim.tier, idle: sim.idle, hc: healthCode(sim.idle), ai: ai && ai.n > 0 ? [Math.round(ai.x * 10) / 10, ai.n, ai.why.slice(0, 4)] : null, thr }, w, fx: fx.slice(0, 12) };
}

// ---------------------------------------------------------------- the daily drop
export interface Drop { kind: string; at?: string; why?: string; route?: string; banner?: string; path?: string; livery?: string; name?: string; plots?: string; lights?: string; species?: string; where?: string; t: string }
export interface Manifest { day: string; season: string; drops: Drop[] }
const SEASONS = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
const FESTIVALS: Record<number, [string, string]> = { 0: ["New year lanterns", "#FFC46B"], 1: ["Ice lights", "#9EC5FF"], 2: ["Spring kites", "#F2A0C8"], 3: ["Blossom night", "#F7B2D0"], 4: ["Garden fair", "#B6E38C"],
  5: ["Midsummer lights", "#FFD27A"], 6: ["Starlight market", "#FFE08A"], 7: ["Lantern float", "#FFC46B"], 8: ["Harvest fair", "#F2A65A"], 9: ["Pumpkin lights", "#FF9A3D"], 10: ["Lantern night", "#FFC46B"], 11: ["Winter lights", "#CFE3FF"] };
const LIVERIES = ["#8B6CF6", "#2DD4BF", "#FBBF24", "#FB7185", "#38BDF8"];
const WILD: [string, string][] = [["deer", "meadow"], ["gulls", "shore"], ["foxes", "meadow"], ["geese", "shore"], ["rabbits", "meadow"]];
/** The curated calendar: a visiting airship every day, wildlife at dawn, a festival on Fridays to Sundays and on the 1st,
 *  a market on Saturdays. Same day in, same drops out. */
export function curatedDrops(d: number): Drop[] {
  const dt = new Date(d * DAY), mo = dt.getUTCMonth(), wd = dt.getUTCDay(), out: Drop[] = [];
  out.push({ kind: "airship", path: d % 2 ? "west-east" : "north-south", livery: LIVERIES[d % LIVERIES.length]!, t: "12:00" });
  const [sp, where] = WILD[d % WILD.length]!; out.push({ kind: "wildlife", species: sp, where, t: "dawn" });
  if (wd === 5 || wd === 6 || wd === 0 || dt.getUTCDate() === 1) { const [name, lights] = FESTIVALS[mo]!; out.push({ kind: "festival", name, plots: "thriving", lights, t: "dusk" }); }
  if (wd === 6) out.push({ kind: "market", where: "plaza", t: "10:00" });
  return out;
}
/** Derived drops from yesterday's work: a parade for the top shipper, fireworks for releases, a welcome party for new
 *  members, a storm over any plot with 50+ commits. */
export function derivedDrops(yesterday: { h: string; name: string; c: number; rel: number }[], joined: string[]): Drop[] {
  const out: Drop[] = [];
  const top = [...yesterday].filter(x => x.c >= 5).sort((a, b) => b.c - a.c || a.h.localeCompare(b.h))[0];
  if (top) out.push({ kind: "parade", at: "@" + top.h, why: `top shipper, ${top.c} commits`, route: "ring", banner: `${firstName(top.name, top.h)} shipped ${top.c}`, t: "09:00" });
  for (const x of yesterday.filter(x => x.rel > 0).sort((a, b) => b.rel - a.rel || a.h.localeCompare(b.h)).slice(0, 3)) out.push({ kind: "fireworks", at: "@" + x.h, why: x.rel === 1 ? "shipped a release" : `shipped ${x.rel} releases`, t: "dusk" });
  for (const h of joined.slice(0, 3)) out.push({ kind: "welcome", at: "@" + h, why: "new member", t: "10:00" });
  for (const x of yesterday.filter(x => x.c >= RULES.stormAt).slice(0, 3)) out.push({ kind: "storm", at: "@" + x.h, why: `${x.c} commits in a day`, t: "12:00" });
  return out;
}
const firstName = (n: string, h: string) => { const s = String(n || "").replace(/^@/, "").trim().split(/\s+/)[0] || h; return s.slice(0, 20); };
export function manifest(d: number, derived: Drop[]): Manifest {
  return { day: dayKey(d), season: SEASONS[new Date(d * DAY).getUTCMonth()]!, drops: [...derived, ...curatedDrops(d)] };
}
/** "Today in your city": a line per thing happening at the viewer's plot today, then the world's drops */
export function todayLines(h: string, mv: MemberView | null, m: Manifest): string[] {
  const at = "@" + h, out: string[] = [];
  for (const d of m.drops) if (d.at === at) out.push(d.kind === "parade" ? `a parade for your ${(/(\d+) commits/.exec(d.why || "") || [])[1] || ""} commits`.replace("your  commits", "your commits")
    : d.kind === "fireworks" ? "fireworks at dusk for your release" : d.kind === "welcome" ? "a welcome party on your plot" : d.kind === "storm" ? "a commit storm over your plot" : d.kind);
  if (mv) {
    if (mv.w.top) out.push(`${mv.w.top} building${mv.w.top === 1 ? "" : "s"} topped out`);
    else if (mv.w.z) out.push(`${mv.w.z} lot${mv.w.z === 1 ? "" : "s"} broke ground`);
    else if (mv.st.hc >= 1) out.push("crews are waiting for your next commit");
  }
  const fest = m.drops.find(d => d.kind === "festival");
  if (fest && (!mv || mv.st.thr)) out.push(`${(fest.name || "a festival").toLowerCase()} at dusk`);
  const ship = m.drops.find(d => d.kind === "airship"); if (ship && out.length < 3) out.push("an airship passes at noon");
  return out.slice(0, 4);
}

// ---------------------------------------------------------------- storage
type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export function growthStore(q: Q) {
  q(`CREATE TABLE IF NOT EXISTS growth_events (id TEXT PRIMARY KEY, profile TEXT, kind TEXT, repo TEXT, ts INTEGER, seen INTEGER, n REAL, void TEXT, x TEXT)`).run();
  q(`CREATE INDEX IF NOT EXISTS growth_events_p ON growth_events (profile, seen)`).run();
  q(`CREATE TABLE IF NOT EXISTS growth_seed (profile TEXT PRIMARY KEY, day INTEGER, side INTEGER, lots TEXT, src TEXT)`).run();
  q(`CREATE TABLE IF NOT EXISTS growth_snap (profile TEXT, day INTEGER, side INTEGER, lots TEXT, stats TEXT, log TEXT, PRIMARY KEY (profile, day))`).run();
  q(`CREATE TABLE IF NOT EXISTS growth_poll (profile TEXT PRIMARY KEY, login TEXT, etag TEXT, ev_last INTEGER, pr_last INTEGER, nightly TEXT, backfilled INTEGER, priv TEXT, repos TEXT, at INTEGER)`).run();
  q(`CREATE TABLE IF NOT EXISTS growth_ai (profile TEXT PRIMARY KEY, repos TEXT, at INTEGER)`).run();
  q(`CREATE TABLE IF NOT EXISTS growth_drops (day TEXT PRIMARY KEY, json TEXT, at INTEGER)`).run();
  const add = (e: GEvent): boolean => {
    const r = q("INSERT OR IGNORE INTO growth_events VALUES (?,?,?,?,?,?,?,?,?)").run(e.id, e.p, e.k, e.repo.slice(0, 140), Math.round(e.ts), Math.round(e.seen), e.n, e.v || "", e.x ? JSON.stringify(e.x) : null);
    return Number(r?.changes || 0) > 0;
  };
  return {
    add,
    has: (id: string) => !!q("SELECT 1 FROM growth_events WHERE id=?").get(id),
    count: (p: string): number => (q("SELECT COUNT(*) n FROM growth_events WHERE profile=?").get(p) as any)?.n || 0,
    events: (since = 0): GEvent[] => (q("SELECT * FROM growth_events WHERE seen >= ?").all(since) as any[]).map(r => ({ id: r.id, p: r.profile, k: r.kind, repo: r.repo || "", ts: r.ts, seen: r.seen, n: r.n, v: r.void || "", ...(r.x ? { x: JSON.parse(r.x) } : {}) })),
    seeds: (): Seed[] => (q("SELECT * FROM growth_seed").all() as any[]).map(r => ({ p: r.profile, day: r.day, side: r.side, lots: r.lots })),
    seed: (s: Seed, src: string) => q("INSERT OR IGNORE INTO growth_seed VALUES (?,?,?,?,?)").run(s.p, s.day, s.side, s.lots, src),
    poll: (id: string) => q("SELECT * FROM growth_poll WHERE profile=?").get(id) as any,
    savePoll: (id: string, v: Record<string, unknown>) => {
      const cur = q("SELECT * FROM growth_poll WHERE profile=?").get(id) as any || { profile: id };
      const n = { ...cur, ...v };
      q("INSERT OR REPLACE INTO growth_poll VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, n.login ?? null, n.etag ?? null, n.ev_last ?? null, n.pr_last ?? null, n.nightly ?? null, n.backfilled ?? 0, n.priv ?? null, n.repos ?? null, n.at ?? null);
    },
    ai: (): Map<string, Map<string, number>> => { const m = new Map<string, Map<string, number>>(); for (const r of q("SELECT * FROM growth_ai").all() as any[]) { try { m.set(r.profile, new Map(Object.entries(JSON.parse(r.repos)).map(([k, v]: [string, any]) => [k, Number(v?.[0]) || 0]))); } catch { /* skip */ } } return m; },
    aiWhy: (): Map<string, Record<string, [number, string[]]>> => { const m = new Map(); for (const r of q("SELECT * FROM growth_ai").all() as any[]) { try { m.set(r.profile, JSON.parse(r.repos)); } catch { /* skip */ } } return m; },
    saveAi: (id: string, repos: Record<string, [number, string[]]>) => q("INSERT OR REPLACE INTO growth_ai VALUES (?,?,?)").run(id, JSON.stringify(repos), Date.now()),
    floor: (): Map<string, number> => new Map((q("SELECT profile, MAX(side) s FROM growth_snap GROUP BY profile").all() as any[]).map(r => [r.profile, r.s] as [string, number])),
    saveSnaps: (p: string, sim: SimOut, fromDay: number) => {
      const logs = new Map<number, Buy[]>(); for (const b of sim.log) { const d = dayOf(b[0]); if (d < fromDay) continue; if (!logs.has(d)) logs.set(d, []); logs.get(d)!.push(b); }
      const stats = new Map(sim.stats.map(s => [s.d, s] as [number, DayStat]));
      for (const [d, s] of sim.snaps) if (d >= fromDay) q("INSERT OR REPLACE INTO growth_snap VALUES (?,?,?,?,?,?)").run(p, d, s.side, s.lots, JSON.stringify({ ...stats.get(d), bank: s.bank, streak: s.streak, tier: s.tier, idle: s.idle }), JSON.stringify(logs.get(d) || []));
    },
    prune: (beforeDay: number) => { q("DELETE FROM growth_snap WHERE day < ?").run(beforeDay); q("DELETE FROM growth_events WHERE seen < ? AND kind IN ('post','comment','note','agent','private')").run(beforeDay * DAY); },
    drops: (day: string): Manifest | null => { const r = q("SELECT json FROM growth_drops WHERE day=?").get(day) as any; try { return r ? JSON.parse(r.json) : null; } catch { return null; } },
    saveDrops: (m: Manifest) => q("INSERT OR REPLACE INTO growth_drops VALUES (?,?,?)").run(m.day, JSON.stringify(m), Date.now()),
    erase: (id: string) => { for (const t of ["growth_events", "growth_seed", "growth_snap", "growth_poll", "growth_ai"]) q(`DELETE FROM ${t} WHERE profile=?`).run(id); },
  };
}
export type GrowthStore = ReturnType<typeof growthStore>;

// ---------------------------------------------------------------- the GitHub poller (hourly per member; the webhook is a bonus)
export interface PollCtx {
  S: GrowthStore; fetch: typeof fetch; token: (profileId: string) => Promise<string | null>; pause?: number; now?: () => number;
}
interface RepoMeta { full: string; fork: boolean; created: number; pushed: number; stars: number; archived: boolean; topics: string[] }
export function githubPoller(c: PollCtx) {
  const sleep = (ms: number) => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
  const now = () => (c.now ? c.now() : Date.now());
  async function gh(token: string | null, p: string, o: { accept?: string; etag?: string } = {}): Promise<{ status: number; body: any; etag: string }> {
    const r = await c.fetch("https://api.github.com" + p, { headers: { accept: o.accept || "application/vnd.github+json", "user-agent": "caldera-hub", ...(token ? { authorization: "Bearer " + token } : {}), ...(o.etag ? { "if-none-match": o.etag } : {}) }, signal: AbortSignal.timeout(15000) });
    if (r.status === 403 || r.status === 429) { const rem = r.headers.get("x-ratelimit-remaining"); if (r.status === 429 || rem === "0") throw Object.assign(new Error("rate limited"), { stop: true }); }
    let body: any = null; if (r.status !== 304) { try { body = await r.json(); } catch { /* empty */ } }
    return { status: r.status, body, etag: r.headers.get("etag") || "" };
  }
  const wait = () => sleep(c.pause ?? 250);
  async function repos(login: string, token: string | null): Promise<RepoMeta[]> {
    const r = await gh(token, `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.body)) return [];
    return r.body.filter((x: any) => !x.private).map((x: any) => ({ full: String(x.full_name), fork: !!x.fork, created: Date.parse(x.created_at) || 0, pushed: Date.parse(x.pushed_at) || 0, stars: Number(x.stargazers_count) || 0, archived: !!x.archived, topics: Array.isArray(x.topics) ? x.topics.slice(0, 20) : [] }));
  }
  /** commits by the member on one repo since a time; live polls check each new commit's line count (the backfill reads trees) */
  async function commits(p: string, login: string, token: string | null, repo: string, meta: RepoMeta | undefined, since: number, backfill: boolean, budget: { stats: number }) {
    let added = 0, head: string | null = null;
    for (let page = 1; page <= (backfill ? 4 : 1); page++) {
      const r = await gh(token, `/repos/${repo}/commits?author=${encodeURIComponent(login)}&since=${new Date(since).toISOString()}&per_page=100&page=${page}`); await wait();
      if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) break;
      const trees = new Map<string, string>(); for (const x of r.body as GhCommit[]) if (x.sha && x.commit?.tree?.sha) trees.set(x.sha, x.commit.tree.sha);
      for (const x of r.body as GhCommit[]) {
        if (!x?.sha) continue; head = head || x.sha;
        const id = "c:" + x.sha; if (c.S.has(id)) continue;
        let j = judgeCommit(x, login, { fork: meta?.fork, created: meta?.created }, trees);
        if (!j.v && !backfill && budget.stats > 0 && !trees.has(x.parents?.[0]?.sha || "")) {   // is it empty? one call, at most 40 a member a poll
          budget.stats--; const d = await gh(token, `/repos/${repo}/commits/${x.sha}`); await wait();
          if (d.status === 200 && d.body) { const j2 = judgeCommit({ ...x, stats: d.body.stats, files: d.body.files }, login, { fork: meta?.fork, created: meta?.created }, trees); if (j2.v) j = j2; }
        }
        const ts = Date.parse(x.commit?.committer?.date || x.commit?.author?.date || "") || now();
        if (c.S.add({ id, p, k: "commit", repo: repo.toLowerCase(), ts: Math.min(ts, now()), seen: backfill ? Math.min(ts, now()) : now(), n: 1, v: j.v, ...(j.reverts ? { x: { rv: j.reverts } } : {}) })) added++;
      }
      if (r.body.length < 100) break;
    }
    return { added, head };
  }
  async function ci(p: string, token: string | null, repo: string, sha: string) {
    const r = await gh(token, `/repos/${repo}/commits/${sha}/check-runs?per_page=30`); await wait();
    const runs = r.status === 200 && Array.isArray(r.body?.check_runs) ? r.body.check_runs : [];
    if (!runs.length) return;
    const done = runs.filter((x: any) => x.status === "completed");
    if (done.some((x: any) => x.conclusion === "failure" || x.conclusion === "timed_out")) {
      const t = Math.max(...done.map((x: any) => Date.parse(x.completed_at) || 0));
      c.S.add({ id: `cir:${repo.toLowerCase()}:${sha}`, p, k: "ci_red", repo: repo.toLowerCase(), ts: t || now(), seen: now(), n: 1, v: "" });
    } else if (done.length === runs.length && done.some((x: any) => x.conclusion === "success")) {
      c.S.add({ id: `ci:${repo.toLowerCase()}:${dayKey(dayOf(now()))}`, p, k: "ci_green", repo: repo.toLowerCase(), ts: now(), seen: now(), n: 1, v: "" });
    }
  }
  async function prs(p: string, login: string, token: string | null, since: number, backfill: boolean) {
    const r = await gh(token, `/search/issues?q=${encodeURIComponent(`author:${login} type:pr is:merged merged:>=${new Date(since).toISOString().slice(0, 10)}`)}&per_page=${backfill ? 60 : 30}&sort=updated`); await sleep(c.pause ?? 2200);
    const items = r.status === 200 && Array.isArray(r.body?.items) ? r.body.items : [];
    let details = backfill ? 40 : 15;
    for (const it of items) {
      const id = "pr:" + it.id; if (c.S.has(id)) continue;
      const m = /repos\/([^/]+\/[^/]+)$/.exec(String(it.repository_url || "")); if (!m) continue;
      const merged = Date.parse(it.pull_request?.merged_at || it.closed_at || "") || now();
      let self: 0 | 1 = 1;
      if (details-- > 0) {
        const d = await gh(token, `/repos/${m[1]}/pulls/${it.number}`); await wait();
        const by = d.body?.merged_by?.login || null;
        let ciPassed = false;
        if (prPoints({ author: login, mergedBy: by }) !== RULES.pts.pr && d.body?.merge_commit_sha) {
          const cr = await gh(token, `/repos/${m[1]}/commits/${d.body.merge_commit_sha}/check-runs?per_page=10`); await wait();
          const runs = Array.isArray(cr.body?.check_runs) ? cr.body.check_runs : [];
          ciPassed = runs.length > 0 && runs.every((x: any) => x.status === "completed" && ["success", "skipped", "neutral"].includes(x.conclusion)) && runs.some((x: any) => x.conclusion === "success");
        }
        self = prPoints({ author: login, mergedBy: by, ciPassed }) === RULES.pts.pr ? 0 : 1;
      }
      c.S.add({ id, p, k: "pr", repo: m[1].toLowerCase(), ts: merged, seen: backfill ? merged : now(), n: 1, v: "", x: { self } });
    }
  }
  async function releases(p: string, token: string | null, repo: string, since: number) {
    const r = await gh(token, `/repos/${repo}/releases?per_page=20`); await wait();
    for (const x of r.status === 200 && Array.isArray(r.body) ? r.body : []) {
      const t = Date.parse(x.published_at || ""); if (!Number.isFinite(t) || t < since || x.draft) continue;
      c.S.add({ id: `rel:${repo.toLowerCase()}:${x.id}`, p, k: "release", repo: repo.toLowerCase(), ts: t, seen: t, n: 1, v: x.prerelease ? "prerelease" : "" });
    }
  }
  async function stars(p: string, token: string | null, list: RepoMeta[], since: number, backfill: boolean) {
    let checks = 20;
    for (const r of list.filter(x => !x.fork && x.stars > 0).sort((a, b) => b.stars - a.stars).slice(0, 5)) {
      const page = Math.max(1, Math.ceil(r.stars / 100));
      const s = await gh(token, `/repos/${r.full}/stargazers?per_page=100&page=${page}`, { accept: "application/vnd.github.star+json" }); await wait();
      if (s.status !== 200 || !Array.isArray(s.body)) continue;
      for (const x of s.body.slice().reverse()) {
        const t = Date.parse(x.starred_at || ""); if (!Number.isFinite(t) || t < since) continue;
        const who = String(x.user?.login || ""), id = `s:${r.full.toLowerCase()}:${who.toLowerCase()}`; if (!who || c.S.has(id)) continue;
        let v = BOT.test(who) ? "bot" : "";
        if (!v) { if (checks-- <= 0) break; const u = await gh(token, `/users/${encodeURIComponent(who)}`); await wait(); if (u.status === 200 && youngAccount(u.body?.created_at, t)) v = "young"; }
        c.S.add({ id, p, k: "star", repo: r.full.toLowerCase(), ts: t, seen: backfill ? t : now(), n: 1, v });
      }
    }
  }
  async function newContributors(p: string, login: string, token: string | null, list: RepoMeta[], since: number) {
    for (const r of list.filter(x => !x.fork && now() - x.pushed < 7 * DAY).slice(0, 5)) {
      const s = await gh(token, `/repos/${r.full}/pulls?state=closed&sort=updated&direction=desc&per_page=30`); await wait();
      for (const pr of s.status === 200 && Array.isArray(s.body) ? s.body : []) {
        const who = String(pr.user?.login || ""), t = Date.parse(pr.merged_at || "");
        if (!Number.isFinite(t) || t < since || !who || who.toLowerCase() === login.toLowerCase() || BOT.test(who)) continue;
        const id = `nc:${r.full.toLowerCase()}:${who.toLowerCase()}`; if (c.S.has(id)) continue;
        const q2 = await gh(token, `/search/issues?q=${encodeURIComponent(`repo:${r.full} author:${who} type:pr is:merged`)}&per_page=1`); await sleep(c.pause ?? 2200);
        if (q2.status === 200 && Number(q2.body?.total_count) === 1) c.S.add({ id, p, k: "newcontrib", repo: r.full.toLowerCase(), ts: t, seen: now(), n: 1, v: "" });
      }
    }
  }
  /** One member: the first poll backfills 90 days; later polls read the public events feed (cheap with an ETag) and only
   *  fetch what changed; once a day stars, new contributors and the repo list. */
  async function poll(m: { id: string; login: string }, o: { backfill?: boolean } = {}): Promise<{ added: number }> {
    const token = await c.token(m.id).catch(() => null), at = now(), cur = c.S.poll(m.id) || {};
    const backfill = o.backfill || !cur.backfilled || (cur.login && cur.login.toLowerCase() !== m.login.toLowerCase());
    const before = c.S.count(m.id);
    const today = dayKey(dayOf(at)), nightly = backfill || cur.nightly !== today;
    let list: RepoMeta[] = []; try { list = JSON.parse(cur.repos || "[]"); } catch { list = []; }
    if (nightly || !list.length) { list = await repos(m.login, token); await wait(); }
    const meta = new Map(list.map(r => [r.full.toLowerCase(), r] as [string, RepoMeta]));
    const budget = { stats: 40 };
    let etag = cur.etag || "", evLast = Number(cur.ev_last) || 0;
    if (backfill) {
      const since = at - 90 * DAY;
      for (const r of list.filter(x => x.pushed >= since).slice(0, 15)) { await commits(m.id, m.login, token, r.full, r, since, true, budget); await releases(m.id, token, r.full, since); }
      await prs(m.id, m.login, token, since, true);
      await stars(m.id, token, list, at - 30 * DAY, true);
      evLast = at;
    } else {
      const ev = await gh(token, `/users/${encodeURIComponent(m.login)}/events/public?per_page=100`, { etag }); await wait();
      const dirty = new Set<string>(); let prCheck = false;
      if (ev.status === 200 && Array.isArray(ev.body)) {
        etag = ev.etag || etag;
        let newest = evLast;
        for (const e of ev.body) {
          const t = Date.parse(e.created_at || ""); if (!Number.isFinite(t) || t <= evLast) continue; newest = Math.max(newest, t);
          const repo = String(e.repo?.name || "");
          if (e.type === "PushEvent" && repo) dirty.add(repo);
          else if (e.type === "PullRequestEvent") prCheck = true;
          else if (e.type === "ReleaseEvent" && e.payload?.action === "published" && repo) c.S.add({ id: `rel:${repo.toLowerCase()}:${e.payload?.release?.id || e.id}`, p: m.id, k: "release", repo: repo.toLowerCase(), ts: t, seen: at, n: 1, v: e.payload?.release?.prerelease ? "prerelease" : "" });
          else if (e.type === "CreateEvent" && e.payload?.ref_type === "repository" && repo) c.S.add({ id: `nr:${repo.toLowerCase()}`, p: m.id, k: "newrepo", repo: repo.toLowerCase(), ts: t, seen: at, n: 1, v: "" });
          else if (e.type === "IssuesEvent" && e.payload?.action === "closed" && repo && !e.payload?.issue?.pull_request && (e.payload?.issue?.state_reason || "completed") === "completed") c.S.add({ id: `is:${repo.toLowerCase()}:${e.payload?.issue?.number}`, p: m.id, k: "issue", repo: repo.toLowerCase(), ts: t, seen: at, n: 1, v: "" });
        }
        evLast = newest;
      }
      const since = Math.max((Number(cur.ev_last) || at) - 6 * 3600_000, at - 3 * DAY);
      for (const repo of [...dirty].slice(0, 10)) {
        const r = await commits(m.id, m.login, token, repo, meta.get(repo.toLowerCase()), since, false, budget);
        if (r.added && r.head) await ci(m.id, token, repo, r.head);
      }
      if (prCheck || nightly) await prs(m.id, m.login, token, at - 3 * DAY, false);
      if (nightly) { await stars(m.id, token, list, at - 3 * DAY, false); await newContributors(m.id, m.login, token, list, at - 3 * DAY); }
    }
    c.S.savePoll(m.id, { login: m.login, etag, ev_last: evLast, nightly: nightly ? today : cur.nightly, backfilled: 1, repos: JSON.stringify(list.slice(0, 100)), at });
    return { added: c.S.count(m.id) - before };
  }
  return { poll, repos };
}

/** The GitHub App webhook, when configured (data/github-webhook.json {secret}): the same events, as they happen. */
export function webhookEvents(kind: string, body: any, profileOfLogin: (login: string) => string | null, at: number): GEvent[] {
  const out: GEvent[] = [], repo = String(body?.repository?.full_name || "").toLowerCase();
  if (!repo || body?.repository?.private) return out;
  if (kind === "push" && Array.isArray(body.commits)) {
    for (const c of body.commits.slice(0, 100)) {
      const login = String(c.author?.username || ""), p = login ? profileOfLogin(login) : null; if (!p || !c.id) continue;
      const msg = String(c.message || ""), rv = /^Revert ".*"/.test(msg) ? /This reverts commit ([0-9a-f]{7,40})/.exec(msg) : null;
      const changed = (c.added?.length || 0) + (c.removed?.length || 0) + (c.modified?.length || 0);
      const v = BOT.test(login) ? "bot" : rv ? "revert" : !c.distinct ? "dup" : changed === 0 ? "empty" : body.repository?.fork && Date.parse(c.timestamp) < Date.parse(body.repository?.created_at) ? "fork" : "";
      out.push({ id: "c:" + c.id, p, k: "commit", repo, ts: Math.min(Date.parse(c.timestamp) || at, at), seen: at, n: 1, v, ...(rv ? { x: { rv: rv[1] } } : {}) });
    }
  } else if (kind === "pull_request" && body.action === "closed" && body.pull_request?.merged) {
    const pr = body.pull_request, login = String(pr.user?.login || ""), p = profileOfLogin(login);
    if (p && !BOT.test(login)) out.push({ id: "pr:" + pr.id, p, k: "pr", repo, ts: Date.parse(pr.merged_at) || at, seen: at, n: 1, v: "", x: { self: prPoints({ author: login, mergedBy: pr.merged_by?.login }) === RULES.pts.pr ? 0 : 1 } });
  } else if (kind === "release" && body.action === "published") {
    const p = profileOfLogin(String(body.sender?.login || "")); if (p) out.push({ id: `rel:${repo}:${body.release?.id}`, p, k: "release", repo, ts: Date.parse(body.release?.published_at) || at, seen: at, n: 1, v: body.release?.prerelease ? "prerelease" : "" });
  } else if (kind === "check_suite" && body.action === "completed") {
    const p = profileOfLogin(String(body.repository?.owner?.login || "")), cs = body.check_suite;
    if (p && cs) { const red = cs.conclusion === "failure" || cs.conclusion === "timed_out"; out.push(red ? { id: `cir:${repo}:${cs.head_sha}`, p, k: "ci_red", repo, ts: Date.parse(cs.updated_at) || at, seen: at, n: 1, v: "" } : cs.conclusion === "success" ? { id: `ci:${repo}:${dayKey(dayOf(at))}`, p, k: "ci_green", repo, ts: at, seen: at, n: 1, v: "" } : null as any); }
  } else if (kind === "star" && body.action === "created") {
    const p = profileOfLogin(String(body.repository?.owner?.login || "")), who = String(body.sender?.login || "");
    if (p && who) out.push({ id: `s:${repo}:${who.toLowerCase()}`, p, k: "star", repo, ts: Date.parse(body.starred_at) || at, seen: at, n: 1, v: BOT.test(who) ? "bot" : body.sender?.created_at && youngAccount(body.sender.created_at, at) ? "young" : "" });
  } else if (kind === "issues" && body.action === "closed" && (body.issue?.state_reason || "completed") === "completed") {
    const p = profileOfLogin(String(body.sender?.login || "")); if (p) out.push({ id: `is:${repo}:${body.issue?.number}`, p, k: "issue", repo, ts: at, seen: at, n: 1, v: "" });
  }
  return out.filter(Boolean);
}
