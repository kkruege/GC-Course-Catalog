// Weekly scrape: builds docs/data/courses.json for the website.
//   node scraper/scrape.mjs            (all programs)
//   node scraper/scrape.mjs ENGL-GRD   (only some programs, for testing)
//   BROWSER_CHANNEL=chrome npm run scrape   (use your installed Chrome or Edge ("msedge")
//                                            instead of downloading Playwright's Chromium)
//   node scraper/scrape.mjs --saved [folder]   (read department pages from .html files saved by hand,
//                                            default folder saved-pages/; see saved-pages/CHECKLIST.md.
//                                            The GC catalog and Google Sheets are still read online.)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { scrapeCatalog } from './catalog.mjs';
import { readPages, readSheet } from './pages.mjs';
import { TERM, OVERRIDES, CONCENTRATIONS, EXTRA_LINKS, GUESS_PATHS, CLASS_URL } from './sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/data/courses.json');
const DEBUG = path.join(ROOT, 'debug');
const args = process.argv.slice(2);
const savedAt = args.indexOf('--saved');
const SAVED = savedAt < 0 ? null : path.resolve(ROOT, args[savedAt + 1] && !/-GRD$|-CONC$/.test(args[savedAt + 1]) ? args[savedAt + 1] : 'saved-pages');
const only = args.filter((a, i) => a !== '--saved' && !(savedAt >= 0 && i === savedAt + 1 && path.resolve(ROOT, a) === SAVED));
// Saved page files, keyed by program code as a file name ("C L-GRD" -> "c_l-grd"), any letter case.
const savedFiles = new Map();
if (SAVED) for (const f of fs.readdirSync(SAVED)) if (/\.html?$/i.test(f)) savedFiles.set(f.replace(/\.html?$/i, '').toLowerCase(), path.join(SAVED, f));
const savedKey = code => code.replace(/\s+/g, '_').toLowerCase();
const log = (...a) => console.log(...a);

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { programs: [] };
const prevByCode = new Map(previous.programs.map(p => [p.code, p]));

const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
const catalog = await scrapeCatalog(browser, log);
log(`catalog: ${catalog.length} departments, ${catalog.reduce((n, d) => n + d.courses.length, 0)} courses`);
// If the catalog did not answer, the program list would be empty and every program would be dropped
// from the output. Stop instead and keep last week's data.
if (!catalog.length && previous.programs.length) {
  log('catalog returned no departments; leaving docs/data/courses.json unchanged');
  await browser.close();
  process.exit(1);
}

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
const results = new Map();
const PER_PROGRAM_MS = 4 * 60 * 1000;   // give up on a program after 4 minutes
const PARALLEL = 4;                     // programs read at the same time

async function readProgram(p) {
  if (p.sheet) { const r = await readSheet(p.sheet); r.url = p.sheet; return r; }
  if (SAVED) return readSaved(p);
  let urls = p.pages || [];
  if (!urls.length && p.site) urls = GUESS_PATHS.map(s => p.site.replace(/\/$/, '') + s);
  if (!urls.length) return { status: 'unknown', sections: [], note: 'no department course page known', raw: '' };
  const subject = p.code.replace(/-(GRD|CONC)$/, '');
  if (p.pages) return readPages(browser, urls, log, { subject });
  // Guessed pages: stop at the first one that loads and is not a 404.
  let r;
  for (const u of urls) { r = await readPages(browser, [u], log, { subject }); if (r.status !== 'unavailable' || /blocked/.test(r.note)) break; }
  return r;
}

/** Read a program's page from its saved .html file instead of the live site. */
async function readSaved(p) {
  const file = savedFiles.get(savedKey(p.code));
  if (!file) return { status: 'unavailable', sections: [], note: 'page not saved yet', raw: '' };
  const html = fs.readFileSync(file, 'utf8');
  // The page's own address, recorded in the saved file, so course links still point at gc.cuny.edu.
  const url = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || p.pages?.[0] || p.site || '';
  // A file saved under the wrong name (e.g. the Digital Humanities page saved as ENGL-GRD.html)
  // would put one program's courses under another. Skip it when the page belongs to another program.
  const key = u => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '');
  const owner = programs.find(o => o.code !== p.code && (o.pages || []).some(u => key(u) === key(url)));
  if (owner) return { status: 'unavailable', sections: [], note: `${path.basename(file)} is the ${owner.name} page; save this program's own page`, raw: '' };
  const r = await readPages(browser, [url], log, { files: { [url]: file }, subject: p.code.replace(/-(GRD|CONC)$/, '') });
  r.savedAt = fs.statSync(file).mtime.toISOString();
  if (r.status === 'unavailable') r.note = `saved file ${path.basename(file)} could not be read`;
  return r;
}

async function handle(p) {
  const t0 = Date.now();
  let timer;
  const r = await Promise.race([
    readProgram(p).catch(e => ({ status: 'unavailable', sections: [], note: `error: ${e.message.split('\n')[0]}`, raw: '' })),
    new Promise(res => { timer = setTimeout(() => res({ status: 'unavailable', sections: [], note: 'timed out', raw: '' }), PER_PROGRAM_MS); }),
  ]);
  clearTimeout(timer);
  fs.writeFileSync(path.join(DEBUG, `${p.code.replace(/\W+/g, '_')}.txt`), `${r.url || ''}\nstatus: ${r.status} ${r.note || ''}\n\n${r.raw || ''}`.slice(0, 300000));
  const prev = prevByCode.get(p.code);
  let entry;
  // If a source could not be reached this week, keep last week's courses rather than wiping them.
  if ((r.status === 'unavailable' || r.status === 'unknown') && prev?.sections?.length) entry = { ...prev, stale: true, note: r.note };
  else entry = {
    code: p.code, name: p.name, kind: p.kind, status: r.status, note: r.note || '',
    source: r.url || p.site || '', site: p.site || '', catalogUrl: p.catalogUrl || '',
    checked: r.savedAt || new Date().toISOString(), ...(r.savedAt ? { savedPage: true } : {}), sections: r.sections.map(s => fillFromCatalog(s)),
  };
  results.set(p.code, entry);
  log(`${p.code} ${p.name}: ${entry.status}${entry.stale ? ' (kept last week)' : ''}, ${entry.sections.length} sections ${r.note || ''} [${Math.round((Date.now() - t0) / 1000)}s]`);
  writeOutput(); // save progress after every program, so a cut-off run still keeps what it found
}

// Programs not being re-read keep their previous data.
for (const p of programs) if (only.length && !only.includes(p.code) && prevByCode.has(p.code)) results.set(p.code, prevByCode.get(p.code));
const todo = programs.filter(p => !only.length || only.includes(p.code));
await Promise.all(Array.from({ length: PARALLEL }, async () => { while (todo.length) await handle(todo.shift()); }));
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

function writeOutput() {
  const list = [...results.values()].sort((a, b) => a.name.localeCompare(b.name));
  const data = { term: TERM.name, generated: new Date().toISOString(), classUrl: CLASS_URL, extraLinks: EXTRA_LINKS, programs: list };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1));
  return list;
}
const final = writeOutput();
const n = s => final.filter(p => p.status === s).length;
log(`\nwrote ${OUT}: ${final.reduce((k, p) => k + p.sections.length, 0)} sections; posted ${n('posted')}, not posted ${n('not_posted')}, unparsed ${n('unparsed')}, unavailable ${n('unavailable') + n('unknown')}`);
