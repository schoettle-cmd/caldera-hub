/**
 * The weekly "What's new" feature email (Growth Engine spec 2026-11-20, notes/specs/2026-11-20-feature-weekly-senders.md).
 *
 * Growth Engine writes, checks and renders each edition; this file only sends it. The edition is three files in
 * CALDERA_FEATURE_MAIL_DIR (default /opt/caldera-hub/data/feature_mail; a root cron copies them there):
 *   caldera.json  { edition, send_from, expires, subject, ... }
 *   caldera.html  the finished HTML
 *   caldera.txt   "Subject: ..." on the first line, a blank line, then the text body
 * Only two per-person slots are filled: %%UNSUB_URL%% and %%WHY_LINE%%. Nothing else in the subject, copy or HTML changes
 * (links are not tagged here either: they already carry their utm).
 *
 * Who: confirmed daily-summary subscribers and email-page accounts without nudge_off, one copy per address, minus the
 * suppression list (bounces, complaints, unsubscribes), the "product news" opt-out, and own and test addresses.
 * Every send goes through the shared mail guard as kind "marketing" (a "no" or no answer = skip this run).
 * (address, edition) is recorded before the send, so a rerun never sends an edition twice. Logs counts only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import type { Mail } from "./email";
import { isOwnAddress, isTestAddress } from "./own";

export const FEATURE_SRC = "feature_weekly";
export const WHY_LINE = "You get this because you have a Caldera account. It comes once a week, only when something new shipped.";
const DEFAULT_DIR = "/opt/caldera-hub/data/feature_mail";
const PRODUCT = "caldera";
/** test sign-ups the email-page tools already leave out (emailpages.ts stuckClaim) */
const TEST_RE = /@(example\.|test\.)|\+caldtest/;

