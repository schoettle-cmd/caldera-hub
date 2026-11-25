/**
 * The Armory (Mike 11-17, asked for Orion, built for every battle player): before each battle night a player buys custom bombs
 * with their help credits (in-game only, no cash value) and writes one short word on each. The word rises over the map as a
 * smoke cloud when the bomb hits in the replay. Rules:
 *  - the window opens when the last battle ends and locks with the defenses at 19:45 PT, 15 minutes before the next battle at
 *    20:00 PT (lockAt; LOOP.md part c, 11-24: until then the lock was the 10:00 UTC battle); each player gets one "Armory open"
 *    alert at 6 PM their time, or 8 AM where 6 PM is under 4 hours before the lock (all of the Americas now) (Mike 11-18);
 *  - four types at different prices; each flies as one of the battle's weapons (same physics, same shields);
 *  - per bomb: a word (anything, 1-12 characters, no filter: Mike 11-18 "No boundaries") and a target ("random" or a city in the battle);
 *  - nobody buys: the night is exactly what it was (the bombs fire after every normal shot, from their own random stream);
 *  - a bomb that cannot fire (the buyer left the battles, no valid target, the night was skipped) is refunded;
 *  - a shown word can be reported; the operator hides a word (admin battle-word-hide <id>).
 */
import { battleAt, lockAt, lastNight, type Weapon } from "./battle";

export type BombKind = "sparkler" | "thunderbolt" | "inferno" | "nova";
export interface BombSpec { k: BombKind; name: string; cost: number; w: Weapon; line: string }
export const ARMORY = {
  types: [
    { k: "sparkler", name: "Sparkler", cost: 5, w: "shell", line: "A small burst of gold sparks." },
    { k: "thunderbolt", name: "Thunderbolt", cost: 12, w: "rocket", line: "A blue-white electric flash." },
    { k: "inferno", name: "Inferno", cost: 25, w: "tactical", line: "A large orange fireball." },
    { k: "nova", name: "Nova", cost: 50, w: "cruise", line: "A huge purple shockwave and mushroom cloud." },
  ] as BombSpec[],
  /** most bombs one player can hold for one night (keeps the replay readable) */ perNight: 20,
  /** the "Armory open" alert goes at this local hour (the player's own time zone) */ alertHour: 18,
  /** credits a city earns for each night it fires (Mike 11-18: "daily battle reward"), idempotent per night */ reward: 10,
  /** the cheapest bomb: below this balance there is nothing to buy, so no alert */ minBuy: 5,
  wordMax: 12,
};
export const bombOf = (k: string): BombSpec | null => ARMORY.types.find(t => t.k === k) || null;
export const priceOf = (kinds: string[]): number | null => { let t = 0; for (const k of kinds) { const b = bombOf(k); if (!b) return null; t += b.cost; } return t; };

// ---------------------------------------------------------------- the window and the player's clock
/** offset (ms to add to UTC to get wall time) of a time zone at an instant; an unknown zone counts as Pacific */
export function tzOffset(t: number, tz = "America/Los_Angeles"): number {
  let f: Intl.DateTimeFormat; try { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return tzOffset(t); }
  const p = f.formatToParts(new Date(t)), g = (k: string) => Number(p.find(x => x.type === k)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
}
export const ptOffset = (t: number) => tzOffset(t, "America/Los_Angeles");
/** the UTC instant of a wall-clock time (ms since epoch, as if UTC) in a zone; the second pass settles a DST edge */
export function wallToUtc(wall: number, tz: string): number { let t = wall - tzOffset(wall, tz); t = wall - tzOffset(t, tz); return t; }
/** a valid IANA zone name, or null */
export function cleanTz(raw: unknown): string | null { const z = String(raw ?? "").trim(); if (!z || z.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(z) && z !== "UTC") return null; try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return z; } catch { return null; } }
/** the window for battle night n: opens when night n-1 ran, locks at night n's lock (19:45 PT, 15 minutes before it runs) */
export function armoryWindow(night: number): { night: number; open: number; lock: number } { return { night, open: battleAt(night - 1), lock: lockAt(night) }; }
/** the night a purchase made now goes to (the next night to run); locked from the lock until that night runs */
export function armoryNow(now: number): { night: number; open: number; lock: number; state: "open" | "locked" } {
  const w = armoryWindow(lastNight(now) + 1); return { ...w, state: now >= w.lock ? "locked" : "open" };
}
/** the latest local hh:mm strictly before t, as a UTC instant */
function lastLocal(t: number, tz: string, h: number, m = 0): number {
  const wall = t + tzOffset(t, tz), day = Math.floor(wall / 86_400_000);
  for (let k = 0; k < 3; k++) { const u = wallToUtc((day - k) * 86_400_000 + h * 3600_000 + m * 60_000, tz); if (u < t) return u; }
  return wallToUtc((day - 3) * 86_400_000 + h * 3600_000 + m * 60_000, tz);
}
/** local hour (0-23.99) of an instant */
export const localHour = (t: number, tz: string) => { const w = t + tzOffset(t, tz); return ((w % 86_400_000) + 86_400_000) % 86_400_000 / 3600_000; };
/** When the "Armory open" alert for night n goes to a player in zone tz: 6 PM their time before the lock. Where 6 PM is less
 *  than 4 hours before the lock (UTC+6 to UTC+10), 8 AM that day instead. Never before the window opens. */
