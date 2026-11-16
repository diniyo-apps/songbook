/* Songbook — offline worship songbook PWA. Vanilla JS, no build step. */
(() => {
'use strict';

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const now = () => Date.now();
const safeJson = (s, d) => { try { return JSON.parse(s); } catch (_) { return d; } };
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (ms) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (_) {} };

const IC = {
  back: '<path d="M15 5l-7 7 7 7"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', edit: '<path d="M4 20h4.2L19.5 8.7a1.5 1.5 0 000-2.1l-2.1-2.1a1.5 1.5 0 00-2.1 0L4 15.8V20z"/>',
  keys: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>', share: '<path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/>',
  down: '<path d="M12 4v11M8 11l4 4 4-4M5 19h14"/>', up: '<path d="M12 16V5M8 9l4-4 4 4M5 19h14"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  sets: '<path d="M4 6h16M4 12h16M4 18h10"/>', gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  chev: '<path d="M9 5l7 7-7 7"/>', ud: '<path d="M6 14l6-6 6 6"/>', dd: '<path d="M6 10l6 6 6-6"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  select: '<path d="M4 7l2 2 3-3M4 16l2 2 3-3M13 7h7M13 17h7"/>', copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 011-1h9"/>',
  restore: '<path d="M4 12a8 8 0 108-8M4 4v4h4"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
};
const ico = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

// ───────────────────────── state ─────────────────────────
const DEFAULTS = { theme: 'night', fontSize: 19, mode: 'letters', chords: true, invertPdf: true, pdfZoom: 100, scrollSpeed: 3, wake: true };
const S = {
  songs: [], sets: [], settings: { ...DEFAULTS },
  ui: { q: '', sort: 'title', filter: 'all', select: null, scroll: {} },
  cur: null, // { songId, setId, idx }
  meta: { lastBackup: 0, editsSinceBackup: 0, lastSnap: 0 },
  persisted: false, dirtySnap: false, draftNew: null,
};
const live = () => S.songs.filter((s) => !s.deleted);
const trashed = () => S.songs.filter((s) => s.deleted);
const songById = (id) => S.songs.find((s) => s.id === id);
const setById = (id) => S.sets.find((s) => s.id === id);
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

// ───────────────────────── persistence + safety ─────────────────────────
let snapTimer = null;
function markDirty() {
  S.meta.editsSinceBackup++; S.dirtySnap = true;
  DB.setMeta('editsSinceBackup', S.meta.editsSinceBackup).catch(() => {});
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => takeSnapshot('auto'), 5000);
}
async function saveSong(song) {
  song.modified = now();
  const copy = { ...song }; delete copy._buf;
  await DB.put('songs', copy);
  if (!S.songs.includes(song)) { const i = S.songs.findIndex((s) => s.id === song.id); if (i >= 0) S.songs[i] = song; else S.songs.push(song); }
  markDirty();
}
async function saveSet(set) {
  set.modified = now();
  await DB.put('sets', set);
  if (!S.sets.includes(set)) { const i = S.sets.findIndex((s) => s.id === set.id); if (i >= 0) S.sets[i] = set; else S.sets.push(set); }
  markDirty();
}
async function saveSettings() { lsSet('sb_theme', S.settings.theme); await DB.setMeta('settings', S.settings); }

async function takeSnapshot(reason, force) {
  if (!force && !S.dirtySnap) return;
  if (!S.songs.length && !S.sets.length) return;
  const snap = {
    id: String(now()), time: now(), reason,
    songs: JSON.parse(JSON.stringify(S.songs.map((s) => { const c = { ...s }; delete c._buf; return c; }))),
    sets: JSON.parse(JSON.stringify(S.sets)),
  };
  await DB.put('snaps', snap);
  S.dirtySnap = false; S.meta.lastSnap = snap.time;
  await DB.setMeta('lastSnap', snap.time);
  const all = (await DB.keys('snaps')).sort();
  const keepAuto = 20;
  if (all.length > keepAuto + 10) await DB.delMany('snaps', all.slice(0, all.length - (keepAuto + 10)));
}

async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) S.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch (_) {}
}
function protection() {
  // iOS keeps installed (home-screen) apps; browsers keep data they marked persistent.
  if (S.persisted && isStandalone()) return { ok: true, label: 'Protected', note: 'Installed and set to persistent storage.' };
  if (isStandalone()) return { ok: true, label: 'Protected', note: 'Installed on the Home Screen — the phone will not clear it for inactivity.' };
  if (S.persisted) return { ok: true, label: 'Protected', note: 'Browser marked this storage as persistent.' };
  return { ok: false, label: 'Not protected yet', note: 'Add the app to your Home Screen so the phone never clears your songs.' };
}
const backupDue = () => live().length > 0 && (!S.meta.lastBackup || now() - S.meta.lastBackup > 7 * 864e5 || S.meta.editsSinceBackup >= 25);

// ───────────────────────── song model helpers ─────────────────────────
const holderOf = (song, setId, idx) => {
  if (setId) { const set = setById(setId); const it = set && set.items[idx]; if (it && it.songId === song.id) return it; }
  return song;
};
function makeCtx(song, holder) {
  const pk = Music.parseKey(song.key);
  let tonic = pk ? pk.tonic : null;
  if (tonic == null && song.fmt === 'text') {
    const c = Music.collectChords(song.body || '');
    if (c.letters.length) { const p = Music.parseKey(Music.inferKey(c.letters)); if (p) tonic = p.tonic; }
  }
  const shift = holder.shift || 0, capo = holder.capo || 0;
  const out = tonic == null ? null : Music.mod(tonic + shift - capo);
  const flats = out == null ? false : Music.useFlats(out, shift - capo === 0 ? pk : null);
  let mode = S.settings.mode;
  if (mode === 'numbers' && tonic == null) mode = 'letters';
  return { mode, tonic, shift, capo, flats, out };
}
const keyLabel = (song, holder) => (song.key ? Music.shiftKey(song.key, (holder || song).shift || 0) : '');
function hasNumbers(song) { return song.fmt === 'text' && Music.collectChords(song.body || '').numbers > 0; }

function chordHtml(c, ctx) {
  if (!c) return '';
  if (c.text !== undefined) return esc(c.text);
  return esc(Music.renderChord(c.ch, ctx));
}
// split segments into whole words so a chord inside a word never breaks the word across lines
function toWords(segs) {
  const words = []; let cur = [];
  const flush = () => { if (cur.length) { words.push(cur); cur = []; } };
  for (const s of segs) {
    let chord = s.c || null;
    const toks = s.t.match(/\s+|\S+/g) || [];
    for (const tk of toks) {
      if (/^\s/.test(tk)) {
        if (chord) { flush(); words.push([{ c: chord, t: tk }]); chord = null; }
        else if (cur.length) { cur[cur.length - 1].t += tk; flush(); }
        else words.push([{ c: null, t: tk }]);
      } else { cur.push({ c: chord, t: tk }); chord = null; }
    }
    if (chord) cur.push({ c: chord, t: '' });
  }
  flush();
  return words;
}
function renderBody(song, holder) {
  const ctx = makeCtx(song, holder);
  const rows = Music.parseSong(song.body);
  const show = S.settings.chords;
  let html = '', lastBlank = true;
  for (const r of rows) {
    if (r.k === 'blank') { if (!lastBlank) html += '<div class="gap"></div>'; lastBlank = true; continue; }
    if (r.k === 'head') { html += `<div class="sec">${esc(r.text)}</div>`; lastBlank = false; continue; }
    if (r.k === 'chords') {
      if (show) { html += '<div class="cr">' + r.toks.map((t) => (t.ch ? `<span class="ch">${esc(Music.renderChord(t.ch, ctx))}</span>` : `<span class="bar">${esc(t.raw)}</span>`)).join('') + '</div>'; lastBlank = false; }
      continue;
    }
    lastBlank = false;
    const has = r.segs.some((s) => s.c);
    if (!has || !show) { html += `<div class="ln plain">${esc(r.segs.map((s) => s.t).join('')) || '&nbsp;'}</div>`; continue; }
    html += '<div class="ln">' + toWords(r.segs).map((w) => '<span class="wd">' + w.map((p) => `<span class="sg"><span class="ch${p.c ? '' : ' e'}">${p.c ? chordHtml(p.c, ctx) : '&nbsp;'}</span><span class="ly">${esc(p.t) || '&nbsp;'}</span></span>`).join('') + '</span>').join('') + '</div>';
  }
  return html || '<p class="muted pad">This song is empty. Tap the pencil to add lyrics and chords.</p>';
}

