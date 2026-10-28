/**
 * Living portraits (ported from Human Architecture's live-gen.js, Mike 2026-10-28): a member's profile photo becomes a
 * 5-second seamless motion loop (Kling image-to-video via fal.ai, first frame = last frame = the photo), stored as
 * data/live/<handle>.mp4 plus an animated <handle>.webp for browsers that refuse to autoplay video. Pages swap the
 * photo for the loop client-side (LIVE_CLIENT). The profile folder is wiped on every publish, so the loops live in
 * their own folder, keyed by handle, with the source photo's hash in live_portraits so they're only remade when the
 * photo changes. Logos/identicons (very few colors) are skipped: this is for photos of people.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";

const MODEL = "fal-ai/kling-video/v2.1/pro/image-to-video";
const PROMPT = "A living portrait. The person stays in the same pose and framing, gently breathing, a slow natural blink, " +
  "a very slight turn of the head and back, subtle shifts of light and shadow across the face and clothing. " +
  "Calm, hypnotic, cinematic, photorealistic. Camera locked off, no zoom, no cuts, no new objects, no talking.";
const NEG = "blur, distort, morphing face, extra limbs, text, talking, camera movement, zoom";
const CONCURRENCY = 3, MAX_TRIES = 3, RETRY_MS = 24 * 3600_000;

type Row = { handle: string; src_hash: string; status: string; tries: number; updated: number; err: string | null };
export interface LiveEntry { a: string; v: string }

const run = (cmd: string, args: string[], o: { buf?: boolean; timeout?: number } = {}) => new Promise<Buffer>((ok, no) =>
  execFile(cmd, args, { encoding: "buffer", maxBuffer: 40e6, timeout: o.timeout || 120_000 }, (e, out) => e ? no(e) : ok(out as Buffer)));

export function liveGen(o: { db: DatabaseSync; dataDir: string; log?: (s: string) => void; isModerated: (handle: string) => boolean }) {
  const log = o.log || ((s: string) => console.log(s));
  const dir = path.join(o.dataDir, "live"); fs.mkdirSync(dir, { recursive: true });
  o.db.exec(`CREATE TABLE IF NOT EXISTS live_portraits (handle TEXT PRIMARY KEY, src_hash TEXT, status TEXT, tries INTEGER NOT NULL DEFAULT 0, updated INTEGER, err TEXT, avatar TEXT)`);
  const q = (sql: string) => o.db.prepare(sql);
  const queue: { handle: string; file: string; avatar: string; hash: string }[] = [], running = new Set<string>();
  let mapCache: { t: number; m: Record<string, LiveEntry> } | null = null;

  const files = (h: string) => ({ mp4: path.join(dir, h + ".mp4"), webp: path.join(dir, h + ".webp") });
  const hashOf = (f: string) => { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16); } catch { return null; } };

  function drop(handle: string) {
    const f = files(handle); for (const p of [f.mp4, f.webp]) fs.rmSync(p, { force: true });
    q("DELETE FROM live_portraits WHERE handle=?").run(handle); mapCache = null;
  }

  /** A photo (not a logo, identicon or flat graphic): enough distinct colors in a 32x32 thumbnail. */
  async function isPhoto(f: string) {
    try {
      const raw = await run("ffmpeg", ["-loglevel", "error", "-i", f, "-vf", "scale=32:32", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { timeout: 30_000 });
      const seen = new Set<number>(); for (let i = 0; i + 2 < raw.length; i += 3) seen.add(((raw[i]! >> 4) << 8) | ((raw[i + 1]! >> 4) << 4) | (raw[i + 2]! >> 4));
      return seen.size >= 40;
    } catch { return false; }
  }
  // fal gets the photo as a data URI (profile files are sandboxed/noindex and may be moderated, so no public fetch);
  // Kling needs >= 300px, so small photos are upscaled to 512 and big ones capped at 1024
  async function asDataUri(f: string) {
    const jpg = await run("ffmpeg", ["-loglevel", "error", "-i", f, "-vf", "scale='if(lt(iw,ih),max(512,min(1024,iw)),-2)':'if(lt(iw,ih),-2,max(512,min(1024,ih)))':flags=lanczos",
      "-frames:v", "1", "-q:v", "3", "-f", "mjpeg", "pipe:1"], { timeout: 30_000 });
    return "data:image/jpeg;base64," + jpg.toString("base64");
  }
  async function fal(url: string, body?: unknown) {
    const r = await fetch(url, { method: body ? "POST" : "GET", headers: { Authorization: "Key " + process.env.FAL_KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error("fal " + r.status + " " + (await r.text()).slice(0, 200));
    return r.json() as Promise<any>;
  }

  async function make(j: { handle: string; file: string; avatar: string; hash: string }) {
    const set = (status: string, err: string | null = null) => {
      q(`INSERT INTO live_portraits (handle, src_hash, status, tries, updated, err, avatar) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(handle) DO UPDATE SET src_hash=excluded.src_hash, status=excluded.status, tries=CASE WHEN excluded.status='failed' THEN live_portraits.tries+1 ELSE 0 END, updated=excluded.updated, err=excluded.err, avatar=excluded.avatar`)
        .run(j.handle, j.hash, status, status === "failed" ? 1 : 0, Date.now(), err, j.avatar); mapCache = null; };
    if (!(await isPhoto(j.file))) { set("skip", "not a photo"); return; }
    const img = await asDataUri(j.file), t0 = Date.now();
    const sub = await fal("https://queue.fal.run/" + MODEL, { prompt: PROMPT, negative_prompt: NEG, image_url: img, tail_image_url: img, duration: "5" });
    for (;;) {
      await new Promise(r => setTimeout(r, 10_000));
      const s = await fal(sub.status_url); if (s.status === "COMPLETED") break;
      if (Date.now() - t0 > 15 * 60_000) throw new Error("timeout");
    }
    const res = await fal(sub.response_url), vurl = res?.video?.url; if (!vurl) throw new Error("no video in response");
    const vr = await fetch(vurl); if (!vr.ok) throw new Error("download " + vr.status);
    const raw = path.join(dir, `.${j.handle}.raw.mp4`), tmp = path.join(dir, `.${j.handle}.tmp.mp4`), tw = path.join(dir, `.${j.handle}.tmp.webp`), f = files(j.handle);
    fs.writeFileSync(raw, Buffer.from(await vr.arrayBuffer()));
    try {
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-an", "-vf", "scale='if(gt(iw,ih),-2,480)':'if(gt(iw,ih),480,-2)'", "-c:v", "libx264", "-crf", "25", "-preset", "slow",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp]);
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-an", "-vf", "fps=12,scale=240:-2:flags=lanczos", "-c:v", "libwebp", "-lossless", "0", "-q:v", "55", "-compression_level", "6", "-loop", "0", tw]);
      // the member changed (or removed) their photo, or was moderated, while this ran: throw the loop away
      if (hashOf(j.file) !== j.hash || o.isModerated(j.handle)) { log(`[live] @${j.handle} photo changed mid-run, discarded`); return; }
      fs.renameSync(tmp, f.mp4); fs.renameSync(tw, f.webp);
    } finally { for (const p of [raw, tmp, tw]) fs.rmSync(p, { force: true }); }
    set("ready"); log(`[live] @${j.handle} ready in ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  function pump() {
    while (running.size < CONCURRENCY && queue.length) {
      const j = queue.shift()!; running.add(j.handle);
      make(j).catch(e => {
        log(`[live] @${j.handle} failed: ${e?.message}`);
        q(`INSERT INTO live_portraits (handle, src_hash, status, tries, updated, err, avatar) VALUES (?,?, 'failed', 1, ?, ?, ?)
          ON CONFLICT(handle) DO UPDATE SET src_hash=excluded.src_hash, status='failed', tries=live_portraits.tries+1, updated=excluded.updated, err=excluded.err`)
          .run(j.handle, j.hash, Date.now(), String(e?.message || e).slice(0, 300), j.avatar);
      }).finally(() => { running.delete(j.handle); pump(); });
    }
  }

  /** Bring one profile's loop in line with its current photo: make it when new/changed, drop it when gone. */
  function check(handle: string, avatarRel: string | null | undefined, photoFile: string | null) {
    if (o.isModerated(handle)) { drop(handle); return; }
    if (!avatarRel || !photoFile || !fs.existsSync(photoFile)) { if (q("SELECT 1 FROM live_portraits WHERE handle=?").get(handle)) drop(handle); return; }
    const hash = hashOf(photoFile); if (!hash) return;
    const row = q("SELECT * FROM live_portraits WHERE handle=?").get(handle) as Row | undefined;
    if (row && row.src_hash === hash) {
      if (row.status === "ready" || row.status === "skip") { if ((row as any).avatar !== avatarRel) { q("UPDATE live_portraits SET avatar=? WHERE handle=?").run(avatarRel, handle); mapCache = null; } return; }
      if (row.status === "failed" && (row.tries >= MAX_TRIES || Date.now() - row.updated < RETRY_MS)) return;
    }
    if (row && row.src_hash !== hash && row.status === "ready") { const f = files(handle); for (const p of [f.mp4, f.webp]) fs.rmSync(p, { force: true }); q("DELETE FROM live_portraits WHERE handle=?").run(handle); mapCache = null; }
    if (!process.env.FAL_KEY || running.has(handle) || queue.some(x => x.handle === handle)) return;
    queue.push({ handle, file: photoFile, avatar: avatarRel, hash }); pump();
  }

  /** handle -> { a: avatar path inside the profile, v: photo hash } for every ready loop (cached a minute). */
  function map(): Record<string, LiveEntry> {
    if (mapCache && Date.now() - mapCache.t < 60_000) return mapCache.m;
    const m: Record<string, LiveEntry> = {};
    for (const r of q("SELECT handle, src_hash, avatar FROM live_portraits WHERE status='ready'").all() as any[])
      if (r.avatar && !o.isModerated(r.handle) && fs.existsSync(files(r.handle).mp4)) m[r.handle] = { a: String(r.avatar).replace(/^\.?\//, ""), v: r.src_hash };
    mapCache = { t: Date.now(), m }; return m;
  }

  return { check, drop, map, files, status: () => ({ queued: queue.length, running: [...running] }) };
}

/** Client: swap every same-origin <img> of a member's photo for its loop (poster = the photo, so nothing flashes);
 *  WebP if the video won't play; the still if both fail; nothing at all under prefers-reduced-motion. */
export function liveClient(m: Record<string, LiveEntry>): string {
  if (!Object.keys(m).length) return "";
  const data = JSON.stringify(m).replace(/</g, "\\u003c");
  return `<script>(function(){if(window.__calLive)return;var L=window.__calLive=${data};
if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
function who(img){var s=img.getAttribute('src')||'';if(!s||/^data:/.test(s))return null;try{var u=new URL(s,location.href);if(u.host!==location.host)return null;var x=u.pathname.match(/^\\/@([a-z0-9-]+)\\/(.+)$/);if(!x)return null;var e=L[x[1]];return e&&decodeURIComponent(x[2])===e.a?x[1]:null}catch(_){return null}}
function swap(img){if(img.__cl)return;var h=who(img);if(!h)return;img.__cl=1;var v=L[h].v,cs=getComputedStyle(img),r=img.getBoundingClientRect();
var w=/px$/.test(cs.width)&&parseFloat(cs.width)?cs.width:r.width+'px',ht=/px$/.test(cs.height)&&parseFloat(cs.height)?cs.height:r.height+'px';
var vid=document.createElement('video');vid.muted=true;vid.defaultMuted=true;vid.loop=true;vid.autoplay=true;vid.playsInline=true;
vid.setAttribute('muted','');vid.setAttribute('playsinline','');vid.setAttribute('aria-hidden','true');vid.poster=img.currentSrc||img.src;vid.preload='auto';
vid.className=(img.className||'')+' cal-live';var K=['position','top','right','bottom','left','z-index','margin-top','margin-right','margin-bottom','margin-left','border-top','border-right','border-bottom','border-left','box-shadow','transform','float','align-self','justify-self','flex','outline','vertical-align','background-color'],st='';
for(var i=0;i<K.length;i++){var val=cs.getPropertyValue(K[i]);if(val)st+=K[i]+':'+val+';'}
vid.style.cssText=st+img.style.cssText+';box-sizing:'+cs.boxSizing+';width:'+w+';height:'+ht+';max-width:100%;object-fit:'+(cs.objectFit==='fill'?'cover':cs.objectFit)+';object-position:'+cs.objectPosition+';border-radius:'+cs.borderRadius+';display:'+(cs.display==='inline'?'inline-block':cs.display);
vid.src='/live/'+h+'.mp4?v='+v;var fell=false;
function fb(){if(fell||!vid.parentNode)return;fell=true;var a=document.createElement('img');a.className=vid.className;a.alt=img.alt||'';a.style.cssText=vid.style.cssText;
a.onerror=function(){if(a.parentNode)a.parentNode.replaceChild(img,a)};a.src='/live/'+h+'.webp?v='+v;vid.parentNode.replaceChild(a,vid)}
vid.addEventListener('error',fb);if(img.parentNode)img.parentNode.replaceChild(vid,img);var p=vid.play();if(p&&p.catch)p.catch(fb);
setTimeout(function(){if(vid.parentNode&&(vid.paused||vid.currentTime===0))fb()},4000)}
function go(img){if(img.complete&&img.naturalWidth)swap(img);else img.addEventListener('load',function(){swap(img)},{once:true})}
function scan(){var a=document.querySelectorAll('img');for(var i=0;i<a.length;i++)go(a[i])}var pend=false;
function q(){if(pend)return;pend=true;requestAnimationFrame(function(){pend=false;scan()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
new MutationObserver(q).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']})})();</script>`;
}
