// GC Course Catalog: renders docs/data/courses.json (written weekly by scraper/scrape.mjs).
(() => {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  const CAL_START = 8, CAL_END = 22, HOUR_PX = 52;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { q: '', days: new Set(), from: '', to: '', prof: '', program: '', mode: '', view: 'list' };
  let data, all = [];

  const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmtTime = t => { const n = toMin(t); if (n == null) return ''; let h = Math.floor(n / 60), m = n % 60; const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
  const whenText = s => {
    const sc = s.schedule || {};
    if (sc.days?.length && sc.start) return `${sc.days.join(' / ')} ${fmtTime(sc.start)}–${fmtTime(sc.end)}`;
    return sc.text || 'TBA';
  };
  const hue = str => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

  fetch('data/courses.json', { cache: 'no-cache' }).then(r => r.json()).then(init).catch(err => {
    $('#departments').innerHTML = `<p class="empty-state">Course data could not be loaded (${esc(err.message)}). Try reloading the page.</p>`;
  });

  function init(d) {
    data = d;
    $('#term').textContent = d.term;
    const when = new Date(d.generated);
    $('#updated').textContent = `Last updated ${when.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`;
    const cl = $('#class-link');
    if (d.classUrl) cl.href = d.classUrl; else cl.replaceWith(Object.assign(document.createElement('strong'), { textContent: cl.textContent }));

    // Flatten sections and detect cross-listings (same course, time and professor in several programs).
    const key = s => [s.code, s.professor, s.schedule?.text, s.topic].join('|').toLowerCase();
    const byKey = new Map();
    d.programs.forEach(p => p.sections.forEach((s, i) => {
      const row = { ...s, program: p, id: `${p.code}-${i}` };
      all.push(row);
      if (!byKey.has(key(s))) byKey.set(key(s), new Set());
      byKey.get(key(s)).add(p.name);
    }));
    all.forEach(r => { r.crossList = [...byKey.get(key(r))].filter(n => n !== r.program.name); });
    all.forEach(r => { r.hay = [r.code, r.title, r.topic, r.professor, r.description, r.notes, r.program.name, r.area].join(' ').toLowerCase(); });

    // Filter controls
    const times = [];
    for (let h = 8; h <= 22; h++) for (const m of [0, 30]) if (!(h === 22 && m)) times.push(`${String(h).padStart(2, '0')}:${m ? '30' : '00'}`);
    $('#t-from').innerHTML = '<option value="">Any time</option>' + times.map(t => `<option value="${t}">${fmtTime(t)}</option>`).join('');
    $('#t-to').innerHTML = '<option value="">Any time</option>' + times.map(t => `<option value="${t}">${fmtTime(t)}</option>`).join('');
    const profs = new Set();
    all.forEach(r => (r.professor || '').split(/\s+and\s+|;\s*/).forEach(n => { n = n.trim(); if (n && !/^tba$|^staff$/i.test(n)) profs.add(n); }));
    $('#prof-list').innerHTML = [...profs].sort().map(n => `<option value="${esc(n)}">`).join('');
    $('#program').innerHTML += d.programs.map(p => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('');
    if (d.extraLinks?.length) $('#extra-links').innerHTML = d.extraLinks.map(l => `<p>See also: <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></p>`).join('');

    restore();
    bind();
    render();
  }

  function bind() {
    let t;
    $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 150); });
    document.querySelectorAll('.days button').forEach(b => b.addEventListener('click', () => {
      const d = b.dataset.day; state.days.has(d) ? state.days.delete(d) : state.days.add(d);
      b.setAttribute('aria-pressed', state.days.has(d)); render();
    }));
    for (const [id, k] of [['#t-from', 'from'], ['#t-to', 'to'], ['#program', 'program'], ['#mode', 'mode']])
      $(id).addEventListener('change', e => { state[k] = e.target.value; render(); });
    $('#prof').addEventListener('input', e => { state.prof = e.target.value.trim().toLowerCase(); render(); });
    $('#reset').addEventListener('click', () => {
      Object.assign(state, { q: '', from: '', to: '', prof: '', program: '', mode: '' }); state.days.clear();
      $('#q').value = $('#prof').value = ''; $('#t-from').value = $('#t-to').value = $('#program').value = $('#mode').value = '';
      document.querySelectorAll('.days button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      render();
    });
    $('#view-list').addEventListener('click', () => setView('list'));
    $('#view-cal').addEventListener('click', () => setView('cal'));
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-open]'); if (b) openDetail(b.dataset.open);
      const m = e.target.closest('.more'); if (m) { const d = m.previousElementSibling; d.classList.toggle('clamped'); m.textContent = d.classList.contains('clamped') ? 'Show full description' : 'Show less'; }
    });
  }

  function setView(v) {
    state.view = v;
    $('#view-list').setAttribute('aria-selected', v === 'list');
    $('#view-cal').setAttribute('aria-selected', v === 'cal');
    $('#list-view').hidden = v !== 'list';
    $('#cal-view').hidden = v !== 'cal';
    try { localStorage.setItem('gcc-view', v); } catch {}
    render();
  }
  function restore() { try { const v = localStorage.getItem('gcc-view'); if (v === 'cal') setView('cal'); } catch {} }

  const filtersActive = () => state.q || state.days.size || state.from || state.to || state.prof || state.program || state.mode;

  function matches(r) {
    if (state.program && r.program.code !== state.program) return false;
    if (state.q && !state.q.split(/\s+/).every(w => r.hay.includes(w))) return false;
    if (state.prof && !(r.professor || '').toLowerCase().includes(state.prof)) return false;
    if (state.mode && !(r.mode || '').toLowerCase().includes(state.mode.toLowerCase())) return false;
    const sc = r.schedule || {};
    if (state.days.size && !(sc.days || []).some(d => state.days.has(d))) return false;
    if (state.from && !(sc.start && toMin(sc.start) >= toMin(state.from))) return false;
    if (state.to && !(sc.end && toMin(sc.end) <= toMin(state.to))) return false;
    return true;
  }

  function render() {
    const shown = all.filter(matches);
    const nProg = new Set(shown.map(r => r.program.code)).size;
    $('#count').textContent = filtersActive()
      ? `${shown.length} course${shown.length === 1 ? '' : 's'} match in ${nProg} program${nProg === 1 ? '' : 's'}`
      : `${all.length} courses listed across ${(n => `${n} program${n === 1 ? '' : 's'}`)(data.programs.filter(p => p.sections.length).length)} · ${data.programs.length} programs tracked`;
    if (state.view === 'list') renderList(shown); else renderCalendar(shown);
  }

  function statusBadge(p) {
    if (p.sections.length) return p.stale ? '<span class="badge verify" title="Could not re-check this week; showing the last listing collected">Last week’s listing</span>' : '';
    if (p.status === 'unparsed') return '<span class="badge pending">Posted on program site</span>';
    return '<span class="badge pending">Not Yet Posted</span>';
  }

  function emptyText(p) {
    const link = p.source || p.site;
    const a = link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">Check the program’s page</a>.` : '';
    if (p.status === 'not_posted') return `This program has not posted its ${esc(data.term)} courses yet.${a}`;
    if (p.status === 'unparsed') return `This program has posted ${esc(data.term)} courses, but in a format we can’t read automatically yet.${a}`;
    return `Not yet posted here. We could not read this program’s course page automatically this week.${a}`;
  }

  function renderList(shown) {
    const active = filtersActive();
    const byProg = new Map();
    shown.forEach(r => { if (!byProg.has(r.program.code)) byProg.set(r.program.code, []); byProg.get(r.program.code).push(r); });
    const openSet = new Set([...document.querySelectorAll('details.program[open]')].map(d => d.dataset.code));
    const html = kindTest => data.programs.filter(kindTest).map(p => {
      const rows = byProg.get(p.code) || [];
      if (active && !rows.length) return '';
      const open = active ? rows.length <= 40 || state.program === p.code : openSet.has(p.code);
      const count = p.sections.length ? `${active ? rows.length + ' of ' : ''}${p.sections.length} course${p.sections.length === 1 ? '' : 's'}` : '';
      return `<details class="program" data-code="${esc(p.code)}"${open ? ' open' : ''}>
        <summary><span class="chev" aria-hidden="true"></span><span class="pname">${esc(p.name)}</span>${statusBadge(p)}<span class="pcount">${count}</span></summary>
        <div class="program-body">
          ${p.sections.length ? `<p class="program-meta">${p.source ? `<span>Source: <a href="${esc(p.source)}" target="_blank" rel="noopener">program course listing</a></span>` : ''}<span>Checked ${new Date(p.checked).toLocaleDateString()}</span></p>` : `<p class="empty-state">${emptyText(p)}</p>`}
          ${rows.map(courseHTML).join('')}
        </div></details>`;
    }).join('');
    const isTail = p => p.kind === 'certificate' || p.kind === 'concentration';
    $('#departments').innerHTML = html(p => !isTail(p)) || '<p class="empty-state">No department courses match these filters.</p>';
    $('#certificates').innerHTML = html(isTail) || '<p class="empty-state">No certificate or concentration courses match these filters.</p>';
  }

  function hl(text) {
    const t = esc(text);
    if (!state.q) return t;
    const words = state.q.split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return words.length ? t.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>') : t;
  }

  function courseHTML(r, inDialog) {
    const v = f => (r.filled || []).includes(f) ? ' <span class="badge verify" title="Not on the program’s page; filled from the GC catalog. Please verify.">Verify</span>' : '';
    const fact = (label, val, cls = '') => val ? `<div><dt>${label}</dt><dd class="${cls}">${val}</dd></div>` : '';
    const desc = r.description || '';
    const long = !inDialog && desc.length > 420;
    return `<article class="course">
      <div class="course-head"><span class="code">${esc(r.code)}${r.section ? ' · ' + esc(r.section) : ''}</span>
        <h3 class="ctitle">${hl(r.title || r.catalogTitle || 'Untitled course')}${v('title')}</h3>
        ${r.crossList?.length ? `<span class="badge cross">Also in ${esc(r.crossList.join(', '))}</span>` : ''}</div>
      ${r.topic ? `<p class="topic">${hl(r.topic)}</p>` : ''}
      <dl class="facts">
        ${fact('Prof', hl(r.professor || 'TBA'))}
        ${fact('When', esc(whenText(r)), 'when')}
        ${fact('Format', esc(r.mode))}
        ${fact('Room', esc(r.room))}
        ${fact('Credits', esc(r.credits) + v('credits'))}
        ${fact('Class #', esc(r.classNumber))}
        ${fact('Campus', esc(r.campus && r.campus !== 'GC' ? r.campus : ''))}
        ${fact('Area', esc(r.area))}
      </dl>
      ${desc ? `<p class="desc${long ? ' clamped' : ''}">${hl(desc)}${v('description')}</p>${long ? '<button class="link-btn more" type="button">Show full description</button>' : ''}` : '<p class="cnotes">No description posted yet.</p>'}
      ${r.notes ? `<p class="cnotes">Note: ${hl(r.notes)}</p>` : ''}
      ${r.source ? `<a class="src" href="${esc(r.source)}" target="_blank" rel="noopener">View on program site ↗</a>` : ''}
    </article>`;
  }

  function renderCalendar(shown) {
    const cal = $('#calendar');
    cal.style.setProperty('--hour', HOUR_PX + 'px');
    const height = (CAL_END - CAL_START) * HOUR_PX;
    const timed = shown.filter(r => r.schedule?.start && r.schedule?.days?.length);
    const days = DAYS.filter(d => !state.days.size || state.days.has(d));
    cal.style.gridTemplateColumns = `52px repeat(${days.length}, minmax(180px, 1fr))`;
    cal.style.minWidth = `${52 + days.length * 180}px`;
    let html = '<div class="cal-dayhead" style="border-left:0"></div>' + days.map(d => `<div class="cal-dayhead">${DAY_NAMES[d]}</div>`).join('');
    html += `<div class="cal-times" style="height:${height}px">` + Array.from({ length: CAL_END - CAL_START }, (_, i) => i ? `<span style="top:${i * HOUR_PX}px">${fmtTime(`${CAL_START + i}:00`)}</span>` : '').join('') + '</div>';
    for (const d of days) {
      const evs = timed.filter(r => r.schedule.days.includes(d)).map(r => ({ r, s: toMin(r.schedule.start), e: toMin(r.schedule.end) })).sort((a, b) => a.s - b.s || b.e - a.e);
      // Side-by-side placement for overlapping courses.
      const clusters = []; let cur = null;
      for (const ev of evs) { if (!cur || ev.s >= cur.end) { cur = { items: [], end: ev.e }; clusters.push(cur); } cur.items.push(ev); cur.end = Math.max(cur.end, ev.e); }
      for (const c of clusters) {
        const lanes = [];
        for (const ev of c.items) { let i = lanes.findIndex(end => end <= ev.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = ev.e; ev.lane = i; }
        c.items.forEach(ev => (ev.lanes = lanes.length));
      }
      html += `<div class="cal-col" style="height:${height}px">` + evs.map(({ r, s, e, lane, lanes }) => {
        const top = Math.max(0, (s - CAL_START * 60) / 60 * HOUR_PX), h = Math.max(22, (e - s) / 60 * HOUR_PX - 2);
        const w = 100 / lanes;
        const narrow = lanes >= 4;
        return `<button class="cal-ev${narrow ? ' narrow' : ''}" data-open="${esc(r.id)}" style="top:${top}px;height:${h}px;left:calc(${lane * w}% + 2px);width:calc(${w}% - 4px);--ev:hsl(${hue(r.program.name)} 60% 50%)" title="${esc(`${r.code} ${r.title} · ${r.professor || 'TBA'} · ${whenText(r)}`)}"><b>${esc(r.code)}</b>${narrow ? '' : esc(r.topic || r.title)}</button>`;
      }).join('') + '</div>';
    }
    cal.innerHTML = html;
    const un = shown.filter(r => !(r.schedule?.start && r.schedule?.days?.length));
    $('#unscheduled').innerHTML = un.length ? un.map(r => `<li><button data-open="${esc(r.id)}"><span class="code">${esc(r.code)}</span> ${esc(r.topic || r.title)} <span class="src">· ${esc(r.program.name)} · ${esc(r.schedule?.text || 'TBA')}</span></button></li>`).join('') : '<li class="cnotes">None.</li>';
  }

  function openDetail(id) {
    const r = all.find(x => x.id === id); if (!r) return;
    $('#detail-body').innerHTML = `<p class="dlg-prog">${esc(r.program.name)}</p>` + courseHTML(r, true).replace('<h3 class="ctitle">', '<h3 class="ctitle" id="detail-title">');
    $('#detail').showModal();
  }
})();
