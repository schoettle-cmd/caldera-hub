// Agent drones on the live feeds: the district is resolved when the agent reports (hashed repo map, else the repo's name
// in the owner's own city), state TTLs (done 2 min, idle 15, quiet working demoted to idle at 15), most active first
// before any cut (live LIMIT 200, World 20 per member).
import test from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "@caldera/core";
import { createHub, foldLive } from "../dist/server.js";

const hash = r => crypto.createHash("sha256").update(r.toLowerCase()).digest("hex").slice(0, 16);
const ago = ms => new Date(Date.now() - ms).toISOString();

async function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-agents-"));
  const h = createHub({ privateNamedSince: "9999-12-31T00:00:00Z", privateModeSince: "2999-01-01T00:00:00Z", dataDir: d });
  const base = "http://127.0.0.1:" + await h.listen(0);
  const post = (p, b, tk) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(tk ? { authorization: "Bearer " + tk } : {}) }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }));
  const login = async (id) => { const { body } = await post("/v1/auth/challenge", { id: id.id }); return (await post("/v1/auth/verify", C.sign(id, "message", { nonce: body.nonce }))).body.token; };
  const uma = C.newIdentity();
  // Uma's own city: districts Forge (repos anvil, Bellows) and Garden (seed-bank); the repo names are on the page
  const city = { private: false, districts: [
    { name: "Forge", repos: [{ name: "anvil", public: true, week: 3 }, { name: "Bellows", public: true, week: 1 }] },
    { name: "Garden", repos: [{ name: "seed-bank", public: true, week: 2 }] }] };
  const page = Buffer.from(`<html><head></head><body><script type="application/json" id="city-data">${JSON.stringify(city)}</script></body></html>`).toString("base64");
  await post(`/v1/profiles/${uma.id}/bundle`, { manifest: C.sign(uma, "profile.manifest", { name: "Uma", handle: "uma", boxKey: uma.boxPublic }), files: { "index.html": page, "city.html": page } });
  const reg = await post(`/v1/owner/${uma.id}/sites`, { sites: [{ key: "eeeeeeeeeeee55", project: "Vault", public: false }], repos: { [hash("vault-bot")]: "Vault" } }, await login(uma));
  const { key, secret } = reg.body.agent;
  const report = agents => post(`/v1/agents/${key}`, { agents }, secret);
  const pub = async () => (await (await fetch(base + "/v1/live/uma")).json()).agents;
  const priv = async () => (await (await fetch(base + `/v1/owner/${uma.id}/live`, { headers: { authorization: "Bearer " + await login(uma) } })).json()).agents;
  const close = () => { h.server.close(); fs.rmSync(d, { recursive: true, force: true }); };
  return { h, uma, report, pub, priv, close };
}

test("agents: district resolved at ingest from the hashed map, else the repo's name in the owner's city; repo never public", async () => {
  const s = await setup();
  try {
    const r = await s.report([
      { id: "sess-hash", repo: "vault-bot", state: "working" },          // hashed map -> Vault (private project)
      { id: "sess-name", repo: "ANVIL", state: "working" },              // name fallback, any case -> Forge
      { id: "sess-name2", repo: "bellows", state: "thinking" },          // -> Forge
      { id: "sess-cwd", repo: "seed-bank", state: "waiting" },           // a folder name (no git) that matches a repo -> Garden
      { id: "sess-none", repo: "not-in-city", state: "working" },
      { id: "sess-empty", state: "working" }]);
    assert.equal(r.body.recorded, 6);
    const rows = Object.fromEntries(s.h.db.prepare("SELECT id, d FROM agents").all().map(x => [x.id, x.d]));
    assert.deepEqual(rows, { "sess-hash": "Vault", "sess-name": "Forge", "sess-name2": "Forge", "sess-cwd": "Garden", "sess-none": "", "sess-empty": "" }, "district stored on the row");
    const pv = Object.fromEntries((await s.priv()).map(a => [a.id, a.d]));
    assert.equal(pv["sess-name"], "Forge"); assert.equal(pv["sess-hash"], "Vault");
    const pb = await s.pub();
    assert.deepEqual(pb.map(a => a.d).sort(), ["", "", "Forge", "Forge", "Garden", "Private"], "public: city districts by name, other projects Private");
    const txt = JSON.stringify(pb); for (const w of ["anvil", "ANVIL", "vault-bot", "Vault", "not-in-city", "sess-"]) assert.ok(!txt.includes(w), "public leaks " + w);
    // a later city change does not need the agent to report again for already-placed rows (stored), and a newly
    // matching name resolves on the next report
    await s.report([{ id: "sess-none", repo: "not-in-city", state: "working" }]);
    assert.equal(s.h.db.prepare("SELECT d FROM agents WHERE id='sess-none'").get().d, "");
  } finally { s.close(); }
});