// ───────────────────────── toast + sheets ─────────────────────────
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}
function sheet(html, opts = {}) {
  const r = $('#modal-root');
  r.innerHTML = `<div class="scrim" data-act="close-sheet"></div><div class="sheet ${opts.full ? 'full' : ''}" role="dialog">${html}</div>`;
  r.classList.add('open'); document.body.classList.add('noscroll');
}
function closeSheet() { const r = $('#modal-root'); r.classList.remove('open'); r.innerHTML = ''; document.body.classList.remove('noscroll'); sheetCtx = null; }
let sheetCtx = null;
function confirmBox(title, text, okLabel, onOk, danger) {
  sheetCtx = { onOk };
  sheet(`<div class="sh-h">${esc(title)}</div><p class="muted">${esc(text)}</p>
    <div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="confirm-ok">${esc(okLabel)}</button></div>`);
}

// ───────────────────────── router ─────────────────────────
function route() {
  const h = location.hash.slice(1) || '/songs';
  const [path, qs] = h.split('?');
  const p = path.split('/').filter(Boolean);
  return { name: p[0] || 'songs', id: p[1] ? decodeURIComponent(p[1]) : null, q: new URLSearchParams(qs || '') };
}
const go = (hash, replace) => { if (replace) location.replace(hash); else location.hash = hash; };
let cleanup = null;
function render() {
  if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
  const prev = S._routeKey; if (prev) S.ui.scroll[prev] = window.scrollY;
  const r = route();
  closeSheet();
  const app = $('#app');
  let key = r.name;
  switch (r.name) {
    case 'sets': app.innerHTML = shell('sets', viewSets()); break;
    case 'set': app.innerHTML = shell('sets', viewSetDetail(r.id)); key = 'set/' + r.id; break;
    case 'settings': app.innerHTML = shell('settings', viewSettings()); break;
    case 'trash': app.innerHTML = shell('settings', viewTrash()); break;
    case 'song': viewSong(app, r); key = 'song'; break;
    case 'edit': viewEdit(app, r); key = 'edit'; break;
    default: app.innerHTML = shell('songs', viewSongs()); key = 'songs'; renderList();
  }
  S._routeKey = key;
  const sc = S.ui.scroll[key];
  window.scrollTo(0, key === 'song' || key === 'edit' ? 0 : sc || 0);
  document.documentElement.dataset.theme = S.settings.theme;
}
function shell(tab, inner) {
  const t = (id, label, icon, href) => `<a class="tab ${tab === id ? 'on' : ''}" href="${href}">${ico(icon)}<span>${label}</span></a>`;
  return `<div class="page">${inner}</div><nav class="tabbar">${t('songs', 'Songs', 'music', '#/songs')}${t('sets', 'Sets', 'sets', '#/sets')}${t('settings', 'Settings', 'gear', '#/settings')}</nav>`;
}

// ───────────────────────── Songs list ─────────────────────────
function viewSongs() {
  const n = live().length;
  const sel = S.ui.select;
  return `
  <header class="top"><h1>All Songs</h1><div class="acts">
    <button class="ibtn" data-act="new-song" aria-label="New song">${ico('plus')}</button>
    <button class="ibtn ${sel ? 'on' : ''}" data-act="toggle-select" aria-label="Select songs">${ico('select')}</button>
  </div></header>
  ${backupDue() ? `<div class="banner" data-act="backup-now">${ico('shield')}<div><b>Back up your songs</b><span>${S.meta.lastBackup ? 'Last backup ' + fmtDate(S.meta.lastBackup) : 'You have not made a backup yet'} · tap to save one</span></div>${ico('chev')}</div>` : ''}
  <div class="search">${ico('search')}<input id="q" type="search" inputmode="search" autocomplete="off" placeholder="Search title, artist or lyrics…" value="${esc(S.ui.q)}"><button class="ibtn sm" data-act="clear-q" aria-label="Clear">${ico('close')}</button></div>
  <div class="filters">
    <div class="seg">${['all', 'text', 'pdf'].map((f) => `<button class="${S.ui.filter === f ? 'on' : ''}" data-act="filter" data-v="${f}">${{ all: 'All', text: 'Chords', pdf: 'PDF' }[f]}</button>`).join('')}</div>
    <select id="sort" aria-label="Sort"><option value="title" ${S.ui.sort === 'title' ? 'selected' : ''}>A–Z</option><option value="author" ${S.ui.sort === 'author' ? 'selected' : ''}>Artist</option><option value="recent" ${S.ui.sort === 'recent' ? 'selected' : ''}>Recent</option></select>
  </div>
  <div id="list"></div>
  <div id="selbar"></div>
  ${n === 0 ? '' : ''}`;
}
function groupLetter(s) {
  const t = (s.title || '').trim();
  const ch = (t[0] || '#').toUpperCase();
  return /[0-9]/.test(ch) ? '#' : ch;
}
function filteredSongs() {
  const q = norm(S.ui.q);
  let arr = live().filter((s) => S.ui.filter === 'all' || (S.ui.filter === 'pdf') === (s.fmt === 'pdf'));
  if (q) arr = arr.filter((s) => norm(s.title).includes(q) || norm(s.author).includes(q) || (s.fmt === 'text' && norm(s.body).includes(q)));
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  if (S.ui.sort === 'recent') arr.sort((a, b) => b.modified - a.modified);
  else if (S.ui.sort === 'author') arr.sort((a, b) => cmp(a.author || '~', b.author || '~') || cmp(a.title, b.title));
  else arr.sort((a, b) => cmp(a.title, b.title));
  return arr;
}
function renderList() {
  const box = $('#list'); if (!box) return;
  const arr = filteredSongs();
  if (!live().length) {
    box.innerHTML = `<div class="empty"><div class="eg">${ico('music')}</div><h2>Your songbook is empty</h2>
      <p>Bring in your SongbookPro backup, add a PDF, or write a song.</p>
      <label class="btn primary file">${ico('up')} Import .sbp or PDF<input type="file" multiple data-import></label>
      <button class="btn" data-act="new-song">${ico('edit')} Write a song</button></div>`;
    renderSelbar(); return;
  }
  if (!arr.length) { box.innerHTML = '<p class="muted pad center">No songs match.</p>'; renderSelbar(); return; }
  let html = '', last = null;
  const grouped = S.ui.sort === 'title' || S.ui.sort === 'author';
  for (const s of arr) {
    if (grouped) {
      const g = S.ui.sort === 'title' ? groupLetter(s) : (s.author || 'No artist');
      if (g !== last) { html += `<div class="grp">${esc(g)}</div>`; last = g; }
    }
    const k = keyLabel(s);
    const checked = S.ui.select && S.ui.select.has(s.id);
    html += `<a class="row ${checked ? 'sel' : ''}" href="#/song/${encodeURIComponent(s.id)}" data-id="${esc(s.id)}">
      ${S.ui.select ? `<span class="cb ${checked ? 'on' : ''}">${checked ? ico('check') : ''}</span>` : ''}
      <span class="rt"><span class="t">${esc(s.title || 'Untitled')}</span><span class="a">${esc(s.author || '')}</span></span>
      <span class="badges">${s.fmt === 'pdf' ? '<i class="bd">PDF</i>' : ''}${k ? `<i class="bd key">${esc(k)}</i>` : ''}</span></a>`;
  }
  box.innerHTML = html + `<p class="muted center small pad">${arr.length} song${arr.length === 1 ? '' : 's'}</p>`;
  renderSelbar();
}
function renderSelbar() {
  const b = $('#selbar'); if (!b) return;
  const sel = S.ui.select;
  b.innerHTML = sel ? `<div class="selbar"><span>${sel.size} selected</span><button class="btn sm" data-act="select-all">All</button><button class="btn primary sm" data-act="add-to-set" ${sel.size ? '' : 'disabled'}>Add to set…</button><button class="btn sm" data-act="toggle-select">Done</button></div>` : '';
}

