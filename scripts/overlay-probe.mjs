// Map overlay probe (Mike 11-18: "ui ux issue here overlap": the city card opened under the battle status pill, hiding the
// name). On /world (plain and Battle view) at phone, Duo and desktop sizes: open a city card and fail if it overlaps the
// status pill or any tool chip. Also (MB 11-18) on a member city at zoom-in and mid zoom: fail if a building label or
// agent tag is drawn under a toolbar chip or past the frame edge. No screenshots unless a dir is given. Prints OVERLAY PASS or OVERLAY FAIL.
// Usage: node scripts/overlay-probe.mjs [base] [screenshotDir]
import { chromium } from '/Users/mjones/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
const BASE = process.argv[2] || 'https://caldera.social', outdir = process.argv[3];
const sizes = [[360, 740, true], [390, 844, true], [466, 678, true], [669, 951, true], [951, 669, false], [1366, 800, false], [1920, 1080, false]];
const b = await chromium.launch({ channel: 'chrome' }); const fails = [];
// INJECT=<file.js>: check a fix before deploying (the live page with that script added before </body>)
const INJ = process.env.INJECT ? (await import('node:fs')).readFileSync(process.env.INJECT, 'utf8') : null;
for (const view of ['battle', 'now']) for (const [w, h, mob] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 }); await ctx.addInitScript(() => { window.ES_TRACE_BOT = true; });   // ES tracer: robot session
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
// city labels and agent tags vs the toolbar and the frame. CITY=<@handle> (default @mike); CITYJS=<bundle.mjs> CITYOLD=<bundle.mjs>
// swap the live CITY_JS for a new build to check a fix before deploying
const CITY = process.env.CITY || '@mike';
let NEU = null, OLD = null; if (process.env.CITYJS) { NEU = (await import(process.env.CITYJS)).CITY_JS; OLD = (await import(process.env.CITYOLD)).CITY_JS; }
for (const [w, h, mob] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 }); await ctx.addInitScript(() => { window.ES_TRACE_BOT = true; });   // ES tracer: robot session
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (NEU) await p.route(/\/city\.html/, async r => { const res = await r.fetch(); let t = await res.text(); const i = t.indexOf(OLD.slice(0, 300)); if (i >= 0) t = t.slice(0, i) + NEU.replace(/<\/script/gi, '<\\/script') + t.slice(i + OLD.length); else errs.push('bundle not found'); await r.fulfill({ response: res, body: t }); });
  await p.goto(`${BASE}/${CITY}/city.html#test`, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(5000);
  for (const z of [2.6, 1.6]) {
    await p.evaluate(z => { const T = window.calderaTest; if (!T) return; const bs = T.buildings().filter(x => x.name); const t = bs.find(x => x.name === 'crypto-trader') || bs[0]; if (t) T.look(t.name, z, 40); }, z);
    await p.waitForTimeout(2000);
    const r = await p.evaluate(() => {
      const T = window.calderaTest; if (!T || !T.uiBoxes) return { skip: 'no uiBoxes hook' };
      const U = T.uiBoxes(), F = U.frame, bad = [], vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > .05 && e.getBoundingClientRect().width > 0; };
      const chips = [...document.querySelectorAll('.c-tools button')].filter(vis).map(e => ({ n: (e.textContent || e.title || '').trim().slice(0, 14), r: e.getBoundingClientRect() }));
      for (const [kind, L] of [['label', U.labels], ['agent tag', U.agents]]) for (const q of L) {
        if (q.x0 < F.x0 - 1 || q.y0 < F.y0 - 1 || q.x1 > F.x1 + 1 || q.y1 > F.y1 + 1) bad.push(`${kind} past the frame edge`);
        for (const c of chips) { const ox = Math.min(q.x1, c.r.right) - Math.max(q.x0, c.r.left), oy = Math.min(q.y1, c.r.bottom) - Math.max(q.y0, c.r.top); if (ox > 1 && oy > 1) bad.push(`${kind} under chip ${c.n}`); }
      }
      return { bad: [...new Set(bad)], n: U.labels.length + U.agents.length };
    });
    const tag = `city ${CITY} z${z} ${w}x${h}`;
    if (outdir) await p.screenshot({ path: `${outdir}/overlay-city-z${z}-${w}x${h}.png` });
    if (r.skip) fails.push(`${tag}: ${r.skip}`); else if (r.bad.length) fails.push(`${tag}: ${r.bad.join('; ')}`);
    if (errs.length) fails.push(`${tag}: page error ${errs[0]}`);
    console.log(tag, r.skip || (r.bad.length ? 'OVERLAP ' + r.bad.join('; ') : `clear (${r.n} tags)`), errs.length ? 'errs ' + errs.length : '');
  }
  await ctx.close();
}
await b.close();
if (fails.length) { console.log('OVERLAY FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('OVERLAY PASS');
