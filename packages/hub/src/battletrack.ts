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

  /** per night (newest first), mails sent in the last `days` days: counts only, no addresses */
  function report(days = 14) {
    const pct = (a: number, b: number) => b ? Math.round(1000 * a / b) / 10 : 0;
    return (q(`SELECT night, COUNT(*) sent, SUM(opened IS NOT NULL) opened, SUM(clicked IS NOT NULL) clicked, SUM(unsub IS NOT NULL) unsub,
        SUM(opens) opens, SUM(clicks) clicks, SUM(freq='weekly') weekly FROM battle_mail WHERE sent >= ? GROUP BY night ORDER BY night DESC`).all(iso(c.now() - days * DAY)) as any[])
      .map(r => ({ night: r.night, sent: r.sent, opened: r.opened || 0, openPct: pct(r.opened || 0, r.sent), clicked: r.clicked || 0, clickPct: pct(r.clicked || 0, r.sent),
        unsub: r.unsub || 0, unsubPct: pct(r.unsub || 0, r.sent), opens: r.opens || 0, clicks: r.clicks || 0, weekly: r.weekly || 0 }));
  }
  const erase = (profile: string) => q("DELETE FROM battle_mail WHERE profile=?").run(profile);

  return { wrap, record, unsub, route, report, erase };
}
export type BattleTrack = ReturnType<typeof battleTrack>;