// ───────────────────────── Song view ─────────────────────────
let autoRaf = 0, wakeLock = null;
async function viewSong(app, r) {
  const song = songById(r.id);
  if (!song) { go('#/songs', true); return; }
  const setId = r.q.get('set'), idx = +(r.q.get('i') || 0);
  S.cur = { songId: song.id, setId, idx };
  const set = setId && setById(setId);
  const holder = holderOf(song, setId, idx);
  const items = set ? set.items.filter((it) => songById(it.songId) && !songById(it.songId).deleted) : null;
  const pos = set ? set.items.findIndex((it, i) => i === idx) : -1;
  app.innerHTML = `
  <header class="songbar glass">
    <button class="ibtn" data-act="song-back" aria-label="Back">${ico('back')}</button>
    <div class="st"><b>${esc(song.title)}</b>${set ? `<small>${esc(set.name)} · ${idx + 1}/${set.items.length}</small>` : ''}</div>
    <button class="ibtn" data-act="song-edit" aria-label="Edit">${ico('edit')}</button>
    <button class="ibtn" data-act="song-more" aria-label="More">${ico('more')}</button>
  </header>
  <article class="songpage">
    <h1 class="stitle">${esc(song.title)}</h1>
    <div class="sby">${esc(song.author || '')}</div>
    <div class="pills" id="pills"></div>
    <div id="songbody" class="sbody" style="--fs:${S.settings.fontSize}px"></div>
  </article>
  <div class="dock glass" id="dock"></div>`;
  paintSong();
  // swipe between songs of a set
  if (set) {
    let sx = 0, sy = 0, st = 0;
    const ts = (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; st = now(); };
    const te = (e) => {
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
      if (now() - st < 600 && Math.abs(dx) > 90 && Math.abs(dy) < 50) setStep(dx < 0 ? 1 : -1);
    };
    document.addEventListener('touchstart', ts, { passive: true }); document.addEventListener('touchend', te, { passive: true });
    const old = cleanup; cleanup = () => { document.removeEventListener('touchstart', ts); document.removeEventListener('touchend', te); if (old) old(); };
  }
  const kd = (e) => { if (!set || /input|textarea|select/i.test(e.target.tagName)) return; if (e.key === 'ArrowRight') setStep(1); if (e.key === 'ArrowLeft') setStep(-1); };
  document.addEventListener('keydown', kd);
  const prevClean = cleanup; cleanup = () => { document.removeEventListener('keydown', kd); stopScroll(); releaseWake(); if (prevClean) prevClean(); };
  acquireWake();
}
function curSong() { return S.cur && songById(S.cur.songId); }
function curHolder() { const s = curSong(); return s ? holderOf(s, S.cur.setId, S.cur.idx) : null; }
function setStep(d) {
  const c = S.cur; if (!c || !c.setId) return;
  const set = setById(c.setId); if (!set) return;
  let i = c.idx + d;
  while (i >= 0 && i < set.items.length && (!songById(set.items[i].songId) || songById(set.items[i].songId).deleted)) i += d;
  if (i < 0 || i >= set.items.length) { toast(d > 0 ? 'End of set' : 'Start of set'); return; }
  go(`#/song/${encodeURIComponent(set.items[i].songId)}?set=${encodeURIComponent(c.setId)}&i=${i}`, true);
}
function paintSong() {
  const song = curSong(); if (!song) return;
  const holder = curHolder();
  const body = $('#songbody');
  if (song.fmt === 'pdf') paintPdf(song, body); else body.innerHTML = renderBody(song, holder);
  body.style.setProperty('--fs', S.settings.fontSize + 'px');
  const k = keyLabel(song, holder), capo = holder.capo || 0, ctx = makeCtx(song, holder);
  const numbersOn = song.fmt === 'text' && ctx.mode === 'numbers';
  const hint = song.fmt === 'text' && !song.key && S.settings.mode === 'letters' && hasNumbers(song) ? '<p class="hint">This song uses Nashville numbers. Tap <b>Key</b> and choose a key to see the letter chords.</p>' : '';
  $('#pills').innerHTML =
    `<button class="pill key" data-act="open-key">${ico('keys')}<span>Key <b>${esc(k || '—')}</b></span></button>` +
    (capo ? `<span class="pill">Capo ${capo}</span>` : '') +
    (song.fmt === 'text' ? `<button class="pill ${numbersOn ? 'on' : ''}" data-act="toggle-mode">${numbersOn ? 'Numbers' : 'Letters'}</button>` : '<span class="pill">PDF</span>') + hint;
  const set = S.cur.setId && setById(S.cur.setId);
  $('#dock').innerHTML = `
    ${set ? `<button class="dk" data-act="set-prev" aria-label="Previous song">${ico('back')}</button>` : ''}
    <button class="dk" data-act="font-" aria-label="Smaller text"><b>A</b><sup>−</sup></button>
    <button class="dk" data-act="font+" aria-label="Larger text"><b>A</b><sup>+</sup></button>
    ${song.fmt === 'text' ? `<button class="dk ${S.settings.chords ? 'on' : ''}" data-act="toggle-chords"><span>♯♭</span></button>` : ''}
    <button class="dk" data-act="open-key">${ico('keys')}</button>
    <button class="dk ${autoRaf ? 'on' : ''}" data-act="autoscroll" aria-label="Auto scroll">${ico(autoRaf ? 'pause' : 'play')}</button>
    ${set ? `<button class="dk" data-act="set-next" aria-label="Next song">${ico('chev')}</button>` : ''}`;
}
async function paintPdf(song, host) {
  host.classList.add('pdfhost');
  host.innerHTML = '<p class="muted center pad">Loading PDF…</p>';
  try {
    const rec = await DB.get('blobs', song.pdfId);
    if (!rec) { host.innerHTML = '<p class="muted center pad">The PDF file for this song is missing. Restore a backup that contains it.</p>'; return; }
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(rec.data.slice(0)) }).promise;
    const zoom = S.settings.pdfZoom / 100;
    const width = Math.max(260, ((host.clientWidth || window.innerWidth) - 36) * zoom);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const frag = document.createDocumentFragment();
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width * dpr) / base.width });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = width + 'px'; c.style.height = (vp.height / dpr) + 'px';
      c.className = 'pdfpage' + (S.settings.invertPdf ? ' inv' : '');
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      frag.appendChild(c);
    }
    host.innerHTML = ''; host.appendChild(frag);
  } catch (e) { host.innerHTML = `<p class="muted center pad">Could not open this PDF (${esc(e.message || e)}).</p>`; }
}
function startScroll() {
  stopScroll();
  const speeds = [12, 22, 36, 55, 80];
  let last = performance.now(), acc = 0;
  const tick = (t) => {
    acc += ((t - last) / 1000) * speeds[S.settings.scrollSpeed - 1]; last = t;
    if (acc >= 1) { window.scrollBy(0, Math.floor(acc)); acc -= Math.floor(acc); }
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) { stopScroll(); paintSong(); return; }
    autoRaf = requestAnimationFrame(tick);
  };
  autoRaf = requestAnimationFrame(tick);
}
function stopScroll() { if (autoRaf) cancelAnimationFrame(autoRaf); autoRaf = 0; }
async function acquireWake() {
  if (!S.settings.wake || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (_) {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && route().name === 'song') acquireWake(); });

// key sheet
const KEYS_MAJ = Music.ALL_KEYS.major, KEYS_MIN = Music.ALL_KEYS.minor;
function openKeySheet() {
  const song = curSong(); if (!song) return;
  const holder = curHolder();
  const isPdf = song.fmt === 'pdf';
  const cur = song.key ? Music.shiftKey(song.key, holder.shift || 0) : '';
  const curP = Music.parseKey(cur);
  const optOf = (k) => { const p = Music.parseKey(k); const sel = curP && p.pc === curP.pc && p.minor === curP.minor; return `<option value="${k}" ${sel ? 'selected' : ''}>${k}</option>`; };
  const shift = holder.shift || 0, capo = holder.capo || 0;
  const row = song.key ? Music.nnsRow(cur) : null;
  sheet(`
    <div class="sh-h">Key adjustments</div>
    <div class="kv"><label>Key</label><select data-chg="set-key"><option value="" ${cur ? '' : 'selected'}>Not set</option><optgroup label="Major">${KEYS_MAJ.map(optOf).join('')}</optgroup><optgroup label="Minor">${KEYS_MIN.map(optOf).join('')}</optgroup></select></div>
    ${song.key ? `<div class="kv small muted"><label>Original</label><span>${esc(song.key)}</span></div>` : ''}
    ${isPdf ? '<p class="muted small">PDF songs are pictures, so they cannot be transposed. You can still note the key.</p>' : `
    <div class="kv"><label>Transpose</label><div class="stepper"><button data-act="shift" data-d="-1">−</button><b>${shift > 0 ? '+' : ''}${shift}</b><button data-act="shift" data-d="1">+</button></div></div>
    <div class="kv"><label>Capo</label><div class="stepper"><button data-act="capo-x" aria-label="No capo">${ico('close')}</button><b>${capo}</b><button data-act="capo" data-d="-1">−</button><button data-act="capo" data-d="1">+</button></div></div>
    <div class="kv"><label>Show chords as</label><div class="seg"><button class="${S.settings.mode === 'letters' ? 'on' : ''}" data-act="mode" data-m="letters">Letters</button><button class="${S.settings.mode === 'numbers' ? 'on' : ''}" data-act="mode" data-m="numbers">Numbers</button></div></div>`}
    ${row ? `<div class="nns"><div class="nh">Nashville numbers in ${esc(cur)}</div><div class="ng">${row.map((c) => `<div><i>${esc(c.label)}</i><b>${esc(c.chord)}</b></div>`).join('')}</div></div>` : ''}
    <div class="btnrow"><button class="btn" data-act="reset-key">Reset</button><button class="btn primary" data-act="close-sheet">Done</button></div>`);
}
async function changeHolder(fn) {
  const song = curSong(), holder = curHolder();
  fn(song, holder);
  if (holder === song) await saveSong(song); else await saveSet(setById(S.cur.setId));
  paintSong(); openKeySheet();
}
const normShift = (n) => { n = ((n % 12) + 12) % 12; return n > 6 ? n - 12 : n; };

