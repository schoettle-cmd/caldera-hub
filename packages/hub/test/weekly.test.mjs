// The weekly battle summary (WEEKLY.md 6.5): weekRange, weekSummary, the subjects, the preheader, the city week line, the lead
// and first-mail lines, the footer, the podium, the week picture and its alt text, the repaired daily picture, the send rule
// with a fixed clock (Sunday Pacific, quiet daily members, weekly members), the tracking freq, and the week picture routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Resvg } from "@resvg/resvg-js";

const load = async f => { const o = await build({ entryPoints: [new URL("../src/" + f, import.meta.url).pathname], bundle: true, platform: "node", format: "esm", packages: "external", write: false }); return import("data:text/javascript;base64," + Buffer.from(o.outputFiles[0].text).toString("base64")); };
const B = await load("battle.ts"), K = await load("battlecard.ts"), BH = await load("battlehub.ts"), PT = await load("points.ts");
const FONTS = K.cardFonts(new URL("../fonts/", import.meta.url).pathname);
const DAY = 86_400_000, H = 3600_000, M = 60_000;
const SW = Math.floor(Date.parse("2026-11-25T00:00:00Z") / DAY), SUN = SW + 5;   // night key 2026-11-30 = the battle of Sunday Nov 29, 20:00 PST
const key = n => new Date(n * DAY).toISOString().slice(0, 10);

const X = (u, held = 0) => ({ u, fi: 0, fu: 0, sp: 0, m: 1, cep: 1, r: 1, kpa: 1, c: 0, fl: 1, v: 1, sh: 0, cd: 1, st: 1, pc: 1, raw: 1, held });
const shot = (a, d, u, o = {}) => ({ k: 0, a, d, w: "rocket", ammo: 2e5, roll: 0, f: o.f ?? (u > 0 ? 0.01 : 0), lot: 0, t: 0, aim: 0, blocked: 0, x: X(u, o.held || 0) });

// ---------------------------------------------------------------- 1, 2: the week's numbers
test("weekRange: one month, two months, two years", () => {
  assert.equal(B.weekRange("2026-11-30"), "Nov 24-30");
  assert.equal(B.weekRange("2026-12-04"), "Nov 28-Dec 4");
  assert.equal(B.weekRange("2027-01-02"), "Dec 27-Jan 2");
});
test("weekSummary: totals over 7 nights, empty nights are no battle, order by dollars, the raiders rule, fell counts nights, null when empty", () => {
  const nights = [{ night: 1, shots: [shot("a", "b", 900), shot("c", "b", 100), shot("~raiders", "a", 5000)] }, { night: 2, shots: [] },
    { night: 3, shots: [shot("b", "a", 300), shot("a", "b", 700), shot("a", "c", 0)] }, { night: 4, shots: [shot("c", "a", 50)] }];
  const s = B.weekSummary(nights);
  assert.equal(s.battles, 3, "a night with no shots is not a battle"); assert.equal(s.hits, 6); assert.equal(s.usd, 7050);
  assert.deepEqual(s.tops.map(t => [t.id, t.usd, t.hits, t.nights]), [["a", 1600, 2, 2], ["b", 300, 1, 1], ["c", 150, 2, 2]], "raiders left out; nights the city fired");
  assert.deepEqual(s.hard.map(t => [t.id, t.usd, t.nights, t.fell]), [["a", 5350, 3, 2], ["b", 1700, 2, 1]], "c took $0: not listed; fell = nights it was that night's fallen city");
  assert.equal(B.weekSummary([{ night: 1, shots: [shot("~raiders", "a", 10)] }]).tops[0].id, "~raiders", "only raiders fired");
  assert.deepEqual(B.weekSummary([{ night: 1, shots: [shot("a", "b", 5), shot("c", "d", 5)] }]).tops.map(t => t.id), ["a", "c"], "a tie goes by id");
  assert.equal(B.weekSummary(Array.from({ length: 7 }, (_, i) => ({ night: i, shots: [] }))), null);
});

