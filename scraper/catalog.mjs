// Reads the public GC Coursedog catalog (gc.catalog.cuny.edu) by loading its own
// pages in a browser and keeping the data those pages load.
import { chromium } from 'playwright';

const BASE = 'https://gc.catalog.cuny.edu';
const strip = (h = '') => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export async function scrapeCatalog(browser, log = console.log) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/departments`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const depts = await page.$$eval('a[href^="/departments/"][href$="/overview"]', as =>
    [...new Map(as.map(a => [a.getAttribute('href'), a.textContent.trim()])).entries()]
      .map(([href, name]) => ({ code: decodeURIComponent(href.split('/')[2]), name })));
  log(`catalog: ${depts.length} departments`);

  const out = [];
  for (const d of depts) {
    // Stop early if the catalog is not answering at all (first 3 departments empty).
    if (out.length === 3 && out.every(x => !x.courses.length && !x.programs.length)) { log('catalog: not answering, skipping the rest'); out.push(...depts.slice(3).map(x => ({ ...x, site: '', programs: [], courses: [] }))); break; }
    const got = {};
    const onResp = async r => {
      const u = r.url();
      try {
        if (u.includes('/courses/search/')) got.courses = await r.json();
        else if (u.includes('/programs/search/')) got.programs = await r.json();
        else if (u.includes(`/catalogPages/`) && u.includes(`department-`)) got.pageInfo = await r.json();
      } catch {}
    };
    page.on('response', onResp);
    try {
      // Wait only for the course list request, not for the whole page to go quiet.
      const coursesLoaded = page.waitForResponse(r => r.url().includes('/courses/search/'), { timeout: 25000 }).catch(() => null);
      await page.goto(`${BASE}/departments/${encodeURIComponent(d.code)}/courses`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await coursesLoaded;
      await page.waitForTimeout(700);
    } catch (e) { log(`catalog: ${d.code} load problem: ${e.message.split('\n')[0]}`); }
    page.off('response', onResp);

    const programs = (got.programs?.data || []).map(p => ({
      name: p.catalogDisplayName || p.name, degree: p.degreeDesignation || '', code: p.code,
    }));
    const content = got.pageInfo?.content || '';
    const site = (content.match(/href="(https?:\/\/(?:www\.)?gc\.cuny\.edu\/[^"#?]+)"/i) || [])[1] || '';
    const courses = (got.courses?.data || []).map(c => ({
      code: (c.code || `${c.subjectCode} ${c.courseNumber}`).replace(/\s+/g, ' ').trim(),
      title: c.longName || c.catalogDisplayName || c.name || '',
      description: strip(c.description || c.catalogDescription || ''),
      credits: c.credits?.creditHours ? fmtCredits(c.credits.creditHours) : '',
    }));
    out.push({ ...d, site, programs, courses });
    log(`catalog: ${d.code} ${d.name}: ${courses.length} courses, ${programs.length} programs ${site}`);
  }
  await page.close();
  return out;
}

function fmtCredits(ch) {
  if (ch.min != null && ch.max != null && ch.min !== ch.max) return `${ch.min}–${ch.max}`;
  return String(ch.value ?? ch.max ?? ch.min ?? '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('fs');
  const b = await chromium.launch();
  const data = await scrapeCatalog(b);
  fs.writeFileSync(process.argv[2] || 'catalog.json', JSON.stringify(data, null, 1));
  await b.close();
}
