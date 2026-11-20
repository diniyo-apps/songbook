/* Songbook cloud edition: sign-in, shared library sync, lead publishing, admin people screen.
   Everything works offline; the cloud only adds the shared library on top of the local one. */
(function () {
  const X = window.SBX; const { S, $, $$, esc, ico, sheet, closeSheet, toast, confirmBox, songById, setById, live, now, uid, go, route, DB } = X;
  const URL_ = 'https://sauknneopfwdqdbedqkk.supabase.co';
  const KEY = 'sb_publishable_MhpwsCogDbryXMt00Bx93w_l5sqttRq';
  const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  const C = { session: LS.get('sb_cloud_session'), profile: LS.get('sb_cloud_profile'), last: LS.get('sb_cloud_last') || 0, busy: false, msg: '', gate: null };
  X.cloud = C;

  /* ---------- tiny API client ---------- */
  function fail(msg, extra) { const e = new Error(msg); Object.assign(e, extra || {}); return e; }
  async function raw(path, o = {}) {
    const h = Object.assign({ apikey: KEY }, o.headers || {});
    if (o.auth !== false) h.Authorization = 'Bearer ' + ((C.session && C.session.access_token) || KEY);
    else h.Authorization = 'Bearer ' + KEY;
    if (o.json !== undefined) { h['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.json); }
    let r;
    try { r = await fetch(URL_ + path, { method: o.method || 'GET', headers: h, body: o.body }); } catch (e) { throw fail('You are offline.', { offline: true }); }
    return r;
  }
  async function errOf(r) {
    let j = null; try { j = await r.json(); } catch (e) {}
    const m = (j && (j.error_description || j.msg || j.message || j.error)) || ('Error ' + r.status);
    return fail(/invalid login/i.test(m) ? 'Wrong email or password.' : /banned/i.test(m) ? 'This account is switched off. Ask an admin.' : String(m), { status: r.status });
  }
  async function fresh() {
    const s = C.session; if (!s) return;
    if (s.expires_at && s.expires_at * 1000 - now() > 60000) return;
    const r = await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, json: { refresh_token: s.refresh_token } });
    if (!r.ok) { const e = await errOf(r); if (r.status >= 400 && r.status < 500) { dropSession('Please sign in again.'); } throw e; }
    setSession(await r.json());
  }
  async function api(path, o = {}) {
    await fresh();
    let r = await raw(path, o);
    if (r.status === 401 && C.session) { C.session.expires_at = 0; await fresh(); r = await raw(path, o); }
    if (!r.ok) throw await errOf(r);
    if (o.blob) return r.arrayBuffer();
    const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch (e) { return t; }
  }
  function setSession(j) {
    C.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(now() / 1000) + (j.expires_in || 3600), user: j.user || (C.session && C.session.user) };
    LS.set('sb_cloud_session', C.session);
  }
  function dropSession(msg) { C.session = null; C.profile = null; LS.del('sb_cloud_session'); LS.del('sb_cloud_profile'); C.msg = msg || ''; }

  /* ---------- who am I ---------- */
  const active = () => !!(C.session && C.profile && C.profile.status === 'active');
  const isAdmin = () => active() && C.profile.is_admin;
  const leadTeams = () => (C.profile && C.profile.teams || []).filter((t) => t.role === 'lead');
  const isLead = (team) => active() && (team ? leadTeams().some((t) => t.id === team) : leadTeams().length > 0);
  async function loadProfile() {
    const uidv = C.session.user.id;
    const [p, m, t] = await Promise.all([
      api('/rest/v1/profiles?id=eq.' + uidv + '&select=*'),
      api('/rest/v1/memberships?user_id=eq.' + uidv + '&select=team_id,role'),
      api('/rest/v1/teams?select=id,name'),
    ]);
    if (!p || !p[0]) throw fail('Account not found.');
    const names = {}; (t || []).forEach((x) => { names[x.id] = x.name; });
    C.profile = Object.assign({}, p[0], { teams: (m || []).map((x) => ({ id: x.team_id, name: names[x.team_id] || 'Team', role: x.role })) });
    LS.set('sb_cloud_profile', C.profile);
  }
  async function signIn(email, pw) {
    const r = await raw('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, json: { email: email.trim().toLowerCase(), password: pw } });
    if (!r.ok) throw await errOf(r);
    setSession(await r.json()); C.msg = ''; LS.del('sb_cloud_skip');
    await loadProfile();
  }
  async function signUp(name, email, pw) {
    const r = await raw('/functions/v1/signup', { method: 'POST', auth: false, json: { name: name.trim(), email: email.trim().toLowerCase(), password: pw } });
    if (!r.ok) throw await errOf(r);
    await signIn(email, pw);
  }

  /* ---------- content helpers ---------- */
  const tagsOf = (s) => (Array.isArray(s.tags) ? s.tags : []).join(',');
  const sigOf = (s) => MD5.text(JSON.stringify([s.title || '', s.author || '', s.key || '', s.fmt || 'text', s.body || '', tagsOf(s), s.fmt === 'pdf' ? (s.hash || '') : '']));
  const edited = (s) => !!(s.cloud && s.cloud.base && sigOf(s) !== s.cloud.base);
  const payload = (s) => ({ by: (C.profile && C.profile.name) || '', title: s.title || '', author: s.author || '', key: s.key || '', fmt: s.fmt || 'text', body: s.body || '', tags: Array.isArray(s.tags) ? s.tags : [], raw: s.raw || null, pdfFile: s.pdfFile || null });
  const setSig = (set) => MD5.text(JSON.stringify([set.name || '', (set.items || []).map((i) => { const sg = songById(i.songId); return sg && sg.cloud ? sg.cloud.id : i.songId; })]));
  const setEdited = (set) => !!(set.cloud && set.cloud.base && setSig(set) !== set.cloud.base);
  async function sha(buf) { const d = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  const norm = (x) => String(x || '').trim().toLowerCase();

  function applySong(local, rem, pdfBuf) {
    const d = rem.data || {};
    Object.assign(local, { title: d.title || '', author: d.author || '', key: d.key || '', fmt: d.fmt || 'text', body: d.body || '', tags: d.tags || [], raw: d.raw || local.raw || null });
    if (d.fmt === 'pdf') { local.pdfFile = d.pdfFile || local.pdfFile; if (pdfBuf) { local.pdfId = local.pdfId || uid(); local.hash = MD5.bytes(pdfBuf); } }
    local.cloud = { id: rem.id, team: rem.team_id, ver: rem.version, base: sigOf(local), pdf: rem.pdf_path || null, hidden: !!rem.hidden, at: rem.updated_at || 0, by: d.by || '' };
    local.deleted = 0;
  }
  async function putSong(song) { const c = { ...song }; delete c._buf; await DB.put('songs', c); }
  async function download(path) { return api('/storage/v1/object/authenticated/pdfs/' + path.split('/').map(encodeURIComponent).join('/'), { blob: true }); }

  /* ---------- pull sync ---------- */
  async function sync(manual) {
    if (C.busy) return; if (!C.session) return;
    if (!navigator.onLine) { if (manual) toast('You are offline. The shared library will update when you are back online.'); return; }
    C.busy = true; paintStatus();
    try {
      await loadProfile();
      if (!active()) { C.busy = false; paintStatus(); if (manual) toast(C.profile.status === 'pending' ? 'Still waiting for approval' : 'This account is switched off'); gateRefresh(); return; }
      closeGate();
      if (C.profile.is_admin) { try { const pp = await api('/rest/v1/profiles?status=eq.pending&select=id'); C.pending = pp.length; } catch (e) {} } else C.pending = 0;
      const teams = (C.profile.teams || []).map((t) => t.id);
      let rs = [], rsets = [];
      for (const t of teams) {
        rs = rs.concat(await api('/rest/v1/cloud_songs?team_id=eq.' + t + '&select=id,team_id,version,hidden,deleted,pdf_path'));
        rsets = rsets.concat(await api('/rest/v1/cloud_sets?team_id=eq.' + t + '&select=id,team_id,version,deleted'));
      }
      const lead = isLead();
      const remote = new Map(rs.map((r) => [r.id, r]));
      let take = false;
      const need = [];
      for (const r of rs) {
        const l = S.songs.find((s) => s.cloud && s.cloud.id === r.id);
        if (r.deleted) continue;
        if (!l) need.push(r.id); else if (l.cloud.ver !== r.version) need.push(r.id); else if (l.cloud.hidden !== !!r.hidden) { l.cloud.hidden = !!r.hidden; await putSong(l); }
      }
      let data = new Map();
      for (let i = 0; i < need.length; i += 30) {
        const part = await api('/rest/v1/cloud_songs?id=in.(' + need.slice(i, i + 30).join(',') + ')&select=id,team_id,data,pdf_path,version,hidden,deleted,updated_at');
        part.forEach((p) => data.set(p.id, p));
      }
      if (need.length || S.songs.some((s) => s.cloud && !remote.has(s.cloud.id))) { if (now() - (S.meta.lastSnap || 0) > 6 * 3600 * 1000) await X.takeSnapshot('before shared update', true); take = true; }
      let added = 0, updated = 0, removed = 0, pdfDone = 0;
      for (const id of need) {
        const r = data.get(id); if (!r) continue;
        let l = S.songs.find((s) => s.cloud && s.cloud.id === id);
        let buf = null;
        const d = r.data || {};
        if (d.fmt === 'pdf' && r.pdf_path && !(l && l.cloud.pdf === r.pdf_path)) {
          try { if (need.length > 3) toast('Downloading PDFs… ' + (++pdfDone), 1500); buf = await download(r.pdf_path); } catch (e) { if (e.offline) throw e; continue; }
        }
        if (!l) {
          const twin = S.songs.find((s) => !s.cloud && !s.deleted && norm(s.title) === norm(d.title) && norm(s.author) === norm(d.author) && s.fmt === (d.fmt || 'text'));
          if (twin) {
            // same song already on this phone: link it; if different, let the person choose
            twin.cloud = { id, team: r.team_id, ver: 0, base: '', pdf: null, hidden: !!r.hidden };
            const keepBody = twin.body, keepHash = twin.hash;
            const probe = Object.assign({}, twin); applySong(probe, r, buf);
            if (twin.fmt === 'pdf' ? (probe.hash === keepHash || !buf) : (probe.body === keepBody && probe.key === twin.key && tagsOf(probe) === tagsOf(twin))) {
              Object.assign(twin, { cloud: probe.cloud }); twin.cloud.base = sigOf(twin);
              if (buf) {} await putSong(twin); updated++;
            } else { twin.cloud.ver = r.version; twin.cloud.base = '-'; twin.cloud.incoming = { ver: r.version, rem: r, hasBuf: !!buf }; if (buf) await DB.put('blobs', { id: 'in-' + id, data: buf }); await putSong(twin); }
            continue;
          }
          l = X.newSong({ id: uid(), fmt: d.fmt || 'text' });
          if (buf) { l.pdfId = uid(); }
          applySong(l, r, buf);
          if (buf) await DB.put('blobs', { id: l.pdfId, data: buf });
          S.songs.push(l); await putSong(l); added++; continue;
        }
        if (l.deleted && !r.deleted) { l.cloud.ver = r.version; await putSong(l); continue; } // I trashed it myself: leave it
        if (edited(l)) {
          l.cloud.incoming = { ver: r.version, rem: r, hasBuf: !!buf };
          if (buf) await DB.put('blobs', { id: 'in-' + id, data: buf });
          await putSong(l); continue;
        }
        applySong(l, r, buf);
        if (buf) await DB.put('blobs', { id: l.pdfId, data: buf });
        await putSong(l); updated++;
      }
      // songs that were deleted/hidden/removed on the server
      for (const l of S.songs.slice()) {
        if (!l.cloud || l.deleted) continue;
        const r = remote.get(l.cloud.id);
        if (r && !r.deleted) continue;
        if (edited(l)) { l.cloud = null; await putSong(l); continue; } // keep my edited copy as my own song
        l.deleted = now(); l.cloud = null; await putSong(l); removed++;
      }
      // shared sets
      let sdata = [];
      const sneed = rsets.filter((r) => { if (r.deleted) return false; const l = S.sets.find((s) => s.cloud && s.cloud.id === r.id); return !l || l.cloud.ver !== r.version; }).map((r) => r.id);
      for (let i = 0; i < sneed.length; i += 30) sdata = sdata.concat(await api('/rest/v1/cloud_sets?id=in.(' + sneed.slice(i, i + 30).join(',') + ')&select=id,team_id,data,version,deleted'));
      for (const r of sdata) {
        let l = S.sets.find((s) => s.cloud && s.cloud.id === r.id);
        if (l && setEdited(l)) { l.cloud.incoming = { ver: r.version, rem: r }; await DB.put('sets', l); continue; }
        if (!l) l = { id: uid(), name: '', items: [], modified: now() };
        applySet(l, r); await DB.put('sets', l); if (!S.sets.includes(l)) S.sets.push(l);
      }
      const rsetIds = new Set(rsets.filter((r) => !r.deleted).map((r) => r.id));
      for (const l of S.sets.slice()) {
        if (!l.cloud || rsetIds.has(l.cloud.id)) continue;
        if (setEdited(l)) l.cloud = null; else { await DB.del('sets', l.id); S.sets = S.sets.filter((x) => x !== l); continue; }
        await DB.put('sets', l);
      }
      // sets can only be mapped once all songs exist: re-apply sets whose items were skipped
      C.last = now(); LS.set('sb_cloud_last', C.last);
      C.msg = '';
      if (manual || added || updated || removed) toast(added + updated + removed ? `Shared library updated: ${added} new, ${updated} changed, ${removed} removed` : 'Everything is up to date');
      const rn = route().name; if (['songs', 'sets', 'settings', 'trash'].includes(rn)) X.render();
    } catch (e) {
      if (manual || !e.offline) toast(e.offline ? 'You are offline.' : 'Could not sync: ' + e.message, 4000);
    }
    C.busy = false; paintStatus();
  }
  function applySet(l, r) {
    const d = r.data || {};
    l.name = d.name || 'Shared set';
    l.items = (d.items || []).map((i) => { const sg = S.songs.find((s) => s.cloud && s.cloud.id === i.cid); return sg ? { songId: sg.id, shift: 0, capo: 0 } : null; }).filter(Boolean);
    l.cloud = { id: r.id, team: r.team_id, ver: r.version, base: '' }; l.cloud.base = setSig(l);
    l.modified = now();
  }

  /* ---------- lead: publish / hide / delete ---------- */
  async function publishSong(s, teamArg) {
    const team = (s.cloud && s.cloud.team) || teamArg || (leadTeams()[0] || {}).id;
    if (!isLead(team)) throw fail('Only leads can change the shared library.');
    let path = s.cloud && s.cloud.pdf || null;
    if (s.fmt === 'pdf') {
      const b = await DB.get('blobs', s.pdfId); if (!b) throw fail('PDF file is missing on this phone.');
      const p = team + '/' + (await sha(b.data)) + '.pdf';
      if (p !== path) {
        const r = await raw('/storage/v1/object/pdfs/' + p, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: b.data });
        if (!r.ok) throw await errOf(r);
        path = p;
      }
    }
    await fresh();
    if (s.cloud) {
      const rows = await api('/rest/v1/cloud_songs?id=eq.' + s.cloud.id + '&version=eq.' + s.cloud.ver, { method: 'PATCH', headers: { Prefer: 'return=representation' }, json: { data: payload(s), pdf_path: path } });
      if (!rows || !rows.length) throw fail('Someone else changed this song first. Sync, then try again.', { conflict: true });
      s.cloud.ver = rows[0].version; s.cloud.at = rows[0].updated_at;
    } else {
      const rows = await api('/rest/v1/cloud_songs', { method: 'POST', headers: { Prefer: 'return=representation' }, json: { team_id: team, data: payload(s), pdf_path: path } });
      s.cloud = { id: rows[0].id, team, ver: rows[0].version, hidden: false, at: rows[0].updated_at };
    }
    s.cloud.by = (C.profile && C.profile.name) || '';
    s.cloud.pdf = path; s.cloud.base = sigOf(s); delete s.cloud.incoming;
    await putSong(s);
  }
  async function patchSong(s, body) {
    const rows = await api('/rest/v1/cloud_songs?id=eq.' + s.cloud.id + '&version=eq.' + s.cloud.ver, { method: 'PATCH', headers: { Prefer: 'return=representation' }, json: body });
    if (!rows || !rows.length) throw fail('Someone else changed this song first. Sync, then try again.', { conflict: true });
    s.cloud.ver = rows[0].version; return rows[0];
  }
  async function publishSet(set, teamArg) {
    const team = (set.cloud && set.cloud.team) || teamArg || (leadTeams()[0] || {}).id;
    const items = []; let skipped = 0;
    for (const i of set.items) { const sg = songById(i.songId); if (sg && sg.cloud) items.push({ cid: sg.cloud.id }); else skipped++; }
    const d = { name: set.name, items };
    if (set.cloud) {
      const rows = await api('/rest/v1/cloud_sets?id=eq.' + set.cloud.id + '&version=eq.' + set.cloud.ver, { method: 'PATCH', headers: { Prefer: 'return=representation' }, json: { data: d } });
      if (!rows || !rows.length) throw fail('Someone else changed this set first. Sync, then try again.', { conflict: true });
      set.cloud.ver = rows[0].version;
    } else {
      const rows = await api('/rest/v1/cloud_sets', { method: 'POST', headers: { Prefer: 'return=representation' }, json: { team_id: team, data: d } });
      set.cloud = { id: rows[0].id, team, ver: rows[0].version };
    }
    set.cloud.base = setSig(set); delete set.cloud.incoming; await DB.put('sets', set);
    return skipped;
  }
  async function guard(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.conflict ? e.message : 'Could not do that: ' + e.message, 5000); if (e.conflict) sync(true); }
    const rn = route().name; if (rn === 'song') { X.paintSong(); } else X.render();
  }

  /* ---------- UI: song & list hooks ---------- */
  const H = X.hooks;
  const A = X.A;
  const row = (act, t, a, cls) => `<button class="row ${cls || ''}" data-act="${act}"><span class="rt"><span class="t">${t}</span>${a ? `<span class="a">${a}</span>` : ''}</span></button>`;
  H.rowTag = (s) => {
    if (!s.cloud) return '';
    if (s.cloud.incoming) return '<i class="bd warn">Update</i>';
    if (edited(s)) return '<i class="bd mine">Mine</i>';
    if (s.cloud.hidden) return '<i class="bd">Hidden</i>';
    return '<i class="bd cloud" title="Shared">\u2601</i>';
  };
  const teamName = (id) => ((C.profile && C.profile.teams || []).find((x) => x.id === id) || {}).name || 'the team';
  const dstr = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  /* ----- team name bar and switcher ----- */
  const TK = 'sb_team';
  const myTeams = () => (active() ? (C.profile.teams || []) : []);
  const roleWord = (r) => (r === 'lead' ? 'Lead' : 'Member');
  function curTeam() { const t = myTeams(); if (t.length < 2) return null; let v = LS.get(TK); if (v === 'mine') return 'mine'; if (!t.some((x) => x.id === v)) v = t[0].id; return v; }
  H.teamFilter = (item) => { const v = curTeam(); if (!v) return true; if (v === 'mine') return !item.cloud; return !!(item.cloud && item.cloud.team === v); };
  H.teamBar = () => {
    const t = myTeams(); if (!t.length) return '';
    if (t.length === 1) return `<div class="teamline"><b>${esc(t[0].name)}</b><i>${roleWord(t[0].role)}</i></div>`;
    const v = curTeam(); const tm = t.find((x) => x.id === v);
    return `<button class="teampill" data-act="cl-team"><b>${tm ? esc(tm.name) : 'My songs'}</b><i>${tm ? roleWord(tm.role) : 'not shared'}</i>${ico('chev')}</button>`;
  };
  A['cl-team'] = () => {
    const v = curTeam(); const t = myTeams();
    const cnt = (id) => [S.songs.filter((s) => !s.deleted && s.cloud && s.cloud.team === id).length, S.sets.filter((s) => s.cloud && s.cloud.team === id).length];
    const row = (id, name, sub, on) => `<button class="row ${on ? 'cur' : ''}" data-act="cl-team-pick" data-v="${id}"><span class="rt"><span class="t">${esc(name)}</span><span class="a">${sub}</span></span>${on ? ico('check') : ''}</button>`;
    sheet(`<div class="sh-h">Choose a team</div><p class="small muted">Each team has its own songs and sets. Other teams never see them.</p>` +
      t.map((x) => { const [a, b] = cnt(x.id); return row(x.id, x.name, `${roleWord(x.role)} \u00b7 ${a} songs \u00b7 ${b} sets`, v === x.id); }).join('') +
      row('mine', 'My songs (not shared)', S.songs.filter((s) => !s.deleted && !s.cloud).length + ' songs only you have', v === 'mine'));
  };
  A['cl-team-pick'] = (el) => { LS.set(TK, el.dataset.v); closeSheet(); X.render(); };
  let shareRes = null;
  function pickShareTeam() {
    const lt = leadTeams(); if (lt.length <= 1) return Promise.resolve((lt[0] || {}).id);
    const v = curTeam(); if (v && lt.some((x) => x.id === v)) return Promise.resolve(v);
    return new Promise((res) => { shareRes = res;
      sheet(`<div class="sh-h">Share into which team?</div>` + lt.map((x) => `<button class="row" data-act="cl-share-team" data-v="${x.id}"><span class="rt"><span class="t">${esc(x.name)}</span></span></button>`).join('') + `<div class="btnrow"><button class="btn" data-act="cl-share-cancel">Cancel</button></div>`); });
  }
  A['cl-share-team'] = (el) => { closeSheet(); if (shareRes) { shareRes(el.dataset.v); shareRes = null; } };
  A['cl-share-cancel'] = () => { closeSheet(); if (shareRes) { shareRes(null); shareRes = null; } };
  H.songInfo = (s) => {
    if (!C.session) return '';
    let a, b = '', cls = '';
    if (!s.cloud) { a = 'Not shared \u00b7 only you have this song'; b = isLead() && active() ? 'Use "Add to shared library" below to share it with the team.' : 'It stays on this phone and is not shared with the team.'; }
    else {
      const c = s.cloud; const ed = edited(s);
      a = '\u2601 Shared with ' + esc(teamName(c.team)) + ' \u00b7 Version ' + c.ver + (c.at ? ' \u00b7 updated ' + dstr(c.at) : '') + (c.by ? ' by ' + esc(c.by) : '');
      b = ed ? 'You have your own changes on this phone. ' + (isLead(c.team) ? 'Publish them to update everyone.' : 'Others do not see them.') : (isLead(c.team) ? 'You are a lead: changes you publish go to everyone.' : 'Your own edits stay on this phone only.');
      if (c.incoming) b = 'The team published a newer version. Tap "Review shared update".';
      if (c.hidden) b += ' Hidden from members.';
    }
    return `<div class="cl-info"><b>${a}</b><span>${b}</span></div>`;
  };
  H.whereBar = () => {
    if (!C.session || myTeams().length > 1) return '';
    const w = S.ui.where || 'all';
    const sh = S.songs.filter((s) => !s.deleted && s.cloud).length, lo = S.songs.filter((s) => !s.deleted && !s.cloud).length;
    return `<div class="wherebar"><div class="seg">${[['all', 'All'], ['shared', '\u2601 Shared ' + sh], ['local', 'Not shared ' + lo]].map(([v, l]) => `<button class="${w === v ? 'on' : ''}" data-act="cl-where" data-v="${v}">${l}</button>`).join('')}</div></div>`;
  };
  H.songMenu = (s) => {
    if (!active()) return '';
    let h = '';
    if (s.cloud && s.cloud.incoming) h += row('cl-review-song', 'Review shared update', 'The shared version changed while you had your own edits');
    if (s.cloud && edited(s)) h += row('cl-reset-song', 'Reset to the shared version', 'Throw away my edits on this phone');
    if (isLead(s.cloud && s.cloud.team)) {
      if (!s.cloud) h += row('cl-pub-song', 'Add to shared library', 'Everyone on the team will get this song');
      else {
        if (edited(s)) h += row('cl-pub-song', 'Publish my changes to everyone');
        h += row('cl-hide-song', s.cloud.hidden ? 'Show to everyone again' : 'Hide from everyone', 'Hidden songs disappear from members’ phones');
        h += row('cl-del-song', 'Delete for everyone', '', 'danger');
      }
    }
    return h;
  };
  /* ----- bulk actions on selected songs (leads) ----- */
  const selSongs = () => [...(S.ui.select || [])].map((id) => songById(id)).filter((s) => s && !s.deleted);
  H.selMenu = (ids) => {
    if (!active() || !isLead()) return '';
    const ss = ids.map((id) => songById(id)).filter(Boolean);
    const newOnes = ss.filter((s) => !s.cloud || (edited(s) && !s.cloud.incoming)).length;
    const linked = ss.filter((s) => s.cloud && isLead(s.cloud.team));
    const hidden = linked.filter((s) => s.cloud.hidden).length;
    let h = '';
    if (newOnes) h += row('cl-sel-share', 'Add to shared library (' + newOnes + ')', 'New and changed songs go to the team');
    if (linked.length - hidden) h += row('cl-sel-hide', 'Hide from everyone (' + (linked.length - hidden) + ')', 'You can show them again later');
    if (hidden) h += row('cl-sel-show', 'Show to everyone again (' + hidden + ')');
    if (linked.length) h += row('cl-sel-del', 'Delete for everyone (' + linked.length + ')', 'Removed from every member\u2019s phone', 'danger');
    return h;
  };
  async function bulk(list, fn, label) {
    if (pubBusy) { toast('Please wait, another job is running'); return; }
    pubBusy = true; let ok = 0, bad = 0;
    for (let i = 0; i < list.length; i++) { toast(label + ' ' + (i + 1) + ' of ' + list.length + '\u2026', 1500); try { await fn(list[i]); ok++; } catch (e) { bad++; if (e.offline) break; } }
    pubBusy = false; S.ui.select = null; toast(`${label} done: ${ok}${bad ? ', ' + bad + ' failed' : ''}`, 5000); X.render();
  }
  A['cl-sel-share'] = async () => {
    closeSheet(); const list = selSongs().filter((s) => !s.cloud || (edited(s) && !s.cloud.incoming)); const tm = await pickShareTeam(); if (!tm) return;
    confirmBox('Share ' + list.length + ' song' + (list.length === 1 ? '' : 's') + '?', 'They will be added to ' + teamName(tm) + ' for everyone.', 'Share', () => bulk(list, (s) => publishSong(s, tm), 'Sharing'));
  };
  A['cl-sel-hide'] = () => { closeSheet(); const list = selSongs().filter((s) => s.cloud && isLead(s.cloud.team) && !s.cloud.hidden);
    confirmBox('Hide ' + list.length + ' song' + (list.length === 1 ? '' : 's') + ' from everyone?', 'Members will no longer see them. You can show them again any time.', 'Hide', () => bulk(list, async (s) => { await patchSong(s, { hidden: true }); s.cloud.hidden = true; await putSong(s); }, 'Hiding')); };
  A['cl-sel-show'] = () => { closeSheet(); const list = selSongs().filter((s) => s.cloud && isLead(s.cloud.team) && s.cloud.hidden);
    confirmBox('Show ' + list.length + ' song' + (list.length === 1 ? '' : 's') + ' to everyone again?', 'Members will get them on their next sync.', 'Show', () => bulk(list, async (s) => { await patchSong(s, { hidden: false }); s.cloud.hidden = false; await putSong(s); }, 'Showing')); };
  A['cl-sel-del'] = () => { closeSheet(); const list = selSongs().filter((s) => s.cloud && isLead(s.cloud.team));
    confirmBox('Delete ' + list.length + ' song' + (list.length === 1 ? '' : 's') + ' for everyone?', 'They will be removed from every member\u2019s phone. Earlier versions are kept on the server. This cannot be undone from the app.', 'Delete for everyone', async () => { await X.takeSnapshot('before bulk delete for everyone', true); bulk(list, async (s) => { await patchSong(s, { deleted: true }); s.deleted = now(); await putSong(s); }, 'Deleting'); }, true); };
  H.setMenu = (set) => {
    if (!active() || !set) return '';
    let h = '';
    if (set.cloud && set.cloud.incoming) h += `<button class="row" data-act="cl-use-set" data-id="${esc(set.id)}"><span class="rt"><span class="t">Use the shared version of this set</span></span></button>`;
    if (isLead(set.cloud && set.cloud.team)) {
      h += `<button class="row" data-act="cl-pub-set" data-id="${esc(set.id)}"><span class="rt"><span class="t">${set.cloud ? 'Publish my changes to this set' : 'Share this set with everyone'}</span><span class="a">Only songs from the shared library are included</span></span></button>`;
      if (set.cloud) h += `<button class="row danger" data-act="cl-del-set" data-id="${esc(set.id)}"><span class="rt"><span class="t">Delete for everyone</span></span></button>`;
    }
    return h;
  };
  const prevPaint = H.paintSong;
  H.paintSong = (song, holder) => {
    if (prevPaint) prevPaint(song, holder);
    if (!active() || !song.cloud || !song.cloud.incoming) return;
    const n = $('#notecard'); if (!n) return;
    n.insertAdjacentHTML('beforeend', '<div class="notecard cl-banner"><b>Shared version updated</b><p>You have your own edits on this song. <button class="btn sm" data-act="cl-review-song">Review</button></p></div>');
  };

  A['cl-where'] = (el) => { S.ui.where = el.dataset.v; X.render(); };
  const cur = () => X.curSong();
  A['cl-pub-song'] = async () => { closeSheet(); const s = cur(); const nw = !s.cloud;
    const tm = nw ? await pickShareTeam() : null; if (nw && !tm) return;
    confirmBox(nw ? 'Add to the shared library?' : 'Publish your changes?', nw ? '"' + s.title + '" will be added for everyone in ' + teamName(tm) + '.' : 'Everyone will get your version of "' + s.title + '" the next time they sync. The old version is kept in history.', nw ? 'Add for everyone' : 'Publish', () => guard(() => publishSong(s, tm), nw ? 'Added to the shared library' : 'Published to everyone')); };
  A['cl-hide-song'] = () => { const s = cur(); closeSheet(); const hide = !s.cloud.hidden;
    confirmBox(hide ? 'Hide this song from everyone?' : 'Show this song to everyone again?', hide ? 'Members will no longer see "' + s.title + '". You can show it again any time.' : 'Members will get this song back.', hide ? 'Hide' : 'Show', () => guard(async () => { await patchSong(s, { hidden: hide }); s.cloud.hidden = hide; await putSong(s); }, hide ? 'Hidden' : 'Visible again')); };
  A['cl-del-song'] = () => { const s = cur(); closeSheet();
    confirmBox('Delete for everyone?', '"' + s.title + '" will be removed from every member’s phone. Earlier versions are kept on the server.', 'Delete for everyone', () => guard(async () => { await patchSong(s, { deleted: true }); s.deleted = now(); await putSong(s); X.go('#/songs'); }, 'Deleted for everyone'), true); };
  A['cl-reset-song'] = () => { const s = cur(); closeSheet();
    confirmBox('Reset to the shared version?', 'Your own changes to "' + s.title + '" on this phone will be replaced.', 'Reset', () => guard(() => useShared(s), 'Back to the shared version'), true); };
  A['cl-review-song'] = () => {
    const s = cur(); closeSheet(); if (!s || !s.cloud || !s.cloud.incoming) return;
    sheet(`<div class="sh-h">Shared update</div><p class="small muted">The team changed "${esc(s.title)}", and you also edited it on this phone. Which one do you want?</p>
      <div class="btnrow"><button class="btn" data-act="cl-keep-mine">Keep mine</button><button class="btn primary" data-act="cl-use-shared">Use shared</button></div>`);
  };
  A['cl-keep-mine'] = () => { const s = cur(); closeSheet(); guard(async () => { const i = s.cloud.incoming; s.cloud.ver = i.ver; s.cloud.pdf = (i.rem && i.rem.pdf_path) || s.cloud.pdf; s.cloud.base = '-'; delete s.cloud.incoming; await DB.del('blobs', 'in-' + s.cloud.id); await putSong(s); }, 'Keeping your version'); };
  A['cl-use-shared'] = () => { const s = cur(); closeSheet(); guard(() => useShared(s), 'Using the shared version'); };
  async function useShared(s) {
    let r = s.cloud.incoming && s.cloud.incoming.rem;
    if (!r) { const rows = await api('/rest/v1/cloud_songs?id=eq.' + s.cloud.id + '&select=id,team_id,data,pdf_path,version,hidden,deleted,updated_at'); r = rows[0]; if (!r) throw fail('The shared song is gone.'); }
    let buf = null;
    if ((r.data || {}).fmt === 'pdf' && r.pdf_path) { const inc = await DB.get('blobs', 'in-' + s.cloud.id); buf = inc ? inc.data : await download(r.pdf_path); }
    await X.takeSnapshot('before reset to shared', true);
    applySong(s, r, buf);
    if (buf) { s.pdfId = s.pdfId || uid(); await DB.put('blobs', { id: s.pdfId, data: buf }); }
    await DB.del('blobs', 'in-' + s.cloud.id).catch(() => {});
    await putSong(s);
  }
  A['cl-pub-set'] = (el) => { const set = setById(el.dataset.id); closeSheet(); guard(async () => { const k = await publishSet(set); if (k) toast(k + ' song' + (k > 1 ? 's' : '') + ' not in the shared library were left out', 5000); }, 'Set shared'); };
  A['cl-del-set'] = (el) => { const set = setById(el.dataset.id); closeSheet(); confirmBox('Delete this set for everyone?', 'It disappears from every member’s phone.', 'Delete for everyone', () => guard(async () => { await api('/rest/v1/cloud_sets?id=eq.' + set.cloud.id, { method: 'PATCH', json: { deleted: true } }); set.cloud = null; await DB.put('sets', set); }, 'Deleted for everyone'), true); };
  A['cl-use-set'] = (el) => { const set = setById(el.dataset.id); closeSheet(); guard(async () => { await X.takeSnapshot('before set reset', true); applySet(set, set.cloud.incoming.rem); await DB.put('sets', set); }, 'Using the shared set'); };

  /* ---------- Account card ---------- */
  const when = (t) => (t ? X.fmtTime(t) : 'never');
  function conflicts() { return S.songs.filter((s) => s.cloud && s.cloud.incoming && !s.deleted).length; }
  H.settingsCloud = () => {
    if (!C.session) return `<section class="card"><h3>Shared songbook</h3><p class="small muted">Sign in to get the team’s songs and sets. Your own changes always stay on this phone.</p>${C.msg ? `<p class="small" style="color:var(--warn)">${esc(C.msg)}</p>` : ''}<button class="btn primary" data-act="cl-open-gate">Sign in or create account</button></section>`;
    const p = C.profile || {}; const roles = [];
    if (p.is_master) roles.push('Master admin'); else if (p.is_admin) roles.push('Admin');
    leadTeams().forEach((t) => roles.push('Lead · ' + t.name));
    (p.teams || []).filter((t) => t.role !== 'lead').forEach((t) => roles.push('Member · ' + t.name));
    const n = conflicts();
    const wait = isAdmin() && C.pending ? `<a class="banner" href="#/admin"><div><b>${C.pending} ${C.pending === 1 ? 'person is' : 'people are'} waiting for approval</b><span>Tap to review</span></div>${ico('chev')}</a>` : '';
    return `${wait}<section class="card" id="cloudcard"><h3>Shared songbook</h3>
      <div class="kv"><label>${esc(p.name || 'You')}</label><span class="small muted">${esc(p.email || '')}</span></div>
      <p class="small">${active() ? esc(roles.join(' · ') || 'Member') : p.status === 'pending' ? 'Waiting for an admin to approve your account.' : 'This account is switched off.'}</p>
      <p class="small muted">${S.songs.filter((s) => !s.deleted && s.cloud).length} shared songs \u00b7 ${S.songs.filter((s) => !s.deleted && !s.cloud).length} not shared (only you have them)</p>
      <p class="small muted" id="cloudstat">${C.busy ? 'Syncing…' : 'Last sync: ' + when(C.last)}</p>
      ${n ? `<p class="small" style="color:var(--warn)">${n} shared song${n > 1 ? 's have' : ' has'} an update that clashes with your edits. Open the song and choose.</p>` : ''}
      <div class="btnrow tight"><button class="btn primary" data-act="cl-sync">Sync now</button><button class="btn" data-act="cl-pw">Change password</button><button class="btn" data-act="cl-out">Sign out</button></div>
      ${isLead() ? `<div class="btnrow tight"><button class="btn" data-act="cl-choose">Choose songs or sets to share…</button><button class="btn" data-act="cl-pub-all">Add all my new songs</button></div>` : ''}
      ${isAdmin() ? `<div class="btnrow tight"><a class="btn" href="#/admin">Manage people</a></div>` : ''}
    </section>`;
  };
  function paintStatus() { const e = $('#cloudstat'); if (e) e.textContent = C.busy ? 'Syncing…' : 'Last sync: ' + when(C.last); }
  A['cl-sync'] = () => sync(true);
  A['cl-out'] = () => confirmBox('Sign out?', 'The songs stay on this phone. You will stop getting shared updates until you sign in again.', 'Sign out', () => { dropSession(); X.render(); toast('Signed out'); });
  A['cl-pw'] = () => sheet(`<div class="sh-h">Change password</div><div class="field"><label>New password (8 or more characters)</label><input id="npw" type="password" autocomplete="new-password"></div><div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="cl-pw-go">Save</button></div>`);
  A['cl-pw-go'] = async () => { const v = $('#npw').value; if (v.length < 8) { toast('Use at least 8 characters'); return; } try { await api('/auth/v1/user', { method: 'PUT', json: { password: v } }); closeSheet(); toast('Password changed'); } catch (e) { toast(e.message, 4000); } };
  let pubBusy = false;
  A['cl-pub-all'] = async () => {
    if (pubBusy) { toast('Already sharing…'); return; }
    pubBusy = true; toast('Checking the shared library first…', 2000);
    try { await sync(false); } catch (e) {}
    pubBusy = false;
    const list = live().filter((s) => !s.cloud);
    const ed = live().filter((s) => edited(s) && !s.cloud.incoming);
    if (!list.length && !ed.length) { toast('Nothing new to share'); return; }
    const tm = await pickShareTeam(); if (!tm) return;
    confirmBox('Share with ' + teamName(tm) + '?', `${list.length} new song${list.length === 1 ? '' : 's'}${ed.length ? ' and ' + ed.length + ' changed' : ''} will be added to the shared library for everyone. This takes a few minutes for many PDFs.`, 'Share', async () => {
      if (pubBusy) return; pubBusy = true;
      let ok = 0, bad = 0; const all = list.concat(ed);
      for (let i = 0; i < all.length; i++) { toast('Sharing ' + (i + 1) + ' of ' + all.length + '…', 1500); try { await publishSong(all[i], tm); ok++; } catch (e) { bad++; if (e.offline) break; } }
      pubBusy = false; toast(`Shared ${ok}${bad ? ', ' + bad + ' failed' : ''}`, 5000); X.render();
    });
  };

  /* ---------- choose what to share (sets / all songs) ---------- */
  let ch = null;
  const todo = (s) => !s.deleted && (!s.cloud || (edited(s) && !s.cloud.incoming));
  function chSongs() {
    if (ch.all) return live().filter(todo);
    const ids = new Set(); ch.sets.forEach((id) => { const st = setById(id); if (st) st.items.forEach((i) => ids.add(i.songId)); });
    return live().filter((s) => ids.has(s.id) && todo(s));
  }
  function paintChooser() {
    const sets = S.sets.slice().sort((a, b) => String(a.name).localeCompare(b.name));
    const n = chSongs().length;
    const cb = (on) => `<span class="cb ${on ? 'on' : ''}">${on ? ico('check') : ''}</span>`;
    sheet(`<div class="sh-h">Choose what to share</div>
      <p class="small muted">Pick songs to add to the shared library. Songs already shared are not sent again.</p>
      <button class="row" data-act="cl-ch-all">${cb(ch.all)}<span class="rt"><span class="t">Every song not shared yet</span><span class="a">${live().filter(todo).length} songs</span></span></button>
      <div class="small muted pad0" style="margin:8px 0 2px">Or by set</div>
      <div class="chlist">${sets.length ? sets.map((st) => { const left = st.items.filter((i) => { const sg = songById(i.songId); return sg && todo(sg); }).length;
        return `<button class="row" data-act="cl-ch-set" data-id="${esc(st.id)}">${cb(ch.all || ch.sets.has(st.id))}<span class="rt"><span class="t">${esc(st.name)}</span><span class="a">${st.items.length} songs · ${left} to share${st.cloud ? ' · set already shared' : ''}</span></span></button>`; }).join('') : '<p class="small muted">You have no sets yet.</p>'}</div>
      <div class="kv"><label>Also share the selected sets</label><button class="sw ${ch.withSets ? 'on' : ''}" data-act="cl-ch-with" aria-label="toggle"></button></div>
      <div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="cl-ch-go" ${n || (ch.withSets && ch.sets.size) ? '' : 'disabled'}>Share ${n} song${n === 1 ? '' : 's'}</button></div>`);
  }
  A['cl-choose'] = async () => { toast('Checking the shared library first…', 1500); try { await sync(false); } catch (e) {} const tm0 = await pickShareTeam(); if (!tm0) return; ch = { team: tm0, all: false, sets: new Set(), withSets: true }; paintChooser(); };
  A['cl-ch-all'] = () => { ch.all = !ch.all; paintChooser(); };
  A['cl-ch-set'] = (el) => { const id = el.dataset.id; if (ch.all) { ch.all = false; S.sets.forEach((s) => ch.sets.add(s.id)); } if (ch.sets.has(id)) ch.sets.delete(id); else ch.sets.add(id); paintChooser(); };
  A['cl-ch-with'] = () => { ch.withSets = !ch.withSets; paintChooser(); };
  A['cl-ch-go'] = () => {
    const songs = chSongs(); const sets = ch.withSets ? (ch.all ? S.sets.slice() : S.sets.filter((s) => ch.sets.has(s.id))) : [];
    confirmBox('Share with ' + teamName(ch.team) + '?', `${songs.length} song${songs.length === 1 ? '' : 's'}${sets.length ? ' and ' + sets.length + ' set' + (sets.length === 1 ? '' : 's') : ''} will be added to the shared library for everyone.`, 'Share', async () => {
      if (pubBusy) return; pubBusy = true; let ok = 0, bad = 0, sok = 0;
      for (let i = 0; i < songs.length; i++) { toast('Sharing song ' + (i + 1) + ' of ' + songs.length + '…', 1500); try { await publishSong(songs[i], ch.team); ok++; } catch (e) { bad++; if (e.offline) break; } }
      for (const st of sets) { try { await publishSet(st, ch.team); sok++; } catch (e) { bad++; } }
      pubBusy = false; toast(`Shared ${ok} song${ok === 1 ? '' : 's'}${sets.length ? ' and ' + sok + ' set' + (sok === 1 ? '' : 's') : ''}${bad ? ', ' + bad + ' failed' : ''}`, 5000); X.render();
    });
  };

  /* ---------- sign-in gate ---------- */
  function closeGate() { const g = $('#cloudgate'); if (g) g.remove(); C.gate = null; }
  function gateRefresh() { if ($('#cloudgate')) openGate(C.gate || 'in'); }
  function openGate(mode) {
    C.gate = mode; let g = $('#cloudgate'); if (!g) { g = document.createElement('div'); g.id = 'cloudgate'; g.className = 'gate'; document.body.appendChild(g); }
    const p = C.profile;
    let inner;
    if (C.session && p && p.status !== 'active') {
      inner = `<h2>${p.status === 'pending' ? 'Waiting for approval' : 'Account switched off'}</h2><p class="muted">${p.status === 'pending' ? 'Your account is created. An admin needs to approve it before you can see the shared songs. Check again later.' : 'Please contact an admin.'}</p>
        <div class="btnrow"><button class="btn primary" data-act="cl-gate-check">Check again</button></div>
        <button class="btn" data-act="cl-skip">Use the app on this phone for now</button><button class="linkbtn" data-act="cl-out2">Sign out</button>`;
    } else {
      const up = mode === 'up';
      inner = `<h2>${up ? 'Create your account' : 'Welcome back'}</h2><p class="muted">${up ? 'Join your team to get the shared songs.' : 'Sign in to get the team’s shared songs. Your own changes always stay on this phone.'}</p>
        <div class="seg"><button class="${up ? '' : 'on'}" data-act="cl-gate-mode" data-m="in">Sign in</button><button class="${up ? 'on' : ''}" data-act="cl-gate-mode" data-m="up">Create account</button></div>
        ${up ? '<div class="field"><label>Your name</label><input id="gname" autocomplete="name"></div>' : ''}
        <div class="field"><label>Email</label><input id="gmail" type="email" autocomplete="email" autocapitalize="off"></div>
        <div class="field"><label>Password${up ? ' (8 or more characters)' : ''}</label><input id="gpw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}"></div>
        <p class="small" id="gerr" style="color:var(--danger);min-height:1.2em">${esc(C.msg || '')}</p>
        <button class="btn primary wide" data-act="cl-gate-go">${up ? 'Create account' : 'Sign in'}</button>
        ${up ? '<p class="small muted">New accounts are approved by an admin before the shared songs appear.</p>' : ''}
        <button class="linkbtn" data-act="cl-skip">Continue without an account</button>`;
    }
    g.innerHTML = `<div class="gateglow"></div><div class="gatecard"><div class="gatelogo"><img src="icons/icon-192.png" alt=""><h1>Songbook</h1><p>Your worship library, always with you</p></div><div class="gatepanel">${inner}</div></div>`;
  }
  A['cl-open-gate'] = () => openGate('in');
  A['cl-gate-mode'] = (el) => { C.msg = ''; openGate(el.dataset.m); };
  A['cl-skip'] = () => { LS.set('sb_cloud_skip', 1); closeGate(); };
  A['cl-out2'] = () => { dropSession(); openGate('in'); };
  A['cl-gate-check'] = async () => { await sync(true); if ($('#cloudgate') && C.profile && C.profile.status !== 'active') toast(C.profile.status === 'pending' ? 'Not approved yet' : 'Account is off'); };
  A['cl-gate-go'] = async () => {
    const up = C.gate === 'up'; const e = $('#gerr'); const btn = $('#cloudgate .btn.primary');
    const email = $('#gmail').value, pw = $('#gpw').value, name = up ? $('#gname').value : '';
    if (!email || !pw || (up && !name.trim())) { e.textContent = 'Please fill in everything.'; return; }
    if (up && pw.length < 8) { e.textContent = 'Password needs at least 8 characters.'; return; }
    btn.disabled = true; e.textContent = '';
    try {
      if (up) await signUp(name, email, pw); else await signIn(email, pw);
      C.msg = '';
      if (active()) { closeGate(); toast('Signed in'); sync(true); } else openGate('in');
      const rn = route().name; if (rn === 'settings') X.render();
    } catch (er) { e.textContent = er.message; btn.disabled = false; }
  };

  /* ---------- admin screen ---------- */
  let adm = null;
  H.viewAdmin = () => {
    if (!isAdmin()) return '<header class="top"><a class="ibtn" href="#/settings">' + ico('back') + '</a><h1 class="mid">People</h1></header><p class="muted pad">Admins only.</p>';
    setTimeout(loadAdmin, 0);
    return `<header class="top"><a class="ibtn" href="#/settings" aria-label="Back">${ico('back')}</a><h1 class="mid">People</h1></header><div id="admbox"><p class="muted pad">Loading…</p></div>`;
  };
  async function loadAdmin() {
    try {
      const [ps, ms, ts] = await Promise.all([api('/rest/v1/profiles?select=*&order=created_at'), api('/rest/v1/memberships?select=user_id,team_id,role'), api('/rest/v1/teams?select=id,name&order=created_at')]);
      adm = { ps, ms, ts }; C.pending = ps.filter((x) => x.status === 'pending').length; paintAdmin();
    } catch (e) { const b = $('#admbox'); if (b) b.innerHTML = `<p class="muted pad">Could not load: ${esc(e.message)}</p>`; }
  }
  function paintAdmin() {
    const b = $('#admbox'); if (!b || !adm) return;
    const order = { pending: 0, active: 1, inactive: 2 };
    const ps = adm.ps.slice().sort((a, c) => (order[a.status] - order[c.status]) || String(a.name).localeCompare(c.name));
    b.innerHTML = ps.map((p) => {
      const mine = p.id === C.session.user.id;
      const roleSel = adm.ts.map((t) => { const m = adm.ms.find((x) => x.user_id === p.id && x.team_id === t.id); const v = m ? m.role : 'none';
        return `<div class="kv"><label>${esc(t.name)}</label><select data-adm-role data-u="${p.id}" data-t="${t.id}" ${p.is_master ? 'disabled' : ''}><option value="none" ${v === 'none' ? 'selected' : ''}>No access</option><option value="user" ${v === 'user' ? 'selected' : ''}>Member</option><option value="lead" ${v === 'lead' ? 'selected' : ''}>Lead</option></select></div>`; }).join('');
      const st = p.status === 'active' ? '<i class="bd key">Active</i>' : p.status === 'pending' ? '<i class="bd warn">Pending</i>' : '<i class="bd">Off</i>';
      return `<section class="card"><div class="kv"><label><b>${esc(p.name || '(no name)')}</b>${p.is_master ? ' · master' : p.is_admin ? ' · admin' : ''}</label>${st}</div><p class="small muted">${esc(p.email)}</p>
        ${p.is_master ? '' : `<div class="btnrow tight">
          ${p.status !== 'active' ? `<button class="btn sm primary" data-act="adm-status" data-u="${p.id}" data-v="active">${p.status === 'pending' ? 'Approve' : 'Switch on'}</button>` : `<button class="btn sm" data-act="adm-status" data-u="${p.id}" data-v="inactive">Switch off</button>`}
          ${mine ? '' : `<button class="btn sm" data-act="adm-admin" data-u="${p.id}" data-v="${p.is_admin ? 0 : 1}">${p.is_admin ? 'Remove admin' : 'Make admin'}</button>`}
          <button class="btn sm" data-act="adm-pw" data-u="${p.id}">Temporary password</button>
          ${mine ? '' : `<button class="btn sm danger" data-act="adm-del" data-u="${p.id}">Delete</button>`}</div>`}
        ${p.status === 'active' || p.is_master ? roleSel : ''}</section>`;
    }).join('') + `<section class="card"><h3>Teams</h3>${adm.ts.map((t, i) => `<div class="kv"><label>${esc(t.name)}</label>${i === 0 ? '<span class="small muted">main team</span>' : `<button class="btn sm danger" data-act="adm-team-del" data-t="${t.id}" data-n="${esc(t.name)}">Remove</button>`}</div>`).join('')}</section><div class="btnrow"><button class="btn" data-act="adm-team">Add a team</button></div><p class="small muted pad">Members read the shared songs. Leads can also add, change, hide and delete them for everyone.</p>`;
  }
  async function edge(body) { return api('/functions/v1/admin-users', { method: 'POST', json: body }); }
  const admDo = async (fn, ok) => { try { await fn(); toast(ok); await loadAdmin(); } catch (e) { toast(e.message, 5000); } };
  let apr = null;
  A['adm-status'] = (el) => {
    const u = el.dataset.u, v = el.dataset.v;
    const has = adm.ms.some((m) => m.user_id === u);
    if (v === 'active' && !has) {
      const p = adm.ps.find((x) => x.id === u) || {};
      apr = { u, sel: {} }; if (adm.ts[0]) apr.sel[adm.ts[0].id] = 'user';
      sheet(`<div class="sh-h">Approve ${esc(p.name || 'this person')}</div><p class="small muted">Choose which teams they can use. They only ever see songs and sets from these teams.</p>` +
        adm.ts.map((t) => `<div class="kv"><label>${esc(t.name)}</label><select data-adm-pick data-t="${t.id}"><option value="none" ${apr.sel[t.id] ? '' : 'selected'}>No access</option><option value="user" ${apr.sel[t.id] === 'user' ? 'selected' : ''}>Member</option><option value="lead">Lead</option></select></div>`).join('') +
        `<div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="adm-approve">Approve</button></div>`);
      return;
    }
    admDo(() => edge({ action: 'set_status', uid: u, status: v }), v === 'active' ? 'Switched on' : 'Switched off');
  };
  A['adm-approve'] = () => {
    const picks = Object.entries(apr.sel).filter(([, r]) => r && r !== 'none');
    if (!picks.length) { toast('Pick at least one team'); return; }
    const u = apr.u; closeSheet();
    admDo(async () => { for (const [tid, role] of picks) await api('/rest/v1/rpc/admin_set_role', { method: 'POST', json: { uid: u, tid, new_role: role } }); await edge({ action: 'set_status', uid: u, status: 'active' }); }, 'Approved');
  };
  A['adm-admin'] = (el) => admDo(() => api('/rest/v1/rpc/admin_set_admin', { method: 'POST', json: { uid: el.dataset.u, flag: el.dataset.v === '1' } }), 'Updated');
  A['adm-del'] = (el) => confirmBox('Delete this account?', 'They will no longer be able to sign in. Songs already on their phone stay there.', 'Delete', () => admDo(() => edge({ action: 'delete', uid: el.dataset.u }), 'Deleted'), true);
  A['adm-pw'] = (el) => { adm.pwFor = el.dataset.u; sheet(`<div class="sh-h">Temporary password</div><p class="small muted">Tell them this password in person. They should change it after signing in.</p><div class="field"><input id="tpw" value="${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 8)}A9"></div><div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="adm-pw-go">Set</button></div>`); };
  A['adm-pw-go'] = () => { const v = $('#tpw').value; closeSheet(); admDo(() => edge({ action: 'set_password', uid: adm.pwFor, password: v }), 'Password set to: ' + v); };
  A['adm-team-del'] = (el) => confirmBox('Remove the team "' + el.dataset.n + '"?', 'Everyone loses access to it. Only teams with no songs or sets can be removed.', 'Remove team', () => admDo(() => api('/rest/v1/rpc/admin_delete_team', { method: 'POST', json: { tid: el.dataset.t } }), 'Team removed'), true);
  A['adm-team'] = () => sheet(`<div class="sh-h">Add a team</div><div class="field"><input id="tname" placeholder="Team name"></div><div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="adm-team-go">Add</button></div>`);
  A['adm-team-go'] = () => { const v = $('#tname').value.trim(); if (!v) return; closeSheet(); admDo(() => api('/rest/v1/rpc/admin_create_team', { method: 'POST', json: { team_name: v } }), 'Team added'); };
  document.addEventListener('change', (e) => { const pk = e.target.closest && e.target.closest('[data-adm-pick]'); if (pk && apr) apr.sel[pk.dataset.t] = pk.value; });
  document.addEventListener('change', (e) => {
    const s = e.target.closest && e.target.closest('[data-adm-role]'); if (!s) return;
    admDo(() => api('/rest/v1/rpc/admin_set_role', { method: 'POST', json: { uid: s.dataset.u, tid: s.dataset.t, new_role: s.value } }), 'Updated');
  });

  /* ---------- start up ---------- */
  let lastAuto = 0;
  const auto = () => { if (active() && now() - lastAuto > 60000) { lastAuto = now(); sync(false); } };
  H.ready = () => {
    if (!C.session && !LS.get('sb_cloud_skip')) openGate('in');
    else if (C.session) {
      if (C.profile && C.profile.status !== 'active' && !sessionStorage.getItem('sb_gate_seen')) { try { sessionStorage.setItem('sb_gate_seen', '1'); } catch (e) {} openGate('in'); }
      lastAuto = now(); sync(false);
    }
  };
  ['new-song', 'imp-go'].forEach((k) => { const o = A[k]; if (!o) return; A[k] = async (...args) => { const v = curTeam(); if (v && v !== 'mine') { LS.set(TK, 'mine'); toast('Saved in My songs. Leads can share it with a team from the \u22ef menu.', 4500); } return o(...args); }; });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') auto(); });
  window.addEventListener('online', () => { lastAuto = 0; auto(); });
  Object.assign(X, { cloudSync: sync, cloudApi: api });
})();
