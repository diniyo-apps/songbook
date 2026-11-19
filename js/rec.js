/* Songbook — voice recorder for each song: record / pause / stop, saved with the song, play back, rename, share, delete. */
(() => {
'use strict';
const X = window.SBX; if (!X) return;
const { S, A, $, $$, esc, ico, IC, sheet, closeSheet, toast, confirmBox, curSong, saveSong, DB, uid, now, route, fmtTime } = X;

Object.assign(IC, {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  recdot: '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
});

const R = { state: 'idle', mr: null, chunks: [], stream: null, t0: 0, acc: 0, songId: null, tick: 0 };
const P = { id: null, audio: null, url: null };
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };
const elapsed = () => R.acc + (R.state === 'rec' ? now() - R.t0 : 0);
const mimeList = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
const pickMime = () => (window.MediaRecorder && MediaRecorder.isTypeSupported ? mimeList.find((m) => MediaRecorder.isTypeSupported(m)) || '' : '');
const extOf = (mime) => (/mp4|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /mpeg/.test(mime) ? 'mp3' : 'webm');
const safe = (t) => String(t || 'recording').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'recording';
const song = () => curSong();
const ownerOf = (id) => S.songs.find((x) => (x.recs || []).some((r) => r.id === id));
const onRecPage = () => route().name === 'recordings';
const after = () => { if (onRecPage()) { closeSheet(); X.render(); } else openSheet(); };

// ───────── recording ─────────
async function start() {
  const sg = song(); if (!sg) return;
  if (R.state !== 'idle') return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('This browser cannot record audio'); return; }
  stopPlayback();
  try {
    R.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (_) { toast('Microphone is blocked. Allow it in your browser settings.', 4500); return; }
  const mime = pickMime();
  try { R.mr = new MediaRecorder(R.stream, mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : {}); }
  catch (_) { try { R.mr = new MediaRecorder(R.stream); } catch (e) { toast('Could not start recording'); releaseStream(); return; } }
  R.chunks = []; R.acc = 0; R.t0 = now(); R.songId = sg.id; R.state = 'rec';
  R.mr.ondataavailable = (e) => { if (e.data && e.data.size) R.chunks.push(e.data); };
  R.mr.start(1000);
  clearInterval(R.tick); R.tick = setInterval(tickTime, 250);
  refresh();
}
function pause() { if (R.state !== 'rec') return; try { R.mr.pause(); } catch (_) { return; } R.acc += now() - R.t0; R.state = 'paused'; refresh(); }
function resume() { if (R.state !== 'paused') return; try { R.mr.resume(); } catch (_) { return; } R.t0 = now(); R.state = 'rec'; refresh(); }
function releaseStream() { if (R.stream) R.stream.getTracks().forEach((t) => t.stop()); R.stream = null; }
async function stop(silent) {
  if (R.state === 'idle' || !R.mr) return;
  const dur = elapsed(), sid = R.songId, mr = R.mr, mime = mr.mimeType || pickMime() || 'audio/webm';
  const done = new Promise((res) => { mr.onstop = res; });
  clearInterval(R.tick); R.state = 'idle';
  try { if (mr.state !== 'inactive') mr.stop(); } catch (_) {}
  await done; releaseStream();
  const blob = new Blob(R.chunks, { type: mime }); R.chunks = []; R.mr = null;
  const sg = S.songs.find((s) => s.id === sid);
  if (!sg || blob.size < 500) { refresh(); if (!silent) toast('Nothing was recorded'); return; }
  try {
    const id = 'rec-' + uid();
    await DB.put('blobs', { id, data: await blob.arrayBuffer() });
    sg.recCount = (sg.recCount || 0) + 1;
    sg.recs = sg.recs || [];
    sg.recs.push({ id, name: `${sg.title} - ${sg.recCount}`, dur, size: blob.size, mime, created: now() });
    await saveSong(sg);
    toast(`Saved “${sg.recs[sg.recs.length - 1].name}”`);
  } catch (_) { toast('Could not save the recording. Storage may be full.', 5000); }
  refresh();
}
function tickTime() {
  $$('.rectime').forEach((e) => { e.textContent = fmtDur(elapsed()); });
}

// ───────── playback ─────────
function stopPlayback() {
  if (P.audio) { try { P.audio.pause(); } catch (_) {} P.audio.src = ''; }
  if (P.url) URL.revokeObjectURL(P.url);
  P.id = null; P.audio = null; P.url = null;
}
async function play(id) {
  if (P.id === id && P.audio) { if (P.audio.paused) P.audio.play(); else P.audio.pause(); syncRows(); return; }
  stopPlayback();
  const sg = ownerOf(id), meta = sg && (sg.recs || []).find((r) => r.id === id); if (!meta) return;
  const rec = await DB.get('blobs', id); if (!rec) { toast('Recording file not found'); return; }
  const url = URL.createObjectURL(new Blob([rec.data], { type: meta.mime || 'audio/mp4' }));
  const a = new Audio(url); P.id = id; P.audio = a; P.url = url;
  a.addEventListener('timeupdate', syncRows); a.addEventListener('ended', () => { a.currentTime = 0; syncRows(); }); a.addEventListener('pause', syncRows); a.addEventListener('play', syncRows);
  try { await a.play(); } catch (_) { toast('Tap play again'); }
  syncRows();
}
function syncRows() {
  $$('.recrow').forEach((row) => {
    const on = P.id === row.dataset.id && P.audio, playing = on && !P.audio.paused;
    const b = row.querySelector('.rplay'); if (b) b.innerHTML = ico(playing ? 'pause' : 'play');
    const rg = row.querySelector('.recseek'), tm = row.querySelector('.rectm'), own = ownerOf(row.dataset.id), meta = own && own.recs.find((r) => r.id === row.dataset.id);
    const dur = on && isFinite(P.audio.duration) && P.audio.duration > 0 ? P.audio.duration * 1000 : (meta ? meta.dur : 0);
    if (rg) { rg.max = String(Math.max(1, Math.round(dur))); rg.value = on ? String(Math.round(P.audio.currentTime * 1000)) : '0'; }
    if (tm) tm.textContent = (on ? fmtDur(P.audio.currentTime * 1000) : '0:00') + ' / ' + fmtDur(dur);
    row.classList.toggle('playing', !!playing);
  });
}

// ───────── UI ─────────
function ctlHtml() {
  if (R.state === 'idle') return `<button class="btn primary recgo" data-act="rec-start">${ico('recdot')} Record</button>`;
  return `<div class="recctl"><span class="recdot ${R.state === 'rec' ? 'live' : ''}"></span><b class="rectime">${fmtDur(elapsed())}</b>
    <button class="btn" data-act="${R.state === 'rec' ? 'rec-pause' : 'rec-resume'}">${ico(R.state === 'rec' ? 'pause' : 'play')} ${R.state === 'rec' ? 'Pause' : 'Resume'}</button>
    <button class="btn danger" data-act="rec-stop">${ico('stop')} Stop &amp; save</button></div>`;
}
function recRow(r, sg, withSong) {
  return `<div class="recrow" data-id="${esc(r.id)}">
    <div class="rtop"><button class="ibtn rplay" data-act="rec-play" data-id="${esc(r.id)}" aria-label="Play">${ico('play')}</button>
      <div class="rname"><b>${esc(r.name)}</b><small>${esc(fmtTime(r.created))} · ${fmtDur(r.dur)} · ${Math.max(1, Math.round(r.size / 1024))} KB</small></div>
      <button class="ibtn sm" data-act="rec-rename" data-id="${esc(r.id)}" aria-label="Rename">${ico('edit')}</button>
      <button class="ibtn sm" data-act="rec-share" data-id="${esc(r.id)}" aria-label="Share">${ico('share')}</button>
      <button class="ibtn sm" data-act="rec-del" data-id="${esc(r.id)}" aria-label="Delete">${ico('trash')}</button></div>
    <div class="rseek"><input type="range" class="recseek" min="0" max="${Math.max(1, Math.round(r.dur))}" value="0" data-id="${esc(r.id)}" aria-label="Seek"><span class="rectm">0:00 / ${fmtDur(r.dur)}</span></div></div>`;
}
function rowsHtml(sg) {
  const list = (sg.recs || []).slice().reverse();
  if (!list.length) return '<p class="muted center pad">No recordings yet. Press Record, play your part, then Stop &amp; save.</p>';
  return list.map((r) => recRow(r, sg)).join('');
}
// all recordings of every song, newest song first; can be limited to the songs of one set
X.hooks.viewRecordings = (setId) => {
  const sets = X.S.sets.filter((st) => !st.deleted);
  const inSet = setId ? new Set(((X.setById(setId) || {}).items || []).map((i) => i.songId)) : null;
  const songs = S.songs.filter((sg) => !sg.deleted && sg.recs && sg.recs.length && (!inSet || inSet.has(sg.id)))
    .sort((a, b) => Math.max(...b.recs.map((r) => r.created)) - Math.max(...a.recs.map((r) => r.created)));
  const total = songs.reduce((n, sg) => n + sg.recs.length, 0), bytes = songs.reduce((n, sg) => n + sg.recs.reduce((m, r) => m + r.size, 0), 0);
  const chips = [`<a class="chip ${!setId ? 'on' : ''}" href="#/recordings">All</a>`].concat(sets.filter((st) => st.items.some((i) => { const g = S.songs.find((x) => x.id === i.songId); return g && g.recs && g.recs.length; }))
    .map((st) => `<a class="chip ${setId === st.id ? 'on' : ''}" href="#/recordings?set=${encodeURIComponent(st.id)}">${esc(st.name)}</a>`)).join('');
  const body = songs.length ? songs.map((sg) => `<section class="recgroup"><div class="rghead"><a href="#/song/${encodeURIComponent(sg.id)}"><b>${esc(sg.title)}</b><small>${sg.recs.length} recording${sg.recs.length === 1 ? '' : 's'}</small></a>
      <a class="btn sm" href="#/song/${encodeURIComponent(sg.id)}">Open song ›</a></div>${sg.recs.slice().reverse().map((r) => recRow(r, sg)).join('')}</section>`).join('')
    : '<p class="muted center pad">No recordings yet. Open a song and tap the microphone button to record.</p>';
  return `<header class="top"><h1>Recordings</h1></header>
    <p class="muted small" style="padding:0 4px">${total} recording${total === 1 ? '' : 's'} · ${bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(0, Math.round(bytes / 1024)) + ' KB'}</p>
    <div class="chips" style="margin:8px 0 12px">${chips}</div><div class="reclist">${body}</div>`;
};
function openSheet() {
  const sg = song(); if (!sg) return;
  sheet(`<div class="sh-h">Recordings</div><p class="muted small center">${esc(sg.title)}</p>
    <div class="recctlbox" id="recctl">${ctlHtml()}</div><div id="reclist" class="reclist">${rowsHtml(sg)}</div>
    <p class="center small muted">Drag the red recording bar to move it. ${loadPos() ? '<button class="linkbtn" data-act="rec-reset">Put it back</button>' : ''}</p>
    <div class="btnrow"><button class="btn primary" data-act="close-sheet">Done</button></div>`);
  syncRows();
}
function refresh() {
  const c = $('#recctl'); if (c) c.innerHTML = ctlHtml();
  const sg = song(), l = $('#reclist'); if (l && sg) { l.innerHTML = rowsHtml(sg); syncRows(); }
  paintBar(); paintButton();
}
function paintBar() {
  let bar = $('#recbar');
  if (R.state === 'idle') { if (bar) bar.remove(); document.body.classList.remove('hasrec'); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'recbar'; bar.className = 'recbar glass'; document.body.appendChild(bar); placeBar(bar); }
  document.body.classList.add('hasrec');
  bar.innerHTML = `<span class="recgrip" title="Drag to move">${ico('grip')}</span><button class="recopen" data-act="rec-open"><span class="recdot ${R.state === 'rec' ? 'live' : ''}"></span><b class="rectime">${fmtDur(elapsed())}</b></button>
    <button class="ibtn" data-act="${R.state === 'rec' ? 'rec-pause' : 'rec-resume'}" aria-label="${R.state === 'rec' ? 'Pause' : 'Resume'}">${ico(R.state === 'rec' ? 'pause' : 'play')}</button>
    <button class="ibtn stopb" data-act="rec-stop" aria-label="Stop and save">${ico('stop')}</button>`;
}
// the bar can be dragged anywhere; the spot is remembered (as a share of the screen, so it survives rotation)
const POS_KEY = 'sb-recbar-pos';
function loadPos() { try { const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return v && typeof v.x === 'number' ? v : null; } catch (_) { return null; } }
function savePos(v) { try { if (v) localStorage.setItem(POS_KEY, JSON.stringify(v)); else localStorage.removeItem(POS_KEY); } catch (_) {} }
function placeBar(bar) {
  const v = loadPos(); if (!bar) return;
  if (!v) { bar.style.left = bar.style.top = bar.style.bottom = bar.style.transform = ''; return; }
  const w = bar.offsetWidth, h = bar.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  bar.style.transform = 'none'; bar.style.bottom = 'auto';
  bar.style.left = Math.round(Math.max(6, Math.min(vw - w - 6, v.x * (vw - w)))) + 'px';
  bar.style.top = Math.round(Math.max(6, Math.min(vh - h - 6, v.y * (vh - h)))) + 'px';
}
let drag = null, noClick = false;
document.addEventListener('pointerdown', (e) => {
  const bar = e.target.closest && e.target.closest('#recbar'); if (!bar) return;
  if (e.target.closest('.ibtn')) return;
  const r = bar.getBoundingClientRect(); drag = { bar, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, on: false, id: e.pointerId };
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.on && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
  if (!drag.on) { drag.on = true; try { drag.bar.setPointerCapture(drag.id); } catch (_) {} }
  e.preventDefault();
  const b = drag.bar, w = b.offsetWidth, h = b.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  const x = Math.max(6, Math.min(vw - w - 6, e.clientX - drag.dx)), y = Math.max(6, Math.min(vh - h - 6, e.clientY - drag.dy));
  b.style.transform = 'none'; b.style.bottom = 'auto'; b.style.left = x + 'px'; b.style.top = y + 'px';
  drag.pos = { x: vw - w > 0 ? x / (vw - w) : 0, y: vh - h > 0 ? y / (vh - h) : 0 };
}, { passive: false });
const endDrag = () => { if (drag && drag.on && drag.pos) { savePos(drag.pos); noClick = true; setTimeout(() => { noClick = false; }, 350); } drag = null; };
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
document.addEventListener('click', (e) => { if (noClick && e.target.closest && e.target.closest('#recbar')) { e.stopPropagation(); e.preventDefault(); } }, true);
window.addEventListener('resize', () => placeBar($('#recbar')));

function paintButton() {
  const dock = $('#dock'); if (!dock) return;
  let b = dock.querySelector('[data-act="rec-open"]');
  if (!b) { b = document.createElement('button'); b.className = 'dk'; b.dataset.act = 'rec-open'; b.setAttribute('aria-label', 'Record'); const st = dock.querySelector('[data-act="stage"]'); dock.insertBefore(b, st || null); }
  const sg = song(), n = sg && sg.recs ? sg.recs.length : 0;
  b.classList.toggle('recording', R.state !== 'idle');
  b.innerHTML = ico('mic') + (n ? `<i class="cnt">${n}</i>` : '');
}

const prevPaint = X.hooks.paintSong;
X.hooks.paintSong = (s, h) => { if (prevPaint) prevPaint(s, h); paintButton(); paintBar(); };

Object.assign(A, {
  'rec-open': () => openSheet(),
  'rec-reset': () => { savePos(null); placeBar($('#recbar')); openSheet(); toast('Recording bar is back in its usual place'); },
  'rec-start': () => start(), 'rec-pause': () => pause(), 'rec-resume': () => resume(), 'rec-stop': () => stop(),
  'rec-play': (el) => play(el.dataset.id),
  'rec-rename': (el) => {
    const sg = ownerOf(el.dataset.id), r = sg && (sg.recs || []).find((x) => x.id === el.dataset.id); if (!r) return;
    sheet(`<div class="sh-h">Rename recording</div><div class="field"><input id="rec-rn" value="${esc(r.name)}" autocomplete="off"></div>
      <div class="btnrow"><button class="btn" data-act="rec-back">Cancel</button><button class="btn primary" data-act="rec-rename-go" data-id="${esc(r.id)}">Save</button></div>`);
    setTimeout(() => { const i = $('#rec-rn'); if (i) { i.focus(); i.select(); } }, 60);
  },
  'rec-rename-go': async (el) => {
    const sg = ownerOf(el.dataset.id), r = sg && (sg.recs || []).find((x) => x.id === el.dataset.id); if (!r) return;
    const v = ($('#rec-rn').value || '').trim(); if (v) r.name = v.slice(0, 120);
    await saveSong(sg); after();
  },
  'rec-back': () => after(),
  'rec-del': (el) => {
    const sg = ownerOf(el.dataset.id), r = sg && (sg.recs || []).find((x) => x.id === el.dataset.id); if (!r) return;
    confirmBox('Delete this recording?', `“${r.name}” will be removed. This cannot be undone.`, 'Delete', async () => {
      if (P.id === r.id) stopPlayback();
      sg.recs = sg.recs.filter((x) => x.id !== r.id); await saveSong(sg);
      if (!S.songs.some((s) => (s.recs || []).some((x) => x.id === r.id))) { try { await DB.delMany('blobs', [r.id]); } catch (_) {} }
      after();
    }, true);
  },
  'rec-share': async (el) => {
    const sg = ownerOf(el.dataset.id), r = sg && (sg.recs || []).find((x) => x.id === el.dataset.id); if (!r) return;
    const rec = await DB.get('blobs', r.id); if (!rec) { toast('Recording file not found'); return; }
    const file = new File([rec.data], safe(r.name) + '.' + extOf(r.mime || ''), { type: r.mime || 'audio/mp4' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: r.name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); toast('Saved to your downloads');
  },
});

// seeking
document.addEventListener('input', (e) => {
  const rg = e.target.closest && e.target.closest('.recseek'); if (!rg || !P.audio || P.id !== rg.dataset.id) return;
  P.audio.currentTime = (+rg.value) / 1000;
});
// never lose a take: leaving the song (or closing the page) saves what was recorded
window.addEventListener('hashchange', () => {
  const r = route(); if (R.state !== 'idle' && !(r.name === 'song' && r.id === R.songId)) stop(true);
  if (r.name !== 'song' && r.name !== 'recordings') stopPlayback();
  else if (P.id && !ownerOf(P.id)) stopPlayback();
});
window.addEventListener('pagehide', () => { if (R.state !== 'idle') stop(true); });
X.rec = { state: () => R.state };
})();
