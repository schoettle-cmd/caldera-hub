// @ts-nocheck
/**
 * The World page's Battle view in the browser (Mike 2026-11-07): the Battle button in the Now | Day | Week | Month switcher,
 * the status chip on the map ("Battle starts in 12h 36m", the one clock: the Armory lock time), and the deck under the map
 * (map-audit PAGE.md, Mike 11-20 "yes do all"): a "Tonight" card (countdown, credits, firepower tiles, targets, the Armory,
 * the Battle settings popover behind the gear), a "Last night" card (three numbers, your city's rows, Replay, Copy link,
 * All shots; "Watch a demo battle" when there was no battle), and one tab panel: Shot by shot, Season ranking, Arming today
 * (#shots, #season, #arsenals open their tab; the choice is kept per viewer in localStorage). The map is drawn by the city
 * renderer (citybattle.ts), driven through window.CALDERA_BATTLE_API: supply drop at noon local, the battle at 20:00, cranes
 * rebuild from midnight to noon (Mike 11-07).
 * Replay (Mike 11-08) is cinematic: one strike beat per city, the camera zooms to the pad, follows the missiles into the hit and
 * resets to the next city, then the wide shot, the cranes, home. It runs 2.5x slower than the first cut (Mike 11-08: "moves too fast on
 * battle and user needs to be able to zoom out and control camera"): about 60 s for the demo at 1x, 35 to 100 s in all. One compact control bar on the map: Strike n
 * of m with the damage tier of the last hit, Prev, Pause / Play, Next, speed (0.5x / 1x / 2x, remembered per viewer in localStorage),
 * Fit (the whole battlefield), Follow (shown once the viewer has panned or zoomed: gives the camera back to the auto camera), End.
 * The viewer's camera: wheel, trackpad pinch (ctrl+wheel) or pinch to zoom, drag to pan (citybattle.ts and city.ts clamp both); a tap on
 * the map still skips to the next strike. "Watch a demo battle" plays a sample battle between the biggest cities (synthetic shots, labelled demo).
 * Shareable: /world?view=battle, &layers=damage,attacks,shields,replay, &replay=1 or &replay=demo.
 * Shipped as the source of battleClient() (self-contained).
 */
/** The replay speed: 0.5x, 1x or 2x, remembered per viewer. Self-contained (shipped inside the page script ahead of battleClient) and
 *  safe where storage is blocked or throws (private windows, cleared site data): every read and write is in try/catch. */
export function battleSpeedLib() {
  var SPEEDS = [0.5, 1, 2], KEY = 'caldera.world.battleSpeed2';   // 11-20: a new key, so a saved 2x from the old fast replay resets to 1x once
  function ok(v) { v = +v; return SPEEDS.indexOf(v) >= 0 ? v : 1; }
  function next(v) { return SPEEDS[(SPEEDS.indexOf(ok(v)) + 1) % SPEEDS.length]; }
  function label(v) { return ok(v) + 'x'; }
  function load(store) { try { var raw = (store || localStorage).getItem(KEY); return raw == null ? 1 : ok(raw); } catch (e) { return 1; } }
  function save(v, store) { try { (store || localStorage).setItem(KEY, String(ok(v))); return true; } catch (e) { return false; } }
  return { SPEEDS: SPEEDS, KEY: KEY, ok: ok, next: next, label: label, load: load, save: save };
}

/** Viewer power-ups v1 (map-audit DESIGN.md item 10, mockup 05; Mike D1 11-20): the tray's charges and limits, pure. Three slots
 *  (repair crate, fireworks, cheer; keys 1 2 3), 3 charges each, 1 back every 8 s; at most 1 drop every 1.5 s and 20 per replay
 *  ("More next replay"). Cosmetic, free, local to this viewer: no network call, no storage (a fresh state per replay). */