// ---------------------------------------------------------------- 3 to 8: the mail
const W = { built: [], hit: [], attackers: [], rebuilds: [], rivalry: null, season: { n: 1, week: 3 } };
const R = { night: "2026-11-30", h: "sam" };
const O = { name: "Sam Lee", hub: "https://caldera.social/", unsub: "https://caldera.social/u/battle?t=x", postal: "mjonesone, LLC, 450 S Melrose Dr, Vista, CA 92081", card: "https://caldera.social/v1/world/battle/card/week/2026-11-30/sam.png", weekly: true };
const WORLD = { range: "Nov 24-30", battles: 7, hits: 412, usd: 2.1e9, tops: [{ h: "@novak", usd: 3.1e8 }, { h: "@tessera", usd: 2.4e8 }, { h: "@quill", usd: 1.9e8 }],
  hard: [{ h: "@harbor", usd: 2.9e8, fell: 3 }, { h: "@lumen", usd: 2.1e8, fell: 1 }, { h: "@okafor", usd: 1.4e8, fell: 0 }], leaders: [{ h: "@novak", usd: 1.8e9 }, { h: "@tessera", usd: 4e8 }, { h: "@quill", usd: 3.47e8 }] };
const FOUGHT = { n: 7, w: 2, fought: 4, lots: 9, dealt: 3.1e7, took: 9e6, move: 3 }, QUIET = { n: 7, w: 0, fought: 0, lots: 3, dealt: 0, took: 0, move: null };
const mail = (week, o = {}) => B.battleEmail(R, W, { ...O, week, world: WORLD, rank: 12, ...o });

