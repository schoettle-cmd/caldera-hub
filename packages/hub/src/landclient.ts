// @ts-nocheck
/**
 * The World page's Expansion view, in the browser: the land map from the design study (same isometric geometry, night
 * palette, language-coloured towers, label pills and rays as the city renderer), driven by /v1/world/land.
 * Shipped as the source of landClient() (self-contained: it must not reference anything outside itself).
 */
export function landClient() {
  'use strict';
  var root = document.getElementById('land'), KEY = 'caldera.worldView';
  if (!root) return;
  var html = document.documentElement, btns = Array.prototype.slice.call(document.querySelectorAll('[data-wview]'));
  var city = document.getElementById('stage');
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  // ---------------------------------------------------------------- the toggle: Current | Expansion
  function setView(v, save) {
    var exp = v === 'expansion';
    html.classList.toggle('w-exp', exp);
    btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-wview') === v)); });
    if (city) { if (exp) city.setAttribute('inert', ''); else city.removeAttribute('inert'); }
    if (save) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      try { var u = new URL(location.href); if (exp) u.searchParams.set('view', 'expansion'); else u.searchParams.delete('view'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
    }
    if (exp) start(); else stopLoops();
  }
  btns.forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-wview'), true); }); });

  // ---------------------------------------------------------------- constants that mirror the Caldera city renderer
  var TW = 64, TH = 32;
  var NIGHT = { sky: ['#04060E', '#0B1020', '#18203A'], grass: '#1D3326', grass2: '#21392A', park: '#1A2F22', walk: '#3A3D47', plaza: '#41444E', road: '#1E222B', road2: '#23272F', line: 'rgba(242,200,90,.45)', water: ['#13233F', '#0D1A30'], earth: ['#2B2219', '#201912'], win: 'rgba(255,208,120,.95)', winOff: 'rgba(16,20,34,.75)', shadow: 'rgba(0,0,0,.35)' };
  var LANG = { TypeScript: '#3178C6', JavaScript: '#E8C547', Python: '#4FB89A', HTML: '#E07A4F', Swift: '#F05138', CSS: '#6E5BD0', Shell: '#7FB24A', Go: '#2FB5D6', Rust: '#C9744A', Java: '#B07219', Kotlin: '#A97BFF', Ruby: '#CC342D', 'C++': '#F34B7D', C: '#8A8F99', 'C#': '#178600', PHP: '#4F5D95', Dart: '#00B4AB', Vue: '#41B883', 'Jupyter Notebook': '#DA5B0B', Svelte: '#FF3E00', Lua: '#5A6FD6', Elixir: '#6E4A7E', Zig: '#EC915C', Nix: '#7E7EFF', Astro: '#FF5A03', MDX: '#FCB32C', Solidity: '#8A8AA0' };
  var STATES = [
    { key: 'thriving', dot: '#4FD1A0', grass: '#234A32', grass2: '#28523A', plaza: '#454955', walk: '#3E424D', fade: 0, lit: .9, lamp: 1, crane: 1, banner: 1, smoke: 1, builders: 3, flowers: 1, trees: 'lush', glow: .22, label: 'Thriving' },
    { key: 'active', dot: '#8BD17A', grass: '#1F3A2A', grass2: '#24422F', plaza: '#41444E', walk: '#3A3D47', fade: 0, lit: .6, lamp: .9, crane: 1, banner: 0, smoke: 0, builders: 1, flowers: 0, trees: 'green', glow: .12, label: 'Active' },
    { key: 'settled', dot: '#C9C27A', grass: '#1D3326', grass2: '#21392A', plaza: '#3E414A', walk: '#363942', fade: .15, lit: .25, lamp: .65, crane: 0, banner: 0, smoke: 0, builders: 0, flowers: 0, trees: 'green', glow: 0, label: 'Settled' },
    { key: 'weathered', dot: '#D1A05A', grass: '#3A3521', grass2: '#413B25', plaza: '#3A3936', walk: '#33322E', fade: .55, lit: .08, lamp: .35, crane: 0, banner: 0, smoke: 0, builders: 0, flowers: 0, trees: 'dry', glow: 0, cracks: 1, vines: 1, label: 'Weathered' },
    { key: 'dormant', dot: '#9A8E86', grass: '#2E2619', grass2: '#33291B', plaza: '#302D28', walk: '#2A2824', fade: .8, lit: 0, lamp: .12, crane: 0, banner: 0, smoke: 0, builders: 0, flowers: 0, trees: 'dead', glow: 0, cracks: 1, vines: 1, rubble: 1, mist: 1, label: 'Dormant' }
  ];

  // ---------------------------------------------------------------- helpers
  function rnd(s) { var x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); }
  function hash(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
  function hex(c) { var n = parseInt(c.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; }
  function shade(col, f) { var c = hex(col).map(function (v) { return Math.round(Math.min(255, v * f)); }); return 'rgb(' + c.join(',') + ')'; }
  function mix(a, t, b) { var x = hex(a), y = hex(b); return '#' + x.map(function (v, i) { var n = Math.round(v + (y[i] - v) * t); return (n < 16 ? '0' : '') + n.toString(16); }).join(''); }
  function rgba(col, a) { var c = hex(col); return 'rgba(' + c.join(',') + ',' + a + ')'; }
  function iso(i, j) { return { x: (i - j) * TW / 2, y: (i + j) * TH / 2 }; }
  function poly(c, pts, fill) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (var k = 1; k < pts.length; k++) c.lineTo(pts[k][0], pts[k][1]); c.closePath(); c.fillStyle = fill; c.fill(); }
  function dia(i, j, s) { var p = iso(i, j), a = TW / 2 * s, b = TH / 2 * s; return [[p.x, p.y - b], [p.x + a, p.y], [p.x, p.y + b], [p.x - a, p.y]]; }
  function corner(x, y) { var p = iso(x, y); return [p.x, p.y]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function langCol(l) { if (LANG[l]) return LANG[l]; if (!l || l === 'Other') return '#8A8A93'; var h = hash(l) % 360; return hslHex(h, 45, 55); }
  function hslHex(h, s, l) { s /= 100; l /= 100; var k = function (n) { return (n + h / 30) % 12; }, a = s * Math.min(l, 1 - l), f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    return '#' + [f(0), f(8), f(4)].map(function (x) { var v = Math.round(x * 255); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }

  // ---------------------------------------------------------------- data
  var D = null, MS = [], DAYS = 1, FINAL = null, scenes = {};
  function at(arr, d) { var v = null; for (var i = 0; i < arr.length; i++) { if (arr[i][0] <= d) v = arr[i][1]; else break; } return v; }
  function sideAt(m, d) { return d < m.j ? 0 : at(m.steps, d) || 2; }
  function stateAt(m, d) { var s = at(m.hs, d); return s == null ? 2 : s; }
  function builtAt(m, d) { if (!m.bl.length) return 0; var n = 0; m.bl.forEach(function (b) { if (b.b <= d) n++; }); return Math.max(1, n); }

  function scene(d) {
    var tiles = {}, plots = [], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    MS.forEach(function (m, idx) {
      var k = sideAt(m, d); if (!k) return; var st = stateAt(m, d), S = STATES[st];
      var cells = []; for (var j = 0; j < k; j++) for (var i = 0; i < k; i++) cells.push([m.x + i, m.y + j]);
      cells.sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]); });
      // buildings in commit order, born by day d; a member with no public repos keeps a homestead
      var bl = m.bl.filter(function (b) { return b.b <= d; }); if (!bl.length && m.bl.length) bl = m.bl.slice(0, 1);
      if (!bl.length) bl = [{ n: '', l: '', c: 6, w: 0, a: 0, home: 1 }];
      bl = bl.slice(0, Math.max(1, Math.min(cells.length, Math.ceil(cells.length * .75))));
      var p = { m: m, k: k, x: m.x, y: m.y, st: st, S: S, bl: [], isNew: d - m.j < 14, idx: idx };
      cells.forEach(function (c, ci) { var key = c[0] + ',' + c[1]; if (ci < bl.length) { tiles[key] = { t: 'b', r: bl[ci], p: p }; p.bl.push({ r: bl[ci], i: c[0], j: c[1] }); } else tiles[key] = { t: 'g', p: p, n: ci }; });
      for (var a = -1; a <= k; a++) for (var b2 = -1; b2 <= k; b2++) { if (a >= 0 && a < k && b2 >= 0 && b2 < k) continue; var kk = (m.x + a) + ',' + (m.y + b2); if (!tiles[kk]) tiles[kk] = { t: 'r' }; }
      x0 = Math.min(x0, m.x - 1); y0 = Math.min(y0, m.y - 1); x1 = Math.max(x1, m.x + k); y1 = Math.max(y1, m.y + k); plots.push(p);
    });
    if (!plots.length) return null;
    return { tiles: tiles, plots: plots, x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2, d: d };
  }
  function sceneAt(T) { var d = Math.round(T * (DAYS - 1)); if (!scenes[d]) scenes[d] = scene(d); return scenes[d]; }
  function totals(sc) { var o = { n: 0, tiles: 0, thr: 0, old: 0 }; if (!sc) return o; sc.plots.forEach(function (p) { o.n++; o.tiles += p.k * p.k; if (p.st === 0) o.thr++; if (p.st >= 3) o.old++; }); return o; }

  // ---------------------------------------------------------------- drawing primitives
  function prism(c, px, py, w, h, col) { var hw = TW / 2 * w, hh = TH / 2 * w;
    poly(c, [[px - hw, py], [px, py + hh], [px, py + hh - h], [px - hw, py - h]], shade(col, .62));
    poly(c, [[px + hw, py], [px, py + hh], [px, py + hh - h], [px + hw, py - h]], shade(col, .82));
    poly(c, [[px, py - hh - h], [px + hw, py - h], [px, py + hh - h], [px - hw, py - h]], shade(col, 1.08)); }
  function windows(c, px, py, w, h, litp, seed) { var hw = TW / 2 * w, hh = TH / 2 * w, rows = Math.min(14, Math.floor((h - 6) / 9)); if (rows <= 0) return; var us = w > .6 ? [.25, .5, .75] : [.33, .67];
    for (var k = 0; k < rows; k++) for (var s = -1; s <= 1; s += 2) for (var ui = 0; ui < us.length; ui++) { var u = us[ui], wx = px + s * hw * u, wy = py + hh * (1 - u) - 6 - k * 9, on = rnd(seed + k * 13 + ui * 7 + (s > 0 ? 100 : 0)) < litp;
      c.fillStyle = on ? NIGHT.win : NIGHT.winOff; c.beginPath(); if (s > 0) { c.moveTo(wx - 2.4, wy + 1.2); c.lineTo(wx + 2.4, wy - 1.2); c.lineTo(wx + 2.4, wy - 4.8); c.lineTo(wx - 2.4, wy - 2.4); } else { c.moveTo(wx + 2.4, wy + 1.2); c.lineTo(wx - 2.4, wy - 1.2); c.lineTo(wx - 2.4, wy - 4.8); c.lineTo(wx + 2.4, wy - 2.4); } c.closePath(); c.fill(); } }
  function bh(r) { return r.home ? 16 : 14 + Math.min(110, Math.round(20 * Math.log2(1 + r.c / 8))); }
  function tree(c, x, y, s, kind, seed) { var r = rnd(seed);
    if (kind === 'dead') { c.strokeStyle = '#3A2F24'; c.lineWidth = 1.2 * s; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 9 * s); c.moveTo(x, y - 5 * s); c.lineTo(x - 4 * s, y - 9 * s); c.moveTo(x, y - 7 * s); c.lineTo(x + 3 * s, y - 11 * s); c.stroke(); return; }
    var col = kind === 'lush' ? (r < .5 ? '#2F6B42' : '#3A7A48') : kind === 'green' ? (r < .5 ? '#2E5A3A' : '#27503A') : (r < .5 ? '#55512F' : '#4A4426');
    c.fillStyle = '#3B2A1C'; c.fillRect(x - 1 * s, y - 5 * s, 2 * s, 5 * s);
    if (r < .5) { c.fillStyle = shade(col, .8); c.beginPath(); c.arc(x - 3 * s, y - 7 * s, 4.5 * s, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(x + 2 * s, y - 8 * s, 4.5 * s, 0, 7); c.fill(); c.fillStyle = shade(col, 1.15); c.beginPath(); c.arc(x - .5 * s, y - 11 * s, 3.6 * s, 0, 7); c.fill(); }
    else { poly(c, [[x - 5 * s, y - 4 * s], [x + 5 * s, y - 4 * s], [x, y - 12 * s]], shade(col, .85)); poly(c, [[x - 4 * s, y - 8 * s], [x + 4 * s, y - 8 * s], [x, y - 15 * s]], col); poly(c, [[x - 3 * s, y - 12 * s], [x + 3 * s, y - 12 * s], [x, y - 18 * s]], shade(col, 1.15)); } }
  function lamp(c, x, y, a) { c.strokeStyle = '#6F7C8F'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 16); c.lineTo(x + 4, y - 16); c.stroke();
    if (a <= 0) return; var g = c.createRadialGradient(x + 4, y - 15, 0, x + 4, y - 15, 24); g.addColorStop(0, 'rgba(255,220,150,' + (.35 * a) + ')'); g.addColorStop(1, 'rgba(255,220,150,0)'); c.fillStyle = g; c.beginPath(); c.arc(x + 4, y - 15, 24, 0, 7); c.fill(); c.fillStyle = 'rgba(255,236,190,' + a + ')'; c.beginPath(); c.arc(x + 4, y - 16, 1.6, 0, 7); c.fill(); }
  function crane(c, x, y, seed) { c.strokeStyle = '#E8B44A'; c.lineWidth = 1.3; var h = 26 + rnd(seed) * 10, j = 18; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.moveTo(x - 6, y - h); c.lineTo(x + j, y - h); c.moveTo(x, y - h + 4); c.lineTo(x + j - 4, y - h); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = .6; c.beginPath(); c.moveTo(x + j - 5, y - h); c.lineTo(x + j - 5, y - h + 12); c.stroke(); c.fillStyle = '#E8B44A'; c.fillRect(x + j - 7, y - h + 12, 4, 3); c.fillStyle = '#FF463C'; c.beginPath(); c.arc(x, y - h, 1.2, 0, 7); c.fill(); }
  function banner(c, x, y, seed) { c.strokeStyle = '#D9D2C4'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 18); c.stroke(); var col = ['#B58CFF', '#4FD1C5', '#FFB86B', '#FF7FA3'][seed % 4]; poly(c, [[x, y - 18], [x + 9, y - 15], [x, y - 11]], col); }
  function roofProps(c, x, y, w, seed) { var hw = TW / 2 * w; if (seed % 3 === 0) { c.fillStyle = '#8F96A3'; c.fillRect(x - hw * .4, y - 5, 5, 4); c.fillStyle = '#6F7686'; c.fillRect(x - hw * .4, y - 1, 5, 1.5); }
    if (seed % 4 === 1) { c.strokeStyle = '#A9B0BD'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + hw * .3, y - 1); c.lineTo(x + hw * .3, y - 9); c.stroke(); } }
  function figure(c, x, y, col) { c.fillStyle = col; c.fillRect(x - 1.2, y - 5, 2.4, 4); c.fillStyle = '#F0D0B0'; c.beginPath(); c.arc(x, y - 6, 1.3, 0, 7); c.fill(); c.fillStyle = '#F2C14E'; c.fillRect(x - 1.6, y - 7.6, 3.2, 1.2); }
  function pill(c, x, y, text, bg, fg, font) { c.font = font; var w = c.measureText(text).width + 14, h = 18, r = 9; c.fillStyle = bg; c.beginPath(); c.moveTo(x - w / 2 + r, y - h); c.arcTo(x + w / 2, y - h, x + w / 2, y, r); c.arcTo(x + w / 2, y, x - w / 2, y, r); c.arcTo(x - w / 2, y, x - w / 2, y - h, r); c.arcTo(x - w / 2, y - h, x + w / 2, y - h, r); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.lineTo(x, y + 4); c.closePath(); c.fill(); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y - h / 2 + .5); return w; }
  function isRoad(tiles, i, j) { var t = tiles[i + ',' + j]; return !!(t && t.t === 'r'); }
  function nearPlot(tiles, i, j) { for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) { var t = tiles[(i + a) + ',' + (j + b)]; if (t && t.p) return t.p; } return null; }

  // ---------------------------------------------------------------- the renderer
  var V = { s: 1, px: 0, py: 0 };   // the viewer's zoom and pan on top of the fitted camera
  function render(cv, sc, opt) {
    var dpr = Math.min(2, devicePixelRatio || 1), cw = cv.clientWidth || 600, ch = cv.clientHeight || 400;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, NIGHT.sky[0]); g.addColorStop(.6, NIGHT.sky[1]); g.addColorStop(1, NIGHT.sky[2]); c.fillStyle = g; c.fillRect(0, 0, cw, ch);
    for (var s = 0; s < 70; s++) { c.fillStyle = 'rgba(255,255,255,' + (.25 + rnd(s) * .6) + ')'; var sz = rnd(s * 5) < .1 ? 1.8 : 1.1; c.fillRect(rnd(s * 3) * cw, rnd(s * 7) * ch * .5, sz, sz); }
    c.fillStyle = '#F4F1E4'; c.beginPath(); c.arc(cw * .86, ch * .11, 13, 0, 7); c.fill(); c.fillStyle = NIGHT.sky[0]; c.beginPath(); c.arc(cw * .86 + 5, ch * .11 - 3, 12, 0, 7); c.fill();
    if (!sc) return null;
    var fb = FINAL || sc, A = corner(fb.x0 - .5, fb.y0 - .5), B = corner(fb.x1 + .5, fb.y0 - .5), C = corner(fb.x1 + .5, fb.y1 + .5), Dd = corner(fb.x0 - .5, fb.y1 + .5);
    var minx = Dd[0], maxx = B[0], miny = A[1] - 70, maxy = C[1] + 36, pad = 10;
    var z0 = Math.min((cw - pad * 2) / (maxx - minx), (ch - pad * 2) / (maxy - miny));
    var ox0 = cw / 2 - (minx + maxx) / 2 * z0, oy0 = ch / 2 - (miny + maxy) / 2 * z0;
    var z = z0 * V.s, ox = cw / 2 + (ox0 - cw / 2) * V.s + V.px, oy = ch / 2 + (oy0 - ch / 2) * V.s + V.py;
    c.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    var tiles = sc.tiles, x0 = sc.x0, y0 = sc.y0, x1 = sc.x1, y1 = sc.y1, i, j;
    var WR = 3, wa = corner(x0 - .5 - WR, y0 - .5 - WR), wb = corner(x1 + .5 + WR, y0 - .5 - WR), wc = corner(x1 + .5 + WR, y1 + .5 + WR), wd = corner(x0 - .5 - WR, y1 + .5 + WR);
    var wg = c.createLinearGradient(0, wa[1], 0, wc[1]); wg.addColorStop(0, NIGHT.water[0]); wg.addColorStop(1, NIGHT.water[1]); poly(c, [wa, wb, wc, wd], wg);
    c.strokeStyle = 'rgba(140,170,230,.25)'; c.lineWidth = 1;
    for (j = y0 - WR; j <= y1 + WR; j++) for (i = x0 - WR; i <= x1 + WR; i++) { if (i >= x0 && i <= x1 && j >= y0 && j <= y1) continue; if (rnd(i * 13 + j * 7) < .5) continue; var q = iso(i, j), rx = (rnd(i * 5 + j * 11) - .5) * TW * .5, ry = (rnd(i * 3 + j * 17) - .5) * TH * .4; c.beginPath(); c.moveTo(q.x + rx - 6, q.y + ry); c.quadraticCurveTo(q.x + rx, q.y + ry - 2, q.x + rx + 6, q.y + ry); c.stroke(); }
    var a = corner(x0 - .5, y0 - .5), b = corner(x1 + .5, y0 - .5), cc = corner(x1 + .5, y1 + .5), d = corner(x0 - .5, y1 + .5), th = 22;
    poly(c, [d, cc, [cc[0], cc[1] + th], [d[0], d[1] + th]], NIGHT.earth[0]); poly(c, [cc, b, [b[0], b[1] + th], [cc[0], cc[1] + th]], NIGHT.earth[1]);
    poly(c, [a, b, cc, d], NIGHT.grass);
    var tint = opt.health !== false;
    for (j = y0; j <= y1; j++) for (i = x0; i <= x1; i++) { var t = tiles[i + ',' + j];
      if (!t) { if ((i * 7 + j * 3) % 5 === 0) poly(c, dia(i, j, .9), NIGHT.grass2); continue; }
      if (t.t === 'r') { poly(c, dia(i, j, 1.02), (i + j) % 2 ? NIGHT.road : NIGHT.road2); var ri = isRoad(tiles, i - 1, j) || isRoad(tiles, i + 1, j), rj = isRoad(tiles, i, j - 1) || isRoad(tiles, i, j + 1), q2 = iso(i, j);
        c.strokeStyle = NIGHT.line; c.lineWidth = 1.2; c.setLineDash([5, 5]);
        if (ri && !rj) { c.beginPath(); c.moveTo(q2.x - TW * .25, q2.y - TH * .25); c.lineTo(q2.x + TW * .25, q2.y + TH * .25); c.stroke(); } else if (rj && !ri) { c.beginPath(); c.moveTo(q2.x + TW * .25, q2.y - TH * .25); c.lineTo(q2.x - TW * .25, q2.y + TH * .25); c.stroke(); } c.setLineDash([]); continue; }
      var S = t.p.S;
      if (t.t === 'g') { poly(c, dia(i, j, .92), tint ? ((i * 7 + j * 3) % 5 === 0 ? S.grass2 : S.grass) : NIGHT.park); continue; }
      poly(c, dia(i, j, .9), tint ? S.plaza : NIGHT.plaza);
      if (S.cracks && tint) { var q3 = iso(i, j); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = .8; c.beginPath(); c.moveTo(q3.x - 12, q3.y + 2); c.lineTo(q3.x - 4, q3.y - 1); c.lineTo(q3.x + 2, q3.y + 4); c.lineTo(q3.x + 9, q3.y + 1); c.stroke(); } }
    sc.plots.forEach(function (p) { var X0 = p.x - .5 - .08, Y0 = p.y - .5 - .08, X1 = p.x + p.k - .5 + .08, Y1 = p.y + p.k - .5 + .08, pa = corner(X0, Y0), pb = corner(X1, Y0), pc = corner(X1, Y1), pd = corner(X0, Y1), h = 3, wk = tint ? p.S.walk : NIGHT.walk;
      poly(c, [pd, pc, [pc[0], pc[1] + h], [pd[0], pd[1] + h]], shade(wk, .75)); poly(c, [pc, pb, [pb[0], pb[1] + h], [pc[0], pc[1] + h]], shade(wk, .62));
      c.strokeStyle = rgba(wk, 1); c.lineWidth = 2.2; c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.lineTo(pc[0], pc[1]); c.lineTo(pd[0], pd[1]); c.closePath(); c.stroke();
      if (p.S.glow && tint) { var gm = iso(p.x + p.k / 2 - .5, p.y + p.k / 2 - .5), gr = c.createRadialGradient(gm.x, gm.y, 4, gm.x, gm.y, TW * p.k * .55); gr.addColorStop(0, 'rgba(255,214,140,' + p.S.glow + ')'); gr.addColorStop(1, 'rgba(255,214,140,0)'); c.fillStyle = gr; c.beginPath(); c.ellipse(gm.x, gm.y, TW * p.k * .55, TH * p.k * .55, 0, 0, 7); c.fill(); }
      if (sel === p.m) { c.strokeStyle = 'rgba(185,166,255,.95)'; c.lineWidth = 3; c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.lineTo(pc[0], pc[1]); c.lineTo(pd[0], pd[1]); c.closePath(); c.stroke(); }
    });
    c.beginPath(); sc.plots.forEach(function (p) { p.bl.forEach(function (bb) { var pp = iso(bb.i, bb.j), hgt = bh(bb.r) * (p.S.rubble ? .6 : 1), hw = TW / 2 * .78, hh = TH / 2 * .78, vx = hgt * .62, vy = hgt * .3;
      var pts = [[pp.x - hw, pp.y + 4], [pp.x, pp.y + 4 - hh], [pp.x + vx, pp.y + 4 - hh + vy], [pp.x + hw + vx, pp.y + 4 + vy], [pp.x + vx, pp.y + 4 + hh + vy], [pp.x, pp.y + 4 + hh]]; c.moveTo(pts[0][0], pts[0][1]); for (var m2 = 1; m2 < 6; m2++) c.lineTo(pts[m2][0], pts[m2][1]); c.closePath(); }); }); c.fillStyle = NIGHT.shadow; c.fill();
    var tn = opt.time || 0, tallest = {};
    for (var sum = x0 + y0; sum <= x1 + y1; sum++) for (i = x0; i <= x1; i++) { j = sum - i; if (j < y0 || j > y1) continue; var tt = tiles[i + ',' + j], p = iso(i, j);
      if (!tt) { if (rnd(i * 17 + j * 29) < .42) { var ts = .7 + rnd(i + j * 3) * .5; tree(c, p.x + (rnd(i) - .5) * 22, p.y + (rnd(j) - .5) * 8, ts, 'green', i * 31 + j); } continue; }
      if (tt.t === 'r') { if (isRoad(tiles, i - 1, j) && isRoad(tiles, i, j - 1) && (i + j) % 2 === 0) { var lp = tiles[(i - 1) + ',' + (j - 1)], pl = lp && lp.p ? lp.p : nearPlot(tiles, i, j); lamp(c, p.x - TW * .32, p.y, pl && tint ? pl.S.lamp : .9); } continue; }
      var P = tt.p, S2 = P.S;
      if (tt.t === 'g') { var kind = tint ? S2.trees : 'green', sd = hash(P.m.h) + tt.n;
        if (tt.n % 3 === 0 || kind === 'lush') tree(c, p.x - 8, p.y + 2, .85, kind, sd); if (tt.n % 2 === 1 && kind !== 'dead') tree(c, p.x + 10, p.y - 3, .7, kind, sd + 5);
        if (S2.flowers && tint) for (var fl = 0; fl < 6; fl++) { c.fillStyle = ['#FF7FA3', '#FFD36B', '#FFFFFF', '#B58CFF'][fl % 4]; c.fillRect(p.x + (rnd(sd + fl) - .5) * 26, p.y + (rnd(sd + fl * 3) - .5) * 10, 1.6, 1.6); }
        if (S2.rubble && tint) for (var wd2 = 0; wd2 < 5; wd2++) { c.strokeStyle = '#5A5A30'; c.lineWidth = .8; var wx = p.x + (rnd(sd + wd2 * 7) - .5) * 26, wy = p.y + (rnd(sd + wd2 * 5) - .5) * 10; c.beginPath(); c.moveTo(wx, wy); c.lineTo(wx + 1.5, wy - 5); c.stroke(); }
        continue; }
      var r = tt.r, h = bh(r), seed = hash(r.n || P.m.h), col = r.home ? '#B9A27E' : langCol(r.l), st = S2;
      if (tint && st.fade) col = mix(col, st.fade, '#6E7076');
      if (r.a && tint) col = mix(col, .8, '#4A4846');
      var litp = tint ? st.lit : (r.w ? .6 : .15); if (r.a && tint) litp = 0;
      var broken = tint && !r.home && (st.rubble || r.a); if (broken) h = Math.round(h * .62);
      var tiers = h > 110 ? [[.78, h * .6], [.62, h * .26], [.46, h * .14]] : h > 70 ? [[.78, h * .72], [.6, h * .28]] : [[r.home ? .6 : .78, h]], base = p.y + 4, top = base;
      for (var k2 = 0; k2 < tiers.length; k2++) { var tw = tiers[k2][0], thh = tiers[k2][1]; prism(c, p.x, top, tw, thh, col); windows(c, p.x, top, tw, thh, litp, seed + k2 * 101); top -= thh; }
      if (r.home) { var hw0 = TW / 2 * .6, hh0 = TH / 2 * .6; poly(c, [[p.x - hw0, top], [p.x, top - 12], [p.x, top + hh0 - 12 + 2], [p.x - hw0, top + 2]], shade('#8E5A4A', .8)); poly(c, [[p.x + hw0, top], [p.x, top - 12], [p.x, top + hh0 - 12 + 2], [p.x + hw0, top + 2]], '#8E5A4A'); top -= 12; }
      else if (broken) { var hw3 = TW / 2 * tiers[tiers.length - 1][0], hh3 = TH / 2 * tiers[tiers.length - 1][0]; poly(c, [[p.x - hw3, top], [p.x - hw3 * .5, top - 7], [p.x - hw3 * .1, top - hh3 * .5 - 3], [p.x + hw3 * .4, top - hh3 * .2 - 9], [p.x + hw3, top], [p.x, top + hh3]], shade(col, .5));
        c.fillStyle = shade(col, .7); c.fillRect(p.x + hw3 * .6, base - 3, 4, 3); c.fillRect(p.x - hw3 * .9, base + 2, 3, 2.5); c.fillRect(p.x + hw3 * .2, base + hh3 * .6, 3, 2.5); }
      else if (st.vines && tint) { c.strokeStyle = '#3E6B3A'; c.lineWidth = 1; for (var v = 0; v < 3; v++) { var vx0 = p.x - TW / 2 * .78 * (0.25 + v * .22), vy0 = base + TH / 2 * .78 * (1 - (0.25 + v * .22)); c.beginPath(); c.moveTo(vx0, vy0); c.quadraticCurveTo(vx0 + 2, vy0 - h * .35, vx0 - 1, vy0 - h * (.5 + rnd(seed + v) * .3)); c.stroke(); } }
      else roofProps(c, p.x, top, tiers[tiers.length - 1][0], seed);
      if (tint && st.crane && r.w > 0 && !broken) crane(c, p.x + 4, top, seed);
      if (tint && st.banner && seed % 2 === 0 && !broken && !r.home) banner(c, p.x - 10, top + 2, seed);
      if (tint && st.smoke && r.w > 0 && !broken) { for (var sm = 0; sm < 5; sm++) { var ph = (tn * .00025 + sm * .2 + rnd(seed + sm)) % 1; c.fillStyle = 'rgba(200,205,220,' + (.28 * (1 - ph)) + ')'; c.beginPath(); c.arc(p.x + 6 + Math.sin(ph * 6 + sm) * 3, top - 6 - ph * 26, 1.5 + ph * 4, 0, 7); c.fill(); } }
      if (P.m.s >= 100 && r === P.m.bl[0] && !broken) { c.strokeStyle = '#A9B0BD'; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, top - 2); c.lineTo(p.x, top - 14); c.stroke(); var bl2 = (Math.sin(tn * .004 + seed) + 1) / 2; c.fillStyle = 'rgba(255,70,60,' + (.4 + .6 * bl2) + ')'; c.beginPath(); c.arc(p.x, top - 15, 1.6, 0, 7); c.fill(); }
      if (!tallest[P.idx] || h > tallest[P.idx].h) tallest[P.idx] = { h: h, x: p.x, y: top, p: P };
    }
    if (tint) sc.plots.forEach(function (p) { if (!p.S.builders) return; var g0 = iso(p.x + p.k - .5, p.y + p.k + .5), sd = hash(p.m.h); for (var b3 = 0; b3 < p.S.builders; b3++) figure(c, g0.x - TW * .35 + (rnd(sd + b3) - .5) * 20 + b3 * 7, g0.y - 4 + rnd(sd + b3 * 3) * 6, ['#4FD1C5', '#FFB86B', '#B58CFF'][b3 % 3]); });
    if (tint) sc.plots.forEach(function (p) { if (!p.S.mist) return; var gm = iso(p.x + p.k / 2 - .5, p.y + p.k / 2 - .5), gr = c.createRadialGradient(gm.x, gm.y - 6, 2, gm.x, gm.y - 6, TW * p.k * .6); gr.addColorStop(0, 'rgba(170,180,200,.16)'); gr.addColorStop(1, 'rgba(170,180,200,0)'); c.fillStyle = gr; c.beginPath(); c.ellipse(gm.x, gm.y - 6, TW * p.k * .6, TH * p.k * .5, 0, 0, 7); c.fill(); });
    if (opt.rays !== false) { c.save(); c.globalCompositeOperation = 'lighter'; c.lineWidth = 1; var byIdx = {}; sc.plots.forEach(function (p) { byIdx[p.idx] = p; });
      D.links.forEach(function (l) { var p = byIdx[l[0]], q = byIdx[l[1]]; if (!p || !q) return; var a1 = iso(p.x + p.k / 2 - .5, p.y + p.k / 2 - .5), b1 = iso(q.x + q.k / 2 - .5, q.y + q.k / 2 - .5), mx = (a1.x + b1.x) / 2, my = (a1.y + b1.y) / 2 - Math.hypot(b1.x - a1.x, b1.y - a1.y) * .35 - 30;
        c.strokeStyle = l[2] === 1 ? 'rgba(181,140,255,.10)' : 'rgba(181,140,255,.22)'; c.lineWidth = 1; c.beginPath(); c.moveTo(a1.x, a1.y); c.quadraticCurveTo(mx, my, b1.x, b1.y); c.stroke(); if (l[2] !== 1) { c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 2.5; c.stroke(); } }); c.restore(); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var placed = [];
    sc.plots.forEach(function (p) { p.lx = null; });
    if (opt.labels !== false) { var fB = '700 11.5px IBM Plex Sans,Arial,sans-serif', list = Object.keys(tallest).map(function (k) { return tallest[k]; }).sort(function (a, b) { return (b.p.m === sel) - (a.p.m === sel) || b.p.k - a.p.k || a.p.idx - b.p.idx; });
      var minK = opt.minLabelK || 0;
      list.forEach(function (t) { if (t.p.k < minK && !t.p.isNew && t.p.m !== sel) return; var text = '@' + t.p.m.h + (t.p.isNew ? ' ✦ new' : ''); c.font = fB; var w = c.measureText(text).width + 14, x = t.x * z + ox, y = (t.y - 8) * z + oy - 6, r0 = [x - w / 2, y - 18, x + w / 2, y];
        if (x - w / 2 < 2 || x + w / 2 > cw - 2 || y - 18 < 2 || y > ch - 2) return;
        for (var o = 0; o < placed.length; o++) { var q = placed[o]; if (!(r0[2] < q[0] - 4 || q[2] < r0[0] - 4 || r0[3] < q[1] - 4 || q[3] < r0[1] - 4)) return; }
        placed.push(r0); pill(c, x, y, text, t.p.isNew ? 'rgba(45,179,122,.95)' : 'rgba(139,108,246,.95)', '#fff', fB); t.p.lx = x; t.p.ly = y; t.p.lw = w; }); }
    var vg = c.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * .35, cw / 2, ch / 2, Math.max(cw, ch) * .8); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = vg; c.fillRect(0, 0, cw, ch);
    return { z: z, ox: ox, oy: oy, sc: sc };
  }

  // ---------------------------------------------------------------- the view: replay, scrubber, tools, card
  var cv = root.querySelector('canvas.l-canvas'), plate = root.querySelector('.l-map'), card = root.querySelector('.l-card');
  var scrub = root.querySelector('.l-scrub'), playB = root.querySelector('.l-play'), tlc = root.querySelector('.l-spark'), hud = root.querySelector('.l-hud'), msg = root.querySelector('.l-msg');
  var T = 1, playing = false, lastTs = 0, cam = null, opts = { labels: true, rays: true, health: true }, sel = null, started = false, loops = false;
  var PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z', PLAY = 'M8 5v14l11-7z';
  function fmtDate(d) { var t = new Date(Date.parse(D.day0 + 'T00:00:00Z') + d * 86400000); return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
  function setT(v, fromScrub) {
    T = clamp(v, 0, 1); if (!fromScrub) scrub.value = String(Math.round(T * 1000));
    var sc = sceneAt(T), tt = totals(sc), d = Math.round(T * (DAYS - 1));
    root.querySelector('[data-r=day]').textContent = String(d + 1);
    root.querySelector('[data-r=date]').textContent = fmtDate(d);
    root.querySelector('[data-r=members]').textContent = String(tt.n);
    root.querySelector('[data-r=tiles]').textContent = tt.tiles.toLocaleString('en-US');
    root.querySelector('[data-r=thr]').textContent = String(tt.thr);
    root.querySelector('[data-r=old]').textContent = String(tt.old);
    hud.textContent = tt.n + (tt.n === 1 ? ' plot' : ' plots') + ' · ' + tt.tiles.toLocaleString('en-US') + ' tiles · day ' + (d + 1);
    scrub.setAttribute('aria-valuetext', 'Day ' + (d + 1) + ', ' + fmtDate(d) + ', ' + tt.n + ' members');
    drawTL();
  }
  function setPlaying(v) { playing = v; playB.firstElementChild.firstElementChild.setAttribute('d', v ? PAUSE : PLAY); playB.setAttribute('aria-label', v ? 'Pause replay' : 'Play replay'); if (v) { if (T >= 1) setT(0); lastTs = 0; requestAnimationFrame(frame); } }
  function minK() { var w = cv.clientWidth || 600, base = w < 500 ? 6 : w < 800 ? 5 : 0; return V.s >= 2.2 ? 0 : V.s >= 1.5 ? Math.min(base, 3) : base; }
  function draw() { if (!D || !html.classList.contains('w-exp')) return; cam = render(cv, sceneAt(T), { labels: opts.labels, rays: opts.rays, health: opts.health, time: performance.now(), minLabelK: minK() }); }
  function frame(ts) { if (!playing) return; if (!lastTs) lastTs = ts; var dt = Math.min(100, ts - lastTs); lastTs = ts; setT(T + dt / 11000); draw(); if (T >= 1) { setPlaying(false); return; } requestAnimationFrame(frame); }
  var idle = 0;
  function idleLoop(ts) { if (!loops) return; if (!playing && !reduce && ts - idle > 120 && document.visibilityState === 'visible') { idle = ts; draw(); } requestAnimationFrame(idleLoop); }
  function stopLoops() { loops = false; if (playing) setPlaying(false); hideCard(); }
  function drawTL() { if (!tlc) return; var dpr = Math.min(2, devicePixelRatio || 1), w = tlc.clientWidth, h = tlc.clientHeight; if (!w) return; tlc.width = w * dpr; tlc.height = h * dpr; var c = tlc.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    var N = Math.min(80, Math.max(1, DAYS - 1)), pts = [], mx = 1; for (var i = 0; i <= N; i++) { var v = totals(sceneAt(i / N)).tiles; pts.push(v); mx = Math.max(mx, v); }
    c.beginPath(); c.moveTo(0, h - 4); pts.forEach(function (v, i) { c.lineTo(i / N * w, h - 4 - (h - 14) * v / mx); }); c.lineTo(w, h - 4); c.closePath(); c.fillStyle = 'rgba(139,108,246,.14)'; c.fill();
    c.beginPath(); pts.forEach(function (v, i) { var x = i / N * w, y = h - 4 - (h - 14) * v / mx; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.strokeStyle = 'rgba(185,166,255,.7)'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(0, h / 2 - 1, w, 2); c.fillStyle = '#8B6CF6'; c.fillRect(0, h / 2 - 1, w * T, 2); }

  // the card: land and the next step, health with the reason, repos with their last commit
  function why(m, st) { var d = m.d;
    if (!m.gh) return d == null ? 'no public GitHub yet; the land follows Caldera activity' : 'no public GitHub; last Caldera activity ' + (d ? d + ' d ago' : 'today');
    if (st === 0) return 'last commit ' + (d ? d + ' d ago' : 'today') + ', ' + m.f + ' of the last 4 weeks active';
    if (d == null) return 'no commits in the last year';
    return 'last commit ' + (d ? d + ' d ago' : 'today') + (st === 4 && d <= 365 ? ', archived' : ''); }
  function cardHtml(p) { var m = p.m, S = p.S, k = p.k, today = Math.round(T * (DAYS - 1)) === DAYS - 1;
    var next = k < 8 ? (k + 1) + '×' + (k + 1) + ' at score ' + ((k - 1) * 7) + ' (now ' + m.sc.toFixed(1) + ')' : 'at the cap';
    var rows = m.bl.slice(0, 4).map(function (b) { var d2 = b.a ? 'archived' : b.w ? 'this week' : b.last == null ? '' : b.last ? b.last + ' d ago' : 'today'; return '<div><span class="l-rn"><i style="background:' + langCol(b.l) + '"></i>' + esc(b.n) + '</span><span>' + d2 + '</span></div>'; }).join('');
    return '<button type="button" class="l-x" aria-label="Close">×</button><h3>' + esc(m.n) + ' <span class="l-st" style="color:' + S.dot + ';border-color:' + rgba(S.dot, .5) + '"><i></i>' + S.label + '</span></h3>'
      + '<div class="l-k">@' + esc(m.h) + (p.isNew ? ' · new this fortnight' : '') + (today ? ' · ' + esc(why(m, p.st)) : ' · as of ' + fmtDate(Math.round(T * (DAYS - 1)))) + '</div>'
      + '<div class="l-rows"><span>Land</span><b>' + k + '×' + k + ' · ' + (k * k) + ' tiles</b>' + (m.gh ? '<span>Next step</span><b>' + next + '</b><span>Commits, 12 mo</span><b>' + m.c.toLocaleString('en-US') + '</b><span>Merged PRs</span><b>' + m.p + '</b><span>Active repos · stars</span><b>' + m.r + ' · ' + m.s.toLocaleString('en-US') + '</b>' : '<span>Meter</span><b>Caldera activity</b>') + '</div>'
      + (m.gh ? '<div class="l-bar"><b style="width:' + Math.round(clamp(m.sc / 49, 0, 1) * 100) + '%"></b></div>' : '')
      + (rows ? '<div class="l-repos">' + rows + (m.bl.length > 4 ? '<div class="l-k">+' + (m.bl.length - 4) + ' more</div>' : '') + '</div>' : '')
      + '<a class="l-go" href="' + esc(m.u) + '">Walk into their city →</a>'; }
  function plotAt(mx, my) { if (!cam || !cam.sc) return null; var best = null, bd = 1e9;
    cam.sc.plots.forEach(function (p) { if (p.lx != null && Math.abs(mx - p.lx) <= p.lw / 2 + 4 && my <= p.ly + 6 && my >= p.ly - 24) { best = p; bd = -1; } });
    if (best) return best;
    cam.sc.plots.forEach(function (p) { var ctr = iso(p.x + p.k / 2 - .5, p.y + p.k / 2 - .5), sx = ctr.x * cam.z + cam.ox, sy = ctr.y * cam.z + cam.oy - 20 * cam.z, d = Math.hypot(mx - sx, my - sy), lim = Math.max(22, (TW * p.k * .5 + 20) * cam.z); if (d < lim && d < bd) { bd = d; best = p; } }); return best; }
  function showCard(p, x, y, sheet) { card.innerHTML = cardHtml(p); card.hidden = false; card.classList.toggle('l-sheet', !!sheet);
    var x2 = card.querySelector('.l-x'); if (x2) x2.onclick = function (e) { e.stopPropagation(); hideCard(); draw(); };
    if (sheet) { card.style.left = ''; card.style.top = ''; return; }
    var r = plate.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight, lx = x + 14, ly = y + 14;
    if (lx + w > r.width - 8) lx = Math.max(8, x - w - 14); if (ly + h > r.height - 8) ly = Math.max(8, r.height - h - 8);
    card.style.left = lx + 'px'; card.style.top = ly + 'px'; }
  function hideCard() { if (card) { card.hidden = true; } sel = null; }
  function local(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  var ptrs = {}, drag = null, moved = 0;
  function bind() {
    cv.addEventListener('pointerdown', function (e) { ptrs[e.pointerId] = local(e); moved = 0; var ks = Object.keys(ptrs);
      if (ks.length === 1) drag = { x: ptrs[ks[0]].x, y: ptrs[ks[0]].y, px: V.px, py: V.py };
      else if (ks.length === 2) { var a = ptrs[ks[0]], b = ptrs[ks[1]]; drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), s: V.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: V.px, py: V.py }; }
      try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
    cv.addEventListener('pointermove', function (e) { var pt = local(e);
      if (ptrs[e.pointerId]) { ptrs[e.pointerId] = pt; var ks = Object.keys(ptrs);
        if (drag && ks.length === 2 && drag.pinch) { var a = ptrs[ks[0]], b = ptrs[ks[1]], dd = Math.hypot(a.x - b.x, a.y - b.y); zoomAt(drag.cx, drag.cy, clamp(drag.s * dd / Math.max(10, drag.pinch), 1, 6) / V.s); moved = 99; draw(); return; }
        if (drag && ks.length === 1 && !drag.pinch) { var dx = pt.x - drag.x, dy = pt.y - drag.y; moved = Math.max(moved, Math.hypot(dx, dy)); if (moved > 6) { V.px = drag.px + dx; V.py = drag.py + dy; draw(); hideCardKeepSel(); } } return; }
      if (e.pointerType === 'mouse') { var p = plotAt(pt.x, pt.y), was = sel; cv.style.cursor = p ? 'pointer' : 'grab'; if (p) { sel = p.m; showCard(p, pt.x, pt.y, false); } else if (!card.hidden) { hideCard(); } if (sel !== was) draw(); } });
    function end(e) { var pt = local(e), was = ptrs[e.pointerId]; delete ptrs[e.pointerId]; if (Object.keys(ptrs).length === 0) { var tap = moved <= 6 && was; drag = null; if (tap) onTap(e, pt); } else drag = null; }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', function (e) { delete ptrs[e.pointerId]; drag = null; });
    cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !Object.keys(ptrs).length) { hideCard(); draw(); } });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); var pt = local(e); zoomAt(pt.x, pt.y, Math.exp(-e.deltaY * .0015)); draw(); }, { passive: false });
    cv.addEventListener('dblclick', function (e) { e.preventDefault(); });
  }
  function hideCardKeepSel() { if (card && !card.hidden && !card.classList.contains('l-sheet')) card.hidden = true; }
  function zoomAt(sx, sy, f) { var s2 = clamp(V.s * f, 1, 6); if (s2 === V.s) return;
    // keep the world point under (sx, sy) still: screen = cw/2 + (base - cw/2)*s + p, so p' = sx - (sx - cw/2 - p)*s'/s - cw/2*(1 - ...) simplified below
    var cw = cv.clientWidth, ch = cv.clientHeight, k = s2 / V.s;
    V.px = (sx - cw / 2) - ((sx - cw / 2) - V.px) * k; V.py = (sy - ch / 2) - ((sy - ch / 2) - V.py) * k; V.s = s2;
    if (V.s === 1) { V.px = 0; V.py = 0; } }
  function onTap(e, pt) { var p = plotAt(pt.x, pt.y);
    if (!p) { hideCard(); draw(); return; }
    if (e.pointerType === 'mouse') { location.href = p.m.u; return; }   // desktop: hover shows the card, a click walks in
    if (sel === p.m && !card.hidden) { location.href = p.m.u; return; }   // touch: the first tap opens the card, a second walks in
    sel = p.m; showCard(p, pt.x, pt.y, (cv.clientWidth || 0) <= 600); draw(); }
  function tool(b, key) { b.addEventListener('click', function () { opts[key] = !opts[key]; b.setAttribute('aria-pressed', String(opts[key])); draw(); }); }

  function init(data) {
    D = data; DAYS = Math.max(1, data.days | 0); scenes = {};
    MS = data.members.map(function (m) { return m; });
    FINAL = scene(DAYS - 1);
    root.querySelector('[data-r=first]').textContent = fmtDate(0);
    root.querySelector('[data-r=last]').textContent = 'Today';
    if (msg) msg.hidden = true;
    bind();
    root.querySelectorAll('[data-tool]').forEach(function (b) { tool(b, b.getAttribute('data-tool')); });
    playB.addEventListener('click', function () { setPlaying(!playing); });
    scrub.addEventListener('input', function () { if (playing) setPlaying(false); setT(+scrub.value / 1000, true); draw(); });
    var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { drawTL(); draw(); }, 120); });
    if (window.ResizeObserver) new ResizeObserver(function () { draw(); }).observe(plate);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    begin();
  }
  function begin() {
    var w0 = cv.clientWidth || 0, h0 = cv.clientHeight || 0; if (w0 && w0 < 600 && h0 > w0) V.s = 1.9;   // portrait phone: the island fills the height; pinch out for all of it
    loops = true; requestAnimationFrame(idleLoop);
    if (reduce || DAYS <= 1) { setT(1); draw(); setPlaying(false); }
    else { setT(0); draw(); setPlaying(true); }
  }
  function start() {
    if (started) { if (D) { if (!loops) { loops = true; requestAnimationFrame(idleLoop); } setT(T); draw(); } return; }
    started = true;
    fetch('/v1/world/land', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(init)
      .catch(function () { if (msg) { msg.hidden = false; msg.textContent = 'The land map could not load. Try again in a minute.'; } started = false; });
  }

  // first paint: ?view= wins, then this viewer's last choice (the head script already set the class to avoid a flash)
  var v0 = 'current';
  try { var qv = new URL(location.href).searchParams.get('view'); if (qv === 'expansion' || qv === 'current') v0 = qv; else if (localStorage.getItem(KEY) === 'expansion') v0 = 'expansion'; } catch (e) {}
  setView(v0, false);
}
export const LAND_JS = "(" + landClient.toString() + ")();";

