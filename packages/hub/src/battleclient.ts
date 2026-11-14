// @ts-nocheck
/**
 * The World page's Battle view in the browser (Mike 2026-11-07): the Battle button in the Now | Day | Week | Month switcher,
 * the legend chip on the map ("Firing until midnight" / "Rebuilding until noon" with a countdown on the viewer's clock), the
 * battle bar under the map (last night's numbers, the layer toggles Damage / Attacks / Shields / Replay, the member's own
 * panel: join or leave, tonight's arsenal, shield, optional manual fire, the report email), the season board, and the morning
 * card "What your city did last night". The map is drawn by the city renderer (citybattle.ts), driven through
 * window.CALDERA_BATTLE_API: supply drop at noon local, one salvo at 20:00, cranes rebuild from midnight to noon (Mike 11-07).
 * Replay (Mike 11-08) is cinematic: one strike beat per city, the camera zooms to the pad, follows the missiles into the hit and
 * resets to the next city, then the wide shot, the cranes, home. It runs 2.5x slower than the first cut (Mike 11-08: "moves too fast on
 * battle and user needs to be able to zoom out and control camera"): about 60 s for the demo at 1x, 35 to 100 s in all. One compact control bar on the map: Strike n
 * of m with the damage tier of the last hit, Prev, Pause / Play, Next, speed (0.5x / 1x / 2x, remembered per viewer in localStorage),
 * Fit (the whole battlefield), Follow (shown once the viewer has panned or zoomed: gives the camera back to the auto camera), End.
 * The viewer's camera: wheel, trackpad pinch (ctrl+wheel) or pinch to zoom, drag to pan (citybattle.ts and city.ts clamp both); a tap on
 * the map still skips to the next strike. "Demo replay" plays a sample battle between the biggest cities (synthetic shots, labelled demo).
 * Shareable: /world?view=battle, &layers=damage,attacks,shields,replay, &replay=1 or &replay=demo.
 * Shipped as the source of battleClient() (self-contained).
 */
/** The replay speed: 0.5x, 1x or 2x, remembered per viewer. Self-contained (shipped inside the page script ahead of battleClient) and
 *  safe where storage is blocked or throws (private windows, cleared site data): every read and write is in try/catch. */
export function battleSpeedLib() {
  var SPEEDS = [0.5, 1, 2], KEY = 'caldera.world.battleSpeed';
  function ok(v) { v = +v; return SPEEDS.indexOf(v) >= 0 ? v : 1; }
  function next(v) { return SPEEDS[(SPEEDS.indexOf(ok(v)) + 1) % SPEEDS.length]; }
  function label(v) { return ok(v) + 'x'; }
  function load(store) { try { var raw = (store || localStorage).getItem(KEY); return raw == null ? 1 : ok(raw); } catch (e) { return 1; } }
  function save(v, store) { try { (store || localStorage).setItem(KEY, String(ok(v))); return true; } catch (e) { return false; } }
  return { SPEEDS: SPEEDS, KEY: KEY, ok: ok, next: next, label: label, load: load, save: save };
}

