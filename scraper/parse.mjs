// Text parsing helpers shared by every source. No network access here, so it is easy to test.
import { TERM, OTHER_TERMS } from './sources.mjs';

export const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_WORDS = [
  ['Mon', /^(?:mon(?:day)?s?|mo|m)$/i],
  ['Tue', /^(?:tue(?:s(?:day)?)?s?|tu)$/i],
  ['Wed', /^(?:wed(?:nesday)?s?|we|w)$/i],
  ['Thu', /^(?:thu(?:r(?:s(?:day)?)?)?s?|th|r)$/i],
  ['Fri', /^(?:fri(?:day)?s?|fr|f)$/i],
  ['Sat', /^(?:sat(?:urday)?s?|sa)$/i],
  ['Sun', /^(?:sun(?:day)?s?|su)$/i],
];
const LONG_DAY = /\b(mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)\b\.?/gi;

function dayOf(tok) { for (const [d, re] of DAY_WORDS) if (re.test(tok)) return d; return null; }

/** Find weekdays in free text such as "Monday & Wednesday", "M/W", "TTh", "Monday–Friday". */
export function parseDays(text = '') {
  const s = text.replace(/\./g, '');
  const found = new Set();
  // Ranges: Monday–Friday
  const range = s.match(/\b([a-z]{2,9})\s*(?:-|–|—|to|through|thru)\s*([a-z]{2,9})\b/i);
  if (range) {
    const a = DAY_ORDER.indexOf(dayOf(range[1])), b = DAY_ORDER.indexOf(dayOf(range[2]));
    if (a >= 0 && b > a && /day|^[a-z]{3,4}$/i.test(range[1])) for (let i = a; i <= b; i++) found.add(DAY_ORDER[i]);
  }
  for (const m of s.matchAll(LONG_DAY)) { const d = dayOf(m[1]); if (d) found.add(d); }
  if (!found.size) {
    // Compact codes before a time: "MW 2-4", "TTh 6:30", "M/W"
    const m = s.match(/(?:^|\s)((?:M|Tu|T|W|Th|R|F|Sa|Su)(?:\s*[\/,&]?\s*(?:M|Tu|T|W|Th|R|F|Sa|Su))*)(?=\s*[,:]?\s*\d)/);
    if (m) for (const t of m[1].match(/Th|Tu|Sa|Su|M|T|W|R|F/g)) found.add(t === 'T' ? 'Tue' : dayOf(t));
  }
  return DAY_ORDER.filter(d => found.has(d));
}

const TIME_RANGE = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)?/i;

/** "2–4 PM" -> {start:'14:00', end:'16:00'}. Without am/pm, 1–8 is read as afternoon/evening. */
export function parseTimeRange(text = '') {
  const m = text.match(TIME_RANGE);
  if (!m) return null;
  let [, h1, m1 = '00', ap1, h2, m2 = '00', ap2] = m;
  h1 = +h1; h2 = +h2;
  if (h1 > 23 || h2 > 23 || +m1 > 59 || +m2 > 59) return null;
  const mer = a => a ? (/p|noon/i.test(a) ? ['pm'] : ['am']) : null;
  const to24 = (h, a) => (a === 'pm' ? (h % 12) + 12 : h % 12);
  // Try every am/pm reading allowed by the text; keep the first plausible class time.
  const e1 = mer(ap2) || ['pm', 'am'];
  let best = null;
  for (const a2 of e1) for (const a1 of mer(ap1) || [a2, a2 === 'pm' ? 'am' : 'pm']) {
    const s = to24(h1, a1) * 60 + +m1, e = to24(h2, a2) * 60 + +m2;
    if (e > s && e - s <= 6 * 60 && s >= 7 * 60 && e <= 23 * 60) { best = [s, e]; break; }
    if (best) break;
  }
  if (!best) return null;
  const [s, e] = best;
  const f = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  return { start: f(s), end: f(e) };
}