/** Read before first paint so the right view shows without a flash (a tiny head script). */
export const LAND_HEAD_JS = `(function(){try{var v=new URL(location.href).searchParams.get('view');if(v!=='expansion'&&v!=='current')v=localStorage.getItem('caldera.worldView');if(v==='expansion')document.documentElement.classList.add('w-exp')}catch(e){}})();`;

export const LAND_CSS = `
.w-view{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,.14));background:var(--surface,rgba(255,255,255,.04));align-self:center;flex:none}
.w-view button{font:600 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif);min-height:32px;padding:0 14px;border:0;border-radius:999px;background:transparent;color:var(--text-muted,#9A9AA5);cursor:pointer}
.w-view button[aria-pressed="true"]{background:#8B6CF6;color:#fff}
.w-view button:focus-visible{outline:2px solid #B9A6FF;outline-offset:2px}
@media (pointer:coarse){.w-view button{min-height:40px}}
.w-maps{position:relative}
.w-exp-only{display:none}html.w-exp .w-exp-only{display:revert}html.w-exp .w-cur-only{display:none}
.l-stage{display:none;position:absolute;inset:0;z-index:20;grid-template-rows:minmax(0,1fr) auto;border-radius:var(--radius-md,10px);overflow:hidden;border:1px solid rgba(140,170,230,.3);background:#04060E;color:#E8EEF8}
html.w-exp .l-stage{display:grid}
.l-map{position:relative;min-height:0;overflow:hidden}
.l-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.l-hud{position:absolute;left:10px;top:10px;font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(10,14,26,.72);border:1px solid rgba(79,209,197,.45);border-radius:999px;padding:7px 11px;pointer-events:none;white-space:nowrap;max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis}
.l-tools{position:absolute;right:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.l-tools button{font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(10,14,26,.72);border:1px solid rgba(79,209,197,.45);border-radius:999px;padding:7px 11px;cursor:pointer;min-height:30px}
.l-tools button[aria-pressed="true"]{background:rgba(79,209,197,.18);border-color:rgba(79,209,197,.8)}
.l-tools button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.l-msg{position:absolute;inset:0;display:grid;place-items:center;font:14px var(--font-sans,sans-serif);color:#C9D2E6;pointer-events:none}
.l-msg[hidden],.l-card[hidden]{display:none}
.l-card{position:absolute;z-index:3;width:min(300px,calc(100% - 24px));max-height:calc(100% - 20px);overflow:auto;background:rgba(17,20,32,.95);color:#F2F2F5;border:1px solid rgba(185,166,255,.35);border-radius:12px;padding:12px 14px;font:13px/1.45 var(--font-sans,'IBM Plex Sans',sans-serif);box-shadow:0 18px 40px -16px rgba(0,0,0,.8);pointer-events:none}
.l-card.l-sheet{pointer-events:auto;left:8px!important;right:8px;bottom:8px;top:auto!important;width:auto;max-height:70%}
.l-card h3{font:600 15px/1.2 var(--font-sans,'IBM Plex Sans',sans-serif);color:#fff;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 22px 2px 0;overflow-wrap:anywhere}
.l-card .l-k{color:#9FA4B5;font-size:12px;overflow-wrap:anywhere}
.l-card .l-st{display:inline-flex;align-items:center;gap:6px;font:500 11px/1 var(--font-mono,'IBM Plex Mono',monospace);padding:4px 8px;border-radius:999px;border:1px solid}
.l-card .l-st i{width:7px;height:7px;border-radius:50%;background:currentColor;display:inline-block}
.l-card .l-rows{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 12px;margin-top:8px;font-variant-numeric:tabular-nums}
.l-card .l-rows span{color:#9FA4B5}.l-card .l-rows b{font-weight:500;text-align:right}
.l-card .l-repos{margin-top:8px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px;display:grid;gap:4px}
.l-card .l-repos div{display:flex;justify-content:space-between;gap:10px;font-variant-numeric:tabular-nums}
.l-card .l-repos i{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:-1px}
.l-card .l-repos span{color:#9FA4B5;white-space:nowrap}.l-card .l-repos .l-rn{color:#F2F2F5;overflow:hidden;text-overflow:ellipsis;min-width:0}
.l-card .l-go{display:inline-block;margin-top:8px;color:#B9A6FF;text-decoration:none;font-weight:600;min-height:24px}
.l-card .l-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin-top:6px;overflow:hidden}
.l-card .l-bar b{display:block;height:100%;background:linear-gradient(90deg,#8B6CF6,#4FD1C5)}
.l-card .l-x{display:none;position:absolute;right:6px;top:6px;width:36px;height:36px;border:0;background:transparent;color:#C9D2E6;font-size:22px;line-height:1;cursor:pointer;border-radius:50%}
.l-card.l-sheet .l-x{display:block}
.l-tl{display:grid;gap:6px;background:#0F1016;border-top:1px solid rgba(255,255,255,.08);padding:8px 12px 10px}
.l-row{display:flex;align-items:center;gap:12px;min-width:0}
.l-play{width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:#1E1F2B;color:#F2F2F5;cursor:pointer;display:grid;place-items:center;flex:none}
.l-play:hover{border-color:#8B6CF6}.l-play:focus-visible{outline:2px solid #8B6CF6;outline-offset:2px}
.l-play svg{width:18px;height:18px;fill:currentColor}
.l-track{flex:1 1 auto;min-width:0;position:relative;height:40px;display:flex;align-items:center}
.l-spark{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:8px}
.l-scrub{position:relative;width:100%;margin:0;-webkit-appearance:none;appearance:none;background:transparent;height:40px;cursor:pointer}
.l-scrub::-webkit-slider-runnable-track{height:4px;background:transparent}
.l-scrub::-moz-range-track{height:4px;background:transparent}
.l-scrub::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#8B6CF6;border:2px solid #fff;box-shadow:0 0 0 4px rgba(139,108,246,.25);margin-top:-7px}
.l-scrub::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#8B6CF6;border:2px solid #fff}
.l-scrub:focus-visible{outline:2px solid #8B6CF6;outline-offset:2px;border-radius:8px}
.l-read{display:flex;gap:4px 14px;flex-wrap:wrap;font:500 12px/1.4 var(--font-mono,'IBM Plex Mono',monospace);color:#9A9AA5;font-variant-numeric:tabular-nums;min-width:0}
.l-read b{color:#F2F2F5;font-weight:500}
.l-marks{display:flex;justify-content:space-between;font:11px/1.2 var(--font-mono,'IBM Plex Mono',monospace);color:#9A9AA5}
.l-legend{display:flex;flex-wrap:wrap;gap:4px 14px}.l-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:-1px}
@media (max-width:600px){.l-tools .t-txt{display:none}.l-read .l-opt{display:none}.l-tl{padding:6px 10px 8px}.l-marks{display:none}.l-hud{display:none}}
`;

