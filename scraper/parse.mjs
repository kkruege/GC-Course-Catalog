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
  // "TH. 11:45" / "TU 2:00" -> "Th" / "Tu", so capitalised day codes are read too.
  const s = text.replace(/\./g, '').replace(/\b(TH|TU|SA|SU)\b/g, m => m[0] + m[1].toLowerCase());
  const found = new Set();
  // Ranges: Monday–Friday
  const range = s.match(/\b([a-z]{2,9})\s*(?:-|–|—|to|through|thru)\s*([a-z]{2,9})\b/i);
  if (range) {
    const a = DAY_ORDER.indexOf(dayOf(range[1])), b = DAY_ORDER.indexOf(dayOf(range[2]));
    if (a >= 0 && b > a && /day|^[a-z]{3,4}$/i.test(range[1])) for (let i = a; i <= b; i++) found.add(DAY_ORDER[i]);
  }
  for (const m of s.matchAll(LONG_DAY)) { const d = dayOf(m[1]); if (d) found.add(d); }
  if (!found.size) {
    // Compact codes before a time: "MW 2-4", "TTh 6:30", "M/W" (and "H 4:15", used for Thursday)
    const m = s.match(/(?:^|\s)((?:M|Tu|T|W|Th|R|F|Sa|Su)(?:\s*[\/,&]?\s*(?:M|Tu|T|W|Th|R|F|Sa|Su))*|H)(?=\s*[,:]?\s*\d)/);
    if (m) for (const t of m[1].match(/Th|Tu|Sa|Su|M|T|W|R|F|H/g)) found.add(t === 'T' ? 'Tue' : t === 'H' ? 'Thu' : dayOf(t));
  }
  return DAY_ORDER.filter(d => found.has(d));
}

const TIME_RANGE = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)?/i;

/** "415-615PM" -> "4:15-6:15PM" (some pages leave out the colons). Years and course numbers are left alone. */
export function fixColonlessTimes(text = '') {
  const t = n => { const h = +n.slice(0, -2), mm = +n.slice(-2); return h >= 1 && h <= 12 && mm < 60 ? `${h}:${n.slice(-2)}` : n; };
  return String(text).replace(/(^|[^\d:])(\d{1,2}(?::\d{2})?|\d{3,4})(\s*(?:[ap]\.?m\.?)?\s*(?:-|–|—)\s*)(\d{1,2}(?::\d{2})?|\d{3,4})(?![\d:])/gi,
    (all, pre, a, mid, b) => pre + (/^\d{3,4}$/.test(a) ? t(a) : a) + mid + (/^\d{3,4}$/.test(b) ? t(b) : b));
}

/** "2–4 PM" -> {start:'14:00', end:'16:00'}. Without am/pm, 1–8 is read as afternoon/evening. */
export function parseTimeRange(text = '') {
  const m = fixColonlessTimes(text).match(TIME_RANGE);
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
// Pages write some subjects without the space the catalog uses ("CL 80900", "UED 72200").
const SUBJECT_ALIASES = { CL: 'C L', UED: 'U ED' };
export function normCode(subj, num) { const s = subj.replace(/\s+/g, ' ').trim(); return `${SUBJECT_ALIASES[s] || s} ${num}`; }

/** Cut out the Spring 2027 part of a page. Returns null when the page never mentions Spring 2027. */
export function termSegment(text) {
  const lines = clean(text).split('\n');
  // A page can name Spring 2027 more than once (e.g. a menu of terms at the top, then the real
  // section). Try each mention and keep the part with the most course codes in it.
  const CODES = new RegExp(CODE_RE.source, 'g');
  let best = null, bestCodes = -1;
  for (let start = 0; start < lines.length; start++) {
    if (!TERM.match.test(lines[start])) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      // A short line naming another term is treated as the next heading.
      if (l.length < 80 && OTHER_TERMS.test(l) && !TERM.match.test(l) && !CODE_RE.test(l)) { end = i; break; }
      // So is a heading for older courses ("Past Course Schedules", "Previous Semesters").
      if (l.length < 60 && /^(?:past|previous|prior|archived?)\s+(?:course|semester|class|term)/i.test(l)) { end = i; break; }
    }
    const seg = lines.slice(start, end).join('\n');
    const codes = (seg.match(CODES) || []).length;
    if (codes > bestCodes) { best = seg; bestCodes = codes; }
    start = end - 1;
  }
  return best;
}

