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
  const payload = (s) => ({ title: s.title || '', author: s.author || '', key: s.key || '', fmt: s.fmt || 'text', body: s.body || '', tags: Array.isArray(s.tags) ? s.tags : [], raw: s.raw || null, pdfFile: s.pdfFile || null });
  const setSig = (set) => MD5.text(JSON.stringify([set.name || '', (set.items || []).map((i) => { const sg = songById(i.songId); return sg && sg.cloud ? sg.cloud.id : i.songId; })]));
  const setEdited = (set) => !!(set.cloud && set.cloud.base && setSig(set) !== set.cloud.base);
  async function sha(buf) { const d = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  const norm = (x) => String(x || '').trim().toLowerCase();

  function applySong(local, rem, pdfBuf) {
    const d = rem.data || {};
    Object.assign(local, { title: d.title || '', author: d.author || '', key: d.key || '', fmt: d.fmt || 'text', body: d.body || '', tags: d.tags || [], raw: d.raw || local.raw || null });
    if (d.fmt === 'pdf') { local.pdfFile = d.pdfFile || local.pdfFile; if (pdfBuf) { local.pdfId = local.pdfId || uid(); local.hash = MD5.bytes(pdfBuf); } }
    local.cloud = { id: rem.id, team: rem.team_id, ver: rem.version, base: sigOf(local), pdf: rem.pdf_path || null, hidden: !!rem.hidden };
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
        const part = await api('/rest/v1/cloud_songs?id=in.(' + need.slice(i, i + 30).join(',') + ')&select=id,team_id,data,pdf_path,version,hidden,deleted');
        part.forEach((p) => data.set(p.id, p));
      }
      if (need.length || S.songs.some((s) => s.cloud && !remote.has(s.cloud.id))) { await X.takeSnapshot('before shared update', true); take = true; }
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
  async function publishSong(s) {
    const team = (s.cloud && s.cloud.team) || (leadTeams()[0] || {}).id;
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
      s.cloud.ver = rows[0].version;
    } else {
      const rows = await api('/rest/v1/cloud_songs', { method: 'POST', headers: { Prefer: 'return=representation' }, json: { team_id: team, data: payload(s), pdf_path: path } });
      s.cloud = { id: rows[0].id, team, ver: rows[0].version, hidden: false };
    }
    s.cloud.pdf = path; s.cloud.base = sigOf(s); delete s.cloud.incoming;
    await putSong(s);
  }
  async function patchSong(s, body) {
    const rows = await api('/rest/v1/cloud_songs?id=eq.' + s.cloud.id + '&version=eq.' + s.cloud.ver, { method: 'PATCH', headers: { Prefer: 'return=representation' }, json: body });
    if (!rows || !rows.length) throw fail('Someone else changed this song first. Sync, then try again.', { conflict: true });
    s.cloud.ver = rows[0].version; return rows[0];
  }
  async function publishSet(set) {
    const team = (set.cloud && set.cloud.team) || (leadTeams()[0] || {}).id;
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
  const row = (act, t, a, cls) => `<button class="row ${cls || ''}" data-act="${act}"><span class="rt"><span class="t">${t}</span>${a ? `<span class="a">${a}</span>` : ''}</span></button>`;
  H.rowTag = (s) => {
    if (!s.cloud) return '';
    if (s.cloud.incoming) return '<i class="bd warn">Update</i>';
    if (edited(s)) return '<i class="bd mine">Mine</i>';
    if (s.cloud.hidden) return '<i class="bd">Hidden</i>';
    return '';
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

  const A = X.A;
  const cur = () => X.curSong();
  A['cl-pub-song'] = () => { closeSheet(); const s = cur(); guard(() => publishSong(s), 'Shared with everyone'); };
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
    if (!r) { const rows = await api('/rest/v1/cloud_songs?id=eq.' + s.cloud.id + '&select=id,team_id,data,pdf_path,version,hidden,deleted'); r = rows[0]; if (!r) throw fail('The shared song is gone.'); }
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
    return `<section class="card" id="cloudcard"><h3>Shared songbook</h3>
      <div class="kv"><label>${esc(p.name || 'You')}</label><span class="small muted">${esc(p.email || '')}</span></div>
      <p class="small">${active() ? esc(roles.join(' · ') || 'Member') : p.status === 'pending' ? 'Waiting for an admin to approve your account.' : 'This account is switched off.'}</p>
      <p class="small muted" id="cloudstat">${C.busy ? 'Syncing…' : 'Last sync: ' + when(C.last)}</p>
      ${n ? `<p class="small" style="color:var(--warn)">${n} shared song${n > 1 ? 's have' : ' has'} an update that clashes with your edits. Open the song and choose.</p>` : ''}
      <div class="btnrow tight"><button class="btn primary" data-act="cl-sync">Sync now</button><button class="btn" data-act="cl-pw">Change password</button><button class="btn" data-act="cl-out">Sign out</button></div>
      ${isLead() ? `<div class="btnrow tight"><button class="btn" data-act="cl-pub-all">Add all my new songs to the shared library</button></div>` : ''}
      ${isAdmin() ? `<div class="btnrow tight"><a class="btn" href="#/admin">Manage people</a></div>` : ''}
    </section>`;
  };
  function paintStatus() { const e = $('#cloudstat'); if (e) e.textContent = C.busy ? 'Syncing…' : 'Last sync: ' + when(C.last); }
  A['cl-sync'] = () => sync(true);
  A['cl-out'] = () => confirmBox('Sign out?', 'The songs stay on this phone. You will stop getting shared updates until you sign in again.', 'Sign out', () => { dropSession(); X.render(); toast('Signed out'); });
  A['cl-pw'] = () => sheet(`<div class="sh-h">Change password</div><div class="field"><label>New password (8 or more characters)</label><input id="npw" type="password" autocomplete="new-password"></div><div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="cl-pw-go">Save</button></div>`);
  A['cl-pw-go'] = async () => { const v = $('#npw').value; if (v.length < 8) { toast('Use at least 8 characters'); return; } try { await api('/auth/v1/user', { method: 'PUT', json: { password: v } }); closeSheet(); toast('Password changed'); } catch (e) { toast(e.message, 4000); } };
  A['cl-pub-all'] = () => {
    const list = live().filter((s) => !s.cloud);
    const ed = live().filter((s) => edited(s) && !s.cloud.incoming);
    if (!list.length && !ed.length) { toast('Nothing new to share'); return; }
    confirmBox('Share with the whole team?', `${list.length} new song${list.length === 1 ? '' : 's'}${ed.length ? ' and ' + ed.length + ' changed' : ''} will be added to the shared library for everyone. This takes a few minutes for many PDFs.`, 'Share', async () => {
      let ok = 0, bad = 0; const all = list.concat(ed);
      for (let i = 0; i < all.length; i++) { toast('Sharing ' + (i + 1) + ' of ' + all.length + '…', 1500); try { await publishSong(all[i]); ok++; } catch (e) { bad++; if (e.offline) break; } }
      toast(`Shared ${ok}${bad ? ', ' + bad + ' failed' : ''}`, 5000); X.render();
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
      inner = `<h2>Songbook</h2><p class="muted">Sign in to get the team’s shared songs. Your own changes always stay on this phone.</p>
        <div class="seg"><button class="${up ? '' : 'on'}" data-act="cl-gate-mode" data-m="in">Sign in</button><button class="${up ? 'on' : ''}" data-act="cl-gate-mode" data-m="up">Create account</button></div>
        ${up ? '<div class="field"><label>Your name</label><input id="gname" autocomplete="name"></div>' : ''}
        <div class="field"><label>Email</label><input id="gmail" type="email" autocomplete="email" autocapitalize="off"></div>
        <div class="field"><label>Password${up ? ' (8 or more characters)' : ''}</label><input id="gpw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}"></div>
        <p class="small" id="gerr" style="color:var(--danger);min-height:1.2em">${esc(C.msg || '')}</p>
        <button class="btn primary wide" data-act="cl-gate-go">${up ? 'Create account' : 'Sign in'}</button>
        ${up ? '<p class="small muted">New accounts are approved by an admin before the shared songs appear.</p>' : ''}
        <button class="linkbtn" data-act="cl-skip">Continue without an account</button>`;
    }
    g.innerHTML = `<div class="gatecard">${inner}</div>`;
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
      adm = { ps, ms, ts }; paintAdmin();
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
    }).join('') + `<div class="btnrow"><button class="btn" data-act="adm-team">Add a team</button></div><p class="small muted pad">Members read the shared songs. Leads can also add, change, hide and delete them for everyone.</p>`;
  }
  async function edge(body) { return api('/functions/v1/admin-users', { method: 'POST', json: body }); }
  const admDo = async (fn, ok) => { try { await fn(); toast(ok); await loadAdmin(); } catch (e) { toast(e.message, 5000); } };
  A['adm-status'] = (el) => admDo(() => edge({ action: 'set_status', uid: el.dataset.u, status: el.dataset.v }), el.dataset.v === 'active' ? 'Switched on' : 'Switched off');
  A['adm-admin'] = (el) => admDo(() => api('/rest/v1/rpc/admin_set_admin', { method: 'POST', json: { uid: el.dataset.u, flag: el.dataset.v === '1' } }), 'Updated');
  A['adm-del'] = (el) => confirmBox('Delete this account?', 'They will no longer be able to sign in. Songs already on their phone stay there.', 'Delete', () => admDo(() => edge({ action: 'delete', uid: el.dataset.u }), 'Deleted'), true);
  A['adm-pw'] = (el) => { adm.pwFor = el.dataset.u; sheet(`<div class="sh-h">Temporary password</div><p class="small muted">Tell them this password in person. They should change it after signing in.</p><div class="field"><input id="tpw" value="${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 8)}A9"></div><div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="adm-pw-go">Set</button></div>`); };
  A['adm-pw-go'] = () => { const v = $('#tpw').value; closeSheet(); admDo(() => edge({ action: 'set_password', uid: adm.pwFor, password: v }), 'Password set to: ' + v); };
  A['adm-team'] = () => sheet(`<div class="sh-h">Add a team</div><div class="field"><input id="tname" placeholder="Team name"></div><div class="btnrow"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="adm-team-go">Add</button></div>`);
  A['adm-team-go'] = () => { const v = $('#tname').value.trim(); if (!v) return; closeSheet(); admDo(() => api('/rest/v1/rpc/admin_create_team', { method: 'POST', json: { team_name: v } }), 'Team added'); };
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') auto(); });
  window.addEventListener('online', () => { lastAuto = 0; auto(); });
  Object.assign(X, { cloudSync: sync, cloudApi: api });
})();
