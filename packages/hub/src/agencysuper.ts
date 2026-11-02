/**
 * Agency Super tracking (campaign caldera-signups, tracking only, 0% payout; Mike 2026-11-02 via MasterBuilder).
 * Same pattern as Inbox Hero's lib/agencysuper.js. A creator's link lands with ?asc=<click_id>:
 *  - kept in a first-party cookie for 30 days (last click wins), and in localStorage by the shared header script, which
 *    puts the cookie back if it went missing; so it survives the Google, GitHub and email sign-up round trips
 *  - an email code request keeps the click with the address for 30 days (the code may be used on another device)
 *  - fixed on the profile when the account is created (never changed after), and Agency Super is told, signed:
 *    POST https://agencysuper.com/api/fp/conversion, event signup, customer_ref = sha256 of the profile id
 * Nothing personal is ever sent. Our own and test addresses go as test:true. Events queue in as_events and a sender
 * retries with backoff; txn_id makes every event idempotent. No secret (AGENCYSUPER_SECRET, or
 * /opt/secrets/agencysuper-caldera.secret): events wait in the queue, nothing is sent.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import type * as http from "node:http";

export const CAMPAIGN = "caldera-signups";
const URL_ = process.env.AGENCYSUPER_URL || "https://agencysuper.com/api/fp/conversion";
const SECRET_FILE = process.env.AGENCYSUPER_SECRET_FILE || "/opt/secrets/agencysuper-caldera.secret";
const COOKIE = "asc", DAYS = 30, DAY = 86_400_000;
const ASC_RE = /^[A-Za-z0-9_-]{6,80}$/;
const OWN = /^(schoettle|mjonesoneinsta)(\+[^@]*)?@gmail\.com$|@(science-inc|mjonesone|joininboxhero|caldera)\.(com|social)$|@example\.(com|org|net)$/i;
export const valid = (v: unknown): v is string => typeof v === "string" && ASC_RE.test(v);
const nowIso = () => new Date().toISOString();
export const refOf = (id: string) => crypto.createHash("sha256").update(String(id)).digest("hex");
const emailHash = (e: string) => crypto.createHash("sha256").update("as|" + String(e || "").trim().toLowerCase()).digest("hex");

/** the header script: remember ?asc= in localStorage, and put the cookie back from it when the cookie is gone */
export const ASC_JS = `<script data-asc>(function(){try{var D=2592e6,m=location.search.match(/[?&]asc=([A-Za-z0-9_-]{6,80})(?:&|$)/);if(m){localStorage.setItem('asc',JSON.stringify({v:m[1],t:Date.now()}));return}if(/(?:^|; )asc=/.test(document.cookie))return;var s=JSON.parse(localStorage.getItem('asc')||'null');if(s&&/^[A-Za-z0-9_-]{6,80}$/.test(s.v)&&Date.now()-s.t<D)document.cookie='asc='+s.v+'; path=/; max-age='+Math.floor((D-(Date.now()-s.t))/1000)+'; samesite=lax; secure'}catch(e){}})();</script>`;

function cookieOf(req: http.IncomingMessage): string | null {
  const m = /(?:^|;\s*)asc=([^;]+)/.exec(String(req.headers.cookie || "")); if (!m) return null;
  try { const v = decodeURIComponent(m[1]); return valid(v) ? v : null; } catch { return null; }
}
function appendCookie(res: http.ServerResponse, c: string) {
  const prev = res.getHeader("set-cookie");
  res.setHeader("set-cookie", prev ? ([] as string[]).concat(prev as any, c) : c);
}

