// Mike 11-19 (868px, logged out): "Sign in" ran over "Guide". 761-1099px: nav icons only, current page keeps its word.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const SRC = fs.readFileSync(new URL("../dist/server.js", import.meta.url), "utf8");
test("top bar: icon-only links between 761 and 1099px, word as tooltip", () => {
  assert.match(SRC, /@media \(min-width:761px\) and \(max-width:1099px\)\{\.ch-nav\{gap:4px\}\.ch-nav a:not\(\[aria-current="page"\]\)\{width:40px/);
  assert.match(SRC, /:is\(:hover,:focus-visible\)>span:not\(\.ch-badge\)\{opacity:1\}/);
  assert.match(SRC, /@media \(min-width:761px\) and \(max-width:899px\)\{\.ch-acct \.ch-hd\{display:none\}/);
});
