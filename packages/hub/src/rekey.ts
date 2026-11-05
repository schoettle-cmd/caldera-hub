import crypto from "node:crypto";

/** Privacy (2026-11-05): per-visitor ids are kept 14 days. After that each id is replaced with a random-looking one made
 *  with a key that exists only for this run and is never stored, so the record can no longer be traced back to an IP
 *  address or browser, even by us with the original salt. Rows stay countable: the same id within a run maps to the same
 *  new id, and every stored id already contains its day, so per-day distinct counts are unchanged. Re-keyed ids start
 *  with "r" (16 characters, like the originals) and are left alone afterwards.
 *  `older` is an SQL condition on the row's day/time with one "?" for the cutoff. Returns the number of ids re-keyed. */
export function rekeyOld(q: (sql: string) => any, table: string, col: string, older: string, cutoff: string): number {
  const ids = (q(`SELECT DISTINCT ${col} v FROM ${table} WHERE ${older} AND ${col} IS NOT NULL AND substr(${col},1,1) <> 'r'`).all(cutoff) as { v: string }[]).map(r => r.v);
  if (!ids.length) return 0;
  const key = crypto.randomBytes(32), upd = q(`UPDATE ${table} SET ${col}=? WHERE ${col}=? AND ${older}`);
  q("BEGIN").run();
  try { for (const v of ids) upd.run("r" + crypto.createHmac("sha256", key).update(String(v)).digest("hex").slice(0, 15), v, cutoff); q("COMMIT").run(); }
  catch (e) { try { q("ROLLBACK").run(); } catch { /* none open */ } throw e; }
  return ids.length;
}
export const ID_KEEP_DAYS = 14;