export function battleClient() {
  'use strict';
  var B0 = window.CALDERA_BATTLE; if (!B0) return;
  var bar = document.getElementById('b-bar'), stage = document.getElementById('stage'), data = B0, me = null, on = false, playing = null, speed = BSPD.load();   // speed: this viewer's choice, 1x unless they changed it
  var LKEY = 'caldera.world.battleLayers', LAYERS = ['damage', 'attacks', 'shields', 'replay'];
  var layers = { damage: true, attacks: true, shields: true, replay: false };
  try { var sv = JSON.parse(localStorage.getItem(LKEY) || 'null'); if (sv) LAYERS.forEach(function (k) { if (k in sv && k !== 'replay') layers[k] = !!sv[k]; }); } catch (e) {}
  var U = null; try { U = new URL(location.href); } catch (e) {}
  var qp = U && U.searchParams.get('layers'); if (qp !== null && qp !== undefined && U.searchParams.has('layers')) { var want = qp.split(','); LAYERS.forEach(function (k) { layers[k] = want.indexOf(k) >= 0; }); }
  var replayNight = U && U.searchParams.has('replay'), replayMode = U && U.searchParams.get('replay') === 'demo' ? 'demo' : undefined; if (replayNight) layers.replay = true;
  function api() { return window.CALDERA_BATTLE_API; }
  function q(sel) { return bar ? bar.querySelector(sel) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setText(k, v) { var el = q('[data-b="' + k + '"]'); if (el) el.textContent = v; }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dLabel(iso) { var t = new Date(iso + 'T12:00:00Z'); return MON[t.getUTCMonth()] + ' ' + t.getUTCDate(); }
  function hhmm(t) { var d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function until(t) { var m = Math.max(0, Math.round((t - Date.now()) / 60000)); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; }
  var WN = { orbital: 'orbital strike', beam: 'beam tower', cannon: 'cannon', catapult: 'catapult' };   // weapon names on nights from before 11-13
  // ---------------------------------------------------------------- 11-13: dollars, sizes, "How damage works" and the per-shot math
  function usd(n) { n = Math.round(n || 0); var f = function (v, u) { return '$' + (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + u; }; return n >= 1e9 ? f(n / 1e9, 'B') : n >= 1e6 ? f(n / 1e6, 'M') : n >= 1e3 ? f(n / 1e3, 'k') : '$' + n; }
  function pct(v) { v = (v || 0) * 100; return (v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + '%'; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function rules() { return data.rules || null; }
  function wOf(k) { var r = rules(), L = r ? r.weapons : []; for (var i = 0; i < L.length; i++) if (L[i].k === k) return L[i]; return null; }
  function wName(k) { var w = wOf(k); return w ? w.name : WN[k] || k; }
  function shotUsd(s) { var x = s[8]; return x ? (x.u || 0) + (x.fu || 0) : Math.round(s[3] * 5e6); }
  function sizesOf(n) { var out = []; (rules() ? rules().weapons : []).forEach(function (w) { if (n && n[w.k]) out.push(n[w.k] + ' ' + w.size); }); return out.join(', '); }
  function sizeChips(n, tech) { return (rules() ? rules().weapons : []).map(function (w) { var c = n && n[w.k] || 0; return '<span class="b-sz' + (w.tech > tech ? ' lock' : c ? ' has' : '') + '" title="' + esc(w.name + ', ' + w.tnt + ' kg TNT, ' + usd(w.cost) + (w.tech > tech ? ' (locked)' : '')) + '"><i>' + w.size + '</i>' + c + '</span>'; }).join(''); }
  function nameOf(h) { return h.charAt(0) === '@' ? h : 'the raiders'; }
  function dl(rows) { return '<dl class="b-math">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>'; }
  /** one shot, step by step: the same numbers the 2am battle used (the row's x) */
  function shotHtml(s) {
    var x = s[8], w = wOf(s[2]), r = rules(), who = (s[0].charAt(0) === '@' ? s[0] : 'Raiders') + ' fired at ' + nameOf(s[1]);
    if (!x || !w || !r) return '<p><b>' + esc(who) + '</b> with a ' + esc(wName(s[2])) + '. That night was fought before the dollar rules: ' + (s[6] ? 'the shield held.' : 'the hit counts as ' + usd(shotUsd(s)) + '.') + '</p>';
    var c = r.classes[x.c] || r.classes[0], rows = [
      ['Weapon', w.name + ' (' + w.size + '): ' + w.tnt + ' kg of TNT, ' + usd(w.cost)],
      ['Accuracy', 'half its shots land within ' + x.cep + ' m; this one landed ' + x.m + ' m off' + (x.m <= r.half ? ', on the building' : ', ' + r1(x.m - r.half) + ' m outside the wall')],
      ['Building', c.name + ', ' + x.fl + ' floors, worth ' + usd(x.v) + '; it fails at ' + c.kpa + ' kPa'],
      ['Blast', 'wrecks everything within ' + x.r + ' m' + (x.m > r.half ? '; ' + x.kpa + ' kPa reached the wall' : '')],
      ['Blast share', pct(x.raw) + ' of the building']];
    if (x.st < 1) rows.push(['Already wrecked', 'x ' + x.st + ' (only what still stands can break)']);
    if (x.cd < 1) rows.push(['Civil defence', 'x ' + x.cd + ' (each hit on a city makes the next one count less)']);
    if (x.pc < 1) rows.push(['Team size', 'x ' + x.pc + ' (a team hits per head)']);
    if (x.sh > 0) rows.push(['Shield', 'stopped ' + Math.round(x.sh * 100) + '%']);
    if (s[6]) rows.push(['Result', 'Shield held. Without it: ' + usd(x.pot) + ' of damage']);
    else { rows.push(['Blast damage', pct(s[3]) + ' of ' + usd(x.v) + ' = ' + usd(x.u)]); rows.push(['Fire', (x.sp ? 'spread through the floors' : 'contained') + ': ' + pct(x.fi) + ' more over about 4 hours = ' + usd(x.fu)]); rows.push(['Total', usd(x.u + x.fu)]); }
    return '<p><b>' + esc(who) + '</b></p>' + dl(rows);
  }
  /** no shot under the new rules yet: the same math on a made-up hit, marked as an example */
  function sampleHtml() {
    var r = rules(), w = wOf('rocket'); if (!r || !w) return ''; var c = r.classes[1], fl = 12, rad = c.z * Math.pow(w.tnt, 1 / 3), vol = r.footprint * fl * r.floorM, share = Math.min(1, 2 / 3 * Math.PI * rad * rad * rad / vol), v = fl * r.footprint * c.sqm, fi = share * c.load * r.fire.spread;
    return '<p><b>Example (not a real shot)</b></p>' + dl([['Weapon', w.name + ' (' + w.size + '): ' + w.tnt + ' kg of TNT, ' + usd(w.cost)], ['Building', c.name + ', ' + fl + ' floors, worth ' + usd(v) + '; it fails at ' + c.kpa + ' kPa'], ['Blast', 'a direct hit wrecks everything within ' + r1(rad) + ' m'], ['Blast damage', pct(share) + ' of ' + usd(v) + ' = ' + usd(share * v)], ['Fire', 'if it spreads: ' + pct(fi) + ' more over about 4 hours = ' + usd(fi * v)], ['Total', usd((share + fi) * v)]]);
  }
  function nightShots(night) { return night && data.prev && data.prev.night === night ? data.prev.shots || [] : data.shots || []; }
  function pickShot() { var best = null, bv = -1, mh = me && me.h ? String(me.h).replace(/^@?/, '@') : null; (data.shots || []).forEach(function (s) { if (!s[8]) return; var v = shotUsd(s) + (s[6] ? 0 : 1) + (mh && (s[0] === mh || s[1] === mh) ? 1e12 : 0); if (v > bv) { bv = v; best = s; } }); return best; }
  var howEl = null, howShot = null;
  function howHtml() {
    var r = rules(); if (!r) return '<p>The rules load with the battle. Try again in a moment.</p>';
    var W = r.weapons, row = function (cells, th) { return '<tr>' + cells.map(function (c, i) { return (th || i === 0 ? '<th scope="' + (th ? 'col' : 'row') + '">' : '<td>') + c + (th || i === 0 ? '</th>' : '</td>'); }).join('') + '</tr>'; };
    var tbl = function (head, rows) { return '<div class="b-tw"><table>' + row(head, true) + rows.map(function (x) { return row(x); }).join('') + '</table></div>'; };
    var unlock = ['any city', 'a mid-rise', 'a tower', 'a campus'];
    var ex = howShot || pickShot(), mine = ex && me && me.h && (ex[0] === String(me.h).replace(/^@?/, '@') || ex[1] === String(me.h).replace(/^@?/, '@'));
    var pts = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(function (t) { return (10 + t * 55) + ',' + (70 - 60 * (1 - Math.exp(-t / r.fire.tauH))).toFixed(1); }).join(' ');
    return '<h2 id="b-how-t">How damage works</h2><p class="b-lede">These are the numbers the 2am battle runs on. Nothing is rounded to zero and nothing is capped.</p>'
      + '<section id="b-how-shot"><h3>' + (howShot ? 'This shot' : ex ? (mine ? 'Your city last night' : 'From last night') : 'A worked example') + '</h3>' + (ex ? shotHtml(ex) : sampleHtml()) + '</section>'
      + '<section><h3>1. Your day of code is the budget</h3>' + tbl(['Work that day', 'Munitions budget'], [['Commit', usd(r.usd)], ['Merged pull request', usd(r.usd * r.w.pr) + ' (' + usd(r.usd * r.w.pr_self) + ' if you merged your own)'], ['Release', usd(r.usd * r.w.release)], ['Green CI run', usd(r.usd * r.w.ci_green)]])
      + '<p>AI work multiplies a repo by up to 1.6 and a streak multiplies the day by up to 1.5. There is no cap: twice the work buys twice the missiles. Bot, empty, merge and fork commits earn nothing, and a revert cancels the commit it reverts.</p></section>'
      + '<section><h3>2. The budget buys missiles</h3>' + tbl(['Size', 'Weapon', 'Price', 'TNT', 'Half land within', 'Fire spreads'], W.map(function (w) { return ['<b class="b-szl">' + w.size + '</b>', esc(w.name) + '<br><small>' + esc(w.like) + '</small>', usd(w.cost), w.tnt + ' kg', w.cep + ' m', Math.round(w.fire * 100) + '%']; }).reverse())
      + '<p>The battle buys the biggest size your city has unlocked, then spends the change on smaller ones.</p></section>'
      + '<section><h3>3. What unlocks bigger missiles</h3><ul><li><b>Tallest building.</b> ' + W.slice().reverse().map(function (w) { return w.size + ': ' + unlock[w.tech]; }).join(', ') + '. A tall repo tower counts like the lot.</li><li><b>A release in the last ' + r.relDays + ' days:</b> one size up.</li><li><b>A green CI run that day:</b> one size up.</li><li><b>Streak:</b> ' + r.guide.slice().reverse().map(function (g) { return (g.streak ? g.streak + ' days: ' : '') + g.name + (g.x < 1 ? ' (misses x ' + g.x + ')' : ''); }).join(', ') + '.</li><li><b>AI work:</b> tightens the aim by up to 1.6 times.</li><li><b>Merged pull requests:</b> each puts one more rival in reach, from ' + r.reach + ' up to ' + r.reachMax + '.</li></ul></section>'
      + '<section><h3>4. Blast against the building</h3><p>A warhead wrecks what is inside its blast radius. The radius grows with the cube root of the TNT (8 times the TNT, twice the radius) and is shorter against tougher construction. This is Hopkinson-Cranz scaling with the Mills overpressure curve.</p>'
      + tbl(['Construction', 'Fails at', 'Worth per m2'].concat(W.slice().reverse().map(function (w) { return w.size + ' radius'; })), r.classes.map(function (c) { return [esc(c.name), c.kpa + ' kPa', usd(c.sqm)].concat(W.slice().reverse().map(function (w) { return r1(c.z * Math.pow(w.tnt, 1 / 3)) + ' m'; })); }))
      + '<p>A building is ' + (r.half * 2) + ' m by ' + (r.half * 2) + ' m with ' + r.floorM + ' m floors, so its value is floors x ' + r.footprint + ' m2 x the price per m2. Damage is the wrecked volume as a share of the building, times its value. A miss past the wall wrecks less, a far miss breaks glass only (' + pct(r.light) + '), and every hit that lands does damage.</p></section>'
      + '<section><h3>5. Shields and tired defenders</h3><ul><li><b>Beginner shield:</b> stops everything for your first 30 days and until you have 7 active days.</li><li><b>Streak shield:</b> stops 50% at a 7-day streak, rising to 95% at 30 days.</li><li>A stopped hit flashes on the dome and shows what it would have cost.</li><li>Each hit on a city makes the next one count a little less, wrecked floors cannot be wrecked twice, and a team hits per head. None of these ever takes a hit to zero.</li></ul></section>'
      + '<section><h3>6. Fire and smoke</h3><p>Every hit starts a fire. A contained fire adds ' + Math.round(r.fire.small * 100) + '% of the blast damage and a fire that spreads adds ' + Math.round(r.fire.spread * 100) + '%, both scaled by how well the building burns (timber most, concrete least). It burns down as 1 - e^(-t / ' + r.fire.tauH + ' h): 63% in the first hour, out after about ' + r.fire.outH + ' hours, smoke until ' + r.fire.emberH + '.</p>'
      + '<svg class="b-curve" viewBox="0 0 240 86" role="img" aria-label="Share of the fire damage done over four hours: 63% after one hour, 86% after two, 98% after four"><path d="M10 70H232M10 70V8" fill="none" stroke="currentColor" stroke-opacity=".35"/><polyline points="' + pts + '" fill="none" stroke="#FFB347" stroke-width="2"/><circle cx="65" cy="' + (70 - 60 * (1 - Math.exp(-1))).toFixed(1) + '" r="3" fill="#FFB347"/><text x="71" y="' + (70 - 60 * (1 - Math.exp(-1)) + 12).toFixed(1) + '" font-size="9" fill="currentColor">63% at 1 h</text><text x="10" y="82" font-size="8" fill="currentColor" fill-opacity=".7">0 h</text><text x="222" y="82" font-size="8" fill="currentColor" fill-opacity=".7">4 h</text></svg></section>'
      + '<section><h3>7. Rebuilding</h3><p>Cranes rebuild ' + Math.round(r.autoRepair * 100) + '% a day on their own and ' + Math.round(r.repairPerPt * 100) + '% more for every point of new work. A city is whole again within 4 days with no action at all.</p></section>'
      + '<p class="b-ad">Run more agents, ship more commits, get more ammo. <b>Orpheus</b> shows each Claude account\'s weekly and 5-hour limit and when it resets, and moves idle agents to the account with the most room. <a href="https://useorpheus.com/app?utm_source=caldera&utm_medium=battle_explainer" target="_blank" rel="noopener">Start 14-day trial</a></p>';
  }
  function closeHow() { if (howEl) { howEl.hidden = true; } howShot = null; var b = q('[data-bhow]'); if (b) b.setAttribute('aria-expanded', 'false'); }
  function openHow(shot) {
    howShot = shot || null;
    if (!howEl) { howEl = document.createElement('aside'); howEl.className = 'b-how'; howEl.setAttribute('role', 'dialog'); howEl.setAttribute('aria-labelledby', 'b-how-t'); howEl.tabIndex = -1; document.body.appendChild(howEl);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && howEl && !howEl.hidden) closeHow(); }); }
    howEl.innerHTML = '<button type="button" class="b-hx" aria-label="Close">&times;</button><div class="b-hb">' + howHtml() + '</div>'; howEl.hidden = false; howEl.querySelector('.b-hx').onclick = closeHow; howEl.querySelector('.b-hb').scrollTop = 0;
    var b = q('[data-bhow]'); if (b) b.setAttribute('aria-expanded', 'true'); try { howEl.focus({ preventScroll: true }); } catch (e) {}
  }
  var howBtn = q('[data-bhow]'); if (howBtn) howBtn.addEventListener('click', function () { if (howEl && !howEl.hidden) closeHow(); else openHow(null); });
  if (U && U.searchParams.has('how')) setTimeout(function () { openHow(null); }, 0);
  /** the lists under the bar: every city's arsenal by size, and last night's shots (tap one for its math) */
  function lists() {
    var ar = q('[data-b="arsenals"]'), M = data.members || {}, keys = Object.keys(M).sort(function (a, b) { return (M[b].usd || 0) - (M[a].usd || 0) || (a < b ? -1 : 1); });
    if (ar) { var armed = keys.filter(function (k) { return M[k].usd > 0; }).length; var sm = q('[data-b="arsum"]'); if (sm) sm.textContent = 'Arsenals building today: ' + armed + ' of ' + keys.length + ' cit' + (keys.length === 1 ? 'y' : 'ies') + ' armed so far';
      var show = keys.filter(function (k) { return M[k].usd > 0; }).slice(0, 40), rest = keys.length - show.length, idle = keys.length - armed;
      ar.innerHTML = keys.length ? (show.length ? '<ul class="b-al">' : '') + show.map(function (k) { var m = M[k]; return '<li><button type="button" data-fly="' + esc(k) + '">' + esc(k) + '</button><b>' + usd(m.usd || 0) + '</b><span class="b-szs">' + sizeChips(m.n, m.tech || 0) + '</span><i>' + esc(m.guide || 'Inertial') + ', shield ' + Math.round((m.sh || 0) * 100) + '%</i></li>'; }).join('') + (show.length ? '</ul>' : '') + (rest > 0 ? '<p class="b-small">' + (armed > show.length ? (armed - show.length) + ' more armed with smaller budgets. ' : '') + (idle ? idle + ' cit' + (idle === 1 ? 'y has' : 'ies have') + ' no budget yet today: no judged commits, pull requests, releases or green CI so far.' : '') + '</p>' : '') : '<p>No cities in the battles yet.</p>'; }
    var sl = q('[data-b="shotlist"]'), S = data.shots || [];
    if (sl) { var ord = S.map(function (s, i) { return i; }).sort(function (a, b) { return shotUsd(S[b]) - shotUsd(S[a]) || a - b; }); var ss = q('[data-b="shotsum"]'); if (ss) ss.textContent = 'Last night, shot by shot (' + S.length + '): tap one for the math';
      sl.innerHTML = S.length ? '<ul class="b-sl">' + ord.slice(0, 80).map(function (i) { var s = S[i], w = wOf(s[2]); return '<li><button type="button" data-shot="' + i + '"><span>' + esc(s[0].charAt(0) === '@' ? s[0] : 'Raiders') + ' → ' + esc(nameOf(s[1])) + '</span><i>' + esc(w ? w.size + ' ' + w.name.toLowerCase() : wName(s[2])) + '</i><b>' + (s[6] ? 'shield held' : '-' + usd(shotUsd(s)) + (s[8] && s[8].sp ? ' +fire' : '')) + '</b></button></li>'; }).join('') + '</ul>' : '<p>No missiles last night.</p>';
      Array.prototype.slice.call(sl.querySelectorAll('[data-shot]')).forEach(function (b) { b.onclick = function () { openHow(S[+b.getAttribute('data-shot')]); }; }); }
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error || r.status); return j; }); });
  }
  function load() { return fetch('/v1/world/battle', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) { data = d; if (api()) api().view(on, d); stats(); } return d; }).catch(function () {}); }
  function stats() {
    var s = data.shots || [], landed = s.filter(function (x) { return x[3] > 0; }).length;
    setText('date', 'Last night, ' + dLabel(data.night));
    setText('cities', String(data.cities || 0)); setText('cl', data.cities === 1 ? 'city in the battles' : 'cities in the battles');
    setText('shots', String(s.length)); setText('landed', String(landed)); setText('dmg', usd(data.usd != null ? data.usd : s.reduce(function (t, x) { return t + shotUsd(x); }, 0))); setText('fires', String(data.fires || 0));
    setText('season', 'Season ' + data.season.n + ', week ' + data.season.week);
    setText('next', 'Next night resolves ' + hhmm(data.next) + ' (in ' + until(data.next) + '), fires from noon');
    var bd = q('[data-b="board"]');
    if (bd) bd.innerHTML = (data.board || []).length ? '<ol>' + data.board.map(function (r) { return '<li><button type="button" data-fly="' + esc(r[0]) + '">' + esc(r[0]) + '</button> <b>' + usd(r[1]) + '</b></li>'; }).join('') + '</ol>' : '<p>No scores yet. The first battle sets the board.</p>';
    lists();
    Array.prototype.slice.call(bar.querySelectorAll('[data-fly]')).forEach(function (b) { b.onclick = function () { if (api()) api().fly(b.getAttribute('data-fly')); }; });
  }
  // ---------------------------------------------------------------- the view: shown and hidden by the switcher (growthclient.ts)
  var chip = null, chipT = 0, pollT = 0;
  function chipTick() {
    if (!on || !api() || !api().phase) return; var ph = api().phase(), left = Math.max(0, ph.until - Date.now()), h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), sec = Math.floor(left / 1000);
    if (!chip) { chip = document.createElement('div'); chip.className = 'b-chip'; chip.setAttribute('role', 'status'); chip.setAttribute('aria-live', 'polite'); chip.innerHTML = '<i></i><b></b><span></span>'; if (stage) stage.appendChild(chip); }
    if (ph.replay) { chip.classList.toggle('rebuild', ph.stage === 'rebuild'); chip.querySelector('b').textContent = ph.demo ? 'Demo replay' : 'Replay'; chip.querySelector('span').textContent = (ph.stage === 'beat' || ph.stage === 'pre' ? 'Strike ' + ph.beat + ' of ' + ph.beats + (ph.label ? ' \u00b7 ' + ph.label : '') : ph.label || '') + (ph.paused ? ' \u00b7 paused' : ''); hud(ph); return; }
    var reb = ph.seg === 'rebuild', left2 = h + 'h ' + (m < 10 ? '0' : '') + m + 'm', L = { idle: 'Quiet', supply: 'Supply drop', loading: 'Loading', countdown: 'Salvo', salvo: 'Salvo', damage: 'Hit', rebuild: 'Rebuilding until noon' }[ph.seg] || 'Battle';
    var tail = ph.seg === 'supply' || ph.seg === 'loading' ? 'salvo ' + (ph.replay ? 'in ' + left2 : 'at ' + hhmm(ph.salvoAt)) + ' \u00b7 ' + ph.landed + ' of ' + ph.total + ' stacked' : ph.seg === 'countdown' ? 'in ' + Math.max(1, Math.ceil(left / 1000)) : ph.seg === 'salvo' || ph.seg === 'damage' ? ph.fired + ' missile' + (ph.fired === 1 ? '' : 's') + ' \u00b7 cranes ' + (ph.replay ? 'in ' + left2 : 'at midnight') : reb ? left2 + ' \u00b7 ' + Math.round(ph.rebuilt * 100) + '% rebuilt' : ph.total + ' missile' + (ph.total === 1 ? '' : 's') + ' today';
    chip.classList.toggle('rebuild', reb); chip.querySelector('b').textContent = L; chip.querySelector('span').textContent = tail;
  }
  // the replay controls on the map, one compact bar: Strike n of m + the last hit's damage tier, then Prev, Pause / Play, Next, speed, Fit, Follow (only after the viewer moved the camera), End. 44 px targets.
  var hudEl = null, hudHit = null;
  function hud(ph) {
    if (!stage) return;
    if (!hudEl) { hudEl = document.createElement('div'); hudEl.className = 'b-play'; hudEl.setAttribute('role', 'group'); hudEl.setAttribute('aria-label', 'Replay controls');
      hudEl.innerHTML = '<div class="b-pt"><div class="b-l1"><b data-p="beat"></b><span data-p="label"></span></div><button type="button" data-p="hit" class="b-hit" aria-live="polite" hidden></button></div><div class="b-pb">'
        + '<button type="button" data-p="prev" aria-label="Previous strike">Prev</button><button type="button" data-p="pause" aria-pressed="false">Pause</button><button type="button" data-p="skip">Next</button>'
        + '<button type="button" data-p="speed">1x</button><button type="button" data-p="fit" aria-label="Fit all: show the whole battlefield">Fit</button><button type="button" data-p="follow" aria-label="Follow the action again" hidden>Follow</button>'
        + '<button type="button" data-p="stop" aria-label="End the replay">End</button></div>';
      var A = function () { return api(); }, refresh = function () { var p = A() && A().phase ? A().phase() : null; if (p && p.replay) hud(p); };
      hudEl.querySelector('[data-p="pause"]').onclick = function () { if (A() && A().pause) { var on = A().pause(); this.setAttribute('aria-pressed', String(on)); this.textContent = on ? 'Play' : 'Pause'; } };
      hudEl.querySelector('[data-p="skip"]').onclick = function () { if (A() && A().skip) A().skip(); refresh(); };
      hudEl.querySelector('[data-p="prev"]').onclick = function () { if (A() && A().prev) A().prev(); refresh(); };
      hudEl.querySelector('[data-p="speed"]').onclick = function () { speed = BSPD.next(speed); BSPD.save(speed); if (A() && A().speed) A().speed(speed); refresh(); };
      hudEl.querySelector('[data-p="fit"]').onclick = function () { if (A() && A().fit) A().fit(); refresh(); };
      hudEl.querySelector('[data-p="follow"]').onclick = function () { if (A() && A().follow) A().follow(true); refresh(); };
      hudEl.querySelector('[data-p="stop"]').onclick = function () { stopPlay(); };
      hudEl.querySelector('[data-p="hit"]').onclick = function () { if (!hudHit) return; var s = nightShots(hudHit.night)[hudHit.ix]; if (!s) return; if (A() && A().pause) A().pause(true); refresh(); openHow(s); };
      stage.appendChild(hudEl); }
    var st = ph.stage, beat = st === 'beat' || st === 'pre' ? 'Strike ' + ph.beat + ' of ' + ph.beats : st === 'wide' ? 'All ' + ph.beats + ' strike' + (ph.beats === 1 ? '' : 's') + ' in' : st === 'rebuild' ? 'Rebuilding' : '';
    hudEl.querySelector('[data-p="beat"]').textContent = (ph.demo ? 'Demo \u00b7 ' : '') + beat; hudEl.querySelector('[data-p="label"]').textContent = ph.label || '';
    var ht = ph.hit ? ph.hit.shield ? ph.hit.d + ': shield held' + (ph.hit.pot ? ', ' + usd(ph.hit.pot) + ' stopped' : '') : (ph.hit.d.charAt(0) === '@' ? ph.hit.d : 'The raiders') + ' -' + usd(ph.hit.usd) + (ph.hit.fire ? ', on fire' : '') + ', ' + Math.round(ph.hit.to) + '% standing' : '';
    var hb = hudEl.querySelector('[data-p="hit"]'); hb.textContent = ht + (ht && !ph.demo ? ' \u00b7 math' : ''); hb.hidden = !ht; hudHit = ph.hit && !ph.demo ? { night: ph.night, ix: ph.hit.ix } : null;
    var pb = hudEl.querySelector('[data-p="pause"]'); pb.setAttribute('aria-pressed', String(!!ph.paused)); pb.textContent = ph.paused ? 'Play' : 'Pause';
    var sk = hudEl.querySelector('[data-p="skip"]'); sk.textContent = st === 'rebuild' ? 'Finish' : st === 'wide' ? 'Cranes' : 'Next';
    var sp = hudEl.querySelector('[data-p="speed"]'), cur = ph.speed || speed; sp.textContent = BSPD.label(cur); sp.setAttribute('aria-label', 'Speed ' + BSPD.label(cur) + '. Change speed: 0.5x, 1x or 2x.');
    var fo = hudEl.querySelector('[data-p="follow"]'); fo.hidden = ph.follow !== false;
  }
  function hudOff() { if (hudEl) { hudEl.remove(); hudEl = null; } }
  function show() {
    on = true; if (bar) bar.hidden = false; document.documentElement.classList.add('w-battle');
    if (api()) { api().layers(layers); api().view(true, data); }
    stats(); load(); mine(); chipTick(); clearInterval(chipT); chipT = setInterval(chipTick, 1000); clearInterval(pollT); pollT = setInterval(load, 600000);
    if (layers.replay) play(replayMode);
  }
  function hide() {
    on = false; stopPlay(); closeHow(); if (bar) bar.hidden = true; document.documentElement.classList.remove('w-battle'); if (api()) api().view(false); clearInterval(chipT); clearInterval(pollT); if (chip) { chip.remove(); chip = null; }
    try { var u = new URL(location.href); if (u.searchParams.has('layers') || u.searchParams.has('replay')) { u.searchParams.delete('layers'); u.searchParams.delete('replay'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) {}
  }
  window.CALDERA_BATTLE_UI = { show: show, hide: hide, play: function (mode) { if (mode === 'demo') play('demo'); else setLayer('replay', true); } };
  var demoBtn = q('[data-bdemo]'); if (demoBtn) demoBtn.addEventListener('click', function () { play('demo'); });
  function saveLayers() {
    try { localStorage.setItem(LKEY, JSON.stringify(layers)); } catch (e) {}
    try { var u = new URL(location.href), def = layers.damage && layers.attacks && layers.shields && !layers.replay; if (def) u.searchParams.delete('layers'); else u.searchParams.set('layers', LAYERS.filter(function (k) { return layers[k]; }).join(',') || 'none'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
  }
  function setLayer(k, v) {
    layers[k] = v; var b = q('[data-bl="' + k + '"]'); if (b) b.setAttribute('aria-pressed', String(v));
    if (k === 'replay') { if (v) play(); else stopPlay(); } else if (api()) api().layers(layers);
    saveLayers();
  }
  Array.prototype.slice.call(bar ? bar.querySelectorAll('[data-bl]') : []).forEach(function (b) {
    var k = b.getAttribute('data-bl'); b.setAttribute('aria-pressed', String(!!layers[k]));
    b.addEventListener('click', function () { setLayer(k, b.getAttribute('aria-pressed') !== 'true'); });
  });
  // ---------------------------------------------------------------- replay: the cinematic strike-by-strike replay (or the demo)
  var cap = q('[data-b="cap"]'), hudT = 0;
  function stopPlay() { if (playing) { clearTimeout(playing); playing = null; } clearInterval(hudT); hudT = 0; document.documentElement.classList.remove('w-replay'); document.documentElement.classList.remove('fb-hide'); if (api() && api().stop) api().stop(); hudOff(); if (cap) cap.textContent = ''; var b = q('[data-bl="replay"]'); if (b) b.setAttribute('aria-pressed', 'false'); var d = q('[data-bdemo]'); if (d) d.setAttribute('aria-pressed', 'false'); layers.replay = false; chipTick(); }
  function play(mode) {
    if (playing) { clearTimeout(playing); playing = null; } clearInterval(hudT); hudT = 0;
    closeHow();
    var n = on && api() && api().replay ? api().replay(mode, { speed: speed }) : 0;
    if (!n) { if (cap) cap.textContent = mode === 'demo' ? 'The demo needs two cities with repo towers on the map.' : 'No missiles today: nothing to replay. Try the demo replay.'; playing = setTimeout(stopPlay, 3500); return; }
    var ph = api().phase(), b = q('[data-bl="replay"]'); if (b) b.setAttribute('aria-pressed', String(mode !== 'demo')); var d = q('[data-bdemo]'); if (d) d.setAttribute('aria-pressed', String(mode === 'demo')); layers.replay = mode !== 'demo';
    if (cap) cap.textContent = (mode === 'demo' ? 'Demo: a sample battle between the biggest cities on the map, synthetic shots. ' : 'Replay: ') + ph.beats + ' strike' + (ph.beats === 1 ? '' : 's') + ', ' + n + ' missile' + (n === 1 ? '' : 's') + ', about ' + Math.round(ph.dur / 1000 / (ph.speed || 1)) + ' s at ' + BSPD.label(ph.speed || 1) + '. Scroll, pinch or drag to look around; Fit shows the whole map; tap the map for the next strike.';
    chipTick(); hud(ph); document.documentElement.classList.add('w-replay'); document.documentElement.classList.add('fb-hide');   // the feedback-hub widgets hide while the replay runs (html.fb-hide, any device)
    if (stage && window.innerWidth >= 700) { var r = stage.getBoundingClientRect(); if (r.top < 0 || r.bottom > window.innerHeight) { try { stage.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) {} } }
    hudT = setInterval(function () { try { var p2 = api() && api().phase ? api().phase() : null; if (!p2 || !p2.replay) { stopPlay(); return; } hud(p2); } catch (e) { stopPlay(); } }, 200);
    playing = setTimeout(stopPlay, 900000);   // a safety net: the poll above ends the replay when it ends, a paused one may wait
  }
  // ---------------------------------------------------------------- the member's panel
  var panel = q('[data-b="me"]');
  function mine() {
    return fetch('/v1/world/battle/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) { me = m && m.h ? m : null; render(); recap(); return me; }).catch(function () { render(); });
  }
  function render() {
    if (!panel) return;
    if (!me) { panel.innerHTML = '<p>Every city is in the battles. Each one fights on its own overnight with that day\'s real code; damage shows only on this map and always rebuilds itself. <a href="/signin?next=%2Fworld%3Fview%3Dbattle">Sign in</a> to see your city\'s arsenal and shield.</p>'; return; }
    if (!me.war) {
      panel.innerHTML = '<p><b>Your city has left the battles.</b> No shots in or out while it is out. Rejoin and it fights on its own overnight with that day\'s real code: no one has to do anything, damage is only on this map, and it always rebuilds itself.</p><button type="button" class="b-join">Rejoin the battles</button>' + reportHtml();
      panel.querySelector('.b-join').onclick = function () { act('/v1/world/battle/opt', { war: true }); };
      wireReport(); return;
    }
    var a = me.arsenal || { ammo: 0, usd: 0, c: 0, pr: 0, shots: 0, best: 'shell', ai: 1, n: {}, tech: 0, why: { base: 0, rel: 0, ci: 0 }, guide: 'Inertial', cep: 1, reach: 3, left: 0 };
    var parts = [a.c + ' commit' + (a.c === 1 ? '' : 's')]; if (a.pr) parts.push(a.pr + ' PR' + (a.pr === 1 ? '' : 's')); if (a.rel) parts.push(a.rel + ' release' + (a.rel === 1 ? '' : 's')); if (a.ci) parts.push(a.ci + ' green CI'); if (a.ai > 1) parts.push('x' + a.ai + ' AI'); if (a.streak > 1) parts.push('x' + a.streak + ' streak');
    var bw = wOf(a.best), why = a.why || {}, up = (a.tech || 0) >= 3 ? 'top size unlocked' : !why.rel ? 'ship a release for the next size' : !why.ci ? 'a green CI run today unlocks the next size' : 'a taller building unlocks the next size';
    var aims = (me.aims || []).map(function (h) { return '<li>' + esc(h) + ' <button type="button" class="b-unaim" data-h="' + esc(h) + '" aria-label="Stop aiming at ' + esc(h) + '">&times;</button></li>'; }).join('');
    var opts = (me.rivals || []).map(function (r) { return '<option value="' + esc(r.h) + '">' + esc(r.h) + ' (shield ' + Math.round(r.sh * 100) + '%' + (r.beg ? ', beginner' : '') + ')</option>'; }).join('');
    panel.innerHTML = '<div class="b-ars"><div><span>Today\'s budget so far</span><b>' + usd(a.usd || 0) + '</b><i>' + esc(parts.join(', ')) + '</i></div>'
      + '<div><span>Missiles</span><b>' + a.shots + ' missile' + (a.shots === 1 ? '' : 's') + '</b><span class="b-szs">' + sizeChips(a.n, a.tech || 0) + '</span></div>'
      + '<div><span>Biggest size</span><b>' + esc(bw ? bw.size + ', ' + bw.name.toLowerCase() : 'S') + '</b><i>' + esc(up) + '</i></div>'
      + '<div><span>Guidance</span><b>' + esc(a.guide || 'Inertial') + '</b><i>misses x ' + (a.cep == null ? 1 : a.cep) + ', ' + (a.reach || 3) + ' rivals in reach</i></div>'
      + '<div><span>Shield</span><b>' + Math.round((me.shield || 0) * 100) + '%</b><i>' + (me.beginner ? 'beginner shield' : 'from your daily streak') + '</i></div></div>'
      + '<details class="b-fire"><summary>Fire at a rival (optional, up to ' + me.aimCap + ' shots tonight)</summary>'
      + (opts ? '<div class="b-aim"><select aria-label="Rival to aim at">' + opts + '</select><button type="button" class="b-doaim"' + ((me.aims || []).length >= me.aimCap ? ' disabled' : '') + '>Aim a shot</button></div>' : '<p>No rivals in range yet. Auto-fire finds a fair match, or raiders from the sea.</p>')
      + (aims ? '<ul class="b-aims">' + aims + '</ul>' : '') + '</details>'
      + reportHtml()
      + '<p class="b-small">' + (me.beginner || me.waive ? '<button type="button" class="b-link b-waive">' + (me.waive ? 'Turn my beginner shield back on' : 'Drop my beginner shield') + '</button> &middot; ' : '') + '<button type="button" class="b-link b-leave">Leave the battles</button> (your city rebuilds instantly)</p>';
    panel.querySelector('.b-leave').onclick = function () { act('/v1/world/battle/opt', { war: false }); };
    var wv = panel.querySelector('.b-waive'); if (wv) wv.onclick = function () { act('/v1/world/battle/opt', { waive: !me.waive }); };
    var da = panel.querySelector('.b-doaim'); if (da) da.onclick = function () { act('/v1/world/battle/aim', { target: panel.querySelector('.b-aim select').value }); };
    Array.prototype.slice.call(panel.querySelectorAll('.b-unaim')).forEach(function (b) { b.onclick = function () { act('/v1/world/battle/aim', { target: b.getAttribute('data-h'), off: true }); }; });
    wireReport();
  }
  function reportHtml() {
    var f = me.report || 'off';
    return '<div class="b-rep" id="reports" role="group" aria-label="Battle report email"><span>Battle report email</span>' + ['daily', 'weekly', 'off'].map(function (k) { return '<button type="button" data-rep="' + k + '" aria-pressed="' + (f === k) + '">' + k.charAt(0).toUpperCase() + k.slice(1) + '</button>'; }).join('')
      + (!me.email ? '<i>Confirm an email in <a href="/settings">Settings</a> first.</i>' : !me.emailLive && f !== 'off' ? '<i>Saved. Reports start soon.</i>' : '') + '</div>';
  }
  function wireReport() { Array.prototype.slice.call(panel.querySelectorAll('[data-rep]')).forEach(function (b) { b.onclick = function () { act('/v1/world/battle/report', { freq: b.getAttribute('data-rep') }); }; }); }
  function act(path, body) {
    var msg = q('[data-b="msg"]'); if (msg) msg.textContent = '';
    post(path, body).then(function (m) { me = m && m.h ? m : me; render(); load(); }).catch(function (e) { if (msg) msg.textContent = String(e.message || e); });
  }
  // ---------------------------------------------------------------- "What your city did last night": the morning card, once per night
  function recap() {
    if (!me || !me.war || !me.last || !stage) return;
    var L = me.last, seen = null; try { seen = localStorage.getItem('caldera.world.recap'); } catch (e) {}
    if (seen === L.night && !replayNight) return;
    var old = document.querySelector('.b-recap'); if (old) old.remove();
    var t = document.querySelector('.g-today'); if (t) t.remove();
    var raids = L.raids.length ? L.raids.map(function (r) { return esc(r.from) + ', ' + hhmm(r.t); }).join('; ') : 'none';
    var rows = [['Raids on you', L.raids.length ? L.raids.length + ' (' + raids + ')' : 'none'], ['Damage taken', L.taken > 0 ? usd(L.takenUsd) + (L.tiers ? ', ' + L.tiers + ' tower' + (L.tiers === 1 ? '' : 's') + ' hit' : '') + (L.fires ? ', ' + L.fires + ' caught fire' : '') : (L.raids.length ? 'none: your shield held' : 'none')]];
    if (L.taken > 0) rows.push(['Rebuilt so far', L.rebuilt + '%']);
    rows.push(['Your towers fired', L.fired + ' shot' + (L.fired === 1 ? '' : 's') + ', ' + L.landed + ' hit' + (L.landed === 1 ? '' : 's') + (L.on.length ? ' on ' + L.on.slice(0, 2).join(', ') : '') + (L.dealtUsd ? ', ' + usd(L.dealtUsd) + ' of damage' : '')]);
    if (L.mvp) rows.push(['MVP', L.mvp.repo + ', ' + L.mvp.bricks + ' brick' + (L.mvp.bricks === 1 ? '' : 's') + ' laid']);
    rows.push(['Shield now', Math.round(L.shield * 100) + '%' + (L.streak ? ' (' + L.streak + '-day streak)' : '')]);
    var card = document.createElement('div'); card.className = 'b-recap'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'What your city did last night');
    card.innerHTML = '<button type="button" class="g-x" aria-label="Dismiss">&times;</button><b>What your city did last night</b><dl>' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>'
      + '<div class="b-rbtn"><button type="button" class="g-go">&#9654; Watch the replay</button><button type="button" class="b-share">Copy link</button></div>';
    stage.appendChild(card);
    var done = function () { card.remove(); try { localStorage.setItem('caldera.world.recap', L.night); } catch (e) {} };
    card.querySelector('.g-x').onclick = done;
    card.querySelector('.g-go').onclick = function () { done(); var b = document.querySelector('[data-gview="battle"]'); if (!on && b) b.click(); setLayer('replay', true); };
    card.querySelector('.b-share').onclick = function () { var u = location.origin + '/world?view=battle&replay=1'; try { navigator.clipboard.writeText(u); card.querySelector('.b-share').textContent = 'Copied'; } catch (e) { prompt('Link to last night', u); } };
  }
  mine();
  if (bar) { var hash = location.hash; if (hash === '#season') { var d = bar.querySelector('.b-board'); if (d) d.open = true; } }
}
export const BATTLE_CLIENT_JS = "(function(BSPD){return (" + battleClient.toString() + ")();})((" + battleSpeedLib.toString() + ")());";

export const BATTLE_CSS = `
.b-bar{display:grid;gap:8px;margin-top:8px;padding:8px 12px 10px;border-radius:var(--radius-md,10px);border:1px solid rgba(61,242,255,.28);background:#0F1016;color:#E8EEF8;min-width:0}
.b-bar[hidden]{display:none}
.b-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;min-width:0}
.b-date{font:600 14px/1.3 var(--font-sans,'IBM Plex Sans',sans-serif);color:#fff}
.b-stats{display:flex;flex-wrap:wrap;gap:2px 14px;font:500 12px/1.4 var(--font-mono,'IBM Plex Mono',monospace);color:#9A9AA5;min-width:0}.b-stats b{color:#F2F2F5;font-weight:600}
.b-row button,.b-rep button{font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(10,14,26,.72);border:1px solid rgba(61,242,255,.4);border-radius:999px;padding:0 11px;min-height:32px;cursor:pointer}
.b-row button[aria-pressed="true"],.b-rep button[aria-pressed="true"]{background:rgba(61,242,255,.18);border-color:#3DF2FF}
.b-bar button:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.b-cap{font:12px/1.4 var(--font-sans,'IBM Plex Sans',sans-serif);color:#C9D2E6;min-width:0}
.b-me{font:13px/1.5 var(--font-sans,'IBM Plex Sans',sans-serif);color:#C9D2E6;min-width:0}.b-me p{margin:0 0 6px}.b-me a{color:#B9A6FF}
.b-join,.b-doaim{font:600 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif)!important;background:#8B6CF6!important;color:#fff!important;border:0!important;border-radius:999px;padding:0 14px!important;min-height:36px;cursor:pointer}
.b-doaim[disabled]{opacity:.45;cursor:default}
.b-ars{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;margin:0 0 8px}.b-ars div{display:grid;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);min-width:0}
.b-ars span{font-size:11.5px;color:#9A9AA5}.b-ars b{color:#fff;font-size:15px}.b-ars i{font-style:normal;font-size:11.5px;color:#9A9AA5;overflow-wrap:anywhere}
.b-fire{margin:0 0 8px}.b-fire summary{cursor:pointer;color:#E8EEF8;min-height:32px;display:flex;align-items:center}.b-aim{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.b-aim select{font:13px var(--font-sans,'IBM Plex Sans',sans-serif);background:#161822;color:#E8EEF8;border:1px solid rgba(255,255,255,.18);border-radius:8px;min-height:36px;padding:0 8px;max-width:100%}
.b-aims{margin:4px 0;padding-left:18px}.b-aims button{background:transparent;border:0;color:#9A9AA5;font-size:16px;min-width:32px;min-height:32px;cursor:pointer}
.b-rep{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 6px}.b-rep span{font-size:12.5px;color:#C9D2E6;margin-right:4px}.b-rep i{font-style:normal;font-size:12px;color:#9A9AA5}
.b-small{font-size:12px;color:#9A9AA5}.b-link{background:none;border:0;padding:0;color:#B9A6FF;font:inherit;cursor:pointer;text-decoration:underline;min-height:32px}
.b-msg{color:#FF9A9A;font-size:12.5px}.b-msg:empty{display:none}
.b-board summary{cursor:pointer;font:500 12.5px/1 var(--font-sans,'IBM Plex Sans',sans-serif);color:#E8EEF8;min-height:32px;display:flex;align-items:center}.b-board ol{margin:4px 0 0;padding-left:22px;columns:2 180px;font-size:12.5px;color:#C9D2E6}.b-board li button{background:none;border:0;color:#B9A6FF;font:inherit;cursor:pointer;padding:0;min-height:28px}.b-board p{margin:4px 0;font-size:12.5px;color:#9A9AA5}
.b-recap{position:absolute;right:10px;top:52px;z-index:7;width:min(320px,calc(100% - 20px));background:rgba(17,20,32,.96);color:#F2F2F5;border:1px solid rgba(61,242,255,.45);border-radius:12px;padding:10px 12px;font:13px/1.45 var(--font-sans,'IBM Plex Sans',sans-serif);box-shadow:0 18px 40px -16px rgba(0,0,0,.8)}
.b-recap b{display:block;font-size:14px;margin-right:30px}.b-recap dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:6px 0 10px}.b-recap dt{color:#9A9AA5}.b-recap dd{margin:0;color:#F2F2F5;overflow-wrap:anywhere}
.b-rbtn{display:flex;flex-wrap:wrap;gap:6px}.b-recap .g-go{font:600 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif);background:#8B6CF6;color:#fff;border:0;border-radius:999px;padding:0 14px;min-height:36px;cursor:pointer}
.b-share{font:500 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif);background:transparent;color:#E8EEF8;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:0 12px;min-height:36px;cursor:pointer}
.b-recap .g-x{position:absolute;right:4px;top:4px;width:36px;height:36px;border:0;background:transparent;color:#C9D2E6;font-size:20px;cursor:pointer;border-radius:50%}
.b-chip{position:absolute;left:10px;top:10px;z-index:6;display:inline-flex;align-items:center;gap:7px;font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(15,16,22,.92);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 11px 6px 9px;font-variant-numeric:tabular-nums;pointer-events:none;max-width:calc(100% - 20px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b-play{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:7;display:grid;gap:4px;width:min(470px,calc(100% - 20px));padding:6px 6px 6px;border-radius:14px;background:rgba(15,16,22,.94);border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 30px -12px rgba(0,0,0,.8);font:500 12px/1.2 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;font-variant-numeric:tabular-nums;box-sizing:border-box}
.b-play .b-pt{display:grid;gap:1px;min-width:0;padding:0 4px}.b-play .b-l1{display:flex;gap:7px;min-width:0;align-items:baseline}.b-play .b-pt b{color:#fff;font-weight:600;white-space:nowrap;flex:none}.b-play .b-pt span{color:#C9D2E6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.b-play .b-pt span:empty{display:none}.b-play .b-pt span[data-p="hit"]{color:#FFB347}
.b-play .b-pb{display:flex;flex-wrap:wrap;gap:4px;justify-content:space-between}
.b-play button{font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.22);border-radius:9px;padding:0 6px;min-height:44px;min-width:44px;cursor:pointer;flex:1 1 44px;white-space:nowrap;touch-action:manipulation}
.b-play button[hidden]{display:none}.b-play button[data-p="follow"]{background:#8B6CF6;border-color:#8B6CF6;color:#fff;font-weight:600}
.b-play button[aria-pressed="true"]{background:rgba(61,242,255,.18);border-color:#3DF2FF}.b-play button:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.b-chip i{width:7px;height:7px;border-radius:50%;background:#FFB347;box-shadow:0 0 8px #FFB347;flex:none}.b-chip.rebuild i{background:#4FD1C5;box-shadow:0 0 8px #4FD1C5}.b-chip b{font-weight:600;color:#fff}.b-chip span{color:#C9D2E6}
@media (prefers-reduced-motion: reduce){.b-chip i{box-shadow:none}}
.b-howb{border-color:rgba(255,179,71,.6)!important;color:#FFD9A0!important}.b-howb[aria-expanded="true"]{background:rgba(255,179,71,.16)!important;border-color:#FFB347!important}
.b-szs{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}.b-sz{display:inline-flex;align-items:center;gap:4px;font:600 11.5px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#9A9AA5;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:3px 6px 3px 3px;font-variant-numeric:tabular-nums}
.b-sz i{font-style:normal;font-size:10px;min-width:18px;text-align:center;padding:2px 3px;border-radius:4px;background:rgba(255,255,255,.08);color:#C9D2E6}.b-sz.has{color:#fff;border-color:rgba(255,179,71,.55)}.b-sz.has i{background:#FFB347;color:#1A1206}.b-sz.lock{opacity:.45;border-style:dashed}
.b-list ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:2px;max-height:260px;overflow:auto}
.b-al li{display:grid;grid-template-columns:minmax(0,1.2fr) 64px minmax(0,1.6fr) minmax(0,1.4fr);align-items:center;gap:8px;padding:3px 0;font:12.5px/1.3 var(--font-sans,'IBM Plex Sans',sans-serif);color:#C9D2E6;border-bottom:1px solid rgba(255,255,255,.06)}
.b-al li>b{color:#fff;font:600 12.5px/1 var(--font-mono,'IBM Plex Mono',monospace);text-align:right}.b-al li>i{font-style:normal;font-size:11.5px;color:#9A9AA5}.b-al .b-szs{margin:0}
.b-al button,.b-sl button{background:none;border:0;color:#B9A6FF;font:inherit;cursor:pointer;text-align:left;min-height:32px;padding:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b-sl button{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) auto;gap:8px;align-items:center;width:100%;color:#E8EEF8;font:12.5px/1.3 var(--font-sans,'IBM Plex Sans',sans-serif);border-bottom:1px solid rgba(255,255,255,.06);border-radius:0}
.b-sl button:hover{background:rgba(255,255,255,.05)}.b-sl span,.b-sl i{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.b-sl i{font-style:normal;color:#9A9AA5;font-size:11.5px}.b-sl b{font:600 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#FFB347;white-space:nowrap}
.b-play .b-hit{background:none!important;border:0!important;color:#FFD9A0!important;text-align:left;padding:0!important;min-height:0!important;font:inherit!important;cursor:pointer;text-decoration:underline;text-decoration-color:rgba(255,217,160,.45);text-underline-offset:2px}
.b-how{position:fixed;z-index:80;right:12px;top:12px;bottom:12px;width:min(520px,calc(100% - 24px));background:#0F1016;color:#D7DDEA;border:1px solid rgba(255,179,71,.45);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;font:13.5px/1.55 var(--font-sans,'IBM Plex Sans',sans-serif)}
.b-how[hidden]{display:none}.b-how:focus{outline:none}.b-hb{overflow:auto;padding:16px 18px 20px;overscroll-behavior:contain}
.b-hx{position:absolute;right:6px;top:6px;width:44px;height:44px;border:0;background:transparent;color:#C9D2E6;font-size:22px;cursor:pointer;border-radius:50%}.b-hx:focus-visible,.b-how a:focus-visible{outline:2px solid #FFB347;outline-offset:2px}
.b-how h2{font:600 19px/1.2 var(--font-display,var(--font-sans,'IBM Plex Sans',sans-serif));color:#fff;margin:0 44px 4px 0}.b-how h3{font:600 13.5px/1.3 var(--font-sans,'IBM Plex Sans',sans-serif);color:#FFD9A0;margin:0 0 6px}
.b-how section{padding:12px 0 2px;border-top:1px solid rgba(255,255,255,.09);margin-top:10px}.b-how p{margin:0 0 8px}.b-how ul{margin:0 0 8px;padding-left:18px}.b-how li{margin:0 0 4px}.b-how b{color:#fff;font-weight:600}.b-lede{color:#9A9AA5}
#b-how-shot{border:1px solid rgba(255,179,71,.35);border-radius:10px;padding:10px 12px 4px;background:rgba(255,179,71,.06)}
.b-tw{overflow-x:auto;margin:0 0 8px}.b-how table{border-collapse:collapse;width:100%;font:12px/1.35 var(--font-mono,'IBM Plex Mono',monospace);font-variant-numeric:tabular-nums}
.b-how th,.b-how td{text-align:left;padding:5px 8px 5px 0;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top;white-space:nowrap}.b-how th{color:#9A9AA5;font-weight:500}.b-how tr>th[scope=row]{color:#E8EEF8;white-space:normal}.b-how td{color:#E8EEF8}.b-how small{color:#9A9AA5;font-size:11px}
.b-szl{display:inline-block;min-width:24px;text-align:center;padding:2px 4px;border-radius:4px;background:#FFB347;color:#1A1206!important;font-size:11px}
.b-math{display:grid;grid-template-columns:minmax(92px,auto) 1fr;gap:3px 12px;margin:0 0 8px;font-size:12.5px}.b-math dt{color:#9A9AA5}.b-math dd{margin:0;color:#E8EEF8;overflow-wrap:anywhere}.b-math dt:last-of-type,.b-math dd:last-of-type{color:#FFB347;font-weight:600;padding-top:3px;border-top:1px solid rgba(255,255,255,.12)}
.b-curve{display:block;width:100%;max-width:300px;height:auto;color:#C9D2E6;margin:2px 0 8px}
.b-ad{margin:14px 0 0!important;padding:10px 12px;border-radius:10px;background:rgba(139,108,246,.1);border:1px solid rgba(139,108,246,.35);font-size:12.5px;color:#C9D2E6}.b-ad a{color:#B9A6FF;font-weight:600;white-space:nowrap}
html.w-replay .b-how{top:auto;height:min(46vh,420px)}
@media (max-width:700px){.b-how{left:0;right:0;top:auto;bottom:0;width:auto;max-height:72vh;border-radius:16px 16px 0 0;border-width:1px 0 0;padding-bottom:env(safe-area-inset-bottom,0px)}.b-al li{grid-template-columns:minmax(0,1fr) 58px;gap:2px 8px}.b-al .b-szs{grid-column:1}.b-al li>i{grid-column:2;grid-row:2;text-align:right}.b-sl button{grid-template-columns:minmax(0,1fr) auto}.b-sl i{display:none}}
html.w-replay #drRail,html.w-replay .cal-nb{display:none!important}
html.w-replay .b-chip{display:none}   /* the replay bar says the same (strike, cities, last hit) and the chip would sit on the Labels chip at the top left */
.w-main .c-stage.c-full{height:100%;min-height:0}
.w-battle-only{display:none}html.w-battle .w-battle-only{display:revert}html.w-battle .w-now-only,html.w-battle .w-grow-only{display:none}
@media (max-width:600px){.b-bar{padding:8px 10px}.b-stats{gap:2px 10px;font-size:11.5px}.b-recap{top:auto;bottom:50px;right:10px}.b-chip{top:auto;bottom:10px}.b-play{bottom:10px;left:10px;right:10px;transform:none;width:auto;padding:5px 5px 5px}.b-play .b-pb{gap:3px}.b-play button{font-size:11px;padding:0 2px}.c-stage.c-full .b-play{bottom:calc(10px + env(safe-area-inset-bottom,0px))}.c-stage.c-full .b-chip{bottom:calc(10px + env(safe-area-inset-bottom,0px))}}
`;

export function battleMarkup(): string {
  return `<div class="b-bar" id="b-bar" hidden aria-label="Battles">
<div class="b-row"><b class="b-date" data-b="date"></b><span class="b-stats"><span><b data-b="cities">0</b> <span data-b="cl">cities in the battles</span></span><span><b data-b="shots">0</b> shots</span><span><b data-b="landed">0</b> landed</span><span><b data-b="dmg">$0</b> damage</span><span><b data-b="fires">0</b> fires spread</span><span data-b="season"></span><span data-b="next"></span></span></div>
<div class="b-row" role="group" aria-label="Layers"><button type="button" data-bl="damage" aria-pressed="true" title="Hits on the repo towers: lost floors, scorch, rubble, smoke; the cranes that rebuild them">Damage</button><button type="button" data-bl="attacks" aria-pressed="true" title="Ammo pads, stacks, launch centers and missiles in flight">Attacks</button><button type="button" data-bl="shields" aria-pressed="true" title="Each city's shield (white: beginner shield)">Shields</button><button type="button" data-bl="replay" aria-pressed="false" title="Last night strike by strike: the camera zooms to each city, follows its missiles into the hit, then the cranes">&#9654; Replay</button><button type="button" data-bdemo aria-pressed="false" title="A sample battle between the biggest cities on the map (synthetic shots), to see the full choreography">Demo replay</button><button type="button" class="b-howb" data-bhow aria-expanded="false" title="The budget, the missiles, blast, shields and fire, with the real numbers">How damage works</button><span class="b-cap" data-b="cap" aria-live="polite"></span></div>
<div class="b-me" data-b="me"></div><div class="b-msg" data-b="msg" role="alert"></div>
<details class="b-board b-list" id="arsenals"><summary data-b="arsum">Arsenals building today</summary><div data-b="arsenals"></div></details>
<details class="b-board b-list" id="shots"><summary data-b="shotsum">Last night, shot by shot</summary><div data-b="shotlist"></div></details>
<details class="b-board" id="season"><summary>Season leaderboard (per head: dollars of damage dealt, plus half of what your shield held off)</summary><div data-b="board"></div></details>
</div>`;
}
