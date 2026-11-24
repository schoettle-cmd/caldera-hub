/**
 * Caldera Points (LOOP.md part d, phase 1; spec 2026-11-24 section 5): a second currency, apart from the Armory credits.
 * Credits buy bombs; points buy promotion of a member's own project to other members (promote.ts).
 *
 * Rules (spec section 5, Mike 11-24): points are earned ONLY by work and play on Caldera (a won or held night, the daily
 * orders, a 7-night streak, the season podium). They are never sold or bought, have no cash value, cannot be sent to another
 * member and cannot be exchanged for money or crypto. Points earned in season n expire at the end of season n+1; the oldest
 * points are used first.
 *
 * The ledger keeps one row per change. Each row belongs to one season "bucket": an earn goes into the season it was earned
 * in; a spend takes from the oldest buckets first and writes one row per bucket it used; an expiry empties a whole bucket.
 * So the balance of a bucket is SUM(amount) for that season, and the oldest-first rule is in the data, not recomputed.
 * earn() is idempotent per (owner, kind, ref): a night, an order or a podium pays one time.
 */
import { DAY, dayOf } from "./growth";
import { WAR, RAIDERS, SWITCH_NIGHT, battleAt, resultOf, lastNight, type Shot } from "./battle";

type Q = (sql: string) => { run: (...a: any[]) => any; get: (...a: any[]) => any; all: (...a: any[]) => any[] };

/** LOOP.md d.2 (proposed; fixed for a season when set) */
export const POINTS = {
  won: 30, held: 20,
  order: { build: 20, fight: 10, scout: 10 } as Record<"build" | "fight" | "scout", number>,
  streak: 100, streakEvery: 7,
  podium: [1000, 600, 400],
  bid: { min: 20, max: 200, step: 10 },
  /** no member gets more than this share of the showings */ cap: 0.25,
  /** points are taken one time a day at 20:00 PT = 04:00 UTC (LOOP.md section 0 rule 10) */ spendHourUtc: 4,
};
export type OrderKind = keyof typeof POINTS.order;

/** the spend day: the day that ends at 20:00 PT, with the battle (lastNight: 04:00 UTC in winter, 03:00 in summer). Before the
 *  battle moved there (night 2026-11-24 ran at 10:00 UTC), the day that ended at 04:00 UTC. */
export const spendDayOf = (t: number) => t < battleAt(SWITCH_NIGHT - 1) ? dayOf(t - POINTS.spendHourUtc * 3600_000) : lastNight(t);

export interface SeasonOf { (night: number): { n: number; from: number } }
export interface LedgerRow { owner: string; ts: number; season: number; kind: string; ref: string; amount: number; note: string }

