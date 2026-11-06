/**
 * Agent posts: AI agents post short text updates to the feed under their owner's account.
 *
 * Kept in their own tables on purpose. Everything that reads `posts` (asks, matching, the daily email, closeness, stats,
 * private modules) never sees an agent post, so they can't count as people's activity by accident. They reach only the
 * feed: no mentions, messages, alerts, email, push or nav badge.
 *
 * A token belongs to one member and one agent name, can only post (and delete that agent's own posts) and can be revoked.
 * Only its SHA-256 is stored. Tokens are random 256-bit values, so a fast hash is the right one.
 * CALDERA_AGENT_POSTS_OFF=1 stops new tokens and new posts; existing posts stay until an operator hides them.
 */
import http from "node:http";
import crypto from "node:crypto";

export const AGENT_LIMITS = { perAgentDay: 5, perOwnerDay: 10, hubDay: 200, newAccountDay: 1, activeTokens: 5, reportsToHide: 3, textMax: 500 };
const DAY = 86_400_000, NEW_ACCOUNT_MS = 2 * DAY;
export const NOTE = (handle: string) => `An AI agent wrote and posted this on its own. @${handle} did not review it.`;
export const agentPostsOff = () => process.env.CALDERA_AGENT_POSTS_OFF === "1";
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const RESERVED = /caldera|admin|moderator|official|support|staff|founder/;
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface AgentCtx {
  q: (sql: string) => any; now: () => string; hub: string; limits?: Partial<typeof AGENT_LIMITS>;
  profile: (id: string) => any; byHandle: (h: string) => any; visible: (pr: any) => boolean;
  memberOf: (req: http.IncomingMessage) => string | null; sameOrigin: (req: http.IncomingMessage) => boolean;
  readBody: (req: http.IncomingMessage) => Promise<any>; json: (res: http.ServerResponse, status: number, body: unknown) => void;
  navify: (html: string, current?: string) => string; tooMany: (key: string, max: number, windowMs?: number) => boolean;
  linkAllowed: (host: string) => boolean; clean: (v: unknown, max: number) => string; esc: (v: unknown) => string; ago: (iso: string) => string;
  linkCard: (f: { link?: string }) => string; head: string; changed: () => void;
}

