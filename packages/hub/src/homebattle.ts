/**
 * The homepage block "Last night's battle" (LOOP.md part b, Fable design 11-24, mockup b-homepage-block.html): the newest
 * battle under the hero, the same block in every arm of the homepage test (hometest.ts only changes the hero). The facts are
 * in the HTML the server sends, so crawlers read them. The block replaces the marker <!--home-battle--> in
 * packages/site/index.html; with no battle ever it renders nothing and the old explainer (#how-battles-work) stays.
 *
 * The stage is the still picture of part a (/v1/world/battle/card/{yyyy-mm-dd}.png). HOME_AUTO is false (Mike 11-17 and 11-21:
 * a replay never starts by itself; Growth Engine 11-24): the button under the stage reads "Play", and only the viewer's tap
 * puts the muted replay in place (an iframe of /world?view=battle&embed=1&replay=1). Never full screen, never sound. The
 * frame posts {type:'caldera-strike', i, n, a, d, k} and {type:'caldera-end'}; it takes caldera-pause and caldera-play.
 */
import { RAIDERS, usdOf, heldOf, fallenOf, fmtUsd, type Shot } from "./battle";

/** LOOP.md b.6 `auto`: false = the stage stays the still picture until the viewer taps Play */
export const HOME_AUTO = false;

export interface HomeBattle {
  /** the night shown, yyyy-mm-dd (the picture's name) */ night: string;
  /** true: it is last night's battle; false: no battle last night, this is the last one */ last: boolean;
  /** "@handle" of the top attacker by damage dealt, or null (only raiders fired) */ winner: string | null;
  cities: number; hits: number; usd: number;
  tops: { h: string; usd: number; fired: number; landed: number }[];
  hard: { h: string; usd: number; hits: number; held: number; fell: boolean }[];
  /** the season top 5 after that night; prev = the rank before it (null: new on the board) */ board: { h: string; usd: number; rank: number; prev: number | null }[];
  season: number; week: number;
  /** the season's last battle: its top 3, shown until the first battle of the next season */ podium: { h: string; usd: number }[] | null;
  /** ms: the next battle */ next: number;
  /** the battle time has passed and its result is not in yet: the lists stay on the last finished battle */ running: boolean;
}

