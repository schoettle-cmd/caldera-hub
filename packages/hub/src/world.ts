/**
 * The World (caldera.social/world): every listed member's city as one neighborhood of a single map, drawn by the same
 * renderer as a member's own city (same buildings, cars and people, the viewer's time of day and weather).
 *
 * Built only from what is already public: each member's PUBLIC city (the data on their hosted city.html), re-cleaned
 * here so a private or locked building can never carry a name, link or history. Unlisted and moderated profiles never
 * appear. Live activity is the same coarse public projection a member's own public city gets, folded per member.
 */
import { fleetRow, mark, FLEET_CSS, FLEET_WORLD_CSS, FLEET_WORLD_JS, type FleetChip } from "./fleet";
import { mapPanel } from "./mapprompt";
import { WADD_CSS, WADD_HTML, WADD_JS } from "./frontierpage";
import { GROWTH_CSS, GROWTH_CLIENT_JS, GROWTH_HEAD_JS, growthMarkup } from "./growthclient";
import { BATTLE_CSS, BATTLE_CLIENT_JS, battleMarkup } from "./battleclient";
import { CITY_CSS, CITY_JS, cleanSites, scrubSignHosts, type CityData, type CityRepo } from "../../../../caldera/packages/plugin/src/city";

export interface WorldMemberIn {
  handle: string; name: string; headline: string; created: string; groups: string[]; friends: number;
  city: CityData | null; notes: number; busy: number;
  /** their top "what they're building" problem space (public GitHub signals), for Color by topic */
  tag?: string;
}
export interface WorldMember { handle: string; name: string; headline: string; isNew: boolean; groups: string[]; friends: number; city: string; page: string; tag?: string }
/** A ray: [@a, @b, kind (0 request/invite, 1 founder welcome, 2 shared repo, 3 GitHub follow, 4 same stack: not a
 *  friendship, their public repos share uncommon packages), why (repo, the follow, or the shared packages)]. */
export type WorldLink = [string, string, number, string?];
export interface World { at: string; members: WorldMember[]; city: CityData; links: WorldLink[]; start: string | null; topics?: { t: string; c: string; n: number }[] }
/** Color by topic: the most common problem spaces get a hue each (readable on the night map, distinct for color-blind
 *  viewers in the order used), everything else is "Other". The legend always names them, so color is never the only cue. */
const TOPIC_HUES = ["#A78BFA", "#2DD4BF", "#FBBF24", "#FB7185", "#38BDF8", "#A3E635", "#FB923C", "#E879F9", "#34D399"];

const MAX_PER_MEMBER = 30, MAX_BUILDINGS = 900, MAX_LINKS = 300, NEW_MS = 48 * 3600_000;
const str = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, n);

/** One building, re-cleaned: public repos keep name/link/history; anything else becomes a nameless padlocked block. */
export function cleanRepo(r: CityRepo, project: string): CityRepo {
  if ((r.kind === "app" || r.kind === "site") && r.public === true && r.name && !r.locked) {   // a listed app or website: a storefront, linking to the store or the site
    const url = typeof r.url === "string" && /^https?:\/\/[^\s"<>]{3,300}$/.test(r.url) && (r.kind === "site" || /^https:\/\/(apps\.apple\.com|play\.google\.com)\//.test(r.url)) ? r.url : undefined;
    const m = r.meta || {}, icon = typeof m.icon === "string" && /^https?:\/\/[^\s"<>]+\/v1\/listings\/img\/[A-Za-z0-9._%-]+$/.test(m.icon) ? m.icon : undefined;
    const sites = (Array.isArray(r.sites) ? r.sites : []).map(x => String(x).toLowerCase()).filter(x => /^[a-z0-9.-]+\.[a-z]{2,}(\/[a-z0-9._~%\/-]{1,120})?$/.test(x)).slice(0, 2);
    return { name: str(r.name, 60), project, public: true, language: r.kind === "app" ? "App" : "Web", commits: 0, weeks: [], week: 0, today: 0, url, kind: r.kind, ...(sites.length ? { sites } : {}),
      meta: { store: m.store === "play" ? "play" : m.store === "apple" ? "apple" : undefined, icon, host: m.host ? str(m.host, 120) : undefined, genre: m.genre ? str(m.genre, 40) : undefined, on: m.on ? str(m.on, 100) : undefined } };   // on: kept only if that building stands here by name (scrubSignHosts below)
  }
  const url = typeof r.url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(r.url) ? r.url : undefined;
  if (r.priv && !r.locked && r.name) {   // "named" private repo: name, language and activity, never a link or description
    return { name: str(r.name, 100), project, public: false, priv: true, language: str(r.language || "Other", 30), commits: Math.max(0, Math.round(Number(r.commits) || 0)),
      weeks: (Array.isArray(r.weeks) ? r.weeks : []).slice(-12).map(w => Math.max(0, Math.round(Number(w) || 0))), week: Math.max(0, Math.round(Number(r.week) || 0)), today: 0, ...siteList(r) };
  }
  if (r.locked || r.public !== true || !r.name) {
    return { name: "", project, public: false, locked: true, language: "Private", commits: Math.max(0, Math.round(Number(r.commits) || 0)), weeks: [], week: (Number(r.week) || 0) > 0 ? 1 : 0, today: 0 };
  }
  return { name: str(r.name, 100), project, public: true, language: str(r.language || "Other", 30), commits: Math.max(0, Math.round(Number(r.commits) || 0)),
    weeks: (Array.isArray(r.weeks) ? r.weeks : []).slice(-12).map(w => Math.max(0, Math.round(Number(w) || 0))), week: Math.max(0, Math.round(Number(r.week) || 0)), today: 0,
    pushed: typeof r.pushed === "string" && Date.parse(r.pushed) ? new Date(r.pushed).toISOString() : undefined, url, description: r.description ? str(r.description, 200) : undefined, ...siteList(r) };
}
const siteList = (r: CityRepo) => { const s = cleanSites(r.sites); return s ? { sites: s } : {}; };

/** Lay out the world: members ordered so groups cluster together and the newest sit at the edge. */
/** Closeness order (Mike 2026-11-02: "people that talk more on our platform, their plots become closer to each other").
 *  The world lays districts out in member order, so neighbours in the list are neighbours in the city.
 *  ties: "a|b" (handles, sorted) -> weight. base: today's default order. prev: last night's order (stability).
 *  Greedy chain: the founder first (the hub at the centre), then whoever is most tied to the last few placed; people with
 *  no ties keep their place; each member moves at most maxShift places per run. Deterministic. */
export function closenessOrder(base: string[], ties: Map<string, number>, founder: string | null, prev: string[] | null, maxShift = 4): string[] {
  const w = (a: string, b: string) => ties.get(a < b ? a + "|" + b : b + "|" + a) || 0;
  const deg = new Map<string, number>(); for (const [k, v] of ties) for (const h of k.split("|")) deg.set(h, (deg.get(h) || 0) + v);
  const pIdx = new Map((prev || []).map((h, i) => [h, i] as [string, number])), bIdx = new Map(base.map((h, i) => [h, i] as [string, number]));
  const rankOf = (h: string) => pIdx.has(h) ? pIdx.get(h)! : 1e6 + bIdx.get(h)!;
  const connected = base.filter(h => (deg.get(h) || 0) > 0);
  const placed: string[] = [], left = new Set(connected);
  const take = (h: string) => { placed.push(h); left.delete(h); };
  if (founder && left.has(founder)) take(founder);
  while (left.size) {
    const recent = placed.slice(-3);
    let best: string | null = null, bs = -1;
    for (const h of left) { const sc = recent.reduce((t, r) => t + w(h, r), 0); if (sc > bs || (sc === bs && best !== null && (rankOf(h) < rankOf(best)))) { best = h; bs = sc; } }
    if (bs <= 0) { best = [...left].sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0) || rankOf(a) - rankOf(b))[0]!; }
    take(best!);
  }
  // desired slots: the connected chain takes the slots the connected members held, in chain order; strangers stay put
  const slots = base.map((h, i) => ({ h, key: rankOf(h) === 1e6 + i ? 1e6 + i : rankOf(h) }));
  const cSlots = slots.filter(x => (deg.get(x.h) || 0) > 0).map(x => x.key).sort((a, b) => a - b);
  const key = new Map<string, number>();
  for (const x of slots) if (!((deg.get(x.h) || 0) > 0)) key.set(x.h, x.key);
  placed.forEach((h, i) => { const want = cSlots[i]!, from = rankOf(h); key.set(h, from >= 1e6 ? want : Math.max(from - maxShift - 0.5, Math.min(from + maxShift + 0.5, want))); });
  return [...base].sort((a, b) => key.get(a)! - key.get(b)! || bIdx.get(a)! - bIdx.get(b)!);
}