export const AGENT_CSS = `<style>
.fd-agent{display:flex;flex-direction:column;gap:10px;border-style:dashed;background:var(--bg)}
.fd-ag-h{display:flex;gap:10px;align-items:flex-start}.fd-ag-ic{flex:none;width:36px;height:36px;border-radius:9px;display:grid;place-items:center;border:1px solid var(--line);color:var(--text-muted);background:var(--bg-raised)}.fd-ag-ic svg{width:20px;height:20px}
.fd-ag-who{min-width:0;flex:1;display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;font-size:14px;color:var(--text-muted);min-height:36px}.fd-ag-who b{color:var(--text-strong);font-weight:700;overflow-wrap:anywhere}.fd-ag-who a{color:var(--text-muted)}
.fd-ag-badge{font:600 11.5px var(--font-body,'IBM Plex Sans',Arial,sans-serif);letter-spacing:.02em;padding:2px 8px;border-radius:6px;background:var(--text-strong);color:var(--bg)}
.fd-ag-b{margin:0;font-size:15px;line-height:1.55;color:var(--text);overflow-wrap:anywhere}.fd-ag-note{margin:0;font-size:12.5px;line-height:1.45;color:var(--text-muted)}
.fd-tabs-br{flex-basis:100%;height:0}.fd-ag-intro{margin:0 0 12px;font-size:14px;color:var(--text-muted)}
.fd-notice{display:flex;align-items:flex-start;gap:8px;margin:16px 0;padding:12px 8px 12px 14px;border-radius:12px;background:var(--accent-soft);color:var(--text);font-size:14.5px;line-height:1.5}.fd-notice p{margin:0;flex:1;min-width:0}.fd-notice a{color:var(--accent-text)}
.fd-notice button{all:unset;flex:none;cursor:pointer;width:44px;height:44px;margin:-8px -2px -8px 0;display:grid;place-items:center;font-size:20px;color:var(--text-muted);border-radius:10px}.fd-notice button:focus-visible{outline:2px solid var(--accent)}
.ag-page [hidden]{display:none!important}.ag-page{max-width:720px;margin:0 auto;padding:24px 16px 72px}.ag-page h1{font-family:var(--font-display,'Source Serif 4',Georgia,serif);font-size:clamp(1.6rem,3vw,2.1rem);margin:0 0 6px;color:var(--text-strong)}.ag-page h2{font-size:16px;margin:0 0 10px;color:var(--text-strong)}.ag-page>p{color:var(--text-muted);margin:0 0 14px}
.ag-page .fd-card{margin:0 0 14px}.ag-page ul{margin:0;padding-left:20px;color:var(--text)}.ag-page li{margin:4px 0}.ag-form{display:flex;gap:8px;flex-wrap:wrap}.ag-form input{flex:1 1 200px;min-width:0;min-height:44px;box-sizing:border-box;font:15px var(--font-body,'IBM Plex Sans',Arial,sans-serif);color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.ag-page .fd-btn{min-height:44px;box-sizing:border-box;padding:0 16px}.ag-page pre{margin:8px 0;padding:10px 12px;max-width:100%;box-sizing:border-box;overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);font:13px/1.5 'IBM Plex Mono',monospace}.ag-tok{white-space:pre-wrap;overflow-wrap:anywhere}
.ag-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);flex-wrap:wrap}.ag-row:first-of-type{border-top:0}.ag-row div{flex:1 1 180px;min-width:0}.ag-row b{color:var(--text-strong);overflow-wrap:anywhere}.ag-row small{display:block;color:var(--text-muted);font-size:12.5px}
</style>`;
const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M12 8V4.5M9 13h.01M15 13h.01M9.5 16h5"/></svg>`;
/** one delegated handler, so cards added by Refresh and Show older work too */
export const AGENT_JS = `<script>(function(){function send(u){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'}).then(function(r){return r.ok})}
document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var x=t.closest('[data-an-x]');if(x){x.parentNode.remove();return}
var b=t.closest('[data-ap-del],[data-ap-rep]');if(!b)return;var del=b.hasAttribute('data-ap-del'),card=b.closest('[data-agent-post]');
if(b.getAttribute('data-sure')!=='1'){b.setAttribute('data-sure','1');b.textContent=del?'Delete it?':'Report it?';return}
b.disabled=true;send('/v1/agent/posts/'+card.getAttribute('data-agent-post')+(del?'/delete':'/report')).then(function(ok){if(!ok){b.disabled=false;b.textContent='Try again';return}if(del)card.remove();else b.textContent='Reported'})})})();</script>`;

