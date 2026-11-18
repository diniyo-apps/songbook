/* Chord diagrams: guitar fingerings (open + movable shapes) and piano keys, drawn as SVG. */
(function (root) {
  const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const pcOf = (n) => { let p = NOTE_PC[n[0]]; for (const c of n.slice(1)) { if (c === '#') p++; else if (c === 'b') p--; } return ((p % 12) + 12) % 12; };

  const QUAL = [
    [/^(|maj|M)$/, [0, 4, 7], ''], [/^(m|min|-)$/, [0, 3, 7], 'm'], [/^7$/, [0, 4, 7, 10], '7'],
    [/^(maj7|M7|Δ|Δ7)$/, [0, 4, 7, 11], 'maj7'], [/^(m7|min7|-7)$/, [0, 3, 7, 10], 'm7'],
    [/^(sus4|sus)$/, [0, 5, 7], 'sus4'], [/^sus2$/, [0, 2, 7], 'sus2'], [/^(add9|2|add2)$/, [0, 4, 7, 14], 'add9'],
    [/^(madd9|minadd9)$/, [0, 3, 7, 14], 'madd9'], [/^6$/, [0, 4, 7, 9], '6'], [/^(m6|min6)$/, [0, 3, 7, 9], 'm6'],
    [/^(dim|º|°|o)$/, [0, 3, 6], 'dim'], [/^(dim7|º7|°7|o7)$/, [0, 3, 6, 9], 'dim7'], [/^(aug|\+)$/, [0, 4, 8], 'aug'],
    [/^9$/, [0, 4, 7, 10, 14], '9'], [/^(m9|min9)$/, [0, 3, 7, 10, 14], 'm9'], [/^maj9$/, [0, 4, 7, 11, 14], 'maj9'],
    [/^7sus4$/, [0, 5, 7, 10], '7sus4'], [/^5$/, [0, 7], '5'], [/^(m7b5|ø|ø7)$/, [0, 3, 6, 10], 'm7b5'],
  ];

  function analyse(name) {
    const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(String(name || '').trim());
    if (!m) return null;
    const q = m[2].replace(/[()]/g, '');
    const base = { root: pcOf(m[1]), rootName: m[1], bass: m[3] ? pcOf(m[3]) : null, bassName: m[3] || '' };
    for (const [re, iv, key] of QUAL) if (re.test(q)) return { ...base, q: key, iv };
    const minor = /^m(?!aj)/.test(q);
    return { ...base, q: minor ? 'm' : '', iv: minor ? [0, 3, 7] : [0, 4, 7], approx: true };
  }

  // ---- guitar ----
  const OPEN = {
    '0:': 'x32010', '0:maj7': 'x32000', '0:7': 'x32310', '0:add9': 'x32030',
    '9:': 'x02220', '9:m': 'x02210', '9:7': 'x02020', '9:maj7': 'x02120', '9:m7': 'x02010', '9:sus2': 'x02200', '9:sus4': 'x02230',
    '7:': '320003', '7:7': '320001', '7:maj7': '320002',
    '4:': '022100', '4:m': '022000', '4:7': '020100', '4:m7': '020000', '4:maj7': '021100', '4:sus4': '022200',
    '2:': 'xx0232', '2:m': 'xx0231', '2:7': 'xx0212', '2:maj7': 'xx0222', '2:m7': 'xx0211', '2:sus2': 'xx0230', '2:sus4': 'xx0233',
    '5:maj7': 'xx3210', '11:7': 'x21202',
  };
  const E_SHAPE = { '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0], maj7: [0, 2, 1, 1, 0, 0], sus4: [0, 2, 2, 2, 0, 0], 6: [0, 2, 2, 1, 2, 0], m6: [0, 2, 2, 0, 2, 0], 5: [0, 2, 2, -1, -1, -1], '7sus4': [0, 2, 0, 2, 0, 0], m7b5: [0, 1, 0, 0, -1, -1] };
  const A_SHAPE = { '': [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0], maj7: [-1, 0, 2, 1, 2, 0], sus4: [-1, 0, 2, 2, 3, 0], sus2: [-1, 0, 2, 2, 0, 0], 6: [-1, 0, 2, 2, 2, 2], m6: [-1, 0, 2, 2, 1, 2], add9: [-1, 0, 2, 4, 2, 0], madd9: [-1, 0, 2, 4, 1, 0], dim: [-1, 0, 1, 2, 1, -1], aug: [-1, 0, 3, 2, 2, -1], 9: [-1, 0, 2, 4, 2, 3], 5: [-1, 0, 2, 2, -1, -1], '7sus4': [-1, 0, 2, 0, 3, 0], m7b5: [-1, 0, 1, 0, 1, -1] };

  function guitar(a) {
    const open = OPEN[a.root + ':' + a.q];
    if (open) return { frets: [...open].map((c) => (c === 'x' ? -1 : +c)), barre: null };
    const cands = [];
    if (E_SHAPE[a.q]) cands.push({ f: (a.root - 4 + 12) % 12, shape: E_SHAPE[a.q] });
    if (A_SHAPE[a.q]) cands.push({ f: (a.root - 9 + 12) % 12, shape: A_SHAPE[a.q] });
    if (!cands.length) return null;
    cands.sort((x, y) => x.f - y.f);
    const { f, shape } = cands[0];
    const frets = shape.map((r) => (r < 0 ? -1 : r + f));
    let barre = null;
    if (f > 0) { const idx = shape.map((r, i) => (r === 0 ? i : -1)).filter((i) => i >= 0); if (idx.length >= 2) barre = { fret: f, from: idx[0], to: idx[idx.length - 1] }; }
    return { frets, barre };
  }

  const css = (v) => `var(${v})`;
  const OPEN_PC = [4, 9, 2, 7, 11, 4];
  function guitarSvg(g, lab) {
    const W = 168, H = 178, x0 = 30, dx = 22, y0 = 40, dy = 25, nf = 5;
    const fretted = g.frets.filter((f) => f > 0);
    const minF = fretted.length ? Math.min(...fretted) : 1, maxF = fretted.length ? Math.max(...fretted) : 1;
    const base = maxF <= 5 ? 1 : minF;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:190px" role="img" aria-label="Guitar chord diagram" font-family="inherit">`;
    // grid
    for (let i = 0; i < 6; i++) s += `<line x1="${x0 + i * dx}" y1="${y0}" x2="${x0 + i * dx}" y2="${y0 + nf * dy}" stroke="${css('--muted')}" stroke-width="1.4"/>`;
    for (let j = 0; j <= nf; j++) s += `<line x1="${x0}" y1="${y0 + j * dy}" x2="${x0 + 5 * dx}" y2="${y0 + j * dy}" stroke="${css('--muted')}" stroke-width="${j === 0 && base === 1 ? 4 : 1.4}"/>`;
    if (base > 1) s += `<text x="${x0 - 8}" y="${y0 + dy * 0.62}" text-anchor="end" font-size="13" fill="${css('--text2')}">${base}fr</text>`;
    if (g.barre) {
      const y = y0 + (g.barre.fret - base + 0.5) * dy;
      s += `<rect x="${x0 + g.barre.from * dx - 7}" y="${y - 7}" width="${(g.barre.to - g.barre.from) * dx + 14}" height="14" rx="7" fill="${css('--accent')}"/>`;
    }
    g.frets.forEach((f, i) => {
      const x = x0 + i * dx;
      if (f < 0) s += `<path d="M${x - 5} ${y0 - 18}l10 10M${x + 5} ${y0 - 18}l-10 10" stroke="${css('--muted')}" stroke-width="2" stroke-linecap="round"/>`;
      else if (f === 0) s += `<circle cx="${x}" cy="${y0 - 13}" r="5" fill="none" stroke="${css('--text2')}" stroke-width="2"/>`;
      else {
        const cy = y0 + (f - base + 0.5) * dy;
        s += `<circle cx="${x}" cy="${cy}" r="9.5" fill="${css('--accent')}"/>`;
        if (lab) s += `<text x="${x}" y="${cy + 3.6}" text-anchor="middle" font-size="10" font-weight="800" fill="#0b0f16">${lab((OPEN_PC[i] + f) % 12)}</text>`;
      }
    });
    return s + '</svg>';
  }

  // ---- piano ----
  function pianoSvg(a, flats, lab) {
    const WH = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24], BL = [1, 3, 6, 8, 10, 13, 15, 18, 20, 22];
    const w = 22, h = 92, bw = 14, bh = 56, W = WH.length * w, H = h + 26;
    const names = flats ? FLAT : SHARP;
    const lit = new Map();
    const ivs = a.iv.map((i) => a.root + i).map((n) => (n > 24 ? n - 12 : n));
    ivs.forEach((n) => lit.set(n, 'c'));
    if (a.bass != null) { const b = a.bass; lit.set(b, 'b'); }
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="Piano chord diagram" font-family="inherit">`;
    WH.forEach((n, i) => {
      const on = lit.get(n);
      s += `<rect x="${i * w + 0.5}" y="0.5" width="${w - 1}" height="${h}" rx="3" fill="${on ? css('--accent') : 'rgba(255,255,255,.88)'}" stroke="rgba(0,0,0,.5)"/>`;
      if (on) s += `<text x="${i * w + w / 2}" y="${h + 16}" text-anchor="middle" font-size="12" font-weight="700" fill="${css('--text')}">${lab ? lab(n % 12) : names[n % 12]}</text>`;
    });
    BL.forEach((n) => {
      const wi = WH.indexOf(n - 1); const x = (wi + 1) * w - bw / 2; const on = lit.get(n);
      s += `<rect x="${x}" y="0.5" width="${bw}" height="${bh}" rx="2.5" fill="${on ? css('--accent') : '#15181d'}" stroke="${on ? 'rgba(0,0,0,.6)' : '#000'}"/>`;
      if (on) s += `<text x="${x + bw / 2}" y="${h + 16}" text-anchor="middle" font-size="12" font-weight="700" fill="${css('--text')}">${lab ? lab(n % 12) : names[n % 12]}</text>`;
    });
    return s + '</svg>';
  }

  // opts.tonic (pitch class of the key being played) + opts.mode 'numbers' label notes as Nashville numbers
  function info(name, opts) {
    const a = analyse(name); if (!a) return null;
    const flats = /b/.test(a.rootName) || /^(F|Bb|Eb|Ab|Db)$/.test(a.rootName);
    const names = flats ? FLAT : SHARP;
    const num = opts && opts.mode === 'numbers' && opts.tonic != null && root.Music;
    const lab = num ? (pc) => root.Music.degName(opts.tonic, pc) : null;
    const nm = (pc) => (lab ? lab(pc % 12) : names[pc % 12]);
    const notes = a.iv.map((i) => nm(a.root + i));
    const g = guitar(a);
    return { a, notes, bass: a.bass != null ? nm(a.bass) : '', guitar: g ? guitarSvg(g, lab || ((pc) => names[pc])) : '', piano: pianoSvg(a, flats, lab), approx: !!a.approx, rootLabel: nm(a.root) };
  }

  root.Chords = { info, analyse, frets: (n) => { const a = analyse(n); return a && guitar(a); } };
  if (typeof module !== 'undefined') module.exports = root.Chords;
})(typeof self !== 'undefined' ? self : globalThis);
