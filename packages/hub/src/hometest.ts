/**
 * Homepage message test "home2" (Mike, 2026-10-30: "we need way more options there, create 10 versions of language and
 * let's run them all", goal: at least 5% of homepage visitors sign up). Replaces home1 (2 arms, 2026-10-29; no signal
 * after 423 views). Ten arms, a tenth of visitors each. Arm "a" = the homepage as it is (control); every other arm swaps
 * only the eyebrow, the headline and the lead line (arm "b" = home1's showcase, which also swaps the how-it-works
 * wording). Title, meta, structured data, the "Show my city" box, the buttons and every sign-up path stay identical, so
 * the test measures the message alone. Every claim is a feature that ships today. Crawlers always get control.
 *
 * The arm comes from the funnel's one-day visitor hash, and the view is recorded as step "h2-<arm>", so every later
 * funnel step that day (preview, click, created, email-created...) can be split by arm with a join on (day, vid).
 * No cookie. If a swap target is missing (the homepage was edited), the visitor gets control and the miss is logged once.
 */
import crypto from "node:crypto";

export const HOME_TEST = "home2";

const EYEBROW = '<div class="eyebrow">Free and open source / GitHub + Obsidian</div>';
const H1 = "<h1>The social network for GitHub and Obsidian.</h1>";
const LEAD = '<p class="lead">Your repos become a <b>living city</b>. Your vault becomes a <b>living profile</b>. Meet people by what they build and what they write.</p>';
const hero = (eyebrow: string, h1: string, lead: string): [string, string][] =>
  [[EYEBROW, `<div class="eyebrow">${eyebrow}</div>`], [H1, `<h1>${h1}</h1>`], [LEAD, `<p class="lead">${lead}</p>`]];

/** arm -> swaps on the control page ("a" has none) */
export const HOME_ARMS: Record<string, [string, string][]> = {
  a: [],
  b: [...hero("Free and open source / for developers", "Show your work as a living city.",
        "Your GitHub repos become a <b>city you can share</b>: districts are projects, buildings are repos, lit windows are this week's commits. Build yours in 30 seconds, then <b>meet developers</b> by what they build."),
      ['<h2 id="doors-h">Two doors, one network.</h2>', '<h2 id="doors-h">Build your city, two ways.</h2>'],
      ["<li><b>Meet people.</b> Add friends, join a group, and get a daily summary by email.</li>",
        "<li><b>Meet developers.</b> Find people by what they build, add friends, start a group, and get a daily summary by email.</li>"]],
  c: hero("Free / 30 seconds / no install", "Your GitHub, as a city.",
        "Type your username and watch your repos rise: <b>districts are projects</b>, <b>buildings are repos</b>, lit windows are this week's commits."),
  d: hero("Free and open source / for developers", "A portfolio that builds itself from your GitHub.",
        "Caldera turns your repos into a <b>live 3D city</b> and a profile page that rebuilds from GitHub every 6 hours. Share one link that is always up to date."),
  e: hero("Free and open source / for AI builders", "Watch your AI agents build, live.",
        "Coding agents show up as <b>drones over the repo</b> they are working in, your commits light the windows, and your site's visitors parachute in. Your GitHub as a <b>living city</b>."),
  f: hero("Free and open source / for developers", "Meet developers by what they actually build.",
        "Every profile is built from <b>real work</b>: repos, commits and notes, not a résumé. Browse people, add friends and <b>message them directly</b>."),
  g: hero("Free / one README badge", "Your contribution graph, but 3D and alive.",
        "Caldera turns your GitHub into a city: every repo a building, every commit a lit window. <b>Put it on your profile README</b> with one badge."),
  h: hero("Free / no sign-up to look", "What does your code look like as a city?",
        "Enter your GitHub username to find out. <b>Districts are projects</b>, buildings are repos, and lit windows are this week's commits."),
  i: hero("Free and open source / build in public", "Build in public without writing a single post.",
        "Your commits and repos become a <b>living city</b> and a page people can follow. Caldera keeps it current from GitHub, so you just <b>keep building</b>."),
  j: hero("Free and open source / GitHub + Obsidian", "Your code and your notes, one living profile.",
        "Connect GitHub and your repos become a <b>city</b>. Add the Obsidian plugin and your vault becomes a <b>profile you control</b>: nothing leaves it unless you choose."),
};
export const ARM_IDS = Object.keys(HOME_ARMS);

let warned = false;
/** this visitor's arm today ("a".."j"); vid = the funnel's visitor hash */
export const homeArm = (vid: string): string => ARM_IDS[crypto.createHash("sha256").update(HOME_TEST + "|" + vid).digest().readUInt32BE(0) % ARM_IDS.length]!;

/** the homepage for this arm, or null for control (arm "a", or the page no longer has every swap target) */
export function armHome(html: string, arm: string): string | null {
  const swaps = HOME_ARMS[arm]; if (!swaps || !swaps.length) return null;
  let out = html;
  for (const [from, to] of swaps) {
    if (!out.includes(from)) { if (!warned) { warned = true; console.error("home2: swap target missing, serving control:", from.slice(0, 60)); } return null; }
    out = out.replace(from, to);
  }
  return out;
}

/** preview "save my city" A/B (save1): independent of home1 (different salt), same one-day visitor hash */
export const SAVE_TEST = "save1";
export const saveArm = (vid: string): "a" | "b" => (crypto.createHash("sha256").update(SAVE_TEST + "|" + vid).digest()[0]! & 1 ? "b" : "a");
