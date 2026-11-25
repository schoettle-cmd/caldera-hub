/**
 * The nightly battle picture, 1200x630 (LOOP.md part a.3; spec 11-24 section 2 "a beautiful graphic that shows who won and
 * who lost"): the top of the battle mail, the share picture of the replay link (og:image) and the still of the homepage block.
 * A port of graphic(n, me) in reports/2026-11-24-battle-loop/a-battle-email.html: plain string building, text only, no remote
 * hrefs (avatars come in as data: URIs over the letter circle), no arrow glyphs (the triangles are drawn paths).
 * Rendered to PNG by cards.ts toPng with the TTF files in packages/hub/fonts (OFL) passed as fontFiles.
 */
import fs from "node:fs";
import path from "node:path";
import { fmtUsd } from "./battle";

/** a city in the picture: display handle ("@h", or "raiders from the sea"), and an avatar as a data: URI (null: letter circle) */
export interface CardNight {
  /** "2026-11-24" */ night: string; season: number; week: number; cities: number; hits: number; usd: number;
  tops: { h: string; usd: number; fired: number; landed: number; av?: string | null }[];
  hard: { h: string; usd: number; hits: number; held: number; down: boolean; av?: string | null }[];
}
export interface CardMe { h: string; res: "WON" | "HELD" | "LOST" | "FELL"; dealt: number; took: number; held: number; rank: number | null; move: number; av?: string | null }

