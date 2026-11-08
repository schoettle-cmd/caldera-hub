// @ts-nocheck
/**
 * The World page's Battle view in the browser (Mike 2026-11-07): the Battle button in the Now | Day | Week | Month switcher,
 * the legend chip on the map ("Firing until midnight" / "Rebuilding until noon" with a countdown on the viewer's clock), the
 * battle bar under the map (last night's numbers, the layer toggles Damage / Attacks / Shields / Replay, the member's own
 * panel: join or leave, tonight's arsenal, shield, optional manual fire, the report email), the season board, and the morning
 * card "What your city did last night". The map is drawn by the city renderer (citybattle.ts), driven through
 * window.CALDERA_BATTLE_API: supply drop at noon local, one salvo at 20:00, cranes rebuild from midnight to noon (Mike 11-07).
 * Replay (Mike 11-08) is cinematic: one strike beat per city, the camera zooms to the pad, follows the missiles into the hit and
 * resets to the next city, then the wide shot, the cranes, home; 20 to 40 s. Controls on the map: Strike n of m, Pause, Skip, End;
 * a tap on the map skips. "Demo replay" plays a sample battle between the biggest cities (synthetic shots, labelled demo).
 * Shareable: /world?view=battle, &layers=damage,attacks,shields,replay, &replay=1 or &replay=demo.
 * Shipped as the source of battleClient() (self-contained).
 */
