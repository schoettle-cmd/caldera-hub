/**
 * One way in (Mike 2026-10-30): every "create your profile" path on the site goes through /join, the profile-type
 * selector ("What do you make?"): code (GitHub or Obsidian), design, or business. Signed-out visitors meet touchpoints
 * across the site (a blurred profile, a gated Follow / Message / Kudos, a nudge on the feed, people, world and city
 * pages); each one carries a touchpoint id (tp) so we can see which ones turn visitors into profiles.
 *
 * Counting is like the funnel (funnel.ts): no cookie for counting, a one-day hash of IP + browser per visitor, bots never
 * counted. Events per touchpoint: shown (the gate or nudge appeared), click (they came to /join from it), door (picked a
 * profile type), signup (a profile was created). The touchpoint that brought someone is remembered in a first-party
 * cookie (cal_tp, 30 days) so the signup can be credited to it.
 */
import type http from "node:http";
import crypto from "node:crypto";
import { BOT_UA, funnelDay } from "./funnel";

/** every touchpoint we place; anything else is ignored */
export const TOUCHPOINTS = ["header", "home-designer", "home-business", "home", "profile-blur", "follow", "message", "kudos", "comment", "reply", "help", "post", "join",
  "gift", "invite", "people-blur", "bar-feed", "bar-people", "bar-world", "bar-city", "bar-gardens", "bar-group", "world-card", "people-cta", "link-messages", "link-install", "link-github", "messages", "signin-page", "direct"] as const;
export const okTp = (v: unknown) => (TOUCHPOINTS as readonly string[]).includes(String(v)) ? String(v) : "";
export const EVENTS = ["shown", "click", "door", "signup"] as const;
export type Door = "code" | "obsidian" | "designer" | "business";
export const PROFILE_TYPES = ["developer", "designer", "business"] as const;
export type ProfileType = typeof PROFILE_TYPES[number];
export const okType = (v: unknown): ProfileType | "" => (PROFILE_TYPES as readonly string[]).includes(String(v)) ? String(v) as ProfileType : "";

/** the approved look per type (canvas "Caldera Profile Types", 2026-10-30) */
export const TYPE_THEME: Record<ProfileType, { ground: string; surface: string; line: string; accent: string; accent2: string; ink: string; mut: string; label: string }> = {
  developer: { ground: "#15141A", surface: "#1F1D27", line: "#2E2B3A", accent: "#8B7CFF", accent2: "#3DF2FF", ink: "#ECE9F2", mut: "#B7B2C4", label: "Developer" },
  designer: { ground: "#1A1416", surface: "#261C20", line: "#3A2A30", accent: "#FF7A8A", accent2: "#FFC2A8", ink: "#F4EAEC", mut: "#C9B6BC", label: "Designer" },
  business: { ground: "#11161F", surface: "#1A2230", line: "#2A3446", accent: "#E8B44A", accent2: "#7FB4FF", ink: "#EAEFF6", mut: "#AEB8C9", label: "Business" },
};
/** per-type limits (approved): uploads and cold messages a day */
export const TYPE_LIMITS = {
  designer: { projects: 24, imagesPerProject: 12, imageBytes: 10 * 1024 * 1024, totalBytes: 300 * 1024 * 1024, coldPerDay: 10 },
  business: { companies: 20, logos: 20, logoBytes: 3 * 1024 * 1024, coldPerDay: 5 },
  developer: { coldPerDay: 10 },
};

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const okHandle = (v: unknown) => String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 31);
const TP_COOKIE = "cal_tp";

export interface JoinCtx {
  q: (sql: string) => any;
  ipOf: (req: http.IncomingMessage) => string;
  page: (res: http.ServerResponse, status: number, title: string, body: string) => void;
  memberOf: (req: http.IncomingMessage) => string | null;
  byHandle: (h: string) => any;
}