type Fetch = (url: string, init: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export function agencySuper(c: { q: (sql: string) => any; emailOf: (owner: string) => string | null }) {
  const { q } = c;
  q(`CREATE TABLE IF NOT EXISTS as_clicks (profile_id TEXT PRIMARY KEY, asc TEXT NOT NULL, at TEXT NOT NULL)`).run();
  q(`CREATE TABLE IF NOT EXISTS as_pending (email_hash TEXT PRIMARY KEY, asc TEXT NOT NULL, at INTEGER NOT NULL)`).run();
  q(`CREATE TABLE IF NOT EXISTS as_events (txn_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, event TEXT NOT NULL, occurred_at TEXT NOT NULL,
    test INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', tries INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT)`).run();
  let secret: string | null = null, secretAt = 0;
  const key = () => {
    if (process.env.AGENCYSUPER_SECRET) return process.env.AGENCYSUPER_SECRET.trim();
    if (Date.now() - secretAt > 60_000) { secretAt = Date.now(); try { secret = fs.readFileSync(SECRET_FILE, "utf8").trim() || null; } catch { secret = null; } }
    return secret;
  };
  const BACKOFF = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3];
  let busy = false, kickT: NodeJS.Timeout | null = null;
  const kick = () => { if (kickT) clearTimeout(kickT); kickT = setTimeout(() => { api.send().catch(() => {}); }, 1500); kickT.unref?.(); };

  const api = {
    /** any GET with ?asc= keeps it for 30 days (last click wins) */
    capture(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
      try {
        const v = req.method === "GET" ? url.searchParams.get("asc") : null;
        if (valid(v) && cookieOf(req) !== v) appendCookie(res, `asc=${v}; Max-Age=${DAYS * 86400}; Path=/; SameSite=Lax; Secure`);
      } catch { /* never breaks a request */ }
    },
    /** "email me a code": keep the click with the address */
    remember(req: http.IncomingMessage, email: string) {
      try {
        const v = cookieOf(req); if (!v || !email) return;
        q("INSERT INTO as_pending VALUES (?,?,?) ON CONFLICT(email_hash) DO UPDATE SET asc=excluded.asc, at=excluded.at").run(emailHash(email), v, Date.now());
        q("DELETE FROM as_pending WHERE at < ?").run(Date.now() - DAYS * DAY);
      } catch { /* best effort */ }
    },
    /** a new account: fix the click on it once, and queue the signup postback */
    attach(req: http.IncomingMessage, owner: string | null | undefined, created: boolean) {
      try {
        if (!created || !owner) return;
        let v = cookieOf(req);
        const email = c.emailOf(owner);
        if (!v && email) { const p = q("SELECT asc, at FROM as_pending WHERE email_hash=?").get(emailHash(email)) as any; if (p && Date.now() - p.at < DAYS * DAY) v = p.asc; }
        if (!valid(v)) return;
        const at = nowIso();
        if (q("INSERT OR IGNORE INTO as_clicks VALUES (?,?,?)").run(owner, v, at).changes !== 1) return;
        const test = !!(email && OWN.test(email.trim()));
        q("INSERT OR IGNORE INTO as_events (txn_id,profile_id,event,occurred_at,test,created_at) VALUES (?,?,?,?,?,?)").run("caldera-signup-" + owner, owner, "signup", at, test ? 1 : 0, at);
        kick();
      } catch (e: any) { console.error("[agencysuper] attach", e?.message); }
    },
    async send(fetchImpl?: Fetch): Promise<number> {
      const k = key(); if (!k || busy) return 0;
      busy = true; let n = 0;
      try {
        const due = q("SELECT e.*, c.asc FROM as_events e JOIN as_clicks c ON c.profile_id=e.profile_id WHERE e.status='queued' AND e.next_at<=? ORDER BY e.created_at LIMIT 20").all(Date.now()) as any[];
        for (const e of due) {
          const body = JSON.stringify({ campaign: CAMPAIGN, click_id: e.asc, event: e.event, customer_ref: refOf(e.profile_id), amount_cents: 0, currency: "USD", txn_id: e.txn_id, occurred_at: e.occurred_at, test: !!e.test });
          const sig = "sha256=" + crypto.createHmac("sha256", k).update(body).digest("hex");
          let ok = false, perm = false, err = "";
          try {
            const r = await (fetchImpl || (fetch as any as Fetch))(URL_, { method: "POST", headers: { "content-type": "application/json", "x-as-signature": sig }, body, signal: AbortSignal.timeout(10_000) });
            const j = await r.json().catch(() => ({}));
            if (r.ok) ok = true; else { err = r.status + " " + String(j.error || JSON.stringify(j)).slice(0, 200); perm = r.status === 400; }
          } catch (x: any) { err = String(x?.message || x).slice(0, 200); }
          const tries = e.tries + 1;
          if (ok) q("UPDATE as_events SET status='sent', tries=?, sent_at=?, last_error=NULL WHERE txn_id=?").run(tries, nowIso(), e.txn_id);
          else if (perm || tries > BACKOFF.length) q("UPDATE as_events SET status='failed', tries=?, last_error=? WHERE txn_id=?").run(tries, err, e.txn_id);
          else q("UPDATE as_events SET tries=?, next_at=?, last_error=? WHERE txn_id=?").run(tries, Date.now() + BACKOFF[tries - 1], err, e.txn_id);
          if (!ok) console.error("[agencysuper]", e.event, e.txn_id, err);
          n += ok ? 1 : 0;
        }
      } finally { busy = false; }
      return n;
    },
    start() { const t = setInterval(() => { api.send().catch(() => {}); }, 60_000); t.unref?.(); },
  };
  return api;
}
