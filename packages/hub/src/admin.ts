/**
 * Hub operator tool. Run on the server next to the hub (same data dir):
 *   CALDERA_DATA=<the hub's data dir> node dist/admin.js list
 *   ... hide <handle> "reason"     take a profile down (page 410, out of search/directory); owner cannot republish
 *   ... unhide <handle>            undo hide/block
 *   ... remove <handle> "reason"   erase the profile and everything tied to it, and keep the handle off-limits
 *   ... block <handle> "reason"    reserve a handle so nobody can claim it (impersonation, trademarks)
 *   ... merge <from> <into> "reason"  one person, two profiles: move <from>'s friends, credit, messages, posts, GitHub and
 *                                  email sign-in and website keys into <into>, erase <from>, and redirect /@from/ to /@into/
 *   ... merges | aliases           past merges / merged-away handles that redirect
 *   ... gh-remove | gh-restore <login>  take a non-member's caldera.social/gh/<login> preview down (removal request) or back
 *   ... stuck-claim [--send] [backup.sqlite ...]  unconfirmed sign-ups: counts, or email each a claim link once
 *   ... tie-stats [days]           Caldera x Orpheus tie: tie_show / tie_click per day and place
 *   ... farm-recount [days] [--apply] | farm-report [days]   the farm judge (Mike 11-24): re-judge commits, counts only
 *   ... orpheus-pull | orpheus-list   Orpheus handle link: pull the fleet feed now (needs CALDERA_ORPHEUS_TIE_KEY) / the linked members
 *   ... reconnect-stats            counts only: members whose GitHub sign-in died, and how many have an address to email
 *   ... agent-list | agent-hide|agent-unhide|agent-delete <post-id>   agent posts, reported first
 *   ... agent-token-list | agent-token-revoke <token-id>
 *   ... growth-run [--polls N] [--backfills N] | growth-run @handle [--backfill]   the World's growth views: one tick now
 *   ... growth-drops                    today's daily drop manifest
 *   ... battle-state | battle-run [--force] [YYYY-MM-DD] | battle-dry [YYYY-MM-DD] | battle-restrike [YYYY-MM-DD] [--save] | battle-optin @handle [--backdate] [--waive] | battle-optout @handle | battle-report [--dry] [--force] [@handle] | battle-summary [--dry]
 *   ... battle-mail-test <handle>      that member's battle mail for the newest night, written to files (html, text, png); never sent
 *   ... leaderboard [day|week|month|all]            the Leaderboard's rows (top 25)
 *   ... leaderboard-post [--dry] [--force] [YYYY-MM-DD]   yesterday's (or that Pacific day's) top 10 to the feed, once per day; --dry composes only; --force posts under 3 shippers
 *   ... land-run [--dry] [handle]   the World's Expansion view: fetch merged PRs and stars gained now, store tonight's land
 *   ... agent-token-add <owner-handle> <agent-name> <sha256-of-token>   register a token made elsewhere; the secret never comes here
 * Alerts, the GitHub circle job and other operator commands live in caldera.social's private tools.
 */
import fs from "node:fs";
import path from "node:path";
import { createHub } from "./server.js";

const argv = process.argv.slice(2), cmd = argv[0] || "";
// removal requests for caldera.social/gh/<login> previews of people who are not members (no hub needed)
if (cmd === "gh-remove" || cmd === "gh-restore") {
  const login = String(argv[1] || "").toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9-]{1,39}$/.test(login)) { console.log("usage: admin.js gh-remove|gh-restore <github-login>"); process.exit(1); }
  const dir = path.join(process.env.CALDERA_DATA || "./data", "gh-preview"), f = path.join(dir, "removed.txt");
  fs.mkdirSync(dir, { recursive: true });
  const set = new Set((fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "").split(/\r?\n/).map(x => x.trim().toLowerCase()).filter(Boolean));
  if (cmd === "gh-remove") { set.add(login); for (const ext of [".json", ".png"]) fs.rmSync(path.join(dir, login + ext), { force: true }); } else set.delete(login);
  fs.writeFileSync(f, [...set].sort().join("\n") + "\n");
  console.log(JSON.stringify({ ok: true, [cmd === "gh-remove" ? "removed" : "restored"]: login, total: set.size }));
  process.exit(0);
}
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const usage = () => { console.log("usage: admin.js list | merges | aliases | hide|unhide|remove|block <handle> [reason] | merge <from-handle> <into-handle> [reason]"); process.exit(1); };
const clean = (h: string) => h.toLowerCase().replace(/^@/, "");