export function parseSchedule(text = '') {
  const t = clean(text);
  if (!t) return { text: '', days: [], start: '', end: '' };
  const tr = parseTimeRange(t) || {};
  return { text: t, days: parseDays(t), start: tr.start || '', end: tr.end || '' };
}

export function clean(s = '') { return String(s).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim(); }

export function parseMode(text = '') {
  if (/hybrid/i.test(text)) return 'Hybrid';
  if (/\b(online|remote|zoom|asynchronous|synchronous online|fully online)\b|\bO\s*\(/i.test(text)) return 'Online';
  if (/in[- ]person|\bP\s*\(|on[- ]campus/i.test(text)) return 'In person';
  return '';
}

// Course codes such as "ENGL 80500", "U ED 75100", "C L 80100", "PSYC 80103", "ANTH 70100-01".
export const CODE_RE = /\b([A-Z]{2,6}|U ED|C L|[A-Z] [A-Z]{1,3})\s?(\d{5})(?:\s*[-.]\s*(\d{1,3}))?\b/;
export function normCode(subj, num) { return `${subj.replace(/\s+/g, ' ').trim()} ${num}`; }

/** Cut out the Spring 2027 part of a page. Returns null when the page never mentions Spring 2027. */
export function termSegment(text) {
  const lines = clean(text).split('\n');
  const start = lines.findIndex(l => TERM.match.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    // A short line naming another term is treated as the next heading.
    if (l.length < 80 && OTHER_TERMS.test(l) && !TERM.match.test(l) && !CODE_RE.test(l)) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const PROF_RE = /(?:^|[\s,;(|])(?:Prof(?:essor)?s?\.?|Instructors?|Faculty|Taught by|Dr\.)\s*:?\s*([A-Z][^\n,;|()]*?(?:\s+(?:and|&)\s+(?:Prof(?:essor)?\.?\s*)?[A-Z][^\n,;|()]*?)*)(?=\s*(?:$|[\n,;|()]|\s{2}|\s(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|GC|Room|\d)))/;
const CREDITS_RE = /(\d(?:\.\d)?(?:\s*(?:-|–|\/|or|to)\s*\d)?)\s*(?:credits?|cr\b\.?)/i;
const ROOM_RE = /\b(?:Room|Rm\.?)\s*:?\s*([A-Z]?\d{3,4}(?:\.\d{1,2})?[A-Z]?|TBA|TBD)/i;
const CLASSNO_RE = /\b(?:Class\s*(?:No\.?|Number|#|Nbr)|CRN|Course\s*ID)\s*:?\s*#?(\d{4,6})/i;
const TIMELINE_RE = new RegExp(`(${LONG_DAY.source}|\\b(?:M|T|W|Th|R|F)(?:\\s*[\\/,&]\\s*(?:M|T|W|Th|R|F))+\\b)[^\\n]{0,40}?${TIME_RANGE.source}`, 'i');

/** Split free text into course blocks, each starting with a course code. */
export function parseCourseBlocks(text, sourceUrl) {
  const lines = clean(text).split('\n').filter(Boolean);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(CODE_RE);
    // A new course starts when a line begins with (or nearly begins with) a course code.
    if (m && m.index < 12) { cur = { head: line, m, body: [] }; blocks.push(cur); }
    else if (cur) cur.body.push(line);
  }
  return blocks.map(b => blockToSection(b, sourceUrl)).filter(Boolean);
}

function blockToSection({ head, m, body }, source) {
  const all = [head, ...body].join('\n');
  let title = head.slice(m.index + m[0].length).replace(/^\s*[-–—:|,.]\s*/, '').trim();
  // Title is text up to a field-looking part.
  title = title.split(/\s{2,}|\t|\s[|•]\s|(?=\s(?:Prof(?:essor)?\.?|Instructor|Mon|Tue|Wed|Thu|Fri|Sat)\w*\b)/)[0].replace(/[,;]\s*$/, '').trim();
  const prof = (all.match(PROF_RE) || [])[1];
  const sched = (all.match(TIMELINE_RE) || [])[0] || '';
  const descLines = body.filter(l => l.length > 90 || (l.length > 40 && /[.!?]$/.test(l) && !TIMELINE_RE.test(l) && !PROF_RE.test(l)));
  const sec = {
    code: normCode(m[1], m[2]),
    section: m[3] || '',
    title,
    professor: prof ? tidyName(prof) : '',
    schedule: parseSchedule(sched),
    credits: ((all.match(CREDITS_RE) || [])[1] || '').replace(/\s+/g, ''),
    room: (all.match(ROOM_RE) || [])[1] || '',
    mode: parseMode(all),
    classNumber: (all.match(CLASSNO_RE) || [])[1] || '',
    description: descLines.join('\n\n'),
    source,
  };
  if (!sec.professor) {
    // Common pattern: a short line that is just a name ("Jane Doe" or "Doe, Jane").
    const nameLine = body.find(l => /^(?:[A-Z][a-zA-Z'’.-]+,?\s){1,3}[A-Z][a-zA-Z'’.-]+$/.test(l) && l.length < 40 && !LONG_DAY.test(l));
    LONG_DAY.lastIndex = 0;
    if (nameLine) sec.professor = tidyName(nameLine);
  }
  return sec;
}

function tidyName(s) { return s.replace(/^(?:Prof(?:essor)?s?\.?|Dr\.)\s*/i, '').replace(/\s+(?:and|&)\s+(?:Prof(?:essor)?\.?\s*)/gi, ' and ').replace(/\s+/g, ' ').trim(); }

/** Map a table (array of rows of cell strings) with a header row to sections. */
export function parseTable(rows, source) {
  if (!rows.length) return [];
  let hi = rows.findIndex(r => r.filter(c => c.length <= 60 && HEAD_KEYS.some(([, re]) => re.test(c))).length >= 2);
  if (hi < 0) return [];
  const header = rows[hi].map(c => clean(c));
  const col = {};
  header.forEach((h, i) => { if (h.length > 60) return; for (const [k, re] of HEAD_KEYS) if (col[k] == null && re.test(h)) { col[k] = i; break; } });
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const get = k => (col[k] != null ? clean(r[col[k]] || '') : '');
    const courseCell = get('course') || r.join(' ');
    const m = courseCell.match(CODE_RE);
    if (!m) continue;
    let title = get('title') || courseCell.slice(m.index + m[0].length).replace(/^\s*[-–—:|]\s*/, '');
    const topic = get('topic');
    const schedText = [get('day'), get('time')].filter(Boolean).join(' ');
    out.push({
      code: normCode(m[1], m[2]), section: get('section') || m[3] || '',
      title: title.replace(/\s*\((?:Complete Column [A-Z])\)\s*/gi, ' ').replace(/\s+/g, ' ').trim(),
      topic: topic && topic !== title ? topic : '',
      professor: get('prof').replace(/\s*\n\s*/g, '; '),
      schedule: parseSchedule(schedText),
      credits: get('credits'), room: get('room'), campus: get('campus'),
      mode: parseMode(get('mode')) || get('mode'),
      classNumber: get('classno'),
      description: get('desc'), notes: get('notes'), area: get('area'), source,
    });
  }
  return out;
}

const HEAD_KEYS = [
  ['classno', /class\s*(no|number|nbr|#)|crn/i],
  ['section', /^section|section\s*(number|#)/i],
  ['topic', /special topic|topic/i],
  ['course', /course\s*(number|no|#|code)|^course$|^course\b/i],
  ['title', /title|course name/i],
  ['credits', /credit/i],
  ['day', /meeting|day/i],
  ['time', /^time|hours/i],
  ['mode', /mode|modality|format/i],
  ['prof', /instructor|professor|faculty|taught/i],
  ['desc', /description/i],
  ['room', /room/i],
  ['campus', /campus|location/i],
  ['area', /training area|area|track/i],
  ['notes', /notes?|comments?/i],
];

/** Minimal RFC-4180 CSV reader. */
export function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