// ───────────────────────── Editor ─────────────────────────
function viewEdit(app, r) {
  let song = songById(r.id);
  let isNew = false;
  if (!song && S.draftNew && S.draftNew.id === r.id) { song = S.draftNew; isNew = true; }
  if (!song) { go('#/songs', true); return; }
  const draftKey = 'sb_draft_' + song.id;
  let body = song.body || '';
  const dr = lsGet(draftKey);
  if (dr != null && dr !== body && song.fmt === 'text') { body = dr; setTimeout(() => toast('Recovered your unsaved changes'), 300); }
  const pdf = song.fmt === 'pdf';
  const keyOpts = (sel) => `<option value="">Not set</option><optgroup label="Major">${KEYS_MAJ.map((k) => `<option ${k === sel ? 'selected' : ''}>${k}</option>`).join('')}</optgroup><optgroup label="Minor">${KEYS_MIN.map((k) => `<option ${k === sel ? 'selected' : ''}>${k}</option>`).join('')}</optgroup>`;
  app.innerHTML = `
  <header class="songbar glass">
    <button class="ibtn" data-act="edit-back" aria-label="Back">${ico('back')}</button>
    <div class="st"><b>${isNew ? 'New song' : 'Edit song'}</b></div>
    ${pdf ? '' : `<button class="ibtn" id="pvbtn" data-act="edit-preview" aria-label="Preview">${ico('search')}</button>`}
    <button class="ibtn accent" data-act="edit-save" aria-label="Save">${ico('check')}</button>
  </header>
  <div class="page editpage">
    <div class="field"><label>Title</label><input id="e-title" value="${esc(song.title)}" placeholder="Song title" autocomplete="off"></div>
    <div class="two"><div class="field"><label>Artist</label><input id="e-author" value="${esc(song.author)}" placeholder="Artist" autocomplete="off"></div>
    <div class="field"><label>Original key</label><select id="e-key">${keyOpts(song.key)}</select></div></div>
    ${pdf ? '<p class="muted small">This song is a PDF picture. You can change its title, artist and key.</p>' : `
    <div class="chiprow" id="chips"></div>
    <textarea id="e-body" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" placeholder="Write lyrics here.&#10;Put chords in brackets, like [G]Amazing [C]grace&#10;or on the line above the words, or use Nashville numbers (1 4 5 6m).">${esc(body)}</textarea>
    <div id="e-prev" class="sbody preview" hidden></div>`}
    ${isNew ? '' : `<div class="btnrow"><button class="btn danger" data-act="edit-trash">${ico('trash')} Move to trash</button></div>`}
  </div>`;
  S.edit = { song, isNew, draftKey, preview: false };
  if (!pdf) {
    paintChips();
    const ta = $('#e-body');
    ta.addEventListener('input', () => lsSet(draftKey, ta.value));
    $('#e-key').addEventListener('change', paintChips);
  }
}
function paintChips() {
  const box = $('#chips'); if (!box) return;
  const k = $('#e-key').value;
  const row = k ? Music.nnsRow(k) : null;
  const secs = ['Verse', 'Chorus', 'Pre-Chorus', 'Bridge', 'Intro', 'Outro', 'Tag'];
  box.innerHTML = secs.map((s) => `<button class="chip sec" data-act="ins-sec" data-v="${s}">${s}</button>`).join('') +
    (row ? row.map((c) => `<button class="chip ch" data-act="ins-chord" data-v="${esc(c.chord)}">${esc(c.chord)}</button>`).join('') : '') +
    ['1', '2m', '3m', '4', '5', '6m'].map((n) => `<button class="chip num" data-act="ins-chord" data-v="${n}">${n}</button>`).join('');
}
function insertAtCursor(text) {
  const ta = $('#e-body'); const a = ta.selectionStart, b = ta.selectionEnd;
  ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
  const p = a + text.length; ta.focus(); ta.setSelectionRange(p, p);
  lsSet(S.edit.draftKey, ta.value);
}