test("subjects: quiet week, won 2 of 4, won 0 of 2, 1 night, the member wins, raiders win; all ASCII", () => {
  const s = (k, top = "@novak", mine = false) => B.loopSubject({ res: "QUIET", winner: null, mine: false, weekly: { ...k, top, mine } });
  const all = [
    [s({ n: 7, w: 0, fought: 0 }), "Last week: @novak won, your city was not hit"],
    [s({ n: 7, w: 2, fought: 4 }), "Last week: @novak won, your city won 2 of 4 nights"],
    [s({ n: 7, w: 0, fought: 2 }), "Last week: @novak won, your city fought 2 nights"],
    [s({ n: 7, w: 1, fought: 1 }), "Last week: @novak won, your city won 1 of 1 night"],
    [s({ n: 7, w: 0, fought: 1 }), "Last week: @novak won, your city fought 1 night"],
    [s({ n: 7, w: 3, fought: 5 }, "@sam", true), "Last week: your city won the week"],
    [s({ n: 1, w: 0, fought: 0 }, "raiders from the sea"), "Last week: raiders from the sea won, your city was not hit"],
    [s({ n: 1, w: 0, fought: 0 }, null), "Last week: 1 battle, your city was not hit"],
    [s({ n: 5, w: 3, fought: 4 }, null), "Last week: 5 battles, your city won 3"]];
  for (const [a, b] of all) { assert.equal(a, b); assert.ok(/^[\x20-\x7e]+$/.test(a)); }
  assert.equal(mail(FOUGHT).subject, "Last week: @novak won, your city won 2 of 4 nights");
  assert.equal(mail(FOUGHT, { mine: true }).subject, "Last week: your city won the week");
});
test("preheader for the two cases, and with no rank", () => {
  assert.equal(mail(FOUGHT).preheader, "Dealt $31M, took $9M in 4 nights. Season rank 12. Next battle Monday at 20:00 PT.");
  assert.equal(mail(FOUGHT, { rank: null }).preheader, "Dealt $31M, took $9M in 4 nights. Next battle Monday at 20:00 PT.");
  assert.equal(mail(QUIET).preheader, "No missiles came your way in 7 battles. Next battle Monday at 20:00 PT. Set your defenses by 19:45 PT.");
  assert.equal(mail({ ...QUIET, n: 1 }).preheader, "No missiles came your way in 1 battle. Next battle Monday at 20:00 PT. Set your defenses by 19:45 PT.");
});
test("city week line: quiet with and without lots, fought with w >= 1 and w = 0; the quiet mail has no $0, no '0 of', no 'down'", () => {
  const q = mail(QUIET).text;
  assert.ok(q.includes("A calm week for your city: no missiles came your way in 7 battles, and it fired none. You built 3 lots.\nMonday's battle is at 20:00 PT. Set your defenses, and the code you push before 19:45 PT becomes your missiles.\nSeason rank 12.\n"), q);
  const q0 = mail({ ...QUIET, lots: 0, move: -4 }).text;
  assert.ok(q0.includes("and it fired none.\n") && !q0.includes("0 lots") && !q0.includes("You built"));
  for (const t of [q, q0]) { const city = t.slice(t.indexOf("YOUR CITY"), t.indexOf("THE WORLD")); assert.ok(!city.includes("$0") && !city.includes("0 of") && !city.includes("down"), city); }
  const f = mail(FOUGHT).text;
  assert.ok(f.includes("Your city fought in 4 of 7 battles and won 2. It dealt $31M of damage and took $9M (all rebuilt on its own). 9 lots built.\nThe next battle is Monday at 20:00 PT. Defenses lock at 19:45 PT.\nSeason rank 12, up 3 in the week.\n"), f);
  assert.ok(mail({ ...FOUGHT, w: 0, lots: 0 }).text.includes("Your city fought in 4 of 7 battles. It dealt $31M of damage and took $9M (all rebuilt on its own).\n"));
  assert.ok(mail({ ...FOUGHT, move: -2 }).text.includes("Season rank 12, down 2 in the week."));
  assert.ok(mail({ ...FOUGHT, move: 0 }).text.includes("Season rank 12, no change in the week."));
  assert.ok(mail({ ...FOUGHT, move: null }).text.includes("Season rank 12.\n"), "no rank 7 nights before");
  assert.ok(!mail(FOUGHT, { rank: null }).text.includes("Season rank"), "no rank: no line");
  assert.ok(!/Armed by|Salvo|Shield \d|TODAY IN THE WORLD|This week:/.test(f), "none of the daily report lines");
});
test("lead line only with why quiet; the two first-mail lines only with o.first; the order of the text version", () => {
  const lead = "Sunday night was quiet for your city, so here is the whole week in one mail.";
  assert.ok(mail(QUIET, { why: "quiet" }).text.includes("Hey Sam,\n\n" + lead + "\n\nYOUR CITY, NOV 24-30\n"));
  assert.ok(!mail(QUIET, { why: "chose" }).text.includes(lead) && !mail(QUIET).html.includes(lead));
  const d = "You get a mail after each battle your city fights, and this summary after a quiet Sunday.", w = "You get this each Sunday after the battle.";
  assert.ok(mail(QUIET, { why: "quiet", first: true }).text.startsWith(d + " Weekly or off: https://caldera.social/world?view=battle#reports\n\nHey Sam,"));
  assert.ok(mail(QUIET, { why: "chose", first: true }).text.startsWith(w + " Daily or off: https://caldera.social/world?view=battle#reports\n\nHey Sam,"));
  assert.ok(mail(QUIET, { why: "chose", first: true }).html.includes(`${w} <a href="https://caldera.social/world?view=battle#reports" style="color:#6E4FE0">Daily or off</a>.`));
  for (const why of ["quiet", "chose"]) { const m = mail(FOUGHT, { why }); assert.ok(!m.text.includes(d) && !m.text.includes(w) && !m.html.includes(d) && !m.html.includes(w)); }
  const t = mail(FOUGHT, { why: "quiet" }).text, at = s => { const i = t.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("Hey Sam,") < at(lead) && at(lead) < at("YOUR CITY, NOV 24-30") && at("Season rank 12") < at("Set tonight's defenses: https://caldera.social/world?view=battle#tonight")
    && at("Set tonight's defenses: ") < at("Watch the replay: https://caldera.social/world?view=battle&replay=1") && at("Watch the replay: ") < at("THE WORLD, NOV 24-30"));
  assert.ok(t.includes("THE WORLD, NOV 24-30\n7 battles, 412 missiles hit, $2.1B of damage.\nMost damage dealt: @novak ($310M), @tessera ($240M), @quill ($190M)\nHit the hardest: @harbor ($290M, fell on 3 nights), @lumen ($210M, fell on 1 night), @okafor ($140M)\nSeason 1 top 3: @novak $1.8B, @tessera $400M, @quill $347M\n"), t);
  assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(t), "text is ASCII");
});
test("the HTML: picture linked to the replay, Set tonight's defenses solid first, headings; footer equal to the daily mail's", () => {
  const h = mail(FOUGHT, { alt: "Caldera week in battle, Nov 24-30. Words." }).html, at = s => { const i = h.indexOf(s); assert.ok(i >= 0, "html has: " + s); return i; };
  assert.ok(at('<a href="https://caldera.social/world?view=battle&amp;replay=1" style="display:block') < at('<img src="https://caldera.social/v1/world/battle/card/week/2026-11-30/sam.png" width="560" height="294" alt="Caldera week in battle, Nov 24-30. Words."'));
  assert.ok(at("background:#6D4AE8;color:#ffffff;font:600 15px/1.2 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;text-decoration:none\">Set tonight's defenses</a>") < at(">Watch the replay</a>"));
  assert.ok(at("Week in battle, Nov 24-30") < at("Hey Sam,") && at("YOUR CITY, NOV 24-30") < at("THE WORLD, NOV 24-30"));
  assert.ok(mail(FOUGHT, { card: null }).html.includes("Set tonight's defenses") && !mail(FOUGHT, { card: null }).html.includes("<img"), "no picture: no empty box");
  assert.ok(mail(FOUGHT).html.includes('alt="Caldera week in battle, Nov 24-30."'), "the default alt");
  // the footer: the same strings and links as the daily mail
  const daily = B.battleEmail({ night: "2026-11-30", h: "sam", peace: true, built: 0, raids: [] }, W, { ...O, weekly: false, res: "QUIET" });
  const foot = s => s.html.slice(s.html.lastIndexOf("<p style=\"margin:26px 0 0"), s.html.indexOf("</td></tr></table></td></tr></table></body>"));
  assert.equal(foot(mail(FOUGHT)), foot(daily)); assert.ok(foot(daily).includes(">Daily, weekly or off</a>") && foot(daily).includes(">Unsubscribe</a>"));
  const tail = s => s.text.slice(s.text.indexOf("\nSeason 1, week 3. Leaderboard"));
  assert.equal(tail(mail(FOUGHT)), tail(daily));
  assert.ok(!/<style|class=/.test(h), "inline styles only");
});
test("the podium takes the place of the Season top 3 line; the promoted card only when given", () => {
  const p = mail(FOUGHT, { podium: WORLD.leaders });
  assert.ok(!p.text.includes("Season 1 top 3") && p.text.includes("SEASON 1 FINAL\n1 @novak $1.8B\n2 @tessera $400M\n3 @quill $347M\nThe three winners keep a Season 1 badge. Season 2 starts Monday at 20:00 PT. Full ranking: https://caldera.social/leaderboard"));
  assert.ok(p.html.includes("Season 2 starts Monday at 20:00 PT.") && p.html.includes(">Full ranking</a>"));
  assert.ok(!mail(FOUGHT).html.includes("BUILT BY THE FLEET"));
  const pr = mail(FOUGHT, { promo: { title: "tidepool", line: "One file.", handle: "okafor", url: "https://caldera.social/p/x", report: "https://caldera.social/points/report?ad=x" } });
  assert.ok(pr.html.includes("BUILT BY THE FLEET") && pr.text.includes("BUILT BY THE FLEET\ntidepool: https://caldera.social/p/x"));
  assert.ok(mail({ ...FOUGHT }, { world: { ...WORLD, leaders: [{ h: "@novak", usd: 5e6 }] } }).text.includes("Season 1 top 1: @novak $5M"), "fewer than 3 on the board");
});

