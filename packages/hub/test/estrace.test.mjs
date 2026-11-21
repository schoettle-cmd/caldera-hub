import { test } from "node:test";
import assert from "node:assert/strict";
const S = await import("../dist/server.js");

test("ES tracer: snippet goes right after <head> with data-product caldera", () => {
  const out = S.traceInject('<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body></body></html>', "/world", "default-src 'self'");
  assert.match(out, /<head><script>window\.esTrace=window\.esTrace\|\|function\(\)\{\(esTrace\.q=esTrace\.q\|\|\[\]\)\.push\(arguments\)\}<\/script><script src="https:\/\/mjonesone\.com\/estrace\/t\.js" data-product="caldera" defer><\/script><meta/);
  assert.equal(S.traceInject(out, "/world", ""), out, "only once");
});

test("ES tracer: never on private routes or sandboxed city pages", () => {
  const h = "<html><head></head></html>";
  for (const p of ["/settings/page", "/admin", "/v1/world", "/messages", "/messages/x", "/signin", "/start", "/claim/abc", "/email/x", "/setup/github", "/auth/x", "/login", "/api/x"]) assert.equal(S.traceInject(h, p, ""), h, p);
  assert.equal(S.traceInject(h, "/@mike/", "sandbox allow-scripts; default-src 'none'"), h);
  for (const p of ["/", "/world", "/people", "/leaderboard", "/gh/octocat"]) assert.notEqual(S.traceInject(h, p, ""), h, p);
});

test("ES tracer: CSP allows mjonesone.com for script and connect, once", () => {
  const w = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'";
  const c = S.cspWithTrace(w);
  assert.match(c, /script-src 'self' 'unsafe-inline' https:\/\/mjonesone\.com/); assert.match(c, /connect-src 'self' https:\/\/mjonesone\.com/);
  assert.equal(S.cspWithTrace(c), c);
  assert.match(S.cspWithTrace("default-src 'self'"), /script-src 'self' https:\/\/mjonesone\.com; connect-src 'self' https:\/\/mjonesone\.com/);
  assert.equal(S.cspWithTrace("sandbox allow-scripts; default-src 'none'"), "sandbox allow-scripts; default-src 'none'");
});
