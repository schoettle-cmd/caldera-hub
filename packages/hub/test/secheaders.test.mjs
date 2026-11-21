// Security headers: every response carries a Content-Security-Policy (the static site pages a strict one, pages that set
// their own keep it), the older headers stay, and /.well-known/security.txt says where to report a problem (RFC 9116).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createHub } from "../dist/server.js";

let hub, base, dir, site;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-sec-")); site = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-sec-site-"));
  fs.writeFileSync(path.join(site, "index.html"), "<!doctype html><title>home</title><body>home</body>");
  fs.writeFileSync(path.join(site, "guide.html"), "<!doctype html><title>guide</title><body>guide</body>");
  fs.writeFileSync(path.join(site, "robots.txt"), "User-agent: *\n");
  hub = createHub({ dataDir: dir, publicUrl: "https://hub.test", siteDir: site, email: { send: async () => {} } });
  base = "http://127.0.0.1:" + await hub.listen(0);
});
after(() => { hub.server.closeAllConnections?.(); hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(site, { recursive: true, force: true }); });
const head = async p => (await fetch(base + p, { redirect: "manual" })).headers;

test("static site pages: a strict policy, next to the headers that were already there", async () => {
  for (const p of ["/", "/guide"]) {
    const h = await head(p), csp = h.get("content-security-policy") || "";
    assert.match(csp, /default-src 'self'/, p); assert.match(csp, /form-action 'self'/, p); assert.match(csp, /frame-ancestors 'none'/, p);
    assert.match(csp, /object-src 'none'/, p); assert.match(csp, /base-uri 'none'/, p);
    assert.doesNotMatch(csp, /img-src[^;]*https:/, p + ": no images from other hosts");
    assert.equal(h.get("x-content-type-options"), "nosniff"); assert.equal(h.get("x-frame-options"), "DENY");
    assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin"); assert.equal(h.get("strict-transport-security"), "max-age=31536000");
  }
});
test("everything else carries a policy too: the API, other files, a 404", async () => {
  for (const p of ["/v1/world/battle", "/robots.txt", "/no-such-page", "/signin"]) {
    const csp = (await head(p)).get("content-security-policy") || "";
    assert.match(csp, /default-src 'self'/, p); assert.match(csp, /frame-ancestors 'none'/, p); assert.match(csp, /object-src 'none'/, p);
  }
});
test("a page that sets its own policy keeps it", async () => {
  const csp = (await head("/leaderboard")).get("content-security-policy") || "";
  assert.match(csp, /connect-src 'self' https:\/\/mjonesone\.com; base-uri 'none'; form-action 'self'/, "its own policy, plus the ES tracer host (MB 11-21)");
  assert.doesNotMatch(csp, /object-src/, "the leaderboard's own policy, not the default one");
});
test("security.txt: contact, an expiry in the future, canonical on this hub", async () => {
  for (const p of ["/.well-known/security.txt", "/security.txt"]) {
    const r = await fetch(base + p); assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /^text\/plain/);
    const t = await r.text();
    assert.match(t, /^Contact: mailto:\S+@\S+$/m); assert.match(t, /^Canonical: https:\/\/hub\.test\/\.well-known\/security\.txt$/m); assert.match(t, /^Policy: https:\/\/hub\.test\/security$/m);
    const exp = Date.parse(t.match(/^Expires: (\S+)$/m)[1]); assert.ok(exp > Date.now() + 150 * 86_400_000 && exp < Date.now() + 366 * 86_400_000, "five to twelve months out");
  }
});
