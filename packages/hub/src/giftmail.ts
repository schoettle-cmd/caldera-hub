/**
 * Armory gift emails (Mike 2026-11-18, "for the armoury"): a player buys bombs in the Armory and aims them at another
 * member's city; that member gets
 *   1. at once: "<sender or Someone> bought you a <bomb>", the bomb, its word, a link to the battle and a live countdown
 *      (an animated GIF the server draws when the email is opened, /email/countdown.gif), plus the start time as text in
 *      the recipient's time zone (mail apps that block images still show it);
 *   2. the next morning, ONLY if the daily battle summary names them (top 3 by ammo stacked, top 4 cities hit): a link to
 *      that summary post with their part. No mention, no email 2.
 * A gift = one buyer's bombs at one city for one night. Each step goes at most once per gift (a row is claimed before the
 * send). Caps: at most GIFT_CAP first emails per recipient per night; one email 2 per recipient per night.
 * Only members with a confirmed, unsuppressed address and the Armory email switch on; only when CALDERA_ARMORY_EMAIL=1.
 * Unclaimed Frontier lands never get mail. Every email has a one-click unsubscribe (the Armory switch) and the guard checks.
 * Sent, opened (the countdown GIF / a pixel) and clicked (a redirect) are logged per step in gift_mail for caldera-agg.
 */
import type http from "node:http";
import crypto from "node:crypto";
import { encodeGif, Canvas, type RGB } from "./gif";
import { bombOf, salvoAt, type ArmoryStore, type BombRow, type BombKind } from "./armory";
import { GIFT_PAL, CD_W, CD_H, BOMB_PX, drawCountdown, whenText, giftEmail1, giftEmail2, bombSvg, type CdFrame } from "./giftlook";

export const GIFT_CAP = 3;
const DAY = 86_400_000, H = 3_600_000;

