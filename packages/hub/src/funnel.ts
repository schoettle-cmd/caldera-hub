/**
 * The sign-up funnel, step by step, so we can see where people drop: viewed the homepage (or a /gh preview) -> clicked
 * "Sign up with GitHub" -> came back from GitHub -> account created (or signed in) -> landed on their city -> and, from
 * the account records, whether we have their email and whether they turned on the daily summary.
 *
 * No cookie and nothing personal: a visitor is a one-day hash of IP + browser (like page views), so the same person is
 * counted once per step per day. Bots and crawlers aren't counted.
 *
 * Returns from email (and other tagged links): every link back to the hub in our emails carries ?src=<which email>
 * (email.ts tagLinks, e.g. src=email-digest). A visit with a src is counted once per visitor per src per day, with
 * whether they were a signed-in member, so the daily report can say how many people each email brought back.
 */
import type http from "node:http";
import crypto from "node:crypto";

export const STEPS = ["view", "preview", "gate", "click", "back", "created", "signin", "fail", "landed", "email-start", "email-sent", "email-created"] as const;
/** Crawlers, link previewers and scripts: never counted in the funnel or page views. Real browsers never match.
 *  Many crawlers ignore robots.txt and follow sign-up links (Meta's AI agents, GoogleOther, BigBug): named here. */
export const BOT_UA = /bot|crawl|spider|slurp|preview|fetch|curl|wget|python|node|headless|monitor|lighthouse|facebookexternalhit|facebookcatalog|embedly|discord|slack|telegram|whatsapp|externalagent|webindexer|googleother|google-inspectiontool|google-extended|bigbug|wrendex|scrapy|httpx|axios|okhttp|go-http|java\/|libwww|ia_archiver|barkrowler|dataprovider|petalsearch|yisou|sogou|seznam|ahrefs|semrush|mj12|bytespider|claude-user|claude-searchbot|anthropic-ai|perplexity|ccbot|cohere|diffbot|timpi|imagesift|omgili|youbot|qwant|yandex|baidu|meta-/i;
/** A browser that claims to be modern Chrome or Firefox always sends Sec-Fetch-Mode on a navigation; a request that
 *  claims to be one and doesn't is a script dressed up as a browser. Fetches that aren't navigations (prefetch, no-cors)
 *  aren't clicks either. Safari and older browsers without these headers still count. */
export function looksAutomated(req: http.IncomingMessage): boolean {
  const ua = String(req.headers["user-agent"] || ""); if (!ua || BOT_UA.test(ua)) return true;
  const mode = req.headers["sec-fetch-mode"];
  if (mode && mode !== "navigate" && mode !== "cors" && mode !== "same-origin") return true;
  if (!mode) {
    const ch = /Chrome\/(\d+)/.exec(ua), ff = /Firefox\/(\d+)/.exec(ua);
    if ((ch && +ch[1] >= 90 && !/Edge\/|OPR\/|SamsungBrowser|Electron/.test(ua)) || (ff && +ff[1] >= 95)) return true;
  }
  return false;
}
export type Step = typeof STEPS[number];
const DAY = 86_400_000;
/** the funnel day: Los Angeles calendar day */
export const funnelDay = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

/** the UTC instant a Los Angeles day starts (handles daylight saving) */
export function laMidnight(day: string): string {
  for (const off of [7, 8]) { const t = Date.parse(`${day}T00:00:00Z`) + off * 3600_000; if (funnelDay(t) === day && funnelDay(t - 1) !== day) return new Date(t).toISOString(); }
  return new Date(Date.parse(`${day}T08:00:00Z`)).toISOString();
}

