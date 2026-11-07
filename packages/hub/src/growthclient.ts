// @ts-nocheck
/**
 * The World page's time views in the browser: the Now | Day | Week | Month switcher (it replaced Current | Expansion), the
 * SimCity-style date bar with replay speeds (turtle, llama, cheetah), the zoning and heat toggles, the daily drop's ticker,
 * and the "Today in your city" card. The map itself is drawn by the city renderer (citygrowth.ts); this only drives it
 * through window.CALDERA_GROWTH_API. Shareable as /world?view=day|week|month (the old ?view=expansion opens Month).
 * Shipped as the source of growthClient() (self-contained: it must not reference anything outside itself).
 */
export function growthClient() {
  'use strict';
  var G0 = window.CALDERA_GROWTH; if (!G0) return;
  var KEY = 'caldera.worldView', VIEWS = window.CALDERA_BATTLE ? ['now', 'day', 'week', 'month', 'battle'] : ['now', 'day', 'week', 'month'], SPEEDS = { turtle: 20000, llama: 10000, cheetah: 5000 };
  var html = document.documentElement, bar = document.getElementById('g-bar'), stage = document.getElementById('stage');
  var btns = Array.prototype.slice.call(document.querySelectorAll('[data-gview]'));
  var cache = { day: { d: G0, at: Date.now() } }, cur = 'now', data = G0, playing = null;
  var speed = 'llama'; try { var sp = localStorage.getItem('caldera.world.speed'); if (SPEEDS[sp]) speed = sp; } catch (e) {}
  function api() { return window.CALDERA_GROWTH_API; }
  function q(sel) { return bar ? bar.querySelector(sel) : null; }
  function setText(k, v) { var el = q('[data-g="' + k + '"]'); if (el) el.textContent = v; }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dLabel(iso, wd) { var t = new Date(iso + 'T12:00:00Z'); return (wd ? WD[t.getUTCDay()] + ' ' : '') + MON[t.getUTCMonth()] + ' ' + t.getUTCDate(); }
  function rangeLabel(d) { if (!d) return ''; var y = d.to.slice(0, 4); return d.window === 'day' ? dLabel(d.to, true) + ', ' + y : dLabel(d.from) + ' to ' + dLabel(d.to) + ', ' + y; }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function stats(d) {
    var t = (d && d.totals) || {};
    setText('date', rangeLabel(d)); setText('c', num(t.c)); setText('z', num(t.z)); setText('top', num(t.top)); setText('rel', num(t.rel));
    setText('cl', t.c === 1 ? 'commit' : 'commits'); setText('zl', t.z === 1 ? 'lot broke ground' : 'lots broke ground'); setText('tl', t.top === 1 ? 'building topped out' : 'buildings topped out'); setText('rl', t.rel === 1 ? 'release' : 'releases');
  }
  function load(v) {
    var c = cache[v]; if (c && Date.now() - c.at < 120000) return Promise.resolve(c.d);
    return fetch('/v1/world/state?window=' + v, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { cache[v] = { d: d, at: Date.now() }; return d; });
  }
  function initial() {
    var v = null; try { v = new URL(location.href).searchParams.get('view'); } catch (e) {}
    if (v === 'expansion') v = 'month'; if (v === 'current') v = 'now';
    if (VIEWS.indexOf(v) < 0) { try { v = localStorage.getItem(KEY); } catch (e) {} if (v === 'expansion') v = 'month'; if (v === 'current') v = 'now'; }
    return VIEWS.indexOf(v) >= 0 ? v : 'now';
  }
  function setView(v, save) {
    if (VIEWS.indexOf(v) < 0) v = 'now';
    stop(); cur = v;
    var BU = window.CALDERA_BATTLE_UI;   // the Battle view (battleclient.ts): the current map with the battle layers on top
    html.classList.toggle('w-grow', v !== 'now' && v !== 'battle');
    btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-gview') === v)); });
    if (bar) bar.hidden = v === 'now' || v === 'battle';
    if (BU && v !== 'battle') BU.hide();
    if (save) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      try { var u = new URL(location.href); if (v === 'now') u.searchParams.delete('view'); else u.searchParams.set('view', v); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
    }
    if (v === 'now') { if (api()) api().view('now', cache.day.d); return; }
    if (v === 'battle') { if (api()) api().view('now', cache.day.d); if (BU) BU.show(); return; }
    if (bar) bar.setAttribute('aria-busy', 'true');
    load(v).then(function (d) { if (cur !== v) return; data = d; if (api()) api().view(v, d); stats(d); })
      .catch(function () { setText('date', 'Could not load this view. Try again in a minute.'); })
      .then(function () { if (bar) bar.removeAttribute('aria-busy'); });
  }
  btns.forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-gview'), true); }); });

  // ---------------------------------------------------------------- replay: the window as a time-lapse on the same camera
  var playBtn = q('.g-play'), fill = q('.g-track i');
  function stop() {
    if (playing) { cancelAnimationFrame(playing.raf); playing = null; }
    if (playBtn) { playBtn.setAttribute('aria-pressed', 'false'); playBtn.innerHTML = '&#9654; Replay'; }
    if (fill) fill.style.width = '0%';
    if (api() && cur !== 'now') api().cursor(null);
    if (data && cur !== 'now') stats(data);
  }
  function play() {
    if (!data || cur === 'now') return;
    var t0 = data.t0, t1 = Date.now(), dur = SPEEDS[speed] || 10000, s0 = performance.now();
    if (playBtn) { playBtn.setAttribute('aria-pressed', 'true'); playBtn.innerHTML = '&#10074;&#10074; Pause'; }
    playing = { raf: 0 };
    (function step() {
      if (!playing) return;
      var f = Math.min(1, (performance.now() - s0) / dur), T = t0 + (t1 - t0) * f, dt = new Date(T);
      if (api()) api().cursor(T);
      if (fill) fill.style.width = (f * 100).toFixed(1) + '%';
      setText('date', (cur === 'day' ? '' : MON[dt.getMonth()] + ' ' + dt.getDate() + ', ') + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'));
      if (f >= 1) { playing = null; setTimeout(stop, 900); return; }
      playing.raf = requestAnimationFrame(step);
    })();
  }
  if (playBtn) playBtn.addEventListener('click', function () { if (playing) stop(); else play(); });
  Array.prototype.slice.call(bar ? bar.querySelectorAll('[data-speed]') : []).forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-speed') === speed));
    b.addEventListener('click', function () {
      speed = b.getAttribute('data-speed'); try { localStorage.setItem('caldera.world.speed', speed); } catch (e) {}
      Array.prototype.slice.call(bar.querySelectorAll('[data-speed]')).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      if (playing) { stop(); play(); }
    });
  });
  Array.prototype.slice.call(bar ? bar.querySelectorAll('[data-gt]') : []).forEach(function (b) {
    var k = b.getAttribute('data-gt'), on = k === 'heat';
    try { var s = localStorage.getItem(k === 'heat' ? 'caldera.world.heat' : 'caldera.world.zoning'); if (s !== null) on = s === '1'; } catch (e) {}
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', function () { on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); if (api()) api()[k](on); });
  });

  // ---------------------------------------------------------------- the daily drop and "Today in your city"
  function phrase(d) {
    var who = d.at || '';
    return d.kind === 'parade' ? 'Parade for ' + who + (d.why ? ' (' + d.why + ')' : '')
      : d.kind === 'airship' ? 'An airship crosses at noon'
      : d.kind === 'festival' ? (d.name || 'Festival') + ' at dusk on thriving plots'
      : d.kind === 'wildlife' ? (d.species ? d.species.charAt(0).toUpperCase() + d.species.slice(1) : 'Wildlife') + ' at dawn'
      : d.kind === 'market' ? 'Market day on the plaza'
      : d.kind === 'fireworks' ? 'Fireworks for ' + who + "'s release"
      : d.kind === 'welcome' ? 'Welcome party for ' + who
      : d.kind === 'storm' ? 'Commit storm over ' + who : '';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  fetch('/v1/world/today', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
    if (!t) return;
    if (api()) api().drops({ drops: t.drops || [] });
    var tk = q('[data-g="ticker"]'); if (tk) tk.textContent = 'Today: ' + (t.drops || []).map(phrase).filter(Boolean).join(' · ');
    if (!t.me || !t.lines || !t.lines.length || !stage || document.querySelector('.b-recap')) return;   // the battle recap card wins
    try { if (localStorage.getItem('caldera.world.today') === t.day) return; } catch (e) {}
    var card = document.createElement('div'); card.className = 'g-today'; card.setAttribute('role', 'status');
    var line = t.lines.join(', '); line = line.charAt(0).toUpperCase() + line.slice(1);
    card.innerHTML = '<button type="button" class="g-x" aria-label="Dismiss">&times;</button><b>Today in your city</b><p>' + esc(line) + '.</p><button type="button" class="g-go">&#9654; Show me</button>';
    stage.appendChild(card);
    card.querySelector('.g-x').onclick = function () { card.remove(); try { localStorage.setItem('caldera.world.today', t.day); } catch (e) {} };
    card.querySelector('.g-go').onclick = function () { if (cur === 'now') setView('day', true); if (api()) api().fly(t.me); card.remove(); try { localStorage.setItem('caldera.world.today', t.day); } catch (e) {} };
  }).catch(function () {});

  setView(initial(), false);
}
export const GROWTH_CLIENT_JS = "(" + growthClient.toString() + ")();";

