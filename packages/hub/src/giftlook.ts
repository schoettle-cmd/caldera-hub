/**
 * The look of the Armory gift emails and the countdown GIF, ported from Fable's design (frontier-design.md section K,
 * gift-mock/gift.js and countdown.js). Email markup: tables, inline styles, light only, ASCII text.
 */
import type { Canvas, RGB } from "./gif";
import type { BombKind } from "./armory";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const ascii = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[  ]/g, " ");

// ---------------------------------------------------------------- the countdown frame (K5)
export const CD_W = 560, CD_H = 156;
/** bg, tile, ink, accent (caption, colons), mute (labels), hot (BATTLE ON) */
export const GIFT_PAL: RGB[] = [[0x14, 0x12, 0x1f], [0x23, 0x20, 0x3a], [0xff, 0xff, 0xff], [0xb9, 0xa6, 0xff], [0x9a, 0x9a, 0xa5], [0xff, 0x7a, 0x1f]];
const BG = 0, TILE = 1, INK = 2, ACCENT = 3, MUTE = 4, HOT = 5;
/** 7 rows of cells, top to bottom; '1' = filled. 5 wide; the colon 1 wide; the space 3 wide. */
const FONT: Record<string, string> = {
  "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 11011 10001", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  ":": "0 0 1 0 1 0 0", " ": "000 000 000 000 000 000 000",
};
const rows = (ch: string) => (FONT[ch] ?? FONT[" "]!).split(" ");
const gw = (ch: string) => rows(ch)[0]!.length;
/** only what the font can draw */
export const cdText = (s: string) => s.toUpperCase().replace(/[^0-9A-Z: ]/g, "");
export const textW = (s: string, c: number) => [...s].reduce((w, ch, i) => w + gw(ch) * c + (i ? c : 0), 0);
function glyph(cv: Canvas, ch: string, px: number, py: number, c: number, col: number) {
  rows(ch).forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "1") cv.rect(px + i * c, py + j * c, c, c, col); });
}
function text(cv: Canvas, s: string, cx: number, py: number, c: number, col: number) {
  let px = Math.round(cx - textW(s, c) / 2);
  for (const ch of s) { glyph(cv, ch, px, py, c, col); px += gw(ch) * c + c; }
}
const p2 = (n: number) => (n < 10 ? "0" : "") + n;
export type CdFrame = { state: "count"; sec: number } | { state: "hold"; time: string; zone: string } | { state: "on" } | { state: "over" };
/** Draw one frame: rectangles only, flat colours (the canvas starts filled with bg). */
export function drawCountdown(cv: Canvas, o: CdFrame) {
  cv.rect(0, 0, CD_W, CD_H, BG);
  if (o.state === "count") {
    const s = Math.max(0, o.sec), d = p2(Math.min(99, Math.floor(s / 3600))) + p2(Math.floor(s / 60) % 60) + p2(s % 60);
    text(cv, "BATTLE STARTS IN", 280, 14, 3, ACCENT);
    const X = [71, 133, 221, 283, 371, 433], L = ["HRS", "MIN", "SEC"];
    for (let i = 0; i < 6; i++) { cv.rect(X[i]!, 47, 56, 72, TILE); glyph(cv, d[i]!, X[i]! + 8, 55, 8, INK); }
    glyph(cv, ":", 201, 55, 8, ACCENT); glyph(cv, ":", 351, 55, 8, ACCENT);
    for (let k = 0; k < 3; k++) text(cv, L[k]!, X[k * 2]! + 59, 127, 2, MUTE);
  } else if (o.state === "hold") {
    text(cv, "BATTLE STARTS AT", 280, 14, 3, ACCENT); text(cv, cdText(o.time), 280, 55, 8, INK); text(cv, cdText(o.zone), 280, 127, 2, MUTE);
  } else if (o.state === "on") {
    text(cv, "CALDERA", 280, 14, 3, ACCENT); text(cv, "BATTLE ON", 280, 55, 8, HOT); text(cv, "OPEN THE BATTLE VIEW", 280, 127, 2, MUTE);
  } else {
    text(cv, "CALDERA", 280, 14, 3, MUTE); text(cv, "BATTLE OVER", 280, 55, 8, INK); text(cv, "WATCH THE REPLAY", 280, 127, 2, MUTE);
  }
}

