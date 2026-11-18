// Mike 11-18, twice: "Remove boundaries on caldera" / "No boundries". A bomb word has no filter: only empty and too long
// are refused. GitHub names on the map are not filtered either.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const out = await build({ entryPoints: [new URL("../src/armory.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false });
const A = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const { checkWord, ARMORY } = A;

test("bomb words: no filter, only empty and too long are refused", () => {
  for (const w of ["sh1t", "SAM", "www.x.com", "5551234567", "héllo wörld", "@ana", "a-b_c!", "🔥🔥🔥"]) assert.equal(checkWord(w, ["sam"]).ok, true, w);
  assert.equal(checkWord("").ok, false); assert.equal(checkWord("   ").ok, false);
  assert.equal(checkWord("x".repeat(ARMORY.wordMax)).ok, true); assert.equal(checkWord("x".repeat(ARMORY.wordMax + 1)).ok, false);
  assert.equal(checkWord("a\u0000b").word, "a b", "control characters become a space");
  assert.equal("nameBlocked" in A, false, "no name filter for the map"); assert.equal("WORD_REFUSED" in A, false);
});