const PROF_RE = /(?:^|[\s,;(|])(?:Prof(?:essor)?s?\.?|Instructors?|Faculty|Taught by|Dr\.)\s*:?\s*([A-Z][^\n,;|()]*?(?:\s+(?:and|&)\s+(?:Prof(?:essor)?\.?\s*)?[A-Z][^\n,;|()]*?)*)(?=\s*(?:$|[\n,;|()]|\s{2}|\s(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|GC|Room|\d)))/;
const CREDITS_RE = /(\d(?:\.\d)?(?:\s*(?:-|–|\/|or|to)\s*\d)?)\s*(?:credits?|cr\b\.?)/i;
const ROOM_RE = /\b(?:Room|Rm\.?)\s*:?\s*([A-Z]?\d{3,4}(?:\.\d{1,2})?[A-Z]?|TBA|TBD)/i;
const CLASSNO_RE = /\b(?:Class\s*(?:No\.?|Number|#|Nbr)|CRN|Course\s*ID)\s*:?\s*#?(\d{4,6})/i;
// A day (Monday, Mon, M/W, or a one-letter code with a full stop such as "W." or "Th."), then a time range.
// Also a one-letter code right after a comma, as in "3 credits, M 415 – 615PM" (H = Thursday).
const TIMELINE_RE = new RegExp(`(${LONG_DAY.source}|\\b(?:M|T|W|Th|R|F)(?:\\s*[\\/,&]\\s*(?:M|T|W|Th|R|F))+\\b|\\b(?:M|Tu|T|W|Th|R|F|Sa|Su)\\.(?=\\s*\\d)|(?<=,\\s?)(?:M|T|W|Th|H|R|F)(?=\\s+\\d))[^\\n]{0,40}?${TIME_RANGE.source}`, 'i');

/** Split free text into course blocks, each starting with a course code. */
export function parseCourseBlocks(text, sourceUrl) {
  const lines = clean(text).split('\n').filter(Boolean);
  const blocks = [];
  let cur = null;
  for (const raw of lines) {
    // "Bres 70003: ..." -> "BRES 70003: ..." so a code written in title case still starts a course.
    const line = raw.replace(/^([A-Z][a-z]{1,5})(?=\s?\d{5}\b)/, s => s.toUpperCase());
    const m = line.match(CODE_RE);
    // A new course starts when a line begins with (or nearly begins with) a course code,
    // but not a sentence about one ("DATA 73000 satisfies as a ... core course").
    const sentence = m && /^\s*(?:[a-z]+\b)/.test(line.slice(m.index + m[0].length).replace(/^\s*[,:]/, ''));
    if (m && m.index < 12 && !sentence) { cur = { head: line, m, body: [] }; blocks.push(cur); }
    else if (cur) cur.body.push(line);
  }
  return blocks.map(b => blockToSection(b, sourceUrl)).filter(Boolean);
}

function blockToSection({ head, m, body }, source) {
  const all = fixColonlessTimes([head, ...body].join('\n'));
  let title = head.slice(m.index + m[0].length).replace(/^\s*[-–—:|,.]\s*/, '').trim();
  const cross = splitCrossList(title); title = cross.title;
  const extraNotes = [];
  // "[55504] Earth Systems II": a class number in brackets before the title.
  const bracketNo = title.match(/^\[(\d{4,6})\]\s*/);
  if (bracketNo) title = title.slice(bracketNo[0].length);
  // Title is text up to a field-looking part.
  title = title.split(/\s{2,}|\t|\s[|•]\s|(?=\s(?:Prof(?:essor)?\.?|Instructor|Mon|Tue|Wed|Thu|Fri|Sat)\w*\b)|,?\s+\d(?:\s*-\s*\d)?\s+credits?\b/i)[0].replace(/[\s\-–—,;:\/]+$/, '').replace(/(?<=[a-z)\]”"’])\.$/, '').trim();
  // "Visualization and Design (in person)": the format is not part of the title.
  const tail = title.match(/\s*\(([^()]*)\)\s*$/);
  if (tail && parseMode(tail[1])) title = title.slice(0, tail.index).trim();
  // "Thesis Workshop, is designed to provide ...": the title stops where the sentence starts.
  title = title.replace(/,\s+(?:is|are|will|was|which|that)\s.*$/i, '').trim();
  // "SOC 81900 (Demography Certificate Program DCP 801)", or just "SOC 84600", with the real
  // title on the next line.
  if (/^\(.*\)$/.test(title) || !title) {
    if (title) extraNotes.push(title.slice(1, -1));
    const next = body.find(l => l.trim());
    title = next && next.length < 120 && !TIMELINE_RE.test(next) && !PROF_RE.test(next) ? next.trim() : '';
  }
  if (title.length > 3 && title === title.toUpperCase() && /[A-Z]{3}/.test(title)) title = titleCase(title);
  // A "professor" with digits or brackets is something else ("Dr. Strangelove [1964]" in a film list).
  const prof = [(all.match(PROF_RE) || [])[1]].find(n => n && !/[\d\[\]]/.test(n));
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
    classNumber: bracketNo?.[1] || (all.match(CLASSNO_RE) || [])[1] || '',
    description: descLines.join('\n\n'),
    ...((cross.cross || extraNotes.length) ? { notes: [...extraNotes, cross.cross && `Cross-listed with ${cross.cross}`].filter(Boolean).join(' · ') } : {}),
    source,
  };
  if (!sec.professor) {
    // Common pattern: a short line that is just a name ("Jane Doe" or "Doe, Jane").
    // Also "Jane Doe, In-person" and "Jane Doe." (a name followed by the format, or a full stop).
    const nameOf = l => l.replace(/,\s*(?:in[- ]person|online|hybrid|remote)\b.*$/i, '').replace(/\.$/, '').trim();
    const nameLine = body.find(l => { const n = nameOf(l); LONG_DAY.lastIndex = 0; return /^(?:[A-Z][a-zA-Z'’.-]+,?\s){1,3}[A-Z][a-zA-Z'’-]+$/.test(n) && n.length < 40 && !LONG_DAY.test(n); });
    LONG_DAY.lastIndex = 0;
    if (nameLine) sec.professor = tidyName(nameOf(nameLine));
  }
  return sec;
}

function tidyName(s) { return s.replace(/^(?:Prof(?:essor)?s?\.?|Dr\.)\s*/i, '').replace(/\s*[-–—]\s+[a-z].*$/, '').replace(/\s+(?:and|&)\s+(?:Prof(?:essor)?\.?\s*)/gi, ' and ').replace(/\s+/g, ' ').trim(); }

/** "/ Hist 75900: The Problems of Slavery" -> { title: 'The Problems of Slavery', cross: 'HIST 75900' }. */
function splitCrossList(title) {
  const cross = [];
  let t = title;
  for (let m; (m = t.match(/^\s*\/\s*([A-Za-z]{1,5}(?: [A-Z]{1,2})?)\s?(\d{5})\s*[:\-–—]?\s*/));) {
    cross.push(normCode(m[1].toUpperCase(), m[2]));
    t = t.slice(m[0].length);
  }
  // Leftover separators: "/ The Novella as a Genre", "History of Literary Theory II-".
  t = t.replace(/^[\s\/\-–—:]+/, '').replace(/[\s\-–—,;:\/]+$/, '');
  return { title: t.trim(), cross: cross.join(', ') };
}

const WEEKDAY_HEAD = /^\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*$/i;
const MODE_WORDS = /^(?:in[- ]?person|online|hybrid(?: synchronous)?|remote|zoom|asynchronous|synchronous|fully online)$/i;
const isNameLine = l => l.length < 45 && !/[:;]/.test(l) && l !== l.toUpperCase()
  && /^(?:Prof(?:essor)?\.?\s+)?[A-Z][\w'’.-]*(?:\s+(?:[A-Z][\w'’.-]*|&|and|de|del|van|der|von|da))*(?:\s*,\s*[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*)*)*$/.test(l)
  && l.split(/\s+/).length <= 7;
const titleCase = s => s.toLowerCase().replace(/(^|[\s(“"'‘\-/:])([a-z])/g, (_, a, b) => a + b.toUpperCase())
  .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Us|Usa|Nyc|Cuny|Ai|Lgbtq|Mena)\b/g, w => w.toUpperCase())
  .replace(/\bU\.s\./g, 'U.S.')
  .replace(/(?<=\S )(And|Of|In|The|For|To|A|An|On|At|By|With|From|Or)\b(?!:)/g, w => w.toLowerCase());

/**
 * A weekly schedule grid: a header row of weekdays, then one row per time slot ("4:15 - 6:15").
 * Each cell holds one or more courses, e.g. "ENGL 86600 / Title" (with the professor before or
 * after), "DHUM 70002 Title (hybrid)", "LING 71500 / Morphology / (Lee)", or "70000 Akasoy"
 * (number only: the program's own subject, given as `subject`, is used).
 * Returns null when the table is not a weekly grid.
 */
export function parseGrid(rows, source, subject = '') {
  const hi = rows.findIndex(r => r.filter(c => WEEKDAY_HEAD.test(clean(c))).length >= 2);
  if (hi < 0) return null;
  const days = rows[hi].map(c => (WEEKDAY_HEAD.test(clean(c)) ? clean(c).replace(/\.$/, '') : null));
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const time = clean(r[0] || '');
    if (!parseTimeRange(time)) continue;
    r.forEach((cell, i) => { if (days[i]) for (const e of cellCourses(cell, subject)) out.push(gridSection(e, `${days[i]} ${time}`, source)); });
  }
  return out;
}

function cellCourses(cell, subject) {
  const lines = clean(cell).split('\n').map(l => l.trim()).filter(l => l && l !== ' ');
  const codeAt = l => {
    const u = l.replace(/^([A-Z][a-z]{1,5})(?=\s?\d{5}\b)/, s => s.toUpperCase());
    const m = u.match(CODE_RE);
    if (m && m.index < 4) return { code: normCode(m[1], m[2]), section: m[3] || '', rest: u.slice(m.index + m[0].length) };
    const b = subject && l.match(/^(\d{5})(?:-(\d{1,3}))?\b\s*(.*)$/);
    if (b) return { code: `${subject} ${b[1]}`, section: b[2] || '', rest: b[3], bare: true };
    return null;
  };
  const entries = [];
  let cur = null, pendingProf = '';
  lines.forEach((l, i) => {
    const c = codeAt(l);
    if (c) {
      cur = { ...c, lines: [], prof: pendingProf };
      pendingProf = '';
      const rest = c.rest.replace(/^\s*[-–—:|,.]\s*/, '').trim();
      if (rest) cur.lines.push(rest);
      entries.push(cur);
      return;
    }
    const nextIsCode = i + 1 < lines.length && codeAt(lines[i + 1]);
    // A name just before a course code belongs to that next course (English: "Ahmed / ENGL 86600 / Title").
    if ((!cur || (nextIsCode && cur.lines.length)) && isNameLine(l)) { pendingProf = l; return; }
    if (cur) cur.lines.push(l);
  });
  return entries;
}

function gridSection(e, when, source) {
  let prof = e.prof, mode = '', title = '';
  const titleParts = [], parenNotes = [], crossCodes = [];
  for (let l of e.lines) {
    // "LING 79800/ANTH 78300": the cross-listed code is not part of the title.
    if (/^\s*\//.test(l)) { const c = splitCrossList(l); if (c.cross) crossCodes.push(c.cross); l = c.title; if (!l) continue; }
    const paren = l.match(/^\((.+)\)$/);
    if (paren) {
      const inner = paren[1].trim();
      if (parseMode(inner) && (MODE_WORDS.test(inner) || /class|lab|hybrid|online|person/i.test(inner))) mode = mode || parseMode(inner);
      // "(2:30 PM to 4:30 PM)": the real meeting time inside a longer grid slot.
      else if (parseTimeRange(inner)) when = `${when.split(' ')[0]} ${inner}`;
      else parenNotes.push(inner);
      continue;
    }
    // "Title (hybrid)" / "Title (1-hour lab class, hybrid)": the format goes in mode.
    const tail = l.match(/\s*\(([^()]*)\)\s*$/);
    if (tail && parseMode(tail[1])) { mode = mode || parseMode(tail[1]); l = l.slice(0, tail.index).trim(); }
    titleParts.push(l);
  }
  // Sociology: "SOC 84600 / Howard Lune / SOCIAL MOVEMENTS" (name, then the title in capitals).
  const caps = titleParts.find(l => l.length > 3 && l === l.toUpperCase() && /[A-Z]{3}/.test(l));
  if (caps) {
    for (const l of titleParts) if (l !== caps && !prof && isNameLine(l)) prof = l;
    title = titleCase(caps);
  } else if (e.bare && titleParts.length === 1 && !prof && isNameLine(titleParts[0]) && titleParts[0].split(/\s+/).length <= 3) {
    // Liberal Studies: "70000 Akasoy" - only a surname after the bare course number.
    prof = titleParts[0];
  } else {
    title = titleParts.reduce((a, l) => (a ? (a.endsWith('/') ? a + l : `${a} ${l}`) : l), '');
  }
  // Bracketed lines: a professor ("(Lee)", "(Al Khatib, Caplan)") or a note ("(TENTATIVE)").
  const notes = [];
  for (const n of parenNotes) {
    if (!prof && n !== n.toUpperCase() && /^[A-Z][\w'’.-]*(?:[\s,&]+(?:and\s+)?[A-Z][\w'’.-]*)*$/.test(n) && n.split(/\s+/).length <= 5) prof = n;
    else notes.push(n === n.toUpperCase() ? titleCase(n) : n);
  }
  const cross = splitCrossList(title);
  if (cross.cross) crossCodes.push(cross.cross);
  if (crossCodes.length) notes.push(`Cross-listed with ${crossCodes.join(', ')}`);
  return {
    code: e.code, section: e.section, title: cross.title,
    professor: prof ? tidyName(prof) : '',
    schedule: parseSchedule(when), credits: '', room: '', mode, classNumber: '', description: '',
    ...(notes.length ? { notes: notes.join(' · ') } : {}),
    source,
  };
}

/**
 * Merge listings of the same course (e.g. a grid cell and its description further down the page,
 * or a schedule list and a separate descriptions list). Two entries are the same course when the
 * code matches and nothing contradicts it: section, title, professor surname and meeting time.
 * Empty fields are filled from the other entry; the longer description is kept.
 */
export function mergeSections(list) {
  const out = [];
  const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const surnames = s => new Set(norm(s).split(' ').filter(w => w.length > 2 && !['and', 'prof', 'professor', 'tbd', 'tba', 'staff'].includes(w)));
  // Titles agree when one contains the other, or most of their words are shared ("Fundamental"
  // vs "Fundamentals"). A shared start alone is not enough: "Special Topics: X" vs "Special Topics: Y".
  const words = s => new Set(norm(s).split(' ').map(w => w.replace(/s$/, '')).filter(Boolean));
  const titleOk = (a, b) => {
    a = norm(a); b = norm(b); if (!a || !b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const x = words(a), y = words(b); let both = 0; for (const w of x) if (y.has(w)) both++;
    return both / (x.size + y.size - both) >= 0.6;
  };
  const profOk = (a, b) => { const x = surnames(a), y = surnames(b); if (!x.size || !y.size) return true; for (const w of x) if (y.has(w)) return true; return false; };
  const timeOk = (a, b) => !a?.days?.length || !b?.days?.length || (a.days.join() === b.days.join() && (!a.start || !b.start || a.start === b.start));
  for (const s of list) {
    const same = o => o.code === s.code && (!o.section || !s.section || o.section === s.section)
      && titleOk(o.title, s.title) && profOk(o.professor, s.professor) && (o.title || s.title || o.professor || s.professor);
    let e = out.find(o => same(o) && timeOk(o.schedule, s.schedule));
    // Same title and same professor, but the page gives two different times (a grid that
    // disagrees with the description): still one course; keep the first time and note the other.
    if (!e) {
      e = out.find(o => same(o) && o.title && s.title && norm(o.title) === norm(s.title));
      if (e && s.schedule?.text && e.schedule?.text) e.notes = [e.notes, `The page also gives: ${s.schedule.text}`].filter(Boolean).join(' · ');
    }
    if (!e) { out.push({ ...s }); continue; }
    for (const [k, v] of Object.entries(s)) {
      if (k === 'schedule') { if (!e.schedule?.days?.length && v?.days?.length) e.schedule = v; else if (e.schedule && !e.schedule.start && v?.start) e.schedule = v; continue; }
      if (k === 'description') { if ((v || '').length > (e.description || '').length) e.description = v; continue; }
      if (k === 'title') { if (v && (!e.title || v.length > e.title.length)) e.title = v; continue; }
      if (k === 'professor') { if (v && (!e.professor || v.split(' ').length > e.professor.split(' ').length)) e.professor = v; continue; }
      if (k === 'notes') { if (v && !(e.notes || '').includes(v)) e.notes = [e.notes, v].filter(Boolean).join(' · '); continue; }
      if (!e[k] && v) e[k] = v;
    }
  }
  return out;
}

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
