// World plots by relationship (world.ts closenessOrder): people who talk more end up next to each other, the founder
// first (the hub at the centre), strangers keep their place, nobody jumps more than a few places a night, deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closenessOrder } from "../dist/server.js";
const T = (pairs) => new Map(pairs.map(([a, b, w]) => [a < b ? a + "|" + b : b + "|" + a, w]));
test("talkers sit together, founder first, strangers stay put, small steps, same answer twice", () => {
  const base = ["ana", "s1", "bo", "s2", "cy", "s3", "di", "s4"];
  const ties = T([["ana", "di", 9], ["di", "bo", 6], ["bo", "cy", 1]]);
  const o = closenessOrder(base, ties, "ana", base, 99);
  assert.equal(o[0], "ana"); assert.deepEqual(o.filter(h => !/^s\d$/.test(h)), ["ana", "di", "bo", "cy"], "the chain follows who talks most: ana-di, di-bo, bo-cy");
  for (const s of ["s1", "s2", "s3", "s4"]) assert.equal(o.indexOf(s), base.indexOf(s), s + " keeps its place");
  assert.deepEqual(closenessOrder(base, ties, "ana", base, 99), o, "deterministic");
  const small = closenessOrder(base, ties, "ana", base, 1);
  for (const h of base) assert.ok(Math.abs(small.indexOf(h) - base.indexOf(h)) <= 2, h + " moved at most a little");
});
