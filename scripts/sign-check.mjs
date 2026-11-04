// Storefront sign check (Mike 2026-11-04: "in front of the construction cranes and clickable to their destination").
// Opens a city page by day, then for every sign: the card's right padding must be the card's own white (nothing drawn
// over it: cranes, helicopters, labels), the tap target must be at least 44 px, and a click must open the listing's URL
// in a new tab (or, for a sign with no URL, the store directory). Prints SIGNS PASS or SIGNS FAIL.
// Usage: node scripts/sign-check.mjs [city url] [--phone]
import { chromium } from '/Users/mjones/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://caldera.social/@mike/city.html';
const phone = process.argv.includes('--phone'), fails = [];
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const p = await ctx.newPage(); p.on('pageerror', e => fails.push('page error: ' + e.message));
await p.addInitScript(() => { const o = window.open; window.__opened = []; window.open = function (u, ...a) { window.__opened.push(String(u)); return o.call(window, u, ...a); }; });   // where the tab was sent, before any redirect
await p.goto(url + '#test&sky=day', { waitUntil: 'load', timeout: 60000 });
await p.evaluate(() => document.querySelector('#stage').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(4500);
const signs = await p.evaluate(() => window.calderaTest.signs());
const SR = await p.evaluate(() => document.querySelector('#stage').getBoundingClientRect().toJSON());
const inStage = s => s.x > SR.left + 1 && s.x < SR.right - 1 && s.y > SR.top + 1 && s.y < SR.bottom - 1;   // a sign whose building is panned out of view isn't on screen
if (!signs.length) fails.push('no signs found');
for (const s of signs) {
  if (Math.min(s.w, s.h) < 43.5) fails.push(`${s.name}: tap target ${s.w.toFixed(0)}x${s.h.toFixed(0)} px`);
  // the card's own background at its right padding, read from what's on screen
  const [x0, y0, x1, y1] = s.card, px = { x: Math.round(x1 - (y1 - y0) * .14), y: Math.round((y0 + y1) / 2) };
  if (!inStage(px)) continue;   // off screen
  const buf = await p.screenshot({ clip: { x: px.x, y: px.y, width: 1, height: 1 } });
  const rgb = await p.evaluate(async b64 => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); }, buf.toString('base64'));
  if (Math.min(...rgb) < 225) fails.push(`${s.name}: something covers the sign (pixel ${rgb})`);
}
// click each visible sign: a new tab with its URL, or the directory when it has none
for (const s of signs.slice(0, 12)) {
  const vp = p.viewportSize(); if (s.x < 0 || s.y < 0 || s.x > vp.width || s.y > vp.height) continue;
  const cur = (await p.evaluate(() => window.calderaTest.signs())).find(x => x.name === s.name) || s;
  if (!inStage(cur)) continue;   // out of view
  const topEl = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.tagName + '.' + e.className); }, [cur.x, cur.y]);
  if (topEl !== 'city') { fails.push(`${s.name}: covered by a page element (${topEl || 'none'}) at its centre`); continue; }
  if (cur.url) {
    const pop = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    if (phone) await p.touchscreen.tap(cur.x, cur.y); else await p.mouse.click(cur.x, cur.y);
    const np = await pop;
    if (!np) { fails.push(`${s.name}: click opened nothing (expected ${cur.url})`); continue; }
    const opened = await p.evaluate(() => window.__opened.splice(0)); await np.close(); const got = opened.length === 1 ? opened[0] : JSON.stringify(opened);   // exactly one tab
    if (got !== cur.url && !got.startsWith(cur.url.replace(/\/$/, ''))) fails.push(`${s.name}: opened ${got}, expected ${cur.url}`);
    else console.log(`ok ${s.name} -> ${got}`);
    const card = await p.evaluate(() => !document.getElementById('card').hidden);
    if (card) { fails.push(`${s.name}: the click also opened a card (fell through)`); await p.keyboard.press('Escape'); await p.evaluate(() => { const x = document.querySelector('#card .x'); if (x) x.click(); }); }
  } else {
    if (phone) await p.touchscreen.tap(cur.x, cur.y); else await p.mouse.click(cur.x, cur.y);
    const dir = await p.evaluate(() => document.getElementById('card').classList.contains('is-dir') && !document.getElementById('card').hidden);
    if (!dir) fails.push(`${s.name}: no URL and no store directory`); else console.log(`ok ${s.name} -> store directory`);
    await p.evaluate(() => { const x = document.querySelector('#card .x'); if (x) x.click(); });
  }
  await p.waitForTimeout(1400);   // past the double-open guard
}
await b.close();
if (fails.length) { console.log('SIGNS FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log(`SIGNS PASS (${signs.length} signs)`);