export function openAlertAt(night: number, tz: string): number {
  const w = armoryWindow(night); let t = lastLocal(w.lock, tz, ARMORY.alertHour);
  if (w.lock - t < 4 * 3600_000) t = lastLocal(t, tz, 8);
  return Math.max(t, w.open);
}
/** When the reminder goes (only to a player with no bombs for that night): 1 hour before the lock when that is between 8 AM and
 *  10 PM their time; otherwise 9:30 PM their time on the evening before. null: too close to the open alert (under 3 hours). */
export function remindAt(night: number, tz: string): number | null {
  const w = armoryWindow(night), h1 = w.lock - 3600_000, lh = localHour(h1, tz);
  const t = lh >= 8 && lh < 22 ? h1 : lastLocal(w.lock, tz, 21, 30);
  return t - openAlertAt(night, tz) < 3 * 3600_000 || t <= w.open ? null : t;
}
/** a clock time in the player's zone: "5:00 AM" */
/** When a night's salvo plays on the map for a viewer in tz: the first 20:00 local at or after the battle time (citybattle.ts
 *  bPick: a local day shows the night whose battle time falls in the 24 h before its 20:00). With the battle at 20:00 PT, the
 *  Pacific map fires it live. */
export function salvoAt(battle: number, tz: string): number {
  const off = tzOffset(battle, tz), wall = battle + off, at8 = Math.floor(wall / 86_400_000) * 86_400_000 + 20 * 3_600_000;
  return wallToUtc(wall <= at8 ? at8 : at8 + 86_400_000, tz);
}
export function clockIn(t: number, tz: string, locale = "en-US"): string {
  try { return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(t)).replace(/ /g, " "); }
  catch { return clockIn(t, "America/Los_Angeles", "en-US"); }
}

// ---------------------------------------------------------------- the bomb word (Mike 11-18: "No boundaries": no word filter)
export type WordCheck = { ok: true; word: string } | { ok: false; why: string };
/** One word for a bomb: anything the player types, trimmed, control characters removed. Only empty and too long are refused
 *  (the bomb art fits wordMax characters). Players can still report a word, which hides it (report-word). */
export function checkWord(raw: unknown, _handles: Iterable<string> = []): WordCheck {
  const w = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return { ok: false, why: "Write a word for each bomb." };
  if ([...w].length > ARMORY.wordMax) return { ok: false, why: `At most ${ARMORY.wordMax} characters.` };
  return { ok: true, word: w };
}

