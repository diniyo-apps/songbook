/* Tiny IndexedDB wrapper. Every write resolves only after the transaction has fully committed. */
(function (root) {
  const NAME = 'songbook', VER = 1;
  const STORES = ['songs', 'sets', 'blobs', 'snaps', 'meta'];
  let db = null;

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        STORES.forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'meta' ? 'k' : 'id' }); });
      };
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Database blocked'));
    });
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  function run(stores, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Transaction aborted'));
      Promise.resolve(fn(t)).then((v) => { out = v; }).catch((e) => { try { t.abort(); } catch (_) {} rej(e); });
    });
  }

  const api = {
    open,
    all: (s) => run(s, 'readonly', (t) => req(t.objectStore(s).getAll())),
    get: (s, id) => run(s, 'readonly', (t) => req(t.objectStore(s).get(id))),
    put: (s, obj) => run(s, 'readwrite', (t) => req(t.objectStore(s).put(obj))),
    putMany: (s, arr) => run(s, 'readwrite', async (t) => { const st = t.objectStore(s); for (const o of arr) st.put(o); }),
    del: (s, id) => run(s, 'readwrite', (t) => req(t.objectStore(s).delete(id))),
    delMany: (s, ids) => run(s, 'readwrite', async (t) => { const st = t.objectStore(s); for (const id of ids) st.delete(id); }),
    clear: (s) => run(s, 'readwrite', (t) => req(t.objectStore(s).clear())),
    keys: (s) => run(s, 'readonly', (t) => req(t.objectStore(s).getAllKeys())),
    // replace whole songs+sets in ONE transaction (all-or-nothing)
    replaceLibrary: (songs, sets) => run(['songs', 'sets'], 'readwrite', async (t) => {
      const a = t.objectStore('songs'), b = t.objectStore('sets');
      a.clear(); b.clear();
      songs.forEach((o) => a.put(o)); sets.forEach((o) => b.put(o));
    }),
    getMeta: async (k, d) => { const r = await api.get('meta', k); return r ? r.v : d; },
    setMeta: (k, v) => api.put('meta', { k, v }),
  };
  root.DB = api;
})(self);