export interface Edition { edition: string; sendFrom: number; expires: number; subject: string; html: string; text: string }
export interface FeatureCtx {
  q: (sql: string) => any; unseal: (s: string) => string; hub: string;
  /** the emailer's address hash (the suppression list's key) */
  hashOf: (email: string) => string;
  /** the emailer's send (mail guard + Resend pacing); false = the guard said no */
  send: (m: Mail) => Promise<unknown>;
  page: (title: string, body: string) => string;
  dir?: () => string; now?: () => number; env?: Record<string, string | undefined>;
}
export interface FeatureCounts { edition: string | null; inWindow: boolean; eligible: number; sent: number; failed: number; skipped: Record<string, number>; busy?: boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Read and check the edition; anything missing or invalid = null (send nothing). */
export function loadEdition(dir: string): Edition | null {
  try {
    let base = dir;
    if (!fs.existsSync(path.join(base, `${PRODUCT}.json`)) && fs.existsSync(path.join(dir, "editions", `${PRODUCT}.json`))) base = path.join(dir, "editions");
    const j = JSON.parse(fs.readFileSync(path.join(base, `${PRODUCT}.json`), "utf8"));
    const html = fs.readFileSync(path.join(base, `${PRODUCT}.html`), "utf8"), txt = fs.readFileSync(path.join(base, `${PRODUCT}.txt`), "utf8").replace(/\r\n/g, "\n");
    const m = /^Subject:[ \t]*(.*)\n\n?([\s\S]*)$/.exec(txt);
    const edition = typeof j.edition === "string" ? j.edition.trim() : "", sendFrom = Date.parse(j.send_from), expires = Date.parse(j.expires);
    const subject = (typeof j.subject === "string" && j.subject.trim()) || (m ? m[1].trim() : "");
    if (!m || !edition || !/^[\w.:-]{1,64}$/.test(edition) || !isFinite(sendFrom) || !isFinite(expires) || expires <= sendFrom || !subject || !html.trim() || !m[2].trim()) return null;
    return { edition, sendFrom, expires, subject, html, text: m[2] };
  } catch { return null; }
}

/** Fill the two per-person slots, and nothing else. */
export function fillSlots(e: Pick<Edition, "html" | "text">, unsubUrl: string, why = WHY_LINE): { html: string; text: string } {
  return { html: e.html.split("%%UNSUB_URL%%").join(esc(unsubUrl)).split("%%WHY_LINE%%").join(esc(why)),
    text: e.text.split("%%UNSUB_URL%%").join(unsubUrl).split("%%WHY_LINE%%").join(why) };
}

export function featureMail(ctx: FeatureCtx) {
  const { q } = ctx, hub = ctx.hub.replace(/\/$/, ""), now = ctx.now || Date.now;
  // one row per address (keyed by the emailer's hash): its opaque opt-out token, and the opt-out once used
  q("CREATE TABLE IF NOT EXISTS feature_people (hash TEXT PRIMARY KEY, token TEXT UNIQUE, optout TEXT)").run();
  q("CREATE TABLE IF NOT EXISTS feature_sends (hash TEXT, edition TEXT, ts TEXT, PRIMARY KEY (hash, edition))").run();
  const dir = () => (ctx.dir ? ctx.dir() : process.env.CALDERA_FEATURE_MAIL_DIR) || DEFAULT_DIR;
  const tokenOf = (hash: string): string => {
    const r = q("SELECT token FROM feature_people WHERE hash=?").get(hash) as any; if (r?.token) return r.token;
    const t = crypto.randomBytes(18).toString("base64url");
    q("INSERT INTO feature_people (hash, token) VALUES (?,?) ON CONFLICT(hash) DO UPDATE SET token=COALESCE(token, excluded.token)").run(hash, t);
    return (q("SELECT token FROM feature_people WHERE hash=?").get(hash) as any).token;
  };
  const unsubUrl = (hash: string) => `${hub}/v1/email/news-off?t=${tokenOf(hash)}`;
  const optedOut = (hash: string) => !!q("SELECT 1 FROM feature_people WHERE hash=? AND optout IS NOT NULL").get(hash);
  /** one-click "no product news" (idempotent; an unknown token does nothing) */
  function optOut(token: string): boolean {
    if (!token) return false;
    return Number(q("UPDATE feature_people SET optout=COALESCE(optout, ?) WHERE token=?").run(new Date().toISOString(), token).changes) > 0;
  }

  /** Everyone with a Caldera account and an address, one entry per address, plus why the rest are left out. */
  function audience(edition: string | null) {
    const out: { hash: string; to: string; id: string }[] = [], skipped: Record<string, number> = {}, seen = new Set<string>(), env = ctx.env || process.env;
    const skip = (k: string) => { skipped[k] = (skipped[k] || 0) + 1; };
    const rows: { id: string; sealed: string }[] = [];
    try { for (const r of q("SELECT owner, email FROM email_subs WHERE confirmed=1 ORDER BY owner").all() as any[]) rows.push({ id: r.owner, sealed: r.email }); } catch { /* no table yet */ }
    try { for (const r of q("SELECT profile_id, email_sealed FROM email_accounts WHERE COALESCE(nudge_off,0)=0 AND email_sealed IS NOT NULL AND email_sealed<>'' ORDER BY profile_id").all() as any[]) rows.push({ id: r.profile_id, sealed: r.email_sealed }); } catch { /* no email pages */ }
    for (const r of rows) {
      let to = ""; try { to = ctx.unseal(r.sealed).trim().toLowerCase(); } catch { /* unreadable */ }
      if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { skip("no_address"); continue; }
      const hash = ctx.hashOf(to); if (seen.has(hash)) { skip("duplicate"); continue; } seen.add(hash);
      if (isOwnAddress(to, env)) { skip("own"); continue; }
      if (TEST_RE.test(to) || isTestAddress(to, env)) { skip("test"); continue; }
      if (q("SELECT 1 FROM email_suppress WHERE hash=?").get(hash)) { skip("suppressed"); continue; }
      if (optedOut(hash)) { skip("opted_out"); continue; }
      if (edition && q("SELECT 1 FROM feature_sends WHERE hash=? AND edition=?").get(hash, edition)) { skip("already_sent"); continue; }
      out.push({ hash, to, id: r.id });
    }
    return { people: out, skipped };
  }

  let busy = false;
  /** One pass. dryRun = the counts only (no send, nothing recorded). */
  async function run(o: { dryRun?: boolean } = {}): Promise<FeatureCounts> {
    const ed = loadEdition(dir()), t = now();
    const inWindow = !!ed && ed.sendFrom <= t && t < ed.expires;
    const res: FeatureCounts = { edition: ed?.edition || null, inWindow, eligible: 0, sent: 0, failed: 0, skipped: {} };
    if (o.dryRun) { const a = audience(ed?.edition || null); res.eligible = a.people.length; res.skipped = a.skipped; return res; }
    if (!ed || !inWindow) return res;
    if (busy) return { ...res, busy: true };
    busy = true;
    try {
      const a = audience(ed.edition); res.eligible = a.people.length; res.skipped = a.skipped;
      const skip = (k: string) => { res.skipped[k] = (res.skipped[k] || 0) + 1; };
      for (const p of a.people) {
        if (now() >= ed.expires) { skip("expired"); continue; }
        // recorded first: a crash mid-send never leads to a second copy; a "no" or a failure frees the row for the next run
        if (!Number(q("INSERT OR IGNORE INTO feature_sends VALUES (?,?,?)").run(p.hash, ed.edition, new Date(now()).toISOString()).changes)) { skip("already_sent"); continue; }
        const un = unsubUrl(p.hash), body = fillSlots(ed, un);
        try {
          const r = await ctx.send({ to: p.to, subject: ed.subject, html: body.html, text: body.text, src: FEATURE_SRC, kind: "marketing", raw: true, learnProgram: "caldera_feature_weekly",
            idempotencyKey: `${FEATURE_SRC}:${ed.edition}:${p.id}`,
            headers: { "List-Unsubscribe": `<${un}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
          if (r === false) { q("DELETE FROM feature_sends WHERE hash=? AND edition=?").run(p.hash, ed.edition); skip("guard"); continue; }
          res.sent++;
        } catch { q("DELETE FROM feature_sends WHERE hash=? AND edition=?").run(p.hash, ed.edition); res.failed++; }
      }
    } finally { busy = false; }
    if (res.sent || res.failed || res.skipped.guard || res.skipped.expired) console.log("[feature_weekly]", JSON.stringify(res));   // counts only, never addresses
    return res;
  }

  /** every 15 minutes (unref'd); sends only inside the edition's window */
  function schedule() {
    const tick = () => { run().catch(e => console.error("[feature_weekly]", e?.message)); };
    const t = setInterval(tick, 15 * 60_000); t.unref?.(); setTimeout(tick, 60_000).unref?.();
  }

  /** /v1/email/news-off?t=: GET shows a button (mail scanners prefetch links), POST opts out (also the RFC 8058 one-click POST) */
  function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL, p: string): boolean {
    if (p !== "/v1/email/news-off" || (req.method !== "GET" && req.method !== "POST")) return false;
    const t = (url.searchParams.get("t") || "").replace(/[^\w-]/g, "");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
    if (req.method === "GET") { res.end(ctx.page("Product news", `<form method="post" action="${p}?t=${t}"><p>Stop the weekly "What's new" email about new Caldera features.</p><button class="btn" type="submit">Stop product news</button></form>`)); return true; }
    optOut(t);
    res.end(ctx.page("Done", "<p>You won't get the weekly \"What's new\" email any more. Your other Caldera emails are not changed.</p>"));
    return true;
  }

  return { run, dryRun: () => run({ dryRun: true }), schedule, route, optOut, unsubUrl, audience };
}
