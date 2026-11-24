/**
 * The Orpheus boost on Caldera: the look of the fleet (spec ~/growth/notes/specs/2026-11-22-orpheus-founding-fleet.md
 * section 2; design Fable 11-24, products/caldera/reports/2026-11-24-orpheus-fleet/FLEET.md). Words are fixed.
 *
 * Pure builders. The data comes from orpheustie.ts (fleetOf / fleetList); the hub places the pieces:
 * - badge: `Runs on Orpheus` (gold: `Founding Fleet`) on the profile (sandboxed: inline styles, a link), the leaderboard
 *   and People (class version, not a link). A badge never changes a score, an order or a rank.
 * - card: `Agent fleet` on the profile, counts only; the owner's empty slot when not linked (visitors get nothing).
 * - row: `Orpheus fleet` at the top of /world and /people, newest link first.
 * - link pages (/link/orpheus) and the Settings row with an in-row Remove confirm.
 * Placeholders FLEET.md leaves open: the mark is Fable's drawn ring-and-satellite (no official Orpheus mark yet) and the
 * Orpheus settings URL is ORPHEUS_SETTINGS below.
 */
import type { Fleet } from "./orpheustie";

export const ORPHEUS_SETTINGS = "https://useorpheus.com/app/members.html#caldera";   // Orpheus Dev 11-24 (owner only)
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
/** the mark: 16 x 16, currentColor */
export const mark = (n: number) => `<svg viewBox="0 0 16 16" width="${n}" height="${n}" aria-hidden="true" focusable="false" style="flex:none"><circle cx="8" cy="8.6" r="4.9" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="8.6" r="1.6" fill="currentColor"/><circle cx="12.4" cy="3.6" r="2" fill="currentColor"/></svg>`;
/** pins, the world card line and both rows: map; badge, card, empty slot and Settings: profile. ref = whose pin/badge/card it is */
export const fleetHref = (medium: "map" | "profile", ref?: string | null) =>
  `https://useorpheus.com/?utm_source=caldera&utm_medium=${medium}&utm_campaign=tie${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
/** 0 not linked, 1 linked, 2 linked and Founding Fleet */
export const orphLevel = (f: { founding: boolean } | null | undefined): 0 | 1 | 2 => (f ? (f.founding ? 2 : 1) : 0);

// ---------------------------------------------------------------- shared CSS (People, leaderboard, /world)
/** the --of-* tokens (also in the sign-in page style block) */
export const FLEET_TOKENS = `:root{--of-ink:#C9B8FF;--of-line:#5B4A99;--of-fill:rgba(139,108,246,.12);--of-gold:#F0BF5A;--of-gold-line:#8A6A1F;--of-gold-fill:rgba(240,191,90,.12)}
:root[data-theme="light"]{--of-ink:#5A38D6;--of-line:#B9A6F5;--of-fill:rgba(109,74,232,.07);--of-gold:#7A5200;--of-gold-line:#D4A84A;--of-gold-fill:#FFF4D6}`;
export const FLEET_CSS = FLEET_TOKENS + `
.w-main,.lb-panel{--of-ink:#C9B8FF;--of-line:#5B4A99;--of-fill:rgba(139,108,246,.12);--of-gold:#F0BF5A;--of-gold-line:#8A6A1F;--of-gold-fill:rgba(240,191,90,.12)}
.of-b{position:relative;display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;flex:none;height:22px;padding:0 8px 0 6px;border:1px solid var(--of-line);border-radius:999px;background:var(--of-fill);color:var(--of-ink);font:600 11.5px/1 var(--font-body,'IBM Plex Sans',Arial,sans-serif);letter-spacing:0;text-transform:none;white-space:nowrap;vertical-align:middle}
.of-b svg{width:12px;height:12px}.of-b.gold{border-color:var(--of-gold-line);background:var(--of-gold-fill);color:var(--of-gold)}
.of-row{display:flex;align-items:center;gap:10px;min-width:0;height:44px}
.of-row-l{flex:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0;border:0;background:none;color:var(--of-ink);font:600 10.5px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.of-row-l b{font-weight:600;letter-spacing:0;color:var(--text-muted,#8A8A93)}
button.of-row-l{position:relative;padding:0 10px 0 8px;border:1px solid var(--of-line);border-radius:8px;cursor:pointer}button.of-row-l::before{content:"";position:absolute;left:0;right:0;top:-8px;bottom:-8px}
button.of-row-l[aria-pressed="true"]{background:#F4F2FF;border-color:#F4F2FF;color:#1A1330}button.of-row-l[aria-pressed="true"] b{color:#4A3F73}
.of-row-s{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;padding:6px 28px 6px 0;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}
.of-row-s::-webkit-scrollbar{display:none}
.of-chip{position:relative;flex:none;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:32px;padding:0 11px 0 4px;border:1px solid var(--of-line);border-radius:999px;background:var(--of-fill);color:var(--text-strong,#F2F2F5);font:500 13px/1 var(--font-body,'IBM Plex Sans',Arial,sans-serif);text-decoration:none;white-space:nowrap}
.of-chip::before{content:"";position:absolute;left:0;right:0;top:-6px;bottom:-6px}.of-chip:hover{text-decoration:none;border-color:var(--of-ink)}
.of-chip i{flex:none;width:24px;height:24px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#3A2F5C;color:#D6CBFF;font:600 11px/1 var(--font-body,'IBM Plex Sans',Arial,sans-serif);font-style:normal}.of-chip i img{width:100%;height:100%;object-fit:cover}
.of-chip.gold{border-color:var(--of-gold-line);background:var(--of-gold-fill)}.of-chip.gold i{box-shadow:0 0 0 1.5px var(--of-gold)}.of-chip.gold svg{width:12px;height:12px;color:var(--of-gold)}
.of-row-a{flex:none;display:inline-flex;align-items:center;min-height:40px;margin-left:8px;padding:0 4px;color:var(--text-muted,#8A8A93);font:500 12.5px/1 var(--font-body,'IBM Plex Sans',Arial,sans-serif);text-decoration:underline;text-underline-offset:3px;white-space:nowrap}.of-row-a:hover{color:var(--text-strong,#F2F2F5)}
.of-row :is(a,button):focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}`;

/** /world only: the row's place, the Layers row, the on-map chip and the world card line */
export const FLEET_WORLD_CSS = `.w-main .of-row{margin:-2px 0 6px}
.w-main:has(.of-row) .c-stage:not(.c-full){height:calc(100svh - 180px)}
#t-orph svg{width:14px;height:14px;vertical-align:-2px}.c-more>#t-orph[aria-pressed="true"]{color:#fff;background:rgba(139,108,246,.24)!important}
.w-of-chip{position:absolute;left:12px;top:52px;z-index:7;display:inline-flex;align-items:center;gap:7px;box-sizing:border-box;height:32px;padding:0 6px 0 9px;border:0;border-radius:10px;background:#F4F2FF;color:#1A1330;font:600 12.5px/1 'IBM Plex Sans',sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.w-of-chip::before{content:"";position:absolute;left:0;right:0;top:-6px;bottom:-6px}.w-of-chip b{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:rgba(26,19,48,.1);font:400 16px/1 Arial,sans-serif}
.w-of-chip:focus-visible{outline:2px solid #3DF2FF;outline-offset:2px}
.w-main .c-stage:has(.w-of-chip) .w-topics{top:92px}
.w-main .c-stage:has(.w-of-chip) .c-card:not(.is-sheet){top:92px;max-height:calc(100% - 142px)}
@media (min-width:601px){.w-main .c-stage:has(.w-of-chip) .g-today,html.w-battle:not(.w-replay) .w-main .c-stage:has(.w-of-chip) .g-today{top:92px}}
@media (max-width:899px){.w-main .c-stage:has(.w-of-chip) .c-card:not(.is-sheet){top:88px}}
@media (max-width:599px){.w-main .c-stage:has(.w-of-chip)>[role=status]:not(.g-today):not(.c-card){top:88px!important}}html.w-replay .w-of-chip{display:none}
.c-card .k-orph{display:inline-flex;align-items:center;gap:6px;min-height:40px;color:#C9B8FF;font-weight:600;text-decoration:none}.c-card .k-orph.gold{color:#F0BF5A}
@media (max-width:899px){.w-of-chip{left:8px;top:48px}}
@media (max-width:699px){.w-main:has(.of-row) .c-stage:not(.c-full){height:calc(100svh - 234px)}html.w-battle .w-main:has(.of-row) .c-stage:not(.c-full){height:calc(100svh - 272px)}.c-more>#t-orph{min-height:44px}}`;

/** leaderboard only */
export const FLEET_LB_CSS = `.lb-who .of-b{margin-left:8px}.lb-key{display:inline-flex;align-items:center;gap:6px}.lb-key svg{color:var(--of-ink)}
@media (max-width:640px){.lb-who a{position:relative}.lb-who .of-b{position:absolute;left:27px;top:50%;margin:1px 0 0;width:18px;height:18px;padding:0;justify-content:center;background:#1B1730}.lb-who .of-b.gold{background:#2A2008}.lb-who .of-b svg{width:11px;height:11px}.lb-who .of-b span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}`;

// ---------------------------------------------------------------- 3. badge
/** class version (People, leaderboard): not a link */
export const fleetBadge = (founding: boolean) => founding
  ? `<span class="of-b gold" title="Founding Fleet. Runs on Orpheus">${mark(12)}<span>Founding Fleet</span></span>`
  : `<span class="of-b" title="Runs on Orpheus">${mark(12)}<span>Runs on Orpheus</span></span>`;
/** the leaderboard's key line under the table */
export const FLEET_LB_KEY = `<span class="lb-key">${mark(13)}Runs on Orpheus. A badge never changes rank.</span>`;
/** profile version (sandboxed page: inline styles; a link) */
export function fleetProfileBadge(f: Fleet): string {
  const a = (title: string, span: string, word: string) => `<a href="${esc(fleetHref("profile", f.handle))}" target="_blank" rel="noopener" data-tie="badge" title="${title}" style="display:inline-flex;align-items:center;min-height:40px;vertical-align:middle;text-decoration:none"><span style="display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:24px;padding:0 10px 0 7px;border-radius:999px;font:600 12px/1 var(--font-body,'IBM Plex Sans',Arial,sans-serif);letter-spacing:0;white-space:nowrap;${span}">${mark(13)}${word}</span></a>`;
  return f.founding ? a("Founding Fleet. Runs on Orpheus", "border:1px solid #8A6A1F;background:#2A2008;color:#F2CB6B", "Founding Fleet")
    : a("Runs on Orpheus", "border:1px solid var(--line-strong,#3A3A40);background:var(--accent-soft,rgba(139,108,246,.10));color:var(--accent-text,#B39DFA)", "Runs on Orpheus");
}

// ---------------------------------------------------------------- 4. Agent fleet card and the empty slot
const STALE_MS = 8 * 86_400_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** a weekday, three letters (never a date) */
export function busyDay(v: string | null | undefined): string {
  const s = String(v || "").trim(); if (!s) return "-";
  const w = DAYS.find(d => s.toLowerCase().startsWith(d.toLowerCase())); if (w) return w;
  const t = /^\d{4}-\d{2}-\d{2}/.test(s) ? Date.parse(s.slice(0, 10) + "T12:00:00Z") : NaN;
  return Number.isNaN(t) ? "-" : DAYS[new Date(t).getUTCDay()]!;
}
/** linked: the card for every viewer; "" when the counts are older than 8 days (the badge stays) */
export function fleetCard(f: Fleet & { syncedAt?: string | null }, now = Date.now()): string {
  const synced = f.syncedAt ? Date.parse(f.syncedAt) : NaN, first = Number.isNaN(synced);
  if (!first && now - synced > STALE_MS) return "";
  const n = (v: number) => first ? "-" : Number(v || 0).toLocaleString("en-US");
  const updated = first ? "First counts within a day" : "Updated " + new Date(synced).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
  const cell = (v: string, label: string) => `<div style="flex:1 1 132px;min-width:0;padding:0 8px 12px"><b style="display:block;font:400 26px/1.15 var(--font-mono,'IBM Plex Mono',monospace);color:var(--text-strong,#F2F2F5);font-variant-numeric:tabular-nums">${esc(v)}</b><span style="font-size:12.5px;color:var(--text-muted,#8A8A93)">${label}</span></div>`;
  return `<section id="cb-fleet" data-tie="fleet" aria-label="Agent fleet" style="box-sizing:border-box;max-width:var(--content-width,760px);margin:20px 0 4px;padding:16px 18px 0;border:1px solid var(--line,#2A2A2E);border-radius:14px;background:var(--bg-raised,#232327);font:400 13.5px/1.45 var(--font-body,'IBM Plex Sans',Arial,sans-serif);color:var(--text,#DADADF);text-align:left">`
    + `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px"><span style="display:inline-flex;align-items:center;gap:7px;font:500 11.5px/1 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#8A8A93)">${mark(14)}Agent fleet</span><span style="margin-left:auto;font-size:12px;color:var(--text-muted,#8A8A93)">${esc(updated)}</span></div>`
    + `<div style="display:flex;flex-wrap:wrap;margin:14px -8px 0">${cell(n(f.agentsWeek), "agents run this week")}${cell(n(f.accounts), "accounts")}${cell(n(f.sessionsWeek), "sessions")}${cell(first ? "-" : busyDay(f.busiestDay), "busiest day")}</div>`
    + `<div style="display:flex;justify-content:flex-end;margin:0 -18px;padding:0 10px;border-top:1px solid var(--line,#2A2A2E)"><a href="${esc(fleetHref("profile", f.handle))}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;min-height:42px;padding:0 8px;color:var(--accent-text,#B39DFA);font-weight:600;text-decoration:none">${mark(14)}Runs on Orpheus<span aria-hidden="true">&rarr;</span></a></div></section>`;
}
/** owner only, not linked */
export const fleetEmpty = (handle: string) => `<a id="cb-fleet" data-tie="fleet-empty" href="${esc(fleetHref("profile", handle))}" target="_blank" rel="noopener" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;box-sizing:border-box;max-width:var(--content-width,760px);min-height:56px;margin:20px 0 4px;padding:10px 16px;border:1px dashed var(--line-strong,#3A3A40);border-radius:14px;font:500 13.5px/1.4 var(--font-body,'IBM Plex Sans',Arial,sans-serif);color:var(--text-muted,#8A8A93);text-decoration:none;text-align:left">${mark(16)}<span style="flex:1 1 200px;min-width:0;color:var(--text,#DADADF)">Connect Orpheus to show your agents</span><span style="font-size:12px">Only you see this<span aria-hidden="true" style="margin-left:10px;color:var(--accent-text,#B39DFA)">&rarr;</span></span></a>`;
/** the profile page (index.html): badge after the name for every viewer, then the card (linked) or the owner's empty slot */
export function fleetProfile(html: string, f: (Fleet & { syncedAt?: string | null }) | null, o: { owner: boolean; handle: string; now?: number }): string {
  if (f) html = html.replace('<span class="caret">|</span></h1>', () => '<span class="caret">|</span> ' + fleetProfileBadge(f) + "</h1>");
  const card = f ? fleetCard(f, o.now) : o.owner ? fleetEmpty(o.handle) : "";
  return card ? html.replace("<!--caldera:owner-->", () => "<!--caldera:owner-->" + card) : html;
}

// ---------------------------------------------------------------- 2. the Orpheus fleet row
export interface FleetChip { handle: string; founding: boolean; avatar: string | null; name?: string }
export const FLEET_ROW_MAX = 24;
/** /world (label is the map toggle) or /people (label is text); "" when nobody is linked. viewer = the ref on the end link */
export function fleetRow(list: FleetChip[], o: { world: boolean; viewer?: string | null }): string {
  if (!list.length) return "";
  const chip = (c: FleetChip) => {
    const href = o.world ? `/world?focus=${encodeURIComponent(c.handle)}` : `/@${encodeURIComponent(c.handle)}/`;
    const av = c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : esc((c.name || c.handle).replace(/^@/, "").charAt(0).toUpperCase());
    return c.founding ? `<a class="of-chip gold" role="listitem" href="${esc(href)}" data-h="${esc(c.handle)}" title="Founding Fleet"><i>${av}</i>@${esc(c.handle)}${mark(12)}</a>`
      : `<a class="of-chip" role="listitem" href="${esc(href)}" data-h="${esc(c.handle)}"><i>${av}</i>@${esc(c.handle)}</a>`;
  };
  const label = o.world ? `<button type="button" class="of-row-l" id="of-only" aria-pressed="false" title="Show only the Orpheus fleet on the map">${mark(14)}Orpheus fleet<b>${list.length}</b></button>`
    : `<span class="of-row-l">${mark(14)}Orpheus fleet<b>${list.length}</b></span>`;
  return `<div class="of-row" id="of-row" data-tie="fleet-row">${label}<div class="of-row-s" role="list" aria-label="Members who run Orpheus, newest first">${list.slice(0, FLEET_ROW_MAX).map(chip).join("")}<a class="of-row-a" href="${esc(fleetHref("map", o.viewer))}" target="_blank" rel="noopener">Try Orpheus free</a></div></div>`;
}
/** /world: a chip flies to the city; the label is the same toggle as the Layers row (CALDERA_FLEET from the renderer) */
export const FLEET_WORLD_JS = `(function(){var r=document.getElementById('of-row');if(!r)return;r.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
var a=t.closest('.of-chip');if(a){if(typeof window.CALDERA_FOCUS==='function'&&window.CALDERA_FOCUS(a.getAttribute('data-h')))e.preventDefault();return}
var b=t.closest('#of-only');if(b&&typeof window.CALDERA_FLEET==='function')window.CALDERA_FLEET(b.getAttribute('aria-pressed')!=='true')})})();`;

// ---------------------------------------------------------------- 5. link pages (/link/orpheus), inside signinPage
export const FLEET_LINK_CSS = `.si .lk-pair{display:flex;align-items:flex-start;margin:6px 0 22px}
.si .lk-n{flex:none;width:76px;display:grid;justify-items:center;gap:6px;font:500 12px/1.2 var(--font-mono,'IBM Plex Mono',monospace);color:var(--text-muted);overflow-wrap:anywhere;text-align:center}
.si .lk-n i{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line-strong);background:var(--bg-raised);color:var(--of-ink);font:600 18px/1 var(--font-display,'Source Serif 4',Georgia,serif);font-style:normal;overflow:hidden}.si .lk-n i img{width:100%;height:100%;object-fit:cover}
.si .lk-w{position:relative;flex:0 1 120px;height:2px;margin:23px -6px 0;background:repeating-linear-gradient(90deg,var(--line-strong) 0 6px,transparent 6px 11px)}
.si .lk-w::after{content:"";position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px;border-radius:50%;display:none;place-items:center;font:700 12px/1 Arial,sans-serif;color:#fff}
.si .lk-pair[data-s="linking"] .lk-w{background:repeating-linear-gradient(90deg,var(--of-ink) 0 6px,transparent 6px 11px);background-size:22px 2px;animation:lk-m .6s linear infinite}
.si .lk-pair[data-s="linked"] .lk-w{background:#3FB97F}.si .lk-pair[data-s="linked"] .lk-w::after{display:grid;content:"\\2713";background:#3FB97F}
.si .lk-pair[data-s="off"] .lk-w{opacity:.55}.si .lk-pair[data-s="off"] .lk-n i{color:var(--text-muted)}
@keyframes lk-m{to{background-position:22px 0}}@media (prefers-reduced-motion:reduce){.si .lk-pair[data-s="linking"] .lk-w{animation:none}}
.si .lk-list{margin:0;padding:0;list-style:none;display:grid;gap:10px}.si .lk-list li{display:grid;grid-template-columns:86px 1fr;gap:10px;font-size:14px}.si .lk-list b{font:500 11.5px/1.7 var(--font-mono,'IBM Plex Mono',monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted)}
.si .lk-act{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:18px 0 12px}.si .lk-act .btn{cursor:pointer;border:0;font:inherit;font-weight:600}.si .lk-act .btn.ghost{border:1px solid var(--line-strong)}
.si .lk-act .btn[disabled]{opacity:.6;cursor:default}.si .lk-gold{display:flex;align-items:center;gap:8px;margin:0 0 14px;color:var(--of-gold);font-weight:600;font-size:14px}
.si .lk-alt{display:inline-block;padding:11px 0}
@media (max-width:480px){.si .lk-act .btn{flex:1 1 100%;justify-content:center}}`;

export type LinkState = "confirm" | "linked" | "handle_taken" | "taken_other" | "expired" | "missing" | "off" | "error";
export interface LinkView { handle?: string | null; avatar?: string | null; token?: string; founding?: boolean; other?: string | null }
const LEDE = "Your profile gets the Runs on Orpheus badge, an Agent fleet card and a pin on the world map.";
const LIST = `<div class="card"><ul class="lk-list"><li><b>Shown</b><span>Counts only: agents run this week, accounts, sessions and the busiest day.</span></li><li><b>Never shown</b><span>Account, project or machine names. Limits, keys or costs.</span></li></ul></div>`;
/** the body of a link page; the wrapper (signinPage) gives the 560px column. data-orpheus-link names the state */
export function linkPage(st: LinkState, v: LinkView): { title: string; html: string } {
  const h = v.handle ? esc(v.handle) : "", pairS = st === "confirm" ? "confirm" : st === "linked" ? "linked" : "off";
  const me = v.handle ? (v.avatar ? `<img src="${esc(v.avatar)}" alt="">` : esc(v.handle.charAt(0).toUpperCase())) : "C";
  const pair = `<div class="lk-pair" data-s="${pairS}" aria-hidden="true"><span class="lk-n"><i>${mark(22)}</i>Orpheus</span><span class="lk-w"></span><span class="lk-n"><i>${me}</i>${h ? "@" + h : "Caldera"}</span></div>`;
  const tag = (inner: string) => `<div data-orpheus-link="${st}">${pair}${inner}</div>`;
  const prof = h ? `/@${h}/` : "/";
  if (st === "confirm") return { title: "Link Orpheus", html: tag(`<h1>Link this Orpheus workspace to @${h}</h1><p class="lede">${LEDE}</p>${LIST}<form class="lk-act" id="lk-form" method="post" action="/link/orpheus"><input type="hidden" name="t" value="${esc(v.token || "")}"><button class="btn" type="submit">Link workspace</button><a class="btn ghost" href="${prof}">Not now</a></form><p class="mut" id="lk-note">You can remove the link at any time in Settings.</p><p class="mut" id="lk-who">Signed in as @${h}. <a class="lk-alt" href="/signout?back=${encodeURIComponent("/link/orpheus")}">Use another account</a></p>`) };
  if (st === "linked") return { title: "Linked", html: `<meta http-equiv="refresh" content="2;url=/@${h}/?linked=orpheus">` + tag(`<h1>Linked to @${h}</h1><p class="lede" role="status">Your profile now shows your agent fleet. Opening your profile&hellip;</p>${v.founding ? `<p class="lk-gold">${mark(16)}You are in the Founding Fleet. Your map pin is gold.</p>` : ""}<div class="lk-act"><a class="btn" href="/@${h}/?linked=orpheus">Go to your profile</a></div><p class="mut">The first counts arrive within a day.</p>`) };
  if (st === "handle_taken" || st === "taken_other") {
    const head = st === "taken_other" && v.other ? `This workspace is linked to @${esc(v.other)}` : `@${h} is linked to another Orpheus workspace`;
    return { title: "Already linked", html: tag(`<h1>${head}</h1><p class="lede">One handle links to one workspace. Remove the old link in Settings. Then open the link from Orpheus again.</p><div class="lk-act"><a class="btn" href="/settings#conn-orpheus">Open Settings</a><a class="btn ghost" href="${prof}">Back to your profile</a></div><p class="mut">Nothing changed.</p>`) };
  }
  if (st === "expired" || st === "missing") return { title: "Link expired", html: tag(`<h1>This link has expired</h1><p class="lede">A link works one time, for a short time. Open Orpheus settings and choose Show my fleet on Caldera again.</p><div class="lk-act"><a class="btn" href="${ORPHEUS_SETTINGS}">Open Orpheus settings</a><a class="btn ghost" href="/">Back to Caldera</a></div><p class="mut">Nothing changed.</p>`) };
  return { title: "Not available", html: tag(`<h1>Linking is not available right now</h1><p class="lede">Nothing changed. Try again in a few minutes.</p><div class="lk-act"><a class="btn ghost" href="/">Back to Caldera</a></div>`) };
}
/** Confirm -> Linking on submit: the button disables and the line moves until the answer comes (the form posts normally) */
export const LINK_JS = `(function(){var f=document.getElementById('lk-form');if(!f)return;f.addEventListener('submit',function(){var p=document.querySelector('.lk-pair');if(p)p.setAttribute('data-s','linking');
var b=f.querySelector('button[type=submit]');if(b){b.disabled=true;b.innerHTML='Linking&hellip;'}f.setAttribute('aria-busy','true');var g=f.querySelector('.ghost');if(g)g.style.display='none';
var n=document.getElementById('lk-note');if(n){n.textContent='This takes a few seconds.';n.setAttribute('role','status')}var w=document.getElementById('lk-who');if(w)w.hidden=true})})();`;

// ---------------------------------------------------------------- 6. Settings row
export const FLEET_SETTINGS_CSS = `.conn-body .of-set-p{margin:0 0 12px;color:var(--text-muted,#9A9AA6);font-size:13.5px;max-width:60ch}
.of-set-a{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}.of-set-a .btn{min-height:40px;cursor:pointer;font:inherit;font-weight:600;font-size:14px}.of-set-a form{margin:0}.of-set-a[hidden]{display:none}
.of-set-l{display:inline-flex;align-items:center;min-height:40px;font-size:13.5px}
.of-set-c{margin:0;padding:14px;border:1px solid rgba(240,113,106,.45);border-radius:10px;background:var(--bg,#1C1C1F)}.of-set-c[hidden]{display:none}
.of-set-c b{display:block;color:var(--text-strong,#F7F7FA);margin:0 0 4px}.of-set-c p{margin:0 0 12px;color:var(--text-muted,#9A9AA6);font-size:13.5px;max-width:60ch}
.of-set-a .btn.of-danger{background:transparent;border:1px solid #E5484D;color:#F0716A}:root[data-theme="light"] .of-set-a .btn.of-danger{color:#C62A2F}`;
export const FLEET_SETTINGS_JS = `<script>(function(){document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-of]');if(!b)return;var ask=b.getAttribute('data-of')==='ask',a=document.getElementById('of-un'),c=document.getElementById('of-un-c');if(!a||!c)return;a.hidden=ask;c.hidden=!ask;(ask?c.querySelector('[data-of=keep]'):a.querySelector('[data-of=ask]')).focus()});
if(location.hash==='#conn-orpheus'){var d=document.getElementById('conn-orpheus');if(d)d.open=true}})()</script>`;
/** one <details class="conn-row"> (the Connections panel's row look); handle = the member's Caldera handle */
export function fleetSettingsRow(handle: string, f: { founding: boolean } | null): string {
  if (f) return `<details class="conn-row" id="conn-orpheus"><summary><span class="conn-dot on" role="img" aria-label="Connected"></span><span class="conn-t"><b>Orpheus</b><span>Linked as @${esc(handle)}${f.founding ? " &middot; Founding Fleet" : ""}</span></span><span class="conn-act"><span class="when-closed">Details &rsaquo;</span><span class="when-open">Close</span></span></summary><div class="conn-body"><p class="of-set-p">Your profile shows the Runs on Orpheus badge and the Agent fleet card. Your city has an Orpheus pin on the world map. Counts update once a day.</p><div class="of-set-a" id="of-un"><button type="button" class="btn small ghost" data-of="ask" aria-controls="of-un-c">Remove</button><a class="of-set-l" href="/@${esc(handle)}/">See your profile</a></div><div class="of-set-c" id="of-un-c" role="group" aria-labelledby="of-un-t" hidden><b id="of-un-t">Remove the Orpheus link?</b><p>The badge, the Agent fleet card and the map pin go away. Your scores and your Orpheus account do not change. You can link again from Orpheus settings.</p><div class="of-set-a"><form method="post" action="/settings/orpheus/unlink"><button class="btn small of-danger" type="submit">Remove link</button></form><button type="button" class="btn small ghost" data-of="keep">Keep</button></div></div></div></details>`;
  return `<details class="conn-row" id="conn-orpheus"><summary><span class="conn-dot" role="img" aria-label="Not connected"></span><span class="conn-t"><b>Orpheus</b><span>Not linked</span></span><span class="conn-act"><span class="when-closed">Connect &rsaquo;</span><span class="when-open">Close</span></span></summary><div class="conn-body"><p class="of-set-p">Run Claude agents with Orpheus? Open Orpheus settings and choose Show my fleet on Caldera.</p><div class="of-set-a"><a class="btn small ghost" href="${esc(fleetHref("profile", handle))}" target="_blank" rel="noopener">Try Orpheus free</a></div></div></details>`;
}