export function funnel(c: { q: (sql: string) => any; ipOf: (req: http.IncomingMessage) => string; botUa: RegExp }) {
  const { q } = c;
  // a salt that survives restarts, so the same visitor is one visitor all day
  q("CREATE TABLE IF NOT EXISTS hub_meta (k TEXT PRIMARY KEY, v TEXT)").run();
  q("INSERT OR IGNORE INTO hub_meta VALUES ('funnel_salt', ?)").run(crypto.randomBytes(16).toString("hex"));
  const salt = String((q("SELECT v FROM hub_meta WHERE k='funnel_salt'").get() as any)?.v || "");
  q(`CREATE TABLE IF NOT EXISTS funnel_events (day TEXT, vid TEXT, step TEXT, detail TEXT, ts TEXT, PRIMARY KEY (day, vid, step))`).run();
  q(`CREATE INDEX IF NOT EXISTS funnel_day ON funnel_events(day, step)`).run();
  // which members we saw on which day (signed in on the site, on their own page, or their Obsidian plugin talking to us):
  // "did yesterday's sign-ups come back today?"
  q(`CREATE TABLE IF NOT EXISTS member_days (owner TEXT, day TEXT, via TEXT, PRIMARY KEY (owner, day))`).run();
  // arrivals from a tagged link (?src=email-digest, ...): one row per visitor per src per day; member = a signed-in
  // member on any of that day's visits; path = where they first landed
  q(`CREATE TABLE IF NOT EXISTS src_visits (day TEXT, vid TEXT, src TEXT, member INTEGER, path TEXT, ts TEXT, PRIMARY KEY (day, vid, src))`).run();
  q(`CREATE INDEX IF NOT EXISTS src_visits_day ON src_visits(day, src)`).run();
  const seenMemo = new Set<string>();
  const vidOf = (req: http.IncomingMessage, day: string) => crypto.createHash("sha256").update(salt + "|funnel|" + day + "|" + c.ipOf(req) + "|" + String(req.headers["user-agent"] || "")).digest("hex").slice(0, 16);
  /** count this visitor at this step today (once per day per step) */
  function track(req: http.IncomingMessage, step: Step, detail = "") {
    try {
      const ua = String(req.headers["user-agent"] || ""); if (!ua || c.botUa.test(ua) || looksAutomated(req)) return;
      const day = funnelDay();
      q("INSERT OR IGNORE INTO funnel_events VALUES (?,?,?,?,?)").run(day, vidOf(req, day), step, String(detail).slice(0, 80), new Date().toISOString());
    } catch { /* counting never breaks a request */ }
  }
  /** a visit that came from a tagged link (?src=...): bots aren't counted, nor anything that isn't a plain tag */
  function arrived(req: http.IncomingMessage, src: string, member: boolean, path = "") {
    try {
      const s = String(src || "").toLowerCase(); if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(s)) return;
      const ua = String(req.headers["user-agent"] || ""); if (!ua || c.botUa.test(ua) || looksAutomated(req)) return;
      const day = funnelDay();
      q(`INSERT INTO src_visits VALUES (?,?,?,?,?,?) ON CONFLICT(day, vid, src) DO UPDATE SET member=MAX(member, excluded.member)`)
        .run(day, vidOf(req, day), s, member ? 1 : 0, String(path).slice(0, 80), new Date().toISOString());
    } catch { /* counting never breaks a request */ }
  }
  /** note that a member was here today (once per member per day; cheap to call on every request) */
  function seen(owner: string | null | undefined, via: "site" | "obsidian") {
    if (!owner) return; const day = funnelDay(), k = owner + "|" + day; if (seenMemo.has(k)) return;
    if (seenMemo.size > 20_000) seenMemo.clear(); seenMemo.add(k);
    try { q("INSERT OR IGNORE INTO member_days VALUES (?,?,?)").run(owner, day, via); } catch { /* counting never breaks a request */ }
  }
  /** per day: unique visitors at each step, failure reasons, and the new accounts with their email status */
  function report(days = 7) {
    const out: any[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = funnelDay(Date.now() - i * DAY), counts: Record<string, number> = {};
      for (const r of q("SELECT step, COUNT(*) n FROM funnel_events WHERE day=? GROUP BY step").all(day) as any[]) counts[r.step] = r.n;
      const fails = q("SELECT detail, COUNT(*) n FROM funnel_events WHERE day=? AND step='fail' GROUP BY detail").all(day) as any[];
      // new members that day (GitHub sign-ups and Obsidian vaults), and whether we can reach them
      const start = laMidnight(day), end = laMidnight(funnelDay(Date.parse(start) + DAY + 3600_000)), next = funnelDay(Date.parse(end) + 3600_000);
      const tracked = !!q("SELECT 1 FROM member_days WHERE day=? LIMIT 1").get(next);   // no data for days before tracking began
      const members = (q(`SELECT p.id, p.handle, p.created, (SELECT 1 FROM gh_accounts g WHERE g.profile_id=p.id) gh,
          (SELECT verified FROM email_suggest e WHERE e.owner=p.id) sug, (SELECT confirmed FROM email_subs s WHERE s.owner=p.id) sub
        FROM profiles p WHERE p.handle IS NOT NULL AND p.created >= ? AND p.created < ?`).all(start, end) as any[])
        .map(m => ({ handle: m.handle, via: m.gh ? "GitHub" : "Obsidian", email: m.sub ? "subscribed" : m.sug === 1 ? "verified on file" : m.sug === 0 ? "unverified on file" : "none",
          // came back the next day (null while that day hasn't happened yet)
          back: next > funnelDay() || !tracked ? null : !!q("SELECT 1 FROM member_days WHERE owner=? AND day=?").get(m.id, next) }));
      // came back from a tagged link, per src (email-digest, email-message, ...): unique visitors, and how many were members
      const returns = (q("SELECT src, COUNT(*) visitors, SUM(member) members FROM src_visits WHERE day=? GROUP BY src ORDER BY visitors DESC, src").all(day) as any[])
        .map(r => ({ src: r.src, visitors: r.visitors, members: r.members || 0 }));
      out.push({ day, counts, fails, members, returns });
    }
    return out;
  }
  return { track, seen, arrived, report };
}