export interface GiftCtx {
  q: (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
  hub: string; now: () => number; postal: string;
  A: ArmoryStore;
  /** the night's battle time (battleAt: 10:00 UTC, when the Armory locks and the night resolves) */ battleAt: (night: number) => number;
  /** the night's battle has run (shots are stored) */ ran: (night: number) => boolean;
  /** the summary post for a night, and who it names (same numbers as the post) */
  summary: (night: number) => { postId: string; top: [string, number][]; hit: [string, { f: number; towers: number }][] } | null;
  emailOf: (id: string) => string | null;
  /** the Armory email switch and time zone of a member, and their unsubscribe token */ prefs: (id: string) => { tz: string; mail: boolean; token: string };
  mailOn: () => boolean;
  handle: (id: string) => string; nameOf: (id: string) => string;
  send: (m: { to: string; subject: string; html: string; text: string; src: string; kind: string; headers: Record<string, string> }) => Promise<unknown>;
  unsubAll?: (id: string) => string | null;
  fmtUsd: (n: number) => string;
  png?: (svg: string, width: number) => Promise<Buffer>;
}

export function giftMail(c: GiftCtx) {
  const q = c.q, hub = c.hub.replace(/\/$/, "");
  q(`CREATE TABLE IF NOT EXISTS gift_mail (gift TEXT, step INTEGER, night INTEGER, sender TEXT, rcpt TEXT, token TEXT UNIQUE, claimed INTEGER,
      sent TEXT, status TEXT, opened TEXT, opens INTEGER DEFAULT 0, clicked TEXT, clicks INTEGER DEFAULT 0, PRIMARY KEY (gift, step))`).run();
  const tok = () => crypto.randomBytes(12).toString("base64url");
  const iso = (t: number) => new Date(t).toISOString();
  const isMember = (id: string | null): id is string => !!id && !id.startsWith("uc:");

  /** Claim a (gift, step) row; false when it already exists (each step goes once per gift). */
  function claim(gift: string, step: 1 | 2, night: number, sender: string, rcpt: string): string | null {
    const t = tok(), r = q("INSERT OR IGNORE INTO gift_mail (gift, step, night, sender, rcpt, token, claimed, status) VALUES (?,?,?,?,?,?,?,'claimed')").run(gift, step, night, sender, rcpt, t, c.now());
    return Number(r.changes) ? t : null;
  }
  const mark = (t: string, status: string) => q("UPDATE gift_mail SET status=?, sent=? WHERE token=?").run(status, status === "sent" ? iso(c.now()) : null, t);
  const rowOf = (t: string) => /^[\w-]{8,40}$/.test(t) ? q("SELECT * FROM gift_mail WHERE token=?").get(t) as any : null;
  const unsubOf = (rcpt: string, token: string) => ({ armory: `${hub}/u/armory?t=${token}`, all: c.unsubAll?.(rcpt) || `${hub}/u/armory?t=${token}` });
  const link = (t: string, path: string) => `${hub}/email/go?t=${t}&u=${encodeURIComponent(path)}`;
  /** "Hey Rae": the first name, else the handle */
  const greet = (id: string) => (c.nameOf(id) || "").trim().split(/\s+/)[0] || c.handle(id);

  /** Who may get a gift email at all. */
  function reachable(rcpt: string): { to: string; tz: string; token: string } | null {
    if (!c.mailOn()) return null;
    const p = c.prefs(rcpt); if (!p.mail) return null;
    const to = c.emailOf(rcpt); return to ? { to, tz: p.tz, token: p.token } : null;
  }

  /** Email 1: after a paid buy. bombs = the rows just bought. Returns how many emails went. */
  async function afterBuy(sender: string, night: number, bombs: BombRow[]): Promise<number> {
    let n = 0;
    const by = new Map<string, BombRow[]>();
    for (const b of bombs) if (isMember(b.target) && b.target !== sender) { if (!by.has(b.target)) by.set(b.target, []); by.get(b.target)!.push(b); }
    for (const [rcpt, mine] of by) {
      const r = reachable(rcpt); if (!r) continue;
      const already = (q("SELECT COUNT(*) n FROM gift_mail WHERE night=? AND rcpt=? AND step=1").get(night, rcpt) as any).n as number;
      if (already >= GIFT_CAP) continue;
      const gift = `${night}:${sender}:${rcpt}`, t = claim(gift, 1, night, sender, rcpt); if (!t) continue;
      const named = mine.some(b => b.named), start = salvoAt(c.battleAt(night), r.tz), u = unsubOf(rcpt, r.token);
      const m = giftEmail1({ hub, to: greet(rcpt), from: named ? c.handle(sender) : null,
        bombs: mine.map(b => ({ k: b.kind, name: bombOf(b.kind)!.name, line: bombOf(b.kind)!.line, word: b.word })), start, now: c.now(),
        tz: r.tz, battle: link(t, "/world?view=battle"), gif: `${hub}/email/countdown.gif?b=${night}&t=${t}`, unsubArmory: u.armory, unsubAll: u.all, postal: c.postal });
      try {
        const ok = await c.send({ to: r.to, subject: m.subject, html: m.html, text: m.text, src: "armory-gift-1", kind: "armory", headers: { "List-Unsubscribe": `<${u.armory}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
        mark(t, ok === false ? "held" : "sent"); if (ok !== false) n++;
      } catch (e: any) { mark(t, "failed"); console.error("[gift] email 1", e?.message); }
    }
    return n;
  }

  /** Email 2, on the tick: the morning after a battle, to recipients of a sent email 1 that the summary names. */
  async function tick(): Promise<number> {
    let n = 0; const now = c.now();
    const nights = (q("SELECT DISTINCT night FROM gift_mail WHERE step=1 AND status='sent' AND claimed > ?").all(now - 4 * DAY) as any[]).map(r => r.night as number);
    for (const night of nights) {
      if (!c.ran(night)) continue;
      const s = c.summary(night); if (!s) continue;
      const rcpts = (q("SELECT rcpt, MIN(claimed) c FROM gift_mail WHERE night=? AND step=1 AND status='sent' GROUP BY rcpt ORDER BY c").all(night) as any[]).map(r => r.rcpt as string);
      for (const rcpt of rcpts) {
        if (q("SELECT 1 FROM gift_mail WHERE gift=? AND step=2").get(`${night}::${rcpt}`)) continue;
        const top = s.top.find(x => x[0] === rcpt), hit = s.hit.find(x => x[0] === rcpt); if (!top && !hit) continue;   // not named: no email 2, ever
        const r = reachable(rcpt); if (!r) continue;
        // "the next day": from the morning after the salvo plays on their map (20:00 their time), 09:00-21:00 local, for 2 days
        const start = salvoAt(c.battleAt(night), r.tz); if (now < start + 12 * H || now > start + 48 * H) continue;
        const hr = Number(new Date(now).toLocaleString("en-US", { timeZone: r.tz, hour: "numeric", hourCycle: "h23" })) || 0; if (hr < 9 || hr >= 21) continue;
        const t = claim(`${night}::${rcpt}`, 2, night, "", rcpt); if (!t) continue;
        const u = unsubOf(rcpt, r.token);
        // the bombs aimed at this city that night by buyers whose gift email 1 went: named only when the buyer chose
        const aimed = (q(`SELECT b.kind, b.word, b.p, b.named FROM armory_bombs b WHERE b.night=? AND b.target=? AND b.state IN ('paid','fired') AND b.hidden=0
            AND EXISTS (SELECT 1 FROM gift_mail g WHERE g.night=b.night AND g.rcpt=b.target AND g.sender=b.p AND g.step=1 AND g.status='sent') ORDER BY b.id`).all(night, rcpt) as any[])
          .map(b => ({ k: b.kind as BombKind, name: bombOf(b.kind)?.name || "Bomb", from: b.named ? c.handle(b.p) : null, word: String(b.word || "") }));
        const m = giftEmail2({ to: greet(rcpt), stacked: top ? top[1] : null, towers: hit ? hit[1].towers : null, usd: hit ? c.fmtUsd(hit[1].f) : null,
          rankStacked: top ? s.top.indexOf(top) + 1 : null, aimed, post: link(t, `/feed/p/${s.postId}`), pixel: `${hub}/email/o.gif?t=${t}`, unsubArmory: u.armory, unsubAll: u.all, postal: c.postal });
        try {
          const ok = await c.send({ to: r.to, subject: m.subject, html: m.html, text: m.text, src: "armory-gift-2", kind: "armory", headers: { "List-Unsubscribe": `<${u.armory}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
          mark(t, ok === false ? "held" : "sent"); if (ok !== false) n++;
        } catch (e: any) { mark(t, "failed"); console.error("[gift] email 2", e?.message); }
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- the countdown GIF (K5)
  /** 120 one-second frames from `at`, then a held frame with the clock time (a cached or late-fetched image is never wrong).
   *  Reaches zero: count to 00:00:00, then hold BATTLE ON. After the start: one still frame, ON for 30 minutes, then OVER. */
  function countdownGif(start: number, at: number, tz = "America/Los_Angeles", secs = 120): Buffer {
    const frames: { px: Uint8Array; delay: number }[] = [];
    const add = (o: CdFrame, delay = 100) => { const cv = new Canvas(CD_W, CD_H, 0); drawCountdown(cv, o); frames.push({ px: cv.copy(), delay }); };
    if (at >= start) { add(at >= start + 30 * 60_000 ? { state: "over" } : { state: "on" }); return encodeGif(CD_W, CD_H, GIFT_PAL, frames, null); }
    const s0 = Math.ceil((start - at) / 1000);
    let zero = false;
    for (let i = 0; i < secs; i++) { const left = Math.max(0, s0 - i); add({ state: "count", sec: left }); if (left === 0) { zero = true; break; } }
    add(zero ? { state: "on" } : { state: "hold", time: whenText(start, tz).clock, zone: "YOUR TIME" });
    return encodeGif(CD_W, CD_H, GIFT_PAL, frames, null);
  }

  // ---------------------------------------------------------------- routes
  const gif1 = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const seen = (t: string | null, what: "open" | "click") => {
    if (!t) return; const r = rowOf(t); if (!r) return;
    if (what === "open") q("UPDATE gift_mail SET opens=opens+1, opened=COALESCE(opened, ?) WHERE token=?").run(iso(c.now()), t);
    else q("UPDATE gift_mail SET clicks=clicks+1, clicked=COALESCE(clicked, ?), opened=COALESCE(opened, ?) WHERE token=?").run(iso(c.now()), iso(c.now()), t);
  };
  const pngCache = new Map<string, Buffer>();
  async function route(req: http.IncomingMessage, res: http.ServerResponse, p: string, url: URL): Promise<boolean> {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (p === "/email/countdown.gif") {
      const t = url.searchParams.get("t"), row = t ? rowOf(t) : null, night = Number(url.searchParams.get("b")) || row?.night || 0;
      if (!night || night < 0 || night > 1e6) { res.writeHead(404); res.end(); return true; }
      try { seen(t, "open"); } catch { /* best effort */ }
      let tz = "America/Los_Angeles"; try { if (row?.rcpt) tz = c.prefs(row.rcpt).tz || tz; } catch { /* PT */ }
      const body = countdownGif(salvoAt(c.battleAt(night), tz), c.now(), tz);
      res.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store, no-cache, must-revalidate, max-age=0", "pragma": "no-cache", "expires": "0", "content-length": body.length });
      res.end(req.method === "HEAD" ? undefined : body); return true;
    }
    if (p === "/email/o.gif") {
      try { seen(url.searchParams.get("t"), "open"); } catch { /* best effort */ }
      res.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store", "content-length": gif1.length }); res.end(gif1); return true;
    }
    if (p === "/email/go") {
      const t = url.searchParams.get("t"), u = url.searchParams.get("u") || "/world?view=battle";
      const safe = /^\/(?!\/)[\w\-./?=&%#@:+~]*$/.test(u) ? u : "/world?view=battle";
      try { seen(t, "click"); } catch { /* best effort */ }
      const r = t ? rowOf(t) : null, dest = new URL(hub + safe); dest.searchParams.set("src", `email-armory-gift-${r?.step || 1}`);
      res.writeHead(302, { location: dest.toString(), "cache-control": "no-store" }); res.end(); return true;
    }
    const m = p.match(/^\/email\/bomb\/(sparkler|thunderbolt|inferno|nova)\.png$/);
    if (m && c.png) {
      const k = m[1]!; let body = pngCache.get(k);
      if (!body) { body = await c.png(bombSvg(k), BOMB_PX); pngCache.set(k, body); }
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=604800", "content-length": body.length }); res.end(req.method === "HEAD" ? undefined : body); return true;
    }
    return false;
  }

  /** Numbers for caldera-agg: per send day and step, sent / opened / clicked. */
  function stats(sinceIso: string) {
    return q(`SELECT substr(sent,1,10) day, step, COUNT(*) sent, SUM(opened IS NOT NULL) opened, SUM(clicked IS NOT NULL) clicked
      FROM gift_mail WHERE status='sent' AND sent >= ? AND gift NOT LIKE 'test:%' GROUP BY 1, 2 ORDER BY 1, 2`).all(sinceIso);
  }

  return { afterBuy, tick, route, stats, countdownGif, isGiftable: (sender: string, target: string | null) => isMember(target) && target !== sender, _claim: claim };
}
export type GiftMail = ReturnType<typeof giftMail>;
