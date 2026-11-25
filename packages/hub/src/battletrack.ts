/**
 * Measurement for the nightly battle mail (battlehub sendReports; Growth Engine reads it per send). Same pattern as the
 * Armory gift mail (giftmail.ts, gift_mail): one token per mail, a 1x1 open pixel in the HTML part, every link wrapped in a
 * click redirect, opened/opens and clicked/clicks per row, a report for caldera-agg and admin.js battle-mail-report.
 *   battle_mail: one row per mail actually sent (written only after the send succeeds).
 *   GET /email/bo.gif?t=        the open pixel. Opens are counted as given: Apple Mail Privacy Protection (and other image
 *                               proxies / prefetchers) load the pixel without a person, so opens run high; read them as an upper bound.
 *   GET /email/bgo?t=&u=        the click redirect: records the click and 302s to u, but ONLY when u is one of the links stored
 *                               for that token or a URL on the hub's own origin; anything else goes to the Battle view (no open redirect).
 *                               "clicked" = the first click of the token (once per mail), "clicks" counts every click (link scanners included).
 * The unsubscribe link and the List-Unsubscribe header are not wrapped (one-click must reach /u/battle directly).
 * The text part is not changed (no pixel, no wrapped links): the mail's words stay as they are.
 */
import type http from "node:http";
import crypto from "node:crypto";

const DAY = 86_400_000;
type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };

