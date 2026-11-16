/* Music core: chord parsing, Nashville numbers, transposing, song text parsing. No DOM here. */
(function (root) {
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const FLAT_TONICS = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db (major tonic)
  const CHROMA_DEG = { 1: [2, -1], 3: [3, -1], 6: [4, 1], 8: [6, -1], 10: [7, -1] };
  const SBP_KEYS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
  const NNS_QUAL = ['', 'm', 'm', '', '', 'm', 'º'];
  const NNS_LABEL = ['1', '2m', '3m', '4', '5', '6m', '7º'];

  const mod = (n) => ((n % 12) + 12) % 12;
  function pcOf(name) {
    let pc = NOTE_PC[name[0]];
    for (const ch of name.slice(1)) { if (ch === '#') pc++; else if (ch === 'b') pc--; }
    return mod(pc);
  }

  // ---- keys -------------------------------------------------------------
  // key string -> { pc, minor, tonic (major tonic used for degrees), sharpPref }
  function parseKey(k) {
    if (!k) return null;
    const m = /^([A-G][#b]?)(m|min)?$/.exec(String(k).trim());
    if (!m) return null;
    const pc = pcOf(m[1]);
    const minor = !!m[2];
    return { pc, minor, tonic: minor ? mod(pc + 3) : pc, name: m[1], sharp: m[1].includes('#'), flat: m[1].includes('b') };
  }
  function useFlats(tonicPc, hintKey) {
    if (hintKey && hintKey.sharp) return false;
    if (hintKey && hintKey.flat) return true;
    return FLAT_TONICS.has(tonicPc);
  }
  function pcName(pc, flats) { return (flats ? FLAT : SHARP)[mod(pc)]; }
  // spell a note for a given key: notes in the key follow the key's sharps/flats; borrowed notes (like the flat 7) use flats
  function spell(pc, outTonic, flatsKey) {
    pc = mod(pc); if (outTonic == null) outTonic = 0;
    if (MAJOR.some((st) => mod(outTonic + st) === pc)) return (flatsKey ? FLAT : SHARP)[pc];
    if (flatsKey) return FLAT[pc];
    return pc === 6 ? 'F#' : (pc === 1 || pc === 3 || pc === 8 || pc === 10) ? FLAT[pc] : SHARP[pc];
  }

  // name of a key after shifting by n semitones (keeps minor)
  function shiftKey(k, shift) {
    const pk = parseKey(k);
    if (!pk) return '';
    const newPc = mod(pk.pc + shift);
    const tonic = pk.minor ? mod(newPc + 3) : newPc;
    return pcName(newPc, useFlats(tonic, shift === 0 ? pk : null)) + (pk.minor ? 'm' : '');
  }
  const ALL_KEYS = (() => {
    const maj = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return { major: maj, minor: maj.map((k) => k.replace('Db', 'C#').replace('Ab', 'G#').replace('Eb', 'D#') + 'm').map((k) => k) };
  })();

  // ---- chords -----------------------------------------------------------
  const LQ = '(?:maj|min|dim|aug|sus|add|m|M|\\+|°|º|o|-|b|#|\\d|\\(|\\)|\\*)*';
  const LETTER_RE = new RegExp('^([A-G][#b]?)(' + LQ + ')(?:/([A-G][#b]?))?$');
  const NUM_RE = new RegExp('^([b#]?)([1-7])(' + LQ + ')(?:/([b#]?)([1-7]))?$');

  function parseChord(tok) {
    const pm = /^\*+/.exec(tok); // marker such as [*G]: keep the star, still transpose the chord
    if (pm) { const c = parseChord(tok.slice(pm[0].length)); if (c) c.pre = pm[0]; return c; }
    let m = LETTER_RE.exec(tok);
    if (m) return { t: 'L', pc: pcOf(m[1]), q: m[2], bass: m[3] !== undefined ? pcOf(m[3]) : null, root: m[1], bassName: m[3] };
    m = NUM_RE.exec(tok);
    if (m) {
      const acc = (s) => (s === 'b' ? -1 : s === '#' ? 1 : 0);
      return { t: 'N', acc: acc(m[1]), deg: +m[2], q: m[3], bass: m[5] ? { acc: acc(m[4]), deg: +m[5] } : null };
    }
    return null;
  }

  function degToPc(tonic, deg, acc) { return mod(tonic + MAJOR[deg - 1] + (acc || 0)); }
  function pcToDeg(tonic, pc) {
    const d = mod(pc - tonic);
    const i = MAJOR.indexOf(d);
    if (i >= 0) return { deg: i + 1, acc: 0 };
    const c = CHROMA_DEG[d];
    return { deg: c[0], acc: c[1] };
  }
  const accStr = (a) => (a < 0 ? 'b' : a > 0 ? '#' : '');

  // ctx: { mode:'letters'|'numbers', tonic (major tonic pc of ORIGINAL key or null), shift, capo, flats, out (tonic pc being played) }
  function renderChord(ch, ctx) { return (ch.pre || '') + renderChordCore(ch, ctx); }
  function renderChordCore(ch, ctx) {
    const { mode, tonic, shift, capo, flats, out } = ctx;
    const move = shift - capo;
    if (mode === 'numbers' && tonic != null) {
      const rel = (pc) => pcToDeg(tonic, pc);
      const root = ch.t === 'N' ? { deg: ch.deg, acc: ch.acc } : rel(ch.pc);
      let bass = null;
      if (ch.bass != null) bass = ch.t === 'N' ? ch.bass : rel(ch.bass);
      return accStr(root.acc) + root.deg + ch.q + (bass ? '/' + accStr(bass.acc) + bass.deg : '');
    }
    if (ch.t === 'N') {
      if (tonic == null) return accStr(ch.acc) + ch.deg + ch.q + (ch.bass ? '/' + accStr(ch.bass.acc) + ch.bass.deg : '');
      const root = spell(degToPc(tonic, ch.deg, ch.acc) + move, out, flats);
      const bass = ch.bass ? spell(degToPc(tonic, ch.bass.deg, ch.bass.acc) + move, out, flats) : null;
      return root + ch.q + (bass ? '/' + bass : '');
    }
    if (move === 0) return ch.root + ch.q + (ch.bassName ? '/' + ch.bassName : ''); // unchanged: show exactly as written
    const root = spell(ch.pc + move, out, flats);
    const bass = ch.bass != null ? spell(ch.bass + move, out, flats) : null;
    return root + ch.q + (bass ? '/' + bass : '');
  }

  // the seven Nashville chords for a key (shown in the Key sheet)
  function nnsRow(k) {
    const pk = parseKey(k);
    if (!pk) return null;
    const flats = useFlats(pk.tonic, pk);
    return NNS_LABEL.map((lab, i) => ({ label: lab, chord: pcName(pk.tonic + MAJOR[i], flats) + NNS_QUAL[i] }));
  }

  // ---- text -> structure -------------------------------------------------
  const SEP_RE = /^(\||\|\||\/\/?|-|—|–|:|x\d+|\d+x|\(?x\d+\)?|N\.?C\.?|%|\.{2,}|~)$/i;
  const HEAD_RE = /^(verse|chorus|pre[- ]?chorus|bridge|intro|outro|tag|interlude|instrumental|ending|refrain|turnaround|vamp|coda|solo|post[- ]?chorus|hook|channel)\b[\w \-/#&.]*$/i;

  function isHeaderText(t) {
    if (t.length > 34) return false;
    const x = t.replace(/[:：]\s*$/, '').replace(/^\[|\]$/g, '').trim();
    return HEAD_RE.test(x) && !parseChordLoose(x);
  }
  function parseChordLoose(x) { const p = parseChord(x); return p && x.length <= 4 ? p : null; }

  function tokenize(line) {
    const re = /[^\s,]+/g; const list = []; let m; let chords = 0;
    while ((m = re.exec(line))) {
      const raw = m[0];
      const ch = parseChord(raw);
      if (ch) { list.push({ raw, col: m.index, ch }); chords++; }
      else if (SEP_RE.test(raw)) list.push({ raw, col: m.index, ch: null, sep: true });
      else return null;
    }
    return chords ? { list, chords } : null;
  }
  const hasInline = (s) => /\[[^\]]+\]/.test(s);

  function parseInline(raw) {
    const segs = []; const re = /\[([^\]]+)\]/g; let last = 0; let m; let pending = null;
    const pushText = (t) => { segs.push({ c: pending, t }); pending = null; };
    while ((m = re.exec(raw))) {
      const before = raw.slice(last, m.index);
      if (before || pending) pushText(before);
      const tok = m[1].trim();
      const ch = parseChord(tok);
      pending = ch ? { ch } : { text: tok };
      last = m.index + m[0].length;
    }
    const rest = raw.slice(last);
    if (rest || pending) pushText(rest);
    return segs;
  }

  function mergeChordLyric(toks, lyric) {
    const segs = [];
    let text = lyric.replace(/\t/g, '    ');
    toks = toks.map((t) => { let c = t.col; while (c > 0 && c < text.length && /[\p{M}\u200c\u200d]/u.test(text[c])) c--; return { ...t, col: c }; });
    const first = toks[0].col;
    if (text.length < toks[toks.length - 1].col) text = text.padEnd(toks[toks.length - 1].col, ' ');
    if (first > 0) segs.push({ c: null, t: text.slice(0, first) });
    toks.forEach((tk, i) => {
      const end = i + 1 < toks.length ? toks[i + 1].col : text.length;
      const c = tk.ch ? { ch: tk.ch } : { text: tk.raw };
      segs.push({ c, t: text.slice(tk.col, end) });
    });
    return segs;
  }

  // Keep letter clusters (Sinhala etc.) whole when a chord marker falls inside one.
  const MARK = /^[\p{M}\u200c\u200d]/u;
  function fixClusters(segs) {
    for (let i = 1; i < segs.length; i++) {
      let guard = 0;
      while (segs[i].t && segs[i - 1].t && (MARK.test(segs[i].t) || /\u200d$/.test(segs[i - 1].t)) && guard++ < 6) {
        const prev = segs[i - 1].t; let j = prev.length;
        while (j > 0 && /[\p{M}\u200c\u200d]/u.test(prev[j - 1])) j--;
        if (j > 0) j--; // include the base letter
        segs[i - 1].t = prev.slice(0, j); segs[i].t = prev.slice(j) + segs[i].t;
      }
    }
    return segs;
  }

  function parseSong(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      if (!t) { out.push({ k: 'blank' }); continue; }
      let m = /^\{\s*(?:c|comment|ci|comment_italic|cb|sov|soc|sob)\s*:\s*(.*?)\s*\}$/i.exec(t);
      if (m) { out.push({ k: 'head', text: m[1] }); continue; }
      if (/^\{\s*(soc|eoc|sov|eov|sob|eob|start_of_\w+|end_of_\w+)\s*\}$/i.test(t)) continue;
      if (/^\{.*\}$/.test(t)) continue;
      m = /^\[([^\]]+)\]$/.exec(t);
      if (m && !parseChord(m[1].trim())) { out.push({ k: 'head', text: m[1].trim() }); continue; }
      if (hasInline(raw)) { out.push({ k: 'line', segs: fixClusters(parseInline(raw)) }); continue; }
      if (isHeaderText(t)) { out.push({ k: 'head', text: t.replace(/[:：]\s*$/, '') }); continue; }
      const tk = tokenize(raw);
      if (tk) {
        const next = lines[i + 1];
        const nt = next === undefined ? '' : next.trim();
        if (nt && !tokenize(next) && !isHeaderText(nt) && !/^\{/.test(nt) && !hasInline(next)) {
          out.push({ k: 'line', segs: fixClusters(mergeChordLyric(tk.list, next)) });
          i++;
        } else out.push({ k: 'chords', toks: tk.list });
        continue;
      }
      out.push({ k: 'line', segs: [{ c: null, t: raw }] });
    }
    return out;
  }

  // all chords found in a text (for key inference & style detection)
  function collectChords(text) {
    const res = { letters: [], numbers: 0 };
    const rows = parseSong(text);
    const add = (c) => {
      if (!c || !c.ch) return;
      if (c.ch.t === 'L') res.letters.push(c.ch); else res.numbers++;
    };
    rows.forEach((r) => {
      if (r.k === 'line') r.segs.forEach((s) => add(s.c));
      else if (r.k === 'chords') r.toks.forEach((t) => add(t.ch ? { ch: t.ch } : null));
    });
    return res;
  }

  function inferKey(chords) {
    if (!chords.length) return '';
    const scores = [];
    for (let t = 0; t < 12; t++) {
      let s = 0;
      chords.forEach((c) => {
        const d = mod(c.pc - t); const i = MAJOR.indexOf(d);
        if (i >= 0) { s += 1; const minor = /^(m(?!aj)|min)/.test(c.q); if ((NNS_QUAL[i] === 'm') === minor) s += 0.5; }
      });
      if (chords[0].pc === t) s += 3;
      if (chords[chords.length - 1].pc === t) s += 2;
      scores.push(s);
    }
    let best = 0; scores.forEach((s, i) => { if (s > scores[best]) best = i; });
    return pcName(best, FLAT_TONICS.has(best));
  }

  function keyFromTitle(title) {
    const m = /\s[-–]\s*([A-G][#b]?m?)(?:\s+to\s+.*)?\s*$/.exec(title || '');
    return m ? m[1] : '';
  }
  function keyFromText(txt) {
    const m = /\bkey\s*(?:of)?\s*[-:–]?\s*([A-G][#b]?m?)\b/i.exec(txt || '');
    return m ? m[1][0].toUpperCase() + m[1].slice(1) : '';
  }
  function keyFromSbpIndex(i) { return i >= 0 && i < 12 ? SBP_KEYS[i] : ''; }
  function sbpIndexFromKey(k) { const p = parseKey(k); return p ? mod(p.pc - 9) : -1; }

  const api = {
    SHARP, FLAT, ALL_KEYS, NNS_LABEL, parseKey, parseChord, renderChord, nnsRow, shiftKey, useFlats, pcName, pcOf, spell,
    parseSong, collectChords, inferKey, keyFromTitle, keyFromText, keyFromSbpIndex, sbpIndexFromKey, mod,
  };
  root.Music = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
