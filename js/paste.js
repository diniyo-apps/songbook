/* Smart paste: turn a chord chart or lyrics pasted from anywhere into a clean Songbook song.
   Rule based (no AI, works offline): removes website junk, tidies section names, puts chords over the
   right words, and finds the key. */
(function () {
  const X = window.SBX; const { $, esc, sheet, closeSheet, toast, confirmBox } = X; const M = window.Music; const A = X.A;

  const URL_RE = /(https?:\/\/|www\.|\.com\b|\.net\b|\.org\b)/i;
  const JUNK_RE = /^(tabbed|transcribed|chords?\s+by|chart\s+by|submitted|written\s+by|words\s+and\s+music|words\s*&\s*music|copyright|©|\(c\)|ccli|all rights reserved|used by permission|ultimate[- ]guitar|printed from|source:|tuning|difficulty|rating|report|advertisement|play along|autoscroll|transpose|chords\s*:?\s*(diagram|chart)|capo\s*[:.]?\s*\d)/i;
  const SECTION_RE = /^(verse|chorus|pre[- ]?chorus|bridge|intro|outro|tag|interlude|instrumental|ending|refrain|turnaround|vamp|coda|solo|post[- ]?chorus|hook|breakdown|repeat)\b[\w \-/#&.:,()]*$/i;

  const isChordLine = (line) => {
    const toks = line.trim().split(/[\s,]+/).filter(Boolean); let n = 0;
    for (const t of toks) { if (M.parseChord(t)) n++; else if (!/^[|/\\\-–—.:()%x\d]+$/i.test(t)) return false; }
    return n > 0;
  };
  const hasInline = (l) => /\[[^\]]+\]/.test(l) && /\[[A-G1-7][^\]]*\]/.test(l);
  const sectionName = (raw) => {
    let t = raw.trim();
    t = t.replace(/^[\[(*#\-=~_\s]+/, '').replace(/[\])*#\-=~_\s:]+$/, '').replace(/\s+/g, ' ');
    if (!t || t.length > 40) return null;
    if (!SECTION_RE.test(t) || M.parseChord(t)) return null;
    return t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bX(\d)\b/g, 'x$1');
  };

  function mergeChords(chordLine, lyric) {
    const re = /[^\s,]+/g; const toks = []; let m;
    while ((m = re.exec(chordLine))) { if (M.parseChord(m[0])) toks.push({ s: m[0], col: m.index }); }
    let text = lyric.replace(/\t/g, '    ').replace(/\s+$/, '');
    toks.forEach((t) => { while (t.col > 0 && t.col < text.length && /[\p{M}‌‍]/u.test(text[t.col])) t.col--; });
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i]; if (text.length < t.col) text = text.padEnd(t.col, ' ');
      text = text.slice(0, t.col) + '[' + t.s + ']' + text.slice(t.col);
    }
    return text;
  }

  function smartClean(input) {
    const info = { title: '', author: '', key: '', capo: 0, sections: 0, chords: 0, lines: 0 };
    let lines = String(input || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n').map((l) => l.replace(/\t/g, '    ').replace(/\s+$/, ''));
    // metadata lines
    const out = []; const chordNames = [];
    const cap = lines.find((l) => /^\s*capo\s*[:.]?\s*(\d{1,2})/i.test(l)); if (cap) info.capo = +/(\d{1,2})/.exec(cap)[1];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]; const t = raw.trim();
      if (!t) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
      let m = /^(?:key|original key)\s*[:=]\s*([A-G][#b]?m?)\b/i.exec(t); if (m) { info.key = m[1]; continue; }
      m = /^(?:title|song)\s*[:=]\s*(.+)$/i.exec(t); if (m) { info.title = info.title || m[1].trim(); continue; }
      m = /^(?:artist|author|by)\s*[:=]?\s+(.+)$/i.exec(t); if (m && !hasInline(t) && out.length < 3) { info.author = info.author || m[1].trim(); continue; }
      if (URL_RE.test(t) || JUNK_RE.test(t)) continue;
      const sec = sectionName(t);
      if (sec && !isChordLine(t)) { out.push('[' + sec + ']'); info.sections++; continue; }
      if (hasInline(raw)) { out.push(raw.replace(/^\s+/, '')); (raw.match(/\[([^\]]+)\]/g) || []).forEach((c) => { const n = c.slice(1, -1); if (M.parseChord(n)) { chordNames.push(n); info.chords++; } }); info.lines++; continue; }
      if (isChordLine(t)) {
        const names = t.split(/[\s,]+/).filter((x) => M.parseChord(x));
        names.forEach((n) => chordNames.push(n)); info.chords += names.length;
        const next = lines[i + 1];
        const nt = next === undefined ? '' : next.trim();
        if (nt && !isChordLine(nt) && !sectionName(nt) && !URL_RE.test(nt) && !JUNK_RE.test(nt) && !hasInline(next)) {
          out.push(mergeChords(raw, next)); i++; info.lines++;
        } else out.push(names.join('  '));
        continue;
      }
      out.push(raw.replace(/^\s{1,}/, '')); info.lines++;
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    // title / artist from the first lines when they stand alone
    if (!info.title && out.length > 1) {
      const first = out[0];
      const m = /^(.{2,60}?)\s+(?:-|–|—|by)\s+(.{2,50})$/i.exec(first);
      if (m && !/\[/.test(first) && (out[1] === '' || /^\[/.test(out[1]))) { info.title = m[1].trim(); info.author = info.author || m[2].trim(); out.shift(); while (out[0] === '') out.shift(); }
      else if (first.length <= 50 && !/\[/.test(first) && out[1] === '' && out[2] && (/^\[/.test(out[2]) || chordNames.length)) { info.title = first.trim(); out.shift(); while (out[0] === '') out.shift(); }
    }
    // key
    if (!info.key && chordNames.length) {
      const objs = chordNames.map((n) => M.parseChord(n)).filter((c) => c && c.t === 'L');
      if (objs.length) {
        let k = M.inferKey(objs);
        const f = objs[0], l = objs[objs.length - 1];
        const minorQ = (c) => /^(m(?!aj)|min)/.test(c.q);
        const kp = M.pcOf ? M.pcOf(k) : null;
        if (kp != null && minorQ(f) && f.pc === M.mod(kp + 9) && (minorQ(l) || l.pc === f.pc)) k = f.root + (f.q ? '' : '') + 'm';
        info.key = k;
      }
    }
    info.body = out.join('\n');
    return info;
  }
  X.smartClean = smartClean;

  /* ----- editor buttons and sheet ----- */
  X.hooks.editTools = () => `<div class="btnrow tight etools"><button class="btn sm" data-act="sp-open">✨ Smart paste</button><button class="btn sm" data-act="sp-find">Find chords online</button></div>`;
  const findOnline = () => {
    const t = (($('#sp-title') || {}).value) || (($('#e-title') || {}).value) || ''; const a = (($('#e-author') || {}).value) || '';
    if (!t.trim()) { toast('Type the song title first'); return; }
    window.open('https://www.google.com/search?q=' + encodeURIComponent((t + ' ' + a + ' chords lyrics').replace(/\s+/g, ' ').trim()), '_blank', 'noopener');
  };
  A['sp-find'] = findOnline;
  let cur = null, timer = 0;
  A['sp-open'] = () => {
    cur = null;
    sheet(`<div class="sh-h">Smart paste</div>
      <p class="small muted">Copy a chord chart or lyrics from anywhere, then paste it here. The app tidies it, puts the chords over the right words and finds the key.</p>
      <div class="btnrow tight"><button class="btn sm" data-act="sp-clip">Paste from clipboard</button><button class="btn sm" data-act="sp-find">Find chords online</button></div>
      <textarea id="sp-in" rows="6" spellcheck="false" placeholder="Paste here…" style="margin-top:10px"></textarea>
      <div id="sp-out" class="sp-out small muted">Nothing pasted yet.</div>
      <div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" id="sp-use" data-act="sp-use" disabled>Use this</button></div>`);
    $('#sp-in').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 250); });
  };
  A['sp-clip'] = async () => {
    try { const t = await navigator.clipboard.readText(); if (!t) { toast('The clipboard is empty'); return; } $('#sp-in').value = t; preview(); }
    catch (e) { toast('Your phone did not allow that. Long-press the box and choose Paste.', 4000); }
  };
  function preview() {
    const v = $('#sp-in').value; const out = $('#sp-out'); const use = $('#sp-use');
    if (!v.trim()) { cur = null; out.textContent = 'Nothing pasted yet.'; use.disabled = true; return; }
    cur = smartClean(v);
    const bits = [];
    if (cur.title) bits.push('Title: ' + esc(cur.title)); if (cur.author) bits.push('Artist: ' + esc(cur.author));
    bits.push('Key: ' + (cur.key ? esc(cur.key) : 'not found')); bits.push(cur.sections + ' sections'); bits.push(cur.chords + ' chords');
    out.innerHTML = `<div class="sp-stats">${bits.join(' · ')}</div><div class="sbody sp-prev" style="--fs:15px">${X.renderBody({ body: cur.body, key: cur.key, fmt: 'text' }, { shift: 0, capo: 0 })}</div>`;
    use.disabled = !cur.body.trim();
  }
  A['sp-use'] = () => {
    if (!cur) return; const c = cur; const ta = $('#e-body');
    const apply = () => {
      ta.value = c.body; ta.dispatchEvent(new Event('input', { bubbles: true }));
      const t = $('#e-title'); if (t && c.title && (!t.value.trim() || /^untitled/i.test(t.value))) t.value = c.title;
      const a = $('#e-author'); if (a && c.author && !a.value.trim()) a.value = c.author;
      const k = $('#e-key'); if (k && c.key && !k.value) { const o = [...k.options].find((x) => x.value === c.key || x.text === c.key); if (o) { k.value = o.value; k.dispatchEvent(new Event('change', { bubbles: true })); } }
      const n = $('#e-notes'); if (n && c.capo && !/capo/i.test(n.value)) n.value = (n.value ? n.value + '\n' : '') + 'Capo ' + c.capo;
      closeSheet(); toast('Pasted. Check it, then tap the tick to save.', 3500);
    };
    if (ta && ta.value.trim()) confirmBox('Replace the current lyrics?', 'The text in this song will be replaced with what you pasted. You can still leave without saving.', 'Replace', apply, true);
    else apply();
  };
})();
