/* Songbook — stage mode, sharing (text + PDF), pen notes on PDFs. Uses the small API that app.js exposes as SBX. */
(() => {
'use strict';
const X = window.SBX; if (!X) return;
const { S, A, $, $$, esc, ico, IC, sheet, closeSheet, toast, confirmBox, songById, setById } = X;
const root = document.documentElement;
S.ink = { on: false, eraser: false, stack: [] };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const safeName = (t) => String(t || 'songbook').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'songbook';

// ───────────────────────── stage mode ─────────────────────────
let barTimer = 0;
function enterStage() {
  const song = X.curSong(); if (!song) return;
  closeSheet();
  S.stage = { fit: true, fs: null, pfit: false, pz: 1 };
  root.classList.add('stage');
  try { if (root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (_) {}
  buildBar();
  X.paintSong();
  showBar(true);
  window.addEventListener('resize', onResize);
}
function exitStage() {
  if (!S.stage) return;
  S.stage = null;
  root.classList.remove('stage');
  window.removeEventListener('resize', onResize);
  const b = $('#stagebar'); if (b) b.remove();
  clearTimeout(barTimer);
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (_) {}
  const body = $('#songbody'); if (body) { body.style.columnCount = ''; body.classList.remove('nowrap'); }
  if (X.route().name === 'song' && X.curSong()) X.paintSong();
}
let rz = 0;
function onResize() { clearTimeout(rz); rz = setTimeout(() => { const s = X.curSong(); if (!S.stage || !s) return; if (s.fmt === 'pdf') X.paintSong(); else fitStage(); }, 200); }
function buildBar() {
  let b = $('#stagebar'); if (b) b.remove();
  b = document.createElement('div'); b.id = 'stagebar'; b.className = 'stagebar';
  document.body.appendChild(b); paintBar();
}
function paintBar() {
  const b = $('#stagebar'); if (!b) return;
  const song = X.curSong(), pdf = song && song.fmt === 'pdf', set = S.cur && S.cur.setId && setById(S.cur.setId);
  b.innerHTML = `
    <button class="dk exit" data-act="stage-exit" aria-label="Exit stage mode">${ico('close')}<span>Exit</span></button>
    ${set ? `<button class="dk" data-act="set-prev" aria-label="Previous song">${ico('back')}</button>` : ''}
    <button class="dk" data-act="font-" aria-label="Smaller text"><b>A</b><sup>−</sup></button><button class="dk ${S.stage && (pdf ? S.stage.pfit : S.stage.fit) ? 'on' : ''}" data-act="stage-fit" aria-label="Fit to screen">${ico('fitpage')}</button><button class="dk" data-act="font+" aria-label="Larger text"><b>A</b><sup>+</sup></button>
    ${pdf ? '' : `<button class="dk ${S.settings.chords ? 'on' : ''}" data-act="toggle-chords" aria-label="Show chords"><span>♯♭</span></button>
    <button class="kb" data-act="shift" data-d="-1" aria-label="Key down">−</button><button class="kb" data-act="shift" data-d="1" aria-label="Key up">+</button>`}
    <button class="dk" data-act="autoscroll" aria-label="Auto scroll">${ico('play')}</button>
    ${set ? `<button class="dk" data-act="set-next" aria-label="Next song">${ico('chev')}</button>` : ''}`;
}
function showBar(first) {
  const b = $('#stagebar'); if (!b) return;
  paintBar(); b.classList.add('on'); clearTimeout(barTimer);
  barTimer = setTimeout(() => b.classList.remove('on'), first ? 4500 : 3500);
}
function fitStage() {
  const st = S.stage; if (!st) return;
  const song = X.curSong(), body = $('#songbody'); if (!song || !body || song.fmt === 'pdf') return;
  if (!st.fit) { if (st.fs) body.style.setProperty('--fs', st.fs + 'px'); return; }
  const W = window.innerWidth, H = window.innerHeight, de = document.documentElement;
  const fits = (fs, cols) => { body.style.setProperty('--fs', fs + 'px'); body.style.columnCount = cols > 1 ? String(cols) : ''; return de.scrollHeight <= H + 1 && body.scrollWidth <= body.clientWidth + 1; };
  const maxCols = W >= 1100 ? 3 : W >= 700 ? 2 : 1;
  const search = (minFs) => {
    let best = { fs: 0, cols: 1 };
    for (let cols = 1; cols <= maxCols; cols++) {
      let lo = minFs, hi = 110;
      if (!fits(lo, cols)) continue;
      if (fits(hi, cols)) lo = hi; else while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fits(mid, cols)) lo = mid; else hi = mid; }
      if (lo > best.fs + 1) best = { fs: lo, cols };
    }
    return best;
  };
  // first choice: every line stays on one row (easier to read from far away); otherwise let long lines wrap
  body.classList.add('nowrap');
  let best = search(16);
  if (!best.fs) { body.classList.remove('nowrap'); best = search(14); }
  if (!best.fs) best = { fs: 14, cols: 1 };
  fits(best.fs, best.cols); st.fs = best.fs; st.cols = best.cols;
}
X.hooks.stageFont = (d) => {
  if (!S.stage) return false;
  const song = X.curSong();
  if (song && song.fmt === 'pdf') { S.stage.pz = clamp(Math.round((S.stage.pz + d * 0.2) * 100) / 100, 0.6, 3); S.stage.pfit = false; X.paintSong(); showBar(); return true; }
  const body = $('#songbody'); const cur = S.stage.fs || parseFloat(getComputedStyle(body).fontSize) || 24;
  S.stage.fit = false; body.classList.remove('nowrap'); S.stage.fs = clamp(Math.round(cur + d * 4), 12, 160);
  body.style.setProperty('--fs', S.stage.fs + 'px'); paintBar(); showBar();
  return true;
};
X.hooks.paintSong = (song) => {
  if (song.fmt !== 'pdf') penOff();
  if (S.stage) { paintBar(); if (song.fmt !== 'pdf') requestAnimationFrame(fitStage); }
};
document.addEventListener('click', (e) => {
  if (!S.stage) return;
  if (e.target.closest('#stagebar, #modal-root, [data-act]')) { if (e.target.closest('#stagebar')) showBar(); return; }
  const set = S.cur && S.cur.setId && setById(S.cur.setId), x = e.clientX / window.innerWidth;
  if (set && x < 0.2) X.setStep(-1); else if (set && x > 0.8) X.setStep(1); else showBar();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.stage && !$('#modal-root').classList.contains('open')) exitStage(); });
Object.assign(A, {
  'stage': () => enterStage(),
  'stage-exit': () => exitStage(),
  'stage-fit': () => { if (!S.stage) return; const sg = X.curSong(); if (sg && sg.fmt === 'pdf') { S.stage.pfit = !S.stage.pfit; S.stage.pz = 1; X.paintSong(); paintBar(); showBar(); return; } S.stage.fit = true; fitStage(); paintBar(); showBar(); },
});

// ───────────────────────── plain-text charts ─────────────────────────
const items = (set) => set.items.filter((it) => songById(it.songId) && !songById(it.songId).deleted);
function chartText(song, holder) {
  const ctx = X.makeCtx(song, holder), out = [];
  for (const r of Music.parseSong(song.body || '')) {
    if (r.k === 'blank') { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    if (r.k === 'head') { out.push('[' + r.text + ']'); continue; }
    if (r.k === 'chords') { out.push(r.toks.map((t) => (t.ch ? Music.renderChord(t.ch, ctx) : t.raw)).join('  ')); continue; }
    let lyric = '', chords = '', any = false;
    for (const sg of r.segs) {
      if (sg.c) {
        any = true;
        const label = sg.c.text !== undefined ? sg.c.text : Music.renderChord(sg.c.ch, ctx);
        let pos = lyric.length; const need = chords.length ? chords.length + 1 : 0;
        if (pos < need) { lyric += ' '.repeat(need - pos); pos = need; }
        chords = chords.padEnd(pos) + label;
      }
      lyric += sg.t;
    }
    if (any) out.push(chords);
    out.push(lyric.replace(/\s+$/, ''));
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
const songLine = (song, holder) => {
  const k = X.keyLabel(song, holder), capo = holder.capo || 0;
  return `${song.title}${k ? ' — ' + k : ''}${capo ? ' (Capo ' + capo + ')' : ''}`;
};
function setText(set, full) {
  const list = items(set);
  const lines = [`*${set.name}* — ${X.fmtDate(set.date)}`, ''];
  list.forEach((it, i) => {
    const s = songById(it.songId);
    lines.push(`${i + 1}. ${songLine(s, it)}${s.author ? ' · ' + s.author : ''}`);
    if (s.notes) lines.push('   Note: ' + s.notes.replace(/\n+/g, ' '));
  });
  if (full) {
    list.forEach((it, i) => {
      const s = songById(it.songId);
      lines.push('', `*${i + 1}. ${songLine(s, it)}*`);
      if (s.fmt === 'pdf') lines.push('(PDF chart — sent as a file)'); else lines.push('```' + chartText(s, it) + '```');
    });
  }
  lines.push('', '— sent from Songbook');
  return lines.join('\n');
}
function songText(song) {
  const h = song, lines = [`*${songLine(song, h)}*`];
  if (song.author) lines.push(song.author);
  if (song.notes) lines.push('Note: ' + song.notes);
  lines.push('');
  lines.push(song.fmt === 'pdf' ? '(PDF chart — sent as a file)' : '```' + chartText(song, h) + '```');
  lines.push('', '— sent from Songbook');
  return lines.join('\n');
}
async function sendWhatsApp(text) {
  if (text.length <= 5000) { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener'); return; }
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  await copyText(text); toast('Long text copied — paste it into WhatsApp', 4500);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (_) {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {} ta.remove(); return true;
  }
}
async function shareFile(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  X.download(blob, name); toast('File saved — attach it in WhatsApp', 4500);
}

// ───────────────────────── PDF export (pictures of pages, so every script prints correctly) ─────────────────────────
const PW = 1240, PH = 1754, M = 90, FONT = '"Noto Sans Sinhala","Iskoola Pota","Sinhala Sangam MN",-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
const F = (px, w = 400) => `${w} ${px}px ${FONT}`;
function newPage(pages) {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, PW, PH); g.textBaseline = 'alphabetic';
  pages.push(c); return { c, g, y: M };
}
function toWords(segs) {
  const words = []; let cur = [];
  const flush = () => { if (cur.length) { words.push(cur); cur = []; } };
  for (const s of segs) {
    let chord = s.c || null;
    for (const tk of s.t.match(/\s+|\S+/g) || []) {
      if (/^\s/.test(tk)) {
        if (chord) { flush(); words.push([{ c: chord, t: tk }]); chord = null; }
        else if (cur.length) { cur[cur.length - 1].t += tk; flush(); }
        else words.push([{ c: null, t: tk }]);
      } else { cur.push({ c: chord, t: tk }); chord = null; }
    }
    if (chord) cur.push({ c: chord, t: '' });
  }
  flush(); return words;
}
function drawSong(pages, pg, song, holder) {
  const ctx = X.makeCtx(song, holder), k = X.keyLabel(song, holder), capo = holder.capo || 0;
  const room = (h) => { if (pg.y + h > PH - M) { Object.assign(pg, newPage(pages)); } };
  room(160);
  pg.g.fillStyle = '#111'; pg.g.font = F(54, 700); pg.g.fillText(song.title, M, pg.y + 50); pg.y += 70;
  if (song.author) { pg.g.fillStyle = '#666'; pg.g.font = F(28); pg.g.fillText(song.author, M, pg.y + 24); pg.y += 40; }
  const meta = [k ? 'Key ' + k : '', capo ? 'Capo ' + capo : ''].filter(Boolean).join('   ·   ');
  if (meta) { pg.g.fillStyle = '#1a4fa0'; pg.g.font = F(30, 700); pg.g.fillText(meta, M, pg.y + 30); pg.y += 46; }
  if (song.notes) { pg.g.fillStyle = '#555'; pg.g.font = F(26); wrapPlain(pages, pg, 'Note: ' + song.notes, 26, 36, '#555'); }
  pg.y += 14;
  const maxW = PW - 2 * M;
  for (const r of Music.parseSong(song.body || '')) {
    if (r.k === 'blank') { pg.y += 18; continue; }
    if (r.k === 'head') { room(70); pg.y += 18; pg.g.fillStyle = '#555'; pg.g.font = F(24, 700); pg.g.fillText(r.text.toUpperCase(), M, pg.y + 24); pg.y += 40; continue; }
    if (r.k === 'chords') {
      room(46); let x = M; pg.g.font = F(28, 700);
      for (const t of r.toks) { const label = t.ch ? Music.renderChord(t.ch, ctx) : t.raw; const w = pg.g.measureText(label).width; if (x + w > PW - M) { x = M; pg.y += 40; room(46); } pg.g.fillStyle = t.ch ? '#1a4fa0' : '#777'; pg.g.fillText(label, x, pg.y + 30); x += w + 30; }
      pg.y += 46; continue;
    }
    const has = r.segs.some((s) => s.c);
    if (!has) { wrapPlain(pages, pg, r.segs.map((s) => s.t).join(''), 30, 42, '#111'); continue; }
    // chord line + lyric line, wrapped by whole words
    const lines = []; let cur = [], x = 0;
    for (const w of toWords(r.segs)) {
      const parts = w.map((p) => {
        const label = p.c ? (p.c.text !== undefined ? p.c.text : Music.renderChord(p.c.ch, ctx)) : '';
        pg.g.font = F(26, 700); const cw = label ? pg.g.measureText(label).width + 14 : 0;
        pg.g.font = F(30); const tw = pg.g.measureText(p.t).width;
        return { label, t: p.t, w: Math.max(cw, tw) };
      });
      const ww = parts.reduce((a, p) => a + p.w, 0);
      if (x + ww > maxW && cur.length) { lines.push(cur); cur = []; x = 0; }
      cur.push({ x, parts }); x += ww;
    }
    if (cur.length) lines.push(cur);
    for (const ln of lines) {
      room(84);
      for (const w of ln) { let px = M + w.x; for (const p of w.parts) {
        if (p.label) { pg.g.fillStyle = '#1a4fa0'; pg.g.font = F(26, 700); pg.g.fillText(p.label, px, pg.y + 28); }
        pg.g.fillStyle = '#111'; pg.g.font = F(30); pg.g.fillText(p.t, px, pg.y + 68); px += p.w; } }
      pg.y += 84;
    }
  }
}
function wrapPlain(pages, pg, text, size, lh, color) {
  pg.g.font = F(size); const maxW = PW - 2 * M;
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/(\s+)/)) {
      if (pg.g.measureText(line + w).width > maxW && line.trim()) { drawLine(pages, pg, line, size, lh, color); line = w.trimStart(); } else line += w;
    }
    drawLine(pages, pg, line, size, lh, color);
  }
}
function drawLine(pages, pg, line, size, lh, color) {
  if (pg.y + lh > PH - M) Object.assign(pg, newPage(pages));
  pg.g.fillStyle = color; pg.g.font = F(size); pg.g.fillText(line, M, pg.y + size); pg.y += lh;
}
function drawCover(pages, set) {
  const pg = newPage(pages); const g = pg.g;
  g.fillStyle = '#111'; g.font = F(70, 700); g.fillText(set.name, M, pg.y + 70); pg.y += 100;
  g.fillStyle = '#666'; g.font = F(32); g.fillText(X.fmtDate(set.date), M, pg.y + 30); pg.y += 70;
  items(set).forEach((it, i) => {
    const s = songById(it.songId), k = X.keyLabel(s, it), capo = it.capo || 0;
    if (pg.y + 70 > PH - M) Object.assign(pg, newPage(pages));
    pg.g.fillStyle = '#888'; pg.g.font = F(38, 700); pg.g.fillText(String(i + 1) + '.', M, pg.y + 40);
    pg.g.fillStyle = '#111'; pg.g.font = F(40, 600); pg.g.fillText(s.title, M + 80, pg.y + 40);
    const right = [k ? k : '', capo ? 'Capo ' + capo : ''].filter(Boolean).join('  ·  ');
    if (right) { pg.g.fillStyle = '#1a4fa0'; pg.g.font = F(36, 700); const w = pg.g.measureText(right).width; pg.g.fillText(right, PW - M - w, pg.y + 40); }
    pg.y += 58;
    if (s.notes) { pg.g.fillStyle = '#666'; pg.g.font = F(26); pg.g.fillText(s.notes.replace(/\n+/g, ' ').slice(0, 80), M + 80, pg.y + 22); pg.y += 38; }
    pg.y += 10;
  });
  return pg;
}
async function drawPdfSong(pages, song, holder) {
  const rec = await X.DB.get('blobs', song.pdfId); if (!rec) return;
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(rec.data.slice(0)) }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), base = page.getViewport({ scale: 1 });
    const pg = newPage(pages);
    const k = X.keyLabel(song, holder), capo = holder.capo || 0, head = [song.title, k ? 'Key ' + k : '', capo ? 'Capo ' + capo : ''].filter(Boolean).join('   ·   ');
    pg.g.fillStyle = '#444'; pg.g.font = F(26, 700); pg.g.fillText(head, M, 60);
    const boxW = PW - 2 * M, boxH = PH - 160 - M, sc = Math.min(boxW / base.width, boxH / base.height);
    const vp = page.getViewport({ scale: sc * 1.5 });
    const tmp = document.createElement('canvas'); tmp.width = Math.floor(vp.width); tmp.height = Math.floor(vp.height);
    await page.render({ canvasContext: tmp.getContext('2d'), viewport: vp }).promise;
    await X.hooks.pdfPage(song, page, vp, tmp, holder);
    const dw = base.width * sc, dh = base.height * sc;
    pg.g.drawImage(tmp, M + (boxW - dw) / 2, 100, dw, dh);
    drawInkOn(pg.g, song, p - 1, M + (boxW - dw) / 2, 100, dw, dh);
  }
}
function buildPdf(pages) {
  const enc = new TextEncoder(), chunks = [], offs = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (id, fn) => { offs[id] = len; push(`${id} 0 obj\n`); fn(); push('endobj\n'); };
  push('%PDF-1.4\n');
  const n = pages.length;
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>\n'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${n} >>\n`));
  pages.forEach((p, i) => {
    const pid = 3 + 3 * i, cid = 4 + 3 * i, iid = 5 + 3 * i, content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    obj(pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>\n`));
    obj(cid, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`));
    obj(iid, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.data.length} >>\nstream\n`); push(p.data); push('\nendstream\n'); });
  });
  const total = 3 * n + 3, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id++) push(String(offs[id]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
async function pagesToPdf(canvases) {
  const out = [];
  for (const c of canvases) {
    const url = c.toDataURL('image/jpeg', 0.86), bin = atob(url.slice(url.indexOf(',') + 1)), data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    out.push({ data, w: c.width, h: c.height });
  }
  return buildPdf(out);
}
async function makeSetPdf(set) {
  const pages = []; drawCover(pages, set);
  for (const it of items(set)) {
    const s = songById(it.songId);
    if (s.fmt === 'pdf') await drawPdfSong(pages, s, it);
    else { const pg = newPage(pages); drawSong(pages, pg, s, it); }
  }
  return pagesToPdf(pages);
}
async function makeSongPdf(song) {
  const pages = [];
  if (song.fmt === 'pdf') await drawPdfSong(pages, song, song); else { const pg = newPage(pages); drawSong(pages, pg, song, song); }
  return pagesToPdf(pages);
}

// ───────────────────────── share sheets ─────────────────────────
const shareRow = (act, title, sub) => `<button class="row share" data-act="${act}"><span class="rt"><span class="t">${title}</span><span class="a">${sub}</span></span>${ico('chev', 'dim')}</button>`;
function shareSet(id) {
  const set = setById(id); if (!set) return;
  if (!items(set).length) { toast('Add songs to the set first'); return; }
  X.sheetCtx = { shareKind: 'set', id };
  sheet(`<div class="sh-h">Share “${esc(set.name)}”</div><p class="muted small center">One tap. The band gets the order and keys without the app.</p>
    ${shareRow('sh-wa-list', 'WhatsApp — order &amp; keys', 'Short text message')}
    ${shareRow('sh-wa-full', 'WhatsApp — with lyrics &amp; chords', 'Text, in the keys you chose')}
    ${shareRow('sh-pdf', 'PDF — order, keys &amp; charts', 'A file you can send to WhatsApp or print')}
    ${shareRow('sh-copy', 'Copy text', 'Paste anywhere')}
    <div class="btnrow"><button class="btn" data-act="close-sheet">Close</button></div>`);
}
function shareSong() {
  const s = X.curSong(); if (!s) return;
  X.sheetCtx = { shareKind: 'song', id: s.id };
  sheet(`<div class="sh-h">Share “${esc(s.title)}”</div><p class="muted small center">Sent in the key you have chosen now${X.keyLabel(s, X.curHolder()) ? ' (' + esc(X.keyLabel(s, X.curHolder())) + ')' : ''}.</p>
    ${s.fmt === 'pdf' ? shareRow('sh-orig', 'WhatsApp — the PDF file', 'Sends the original PDF') : shareRow('sh-wa-full', 'WhatsApp — lyrics &amp; chords', 'Text message')}
    ${shareRow('sh-pdf', 'PDF — chart', s.fmt === 'pdf' ? 'With a title line and your pen marks' : 'A neat page you can send or print')}
    ${shareRow('sh-copy', 'Copy text', 'Paste anywhere')}
    <div class="btnrow"><button class="btn" data-act="close-sheet">Close</button></div>`);
}
function curShare() {
  const c = X.sheetCtx; if (!c || !c.shareKind) return null;
  if (c.shareKind === 'set') { const set = setById(c.id); return set ? { kind: 'set', set } : null; }
  const song = songById(c.id); if (!song) return null;
  const holder = S.cur && S.cur.songId === song.id ? X.curHolder() : song;
  return { kind: 'song', song, holder };
}
function songForText(sh) { return Object.assign({}, sh.song, { shift: sh.holder.shift || 0, capo: sh.holder.capo || 0 }); }
async function withBusy(label, fn) {
  toast(label, 60000);
  try { await fn(); } catch (e) { console.error(e); toast('Could not make that: ' + (e.message || e), 5000); return; }
  const t = $('#toast'); if (t) t.classList.remove('on');
}
Object.assign(A, {
  'share-set': (el) => shareSet(el.dataset.id || (route().id)),
  'share-song': () => shareSong(),
  'sh-wa-list': async () => { const sh = curShare(); if (!sh) return; const t = setText(sh.set, false); closeSheet(); await sendWhatsApp(t); },
  'sh-wa-full': async () => {
    const sh = curShare(); if (!sh) return; closeSheet();
    await sendWhatsApp(sh.kind === 'set' ? setText(sh.set, true) : songText(songForText(sh)));
  },
  'sh-copy': async () => { const sh = curShare(); if (!sh) return; const t = sh.kind === 'set' ? setText(sh.set, true) : songText(songForText(sh)); await copyText(t); closeSheet(); toast('Copied'); },
  'sh-pdf': async () => {
    const sh = curShare(); if (!sh) return; closeSheet();
    await withBusy('Making the PDF…', async () => {
      const blob = sh.kind === 'set' ? await makeSetPdf(sh.set) : await makeSongPdf(Object.assign({}, songForText(sh), { ink: sh.song.ink }));
      await shareFile(blob, safeName(sh.kind === 'set' ? sh.set.name : sh.song.title) + '.pdf', sh.kind === 'set' ? sh.set.name : sh.song.title);
    });
  },
  'sh-orig': async () => {
    const sh = curShare(); if (!sh) return; closeSheet();
    const rec = await X.DB.get('blobs', sh.song.pdfId); if (!rec) { toast('The PDF file is missing'); return; }
    await shareFile(new Blob([rec.data], { type: 'application/pdf' }), safeName(sh.song.title) + '.pdf', sh.song.title);
  },
});
const route = () => X.route();

// ───────────────────────── pen notes on PDFs ─────────────────────────
const PEN_COLORS = ['#f2f2f2', '#ffd479', '#ff8a8a', '#8fe3a6', '#8fd3ff'];
const penW = () => 0.0015 + ((S.settings.penSize == null ? 40 : S.settings.penSize) / 100) * 0.014;
const penColor = () => S.settings.penColor || '#ffd479';
function strokesOf(song, pg) { return (song.ink && song.ink[pg]) || []; }
function paintStrokes(c, strokes) {
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of strokes) {
    g.strokeStyle = s.c; g.lineWidth = Math.max(1, s.w * c.width); g.beginPath();
    for (let i = 0; i < s.p.length; i += 2) { const x = s.p[i] * c.width, y = s.p[i + 1] * c.height; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    if (s.p.length === 2) g.lineTo(s.p[0] * c.width + 0.1, s.p[1] * c.height);
    g.stroke();
  }
}
function drawInkOn(g, song, pg, x, y, w, h) {
  const strokes = strokesOf(song, pg); if (!strokes.length) return;
  const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); paintStrokes(c, strokes); g.drawImage(c, x, y, w, h);
}
let inkSave = 0;
function saveInkSoon(song) { clearTimeout(inkSave); inkSave = setTimeout(() => X.saveSong(song), 500); }
X.hooks.afterPdf = (song, host) => {
  $$('.pgwrap', host).forEach((w) => {
    const pg = w.dataset.page, cw = parseFloat(w.style.width), ch = parseFloat(w.style.height), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const c = document.createElement('canvas'); c.className = 'inkc'; c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); c.style.width = cw + 'px'; c.style.height = ch + 'px';
    w.appendChild(c); paintStrokes(c, strokesOf(song, pg)); bindInk(c, pg, song);
  });
  if (S.ink.on && !S.stage) buildPenBar(); else if (S.stage) penOff();
};
function bindInk(c, pg, song) {
  let cur = null;
  const pt = (e) => { const r = c.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1), r]; };
  const erase = (e) => {
    const [x, y, r] = pt(e); const list = strokesOf(song, pg); if (!list.length) return;
    const keep = list.filter((s) => { for (let i = 0; i < s.p.length; i += 2) { const dx = s.p[i] - x, dy = (s.p[i + 1] - y) * (r.height / r.width); if (dx * dx + dy * dy < 0.0009) return false; } return true; });
    if (keep.length !== list.length) { song.ink[pg] = keep; paintStrokes(c, keep); saveInkSoon(song); }
  };
  c.addEventListener('pointerdown', (e) => {
    if (!S.ink.on) return; e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (_) {}
    if (S.ink.eraser) { cur = 'erase'; erase(e); return; }
    const [x, y] = pt(e); cur = { c: penColor(), w: penW(), p: [x, y] };
    paintStrokes(c, strokesOf(song, pg).concat([cur]));
  });
  c.addEventListener('pointermove', (e) => {
    if (!cur) return; e.preventDefault();
    if (cur === 'erase') { erase(e); return; }
    const [x, y] = pt(e); cur.p.push(x, y); paintStrokes(c, strokesOf(song, pg).concat([cur]));
  });
  const end = () => {
    if (!cur) return;
    if (cur !== 'erase') { song.ink = song.ink || {}; (song.ink[pg] = song.ink[pg] || []).push(cur); S.ink.stack.push(pg); saveInkSoon(song); }
    cur = null;
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
}
function buildPenBar() {
  let b = $('#penbar'); if (!b) { b = document.createElement('div'); b.id = 'penbar'; b.className = 'penbar'; document.body.appendChild(b); }
  const size = S.settings.penSize == null ? 40 : S.settings.penSize;
  b.innerHTML = `<div class="pcols">${PEN_COLORS.map((c) => `<button class="pc ${penColor() === c && !S.ink.eraser ? 'on' : ''}" data-act="pen-color" data-c="${c}" style="--c:${c}" aria-label="Pen colour"></button>`).join('')}
    <button class="dk ${S.ink.eraser ? 'on' : ''}" data-act="pen-eraser" aria-label="Eraser">${ico('eraser')}</button><button class="dk" data-act="pen-undo" aria-label="Undo">${ico('undo')}</button><button class="dk" data-act="pen-clear" aria-label="Clear all">${ico('trash')}</button><button class="btn sm primary" data-act="pen">Done</button></div>
    ${X.rng('Pen size', 'penSize', 0, 100, size)}`;
}
function penOff() {
  if (!S.ink.on && !$('#penbar')) return;
  S.ink.on = false; S.ink.eraser = false; document.body.classList.remove('penon');
  const b = $('#penbar'); if (b) b.remove();
  $$('[data-act="pen"]').forEach((x) => x.classList.remove('on'));
}
Object.assign(A, {
  'pen': () => {
    const song = X.curSong(); if (!song || song.fmt !== 'pdf') return;
    if (S.ink.on) { penOff(); return; }
    S.ink.on = true; S.ink.eraser = false; document.body.classList.add('penon'); buildPenBar();
    $$('[data-act="pen"]').forEach((x) => x.classList.add('on'));
    X.stopScroll(); toast('Draw on the page. Tap Done to scroll again.', 3200);
  },
  'pen-color': (el) => { S.settings.penColor = el.dataset.c; S.ink.eraser = false; X.saveSettings(); buildPenBar(); },
  'pen-eraser': () => { S.ink.eraser = !S.ink.eraser; buildPenBar(); },
  'pen-undo': () => {
    const song = X.curSong(); if (!song) return;
    const pg = S.ink.stack.pop(); const list = pg == null ? null : strokesOf(song, pg);
    if (!list || !list.length) { toast('Nothing to undo'); return; }
    list.pop(); const w = $(`.pgwrap[data-page="${pg}"] .inkc`); if (w) paintStrokes(w, list); saveInkSoon(song);
  },
  'pen-clear': () => {
    const song = X.curSong(); if (!song) return;
    if (!song.ink || !Object.values(song.ink).some((l) => l.length)) { toast('No pen marks on this song'); return; }
    confirmBox('Clear all pen marks?', 'Every pen mark on this song will be removed. The PDF itself is not touched.', 'Clear marks', async () => {
      song.ink = null; await X.saveSong(song); $$('.inkc').forEach((c) => c.getContext('2d').clearRect(0, 0, c.width, c.height)); S.ink.stack = []; toast('Marks cleared');
    }, true);
  },
});

// ───────────────────────── key change inside PDFs ─────────────────────────
// Most chord-chart PDFs keep their chords as real text. We find those chords on each page,
// paint over them and draw the chord for the chosen key in the same place, so the page keeps its look.
const CH_ALLOW = /^(?:[-–—|/:.,()*~_]+|x\d+|\d+x|[A-Za-z]{2,12}:)$/;
const pdfCache = new Map();
async function analyzePage(song, page) {
  const key = song.pdfId + ':' + page.pageNumber; if (pdfCache.has(key)) return pdfCache.get(key);
  const tc = await page.getTextContent(), styles = tc.styles || {};
  const items = tc.items.filter((it) => it.str && it.str.trim() && Math.abs(it.transform[1]) < 0.01);
  const rows = [];
  for (const it of items.slice().sort((a, b) => b.transform[5] - a.transform[5])) {
    const h = Math.hypot(it.transform[2], it.transform[3]) || 10;
    let r = rows.find((q) => Math.abs(q.y - it.transform[5]) < Math.max(2, h * 0.45));
    if (!r) { r = { y: it.transform[5], h, items: [] }; rows.push(r); }
    r.items.push(it);
  }
  const chords = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.transform[4] - b.transform[4]);
    r.toks = [];
    for (const it of r.items) { const re = /[^\s\-–—|]+/g; let m; while ((m = re.exec(it.str))) r.toks.push({ s: m[0], start: m.index, it }); }
    r.chordLine = r.toks.length > 0 && r.toks.some((t) => Music.parseChord(t.s)) && r.toks.every((t) => Music.parseChord(t.s) || CH_ALLOW.test(t.s));
    if (r.chordLine) for (const t of r.toks) if (Music.parseChord(t.s)) chords.push({ s: t.s, start: t.start, it: t.it, family: (styles[t.it.fontName] || {}).fontFamily || 'sans-serif' });
    else for (let i = 0; i < r.toks.length - 1; i++) { // a header such as "Key of E" or "Key: E" moves with the chords
      if (!/^key:?$/i.test(r.toks[i].s)) continue;
      let j = i + 1; if (/^of$/i.test(r.toks[j].s)) j++;
      const t = r.toks[j]; if (t && Music.parseChord(t.s)) chords.push({ s: t.s, start: t.start, it: t.it, keyTok: true, family: (styles[t.it.fontName] || {}).fontFamily || 'sans-serif' });
    }
  }
  const res = { chords, rows }; pdfCache.set(key, res); return res;
}
X.hooks.pdfBefore = async (song, doc) => {
  const old = $('#pdfhint'); if (old) old.remove();
  if (S.settings.pdfSmart === false) return;
  let all = [];
  for (let p = 1; p <= doc.numPages; p++) all = all.concat((await analyzePage(song, await doc.getPage(p))).chords);
  S.pdfInfo = { id: song.id, found: all.length };
  if (all.length && !song.key) {
    const k = Music.inferKey(all.map((c) => c.s)); if (k) { song.key = k; await X.saveSong(song); const b = $('.pill.key b'); if (b) b.textContent = X.keyLabel(song, X.curHolder() || song); }
  }
  if (!all.length) { const n = $('#notecard'); if (n) n.insertAdjacentHTML('beforeend', '<p class="hint" id="pdfhint">No readable chords in this PDF, so only the key label changes. Tap ⋯ → <b>Make editable text copy</b> to get chords you can transpose.</p>'); }
};
X.hooks.pdfPage = async (song, page, vp, canvas, hold) => {
  if (S.settings.pdfSmart === false) return;
  const holder = hold || X.curHolder(); if (!holder) return;
  const ctx = X.makeCtx(song, holder);
  if (ctx.tonic == null || (!ctx.shift && !ctx.capo && ctx.mode === 'letters')) return;
  const { chords } = await analyzePage(song, page); if (!chords.length) return;
  const g = canvas.getContext('2d', { willReadFrequently: true }), ops = [];
  for (const c of chords) {
    if (c.keyTok && ctx.mode === 'numbers') continue;
    const ch = Music.parseChord(c.s); if (!ch) continue;
    const label = Music.renderChord(ch, ctx); if (label === c.s) continue;
    const tx = pdfjsLib.Util.transform(vp.transform, c.it.transform), fh = Math.hypot(tx[2], tx[3]), itemW = c.it.width * vp.scale;
    const fam = /,/.test(c.family) ? c.family : c.family + ', sans-serif';
    g.font = `400 ${fh}px ${fam}`; const wReg = g.measureText(c.it.str).width; g.font = `700 ${fh}px ${fam}`; const wBold = g.measureText(c.it.str).width;
    const bold = Math.abs(wBold - itemW) < Math.abs(wReg - itemW), wt = bold ? 700 : 400, whole = bold ? wBold : wReg; if (!whole) continue;
    g.font = `${wt} ${fh}px ${fam}`;
    const x0 = tx[4] + itemW * (g.measureText(c.it.str.slice(0, c.start)).width / whole), tokW = itemW * (g.measureText(c.s).width / whole);
    const rx = Math.max(0, Math.floor(x0 - 3)), ry = Math.max(0, Math.floor(tx[5] - fh * 1.0)), rw = Math.min(canvas.width - rx, Math.ceil(tokW + 6)), rh = Math.min(canvas.height - ry, Math.ceil(fh * 1.3));
    if (rw < 2 || rh < 2) continue;
    const d = g.getImageData(rx, ry, rw, rh).data, bg = [d[0], d[1], d[2]]; let best = 0, ink = null;
    for (let i = 0; i < d.length; i += 4) { const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]); if (dist > best) { best = dist; ink = [d[i], d[i + 1], d[i + 2]]; } }
    if (!ink || best < 60) ink = (bg[0] + bg[1] + bg[2]) / 3 > 128 ? [20, 20, 20] : [235, 235, 235];
    ops.push({ label, x0, y: tx[5], rx, ry, rw, rh, bg, ink, font: g.font, tokW });
  }
  for (const o of ops) { g.fillStyle = `rgb(${o.bg})`; g.fillRect(o.rx, o.ry, o.rw, o.rh); }
  for (const o of ops) { g.font = o.font; g.fillStyle = `rgb(${o.ink})`; g.textBaseline = 'alphabetic'; g.fillText(o.label, o.x0, o.y); }
};
// make a real text song from a PDF (chords above the lyrics, aligned by position)
const HEAD_RE = /^(verse|chorus|bridge|intro|outro|pre-?chorus|tag|interlude|instrumental|ending|refrain|coda|turnaround|vamp)\b/i;
async function pdfToText(song) {
  const rec = await X.DB.get('blobs', song.pdfId); if (!rec) throw new Error('The PDF file is missing');
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(rec.data.slice(0)) }).promise;
  const out = []; let found = 0;
  const rowText = (r) => { let t = '', end = null; for (const it of r.items) { if (end != null && it.transform[4] - end > r.h * 0.2 && !/\s$/.test(t)) t += ' '; t += it.str; end = it.transform[4] + it.width; } return t.replace(/\s+$/, ''); };
  for (let p = 1; p <= doc.numPages; p++) {
    const { rows } = await analyzePage(song, await doc.getPage(p));
    let prevY = null, prevH = 10;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], txt = rowText(r);
      if (!txt.trim() || /^page\s*\d+$/i.test(txt.trim())) continue;
      if (prevY != null && prevY - r.y > prevH * 2.1 && out.length && out[out.length - 1] !== '') out.push('');
      prevY = r.y; prevH = r.h;
      if (r.chordLine) {
        found += r.toks.filter((t) => Music.parseChord(t.s)).length;
        const n = rows[i + 1];
        if (n && !n.chordLine && r.y - n.y < Math.max(r.h, n.h) * 2.4 && !HEAD_RE.test(rowText(n).trim())) {
          const lyric = rowText(n), x0 = n.items[0].transform[4], last = n.items[n.items.length - 1], w = last.transform[4] + last.width - x0, cw = w / Math.max(1, lyric.length);
          let line = '';
          for (const t of r.toks) { const x = t.it.transform[4] + t.it.width * (t.start / Math.max(1, t.it.str.length)); const idx = clamp(Math.round((x - x0) / cw), 0, 400); const pos = Math.max(idx, line ? line.length + 1 : 0); line = line.padEnd(pos) + t.s; }
          out.push(line, lyric); prevY = n.y; prevH = n.h; i++; continue;
        }
        const lab = r.toks[0] && /:$/.test(r.toks[0].s) ? r.toks.shift().s.replace(/:$/, '') : '';
        if (lab) out.push('[' + lab + ']');
        out.push(r.toks.map((t) => t.s).join('  ')); continue;
      }
      out.push(HEAD_RE.test(txt.trim()) && txt.trim().split(/\s+/).length <= 3 ? '[' + txt.trim().replace(/:$/, '') + ']' : txt);
    }
    if (out.length && out[out.length - 1] !== '') out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return { body: out.join('\n'), found };
}
A['pdf-to-text'] = async () => {
  const song = X.curSong(); if (!song || song.fmt !== 'pdf') return; closeSheet();
  toast('Reading the PDF…', 60000);
  try {
    const { body, found } = await pdfToText(song);
    if (!body.trim()) { toast('This PDF is a picture with no text, so it cannot be converted'); return; }
    const key = song.key || Music.inferKey(Music.collectChords(body).letters) || '';
    const n = X.newSong({ title: song.title + ' (text)', author: song.author, key, body, notes: song.notes || '', tags: (song.tags || []).slice() });
    await X.saveSong(n); toast(found ? 'Text copy made. Check it, then edit as you like.' : 'Text copy made (no chords were found).', 4500); X.go('#/edit/' + encodeURIComponent(n.id));
  } catch (e) { console.error(e); toast('Could not convert: ' + (e.message || e), 5000); }
};
window.addEventListener('hashchange', () => { if (X.route().name !== 'song') { if (S.stage) exitStage(); penOff(); } });
window.SBP = { pdfToText, analyzePage, chartText, setText, songText, buildPdf, makeSetPdf, makeSongPdf, fitStage, enterStage, exitStage };
})();