export function landMarkup(): string {
  return `<div class="l-stage" id="land" aria-label="Expansion view: land earned by code, replayed from the first day">
<div class="l-map"><canvas class="l-canvas" role="img" aria-label="Isometric land map: each member's plot grows with their public GitHub activity and weathers when it goes quiet"></canvas>
<div class="l-hud" aria-hidden="true"></div>
<div class="l-tools"><button type="button" data-tool="labels" aria-pressed="true">Labels</button><button type="button" data-tool="rays" aria-pressed="true" aria-label="Friendships">&#x2727;<span class="t-txt"> Friendships</span></button><button type="button" data-tool="health" aria-pressed="true" aria-label="Health tint">&#x25CF;<span class="t-txt"> Health tint</span></button></div>
<div class="l-msg">Loading the land map&hellip;</div>
<div class="l-card" hidden></div></div>
<div class="l-tl" aria-label="Settlement timeline">
<div class="l-row"><button type="button" class="l-play" aria-label="Play replay"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
<div class="l-track"><canvas class="l-spark" aria-hidden="true"></canvas><input type="range" class="l-scrub" min="0" max="1000" value="1000" step="1" aria-label="Replay position"></div></div>
<div class="l-read"><span>Day <b data-r="day">1</b></span><span><b data-r="date"></b></span><span>Members <b data-r="members">0</b></span><span class="l-opt">Land <b data-r="tiles">0</b> tiles</span><span class="l-opt">Thriving <b data-r="thr">0</b></span><span class="l-opt">Weathered or dormant <b data-r="old">0</b></span></div>
<div class="l-marks"><span data-r="first">Day 1</span><span class="l-legend"><span><i style="background:#4FD1A0"></i>Thriving</span><span><i style="background:#8BD17A"></i>Active</span><span><i style="background:#C9C27A"></i>Settled</span><span><i style="background:#D1A05A"></i>Weathered</span><span><i style="background:#9A8E86"></i>Dormant</span></span><span data-r="last">Today</span></div>
</div></div>`;
}
