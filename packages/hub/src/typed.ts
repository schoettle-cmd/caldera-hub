/**
 * Designer and Business profiles (Mike approved 2026-10-30, canvas "Caldera Profile Types"). They're email pages
 * (emailpages.ts) with a `kind` and their own sections, colors and city:
 *  - Designer: portfolio (projects with images and case-study text), disciplines, tools, open for work, availability,
 *    clients. City: each project is a building.
 *  - Business: companies (role, years, exited, logo), looking for (hiring, raising, partners), sectors.
 *    City: each company is a building.
 * Developer pages are everything else (GitHub, Obsidian, AI-written email pages) and keep today's look.
 */
import { TYPE_THEME, TYPE_LIMITS } from "./join";

export type Kind = "designer" | "business";
export const okKind = (v: unknown): Kind | "" => v === "designer" || v === "business" ? v : "";
export interface Work { id: string; title: string; url?: string; about?: string; images: string[]; year?: string }
export interface Company { id: string; name: string; role?: string; years?: string; exited?: boolean; url?: string; team?: number; logo?: string }
export interface Typed {
  kind?: Kind;
  /** an optional second type (approved, no UI yet): stored only */
  kind2?: Kind;
  disciplines?: string[]; tools?: string[]; open?: boolean; availability?: string; clients?: string[]; work?: Work[];
  companies?: Company[]; looking?: { hiring?: string; raising?: string; partners?: string }; sectors?: string[];
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const clean = (v: unknown, n: number) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
export const okUrl = (u: string) => /^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length <= 300;
export const list = (v: unknown, n = 12, w = 32) => String(v ?? "").split(/[,;\n]/).map(x => clean(x, w)).filter(Boolean).slice(0, n);
export const newId = () => Math.random().toString(36).slice(2, 10);

/** what the city builds from: one building per portfolio project or company */
export function typedProjects(t: Typed): { name: string; status: string; url: string; about: string }[] | null {
  if (t.kind === "designer") return (t.work || []).map(w => ({ name: w.title, status: "Design", url: w.url || "", about: w.about || "" }));
  if (t.kind === "business") return (t.companies || []).map(co => ({ name: co.name, status: co.exited ? "Exited" : "Company", url: co.url || "", about: co.role || "" }));
  return null;
}

/** the type's colors over the profile theme (renderProfile's tokens) */
function themeCss(kind: Kind): string {
  const T = TYPE_THEME[kind];
  return `<style>:root,.theme-dark,body{--accent:${T.accent};--accent-soft:${T.surface};--bg:${T.ground};--bg-raised:${T.surface};--bg-sunken:${T.ground};--line:${T.line};--text:${T.ink};--text-strong:${T.ink};--text-muted:${T.mut}}
body{background:${T.ground}}.ct{margin:20px 0 26px;display:flex;flex-direction:column;gap:18px}.ct-badge{display:inline-flex;align-items:center;gap:6px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:${T.accent};border:1px solid ${T.line};border-radius:6px;padding:4px 8px}
.ct-open{display:inline-flex;margin-left:8px;background:#2F4A3A;color:#9FE6B8;border-radius:999px;padding:4px 11px;font:600 12.5px 'IBM Plex Sans',Arial,sans-serif}
.ct-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ct-k{font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:${T.mut};margin-right:4px}
.ct-chip{background:${T.surface};color:${T.accent2};border-radius:999px;padding:5px 12px;font-size:13px}.ct-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}@media (max-width:760px){.ct-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ct-w{display:flex;flex-direction:column;gap:8px;color:inherit;text-decoration:none}.ct-img{aspect-ratio:4/3;border-radius:14px;background:${T.surface};border:1px solid ${T.line};overflow:hidden;display:grid;place-items:center;color:${T.mut};font:500 11px 'IBM Plex Mono',monospace}
.ct-img img{width:100%;height:100%;object-fit:cover}.ct-t{font-weight:600}.ct-a{font-size:13.5px;color:${T.mut};line-height:1.45}
.ct-card{background:${T.surface};border:1px solid ${T.line};border-radius:14px;padding:18px}.ct-look{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}@media (max-width:760px){.ct-look{grid-template-columns:1fr}}
.ct-look div{background:${T.ground};border-radius:10px;padding:13px;display:flex;flex-direction:column;gap:4px}.ct-co{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid ${T.line}}
.ct-logo{width:52px;height:52px;border-radius:12px;background:${T.accent};color:${T.ground};display:grid;place-items:center;font-weight:700;overflow:hidden}.ct-logo img{width:100%;height:100%;object-fit:cover}.ct-ex{color:${T.accent};font-size:12.5px;font-weight:600}</style>`;
}

/** The type's sections, right under the name: the first row of work (or the looking-for card) stays visible to visitors;
 *  .cal-typed-more starts what the signed-out blur covers. Images are under img/ in the published page. */
export function typedSections(t: Typed): string {
  if (t.kind === "designer") {
    const w = t.work || [];
    const tile = (x: Work) => `<${x.url ? `a href="${esc(x.url)}" rel="nofollow noopener"` : "div"} class="ct-w"><div class="ct-img">${x.images[0] ? `<img src="img/work/${esc(x.images[0])}" alt="${esc(x.title)}" loading="lazy">` : "No image yet"}</div><span class="ct-t">${esc(x.title)}</span>${x.about ? `<span class="ct-a">${esc(x.about)}</span>` : ""}</${x.url ? "a" : "div"}>`;
    const chips = (k: string, xs?: string[]) => xs && xs.length ? `<div class="ct-row"><span class="ct-k">${k}</span>${xs.map(x => `<span class="ct-chip">${esc(x)}</span>`).join("")}</div>` : "";
    return `<div class="ct"><div><span class="ct-badge">Designer</span>${t.open ? `<span class="ct-open">Open for work</span>` : ""}</div>${chips("Disciplines", t.disciplines)}${chips("Tools", t.tools)}
${w.length ? `<div class="ct-k">Portfolio · ${w.length} project${w.length === 1 ? "" : "s"}</div><div class="ct-grid">${w.slice(0, 3).map(tile).join("")}</div>` : ""}</div>
${w.length > 3 || t.availability || t.clients?.length ? `<section class="ct cal-typed-more">${w.length > 3 ? `<div class="ct-grid">${w.slice(3).map(tile).join("")}</div>` : ""}${t.availability ? `<div class="ct-card"><div class="ct-k">Availability</div><p style="margin:6px 0 0">${esc(t.availability)}</p></div>` : ""}${chips("Clients", t.clients)}</section>` : ""}`;
  }
  if (t.kind === "business") {
    const L = t.looking || {}, co = t.companies || [];
    const look = [["Hiring", L.hiring], ["Raising", L.raising], ["Partners", L.partners]].filter(x => x[1]);
    const row = (c: Company) => `<div class="ct-co"><div class="ct-logo">${c.logo ? `<img src="img/logos/${esc(c.logo)}" alt="">` : esc(c.name.slice(0, 2).toUpperCase())}</div><div><div class="ct-t">${c.url ? `<a href="${esc(c.url)}" rel="nofollow noopener">${esc(c.name)}</a>` : esc(c.name)}</div><div class="ct-a">${esc([c.role, c.years].filter(Boolean).join(" · "))}</div></div><span class="ct-ex">${c.exited ? "Exited" : c.team ? `${c.team} people` : ""}</span></div>`;
    return `<div class="ct"><div><span class="ct-badge">Business</span></div>${look.length ? `<div class="ct-card"><div class="ct-k">Looking for</div><div class="ct-look" style="margin-top:10px">${look.map(([k, v]) => `<div><b>${k}</b><span class="ct-a">${esc(v)}</span></div>`).join("")}</div></div>` : ""}</div>
${co.length || t.sectors?.length ? `<section class="ct cal-typed-more">${co.length ? `<div class="ct-k">Companies</div><div>${co.map(row).join("")}</div>` : ""}${t.sectors?.length ? `<div class="ct-row"><span class="ct-k">Sectors</span>${t.sectors.map(x => `<span class="ct-chip">${esc(x)}</span>`).join("")}</div>` : ""}</section>` : ""}`;
  }
  return "";
}

/** put the type's colors and sections into a rendered profile index.html */
export function typedIndex(html: string, t: Typed): string {
  if (!t.kind) return html;
  let out = html.replace(/<\/head>/i, () => themeCss(t.kind!) + "</head>");
  const sec = typedSections(t), lede = /<p class="lede">[\s\S]*?<\/p>/;
  out = lede.test(out) ? out.replace(lede, m => m + sec) : out.replace(/(<h1 class="title">[\s\S]*?<\/h1>)/, m => m + sec);
  return out;
}

const FIELD_CSS = `<style>.ty label{display:block;font-size:13.5px;margin:10px 0 4px;color:var(--text-muted)}.ty input[type=text],.ty input[type=url],.ty input[type=email],.ty input[type=number],.ty textarea{width:100%;box-sizing:border-box;font:15px 'IBM Plex Sans',Arial,sans-serif;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px}
.ty textarea{min-height:80px}.ty .it{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.ty .it img{width:48px;height:48px;border-radius:8px;object-fit:cover}.ty .thumbs{display:flex;gap:6px;flex-wrap:wrap}</style>`;

const basic = (t: any) => `<label for="ty-n">Name</label><input type="text" id="ty-n" name="name" value="${esc(t.name ?? "")}" maxlength="80" required>
<label for="ty-hl">Headline</label><input type="text" id="ty-hl" name="headline" value="${esc(t.headline ?? "")}" maxlength="160">
<label for="ty-ab">About</label><textarea id="ty-ab" name="about" maxlength="1200">${esc(t.about ?? "")}</textarea>
<label for="ty-lo">City</label><input type="text" id="ty-lo" name="location" value="${esc(t.location ?? "")}" maxlength="60" placeholder="Los Angeles">`;

/** the type's editor on Settings (owner only): fields, add/remove items, image uploads */
export function typedEditor(t: Typed, handle: string): string {
  const K = t.kind; if (!K) return "";
  const v = (x: unknown) => esc(x ?? "");
  const up = (attr: string, label: string, max: number) => `<label class="btn small ghost" style="cursor:pointer">${label}<input type="file" accept="image/jpeg,image/png,image/webp" ${attr} data-max="${max}" style="display:none"></label>`;
  if (K === "designer") {
    const L = TYPE_LIMITS.designer, w = t.work || [];
    return `${FIELD_CSS}<section class="card ty" id="typed"><h2>Your designer profile</h2><form method="post" action="/settings/typed"><input type="hidden" name="do" value="fields">${basic(t)}
<label for="ty-d">Disciplines (comma separated)</label><input type="text" id="ty-d" name="disciplines" value="${v((t.disciplines || []).join(", "))}" maxlength="300">
<label for="ty-t">Tools</label><input type="text" id="ty-t" name="tools" value="${v((t.tools || []).join(", "))}" maxlength="300">
<label for="ty-a">Availability</label><input type="text" id="ty-a" name="availability" value="${v(t.availability)}" maxlength="160" placeholder="Taking 2 projects from Nov 15">
<label for="ty-c">Clients (comma separated)</label><input type="text" id="ty-c" name="clients" value="${v((t.clients || []).join(", "))}" maxlength="300">
<label><input type="checkbox" name="open" ${t.open ? "checked" : ""}> Open for work</label><div class="row"><button class="btn small" type="submit">Save</button></div></form></section>
<section class="card ty" id="work"><h2>Portfolio (${w.length} of ${L.projects})</h2><p class="mut">Up to ${L.imagesPerProject} images per project, 10 MB each, 300 MB in total. JPG, PNG or WebP; we remove location and camera data.</p>
${w.map(x => `<div class="it"><div><b>${v(x.title)}</b><div class="thumbs">${x.images.map(i => `<img src="/@${v(handle)}/img/work/${v(i)}" alt="">`).join("")}</div></div><div class="row" style="margin:0">${x.images.length < L.imagesPerProject ? up(`data-work="${v(x.id)}"`, "Add image", L.imageBytes) : ""}<form method="post" action="/settings/typed" style="margin:0"><input type="hidden" name="do" value="del-work"><input type="hidden" name="id" value="${v(x.id)}"><button class="btn small ghost" type="submit">Remove</button></form></div></div>`).join("")}
${w.length < L.projects ? `<form method="post" action="/settings/typed" style="margin-top:12px"><input type="hidden" name="do" value="add-work"><label for="ty-wt">Project title</label><input type="text" id="ty-wt" name="title" required maxlength="60">
<label for="ty-wu">Link (optional)</label><input type="url" id="ty-wu" name="url" maxlength="300" placeholder="https://"><label for="ty-wa">One line about it</label><input type="text" id="ty-wa" name="about" maxlength="200"><div class="row"><button class="btn small" type="submit">Add project</button></div></form>` : ""}
<p class="mut" id="ty-st" role="status"></p></section>${UP_JS}`;
  }
  const L = TYPE_LIMITS.business, co = t.companies || [], lk = t.looking || {};
  return `${FIELD_CSS}<section class="card ty" id="typed"><h2>Your business profile</h2><form method="post" action="/settings/typed"><input type="hidden" name="do" value="fields">${basic(t)}
<label for="ty-h">Hiring</label><input type="text" id="ty-h" name="hiring" value="${v(lk.hiring)}" maxlength="160" placeholder="Head of sales, US mid-market">
<label for="ty-r">Raising</label><input type="text" id="ty-r" name="raising" value="${v(lk.raising)}" maxlength="160" placeholder="Series A, opening Q1">
<label for="ty-p">Partners</label><input type="text" id="ty-p" name="partners" value="${v(lk.partners)}" maxlength="160">
<label for="ty-s">Sectors (comma separated)</label><input type="text" id="ty-s" name="sectors" value="${v((t.sectors || []).join(", "))}" maxlength="300"><div class="row"><button class="btn small" type="submit">Save</button></div></form></section>
<section class="card ty" id="companies"><h2>Companies (${co.length} of ${L.companies})</h2><p class="mut">One logo per company, up to 3 MB. JPG, PNG or WebP.</p>
${co.map(x => `<div class="it"><div style="display:flex;gap:10px;align-items:center">${x.logo ? `<img src="/@${v(handle)}/img/logos/${v(x.logo)}" alt="">` : ""}<div><b>${v(x.name)}</b><div class="mut">${v([x.role, x.years, x.exited ? "exited" : ""].filter(Boolean).join(" · "))}</div></div></div><div class="row" style="margin:0">${up(`data-co="${v(x.id)}"`, x.logo ? "Replace logo" : "Add logo", L.logoBytes)}<form method="post" action="/settings/typed" style="margin:0"><input type="hidden" name="do" value="del-co"><input type="hidden" name="id" value="${v(x.id)}"><button class="btn small ghost" type="submit">Remove</button></form></div></div>`).join("")}
${co.length < L.companies ? `<form method="post" action="/settings/typed" style="margin-top:12px"><input type="hidden" name="do" value="add-co"><label for="ty-cn">Company</label><input type="text" id="ty-cn" name="name" required maxlength="60">
<label for="ty-cr">Your role</label><input type="text" id="ty-cr" name="role" maxlength="80" placeholder="Founder and CEO"><label for="ty-cy">Years</label><input type="text" id="ty-cy" name="years" maxlength="30" placeholder="2021 to now">
<label for="ty-cu">Website (optional)</label><input type="url" id="ty-cu" name="url" maxlength="300" placeholder="https://"><label for="ty-ct">Team size (optional)</label><input type="number" id="ty-ct" name="team" min="1" max="1000000">
<label><input type="checkbox" name="exited"> Exited (acquired or sold)</label><div class="row"><button class="btn small" type="submit">Add company</button></div></form>` : ""}
<p class="mut" id="ty-st" role="status"></p></section>${UP_JS}`;
}

const UP_JS = `<script>(function(){var st=document.getElementById('ty-st');document.querySelectorAll('input[type=file][data-max]').forEach(function(i){i.addEventListener('change',function(){var f=i.files&&i.files[0];if(!f)return;
var max=+i.getAttribute('data-max');if(f.size>max){st.textContent='That image is over '+Math.round(max/1048576)+' MB.';return}st.textContent='Uploading\\u2026';var r=new FileReader();r.onload=function(){var b={data:String(r.result).split(',')[1]};
if(i.getAttribute('data-work'))b.work=i.getAttribute('data-work');if(i.getAttribute('data-co'))b.co=i.getAttribute('data-co');
fetch('/settings/typed/img',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify(b)}).then(function(x){return x.json()}).then(function(j){if(j.ok){location.href='/settings?saved=1'+(b.co?'#companies':'#work')}else{st.textContent=j.error||'Upload failed.'}}).catch(function(){st.textContent='Upload failed.'})};r.readAsDataURL(f)})})})();</script>`;

/** apply one Settings form to the profile; returns the new profile or an error */
export function applyTyped(t: Typed, f: URLSearchParams): { t: Typed; msg: string } | { error: string } {
  const K = t.kind, d = f.get("do"), out: Typed = JSON.parse(JSON.stringify(t));
  if (!K) return { error: "This page has no profile type." };
  if (d === "fields") {
    const o = out as any, nm = clean(f.get("name"), 80);
    if (nm) o.name = nm;
    for (const [k, n] of [["headline", 160], ["about", 1200], ["location", 60]] as const) if (f.has(k)) o[k] = clean(f.get(k), n);
    if (K === "designer") { out.disciplines = list(f.get("disciplines")); out.tools = list(f.get("tools")); out.clients = list(f.get("clients")); out.availability = clean(f.get("availability"), 160); out.open = !!f.get("open"); }
    else { out.looking = { hiring: clean(f.get("hiring"), 160), raising: clean(f.get("raising"), 160), partners: clean(f.get("partners"), 160) }; out.sectors = list(f.get("sectors")); }
    return { t: out, msg: "ok:Saved and republished." };
  }
  if (d === "add-work" && K === "designer") {
    const w = out.work ||= []; if (w.length >= TYPE_LIMITS.designer.projects) return { error: `That's the limit of ${TYPE_LIMITS.designer.projects} projects.` };
    const title = clean(f.get("title"), 60); if (!title) return { error: "Give the project a title." };
    const url = String(f.get("url") || "").trim(); w.push({ id: newId(), title, url: okUrl(url) ? url : "", about: clean(f.get("about"), 200), images: [] });
    return { t: out, msg: "ok:Project added. Add images to it below." };
  }
  if (d === "del-work" && K === "designer") { out.work = (out.work || []).filter(x => x.id !== f.get("id")); return { t: out, msg: "ok:Project removed." }; }
  if (d === "add-co" && K === "business") {
    const c = out.companies ||= []; if (c.length >= TYPE_LIMITS.business.companies) return { error: `That's the limit of ${TYPE_LIMITS.business.companies} companies.` };
    const name = clean(f.get("name"), 60); if (!name) return { error: "Name the company." };
    const url = String(f.get("url") || "").trim(), team = Math.max(0, Math.min(1_000_000, parseInt(String(f.get("team") || "0"), 10) || 0));
    c.push({ id: newId(), name, role: clean(f.get("role"), 80), years: clean(f.get("years"), 30), url: okUrl(url) ? url : "", exited: !!f.get("exited"), ...(team ? { team } : {}) });
    return { t: out, msg: "ok:Company added." };
  }
  if (d === "del-co" && K === "business") { out.companies = (out.companies || []).filter(x => x.id !== f.get("id")); return { t: out, msg: "ok:Company removed." }; }
  return { error: "Unknown change." };
}

/** the sign-up form for /join/designer and /join/business */
export function typedSignupForm(kind: Kind, o: { msg?: string; name?: string; headline?: string; email?: string; a?: string; b?: string; inv?: string }): string {
  const T = TYPE_THEME[kind], v = (x: unknown) => esc(x ?? "");
  const extra = kind === "designer"
    ? `<label for="ts-a">What you design (comma separated)</label><input type="text" id="ts-a" name="a" value="${v(o.a)}" maxlength="300" placeholder="Brand identity, product UI, motion">`
    : `<label for="ts-a">Your company</label><input type="text" id="ts-a" name="a" value="${v(o.a)}" maxlength="60" placeholder="Company name"><label for="ts-b">Your role</label><input type="text" id="ts-b" name="b" value="${v(o.b)}" maxlength="80" placeholder="Founder and CEO">`;
  return `<style>.ts{max-width:560px;margin:0 auto;padding:36px 16px 72px}.ts-card{background:${T.surface};border:1px solid ${T.line};border-radius:18px;padding:24px;color:${T.ink}}
.ts h1{margin:0 0 6px;font:600 clamp(1.7rem,4vw,2.3rem)/1.1 'Source Serif 4',Georgia,serif}.ts .lede{margin:0 0 16px;color:${T.mut}}.ts label{display:block;font-size:13.5px;margin:12px 0 4px;color:${T.mut}}
.ts input{width:100%;box-sizing:border-box;min-height:46px;font:15px 'IBM Plex Sans',Arial,sans-serif;background:${T.ground};color:${T.ink};border:1px solid ${T.line};border-radius:10px;padding:10px 12px}
.ts button{margin-top:18px;width:100%;min-height:48px;border:0;border-radius:12px;background:${T.accent};color:${kind === "designer" ? "#2A1216" : "#1E1607"};font:600 15px 'IBM Plex Sans',Arial,sans-serif;cursor:pointer}
.ts .err{color:#FF8A8A}.ts .fine{font-size:12.5px;color:${T.mut};margin:12px 0 0}.ts .fine a{color:${T.accent2}}.ts-eb{font:500 12px 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:${T.accent};margin:0 0 10px}</style>
<main class="ts"><div class="ts-card"><p class="ts-eb">${kind === "designer" ? "Designer" : "Business"} profile</p><h1>${kind === "designer" ? "Make your portfolio page" : "Make your business page"}</h1>
<p class="lede">${kind === "designer" ? "Your work becomes your page and your city. Add projects and images after you confirm your email." : "Your companies become your page and your city. Add companies, logos and what you're looking for after you confirm your email."}</p>
${o.msg ? `<p class="err" role="alert">${v(o.msg)}</p>` : ""}<form method="post" action="/join/${kind}">${o.inv ? `<input type="hidden" name="invite" value="${v(o.inv)}">` : ""}
<label for="ts-n">Your name</label><input type="text" id="ts-n" name="name" required maxlength="80" value="${v(o.name)}" autocomplete="name">
<label for="ts-h">Headline</label><input type="text" id="ts-h" name="headline" maxlength="160" value="${v(o.headline)}" placeholder="${kind === "designer" ? "Brand and product designer" : "Founder of a logistics software company"}">
${extra}<label for="ts-e">Email</label><input type="email" id="ts-e" name="email" required maxlength="200" value="${v(o.email)}" autocomplete="email">
<button type="submit">Email me my link</button></form><p class="fine">We email you one link; opening it publishes your page. By signing up you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p></div></main>`;
}