// ---------------------------------------------------------------- the bomb image (K5: 144 px PNG, shown at 72)
const BICON: Record<BombKind, string> = {
  sparkler: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  thunderbolt: '<path d="M13.5 2.5 5 13.5h6l-1.5 8 8.5-11h-6z" fill="currentColor" fill-opacity=".22"/>',
  inferno: '<path d="M12 21.5c-3.9 0-6.5-2.6-6.5-6.2 0-3.5 2.4-5.4 3.6-8.3.5 1.7 1.6 2.7 2.7 3.2.2-3.1 1.5-5.6 3.7-7.7.3 3.6 3.5 6 3.5 11.2 0 4.6-3 7.8-7 7.8z" fill="currentColor" fill-opacity=".22"/><path d="M12 21.5c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.5-2.7 2.3-4.4 1.5 1.4 3.3 2.6 3.3 4.4 0 1.6-1.1 2.8-2.8 2.8z"/>',
  nova: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6.4" stroke-opacity=".7"/><ellipse cx="12" cy="12" rx="10" ry="4.2" stroke-opacity=".45"/>',
};
export const BOMB_COL: Record<BombKind, string> = { sparkler: "#FFD24A", thunderbolt: "#9FD8FF", inferno: "#FF7A1F", nova: "#B9A6FF" };
export const BOMB_PX = 144;
export function bombSvg(k: string): string {
  const kk = (k in BICON ? k : "nova") as BombKind;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="28" fill="#14121F"/>`
    + `<svg x="28" y="28" width="88" height="88" viewBox="0 0 24 24" fill="none" stroke="${BOMB_COL[kk]}" color="${BOMB_COL[kk]}" style="color:${BOMB_COL[kk]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${BICON[kk].replace(/currentColor/g, BOMB_COL[kk])}</svg></svg>`;
}