/** Winners and Hit hardest of one night (members only: each row links to a member's page). member: id -> "@handle" or null */
export function homeNight(shots: Shot[], member: (id: string) => string | null): Pick<HomeBattle, "winner" | "hits" | "usd" | "tops" | "hard"> {
  const att = new Map<string, { usd: number; fired: number; landed: number }>(), def = new Map<string, { usd: number; hits: number; held: number }>();
  for (const s of shots) {
    if (s.a !== RAIDERS) { const r = att.get(s.a) || { usd: 0, fired: 0, landed: 0 }; r.fired++; if (s.f > 0) { r.landed++; r.usd += usdOf(s); } att.set(s.a, r); }
    if (s.d !== RAIDERS) { const r = def.get(s.d) || { usd: 0, hits: 0, held: 0 }; if (s.f > 0) { r.hits++; r.usd += usdOf(s); } r.held += heldOf(s); def.set(s.d, r); }
  }
  const fell = fallenOf(shots), by = <T extends { usd: number }>(m: Map<string, T>) => [...m.entries()].filter(([id, r]) => r.usd > 0 && member(id)).sort((a, b) => b[1].usd - a[1].usd || (a[0] < b[0] ? -1 : 1));
  const tops = by(att).slice(0, 3).map(([id, r]) => ({ h: member(id)!, usd: r.usd, fired: r.fired, landed: r.landed }));
  const hard = by(def).slice(0, 3).map(([id, r]) => ({ h: member(id)!, usd: r.usd, hits: r.hits, held: r.held, fell: id === fell }));
  return { winner: tops[0]?.h || null, hits: shots.filter(s => s.f > 0).length, usd: shots.reduce((t, s) => t + usdOf(s), 0), tops, hard };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dateLabel = (night: string) => { const d = new Date(night + "T12:00:00Z"); return isNaN(+d) ? night : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const n1 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const AVC = ["#6D4AE8", "#138A6A", "#B5650A", "#2F6FD0", "#B2394B", "#5A6478"];
const av = (h: string, i: number) => `<span class="av" style="background:${AVC[i % AVC.length]}" aria-hidden="true">${esc((h.replace(/^@/, "")[0] || "?").toUpperCase())}</span>`;
const page = (h: string) => "/" + esc(h.startsWith("@") ? h : "@" + h) + "/";
const TRI = { up: '<svg viewBox="0 0 8 8" aria-hidden="true"><path d="M0 7 L4 1 L8 7Z" fill="currentColor"/></svg>', dn: '<svg viewBox="0 0 8 8" aria-hidden="true"><path d="M0 1 L8 1 L4 7Z" fill="currentColor"/></svg>' };
const PLAY = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style="margin-right:8px;fill:currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
const REPLAY = "/world?view=battle&amp;replay=1";

/** "5h 12m" and "Next battle in 5 hours 12 minutes" for the countdown chip (whole minutes, at least 1) */
export function countdown(ms: number): { short: string; long: string; soon: boolean } {
  const m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60), r = m % 60;
  return { short: h ? `${h}h ${r}m` : `${m}m`, long: "Next battle in " + (h ? n1(h, "hour", "hours") + (r ? " " + n1(r, "minute", "minutes") : "") : n1(m, "minute", "minutes")), soon: m < 60 };
}

/** the generic alt text of the picture (LOOP.md a.3) */
export function battleAlt(d: HomeBattle): string {
  const a = d.tops.map(r => `${r.h} ${fmtUsd(r.usd)}`).join(", "), h = d.hard.map(r => `${r.h} ${fmtUsd(r.usd)}${r.fell ? " (city down)" : ""}`).join(", ");
  return `Caldera battle, ${dateLabel(d.night)}.${d.winner ? ` ${d.winner} won the night.` : ""}${a ? ` Top attackers: ${a}.` : ""}${h ? ` Hit hardest: ${h}.` : ""} ${d.cities} cities fought, ${d.hits} missiles hit, ${fmtUsd(d.usd)} of damage. Next battle tonight at 20:00 PT.`;
}

/** the block's HTML (one string for every arm of the homepage test); viewer = the signed-in member, or null */
export function homeBattleBlock(d: HomeBattle, viewer: string | null, o: { promo?: () => string | null; now?: number } = {}): string {
  const now = o.now ?? Date.now(), date = dateLabel(d.night), member = !!viewer;
  const cd = countdown(d.next - now);
  const chip = d.running || d.next <= now ? `<span class="ln-next run" role="status"><b>Battle running.</b> Results in a moment.</span>`
    : `<span class="ln-next${cd.soon ? " soon" : ""}" id="ln-next" role="timer" aria-label="${esc(cd.long)}" data-next="${d.next}">Next battle in <b>${esc(cd.short)}</b> <span aria-hidden="true">/ 20:00 PT</span></span>`;
  const head = d.winner ? `${esc(d.winner)} won the night.` : "Raiders from the sea won the night.";
  const sub = `${d.last ? "" : `No battle last night. This is the battle of ${esc(date)}. `}${n1(d.cities, "city", "cities")} fought. ${n1(d.hits, "missile", "missiles")} hit. ${esc(fmtUsd(d.usd))} of damage, rebuilt by noon.`;
  const stage = `<div class="ln-stage" id="ln-stage" data-night="${esc(d.night)}" data-date="${esc(date)}"><a href="${REPLAY}" aria-label="Watch the full replay"><img src="/v1/world/battle/card/${esc(d.night)}.png" width="1200" height="630" alt="${esc(battleAlt(d))}" decoding="async"></a></div>`;
  const cap = `<p class="ln-cap"><button class="ln-pp" type="button" id="ln-pp" aria-pressed="true" hidden>Play</button><span id="ln-capt">Picture of the battle of ${esc(date)}.</span><i class="ln-mu" id="ln-mu" hidden>Replay, muted</i></p>`;
  const cta = `<div class="ln-cta"><a class="btn" href="${REPLAY}">${PLAY}Watch the full replay</a>${member ? `<a class="btn ghost" href="/world?view=battle#tonight">Set tonight's defenses</a>` : `<a rel="nofollow" class="btn ghost" href="/join?tp=battle">Put your city in tonight's battle</a>`}</div>`;
  const fine = `<p class="ln-fine">${member ? "Defenses lock at 19:45 PT. Work you push before then becomes missiles." : "Free. Your GitHub becomes a city, and today's code becomes missiles. Damage shows only on this map."}</p>`;
  const tops = d.tops.map((r, i) => `<li><a class="ln-row" href="${page(r.h)}"><span class="rk">${i + 1}</span>${av(r.h, i)}<span class="nm">${esc(r.h)}<small>${r.landed} of ${n1(r.fired, "missile", "missiles")} hit</small></span><span class="v">${esc(fmtUsd(r.usd))}</span></a></li>`).join("");
  const hard = d.hard.map((r, i) => `<li><a class="ln-row" href="${page(r.h)}"><span class="rk">${i + 1}</span>${av(r.h, i + 3)}<span class="nm">${esc(r.h)}${r.fell ? '<span class="ln-tag">City down</span>' : ""}<small>${n1(r.hits, "hit", "hits")}, shield held ${esc(fmtUsd(r.held))}</small></span><span class="v d">${esc(fmtUsd(r.usd))}</span></a></li>`).join("");
  const mv = (r: HomeBattle["board"][number]) => { if (r.prev == null) return `<span class="ln-mv" aria-label="new">new</span>`; const m = r.prev - r.rank;
    return m > 0 ? `<span class="ln-mv up" aria-label="up ${m}">${TRI.up}${m}</span>` : m < 0 ? `<span class="ln-mv dn" aria-label="down ${-m}">${TRI.dn}${-m}</span>` : `<span class="ln-mv" aria-label="no change">=</span>`; };
  let board = "";
  if (d.podium && d.podium.length) {
    const P = d.podium, cell = (i: number) => P[i] ? `<div${i === 0 ? ' class="p1"' : ""}><b>${i + 1}</b><a href="${page(P[i]!.h)}">${esc(P[i]!.h)}</a><span>${esc(fmtUsd(P[i]!.usd))}</span></div>` : "<div></div>";
    board = `<div class="ln-box"><p class="ln-bh"><span>Season ${d.season} final</span><a href="/leaderboard">Full ranking</a></p><div class="ln-pod">${cell(1)}${cell(0)}${cell(2)}</div><p class="ln-fine ln-podf">The three winners keep a Season ${d.season} badge. Season ${d.season + 1} starts tonight.</p></div>`;
  } else if (d.board.length) {
    board = `<div class="ln-box"><p class="ln-bh"><span>Season ${d.season}, week ${d.week}</span><a href="/leaderboard">Full ranking</a></p><ol class="ln-list">${d.board.map((r, i) => `<li><a class="ln-row s5" href="${page(r.h)}"><span class="rk">${r.rank}</span>${mv(r)}${av(r.h, i)}<span class="nm">${esc(r.h)}</span><span class="v">${esc(fmtUsd(r.usd))}</span></a></li>`).join("")}</ol></div>`;
  }
  let promo: string | null = null; try { promo = o.promo ? o.promo() : null; } catch { promo = null; }
  const fleet = promo || `<aside class="pr-card empty" aria-label="Built by the fleet"><p class="pr-eb">Built by the fleet</p><div class="pr-main"><span class="pr-t">This spot shows a member's own project.</span><span class="pr-l">Members earn Caldera Points in the battle and use them here. Points are never sold.</span></div><a class="btn small ghost" href="/points">How points work</a></aside>`;
  return `<section class="ln" id="battle" aria-labelledby="ln-h">
<div class="ln-head"><p class="ln-eb"><span class="ln-dot" aria-hidden="true"></span>${d.last ? "Last night's battle" : "Last battle"} / ${esc(date)}</p>${chip}</div>
<h2 id="ln-h">${head}</h2>
<p class="ln-sub">${sub}</p>
<div class="ln-grid"><div>
${stage}${cap}
${cta}
${fine}
</div><div>
${tops ? `<div class="ln-box"><p class="ln-bh"><span>Winners</span><span>Damage dealt</span></p><ol class="ln-list">${tops}</ol></div>` : ""}
${hard ? `<div class="ln-box"><p class="ln-bh"><span>Hit hardest</span><span>Damage taken</span></p><ol class="ln-list">${hard}</ol></div>` : ""}
${board}
</div></div>
${fleet}
</section>
<script>${HOME_BATTLE_JS.replace("__AUTO__", HOME_AUTO ? "1" : "0")}</script>`;
}

/** the homepage with the block in place of the marker (no data: the marker goes, the old explainer stays) */
export function homeBattle(html: string, data: HomeBattle | null, viewer: string | null, o: { promo?: () => string | null; now?: number } = {}): string {
  const MARK = "<!--home-battle-->";
  if (!html.includes(MARK)) return html;
  if (!data) return html.replace(MARK, "");
  const block = homeBattleBlock(data, viewer, o);
  return html.replace(MARK, () => block);
}

/** The small inline script (LOOP.md b.6): the countdown from the server's `next`, once a minute; the Play / Pause button and
 *  the muted in-place replay. With auto off, the replay starts only on the viewer's tap. No replay at all with reduced motion
 *  or Save-Data (the button stays hidden; "Watch the full replay" still opens the full replay). 3 loops, then the still. */
const HOME_BATTLE_JS = `(function(){var AUTO=__AUTO__;
var C=document.getElementById('ln-next');
if(C){var N=+C.getAttribute('data-next'),tk=function(){var ms=N-Date.now();if(ms<=0){C.className='ln-next run';C.setAttribute('role','status');C.removeAttribute('aria-label');C.innerHTML='<b>Battle running.</b> Results in a moment.';return}
var m=Math.max(1,Math.ceil(ms/6e4)),h=Math.floor(m/60),r=m%60,pl=function(n,w){return n+' '+w+(n===1?'':'s')};
C.classList.toggle('soon',m<60);C.querySelector('b').textContent=h?h+'h '+r+'m':m+'m';C.setAttribute('aria-label','Next battle in '+(h?pl(h,'hour')+(r?' '+pl(r,'minute'):''):pl(m,'minute')));setTimeout(tk,Math.min(6e4,ms%6e4||6e4))};tk()}
var S=document.getElementById('ln-stage'),B=document.getElementById('ln-pp'),T=document.getElementById('ln-capt'),M=document.getElementById('ln-mu');if(!S||!B||!T||!window.postMessage)return;
var rm=false;try{rm=matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}var sd=!!(navigator.connection&&navigator.connection.saveData);if(rm||sd)return;
var still=T.textContent,F=null,loops=0,seen=false,user=false,vis=true;B.hidden=false;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function who(h){h=String(h||'');return h==='Raiders'?'Sea raiders':h}
function btn(play){B.textContent=play?'Play':'Pause';B.setAttribute('aria-pressed',String(play))}
function send(t){try{if(F&&F.contentWindow)F.contentWindow.postMessage({type:t},location.origin)}catch(e){}}
function end(){if(F){F.remove();F=null}loops=0;seen=false;T.textContent=still;M.hidden=true;btn(true)}
function start(){if(F)return;F=document.createElement('iframe');F.className='ln-frame';F.title='Replay of the battle of '+(S.getAttribute('data-date')||'')+', muted';F.setAttribute('tabindex','-1');F.setAttribute('loading','lazy');F.setAttribute('scrolling','no');F.src='/world?view=battle&embed=1&replay=1';S.appendChild(F);M.hidden=false;btn(false);T.textContent='Replay, loading.'}
window.addEventListener('message',function(e){if(!F||e.source!==F.contentWindow||e.origin!==location.origin||!e.data)return;var d=e.data;
if(d.type==='caldera-strike'){if(!seen){seen=true;F.classList.add('on')}T.innerHTML=esc(d.i)+'/'+esc(d.n)+' <b>'+esc(who(d.a))+'</b> hit <b>'+esc(d.d)+'</b>, '+esc(d.k)+' missile'+(+d.k===1?'':'s');if(user||!vis)send('caldera-pause')}
else if(d.type==='caldera-end'){loops++;if(!seen||loops>=3)end();else send('caldera-play')}});
B.addEventListener('click',function(){if(!F){user=false;start();return}user=B.getAttribute('aria-pressed')!=='true';btn(user);send(user?'caldera-pause':'caldera-play')});
if('IntersectionObserver' in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting;if(!F)return;if(!vis)send('caldera-pause');else if(!user)send('caldera-play')}).observe(S);
if(AUTO){var go=function(){if(vis&&!F)start()};(window.requestIdleCallback||function(f){setTimeout(f,1500)})(go)}
})();`;