// ---------------------------------------------------------------- 9, 10: the week picture
const wk = (k = 3, long = false) => ({ night: "2026-11-30", range: "Nov 24-30", season: 1, week: 3, battles: 7, hits: 412, usd: 2.1e9,
  tops: [["@" + (long ? "a".repeat(39) : "novak"), 310e6, 41, 6], ["@tessera", 240e6, 36, 7], ["@quill", 190e6, 30, 5]].slice(0, k).map(([h, usd, hits, nights]) => ({ h, usd, hits, nights })),
  hard: [["@harbor", 290e6, 44, 6, 3], ["@lumen", 210e6, 31, 5, 1], ["@okafor", 140e6, 22, 4, 0]].slice(0, k).map(([h, usd, hits, nights, fell]) => ({ h, usd, hits, nights, fell })) });
const MEF = { h: "@sam", won: 2, fought: 4, dealt: 31e6, took: 9e6, lots: 9, rank: 12, move: 3 }, MEQ = { h: "@sam", won: 0, fought: 0, dealt: 0, took: 0, lots: 3, rank: 12, move: null };
test("weeklyCardSvg: valid for 0 to 3 rows, the three bands, a 39-character handle and 7-character money; quiet band has no DEALT and no move; no arrows, no remote href", () => {
  for (const k of [0, 1, 2, 3]) for (const me of [MEF, { ...MEF, won: 0 }, MEQ, null]) {
    const svg = K.weeklyCardSvg(wk(k), me); assert.doesNotThrow(() => new Resvg(svg), `rows ${k}`);
    assert.equal((svg.match(/ in \d+ nights?<\/text>/g) || []).length, 2 * k, "only the rows that exist");
    assert.ok(!/[←-⇿▲▼]/.test(svg), "no arrow characters"); assert.ok(!/href="(?!data:)/.test(svg), "no remote href");
  }
  const long = K.weeklyCardSvg(wk(3, true), { ...MEF, h: "@" + "b".repeat(39), dealt: 287.5e6, took: 123.4e6 });
  assert.doesNotThrow(() => new Resvg(long)); assert.ok(long.includes(">" + "A".repeat(16) + "..<") && long.includes('font-size="78"'), "headline cut at 16, 78 px");
  assert.ok(long.includes(">" + "B".repeat(12) + "<") && long.includes('font-size="32" letter-spacing=".8"'), "band handle cut at 12, 32 px");
  assert.ok(long.includes('font-size="40" fill="#FFC83D">$287.5M<') && long.includes('font-size="40" fill="#58B4FF">$123.4M<'), "7-character money at 40 px");
  const f = K.weeklyCardSvg(wk(), MEF); for (const s of ["WON THE WEEK", "WEEK IN BATTLE", "NOV 24-30", "TOP ATTACKERS OF THE WEEK", "HIT HARDEST", "NIGHTS WON", ">OF 4<", "DEALT", "TOOK", "LOTS BUILT", "SEASON RANK", ">#12<", ">UP 3<", ">FELL 3X</tspan>", ">FELL 1X</tspan>", 'font-size="100"']) assert.ok(f.includes(s), s);
  assert.ok(!f.includes("FELL 0X"));
  const z = K.weeklyCardSvg(wk(), { ...MEF, won: 0 }); assert.ok(z.includes("NIGHTS FOUGHT") && z.includes(">OF 7<") && z.includes("#3DF2FF"));
  const q = K.weeklyCardSvg(wk(), MEQ); for (const s of ["INTACT", "NOT HIT IN 7 BATTLES", "NEXT: MON 20:00 PT", ">#12<"]) assert.ok(q.includes(s), s);
  assert.ok(!q.includes("DEALT") && !q.includes(">UP ") && !q.includes(">DOWN ") && !q.includes("SAME") && !q.includes("M0 12 L8 0"), "no dollars and no move on a quiet week");
  assert.ok(K.weeklyCardSvg(wk(), { ...MEQ, move: -5 }).indexOf(">DOWN") < 0, "a quiet city never shows down");
  assert.ok(!K.weeklyCardSvg(wk(), { ...MEF, rank: null }).includes("SEASON RANK"));
  const g = K.weeklyCardSvg(wk(), null); for (const s of ["NEXT BATTLE", "TONIGHT 20:00 PT", "ADD YOUR CITY"]) assert.ok(g.includes(s), s);
  assert.ok(!K.weeklyCardSvg({ ...wk(), tops: [{ h: "@x&<y>", usd: 1, hits: 1, nights: 1 }] }, null).includes("x&<y>"), "text is escaped");
  const png = new Resvg(f, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: "Barlow Condensed" } }).render();
  assert.equal(png.width, 1200); assert.equal(png.height, 630);
});
test("weeklyCardAlt: the four endings; singular words", () => {
  const head = "Caldera week in battle, Nov 24-30. @novak won the week. Top attackers: @novak $310M, @tessera $240M, @quill $190M. Hit hardest: @harbor $290M (fell on 3 nights), @lumen $210M (fell on 1 night), @okafor $140M. 7 battles, 412 missiles hit, $2.1B of damage.";
  assert.equal(K.weeklyCardAlt(wk(), null), head + " Next battle tonight at 20:00 PT.");
  assert.equal(K.weeklyCardAlt(wk(), MEF), head + " Your city @sam won 2 of 4 nights fought: dealt $31M, took $9M, 9 lots built. Season rank 12, up 3.");
  assert.equal(K.weeklyCardAlt(wk(), { ...MEF, won: 0, fought: 1, lots: 1, move: 0 }), head + " Your city @sam fought 1 night of 7: dealt $31M, took $9M, 1 lot built. Season rank 12, no change.");
  assert.equal(K.weeklyCardAlt(wk(), MEQ), head + " Your city @sam was not hit in 7 battles. Next battle Monday at 20:00 PT. Season rank 12.");
  assert.ok(K.weeklyCardAlt({ ...wk(1), battles: 1, hits: 1 }, null).includes(" 1 battle, 1 missile hit,"));
  assert.equal(K.weeklyCardAlt({ ...wk(0), battles: 1, hits: 0, usd: 0 }, null), "Caldera week in battle, Nov 24-30. 1 battle, 0 missiles hit, $0 of damage. Next battle tonight at 20:00 PT.");
});
test("the daily picture's repair (WEEKLY.md 6.2): headline cut at 16 at 78 px, DEALT of 7 characters at 40 px", () => {
  const night = { night: "2026-11-24", season: 1, week: 3, cities: 96, hits: 56, usd: 287e6, tops: [{ h: "@" + "a".repeat(15), usd: 53e6, fired: 6, landed: 5 }], hard: [] };
  const s = K.battleCardSvg(night, { h: "@sam", res: "WON", dealt: 287.5e6, took: 4e6, held: 9e6, rank: 12, move: 3 });
  assert.ok(s.includes(">" + "A".repeat(15) + "<") && s.includes('font-size="78"'), "15 characters fit at 78 px");
  assert.ok(s.includes('font-size="40" fill="#F4F6FA">$287.5M<') && s.includes('font-size="46" fill="#F4F6FA">$4M<'), s.match(/font-size="4\d" fill="#[0-9A-F]+">\$[^<]+/g));
  assert.ok(K.battleCardSvg({ ...night, tops: [{ h: "@" + "c".repeat(17), usd: 1, fired: 1, landed: 1 }] }, null).includes(">" + "C".repeat(16) + "..<"));
});

