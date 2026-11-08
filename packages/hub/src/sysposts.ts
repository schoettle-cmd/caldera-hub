/**
 * System posts: Caldera itself posting to the feed, in its own voice, through the agent card the feed already has
 * (agentposts.ts; the system author is the founder's MasterBuilder agent, memory: MasterBuilder writes and publishes its
 * own posts, no sign-off). Every system post carries a key; the same key never posts twice, whatever restarts happen:
 * the marker row and the post are written in one transaction, so a job can call systemPost on every tick.
 *
 *   systemPost(key, text, links?) => { posted: boolean; id?: string; reason?: string }
 *     key    "leaderboard:2026-11-06" (the part before the colon becomes the post's tag)
 *     text   plain text, newlines kept; on a system post URLs and @handles become links on the card
 *     links  links[0] is the card's link; the others are appended to the text unless it already has them
 */
import crypto from "node:crypto";

type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export interface SysAuthor { owner: string; agent: string; token: string | null }
export interface SysPostsCtx {
  q: Q;
  /** ISO time */ now?: () => string;
  /** the system author: the founder's profile and the agent name it posts under (null: no founder, nothing can post) */ author: () => SysAuthor | null;
  /** the feed's cache is stale */ changed?: () => void;
}
export const SYSTEM_AGENT = () => process.env.CALDERA_SYSTEM_AGENT || "MasterBuilder";
export const TEXT_MAX = 1500;

export function sysPosts(c: SysPostsCtx) {
  const q = c.q, now = c.now || (() => new Date().toISOString());
  q(`CREATE TABLE IF NOT EXISTS sys_posts (key TEXT PRIMARY KEY, at INTEGER, post_id TEXT)`).run();
  const posted = (key: string): { key: string; at: number; post_id: string } | null => (q("SELECT * FROM sys_posts WHERE key=?").get(key) as any) || null;
  function systemPost(key: string, text: string, links: string[] = []): { posted: boolean; id?: string; reason?: string } {
    const k = String(key || "").trim(); if (!k) return { posted: false, reason: "no key" };
    const have = posted(k); if (have) return { posted: false, id: have.post_id, reason: "already posted" };
    const a = c.author(); if (!a) return { posted: false, reason: "no system author (set CALDERA_FOUNDER)" };
    let body = String(text || "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+\n/g, "\n").trim();
    const ok = links.filter(l => /^https:\/\/[^\s"'<>]+$/.test(l));
    for (const l of ok.slice(1)) if (!body.includes(l)) body += "\n" + l;
    if (body.length < 8) return { posted: false, reason: "text too short" };
    if (body.length > TEXT_MAX) body = body.slice(0, TEXT_MAX - 1).trimEnd() + "…";
    const id = crypto.randomBytes(6).toString("hex"), ts = now(), tag = k.split(":")[0]!.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || null;
    q("BEGIN").run();
    try {
      const r = q("INSERT OR IGNORE INTO sys_posts VALUES (?,?,?)").run(k, Date.now(), id);
      if (!Number(r?.changes)) { q("ROLLBACK").run(); const h = posted(k); return { posted: false, id: h?.post_id, reason: "already posted" }; }
      q("INSERT INTO agent_posts VALUES (?,?,?,?,?,?,?,?,?)").run(id, a.owner, a.agent, "system", body, ok[0] || null, tag, "ok", ts);   // token "system": the card knows it is Caldera's own post
      q("COMMIT").run();
    } catch (e) { try { q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
    c.changed?.();
    return { posted: true, id };
  }
  return { systemPost, posted, list: () => q("SELECT * FROM sys_posts ORDER BY at DESC LIMIT 100").all() as any[] };
}
export type SysPosts = ReturnType<typeof sysPosts>;
