// Replay overlap check (MasterBuilder 2026-11-08, after the status chip sat on the Labels chip): at 360, 390 and 1366 wide, sample the demo replay
// and fail if any visible, topmost control (tool chips, status chip, replay bar, recap, hint, battle bar) overlaps another. No screenshots.
// Usage: node scripts/battle-overlap.mjs [screenshotDir]  (prints OVERLAP PASS or OVERLAP FAIL)
import { chromium } from '/Users/mjones/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const outdir = process.argv[2];
const html = null;
const b = await chromium.launch({ channel: 'chrome' });
const sizes = [[360, 740, true], [390, 844, true], [1366, 800, false]];
let bad = 0;
for (const [w, h, mob] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (html) await p.route(/caldera\.social\/world(\?.*)?$/, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await p.goto('https://caldera.social/world?view=battle&replay=demo', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const ph = () => p.evaluate(() => { const a = window.CALDERA_BATTLE_API, x = a.phase(); return { replay: x.replay, hit: x.hit, stage: x.stage, follow: x.follow }; });
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(500); if ((await ph().catch(() => ({}))).replay) break; }
  const check = () => p.evaluate(() => {
    const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0 || e.hidden) return null; const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return null; const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1); if (r.bottom < 0 || r.top > innerHeight) return null; const t = document.elementFromPoint(cx, cy); return t && (t === e || e.contains(t) || t.contains(e)) ? r : null; };
    const items = [];
    for (const sel of ['.b-chip', '.c-tools button', '.c-hint', '.b-play', '.b-recap', '.b-bar']) for (const e of document.querySelectorAll(sel)) { const r = vis(e); if (r && !items.some(i => i.e === e)) items.push({ e, n: sel + ':' + (e.textContent || '').trim().slice(0, 14), r }); }
    const hit = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (items[i].e.contains(items[j].e) || items[j].e.contains(items[i].e)) continue;
      const a = items[i].r, c = items[j].r, ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (ox > 1 && oy > 1) hit.push(items[i].n + ' x ' + items[j].n + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')');
    }
    return { n: items.length, names: items.map(i => i.n), hit, vw: innerWidth, sw: document.documentElement.scrollWidth, chip: !!(document.querySelector('.b-chip') && vis(document.querySelector('.b-chip'))) };
  });
  const all = []; let sawHit = false;
  for (let i = 0; i < 70; i++) { const c = await check(); all.push(c); const s = await ph().catch(() => ({})); if (s.hit) sawHit = true; if (c.hit.length) bad++; if (i === 30 && outdir) await p.screenshot({ path: `${outdir}/ov-${w}.png` }); await p.waitForTimeout(500); }
  await p.evaluate(() => { const a = window.CALDERA_BATTLE_API; try { a.seek && a.seek(1e9) } catch (e) {} });
  await p.waitForTimeout(1500); const fin = await check(); all.push(fin); if (fin.hit.length) bad++;
  const hits = [...new Set(all.flatMap(c => c.hit))];
  console.log(w, 'samples', all.length, 'sawHitReadout', sawHit, 'chipEverVisible', all.some(c => c.chip), 'overlaps', JSON.stringify(hits), 'hscroll', all.some(c => c.sw > c.vw), 'finalItems', JSON.stringify(fin.names), 'errs', errs.length);
  await ctx.close();
}
console.log(bad ? 'OVERLAP FAIL' : 'OVERLAP PASS');
await b.close();
process.exit(bad?1:0)