// ---------------------------------------------------------------- shared email parts (K5)
const F = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif", MONO = "'SFMono-Regular',Menlo,Consolas,monospace";
const art = (name: string) => (/^[AEIOU]/i.test(name) ? "an" : "a");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function wrap(pre: string, inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>`
    + `<body style="margin:0;padding:0;background:#fff"><div style="margin:0;padding:20px 14px;background:#fff;color:#24222B;font:15px/1.55 ${F}"><div style="max-width:560px;margin:0 auto">`
    + `<div style="display:none;max-height:0;overflow:hidden">${esc(pre)}</div>${inner}</div></div></body></html>`;
}
const btn = (href: string, label: string) => `<p style="margin:0 0 18px"><a href="${esc(href)}" style="display:inline-block;background:#6E4FE0;color:#fff;text-decoration:none;font-weight:600;font-size:16px;line-height:48px;padding:0 26px;border-radius:999px">${esc(label)}</a></p>`;
const foot = (line: string, armory: string, all: string, postal: string) =>
  `<p style="margin:0;padding-top:14px;border-top:1px solid #E4E4DF;color:#5F5C6B;font-size:12.5px;line-height:1.6">${esc(line)} <a href="${esc(armory)}" style="color:#5A3CD0">Turn off Armory emails</a> or <a href="${esc(all)}" style="color:#5A3CD0">unsubscribe from all Caldera email</a>.<br>Caldera, ${esc(postal)}</p>`;
const footText = (line: string, armory: string, all: string, postal: string) => `--\n${line}\nTurn off Armory emails: ${armory}\nUnsubscribe from all Caldera email: ${all}\nCaldera, ${postal}`;

/** K4: "Wed, Nov 19 at 8:00 PM your time"; short "8:00 PM your time" */
export function whenText(t: number, tz: string) {
  const f = (o: Intl.DateTimeFormatOptions, z: string) => ascii(new Intl.DateTimeFormat("en-US", { timeZone: z, ...o }).format(new Date(t)));
  let z = tz; try { f({ hour: "numeric" }, z); } catch { z = "America/Los_Angeles"; }
  const clock = f({ hour: "numeric", minute: "2-digit" }, z), day = f({ weekday: "short", month: "short", day: "numeric" }, z);
  return { clock, long: `${day} at ${clock} your time`, short: `${clock} your time` };
}

export interface GiftBomb { k: BombKind; name: string; line: string; word: string }
export interface Gift1 { hub: string; to: string; from: string | null; bombs: GiftBomb[]; start: number; now: number; tz: string;
  battle: string; gif: string; unsubArmory: string; unsubAll: string; postal: string }
function bombCard(hub: string, b: GiftBomb, from: string | null) {
  const col = BOMB_COL[b.k] || "#B9A6FF";
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;border-collapse:separate;border:1px solid #E4E4DF;border-radius:12px"><tr>`
    + `<td width="72" valign="top" style="padding:12px 0 12px 12px"><img src="${esc(hub)}/email/bomb/${esc(b.k)}.png" width="72" height="72" alt="${esc(b.name)}" style="display:block;width:72px;height:72px;border:0;border-radius:14px;background:#14121F;color:${col};font:600 13px/72px ${F};text-align:center"></td>`
    + `<td valign="top" style="padding:12px 14px;font:15px/1.45 ${F};color:#24222B"><b style="font-size:17px;color:#111">${esc(b.name)}</b><br><span style="color:#5F5C6B;font-size:13.5px">${esc(b.line)}</span>`
    + `<div style="margin-top:8px;font-size:12px;color:#5F5C6B">The word on it${from ? ", from " + esc(from) : ""}</div>`
    + `<div style="font:700 22px/1.25 ${MONO};letter-spacing:.06em;color:#111;word-break:break-all">${esc(b.word.toUpperCase())}</div></td></tr></table>`;
}

/** Email 1 (K2): at once, when a bomb is bought and aimed at the member's city. */
export function giftEmail1(o: Gift1) {
  const b = o.bombs[0]!, who = o.from || "Someone", what = o.bombs.length === 1 ? `${art(b.name)} ${b.name}` : `${o.bombs.length} bombs`;
  const w = whenText(o.start, o.tz), started = o.now >= o.start;
  const subject = ascii(`${who} bought you ${what}`);
  const pre = ascii(started ? "It flies at your city in this battle. Watch it land." : `It flies at your city in the next battle: ${w.short}. Watch it land.`);
  const p1 = `${who} bought ${what} in the Armory and aimed ${o.bombs.length === 1 ? "it" : "them"} at your city.${o.from ? "" : " They chose not to show their name."} It is a game: the ${o.bombs.length === 1 ? "bomb flies" : "bombs fly"} in the next battle and ${o.bombs.length === 1 ? "its word rises" : "their words rise"} over the hit.`;
  const timeLine = started ? "The battle has started." : `The battle starts ${w.long}.`;
  const footLine = "You get at most 2 emails about a bomb: this one, and one more if your city is in the battle summary.";
  const html = wrap(pre,
    `<p style="margin:0 0 14px">Hey ${esc(o.to)},</p><p style="margin:0 0 14px">${esc(p1)}</p>`
    + o.bombs.map(x => bombCard(o.hub, x, o.from)).join("")
    + `<p style="margin:0 0 6px"><img src="${esc(o.gif)}" alt="${esc(started ? "The battle has started." : `The battle starts ${w.long}.`)}" width="560" height="156" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:12px;background:#14121F;color:#fff;font:600 15px/1.4 ${F}"></p>`
    + (started ? `<p style="margin:0 0 18px"><b>The battle has started.</b></p>` : `<p style="margin:0 0 18px"><b>The battle starts ${esc(w.long)}</b>. The timer counts to that real start time.</p>`)
    + btn(o.battle, "Watch the battle")
    + `<p style="margin:0 0 22px;color:#5F5C6B;font-size:13.5px">The damage is for show. Your city heals by noon the next day.</p>`
    + foot(footLine, o.unsubArmory, o.unsubAll, o.postal));
  const text = ascii([`Hey ${o.to},`, "", p1, "", ...o.bombs.flatMap(x => [`${x.name}: ${x.line}`, `Word: ${x.word.toUpperCase()}`, ""]),
    started ? timeLine : `${timeLine} The timer counts to that real start time.`, "", `Watch the battle: ${o.battle}`, "",
    "The damage is for show. Your city heals by noon the next day.", "", footText(footLine, o.unsubArmory, o.unsubAll, o.postal)].join("\n"));
  return { subject, pre, html, text };
}

