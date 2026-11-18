// Map overlay probe (Mike 11-18: "ui ux issue here overlap": the city card opened under the battle status pill, hiding the
// name). On /world (plain and Battle view) at phone, Duo and desktop sizes: open a city card and fail if it overlaps the
// status pill or any tool chip. No screenshots unless a dir is given. Prints OVERLAY PASS or OVERLAY FAIL.
// Usage: node scripts/overlay-probe.mjs [base] [screenshotDir]
import { chromium } from '/Users/mjones/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
const BASE = process.argv[2] || 'https://caldera.social', outdir = process.argv[3];
const sizes = [[360, 740, true], [390, 844, true], [466, 678, true], [669, 951, true], [951, 669, false], [1366, 800, false], [1920, 1080, false]];
const b = await chromium.launch({ channel: 'chrome' }); const fails = [];
// INJECT=<file.js>: check a fix before deploying (the live page with that script added before </body>)
const INJ = process.env.INJECT ? (await import('node:fs')).readFileSync(process.env.INJECT, 'utf8') : null;
for (const view of ['battle', 'now']) for (const [w, h, mob] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (INJ) await p.route(/\/world(\?.*)?$/, async r => { const res = await r.fetch(); const t = await res.text(); await r.fulfill({ response: res, body: t.replace('</body>', '<script>' + INJ.replace(/<\/script/gi, '<\\/script') + '</script></body>') }); });
  await p.goto(`${BASE}/world?view=${view}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(view === 'battle' ? 5000 : 2500);
  // open a card the way the page does (a filled #card, unhidden), with a name line at the top
  await p.evaluate(() => { const c = document.getElementById('card'); if (!c) return; c.innerHTML = '<h3>Probe Name</h3><div class="k">@probe</div>' + '<div class="row"><span>Row</span><b>1</b></div>'.repeat(14); c.hidden = false; });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 && e.getBoundingClientRect().width > 0; };
    const c = document.getElementById('card'); if (!c || !vis(c)) return { skip: 'no card' };
    const C = c.getBoundingClientRect(), H = c.querySelector('h3').getBoundingClientRect(), bad = [];
    for (const e of document.querySelectorAll('#stage .b-chip, #stage .c-tools button')) { if (!vis(e)) continue; const R = e.getBoundingClientRect();
      const ox = Math.min(C.right, R.right) - Math.max(C.left, R.left), oy = Math.min(C.bottom, R.bottom) - Math.max(C.top, R.top);
      if (ox > 1 && oy > 1) bad.push(`${e.className || e.tagName}:${(e.textContent || '').trim().slice(0, 18)} (${Math.round(ox)}x${Math.round(oy)})`); }
    const top = document.elementFromPoint(H.left + 4, H.top + H.height / 2); if (!(top && (top === c || c.contains(top)))) bad.push('name line covered by ' + (top ? (top.className || top.tagName) + ' in ' + ((top.closest('[class]') || {}).className || '?') + '/' + ((top.parentElement || {}).className || '') : 'nothing'));
    return { bad };
  });
  if (outdir) await p.screenshot({ path: `${outdir}/overlay-${view}-${w}x${h}.png` });
  const tag = `${view} ${w}x${h}`;
  if (r.skip) fails.push(`${tag}: ${r.skip}`); else if (r.bad.length) fails.push(`${tag}: ${r.bad.join('; ')}`);
  console.log(tag, r.skip || (r.bad.length ? 'OVERLAP ' + r.bad.join('; ') : 'clear'), errs.length ? 'errs ' + errs.length : '');
  await ctx.close();
}
await b.close();
if (fails.length) { console.log('OVERLAY FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('OVERLAY PASS');