// ───────────────────────── Sets ─────────────────────────
function monthKey(ms) { return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function viewSets() {
  const sets = [...S.sets].sort((a, b) => b.date - a.date);
  let html = '', last = null;
  for (const s of sets) {
    const m = monthKey(s.date);
    if (m !== last) { html += `<div class="grp big">${esc(m)}</div>`; last = m; }
    const n = s.items.filter((it) => songById(it.songId) && !songById(it.songId).deleted).length;
    html += `<a class="row" href="#/set/${encodeURIComponent(s.id)}"><span class="rt"><span class="t">${esc(s.name)}</span><span class="a">${fmtDate(s.date)} · ${n} song${n === 1 ? '' : 's'}</span></span>${ico('chev', 'dim')}</a>`;
  }
  return `<header class="top"><h1>All Sets</h1><div class="acts"><button class="ibtn" data-act="new-set" aria-label="New set">${ico('plus')}</button></div></header>
    ${html || `<div class="empty"><div class="eg">${ico('sets')}</div><h2>No sets yet</h2><p>A set is your song order for a service or practice.</p><button class="btn primary" data-act="new-set">${ico('plus')} New set</button></div>`}`;
}
function viewSetDetail(id) {
  const set = setById(id);
  if (!set) return '<header class="top"><h1>Set not found</h1></header>';
  const rows = set.items.map((it, i) => {
    const s = songById(it.songId); if (!s || s.deleted) return '';
    const k = keyLabel(s, it);
    return `<div class="row srow"><a class="rt" href="#/song/${encodeURIComponent(s.id)}?set=${encodeURIComponent(set.id)}&i=${i}"><span class="t"><em>${i + 1}.</em> ${esc(s.title)}</span><span class="a">${esc(s.author || '')}</span></a>
      <span class="badges">${k ? `<i class="bd key">${esc(k)}</i>` : ''}</span>
      <span class="mv"><button class="ibtn sm" data-act="item-up" data-i="${i}" aria-label="Move up">${ico('ud')}</button><button class="ibtn sm" data-act="item-down" data-i="${i}" aria-label="Move down">${ico('dd')}</button><button class="ibtn sm" data-act="item-del" data-i="${i}" aria-label="Remove">${ico('close')}</button></span></div>`;
  }).join('');
  return `<header class="top"><a class="ibtn" href="#/sets" aria-label="Back">${ico('back')}</a><h1 class="mid">${esc(set.name)}</h1><div class="acts"><button class="ibtn" data-act="set-more" data-id="${esc(set.id)}" aria-label="More">${ico('more')}</button></div></header>
    <p class="muted small pad">${fmtDate(set.date)}</p>
    <div class="btnrow tight"><button class="btn primary" data-act="set-add" data-id="${esc(set.id)}">${ico('plus')} Add songs</button>${set.items.length ? `<a class="btn" href="#/song/${encodeURIComponent(set.items.find((it) => songById(it.songId) && !songById(it.songId).deleted)?.songId || '')}?set=${encodeURIComponent(set.id)}&i=${Math.max(0, set.items.findIndex((it) => songById(it.songId) && !songById(it.songId).deleted))}">${ico('play')} Start</a>` : ''}</div>
    <div id="setlist">${rows || '<p class="muted center pad">No songs in this set yet.</p>'}</div>`;
}
function newSetSheet(preSelect) {
  const d = new Date(); const iso = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  sheetCtx = { preSelect };
  sheet(`<div class="sh-h">New set</div>
    <div class="field"><label>Name</label><input id="ns-name" value="${d.toLocaleDateString(undefined, { weekday: 'long' })}" autocomplete="off"></div>
    <div class="field"><label>Date</label><input id="ns-date" type="date" value="${iso}"></div>
    <div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="create-set">Create</button></div>`);
}
function pickSongsSheet(setId) {
  sheetCtx = { pickSet: setId, picked: new Set(), q: '' };
  sheet(`<div class="sh-h">Add songs</div><div class="search">${ico('search')}<input id="pk-q" type="search" placeholder="Search…" autocomplete="off"></div><div id="pk-list" class="pklist"></div>
    <div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" id="pk-go" data-act="pick-go" disabled>Add</button></div>`, { full: true });
  paintPick();
}
function paintPick() {
  const c = sheetCtx; const box = $('#pk-list'); if (!box || !c) return;
  const q = norm(c.q);
  const arr = live().filter((s) => !q || norm(s.title).includes(q) || norm(s.author).includes(q)).sort((a, b) => a.title.localeCompare(b.title));
  box.innerHTML = arr.map((s) => { const on = c.picked.has(s.id); return `<button class="row pick ${on ? 'sel' : ''}" data-act="pick" data-id="${esc(s.id)}"><span class="cb ${on ? 'on' : ''}">${on ? ico('check') : ''}</span><span class="rt"><span class="t">${esc(s.title)}</span><span class="a">${esc(s.author || '')}</span></span>${s.key ? `<i class="bd key">${esc(s.key)}</i>` : ''}</button>`; }).join('');
  const b = $('#pk-go'); b.disabled = !c.picked.size; b.textContent = c.picked.size ? `Add ${c.picked.size}` : 'Add';
}
function chooseSetSheet(ids) {
  sheetCtx = { ids };
  const sets = [...S.sets].sort((a, b) => b.date - a.date);
  sheet(`<div class="sh-h">Add ${ids.length} song${ids.length === 1 ? '' : 's'} to…</div>
    <div class="pklist short">${sets.map((s) => `<button class="row" data-act="add-to" data-id="${esc(s.id)}"><span class="rt"><span class="t">${esc(s.name)}</span><span class="a">${fmtDate(s.date)} · ${s.items.length} songs</span></span></button>`).join('') || '<p class="muted center pad">No sets yet.</p>'}</div>
    <div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="new-set-with">${ico('plus')} New set</button></div>`);
}
async function addSongsToSet(setId, ids) {
  const set = setById(setId); if (!set) return;
  ids.forEach((id) => { const s = songById(id); if (s) set.items.push({ songId: id, shift: s.shift || 0, capo: s.capo || 0 }); });
  await saveSet(set);
  toast(`Added ${ids.length} to ${set.name}`);
}

// ───────────────────────── Settings / safety ─────────────────────────
function viewSettings() {
  const p = protection(); const st = S.settings;
  return `<header class="top"><h1>Settings</h1></header>
  <section class="card safety ${p.ok ? 'ok' : 'warn'}">
    <div class="sh">${ico('shield')}<div><b>${p.label}</b><span>${esc(p.note)}</span></div></div>
    <div class="stats"><div><b>${live().length}</b><span>songs</span></div><div><b>${S.sets.length}</b><span>sets</span></div><div><b id="usage">…</b><span>stored</span></div></div>
    <p class="small muted">Last backup: ${S.meta.lastBackup ? fmtTime(S.meta.lastBackup) : 'never'} · Auto-saved copy: ${S.meta.lastSnap ? fmtTime(S.meta.lastSnap) : 'none yet'}</p>
    <div class="btnrow tight"><button class="btn primary" data-act="backup-now">${ico('share')} Back up now</button><label class="btn file">${ico('up')} Restore / import<input type="file" multiple data-import></label></div>
    ${isStandalone() ? '' : '<p class="small tip"><b>iPhone:</b> tap Share ▸ <b>Add to Home Screen</b>. <b>Android / desktop:</b> use the browser’s <b>Install</b> option.</p>'}
  </section>
  <section class="card"><h3>Automatic safety copies</h3><p class="small muted">The app quietly keeps recent copies of your whole library on this device and one more before anything risky (import, restore, delete forever).</p><div id="snaplist" class="snaplist"></div></section>
  <section class="card"><h3>Trash</h3><a class="row" href="#/trash"><span class="rt"><span class="t">Deleted songs</span><span class="a">${trashed().length} in trash — restore any time</span></span>${ico('chev', 'dim')}</a></section>
  <section class="card"><h3>Display</h3>
    <div class="kv"><label>Theme</label><div class="seg">${[['night', 'Night'], ['oled', 'Black'], ['warm', 'Warm']].map(([v, l]) => `<button class="${st.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="kv"><label>Text size</label><div class="stepper"><button data-act="fs" data-d="-1">−</button><b>${st.fontSize}</b><button data-act="fs" data-d="1">+</button></div></div>
    <div class="kv"><label>Chords as</label><div class="seg"><button class="${st.mode === 'letters' ? 'on' : ''}" data-act="mode" data-m="letters">Letters</button><button class="${st.mode === 'numbers' ? 'on' : ''}" data-act="mode" data-m="numbers">Numbers</button></div></div>
    <div class="kv"><label>Dim PDFs for dark mode</label><button class="sw ${st.invertPdf ? 'on' : ''}" data-act="sw" data-k="invertPdf" aria-label="toggle"></button></div>
    <div class="kv"><label>Keep screen awake</label><button class="sw ${st.wake ? 'on' : ''}" data-act="sw" data-k="wake" aria-label="toggle"></button></div>
    <div class="kv"><label>Auto-scroll speed</label><div class="stepper"><button data-act="spd" data-d="-1">−</button><b>${st.scrollSpeed}</b><button data-act="spd" data-d="1">+</button></div></div>
  </section>
  <section class="card"><h3>Storage</h3><div class="btnrow tight"><button class="btn" data-act="free-space">Free up space</button><button class="btn" data-act="check-update">Check for update</button></div><p class="small muted">Songbook v${window.SB_VERSION || '1'} · works fully offline.</p></section>`;
}
async function paintSettingsAsync() {
  try { const e = await navigator.storage.estimate(); const u = $('#usage'); if (u) u.textContent = fmtBytes(e.usage || 0); } catch (_) { const u = $('#usage'); if (u) u.textContent = '—'; }
  const box = $('#snaplist'); if (!box) return;
  const snaps = (await DB.all('snaps')).sort((a, b) => b.time - a.time).slice(0, 8);
  box.innerHTML = snaps.length ? snaps.map((s) => `<div class="row"><span class="rt"><span class="t">${fmtTime(s.time)}</span><span class="a">${s.songs.filter((x) => !x.deleted).length} songs · ${s.sets.length} sets · ${esc(s.reason)}</span></span><button class="btn sm" data-act="snap-restore" data-id="${esc(s.id)}">${ico('restore')} Restore</button></div>`).join('') : '<p class="small muted">None yet — the first one is made right after your first change.</p>';
}
function viewTrash() {
  const t = trashed().sort((a, b) => b.deleted - a.deleted);
  return `<header class="top"><a class="ibtn" href="#/settings" aria-label="Back">${ico('back')}</a><h1 class="mid">Trash</h1><div class="acts">${t.length ? `<button class="ibtn" data-act="empty-trash" aria-label="Empty trash">${ico('trash')}</button>` : ''}</div></header>
  ${t.map((s) => `<div class="row"><span class="rt"><span class="t">${esc(s.title)}</span><span class="a">Deleted ${fmtDate(s.deleted)}</span></span><button class="btn sm" data-act="untrash" data-id="${esc(s.id)}">${ico('restore')} Restore</button><button class="ibtn sm" data-act="purge" data-id="${esc(s.id)}" aria-label="Delete forever">${ico('close')}</button></div>`).join('') || '<p class="muted center pad">Trash is empty.</p>'}`;
}

// ───────────────────────── Import / export (.sbp) ─────────────────────────
async function importFiles(fileList) {
  const files = [...fileList]; if (!files.length) return;
  toast('Reading…', 8000);
  const pdfs = [], texts = [];
  for (const f of files) {
    const n = f.name.toLowerCase();
    try {
      if (/\.pdf$/.test(n)) pdfs.push(f);
      else if (/\.(txt|cho|crd|chopro|chordpro|pro)$/.test(n)) texts.push(f);
      else {
        // .sbp, .zip, or anything else: try as a backup
        const pack = await readSbp(f);
        await importPackSheet(pack, f.name); // one backup at a time
        if (pdfs.length || texts.length) toast('Backup selected — add the other files after it is imported.', 5000);
        return;
      }
    } catch (e) { toast(`${f.name}: ${e.message || 'could not read'}`, 5000); return; }
  }
  let added = 0;
  if (pdfs.length || texts.length) await takeSnapshot('before import', true);
  for (const f of pdfs) { await addPdfSong(f); added++; }
  for (const f of texts) { await addTextSong(f); added++; }
  if (added) { toast(`Added ${added} song${added === 1 ? '' : 's'}`); render(); }
}
const stripExt = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
async function addPdfSong(f) {
  const buf = await f.arrayBuffer();
  const hash = MD5.bytes(new Uint8Array(buf));
  const dupe = S.songs.find((s) => s.hash === hash && !s.deleted);
  if (dupe) { toast(`"${dupe.title}" is already in your songbook`); return; }
  const rec = newSong({ title: stripExt(f.name), fmt: 'pdf', pdfId: uid(), pdfFile: f.name, hash });
  await DB.put('blobs', { id: rec.pdfId, data: buf });
  rec.key = Music.keyFromTitle(rec.title) || (await pdfKey(buf)) || '';
  await saveSong(rec);
}
async function addTextSong(f) {
  const body = await f.text();
  const c = Music.collectChords(body);
  const dir = /\{\s*key\s*:\s*([A-G][#b]?m?)\s*\}/i.exec(body);
  const rec = newSong({ title: stripExt(f.name), fmt: 'text', body, hash: MD5.text(body) });
  rec.key = (dir && dir[1]) || Music.inferKey(c.letters);
  await saveSong(rec);
}
function newSong(o) {
  return Object.assign({ id: uid(), title: '', author: '', key: '', shift: 0, capo: 0, fmt: 'text', body: '', tags: [], deleted: 0, modified: now(), hash: '', raw: {} }, o);
}
async function pdfKey(buf) {
  try {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const page = await doc.getPage(1); const tc = await page.getTextContent();
    return Music.keyFromText(tc.items.map((i) => i.str).join(' '));
  } catch (_) { return ''; }
}

const EXTRA_DROP = new Set(['content', 'name', 'author', 'Capo', 'KeyShift', 'Deleted', 'key', 'Id', 'ModifiedDateTime', '_tags', 'hash', 'DeepSearch', 'type']);
async function readSbp(file) {
  const zip = await JSZip.loadAsync(file);
  const df = zip.file('dataFile.txt');
  if (!df) throw new Error('This is not a SongbookPro backup');
  const txt = await df.async('string');
  const data = JSON.parse(txt.slice(txt.indexOf('\n') + 1));
  if (!data || !Array.isArray(data.songs)) throw new Error('Backup looks damaged');
  return { zip, data };
}
async function sbpSong(s, zip) {
  const isPdf = s.type === 2 || /\.pdf$/i.test(s.content || '');
  const rec = newSong({
    title: s.name || 'Untitled', author: s.author || '', shift: s.KeyShift || 0, capo: s.Capo || 0,
    fmt: isPdf ? 'pdf' : 'text', tags: safeJson(s._tags, []), deleted: s.Deleted ? now() : 0,
    modified: Date.parse(s.ModifiedDateTime) || now(), origId: s.Id,
  });
  rec.raw = {}; Object.keys(s).forEach((k) => { if (!EXTRA_DROP.has(k)) rec.raw[k] = s[k]; });
  if (isPdf) {
    const f = zip.file('pdf/' + s.content); if (!f) return null;
    rec._buf = await f.async('arraybuffer'); rec.pdfId = uid(); rec.pdfFile = s.content;
    rec.hash = MD5.bytes(new Uint8Array(rec._buf));
  } else { rec.body = s.content || ''; rec.hash = MD5.text(rec.body); }
  let k = s.key === 0 ? '' : Music.keyFromSbpIndex(s.key); // 0 is SongbookPro's "unset" default
  if (!k) k = Music.keyFromTitle(rec.title);
  if (!k && !isPdf) k = Music.inferKey(Music.collectChords(rec.body).letters);
  if (!k && isPdf) k = await pdfKey(rec._buf);
  rec.key = k || '';
  return rec;
}
async function importPackSheet(pack, name) {
  const { data } = pack;
  $('#toast').classList.remove('on');
  const total = data.songs.length, pdfN = data.songs.filter((s) => s.type === 2).length;
  const have = new Set(S.songs.map((s) => s.hash));
  sheetCtx = { pack, mode: 'add' };
  sheet(`<div class="sh-h">Import backup</div>
    <p class="muted small">${esc(name)}</p>
    <div class="stats"><div><b>${total}</b><span>songs</span></div><div><b>${pdfN}</b><span>PDFs</span></div><div><b>${(data.sets || []).length}</b><span>sets</span></div></div>
    <div class="choice on" data-act="imp-mode" data-m="add"><b>Add to my songbook</b><span>Keeps everything you have. Songs you already have are skipped.</span></div>
    <div class="choice" data-act="imp-mode" data-m="replace"><b>Replace everything</b><span>Makes your library exactly match this backup. A safety copy of your current library is saved first.</span></div>
    <div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="imp-go">Import</button></div>`);
}
async function runImport(pack, mode) {
  const { zip, data } = pack;
  toast('Importing… please wait', 60000);
  await takeSnapshot(mode === 'replace' ? 'before replace' : 'before import', true);
  const map = new Map(); // origId -> id
  const recs = [];
  let skipped = 0;
  const byHash = new Map(); if (mode === 'add') S.songs.forEach((s) => byHash.set(s.hash, s));
  for (const s of data.songs) {
    const rec = await sbpSong(s, zip);
    if (!rec) { skipped++; continue; }
    const ex = byHash.get(rec.hash);
    if (ex) { map.set(s.Id, ex.id); skipped++; continue; }
    byHash.set(rec.hash, rec); map.set(s.Id, rec.id); recs.push(rec);
  }
  for (const r of recs) if (r.fmt === 'pdf') { await DB.put('blobs', { id: r.pdfId, data: r._buf }); delete r._buf; }
  const sets = [];
  for (const st of data.sets || []) {
    const d = st.details || {}; if (d.Deleted) continue;
    const items = (st.contents || []).filter((c) => !c.Deleted && map.has(c.SongId)).sort((a, b) => a.Order - b.Order)
      .map((c) => ({ songId: map.get(c.SongId), shift: c.keyOfset || 0, capo: c.Capo || 0 }));
    const date = Date.parse(d.date) || now();
    if (mode === 'add' && S.sets.some((x) => x.name === d.name && Math.abs(x.date - date) < 864e5)) continue;
    sets.push({ id: uid(), name: d.name || 'Imported set', date, items, modified: now() });
  }
  if (mode === 'replace') {
    await DB.replaceLibrary(recs, sets);
    S.songs = recs; S.sets = sets;
  } else {
    await DB.putMany('songs', recs); await DB.putMany('sets', sets);
    S.songs.push(...recs); S.sets.push(...sets);
  }
  S.dirtySnap = true; S.meta.editsSinceBackup = 0; await DB.setMeta('editsSinceBackup', 0);
  await takeSnapshot('after import', true);
  toast(`Imported ${recs.length} song${recs.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} already here` : ''}`, 4500);
  render();
}

