import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { after as __afterAll } from "node:test";
const __tmpDirs = [];
const __mkdtemp = (p) => { const d = fs.mkdtempSync(p); __tmpDirs.push(d); return d; };
__afterAll(() => { for (const d of __tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });   // temp hubs are removed after the file's tests, even when one fails

// setup prompts pin the agent hook by hash: the pin must match the file we serve
test("agent hook pin matches the served file", () => {
  const file = new URL("../../site/agent-hook.mjs", import.meta.url);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const pin = fs.readFileSync(new URL("../src/hookpin.ts", import.meta.url), "utf8").match(/AGENT_HOOK_SHA256 = "([0-9a-f]{64})"/)[1];
  assert.equal(pin, hash, "update AGENT_HOOK_SHA256 in src/hookpin.ts (and the plugin's copy) after changing agent-hook.mjs");
});

// new snippets pin /t/1.js by Subresource Integrity: the frozen file must hash to the pin (the Obsidian plugin ships the
// same value, so changing the tracker means a new /t/2.js, never an edit to /t/1.js)
test("the frozen tracker matches its integrity pin", async () => {
  const os = await import("node:os"), path = await import("node:path");
  const { createHub } = await import("../dist/server.js");
  const dir = __mkdtemp(path.join(os.tmpdir(), "caldera-pin-"));
  const hub = createHub({ dataDir: dir, publicUrl: "https://hub.test" });
  try {
    const base = "http://127.0.0.1:" + await hub.listen(0);
    const r = await fetch(base + "/t/1.js"); assert.equal(r.status, 200); assert.match(r.headers.get("cache-control"), /immutable/);
    const sri = "sha384-" + crypto.createHash("sha384").update(Buffer.from(await r.arrayBuffer())).digest("base64");
    assert.equal(sri, "sha384-UCnwKWu6Be2g87+ZI1+h367D6yOXEuXFQL2U2Z7PuSoH3oSCsu/cmZMbj4s70JlC");
    assert.equal(await (await fetch(base + "/t.js")).text(), await (await fetch(base + "/t/1.js")).text(), "older snippets get the same script");
  } finally { hub.server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
