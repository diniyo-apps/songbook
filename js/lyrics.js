/* Find lyrics: browse the free WorshipCommons English library (online), preview, and add songs to this phone. */
(function () {
  const X = window.SBX; const { $, esc, sheet, closeSheet, toast, ico } = X; const A = X.A; const PER = 20, MAXSEL = 10;
  const LICN = { PD: 'Public domain', WC: 'Free for worship', CC: 'Creative Commons', OT: 'Permission' };
  const LICLONG = { 'PD': 'Public domain: free to use.', 'WC': 'Free for worship use. The writer keeps the commercial rights.', 'CC-BY': 'Creative Commons BY: free to use if you credit the writer.', 'CC-BY-SA': 'Creative Commons BY-SA: credit the writer and share changes under the same licence.', 'larry-holder': 'Used with the writer’s permission. See the writer’s copyright page.' };
  let idx = null, st = { q: '', lic: 'PD', page: 0, sel: new Set(), loading: false };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  async function load() {
    if (idx) return idx;
    const r = await fetch('lyrics/index.json'); if (!r.ok) throw new Error('bad');
    idx = (await r.json()).map((a) => ({ id: a[0], t: a[1], w: a[2], k: a[3], bpm: a[4], l: a[5], y: a[6], n: norm(a[1] + ' ' + a[2]) }));
    return idx;
  }
  const filtered = () => {
    const q = norm(st.q).split(' ').filter(Boolean);
    return idx.filter((s) => (st.lic === 'PD' ? s.l === 'PD' : st.lic === 'FREE' ? s.l !== 'OT' : true) && q.every((w) => s.n.includes(w)));
  };
  A['ly-open'] = async () => {
    st = { q: '', lic: 'PD', page: 0, sel: new Set(), loading: false };
    sheet(`<div class="sh-h">Find lyrics</div>
      <p class="small muted">Free worship songs with chords, from the WorshipCommons library. Needs internet. Songs you add stay on this phone.</p>
      <div class="search"><input id="ly-q" type="search" placeholder="Search title or writer" autocomplete="off" enterkeyhint="search"></div>
      <div class="seg wherebar" id="ly-lic"><button data-act="ly-lic" data-v="PD" class="on">Public domain</button><button data-act="ly-lic" data-v="FREE">+ Free for worship</button><button data-act="ly-lic" data-v="ALL">All</button></div>
      <div id="ly-info" class="small muted" style="margin:8px 2px">Loading songs…</div>
      <div id="ly-list" class="pklist"></div>
      <div id="ly-pager" class="btnrow tight"></div>
      <div class="btnrow"><button class="btn" data-act="close-sheet">Close</button><button class="btn primary" id="ly-add" data-act="ly-add" disabled>Add selected</button></div>`, { full: true });
    let t = 0; $('#ly-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 0; paint(); }, 200); });
    try { await load(); paint(); } catch (e) { $('#ly-info').textContent = 'Could not load the song list. Check your internet and try again.'; }
  };
  A['ly-lic'] = (el) => { st.lic = el.dataset.v; st.page = 0; $('#ly-lic').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); paint(); };
  function paint() {
    if (!idx || !$('#ly-list')) return;
    const all = filtered(); const pages = Math.max(1, Math.ceil(all.length / PER)); if (st.page >= pages) st.page = pages - 1;
    const part = all.slice(st.page * PER, st.page * PER + PER);
    $('#ly-info').textContent = all.length ? `${all.length} song${all.length === 1 ? '' : 's'} · page ${st.page + 1} of ${pages}` : 'No songs match.';
    $('#ly-list').innerHTML = part.map((s) => { const on = st.sel.has(s.id); return `<div class="row pick ly-row ${on ? 'sel' : ''}"><button class="cb ${on ? 'on' : ''}" data-act="ly-pick" data-id="${esc(s.id)}" aria-label="Select">${on ? ico('check') : ''}</button><button class="rt ly-rt" data-act="ly-view" data-id="${esc(s.id)}"><span class="t">${esc(s.t)}</span><span class="a">${esc(s.w)}</span></button><i class="bd ly-lic ${s.l}">${LICN[s.l]}</i>${s.k ? `<i class="bd key">${esc(s.k)}</i>` : ''}</div>`; }).join('');
    $('#ly-pager').innerHTML = pages > 1 ? `<button class="btn sm" data-act="ly-pg" data-d="-1" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn sm" data-act="ly-pg" data-d="1" ${st.page < pages - 1 ? '' : 'disabled'}>Next</button>` : '';
    paintSel();
  }
  function paintSel() { const b = $('#ly-add'); if (!b) return; b.disabled = !st.sel.size; b.textContent = st.sel.size ? 'Add ' + st.sel.size + ' song' + (st.sel.size === 1 ? '' : 's') : 'Add selected'; }
  A['ly-pg'] = (el) => { st.page += +el.dataset.d; paint(); const l = $('#ly-list'); if (l) l.scrollTop = 0; };
  A['ly-pick'] = (el) => {
    const id = el.dataset.id;
    if (st.sel.has(id)) st.sel.delete(id); else { if (st.sel.size >= MAXSEL) { toast('Pick up to ' + MAXSEL + ' songs at a time'); return; } st.sel.add(id); }
    paint();
  };
  const get = async (id) => { const r = await fetch('lyrics/s/' + encodeURIComponent(id) + '.json'); if (!r.ok) throw new Error('bad'); return r.json(); };
  const credit = (d) => 'Source: WorshipCommons (worshipcommons.org)\nWriter: ' + (d.at || d.w || 'unknown') + (d.y ? ' (' + d.y + ')' : '') + '\nLicence: ' + (LICLONG[d.lic] || d.lic) + (d.lu ? '\n' + d.lu : '');
  A['ly-view'] = async (el) => {
    const id = el.dataset.id; const s = idx.find((x) => x.id === id);
    sheet(`<div class="sh-h">${esc(s.t)}</div><p class="small muted">${esc(s.w)}</p><div id="ly-prev" class="muted small">Loading…</div><div class="btnrow"><button class="btn" data-act="ly-back">Back</button><button class="btn primary" data-act="ly-add1" data-id="${esc(id)}">Add to my songs</button></div>`, { full: true });
    try {
      const d = await get(id);
      $('#ly-prev').className = 'ly-prevbox';
      $('#ly-prev').innerHTML = `<div class="sp-stats">${[d.k ? 'Key ' + esc(d.k) : '', d.bpm ? d.bpm + ' bpm' : '', esc(LICN[s.l])].filter(Boolean).join(' · ')}</div><div class="sbody sp-prev" style="--fs:15px">${X.renderBody({ body: d.b, key: d.k, fmt: 'text' }, { shift: 0, capo: 0 })}</div><p class="small muted ly-credit">${esc(LICLONG[d.lic] || d.lic)}</p>`;
    } catch (e) { $('#ly-prev').textContent = 'Could not load this song. Check your internet.'; }
  };
  A['ly-back'] = () => A['ly-open']();
  A['ly-add1'] = async (el) => { st.sel = new Set([el.dataset.id]); await addSel(); };
  A['ly-add'] = () => addSel();
  async function addSel() {
    const ids = [...st.sel]; if (!ids.length) return;
    let added = 0, dupe = 0, bad = 0; const P = X.prog, PE = X.progEnd;
    closeSheet();
    if (ids.length > 1 && P) P('Adding songs', 0, ids.length);
    for (let i = 0; i < ids.length; i++) {
      if (ids.length > 1 && P) P('Adding songs', i, ids.length);
      try {
        const d = await get(ids[i]);
        const same = X.S.songs.find((s) => !s.deleted && !s.cloud && norm(s.title) === norm(d.t) && norm(s.author) === norm(d.w));
        if (same) { dupe++; continue; }
        const c = window.Music.collectChords(d.b);
        const rec = X.newSong({ title: d.t, author: d.w, fmt: 'text', body: d.b, notes: credit(d), key: d.k || window.Music.inferKey(c.letters) || '', origin: 'worshipcommons:' + ids[i] });
        await X.saveSong(rec); added++;
      } catch (e) { bad++; if (!navigator.onLine) break; }
    }
    if (ids.length > 1 && PE) PE(bad ? 'Finished with problems' : 'Added', !bad);
    st.sel = new Set();
    toast((added ? 'Added ' + added + ' song' + (added === 1 ? '' : 's') : 'Nothing added') + (dupe ? ' · ' + dupe + ' already in your songbook' : '') + (bad ? ' · ' + bad + ' could not load' : ''), 4000);
    if (added) X.render();
  }
})();