export function battleClient() {
  'use strict';
  var B0 = window.CALDERA_BATTLE; if (!B0) return;
  var bar = document.getElementById('b-bar'), stage = document.getElementById('stage'), data = B0, me = null, on = false, playing = null;
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
  var WN = { orbital: 'orbital strike', beam: 'beam tower', cannon: 'cannon', catapult: 'catapult' };
  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error || r.status); return j; }); });
  }
  function load() { return fetch('/v1/world/battle', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d) { data = d; if (api()) api().view(on, d); stats(); } return d; }).catch(function () {}); }
  function stats() {
    var s = data.shots || [], landed = s.filter(function (x) { return x[3] > 0; }).length;
    setText('date', 'Last night, ' + dLabel(data.night));
    setText('cities', String(data.cities || 0)); setText('cl', data.cities === 1 ? 'city in the battles' : 'cities in the battles');
    setText('shots', String(s.length)); setText('landed', String(landed));
    setText('season', 'Season ' + data.season.n + ', week ' + data.season.week);
    setText('next', 'Next night resolves ' + hhmm(data.next) + ' (in ' + until(data.next) + '), fires from noon');
    var bd = q('[data-b="board"]');
    if (bd) bd.innerHTML = (data.board || []).length ? '<ol>' + data.board.map(function (r) { return '<li><button type="button" data-fly="' + esc(r[0]) + '">' + esc(r[0]) + '</button> <b>' + r[1] + '</b></li>'; }).join('') + '</ol>' : '<p>No scores yet. The first battle sets the board.</p>';
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
  // the replay controls on the map: Strike n of m with the city, Pause / Play, Skip (a tap on the map skips too), End
  var hudEl = null;
  function hud(ph) {
    if (!stage) return;
    if (!hudEl) { hudEl = document.createElement('div'); hudEl.className = 'b-play'; hudEl.setAttribute('role', 'group'); hudEl.setAttribute('aria-label', 'Replay controls');
      hudEl.innerHTML = '<div class="b-pt"><b data-p="beat"></b><span data-p="label"></span></div><button type="button" data-p="pause" aria-pressed="false">Pause</button><button type="button" data-p="skip">Skip</button><button type="button" data-p="stop" aria-label="End the replay">End</button>';
      hudEl.querySelector('[data-p="pause"]').onclick = function () { if (api() && api().pause) { var on = api().pause(); this.setAttribute('aria-pressed', String(on)); this.textContent = on ? 'Play' : 'Pause'; } };
      hudEl.querySelector('[data-p="skip"]').onclick = function () { if (api() && api().skip) api().skip(); hud(api().phase()); };
      hudEl.querySelector('[data-p="stop"]').onclick = function () { stopPlay(); };
      stage.appendChild(hudEl); }
    var st = ph.stage, beat = st === 'beat' || st === 'pre' ? 'Strike ' + ph.beat + ' of ' + ph.beats : st === 'wide' ? 'All ' + ph.beats + ' strike' + (ph.beats === 1 ? '' : 's') + ' in' : st === 'rebuild' ? 'Rebuilding' : '';
    hudEl.querySelector('[data-p="beat"]').textContent = (ph.demo ? 'Demo \u00b7 ' : '') + beat; hudEl.querySelector('[data-p="label"]').textContent = ph.label || '';
    var pb = hudEl.querySelector('[data-p="pause"]'); pb.setAttribute('aria-pressed', String(!!ph.paused)); pb.textContent = ph.paused ? 'Play' : 'Pause';
    var sk = hudEl.querySelector('[data-p="skip"]'); sk.textContent = st === 'rebuild' ? 'Finish' : st === 'wide' ? 'Cranes' : 'Skip';
  }
  function hudOff() { if (hudEl) { hudEl.remove(); hudEl = null; } }
  function show() {
    on = true; if (bar) bar.hidden = false; document.documentElement.classList.add('w-battle');
    if (api()) { api().layers(layers); api().view(true, data); }
    stats(); load(); mine(); chipTick(); clearInterval(chipT); chipT = setInterval(chipTick, 1000); clearInterval(pollT); pollT = setInterval(load, 600000);
    if (layers.replay) play(replayMode);
  }
  function hide() {
    on = false; stopPlay(); if (bar) bar.hidden = true; document.documentElement.classList.remove('w-battle'); if (api()) api().view(false); clearInterval(chipT); clearInterval(pollT); if (chip) { chip.remove(); chip = null; }
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
  function stopPlay() { if (playing) { clearTimeout(playing); playing = null; } clearInterval(hudT); hudT = 0; document.documentElement.classList.remove('w-replay'); if (api() && api().stop) api().stop(); hudOff(); if (cap) cap.textContent = ''; var b = q('[data-bl="replay"]'); if (b) b.setAttribute('aria-pressed', 'false'); var d = q('[data-bdemo]'); if (d) d.setAttribute('aria-pressed', 'false'); layers.replay = false; chipTick(); }
  function play(mode) {
    if (playing) { clearTimeout(playing); playing = null; } clearInterval(hudT); hudT = 0;
    var n = on && api() && api().replay ? api().replay(mode) : 0;
    if (!n) { if (cap) cap.textContent = mode === 'demo' ? 'The demo needs two cities with repo towers on the map.' : 'No missiles today: nothing to replay. Try the demo replay.'; playing = setTimeout(stopPlay, 3500); return; }
    var ph = api().phase(), b = q('[data-bl="replay"]'); if (b) b.setAttribute('aria-pressed', String(mode !== 'demo')); var d = q('[data-bdemo]'); if (d) d.setAttribute('aria-pressed', String(mode === 'demo')); layers.replay = mode !== 'demo';
    if (cap) cap.textContent = (mode === 'demo' ? 'Demo: a sample battle between the biggest cities on the map, synthetic shots. ' : 'Replay: ') + ph.beats + ' strike' + (ph.beats === 1 ? '' : 's') + ', ' + n + ' missile' + (n === 1 ? '' : 's') + ', about ' + Math.round(ph.dur / 1000) + ' s. Tap the map to skip to the next strike.';
    chipTick(); hud(ph); document.documentElement.classList.add('w-replay');
    if (stage && window.innerWidth >= 700) { var r = stage.getBoundingClientRect(); if (r.top < 0 || r.bottom > window.innerHeight) { try { stage.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch (e) {} } }
    hudT = setInterval(function () { var p2 = api() && api().phase ? api().phase() : null; if (!p2 || !p2.replay) { stopPlay(); return; } hud(p2); }, 200);
    playing = setTimeout(stopPlay, 50000);
  }
  // ---------------------------------------------------------------- the member's panel
  var panel = q('[data-b="me"]');
  function mine() {
    return fetch('/v1/world/battle/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) { me = m && m.h ? m : null; render(); recap(); return me; }).catch(function () { render(); });
  }
  function render() {
    if (!panel) return;
    if (!me) { panel.innerHTML = '<p>Battles are opt-in. Everyone else is a peaceful zone: no shots in or out. <a href="/signin?next=%2Fworld%3Fview%3Dbattle">Sign in</a> to join with your city.</p>'; return; }
    if (!me.war) {
      panel.innerHTML = '<p><b>Your city is a peaceful zone.</b> No shots in or out. Join and your city fights on its own overnight with that day\'s real code: no one has to do anything, damage is only on this map, and it always rebuilds itself.</p><button type="button" class="b-join">Join the battles</button>' + reportHtml();
      panel.querySelector('.b-join').onclick = function () { act('/v1/world/battle/opt', { war: true }); };
      wireReport(); return;
    }
    var a = me.arsenal || { ammo: 0, c: 0, pr: 0, shots: 0, best: 'catapult', ai: 1 };
    var parts = [a.c + ' commit' + (a.c === 1 ? '' : 's')]; if (a.pr) parts.push(a.pr + ' PR' + (a.pr === 1 ? '' : 's')); if (a.rel) parts.push(a.rel + ' release' + (a.rel === 1 ? '' : 's')); if (a.ai > 1) parts.push('x' + a.ai + ' AI'); if (a.streak > 1) parts.push('x' + a.streak + ' streak');
    var aims = (me.aims || []).map(function (h) { return '<li>' + esc(h) + ' <button type="button" class="b-unaim" data-h="' + esc(h) + '" aria-label="Stop aiming at ' + esc(h) + '">&times;</button></li>'; }).join('');
    var opts = (me.rivals || []).map(function (r) { return '<option value="' + esc(r.h) + '">' + esc(r.h) + ' (shield ' + Math.round(r.sh * 100) + '%' + (r.beg ? ', beginner' : '') + ')</option>'; }).join('');
    panel.innerHTML = '<div class="b-ars"><div><span>Tonight\'s arsenal</span><b>' + a.ammo + ' ammo</b><i>' + esc(parts.join(', ')) + '</i></div>'
      + '<div><span>Weapons</span><b>' + a.shots + ' ' + esc(WN[a.best] || 'catapult') + ' shot' + (a.shots === 1 ? '' : 's') + '</b><i>auto-fire on</i></div>'
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
    var rows = [['Raids on you', L.raids.length ? L.raids.length + ' (' + raids + ')' : 'none'], ['Damage taken', L.taken > 0 ? (Math.round(L.taken * 10) / 10) + ' facade' + (L.taken === 1 ? '' : 's') + (L.tiers ? ', ' + L.tiers + ' tier' + (L.tiers === 1 ? '' : 's') : '') : (L.raids.length ? 'none: your shield held' : 'none')]];
    if (L.taken > 0) rows.push(['Rebuilt so far', L.rebuilt + '%']);
    rows.push(['Your towers fired', L.fired + ' shot' + (L.fired === 1 ? '' : 's') + ', ' + L.landed + ' hit' + (L.landed === 1 ? '' : 's') + (L.on.length ? ' on ' + L.on.slice(0, 2).join(', ') : '')]);
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
export const BATTLE_CLIENT_JS = "(" + battleClient.toString() + ")();";

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
.b-play{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:7;display:flex;align-items:center;gap:6px;max-width:calc(100% - 20px);padding:5px 6px 5px 12px;border-radius:14px;background:rgba(15,16,22,.94);border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 30px -12px rgba(0,0,0,.8);font:500 12px/1.2 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;font-variant-numeric:tabular-nums}
.b-play .b-pt{display:grid;gap:2px;min-width:0;margin-right:6px}.b-play .b-pt b{color:#fff;font-weight:600;white-space:nowrap}.b-play .b-pt span{color:#C9D2E6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34vw}.b-play .b-pt span:empty{display:none}
.b-play button{font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.22);border-radius:9px;padding:0 10px;min-height:36px;min-width:44px;cursor:pointer;flex:none}
.b-play button[aria-pressed="true"]{background:rgba(61,242,255,.18);border-color:#3DF2FF}.b-play button:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.b-chip i{width:7px;height:7px;border-radius:50%;background:#FFB347;box-shadow:0 0 8px #FFB347;flex:none}.b-chip.rebuild i{background:#4FD1C5;box-shadow:0 0 8px #4FD1C5}.b-chip b{font-weight:600;color:#fff}.b-chip span{color:#C9D2E6}
@media (prefers-reduced-motion: reduce){.b-chip i{box-shadow:none}}
html.w-replay #drRail,html.w-replay .cal-nb{display:none!important}
.w-main .c-stage.c-full{height:100%;min-height:0}
.w-battle-only{display:none}html.w-battle .w-battle-only{display:revert}html.w-battle .w-now-only,html.w-battle .w-grow-only{display:none}
@media (max-width:600px){.b-bar{padding:8px 10px}.b-stats{gap:2px 10px;font-size:11.5px}.b-recap{top:auto;bottom:50px;right:10px}.b-chip{top:auto;bottom:10px}.b-play{bottom:48px;left:10px;right:10px;transform:none;max-width:none;justify-content:space-between;padding:5px 5px 5px 10px}.b-play .b-pt span{max-width:40vw}.b-play button{padding:0 8px}.c-stage.c-full .b-play{bottom:calc(48px + env(safe-area-inset-bottom,0px))}.c-stage.c-full .b-chip{bottom:calc(10px + env(safe-area-inset-bottom,0px))}}
`;

export function battleMarkup(): string {
  return `<div class="b-bar" id="b-bar" hidden aria-label="Battles">
<div class="b-row"><b class="b-date" data-b="date"></b><span class="b-stats"><span><b data-b="cities">0</b> <span data-b="cl">cities in the battles</span></span><span><b data-b="shots">0</b> shots</span><span><b data-b="landed">0</b> landed</span><span data-b="season"></span><span data-b="next"></span></span></div>
<div class="b-row" role="group" aria-label="Layers"><button type="button" data-bl="damage" aria-pressed="true" title="Hits on the repo towers: lost floors, scorch, rubble, smoke; the cranes that rebuild them">Damage</button><button type="button" data-bl="attacks" aria-pressed="true" title="Ammo pads, stacks, launch centers and missiles in flight">Attacks</button><button type="button" data-bl="shields" aria-pressed="true" title="Each city's shield (white: beginner shield)">Shields</button><button type="button" data-bl="replay" aria-pressed="false" title="Last night strike by strike: the camera zooms to each city, follows its missiles into the hit, then the cranes">&#9654; Replay</button><button type="button" data-bdemo aria-pressed="false" title="A sample battle between the biggest cities on the map (synthetic shots), to see the full choreography">Demo replay</button><span class="b-cap" data-b="cap" aria-live="polite"></span></div>
<div class="b-me" data-b="me"></div><div class="b-msg" data-b="msg" role="alert"></div>
<details class="b-board" id="season"><summary>Season leaderboard (per head: facades landed, plus half of what your shield held off)</summary><div data-b="board"></div></details>
</div>`;
}