async function buildSbp() {
  const zip = new JSZip();
  const idOf = new Map(); S.songs.forEach((s, i) => idOf.set(s.id, i + 1));
  const songs = [];
  for (const s of S.songs) {
    const isPdf = s.fmt === 'pdf';
    let content = s.body || '';
    if (isPdf) {
      content = (s.pdfFile && /\.pdf$/i.test(s.pdfFile) ? s.pdfFile : s.pdfId + '.pdf');
      const rec = await DB.get('blobs', s.pdfId);
      if (rec) zip.file('pdf/' + content, rec.data);
    }
    songs.push(Object.assign({
      Id: idOf.get(s.id), author: s.author || '', Capo: s.capo || 0, content, hash: s.hash || '', key: Music.sbpIndexFromKey(s.key),
      KeyShift: s.shift || 0, name: s.title, subTitle: '', type: isPdf ? 2 : 1, ModifiedDateTime: new Date(s.modified).toISOString(), Deleted: !!s.deleted,
      SyncId: '', timeSig: '', ZoomFactor: 1.0, Duration: 0, Duration2: 0, _displayParams: '{}', TempoInt: 0, _tags: JSON.stringify(s.tags || []), Url: '',
      DeepSearch: `${norm(s.title)}\n${norm(s.author)}\n`, Copyright: '', NotesText: '', Zoom: 1.0, SectionOrder: '', SongNumber: 0, HasChildren: 0, ParentId: 0,
      vName: null, locked: 0, LinkedAudio: null, Chords: null, midiOnLoad: null, importSource: null, _folders: '[]', drawingPathsBackup: null,
    }, s.raw || {}, {
      Id: idOf.get(s.id), author: s.author || '', Capo: s.capo || 0, content, hash: s.hash || '', key: Music.sbpIndexFromKey(s.key), KeyShift: s.shift || 0,
      name: s.title, type: isPdf ? 2 : 1, Deleted: !!s.deleted, ModifiedDateTime: new Date(s.modified).toISOString(), _tags: JSON.stringify(s.tags || []),
    }));
  }
  const sets = S.sets.map((st, si) => ({
    details: { Id: si + 1, name: st.name, date: new Date(st.date).toISOString().replace('Z', ''), ModifiedDateTime: new Date(st.modified || now()).toISOString(), Deleted: 0, SyncId: '', pinned: 0 },
    contents: st.items.filter((it) => idOf.has(it.songId)).map((it, i) => ({
      Id: si * 1000 + i + 1, Order: i, Capo: it.capo || 0, SetId: si + 1, SongId: idOf.get(it.songId), keyOfset: it.shift || 0,
      ModifiedDateTime: new Date(st.modified || now()).toISOString(), Deleted: 0, SyncId: '', NotesText: null, SectionOrder: '', ItemType: 1, Content: '', drawingPathsBackup: null,
    })),
  }));
  const txt = '1.0\n' + JSON.stringify({ songs, sets, folders: [] });
  zip.file('dataFile.txt', txt);
  zip.file('dataFile.hash', MD5.text(txt));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
async function backupNow() {
  toast('Preparing backup…', 15000);
  try {
    const blob = await buildSbp();
    const name = `Songbook-${new Date().toISOString().slice(0, 10)}.sbp`;
    const file = new File([blob], name, { type: 'application/zip' });
    let done = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Songbook backup' }); done = true; }
      catch (e) { if (e && e.name === 'AbortError') { toast('Backup cancelled'); return; } }
    }
    if (!done) { download(blob, name); done = true; }
    S.meta.lastBackup = now(); S.meta.editsSinceBackup = 0;
    await DB.setMeta('lastBackup', S.meta.lastBackup); await DB.setMeta('editsSinceBackup', 0);
    toast('Backup ready — keep it in Files, iCloud Drive or send it to yourself', 5000);
    if (['settings', 'songs'].includes(route().name)) render();
  } catch (e) { toast('Backup failed: ' + (e.message || e), 5000); }
}
async function restoreSnapshot(id) {
  const snap = await DB.get('snaps', id); if (!snap) return;
  await takeSnapshot('before restore', true);
  await DB.replaceLibrary(snap.songs, snap.sets);
  S.songs = snap.songs; S.sets = snap.sets; S.dirtySnap = true;
  toast('Restored'); render();
}
async function freeSpace() {
  const keep = new Set(S.songs.map((s) => s.pdfId).filter(Boolean));
  (await DB.all('snaps')).forEach((sn) => sn.songs.forEach((s) => s.pdfId && keep.add(s.pdfId)));
  const orphan = (await DB.keys('blobs')).filter((k) => !keep.has(k));
  if (orphan.length) await DB.delMany('blobs', orphan);
  toast(orphan.length ? `Freed ${orphan.length} unused file${orphan.length === 1 ? '' : 's'}` : 'Nothing to clean up');
}

