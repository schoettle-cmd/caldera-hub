// SEO / AI-answer pages (scripts/seo-pages.mjs): every related link resolves, slugs are unique, and pages that carry their
// own "updated" date (written to the 2026-11 GEO brief) keep the brief's limits: title <= 60, description <= 155,
// 3 to 5 FAQ entries, no em or en dashes, a valid date.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pages, UPDATED } from "../../../scripts/seo-pages.mjs";

test("seo pages: unique slugs and every related slug exists", () => {
  const slugs = pages.map(p => p.slug);
  assert.equal(new Set(slugs).size, slugs.length, "duplicate slug");
  for (const p of pages) for (const r of p.related) assert.ok(slugs.includes(r), `${p.slug} links to missing ${r}`);
  assert.match(UPDATED, /^\d{4}-\d{2}-\d{2}$/);
});

test("seo pages with their own date follow the GEO brief limits", () => {
  const dated = pages.filter(p => p.updated);
  assert.ok(dated.length >= 3);
  for (const p of dated) {
    assert.match(p.updated, /^\d{4}-\d{2}-\d{2}$/, p.slug);
    assert.ok(p.title.length <= 60, `${p.slug} title ${p.title.length}`);
    assert.ok(p.description.length <= 155, `${p.slug} description ${p.description.length}`);
    assert.ok(p.faq.length >= 3 && p.faq.length <= 5, `${p.slug} faq count`);
    const text = JSON.stringify(p);
    assert.doesNotMatch(text, /[–—]/, `${p.slug} has an em or en dash`);
    assert.ok(p.related.length >= 2 && p.related.length <= 4, `${p.slug} related count`);
  }
});

test("each dated page is linked from at least one other page", () => {
  for (const p of pages.filter(x => x.updated))
    assert.ok(pages.some(o => o.slug !== p.slug && o.related.includes(p.slug)), `${p.slug} has no inbound related link`);
});