// the battle-report command needs the mail transport (CALDERA_RESEND_KEY from the env file), the others never send
const hub = createHub({ dataDir: process.env.CALDERA_DATA || "./data", publicUrl: process.env.CALDERA_PUBLIC_URL || undefined, founder: process.env.CALDERA_FOUNDER || undefined, email: process.env.CALDERA_RESEND_KEY && process.argv.includes("battle-report") ? { resendKey: process.env.CALDERA_RESEND_KEY, schedule: false } : undefined });
const a = hub.admin as any;
try {
  if (cmd === "stuck-claim") {   // dry run by default; --send emails each person once; other args are sqlite backup files
    const paths = argv.slice(1).filter(x => !x.startsWith("--")), send = argv.includes("--send");
    out(await (hub as any).stuckClaim({ send, paths, skipFrom: "2026-10-28", skipTo: "2026-10-30" })); process.exit(0);
  }
  if (cmd === "reconnect-stats") { out(hub.reconnect.stats()); process.exit(0); }
  if (cmd === "farm-recount") { out(await a.farmRecount({ days: Number(argv.find(x => /^\d+$/.test(x))) || 42, apply: argv.includes("--apply") })); process.exit(0); }   // spec 11-24 1d: dry run unless --apply; counts only
  if (cmd === "farm-report") { out(a.farmReport(Number(argv[1]) || 42)); process.exit(0); }   // commits voided as farm per member and repo
  if (cmd === "orpheus-pull") { out(await a.orpheusPull()); process.exit(0); }   // the daily Orpheus fleet feed, now
  if (cmd === "orpheus-list") { out(a.orpheusList()); process.exit(0); }   // linked members, newest first
  if (cmd === "tie-stats") { out(a.tieStats(Number(argv[1]) || 30)); process.exit(0); }   // Caldera x Orpheus tie: {tie, tie_at} per LA day
  if (cmd === "growth-run") {   // the World's growth views: one tick now (poll GitHub, re-run the simulation); --polls N --backfills N; or one member: growth-run @handle [--backfill]
    const g = a.growth; if (!g) { out({ error: "growth is off (CALDERA_GROWTH=0)" }); process.exit(1); }
    const who = argv.find((x, i) => i > 0 && x.startsWith("@"))?.slice(1), num = (f: string) => { const i = argv.indexOf(f); return i > 0 ? Number(argv[i + 1]) : undefined; };
    if (who) { const gm = (g as any); const list = a.growthMembers?.() || []; const mm = list.find((x: any) => x.handle === who) || { id: null, login: null };
      if (!mm.login) { out({ error: "no GitHub login for @" + who }); process.exit(1); }
      out(await gm.poller.poll({ id: mm.id, login: mm.login }, { backfill: argv.includes("--backfill") })); gm.recompute(); process.exit(0); }
    await g.tick({ maxPolls: num("--polls"), maxBackfills: num("--backfills") }); const s = g.state("week"); out({ members: s.totals.members, week: s.totals }); process.exit(0);
  }
  if (cmd.startsWith("battle-")) {   // the World's battles (battle.ts): battle-state | battle-run [--force] [YYYY-MM-DD] | battle-dry [YYYY-MM-DD] | battle-optin @handle [--backdate] [--waive] | battle-optout @handle | battle-report [--dry] [--force] [@handle]
    const b = a.battle; if (!b) { out({ error: "battles are off (CALDERA_BATTLE=0 or CALDERA_GROWTH=0)" }); process.exit(1); }
    const who = argv.find((x, i) => i > 0 && x.startsWith("@"))?.slice(1), list = a.growthMembers?.() || [], mm = who ? list.find((x: any) => x.handle === who) : null;
    if (who && !mm) { out({ error: "no listed member @" + who }); process.exit(1); }
    if (cmd === "battle-state") { out(b.state()); process.exit(0); }
    // LOOP.md part a: the hub has no test/ops address (agents@) in its code, so the test mail is written to files, never sent
    if (cmd === "battle-mail-test") {
      const h = clean(argv[1] || ""), mt = list.find((x: any) => String(x.handle).toLowerCase() === h);
      if (!mt) { out({ error: "usage: battle-mail-test <handle> (a listed member)" }); process.exit(1); }
      const r = await b.mailTest(mt.id); if (r.error) { out(r); process.exit(1); }
      const dir = path.join(process.env.CALDERA_DATA || "./data", "battle-mail-test"); fs.mkdirSync(dir, { recursive: true });
      const base = path.join(dir, `${h}-${r.night}`), files: string[] = [base + ".html", base + ".txt"];
      fs.writeFileSync(base + ".html", r.html); fs.writeFileSync(base + ".txt", `Subject: ${r.subject}\nPreheader: ${r.preheader}\n\n${r.text}\n`);
      if (r.png) { fs.writeFileSync(base + ".png", r.png); files.push(base + ".png"); }
      out({ sent: false, why: "no agents@ test address in the hub; open the files", night: r.night, freq: r.freq, result: r.res, quiet: r.quiet, subject: r.subject, files }); process.exit(0);
    }
    if (cmd === "battle-dry") { const d = argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x)), n = d ? Math.floor(Date.parse(d + "T00:00:00Z") / 86_400_000) : Math.floor((Date.now() - 10 * 3600_000) / 86_400_000);   // nothing is saved: the stored night through today's strike math, and the night resolved again
      out({ restrike: b.restrikeNight(n), resolve: b.resolve(n, { dry: true }) }); process.exit(0); }
    if (cmd === "battle-run") { const d = argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x)), n = d ? Math.floor(Date.parse(d + "T00:00:00Z") / 86_400_000) : Math.floor((Date.now() - 10 * 3600_000) / 86_400_000);
      out(b.resolve(n, { force: argv.includes("--force") })); process.exit(0); }
    if (cmd === "battle-restrike") { const d = argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x)), n = d ? Math.floor(Date.parse(d + "T00:00:00Z") / 86_400_000) : Math.floor((Date.now() - 10 * 3600_000) / 86_400_000);   // the stored night's same shots through today's strike math; --save stores them (sends nothing)
      out(b.restrikeNight(n, { save: argv.includes("--save") })); process.exit(0); }
    if (cmd === "battle-optin" && mm) { b.optIn(mm.id, { since: argv.includes("--backdate") ? 0 : undefined, waive: argv.includes("--waive") ? true : undefined }); out(b.me(mm.id)); process.exit(0); }
    if (cmd === "battle-optout" && mm) { b.store.setWar(mm.id, false, Date.now()); out(b.me(mm.id)); process.exit(0); }
    if (cmd === "battle-summary") { out(b.postSummary({ dry: argv.includes("--dry") })); process.exit(0); }
    if (cmd === "battle-report") { out(await b.sendReports({ dry: argv.includes("--dry"), force: argv.includes("--force"), only: mm?.id })); process.exit(0); }
    usage();
  }
  if (cmd === "leaderboard" || cmd === "leaderboard-post") {   // the Leaderboard (leaderboard.ts): rows, or yesterday's top 10 to the feed (idempotent per day)
    const lb = a.leaderboard; if (!lb) { out({ error: "the leaderboard is off (CALDERA_GROWTH=0)" }); process.exit(1); }
    if (cmd === "leaderboard") { const w = ["day", "week", "month", "all"].includes(argv[1] || "") ? argv[1] : "day"; out(lb.rankMembers(w).slice(0, 25)); process.exit(0); }
    const d = argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x)), day = d ? Math.floor(Date.parse(d + "T00:00:00Z") / 86_400_000) : undefined;
    out(lb.dailyPost({ dry: argv.includes("--dry"), force: argv.includes("--force"), day })); process.exit(0);
  }
  if (cmd === "growth-drops") { const g = a.growth; out(g ? g.drops() : { error: "growth is off" }); process.exit(0); }
  if (cmd === "land-run") { out(await a.land({ dry: argv.includes("--dry"), only: argv.find((x, i) => i > 0 && !x.startsWith("--"))?.replace(/^@/, "") })); process.exit(0); }   // the World's Expansion view: fetch tonight's public-GitHub numbers now
  if (cmd.startsWith("agent-")) {
    const fn = a[cmd]; if (!fn) usage();
    out(fn(...(cmd === "agent-token-add" ? [clean(argv[1] || ""), argv[2] || "", argv[3] || ""] : argv.slice(1))));
    process.exit(0);
  }
  if (cmd === "merge") {
    const [, from, into, ...why] = argv;
    if (!from || !into) usage();
    out(a.merge(clean(from!), clean(into!), why.join(" ")));
  } else {
    const [, handle, ...why] = argv;
    if (!["list", "merges", "aliases", "hide", "unhide", "remove", "block"].includes(cmd) || (!["list", "merges", "aliases"].includes(cmd) && !handle)) usage();
    out(["list", "merges", "aliases"].includes(cmd) ? a[cmd]() : a[cmd](clean(handle!), why.join(" ")));
  }
} finally { hub.db.close(); }