test("agents: done expires after 2 min, idle after 15, quiet working reads idle after 15 and expires 15 later", async () => {
  const s = await setup();
  try {
    await s.report([
      { id: "done-new", state: "done" }, { id: "done-old", state: "done" },
      { id: "idle-new", state: "idle" }, { id: "idle-old", state: "idle" },
      { id: "work-4m", state: "working" }, { id: "work-16m", state: "working" }, { id: "think-20m", state: "thinking" }, { id: "work-31m", state: "working" }]);
    const set = (id, ms) => s.h.db.prepare("UPDATE agents SET ts=? WHERE id=?").run(ago(ms), id);
    set("done-new", 60_000); set("done-old", 3 * 60_000); set("idle-new", 10 * 60_000); set("idle-old", 16 * 60_000);
    set("work-4m", 4 * 60_000); set("work-16m", 16 * 60_000); set("think-20m", 20 * 60_000); set("work-31m", 31 * 60_000);
    const pv = Object.fromEntries((await s.priv()).map(a => [a.id, a.state]));
    assert.deepEqual(pv, { "done-new": "done", "idle-new": "idle", "work-4m": "working", "work-16m": "idle", "think-20m": "idle" },
      "expired rows are filtered by their time even though no cleanup ran");
    assert.equal(s.h.db.prepare("SELECT COUNT(*) n FROM agents").get().n, 8, "rows still in the table: the query did the filtering");
  } finally { s.close(); }
});

test("agents: most active first before the cut; live feed holds 200, the World 20 per member, active ones always in", async () => {
  const s = await setup();
  try {
    // 250 newer rows (50 idle, 200 done) seeded straight into the table (the hub rate-limits POSTs per address); the 4
    // active ones are the oldest, so recency alone would cut them
    const ins = s.h.db.prepare("INSERT INTO agents (owner, id, label, machine, repo, state, task, did, tokens, ts, d) VALUES (?,?,'','','',?,'','',0,?,'')");
    for (let i = 0; i < 50; i++) ins.run(s.uma.id, "idle-" + String(i).padStart(3, "0"), "idle", ago(30_000));
    for (let i = 0; i < 200; i++) ins.run(s.uma.id, "done-" + String(i).padStart(3, "0"), "done", ago(30_000));
    await s.report([{ id: "work-1", state: "working" }, { id: "think-1", state: "thinking" }, { id: "wait-1", state: "waiting" }, { id: "work-2", state: "working" }]);
    s.h.db.prepare("UPDATE agents SET ts=? WHERE id IN ('work-1','think-1','wait-1','work-2')").run(ago(90_000));
    s.h.db.prepare("UPDATE agents SET ts=? WHERE id='work-2'").run(ago(60_000));
    const pv = await s.priv();
    assert.equal(pv.length, 200, "live LIMIT 200");
    assert.deepEqual(pv.slice(0, 4).map(a => a.id), ["work-2", "work-1", "think-1", "wait-1"], "working (newest first), thinking, waiting");
    assert.ok(pv.slice(4, 54).every(a => a.state === "idle") && pv.slice(54).every(a => a.state === "done"), "then idle, then done");
    const pb = await s.pub(); assert.equal(pb.length, 200); assert.deepEqual(pb.slice(0, 4).map(a => a.state), ["working", "working", "thinking", "waiting"]);
    // the World keeps 20 per member and sorts first, whatever order the member's feed came in
    const shuffled = [...pb].reverse();
    const w = foldLive([{ handle: "uma", live: { districts: {}, agents: shuffled } }], new Date().toISOString());
    assert.equal(w.agents.length, 20); assert.deepEqual(w.agents.slice(0, 4).map(a => a.state), ["working", "working", "thinking", "waiting"]);
    assert.ok(w.agents.slice(4).every(a => a.state === "idle"));
  } finally { s.close(); }
});