export function battleTrack(c: { q: Q; hub: string; now: () => number }) {
  const q = c.q, hub = c.hub.replace(/\/$/, ""), origin = new URL(hub).origin;
  q(`CREATE TABLE IF NOT EXISTS battle_mail (night TEXT, profile TEXT, token TEXT UNIQUE, freq TEXT, sent TEXT, opened TEXT, opens INTEGER DEFAULT 0,
      clicked TEXT, clicks INTEGER DEFAULT 0, unsub TEXT, links TEXT)`).run();
  q("CREATE INDEX IF NOT EXISTS battle_mail_p ON battle_mail (profile, sent)").run();
  const iso = (t: number) => new Date(t).toISOString();
  const tok = () => crypto.randomBytes(12).toString("base64url");
  const rowOf = (t: string | null) => t && /^[\w-]{8,40}$/.test(t) ? q("SELECT * FROM battle_mail WHERE token=?").get(t) as any : null;
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /** A fresh token and the HTML with every link wrapped (except `keep`, the unsubscribe link) and the open pixel before </body>.
   *  links: the original URLs, stored with the row after the send. */
  function wrap(html: string, keep: string[] = []): { token: string; html: string; links: string[] } {
    const token = tok(), links: string[] = [];
    let out = html.replace(/href="([^"]+)"/g, (all, raw: string) => {
      const u = unesc(raw); if (!/^https?:\/\//i.test(u) || keep.includes(u)) return all;
      if (!links.includes(u)) links.push(u);
      return `href="${esc(`${hub}/email/bgo?t=${token}&u=${encodeURIComponent(u)}`)}"`;
    });
    const px = `<img src="${esc(`${hub}/email/bo.gif?t=${token}`)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`;
    out = out.includes("</body>") ? out.replace("</body>", px + "</body>") : out + px;
    return { token, html: out, links };
  }
  /** after a successful send only */
  function record(o: { token: string; night: string; profile: string; freq: string; links: string[] }) {
    q("INSERT OR IGNORE INTO battle_mail (night, profile, token, freq, sent, links) VALUES (?,?,?,?,?,?)").run(o.night, o.profile, o.token, o.freq, iso(c.now()), JSON.stringify(o.links));
  }
  /** the stop rule (Growth Engine 11-25): how many of the member's newest battle mails in a row are weekly-quiet mails with no
   *  open and no click. A daily mail (the city fought), an opened or clicked mail, or a weekly mail they chose ends the run. */
  function quietRun(profile: string): number {
    let n = 0; for (const r of q("SELECT freq, opened, clicked FROM battle_mail WHERE profile=? ORDER BY sent DESC LIMIT 12").all(profile) as any[]) {
      if (r.freq !== "weekly-quiet" || r.opened || r.clicked) break; n++; }
    return n;
  }
  /** the member turned the battle mail off: mark their newest mail of the last 7 days */
  function unsub(profile: string) {
    const r = q("SELECT token FROM battle_mail WHERE profile=? AND sent >= ? ORDER BY sent DESC LIMIT 1").get(profile, iso(c.now() - 7 * DAY)) as any;
    if (r) q("UPDATE battle_mail SET unsub=COALESCE(unsub, ?) WHERE token=?").run(iso(c.now()), r.token);
  }
  /** where a click may go: a link stored for the token, or the hub's own origin; null = refused */
  function dest(row: any, u: string | null): string | null {
    if (!u) return null;
    try { if (row && (JSON.parse(row.links || "[]") as string[]).includes(u)) return u; } catch { /* bad row */ }
    try { const x = new URL(u); if (x.origin === origin && (x.protocol === "https:" || x.protocol === "http:")) return x.toString(); } catch { /* not a URL */ }
    return null;
  }

  const gif1 = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  function route(req: http.IncomingMessage, res: http.ServerResponse, p: string, url: URL): boolean {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (p === "/email/bo.gif") {
      try { const t = url.searchParams.get("t"); if (rowOf(t)) q("UPDATE battle_mail SET opens=opens+1, opened=COALESCE(opened, ?) WHERE token=?").run(iso(c.now()), t); } catch { /* best effort */ }
      res.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store", "content-length": gif1.length }); res.end(req.method === "HEAD" ? undefined : gif1); return true;
    }
    if (p === "/email/bgo") {
      const t = url.searchParams.get("t"), row = rowOf(t), to = dest(row, url.searchParams.get("u"));
      if (row && to) try { const n = iso(c.now()); q("UPDATE battle_mail SET clicks=clicks+1, clicked=COALESCE(clicked, ?), opened=COALESCE(opened, ?) WHERE token=?").run(n, n, t); } catch { /* best effort */ }
      res.writeHead(302, { location: to || `${hub}/world?view=battle`, "cache-control": "no-store" }); res.end(); return true;
    }
    return false;
  }

  /** per night (newest first), mails sent in the last `days` days: counts only, no addresses. freq of a row: "daily", "weekly"
   *  (the member chose weekly) or "weekly-quiet" (a daily member's weekly mail after a quiet Sunday, WEEKLY.md 6.4). Each night
   *  has the totals, the counts of the two weekly groups, and byFreq: the same counts and rates for each group apart. */
  function report(days = 14) {
    const pct = (a: number, b: number) => b ? Math.round(1000 * a / b) / 10 : 0;
    const rate = (r: any) => ({ sent: r.sent, opened: r.opened || 0, openPct: pct(r.opened || 0, r.sent), clicked: r.clicked || 0, clickPct: pct(r.clicked || 0, r.sent),
      unsub: r.unsub || 0, unsubPct: pct(r.unsub || 0, r.sent), opens: r.opens || 0, clicks: r.clicks || 0 });
    const cols = "COUNT(*) sent, SUM(opened IS NOT NULL) opened, SUM(clicked IS NOT NULL) clicked, SUM(unsub IS NOT NULL) unsub, SUM(opens) opens, SUM(clicks) clicks", since = iso(c.now() - days * DAY);
    const by = new Map<string, Record<string, ReturnType<typeof rate>>>();
    for (const r of q(`SELECT night, COALESCE(freq, 'daily') freq, ${cols} FROM battle_mail WHERE sent >= ? GROUP BY night, COALESCE(freq, 'daily')`).all(since) as any[]) {
      const m = by.get(r.night) || {}; m[r.freq] = rate(r); by.set(r.night, m);
    }
    return (q(`SELECT night, ${cols}, SUM(freq='weekly') weekly, SUM(freq='weekly-quiet') weeklyQuiet FROM battle_mail WHERE sent >= ? GROUP BY night ORDER BY night DESC`).all(since) as any[])
      .map(r => { const a = acted(r.night); return { night: r.night, ...rate(r), weekly: r.weekly || 0, weeklyQuiet: r.weeklyQuiet || 0, ...a, byFreq: by.get(r.night) || {} }; });
  }
  /** the mark of the weekly-quiet mail (registry caldera_battle_loop, GE 11-25): of its recipients that night, how many fought
   *  (fired a missile) or set tonight's defenses (an order in battle_turn) in the 7 nights after it. Counts only. */
  function acted(nightKey: string): { quietActed7: number; quietActed7Pct: number } {
    try {
      const n0 = Math.floor(Date.parse(nightKey + "T12:00:00Z") / DAY), ps = (q("SELECT profile FROM battle_mail WHERE night=? AND freq='weekly-quiet'").all(nightKey) as any[]).map(r => r.profile);
      let k = 0; for (const p of ps) if (q("SELECT 1 FROM battle_shots WHERE a=? AND night>? AND night<=? LIMIT 1").get(p, n0, n0 + 7) || q("SELECT 1 FROM battle_turn WHERE profile=? AND night>? AND night<=? LIMIT 1").get(p, n0, n0 + 7)) k++;
      return { quietActed7: k, quietActed7Pct: ps.length ? Math.round(1000 * k / ps.length) / 10 : 0 };
    } catch { return { quietActed7: 0, quietActed7Pct: 0 }; }
  }
  const erase = (profile: string) => q("DELETE FROM battle_mail WHERE profile=?").run(profile);

  return { wrap, record, unsub, quietRun, route, report, erase };
}
export type BattleTrack = ReturnType<typeof battleTrack>;