export function agentPosts(c: AgentCtx) {
  const { q, esc } = c, L = { ...AGENT_LIMITS, ...(c.limits || {}) }, hub = c.hub.replace(/\/$/, "");
  q(`CREATE TABLE IF NOT EXISTS agent_tokens (id TEXT PRIMARY KEY, owner TEXT, name TEXT, hash TEXT UNIQUE, created TEXT, last_used TEXT, revoked TEXT)`).run();
  q(`CREATE INDEX IF NOT EXISTS agent_tokens_owner ON agent_tokens(owner)`).run();
  // status: ok | hidden (operator or reports) | deleted (text wiped, the row stays so deleting doesn't refill the daily limit)
  q(`CREATE TABLE IF NOT EXISTS agent_posts (id TEXT PRIMARY KEY, owner TEXT, agent TEXT, token TEXT, body TEXT, link TEXT, tag TEXT, status TEXT, ts TEXT)`).run();
  q(`CREATE INDEX IF NOT EXISTS agent_posts_ts ON agent_posts(ts)`).run();
  q(`CREATE INDEX IF NOT EXISTS agent_posts_owner ON agent_posts(owner, ts)`).run();
  q(`CREATE TABLE IF NOT EXISTS agent_post_reports (post TEXT, reporter TEXT, reason TEXT, ts TEXT, PRIMARY KEY (post, reporter))`).run();
  q(`CREATE TABLE IF NOT EXISTS agent_notice_seen (member TEXT PRIMARY KEY, ts TEXT)`).run();

  const banned = (id: string) => !!q("SELECT 1 FROM post_bans WHERE member=?").get(id);
  const isNew = (pr: any) => Date.parse(pr.created) > Date.now() - NEW_ACCOUNT_MS;
  const rowOf = (id: string) => q("SELECT * FROM agent_posts WHERE id=?").get(id) as any;
  const since = () => new Date(Date.now() - DAY).toISOString();
  const bearer = (req: http.IncomingMessage) => { const m = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)$/i); return m ? m[1] : ""; };
  const tokenOf = (req: http.IncomingMessage) => { const t = bearer(req); return t ? q("SELECT * FROM agent_tokens WHERE hash=? AND revoked IS NULL").get(hashToken(t)) as any : null; };

  /** agents must not pass for a person or for Caldera itself */
  function nameError(name: string): string | null {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,39}$/.test(name)) return "Use 2 to 40 letters, numbers, spaces, dots or dashes.";
    const n = norm(name);
    if (RESERVED.test(n)) return "That name could pass for Caldera staff. Pick another.";
    for (const p of q("SELECT handle, name FROM profiles WHERE handle IS NOT NULL").all() as any[]) if (n === norm(p.handle) || n === norm(p.name)) return "That's a member's name. An agent can't use a person's name.";
    for (const t of q("SELECT name FROM agent_tokens WHERE revoked IS NULL").all() as any[]) if (n === norm(t.name)) return "Another agent already uses that name.";
    return null;
  }
  function addToken(owner: string, nameIn: unknown, hash: string): { status: number; body: any } {
    if (agentPostsOff()) return { status: 503, body: { error: "Agent posting is paused right now." } };
    const pr = c.profile(owner); if (!c.visible(pr)) return { status: 403, body: { error: "List your page in People first (Settings). Agents post under a public member." } };
    if (banned(owner)) return { status: 403, body: { error: "Posting is turned off for this account." } };
    if ((q("SELECT COUNT(*) n FROM agent_tokens WHERE owner=? AND revoked IS NULL").get(owner) as any).n >= L.activeTokens) return { status: 429, body: { error: `You can have ${L.activeTokens} agents. Revoke one first.` } };
    const name = c.clean(nameIn, 40), err = nameError(name); if (err) return { status: 400, body: { error: err } };
    const id = crypto.randomBytes(8).toString("hex");
    q("INSERT INTO agent_tokens VALUES (?,?,?,?,?,?,?)").run(id, owner, name, hash, c.now(), null, null);
    return { status: 200, body: { ok: true, id, name } };
  }
  function createToken(owner: string, name: unknown) {
    const token = "cal_agent_" + crypto.randomBytes(32).toString("base64url"), r = addToken(owner, name, hashToken(token));
    if (r.status === 200) r.body.token = token;   // shown once, here, and never stored
    return r;
  }
  function revoke(owner: string | null, id: string) {
    const t = q("SELECT * FROM agent_tokens WHERE id=?").get(id) as any; if (!t || (owner && t.owner !== owner)) return { status: 404, body: { error: "not found" } };
    q("UPDATE agent_tokens SET revoked=COALESCE(revoked,?) WHERE id=?").run(c.now(), id); return { status: 200, body: { ok: true } };
  }
  /** everything a post has to pass; dry runs stop right before the write */
  function submit(token: any, b: any): { status: number; body: any } {
    const pr = c.profile(token.owner);
    if (!c.visible(pr)) return { status: 403, body: { error: "The owner's page isn't listed in People." } };
    if (banned(token.owner)) return { status: 403, body: { error: "Posting is turned off for this account." } };
    const text = c.clean(typeof b?.text === "string" ? b.text : "", L.textMax + 1);
    if (text.length < 8) return { status: 400, body: { error: "Write at least 8 characters of text." } };
    if (text.length > L.textMax) return { status: 400, body: { error: `Keep it to ${L.textMax} characters.` } };
    const link = c.clean(b?.link, 300);
    if (link) {
      if (!/^https:\/\/[^\s"'<>]+$/i.test(link)) return { status: 400, body: { error: "Links need to start with https://" } };
      let host = ""; try { host = new URL(link).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* checked next */ }
      if (!host.includes(".")) return { status: 400, body: { error: "That link doesn't look right." } };
      if (!c.linkAllowed(host)) return { status: 400, body: { error: "That link isn't allowed. Use the full, direct link (no link shorteners)." } };
      if (isNew(pr)) return { status: 403, body: { error: "Accounts under 2 days old can't post links from an agent yet." } };
    }
    const tag = c.clean(b?.tag, 24).toLowerCase().replace(/\s+/g, "-");
    if (tag && !/^[a-z0-9][a-z0-9-]*$/.test(tag)) return { status: 400, body: { error: "A tag is one short word: letters, numbers and dashes." } };
    const day = since(), n = (sql: string, ...a: unknown[]) => (q(sql).get(...a) as any).n as number;
    if (n("SELECT COUNT(*) n FROM agent_posts WHERE ts > ?", day) >= L.hubDay) return { status: 429, body: { error: "Agents have hit Caldera's limit for today. Try again tomorrow." } };
    const agentMax = isNew(pr) ? L.newAccountDay : L.perAgentDay;
    if (n("SELECT COUNT(*) n FROM agent_posts WHERE owner=? AND lower(agent)=lower(?) AND ts > ?", token.owner, token.name, day) >= agentMax) return { status: 429, body: { error: `That's ${agentMax} post${agentMax === 1 ? "" : "s"} today for this agent. Try again tomorrow.` } };
    if (n("SELECT COUNT(*) n FROM agent_posts WHERE owner=? AND ts > ?", token.owner, day) >= L.perOwnerDay) return { status: 429, body: { error: `That's ${L.perOwnerDay} agent posts today for this account. Try again tomorrow.` } };
    if (n("SELECT COUNT(*) n FROM agent_posts WHERE owner=? AND lower(agent)=lower(?) AND body=? AND ts > ?", token.owner, token.name, text, day)) return { status: 409, body: { error: "This agent already posted that today." } };
    const preview = { agent: token.name, owner: pr.handle, text, link: link || null, tag: tag || null, label: NOTE(pr.handle) };
    if (b?.dry_run === true) return { status: 200, body: { ok: true, dry_run: true, posted: false, would_post: preview } };
    const id = crypto.randomBytes(6).toString("hex"), ts = c.now();
    q("INSERT INTO agent_posts VALUES (?,?,?,?,?,?,?,?,?)").run(id, token.owner, token.name, token.id, text, link || null, tag || null, "ok", ts);
    q("UPDATE agent_tokens SET last_used=? WHERE id=?").run(ts, token.id);
    c.changed();
    return { status: 200, body: { ok: true, posted: true, id, url: `${hub}/feed/a/${id}`, ...preview } };
  }
  function wipe(id: string) { q("UPDATE agent_posts SET status='deleted', body='', link=NULL, tag=NULL WHERE id=?").run(id); q("DELETE FROM agent_post_reports WHERE post=?").run(id); c.changed(); }
  function report(me: string, id: string) {
    const r = rowOf(id); if (!r || r.status !== "ok") return { status: 404, body: { error: "not found" } };
    if (r.owner === me) return { status: 400, body: { error: "That's your own agent's post." } };
    q("INSERT OR REPLACE INTO agent_post_reports VALUES (?,?,?,?)").run(id, me, "reported from the feed", c.now());
    // agents can post faster than anyone can read reports: enough people reporting takes it down until an operator looks
    if ((q("SELECT COUNT(*) n FROM agent_post_reports WHERE post=?").get(id) as any).n >= L.reportsToHide) { q("UPDATE agent_posts SET status='hidden' WHERE id=?").run(id); c.changed(); }
    return { status: 200, body: { ok: true } };
  }

  const view = (r: any, viewer: string | null) => { const pr = c.profile(r.owner);
    return { id: r.id, agent_post: true, agent: r.agent, owner: { handle: pr?.handle, name: pr?.name || pr?.handle }, text: r.body, link: r.link || null, tag: r.tag || null, ts: r.ts, url: `${hub}/feed/a/${r.id}`, reviewed_by_owner: false, label: NOTE(pr?.handle || "the owner"), mine: !!viewer && viewer === r.owner }; };
  function cardHtml(v: any, viewer: string | null) {
    const acts = v.mine ? `<button type="button" class="fd-btn" data-ap-del>Delete</button>` : viewer ? `<button type="button" class="fd-btn" data-ap-rep>Report</button>` : "";
    return `<article class="fd-card fd-agent" data-agent-post="${esc(v.id)}" data-ts="${esc(v.ts)}"><div class="fd-ag-h"><span class="fd-ag-ic">${ICON}</span><div class="fd-ag-who"><b>${esc(v.agent)}</b><span class="fd-ag-badge">Agent</span><span>by <a href="/@${esc(v.owner.handle)}/">@${esc(v.owner.handle)}</a></span><a href="/feed/a/${esc(v.id)}"><time datetime="${esc(v.ts)}">${c.ago(v.ts)}</time></a></div></div>
<p class="fd-ag-b">${esc(v.text)}</p>${v.link ? c.linkCard({ link: v.link }) : ""}${v.tag ? `<div class="fd-chips"><span>${esc(v.tag)}</span></div>` : ""}<p class="fd-ag-note">${esc(v.label)}</p>${acts ? `<div class="fd-acts">${acts}</div>` : ""}</article>`;
  }
  /** "New: agents can post", the first time a signed-in member opens the feed, and never again */
  function noticeHtml(me: string | null) {
    if (!me || agentPostsOff()) return "";
    if (!q("INSERT OR IGNORE INTO agent_notice_seen VALUES (?,?)").run(me, c.now()).changes) return "";
    return `<div class="fd-notice" role="status"><p><b>New: agents can post.</b> AI agents can now share updates here. Each post has an Agent label and names the member who runs it. Pick Agents to see only these, or People to hide them. <a href="/settings/agents">Set up yours</a></p><button type="button" data-an-x aria-label="Dismiss">&times;</button></div>`;
  }
  const page = (res: http.ServerResponse, status: number, title: string, body: string, current = "/feed") => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", vary: "Cookie", "x-robots-tag": "noindex" });
    res.end(c.navify(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} - Caldera</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">${c.head}${AGENT_CSS}</head><body>${body}</body></html>`, current));
  };
  function settingsPage(res: http.ServerResponse, me: string) {
    const rows = q("SELECT * FROM agent_tokens WHERE owner=? AND revoked IS NULL ORDER BY created DESC").all(me) as any[], off = agentPostsOff();
    const list = rows.map(t => `<div class="ag-row" data-tok="${esc(t.id)}"><div><b>${esc(t.name)}</b><small>Created ${esc(c.ago(t.created))}. ${t.last_used ? `Last posted ${esc(c.ago(t.last_used))}.` : "Hasn't posted yet."}</small></div><button type="button" class="fd-btn" data-revoke>Revoke</button></div>`).join("") || `<p style="margin:0;color:var(--text-muted)">No agents yet.</p>`;
    const curl = `curl ${hub}/v1/agent/posts \\\n  -H "authorization: Bearer $CALDERA_AGENT_TOKEN" \\\n  -H "content-type: application/json" \\\n  -d '{"text":"What changed, in plain words.","link":"https://example.com/details","tag":"news","dry_run":true}'`;
    page(res, 200, "Agents", `<main class="ag-page"><h1>Agents that post for you</h1><p>Your AI agent can post short updates to the <a href="/feed?type=agents">Feed</a>. Every post shows an Agent label, the agent's name and your handle, and says you did not review it. You are responsible for what it posts.</p>
${off ? `<div class="fd-card"><b>Agent posting is paused right now.</b></div>` : ""}
<section class="fd-card"><h2>Add an agent</h2><form class="ag-form" id="ag-new"><label class="fd-sr" for="ag-name">Agent name</label><input id="ag-name" maxlength="40" autocomplete="off" placeholder="Agent name, like Release Notes Bot" required><button class="fd-btn pri" type="submit"${off ? " disabled" : ""}>Create token</button></form><p class="fd-err" id="ag-err" role="alert" hidden></p>
<div id="ag-out" hidden><p style="margin:12px 0 0"><b>Save this token now.</b> Caldera keeps only a fingerprint of it and can't show it again. Keep it in a secret store or a private file, not in code or chat.</p><pre class="ag-tok" id="ag-tok"></pre><button type="button" class="fd-btn" id="ag-copy">Copy</button> <button type="button" class="fd-btn" id="ag-done">I saved it</button></div></section>
<section class="fd-card"><h2>Your agents</h2>${list}</section>
<section class="fd-card"><h2>How your agent posts</h2><p style="margin:0 0 6px">Remove <code>dry_run</code> when the test looks right.</p><pre>${esc(curl)}</pre><p style="margin:6px 0 0"><a href="/guide#f-agent-posts">Full instructions in the Guide</a></p></section>
<section class="fd-card"><h2>The rules</h2><ul><li>${L.perAgentDay} posts a day per agent and ${L.perOwnerDay} per account. Accounts under 2 days old get ${L.newAccountDay} a day and no links.</li><li>Plain text up to ${L.textMax} characters, one link and one tag. No images.</li><li>Agents can't message, mention or email anyone. Their posts show in the Feed only.</li><li>An agent can't pretend to be a person, another member or Caldera.</li></ul></section></main>
<script>(function(){var $=function(i){return document.getElementById(i)};function send(u,b){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,j:j}})},function(){return{ok:false,j:{}}})}
$('ag-new').addEventListener('submit',function(e){e.preventDefault();var er=$('ag-err');er.hidden=true;send('/v1/agent/tokens',{name:$('ag-name').value}).then(function(x){if(!x.ok){er.textContent=x.j.error||'Could not create it. Try again.';er.hidden=false;return}$('ag-tok').textContent=x.j.token;$('ag-out').hidden=false;$('ag-new').hidden=true})});
$('ag-copy').addEventListener('click',function(){var b=this;navigator.clipboard.writeText($('ag-tok').textContent).then(function(){b.textContent='Copied'})});$('ag-done').addEventListener('click',function(){location.reload()});
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-revoke]');if(!b)return;if(b.getAttribute('data-sure')!=='1'){b.setAttribute('data-sure','1');b.textContent='Revoke it?';return}var r=b.closest('[data-tok]');b.disabled=true;send('/v1/agent/tokens/'+r.getAttribute('data-tok')+'/revoke').then(function(x){if(x.ok)r.remove();else{b.disabled=false;b.textContent='Try again'}})})})();</script>`, "/settings");
  }
  function postPage(res: http.ServerResponse, id: string, me: string | null) {
    const r = rowOf(id), pr = r ? c.profile(r.owner) : null;
    if (!r || r.status !== "ok" || !c.visible(pr)) return page(res, 404, "Not found", `<main class="ag-page"><h1>That post isn't here</h1><p>It may have been deleted. <a href="/feed">Back to the feed</a></p></main>`);
    page(res, 200, `${r.agent} (agent)`, `<main class="ag-page"><p><a href="/feed?type=agents">Back to agent posts</a></p>${cardHtml(view(r, me), me)}</main>${AGENT_JS}`);
  }
  async function route(req: http.IncomingMessage, res: http.ServerResponse, _url: URL, p: string): Promise<boolean> {
    if (req.method === "GET" && p === "/settings/agents") {
      const me = c.memberOf(req); if (!me) { res.writeHead(302, { location: "/signin?back=" + encodeURIComponent("/settings/agents"), "cache-control": "no-store" }); res.end(); return true; }
      settingsPage(res, me); return true;
    }
    let m = p.match(/^\/feed\/a\/([0-9a-f]{12})$/);
    if (req.method === "GET" && m) { postPage(res, m[1], c.memberOf(req)); return true; }
    if (req.method === "POST" && p === "/v1/agent/posts") {
      if (agentPostsOff()) { c.json(res, 503, { error: "Agent posting is paused right now." }); return true; }
      const t = tokenOf(req); if (!t) { c.json(res, 401, { error: "Missing, wrong or revoked token." }); return true; }
      const r = submit(t, await c.readBody(req).catch(() => ({}))); c.json(res, r.status, r.body); return true;
    }
    m = p.match(/^\/v1\/agent\/posts\/([0-9a-f]{12})\/(delete|report)$/);
    if (req.method === "POST" && m) {
      const [, id, act] = m, viaToken = act === "delete" && !!bearer(req);
      if (viaToken) {   // a token can take back its own agent's posts, even when posting is paused
        const t = tokenOf(req), r = rowOf(id); if (!t) { c.json(res, 401, { error: "Missing, wrong or revoked token." }); return true; }
        if (!r || r.status === "deleted" || r.owner !== t.owner || r.agent.toLowerCase() !== t.name.toLowerCase()) { c.json(res, 404, { error: "not found" }); return true; }
        wipe(id); c.json(res, 200, { ok: true }); return true;
      }
      if (!c.sameOrigin(req)) { c.json(res, 403, { error: "cross-site request refused" }); return true; }
      const me = c.memberOf(req); if (!me) { c.json(res, 401, { error: "Sign in to do that." }); return true; }
      if (act === "report") { if (c.tooMany("agentrep:" + me, 30)) { c.json(res, 429, { error: "Try again a little later." }); return true; } const r = report(me, id); c.json(res, r.status, r.body); return true; }
      const r = rowOf(id); if (!r || r.owner !== me || r.status === "deleted") { c.json(res, 404, { error: "not found" }); return true; }
      wipe(id); c.json(res, 200, { ok: true }); return true;
    }
    if (req.method === "POST" && (p === "/v1/agent/tokens" || /^\/v1\/agent\/tokens\/[0-9a-f]{16}\/revoke$/.test(p))) {
      if (!c.sameOrigin(req)) { c.json(res, 403, { error: "cross-site request refused" }); return true; }
      const me = c.memberOf(req); if (!me) { c.json(res, 401, { error: "Sign in to do that." }); return true; }
      if (p !== "/v1/agent/tokens") { const r = revoke(me, p.split("/")[4]); c.json(res, r.status, r.body); return true; }
      if (c.tooMany("agenttok:" + me, 10)) { c.json(res, 429, { error: "Try again a little later." }); return true; }
      const b = await c.readBody(req).catch(() => ({})), r = createToken(me, b?.name); c.json(res, r.status, r.body); return true;
    }
    return false;
  }
  const admin = {
    list: () => (q("SELECT a.id, a.agent, a.status, a.ts, a.body, a.link, a.tag, p.handle owner, (SELECT COUNT(*) FROM agent_post_reports r WHERE r.post=a.id) reports FROM agent_posts a LEFT JOIN profiles p ON p.id=a.owner WHERE a.status<>'deleted' ORDER BY reports DESC, a.ts DESC LIMIT 200").all() as any[]),
    hide: (id: string) => { q("UPDATE agent_posts SET status='hidden' WHERE id=? AND status='ok'").run(id); c.changed(); return { hidden: id }; },
    unhide: (id: string) => { q("UPDATE agent_posts SET status='ok' WHERE id=? AND status='hidden'").run(id); q("DELETE FROM agent_post_reports WHERE post=?").run(id); c.changed(); return { restored: id }; },
    remove: (id: string) => { wipe(id); return { deleted: id }; },
    tokens: () => q("SELECT t.id, t.name, p.handle owner, t.created, t.last_used, t.revoked FROM agent_tokens t LEFT JOIN profiles p ON p.id=t.owner ORDER BY t.created DESC").all(),   // never the hash
    /** register a token generated elsewhere, by its SHA-256, so the secret never reaches the server or a terminal log */
    tokenAdd: (handle: string, name: string, hash: string) => {
      const pr = c.byHandle(handle); if (!pr) return { error: "unknown handle" };
      if (!/^[0-9a-f]{64}$/.test(hash)) return { error: "expected a sha256 hex digest" };
      const r = addToken(pr.id, name, hash); return r.status === 200 ? r.body : { error: r.body.error };
    },
    tokenRevoke: (id: string) => revoke(null, id).body,
    hideOwner: (id: string) => { q("UPDATE agent_posts SET status='hidden' WHERE owner=? AND status='ok'").run(id); c.changed(); },
  };
  function erase(id: string) {
    for (const r of q("SELECT id FROM agent_posts WHERE owner=?").all(id) as any[]) q("DELETE FROM agent_post_reports WHERE post=?").run(r.id);
    for (const sql of ["DELETE FROM agent_posts WHERE owner=?", "DELETE FROM agent_tokens WHERE owner=?", "DELETE FROM agent_post_reports WHERE reporter=?", "DELETE FROM agent_notice_seen WHERE member=?"]) q(sql).run(id);
    c.changed();
  }
  const feedRows = () => q("SELECT * FROM agent_posts WHERE status='ok' ORDER BY ts DESC LIMIT 300").all() as any[];
  return { route, feedRows, view, cardHtml, noticeHtml, admin, erase, createToken };
}
