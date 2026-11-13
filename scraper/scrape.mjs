// Weekly scrape: builds docs/data/courses.json for the website.
//   node scraper/scrape.mjs            (all programs)
//   node scraper/scrape.mjs ENGL-GRD   (only some programs, for testing)
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { scrapeCatalog } from './catalog.mjs';
import { readPages, readSheet } from './pages.mjs';
import { TERM, OVERRIDES, CONCENTRATIONS, EXTRA_LINKS, GUESS_PATHS, CLASS_URL } from './sources.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'docs/data/courses.json');
const DEBUG = path.join(ROOT, 'debug');
const only = process.argv.slice(2);
const log = (...a) => console.log(...a);

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { programs: [] };
const prevByCode = new Map(previous.programs.map(p => [p.code, p]));

const browser = await chromium.launch();
const catalog = await scrapeCatalog(browser, () => {});
log(`catalog: ${catalog.length} departments, ${catalog.reduce((n, d) => n + d.courses.length, 0)} courses`);

// Course code -> catalog entry (for filling in missing descriptions/titles/credits).
const catalogCourse = new Map();
for (const d of catalog) for (const c of d.courses) if (!catalogCourse.has(c.code)) catalogCourse.set(c.code, c);

const isCert = d => /CP-GRD$/.test(d.code) || (d.programs.length > 0 && d.programs.every(p => /CERT/i.test(p.degree)));

const programs = [
  ...catalog.map(d => ({
    code: d.code, name: d.name, kind: isCert(d) ? 'certificate' : 'department',
    site: d.site, catalogUrl: `https://gc.catalog.cuny.edu/departments/${encodeURIComponent(d.code)}/courses`,
    ...OVERRIDES[d.code],
  })),
  ...CONCENTRATIONS,
];

fs.mkdirSync(DEBUG, { recursive: true });
const results = [];
for (const p of programs) {
  if (only.length && !only.includes(p.code)) { if (prevByCode.has(p.code)) results.push(prevByCode.get(p.code)); continue; }
  log(`\n== ${p.name} (${p.code})`);
  let r;
  if (p.sheet) {
    r = await readSheet(p.sheet);
    r.url = p.sheet;
  } else {
    let urls = p.pages || [];
    if (!urls.length && p.site) urls = GUESS_PATHS.map(s => p.site.replace(/\/$/, '') + s);
    if (!urls.length) r = { status: 'unknown', sections: [], note: 'no department course page known', raw: '' };
    else if (p.pages) r = await readPages(browser, urls, log);
    else {
      // Guessed pages: stop at the first one that loads and is not a 404.
      for (const u of urls) { r = await readPages(browser, [u], log); if (r.status !== 'unavailable' || /blocked/.test(r.note)) break; }
    }
  }
  fs.writeFileSync(path.join(DEBUG, `${p.code.replace(/\W+/g, '_')}.txt`), `${r.url || ''}\nstatus: ${r.status} ${r.note || ''}\n\n${r.raw || ''}`.slice(0, 300000));

  const prev = prevByCode.get(p.code);
  // If a source could not be reached this week, keep last week's courses rather than wiping them.
  if ((r.status === 'unavailable' || r.status === 'unknown') && prev?.sections?.length) {
    log(`  kept ${prev.sections.length} sections from ${prev.checked}`);
    results.push({ ...prev, stale: true, note: r.note });
    continue;
  }
  const sections = r.sections.map(s => fillFromCatalog(s));
  log(`  ${r.status}: ${sections.length} sections ${r.note || ''}`);
  results.push({
    code: p.code, name: p.name, kind: p.kind, status: r.status, note: r.note || '',
    source: r.url || p.site || '', site: p.site || '', catalogUrl: p.catalogUrl || '',
    checked: new Date().toISOString(), sections,
  });
}
await browser.close();

function fillFromCatalog(s) {
  const c = catalogCourse.get(s.code);
  const filled = [];
  const out = { ...s, schedule: s.schedule || { text: '', days: [], start: '', end: '' } };
  // A short "description" (e.g. "Psych BCN students only") is really a note.
  if (out.description && out.description.length < 160 && !/\.\s+\S/.test(out.description)) {
    out.notes = [out.notes, out.description].filter(Boolean).join(' · ');
    out.description = '';
  }
  if (c) {
    const realDesc = c.description && c.description.toLowerCase() !== c.title.toLowerCase() && c.description.length > 40;
    if (!out.description && realDesc) { out.description = c.description; filled.push('description'); }
    if (!out.title) { out.title = c.title; filled.push('title'); }
    if (!out.credits && c.credits) { out.credits = c.credits; filled.push('credits'); }
    out.catalogTitle = c.title;
  }
  out.filled = filled;
  return out;
}

const data = {
  term: TERM.name,
  generated: new Date().toISOString(),
  classUrl: CLASS_URL,
  extraLinks: EXTRA_LINKS,
  programs: results.sort((a, b) => a.name.localeCompare(b.name)),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data, null, 1));
const n = s => results.filter(p => p.status === s).length;
log(`\nwrote ${OUT}: ${results.reduce((k, p) => k + p.sections.length, 0)} sections; posted ${n('posted')}, not posted ${n('not_posted')}, unparsed ${n('unparsed')}, unavailable ${n('unavailable') + n('unknown')}`);