export interface Gift2 { to: string; stacked: number | null; rankStacked: number | null; towers: number | null; usd: string | null;
  aimed: { k: BombKind; name: string; from: string | null; word: string }[]; post: string; pixel: string; unsubArmory: string; unsubAll: string; postal: string }
/** K3: only what the post prints for this city */
export function partOf(o: Pick<Gift2, "stacked" | "rankStacked" | "towers" | "usd">) {
  const a: string[] = [];
  if (o.towers != null) a.push(`${o.towers} tower${o.towers === 1 ? "" : "s"} hit, ${o.usd} damage`);
  if (o.rankStacked != null) a.push(`#${o.rankStacked} for most ammo stacked${o.stacked != null ? `, ${o.stacked} missile${o.stacked === 1 ? "" : "s"}` : ""}`);
  return a.join("; ");
}
/** Email 2 (K3): the next day, only when the summary names the city. */
export function giftEmail2(o: Gift2) {
  const part = partOf(o), subject = "Your city made the battle summary", pre = ascii(`${cap(part)}. Read the summary and watch the replay.`);
  const shown = o.aimed.slice(0, 3), more = o.aimed.length - shown.length;
  const rowsTxt = shown.map(x => `${cap(art(x.name))} ${x.name} from ${x.from || "someone"}, with the word ${x.word.toUpperCase()}`);
  const footLine = "This is the last email about this bomb.";
  const td = (l: string, v: string) => `<tr><td style="padding:2px 16px 2px 0;color:#5F5C6B;white-space:nowrap" valign="top">${l}</td><td style="padding:2px 0">${v}</td></tr>`;
  const html = wrap(pre,
    `<p style="margin:0 0 14px">Hey ${esc(o.to)},</p><p style="margin:0 0 14px">Last night's battle is over. Your city was in the summary: <b>${esc(part)}</b>.</p>`
    + `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border-collapse:collapse;font:15px/1.5 ${F};color:#24222B">`
    + shown.map((x, i) => td(i ? "" : "Aimed at you", `${esc(cap(art(x.name)))} ${esc(x.name)} from ${esc(x.from || "someone")}, with the word <b style="font-family:${MONO}">${esc(x.word.toUpperCase())}</b>`)).join("")
    + (more > 0 ? td("", `and ${more} more`) : "")
    + td("Repairs", "Your city heals by noon today") + `</table>`
    + btn(o.post, "Read the summary")
    + `<p style="margin:0 0 22px;color:#5F5C6B;font-size:13.5px">You can watch every hit in the replay on the battle view.</p>`
    + foot(footLine, o.unsubArmory, o.unsubAll, o.postal)
    + `<img src="${esc(o.pixel)}" width="1" height="1" alt="" style="display:block;border:0">`);
  const text = ascii([`Hey ${o.to},`, "", `Last night's battle is over. Your city was in the summary: ${part}.`, "",
    ...rowsTxt.map((r, i) => (i ? "" : "Aimed at you: ") + r), ...(more > 0 ? [`and ${more} more`] : []), "Repairs: Your city heals by noon today", "",
    `Read the summary: ${o.post}`, "", "You can watch every hit in the replay on the battle view.", "", footText(footLine, o.unsubArmory, o.unsubAll, o.postal)].join("\n"));
  return { subject, pre, html, text };
}
