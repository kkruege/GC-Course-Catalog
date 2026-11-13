// Reads a department's course web page (or Google Sheet / Doc) and returns Spring 2027 sections.
import { TERM } from './sources.mjs';
import { parseCSV, parseTable, parseCourseBlocks, termSegment, clean } from './parse.mjs';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export function sheetCsvUrl(url) {
  const id = (url.match(/spreadsheets\/d\/([\w-]+)/) || [])[1];
  if (!id) return null;
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`;
}

export async function readSheet(url) {
  const csvUrl = sheetCsvUrl(url);
  let r;
  try { r = await fetch(csvUrl, { headers: { 'user-agent': UA } }); }
  catch (e) { return { status: 'unavailable', note: `Google Sheet could not be reached (${e.cause?.code || e.message})`, sections: [], raw: '' }; }
  if (!r.ok) return { status: 'unavailable', note: `Google Sheet returned HTTP ${r.status} (is it shared publicly?)`, sections: [], raw: '' };
  const text = await r.text();
  if (/^\s*<!doctype html/i.test(text)) return { status: 'unavailable', note: 'Google Sheet is not public', sections: [], raw: '' };
  const sections = parseTable(parseCSV(text), url);
  return { status: sections.length ? 'posted' : 'unparsed', sections, raw: text };
}

async function readGoogleDoc(url) {
  const id = (url.match(/document\/d\/([\w-]+)/) || [])[1];
  const r = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, { headers: { 'user-agent': UA } }).catch(() => null);
  if (!r?.ok) return null;
  return await r.text();
}

/** Load a web page in the browser, open collapsed sections, and return text + tables + links. */
async function loadPage(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const status = resp ? resp.status() : 0;
  const title = await page.title().catch(() => '');
  if (status >= 400 || /attention required|just a moment|captcha|access denied/i.test(title)) {
    return { blocked: status === 403 || /attention|moment|captcha|denied/i.test(title), status, title };
  }
  // Open accordions / tabs so hidden course text is included.
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach(d => (d.open = true));
    document.querySelectorAll('[aria-expanded="false"]').forEach(b => { try { b.click(); } catch {} });
    document.querySelectorAll('.collapse, .accordion-content, [hidden]').forEach(e => { e.style.display = 'block'; e.hidden = false; });
  }).catch(() => {});
  await page.waitForTimeout(800);
  return await page.evaluate(() => {
    const root = document.querySelector('main, #main-content, [role=main], article, .region-content') || document.body;
    root.querySelectorAll('nav, header, footer, script, style, noscript').forEach(e => e.remove());
    const tables = [...root.querySelectorAll('table')].map(t => [...t.rows].map(r => [...r.cells].map(c => c.innerText)));
    const links = [...root.querySelectorAll('a[href]')].map(a => ({ text: a.innerText.trim(), href: a.href }));
    return { text: root.innerText, tables, links, status: 200 };
  });
}

/**
 * Scrape one or more course pages for a program.
 * Returns { status: 'posted'|'not_posted'|'unparsed'|'unavailable', sections, note, raw, url }
 */
export async function readPages(browser, urls, log = console.log) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  const raws = [];
  let anyLoaded = false, sawTerm = false, blockedNote = '';
  const sections = [];
  const seen = new Set();
  const queue = urls.map(u => ({ url: u, depth: 0 }));
  try {
    while (queue.length) {
      const { url, depth } = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      if (/docs\.google\.com\/spreadsheets/.test(url)) {
        const r = await readSheet(url);
        raws.push(`### ${url}\n${r.raw.slice(0, 20000)}`);
        if (r.status === 'posted') { anyLoaded = sawTerm = true; sections.push(...r.sections); }
        continue;
      }
      if (/docs\.google\.com\/document/.test(url)) {
        const t = await readGoogleDoc(url);
        if (t) {
          anyLoaded = true; raws.push(`### ${url}\n${t}`);
          const seg = termSegment(t) ?? (depth > 0 ? t : null);
          if (seg != null) { sawTerm = true; sections.push(...parseCourseBlocks(seg, url)); }
        }
        continue;
      }
      if (/\.pdf($|\?)/i.test(url)) { raws.push(`### ${url}\n(PDF not read)`); continue; }
      let r;
      try { r = await loadPage(page, url); } catch (e) { log(`  ! ${url}: ${e.message.split('\n')[0]}`); continue; }
      if (r.blocked || r.status >= 400) { blockedNote = `${new URL(url).host} returned ${r.status}${r.blocked ? ' (blocked by site security)' : ''}`; log(`  ! ${url}: ${blockedNote}`); continue; }
      anyLoaded = true;
      raws.push(`### ${url}\n${r.text}\n${r.tables.map(t => t.map(row => row.join(' | ')).join('\n')).join('\n\n')}`);

      // Pages reached by following a "Spring 2027" link are entirely about that term.
      const seg = termSegment(r.text) ?? (depth > 0 ? clean(r.text) : null);
      if (seg != null) sawTerm = true;

      // Tables: use tables that sit inside the Spring 2027 part (or any table on a term page).
      // (Table text is part of the page text, so a table course belongs to Spring 2027
      // when its code appears inside the Spring 2027 segment.)
      if (seg != null) for (const t of r.tables)
        sections.push(...parseTable(t, url).filter(s => seg.includes(s.code.split(' ').pop())));
      if (seg != null && !sections.length) sections.push(...parseCourseBlocks(seg, url));

      // Follow links that point at Spring 2027 listings.
      if (depth < 1) for (const l of r.links.slice(0, 400)) {
        if (queue.length >= 6) break;
        if (TERM.match.test(l.text) || TERM.match.test(decodeURIComponent(l.href)) || (/spring/i.test(l.text) && /course|schedule|class/i.test(l.text) && /2027|27/.test(l.href))) {
          if (!seen.has(l.href)) queue.push({ url: l.href, depth: depth + 1 });
        }
      }
    }
  } finally { await ctx.close(); }

  const dedup = dedupe(sections);
  let status;
  if (dedup.length) status = 'posted';
  else if (!anyLoaded) status = 'unavailable';
  else if (sawTerm) status = 'unparsed';
  else status = 'not_posted';
  return { status, sections: dedup, note: status === 'unavailable' ? blockedNote || 'page could not be loaded' : '', raw: raws.join('\n\n'), url: urls[0] };
}

function dedupe(list) {
  const m = new Map();
  for (const s of list) {
    const k = [s.code, s.section, s.professor, s.schedule?.text, s.topic].join('|').toLowerCase();
    if (!m.has(k)) m.set(k, s);
  }
  return [...m.values()];
}
