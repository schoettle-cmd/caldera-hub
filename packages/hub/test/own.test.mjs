// Our own and test addresses (own.ts): nothing personal is built in; the lists come from the environment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnAddress, isTestAddress } from "../dist/own.js";

test("the reserved example domains are always ours; nothing else is without config", () => {
  for (const e of ["a@example.com", "B@Example.ORG", " c+tag@example.net "]) assert.equal(isOwnAddress(e, {}), true, e);
  for (const e of ["a@gmail.com", "a@sub.example.com", "a@notexample.com", "", "no-at-sign", "@example.com"]) assert.equal(isOwnAddress(e, {}), false, e);
});
test("CALDERA_OWN_EMAILS: the mailbox and its +tags, any case, nobody else at that domain", () => {
  const env = { CALDERA_OWN_EMAILS: "Owner@mail.test, second@mail.test" };
  for (const e of ["owner@mail.test", "OWNER+caldera@mail.test", "second+x@mail.test"]) assert.equal(isOwnAddress(e, env), true, e);
  for (const e of ["owner2@mail.test", "owner@other.test", "third@mail.test"]) assert.equal(isOwnAddress(e, env), false, e);
});
test("CALDERA_OWN_DOMAINS: every address at the domain, not its subdomains or look-alikes", () => {
  const env = { CALDERA_OWN_DOMAINS: "corp.test @ours.test" };
  for (const e of ["a@corp.test", "b+c@ours.test"]) assert.equal(isOwnAddress(e, env), true, e);
  for (const e of ["a@x.corp.test", "a@notcorp.test", "a@corp.test.evil.test"]) assert.equal(isOwnAddress(e, env), false, e);
});
test("CALDERA_TEST_DOMAINS count as test sign-ups, not as our own", () => {
  const env = { CALDERA_OWN_DOMAINS: "corp.test", CALDERA_TEST_DOMAINS: "robots.test" };
  assert.equal(isTestAddress("bot+1@robots.test", env), true);
  assert.equal(isOwnAddress("bot+1@robots.test", env), false);
  assert.equal(isTestAddress("a@corp.test", env), true);
  assert.equal(isTestAddress("a@real.test", env), false);
});
