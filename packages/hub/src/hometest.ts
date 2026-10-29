/**
 * Homepage message A/B "home1" (Mike, 2026-10-29: lead with showcasing your work, building your city and meeting
 * developers, not "the social network"). Control = the homepage as it is. "showcase" swaps only the hero and the
 * how-it-works wording; title, meta, structured data, buttons and every sign-up path stay identical, so the test
 * measures the message alone. Crawlers always get control (SEO sees one page).
 *
 * The arm comes from the funnel's one-day visitor hash, and the view is recorded as step "home-a" / "home-b", so every
 * later funnel step that day (preview, click, created...) can be split by arm with a join on (day, vid). No cookie.
 * If a swap target is missing (the homepage was edited), the visitor gets control and the miss is logged once.
 */
import crypto from "node:crypto";

export const HOME_TEST = "home1";

const SWAPS: [string, string][] = [
  ['<div class="eyebrow">Free and open source / GitHub + Obsidian</div>', '<div class="eyebrow">Free and open source / for developers</div>'],
  ["<h1>The social network for GitHub and Obsidian.</h1>", "<h1>Show your work as a living city.</h1>"],
  ['<p class="lead">Your repos become a <b>living city</b>. Your vault becomes a <b>living profile</b>. Meet people by what they build and what they write.</p>',
    '<p class="lead">Your GitHub repos become a <b>city you can share</b>: districts are projects, buildings are repos, lit windows are this week\'s commits. Build yours in 30 seconds, then <b>meet developers</b> by what they build.</p>'],
  ['<h2 id="doors-h">Two doors, one network.</h2>', '<h2 id="doors-h">Build your city, two ways.</h2>'],
  ["<li><b>Meet people.</b> Add friends, join a group, and get a daily summary by email.</li>",
    "<li><b>Meet developers.</b> Find people by what they build, add friends, start a group, and get a daily summary by email.</li>"],
];

let warned = false;
/** "a" (control) or "b" (showcase) for this visitor today; vid = the funnel's visitor hash */
export const homeArm = (vid: string): "a" | "b" => (crypto.createHash("sha256").update(HOME_TEST + "|" + vid).digest()[0]! & 1 ? "b" : "a");

/** the showcase homepage, or null when the page no longer has every swap target (serve control) */
export function showcaseHome(html: string): string | null {
  let out = html;
  for (const [from, to] of SWAPS) {
    if (!out.includes(from)) { if (!warned) { warned = true; console.error("home1: swap target missing, serving control:", from.slice(0, 60)); } return null; }
    out = out.replace(from, to);
  }
  return out;
}
