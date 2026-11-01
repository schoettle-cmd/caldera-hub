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

export interface CareerEval { repos: number; commits: number; activeWeeks: number; span: number; recent: number; languages: string[]; style: { name: string; line: string }; roles: { role: string; why: string }[]; proof: string[]; next: string[] }

/** One named style from the same counts, first match wins. Every style is a strength; none ranks a person. */
function styleOf(o: { repos: number; recent: number; sites: number; langs: number; topShare: number; activeWeeks: number; span: number }): { name: string; line: string } {
  if (o.sites >= 2) return { name: "Product Builder", line: "Code that ends up live, on sites people can open." };
  if (o.repos >= 8 && o.topShare >= 0.5) return { name: "Deep Specialist", line: "Most of the work goes into one project, and it goes deep." };
  if (o.repos >= 20 && o.recent >= 5) return { name: "Toolmaker", line: "Lots of focused projects, kept moving." };
  if (o.langs >= 4) return { name: "Polyglot", line: "Comfortable across languages, picking the right one for the job." };
  if (o.span && o.activeWeeks >= o.span * 0.75) return { name: "Steady Maintainer", line: "Commits week after week, the habit that keeps projects alive." };
  return { name: "Explorer", line: "Trying ideas in public and following what's interesting." };
}

export function careerEval(city: CityData, now = Date.now()): CareerEval {
  const R: CityRepo[] = city.districts.flatMap(d => d.repos).filter(r => !r.locked && r.public !== false && r.kind === undefined);
  const commits = R.reduce((a, r) => a + (r.commits || 0), 0);
  const span = Math.max(0, ...R.map(r => (r.weeks || []).length));   // the city keeps only its recent weeks, so say how many
  const weeks = new Array(span).fill(0);
  for (const r of R) (r.weeks || []).forEach((n, i, w) => { weeks[span - w.length + i] += n || 0; });
  const activeWeeks = weeks.filter(n => n > 0).length;
  const byLang = new Map<string, number>();
  for (const r of R) if (r.language && r.language !== "Other") byLang.set(r.language, (byLang.get(r.language) || 0) + (r.commits || 0) + 1);
  const languages = [...byLang.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const roles: { role: string; why: string }[] = [];
  languages.forEach((l, i) => { const m = ROLES.find(([rx]) => rx.test(l)); if (m && roles.length < 3 && !roles.some(r => r.role === m[1])) roles.push({ role: m[1], why: i === 0 ? `${l} leads your public work` : `You also work in ${l}` }); });
  const recent = R.filter(r => r.pushed && now - Date.parse(r.pushed) < 90 * DAY).length;
  const top = [...R].sort((a, b) => (b.commits || 0) - (a.commits || 0))[0];
  const described = R.filter(r => r.description).length, sites = R.filter(r => r.sites?.length).length;
  const n = (x: number, w: string) => `${x.toLocaleString("en-US")} ${w}${x === 1 ? "" : "s"}`;
  const proof: string[] = [], next: string[] = [];
  if (top && (top.commits || 0) >= 20) proof.push(`${n(top.commits, "commit")} on ${top.name} this year`);
  if (recent) proof.push(`${n(recent, "repo")} pushed in the last 90 days`);
  if (languages.length >= 2) proof.push(`Work in ${n(languages.length, "language")}`);
  if (sites) proof.push(`${n(sites, "repo")} linked to a live site`);
  if (!recent) next.push("Push something public this month");
  if (R.length && described < R.length) next.push(`Describe the ${n(R.length - described, "repo")} with no description`);
  if (R.length && !sites) next.push("Link a live demo from your best repo");
  if (languages.length === 1) next.push(`Add one project outside ${languages[0]}, if you want roles beyond it`);
  const style = styleOf({ repos: R.length, recent, sites, langs: languages.length, topShare: commits ? (top?.commits || 0) / commits : 0, activeWeeks, span });
  return { repos: R.length, commits, activeWeeks, span, recent, languages: languages.slice(0, 5), style, roles, proof: proof.slice(0, 4), next: next.slice(0, 3) };
}
