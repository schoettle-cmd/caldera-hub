// The farm judge (Mike 11-24, spec ~/growth/notes/specs/2026-11-24-caldera-battle-loop.md section 1): one judge for city and
// battle, the battle arsenal on the city's daily caps, the season score weighted by the recount's share. No ban, counts only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const load = async (f) => { const { build } = await import("esbuild"); const o = await build({ entryPoints: [new URL("../src/" + f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false }); return import("data:text/javascript;base64," + Buffer.from(o.outputFiles[0].text).toString("base64")); };
const G = await load("growth.ts"), B = await load("battle.ts");
const DAY = 86400000, D = 20770, T0 = D * DAY + 3600_000;
const it = (i, title, o = {}) => ({ id: "c:" + i, ts: o.ts ?? T0 + i * 60_000, tt: G.ttKey(title), ...(o.sm !== undefined ? { sm: o.sm } : {}) });

test("title templates: digits and dates out; the 5 war-room templates are 5 keys", () => {
  assert.equal(G.titleTemplate("Leaderboard snapshot 11-14"), "leaderboard snapshot");
  assert.equal(G.ttKey("README standings 11-14"), G.ttKey("README standings 11-20\n\nbody"));
  assert.equal(G.ttKey("History row 2026-11-14T03:00:00Z"), G.ttKey("History row 2026-11-15"));
  assert.notEqual(G.ttKey("Rival report 1-2"), G.ttKey("Latest standings 1-2"));
  assert.equal(G.smallOf({ stats: { total: 2 }, files: [{}] }), 1); assert.equal(G.smallOf({ stats: { total: 95 }, files: [{}] }), 1, "a generated data file (the live farm)"); assert.equal(G.smallOf({ stats: { total: 201 }, files: [{}] }), 0);
  assert.equal(G.smallOf({ stats: { total: 2 }, files: [{}, {}] }), 0); assert.equal(G.smallOf({}), undefined);
});

test("farm: a day of 5 templates x 96 small commits keeps 1 per template; real work and real bursts stay", () => {
  const T = ["Leaderboard snapshot", "README standings", "Rival report", "Latest standings", "History row"], items = [];
  let k = 0; for (let n = 0; n < 96; n++) for (const t of T) { items.push(it(k, `${t} ${n}-${n + 1}`, { ts: T0 + Math.floor(k / 3) * 1000, sm: k < 15 ? 1 : undefined })); k++; }
  const f = G.farmIds(items); assert.equal(f.size, 480 - 5, "480 a day -> 5 counted");
  // a rebase: 30 commits in the same second with different titles, each big or small: all stay
  const rebase = Array.from({ length: 30 }, (_, i) => it(1000 + i, ["Fix login", "Add tests", "Refactor parser", "Bump deps", "Docs", "Tidy CSS"][i % 6] + " for " + ["api", "web", "cli", "core", "db"][Math.floor(i / 6)], { ts: T0, sm: 1 }));
  assert.equal(G.farmIds(rebase).size, 0);
  // 5 real "wip" commits that are big: stay
  assert.equal(G.farmIds(Array.from({ length: 6 }, (_, i) => it(2000 + i, "wip", { sm: i === 0 ? 0 : undefined }))).size, 0);
  // size unknown: nothing yet, and the judge asks for a sample of 3
  const unk = Array.from({ length: 7 }, (_, i) => it(3000 + i, `Snapshot ${i}`));
  assert.equal(G.farmIds(unk).size, 0); assert.deepEqual(G.farmNeeds(unk), ["c:3000", "c:3001", "c:3002"]);
  // a burst of the same template in one second (size unknown): from the 6th on
  const burst = Array.from({ length: 9 }, (_, i) => it(4000 + i, `Sync ${i}`, { ts: T0 }));
  assert.equal(G.farmIds(burst).size, 4);
  // 4 small repeats a day are not a farm
  assert.equal(G.farmIds(Array.from({ length: 4 }, (_, i) => it(5000 + i, `Note ${i}`, { sm: 1 }))).size, 0);
});

test("store: refarm flips only '' <-> 'farm', keeps other voids, dry writes nothing", () => {
  const db = new DatabaseSync(":memory:"), q = (s) => db.prepare(s), S = G.growthStore(q);
  for (let i = 0; i < 8; i++) S.add({ id: "c:" + i, p: "p1", k: "commit", repo: "o/farm", ts: T0 + i * 1000, seen: T0, n: 1, v: i === 7 ? "empty" : "", x: { tt: G.ttKey("Snap " + i), sm: 1 } });
  assert.deepEqual(S.refarm("p1", "o/farm", D, true), { farm: 7, voided: 6, restored: 0 });
  assert.equal(S.farmCounts(0).length, 0, "dry: nothing written");
  S.refarm("p1", "o/farm", D); assert.deepEqual(S.farmCounts(0), [{ p: "p1", repo: "o/farm", n: 6 }]);
  assert.equal(S.get("c:7").v, "empty"); assert.equal(S.get("c:0").v, "");
  S.setX("c:3", { tt: G.ttKey("Snap 3"), sm: 0 }); assert.equal(S.refarm("p1", "o/farm", D).restored, 6, "a big one in the group: the group is not a farm");
});

test("battle arsenal (switch CALDERA_BATTLE_CAP): the city's daily caps (40 a repo then a fifth, 40 a day with private); the old count without caps", () => {
  const ev = (i, repo, k = "commit") => ({ id: "c:" + i.toString(16).padStart(8, "0"), p: "p", k, repo, ts: D * DAY + 3600_000 + i * 1000, seen: D * DAY + 3600_000 + i * 1000, n: 1, v: "" });
  const many = Array.from({ length: 480 }, (_, i) => ev(i, "o/farm"));
  const capped = B.arsenal(many, D, { cap: true }), old = B.arsenal(many, D, { cap: false });
  assert.equal(old.raw, 480 * 1); assert.ok(capped.raw <= 40 + 1e-9, "40 a day at most: " + capped.raw); assert.equal(capped.c, 480, "c still says what was seen");
  const two = [...Array.from({ length: 30 }, (_, i) => ev(i, "o/a")), ...Array.from({ length: 30 }, (_, i) => ev(100 + i, "o/b"))];
  assert.equal(B.arsenal(two, D, { cap: true }).raw, B.arsenal(two.slice(0, 40), D, { cap: true }).raw, "60 across two repos counts as 40");
  assert.equal(B.arsenal(many, D).raw, 480, "switch off (the default, Mike 11-13): no cap");
  const six = Array.from({ length: 6 }, (_, i) => ev(i, "o/a"));
  assert.equal(B.arsenal(six, D, { cap: true }).raw, B.arsenal(six, D, { cap: false }).raw, "a normal day is unchanged");
});

test("season score: a night's damage is weighted by the recount's share; held damage is not", () => {
  const shot = (a, d, u) => ({ k: 1, a, d, w: "shell", ammo: 1, roll: 0, f: 0.1, lot: 0, t: 0, aim: 0, blocked: 0, night: D, x: { u, fi: 0, fu: 0, sp: 0, m: 0, cep: 1, r: 1, kpa: 1, c: 1, fl: 1, v: 1, sh: 0, cd: 1, st: 1, pc: 1, raw: 1 } });
  const shots = [shot("orion", "ann", 1000), shot("ann", "orion", 500)];
  const plain = B.scoreOf(shots, () => 1), fair = B.scoreOf(shots, () => 1, (n, id) => id === "orion" ? 0.1 : 1);
  assert.equal(fair.get("ann"), plain.get("ann")); assert.ok(fair.get("orion") < plain.get("orion"));
});