export function buildWorld(members: WorldMemberIn[], friendships: ([string, string] | [string, string, string?, string?])[], founder: string | null, hub: string, now = Date.now(), orderHint?: string[]): World {
  const base = hub.replace(/\/$/, "");
  const isNew = (m: WorldMemberIn) => now - Date.parse(m.created) < NEW_MS;
  const order = [...members].sort((a, b) => Number(isNew(a)) - Number(isNew(b))
    || (a.groups[0] || "￿").localeCompare(b.groups[0] || "￿")
    || b.busy - a.busy || a.handle.localeCompare(b.handle));
  if (orderHint && orderHint.length) { const oi = new Map(orderHint.map((h, i) => [h, i] as [string, number])); order.sort((a, b) => (oi.has(a.handle) ? oi.get(a.handle)! : 1e9) - (oi.has(b.handle) ? oi.get(b.handle)! : 1e9)); }   // closeness, computed nightly
  // each member keeps their own districts (the same public projects their own city shows; private ones are already
  // merged into one "Private" district there), so the world can label them. Buildings are capped per member.
  let left = MAX_BUILDINGS;
  const districts: { name: string; label: string; nb: string; notes: number; repos: CityRepo[] }[] = [];
  for (const m of order) {
    const key = "@" + m.handle, src = m.city?.districts || [];
    const ranked = src.flatMap((d, di) => (d.repos || []).map(r => ({ di, r: cleanRepo(r, key) })));
    // storefronts (apps and websites the member listed) always make the cut: they have no commits, but they're what the member chose to show
    const score = (r: CityRepo) => (r.kind ? 1e12 : 0) + r.week * 20 + r.commits;
    ranked.sort((a, b) => score(b.r) - score(a.r));
    const keep = ranked.slice(0, Math.max(0, Math.min(MAX_PER_MEMBER, left))); left -= keep.length;
    const notesLeft = { n: Math.min(16, Math.max(0, m.notes)) };
    src.forEach((d, di) => {
      const repos = keep.filter(k => k.di === di).map(k => k.r);
      if (!repos.length) return;
      const label = str(d.name, 60) || "Private";   // the member's own public city already names only public projects
      const k = key + "/" + label;
      const prev = districts.find(x => x.name === k);
      for (const r of repos) r.project = k;
      if (prev) { prev.repos.push(...repos); return; }
      const notes = Math.min(notesLeft.n, Math.max(0, Number((d as any).notes) || 0)); notesLeft.n -= notes;
      districts.push({ name: k, label, nb: key, notes, repos });
    });
    if (!src.length || !keep.length) districts.push({ name: key + "/Notes", label: "Notes", nb: key, notes: Math.min(16, Math.max(0, m.notes)) || 4, repos: [] });
  }
  const listed = new Set(members.map(m => m.handle)), seen = new Set<string>(), links: WorldLink[] = [];
  for (const [a, b, kind, why] of friendships as [string, string, string?, string?][]) {
    if (!listed.has(a) || !listed.has(b) || a === b) continue;
    const k = a < b ? a + "|" + b : b + "|" + a; if (seen.has(k)) continue; seen.add(k);
    // kind from the friends table; without it (older callers) a link touching the founder counts as a welcome link
    const n = kind === "stack" ? 4 : kind === "repo" ? 2 : kind === "github" ? 3 : kind === "founder" ? 1 : kind ? 0 : founder && (a === founder || b === founder) ? 1 : 0;
    links.push((n === 2 || n === 3 || n === 4) && why ? ["@" + a, "@" + b, n, String(why).slice(0, 140)] : ["@" + a, "@" + b, n]);
  }
  links.sort((x, y) => (x[2] === 1 ? 1 : 0) - (y[2] === 1 ? 1 : 0));   // real and shared-repo friendships first, the founder's welcome links after (and fainter)
  const all = districts.flatMap(d => d.repos);
  const busiest = [...members].sort((a, b) => b.busy - a.busy)[0];
  return {
    at: new Date(now).toISOString(),
    members: order.map(m => ({ handle: m.handle, name: str(m.name, 80), headline: str(m.headline, 160), isNew: isNew(m), groups: m.groups.slice(0, 8), friends: m.friends, ...(m.tag ? { tag: str(m.tag, 32) } : {}),
      city: m.city ? `${base}/@${m.handle}/city.html` : `${base}/@${m.handle}/`, page: `${base}/@${m.handle}/` })),
    city: { generated: new Date(now).toISOString(), districts: scrubSignHosts(districts as any) as typeof districts, private: false, totals: { commits: all.reduce((s, r) => s + r.commits, 0), active: all.filter(r => r.week > 0).length } },
    links: links.slice(0, MAX_LINKS),
    topics: (() => { const n = new Map<string, number>(); for (const m of members) if (m.tag) n.set(m.tag, (n.get(m.tag) || 0) + 1);
      return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOPIC_HUES.length).map(([t, k], i) => ({ t: str(t, 32), c: TOPIC_HUES[i]!, n: k })); })(),
    start: busiest && busiest.busy > 0 ? "@" + busiest.handle : order.length ? "@" + order[0].handle : null,
  };
}

