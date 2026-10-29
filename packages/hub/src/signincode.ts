/**
 * "Email me a code" sign-in (sign-in standard, Mike 2026-10-29: growth/LOGIN_STANDARD.md in product-strategy).
 * One email carries a 6-digit code and a link; both work for 15 minutes, once, and using either one kills both.
 * Five wrong codes kill the code (the link still works: it needs the inbox anyway). The code is how someone who reads
 * email on their phone signs in on their laptop. Codes are stored hashed with their link, never in the clear.
 */
import crypto from "node:crypto";

export const CODE_TTL = 15 * 60_000;
const MAX_TRIES = 5;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
/** digits only, so "123 456" and "123-456" both work */
export const normDigits = (c: unknown) => String(c || "").replace(/\D/g, "").slice(0, 6);

export function signinCodes(q: (sql: string) => any, hashOf: (email: string) => string) {
  q("CREATE TABLE IF NOT EXISTS signin_codes (link_hash TEXT PRIMARY KEY, email_hash TEXT, code_hash TEXT, tries INTEGER DEFAULT 0)").run();
  q("CREATE INDEX IF NOT EXISTS idx_signin_codes_email ON signin_codes(email_hash)").run();
  const codeHash = (linkHash: string, code: string) => sha(linkHash + ":" + code);

  /** a new link token + code for this owner, sent to `email` (the caller checked the address belongs to the owner) */
  function issue(owner: string, email: string): { token: string; code: string } {
    const token = crypto.randomBytes(24).toString("base64url"), code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"), lh = sha(token);
    q("DELETE FROM signin_links WHERE expires < ?").run(Date.now());
    q("DELETE FROM signin_codes WHERE link_hash NOT IN (SELECT code_hash FROM signin_links)").run();
    q("INSERT INTO signin_links VALUES (?,?,?)").run(lh, owner, Date.now() + CODE_TTL);
    q("INSERT INTO signin_codes VALUES (?,?,?,0)").run(lh, hashOf(email), codeHash(lh, code));
    return { token, code };
  }
  /** the owner a right code signs in (link and code both used up), "bad" for a wrong one, "none" when nothing is waiting */
  function useCode(email: string, raw: unknown): string | "bad" | "none" {
    const code = normDigits(raw), eh = hashOf(email);
    const rows = q("SELECT c.link_hash, c.code_hash, l.owner FROM signin_codes c JOIN signin_links l ON l.code_hash=c.link_hash WHERE c.email_hash=? AND l.expires > ? AND c.tries < ?").all(eh, Date.now(), MAX_TRIES) as any[];
    if (!rows.length) return "none";
    const hit = code.length === 6 ? rows.find(r => crypto.timingSafeEqual(Buffer.from(r.code_hash), Buffer.from(codeHash(r.link_hash, code)))) : null;
    if (!hit) {
      q("UPDATE signin_codes SET tries=tries+1 WHERE email_hash=?").run(eh);
      q("DELETE FROM signin_codes WHERE tries >= ?").run(MAX_TRIES);
      return "bad";
    }
    q("DELETE FROM signin_links WHERE code_hash=?").run(hit.link_hash); q("DELETE FROM signin_codes WHERE link_hash=?").run(hit.link_hash);
    return hit.owner;
  }
  /** the link was used: its code dies with it */
  const linkUsed = (linkHash: string) => { q("DELETE FROM signin_codes WHERE link_hash=?").run(linkHash); };
  return { issue, useCode, linkUsed };
}

/** the code email: code in the subject (shows on a lock screen), big code first, then the link */
export function codeMail(product: string, code: string, link: string, who = "") {
  const pretty = code.slice(0, 3) + " " + code.slice(3);
  const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return {
    subject: `Your ${product} code: ${code}`, title: `Your ${product} code`,
    html: `<p>${who ? `Sign in as <b>${esc(who)}</b>. ` : ""}Enter this code on the sign-in page:</p><p style="font-size:34px;font-weight:700;letter-spacing:.12em;margin:14px 0;font-family:'IBM Plex Mono',ui-monospace,monospace">${pretty}</p><p>Or tap to sign in:</p><p><a href="${esc(link)}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#6E4FE0;color:#fff;text-decoration:none;font-weight:600">Sign in</a></p><p style="color:#8A8794;font-size:13px">The code and the link work once, for 15 minutes. If this wasn't you, ignore this email: nothing changes until one is used.</p>`,
    text: `Your ${product} code: ${pretty}\n\nOr tap to sign in: ${link}\n\nThe code and the link work once, for 15 minutes. If this wasn't you, ignore this email.`,
  };
}
