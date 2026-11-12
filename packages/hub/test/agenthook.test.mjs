// The agent hook (site/agent-hook.mjs) run as Claude Code runs it: event JSON on stdin, HOME pointing at a temp dir
// with ~/.caldera/agent.json, posting to a stub hub. Covers: PreToolUse + the 2-minute heartbeat (shortened here),
// an explicit done on Stop and SessionEnd, and the folder name as the repo when there is no git checkout.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../site/agent-hook.mjs", import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function harness() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "caldera-hook-"));
  const posts = [];
  const server = http.createServer((req, res) => { let b = ""; req.on("data", c => b += c); req.on("end", () => { posts.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(b || "{}") }); res.end("{}"); }); });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(home, ".caldera"));
  fs.writeFileSync(path.join(home, ".caldera", "agent.json"), JSON.stringify({ hub: `http://127.0.0.1:${server.address().port}`, key: "a".repeat(18), secret: "s3", machine: "box" }));
  const run = (ev, env = {}) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [HOOK], { env: { ...process.env, HOME: home, CALDERA_AGENT_BEAT_MS: "300", ...env }, stdio: ["pipe", "ignore", "ignore"] });
    c.on("exit", code => resolve(code)); c.on("error", reject); c.stdin.end(JSON.stringify(ev));
  });
  const state = () => { try { return JSON.parse(fs.readFileSync(path.join(home, ".caldera", "agent-state.json"), "utf8")); } catch { return {}; } };
  const close = () => { for (const s of Object.values(state())) if (s.beat) { try { process.kill(s.beat); } catch { /* gone */ } } server.close(); fs.rmSync(home, { recursive: true, force: true }); };
  return { home, posts, run, state, close };
}

test("agent hook: outside a git checkout the folder's name is the repo; never the home folder", async () => {
  const h = await harness();
  try {
    const work = path.join(h.home, "side-project"); fs.mkdirSync(work);
    assert.equal(await h.run({ hook_event_name: "UserPromptSubmit", session_id: "sess-a", cwd: work, prompt: "Fix the build for the side project" }), 0);
    assert.equal(h.posts.length, 1); const a = h.posts[0].body.agents[0];
    assert.equal(a.repo, "side-project"); assert.equal(a.state, "thinking"); assert.equal(h.posts[0].auth, "Bearer s3");
    await h.run({ hook_event_name: "UserPromptSubmit", session_id: "sess-h", cwd: h.home, prompt: "Something in my home folder" });
    assert.equal(h.posts[1].body.agents[0].repo, "", "home folder is not a repo");
  } finally { h.close(); }
});

test("agent hook: PreToolUse says working and a heartbeat repeats it while the tool runs; PostToolUse stops it", async () => {
  const h = await harness();
  try {
    const work = path.join(h.home, "builder"); fs.mkdirSync(work);
    await h.run({ hook_event_name: "PreToolUse", session_id: "sess-b", cwd: work, tool_name: "Bash", tool_input: { description: "Run the long test suite" } });
    assert.equal(h.posts.length, 1); assert.equal(h.posts[0].body.agents[0].state, "working"); assert.match(h.posts[0].body.agents[0].did, /^Bash Run the long test suite/);
    const st = h.state()["sess-b"]; assert.ok(st.inflight > 0, "tool call in flight"); assert.ok(st.beat > 0, "heartbeat started");
    await sleep(1100);
    const beats = h.posts.slice(1); assert.ok(beats.length >= 2, `heartbeat posted ${beats.length} times`);
    assert.ok(beats.every(p => p.body.agents[0].state === "working" && p.body.agents[0].id === "sess-b" && p.body.agents[0].repo === "builder"));
    // a second tool call reuses the same heartbeat process
    await h.run({ hook_event_name: "PreToolUse", session_id: "sess-b", cwd: work, tool_name: "Read", tool_input: {} });
    assert.equal(h.state()["sess-b"].beat, st.beat, "one heartbeat per session");
    await h.run({ hook_event_name: "PostToolUse", session_id: "sess-b", cwd: work, tool_name: "Bash", tool_input: {} });
    assert.equal(h.state()["sess-b"].inflight, 0);
    await sleep(700); const n = h.posts.length; await sleep(700);
    assert.equal(h.posts.length, n, "no heartbeat once the tool call is over");
    let gone = false; try { process.kill(st.beat, 0); } catch { gone = true; } assert.ok(gone, "heartbeat process exited");
  } finally { h.close(); }
});

test("agent hook: Stop and SessionEnd send an explicit done", async () => {
  const h = await harness();
  try {
    const work = path.join(h.home, "shop"); fs.mkdirSync(work);
    const transcript = path.join(h.home, "t.jsonl");
    fs.writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "All done, the tests pass." }] } }) + "\n");
    await h.run({ hook_event_name: "PreToolUse", session_id: "sess-c", cwd: work, tool_name: "Bash", tool_input: {} });
    await h.run({ hook_event_name: "Stop", session_id: "sess-c", cwd: work, transcript_path: transcript });
    assert.equal(h.posts.at(-1).body.agents[0].state, "done"); assert.equal(h.state()["sess-c"].inflight, 0, "Stop ends the heartbeat");
    await h.run({ hook_event_name: "SessionEnd", session_id: "sess-c", cwd: work });
    const last = h.posts.at(-1).body.agents[0]; assert.equal(last.state, "done"); assert.equal(last.repo, "shop");
    assert.equal(h.state()["sess-c"], undefined, "session forgotten locally");
  } finally { h.close(); }
});