const RES_COL: Record<CardMe["res"], [string, string, string]> = { WON: ["#4BE38A", "#1E7A45", "#0E3F23"], HELD: ["#3DF2FF", "#16808A", "#0A4046"], LOST: ["#FF6A3D", "#9C3414", "#521A08"], FELL: ["#FF4D5E", "#9A1F2C", "#4F0E15"] };
const AV_COL = ["#6D4AE8", "#138A6A", "#B5650A", "#2F6FD0", "#B2394B", "#5A6478"];
const F_HEAD = "'Saira Extra Condensed','Barlow Condensed','Arial Narrow',Arial,sans-serif";
const F_LAB = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";
const F_MONO = "'IBM Plex Mono','DejaVu Sans Mono',monospace";
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const bare = (h: string) => h.replace(/^@/, "");
/** upper case, cut at n characters with "..", then escaped (upper case first: an escaped entity must stay lower case) */
const up = (h: string, n = 20) => { const b = bare(h); return esc((b.length > n ? b.slice(0, n) + ".." : b).toUpperCase()); };
const day = (key: string) => { const d = new Date(key + "T12:00:00Z"); return isNaN(+d) ? { short: key, long: key } : { short: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`, long: `${MON[d.getUTCMonth()]!.charAt(0)}${MON[d.getUTCMonth()]!.slice(1).toLowerCase()} ${d.getUTCDate()}` }; };
const DATA_IMG = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

let clipN = 0;
function av(cx: number, cy: number, r: number, h: string, i: number, ring: string | null, uri?: string | null): string {
  const letter = (bare(h)[0] || "?").toUpperCase();
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${AV_COL[i % AV_COL.length]}"/>` +
    `<text x="${cx}" y="${(cy + r * 0.36).toFixed(1)}" text-anchor="middle" font-family="${F_LAB}" font-weight="700" font-size="${Math.round(r * 1.05)}" fill="#fff">${esc(letter)}</text>`;
  if (uri && DATA_IMG.test(uri)) { const id = `av${clipN++}`; s += `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><image x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" href="${uri}"/>`; }
  if (ring) s += `<circle cx="${cx}" cy="${cy}" r="${r + 2.5}" fill="none" stroke="${ring}" stroke-width="3"/>`;
  return s;
}
/** skewed headline with the hard block shadow (2 px right per 1 px down) */
function block(x: number, y: number, size: number, txt: string, cols: [string, string, string]): string {
  const t = (dx: number, dy: number, f: string) => `<text x="${dx}" y="${dy}" font-family="${F_HEAD}" font-weight="900" font-size="${size}" letter-spacing="1" fill="${f}">${txt}</text>`;
  return `<g transform="translate(${x} ${y}) skewX(-8)">${t(8, 4, cols[2])}${t(6, 3, cols[2])}${t(4, 2, cols[1])}${t(2, 1, cols[1])}${t(0, 0, cols[0])}</g>`;
}
const moveOf = (mv: number): [string, string, string] => mv > 0 ? ["UP " + mv, "#4BE38A", "M0 12 L8 0 L16 12 Z"] : mv < 0 ? ["DOWN " + -mv, "#FF4D5E", "M0 0 L16 0 L8 12 Z"] : ["NO CHANGE", "#F4F6FA", ""];

/** The picture as SVG. me = null: the generic variant (share picture, homepage still, visitors). */
export function battleCardSvg(n: CardNight, me: CardMe | null): string {
  clipN = 0;
  const d = day(n.night), G: [string, string, string] = ["#FFC83D", "#B07A0E", "#5E3F04"];
  const w = n.tops[0]?.h || "", wb = bare(w), hs = wb.length <= 14 ? 100 : 78;
  const rowA = (r: CardNight["tops"][number], i: number) => { const cy = 300 + i * 56; return `<text x="48" y="${cy + 12}" font-family="${F_HEAD}" font-weight="900" font-size="36" fill="${i ? "#F4F6FA" : "#FFC83D"}">${i + 1}</text>` + av(104, cy, 19, r.h, i, null, r.av) +
    `<text x="136" y="${cy - 4}" font-family="${F_LAB}" font-weight="700" font-size="28" letter-spacing=".8" fill="#F4F6FA">${up(r.h)}</text>` +
    `<text x="136" y="${cy + 19}" font-family="${F_MONO}" font-weight="500" font-size="20" fill="#F4F6FA" fill-opacity=".6">${r.landed} of ${r.fired} missiles hit</text>` +
    `<text x="640" y="${cy + 11}" text-anchor="end" font-family="${F_LAB}" font-weight="700" font-size="36" fill="#FFC83D">${esc(fmtUsd(r.usd))}</text>`; };
  const rowD = (r: CardNight["hard"][number], i: number) => { const cy = 300 + i * 56; return av(707, cy, 19, r.h, i + 3, null, r.av) +
    `<text x="739" y="${cy - 4}" font-family="${F_LAB}" font-weight="700" font-size="28" letter-spacing=".8" fill="#F4F6FA">${up(r.h, 14)}${r.down ? `<tspan dx="10" font-size="20" letter-spacing="2" fill="#FF4D5E">CITY DOWN</tspan>` : ""}</text>` +
    `<text x="739" y="${cy + 19}" font-family="${F_MONO}" font-weight="500" font-size="20" fill="#F4F6FA" fill-opacity=".6">${r.hits} hit${r.hits === 1 ? "" : "s"}, shield held ${esc(fmtUsd(r.held))}</text>` +
    `<text x="1152" y="${cy + 11}" text-anchor="end" font-family="${F_LAB}" font-weight="700" font-size="36" fill="#58B4FF">${esc(fmtUsd(r.usd))}</text>`; };
  const tile = (x: number, v: string, l: string, gold?: boolean) => `<rect x="${x}" y="96" width="144" height="112" rx="10" fill="#fff" fill-opacity=".055"/>` +
    `<text x="${x + 16}" y="154" font-family="${F_LAB}" font-weight="700" font-size="${v.length <= 5 ? 52 : v.length === 6 ? 46 : 40}" fill="${gold ? "#FFC83D" : "#F4F6FA"}">${esc(v)}</text>` +
    `<text x="${x + 16}" y="188" font-family="${F_LAB}" font-weight="600" font-size="20" letter-spacing="2" fill="#F4F6FA" fill-opacity=".7">${l}</text>`;
  const frame = `<polygon points="63,452 1171,452 1151,592 43,592" fill="#8B6CF6" fill-opacity=".18" stroke="#8B6CF6" stroke-width="1.5"/><polygon points="63,452 75,452 55,592 43,592" fill="#8B6CF6"/>`;
  let band: string;
  if (me) {
    const c = RES_COL[me.res], mv = moveOf(me.move);
    const fact = (x: number, l: string, v: string, col?: string) => `<text x="${x}" y="494" font-family="${F_LAB}" font-weight="600" font-size="20" letter-spacing="1.5" fill="#F4F6FA" fill-opacity=".7">${l}</text><text x="${x}" y="548" font-family="${F_LAB}" font-weight="700" font-size="${v.length <= 6 ? 46 : 40}" fill="${col || "#F4F6FA"}">${esc(v)}</text>`;
    band = frame + av(124, 523, 34, me.h, 0, "#8B6CF6", me.av) +
      `<text x="176" y="494" font-family="${F_LAB}" font-weight="700" font-size="20" letter-spacing="2.5" fill="#B9A6FF">YOUR CITY</text>` +
      `<text x="176" y="535" font-family="${F_LAB}" font-weight="700" font-size="38" letter-spacing=".8" fill="#F4F6FA">${esc(bare(me.h).slice(0, 12).toUpperCase())}</text>` +
      `<text x="176" y="563" font-family="${F_MONO}" font-weight="500" font-size="18" fill="#F4F6FA" fill-opacity=".7">S${n.season} WEEK ${n.week}</text>` +
      block(392, 558, 96, me.res, c) + fact(590, "DEALT", fmtUsd(me.dealt)) + fact(736, "TOOK", fmtUsd(me.took)) + fact(876, "SHIELD HELD", fmtUsd(me.held), "#3DF2FF") +
      (me.rank ? `<text x="1136" y="494" text-anchor="end" font-family="${F_LAB}" font-weight="600" font-size="20" letter-spacing="1.5" fill="#F4F6FA" fill-opacity=".7">SEASON RANK</text>` +
        `<text x="1136" y="546" text-anchor="end" font-family="${F_HEAD}" font-weight="900" font-size="56" fill="#F4F6FA">#${me.rank}</text>` +
        `<text x="1136" y="577" text-anchor="end" font-family="${F_LAB}" font-weight="700" font-size="22" letter-spacing="1.5" fill="${mv[1]}">${mv[0]}</text>` +
        (mv[2] ? `<path d="${mv[2]}" transform="translate(${(1136 - mv[0].length * 12.5 - 26).toFixed(1)} 562)" fill="${mv[1]}"/>` : "") : "");
  } else {
    band = frame + `<text x="100" y="494" font-family="${F_LAB}" font-weight="700" font-size="20" letter-spacing="2.5" fill="#B9A6FF">NEXT BATTLE</text>` + block(100, 560, 72, "TONIGHT 20:00 PT", G) +
      `<text x="600" y="520" font-family="${F_LAB}" font-weight="600" font-size="26" fill="#F4F6FA">Your GitHub becomes a city.</text><text x="600" y="552" font-family="${F_LAB}" font-weight="600" font-size="26" fill="#F4F6FA">Today&#39;s code becomes missiles.</text>` +
      `<rect x="930" y="497" width="204" height="56" rx="28" fill="#8B6CF6"/><text x="1032" y="533" text-anchor="middle" font-family="${F_LAB}" font-weight="700" font-size="24" letter-spacing="1.5" fill="#fff">ADD YOUR CITY</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="${esc(battleCardAlt(n, me))}">
<defs><radialGradient id="gA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(170 40) scale(640 420)"><stop offset="0" stop-color="#FF6A3D" stop-opacity=".2"/><stop offset="1" stop-color="#FF6A3D" stop-opacity="0"/></radialGradient>
<radialGradient id="gB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1090 610) scale(600 380)"><stop offset="0" stop-color="#8B6CF6" stop-opacity=".28"/><stop offset="1" stop-color="#8B6CF6" stop-opacity="0"/></radialGradient>
<pattern id="hat" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-62)"><rect width="1" height="14" fill="#fff" fill-opacity=".035"/></pattern></defs>
<rect width="1200" height="630" fill="#0B0D13"/><rect width="1200" height="630" fill="url(#hat)"/><rect width="1200" height="630" fill="url(#gA)"/><rect width="1200" height="630" fill="url(#gB)"/>
<path d="M48 66 L59 44 L70 66 Z" fill="#8B6CF6"/><text x="80" y="65" font-family="${F_LAB}" font-weight="700" font-size="22" letter-spacing="3.5" fill="#F4F6FA">CALDERA<tspan fill="#3DF2FF" dx="12">NIGHTLY BATTLE</tspan><tspan fill="#F4F6FA" fill-opacity=".7" dx="12">${esc(d.short)}</tspan></text>
<text x="1152" y="64" text-anchor="end" font-family="${F_MONO}" font-weight="500" font-size="20" fill="#F4F6FA" fill-opacity=".7">caldera.social</text>
${w ? block(48, hs === 100 ? 166 : 158, hs, up(w, hs === 100 ? 14 : 16), G) : ""}
<g transform="translate(48 220) skewX(-8)"><text font-family="${F_HEAD}" font-weight="900" font-size="54" letter-spacing="1" fill="#F4F6FA">WON THE NIGHT</text></g>
${tile(688, String(n.cities), "CITIES")}${tile(848, String(n.hits), "HITS")}${tile(1008, fmtUsd(n.usd), "DAMAGE", true)}
<text x="48" y="256" font-family="${F_LAB}" font-weight="700" font-size="20" letter-spacing="3" fill="#FF6A3D">TOP ATTACKERS</text><rect x="48" y="266" width="592" height="1" fill="#fff" fill-opacity=".14"/>
<text x="688" y="256" font-family="${F_LAB}" font-weight="700" font-size="20" letter-spacing="3" fill="#58B4FF">HIT HARDEST</text><rect x="688" y="266" width="464" height="1" fill="#fff" fill-opacity=".14"/>
${n.tops.slice(0, 3).map(rowA).join("")}${n.hard.slice(0, 3).map(rowD).join("")}
${band}
</svg>`;
}

// ---------------------------------------------------------------- the week picture (WEEKLY.md 4; weekGraphic() of weekly-email.html)
/** the week for the picture: range "Nov 24-30", the week's totals, the top 3 attackers and the 3 cities hit hardest (handles) */
export interface CardWeek { /** the night key of the last night */ night: string; range: string; season: number; week: number; battles: number; hits: number; usd: number;
  tops: { h: string; usd: number; hits: number; nights: number; av?: string | null }[]; hard: { h: string; usd: number; hits: number; nights: number; fell: number; av?: string | null }[] }
/** the member's week: nights won and fought, dollars, lots built, season rank and its move of the week (null: no move shown) */
export interface CardWeekMe { h: string; won: number; fought: number; dealt: number; took: number; lots: number; rank: number | null; move: number | null; av?: string | null }
const GREEN: [string, string, string] = ["#4BE38A", "#1E7A45", "#0E3F23"], CYAN: [string, string, string] = ["#3DF2FF", "#16808A", "#0A4046"], GOLD: [string, string, string] = ["#FFC83D", "#B07A0E", "#5E3F04"];
const n1 = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const lab = (x: number, y: number, t: string, o: { end?: boolean; w?: number; ls?: number; col?: string } = {}) => `<text x="${x}" y="${y}"${o.end ? ' text-anchor="end"' : ""} font-family="${F_LAB}" font-weight="${o.w || 600}" font-size="20" letter-spacing="${o.ls || 1.5}" fill="${o.col || "#F4F6FA"}"${o.col ? "" : ' fill-opacity=".7"'}>${t}</text>`;
const FRAME = `<polygon points="63,452 1171,452 1151,592 43,592" fill="#8B6CF6" fill-opacity=".18" stroke="#8B6CF6" stroke-width="1.5"/><polygon points="63,452 75,452 55,592 43,592" fill="#8B6CF6"/>`;
function weekWho(wk: CardWeek, me: CardWeekMe): string {
  const b = bare(me.h);
  return av(124, 523, 34, me.h, 0, "#8B6CF6", me.av) + lab(176, 494, "YOUR CITY", { w: 700, ls: 2.5, col: "#B9A6FF" }) +
    `<text x="176" y="535" font-family="${F_LAB}" font-weight="700" font-size="${b.length > 10 ? 32 : 38}" letter-spacing=".8" fill="#F4F6FA">${esc(b.slice(0, 12).toUpperCase())}</text>` +
    `<text x="176" y="563" font-family="${F_MONO}" font-weight="500" font-size="18" fill="#F4F6FA" fill-opacity=".7">S${wk.season} WEEK ${wk.week}</text>`;
}
function weekRank(me: CardWeekMe): string {
  if (!me.rank) return "";
  const s = lab(1136, 494, "SEASON RANK", { end: true }) + `<text x="1136" y="${me.move == null ? 556 : 546}" text-anchor="end" font-family="${F_HEAD}" font-weight="900" font-size="56" fill="#F4F6FA">#${me.rank}</text>`;
  if (me.move == null) return s;   // a quiet week, or no rank 7 nights before: the rank alone
  const mv = moveOf(me.move);
  return s + `<text x="1136" y="577" text-anchor="end" font-family="${F_LAB}" font-weight="700" font-size="22" letter-spacing="1.5" fill="${mv[1]}">${mv[0]}</text>` +
    (mv[2] ? `<path d="${mv[2]}" transform="translate(${(1136 - mv[0].length * 12.5 - 26).toFixed(1)} 562)" fill="${mv[1]}"/>` : "");
}
/** The week picture as SVG, 1200x630. me = null: the public variant; me with fought = 0: the quiet band (INTACT). */
export function weeklyCardSvg(wk: CardWeek, me: CardWeekMe | null): string {
  clipN = 0;
  const w = wk.tops[0]?.h || "", hs = bare(w).length <= 14 ? 100 : 78;
  const sub = (r: { hits: number; nights: number }) => `${n1(r.hits, "hit")} in ${n1(r.nights, "night")}`;
  const rowA = (r: CardWeek["tops"][number], i: number) => { const cy = 300 + i * 56; return `<text x="48" y="${cy + 12}" font-family="${F_HEAD}" font-weight="900" font-size="36" fill="${i ? "#F4F6FA" : "#FFC83D"}">${i + 1}</text>` + av(104, cy, 19, r.h, i, null, r.av) +
    `<text x="136" y="${cy - 4}" font-family="${F_LAB}" font-weight="700" font-size="28" letter-spacing=".8" fill="#F4F6FA">${up(r.h)}</text>` +
    `<text x="136" y="${cy + 19}" font-family="${F_MONO}" font-weight="500" font-size="20" fill="#F4F6FA" fill-opacity=".6">${sub(r)}</text>` +
    `<text x="640" y="${cy + 11}" text-anchor="end" font-family="${F_LAB}" font-weight="700" font-size="36" fill="#FFC83D">${esc(fmtUsd(r.usd))}</text>`; };
  const rowD = (r: CardWeek["hard"][number], i: number) => { const cy = 300 + i * 56; return av(707, cy, 19, r.h, i + 3, null, r.av) +
    `<text x="739" y="${cy - 4}" font-family="${F_LAB}" font-weight="700" font-size="28" letter-spacing=".8" fill="#F4F6FA">${up(r.h, 14)}${r.fell ? `<tspan dx="10" font-size="20" letter-spacing="2" fill="#FF4D5E">FELL ${r.fell}X</tspan>` : ""}</text>` +
    `<text x="739" y="${cy + 19}" font-family="${F_MONO}" font-weight="500" font-size="20" fill="#F4F6FA" fill-opacity=".6">${sub(r)}</text>` +
    `<text x="1152" y="${cy + 11}" text-anchor="end" font-family="${F_LAB}" font-weight="700" font-size="36" fill="#58B4FF">${esc(fmtUsd(r.usd))}</text>`; };
  const tile = (x: number, v: string, l: string, gold?: boolean) => `<rect x="${x}" y="96" width="144" height="112" rx="10" fill="#fff" fill-opacity=".055"/>` +
    `<text x="${x + 16}" y="154" font-family="${F_LAB}" font-weight="700" font-size="${v.length <= 5 ? 52 : v.length === 6 ? 46 : 40}" fill="${gold ? "#FFC83D" : "#F4F6FA"}">${esc(v)}</text>` +
    `<text x="${x + 16}" y="188" font-family="${F_LAB}" font-weight="600" font-size="20" letter-spacing="2" fill="#F4F6FA" fill-opacity=".7">${l}</text>`;
  let band: string;
  if (!me) {   // the band of the daily generic picture
    band = FRAME + lab(100, 494, "NEXT BATTLE", { w: 700, ls: 2.5, col: "#B9A6FF" }) + block(100, 560, 72, "TONIGHT 20:00 PT", GOLD) +
      `<text x="600" y="520" font-family="${F_LAB}" font-weight="600" font-size="26" fill="#F4F6FA">Your GitHub becomes a city.</text><text x="600" y="552" font-family="${F_LAB}" font-weight="600" font-size="26" fill="#F4F6FA">Today&#39;s code becomes missiles.</text>` +
      `<rect x="930" y="497" width="204" height="56" rx="28" fill="#8B6CF6"/><text x="1032" y="533" text-anchor="middle" font-family="${F_LAB}" font-weight="700" font-size="24" letter-spacing="1.5" fill="#fff">ADD YOUR CITY</text>`;
  } else if (!me.fought) {   // a quiet week: no zero, no red, no rank move
    band = FRAME + weekWho(wk, me) + block(392, 558, 96, "INTACT", CYAN) + lab(668, 494, `NOT HIT IN ${n1(wk.battles, "BATTLE").toUpperCase()}`) +
      `<text x="668" y="548" font-family="${F_LAB}" font-weight="700" font-size="46" fill="#F4F6FA">NEXT: MON 20:00 PT</text>` + weekRank({ ...me, move: null });
  } else {   // fought: NIGHTS WON {w} OF {f} in green, or NIGHTS FOUGHT {f} OF {n} in cyan
    const win = me.won > 0, k = String(win ? me.won : me.fought), m = win ? me.fought : wk.battles;
    const fact = (x: number, l: string, v: string, col?: string) => lab(x, 494, l) + `<text x="${x}" y="548" font-family="${F_LAB}" font-weight="700" font-size="${v.length <= 6 ? 46 : 40}" fill="${col || "#F4F6FA"}">${esc(v)}</text>`;
    band = FRAME + weekWho(wk, me) + lab(392, 494, win ? "NIGHTS WON" : "NIGHTS FOUGHT") + block(392, 568, 84, k, win ? GREEN : CYAN) +
      `<text x="${392 + k.length * 36 + 26}" y="562" font-family="${F_LAB}" font-weight="700" font-size="34" letter-spacing="1" fill="#F4F6FA" fill-opacity=".7">OF ${m}</text>` +
      fact(590, "DEALT", fmtUsd(me.dealt), "#FFC83D") + fact(736, "TOOK", fmtUsd(me.took), "#58B4FF") + fact(876, "LOTS BUILT", String(me.lots)) + weekRank(me);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="${esc(weeklyCardAlt(wk, me))}">
<defs><radialGradient id="gA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(170 40) scale(640 420)"><stop offset="0" stop-color="#FF6A3D" stop-opacity=".2"/><stop offset="1" stop-color="#FF6A3D" stop-opacity="0"/></radialGradient>
<radialGradient id="gB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1090 610) scale(600 380)"><stop offset="0" stop-color="#8B6CF6" stop-opacity=".28"/><stop offset="1" stop-color="#8B6CF6" stop-opacity="0"/></radialGradient>
<pattern id="hat" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-62)"><rect width="1" height="14" fill="#fff" fill-opacity=".035"/></pattern></defs>
<rect width="1200" height="630" fill="#0B0D13"/><rect width="1200" height="630" fill="url(#hat)"/><rect width="1200" height="630" fill="url(#gA)"/><rect width="1200" height="630" fill="url(#gB)"/>
<path d="M48 66 L59 44 L70 66 Z" fill="#8B6CF6"/><text x="80" y="65" font-family="${F_LAB}" font-weight="700" font-size="22" letter-spacing="3.5" fill="#F4F6FA">CALDERA<tspan fill="#3DF2FF" dx="12">WEEK IN BATTLE</tspan><tspan fill="#F4F6FA" fill-opacity=".7" dx="12">${esc(String(wk.range).toUpperCase())}</tspan></text>
<text x="1152" y="64" text-anchor="end" font-family="${F_MONO}" font-weight="500" font-size="20" fill="#F4F6FA" fill-opacity=".7">caldera.social</text>
${w ? block(48, hs === 100 ? 166 : 158, hs, up(w, hs === 100 ? 14 : 16), GOLD) : ""}
<g transform="translate(48 220) skewX(-8)"><text font-family="${F_HEAD}" font-weight="900" font-size="54" letter-spacing="1" fill="#F4F6FA">WON THE WEEK</text></g>
${tile(688, String(wk.battles), "BATTLES")}${tile(848, String(wk.hits), "HITS")}${tile(1008, fmtUsd(wk.usd), "DAMAGE", true)}
<text x="48" y="256" font-family="${F_LAB}" font-weight="700" font-size="20" letter-spacing="3" fill="#FF6A3D">TOP ATTACKERS OF THE WEEK</text><rect x="48" y="266" width="592" height="1" fill="#fff" fill-opacity=".14"/>
<text x="688" y="256" font-family="${F_LAB}" font-weight="700" font-size="20" letter-spacing="3" fill="#58B4FF">HIT HARDEST</text><rect x="688" y="266" width="464" height="1" fill="#fff" fill-opacity=".14"/>
${wk.tops.slice(0, 3).map(rowA).join("")}${wk.hard.slice(0, 3).map(rowD).join("")}
${band}
</svg>`;
}
/** The week picture's alt text (and the SVG's aria-label): the same facts as words (WEEKLY.md 4). */
export function weeklyCardAlt(wk: CardWeek, me: CardWeekMe | null): string {
  const a = wk.tops.map(r => `${r.h} ${fmtUsd(r.usd)}`).join(", "), d = wk.hard.map(r => `${r.h} ${fmtUsd(r.usd)}${r.fell ? ` (fell on ${n1(r.fell, "night")})` : ""}`).join(", ");
  const rank = me && me.rank ? ` Season rank ${me.rank}${me.fought && me.move != null ? (me.move > 0 ? `, up ${me.move}` : me.move < 0 ? `, down ${-me.move}` : ", no change") : ""}.` : "";
  return `Caldera week in battle, ${wk.range}.` + (wk.tops.length ? ` ${wk.tops[0]!.h} won the week. Top attackers: ${a}.` : "") + (d ? ` Hit hardest: ${d}.` : "") +
    ` ${n1(wk.battles, "battle")}, ${n1(wk.hits, "missile")} hit, ${fmtUsd(wk.usd)} of damage.` +
    (!me ? " Next battle tonight at 20:00 PT." : !me.fought ? ` Your city ${me.h} was not hit in ${n1(wk.battles, "battle")}. Next battle Monday at 20:00 PT.${rank}` :
      ` Your city ${me.h} ${me.won ? `won ${me.won} of ${n1(me.fought, "night")} fought` : `fought ${n1(me.fought, "night")} of ${wk.battles}`}: dealt ${fmtUsd(me.dealt)}, took ${fmtUsd(me.took)}, ${n1(me.lots, "lot")} built.${rank}`);
}

/** The story picture, 1080x1920 (LOOP.md c.7, mockup c share sheet): the winner line, "Your city" + the result word, Dealt / Took,
 *  the season rank, one drawn button WATCH THE REPLAY in the lower middle and caldera.social at the foot. House rule 11: the link
 *  sticker goes on the drawn button only; the left and right 13% (140 px) stay empty for the thumb, and nothing else looks like a button. */
export function battleStorySvg(n: CardNight, me: CardMe): string {
  const c = RES_COL[me.res], G: [string, string, string] = ["#FFC83D", "#B07A0E", "#5E3F04"], L = 173, W = 1080 - 2 * L;
  const w = n.tops[0]?.h || "", wb = bare(w), hs = wb.length <= 10 ? 150 : wb.length <= 15 ? 112 : 84;
  const mv = me.rank ? `SEASON RANK #${me.rank}, ${me.move > 0 ? "UP " + me.move : me.move < 0 ? "DOWN " + -me.move : "NO CHANGE"}` : "";
  const lab = (y: number, t: string, col = "#F4F6FA", op = ".7", size = 38) => `<text x="${L}" y="${y}" font-family="${F_LAB}" font-weight="700" font-size="${size}" letter-spacing="3" fill="${col}" fill-opacity="${op}">${t}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920" role="img" aria-label="${esc(battleCardAlt(n, me))}">
<defs><radialGradient id="sA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(300 200) scale(900 800)"><stop offset="0" stop-color="#FF6A3D" stop-opacity=".2"/><stop offset="1" stop-color="#FF6A3D" stop-opacity="0"/></radialGradient>
<radialGradient id="sB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(800 1700) scale(900 700)"><stop offset="0" stop-color="#8B6CF6" stop-opacity=".28"/><stop offset="1" stop-color="#8B6CF6" stop-opacity="0"/></radialGradient></defs>
<rect width="1080" height="1920" fill="#0B0D13"/><rect width="1080" height="1920" fill="url(#sA)"/><rect width="1080" height="1920" fill="url(#sB)"/>
${lab(200, "CALDERA NIGHTLY BATTLE", "#3DF2FF", "1", 34)}
${w ? block(L, 250 + hs, hs, up(w, 18), G) : ""}
<g transform="translate(${L} ${w ? 320 + hs : 330}) skewX(-8)"><text font-family="${F_HEAD}" font-weight="900" font-size="64" letter-spacing="1" fill="#F4F6FA">WON THE NIGHT</text></g>
${lab(640, "YOUR CITY", "#B9A6FF", "1")}
${block(L, 820, 190, me.res, c)}
${lab(920, `DEALT ${esc(fmtUsd(me.dealt))} / TOOK ${esc(fmtUsd(me.took))}`, "#F4F6FA", ".85", 44)}
${mv ? lab(990, mv, "#F4F6FA", ".85", 44) : ""}
<rect x="${L + 108}" y="1306" width="${W - 216}" height="150" rx="75" fill="#8B6CF6"/><rect x="${L + 102}" y="1300" width="${W - 204}" height="162" rx="81" fill="none" stroke="#3DF2FF" stroke-opacity=".7" stroke-width="6"/>
<text x="540" y="1398" text-anchor="middle" font-family="${F_LAB}" font-weight="700" font-size="48" letter-spacing="4" fill="#fff">WATCH THE REPLAY</text>
<text x="540" y="1806" text-anchor="middle" font-family="${F_MONO}" font-weight="500" font-size="34" fill="#F4F6FA" fill-opacity=".44">caldera.social</text>
</svg>`;
}

/** The alt text (and the SVG's aria-label): the same facts as words (LOOP.md a.3). */
export function battleCardAlt(n: CardNight, me: CardMe | null): string {
  const at = (h: string) => h;   // "@h" as given; the raiders keep their name ("raiders from the sea")
  const a = n.tops.map(r => `${at(r.h)} ${fmtUsd(r.usd)}`).join(", "), d = n.hard.map(r => `${at(r.h)} ${fmtUsd(r.usd)}${r.down ? " (city down)" : ""}`).join(", ");
  const mv = !me ? "" : me.move > 0 ? `up ${me.move}` : me.move < 0 ? `down ${-me.move}` : "no change";
  return `Caldera battle, ${day(n.night).long}.` + (n.tops.length ? ` ${at(n.tops[0]!.h)} won the night. Top attackers: ${a}.` : "") + (d ? ` Hit hardest: ${d}.` : "") +
    ` ${n.cities} cities fought, ${n.hits} missiles hit, ${fmtUsd(n.usd)} of damage.` +
    (me ? ` Your city ${at(me.h)} ${me.res.toLowerCase()}: dealt ${fmtUsd(me.dealt)}, took ${fmtUsd(me.took)}, shield held ${fmtUsd(me.held)}.${me.rank ? ` Season rank ${me.rank}, ${mv}.` : ""}` : " Next battle tonight at 20:00 PT.");
}

/** The picture's TTF files (LOOP.md a.6: Saira Extra Condensed 900, Barlow Condensed 600 and 700, IBM Plex Mono 500; OFL),
 *  from CALDERA_FONTS or packages/hub/fonts next to dist/. [] when they are not there: resvg falls back to system fonts. */
export const CARD_FONTS = ["SairaExtraCondensed-Black.ttf", "BarlowCondensed-SemiBold.ttf", "BarlowCondensed-Bold.ttf", "IBMPlexMono-Medium.ttf"];
let fontsCache: string[] | null = null;
export function cardFonts(dir?: string): string[] {
  if (!dir && fontsCache) return fontsCache;
  let base = dir || process.env.CALDERA_FONTS || "";
  if (!base) { try { base = new URL("../fonts/", import.meta.url).pathname; } catch { base = ""; } }
  const out = base ? CARD_FONTS.map(f => path.join(base, f)).filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) : [];
  if (out.length < CARD_FONTS.length) console.error(`[battlecard] ${CARD_FONTS.length - out.length} of ${CARD_FONTS.length} font files missing; system fonts stand in`);
  if (!dir) fontsCache = out;
  return out;
}

/** An avatar as a data: URI for the picture: a PNG or JPEG of at most 1.5 MB, or null (the letter circle stays). Never throws. */
export function avatarUri(buf: Buffer | Uint8Array | null | undefined): string | null {
  if (!buf || !buf.length || buf.length > 1_500_000) return null;
  const b = Buffer.from(buf), png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return png ? "data:image/png;base64," + b.toString("base64") : jpg ? "data:image/jpeg;base64," + b.toString("base64") : null;
}
/** fetch an avatar with a short timeout; any failure gives null */
export async function fetchAvatar(url: string, ms = 1500, f: typeof fetch = fetch): Promise<string | null> {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await f(url, { signal: ctl.signal, redirect: "follow" }); if (!r.ok) return null; return avatarUri(Buffer.from(await r.arrayBuffer())); }
  catch { return null; } finally { clearTimeout(t); }
}