export function joinModule(c: JoinCtx) {
  const { q } = c;
  q(`CREATE TABLE IF NOT EXISTS gate_events (day TEXT, vid TEXT, tp TEXT, ev TEXT, ts TEXT, PRIMARY KEY (day, vid, tp, ev))`).run();
  q("CREATE INDEX IF NOT EXISTS gate_events_day ON gate_events(day)").run();
  const saltRow = () => (q("SELECT v FROM hub_meta WHERE k='funnel_salt'").get() as any)?.v || "caldera";
  const vidOf = (req: http.IncomingMessage, day: string) => crypto.createHash("sha256").update(saltRow() + "|gate|" + day + "|" + c.ipOf(req) + "|" + String(req.headers["user-agent"] || "")).digest("hex").slice(0, 16);
  const isBot = (req: http.IncomingMessage) => { const ua = String(req.headers["user-agent"] || ""); return !ua || BOT_UA.test(ua); };

  /** count one touchpoint event for this visitor today (once per visitor per touchpoint per event per day) */
  function record(req: http.IncomingMessage, tp: string, ev: typeof EVENTS[number]) {
    const t = okTp(tp); if (!t || isBot(req)) return;
    try { const day = funnelDay(); q("INSERT OR IGNORE INTO gate_events VALUES (?,?,?,?,?)").run(day, vidOf(req, day), t, ev, new Date().toISOString()); } catch { /* counting never breaks a page */ }
  }
  const cookieTp = (req: http.IncomingMessage) => okTp((String(req.headers.cookie || "").match(/(?:^|;\s*)cal_tp=([a-z0-9-]+)/) || [])[1]);
  /** a new profile was created: credit the touchpoint that brought them (or "direct") */
  function signup(req: http.IncomingMessage) { record(req, cookieTp(req) || "direct", "signup"); }

  /** per touchpoint, last `days` days: unique visitors shown / clicked / picked a door / signed up */
  function report(days = 7) {
    const since = funnelDay(Date.now() - (days - 1) * 86_400_000);
    const rows = q("SELECT tp, ev, COUNT(*) n FROM gate_events WHERE day >= ? GROUP BY tp, ev").all(since) as { tp: string; ev: string; n: number }[];
    const by: Record<string, { tp: string; shown: number; click: number; door: number; signup: number; clickRate: string; signupRate: string }> = {};
    for (const r of rows) { const o = by[r.tp] ||= { tp: r.tp, shown: 0, click: 0, door: 0, signup: 0, clickRate: "", signupRate: "" }; (o as any)[r.ev] = r.n; }
    const pct = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + "%" : "";
    return { since, days, touchpoints: Object.values(by).map(o => ({ ...o, clickRate: pct(o.click, o.shown), signupRate: pct(o.signup, o.click || o.shown) })).sort((a, b) => b.signup - a.signup || b.click - a.click || b.shown - a.shown) };
  }

  const JOIN_CSS = `<style>.jn{max-width:1080px;margin:0 auto;padding:40px 16px 72px}.jn-head{text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center;margin-bottom:30px}
.jn-eb{font:500 12px 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted,#9A95A8)}.jn h1{margin:0;font:600 clamp(2rem,4.4vw,3rem)/1.08 'Source Serif 4',Georgia,serif;text-wrap:balance}
.jn-lede{margin:0;max-width:620px;color:var(--text-muted,#B7B2C4);font-size:1.05rem;line-height:1.5}.jn-for{margin:0;font-size:14px;color:var(--text-muted,#B7B2C4)}.jn-for b{color:var(--text-strong,#F2F2F5)}
.jn-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}@media (max-width:860px){.jn-grid{grid-template-columns:1fr}}
.jn-door{border-radius:18px;padding:24px;display:flex;flex-direction:column;gap:14px;border:1px solid}.jn-door h2{margin:0;font:600 1.6rem/1.15 'Source Serif 4',Georgia,serif}
.jn-door p{margin:0;font-size:14.5px;line-height:1.55}.jn-door ol{margin:0;padding-left:20px;font-size:14px;line-height:1.7}.jn-ic{width:48px;height:48px;border-radius:12px;display:grid;place-items:center}
.jn-btns{margin-top:auto;display:flex;flex-direction:column;gap:10px}.jn-alt{font-size:13px;color:#B7B2C4;text-align:center}.jn-alt:hover{color:#ECE9F2}.jn-b{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;border-radius:12px;font:600 15px 'IBM Plex Sans',Arial,sans-serif;text-decoration:none!important;box-sizing:border-box;padding:0 14px}
.jn-b:focus-visible{outline:2px solid #fff;outline-offset:2px}.jn-foot{text-align:center;margin:26px 0 0;font-size:14px;color:var(--text-muted,#8F89A0)}.jn-foot a{color:inherit}
.jn-sel{outline:3px solid currentColor;outline-offset:3px}</style>`;

  const doorHref = (door: Door, tp: string, from: string) => `/join/go?door=${door}${tp ? `&tp=${tp}` : ""}${from ? `&from=${from}` : ""}`;
  function selectorPage(res: http.ServerResponse, tp: string, from: string, pre: string) {
    const who = from ? c.byHandle(from) : null, nm = who?.name || (from ? "@" + from : "");
    const T = TYPE_THEME;
    const door = (k: ProfileType, title: string, body: string, steps: string[], icon: string, btns: string) => `<div class="jn-door${pre === k ? " jn-sel" : ""}" id="door-${k}" style="background:${T[k].surface};border-color:${T[k].line};color:${T[k].ink}">
<div class="jn-ic" style="background:${T[k].ground}">${icon}</div><h2>${title}</h2><p style="color:${T[k].mut}">${body}</p><ol>${steps.map(s => `<li>${s}</li>`).join("")}</ol><div class="jn-btns">${btns}</div></div>`;
    const svg = (col: string, d: string) => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    c.page(res, 200, "Create your profile", `${JOIN_CSS}<main class="jn"><div class="jn-head"><p class="jn-eb">Get your own page</p><h1>What do you make?</h1>
<p class="jn-lede">Your answer sets your page's look, what it shows and how your city gets built. You can change it later.</p>${nm ? `<p class="jn-for">You'll be able to follow and message <b>${esc(nm)}</b> once your profile is up.</p>` : ""}</div>
<div class="jn-grid">
${door("developer", "I write code", "Your repos become a city. Your activity, stack and agents show up on your page.", ["Sign in with GitHub (read-only)", "We build your city from public repos", "Add Obsidian later for a living profile"],
      svg(T.developer.accent, '<polyline points="8 6 3 12 8 18"></polyline><polyline points="16 6 21 12 16 18"></polyline>'),
      `<a class="jn-b" rel="nofollow" href="${doorHref("code", tp, from)}" style="background:${T.developer.ink};color:${T.developer.ground}">Sign up with GitHub</a><a class="jn-b" href="${doorHref("obsidian", tp, from)}" style="border:1px solid ${T.developer.accent};color:#CFC7FF">Install for Obsidian</a><a class="jn-alt" href="/start${from ? `?invite=${from}` : ""}">No GitHub? Start with email and ChatGPT or Claude</a>`)}
${door("designer", "I design", "Your portfolio becomes your page. Each project becomes a building in your city.", ["Start with your email", "Add your work: images, case studies, links", "Mark yourself open for work (optional)"],
      svg(T.designer.accent, '<path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle>'),
      `<a class="jn-b" href="${doorHref("designer", tp, from)}" style="background:${T.designer.accent};color:#2A1216">Start with email</a>`)}
${door("business", "I build companies", "Your companies become your city. Show what you've built and what you're looking for.", ["Start with your email", "Add your companies and roles", "Say what you're looking for: hiring, raising, partners"],
      svg(T.business.accent, '<rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>'),
      `<a class="jn-b" href="${doorHref("business", tp, from)}" style="background:${T.business.accent};color:#1E1607">Start with email</a>`)}
</div><p class="jn-foot">Already on Caldera? <a href="/signin">Sign in</a>. Do more than one? Pick the main one; your page can show more later.</p></main>`);
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL, p: string): Promise<boolean> {
    if (p === "/join" && req.method === "GET") {
      const tp = okTp(url.searchParams.get("tp")), from = okHandle(url.searchParams.get("from") || url.searchParams.get("invite")), pre = okType(url.searchParams.get("type"));
      if (c.memberOf(req) && !url.searchParams.get("preview")) { res.writeHead(302, { location: from ? `/@${from}/` : "/me", "cache-control": "no-store" }); res.end(); return true; }
      if (tp) { record(req, tp, "click"); res.setHeader("set-cookie", `${TP_COOKIE}=${tp}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; Secure`); }
      else if (!cookieTp(req)) record(req, "direct", "click");
      selectorPage(res, tp, from, pre); return true;
    }
    if (p === "/join/go" && req.method === "GET") {
      const door = String(url.searchParams.get("door") || "") as Door, tp = okTp(url.searchParams.get("tp")) || cookieTp(req) || "direct", from = okHandle(url.searchParams.get("from"));
      const to = door === "code" ? `/auth/github${from ? `?invite=${from}` : ""}` : door === "obsidian" ? `/${from ? `?invite=${from}` : ""}#obsidian`
        : door === "designer" ? `/join/designer${from ? `?invite=${from}` : ""}` : door === "business" ? `/join/business${from ? `?invite=${from}` : ""}` : "/join";
      if (["code", "obsidian", "designer", "business"].includes(door)) record(req, tp, "door");
      res.writeHead(302, { location: to, "cache-control": "no-store" }); res.end(); return true;
    }
    // touchpoint events from pages (gate shown): "tp:ev", any origin (hosted pages are sandboxed: Origin null), no cookie
    if (p === "/v1/gate/ev" && req.method === "POST") {
      let s = ""; for await (const x of req) { s += x; if (s.length > 60) break; }
      const [tp, ev] = s.trim().split(":"); if (ev === "shown") record(req, tp, "shown");
      res.writeHead(204, { "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(); return true;
    }
    return false;
  }
  return { route, record, signup, report, cookieTp };
}

/** The gate card style (profile blur, people blur, the nudge bar). Theme-neutral dark, like the sign-up panel. */
const GATE2_CSS = `.cal-bl{filter:blur(7px);opacity:.6;pointer-events:none;user-select:none;-webkit-user-select:none}
.cal-gc{position:sticky;top:86px;z-index:60;margin:18px auto 22px;max-width:520px;box-sizing:border-box;padding:20px 20px 18px;border-radius:16px;background:#18171D;border:1px solid #3A3355;color:#E6E6EA;font:400 14.5px/1.5 'IBM Plex Sans',Arial,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);text-align:center}
.cal-gc h3{margin:0 0 6px;color:#F2F2F5;font:600 19px/1.3 'Source Serif 4',Georgia,serif}.cal-gc p{margin:0 0 14px;color:#C9C6D3}
.cal-gc a.cal-go{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 22px;border-radius:999px;background:#8B6CF6;color:#fff!important;font:600 15px 'IBM Plex Sans',Arial,sans-serif;text-decoration:none!important}
.cal-gc a.cal-go:focus-visible,.cal-nb a:focus-visible,.cal-nb button:focus-visible{outline:2px solid #fff;outline-offset:2px}.cal-gc .cal-si{display:block;margin-top:10px;font-size:13px}.cal-gc .cal-si a{color:#B9A6FF!important}
.cal-nb{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147482000;display:flex;align-items:center;gap:12px;max-width:calc(100% - 24px);box-sizing:border-box;padding:10px 10px 10px 16px;border-radius:999px;background:#18171D;border:1px solid #3A3355;color:#E6E6EA;font:500 14px 'IBM Plex Sans',Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.5)}
.cal-nb[hidden]{display:none}.cal-nb a{flex:none;display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:999px;background:#8B6CF6;color:#fff!important;font-weight:600;text-decoration:none!important}
.cal-nb button{all:unset;cursor:pointer;flex:none;width:32px;height:32px;display:grid;place-items:center;border-radius:999px;color:#B8B8C2;font-size:18px}.cal-nb button:hover{background:#25222F}
@media (max-width:620px){.cal-nb{left:12px;right:12px;transform:none;border-radius:16px}.cal-nb span{font-size:13px}}`;

/**
 * Signed-out visitors only (the hub never sends this to members, owners or crawlers). `kind` says what page this is:
 * profile = blur the deeper sections under a card; people = blur the directory past the first 12 cards; others get a
 * small nudge bar after a moment. Action links (Message, Get started, GitHub sign-up) go through /join with their touchpoint.
 * Everything stays in the HTML; the blur is only paint, so search engines and link previews see the whole page.
 */
export function gateScript(o: { hub: string; kind: "profile" | "people" | "feed" | "world" | "city" | "gardens" | "group" | "other"; handle?: string; name?: string }): string {
  const cfg = JSON.stringify({ hub: o.hub.replace(/\/$/, ""), kind: o.kind, h: o.handle || "", nm: o.name || "" }).replace(/</g, "\\u003c");
  return `<style>${GATE2_CSS}</style><script>(function(){var C=${cfg};if(window.__calGate2)return;window.__calGate2=1;
var sent={};function ev(tp,e){var k=tp+':'+e;if(sent[k])return;sent[k]=1;try{fetch(C.hub+'/v1/gate/ev',{method:'POST',headers:{'content-type':'text/plain'},body:k,keepalive:true}).catch(function(){})}catch(x){}}
function jurl(tp){return C.hub+'/join?tp='+tp+(C.h?'&from='+encodeURIComponent(C.h):'')}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function card(tp,title,body){var d=el('div','cal-gc');d.setAttribute('role','region');d.setAttribute('aria-label','Create your profile');d.appendChild(el('h3','',title));d.appendChild(el('p','',body));
var a=el('a','cal-go','Create your profile');a.href=jurl(tp);a.rel='nofollow';d.appendChild(a);var s=el('span','cal-si','Already on Caldera? ');var si=el('a','','Sign in');si.href=C.hub+'/signin'+(C.h?'?back='+encodeURIComponent('/@'+C.h+'/'):'');si.rel='nofollow';s.appendChild(si);d.appendChild(s);ev(tp,'shown');return d}
function profile(){var page=document.querySelector('main.note .page')||document.querySelector('main .page')||document.querySelector('main');if(!page)return;var kids=[].slice.call(page.children),cut=-1;
var typed=page.querySelector(':scope > .cal-typed-more');
if(typed){cut=kids.indexOf(typed);kids.slice(0,cut).forEach(function(k){if(k.matches&&k.matches('.pc,.journal,.scoreboard,.module'))k.classList.add('cal-bl')})}
else for(var i=0;i<kids.length;i++){var k=kids[i];if(k.matches&&k.matches('section,h2,.pc,.journal,.scoreboard,.module')){cut=i;break}}
if(cut<0)return;for(var j=cut;j<kids.length;j++)kids[j].classList.add('cal-bl');
var nm=C.nm||('@'+C.h);page.insertBefore(card('profile-blur','See the rest of '+nm+'\\u2019s page','Create your free profile to see their posts, activity and journal, and to follow or message them. It takes a minute.'),kids[cut])}
function people(){var g=document.getElementById('grid');if(!g)return;var done=false;function go(){var cs=[].slice.call(g.children).filter(function(x){return !x.classList.contains('cal-gc')});if(cs.length<=12)return;
cs.slice(12).forEach(function(x){x.classList.add('cal-bl')});if(!done){done=true;g.parentNode.insertBefore(card('people-blur','See everyone on Caldera','Create your profile to browse the whole directory, follow people and send messages.'),g.nextSibling)}}
go();try{new MutationObserver(go).observe(g,{childList:true})}catch(x){}}
function bar(tp,txt){var shown=false;try{if(sessionStorage.getItem('cal-nb-x'))return}catch(x){}var b=el('div','cal-nb');b.hidden=true;b.setAttribute('role','complementary');b.setAttribute('aria-label','Create your profile');
b.appendChild(el('span','',txt));var a=el('a','','Create your profile');a.href=jurl(tp);a.rel='nofollow';b.appendChild(a);var x=el('button','','\\u00d7');x.type='button';x.setAttribute('aria-label','Dismiss');
x.addEventListener('click',function(){b.hidden=true;try{sessionStorage.setItem('cal-nb-x','1')}catch(e){}});b.appendChild(x);document.body.appendChild(b);
function show(){if(shown)return;shown=true;b.hidden=false;ev(tp,'shown')}setTimeout(show,12000);addEventListener('scroll',function(){if((scrollY+innerHeight)/Math.max(1,document.documentElement.scrollHeight)>.45)show()},{passive:true})}
// action links that lead to signing up go through the selector instead
document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;var h=a.getAttribute('href')||'',tp='';
if(/\\/messages(\\/|$|\\?)/.test(h)||/signin\\?back=%2Fmessages|signin\\?back=\\/messages/.test(h))tp='link-messages';else if(/#install$/.test(h)&&!/^\\/?$/.test(location.pathname))tp='link-install';else if(/\\/auth\\/github/.test(h))tp='link-github';
if(!tp)return;e.preventDefault();e.stopPropagation();location.href=jurl(tp)},true);
// "light up" on the world map: members only
document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('button,a'):null;if(!b)return;if(!/light (it )?up|light up a city/i.test(b.textContent||''))return;e.preventDefault();e.stopPropagation();ev('gift','shown');location.href=jurl('gift')},true);
function worldCard(){var cd=document.getElementById('card');if(!cd)return;function go(){if(cd.hidden||cd.querySelector('.cal-wc'))return;var pg=[].slice.call(cd.querySelectorAll('a')).filter(function(a){return /^Profile$/.test(a.textContent||'')})[0];if(!pg)return;
var h=((pg.getAttribute('href')||'').match(/\\/@([a-z0-9-]+)/)||[])[1]||'',nm=(cd.querySelector('h3')||{}).textContent||('@'+h);var d=el('p','cal-wc');d.style.cssText='margin:10px 0 0';
var a=el('a','','Create your profile to follow '+nm);a.href=C.hub+'/join?tp=world-card'+(h?'&from='+encodeURIComponent(h):'');a.rel='nofollow';a.style.cssText='font-weight:600';d.appendChild(a);cd.appendChild(d);ev('world-card','shown')}
try{new MutationObserver(go).observe(cd,{childList:true,attributes:true,attributeFilter:['hidden']})}catch(x){}}
function start(){if(C.kind==='profile')profile();else if(C.kind==='people'){people();bar('bar-people','Make your own page and get found by what you build.')}
else if(C.kind==='feed')bar('bar-feed','Join the conversation: post, comment and follow people.');else if(C.kind==='world'){bar('bar-world','Put your own city on the world map.');worldCard()}
else if(C.kind==='city')bar('bar-city','Get a living city like this one, built from your work.');else if(C.kind==='gardens')bar('bar-gardens','Plant your own garden of notes.');else if(C.kind==='group')bar('bar-group','Create your profile to join this group.')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start()})();</script>`;
}
