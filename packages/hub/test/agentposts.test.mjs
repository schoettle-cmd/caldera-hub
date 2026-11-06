import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "@caldera/core";
import { createHub } from "../dist/server.js";

let hub, base, dir;
const ORIGIN = { origin: "https://hub.test" };
const who = ["mike", "ana", "bo", "cy", "newbie", "gone"];
const ids = Object.fromEntries(who.map(w => [w, C.newIdentity()]));
const post = (p, body, h = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const login = async id => { const { body } = await post("/v1/auth/challenge", { id: id.id }); return (await post("/v1/auth/verify", C.sign(id, "message", { nonce: body.nonce }))).body.token; };
const cookies = {};
async function cookie(w) {
  if (cookies[w]) return cookies[w];
  const { body } = await post(`/v1/owner/${ids[w].id}/link`, {}, { authorization: "Bearer " + await login(ids[w]) });
  const r = await fetch(body.url.replace("https://hub.test", base), { redirect: "manual" });
  return (cookies[w] = (r.headers.get("set-cookie") || "").split(";")[0]);
}
const as = async (w, p, body = {}, extra = {}) => post(p, body, { cookie: await cookie(w), ...ORIGIN, ...extra });
const newToken = async (w, name) => { const r = await as(w, "/v1/agent/tokens", { name }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const say = (token, body) => post("/v1/agent/posts", body, { authorization: "Bearer " + token });
const items = async (type, h = {}) => (await (await fetch(`${base}/v1/feed?fresh=1&type=${type}`, { headers: h })).json()).items;
const html = async (p, w) => (await fetch(base + p, { headers: w ? { cookie: await cookie(w) } : {} })).text();

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-agents-"));
  hub = createHub({ dataDir: dir, publicUrl: "https://hub.test", limits: { newProfilesPerDay: 100 }, agentLimits: { reportsToHide: 2 } });
  base = "http://127.0.0.1:" + await hub.listen(0);
  for (const w of who) {
    const m = C.sign(ids[w], "profile.manifest", { name: w.toUpperCase(), handle: w, boxKey: ids[w].boxPublic, headline: "Builder", topics: [["ai agents", 5]], languages: ["TypeScript"] });
    await post(`/v1/profiles/${ids[w].id}/bundle`, { manifest: m, files: { "index.html": Buffer.from("<html><head></head><body><p>hi</p></body></html>").toString("base64") } });
  }
  // everyone but newbie is past the new-account limit
  hub.db.prepare("UPDATE profiles SET created=? WHERE handle<>'newbie'").run(new Date(Date.now() - 30 * 86400_000).toISOString());
});
after(() => { delete process.env.CALDERA_AGENT_POSTS_OFF; hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test("auth: tokens need a same-origin member; posts need a real token; only a hash is stored", async () => {
  assert.equal((await post("/v1/agent/tokens", { name: "Helper" }, ORIGIN)).status, 401, "signed out");
  assert.equal((await as("ana", "/v1/agent/tokens", { name: "Helper" }, { origin: "https://evil.example" })).status, 403, "cross-site");
  assert.equal((await post("/v1/agent/posts", { text: "no token at all here" })).status, 401);
  assert.equal((await say("cal_agent_wrong", { text: "a wrong token here" })).status, 401);
  const { token, id } = await newToken("ana", "Helper One");
  assert.match(token, /^cal_agent_[A-Za-z0-9_-]{43}$/);
  const row = hub.db.prepare("SELECT * FROM agent_tokens WHERE id=?").get(id);
  assert.equal(row.hash, crypto.createHash("sha256").update(token).digest("hex"));
  assert.ok(!JSON.stringify(row).includes(token), "plain token is not stored");
  assert.ok(!(await html("/settings/agents", "ana")).includes(token), "settings can't show it again");
  assert.ok(!JSON.stringify(hub.admin["agent-token-list"]()).includes(row.hash), "operator list leaves out the hash");
  const r = await say(token, { text: "Hello from a real token", tag: "News" });
  assert.equal(r.status, 200); assert.equal(r.body.owner, "ana"); assert.equal(r.body.tag, "news");
  assert.ok(!JSON.stringify(r.body).includes(token));
});

test("a token can't use a person's name or pass for Caldera", async () => {
  for (const name of ["ana", "BO", "Caldera News", "Site Admin", "x", "bad!name"]) assert.equal((await as("cy", "/v1/agent/tokens", { name })).status, 400, name);
  assert.equal((await as("cy", "/v1/agent/tokens", { name: "helper one" })).status, 400, "another agent's name");
});

test("revoked token stops at once, its posts stay until deleted, and another member can't revoke it", async () => {
  const { token, id } = await newToken("bo", "Revoke Me");
  assert.equal((await say(token, { text: "Posted before the revoke" })).status, 200);
  assert.equal((await as("cy", `/v1/agent/tokens/${id}/revoke`)).status, 404);
  assert.equal((await say(token, { text: "Still works after that try" })).status, 200);
  assert.equal((await as("bo", `/v1/agent/tokens/${id}/revoke`)).status, 200);
  assert.equal((await say(token, { text: "Should not get through" })).status, 401);
});

test("dry run checks everything and writes nothing", async () => {
  const { token } = await newToken("cy", "Dry Runner");
  const n = () => hub.db.prepare("SELECT COUNT(*) n FROM agent_posts").get().n, before = n();
  const r = await say(token, { text: "Only a test of the path", link: "https://example.com/a", dry_run: true });
  assert.equal(r.status, 200); assert.equal(r.body.posted, false); assert.match(r.body.would_post.label, /on its own\. @cy did not review it/);
  assert.equal(n(), before);
  assert.equal((await say(token, { text: "x", dry_run: true })).status, 400, "still validates");
});

test("rate limits: 5 a day per agent, a re-created token doesn't reset it, 10 a day per owner, repeats refused", async () => {
  const a = await newToken("mike", "Limit One");
  for (let i = 0; i < 5; i++) assert.equal((await say(a.token, { text: `Limit test number ${i}` })).status, 200, `post ${i}`);
  const sixth = await say(a.token, { text: "Limit test number six" }); assert.equal(sixth.status, 429); assert.match(sixth.body.error, /5 posts today/);
  await as("mike", `/v1/agent/tokens/${a.id}/revoke`);
  const again = await newToken("mike", "Limit One");
  assert.equal((await say(again.token, { text: "Fresh token same agent" })).status, 429, "same agent, same limit");
  const b = await newToken("mike", "Limit Two");
  assert.equal((await say(b.token, { text: "Same words again here" })).status, 200);
  assert.equal((await say(b.token, { text: "Same words again here" })).status, 409);
  for (let i = 0; i < 4; i++) assert.equal((await say(b.token, { text: `Second agent post ${i}` })).status, 200);
  const c = await newToken("mike", "Limit Three");
  const over = await say(c.token, { text: "Past the owner limit now" }); assert.equal(over.status, 429); assert.match(over.body.error, /10 agent posts today/);
  // deleting doesn't refill it
  const row = hub.db.prepare("SELECT id FROM agent_posts WHERE agent='Limit Two' LIMIT 1").get();
  assert.equal((await as("mike", `/v1/agent/posts/${row.id}/delete`)).status, 200);
  assert.equal((await say(c.token, { text: "Still past the owner limit" })).status, 429);
});

test("new accounts: 1 post a day and no links; 5 agents at most", async () => {
  const { token } = await newToken("newbie", "New Agent");
  assert.equal((await say(token, { text: "First post with a link", link: "https://example.com" })).status, 403);
  assert.equal((await say(token, { text: "First post with no link" })).status, 200);
  assert.equal((await say(token, { text: "Second post the same day" })).status, 429);
  for (let i = 2; i <= 5; i++) await newToken("newbie", `New Agent ${i}`);
  assert.equal((await as("newbie", "/v1/agent/tokens", { name: "New Agent 6" })).status, 429);
});

test("kill switch stops tokens and posts, even dry runs; a token can still take its post back", async () => {
  const { token } = await newToken("cy", "Kill Test");
  const r = await say(token, { text: "Posted before the switch" });
  process.env.CALDERA_AGENT_POSTS_OFF = "1";
  try {
    assert.equal((await say(token, { text: "Blocked by the switch" })).status, 503);
    assert.equal((await say(token, { text: "Blocked dry run too", dry_run: true })).status, 503);
    assert.equal((await as("cy", "/v1/agent/tokens", { name: "Kill Two" })).status, 503);
    assert.doesNotMatch(await html("/settings/agents", "cy"), /Set up yours/);
    assert.match(await html("/settings/agents", "cy"), /paused right now/);
    assert.equal((await post(`/v1/agent/posts/${r.body.id}/delete`, {}, { authorization: "Bearer " + token })).status, 200);
  } finally { delete process.env.CALDERA_AGENT_POSTS_OFF; }
  assert.equal((await say(token, { text: "Back on after the switch" })).status, 200);
});

test("filters: All has both, People has none, Agents has only agent posts", async () => {
  const count = hub.db.prepare("SELECT COUNT(*) n FROM agent_posts WHERE status='ok'").get().n;
  assert.ok(count > 0);
  const [all, people, agents] = [await items("all"), await items("people"), await items("agents")];
  const ag = l => l.filter(i => i.kind === "agent").length;
  assert.equal(ag(people), 0); assert.ok(people.length > 0);
  assert.ok(agents.every(i => i.kind === "agent")); assert.equal(agents.length, Math.min(30, count));
  assert.ok(ag(all) > 0 && all.some(i => i.kind !== "agent"));
  for (const t of ["posts", "recommends", "members", "cities", "kudos"]) assert.equal(ag(await items(t)), 0, t);
  assert.ok(agents.every(i => i.agent.reviewed_by_owner === false && i.agent.owner.handle));
  const page = await html("/feed?type=agents");
  for (const label of [">All<", ">People<", ">Agents<", ">Asks<"]) assert.ok(page.includes(label), label);
  assert.match(page, /aria-current="page">Agents</);
  assert.match(page, /fd-ag-badge">Agent</); assert.match(page, /did not review it/); assert.match(page, /by <a href="\/@/);
  assert.ok(!page.includes('class="fd-card fd-post" data-post'), "never styled as a person's post");
});

test("excluded from people's stats, matching, asks, alerts, email and the nav count", async () => {
  const { token } = await newToken("ana", "Topic Bot");
  const tables = () => Object.fromEntries(["posts", "post_links", "post_comments", "alerts"].map(t => [t, hub.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  const t0 = tables(), info0 = await (await fetch(base + "/v1/info")).json();
  const r = await say(token, { text: "Looking for a developer for AI agents in TypeScript, @bo @mike please read", tag: "ai-agents" });
  assert.equal(r.status, 200);
  assert.deepEqual(tables(), t0, "nothing in posts, links, comments or alerts");
  assert.deepEqual(await (await fetch(base + "/v1/info")).json(), info0);
  const notices = await (await fetch(base + "/v1/me/notices", { headers: { cookie: await cookie("bo") } })).json();
  assert.ok(!JSON.stringify(notices).includes("Looking for a developer"), "a mention tells nobody");
  const page = await html(`/feed/a/${r.body.id}`), card = page.slice(page.indexOf("data-agent-post"), page.indexOf("</article>"));
  assert.match(card, /@bo @mike please read/); assert.doesNotMatch(card, /<a[^>]*>@bo</, "@mentions aren't links");
  await html("/feed", "cy");   // cy has seen everything so far
  await new Promise(r => setTimeout(r, 5));
  assert.equal((await say(token, { text: "One more after cy opened the feed" })).status, 200);
  assert.equal((await (await fetch(base + "/v1/me/badges", { headers: { cookie: await cookie("cy") } })).json()).feed, 0, "agent posts don't raise the nav count");
  // a member's activity page and their human post limit are untouched
  const byAna = (await (await fetch(`${base}/v1/feed?fresh=1&author=ana`)).json()).items;
  assert.equal(byAna.filter(i => i.kind === "agent").length, 0);
  assert.equal((await as("ana", "/v1/posts", { type: "other", detail: "A real ask from a person" })).status, 200, "agent posts don't use up a person's 3 a day");
});

test("escaping: agent text, name, tag and link can't inject markup", async () => {
  const { token } = await newToken("bo", "Escape Test");
  const evil = `Hi <img src=x onerror=alert(1)> "quoted" & 'single' <script>alert(2)</script> javascript:alert(3) end`;
  const r = await say(token, { text: evil, tag: "news" });
  assert.equal(r.status, 200); assert.doesNotMatch(r.body.text, /<img|<script/);
  for (const page of [await html("/feed?type=agents"), await html(`/feed/a/${r.body.id}`)]) { const card = page.slice(page.indexOf(`data-agent-post="${r.body.id}"`)); const one = card.slice(0, card.indexOf("</article>"));
    assert.doesNotMatch(one, /<img|<script|onerror=alert\(1\)>/); assert.match(one, /&quot;quoted&quot; &amp; &#39;single&#39;/); }
  assert.equal((await say(token, { text: "A javascript link here", link: "javascript:alert(1)" })).status, 400);
  assert.equal((await say(token, { text: "A plain http link here", link: "http://example.com" })).status, 400);
  assert.equal((await say(token, { text: "A link with a quote", link: 'https://example.com/"onmouseover="x' })).status, 400);
  assert.equal((await say(token, { text: "A tag with markup in it", tag: "<b>x</b> & y" })).status, 400);
  assert.equal((await say(token, { text: "x".repeat(501) })).status, 400, "length cap");
});

test("moderation: owner deletes, others report, reports hide it, operator hides and restores, a banned or hidden owner disappears", async () => {
  const { token } = await newToken("gone", "Moderated");
  const a = await say(token, { text: "Moderation test post one" }), id = a.body.id;
  const inAgents = async i => (await items("agents")).some(x => x.agent.id === i);
  assert.equal((await as("bo", `/v1/agent/posts/${id}/delete`)).status, 404, "not yours");
  assert.equal((await as("gone", `/v1/agent/posts/${id}/report`)).status, 400, "your own");
  assert.equal(hub.admin["agent-hide"](id).hidden, id); assert.equal(await inAgents(id), false);
  assert.equal((await fetch(`${base}/feed/a/${id}`)).status, 404);
  hub.admin["agent-unhide"](id); assert.equal(await inAgents(id), true);
  await as("bo", `/v1/agent/posts/${id}/report`); assert.equal(await inAgents(id), true);
  await as("cy", `/v1/agent/posts/${id}/report`); assert.equal(await inAgents(id), false, "2 reports with this test's limit");
  assert.equal(hub.admin["agent-list"]().find(x => x.id === id).reports, 2);
  const b = await say(token, { text: "Moderation test post two" });
  assert.equal((await as("gone", `/v1/agent/posts/${b.body.id}/delete`)).status, 200); assert.equal(await inAgents(b.body.id), false);
  assert.equal(hub.db.prepare("SELECT body FROM agent_posts WHERE id=?").get(b.body.id).body, "", "text is gone");
  const c = await say(token, { text: "Moderation test post three" });
  hub.admin["post-ban"]("gone", "test"); assert.equal(await inAgents(c.body.id), false);
  assert.equal((await say(token, { text: "Banned owners can't post" })).status, 403);
  hub.admin["post-unban"]("gone"); hub.admin["agent-unhide"](c.body.id); assert.equal(await inAgents(c.body.id), true);
  hub.admin.hide("gone", "test"); assert.equal((await fetch(`${base}/feed/a/${c.body.id}`)).status, 404, "hidden member, hidden agent posts");
  assert.equal((await say(token, { text: "Hidden owners can't post" })).status, 403);
  hub.admin.unhide("gone");
});

test("notice: once per signed-in member, never signed out", async () => {
  const fresh = "bo";
  hub.db.prepare("DELETE FROM agent_notice_seen").run();
  assert.doesNotMatch(await html("/feed"), /New: agents can post/);
  assert.match(await html("/feed", fresh), /New: agents can post/);
  assert.doesNotMatch(await html("/feed", fresh), /New: agents can post/);
});

test("operator can register a token by its hash; erase removes tokens and posts", async () => {
  const token = "cal_agent_" + crypto.randomBytes(32).toString("base64url"), hash = crypto.createHash("sha256").update(token).digest("hex");
  assert.equal(hub.admin["agent-token-add"]("cy", "Registered Bot", "nothex").error, "expected a sha256 hex digest");
  const r = hub.admin["agent-token-add"]("cy", "Registered Bot", hash); assert.equal(r.name, "Registered Bot"); assert.equal(r.token, undefined);
  const p = await say(token, { text: "Registered by the operator", dry_run: true }); assert.equal(p.body.would_post.agent, "Registered Bot");
  hub.admin["agent-token-revoke"](r.id); assert.equal((await say(token, { text: "Revoked by the operator" })).status, 401);
  const owner = ids.gone.id, n = t => hub.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE owner=?`).get(owner).n;
  assert.ok(n("agent_posts") > 0 && n("agent_tokens") > 0);
  await post(`/v1/profiles/${owner}/delete`, {}, { authorization: "Bearer " + await login(ids.gone) }).catch(() => {});
  hub.admin.remove("gone", "test");
  assert.equal(n("agent_posts"), 0); assert.equal(n("agent_tokens"), 0);
});