export function powerupLib() {
  var KINDS = [
    { k: 'heal', key: '1', name: 'Repair crate', col: '#4BE38A', act: 'drop a repair crate', sent: 'a repair crate' },
    { k: 'fw', key: '2', name: 'Fireworks', col: '#FFC83D', act: 'set off fireworks', sent: 'fireworks' },
    { k: 'cheer', key: '3', name: 'Cheer', col: '#FF7BD0', act: 'send a cheer', sent: 'a cheer' }];
  var MAX = 3, EVERY = 8000, GAP = 1500, CAP = 20;
  function kind(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].k === k || KINDS[i].key === String(k)) return KINDS[i]; return null; }
  function fresh() { var s = { c: {}, t: {}, last: -Infinity, used: 0 }; KINDS.forEach(function (o) { s.c[o.k] = MAX; s.t[o.k] = null; }); return s; }
  /** charges now: one comes back every 8 s while a slot is below 3 */
  function left(s, k, now) { if (!(k in s.c)) return 0; while (s.c[k] < MAX && s.t[k] != null && now - s.t[k] >= EVERY) { s.c[k]++; s.t[k] += EVERY; } if (s.c[k] >= MAX) s.t[k] = null; return s.c[k]; }
  /** 'ok', or why not: 'kind', 'cap' (20 this replay), 'empty' (no charge), 'wait' (1.5 s since the last drop) */
  function why(s, k, now) { if (!(k in s.c)) return 'kind'; if (s.used >= CAP) return 'cap'; if (left(s, k, now) <= 0) return 'empty'; if (now - s.last < GAP) return 'wait'; return 'ok'; }
  function canArm(s, k, now) { var w = why(s, k, now); return w === 'ok' || w === 'wait'; }
  function use(s, k, now) { if (why(s, k, now) !== 'ok') return false; if (s.c[k] >= MAX) s.t[k] = now; s.c[k]--; s.last = now; s.used++; return true; }
  /** one slot's look: Ready (3), Armed, Recharging (1 or 2: sweep p 0..1 and seconds to the next charge), Empty (0, or 20 used) */
  function view(s, k, now, armed) { var n = left(s, k, now), cap = s.used >= CAP, w = s.t[k] == null ? 0 : Math.max(0, EVERY - (now - s.t[k]));
    return { n: cap ? 0 : n, state: cap ? 'empty' : armed === k && n > 0 ? 'armed' : n <= 0 ? 'empty' : n < MAX ? 'cool' : 'ready', sec: cap || n >= MAX ? 0 : Math.ceil(w / 1000), p: cap || n >= MAX ? 1 : 1 - w / EVERY }; }
  function hint(s, k, now) { if (s.used >= CAP) return 'More next replay'; var o = kind(k); if (!o) return ''; return 'Tap the map to ' + o.act + ' · ' + left(s, o.k, now) + ' left'; }
  function toast(k, handle) { var o = kind(k); if (!o) return ''; var h = handle ? String(handle) : ''; if (h && h.charAt(0) !== '@') h = '@' + h; return 'You sent ' + o.sent + (h ? ' to ' + h : ''); }
  return { KINDS: KINDS, MAX: MAX, EVERY: EVERY, GAP: GAP, CAP: CAP, kind: kind, fresh: fresh, left: left, why: why, canArm: canArm, use: use, view: view, hint: hint, toast: toast };
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
  // Mike 11-21 (Fable design, reports/2026-11-21-replay-bar): a compact icon bar; Speed, Fit, Sound and Full screen sit in one menu
  var BI = { prev: ['24', 'M19 19 9 12l10-7v14ZM5 5v14', 'f'], pause: ['24', 'M7.5 5.5h2v13h-2zM14.5 5.5h2v13h-2z', 'f'], play: ['24', 'M7 5l12 7-12 7V5Z', 'f'], next: ['24', 'M5 5l10 7-10 7V5ZM19 5v14', 'f'],
    follow: ['24', 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'], more: ['24', 'M5 12h.01M12 12h.01M19 12h.01', 'dots'], stop: ['24', 'M6 6l12 12M18 6 6 18'],
    speed: ['24', 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0'], fit: ['24', 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.05-4.05M8 11h6'], snd: ['24', 'M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9.5 9.5 0 0 1 0 13'],
    muted: ['24', 'M11 5 6 9H3v6h3l5 4V5ZM16 9.5l5 5M21 9.5l-5 5'], full: ['16', 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'], unfull: ['16', 'M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4'] };
  function bIco(n) { var i = BI[n]; return '<svg' + (i[2] ? ' class="' + i[2] + '"' : '') + ' viewBox="0 0 ' + i[0] + ' ' + i[0] + '" aria-hidden="true"><path d="' + i[1] + '"/></svg>'; }
  function fsSync() { var b = hudEl && hudEl.querySelector('[data-p="full"]'); if (!b) return; var on = !!(api() && api().full && api().full()), u = hudEl.querySelector('[data-p="unfull"]'); if (u) u.hidden = !on;
    if (b.getAttribute('data-on') === String(on)) return; b.setAttribute('data-on', String(on));
    b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); b.title = (on ? 'Exit full screen' : 'Full screen') + ' (F)'; b.innerHTML = bIco(on ? 'unfull' : 'full') + '<span>' + (on ? 'Exit full screen' : 'Full screen') + '</span><kbd>F</kbd>'; }
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
  window.CALDERA_PEOPLE = data && data.people || null;   // the strike card's top attackers link and show avatars from it (plugin citycard.ts bcLink)
  function nameOf(h) { return h.charAt(0) === '@' ? h : 'the raiders'; }
  // people in the deck (Mike 11-20): avatar + name, one link to the member's Caldera profile. data.people (battlehub peopleOf) holds
  // every listed member's avatar path ('' for none: an initial); raiders and unclaimed lands are not in it and stay plain text
  function pOf(h) { var P = data && data.people; return P && typeof h === 'string' && Object.prototype.hasOwnProperty.call(P, h) ? String(P[h] || '') : null; }
  function avHtml(h) {
    var a = pOf(h); if (a == null) return ''; var ini = esc((String(h).replace(/^@/, '').charAt(0) || '?').toUpperCase());
    return a ? '<img class="b-av" src="' + esc(a) + '" width="20" height="20" loading="lazy" decoding="async" alt="" data-i="' + ini + '">' : '<i class="b-av b-avi" aria-hidden="true">' + ini + '</i>';
  }
  function who(h, cls, label) {
    var t = esc(label != null ? label : h), sp = cls ? '<span class="' + cls + '">' + t + '</span>' : '<span>' + t + '</span>';
    if (pOf(h) == null) return cls ? sp : t;
    return '<a class="b-who" href="/@' + encodeURIComponent(String(h).slice(1)) + '/">' + avHtml(h) + sp + '</a>';
  }
  // an avatar that fails to load turns into the initial circle
  document.addEventListener('error', function (e) { var im = e.target; if (!im || im.tagName !== 'IMG' || !im.classList || !im.classList.contains('b-av')) return; var i = document.createElement('i'); i.className = 'b-av b-avi'; i.setAttribute('aria-hidden', 'true'); i.textContent = im.getAttribute('data-i') || '?'; if (im.parentNode) im.parentNode.replaceChild(i, im); }, true);
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
    if (x.pc < 1) rows.push(['Team size', 'x ' + x.pc + ' (a team hits per person)']);
    var pre = x.raw * x.st * x.cd * x.pc;
    if (r.floor && pre < r.floor && !s[6]) rows.push(['Least a hit does', pct(r.floor) + ' of the building (no missile does nothing)']);
    if (s[6]) { if (x.sh > 0) rows.push(['Shield', 'stopped ' + Math.round(x.sh * 100) + '%']); rows.push(['Result', 'Shield held (the rules before Nov 15). Without it: ' + usd(x.pot) + ' of damage']); }
    else {
      if (x.sh > 0 && x.pot != null) { rows.push(['Without a shield', pct(Math.max(r.floor || 0, pre)) + ' of ' + usd(x.v) + ' = ' + usd(x.pot)]); rows.push(['Shield', 'took ' + Math.round(x.sh * 100) + '% off: ' + usd(x.held != null ? x.held : x.pot - x.u) + ' held']); }
      else if (x.sh > 0) rows.push(['Shield', 'stopped ' + Math.round(x.sh * 100) + '%']);
      rows.push(['Blast damage', pct(s[3]) + ' of ' + usd(x.v) + ' = ' + usd(x.u) + (x.sh > 0 && x.pot != null ? ' (the ' + pct(1 - x.sh) + ' that got through)' : '')]);
      rows.push(['Fire', (x.sp ? 'spread through the floors' : 'contained') + ': ' + pct(x.fi) + ' more over about 4 hours = ' + usd(x.fu)]); rows.push(['Total', usd(x.u + x.fu)]); }
    return '<p><b>' + esc(who) + '</b></p>' + dl(rows);
  }
  /** no shot under the new rules yet: the same math on a made-up hit, marked as an example */
  function sampleHtml() {
    var r = rules(), w = wOf('rocket'); if (!r || !w) return ''; var c = r.classes[1], fl = 12, rad = c.z * Math.pow(w.tnt, 1 / 3), vol = r.footprint * fl * r.floorM, share = Math.min(1, 2 / 3 * Math.PI * rad * rad * rad / vol), v = fl * r.footprint * c.sqm, fi = share * c.load * r.fire.spread;
    return '<p><b>Example (not a real shot)</b></p>' + dl([['Weapon', w.name + ' (' + w.size + '): ' + w.tnt + ' kg of TNT, ' + usd(w.cost)], ['Building', c.name + ', ' + fl + ' floors, worth ' + usd(v) + '; it fails at ' + c.kpa + ' kPa'], ['Blast', 'a direct hit wrecks everything within ' + r1(rad) + ' m'], ['Blast damage', pct(share) + ' of ' + usd(v) + ' = ' + usd(share * v)], ['Fire', 'if it spreads: ' + pct(fi) + ' more over about 4 hours = ' + usd(fi * v)], ['Total', usd((share + fi) * v)]]);
  }
  /** the replay bar's words for the last hit (11-15: a shield cuts a hit, it never cancels it) */
  function hitLine(h) {
    var who = h.d.charAt(0) === '@' ? h.d : 'The raiders', tail = (h.fire ? ', on fire' : '') + ', ' + Math.round(h.to) + '% standing';
    if (h.shield) return h.d + ': shield held' + (h.pot ? ', ' + usd(h.pot) + ' stopped' : '');   // a night from before Nov 15
    if (h.sh > 0) return who + ': shield cut it to ' + usd(h.usd) + tail;
    return who + ' -' + usd(h.usd) + tail;
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
    return '<h2 id="b-how-t">How damage works</h2><p class="b-lede">These are the numbers the 2am battle runs on. Every missile does damage: nothing is rounded to zero, no shield stops a hit outright, and nothing is capped.</p>'
      + '<section id="b-how-shot"><h3>' + (howShot ? 'This shot' : ex ? (mine ? 'Your city last night' : 'From last night') : 'A worked example') + '</h3>' + (ex ? shotHtml(ex) : sampleHtml()) + '</section>'
      + '<section><h3>1. Your day of code is the budget</h3>' + tbl(['Work that day', 'Firepower'], [['Commit', usd(r.usd)], ['Merged pull request', usd(r.usd * r.w.pr) + ' (' + usd(r.usd * r.w.pr_self) + ' if you merged your own)'], ['Release', usd(r.usd * r.w.release)], ['Green CI run', usd(r.usd * r.w.ci_green)]])
      + '<p>AI work multiplies a repo by up to 1.6 and a streak multiplies the day by up to 1.5. There is no cap: twice the work buys twice the missiles. Bot, empty, merge and fork commits earn nothing, and a revert cancels the commit it reverts.</p></section>'
      + '<section><h3>2. The budget buys missiles</h3>' + tbl(['Size', 'Weapon', 'Price', 'TNT', 'Half land within', 'Fire spreads'], W.map(function (w) { return ['<b class="b-szl">' + w.size + '</b>', esc(w.name) + '<br><small>' + esc(w.like) + '</small>', usd(w.cost), w.tnt + ' kg', w.cep + ' m', Math.round(w.fire * 100) + '%']; }).reverse())
      + '<p>The battle buys the biggest size your city has unlocked, then spends the change on smaller ones.</p></section>'
      + '<section><h3>3. What unlocks bigger missiles</h3><ul><li><b>Tallest building.</b> ' + W.slice().reverse().map(function (w) { return w.size + ': ' + unlock[w.tech]; }).join(', ') + '. A tall repo tower counts like the lot.</li><li><b>A release in the last ' + r.relDays + ' days:</b> one size up.</li><li><b>A green CI run that day:</b> one size up.</li><li><b>Streak:</b> ' + r.guide.slice().reverse().map(function (g) { return (g.streak ? g.streak + ' days: ' : '') + aimOf(g.x) + ' aim' + (g.x < 1 ? ' (' + Math.round((1 - g.x) * 100) + '% fewer misses)' : ''); }).join(', ') + '.</li><li><b>AI work:</b> tightens the aim by up to 1.6 times.</li><li><b>Merged pull requests:</b> each puts one more rival in reach, from ' + r.reach + ' up to ' + r.reachMax + '.</li></ul></section>'
      + '<section><h3>4. Blast against the building</h3><p>A warhead wrecks what is inside its blast radius. The radius grows with the cube root of the TNT (8 times the TNT, twice the radius) and is shorter against tougher construction. This is Hopkinson-Cranz scaling with the Mills overpressure curve.</p>'
      + tbl(['Construction', 'Fails at', 'Worth per m2'].concat(W.slice().reverse().map(function (w) { return w.size + ' radius'; })), r.classes.map(function (c) { return [esc(c.name), c.kpa + ' kPa', usd(c.sqm)].concat(W.slice().reverse().map(function (w) { return r1(c.z * Math.pow(w.tnt, 1 / 3)) + ' m'; })); }))
      + '<p>A building is ' + (r.half * 2) + ' m by ' + (r.half * 2) + ' m with ' + r.floorM + ' m floors, so its value is floors x ' + r.footprint + ' m2 x the price per m2. Damage is the wrecked volume as a share of the building, times its value. A miss past the wall wrecks less and a far miss still breaks glass and cladding (up to ' + pct(r.light) + '). Every missile does at least ' + pct(r.floor || .001) + ' of the building before the shield, so no strike comes to $0.</p></section>'
      + '<section><h3>5. Shields and tired defenders</h3><p>A shield cuts a hit down. It never stops it: what gets through lands as blast and fire.</p><ul><li><b>Beginner shield:</b> takes ' + Math.round((r.dome || .99) * 100) + '% off every hit for your first 30 days and until you have 7 active days.</li><li><b>Streak shield:</b> takes 50% off at a 7-day streak, rising to 95% at 30 days.</li><li><b>The math:</b> damage = what the missile would do x (1 - shield). A cruise missile that would do $30.4M to a tower does ' + usd(30.4e6 * (1 - (r.dome || .99))) + ' through a beginner shield and $15.2M through a 50% one. The fire burns on what got through.</li><li>A shielded hit flashes on the dome, then lands smaller, with less fire and smoke. The breakdown shows what it would have cost and what the shield held.</li><li>Each missile coming in makes the next one count a little less (civil defence turns out for every siren, shielded or not), wrecked floors cannot be wrecked twice, and a team hits per person. None of these ever takes a hit to zero.</li></ul></section>'
      + '<section><h3>6. Fire and smoke</h3><p>Every hit starts a fire. A contained fire adds ' + Math.round(r.fire.small * 100) + '% of the blast damage and a fire that spreads adds ' + Math.round(r.fire.spread * 100) + '%, both scaled by how well the building burns (timber most, concrete least). It burns down as 1 - e^(-t / ' + r.fire.tauH + ' h): 63% in the first hour, out after about ' + r.fire.outH + ' hours, smoke until ' + r.fire.emberH + '.</p>'
      + '<svg class="b-curve" viewBox="0 0 240 86" role="img" aria-label="Share of the fire damage done over four hours: 63% after one hour, 86% after two, 98% after four"><path d="M10 70H232M10 70V8" fill="none" stroke="currentColor" stroke-opacity=".35"/><polyline points="' + pts + '" fill="none" stroke="#FFB347" stroke-width="2"/><circle cx="65" cy="' + (70 - 60 * (1 - Math.exp(-1))).toFixed(1) + '" r="3" fill="#FFB347"/><text x="71" y="' + (70 - 60 * (1 - Math.exp(-1)) + 12).toFixed(1) + '" font-size="9" fill="currentColor">63% at 1 h</text><text x="10" y="82" font-size="8" fill="currentColor" fill-opacity=".7">0 h</text><text x="222" y="82" font-size="8" fill="currentColor" fill-opacity=".7">4 h</text></svg></section>'
      + '<section><h3>7. Rebuilding</h3><p>Cranes rebuild ' + Math.round(r.autoRepair * 100) + '% a day on their own and ' + Math.round(r.repairPerPt * 100) + '% more for every point of new work. A city is whole again within 4 days with no action at all.</p></section>'
      + '<p class="b-ad">Run more agents, ship more commits, get more ammo. <b>Orpheus</b> shows each Claude account\'s weekly and 5-hour limit and when it resets, and moves idle agents to the account with the most room. <a href="https://useorpheus.com/app?utm_source=caldera&utm_medium=battle_explainer" target="_blank" rel="noopener">Start 14-day trial</a></p>';
  }
  function closeHow() { if (howEl) { howEl.hidden = true; } howShot = null; Array.prototype.slice.call(document.querySelectorAll('[data-bhow]')).forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); }
  function openHow(shot) {
    howShot = shot || null;
    if (!howEl) { howEl = document.createElement('aside'); howEl.className = 'b-how'; howEl.setAttribute('role', 'dialog'); howEl.setAttribute('aria-labelledby', 'b-how-t'); howEl.tabIndex = -1; document.body.appendChild(howEl);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && howEl && !howEl.hidden) closeHow(); }); }
    howEl.innerHTML = '<button type="button" class="b-hx" aria-label="Close">&times;</button><div class="b-hb">' + howHtml() + '</div>'; howEl.hidden = false; howEl.querySelector('.b-hx').onclick = closeHow; howEl.querySelector('.b-hb').scrollTop = 0;
    Array.prototype.slice.call(document.querySelectorAll('[data-bhow]')).forEach(function (b) { b.setAttribute('aria-expanded', 'true'); }); try { howEl.focus({ preventScroll: true }); } catch (e) {}
  }
  // any [data-bhow] on the page opens the sheet (the header link "How battles work" lives in world.ts)
  document.addEventListener('click', function (e) { var b = e.target && e.target.closest ? e.target.closest('[data-bhow]') : null; if (!b) return; e.preventDefault(); if (howEl && !howEl.hidden) closeHow(); else openHow(null); });
  if (U && U.searchParams.has('how')) setTimeout(function () { openHow(null); }, 0);
  // the header link "How battles work" (world.ts) calls this when it exists; opens the sheet, never toggles it shut
  window.CALDERA_BATTLE_HOW = function () { openHow(null); return true; };
  // ---------------------------------------------------------------- small icons (the mockups' set, 24px grid, stroke 1.75)
  var ICO = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    layers: '<path d="M12 4 3 9l9 5 9-5-9-5Z"/><path d="m3 14 9 5 9-5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[n] || '') + '</svg>'; }
  try { if (!document.getElementById('b-font')) { var fl = document.createElement('link'); fl.id = 'b-font'; fl.rel = 'stylesheet'; fl.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@500;600&family=Saira+Extra+Condensed:wght@900&display=swap'; document.head.appendChild(fl); } } catch (e) {}   // 11-20 strike card (STRIKECARD.md): Saira Extra Condensed 900 for its headline, Barlow 600 and Plex Mono 500/600 for its labels
  /** the Aim tile's word for a miss multiplier (PAGE.md 5a): 1 or more Standard, 0.75 to 0.99 Steady, 0.5 to 0.74 Sharp, under 0.5 Pinpoint */
  function aimOf(cep) { cep = cep == null ? 1 : +cep; return cep >= 1 ? 'Standard' : cep >= 0.75 ? 'Steady' : cep >= 0.5 ? 'Sharp' : 'Pinpoint'; }
  function aimLine(cep) { cep = cep == null ? 1 : +cep; return cep >= 1 ? 'normal misses' : Math.round((1 - cep) * 100) + '% fewer misses'; }
  /** the line under the firepower tiles: "88 commits, 1 release, +27% streak bonus" */
  function workLine(a) {
    if (!a || !(a.shots > 0)) return 'Push code today to load missiles.';
    var p = [], pl = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
    if (a.c) p.push(pl(a.c, 'commit')); if (a.pr) p.push(pl(a.pr, 'pull request')); if (a.rel) p.push(pl(a.rel, 'release')); if (a.ci) p.push('green CI');
    if (a.ai > 1) p.push('+' + Math.round((a.ai - 1) * 100) + '% AI bonus'); if (a.streak > 1) p.push('+' + Math.round((a.streak - 1) * 100) + '% streak bonus');
    return p.join(', ') || 'Push code today to load missiles.';
  }
  var SZN = { S: 'small', M: 'medium', L: 'large', XL: 'extra large' };
  /** the Missiles tile's line: the sizes with a count, biggest first; the unlock hint while a bigger size is locked */
  function missLine(a) {
    var why = a.why || {}, W = rules() ? rules().weapons : [];
    if ((a.tech || 0) < 3) return !why.rel ? 'Ship a release for the next size' : !why.ci ? 'A green CI run today unlocks the next size' : 'A taller building unlocks the next size';
    return W.slice().reverse().filter(function (w) { return a.n && a.n[w.k]; }).map(function (w) { return a.n[w.k] + ' ' + (SZN[w.size] || w.size); }).join(', ');
  }
  // ---------------------------------------------------------------- the tabs under the deck (PAGE.md 5c): Shot by shot, Season ranking, Arming today
  var TKEY = 'caldera.world.tab', TABS = ['shots', 'season', 'arsenals'], tab = 'shots', more = { shots: false, season: false, arsenals: false }, openShot = -1;
  try { var tv = localStorage.getItem(TKEY); if (TABS.indexOf(tv) >= 0) tab = tv; } catch (e) {}
  if (TABS.indexOf(location.hash.slice(1)) >= 0) tab = location.hash.slice(1);
  function setTab(k, focus, save) {
    if (TABS.indexOf(k) < 0) return; tab = k;
    TABS.forEach(function (t) { var b = q('[data-tab="' + t + '"]'), p = bar ? bar.querySelector('#' + t) : null; if (b) { b.setAttribute('aria-selected', String(t === k)); b.tabIndex = t === k ? 0 : -1; if (t === k && focus) b.focus(); } if (p) p.hidden = t !== k; });
    if (save) try { localStorage.setItem(TKEY, k); } catch (e) {}
  }
  function moreBtn(k, n) { return n > 8 && !more[k] ? '<button type="button" class="b-more" data-more="' + k + '">Show all ' + n + '</button>' : ''; }
  function shotRow(s, i) {
    var w = wOf(s[2]), x = s[8], word = x && x.bk ? x.word : '', open = openShot === i, blk = !!s[6];
    var an = s[0].charAt(0) === '@' ? s[0] : 'Raiders', dn = nameOf(s[1]);
    return '<li' + (open ? ' class="open"' : '') + '><div class="b-sr"><button type="button" class="b-hit0" data-shot="' + i + '" aria-expanded="' + open + '" aria-label="' + esc(an + ' fired at ' + dn + ': how the damage was worked out') + '"></button><time>' + (s[4] ? hhmm(s[4]) : '') + '</time>'
      + '<span class="b-p">' + who(s[0], 'a', an) + ' → ' + who(s[1], 'd', dn) + (word ? '<q>' + esc(word) + '</q>' : '') + '</span>'
      + '<span class="b-szc">' + esc(w ? w.size : '') + '</span><span class="b-r' + (blk ? ' h' : '') + '">' + (blk ? 'Blocked ' + usd(x && x.pot != null ? x.pot : shotUsd(s)) : '−' + usd(shotUsd(s))) + '</span><span class="b-cv" aria-hidden="true">›</span></div>'
      + (open ? '<div class="b-shot">' + shotHtml(s) + '</div>' : '') + '</li>';
  }
  function lists() {
    var S = data.shots || [], M = data.members || {}, keys = Object.keys(M), mh = me && me.h ? String(me.h).replace(/^@?/, '@') : null;
    var landed = S.filter(function (x) { return x[3] > 0; }).length, armed = keys.filter(function (k) { return M[k].usd > 0; }).sort(function (a, b) { return (M[b].usd || 0) - (M[a].usd || 0) || (a < b ? -1 : 1); });
    setText('nshots', String(S.length)); setText('narmed', armed.length + ' of ' + keys.length); setText('narmeds', String(armed.length));
    setText('shotsum', S.length ? S.length + ' fired · ' + landed + ' landed · ' + (data.fires || 0) + ' fire' + (data.fires === 1 ? '' : 's') + ' spread. Biggest hits first. Open a shot to see how its damage was worked out.' : 'No missiles last night.');
    var sl = q('[data-b="shotlist"]');
    if (sl) { var ord = S.map(function (s, i) { return i; }).sort(function (a, b) { return shotUsd(S[b]) - shotUsd(S[a]) || a - b; });
      sl.innerHTML = S.length ? '<ul class="b-sl">' + (more.shots ? ord : ord.slice(0, 8)).map(function (i) { return shotRow(S[i], i); }).join('') + '</ul>' + moreBtn('shots', S.length) : ''; }
    setText('seasonsum', 'Season ' + data.season.n + ' · week ' + data.season.week + '. Score = damage you dealt + half of what your shield blocked, per person.');
    var bd = q('[data-b="board"]'), Bd = data.board || [];
    if (bd) bd.innerHTML = Bd.length ? '<ol class="b-rk">' + (more.season ? Bd : Bd.slice(0, 8)).map(function (r, i) { var you = r[0] === mh; return '<li' + (you ? ' class="you"' : '') + '><button type="button" class="b-hit0" data-fly="' + esc(r[0]) + '" aria-label="Show ' + esc(r[0]) + ' on the map"></button><span class="b-rn">' + (i + 1) + '</span>' + who(r[0], 'n') + (you ? '<i class="b-yq" aria-hidden="true"></i><small>Your city</small>' : '') + '<b>' + usd(r[1]) + '</b></li>'; }).join('') + '</ol>' + moreBtn('season', Bd.length) : '<p class="b-empty">No scores yet. The first battle sets the ranking.</p>';
    setText('armsum', armed.length + ' of ' + keys.length + ' cit' + (keys.length === 1 ? 'y has' : 'ies have') + ' missiles so far today.');
    var ar = q('[data-b="arsenals"]');
    if (ar) ar.innerHTML = armed.length ? '<ul class="b-al">' + (more.arsenals ? armed : armed.slice(0, 8)).map(function (k) { var m = M[k]; return '<li><button type="button" class="b-hit0" data-fly="' + esc(k) + '" aria-label="Show ' + esc(k) + ' on the map"></button>' + who(k, 'n') + '<span>' + (m.shots || 0) + ' missile' + (m.shots === 1 ? '' : 's') + '</span><b>' + usd(m.usd || 0) + '</b></li>'; }).join('') + '</ul>' + moreBtn('arsenals', armed.length)
      : '<p class="b-empty">' + (keys.length ? 'No city has missiles yet today. Code pushed today loads them.' : 'No cities in the battles yet.') + '</p>';
  }
  // ---------------------------------------------------------------- the Last night card (PAGE.md 5b)
  function yourCity() {
    if (!me || !me.war || !me.last) return '';
    var L = me.last, rows = [], raids = L.raids || [], hits = raids.reduce(function (t, r) { return t + (r.landed || 0); }, 0);
    var bq = function (b) { return (BNAME[b.k] || b.k) + ' "' + b.word + '"'; };
    rows.push(['Hits on you', hits ? '<span class="gd">' + hits + '</span> · ' + esc(usd(L.takenUsd)) + ' damage' : raids.length ? 'none: your shield blocked them' : 'none']);
    if (L.heldUsd > 0) rows.push(['Your shield blocked', '<span class="cy">' + esc(usd(L.heldUsd)) + '</span>']);
    if (L.bombs && L.bombs.length) rows.push(['Custom bombs on you', esc(L.bombs.length + ': ') + L.bombs.slice(0, 2).map(function (b) { return esc(bq(b)) + ' from ' + who(b.from); }).join(', ') + esc(L.bombs.length > 2 ? ', +' + (L.bombs.length - 2) + ' more' : '')]);
    rows.push(['You hit', !L.fired ? 'You had no missiles' : L.landed ? ((L.on || []).slice(0, 2).map(function (h) { return who(h); }).join(', ') || esc(L.landed + ' hit' + (L.landed === 1 ? '' : 's'))) + (L.dealtUsd ? ' · <span class="gd">' + esc(usd(L.dealtUsd)) + '</span>' : '') : 'No hits: shields blocked them']);
    if (L.mine) rows.push(['Your bombs', esc(L.mine.n + ' flew, ' + (L.mine.hit || 0) + ' hit')]);
    if (L.mvp) rows.push(['Top builder', esc(L.mvp.repo + ', ' + L.mvp.bricks + ' brick' + (L.mvp.bricks === 1 ? '' : 's'))]);
    if (L.taken > 0) rows.push(['Rebuilt so far', '<span class="gr">' + (L.rebuilt || 0) + '%</span>']);
    if (L.reward > 0) rows.push(['Reward', '+' + L.reward + ' credits']);
    return '<h3 class="b-ych"><i aria-hidden="true"></i>Your city</h3><dl class="b-yc">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>';
  }
  function lastRender() {
    var el = q('[data-b="last"]'); if (!el) return;
    var S = data.shots || [], landed = S.filter(function (x) { return x[3] > 0; }).length, eb = '<p class="b-eb">Last night · ' + esc(dLabel(data.night)) + '</p>';
    var lay = '<button type="button" class="b-gb" data-pop="layers" aria-haspopup="dialog" aria-expanded="' + (popKind === 'layers') + '">' + ic('layers') + 'Layers</button>';
    if (!S.length) { el.innerHTML = eb + '<h2 class="b-big b-none">No battle last night</h2><p class="b-sub">No city had missiles. Watch a demo to see how a battle looks.</p><div class="b-lbtn"><button type="button" class="b-gb" data-bdemo aria-pressed="false">' + ic('play') + 'Watch a demo battle</button>' + lay + '</div>'; popRefresh(); return; }
    var dmg = data.usd != null ? data.usd : S.reduce(function (t, x) { return t + shotUsd(x); }, 0);
    el.innerHTML = eb + '<div class="b-nums"><div><b>' + (data.cities || 0) + '</b><span>' + (data.cities === 1 ? 'city fought' : 'cities fought') + '</span></div><div><b>' + landed + '</b><span>missile' + (landed === 1 ? '' : 's') + ' hit</span></div><div class="g"><b>' + esc(usd(dmg)) + '</b><span>damage</span></div></div>' + yourCity()
      + '<div class="b-lbtn"><button type="button" class="b-gb" data-bl="replay" aria-pressed="' + !!(layers.replay && playing) + '">' + ic('play') + 'Replay</button><button type="button" class="b-gb b-share">' + ic('copy') + '<span>Copy link</span></button>' + lay
      + '<a class="b-allshots" href="#shots" data-ball>All ' + S.length + ' shot' + (S.length === 1 ? '' : 's') + '</a></div>';
    popRefresh();
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error || r.status); return j; }); });
  }
  function load() { return fetch('/v1/world/battle', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) { data = d; window.CALDERA_PEOPLE = d.people || null; if (api()) api().view(on, d); stats(); } return d; }).catch(function () {}); }
  function stats() { lastRender(); lists(); setTab(tab); if (meLoaded && !me) render(); }
  // ---------------------------------------------------------------- the view: shown and hidden by the switcher (growthclient.ts)
  var chip = null, chipT = 0, pollT = 0;
  /** the one clock (PAGE.md P1): the Armory lock time, which is the next battle; the server's clock when the member panel told us its skew */
  function lockAt() { return me && me.armory ? me.armory.locksAt : data.next; }
  function leftMs() { return (lockAt() || 0) - (Date.now() + armSkew); }
  function chipTick() {
    if (!on || !api() || !api().phase) return; var ph = api().phase();
    if (!chip) { chip = document.createElement('div'); chip.className = 'b-chip'; chip.setAttribute('role', 'timer'); chip.setAttribute('aria-live', 'off'); chip.innerHTML = '<i></i><span class="b-ct"></span>'; if (stage) stage.appendChild(chip); }
    var ct = chip.querySelector('.b-ct'), t;
    if (ph.replay) { chip.classList.toggle('rebuild', ph.stage === 'rebuild'); t = '<b>' + (ph.demo ? 'Demo replay' : 'Replay') + '</b> ' + esc((ph.stage === 'beat' || ph.stage === 'pre' ? 'Strike ' + ph.beat + ' of ' + ph.beats + (ph.label ? ' · ' + ph.label : '') : ph.label || '') + (ph.paused ? ' · paused' : '')); if (ct.innerHTML !== t) ct.innerHTML = t; hud(ph); return; }
    var left = leftMs(), reb = ph.seg === 'rebuild' && left > 0, n = ph.total || 0;
    if (reb) t = 'Cranes rebuild until <b>12:00</b>';
    else if (left <= 0) t = '<b>Battle running</b>';
    else { var sp = esc(armSpan(left)); t = '<span class="b-cw">Battle starts in <b>' + sp + '</b> · <b>' + n + '</b> missile' + (n === 1 ? '' : 's') + ' loaded</span><span class="b-cn">Starts in <b>' + sp + '</b></span>'; }
    chip.classList.toggle('rebuild', reb); if (ct.innerHTML !== t) ct.innerHTML = t;
  }
  // the replay controls on the map, one compact bar: Strike n of m + the last hit's damage tier, then Prev, Pause / Play, Next, speed, Fit, Follow (only after the viewer moved the camera), End. 44 px targets.
  var hudEl = null, hudHit = null;
  function hud(ph) {
    if (!stage) return;
    if (!hudEl) { hudEl = document.createElement('div'); hudEl.className = 'b-play'; hudEl.setAttribute('role', 'group'); hudEl.setAttribute('aria-label', 'Replay controls');
      hudEl.innerHTML = '<div class="b-pt"><div class="b-l1"><b data-p="beat"></b><span data-p="label" title=""></span></div><button type="button" data-p="hit" class="b-hit" aria-live="polite" hidden></button></div><div class="b-pb">'
        + '<button type="button" data-p="follow" aria-label="Follow the action again" title="Follow the action again" hidden>' + bIco('follow') + '<span>Follow</span></button>'
        + '<button type="button" data-p="prev" aria-label="Previous strike" title="Previous strike (\u2190)">' + bIco('prev') + '</button><button type="button" data-p="pause" aria-pressed="false" aria-label="Pause" title="Pause (Space)">' + bIco('pause') + '</button><button type="button" data-p="skip" aria-label="Next strike" title="Next strike (\u2192)">' + bIco('next') + '</button>'
        + '<i class="b-sep" aria-hidden="true"></i><button type="button" data-p="unfull" aria-label="Exit full screen" title="Exit full screen (F)" hidden>' + bIco('unfull') + '</button>'
        + '<button type="button" data-p="more" aria-haspopup="menu" aria-controls="b-menu" aria-expanded="false" aria-label="More controls" title="More controls">' + bIco('more') + '</button>'
        + '<button type="button" data-p="stop" aria-label="End the replay" title="End the replay">' + bIco('stop') + '</button></div>'
        + '<div class="b-menu" id="b-menu" role="menu" aria-label="More replay controls" hidden>'
        + '<button type="button" role="menuitem" data-p="speed" title="Change speed: 0.5x, 1x or 2x">' + bIco('speed') + '<span>Speed</span><em>1x</em></button>'
        + '<button type="button" role="menuitem" data-p="fit" aria-label="Fit all: show the whole battlefield" title="Fit all: show the whole battlefield">' + bIco('fit') + '<span>Fit all</span></button>'
        + '<button type="button" role="menuitemcheckbox" data-p="snd" aria-checked="true" aria-label="Sound" title="Sound (M)">' + bIco('snd') + '<span>Sound</span><em>On</em><kbd>M</kbd></button>'
        + '<button type="button" role="menuitem" data-p="full" aria-label="Full screen" title="Full screen (F)"></button></div>';
      var A = function () { return api(); }, refresh = function () { var p = A() && A().phase ? A().phase() : null; if (p && p.replay) hud(p); };
      hudEl.querySelector('[data-p="pause"]').onclick = function () { if (A() && A().pause) { var on = A().pause(); pauseSet(this, on); } };
      hudEl.querySelector('[data-p="skip"]').onclick = function () { if (A() && A().skip) A().skip(); refresh(); };
      hudEl.querySelector('[data-p="prev"]').onclick = function () { if (A() && A().prev) A().prev(); refresh(); };
      hudEl.querySelector('[data-p="speed"]').onclick = function () { speed = BSPD.next(speed); BSPD.save(speed); if (A() && A().speed) A().speed(speed); refresh(); };
      hudEl.querySelector('[data-p="fit"]').onclick = function () { if (A() && A().fit) A().fit(); menuSet(false); refresh(); };
      hudEl.querySelector('[data-p="follow"]').onclick = function () { if (A() && A().follow) A().follow(true); refresh(); };
      hudEl.querySelector('[data-p="stop"]').onclick = function () { menuSet(false); stopPlay(); };
      hudEl.querySelector('[data-p="more"]').onclick = function () { menuSet(hudEl.querySelector('.b-menu').hidden, true); };
      hudEl.querySelector('[data-p="unfull"]').onclick = function () { if (A() && A().full) { A().full(false); setTimeout(fsSync, 60); } };
      hudEl.querySelector('.b-menu').addEventListener('keydown', function (e) {   // Esc closes, arrows move between the items
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menuSet(false); var mb = hudEl.querySelector('[data-p="more"]'); if (mb) mb.focus(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var it = Array.prototype.slice.call(this.querySelectorAll('button:not([hidden])')), ix = it.indexOf(document.activeElement); ix = (ix + (e.key === 'ArrowDown' ? 1 : it.length - 1)) % it.length; if (it[ix]) it[ix].focus(); }
        if (e.key === 'Tab') menuSet(false); });
      // Mike 11-21: the replay starts in the page; full screen is the viewer's own tap (Fable design). Leaving it keeps the replay
      hudEl.querySelector('[data-p="full"]').onclick = function () { if (A() && A().full) { A().full(!A().full()); menuSet(false); setTimeout(fsSync, 60); } };
      document.addEventListener('fullscreenchange', fsSync); fsSync();
      hudEl.querySelector('[data-p="snd"]').onclick = function () { if (A() && A().sound) A().sound(!A().sound()); refresh(); };   // D6 (Mike 11-20): sound on by default for a pressed replay; a mute is remembered
      hudEl.querySelector('[data-p="hit"]').onclick = function () { menuSet(false); if (!hudHit) return; var s = nightShots(hudHit.night)[hudHit.ix]; if (!s) return; if (A() && A().pause) A().pause(true); refresh(); openHow(s); };
      document.addEventListener('keydown', function (e) {   // 11-20: keys during a replay (right/left: next/previous strike, space: pause)
        if (!hudEl || !document.documentElement.classList.contains('w-replay') || document.documentElement.classList.contains('w-board') || e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.closest && e.target.closest('.b-menu'))) return;
        if (puEl && /^[123]$/.test(e.key)) { e.preventDefault(); puToggle(BPU.kind(e.key).k); return; }   // power-ups: 1 2 3 arm, Esc disarms
        if (e.key === 'Escape' && puDisarm()) { e.preventDefault(); return; }
        var k = e.key === 'ArrowRight' ? 'skip' : e.key === 'ArrowLeft' ? 'prev' : e.key === ' ' ? 'pause' : e.key === 'm' || e.key === 'M' ? 'snd' : e.key === 'f' || e.key === 'F' ? 'full' : ''; if (!k) return;
        var b = hudEl.querySelector('[data-p="' + k + '"]'); if (b) { e.preventDefault(); b.click(); } });
      document.addEventListener('pointerdown', function (e) { if (!hudEl || hudEl.querySelector('.b-menu').hidden) return; var t = e.target; if (t && t.closest && (t.closest('.b-menu') || t.closest('[data-p="more"]'))) return; menuSet(false); }, true);
      stage.appendChild(hudEl); fsSync(); puOn(); }
    if (api() && api().viewer) api().viewer(me && me.h ? me.h : null);   // the strike card: the viewer's own cities read YOU and YOUR on screen (citycard.ts)
    // LEADERBOARD.md (Mike 11-21): at the end of the replay the plugin holds the clock and puts the results board up (html.w-board):
    // the bar, its menu and the power-up tray step aside (CSS below) and no key acts behind it; the board stays until a button
    if (ph.board) { menuSet(false); puDisarm(); if (playing) { clearTimeout(playing); playing = null; } }
    var st = ph.stage, beat = st === 'beat' || st === 'pre' ? 'Strike ' + ph.beat + ' of ' + ph.beats : st === 'fall' ? 'Final strike' : st === 'wide' ? 'All ' + ph.beats + ' strike' + (ph.beats === 1 ? '' : 's') + ' in' : st === 'rebuild' ? 'Rebuilding' : '';
    var sbeat = st === 'beat' || st === 'pre' ? ph.beat + '/' + ph.beats : st === 'fall' ? 'Final' : st === 'wide' ? 'All ' + ph.beats + ' in' : beat, dm = ph.demo ? 'Demo \u00b7 ' : '', bt = dm + beat + '|' + dm + sbeat, be = hudEl.querySelector('[data-p="beat"]');
    if (be.getAttribute('data-t') !== bt) { be.setAttribute('data-t', bt); be.innerHTML = '<span class="sr">' + esc(dm + beat) + '</span><span aria-hidden="true">' + esc(dm + sbeat) + '</span>'; }
    var lb = hudEl.querySelector('[data-p="label"]'); lb.textContent = ph.label || ''; lb.title = ph.label || '';
    var hs = ph.hit && !ph.demo ? nightShots(ph.night)[ph.hit.ix] : null, ht = ph.hit ? hitLine(ph.hit) + bombTail(hs) : '';
    var mh = me && me.h ? String(me.h) : null, fl = hudEl.querySelector('[data-p="flag"]'), canFlag = !!(me && bombOf(hs) && !hs[8].hid && hs[0] !== mh && !flagBusy);
    if (canFlag && !fl) { hudEl.querySelector('.b-pt').insertAdjacentHTML('beforeend', flagHtml(hs)); fl = hudEl.querySelector('[data-p="flag"]'); }
    if (fl) { if (!canFlag) fl.remove(); else { fl.setAttribute('aria-label', 'Report the word ' + hs[8].word); fl.onclick = function () { flagAsk(hs); }; } }
    var hb = hudEl.querySelector('[data-p="hit"]'); hb.textContent = ht + (ht && !ph.demo ? ' \u00b7 math' : ''); hb.hidden = !ht; hb.classList.toggle('sh', !!(ph.hit && (ph.hit.shield || ph.hit.sh > 0))); hudHit = ph.hit && !ph.demo ? { night: ph.night, ix: ph.hit.ix } : null;
    pauseSet(hudEl.querySelector('[data-p="pause"]'), !!ph.paused);
    var sk = hudEl.querySelector('[data-p="skip"]'), skw = st === 'rebuild' ? 'Finish' : st === 'wide' ? 'Cranes' : '';
    if (sk.getAttribute('data-w') !== skw) { sk.setAttribute('data-w', skw); sk.classList.toggle('t', !!skw); sk.innerHTML = bIco('next') + (skw ? '<span>' + skw + '</span>' : ''); var skl = st === 'rebuild' ? 'Finish the replay' : st === 'wide' ? 'Skip to the cranes' : 'Next strike'; sk.setAttribute('aria-label', skl); sk.title = skl + ' (\u2192)'; }
    var sp = hudEl.querySelector('[data-p="speed"]'), cur = ph.speed || speed, spl = BSPD.label(cur); sp.querySelector('em').textContent = spl; sp.setAttribute('aria-label', 'Speed ' + spl + '. Change speed: 0.5x, 1x or 2x.');
    var mo = hudEl.querySelector('[data-p="more"]'); if (spl === '1x') mo.removeAttribute('data-sp'); else mo.setAttribute('data-sp', spl);
    var fo = hudEl.querySelector('[data-p="follow"]'); fo.hidden = ph.follow !== false;
    var sb = hudEl.querySelector('[data-p="snd"]'), son = !!(api() && api().sound && api().sound()); sb.hidden = !(api() && api().sound); if (sb.getAttribute('aria-checked') !== String(son) || !sb.getAttribute('data-i')) { sb.setAttribute('data-i', '1'); sb.setAttribute('aria-checked', String(son)); sb.innerHTML = bIco(son ? 'snd' : 'muted') + '<span>Sound</span><em>' + (son ? 'On' : 'Off') + '</em><kbd>M</kbd>'; } sb.setAttribute('aria-label', son ? 'Sound on. Mute.' : 'Sound off. Turn sound on.');
    fsSync(); puTick();
  }
  // ---- power-ups start: viewer power-ups v1 (DESIGN.md item 10; Mike D1 11-20): cosmetic, free, local to this viewer, no network
  // call, no storage. The tray shows only during a replay, bottom right of the map, never over the replay bar (Mike 11-21: the bar
  // had "too many options", so the tray sits beside it, or right above it on a phone) and hides while the bar's menu is open.
  var puEl = null, puS = null, puArm = null, puToastEl = null, puToastT = 0, puRet = null;
  var PUI = { heal: '<path d="M4.5 9a7.5 5.5 0 0 1 15 0"/><path d="M4.5 9 9 14M19.5 9 15 14M12 3.5V9"/><rect x="8" y="14" width="8" height="7" rx="1"/><path d="M12 15.8v3.4M10.3 17.5h3.4"/>',
    fw: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    cheer: '<path d="M4 10v4l3 .6V9.4L4 10zM7 9.4 17 5v14L7 14.6"/><path d="M9 15.2V19h3v-2.6M20 9.5v5"/>' };
  function puNow() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  function puOn() {
    if (puEl || !stage || !(api() && api().drop)) return;
    puS = BPU.fresh(); puArm = null; puEl = document.createElement('div'); puEl.className = 'b-pu'; puEl.setAttribute('role', 'group'); puEl.setAttribute('aria-label', 'Power-ups: tap one, then tap the map');
    puEl.innerHTML = '<div class="b-puhint" aria-live="polite" hidden></div><div class="b-putray">' + BPU.KINDS.map(function (o) {
      return '<button type="button" class="b-puslot" data-pu="' + o.k + '" style="--c:' + o.col + '" aria-pressed="false" aria-label="' + o.name + ' (key ' + o.key + ')" title="' + o.name + ' (' + o.key + ')">'
        + '<span class="b-pukey" aria-hidden="true">' + o.key + '</span><span class="b-pucd" aria-hidden="true"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + PUI[o.k] + '</svg>'
        + '<span class="b-pupips" aria-hidden="true"><i></i><i></i><i></i></span></button>'; }).join('') + '</div>';
    Array.prototype.forEach.call(puEl.querySelectorAll('[data-pu]'), function (b) { b.onclick = function () { puToggle(b.getAttribute('data-pu')); }; });
    puRet = document.createElement('div'); puRet.className = 'b-puret'; puRet.hidden = true; puRet.setAttribute('aria-hidden', 'true');
    puToastEl = document.createElement('div'); puToastEl.className = 'b-putoast'; puToastEl.setAttribute('role', 'status'); puToastEl.hidden = true;
    stage.appendChild(puEl); stage.appendChild(puRet); stage.appendChild(puToastEl);
    stage.addEventListener('pointermove', puMove); stage.addEventListener('pointerleave', puLeave);
    window.CALDERA_BATTLE_TAP = puTap; puTick(); }
  function puOff() {
    if (!puEl) return; [puEl, puRet, puToastEl].forEach(function (x) { if (x) x.remove(); }); puEl = puRet = puToastEl = null; puS = null; puArm = null; clearTimeout(puToastT);
    if (stage) { stage.removeEventListener('pointermove', puMove); stage.removeEventListener('pointerleave', puLeave); }
    if (window.CALDERA_BATTLE_TAP === puTap) window.CALDERA_BATTLE_TAP = null; document.documentElement.classList.remove('pu-armed'); }
  /** a slot tap or its key: arm it; again (or Esc, or its last charge) disarms */
  function puToggle(k) { if (!puS) return; if (puArm === k) puArm = null; else if (BPU.canArm(puS, k, puNow())) puArm = k; puTick(); }
  function puDisarm() { if (!puArm) return false; puArm = null; puTick(); return true; }
  /** city.ts hands a replay tap here (under 180 ms and 8 px). Armed: drop at the tap; true = the tap was the tray's */
  function puTap(x, y) {
    if (!puArm || !puS) return false; var now = puNow(), k = puArm; if (BPU.why(puS, k, now) !== 'ok') return true;
    var r = api() && api().drop ? api().drop(k, x, y) : null; if (!r || !r.ok) return true;
    BPU.use(puS, k, now); if (BPU.left(puS, k, now) <= 0 || puS.used >= BPU.CAP) puArm = null; puToast(k, r.handle); puTick(); return true; }
  function puToast(k, h) { if (!puToastEl) return; var o = BPU.kind(k); puToastEl.style.setProperty('--c', o.col); puToastEl.innerHTML = '<b aria-hidden="true">+</b> ' + esc(BPU.toast(k, h)); puToastEl.hidden = false;
    clearTimeout(puToastT); puToastT = setTimeout(function () { if (puToastEl) puToastEl.hidden = true; }, 2000); }
  function puMove(e) { if (!puRet) return; var cv = e.target && e.target.tagName === 'CANVAS'; if (!puArm || e.pointerType !== 'mouse' || !cv) { puRet.hidden = true; return; }
    var r = stage.getBoundingClientRect(); puRet.style.left = (e.clientX - r.left) + 'px'; puRet.style.top = (e.clientY - r.top) + 'px'; puRet.hidden = false; }
  function puLeave() { if (puRet) puRet.hidden = true; }
  /** the tray's look (every hud tick, 200 ms): slot states, pips, sweep, seconds, the hint chip, and its place beside the bar */
  function puTick() {
    if (!puEl || !puS) return; var now = puNow(); if (puArm && !BPU.canArm(puS, puArm, now)) puArm = null;
    BPU.KINDS.forEach(function (o) { var b = puEl.querySelector('[data-pu="' + o.k + '"]'), v = BPU.view(puS, o.k, now, puArm); if (!b) return;
      if (b.getAttribute('data-st') !== v.state) { b.setAttribute('data-st', v.state); b.className = 'b-puslot ' + v.state; }
      b.setAttribute('aria-pressed', String(v.state === 'armed')); b.disabled = v.state === 'empty';
      b.style.setProperty('--p', Math.round(v.p * 100) + '%'); var cd = b.querySelector('.b-pucd'), ct = v.sec > 0 ? v.sec + 's' : ''; if (cd.textContent !== ct) cd.textContent = ct;
      Array.prototype.forEach.call(b.querySelectorAll('.b-pupips i'), function (pip, i) { pip.className = i < v.n ? 'f' : ''; });
      b.setAttribute('aria-label', o.name + ' (key ' + o.key + '), ' + v.n + ' of ' + BPU.MAX + (v.state === 'armed' ? ', armed' : '')); });
    var hn = puEl.querySelector('.b-puhint'), ht = puS.used >= BPU.CAP ? BPU.hint(puS, null, now) : puArm ? BPU.hint(puS, puArm, now) : '';
    if (hn.textContent !== ht) hn.textContent = ht; hn.hidden = !ht;
    document.documentElement.classList.toggle('pu-armed', !!puArm); if (puRet) { if (puArm) puRet.style.setProperty('--c', BPU.kind(puArm).col); else puRet.hidden = true; }
    puPlace(); }
  /** never over the replay bar: lift the tray above it when they meet (phones: always); hide it while the bar's menu is open */
  function puPlace() {
    if (!puEl || !stage) return; var m = hudEl && hudEl.querySelector('.b-menu'); puEl.classList.toggle('mhide', !!(m && !m.hidden)); puEl.style.bottom = '';
    if (!hudEl) return; var a = puEl.getBoundingClientRect(), b = hudEl.getBoundingClientRect(), s = stage.getBoundingClientRect();
    if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) puEl.style.bottom = Math.round(s.bottom - b.top + 8) + 'px'; }
  // ---- power-ups end
  function hudOff() { puOff(); if (hudEl) { hudEl.remove(); hudEl = null; } }
  function pauseSet(b, on) { if (!b || b.getAttribute('aria-pressed') === String(on) && b.firstChild) return; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Play' : 'Pause'); b.title = (on ? 'Play' : 'Pause') + ' (Space)'; b.innerHTML = bIco(on ? 'play' : 'pause'); }
  function menuSet(open, focus) { if (!hudEl) return; var m = hudEl.querySelector('.b-menu'), mb = hudEl.querySelector('[data-p="more"]'); if (!m || !mb) return; m.hidden = !open; mb.setAttribute('aria-expanded', String(!!open)); puPlace(); if (open && focus) { var f = m.querySelector('button:not([hidden])'); if (f) f.focus(); } }
  var flagBusy = false;
  function flagAsk(s) {
    if (!hudEl) return; menuSet(false); if (api() && api().pause) api().pause(true); flagBusy = true;
    var pt = hudEl.querySelector('.b-pt'), keep = pt.innerHTML, q2 = document.createElement('div'); q2.className = 'b-flagq'; q2.setAttribute('role', 'group'); q2.setAttribute('aria-label', 'Report word');
    q2.innerHTML = '<span>Report "' + esc(s[8].word) + '" from ' + esc(s[0]) + '? We hide it for you now and review it.</span><button type="button" data-p="flagyes">Report</button><button type="button" data-p="flagno">Cancel</button>';
    var fl = pt.querySelector('[data-p="flag"]'); if (fl) fl.remove(); pt.appendChild(q2); q2.querySelector('[data-p="flagyes"]').focus();
    var back = function () { q2.remove(); flagBusy = false; };
    q2.querySelector('[data-p="flagno"]').onclick = back;
    q2.querySelector('[data-p="flagyes"]').onclick = function () {
      post('/v1/world/battle/report-word', { bid: s[8].bid }).then(function () {
        s[8].word = (BNAME[s[8].bk] || s[8].bk).toUpperCase(); s[8].hid = 1;   // hidden for this viewer at once (B8); the sprite key follows the word
        q2.querySelector('span').textContent = 'Reported. The word is hidden for you.'; Array.prototype.slice.call(q2.querySelectorAll('button')).forEach(function (b) { b.remove(); });
        setTimeout(back, 2500);
      }).catch(function () { q2.querySelector('span').textContent = 'Could not send the report. Try again.'; });
    };
  }
  function show() {
    on = true; if (bar) bar.hidden = false; document.documentElement.classList.add('w-battle');
    if (api()) { api().layers(layers); api().view(true, data); }
    stats(); load(); mine(); chipTick(); clearInterval(chipT); chipT = setInterval(chipTick, 1000); clearInterval(pollT); pollT = setInterval(load, 600000);
    if (layers.replay) play(replayMode, true);
  }
  function hide() {
    on = false; stopPlay(); closeHow(); popClose(false); if (bar) bar.hidden = true; document.documentElement.classList.remove('w-battle'); if (api()) api().view(false); clearInterval(chipT); clearInterval(pollT); if (chip) { chip.remove(); chip = null; }
    try { var u = new URL(location.href); if (u.searchParams.has('layers') || u.searchParams.has('replay')) { u.searchParams.delete('layers'); u.searchParams.delete('replay'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) {}
  }
  // the Armory yard on the map (plugin cityarmory.ts): a tap on your own yard opens the Armory panel in the Battle view; anyone
  // else's (or a signed-out viewer) gets the city card as before. Who you are is asked once, on the first tap of a yard.
  var armOwner = null;
  window.CALDERA_ARMORY_OPEN = function (h, fallback) {
    var go = function () {
      if (!armOwner || armOwner !== h) { if (fallback) fallback(); return; }
      try { var u = new URL(location.href); u.hash = 'armory'; history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
      render.did = 0;
      if (on) { if (meLoaded) render(); return; }
      var b = document.querySelector('[data-gmode="battle"]'); if (b) b.click(); else show();
    };
    if (meLoaded) armOwner = me && me.war ? me.h : '';
    if (armOwner !== null) { go(); return true; }
    fetch('/v1/world/battle/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { armOwner = m && m.h && m.war ? m.h : ''; go(); }, function () { armOwner = ''; go(); });
    return true;
  };
  window.CALDERA_BATTLE_UI = { show: show, hide: hide, play: function (mode) { if (mode === 'demo') play('demo'); else setLayer('replay', true); } };
  function saveLayers() {
    try { localStorage.setItem(LKEY, JSON.stringify(layers)); } catch (e) {}
    try { var u = new URL(location.href), def = layers.damage && layers.attacks && layers.shields && !layers.replay; if (def) u.searchParams.delete('layers'); else u.searchParams.set('layers', LAYERS.filter(function (k) { return layers[k]; }).join(',') || 'none'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
  }
  function setLayer(k, v) {
    layers[k] = v; var b = q('[data-bl="' + k + '"]'); if (b) b.setAttribute('aria-pressed', String(v));
    if (k === 'replay') { if (v) play(); else stopPlay(); } else if (api()) api().layers(layers);
    saveLayers();
  }
  // ---------------------------------------------------------------- popovers (PAGE.md 5a): Layers, Choose a target, Battle settings. One at a time;
  // anchored under the opener (right aligned), a bottom sheet under 700 px; Esc or a tap outside closes; focus goes back to the opener.
  var popEl = null, popKind = '', popFrom = null;
  function popHtml(k) {
    if (k === 'layers') return '<h4 id="b-pop-t">Layers</h4>'
      + '<div class="b-prow"><span id="b-ly-d">Damage<small>Hits on the towers, smoke and the cranes</small></span><button type="button" class="b-sw" data-bl="damage" aria-pressed="' + !!layers.damage + '" aria-labelledby="b-ly-d"></button></div>'
      + '<div class="b-prow"><span id="b-ly-a">Attacks<small>Missile pads, launch centers and missiles in flight</small></span><button type="button" class="b-sw" data-bl="attacks" aria-pressed="' + !!layers.attacks + '" aria-labelledby="b-ly-a"></button></div>'
      + '<div class="b-prow"><span id="b-ly-s">Shields<small>Each city\'s shield (white: beginner shield)</small></span><button type="button" class="b-sw" data-bl="shields" aria-pressed="' + !!layers.shields + '" aria-labelledby="b-ly-s"></button></div>';
    if (k === 'aim') return aimHtml();
    if (k === 'set') return setHtml();
    return '';
  }
  function popWire(k) {
    if (!popEl) return;
    if (k === 'aim') {
      var da = popEl.querySelector('.b-doaim'); if (da) da.onclick = function () { var s = popEl.querySelector('.b-aimsel'); if (s) act('/v1/world/battle/aim', { target: s.value }); };
      Array.prototype.slice.call(popEl.querySelectorAll('.b-unaim')).forEach(function (b) { b.onclick = function () { act('/v1/world/battle/aim', { target: b.getAttribute('data-h'), off: true }); }; });
    }
    if (k === 'set') {
      Array.prototype.slice.call(popEl.querySelectorAll('[data-rep]')).forEach(function (b) { b.onclick = function () { act('/v1/world/battle/report', { freq: b.getAttribute('data-rep') }); }; });
      var wv = popEl.querySelector('.b-waive'); if (wv) wv.onclick = function () { act('/v1/world/battle/opt', { waive: !me.waive }); };
      var lv = popEl.querySelector('.b-leave'); if (lv) lv.onclick = function () { act('/v1/world/battle/opt', { war: false }); };
    }
  }
  function popPlace() {
    if (!popEl || !bar) return; var sheet = window.innerWidth < 700; popEl.classList.toggle('sheet', sheet);
    if (sheet || !popFrom || !document.contains(popFrom)) { popEl.style.left = ''; popEl.style.top = ''; return; }
    var br = bar.getBoundingClientRect(), r = popFrom.getBoundingClientRect(), w = popEl.offsetWidth;
    popEl.style.left = Math.max(0, Math.min(r.right - br.left - w, br.width - w)) + 'px'; popEl.style.top = Math.round(r.bottom - br.top + 6) + 'px';
  }
  function popOpen(k, btn) {
    popClose(false); var h = popHtml(k); if (!h || !bar) return;
    popKind = k; popFrom = btn || null; popEl = document.createElement('div'); popEl.className = 'b-pop'; popEl.setAttribute('role', 'dialog'); popEl.setAttribute('aria-labelledby', 'b-pop-t'); popEl.setAttribute('data-k', k); popEl.innerHTML = h; bar.appendChild(popEl);
    if (popFrom) popFrom.setAttribute('aria-expanded', 'true'); popPlace(); popWire(k);
    var f = popEl.querySelector('button:not([disabled]),select,input,a[href]'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  function popClose(back) {
    if (!popEl) return; popEl.remove(); popEl = null; popKind = '';
    if (popFrom) { popFrom.setAttribute('aria-expanded', 'false'); if (back && document.contains(popFrom)) try { popFrom.focus({ preventScroll: true }); } catch (e) {} } popFrom = null;
  }
  /** after the deck re-renders: the open popover shows the new state and stays anchored to the new opener */
  function popRefresh() {
    if (!popEl || !popKind) return; var k = popKind, h = popHtml(k); if (!h) { popClose(false); return; }
    var had = popEl.contains(document.activeElement); popEl.innerHTML = h; popFrom = bar.querySelector('[data-pop="' + k + '"]'); if (popFrom) popFrom.setAttribute('aria-expanded', 'true'); popPlace(); popWire(k);
    if (had || document.activeElement === document.body) { var f = popEl.querySelector('button:not([disabled]),select'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && popEl) { e.preventDefault(); popClose(true); } });
  document.addEventListener('pointerdown', function (e) { if (popEl && !popEl.contains(e.target) && !(popFrom && popFrom.contains(e.target))) popClose(false); });
  addEventListener('resize', popPlace);
  // ---------------------------------------------------------------- one click handler for the deck's buttons (the cards re-render, the handler stays)
  if (bar) bar.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null, b; if (!t) return;
    if ((b = t.closest('[data-bl]'))) { setLayer(b.getAttribute('data-bl'), b.getAttribute('aria-pressed') !== 'true'); return; }
    if ((b = t.closest('[data-bdemo]'))) { play('demo'); return; }
    if ((b = t.closest('[data-pop]'))) { var pk = b.getAttribute('data-pop'); if (popKind === pk) popClose(true); else popOpen(pk, b); return; }
    if ((b = t.closest('[data-ball]'))) { e.preventDefault(); setTab('shots', false, true); var tb = q('[data-tab="shots"]'); if (tb) { try { tb.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e2) {} try { tb.focus({ preventScroll: true }); } catch (e2) {} } return; }
    if ((b = t.closest('.b-share'))) {
      var u = location.origin + '/world?view=battle&replay=1', lb = b.querySelector('span') || b, done = function () { lb.textContent = 'Copied'; setTimeout(function () { lb.textContent = 'Copy link'; }, 2000); };
      try { navigator.clipboard.writeText(u).then(done, function () { prompt('Link to last night', u); }); } catch (e3) { prompt('Link to last night', u); } return; }
    if ((b = t.closest('[data-tab]'))) { setTab(b.getAttribute('data-tab'), false, true); return; }
    if ((b = t.closest('[data-more]'))) { more[b.getAttribute('data-more')] = true; lists(); return; }
    if ((b = t.closest('[data-shot]'))) { var i = +b.getAttribute('data-shot'); openShot = openShot === i ? -1 : i; lists(); var nb = q('[data-shot="' + i + '"]'); if (nb) try { nb.focus({ preventScroll: true }); } catch (e4) {} return; }
    if ((b = t.closest('[data-fly]'))) { if (api()) api().fly(b.getAttribute('data-fly')); return; }
  });
  // the tab row: arrow keys, Home and End move between the tabs (role="tablist")
  var trow = q('[role="tablist"]'); if (trow) trow.addEventListener('keydown', function (e) {
    var i = TABS.indexOf(tab), k = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1;
    if (k < 0) return; e.preventDefault(); setTab(TABS[k], true, true);
  });
  addEventListener('hashchange', function () { var h = location.hash.slice(1); if (TABS.indexOf(h) >= 0) setTab(h); });
  // ---------------------------------------------------------------- replay: the cinematic strike-by-strike replay (or the demo)
  var cap = q('[data-b="cap"]'), hudT = 0;
  function stopPlay() { try { if (api() && api().full && api().full()) api().full(false); } catch (e) {} setTimeout(fsSync, 60); if (playing) { clearTimeout(playing); playing = null; } clearInterval(hudT); hudT = 0; document.documentElement.classList.remove('w-replay'); document.documentElement.classList.remove('fb-hide'); if (api() && api().stop) api().stop(); hudOff(); if (cap) cap.textContent = ''; var b = q('[data-bl="replay"]'); if (b) b.setAttribute('aria-pressed', 'false'); var d = q('[data-bdemo]'); if (d) d.setAttribute('aria-pressed', 'false'); layers.replay = false; chipTick(); }
  function play(mode, auto) {
    if (playing) { clearTimeout(playing); playing = null; } clearInterval(hudT); hudT = 0;
    closeHow();
    // the results board's buttons (LEADERBOARD.md): Watch again = play() in the same mode, Exit = stopPlay(), Add your city = /#start
    if (api() && api().boardHooks) api().boardHooks({ again: function (demo) { play(demo ? 'demo' : undefined); }, exit: function () { stopPlay(); }, add: '/#start', signedIn: function () { return !!me; } });
    var n = on && api() && api().replay ? api().replay(mode, { speed: speed, auto: !!auto }) : 0;
    if (!n) { if (cap) cap.textContent = mode === 'demo' ? 'The demo needs two cities with repo towers on the map.' : 'No battle to replay. Watch a demo battle instead.'; playing = setTimeout(stopPlay, 3500); return; }
    var ph = api().phase(), b = q('[data-bl="replay"]'); if (b) b.setAttribute('aria-pressed', String(mode !== 'demo')); var d = q('[data-bdemo]'); if (d) d.setAttribute('aria-pressed', String(mode === 'demo')); layers.replay = mode !== 'demo';
    if (cap) cap.textContent = (mode === 'demo' ? 'Demo: a sample battle between the biggest cities on the map, synthetic shots. ' : 'Replay: ') + ph.beats + ' strike' + (ph.beats === 1 ? '' : 's') + ', ' + n + ' missile' + (n === 1 ? '' : 's') + ', about ' + Math.round(ph.dur / 1000 / (ph.speed || 1)) + ' s at ' + BSPD.label(ph.speed || 1) + '. Scroll, pinch or drag to look around; Fit shows the whole map; Next or the right arrow key goes to the next strike.';
    chipTick(); hud(ph); document.documentElement.classList.add('w-replay'); document.documentElement.classList.add('fb-hide');   // the feedback-hub widgets hide while the replay runs (html.fb-hide, any device)
    if (stage && window.innerWidth >= 700) { var r = stage.getBoundingClientRect(); if (r.top < 0 || r.bottom > window.innerHeight) { try { stage.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) {} } }
    hudT = setInterval(function () { try { var p2 = api() && api().phase ? api().phase() : null; if (!p2 || !p2.replay) { stopPlay(); return; } hud(p2); } catch (e) { stopPlay(); } }, 200);
    playing = setTimeout(stopPlay, 900000);   // a safety net: the poll above ends the replay when it ends, a paused one may wait
  }

  // ---------------------------------------------------------------- the Armory (armory-design A): custom bombs with a word, bought with help credits
  var BICON = {
    sparkler: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
    thunderbolt: '<path d="M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6z" fill="currentColor" fill-opacity=".22"/>',
    inferno: '<path d="M12 21.5c-3.9 0-6.5-2.6-6.5-6.2 0-3.5 2.4-5.4 3.6-8.3.5 1.7 1.6 2.7 2.7 3.2.2-3.1 1.5-5.6 3.7-7.7.3 3.6 3.5 6 3.5 11.2 0 4.6-3 7.8-7 7.8z" fill="currentColor" fill-opacity=".22"/><path d="M12 21.5c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.5-2.7 2.3-4.4 1.5 1.4 3.3 2.6 3.3 4.4 0 1.6-1.1 2.8-2.8 2.8z"/>',
    nova: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6.4" stroke-opacity=".7"/><ellipse cx="12" cy="12" rx="10" ry="4.2" stroke-opacity=".45"/>'
  };
  var BNAME = { sparkler: 'Sparkler', thunderbolt: 'Thunderbolt', inferno: 'Inferno', nova: 'Nova' };
  function bIcon(k) { return '<i class="b-bi" data-k="' + esc(k) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (BICON[k] || '') + '</svg></i>'; }
  var cart = [], armSkew = 0, armT = 0, armBusy = false, armOk = '', armErr = '', armTzSent = false;
  // the target picker (frontier-design D): a button per bomb row, an inline list of battle cities, and a GitHub lookup that can add an unclaimed land
  var armShow = true; try { armShow = localStorage.getItem('caldera.armory.showName') !== '0'; } catch (e) {}
  /* Show my name (frontier-design K6): one switch for the order, only when a bomb aims at a member; the target gets a gift email */
  function armWho() {
    var hs = []; cart.forEach(function (r) { if (r.target && !isLand(r.target)) { var h = '@' + String(r.target).replace(/^@/, ''); if (hs.indexOf(h) < 0) hs.push(h); } });
    if (!hs.length) return '';
    var d = hs.length === 1 ? esc(hs[0]) + ' gets an email about this bomb.' : hs.length === 2 ? esc(hs[0]) + ' and ' + esc(hs[1]) + ' each get an email about their bomb.' : hs.length + ' members each get an email about their bomb.';
    return '<div class="b-arm-who"><button type="button" class="b-sw b-arm-sw" id="b-arm-sw" role="switch" aria-checked="' + armShow + '" aria-labelledby="b-arm-who-l" aria-describedby="b-arm-who-d"></button>'
      + '<p class="b-arm-who-d" id="b-arm-who-d"><b id="b-arm-who-l">Show my name.</b> ' + d + ' <span data-arm="say">' + armSay() + '</span></p></div>';
  }
  function armSay() { return armShow ? '' : 'It says the bomb is from "Someone".'; }
  var pick = -1, pq = '', pAct = 0, gl = null, glT = 0, glX = null, armAim = '', GHL = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  function isLand(h) { return !!(h && me && me.armory && (me.armory.lands || []).indexOf(h) >= 0); }
  function pOpts() {
    var A2 = me.armory, q = pq.toLowerCase(), by = function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; };
    var all = A2.targets.slice().sort(by).map(function (h) { return { h: h, t: 'member' }; }).concat((A2.lands || []).slice().sort(by).map(function (h) { return { h: h, t: 'unclaimed' }; }));
    if (!q) return [{ h: '', t: 'any city in the battle' }].concat(all);
    var a = [], b = []; all.forEach(function (o) { var s = o.h.replace(/^@/, '').toLowerCase(), i = s.indexOf(q); if (i === 0) a.push(o); else if (i > 0) b.push(o); });
    return a.concat(b);
  }
  function ghHtml() {
    if (!gl) return '';
    var L = '@' + gl.login, j = gl.j || {}, st = gl.st, T = '', D = '', M = '', B = '', k = 'bad';
    if (st === 'wait') { k = 'wait'; T = 'Checking GitHub for ' + esc(L); D = 'This takes a second.'; }
    else if (st === 'new' && j.left === 0) { k = 'limit'; T = 'You added 20 GitHubs today'; D = 'That is the daily limit. You can add more after midnight Pacific. You can still target any land on the map.'; }
    else if (st === 'new') { k = 'new'; T = esc(L) + ' <small>on GitHub</small>'; D = esc(j.name || gl.login) + ' &middot; ' + (j.repos || 0) + ' public repo' + (j.repos === 1 ? '' : 's');
      M = j.famous ? 'Not on Caldera yet. Adding puts an unclaimed land on the frontier, built from public GitHub data. Caldera does not contact them.' : 'Not on Caldera yet. Only well-known GitHubs and members\' friends go on the map. If ' + esc(L) + ' is your friend, add them: when they claim the land, you two become friends. Caldera does not contact them.';
      B = '<button type="button" class="b-gh-go" data-gh="add">' + (j.famous ? 'Add to the map and target' : 'Add as my friend and target') + '</button>'; }
    else if (st === 'land') { k = 'new'; T = esc(L) + ' <small>unclaimed land</small>'; D = 'Added by ' + esc(j.by || 'Caldera') + ' &middot; ' + (j.repos || 0) + ' public repo' + (j.repos === 1 ? '' : 's'); B = '<button type="button" class="b-gh-go" data-gh="aim">Target ' + esc(L) + '</button>'; }
    else if (st === 'limit') { k = 'limit'; T = 'You added 20 GitHubs today'; D = 'That is the daily limit. You can add more after midnight Pacific. You can still target any land on the map.'; }
    else if (st === 'missing') { T = 'No GitHub user named ' + esc(L); D = 'Check the spelling. Use the username from github.com/username.'; }
    else if (st === 'removed') { T = esc(L) + ' can\'t be added'; D = 'This person asked not to be on Caldera. Pick another target.'; }
    else if (st === 'nocode') { T = esc(L) + ' has no public code yet'; D = 'There is no city to draw, so it can\'t be a land.'; }
    else if (st === 'org') { T = esc(L) + ' is an organization'; D = 'Only a person\'s GitHub can be a land. Type a person\'s username.'; }
    else if (st === 'member') { T = esc('@' + (j.handle || gl.login)) + ' is on Caldera'; D = 'Their city is not in the next battle. Pick another target.'; }
    else if (st === 'busy') { k = 'limit'; T = 'Too many lookups'; D = 'Try again in an hour. You can still target any city in the list.'; }
    else { T = 'Could not reach GitHub'; D = 'Nothing was added.'; B = '<button type="button" class="b-gh-go ghost" data-gh="retry">Try again</button>'; }
    return '<div class="b-gh" data-st="' + k + '" role="' + (k === 'bad' || k === 'limit' ? 'alert' : 'status') + '"><span class="b-gh-av" aria-hidden="true">' + (k === 'wait' ? '<span class="b-spin"></span>' : esc(gl.login.charAt(0).toUpperCase())) + '</span>'
      + '<span class="b-gh-n">' + T + '</span><span class="b-gh-d">' + D + '</span>' + (M ? '<p class="b-gh-m">' + M + '</p>' : '') + B + '</div>';
  }
  function pList(n) {
    var o = pOpts(); if (pAct >= o.length) pAct = Math.max(0, o.length - 1);
    return (o.length ? '<p class="b-tp-h" id="b-tp-h-' + n + '">' + (pq ? 'Members' : 'In the next battle') + '</p><ul class="b-tp-l" id="b-tp-l-' + n + '" role="listbox" aria-labelledby="b-tp-h-' + n + '">'
      + o.map(function (x, i) { return '<li role="option" id="b-tp-o-' + n + '-' + i + '" data-h="' + esc(x.h) + '" aria-selected="' + (i === pAct) + '">' + (x.h ? avHtml(x.h) : '') + '<span>' + esc(x.h || 'Random') + '</span><small>' + esc(x.t) + '</small></li>'; }).join('') + '</ul>' : '') + ghHtml();
  }
  function pHtml(n) {
    return '<div class="b-tp"><div class="b-tp-in"><span aria-hidden="true">@</span><label class="sr" for="b-tp-q-' + n + '">Search a member or type a GitHub username</label>'
      + '<input id="b-tp-q-' + n + '" type="text" role="combobox" aria-expanded="true" aria-controls="b-tp-l-' + n + '" aria-autocomplete="list" aria-activedescendant="b-tp-o-' + n + '-' + pAct + '" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="39" placeholder="Member or GitHub username" value="' + esc(pq) + '"></div>'
      + '<div class="b-tp-r">' + pList(n) + '</div></div>';
  }
  function pClose(i) { pick = -1; pq = ''; gl = null; clearTimeout(glT); if (glX) { try { glX.abort(); } catch (e) {} glX = null; } armRender('#b-ar-t-' + (i + 1)); }
  function pSet(i, h) { if (cart[i]) cart[i].target = h; pClose(i); }
  function pLook(q) {
    if (glX) { try { glX.abort(); } catch (e) {} } glX = typeof AbortController === 'function' ? new AbortController() : null;
    gl = { st: 'wait', login: q }; pPaint();
    fetch('/v1/frontier/lookup?u=' + encodeURIComponent(q), { credentials: 'same-origin', signal: glX ? glX.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) { if (pq.toLowerCase() !== q.toLowerCase()) return; gl = { st: x.j.st || 'github', login: x.j.login || q, j: x.j }; pPaint(); })
      .catch(function (e) { if (e && e.name === 'AbortError') return; if (pq.toLowerCase() === q.toLowerCase()) { gl = { st: 'github', login: q }; pPaint(); } });
  }
  function pAdd(i) {
    var login = gl && gl.login; if (!login) return; var bt = panel.querySelector('[data-gh="add"]'); if (bt) { bt.disabled = true; bt.setAttribute('aria-busy', 'true'); }
    fetch('/v1/frontier/add', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: login, friend: !(gl && gl.j && gl.j.famous) }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        if (x.status === 200 && x.j.login) { var h = '@' + x.j.login; if (x.j.land && window.CALDERA_FRONTIER_ADD) try { window.CALDERA_FRONTIER_ADD(x.j.land.district, x.j.land.meta, false); } catch (e2) {} if (!isLand(h)) (me.armory.lands = me.armory.lands || []).push(h); armOk = h + ' is on the frontier. Caldera does not contact them.'; pSet(i, h); return; }
        gl = { st: x.status === 429 ? 'limit' : x.j.st || 'github', login: login, j: x.j }; pPaint();
      }).catch(function () { gl = { st: 'github', login: login }; pPaint(); });
  }
  function pPaint() {   // the list and the lookup card only: the input keeps its caret
    var d = armEl(), r = d && d.querySelector('.b-tp-r'), inp = d && d.querySelector('.b-tp-in input'); if (!r) return;
    r.innerHTML = pList(pick + 1); if (inp) inp.setAttribute('aria-activedescendant', 'b-tp-o-' + (pick + 1) + '-' + pAct); pWireList();
  }
  function pWireList() {
    var d = armEl(); if (!d || pick < 0) return; var i = pick;
    Array.prototype.slice.call(d.querySelectorAll('.b-tp-l li')).forEach(function (li) { li.onclick = function () { pSet(i, li.getAttribute('data-h')); }; });
    var g = d.querySelector('.b-gh-go'); if (g) g.onclick = function () { var a = g.getAttribute('data-gh'); if (a === 'add') pAdd(i); else if (a === 'aim') { var h = '@' + gl.login; if (!isLand(h)) (me.armory.lands = me.armory.lands || []).push(h); pSet(i, h); } else pLook(gl.login); };
  }
  function pWire() {
    var d = armEl(); if (!d || pick < 0) return; var i = pick, inp = d.querySelector('.b-tp-in input'); if (!inp) return;
    inp.oninput = function () {
      pq = inp.value.replace(/^@/, '').trim(); pAct = 0; gl = null; clearTimeout(glT); if (glX) { try { glX.abort(); } catch (e) {} glX = null; }
      var q = pq.toLowerCase(), known = pOpts().some(function (o) { return o.h.toLowerCase() === '@' + q; });
      if (pq && GHL.test(pq) && !known) glT = setTimeout(function () { pLook(pq); }, 400);
      pPaint();
    };
    inp.onkeydown = function (ev) {
      var o = pOpts();
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (!o.length) return; pAct = (pAct + (ev.key === 'ArrowDown' ? 1 : o.length - 1)) % o.length; pPaint(); var a = d.querySelector('#b-tp-o-' + (i + 1) + '-' + pAct); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' }); }
      else if (ev.key === 'Enter') { ev.preventDefault(); if (o.length) pSet(i, o[pAct].h); else if (gl && gl.st === 'new' && gl.j && gl.j.left !== 0) pAdd(i); else if (gl && gl.st === 'land') { var h = '@' + gl.login; if (!isLand(h)) (me.armory.lands = me.armory.lands || []).push(h); pSet(i, h); } }
      else if (ev.key === 'Escape') { ev.preventDefault(); pClose(i); }
    };
    pWireList();
  }
  // "Target in the Armory" on an unclaimed land's card (cityfrontier.ts): open the Armory and aim a bomb there
  window.CALDERA_ARMORY_TARGET = function (h) {
    if (!me || !me.armory) return false; if (h === null) return true;
    if (!isLand(h) && me.armory.targets.indexOf(h) < 0) (me.armory.lands = me.armory.lands || []).push(h);
    var r = cart.filter(function (x) { return !x.target; })[0];
    if (r) { r.target = h; armOk = 'Bomb ' + (cart.indexOf(r) + 1) + ' now aims at ' + h + '.'; armRender('#b-ar-t-' + (cart.indexOf(r) + 1)); }
    else { armAim = h; armOk = 'Pick a bomb. It aims at ' + h + '.'; armRender('.b-bc:not([disabled])'); }
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
    return true;
  };
  function armClock(t) { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return hhmm(t); } }
  function armSpan(ms) { if (ms < 60000) return 'under 1m'; var h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000); return h ? h + 'h ' + m + 'm' : m + 'm'; }
  function armCost(k) { var A2 = me && me.armory, t = A2 && A2.kinds.filter(function (x) { return x.k === k; })[0]; return t ? t.cost : 0; }
  function armTotal() { return cart.reduce(function (t, r) { return t + armCost(r.k); }, 0); }
  function armBuyLabel() {
    var A2 = me.armory, tot = armTotal();
    if (armBusy) return ['Buying...', false];
    if (!cart.length) return ['Pick a bomb', false];
    for (var i = 0; i < cart.length; i++) if (!cart[i].word) return ['Add a word to bomb ' + (i + 1), false];
    if (tot > A2.balance) return ['Need ' + (tot - A2.balance) + ' more credits', false];
    return ['Buy ' + cart.length + ' bomb' + (cart.length === 1 ? '' : 's') + ' for ' + tot + ' credits', true];
  }
  /** the order line left of the Buy button: Balance 315 / Order 17 credits · 298 left / Order 60 credits · 12 short */
  function armSum() {
    var A2 = me.armory, tot = armTotal(), left = A2.balance - tot;
    if (!cart.length) return 'Balance <b>' + A2.balance + '</b>';
    return 'Order <b>' + tot + '</b> credits · ' + (left < 0 ? '<b class="neg">' + (-left) + '</b> short' : '<b>' + left + '</b> left');
  }
  function armEl() { return panel ? panel.querySelector('.b-arm') : null; }
  function armLocked() { return !(leftMs() > 0); }
  /** the Armory column of the Tonight card (PAGE.md 5a): bomb cards, one row per bomb, Show my name, the order line and Buy */
  function armoryHtml(locked) {
    var A2 = me && me.armory; if (!A2) return '';
    return '<div class="b-arm" data-st="' + (locked ? 'locked' : 'open') + '">' + armBody(locked) + '</div>';
  }
  function armBody(locked) {
    var A2 = me.armory, tot = armTotal(), left = A2.balance - tot, room = A2.cap - A2.bought.length - cart.length;
    var spent = A2.bought.reduce(function (t, b) { return t + armCost(b.k); }, 0);
    var load = A2.bought.length ? '<div class="b-arm-load"><h3 class="b-hh">Loaded for tonight <small>' + A2.bought.length + ' bomb' + (A2.bought.length === 1 ? '' : 's') + ', ' + spent + ' credits</small></h3><ul>'
      + A2.bought.map(function (b) { return '<li data-k="' + esc(b.k) + '">' + bIcon(b.k) + '<b>' + esc(BNAME[b.k] || b.k) + '</b><q>' + esc(b.word) + '</q><span>' + (b.target ? 'at ' + who(b.target) : 'at a random rival') + '</span></li>'; }).join('') + '</ul></div>' : '';
    if (locked) return (load || '<h3 class="b-hh">Loaded for tonight</h3><p class="b-fine">No custom bombs tonight.</p>') + '<p class="b-fine">The Armory opens again after the battle.</p>';
    var cards = A2.kinds.map(function (t) {
      var n = cart.filter(function (r) { return r.k === t.k; }).length, need = t.cost - left, dis = room <= 0 || need > 0;
      return '<button type="button" class="b-bc' + (n ? ' in' : '') + '" data-k="' + esc(t.k) + '" aria-describedby="b-bc-' + esc(t.k) + '-d"' + (dis ? ' disabled' : '') + '>' + bIcon(t.k)
        + '<span class="b-bc-n">' + esc(t.name) + '</span><span class="b-bc-p">' + t.cost + ' credits</span><span class="b-bc-d" id="b-bc-' + esc(t.k) + '-d">' + esc(t.line) + '</span>'
        + '<span class="b-bc-add" aria-hidden="true">' + (room <= 0 ? A2.cap + ' a night reached' : need > 0 ? 'Need ' + need + ' more credits' : '+ Add') + '</span>'
        + '<span class="b-bc-c"' + (n ? '' : ' hidden') + '>' + n + '</span></button>';
    }).join('');
    var rows = cart.map(function (r, i) {
      var n = i + 1, tl = r.target || 'Random rival';
      return '<li class="b-ar' + (r.err ? ' bad' : '') + '" data-k="' + esc(r.k) + '" data-i="' + i + '">' + bIcon(r.k)
        + '<label class="b-ar-w"><span class="sr">Word for bomb ' + n + ', ' + esc(BNAME[r.k] || r.k) + '</span><input id="b-ar-w-' + n + '" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="' + A2.wordMax + '" placeholder="Your word" aria-describedby="b-ar-e-' + n + '" value="' + esc(r.word) + '"' + (r.err ? ' aria-invalid="true"' : '') + '><span class="b-ar-cnt" aria-hidden="true">' + Array.from(r.word).length + '/' + A2.wordMax + '</span></label>'
        + '<button type="button" class="b-ar-tb" id="b-ar-t-' + n + '" aria-haspopup="listbox" aria-expanded="' + (pick === i) + '" aria-label="Target for bomb ' + n + ': ' + esc(tl) + (isLand(r.target) ? ', unclaimed land' : '') + '">' + (r.target ? avHtml(r.target) : '') + '<span>' + esc(tl) + '</span>' + (isLand(r.target) ? '<i class="b-un">Unclaimed</i>' : '') + '</button>'
        + '<button type="button" class="b-ar-x" aria-label="Remove bomb ' + n + '">&times;</button><p class="b-ar-e" id="b-ar-e-' + n + '" role="alert"' + (r.err ? '' : ' hidden') + '>' + esc(r.err || '') + '</p>' + (pick === i ? pHtml(n) : '') + '</li>';
    }).join('');
    var bl = armBuyLabel();
    return '<h3 class="b-hh">Armory <small>Add a bomb with your word on it. Everyone sees the word in the replay.</small></h3>' + load
      + '<div class="b-arm-cards" role="group" aria-label="Add a bomb">' + cards + '</div><ol class="b-arm-rows" data-arm="rows" aria-label="Bombs to buy">' + rows + '</ol>' + armWho()
      + '<div class="b-arm-foot"><span class="b-arm-sum" data-arm="sum">' + armSum() + '</span><button type="button" class="b-arm-buy" data-arm="buy"' + (bl[1] ? '' : ' disabled') + (armBusy ? ' aria-busy="true"' : '') + '>' + esc(bl[0]) + '</button></div>'
      + (armErr ? '<p class="b-arm-err" role="alert">' + esc(armErr) + '</p>' : '')
      + (A2.balance < 5 && !cart.length ? '<p class="b-fine" data-arm="low">You have ' + A2.balance + ' credits. Each city that fires gets +10. Answer asks in the <a href="/gardens">gardens</a> to earn more.</p>' : '')
      + '<p class="b-fine" data-arm="note">Up to ' + A2.cap + ' bombs a night. Credits have no cash value.</p>'
      + '<p class="b-arm-ok" data-arm="ok" role="status"' + (armOk ? '' : ' hidden') + '>' + esc(armOk) + '</p>';
  }
  function armRender(focus) {
    var d = armEl(); if (!d || !me || !me.armory) return; var lk = armLocked();
    d.setAttribute('data-st', lk ? 'locked' : 'open'); d.innerHTML = armBody(lk); armWire();
    var cb = panel.querySelector('[data-arm="bal"]'); if (cb) cb.textContent = String(me.armory.balance);
    if (focus) { var f = d.querySelector(focus); if (f) f.focus(); }
  }
  function armFoot() {   // typing: update the Buy button without rebuilding the rows (keeps the caret)
    var d = armEl(); if (!d) return; var bl = armBuyLabel(), b = d.querySelector('[data-arm="buy"]'); if (!b) return;
    b.textContent = bl[0]; b.disabled = !bl[1];
    if (armOk) { armOk = ''; var ok = d.querySelector('[data-arm="ok"]'); if (ok) ok.hidden = true; }
  }
  function armWire() {
    var d = armEl(); if (!d) return;
    Array.prototype.slice.call(d.querySelectorAll('.b-bc')).forEach(function (b) { b.onclick = function () { if (b.disabled) return; cart.push({ k: b.getAttribute('data-k'), word: '', target: armAim, err: '' }); armAim = ''; armOk = ''; armErr = ''; pick = -1; armRender('#b-ar-w-' + cart.length); }; });
    Array.prototype.slice.call(d.querySelectorAll('.b-ar')).forEach(function (li) {
      var i = +li.getAttribute('data-i'), inp = li.querySelector('.b-ar-w input'), tb = li.querySelector('.b-ar-tb'), cnt = li.querySelector('.b-ar-cnt');
      inp.oninput = function () { var v = Array.from(inp.value).slice(0, me.armory.wordMax).join(''); if (v !== inp.value) inp.value = v; cart[i].word = v.toUpperCase(); cnt.textContent = Array.from(v).length + '/' + me.armory.wordMax;
        if (cart[i].err) { cart[i].err = ''; li.classList.remove('bad'); inp.removeAttribute('aria-invalid'); li.querySelector('.b-ar-e').hidden = true; } armFoot(); };
      tb.onclick = function () { if (pick === i) { pClose(i); return; } pick = i; pq = ''; gl = null; pAct = Math.max(0, pOpts().map(function (o) { return o.h; }).indexOf(cart[i].target || '')); armRender('#b-tp-q-' + (i + 1)); };
      li.querySelector('.b-ar-x').onclick = function () { pick = -1; cart.splice(i, 1); armRender(cart.length ? '#b-ar-w-' + Math.min(i + 1, cart.length) : '.b-bc:not([disabled])'); };
    });
    var buy = d.querySelector('[data-arm="buy"]'); if (buy) buy.onclick = armBuy;
    var sw = d.querySelector('#b-arm-sw'); if (sw) sw.onclick = function () { armShow = !armShow; sw.setAttribute('aria-checked', String(armShow)); try { localStorage.setItem('caldera.armory.showName', armShow ? '1' : '0'); } catch (e) {}
      var say = d.querySelector('[data-arm="say"]'); if (say) say.textContent = armSay(); };
    pWire();
  }
  function armBuy() {
    if (armBusy || !armBuyLabel()[1]) return;
    pick = -1; armBusy = true; armErr = ''; armRender();
    var key = Date.now().toString(36) + Math.random().toString(36).slice(2), n = cart.length;
    fetch('/v1/world/battle/armory', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: key, showName: armShow, bombs: cart.map(function (r) { return { k: r.k, word: r.word, target: r.target || null }; }) }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        armBusy = false;
        if (x.status === 200) { cart = []; me = x.j.me && x.j.me.h ? x.j.me : me; armOk = 'Loaded: ' + n + ' bomb' + (n === 1 ? '' : 's') + '. They fly at ' + armClock(me.armory.locksAt) + '. Watch them hit in the morning replay.'; armRender(); return; }
        if (x.status === 422 && x.j.rows) { x.j.rows.forEach(function (r) { if (cart[r.i]) cart[r.i].err = r.error || 'Write a word for this bomb.'; }); armErr = x.j.error; armRender('.b-ar.bad input'); return; }
        if (x.status === 402 && typeof x.j.balance === 'number') me.armory.balance = x.j.balance;
        armErr = x.j && x.j.error ? x.j.error : 'Could not buy right now. Nothing was charged. Try again.'; armRender();
      }).catch(function () { armBusy = false; armErr = 'Could not buy right now. Nothing was charged. Try again.'; armRender(); });
  }
  /** the Tonight title's countdown, every 15 s (role="timer", aria-live off). At the lock the card turns to "Battle running" and the
   *  member panel reloads a minute later (the next Armory window). */
  function armTick() {
    if (!panel || !meLoaded) return; var left = leftMs(), c = panel.querySelector('[data-arm="clock"]');
    if (left <= 0) { if (c || panel.querySelector('.b-arm[data-st="open"]')) { clearInterval(armT); armT = 0; render(); setTimeout(me ? mine : load, 60000); } return; }
    if (!c) return; c.textContent = armSpan(left); var last = left < 3600000;
    if (c.classList.contains('last') !== last) { c.classList.toggle('last', last); var s = panel.querySelector('[data-arm="sub"]'); if (s && me) s.textContent = openSub(left); }
  }
  function armClockGo() { clearInterval(armT); armT = setInterval(armTick, 15000); }
  function armStart() {
    if (!me || !me.armory) return;
    armWire();
    if (!armTzSent) { armTzSent = true; try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (z && z !== me.armory.tz) post('/v1/world/battle/tz', { tz: z }).catch(function () {}); } catch (e) {} }
  }
  // the report flag on a custom bomb's word in the replay (armory-design D1)
  function bombOf(s) { return s && s[8] && s[8].bk ? s[8] : null; }
  function bombTail(s) { var x = bombOf(s); return x ? ' · ' + (BNAME[x.bk] || x.bk) + ' "' + x.word + '" from ' + s[0] : ''; }
  function flagHtml(s) { return '<button type="button" data-p="flag" class="b-flag" aria-label="Report the word ' + esc(s[8].word) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5"/></svg>Report</button>'; }
  // ---------------------------------------------------------------- the Tonight card (PAGE.md 5a and 8): the member's own panel
  var panel = q('[data-b="me"]'), meLoaded = false;
  function mine() {
    return fetch('/v1/world/battle/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { me = m && m.h ? m : null; meLoaded = true; if (me && me.armory) armSkew = me.armory.now - Date.now(); render(); lastRender(); lists(); return me; })
      .catch(function () { meLoaded = true; render(); });
  }
  function tnHead(title, sub, right) { return '<div class="b-ch1"><div><p class="b-eb">Tonight</p><h2 class="b-big" id="b-tn-t">' + title + '</h2>' + (sub ? '<p class="b-sub" data-arm="sub">' + sub + '</p>' : '') + '</div>' + (right || '') + '</div>'; }
  function gearBtn() { return '<button type="button" class="b-gear" data-pop="set" aria-haspopup="dialog" aria-expanded="' + (popKind === 'set') + '" aria-label="Battle settings" title="Battle settings">' + ic('gear') + '</button>'; }
  function clockTitle(left) { return left > 0 ? 'Battle starts in <b data-arm="clock" role="timer" aria-live="off"' + (left < 3600000 ? ' class="last"' : '') + '>' + esc(armSpan(left)) + '</b>' : 'Battle running'; }
  function openSub(left) { return left < 3600000 ? 'Last hour. Your bombs lock at ' + armClock(lockAt()) + '.' : 'Your bombs lock then. Your city fires by itself.'; }
  /** the four firepower tiles, the work line and (while the Armory is open) the Targets row; m null: the loading state */
  function fireHtml(m, locked) {
    var tiles;
    if (!m) tiles = ['Firepower', 'Missiles', 'Aim', 'Shield'].map(function (l) { return [l, '–', ' ']; });
    else { var a = m.arsenal || { usd: 0, shots: 0, n: {}, tech: 0, why: {}, cep: 1, reach: 3 };
      tiles = [['Firepower', usd(a.usd || 0), 'to spend on missiles'], ['Missiles', String(a.shots || 0), missLine(a)], ['Aim', aimOf(a.cep), aimLine(a.cep)],
        ['Shield', Math.round((m.shield || 0) * 100) + '%', m.beginner ? 'beginner shield, first 30 days' : 'blocked from each hit', 'cy']]; }
    var aims = m ? m.aims || [] : [];
    return '<div class="b-fp"><h3 class="b-hh">Your firepower <small>from today\'s code</small></h3><div class="b-tiles">'
      + tiles.map(function (t) { return '<div class="b-tile"><span>' + t[0] + '</span><b' + (t[3] ? ' class="' + t[3] + '"' : '') + '>' + esc(t[1]) + '</b><i>' + esc(t[2]) + '</i></div>'; }).join('') + '</div>'
      + (m ? '<p class="b-from">' + esc(workLine(m.arsenal)) + '</p>' : '')
      + (m && !locked ? '<div class="b-trow"><span><b>Targets:</b> ' + (aims.length ? aims.map(function (h) { return who(h); }).join(', ') : 'auto, a fair rival') + '</span><button type="button" class="b-gb" data-pop="aim" aria-haspopup="dialog" aria-expanded="' + (popKind === 'aim') + '">' + ic('target') + 'Choose a target</button></div>' : '')
      + '</div>';
  }
  function render() {
    if (!panel) return; var left = leftMs();
    if (!meLoaded) { panel.setAttribute('aria-busy', 'true'); panel.innerHTML = tnHead(clockTitle(left), '') + '<div class="b-tnb">' + fireHtml(null) + '</div>'; return; }
    panel.removeAttribute('aria-busy');
    if (!me) {
      panel.innerHTML = tnHead(clockTitle(left), '') + '<p class="b-txt">Put your city in the fight. Your GitHub becomes a city, and today\'s code becomes missiles. Damage shows only on this map.</p>'
        + '<div class="b-cta-row"><a class="b-cta2" href="/#start">Add your city</a><a class="b-lnk" href="/signin?next=%2Fworld%3Fview%3Dbattle">Sign in</a></div>';
      armClockGo(); popClose(false); return; }
    if (!me.war) {
      panel.innerHTML = tnHead('Your city is out of the battles', 'No shots in or out. Rejoin and it fights by itself each night.', gearBtn()) + '<button type="button" class="b-cta2 b-join">Rejoin the battles</button>';
      panel.querySelector('.b-join').onclick = function () { act('/v1/world/battle/opt', { war: true }); };
      popRefresh(); return; }
    var A2 = me.armory, locked = !(left > 0);
    panel.innerHTML = tnHead(clockTitle(left), locked ? 'Bombs are locked. The replay is ready in the morning.' : openSub(left), '<div class="b-tools">' + (A2 ? '<span class="b-cred"><b data-arm="bal">' + A2.balance + '</b> credits</span>' : '') + gearBtn() + '</div>')
      + '<div class="b-tnb">' + fireHtml(me, locked) + armoryHtml(locked) + '</div>';
    armStart(); armClockGo(); popRefresh();
    if (location.hash === '#armory' && !render.did) { render.did = 1; try { panel.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    if (location.hash === '#reports' && !render.rep) { render.rep = 1; var g = panel.querySelector('[data-pop="set"]'); if (g) setTimeout(function () { popOpen('set', panel.querySelector('[data-pop="set"]')); }, 0); }
  }
  /** Choose a target (PAGE.md 5a): up to aimCap missiles at a rival in reach */
  function aimHtml() {
    if (!me || !me.war) return '';
    var a = me.arsenal || {}, aims = me.aims || [], cap = me.aimCap || 3, full = aims.length >= cap, R = me.rivals || [];
    return '<h4 id="b-pop-t">Choose a target</h4><p>Aim up to ' + cap + ' missiles at one rival. You can reach ' + (a.reach || 3) + ' rivals tonight.</p>'
      + (R.length ? '<label class="sr" for="b-aim-s">Rival to aim at</label><select id="b-aim-s" class="b-aimsel">' + R.map(function (r) { return '<option value="' + esc(r.h) + '">' + esc(r.h) + ' · shield ' + Math.round((r.sh || 0) * 100) + '%' + (r.beg ? ' · beginner' : '') + '</option>'; }).join('') + '</select>'
        + '<button type="button" class="b-pbuy b-doaim"' + (full ? ' disabled' : '') + '>' + (full ? cap + ' of ' + cap + ' aimed' : 'Aim a missile') + '</button>'
        : '<p>No rivals in reach yet. Your missiles find a fair match by themselves.</p>')
      + (aims.length ? '<ul class="b-aims">' + aims.map(function (h) { return '<li><b>Aimed:</b> ' + who(h) + ' <button type="button" class="b-unaim" data-h="' + esc(h) + '" aria-label="Stop aiming at ' + esc(h) + '">Remove</button></li>'; }).join('') + '</ul>' : '');
  }
  /** Battle settings (PAGE.md 5a): the report email, the beginner shield, Leave the battles */
  function setHtml() {
    if (!me) return '';
    var dome = Math.round(((rules() && rules().dome) || 0.99) * 100);
    return '<h4 id="b-pop-t">Battle settings</h4>' + reportHtml()
      + (me.war && (me.beginner || me.waive) ? '<hr><div class="b-prow"><span id="b-beg-l">Beginner shield<small>Blocks ' + dome + '% of each hit for your first 30 days.</small></span><button type="button" class="b-sw b-waive" role="switch" aria-checked="' + !me.waive + '" aria-labelledby="b-beg-l"></button></div>' : '')
      + (me.war ? '<hr><button type="button" class="b-dz b-leave">Leave the battles</button><p>Your city rebuilds at once. You can rejoin at any time.</p>' : '');
  }
  function reportHtml() {
    var f = me.report || 'off';
    return '<div class="b-rep" id="reports"><p class="b-pl" id="b-rep-l">Battle report email</p><div class="b-seg" role="group" aria-labelledby="b-rep-l">' + ['daily', 'weekly', 'off'].map(function (k) { return '<button type="button" data-rep="' + k + '" aria-pressed="' + (f === k) + '">' + k.charAt(0).toUpperCase() + k.slice(1) + '</button>'; }).join('') + '</div>'
      + (!me.email ? '<p class="b-pnote">Confirm an email in <a href="/settings">Settings</a> first.</p>' : !me.emailLive && f !== 'off' ? '<p class="b-pnote">Saved. Reports start soon.</p>' : '') + '</div>';
  }
  function act(path, body) {
    var msg = q('[data-b="msg"]'); if (msg) msg.textContent = ''; var pe = popEl && popEl.querySelector('.b-perr'); if (pe) pe.remove();
    post(path, body).then(function (m) { me = m && m.h ? m : me; render(); lastRender(); load(); })
      .catch(function (e) { var t = String(e && e.message || e); if (popEl) popEl.insertAdjacentHTML('beforeend', '<p class="b-perr" role="alert">' + esc(t) + '</p>'); else if (msg) msg.textContent = t; });
  }
  render(); setTab(tab);
  mine();
}
export const BATTLE_CLIENT_JS = "(function(BSPD,BPU){return (" + battleClient.toString() + ")();})((" + battleSpeedLib.toString() + ")(),(" + powerupLib.toString() + ")());";

export const BATTLE_CSS = `
.b-chip{position:absolute;left:10px;top:10px;z-index:6;display:inline-flex;align-items:center;gap:7px;font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(15,16,22,.92);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:6px 11px 6px 9px;font-variant-numeric:tabular-nums;pointer-events:none;max-width:calc(100% - 20px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* viewer power-ups v1 (map-audit DESIGN.md item 10, mockup 05): only during a replay; bottom right, beside the replay bar or above it */
.b-pu{position:absolute;right:12px;bottom:12px;z-index:7;pointer-events:none}
.b-pu.mhide{visibility:hidden}
.b-putray{display:flex;gap:8px;align-items:flex-end;pointer-events:auto}
.b-puslot{--c:#fff;position:relative;width:56px;height:56px;padding:0;border-radius:14px;display:grid;place-items:center;cursor:pointer;color:var(--c);background:rgba(9,11,17,.76);border:1px solid rgba(255,255,255,.14);-webkit-backdrop-filter:blur(10px) saturate(1.2);backdrop-filter:blur(10px) saturate(1.2);-webkit-appearance:none;appearance:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .15s,background-color .15s,box-shadow .15s}
.b-puslot svg{width:26px;height:26px;fill:none;stroke:currentColor;pointer-events:none}
.b-puslot:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
@media (hover:hover){.b-puslot.ready:hover,.b-puslot.cool:hover{border-color:rgba(255,255,255,.34)}}
.b-puslot .b-pukey{position:absolute;left:5px;top:4px;font:600 9px/1 var(--font-mono,'IBM Plex Mono',monospace);color:rgba(244,246,250,.44)}
.b-puslot .b-pucd{position:absolute;right:5px;top:4px;z-index:1;font:600 9px/1 var(--font-mono,'IBM Plex Mono',monospace);color:rgba(244,246,250,.68)}
.b-puslot .b-pupips{position:absolute;left:50%;bottom:5px;width:auto;height:auto;background:none;transform:translateX(-50%);display:flex;gap:2px}
.b-puslot .b-pupips i{width:8px;height:3px;border-radius:1.5px;background:rgba(255,255,255,.22)}.b-puslot .b-pupips i.f{background:var(--c)}
.b-puslot.armed{background:var(--c);border-color:#fff;color:#0B0D13;transform:translateY(-4px);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 40%,transparent),0 0 26px color-mix(in srgb,var(--c) 60%,transparent)}
.b-puslot.armed .b-pukey{color:rgba(0,0,0,.6)}.b-puslot.armed .b-pupips i{background:rgba(0,0,0,.25)}.b-puslot.armed .b-pupips i.f{background:#0B0D13}
.b-puslot.cool svg{opacity:.35}
.b-puslot.cool::after{content:"";position:absolute;inset:-1px;border-radius:14px;background:conic-gradient(rgba(255,255,255,0) var(--p,0%),rgba(9,11,17,.62) 0);pointer-events:none}
.b-puslot.empty{border-style:dashed;cursor:default}.b-puslot.empty svg{opacity:.22}
.b-puhint{position:absolute;right:0;bottom:calc(100% + 10px);height:28px;padding:0 10px;border-radius:8px;display:inline-flex;align-items:center;white-space:nowrap;font:500 12px/1 var(--font-sans,'IBM Plex Sans',sans-serif);color:#F4F6FA;background:rgba(9,11,17,.76);border:1px solid rgba(255,255,255,.14);-webkit-backdrop-filter:blur(10px) saturate(1.2);backdrop-filter:blur(10px) saturate(1.2)}
.b-puhint[hidden],.b-putoast[hidden],.b-puret[hidden]{display:none}
.b-putoast{--c:#4BE38A;position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:8;max-width:calc(100% - 20px);height:30px;padding:0 12px;border-radius:8px;display:inline-flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:500 12px/1 var(--font-sans,'IBM Plex Sans',sans-serif);color:#F4F6FA;background:rgba(9,11,17,.76);border:1px solid color-mix(in srgb,var(--c) 60%,transparent);-webkit-backdrop-filter:blur(10px) saturate(1.2);backdrop-filter:blur(10px) saturate(1.2);pointer-events:none;animation:b-putoast .2s ease-out}
.b-putoast b{color:var(--c);font-weight:700}
@keyframes b-putoast{from{opacity:0;transform:translate(-50%,-4px)}}
.b-puret{--c:#4BE38A;position:absolute;z-index:6;width:64px;height:32px;margin:-16px 0 0 -32px;border:2px dashed var(--c);border-radius:50%;box-shadow:0 0 18px color-mix(in srgb,var(--c) 60%,transparent);pointer-events:none}
.b-puret::after{content:"";position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:var(--c)}
html.pu-armed #stage canvas{cursor:none}
@media (max-width:899px){.b-puslot{width:48px;height:48px}.b-puslot svg{width:24px;height:24px}}
@media (max-width:600px){.b-pu{right:10px;bottom:94px}.b-putoast{top:56px}}
@media (prefers-reduced-motion:reduce){.b-puslot{transition:none}.b-putoast{animation:none}}
/* replay bar, Mike 11-21 (Fable design reports/2026-11-21-replay-bar/BAR.md) */
.b-play{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:7;display:flex;align-items:center;gap:8px;width:min(560px,calc(100% - 20px));min-height:44px;padding:4px 4px 4px 12px;border-radius:12px;background:rgba(15,16,22,.94);border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 30px -12px rgba(0,0,0,.8);font:500 12px/1.3 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;font-variant-numeric:tabular-nums;box-sizing:border-box}
.b-play [hidden]{display:none!important}
.b-play .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.b-play button{-webkit-appearance:none;appearance:none;margin:0;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.b-play button:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.b-play svg{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none;pointer-events:none}
.b-play svg.f{fill:currentColor;stroke-width:1.5}
.b-play svg.dots{stroke-width:3}
.b-play svg[viewBox="0 0 16 16"]{stroke-width:1.5}
/* text zone: line 1 = beat + label, line 2 = hit (+ Report pill) */
.b-play .b-pt{flex:1 1 0;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;row-gap:1px;align-items:center}
.b-play .b-l1{grid-column:1/-1;display:flex;gap:7px;align-items:baseline;min-width:0}
.b-play .b-l1 b{flex:none;color:#fff;font-weight:600;white-space:nowrap}
.b-play [data-p="label"]{min-width:0;color:#C9D2E6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.b-play [data-p="label"]:empty{display:none}
.b-play .b-hit{justify-self:start;min-width:0;max-width:100%;padding:8px 0;margin:-8px 0;border:0;background:none;font:500 11px/1.3 var(--font-mono,'IBM Plex Mono',monospace);color:#FFD9A0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:underline;text-decoration-color:rgba(255,217,160,.45);text-underline-offset:2px}
.b-play .b-hit.sh{color:#9FF6FF;text-decoration-color:rgba(61,242,255,.5)}
.b-play .b-flag{position:relative;display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:999px;background:transparent;border:1px solid rgba(255,154,154,.4);color:#FFB4B4;font:500 10.5px/1 var(--font-mono,'IBM Plex Mono',monospace)}
.b-play .b-flag::after{content:"";position:absolute;inset:-10px -4px}
.b-play .b-flag svg{width:11px;height:11px}
.b-play .b-flag:hover{background:rgba(255,154,154,.1)}
/* controls */
.b-play .b-pb{flex:none;display:flex;align-items:center;gap:2px}
.b-play .b-pb button{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;width:36px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:#E8EEF8;font:600 11px/1 var(--font-mono,'IBM Plex Mono',monospace);white-space:nowrap}
.b-play .b-pb svg{width:18px;height:18px}
@media (hover:hover){.b-play .b-pb button:hover{background:rgba(255,255,255,.1)}.b-play .b-pb [data-p="follow"]:hover{background:#7A5BEA}.b-play .b-pb [data-p="stop"]:hover{background:rgba(255,154,154,.16);color:#FFB4B4}.b-play .b-menu button:hover{background:rgba(255,255,255,.08)}}
.b-play .b-pb button:active{background:rgba(255,255,255,.16)}
.b-play .b-pb [data-p="pause"]{background:rgba(255,255,255,.1)}
.b-play .b-pb [data-p="pause"][aria-pressed="true"]{background:rgba(61,242,255,.18);color:#3DF2FF;box-shadow:inset 0 0 0 1px #3DF2FF}
.b-play .b-pb [data-p="skip"].t{width:auto;padding:0 9px 0 6px}
.b-play .b-pb [data-p="follow"]{width:auto;padding:0 11px 0 8px;margin-right:4px;border-radius:999px;background:#8B6CF6;color:#fff}
.b-play .b-pb [data-p="follow"] svg{width:16px;height:16px}
.b-play .b-pb [data-p="unfull"]{color:#3DF2FF}
.b-play .b-pb [data-p="stop"]{color:#C9D2E6}
.b-play .b-pb [data-p="more"][aria-expanded="true"]{background:rgba(255,255,255,.16)}
.b-play .b-pb [data-p="more"][data-sp]::after{content:attr(data-sp);position:absolute;top:-5px;right:-4px;padding:2px 3px;border-radius:5px;background:#3DF2FF;color:#0F1016;font:600 9px/1 var(--font-mono,'IBM Plex Mono',monospace)}
.b-play .b-sep{flex:none;width:1px;height:20px;margin:0 4px;background:rgba(255,255,255,.16)}
/* overflow menu, opens upward from the right end of the bar */
.b-play .b-menu{position:absolute;right:0;bottom:calc(100% + 6px);width:208px;display:grid;gap:1px;padding:4px;border-radius:12px;background:rgba(15,16,22,.97);border:1px solid rgba(255,255,255,.18);box-shadow:0 14px 34px -12px rgba(0,0,0,.85);animation:b-menu .12s ease-out}
@keyframes b-menu{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion:reduce){.b-play .b-menu{animation:none}}
.b-play .b-menu button{display:flex;align-items:center;gap:9px;width:100%;height:36px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:#E8EEF8;font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);text-align:left;white-space:nowrap}
.b-play .b-menu button:focus-visible{outline-offset:-2px}
.b-play .b-menu svg{width:16px;height:16px;color:#C9D2E6}
.b-play .b-menu span{flex:1 1 auto;min-width:0}
.b-play .b-menu em{font-style:normal;font-weight:600;color:#3DF2FF}
.b-play .b-menu [aria-checked="false"] em{color:#9A9AA5}
.b-play .b-menu kbd{min-width:9px;padding:2px 4px;border:1px solid rgba(255,255,255,.16);border-radius:4px;font:500 10px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#8B8E9C;text-align:center}
/* Report confirm row: the bar stacks while the question is open */
.b-play:has(.b-flagq){flex-direction:column;align-items:stretch;gap:6px;padding:8px 4px 4px}
.b-play:has(.b-flagq) .b-pt{flex:none;padding:0 6px}
.b-play:has(.b-flagq) .b-pb{justify-content:flex-end}
.b-play:has(.b-flagq) .b-hit{display:none}
.b-play .b-flagq{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:3px;color:#F2F2F5;font:500 12px/1.35 var(--font-sans,'IBM Plex Sans',sans-serif)}
.b-play .b-flagq span{flex:1 1 200px;min-width:0}
.b-play .b-flagq button{flex:none;height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#E8EEF8;font:600 12px/1 var(--font-mono,'IBM Plex Mono',monospace)}
.b-play .b-flagq [data-p="flagyes"]{background:#8B6CF6;border-color:#8B6CF6;color:#fff}
@media (max-width:600px){.b-play{left:10px;right:10px;bottom:10px;transform:none;width:auto;flex-direction:column;align-items:stretch;gap:5px;padding:6px 5px 5px}.b-play .b-pt{flex:none;padding:0 5px}.b-play .b-hit{padding:13px 0;margin:-13px 0}.b-play .b-pb{gap:3px}.b-play .b-pb button{width:40px;height:40px}.b-play .b-pb [data-p="prev"],.b-play .b-pb [data-p="skip"]{flex:1 1 40px;width:auto;background:rgba(255,255,255,.06)}.b-play .b-pb [data-p="pause"]{flex:1 1 40px;width:auto}.b-play .b-pb [data-p="follow"]{width:auto;margin-right:2px}.b-play .b-sep{margin:0 2px}.b-play .b-menu{width:220px}.b-play .b-menu button{height:44px;padding:0 10px}.b-play .b-menu kbd{display:none}.b-play:has(.b-flagq){padding:8px 5px 5px}.b-play .b-flagq span{flex-basis:100%}.b-play .b-flagq button{flex:1 1 0;height:40px}}
.b-chip i{width:7px;height:7px;border-radius:50%;background:#FFB347;box-shadow:0 0 8px #FFB347;flex:none}.b-chip.rebuild i{background:#4FD1C5;box-shadow:0 0 8px #4FD1C5}.b-chip b{font-weight:600;color:#fff}.b-chip span{color:#C9D2E6}
@media (prefers-reduced-motion: reduce){.b-chip i{box-shadow:none}}
.b-szs{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}.b-sz{display:inline-flex;align-items:center;gap:4px;font:600 11.5px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#9A9AA5;border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:3px 6px 3px 3px;font-variant-numeric:tabular-nums}
.b-sz i{font-style:normal;font-size:10px;min-width:18px;text-align:center;padding:2px 3px;border-radius:4px;background:rgba(255,255,255,.08);color:#C9D2E6}.b-sz.has{color:#fff;border-color:rgba(255,179,71,.55)}.b-sz.has i{background:#FFB347;color:#1A1206}.b-sz.lock{opacity:.45;border-style:dashed}
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
@media (max-width:700px){.b-how{left:0;right:0;top:auto;bottom:0;width:auto;max-height:72vh;border-radius:16px 16px 0 0;border-width:1px 0 0;padding-bottom:env(safe-area-inset-bottom,0px)}}
html.w-replay #drRail,html.w-replay .cal-nb{display:none!important}
html.w-board .c-tools{display:none!important}   /* the map buttons sat on the leaderboard's top edge on phones (11-21) */
html.w-board .b-play,html.w-board .b-pu,html.w-board .b-puret,html.w-board .b-putoast{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s,visibility 0s .15s}   /* LEADERBOARD.md: the results board (plugin citycard.ts) covers the stage; the replay bar and the power-up tray fade out in 150 ms */
@media (prefers-reduced-motion:reduce){html.w-board .b-play,html.w-board .b-pu{transition:none}}
html.w-replay .b-chip{display:none}   /* the replay bar says the same (strike, cities, last hit) and the chip would sit on the Labels chip at the top left */
.w-main .c-stage.c-full{height:100%;min-height:0}
.w-battle-only{display:none}html.w-battle .w-battle-only{display:revert}html.w-battle .w-now-only,html.w-battle .w-grow-only{display:none}
@media (max-width:600px){.b-chip{top:auto;bottom:10px}.c-stage.c-full .b-play{bottom:calc(10px + env(safe-area-inset-bottom,0px))}.c-stage.c-full .b-chip{bottom:calc(10px + env(safe-area-inset-bottom,0px))}}
.b-un{flex:none;font:600 10px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.06em;text-transform:uppercase;padding:3px 5px;border-radius:4px;border:1px dashed rgba(201,210,230,.55);color:#C9D2E6}
.b-tp{grid-area:p;display:grid;gap:8px;margin:2px 0 4px;padding:8px;border-radius:10px;border:1px solid rgba(61,242,255,.28);background:#12141D;min-width:0}
.b-tp-in{position:relative}
.b-tp-in>span{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#9A9AA5;font:600 13px/1 var(--font-mono,'IBM Plex Mono',monospace);pointer-events:none}
.b-tp-in input{box-sizing:border-box;width:100%;min-height:36px;padding:0 10px 0 25px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:#161822;color:#E8EEF8;font:500 13px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:0;text-transform:none}
.b-tp-in input::placeholder{color:#8B8E9C;font-family:var(--font-sans,'IBM Plex Sans',sans-serif)}
.b-tp-in input:focus-visible{outline:2px solid #3DF2FF;outline-offset:1px}
.b-tp-h{margin:0;padding:2px 8px 0;font:500 10.5px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.08em;text-transform:uppercase;color:#9A9AA5}
.b-tp-l{list-style:none;margin:0;padding:0;max-height:180px;overflow:auto;display:grid}
.b-tp-l li{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 8px;border-radius:8px;cursor:pointer;font:13px/1.2 var(--font-sans,'IBM Plex Sans',sans-serif);color:#E8EEF8;min-width:0}
.b-tp-l li>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b-tp-l li small{margin-left:auto;flex:none;color:#9A9AA5;font:500 11px/1 var(--font-mono,'IBM Plex Mono',monospace)}
.b-tp-l li:hover{background:rgba(255,255,255,.06)}.b-tp-l li[aria-selected="true"]{background:rgba(61,242,255,.14);box-shadow:inset 0 0 0 1px rgba(61,242,255,.5)}
.b-gh{display:grid;grid-template-columns:36px minmax(0,1fr);gap:2px 10px;align-items:center;padding:8px;border-radius:8px;border:1px dashed rgba(201,210,230,.4);background:rgba(255,255,255,.03);font:12px/1.4 var(--font-sans,'IBM Plex Sans',sans-serif);color:#C9D2E6}
.b-gh[data-st="bad"]{border:1px solid rgba(255,154,154,.55);background:rgba(255,154,154,.06)}
.b-gh[data-st="limit"]{border:1px solid rgba(255,179,71,.55);background:rgba(255,179,71,.07)}
.b-gh[data-st="wait"]{border-style:solid;border-color:rgba(255,255,255,.14)}
.b-gh-av{grid-row:span 2;width:36px;height:36px;border-radius:8px;background:#23263A;display:grid;place-items:center;color:#C9D2E6;font:600 15px/1 var(--font-mono,'IBM Plex Mono',monospace);overflow:hidden}
.b-gh-av img{width:100%;height:100%;object-fit:cover;filter:grayscale(1)}
.b-gh-n{font:600 13px/1.25 var(--font-sans,'IBM Plex Sans',sans-serif);color:#fff;min-width:0;overflow-wrap:anywhere}
.b-gh-n small{font:500 11px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#9A9AA5;margin-left:6px}
.b-gh-d{min-width:0}
.b-gh-m{grid-column:1/-1;margin:4px 0 0}
.b-board li .b-gh-go,.b-gh-go{grid-column:1/-1;justify-self:start;margin-top:6px;font:600 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif);background:#8B6CF6;color:#fff;border:0;border-radius:999px;padding:0 14px;min-height:36px;cursor:pointer}
.b-board li .b-gh-go:hover,.b-gh-go:hover{background:#7A5BEA}.b-gh-go:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.b-board li .b-gh-go.ghost,.b-gh-go.ghost{background:transparent;border:1px solid rgba(255,255,255,.25);color:#E8EEF8}
.b-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.2);border-top-color:#3DF2FF;border-radius:50%;animation:b-spin .8s linear infinite}
@keyframes b-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.b-spin{animation:none;border-top-color:rgba(255,255,255,.2);border-right-color:#3DF2FF}.b-ar-tb::after{transition:none}}
@media (max-width:600px){.b-ar-tb,.b-tp-in input,.b-gh-go{min-height:44px}.b-tp-in input{font-size:16px}.b-tp-l li{min-height:44px}}
.b-tp-r{display:contents}
@media (min-width:601px){.b-chip{top:48px;max-width:min(360px,calc(100% - 20px));font-size:11px;padding:5px 10px 5px 8px}
html.w-battle:not(.w-replay) .c-stage:has(.b-chip) .g-today{top:80px;max-height:calc(100% - 90px);overflow-y:auto}}
.b-arm{min-width:0}
/* ---- the deck under the map (map-audit PAGE.md 5, Mike 11-20). L >= 900 px, M (Duo) 700 to 899 px, dense on purpose; S < 700 px. */
.b-deck{--ink:#F4F6FA;--ink2:rgba(244,246,250,.68);--ink3:rgba(244,246,250,.44);--line:rgba(255,255,255,.14);--rule:rgba(255,255,255,.09);--cy:#3DF2FF;--you:#8B6CF6;--gd:#FFC83D;--gap:12px;--disp:'Barlow Condensed','Arial Narrow',Arial,sans-serif;--ui:var(--font-sans,'IBM Plex Sans',sans-serif);--mono:var(--font-mono,'IBM Plex Mono',monospace);position:relative;margin-top:var(--gap);color:var(--ink);font:13px/1.45 var(--ui);min-width:0}
.b-deck[hidden]{display:none}
.b-deck .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.b-deck button:focus-visible,.b-deck a:focus-visible,.b-deck input:focus-visible,.b-deck select:focus-visible{outline:2px solid var(--cy);outline-offset:2px}
.b-grid{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:var(--gap);align-items:start}
.b-card{background:#14171E;border:1px solid var(--rule);border-radius:14px;padding:16px;min-width:0}
.b-tn{border-color:rgba(139,108,246,.38)}.b-tn[aria-busy="true"]{min-height:250px}.b-tn[aria-busy="true"] .b-tile b{color:var(--ink3)}
.b-eb{margin:0;font:700 13px/1 var(--disp);letter-spacing:.16em;text-transform:uppercase;color:var(--cy)}
.b-big{font:700 34px/1 var(--disp);letter-spacing:.01em;text-transform:uppercase;margin:8px 0 0;color:var(--ink);text-wrap:balance}
.b-big b{font-weight:700;font-variant-numeric:tabular-nums}.b-big b.last{color:var(--cy)}.b-big.b-none{font-size:24px}
.b-sub{margin:6px 0 0;color:var(--ink2);font-size:12.5px}
.b-ch1{display:flex;align-items:flex-start;gap:10px}.b-ch1>div:first-child{flex:1;min-width:0}
.b-tools{display:flex;align-items:center;gap:8px;flex:none}
.b-cred{height:32px;box-sizing:border-box;border-radius:10px;padding:0 10px;border:1px solid var(--line);display:inline-flex;align-items:center;gap:6px;font:500 12px var(--mono);color:var(--ink2);white-space:nowrap}.b-cred b{color:var(--ink);font-weight:600}
.b-gear{position:relative;width:32px;height:32px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);display:grid;place-items:center;padding:0;flex:none;cursor:pointer}
.b-gear svg{width:17px;height:17px}.b-gear::before{content:"";position:absolute;inset:-7px}
.b-gear[aria-expanded="true"]{background:var(--ink);color:#0B0D13;border-color:var(--ink)}
.b-tnb{display:grid;grid-template-columns:288px minmax(0,1fr);gap:20px;margin-top:16px}
.b-hh{font:600 13px/1.2 var(--ui);margin:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;color:var(--ink)}.b-hh small{font:400 12px var(--ui);color:var(--ink2)}
.b-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.b-tile{background:rgba(255,255,255,.045);border-radius:10px;padding:9px 11px;min-width:0}
.b-tile span{display:block;font-size:11.5px;color:var(--ink2)}
.b-tile b{display:block;font:700 26px/1.05 var(--disp);letter-spacing:.01em;margin-top:2px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.b-tile b.cy{color:var(--cy)}
.b-tile i{display:block;font-style:normal;font-size:11.5px;line-height:1.35;color:var(--ink3);margin-top:2px}
.b-from{font-size:11.5px;color:var(--ink3);margin:8px 0 0}
.b-trow{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px;color:var(--ink2);flex-wrap:wrap}.b-trow b{color:var(--ink);font-weight:600}.b-trow>span{flex:1;min-width:0;overflow-wrap:anywhere}
.b-gb{position:relative;box-sizing:border-box;height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font:600 12.5px var(--ui);display:inline-flex;align-items:center;gap:7px;white-space:nowrap;cursor:pointer;text-decoration:none}
.b-gb::before{content:"";position:absolute;inset:-7px 0}.b-gb svg{width:16px;height:16px;flex:none}.b-gb small{font:500 11px var(--mono);color:var(--ink3)}
.b-gb:hover,.b-gear:hover{border-color:rgba(255,255,255,.34)}.b-gb[aria-pressed="true"],.b-gb[aria-expanded="true"]{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.4)}
.b-txt{color:var(--ink2);margin:10px 0 0;max-width:62ch;font-size:13.5px}
.b-cta-row{display:flex;align-items:center;gap:6px 18px;flex-wrap:wrap;margin-top:14px}
.b-cta2{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:44px;padding:0 22px;border-radius:22px;border:0;background:var(--you);color:#fff;font:600 14px var(--ui);text-decoration:none;cursor:pointer;white-space:nowrap}
.b-tn>.b-cta2{margin-top:14px}.b-cta2:hover{background:#7A5BEA}
.b-lnk{display:inline-flex;align-items:center;min-height:44px;color:var(--ink);text-decoration:underline;text-underline-offset:3px;font-weight:500}
.b-msg{margin:6px 0 0;color:#FF8C8C;font-size:12px}.b-msg:empty{display:none}
.b-cap{margin:6px 0 0;font-size:12px;color:var(--ink2)}.b-cap:empty{display:none}
/* the Armory column */
.b-arm-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px}
.b-bi{display:inline-grid;place-items:center;width:22px;height:22px;flex:none;color:var(--c,#C9D2E6)}.b-bi svg{width:100%;height:100%}
[data-k="sparkler"]{--c:#FFC83D}[data-k="thunderbolt"]{--c:#58B4FF}[data-k="inferno"]{--c:#FF6A3D}[data-k="nova"]{--c:#B9A6FF}
.b-bc{position:relative;display:grid;grid-template-columns:22px minmax(0,1fr);gap:2px 8px;align-content:start;text-align:left;padding:10px 11px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--ink);cursor:pointer;font:12px/1.35 var(--ui);transition:border-color .15s,background-color .15s}
.b-bc .b-bi{grid-row:span 2;align-self:start}
.b-bc-n{font:600 13px/1.2 var(--ui);color:var(--ink);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b-bc-p{font:500 11.5px/1.2 var(--mono);color:var(--ink2);font-variant-numeric:tabular-nums}
.b-bc-d{grid-column:1/-1;margin-top:4px;font-size:11.5px;line-height:1.35;color:var(--ink3)}
.b-bc-add{grid-column:1/-1;margin-top:4px;font:600 12px/1.2 var(--ui);color:#B9A6FF}
.b-bc-c{position:absolute;right:-7px;top:-7px;width:20px;height:20px;border-radius:50%;background:var(--you);color:#fff;font:600 11px/20px var(--mono);text-align:center}.b-bc-c[hidden]{display:none}
.b-bc:hover{border-color:rgba(139,108,246,.7)}.b-bc.in{border-color:var(--you);background:rgba(139,108,246,.1)}
.b-bc[disabled]{cursor:default;opacity:.45}.b-bc[disabled]:hover{border-color:var(--line)}
.b-arm-rows{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}.b-arm-rows:empty{display:none}
.b-ar{display:grid;grid-template-columns:18px minmax(0,1fr) minmax(0,max-content) 32px;grid-template-areas:"i w t x" ". e e e" "p p p p";align-items:center;gap:4px 8px;min-width:0}
.b-ar .b-bi{grid-area:i;width:18px;height:18px}
.b-ar-w{grid-area:w;position:relative;min-width:0}
.b-ar input{box-sizing:border-box;width:100%;height:36px;border-radius:10px;border:1px solid var(--line);background:#0B0D13;color:var(--ink);font:600 13px/1 var(--mono);padding:0 46px 0 10px;letter-spacing:.06em;text-transform:uppercase}
.b-ar input::placeholder{color:var(--ink3);text-transform:none;letter-spacing:0;font-weight:500}
.b-ar-cnt{position:absolute;right:10px;top:50%;transform:translateY(-50%);font:500 10.5px/1 var(--mono);color:var(--ink3);pointer-events:none;font-variant-numeric:tabular-nums}
.b-ar-tb{grid-area:t;display:flex;align-items:center;gap:6px;box-sizing:border-box;max-width:190px;min-width:0;height:36px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);font:600 12.5px var(--ui);cursor:pointer;text-align:left}
.b-ar-tb>span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b-ar-tb::after{content:"";flex:none;width:6px;height:6px;border-right:1.5px solid var(--ink3);border-bottom:1.5px solid var(--ink3);transform:rotate(45deg) translateY(-2px);transition:transform .18s}
.b-ar-tb[aria-expanded="true"]{border-color:var(--cy)}.b-ar-tb[aria-expanded="true"]::after{transform:rotate(-135deg) translateY(-2px)}
.b-ar-x{grid-area:x;position:relative;width:32px;height:36px;border:0;border-radius:8px;background:transparent;color:var(--ink2);font-size:18px;padding:0;cursor:pointer}.b-ar-x::before{content:"";position:absolute;inset:-4px -6px}.b-ar-x:hover{color:var(--ink);background:rgba(255,255,255,.06)}
.b-ar-e{grid-area:e;margin:0;font-size:12px;line-height:1.4;color:#FF8C8C}.b-ar-e[hidden]{display:none}
.b-ar.bad input{border-color:#FF8C8C}
.b-arm-who{display:flex;align-items:center;gap:10px;margin-top:10px}
.b-arm-who-d{margin:0;font-size:12px;line-height:1.4;color:var(--ink2)}.b-arm-who-d b{color:var(--ink);font-weight:600}
.b-sw{position:relative;width:30px;height:18px;border-radius:9px;border:0;padding:0;background:rgba(255,255,255,.16);flex:none;cursor:pointer;transition:background-color .15s}
.b-sw::before{content:"";position:absolute;inset:-13px -7px}
.b-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s,background-color .15s}
.b-sw[aria-checked="true"],.b-sw[aria-pressed="true"]{background:var(--cy)}.b-sw[aria-checked="true"]::after,.b-sw[aria-pressed="true"]::after{left:14px;background:#0B0D13}
.b-arm-foot{display:flex;align-items:center;gap:12px;margin-top:12px}
.b-arm-sum{flex:1;min-width:0;font:500 12px var(--mono);color:var(--ink2);font-variant-numeric:tabular-nums}.b-arm-sum b{color:var(--ink);font-weight:600}.b-arm-sum b.neg{color:#FF8C8C}
.b-arm-buy{height:44px;padding:0 22px;border-radius:22px;border:0;background:var(--you);color:#fff;font:600 14px var(--ui);white-space:nowrap;cursor:pointer;transition:background-color .15s}
.b-arm-buy:hover{background:#7A5BEA}.b-arm-buy[disabled]{background:rgba(139,108,246,.28);color:rgba(255,255,255,.6);cursor:default}.b-arm-buy[aria-busy="true"]{cursor:progress}
.b-fine{font-size:11.5px;color:var(--ink3);margin:8px 0 0}.b-fine a{color:var(--ink)}
.b-arm-err{margin:8px 0 0;font-size:12px;color:#FF8C8C}
.b-arm-ok{margin:8px 0 0;font-size:12.5px;color:var(--cy)}.b-arm-ok[hidden]{display:none}
.b-arm-load{margin:0 0 10px}.b-arm .b-hh+.b-arm-load{margin-top:10px}
.b-arm-load ul{list-style:none;margin:8px 0 0;padding:0;display:grid}
.b-arm-load li{display:flex;align-items:center;gap:8px;min-height:30px;font-size:12.5px;color:var(--ink2);border-top:1px solid var(--rule);min-width:0}.b-arm-load li:first-child{border-top:0}
.b-arm-load .b-bi{width:16px;height:16px}.b-arm-load li b{color:var(--ink);font-weight:600}
.b-arm-load q{quotes:none;font:600 12px var(--mono);letter-spacing:.05em;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.b-arm-load li span{margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
/* the Last night card */
.b-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
.b-nums b{display:block;font:700 30px/1 var(--disp);color:var(--ink);font-variant-numeric:tabular-nums}.b-nums span{display:block;font-size:11.5px;color:var(--ink2);margin-top:3px}.b-nums .g b{color:var(--gd)}
.b-ych{font:600 12px var(--ui);margin:14px 0 0;color:var(--ink);display:flex;align-items:center;gap:7px}.b-ych i{width:8px;height:8px;border-radius:2px;background:var(--you)}
.b-yc{margin:6px 0 0;display:grid;grid-template-columns:auto minmax(0,1fr);font-size:12.5px}
.b-yc dt,.b-yc dd{margin:0;padding:6px 0;border-top:1px solid var(--rule)}.b-yc dt{color:var(--ink2);padding-right:14px}.b-yc dd{text-align:right;color:var(--ink);font-weight:500;overflow-wrap:anywhere}
.b-yc .cy{color:var(--cy)}.b-yc .gd{color:var(--gd)}.b-yc .gr{color:#4BE38A}
.b-lbtn{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center}
.b-allshots{margin-left:auto;display:inline-flex;align-items:center;min-height:32px;font-size:12.5px;color:var(--ink);text-decoration:underline;text-underline-offset:3px;font-weight:500}
/* the tabs */
.b-tabs{margin-top:var(--gap);background:#14171E;border:1px solid var(--rule);border-radius:14px;overflow:hidden}
.b-tabrow{display:flex;gap:2px;border-bottom:1px solid var(--rule);padding:0 8px;overflow-x:auto}
.b-tabrow button{height:42px;padding:0 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--ink2);font:600 13px var(--ui);display:inline-flex;align-items:center;gap:7px;white-space:nowrap;cursor:pointer}
.b-tabrow button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--cy)}
.b-tabrow small{font:500 11px var(--mono);color:var(--ink3);background:rgba(255,255,255,.07);border-radius:6px;padding:1px 6px}
.b-ts{display:none}
.b-panel{padding:0 16px 10px}.b-panel[hidden]{display:none}
.b-tabhint{font-size:12px;color:var(--ink3);margin:0;padding:10px 0 4px}
.b-sl,.b-rk,.b-al{list-style:none;margin:0;padding:0}
.b-sl li,.b-rk li,.b-al li{border-top:1px solid var(--rule)}.b-sl li:first-child,.b-rk li:first-child,.b-al li:first-child{border-top:0}
.b-sr{position:relative;display:grid;grid-template-columns:52px minmax(0,1fr) 34px 110px 18px;align-items:center;gap:10px;width:100%;min-height:38px;padding:0;border:0;background:none;color:var(--ink);font:13px/1.3 var(--ui);text-align:left;cursor:pointer}
.b-sr:hover,.b-rk li:hover,.b-al li:hover{background:rgba(255,255,255,.03)}
.b-sl time{font:500 11.5px var(--mono);color:var(--ink3);font-variant-numeric:tabular-nums}
.b-p{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.b-p .a{box-shadow:inset 0 -2px 0 #FF6A3D}.b-p .d{box-shadow:inset 0 -2px 0 #58B4FF}.b-p q{quotes:none;font:600 11px var(--mono);color:#B9A6FF;margin-left:8px}
.b-szc{font:600 10.5px var(--mono);border:1px solid var(--line);border-radius:6px;text-align:center;padding:1px 0;color:var(--ink2)}
.b-r{font:600 12.5px var(--mono);text-align:right;color:var(--gd);white-space:nowrap;font-variant-numeric:tabular-nums}.b-r.h{color:var(--cy)}
.b-cv{color:var(--ink3);font-size:15px;text-align:center;transition:transform .15s}.b-sl li.open .b-cv{transform:rotate(90deg)}
.b-shot{padding:2px 0 10px 62px;font-size:12.5px;color:var(--ink2)}.b-shot p{margin:0 0 6px}.b-shot b{color:var(--ink)}
.b-rk li,.b-al li{display:flex;align-items:center;gap:10px;min-height:38px;font-size:13px;min-width:0}
.b-rn{width:22px;flex:none;font:500 11.5px var(--mono);color:var(--ink3)}
.b-rk li,.b-al li{position:relative}
.b-rk .n,.b-al .n{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b-hit0{position:absolute;inset:0;z-index:0;width:auto;height:auto;margin:0;padding:0;border:0;border-radius:6px;background:none;cursor:pointer}
.b-hit0:focus-visible{outline:2px solid var(--cy);outline-offset:-2px}
:where(.b-sr,.b-rk li,.b-al li)>:where(:not(.b-hit0)){position:relative;z-index:1;pointer-events:none}
.b-who{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;vertical-align:middle;color:inherit;text-decoration:none;border-radius:4px}
.b-who>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.b-who:hover>span,.b-who:focus-visible>span{text-decoration:underline;text-underline-offset:3px}
.b-who:focus-visible{outline:2px solid var(--cy);outline-offset:2px}
.b-av{flex:none;width:20px;height:20px;border-radius:50%;object-fit:cover;background:#262B36;display:inline-flex;align-items:center;justify-content:center;font:600 10px/1 var(--ui);font-style:normal;color:var(--ink);vertical-align:middle;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
.b-p .b-who{max-width:46%}
.b-yc dd .b-who,.b-trow .b-who,.b-aims .b-who,.b-arm-load li span .b-who{margin:1px 0}
.b-ar-tb .b-av,.b-tp-l .b-av{width:18px;height:18px}
.b-rk b,.b-al b{margin-left:auto;font:600 12.5px var(--mono);color:var(--ink);white-space:nowrap;font-variant-numeric:tabular-nums}
.b-yq{width:8px;height:8px;border-radius:2px;background:var(--you);flex:none}.b-rk small{font-size:11.5px;color:var(--ink2);white-space:nowrap}
.b-al span{font-size:12px;color:var(--ink2);white-space:nowrap}
.b-empty{margin:0;padding:6px 0 4px;font-size:12.5px;color:var(--ink2)}
.b-more{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;color:var(--ink);font:500 12.5px var(--ui);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
/* popovers: Layers, Choose a target, Battle settings */
.b-pop{position:absolute;z-index:40;box-sizing:border-box;width:320px;max-width:100%;display:grid;gap:10px;padding:14px;border-radius:14px;background:#181B23;border:1px solid var(--line);box-shadow:0 16px 40px rgba(0,0,0,.5);color:var(--ink);font:13px/1.45 var(--ui)}
.b-pop h4{margin:0;font:600 14px var(--ui)}.b-pop p{margin:0;font-size:12.5px;color:var(--ink2)}.b-pop p a{color:var(--ink)}
.b-pop hr{width:100%;margin:0;border:0;border-top:1px solid var(--rule)}
.b-pl{color:var(--ink)!important;margin:0 0 6px!important}.b-pnote{margin-top:6px!important;font-size:12px!important}
.b-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:rgba(255,255,255,.06)}
.b-seg button{flex:1;height:32px;border:0;border-radius:7px;background:transparent;color:var(--ink2);font:600 12px var(--ui);cursor:pointer}.b-seg button[aria-pressed="true"]{background:var(--ink);color:#0B0D13}
.b-prow{display:flex;align-items:center;gap:10px;min-height:36px;font-size:13px}.b-prow>span{flex:1;min-width:0}.b-prow small{display:block;font:400 11.5px var(--ui);color:var(--ink3)}
.b-dz{justify-self:start;min-height:32px;padding:0;border:0;background:none;color:#FF8C8C;font:600 13px var(--ui);text-align:left;cursor:pointer}
.b-aimsel{box-sizing:border-box;width:100%;height:40px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:#0B0D13;color:var(--ink);font:13.5px var(--ui)}
.b-pbuy{height:40px;border-radius:20px;border:0;background:var(--you);color:#fff;font:600 13.5px var(--ui);cursor:pointer}.b-pbuy[disabled]{background:rgba(139,108,246,.28);color:rgba(255,255,255,.6);cursor:default}
.b-aims{list-style:none;margin:0;padding:0;display:grid;gap:2px;font-size:12.5px;color:var(--ink2)}.b-aims b{color:var(--ink);font-weight:600}
.b-unaim{min-height:32px;padding:0 4px;border:0;background:none;color:var(--ink);font:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.b-perr{color:#FF8C8C!important;font-size:12px!important}
.b-pop.sheet{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;max-width:none;max-height:80vh;overflow:auto;z-index:90;border-radius:16px 16px 0 0;padding:8px 14px calc(14px + env(safe-area-inset-bottom,0px))}
.b-pop.sheet::before{content:"";display:block;width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.3);margin:0 auto}
.b-pop.sheet .b-seg button,.b-pop.sheet .b-aimsel,.b-pop.sheet .b-pbuy,.b-pop.sheet .b-prow{min-height:44px}
@media (prefers-reduced-motion:no-preference){.b-pop{animation:b-pop .14s ease-out}}
@keyframes b-pop{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion:reduce){.b-sw,.b-sw::after,.b-bc,.b-arm-buy,.b-cv,.b-ar-tb::after{transition:none}}
/* the status chip: the long line on L and M, "Starts in" on S */
.b-cn{display:none}
/* M: Duo, dense on purpose */
@media (min-width:700px) and (max-width:899px){
.b-deck{--gap:8px}
.b-grid{grid-template-columns:minmax(0,1fr) 272px}
.b-card{padding:10px 12px;border-radius:12px}
.b-eb{font-size:11px}.b-big{font-size:22px;margin-top:5px}.b-big.b-none{font-size:19px}.b-sub{font-size:11px;margin-top:3px}
.b-cred{height:28px;font-size:11px}.b-gear{width:28px;height:28px}.b-gear::before{inset:-8px}
.b-tnb{grid-template-columns:minmax(0,1fr);gap:10px;margin-top:10px}
.b-hh{font-size:11.5px}.b-hh small{font-size:11px}
.b-tiles{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:6px}
.b-tile{padding:5px 8px;border-radius:8px}.b-tile span,.b-tile i{font-size:10px}.b-tile b{font-size:19px}
.b-from{font-size:10.5px;margin-top:5px}.b-trow{margin-top:6px;font-size:11px}
.b-gb{height:28px;font-size:11.5px;padding:0 10px}.b-gb::before{inset:-8px 0}
.b-txt{font-size:11.5px;margin-top:6px}.b-cta2{height:36px;font-size:12.5px;padding:0 16px}
.b-arm-cards{gap:6px;margin-top:6px}
.b-bc{padding:6px 8px;border-radius:12px;grid-template-columns:18px minmax(0,1fr);gap:0 6px}.b-bc .b-bi{width:18px;height:18px}.b-bc-n{font-size:11.5px}.b-bc-p{font-size:10px}.b-bc-d{display:none}.b-bc-add{font-size:10.5px;margin-top:2px}
.b-arm-rows{margin-top:6px;gap:4px}.b-ar input,.b-ar-tb,.b-ar-x{height:28px}.b-ar input{font-size:11.5px}.b-ar-x::before{inset:-8px -6px}
.b-arm-who{margin-top:6px}.b-arm-who-d{font-size:11px}
.b-arm-foot{margin-top:8px}.b-arm-sum{font-size:10.5px}.b-arm-buy{height:36px;font-size:12.5px;padding:0 16px}
.b-fine{font-size:10.5px;margin-top:5px}
.b-nums{margin-top:8px;gap:4px}.b-nums b{font-size:21px}.b-nums span{font-size:10px}
.b-ych{margin-top:8px;font-size:11px}.b-yc{font-size:11px}.b-yc dt,.b-yc dd{padding:3px 0}
.b-lbtn{margin-top:8px;gap:6px}.b-allshots{font-size:11px}
.b-tabrow button{height:32px;font-size:11.5px;padding:0 9px}
.b-panel{padding:0 12px 6px}.b-tabhint{font-size:10.5px;padding:6px 0 2px}
.b-sr{min-height:28px;font-size:11.5px;grid-template-columns:44px minmax(0,1fr) 30px 96px 14px;gap:8px}.b-r{font-size:11px}
.b-rk li,.b-al li{min-height:28px;font-size:11.5px}.b-av{width:16px;height:16px;font-size:9px}.b-who{gap:5px}.b-shot{padding-left:52px;font-size:11.5px}
}
/* S: phones */
@media (max-width:699px){
.b-deck{--gap:10px}
.b-grid{grid-template-columns:minmax(0,1fr)}
.b-card{padding:14px}
.b-big{font-size:24px}
.b-ch1 .b-cred{display:none}
.b-gear{width:40px;height:40px}.b-gear::before{inset:-2px}
.b-tnb{grid-template-columns:minmax(0,1fr);gap:16px;margin-top:14px}
.b-gb{height:44px;font-size:14px;padding:0 14px}.b-gb::before{display:none}
.b-arm-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.b-bc{min-height:44px}
.b-ar{grid-template-columns:18px minmax(0,1fr) 44px;grid-template-areas:"i w x" ". t t" ". e e" "p p p"}
.b-ar input,.b-ar-tb{height:44px}.b-ar input{font-size:16px}.b-ar-tb{max-width:none;width:100%}.b-ar-x{width:44px;height:44px}.b-ar-x::before{display:none}
.b-arm-foot{flex-direction:column;align-items:stretch;gap:8px}.b-arm-buy{width:100%}
.b-tabrow button{flex:1;justify-content:center;height:44px;padding:0 6px}
.b-tl{display:none}.b-ts{display:inline}
.b-sr{grid-template-columns:minmax(0,1fr) 34px 14px;min-height:52px;gap:2px 8px;padding:6px 0}.b-sl time{display:none}.b-rk li,.b-al li{min-height:44px}.b-who{padding:6px 0;margin:-6px 0}.b-p .b-who{max-width:48%}.b-r{grid-column:1;grid-row:2;text-align:left}.b-szc{grid-row:1/3;grid-column:2}.b-cv{grid-row:1/3;grid-column:3}
.b-shot{padding-left:0}
.b-cw{display:none}.b-cn{display:inline}
}
`;

/** The deck under the map (PAGE.md 5): the Tonight and Last night cards, then one tab panel. The cards are filled by battleClient. */
export function battleMarkup(): string {
  return `<div class="b-deck" id="b-bar" hidden aria-label="Battles">
<div class="b-grid"><section class="b-card b-tn" id="armory" data-b="me" aria-labelledby="b-tn-t" aria-busy="true"></section><section class="b-card b-ln" data-b="last" aria-label="Last night"></section></div>
<p class="b-msg" data-b="msg" role="alert"></p><p class="b-cap" data-b="cap" aria-live="polite"></p>
<section class="b-tabs" aria-label="Battle lists"><div class="b-tabrow" role="tablist" aria-label="Battle lists">
<button type="button" role="tab" id="b-tab-shots" data-tab="shots" aria-controls="shots" aria-selected="true"><span class="b-tl">Shot by shot</span><span class="b-ts">Shots</span> <small data-b="nshots">0</small></button>
<button type="button" role="tab" id="b-tab-season" data-tab="season" aria-controls="season" aria-selected="false" tabindex="-1"><span class="b-tl">Season ranking</span><span class="b-ts">Season</span></button>
<button type="button" role="tab" id="b-tab-arsenals" data-tab="arsenals" aria-controls="arsenals" aria-selected="false" tabindex="-1"><span class="b-tl">Arming today</span><span class="b-ts">Arming</span> <small><span class="b-tl" data-b="narmed">0</span><span class="b-ts" data-b="narmeds">0</span></small></button></div>
<div class="b-panel" role="tabpanel" id="shots" aria-labelledby="b-tab-shots"><p class="b-tabhint" data-b="shotsum"></p><div data-b="shotlist"></div><button type="button" class="b-more" data-bhow aria-haspopup="dialog" aria-expanded="false">How battles work</button></div>
<div class="b-panel" role="tabpanel" id="season" aria-labelledby="b-tab-season" hidden><p class="b-tabhint" data-b="seasonsum"></p><div data-b="board"></div></div>
<div class="b-panel" role="tabpanel" id="arsenals" aria-labelledby="b-tab-arsenals" hidden><p class="b-tabhint" data-b="armsum"></p><div data-b="arsenals"></div></div>
</section></div>`;
}