/** Before first paint: the right button pressed and the date bar shown, without a flash; the renderer reads CALDERA_GVIEW */
export const GROWTH_HEAD_JS = `(function(){try{var v=new URL(location.href).searchParams.get('view');if(v==='expansion')v='month';if(v==='current')v='now';var B=!!window.CALDERA_BATTLE_ON;if(['now','day','week','month'].concat(B?['battle']:[]).indexOf(v)<0){v=localStorage.getItem('caldera.worldView');if(v==='expansion')v='month';}if(['day','week','month'].concat(B?['battle']:[]).indexOf(v)<0)v='now';window.CALDERA_GVIEW=v==='battle'?'now':v;if(v==='battle')document.documentElement.classList.add('w-battle');else if(v!=='now')document.documentElement.classList.add('w-grow')}catch(e){}})();`;

export const GROWTH_CSS = `
.w-view{display:inline-flex;gap:2px;padding:3px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,.14));background:var(--surface,rgba(255,255,255,.04));align-self:center;flex:none;max-width:100%}
.w-view button{font:600 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif);min-height:32px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--text-muted,#9A9AA5);cursor:pointer}
.w-view button[aria-pressed="true"]{background:#8B6CF6;color:#fff}
.w-view button:focus-visible{outline:2px solid #B9A6FF;outline-offset:2px}
@media (pointer:coarse){.w-view button{min-height:40px}}
.w-maps{position:relative}
.w-grow-only{display:none}html.w-grow .w-grow-only{display:revert}html.w-grow .w-now-only{display:none}
.g-bar{display:grid;gap:6px;margin-top:8px;padding:8px 12px 10px;border-radius:var(--radius-md,10px);border:1px solid rgba(140,170,230,.25);background:#0F1016;color:#E8EEF8;min-width:0}
.g-bar[hidden]{display:none}html.w-grow .g-bar:not([hidden]){display:grid}
.g-row1,.g-row2{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;min-width:0}
.g-date{font:600 14px/1.3 var(--font-sans,'IBM Plex Sans',sans-serif);color:#fff;font-variant-numeric:tabular-nums;min-width:0}
.g-stats{display:flex;flex-wrap:wrap;gap:2px 14px;font:500 12px/1.4 var(--font-mono,'IBM Plex Mono',monospace);color:#9A9AA5;min-width:0}.g-stats b{color:#F2F2F5;font-weight:600}
.g-row2 button{font:500 12px/1 var(--font-mono,'IBM Plex Mono',monospace);color:#E8EEF8;background:rgba(10,14,26,.72);border:1px solid rgba(185,166,255,.4);border-radius:999px;padding:0 11px;min-height:32px;cursor:pointer}
.g-row2 button[aria-pressed="true"]{background:rgba(139,108,246,.28);border-color:#B9A6FF}
.g-row2 button:focus-visible{outline:2px solid #B9A6FF;outline-offset:2px}
.g-play{background:#8B6CF6!important;border-color:#8B6CF6!important;color:#fff!important;font-weight:600!important}
.g-speeds{display:inline-flex;gap:4px}
.g-track{flex:1 1 80px;min-width:60px;height:4px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}.g-track i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8B6CF6,#FFC46B)}
.g-ticker{font:12px/1.4 var(--font-sans,'IBM Plex Sans',sans-serif);color:#C9D2E6;min-width:0;overflow-wrap:anywhere}
.g-today{position:absolute;left:10px;top:52px;z-index:6;width:min(300px,calc(100% - 20px));background:rgba(17,20,32,.95);color:#F2F2F5;border:1px solid rgba(185,166,255,.45);border-radius:12px;padding:10px 12px;font:13px/1.45 var(--font-sans,'IBM Plex Sans',sans-serif);box-shadow:0 18px 40px -16px rgba(0,0,0,.8)}
.g-today b{display:block;font-size:14px;margin-right:30px}.g-today p{margin:4px 0 8px;color:#C9D2E6}
.g-today .g-go{font:600 13px/1 var(--font-sans,'IBM Plex Sans',sans-serif);background:#8B6CF6;color:#fff;border:0;border-radius:999px;padding:0 14px;min-height:36px;cursor:pointer}
.g-today .g-x{position:absolute;right:4px;top:4px;width:36px;height:36px;border:0;background:transparent;color:#C9D2E6;font-size:20px;cursor:pointer;border-radius:50%}
@media (max-width:600px){.w-view button{padding:0 10px;font-size:12.5px}.g-bar{padding:8px 10px}.g-stats{gap:2px 10px;font-size:11.5px}.g-today{top:auto;bottom:10px}}
`;