// ---------------------------------------------------------------- the store
type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };
export interface BombRow { id: number; night: number; p: string; kind: BombKind; word: string; target: string | null; cost: number; ts: number; state: "paid" | "fired" | "refunded"; k: number | null; hidden: 0 | 1; reports: number; named: 0 | 1 }
const rowOf = (r: any): BombRow => ({ id: r.id, night: r.night, p: r.p, kind: r.kind, word: r.word, target: r.target || null, cost: r.cost, ts: r.ts, state: r.state, k: r.k ?? null, hidden: r.hidden ? 1 : 0, reports: r.reports || 0, named: r.named ? 1 : 0 });
/** The bombs and the credit ledger. The ledger is the hub's help-credit table (who, delta, reason, ref, ts ISO). */
export function armoryStore(q: Q) {
  q(`CREATE TABLE IF NOT EXISTS armory_bombs (id INTEGER PRIMARY KEY AUTOINCREMENT, night INTEGER, p TEXT, kind TEXT, word TEXT, target TEXT, cost INTEGER, ts INTEGER, state TEXT, k INTEGER, hidden INTEGER DEFAULT 0, reports INTEGER DEFAULT 0)`).run();
  q(`CREATE INDEX IF NOT EXISTS armory_bombs_n ON armory_bombs (night, p)`).run();
  try { q(`ALTER TABLE armory_bombs ADD COLUMN named INTEGER DEFAULT 0`).run(); } catch { /* already there: 1 = the buyer showed their name to the target (gift email) */ }
  q(`CREATE TABLE IF NOT EXISTS armory_reports (bomb INTEGER, who TEXT, ts INTEGER, PRIMARY KEY (bomb, who))`).run();
  q(`CREATE TABLE IF NOT EXISTS ledger (who TEXT, delta INTEGER, reason TEXT, ref TEXT, ts TEXT)`).run();
  const balance = (p: string) => Number((q("SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE who=?").get(p) as any).s) || 0;
  const credit = (p: string, delta: number, reason: string, ref: string, at: number) => q("INSERT INTO ledger VALUES (?,?,?,?,?)").run(p, delta, reason, ref, new Date(at).toISOString());
  const S = {
    balance,
    get: (id: number): BombRow | null => { const r = q("SELECT * FROM armory_bombs WHERE id=?").get(id); return r ? rowOf(r) : null; },
    of: (night: number, p?: string): BombRow[] => (p ? q("SELECT * FROM armory_bombs WHERE night=? AND p=? ORDER BY id").all(night, p) : q("SELECT * FROM armory_bombs WHERE night=? ORDER BY id").all(night)).map(rowOf),
    /** the bombs that fly tonight (paid; fired too, when a night is resolved again) */
    live: (night: number): BombRow[] => (q("SELECT * FROM armory_bombs WHERE night=? AND state IN ('paid','fired') ORDER BY id").all(night) as any[]).map(rowOf),
    /** Buy: all or nothing, inside one transaction (the balance is read and spent under the same lock). */
    buy: (p: string, night: number, items: { kind: BombKind; word: string; target: string | null; named?: boolean }[], at: number): { ok: true; ids: number[]; balance: number } | { ok: false; error: string; balance: number } => {
      const cost = priceOf(items.map(i => i.kind));
      if (cost === null || !items.length) return { ok: false, error: "pick a bomb", balance: balance(p) };
      q("BEGIN IMMEDIATE").run();
      try {
        const have = balance(p), held = (q("SELECT COUNT(*) n FROM armory_bombs WHERE night=? AND p=? AND state!='refunded'").get(night, p) as any).n as number;
        if (held + items.length > ARMORY.perNight) { q("ROLLBACK").run(); return { ok: false, error: `at most ${ARMORY.perNight} bombs a night (you have ${held})`, balance: have }; }
        if (cost > have) { q("ROLLBACK").run(); return { ok: false, error: `not enough credits: ${cost} needed, ${have} left`, balance: have }; }
        const ids: number[] = [];
        for (const it of items) { const r = q("INSERT INTO armory_bombs (night, p, kind, word, target, cost, ts, state, named) VALUES (?,?,?,?,?,?,?,'paid',?)").run(night, p, it.kind, it.word, it.target, bombOf(it.kind)!.cost, at, it.named && it.target ? 1 : 0); ids.push(Number(r.lastInsertRowid)); }
        credit(p, -cost, `armory: ${items.length} bomb${items.length === 1 ? "" : "s"}`, "night:" + night, at);
        q("COMMIT").run();
        return { ok: true, ids, balance: balance(p) };
      } catch (e) { try { q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
    },
    /** give a bomb's credits back (the buyer took it back while the window was open, or it could not fire) */
    refund: (id: number, why: string, at: number): boolean => {
      const b = S.get(id); if (!b || b.state !== "paid") return false;
      q("BEGIN IMMEDIATE").run();
      try { q("UPDATE armory_bombs SET state='refunded' WHERE id=? AND state='paid'").run(id); credit(b.p, b.cost, `armory refund: ${why}`, "bomb:" + id, at); q("COMMIT").run(); return true; }
      catch (e) { try { q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
    },
    fired: (id: number, k: number) => q("UPDATE armory_bombs SET state='fired', k=? WHERE id=?").run(k, id),
    /** paid bombs of nights that are over (resolved, or skipped because the hub was down) */
    stale: (beforeOrAt: number): BombRow[] => (q("SELECT * FROM armory_bombs WHERE state='paid' AND night<=?").all(beforeOrAt) as any[]).map(rowOf),
    report: (id: number, who: string, at: number): number => { const r = q("INSERT OR IGNORE INTO armory_reports VALUES (?,?,?)").run(id, who, at); if (r.changes) q("UPDATE armory_bombs SET reports=reports+1 WHERE id=?").run(id); return S.get(id)?.reports || 0; },
    hide: (id: number, on: boolean) => q("UPDATE armory_bombs SET hidden=? WHERE id=?").run(on ? 1 : 0, id),
    /** words of a night for the operator, the reported ones first */
    words: (night: number) => (q("SELECT * FROM armory_bombs WHERE night=? AND state='fired' ORDER BY reports DESC, id").all(night) as any[]).map(rowOf),
    reported: () => (q("SELECT * FROM armory_bombs WHERE reports>0 ORDER BY reports DESC, id DESC LIMIT 100").all() as any[]).map(rowOf),
    /** the daily battle reward (Mike 11-18): +ARMORY.reward once per night a player's city fired; true when paid now */
    reward: (p: string, night: number, at: number): boolean => {
      if (q("SELECT 1 FROM ledger WHERE who=? AND reason='battle reward' AND ref=?").get(p, "night:" + night)) return false;
      credit(p, ARMORY.reward, "battle reward", "night:" + night, at); return true;
    },
    rewarded: (p: string, night: number): number => Number((q("SELECT COALESCE(SUM(delta),0) s FROM ledger WHERE who=? AND reason='battle reward' AND ref=?").get(p, "night:" + night) as any).s) || 0,
    /** bombs a player holds for a night (paid, not refunded) */ held: (night: number, p: string): number => (q("SELECT COUNT(*) n FROM armory_bombs WHERE night=? AND p=? AND state!='refunded'").get(night, p) as any).n as number,
    hiddenIds: (ids: number[]): Set<number> => { if (!ids.length) return new Set(); return new Set((q(`SELECT id FROM armory_bombs WHERE hidden=1 AND id IN (${ids.map(() => "?").join(",")})`).all(...ids) as any[]).map(r => r.id)); },
    erase: (p: string) => { q("DELETE FROM armory_bombs WHERE p=?").run(p); q("DELETE FROM armory_reports WHERE who=?").run(p); },
  };
  return S;
}
export type ArmoryStore = ReturnType<typeof armoryStore>;

// ---------------------------------------------------------------- the player's Armory settings and alert bookkeeping
/** one row per player: time zone, the two alert switches (both on by default), the last night each alert went out for, and
 *  the token for the one-click unsubscribe from Armory emails */
export interface ArmoryPrefs { p: string; tz: string; open: boolean; remind: boolean; sentOpen: number; sentRemind: number; token: string }
export function armoryPrefs(q: Q, token: () => string) {
  q(`CREATE TABLE IF NOT EXISTS armory_prefs (p TEXT PRIMARY KEY, tz TEXT, open_on INTEGER DEFAULT 1, remind_on INTEGER DEFAULT 1, mail_on INTEGER DEFAULT 1, sent_open INTEGER DEFAULT 0, sent_remind INTEGER DEFAULT 0, token TEXT)`).run();
  const of = (r: any): ArmoryPrefs & { mail: boolean } => ({ p: r.p, tz: r.tz || "America/Los_Angeles", open: !!r.open_on, remind: !!r.remind_on, mail: !!r.mail_on, sentOpen: r.sent_open || 0, sentRemind: r.sent_remind || 0, token: r.token });
  const ensure = (p: string) => { q("INSERT OR IGNORE INTO armory_prefs (p, tz, token) VALUES (?,?,?)").run(p, "America/Los_Angeles", token()); return of(q("SELECT * FROM armory_prefs WHERE p=?").get(p)); };
  return {
    ensure, get: (p: string) => { const r = q("SELECT * FROM armory_prefs WHERE p=?").get(p); return r ? of(r) : null; },
    all: () => (q("SELECT * FROM armory_prefs").all() as any[]).map(of),
    setTz: (p: string, tz: string) => { ensure(p); q("UPDATE armory_prefs SET tz=? WHERE p=?").run(tz, p); },
    set: (p: string, o: { open?: boolean; remind?: boolean; mail?: boolean }) => { ensure(p);
      if (typeof o.open === "boolean") q("UPDATE armory_prefs SET open_on=? WHERE p=?").run(o.open ? 1 : 0, p);
      if (typeof o.remind === "boolean") q("UPDATE armory_prefs SET remind_on=? WHERE p=?").run(o.remind ? 1 : 0, p);
      if (typeof o.mail === "boolean") q("UPDATE armory_prefs SET mail_on=? WHERE p=?").run(o.mail ? 1 : 0, p); },
    /** claim a send: true once per player per night per kind (the row update is the lock) */
    claim: (p: string, kind: "open" | "remind", night: number) => { ensure(p); const col = kind === "open" ? "sent_open" : "sent_remind"; return q(`UPDATE armory_prefs SET ${col}=? WHERE p=? AND ${col}<?`).run(night, p, night).changes > 0; },
    byToken: (t: string) => { const r = q("SELECT * FROM armory_prefs WHERE token=?").get(t); return r ? of(r) : null; },
    erase: (p: string) => q("DELETE FROM armory_prefs WHERE p=?").run(p),
  };
}
export type ArmoryPrefsStore = ReturnType<typeof armoryPrefs>;

/** Which alert a player is due at `now` for the next night (null: none). Rules (frontier-design B1, B5): switch on, in the
 *  battles, balance >= minBuy, no bombs yet for that night, not sent before; the reminder only after its time and never
 *  within 3 hours of the open alert; nothing once the night has locked. */
export function alertDue(o: { now: number; tz: string; open: boolean; remind: boolean; sentOpen: number; sentRemind: number; balance: number; bought: number; war: boolean }): { kind: "open" | "remind"; night: number } | null {
  const w = armoryNow(o.now); if (!o.war || o.balance < ARMORY.minBuy || o.bought > 0 || o.now >= w.lock) return null;
  const ra = remindAt(w.night, o.tz);
  if (o.remind && ra !== null && o.now >= ra && o.sentRemind < w.night) return { kind: "remind", night: w.night };
  if (o.open && o.now >= openAlertAt(w.night, o.tz) && o.sentOpen < w.night && (ra === null || o.now < ra || !o.remind)) return { kind: "open", night: w.night };
  return null;
}

/** the bell row (and push text) for an alert; md for alertsStore's mdLite */
export function alertText(kind: "open" | "remind", o: { lock: number; tz: string; balance: number; reward: number }) {
  const at = clockIn(o.lock, o.tz), bal = `Balance: **${o.balance} credits**${o.reward > 0 ? `, +${o.reward} from the last battle` : ""}.`;
  if (kind === "open") return { title: "Your Armory is open", body: `Pick your bombs and write a word for the next battle. Locks at **${at}** your time.\n\n${bal}`,
    push: `Pick your bombs and write a word by ${at}. You have ${o.balance} credits${o.reward > 0 ? `, +${o.reward} from the last battle` : ""}.`, ctaLabel: "Open the Armory", ctaUrl: "/world#armory" };
  const soon = o.lock - Date.now() <= 75 * 60_000;
  return { title: soon ? "Armory locks in 1 hour" : `Armory locks at ${at}`, body: `You have no bombs for the next battle. Add one and write your word before **${at}**.\n\nBalance: **${o.balance} credits**.`,
    push: `No bombs picked for the next battle. Add one and write your word ${soon ? "by " + at : "before you sleep"}. ${o.balance} credits ready.`, ctaLabel: "Open the Armory", ctaUrl: "/world#armory" };
}

const ascii = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
const escH = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** The once-a-day "Armory open" email (frontier-design B4; markup from the approved mockup 02-alert-email.html). ASCII only. */
export function armoryEmail(o: { name: string; lock: number; tz: string; balance: number; reward: number; hub: string; unsubArmory: string; unsubAll: string; postal: string }) {
  const hub = o.hub.replace(/\/$/, ""), at = clockIn(o.lock, o.tz), pt = clockIn(o.lock, "America/Los_Angeles"), first = ascii(String(o.name || "").replace(/^@/, "").trim().split(/\s+/)[0] || "").replace(/[^A-Za-z0-9._'-]/g, "");
  // no usable name (empty, or not in Latin letters): no greeting line at all (Growth Engine 11-25: "Hi," was held by the mail guard)
  const hey = /[A-Za-z0-9]/.test(first) ? `Hey ${first},` : "";
  const url = `${hub}/world#armory`, set = `${hub}/settings#notifications`;
  const subject = ascii(`Your Armory is open until ${at}`), pre = ascii(`${o.balance} credits to spend. Pick your bombs and write a word before the battle.`);
  const text = ascii([...(hey ? [hey, ""] : []), "Your Armory is open for the next battle. Pick your bombs and write one word on each. The word rises over the hit in the replay, for everyone to see.", "",
    `Locks: ${at} your time (${pt} Pacific), 15 minutes before the battle`, `Balance: ${o.balance} credits`, ...(o.reward > 0 ? [`Last battle: +${o.reward} credits, because your city fired`] : []), "",
    `Open the Armory: ${url}`, "", "Bombs start at 5 credits. Credits are for the game only and have no cash value.", "",
    "You get this email once a day when your Armory opens.", `Turn off Armory emails: ${o.unsubArmory}`, `Unsubscribe from all Caldera email: ${o.unsubAll}`, `Caldera, ${o.postal}`].join("\n"));
  const td = (k: string, v: string) => `<tr><td style="padding:2px 16px 2px 0;color:#5F5C6B">${k}</td><td style="padding:2px 0">${v}</td></tr>`;
  const html = ascii(`<div style="margin:0;padding:20px 14px;background:#fff;color:#24222B;font:15px/1.55 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto">
<div style="display:none;max-height:0;overflow:hidden">${escH(pre)}</div>
${hey ? `<p style="margin:0 0 14px">${escH(hey)}</p>\n` : ""}<p style="margin:0 0 14px">Your Armory is open for the next battle. Pick your bombs and write one word on each. The word rises over the hit in the replay, for everyone to see.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:collapse;font:15px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#24222B">
${td("Locks", `<b>${escH(at)} your time</b> (${escH(pt)} Pacific), 15 minutes before the battle`)}
${td("Balance", `<b>${o.balance} credits</b>`)}${o.reward > 0 ? "\n" + td("Last battle", `+${o.reward} credits, because your city fired`) : ""}</table>
<p style="margin:0 0 18px"><a href="${escH(url)}" style="display:inline-block;background:#6E4FE0;color:#fff;text-decoration:none;font-weight:600;font-size:16px;line-height:48px;padding:0 26px;border-radius:999px">Open the Armory</a></p>
<p style="margin:0 0 22px;color:#5F5C6B;font-size:13.5px">Bombs start at 5 credits. Credits are for the game only and have no cash value.</p>
<p style="margin:0;padding-top:14px;border-top:1px solid #E4E4DF;color:#5F5C6B;font-size:12.5px;line-height:1.6">You get this email once a day when your Armory opens. <a href="${escH(o.unsubArmory)}" style="color:#5A3CD0">Turn off Armory emails</a> or <a href="${escH(o.unsubAll)}" style="color:#5A3CD0">unsubscribe from all Caldera email</a>. Settings: <a href="${escH(set)}" style="color:#5A3CD0">${escH(set)}</a><br>Caldera, ${escH(o.postal)}</p>
</div></div>`);
  return { subject, pre, text, html };
}