// ---------------------------------------------------------------- 11, 12: the send rule and the routes, fixed clock
test("sundayNight: the night of a Sunday battle, Pacific, in winter and in summer time", () => {
  const n = s => Math.floor(Date.parse(s + "T00:00:00Z") / DAY);
  assert.equal(B.sundayNight(SUN), true, "the battle of Sun Nov 29 has the key Nov 30");
  assert.equal(B.sundayNight(SUN - 1), false); assert.equal(B.sundayNight(SUN + 1), false);
  assert.equal(B.sundayNight(n("2027-07-12")), true, "Sun Jul 11 2027, summer time");
  assert.equal(B.sundayNight(n("2027-03-15")), true, "Sun Mar 14 2027, the first Sunday of summer time");
  assert.equal(B.sundayNight(n("2027-07-11")), false);
});

const png = svg => Promise.resolve(Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: "Barlow Condensed" } }).render().asPng()));
/** a battle hub on an in-memory database with a fake clock, 3 members with work every hour, mail on, a fake address */
function rig() {
  const db = new DatabaseSync(":memory:"), q = sql => db.prepare(sql), clock = { t: 0 }, sent = [];
  const ids = ["a", "b", "c"], E = [];
  for (const p of ids) for (let t = Date.parse("2026-11-18T00:00:00Z"); t < Date.parse("2026-12-03T00:00:00Z"); t += H) E.push({ id: `c:${p}${t}`, p, k: "commit", repo: p + "/app", ts: t, seen: t, n: 1, v: "" });
  const members = ids.map((id, i) => ({ id, handle: id + "x", name: id.toUpperCase() + " Lee", created: Date.parse("2026-09-01T00:00:00Z"), login: id, city: { districts: [{ repos: [{ name: id + "/app", commits: 400 - i * 50, week: 3 }, { name: id + "/web", commits: 120, week: 1 }] }] } }));
  const stats = Array.from({ length: 130 }, (_, k) => ({ d: SW - 100 + k, pts: 5, c: 5, pr: 0, rel: 0, st: 0, z: 0, top: 1, up: 0, ring: 0, ai: 0, nc: 0 }));
  const sim = p => ({ side: 4, lots: "4444", bank: 0, streak: p === "a" ? 20 : 3, tier: 0, idle: null, stats, snaps: new Map() });
  const P = PT.pointsStore(q, { now: () => clock.t, seasonOf: () => ({ n: 1, from: SW - 20 }) });
  const hub = BH.battleHub({ q, hub: "https://hub.test", postal: "x", now: () => clock.t, cardPng: png,
    growth: { sim: () => ({ sims: new Map(ids.map(p => [p, sim(p)])), events: E.filter(e => e.ts <= clock.t), ai: new Map() }), onTick: () => {} },
    members: () => members, memberOf: req => req.who || null, sameOrigin: () => true, readBody: async req => req.body || {},
    json: (r, s, b) => { r.status = s; r.body = b; }, page: (t, h) => h, emailOf: id => id + "@agents.test", send: async m => { sent.push(m); return true; }, emailOn: () => true, points: () => P });
  hub.store.setMeta("launch", String(SW - 20));
  /** resolve nights from..to at their battle time; quiet: members with no shot in or out on given nights */
  const run = (from, to, quiet = {}) => { for (let n = from; n <= to; n++) { clock.t = B.battleAt(n) + M; hub.resolve(n);
    const qs = quiet[n] || []; if (qs.length) { const meta = hub.store.night(n), sh = hub.store.shots(n).filter(s => !qs.includes(s.a) && !qs.includes(s.d)).map((s, k) => ({ ...s, k })); hub.store.saveNight(n, meta, sh, clock.t); } } };
  const get = async path => { const r = { status: 0, headers: {}, body: null }; const res = { writeHead(s, h) { r.status = s; r.headers = h || {}; }, end(b) { r.body = b; } };
    await hub.route({ method: "GET", headers: {} }, res, path, new URL("https://hub.test" + path)); return r; };
  return { hub, db, clock, sent, run, get };
}
const quietLog = async fn => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