export function growthMarkup(): string {
  return `<div class="g-bar" id="g-bar" hidden aria-label="Growth timeline">
<div class="g-row1"><b class="g-date" data-g="date"></b><span class="g-stats"><span><b data-g="c">0</b> <span data-g="cl">commits</span></span><span><b data-g="z">0</b> <span data-g="zl">lots broke ground</span></span><span><b data-g="top">0</b> <span data-g="tl">buildings topped out</span></span><span><b data-g="rel">0</b> <span data-g="rl">releases</span></span></span></div>
<div class="g-row2"><button type="button" class="g-play" aria-pressed="false">&#9654; Replay</button><span class="g-speeds" role="group" aria-label="Replay speed"><button type="button" data-speed="turtle" title="Turtle: the window in 20 seconds">Turtle</button><button type="button" data-speed="llama" title="Llama: 10 seconds">Llama</button><button type="button" data-speed="cheetah" title="Cheetah: 5 seconds">Cheetah</button></span><span class="g-track" aria-hidden="true"><i></i></span><button type="button" data-gt="zoning" aria-pressed="false" title="Zoning overlay: each plot tinted in its owner's language colour">Zoning</button><button type="button" data-gt="heat" aria-pressed="true" title="Heat: warm glow for work in this window, blue frost when a plot goes quiet">Heat</button></div>
<div class="g-ticker" data-g="ticker"></div>
</div>`;
}
