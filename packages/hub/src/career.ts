/**
 * Free career evaluation (Mike 2026-11-01: offer something free before asking for a sign-up). /gh/<login>/career reads
 * only the public city data: languages, commit activity, recency, descriptions, live sites. Rules, no AI, no score of
 * the person, and every line is a count we can show. Not for search engines: anyone can look up anyone.
 */
import type { CityData, CityRepo } from "../../../../caldera/packages/plugin/src/city";

const ROLES: [RegExp, string][] = [
  [/^(typescript|javascript|html|css|vue|svelte|astro)$/i, "Frontend or full-stack engineer"],
  [/^(python|jupyter notebook|r)$/i, "Backend, data or machine learning engineer"],
  [/^(go|rust|c|c\+\+|zig)$/i, "Systems or infrastructure engineer"],
  [/^(swift|kotlin|dart|objective-c)$/i, "Mobile engineer"],
  [/^(java|c#|php|ruby|elixir|scala)$/i, "Backend engineer"],
  [/^(shell|hcl|dockerfile|nix)$/i, "DevOps or platform engineer"],
  [/^solidity$/i, "Smart contract engineer"],
];
const DAY = 86_400_000;

export interface CareerEval { repos: number; commits: number; activeWeeks: number; recent: number; languages: string[]; roles: string[]; stands: string[]; next: string[] }

export function careerEval(city: CityData, now = Date.now()): CareerEval {
  const R: CityRepo[] = city.districts.flatMap(d => d.repos).filter(r => !r.locked && r.public !== false && r.kind === undefined);
  const commits = R.reduce((a, r) => a + (r.commits || 0), 0);
  const weeks = new Array(52).fill(0);
  for (const r of R) (r.weeks || []).slice(-52).forEach((n, i, w) => { weeks[52 - w.length + i] += n || 0; });
  const activeWeeks = weeks.filter(n => n > 0).length;
  const byLang = new Map<string, number>();
  for (const r of R) if (r.language) byLang.set(r.language, (byLang.get(r.language) || 0) + (r.commits || 0) + 1);
  const languages = [...byLang.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const roles: string[] = [];
  for (const l of languages) { const m = ROLES.find(([rx]) => rx.test(l)); if (m && !roles.includes(m[1])) roles.push(m[1]); if (roles.length === 3) break; }
  const recent = R.filter(r => r.pushed && now - Date.parse(r.pushed) < 90 * DAY).length;
  const top = [...R].sort((a, b) => (b.commits || 0) - (a.commits || 0))[0];
  const described = R.filter(r => r.description).length, sites = R.filter(r => r.sites?.length).length;
  const n = (x: number, w: string) => `${x.toLocaleString("en-US")} ${w}${x === 1 ? "" : "s"}`;
  const stands: string[] = [], next: string[] = [];
  if (activeWeeks >= 26) stands.push(`Steady work: commits in ${activeWeeks} of the last 52 weeks.`);
  if (top && (top.commits || 0) >= 100) stands.push(`Depth: ${n(top.commits, "commit")} on ${top.name} in the last year.`);
  if (languages.length >= 3) stands.push(`Range: public work in ${languages.length} languages, led by ${languages.slice(0, 3).join(", ")}.`);
  if (recent >= 3) stands.push(`Current: ${n(recent, "repo")} pushed in the last 90 days.`);
  if (sites) stands.push(`Shipping: ${n(sites, "repo")} linked to a live site.`);
  if (!recent) next.push("Push something public this month. Recent activity is the first thing people check.");
  if (R.length && described < R.length) next.push(`Add a one-line description to ${n(R.length - described, "repo")}, so people can see what each one does.`);
  if (R.length && !sites) next.push("Link a live demo from your best repo. A working site says more than a code listing.");
  if (languages.length === 1) next.push(`Your public work is all ${languages[0]}. One project in a second language shows range, if you want roles beyond it.`);
  if (activeWeeks < 26 && commits > 0) next.push("Small, regular commits show steady work better than occasional bursts.");
  return { repos: R.length, commits, activeWeeks, recent, languages: languages.slice(0, 5), roles, stands: stands.slice(0, 4), next: next.slice(0, 3) };
}