/** Agent state priority, most active first: the order agents are listed and cut in (hub live feed and the World). */
export const AGENT_RANK: Record<string, number> = { working: 0, thinking: 1, waiting: 2, idle: 3 };
export const agentRank = (state: unknown) => AGENT_RANK[String(state)] ?? 4;

/** Public live activity folded per member: activity level, coarse arrivals, today's coarse counts, agents (no ids). */
export function foldLive(per: { handle: string; live: any }[], at: string) {
  const out: any = { at, districts: {}, agents: [], arrivals: {}, today: {}, left: {} };
  let anyArr = false;
  for (const { handle, live } of per) {
    if (!live) continue; const k = "@" + handle;
    const lv = Object.values(live.districts || {}).reduce((m: number, d: any) => Math.max(m, Number(d?.level) || 0), 0);
    const gl = Object.values(live.districts || {}).reduce((m: number, d: any) => Math.max(m, Number(d?.glow) || 0), 0);
    const st: Record<string, number> = {};
    for (const d of Object.values(live.districts || {}) as any[]) for (const [h, g] of Object.entries(d?.sites || {})) if (Object.keys(st).length < 24) st[h] = Math.max(st[h] || 0, Number(g) || 0);
    out.districts[k] = { level: lv, glow: gl, ...(Object.keys(st).length ? { sites: st } : {}) };
    // the 20 shown per member are the most active ones (working first, then thinking, waiting, idle, done; newest first
    // within a state, as the feed already lists them): the renderer's "+n parked" badge carries the rest
    const ags = Array.isArray(live.agents) ? live.agents.map((a: any, i: number) => [a, i] as [any, number]).sort((x, y) => agentRank(x[0]?.state) - agentRank(y[0]?.state) || x[1] - y[1]).map(x => x[0]) : [];
    for (const a of ags.slice(0, 20)) out.agents.push({ id: String(a.id || "").slice(0, 10) + handle.slice(0, 4), d: k, state: a.state });
    if (live.arrivals) { anyArr = true; const x = out.arrivals[k] = { v: 0, s: 0, b: 0 }; for (const v of Object.values(live.arrivals) as any[]) { x.v += +v.v || 0; x.s += +v.s || 0; x.b += +v.b || 0; } }
    for (const t of Object.values(live.today || {}) as any[]) {
      const y = out.today[k] ||= { v: 0, q: Array(96).fill(0), t0: t.t0 };
      y.v += +t.v || 0; (t.q || []).forEach((n: number, i: number) => { if (i < 96) y.q[i] += +n || 0; });
    }
    const lf = Object.values(live.left || {}).reduce((s: number, n: any) => s + (+n || 0), 0); if (lf) out.left[k] = lf;
  }
  if (!anyArr) delete out.arrivals;
  return out;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** The world page: the city renderer in world mode, with the site's own look around it. */
/** Mike 11-18 ("ui ux issue here overlap"): the city card opened under the battle status pill and the tools, hiding the
 *  name line. While a card is open (not the bottom sheet), it starts below every overlay at the top of the map that shares
 *  its column (the pill, the tool chips; any width, Duo and phone included) and its height stops above any overlay at the bottom (the pill on a phone). Status banners
 *  (new land) count too; passing toasts step aside while a card is open, so nothing lies over the name line. */
export const CARD_CLEAR_JS = String.raw`(function(){var st=document.getElementById('stage'),cd=document.getElementById('card');if(!st||!cd)return;var busy=false;var ss=document.createElement('style');ss.textContent='.c-stage.w-card-open .c-toasts{display:none}';document.head.appendChild(ss);
function lay(){if(busy)return;busy=true;try{cd.style.top='';cd.style.maxHeight='';st.classList.toggle('w-card-open',!cd.hidden);if(cd.hidden||cd.classList.contains('is-sheet')||getComputedStyle(cd).position==='fixed')return;
var S=st.getBoundingClientRect(),C=cd.getBoundingClientRect(),y=C.top-S.top,lim=S.height*.45,yb=S.height-10;
st.querySelectorAll('.b-chip,.w-mode,.w-of-chip,.c-tools,.c-tools button,#stage > [role=status]').forEach(function(e){var cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0)return;var r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0))return;
  var top=r.top-S.top,bot=r.bottom-S.top;if(r.right<=C.left||r.left>=C.right)return;if(top>lim){if(top-8<yb)yb=top-8;return}if(bot+8>y)y=bot+8});
if(y>C.top-S.top+.5)cd.style.top=Math.round(y)+'px';if(y>C.top-S.top+.5||yb<S.height-10||C.bottom-S.top>yb)cd.style.maxHeight=Math.max(120,Math.round(yb-y))+'px'}finally{busy=false}}
new MutationObserver(lay).observe(st,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});addEventListener('resize',lay);setInterval(lay,1000);lay()})();`;

/** Map audit 11-20 (PAGE.md section 4, step 11): the map's height leaves the top of the battle deck on the first screen.
 *  With the app's bottom tab bar (601px+ wide in the old rule; now 700px+, the M and L sizes) the map runs from where it
 *  starts down to the tab bar, less 58px in Battle mode (the 8px gap and 50px of the Tonight card stay above the bar) or
 *  10px in World mode (380px at least; if less is left, it fills the screen under the top bar and the page scrolls to it).
 *  Under 700px the CSS rules alone set the height. The header is one row now, so the old one-line-intro rule is gone. */
export const WORLD_FIT_JS = String.raw`(function(){var st=document.getElementById('stage');if(!st)return;var R=document.documentElement;
function bar(){var b=document.querySelector('.ch-bn');if(!b)return 0;var cs=getComputedStyle(b);if(cs.display==='none'||cs.position!=='fixed')return 0;var r=b.getBoundingClientRect();return r.top>innerHeight*.5?innerHeight-r.top:0}
function fitH(){if(st.classList.contains('c-full'))return;var bb=bar();if(!bb||innerWidth<700){if(st.style.height){st.style.height='';dispatchEvent(new Event('resize'))}return}
  var top=st.getBoundingClientRect().top+scrollY,nav=document.querySelector('.ch,header.nav'),nh=nav?nav.getBoundingClientRect().height:0,deck=R.classList.contains('w-battle')?58:10,h=Math.round(innerHeight-top-bb-deck);
  if(h<380)h=Math.round(innerHeight-nh-bb-16);h=Math.max(300,h)+'px';if(st.style.height!==h){st.style.height=h;dispatchEvent(new Event('resize'))}}
var T=0;function later(){clearTimeout(T);T=setTimeout(fitH,120)}addEventListener('resize',later);
var wb=R.classList.contains('w-battle');new MutationObserver(function(){var b=R.classList.contains('w-battle');if(b!==wb){wb=b;later()}}).observe(R,{attributes:true,attributeFilter:['class']});
setTimeout(fitH,50);setTimeout(fitH,800)})();`;

/** D4 (Mike 11-20, DESIGN.md item 3, PAGE.md step 12): the time views leave the page header. World | Battle is a switch at the
 *  map's top left; Now / Day / Week / Month is the "Time" row of the Layers panel (the renderer moves .c-lrow rows from the
 *  toolbar into Layers). growthclient.ts drives both ([data-gmode], [data-gview]); ?view= links work as before. */
export const MODE_HTML = `<div class="w-mode" role="group" aria-label="Map mode"><button type="button" data-gmode="world" aria-pressed="true">World</button><button type="button" data-gmode="battle" aria-pressed="false">Battle</button></div>`;
export const TIME_HTML = `<div class="c-lrow w-time" role="group" aria-labelledby="w-time-l"><span id="w-time-l">Time</span><span class="w-seg"><button type="button" data-gview="now" aria-pressed="true">Now</button><button type="button" data-gview="day" aria-pressed="false">Day</button><button type="button" data-gview="week" aria-pressed="false">Week</button><button type="button" data-gview="month" aria-pressed="false">Month</button></span></div>`;

const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>`;

/** Map audit 11-20 (PAGE.md sections 3, 4, 5d, Fable mockups 06-08): the page shell around the map. One header row
 *  (title, time switch, one sentence, "How battles work", "Add a friend"), the map's height, the Extras row and the legend
 *  sheet. Sizes: L 900px+, M 700 to 899px (dense on purpose), S under 700px. */
export const WORLD_CSS = String.raw`.w-main{max-width:none;margin:0;padding:0 20px 32px}
.w-head{display:flex;flex-wrap:nowrap;align-items:center;gap:14px;box-sizing:border-box;height:54px;padding:10px 0 8px;margin:0;min-width:0}
.w-head h1{font:600 24px/1.1 'Source Serif 4',Georgia,serif;margin:0;white-space:nowrap;flex:none;color:var(--text-strong,#F4F6FA)}
.w-mode{position:absolute;left:12px;top:12px;z-index:7;display:inline-flex;gap:2px;padding:2px;box-sizing:border-box;height:32px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(10,12,18,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.w-mode button{position:relative;min-width:52px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:rgba(244,246,250,.8);font:600 12.5px/1 'IBM Plex Sans',sans-serif;cursor:pointer}
.w-mode button::before{content:"";position:absolute;left:0;right:0;top:-7px;bottom:-7px}
.w-mode button[aria-pressed="true"]{background:#F4F6FA;color:#0B0D13}.w-mode button:focus-visible,.w-time button:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.w-main .c-stage:has(.w-mode) .w-topics{top:52px}
html.w-battle .w-main .c-stage:has(.w-mode) .b-chip{left:136px;top:12px;max-width:calc(100% - 300px)}
html.w-replay .w-mode,html.w-replay .w-main .g-today{display:none}
.c-more>.w-time{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 4px 0 10px;font:500 12px 'IBM Plex Mono',monospace;color:#BFF8FF}
.w-time>span:first-child{min-width:64px;opacity:.65}.w-time .w-seg{display:inline-flex;gap:1px;padding:2px;border-radius:8px;background:rgba(255,255,255,.06)}
.w-time .w-seg button{height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:#BFF8FF;font:500 12px 'IBM Plex Mono',monospace;cursor:pointer}
.w-time .w-seg button[aria-pressed="true"]{background:#F4F6FA;color:#0B0D13}
.c-tools>.w-time{display:none}
.w-main .c-tools.c-3{left:auto}   /* three buttons on the right only: the World | Battle switch at the left stays tappable */
.w-sent{display:flex;align-items:baseline;gap:.4em;margin:0;flex:1 1 auto;min-width:0;font:400 13.5px/1.3 'IBM Plex Sans',sans-serif;color:rgba(244,246,250,.68)}
.w-s-txt{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.w-sent a{flex:none;white-space:nowrap;color:#F4F6FA;text-decoration:underline;text-underline-offset:3px}
.w-addw{position:relative;flex:none;margin-left:auto}
.w-addb{position:relative;display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#F4F6FA;font:600 13px/1 'IBM Plex Sans',sans-serif;white-space:nowrap;cursor:pointer}
.w-addb:hover,.w-addb[aria-expanded="true"]{border-color:rgba(255,255,255,.3);background:rgba(255,255,255,.05)}.w-addb svg{width:16px;height:16px;flex:none}
.w-head :is(a,button):focus-visible,.w-addp :is(a,button,input):focus-visible,.w-extras :is(a,button):focus-visible,.w-lgd :is(a,button):focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.w-addp{position:absolute;right:0;top:calc(100% + 8px);z-index:70;width:320px;box-sizing:border-box;display:grid;gap:10px;padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:#181B23;box-shadow:0 16px 40px rgba(0,0,0,.5);text-align:left;white-space:normal;color:#F4F6FA}
.w-addp[hidden]{display:none}.w-addp h2{font:600 14px/1.3 'IBM Plex Sans',sans-serif;margin:0;color:#F4F6FA}
.w-addp .w-add{gap:10px}.w-addp .w-add-f{flex-direction:column;gap:10px}
.w-addp .w-add-in input{min-height:40px;border-radius:10px;border-color:rgba(255,255,255,.14);background:#0B0D13;font-size:13.5px}
.w-addp .w-add-b{min-height:40px;border-radius:20px;background:#8B6CF6;color:#fff;font-size:13.5px}
.w-addp .w-add-h{font-size:12.5px;line-height:1.45;color:rgba(244,246,250,.68)}
.w-addp .w-add-so{display:grid;gap:10px}.w-addp .w-add-so[hidden]{display:none}.w-addp .w-add-so p{margin:0;font-size:12.5px;color:rgba(244,246,250,.68)}
.w-addp a.w-add-b{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
@media (prefers-reduced-motion:no-preference){.w-addp:not([hidden]),.w-lgd:not([hidden]){animation:w-in .14s ease-out}@keyframes w-in{from{opacity:0;transform:translateY(-4px)}}}
.w-main .c-stage:not(.c-full){height:calc(100vh - 130px);height:calc(100svh - 130px);min-height:460px}
html.w-battle .w-main .c-stage:not(.c-full){height:calc(100vh - 200px);height:calc(100svh - 200px);min-height:460px}
.w-extras{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0 0}
.w-exh{grid-column:1/-1;font:600 10px/1 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:rgba(244,246,250,.44);margin:0 2px -4px}
.w-ex{display:flex;align-items:center;gap:10px;box-sizing:border-box;min-height:44px;padding:10px 12px;border:1px solid rgba(255,255,255,.09);border-radius:10px;color:rgba(244,246,250,.68);font:400 12.5px/1.4 'IBM Plex Sans',sans-serif}
.w-ex b{color:#F4F6FA;font-weight:600}.w-ex>span{flex:1;min-width:0}
.w-ex-a{position:relative;flex:none;display:inline-flex;align-items:center;min-height:24px;padding:0;border:0;background:none;color:#F4F6FA;font:500 12.5px/1 'IBM Plex Sans',sans-serif;text-decoration:underline;text-underline-offset:3px;white-space:nowrap;cursor:pointer}
.w-ex-a::before{content:"";position:absolute;left:-8px;right:-8px;top:-10px;bottom:-10px}
.mp.mp-x{margin:10px 0 0}.mp.mp-x:not([open]),.mp.mp-x>summary{display:none}.mp.mp-x>.mp-body{padding-top:16px}
.w-lgd{position:fixed;z-index:80;right:12px;top:12px;bottom:12px;width:min(400px,calc(100% - 24px));box-sizing:border-box;overflow:auto;overscroll-behavior:contain;padding:16px 18px 20px;background:#14171E;color:rgba(244,246,250,.82);border:1px solid rgba(255,255,255,.14);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.55);font:13.5px/1.55 'IBM Plex Sans',sans-serif}
.w-lgd[hidden]{display:none}.w-lgd:focus{outline:none}
.w-lgd h2{font:600 17px/1.25 'IBM Plex Sans',sans-serif;color:#F4F6FA;margin:0 44px 8px 0}.w-lgd h3{font:600 13.5px/1.3 'IBM Plex Sans',sans-serif;color:#F4F6FA;margin:14px 0 4px}
.w-lgd p{margin:0 0 8px}.w-lgd ul{margin:0;padding:0;list-style:none;display:grid;gap:6px}.w-lgd li{display:flex;align-items:baseline;gap:8px}.w-lgd a{color:#F4F6FA;text-underline-offset:3px}
.w-lgd i{flex:none;display:inline-block;width:18px;height:4px;border-radius:2px;align-self:center;background:linear-gradient(90deg,#B98CFF,#FFC46B,#B98CFF);box-shadow:0 0 6px rgba(200,160,255,.8)}.w-lgd i.w-lg-stack{background:repeating-linear-gradient(90deg,#FF7A96 0 4px,transparent 4px 7px);box-shadow:none}
.w-lgd-x{position:absolute;right:6px;top:6px;width:44px;height:44px;border:0;border-radius:50%;background:transparent;color:#C9D2E6;font-size:22px;cursor:pointer}
@media (min-width:700px) and (max-width:899px){.w-mode{left:8px;top:8px}html.w-battle .w-main .c-stage:has(.w-mode) .b-chip{left:128px;top:8px;max-width:calc(100% - 260px)}.w-main{padding:0 12px 28px}.w-head{height:36px;padding:3px 0;gap:10px}.w-head h1{font-size:17px}.w-sent{font-size:11.5px}.w-xl{display:none}
  .w-addb{height:28px;padding:0 11px;font-size:11.5px}.w-addb::before{content:"";position:absolute;left:0;right:0;top:-8px;bottom:-8px}
  .w-main .c-stage:not(.c-full){height:calc(100vh - 150px);height:calc(100svh - 150px);min-height:460px}html.w-battle .w-main .c-stage:not(.c-full){height:calc(100vh - 212px);height:calc(100svh - 212px);min-height:380px}
  .w-extras{gap:8px;margin-top:14px}.w-ex{min-height:36px;padding:6px 10px;font-size:11px}.w-ex-a{font-size:11px}}
@media (max-width:699px){.w-main{padding:0 12px 28px}.w-main .w-maps{margin:0 -4px}
  .w-head{height:44px;padding:2px 0;gap:10px}.w-head h1{font-size:19px;line-height:40px}
  .w-mode{left:8px;top:8px}.w-mode button{min-width:56px}html.w-battle .w-main .c-stage:has(.w-mode) .b-chip{left:12px;top:52px;bottom:auto}   /* BATTLE.md U2 (Fable 11-24): on a phone the chip sits under the switch; the bottom edge is for the Replay button (the new-land note moves above it) */
  .c-more>.w-time{min-height:44px}.w-time .w-seg button{height:36px;padding:0 9px}
  .w-sent{flex:1 1 120px;justify-content:flex-end;font-size:13px}.w-s-txt{display:none}.w-sent a{display:inline-flex;align-items:center;min-height:44px}
  .w-addb{width:44px;height:40px;padding:0;justify-content:center;border-radius:10px}.w-addb span{display:none}
  .w-addp{position:fixed;left:0;right:0;bottom:0;top:auto;width:auto;z-index:95;border-radius:16px 16px 0 0;border-width:1px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px))}
  .w-addp .w-add-in input,.w-addp .w-add-b{min-height:44px}.w-addp .w-add-b{border-radius:22px}
  .w-main .c-stage:not(.c-full){height:calc(100vh - 190px);height:calc(100svh - 190px);min-height:400px}html.w-battle .w-main .c-stage:not(.c-full){height:calc(100vh - 228px);height:calc(100svh - 228px);min-height:400px}
  .w-extras{grid-template-columns:1fr;gap:10px}
  .w-lgd{left:0;right:0;top:auto;bottom:0;width:auto;max-height:72vh;border-radius:16px 16px 0 0;border-width:1px 0 0;padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))}}
`;

/** "What am I looking at?" (PAGE.md section 2, rows 7, 8 and 30): the legend line and the long intro paragraphs live here
 *  now. It opens from the Layers panel (the #t-what button, which the renderer moves into Layers). */
export function legendSheet(n: number, b: number, growth: boolean): string {
  return `<aside class="w-lgd" id="w-lgd" role="dialog" aria-labelledby="w-lgd-t" tabindex="-1" hidden><button type="button" class="w-lgd-x" aria-label="Close" title="Close">&times;</button>`
    + `<h2 id="w-lgd-t">What am I looking at?</h2><p>${n.toLocaleString("en-US")} cit${n === 1 ? "y" : "ies"} and ${b.toLocaleString("en-US")} building${b === 1 ? "" : "s"} on one map. Each city is one member's work.</p>`
    + `<ul><li><i aria-hidden="true"></i><span>Rays of light are friendships.</span></li><li><i class="w-lg-stack" aria-hidden="true"></i><span>Dashed coral lines: builds with a similar stack.</span></li>`
    + `<li><span aria-hidden="true">&#128274;</span><span>Padlocked buildings are private repos: size only, never names.</span></li>`
    + `<li><span aria-hidden="true">&#10022;</span><span>Light up a city you like: one gift a day.</span></li>`
    + `<li><span aria-hidden="true">&rarr;</span><span>Click a name to fly there, and again to walk in.</span></li>`
    + `<li><span aria-hidden="true">&middot;</span><span>Only people listed in <a href="/people">People</a> appear.</span></li></ul>`
    + (growth ? `<h3>Growth from code</h3><p>Every day's commits, merged PRs and releases earn build points, and each plot spends them on land, one lot at a time (zoned, graded, framed, built). Purple outlines are new in this window. Recent daily work and AI projects grow fastest. Land is never lost, it weathers.</p>` : "")
    + `</aside>`;
}

/** The old Battle paragraph (PAGE.md section 2, row 6): now the first paragraph of the "How battles work" sheet. */
export const BATTLE_INTRO = "Cities at war: every city in the battles has an ammo pad in front of its buildings. At noon on your clock, that day's real code drops from the sky as missiles and stacks on the pad. Through the afternoon they load into the launch center. At 20:00 every city fires at once, and the hits land on rival repo towers. From midnight to noon the cranes rebuild them, whole by noon. Every city with buildings is in, and you can leave or rejoin at any time. Damage shows only on this map: land and data are never touched.";

/** The shell's behaviour: the Add a friend popover (Esc and a tap outside close it, focus goes to the field and back to
 *  the button, signed-out content, #add opens it), the "How battles work" link (opens the battle client's sheet through its
 *  [data-bhow] opener or window.CALDERA_BATTLE_HOW, and puts BATTLE_INTRO first in it), the legend sheet and the Extras
 *  "Open" button for the Power up panel. */
export const WORLD_UI_JS = String.raw`(function(){
var W=document.querySelector('.w-addw');if(W){var B=W.querySelector('.w-addb'),P=document.getElementById('w-addp'),F=document.getElementById('w-add'),SO=P&&P.querySelector('.w-add-so'),hb=document.getElementById('caldera-bar');
  if(SO&&hb&&hb.getAttribute('data-state')==='out'){SO.hidden=false;if(F)F.hidden=true}
  var pop=function(on,back){if(!P)return;P.hidden=!on;B.setAttribute('aria-expanded',String(on));if(on){var x=(F&&!F.hidden&&F.querySelector('input'))||P.querySelector('a,button,input');if(x)try{x.focus({preventScroll:true})}catch(e){x.focus()}}else if(back)B.focus()};
  B.addEventListener('click',function(){pop(P.hidden,false)});
  document.addEventListener('pointerdown',function(e){if(P&&!P.hidden&&!W.contains(e.target))pop(false,false)});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&P&&!P.hidden){pop(false,true)}});
  if(P)P.addEventListener('click',function(e){var v=e.target.closest&&e.target.closest('[data-view]');if(v&&window.CALDERA_FRONTIER_FOCUS)setTimeout(function(){pop(false,false)},0)});
  window.CALDERA_WADD_OPEN=function(){pop(true)};if(location.hash==='#add')setTimeout(function(){pop(true)},0)}
var INTRO=${JSON.stringify(BATTLE_INTRO)};
function intro(){var hb2=document.querySelector('.b-how .b-hb');if(!hb2||hb2.querySelector('.w-how-in'))return;var p=document.createElement('p');p.className='b-lede w-how-in';p.textContent=INTRO;var h=hb2.querySelector('h2');hb2.insertBefore(p,h?h.nextSibling:hb2.firstChild)}
var HO=null;new MutationObserver(function(){var a=document.querySelector('.b-how');if(a&&a!==HO){HO=a;new MutationObserver(intro).observe(a,{childList:true,subtree:true})}intro()}).observe(document.body,{childList:true});
var HA=document.querySelector('[data-whow]');if(HA)HA.addEventListener('click',function(e){var o=document.querySelector('[data-bhow]');if(typeof window.CALDERA_BATTLE_HOW==='function'){e.preventDefault();window.CALDERA_BATTLE_HOW()}else if(o){e.preventDefault();o.click()}else return;intro()});
var L=document.getElementById('w-lgd'),LB=null;if(L){var lclose=function(){if(L.hidden)return;L.hidden=true;if(LB)try{LB.focus()}catch(e){}};L.querySelector('.w-lgd-x').onclick=lclose;
  document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('#t-what');if(!t)return;LB=t;if(!L.hidden)return lclose();L.hidden=false;try{L.focus({preventScroll:true})}catch(x){}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')lclose()})}
var X=document.querySelector('[data-wpu]'),MP=document.getElementById('power-up');if(X&&MP){var sync=function(){X.setAttribute('aria-expanded',String(MP.open));X.textContent=MP.open?'Close':'Open'};
  X.addEventListener('click',function(){MP.open=!MP.open;sync();if(MP.open){var c=MP.querySelector('.mp-copy');if(c)try{c.focus({preventScroll:true})}catch(e){}}});MP.addEventListener('toggle',sync);sync()}
})();`;
/** embed (LOOP.md b.6): only the map fills the frame. No header, deck, replay bar, tray, chip, map tools, Replay pill or
 *  extras; no pointer actions (keys and sound: battleclient.ts, CALDERA_EMBED) */
const EMBED_CSS = `html.w-embed,html.w-embed body{margin:0;height:100%;overflow:hidden;background:#0B0D13}
html.w-embed,html.w-embed *{pointer-events:none!important}
html.w-embed body>:not(main){display:none!important}
html.w-embed main.w-main{padding:0!important;margin:0!important;max-width:none!important}
html.w-embed main.w-main>:not(.w-maps){display:none!important}
html.w-embed .w-maps>:not(.c-stage){display:none!important}
html.w-embed .w-maps .c-stage{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;min-height:0!important;margin:0!important;border:0!important;border-radius:0!important}
html.w-embed .c-stage>:not(canvas){display:none!important}`;
export function worldPage(w: World, o: { hub: string; nav: string; tools?: unknown[]; growth?: unknown | null; battle?: unknown | null; frontier?: { districts: any[]; meta: Record<string, any>; fs?: Record<string, { slot: number; by: string | null }> } | null;
  /** the Orpheus fleet (fleet.ts), newest link first: listed members only; viewer = the signed-in handle (the ref on Try Orpheus free) */
  fleet?: FleetChip[]; viewer?: string | null;
  /** LOOP.md b.6: the homepage block's muted in-place replay (/world?view=battle&embed=1&replay=1): only the map */ embed?: boolean }): string {
  const G = o.growth || null, BT = G ? o.battle || null : null;
  const hub = o.hub.replace(/\/$/, ""), n = w.members.length, b = w.city.districts.reduce((s, d) => s + d.repos.length, 0);
  // Frontier lands (frontier.ts) ride along as fogged districts on the world's edge (uc: 1), with their card facts in world.uc
  const FD = (o.frontier?.districts || []).filter(d => !w.members.some(m => "@" + m.handle.toLowerCase() === String(d.nb).toLowerCase()));
  // the fleet: members on this map only; orph on the member data draws the pin (1, 2 = Founding Fleet)
  const FL = (o.fleet || []).filter(f => w.members.some(m => m.handle.toLowerCase() === f.handle.toLowerCase()));
  const OL = new Map(FL.map(f => [f.handle.toLowerCase(), f.founding ? 2 : 1]));
  const data = { ...w.city, districts: [...w.city.districts, ...FD], openBase: "", world: { m: Object.fromEntries(w.members.map(m => ["@" + m.handle, OL.has(m.handle.toLowerCase()) ? { ...m, orph: OL.get(m.handle.toLowerCase()) } : m])), links: w.links, start: w.start, topics: w.topics || [], uc: o.frontier?.meta || {}, fr: o.frontier ? 1 : 0, fs: Object.fromEntries(Object.entries(o.frontier?.fs || {}).filter(([k]) => w.members.some(m => "@" + m.handle === k))) } };
  const EMB = !!o.embed && !!BT;
  return `<!doctype html><html lang="en"${EMB ? ' class="w-embed"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Caldera world: every member's city on one map</title>${EMB ? `<meta name="robots" content="noindex"><script>window.CALDERA_EMBED=1</script><style>${EMBED_CSS}</style>` : ""}
<meta name="description" content="Every Caldera member's GitHub and Obsidian city on one live map: ${n} neighborhoods, ${b} buildings, friendships as highways.">
<meta property="og:title" content="The Caldera world"><meta property="og:description" content="Every member's city on one live map."><meta property="og:image" content="${esc(hub)}/og.jpg"><meta property="og:url" content="${esc(hub)}/world">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="canonical" href="${esc(hub)}/world">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap">
${BT ? `<script>window.CALDERA_BATTLE_ON=1</script>` : ""}${G ? `<script>${GROWTH_HEAD_JS}</script>` : ""}
<link rel="stylesheet" href="/assets/theme.css"><link rel="stylesheet" href="/assets/site.css"><style>${CITY_CSS}${G ? GROWTH_CSS : ""}${BT ? BATTLE_CSS : ""}
${WORLD_CSS}${FL.length ? FLEET_CSS + "\n" + FLEET_WORLD_CSS + "\n" : ""}@media (max-width:600px){.w-main .c-tools{flex-wrap:wrap;justify-content:flex-end;left:8px;right:8px;gap:4px}.w-main .c-tools button{padding:5px 8px}}
.w-main .c-stage.c-full{height:100%;min-height:0}
@media (max-width:600px){html.w-battle .w-main .c-live{display:none}.w-main .b-chip{font-size:11px;gap:6px;padding:6px 10px 6px 8px}}
.w-main .b-chip b{flex:none}.w-main .b-chip span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.w-main .b-me .b-small{line-height:1.45}.w-main .b-me .b-link{min-height:0;padding:7px 0;margin:-7px 0;vertical-align:baseline}.w-main .b-board summary{line-height:1.35;padding:6px 0}
</style></head><body>
${o.nav}
<main class="w-main">
<div class="w-head"><h1>The world</h1><p class="w-sent"><span class="w-s-txt"><span class="w-now-only">${n} cit${n === 1 ? "y" : "ies"} on one map.<span class="w-xl"> Tap a name to fly there.</span></span>${G ? `<span class="w-grow-only">Purple outlines are new in this window.</span>` : ""}${BT ? `<span class="w-battle-only">Every city fires at 20:00.<span class="w-xl"> Cranes rebuild the hits by noon.</span></span>` : ""}</span>${BT ? ` <a class="w-how-a" href="/world?view=battle&amp;how" data-whow>How battles work</a>` : ""}</p>${o.frontier ? `<div class="w-addw"><button type="button" class="w-addb" aria-label="Add a friend" title="Add a friend" aria-haspopup="dialog" aria-expanded="false" aria-controls="w-addp">${PLUS_SVG}<span>Add a friend</span></button><div class="w-addp" id="w-addp" role="dialog" aria-labelledby="w-addp-t" hidden><h2 id="w-addp-t">Add a friend's GitHub</h2>${WADD_HTML}</div></div>` : ""}</div>
${fleetRow(FL, { world: true, viewer: o.viewer })}<div class="w-maps"><div class="c-stage" id="stage"><canvas id="city" aria-label="Isometric world map of ${n} member cities"></canvas>${BT ? MODE_HTML : ""}
<div class="c-tools">${G ? TIME_HTML : ""}<button id="t-labels" aria-pressed="true">Labels</button><button id="t-fr" aria-pressed="false" aria-label="Friendships" title="Friendships between neighborhoods, drawn as rays of light">&#x2727;<span class="t-txt"> Friendships</span></button><button id="t-topics" aria-pressed="false" aria-label="Color by topic" title="Tint each neighborhood by what they're building"><span class="t-sw" aria-hidden="true"></span><span class="t-txt"> Topics</span></button>${FL.length ? `<button id="t-orph" aria-pressed="false" aria-label="Orpheus fleet" title="Show only members who run Orpheus">${mark(14)}<span class="t-txt"> Orpheus fleet</span></button>` : ""}<button id="t-sky">Auto</button><button id="t-wx" title="Weather">Weather</button><button id="t-snd" aria-pressed="false" title="Sound for arrivals (off)">&#x1F507;</button><button id="t-reset">Reset</button><button id="t-what" type="button" aria-haspopup="dialog" aria-controls="w-lgd" title="What am I looking at?">What am I looking at?</button><button id="t-full" aria-label="Full screen">&#x26F6;<span class="t-txt"> Full screen</span></button></div>
<div class="c-toasts" aria-live="polite"></div><div class="c-mininame" aria-hidden="true"><i></i>Caldera world</div>
<div class="c-card" id="card" hidden></div><div class="c-hint">Drag to move &middot; scroll or pinch to zoom &middot; click a name to fly there</div></div>
</div>${G ? growthMarkup() : ""}${BT ? battleMarkup() : ""}
<section class="w-extras" aria-labelledby="w-ex-h"><h2 class="w-exh" id="w-ex-h">Extras</h2><div class="w-ex"><span><b>Power up your map.</b> One prompt for your AI: drones, live visitors, private repos.</span><button type="button" class="w-ex-a" data-wpu aria-controls="power-up" aria-expanded="false">Open</button></div><div class="w-ex"><span><b>Orpheus.</b> More agents, more commits, more missiles.</span><a class="w-ex-a" href="https://useorpheus.com/?utm_source=caldera&amp;utm_medium=world" target="_blank" rel="noopener">Try Orpheus free</a></div></section>
${mapPanel(hub, { extras: true })}${legendSheet(n, b, !!G)}
</main><footer class="footer"><span>&copy; 2026 mjonesone, LLC</span><span><a href="/guide">Guide</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></span></footer>
<script>window.CALDERA_TOOLS=${safeJson(o.tools || [])};window.CALDERA_TOOLS_HUB=${safeJson(hub)};window.CALDERA_LIVE=${safeJson({ url: "/v1/world/live", mode: "public" })};window.CALDERA_EXTRAS=${safeJson({ weather: `${hub}/v1/weather` })};window.CALDERA_GIFTS=${safeJson({ url: "/v1/gifts" })}</script>
<script type="application/json" id="city-data">${safeJson(data)}</script>
${G ? `<script>window.CALDERA_GROWTH=${safeJson(G)}</script>` : ""}${BT ? `<script>window.CALDERA_BATTLE=${safeJson(BT)}</script>` : ""}
<script>${CITY_JS}</script>${BT ? `<script>${BATTLE_CLIENT_JS}</script>` : ""}${G ? `<script>${GROWTH_CLIENT_JS}</script>` : ""}<script>${CARD_CLEAR_JS}</script><script>${WORLD_FIT_JS}</script>${o.frontier ? `<style>${WADD_CSS}</style><script>${WADD_JS}</script>` : ""}<script>${WORLD_UI_JS}</script>${FL.length ? `<script>${FLEET_WORLD_JS}</script>` : ""}</body></html>`;
}