test("send rule: Sunday gives the weekly mail to weekly members and quiet daily members, the daily mail to fought daily members; tracked by freq; once a night", async () => {
  const { hub, db, clock, sent, run } = rig();
  await quietLog(async () => {
    run(SW - 1, SUN, { [SUN]: ["c"] });   // c fights the week, but Sunday's night is quiet for c
    assert.ok(hub.store.shots(SUN).length > 0 && !hub.store.shots(SUN).some(s => s.a === "c" || s.d === "c"));
    hub.store.setReport("b", "weekly");
    clock.t = B.battleAt(SUN) + 30 * M;   // Sunday 20:30 PST
    const r = await hub.sendReports();
    const by = h => sent.find(m => m.to === h + "@agents.test");
    assert.equal(sent.length, 3, JSON.stringify(r.out));
    assert.equal(by("a").kind, "daily", "daily + fought + Sunday: the daily mail"); assert.ok(/^Last night: /.test(by("a").subject));
    assert.equal(by("b").kind, "weekly", "weekly + Sunday: the weekly mail"); assert.ok(/^Last week: /.test(by("b").subject));
    assert.ok(by("b").text.startsWith("You get this each Sunday after the battle. Daily or off:") && !by("b").text.includes("Sunday night was quiet"));
    assert.equal(by("c").kind, "weekly", "daily + quiet + Sunday: the weekly mail");
    assert.ok(by("c").text.includes("Sunday night was quiet for your city, so here is the whole week in one mail.") && by("c").text.startsWith("You get a mail after each battle your city fights, and this summary after a quiet Sunday."));
    assert.ok(by("c").html.includes("https://hub.test/v1/world/battle/card/week/2026-11-30/cx.png") || by("c").html.includes(encodeURIComponent("https://hub.test/v1/world/battle/card/week/2026-11-30/cx.png")) || by("c").html.includes("/v1/world/battle/card/week/2026-11-30/cx.png"), "the week picture");
    for (const m of sent) assert.ok(m.headers["List-Unsubscribe"] && m.html.includes("/email/bo.gif?t="), "same unsubscribe header, the open pixel");
    assert.deepEqual(db.prepare("SELECT profile, freq FROM battle_mail ORDER BY profile").all().map(x => [x.profile, x.freq]), [["a", "daily"], ["b", "weekly"], ["c", "weekly-quiet"]]);
    const rep = hub.track.report(14)[0]; assert.equal(rep.weekly, 1); assert.equal(rep.weeklyQuiet, 1); assert.deepEqual(Object.keys(rep.byFreq).sort(), ["daily", "weekly", "weekly-quiet"]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM battle_cards WHERE night=? AND who LIKE 'week:%'").get(SUN).n, 2, "the week pictures exist before the mails");
    // a second run on the same night sends nothing
    await hub.sendReports(); assert.equal(sent.length, 3);
    // Monday: weekly members get nothing; a quiet daily member gets nothing; a fought daily member gets the daily mail
    run(SUN + 1, SUN + 1, { [SUN + 1]: ["c"] }); clock.t = B.battleAt(SUN + 1) + 30 * M;
    const r2 = await hub.sendReports();
    const aFought = hub.store.shots(SUN + 1).some(s => s.a === "a" || s.d === "a");
    assert.deepEqual(sent.slice(3).map(m => [m.to.split("@")[0], m.kind]), aFought ? [["a", "daily"]] : [], JSON.stringify(r2.out));
    assert.ok(r2.out.some(x => x.h === "cx" && x.skip === "nothing to report"));
  });
});
test("send rule: a quiet weekday gives nothing; a week with no battle gives nothing", async () => {
  const { hub, clock, sent, run } = rig();
  await quietLog(async () => {
    run(SUN - 2, SUN - 2, { [SUN - 2]: ["c"] }); clock.t = B.battleAt(SUN - 2) + 30 * M;   // Friday
    hub.store.setReport("b", "weekly");
    await hub.sendReports();
    assert.deepEqual(sent.map(m => m.to.split("@")[0]).sort(), ["a"], "daily + quiet + weekday: nothing for c; weekly + weekday: nothing for b");
  });
  const k = rig();
  await quietLog(async () => {
    k.run(SUN, SUN, { [SUN]: ["a", "b", "c"] }); k.hub.store.setReport("b", "weekly"); k.clock.t = B.battleAt(SUN) + 30 * M;
    assert.equal(k.hub.store.shots(SUN).length, 0);
    const r = await k.hub.sendReports();
    assert.equal(k.sent.length, 0, JSON.stringify(r.out)); assert.ok(r.out.filter(x => x.skip === "no battle in the week").length >= 2);
  });
});
test("routes: the week picture is 200 image/png for a week with shots, stored once; 404 for a week with none; a non-member handle gets the public picture", async () => {
  const { hub, db, run, get } = rig();
  await quietLog(async () => {
    run(SUN - 2, SUN);
    const g = await get(`/v1/world/battle/card/week/${key(SUN)}.png`);
    assert.equal(g.status, 200); assert.equal(g.headers["content-type"], "image/png"); assert.ok(/max-age=\d{6}/.test(g.headers["cache-control"]));
    assert.ok(g.body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM battle_cards WHERE night=? AND who='week'").get(SUN).n, 1);
    assert.ok((await get(`/v1/world/battle/card/week/${key(SUN)}.png`)).body.equals(g.body), "the stored picture again");
    const m = await get(`/v1/world/battle/card/week/${key(SUN)}/ax.png`); assert.equal(m.status, 200); assert.ok(!m.body.equals(g.body), "the member's own picture");
    const nm = await get(`/v1/world/battle/card/week/${key(SUN)}/nobody.png`); assert.equal(nm.status, 200); assert.ok(nm.body.equals(g.body), "not a member: the public picture");
    assert.equal((await get(`/v1/world/battle/card/week/${key(SUN - 14)}.png`)).status, 404, "no battle that week");
    assert.equal((await get(`/v1/world/battle/card/week/${key(SUN + 1)}.png`)).status, 404, "a night that has not run");
    // a changed night drops the week pictures that hold it
    hub.resolve(SUN - 1, { force: true });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM battle_cards WHERE who LIKE 'week%'").get().n, 0);
  });
});
