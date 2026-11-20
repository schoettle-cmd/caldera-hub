// The viewer's Storefronts switch (Mike 11-19). Hosted cities are sandboxed (no storage), so /@handle/sf keeps the choice
// in a first-party cookie and goes back; the city page then starts with storefronts hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sfOff, sfInject, sfRedirect, SF_COOKIE } from "../dist/server.js";

function fakeRes() { const r = { status: 0, h: {}, ended: false, writeHead(s, h) { r.status = s; r.h = h; }, end() { r.ended = true; } }; return r; }

test("sf route: sets the cookie and goes back to a page beside it only", () => {
  let r = fakeRes(); sfRedirect(r, new URL("https://x/@mike/sf?on=0&back=city.html%3Fview%3Dpublic"));
  assert.equal(r.status, 303); assert.equal(r.h.location, "city.html?view=public");
  assert.match(r.h["set-cookie"], new RegExp(`^${SF_COOKIE}=0; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly$`));
  r = fakeRes(); sfRedirect(r, new URL("https://x/@mike/sf?on=1&back=https%3A%2F%2Fevil.example%2F"));
  assert.equal(r.h.location, "city.html"); assert.match(r.h["set-cookie"], /^caldera_sf=1;/);
  r = fakeRes(); sfRedirect(r, new URL("https://x/@mike/sf?on=0&back=..%2Fother.html")); assert.equal(r.h.location, "city.html");
  r = fakeRes(); sfRedirect(r, new URL("https://x/@mike/sf?on=0&back=%2F%2Fevil.example")); assert.equal(r.h.location, "city.html");
});

test("city page starts with storefronts hidden only for a viewer who turned them off", () => {
  const html = "<html><head><title>c</title></head><body></body></html>";
  assert.equal(sfInject(html, { headers: {} }), html);
  assert.equal(sfInject(html, { headers: { cookie: "a=1; caldera_sf=1" } }), html);
  assert.ok(sfOff({ headers: { cookie: "a=1; caldera_sf=0" } }));
  assert.ok(!sfOff({ headers: { cookie: "xcaldera_sf=0" } }));
  assert.match(sfInject(html, { headers: { cookie: "caldera_sf=0" } }), /<script>window\.CALDERA_SF=0<\/script><\/head>/);
});
