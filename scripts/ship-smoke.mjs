// Browser smoke after every hub deploy (MasterBuilder 2026-11-03, after HA's blank-screen morning): the landing, a profile
// and the directory must render real content in a fresh browser, and the API must answer. Prints SMOKE PASS or SMOKE FAIL.
// There is no Caldera demo account, so signed-in pages are not covered. Usage: node scripts/ship-smoke.mjs [base]
import { chromium } from '/Users/mjones/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
const BASE = process.argv[2] || 'https://caldera.social', fails = [];
const b = await chromium.launch({ channel: 'chrome' });
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  for (const [path, must] of [['/', /caldera/i], ['/@mike/', /Michael|Mike/], ['/people', /@[a-z0-9-]+/i]]) {
    const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
    const r = await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => null);
    await p.waitForTimeout(2500);
    const t = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    if (!r || r.status() >= 400) fails.push(`${path}: HTTP ${r ? r.status() : 'no response'}`);
    else if (t.length < 200 || !must.test(t)) fails.push(`${path}: nearly blank or missing content (${t.length} chars)`);
    if (errs.length) fails.push(`${path}: page errors: ${errs.slice(0, 2).join(' | ')}`);
    await p.close();
  }
  const info = await fetch(BASE + '/v1/info').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!info) fails.push('/v1/info did not answer');
} catch (e) { fails.push('smoke crashed: ' + e.message); }
await b.close();
if (fails.length) { console.log('SMOKE FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('SMOKE PASS');
