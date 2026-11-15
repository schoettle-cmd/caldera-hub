/**
 * Which sign-ups are the operator's own: their addresses and test accounts are left out of the funnel numbers and go to
 * partners as test events. Nothing is built in except the reserved example.com / .org / .net domains; the rest is config:
 *   CALDERA_OWN_EMAILS    comma list of addresses (a +tag on the same mailbox matches too)
 *   CALDERA_OWN_DOMAINS   comma list of domains (every address at that domain)
 *   CALDERA_TEST_DOMAINS  comma list of further domains used only for test sign-ups (robot inboxes); see isTestAddress
 * Read on every call, so a test or an operator can change the lists without a rebuild.
 */
type Env = Record<string, string | undefined>;
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];
const envList = (v?: string) => String(v || "").toLowerCase().split(/[\s,]+/).map(s => s.replace(/^@/, "")).filter(Boolean);
function addrParts(email: string): { local: string; domain: string } | null {
  const e = String(email || "").trim().toLowerCase(), at = e.lastIndexOf("@");
  return at < 1 || at === e.length - 1 ? null : { local: e.slice(0, at).replace(/\+.*$/, ""), domain: e.slice(at + 1) };
}

/** the operator's own address (or a reserved example address) */
export function isOwnAddress(email: string, env: Env = process.env): boolean {
  const p = addrParts(email); if (!p) return false;
  if (RESERVED_DOMAINS.includes(p.domain) || envList(env.CALDERA_OWN_DOMAINS).includes(p.domain)) return true;
  return envList(env.CALDERA_OWN_EMAILS).some(o => { const q = addrParts(o); return !!q && q.domain === p.domain && q.local === p.local; });
}

/** own, or at one of the test-only domains */
export function isTestAddress(email: string, env: Env = process.env): boolean {
  if (isOwnAddress(email, env)) return true;
  const p = addrParts(email); return !!p && envList(env.CALDERA_TEST_DOMAINS).includes(p.domain);
}