export function pointsStore(q: Q, o: { seasonOf: SeasonOf; now?: () => number }) {
  q(`CREATE TABLE IF NOT EXISTS points_ledger (owner TEXT, ts INTEGER, season INTEGER, kind TEXT, ref TEXT, amount INTEGER, note TEXT, UNIQUE (owner, kind, ref))`).run();
  q(`CREATE INDEX IF NOT EXISTS points_ledger_o ON points_ledger (owner, season)`).run();
  const now = () => (o.now ? o.now() : Date.now());
  const seasonNow = (t = now()) => o.seasonOf(lastNight(t)).n;
  /** the first night of season s (seasons are WAR.seasonDays long) */
  const fromOf = (s: number) => { const cur = o.seasonOf(lastNight(now())); return cur.from + (s - cur.n) * WAR.seasonDays; };
  /** the last day of season s, as a Date (shown as "end of season s") */
  const endOf = (s: number) => new Date((fromOf(s + 1) - 1) * DAY);
  const balanceOf = (owner: string): number => Number((q("SELECT COALESCE(SUM(amount),0) s FROM points_ledger WHERE owner=?").get(owner) as any).s) || 0;
  const buckets = (owner: string): { season: number; n: number }[] =>
    (q("SELECT season, SUM(amount) n FROM points_ledger WHERE owner=? GROUP BY season HAVING SUM(amount) > 0 ORDER BY season").all(owner) as any[]).map(r => ({ season: Number(r.season), n: Number(r.n) }));
  const insert = (r: Omit<LedgerRow, "ts"> & { ts?: number }) => q("INSERT OR IGNORE INTO points_ledger VALUES (?,?,?,?,?,?,?)").run(r.owner, r.ts ?? now(), r.season, r.kind, r.ref, Math.round(r.amount), r.note);
  const S = {
    balanceOf, buckets, seasonNow, endOf,
    /** a positive amount for work or play; one row for each (owner, kind, ref), so a night or an order pays one time.
     *  season: the season it was earned in (default: now). Returns true when it paid. */
    earn(owner: string, kind: string, ref: string, amount: number, note: string, season = seasonNow()): boolean {
      if (!owner || owner.startsWith("~") || owner.startsWith("uc:") || !(amount > 0)) return false;
      return Number(insert({ owner, season, kind, ref, amount, note }).changes) > 0;
    },
    /** take up to `amount`, oldest season first (one row per bucket used; refs get "#s{season}"). Idempotent per ref.
     *  Returns the points taken (less than asked when the balance is short). */
    spend(owner: string, amount: number, kind: string, ref: string, note: string): number {
      if (!(amount > 0)) return 0;
      if (q("SELECT 1 FROM points_ledger WHERE owner=? AND kind=? AND (ref=? OR ref LIKE ?) LIMIT 1").get(owner, kind, ref, ref + "#s%")) return 0;
      q("BEGIN IMMEDIATE").run();
      try {
        let left = Math.round(amount), took = 0; const at = now();
        for (const b of buckets(owner)) { if (left <= 0) break; const t = Math.min(left, b.n); insert({ owner, ts: at, season: b.season, kind, ref: `${ref}#s${b.season}`, amount: -t, note }); left -= t; took += t; }
        q("COMMIT").run(); return took;
      } catch (e) { try { q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
    },
    /** points that expire, oldest first: [{n, season, date}] (season s ends with season s+1) */
    expiringOf(owner: string): { n: number; season: number; ends: number; date: Date; days: number }[] {
      const t = now();
      return buckets(owner).map(b => { const date = endOf(b.season + 1); return { n: b.n, season: b.season, ends: b.season + 1, date, days: Math.ceil((date.getTime() + DAY - t) / DAY) }; });
    },
    /** at a season end: points of season s are gone once season s+2 starts. Idempotent. Returns the points expired. */
    expire(): number {
      const cur = seasonNow(); let total = 0;
      for (const r of q("SELECT owner, season, SUM(amount) n FROM points_ledger WHERE season <= ? GROUP BY owner, season HAVING SUM(amount) > 0").all(cur - 2) as any[]) {
        const n = Number(r.n); if (Number(insert({ owner: r.owner, season: Number(r.season), kind: "expire", ref: "s" + r.season, amount: -n, note: "Expired" }).changes)) total += n;
      }
      return total;
    },
    /** the rows of the last `days` days, newest first; a spend split over seasons is one row */
    history(owner: string, days = 30): LedgerRow[] {
      const rows = q("SELECT * FROM points_ledger WHERE owner=? AND ts>=? ORDER BY ts DESC, rowid DESC").all(owner, now() - days * DAY) as any[];
      const out: LedgerRow[] = [], by = new Map<string, LedgerRow>();
      for (const r of rows) { const base = r.kind + ":" + String(r.ref).replace(/#s\d+$/, ""), x = by.get(base);
        if (x) { x.amount += Number(r.amount); continue; }
        const row = { owner: r.owner, ts: Number(r.ts), season: Number(r.season), kind: r.kind, ref: String(r.ref), amount: Number(r.amount), note: String(r.note || "") }; by.set(base, row); out.push(row); }
      return out;
    },
    /** points used for one ref prefix since a time (the counts page: "Points used in these 7 days") */
    spentSince(owner: string, kind: string, refPrefix: string, since: number): number {
      return -Number((q("SELECT COALESCE(SUM(amount),0) s FROM points_ledger WHERE owner=? AND kind=? AND ref LIKE ? AND ts>=?").get(owner, kind, refPrefix + "%", since) as any).s) || 0;
    },
    erase: (owner: string) => q("DELETE FROM points_ledger WHERE owner=?").run(owner),

    // ------------------------------------------------------------ award calls (the night resolve, the evening turn, the season end)
    /** after a night is resolved: a won night +30 or a held night +20 (never both), and +100 for each 7 nights in a row that
     *  the city fought (shots in or out). prior(n): the stored shots of an earlier night. Returns what it paid. */
    awardNight(night: number, shots: Shot[], prior: (n: number) => Shot[]): { owner: string; kind: string; amount: number }[] {
      const paid: { owner: string; kind: string; amount: number }[] = [], season = o.seasonOf(night).n;
      const fought = (sh: Shot[]) => new Set(sh.flatMap(s => [s.a, s.d]).filter(id => id && id !== RAIDERS && !id.startsWith("uc:") && !id.startsWith("~")));
      const tonight = fought(shots);
      for (const id of tonight) {
        const r = resultOf(id, shots);
        if (r === "WON" && S.earn(id, "night", String(night), POINTS.won, "won", season)) paid.push({ owner: id, kind: "won", amount: POINTS.won });
        else if (r === "HELD" && S.earn(id, "night", String(night), POINTS.held, "held", season)) paid.push({ owner: id, kind: "held", amount: POINTS.held });
      }
      // streaks: walk back night by night while anyone is still in a run
      const run = new Map([...tonight].map(id => [id, 1] as [string, number]));
      let alive = new Set(tonight);
      for (let n = night - 1; alive.size && n > night - 400; n--) {
        const f = fought(prior(n)), next = new Set<string>();
        for (const id of alive) if (f.has(id)) { run.set(id, run.get(id)! + 1); next.add(id); }
        alive = next;
      }
      for (const [id, len] of run) if (len % POINTS.streakEvery === 0 && S.earn(id, "streak", String(night), POINTS.streak, "7-night streak", season)) paid.push({ owner: id, kind: "streak", amount: POINTS.streak });
      return paid;
    },
    /** the rows a night paid (the "Last night" card, LOOP.md c.6): the won or held night and the streak of that night, and the
     *  orders of the day before it (orders of day n-1 lead to night n) */
    nightRows(owner: string, night: number): LedgerRow[] {
      return (q("SELECT * FROM points_ledger WHERE owner=? AND ((kind IN ('night','streak') AND ref=?) OR (kind='order' AND ref LIKE ?)) ORDER BY rowid").all(owner, String(night), `${night - 1}:%`) as any[])
        .map(r => ({ owner: r.owner, ts: Number(r.ts), season: Number(r.season), kind: r.kind, ref: String(r.ref), amount: Number(r.amount), note: String(r.note || "") }));
    },
    hasOrder: (owner: string, day: number, kind: string): boolean => !!q("SELECT 1 FROM points_ledger WHERE owner=? AND kind='order' AND ref=?").get(owner, `${day}:${kind}`),
    /** one daily order done (LOOP.md c.3): Build +20, Fight +10, Scout +10; name = the order's words ("Merge a pull request") */
    awardOrder(owner: string, day: number, order: OrderKind, name: string): boolean {
      const amount = POINTS.order[order]; if (!amount) return false;
      return S.earn(owner, "order", `${day}:${order}`, amount, name, o.seasonOf(day).n);
    },
    /** the season podium: place 1, 2 or 3 at the end of season s */
    awardPodium(owner: string, season: number, place: 1 | 2 | 3): boolean {
      const amount = POINTS.podium[place - 1]; if (!amount) return false;
      return S.earn(owner, "podium", String(season), amount, String(place), season);
    },
  };
  return S;
}
export type PointsStore = ReturnType<typeof pointsStore>;

/** "Won night", "Order: Merge a pull request", ... (LOOP.md d.3) */
export function ledgerWhat(r: LedgerRow): string {
  switch (r.kind) {
    case "night": return r.note === "held" ? "Held night" : "Won night";
    case "order": return `Order: ${r.note}`;
    case "streak": return "7-night streak";
    case "podium": return `Season ${r.season} podium`;
    case "promo": return r.note;
    case "expire": return "Expired";
    default: return r.note || r.kind;
  }
}