// ───────────────────────── actions ─────────────────────────
const A = {
  'close-sheet': () => closeSheet(),
  'confirm-ok': async () => { const f = sheetCtx && sheetCtx.onOk; closeSheet(); if (f) await f(); },
  'new-song': () => { const s = newSong({}); S.draftNew = s; go('#/edit/' + encodeURIComponent(s.id)); },
  'toggle-select': () => { S.ui.select = S.ui.select ? null : new Set(); render(); },
  'select-all': () => { S.ui.select = new Set(filteredSongs().map((s) => s.id)); renderList(); },
  'clear-q': () => { S.ui.q = ''; const i = $('#q'); if (i) i.value = ''; renderList(); },
  'filter': (el) => { S.ui.filter = el.dataset.v; $$('.filters .seg button').forEach((b) => b.classList.toggle('on', b === el)); renderList(); },
  'backup-now': () => backupNow(),
  'add-to-set': () => chooseSetSheet([...S.ui.select]),
  'add-to': async (el) => { const ids = sheetCtx.ids; closeSheet(); await addSongsToSet(el.dataset.id, ids); S.ui.select = null; render(); },
  'new-set-with': () => newSetSheet(sheetCtx.ids),
  'new-set': () => newSetSheet(null),
  'create-set': async () => {
    const name = $('#ns-name').value.trim() || 'Set'; const date = Date.parse($('#ns-date').value) || now();
    const pre = sheetCtx && sheetCtx.preSelect;
    const set = { id: uid(), name, date, items: [], modified: now() };
    await saveSet(set);
    if (pre) { await addSongsToSet(set.id, pre); S.ui.select = null; }
    closeSheet(); go('#/set/' + encodeURIComponent(set.id));
  },
  'set-add': (el) => pickSongsSheet(el.dataset.id),
  'pick': (el) => { const c = sheetCtx; const id = el.dataset.id; c.picked.has(id) ? c.picked.delete(id) : c.picked.add(id); paintPick(); },
  'pick-go': async () => { const c = sheetCtx; const ids = [...c.picked]; const sid = c.pickSet; closeSheet(); await addSongsToSet(sid, ids); render(); },
  'item-up': async (el) => moveItem(el.dataset.i | 0, -1),
  'item-down': async (el) => moveItem(el.dataset.i | 0, 1),
  'item-del': async (el) => { const r = route(); const set = setById(r.id); set.items.splice(el.dataset.i | 0, 1); await saveSet(set); render(); },
  'set-more': (el) => {
    sheet(`<div class="sh-h">Set</div><button class="row" data-act="set-rename" data-id="${esc(el.dataset.id)}"><span class="rt"><span class="t">Rename</span></span></button>
      <button class="row" data-act="set-dup" data-id="${esc(el.dataset.id)}"><span class="rt"><span class="t">Duplicate</span></span></button>
      <button class="row danger" data-act="set-del" data-id="${esc(el.dataset.id)}"><span class="rt"><span class="t">Delete set</span></span></button>`);
  },
  'set-rename': (el) => { const set = setById(el.dataset.id); sheetCtx = { setId: set.id }; sheet(`<div class="sh-h">Rename set</div><div class="field"><input id="rn" value="${esc(set.name)}"></div><div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="rename-go">Save</button></div>`); },
  'rename-go': async () => { const set = setById(sheetCtx.setId); set.name = $('#rn').value.trim() || set.name; await saveSet(set); closeSheet(); render(); },
  'set-dup': async (el) => { const o = setById(el.dataset.id); const n = { ...JSON.parse(JSON.stringify(o)), id: uid(), name: o.name + ' copy' }; await saveSet(n); closeSheet(); go('#/set/' + encodeURIComponent(n.id)); },
  'set-del': (el) => { const id = el.dataset.id; confirmBox('Delete this set?', 'The songs stay in your songbook. Only the set is removed.', 'Delete set', async () => { await takeSnapshot('before delete', true); await DB.del('sets', id); S.sets = S.sets.filter((s) => s.id !== id); S.dirtySnap = true; markDirty(); go('#/sets'); }, true); },
  // song view
  'song-back': () => { const c = S.cur; if (c && c.setId && setById(c.setId)) go('#/set/' + encodeURIComponent(c.setId)); else go('#/songs'); },
  'song-edit': () => go('#/edit/' + encodeURIComponent(S.cur.songId)),
  'song-more': () => {
    const s = curSong();
    sheet(`<div class="sh-h">${esc(s.title)}</div>
      <button class="row" data-act="song-addset"><span class="rt"><span class="t">Add to a set…</span></span></button>
      <button class="row" data-act="song-dup"><span class="rt"><span class="t">Duplicate</span></span></button>
      <button class="row" data-act="song-edit"><span class="rt"><span class="t">Edit</span></span></button>
      <button class="row danger" data-act="song-trash"><span class="rt"><span class="t">Move to trash</span></span></button>`);
  },
  'song-addset': () => chooseSetSheet([S.cur.songId]),
  'song-dup': async () => { const o = curSong(); const n = { ...o, id: uid(), title: o.title + ' copy', modified: now() }; if (o.fmt === 'pdf') { const b = await DB.get('blobs', o.pdfId); n.pdfId = uid(); if (b) await DB.put('blobs', { id: n.pdfId, data: b.data }); } await saveSong(n); closeSheet(); toast('Duplicated'); go('#/song/' + encodeURIComponent(n.id)); },
  'song-trash': async () => { const s = curSong(); s.deleted = now(); await saveSong(s); toast('Moved to trash'); A['song-back'](); },
  'open-key': () => openKeySheet(),
  'shift': (el) => changeHolder((s, h) => { if (!s.key) { toast('Set the key first'); return; } h.shift = normShift((h.shift || 0) + (+el.dataset.d)); }),
  'capo': (el) => changeHolder((s, h) => { h.capo = Math.max(0, Math.min(11, (h.capo || 0) + (+el.dataset.d))); }),
  'capo-x': () => changeHolder((s, h) => { h.capo = 0; }),
  'reset-key': () => changeHolder((s, h) => { h.shift = 0; h.capo = 0; }),
  'mode': async (el) => { S.settings.mode = el.dataset.m; await saveSettings(); if (route().name === 'song') { paintSong(); openKeySheet(); } else render(); },
  'toggle-mode': async () => { S.settings.mode = S.settings.mode === 'numbers' ? 'letters' : 'numbers'; await saveSettings(); paintSong(); },
  'toggle-chords': async () => { S.settings.chords = !S.settings.chords; await saveSettings(); paintSong(); },
  'font+': async () => fontStep(1), 'font-': async () => fontStep(-1),
  'autoscroll': () => { if (autoRaf) stopScroll(); else startScroll(); paintSong(); },
  'set-prev': () => setStep(-1), 'set-next': () => setStep(1),
  // editor
  'edit-back': () => { const c = S.edit; if (c && !c.isNew) go('#/song/' + encodeURIComponent(c.song.id)); else go('#/songs'); },
  'edit-preview': () => {
    const c = S.edit; c.preview = !c.preview; const ta = $('#e-body'), pv = $('#e-prev');
    if (c.preview) { const tmp = { ...c.song, body: ta.value, key: $('#e-key').value, fmt: 'text' }; pv.innerHTML = renderBody(tmp, { shift: 0, capo: 0 }); pv.style.setProperty('--fs', S.settings.fontSize + 'px'); }
    ta.hidden = c.preview; pv.hidden = !c.preview; $('#chips').hidden = c.preview;
  },
  'ins-sec': (el) => { const ta = $('#e-body'); const pre = ta.selectionStart > 0 && ta.value[ta.selectionStart - 1] !== '\n' ? '\n' : ''; insertAtCursor(`${pre}{c: ${el.dataset.v}}\n`); },
  'ins-chord': (el) => insertAtCursor(`[${el.dataset.v}]`),
  'edit-save': async () => {
    const c = S.edit; const s = c.song;
    const title = $('#e-title').value.trim();
    if (!title) { toast('Give the song a title'); return; }
    s.title = title; s.author = $('#e-author').value.trim();
    const newKey = $('#e-key').value; if (newKey !== s.key) { s.key = newKey; if (!newKey) s.shift = 0; }
    if (s.fmt === 'text') { s.body = $('#e-body').value; s.hash = MD5.text(s.body); }
    await saveSong(s); lsDel(c.draftKey); S.draftNew = null;
    toast('Saved'); go('#/song/' + encodeURIComponent(s.id), true);
  },
  'edit-trash': () => { const s = S.edit.song; confirmBox('Move to trash?', 'You can bring it back from Settings ▸ Trash.', 'Move to trash', async () => { s.deleted = now(); await saveSong(s); lsDel(S.edit.draftKey); go('#/songs'); }, true); },
  // settings
  'theme': async (el) => { S.settings.theme = el.dataset.v; document.documentElement.dataset.theme = el.dataset.v; await saveSettings(); render(); },
  'fs': async (el) => { S.settings.fontSize = Math.max(13, Math.min(34, S.settings.fontSize + (+el.dataset.d))); await saveSettings(); render(); },
  'spd': async (el) => { S.settings.scrollSpeed = Math.max(1, Math.min(5, S.settings.scrollSpeed + (+el.dataset.d))); await saveSettings(); render(); },
  'sw': async (el) => { const k = el.dataset.k; S.settings[k] = !S.settings[k]; await saveSettings(); render(); },
  'snap-restore': (el) => { const id = el.dataset.id; confirmBox('Restore this copy?', 'Your library will go back to how it was then. Your current library is saved as another safety copy first, so you can undo this.', 'Restore', () => restoreSnapshot(id)); },
  'untrash': async (el) => { const s = songById(el.dataset.id); s.deleted = 0; await saveSong(s); toast('Restored'); render(); },
  'purge': (el) => { const id = el.dataset.id; confirmBox('Delete forever?', 'This song will be removed from your songbook. A safety copy is saved first.', 'Delete', async () => { await takeSnapshot('before delete', true); await DB.del('songs', id); S.songs = S.songs.filter((s) => s.id !== id); S.dirtySnap = true; render(); }, true); },
  'empty-trash': () => confirmBox('Empty trash?', `${trashed().length} songs will be removed. A safety copy is saved first.`, 'Empty trash', async () => { await takeSnapshot('before delete', true); const ids = trashed().map((s) => s.id); await DB.delMany('songs', ids); S.songs = S.songs.filter((s) => !s.deleted); S.dirtySnap = true; render(); }, true),
  'free-space': () => freeSpace(),
  'check-update': async () => { try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); toast('You have the latest version'); } catch (_) { toast('Could not check right now'); } },
  'imp-mode': (el) => { sheetCtx.mode = el.dataset.m; $$('.choice').forEach((c) => c.classList.toggle('on', c === el)); },
  'imp-go': () => {
    const { pack, mode } = sheetCtx;
    if (mode === 'replace') confirmBox('Replace everything?', 'Your current songs and sets will be replaced by the backup. A safety copy is kept so you can undo it.', 'Replace', () => runImport(pack, 'replace'), true);
    else { closeSheet(); runImport(pack, 'add'); }
  },
};
async function moveItem(i, d) {
  const r = route(); const set = setById(r.id); const j = i + d;
  if (j < 0 || j >= set.items.length) return;
  [set.items[i], set.items[j]] = [set.items[j], set.items[i]];
  await saveSet(set); render();
}
async function fontStep(d) {
  const c = S.cur && songById(S.cur.songId);
  if (c && c.fmt === 'pdf') { S.settings.pdfZoom = Math.max(60, Math.min(260, S.settings.pdfZoom + d * 15)); await saveSettings(); paintSong(); return; }
  S.settings.fontSize = Math.max(13, Math.min(34, S.settings.fontSize + d)); await saveSettings();
  $('#songbody').style.setProperty('--fs', S.settings.fontSize + 'px');
}

document.addEventListener('click', async (e) => {
  const imp = e.target.closest('input[data-import]'); if (imp) return;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  try { await fn(el, e); } catch (err) { console.error(err); toast('Something went wrong: ' + (err.message || err), 5000); }
});
document.addEventListener('click', (e) => {
  const row = e.target.closest('a.row[data-id]');
  if (row && S.ui.select) { e.preventDefault(); const id = row.dataset.id; S.ui.select.has(id) ? S.ui.select.delete(id) : S.ui.select.add(id); renderList(); }
}, true);
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { S.ui.q = e.target.value; renderList(); }
  if (e.target.id === 'pk-q' && sheetCtx) { sheetCtx.q = e.target.value; paintPick(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'sort') { S.ui.sort = t.value; renderList(); }
  if (t.dataset && t.dataset.import !== undefined) { const files = t.files; await importFiles(files); t.value = ''; }
  if (t.dataset && t.dataset.chg === 'set-key') {
    const target = Music.parseKey(t.value);
    await changeHolder((s, h) => {
      if (!target) { s.key = ''; h.shift = 0; return; }
      const o = Music.parseKey(s.key);
      if (!o) { s.key = t.value; if (h !== s) h.shift = 0; else s.shift = 0; return; }
      h.shift = normShift(target.pc - o.pc);
    });
  }
});
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => {
  if (!e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return;
  e.preventDefault(); if (ev === 'drop') importFiles(e.dataTransfer.files);
}));
window.addEventListener('hashchange', () => { render(); if (route().name === 'settings') paintSettingsAsync(); });
window.addEventListener('pagehide', () => { if (S.dirtySnap) takeSnapshot('auto').catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.dirtySnap) takeSnapshot('auto').catch(() => {}); });

// ───────────────────────── boot ─────────────────────────
const _render = render;
render = function () { _render(); if (route().name === 'settings') paintSettingsAsync(); }; // eslint-disable-line no-func-assign

async function boot() {
  try {
    await DB.open();
    S.songs = await DB.all('songs'); S.sets = await DB.all('sets');
    S.settings = Object.assign({}, DEFAULTS, await DB.getMeta('settings', {}));
    S.meta.lastBackup = await DB.getMeta('lastBackup', 0);
    S.meta.editsSinceBackup = await DB.getMeta('editsSinceBackup', 0);
    S.meta.lastSnap = await DB.getMeta('lastSnap', 0);
  } catch (e) {
    $('#app').innerHTML = `<div class="empty"><h2>Storage is unavailable</h2><p>${esc(e.message || e)}. Open the app from your Home Screen, or allow site data for this page.</p></div>`;
    return;
  }
  document.documentElement.dataset.theme = S.settings.theme;
  await requestPersist();
  render();
  if (S.songs.length && (!S.meta.lastSnap || now() - S.meta.lastSnap > 6 * 36e5)) { S.dirtySnap = true; takeSnapshot('daily').catch(() => {}); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready — it will apply next time you open the app', 6000); });
      });
    }).catch(() => {});
  }
}
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
window.SB = { S, A, render }; // handy for debugging/tests
boot();
})();
