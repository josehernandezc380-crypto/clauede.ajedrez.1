/* Capa de datos local (IndexedDB). Todo se guarda en el dispositivo.
   Cada registro lleva id único (uuid) y updatedAt: así se podrá sincronizar con la nube después. */
(function (g) {
  var DB = "entrenador", V = 1, db = null, DAY = 864e5;
  var STORES = { games: "id", revancha: "id", journal: "id", kv: "k" };
  var STEPS = [1, 3, 7, 14, 30]; // días entre repasos de Revancha

  function uid() {
    return (g.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, V);
      r.onupgradeneeded = function () {
        Object.keys(STORES).forEach(function (s) {
          if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: STORES[s] });
        });
      };
      r.onsuccess = function () { db = r.result; res(db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function run(store, mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), out = fn(t.objectStore(store));
        t.oncomplete = function () { res(out && "result" in out ? out.result : out); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function put(store, obj) {
    var key = STORES[store];
    if (!obj[key]) obj[key] = uid();
    obj.updatedAt = Date.now();
    return run(store, "readwrite", function (s) { s.put(obj); }).then(function () { return obj; });
  }
  function get(store, id) { return run(store, "readonly", function (s) { return s.get(id); }); }
  function all(store) { return run(store, "readonly", function (s) { return s.getAll(); }); }
  function del(store, id) { return run(store, "readwrite", function (s) { s.delete(id); }); }

  /* ---------- Partidas ---------- */
  // game: { pgn, startFen, sans[], ana[], me:"w"|"b", result, source, playedAt }
  function saveGame(game) { game.createdAt = game.createdAt || Date.now(); return put("games", game); }
  function listGames() { return all("games").then(function (a) { return a.sort(function (x, y) { return y.createdAt - x.createdAt; }); }); }

  /* ---------- Revancha (repetición espaciada) ---------- */
  // item: { fen, played, best, bestUci, kind, gameId, ply }
  // El id depende de la posición: si repites el mismo error, no se duplica.
  function addRevancha(items) {
    return Promise.all(items.map(function (it) {
      var id = "rv:" + it.fen;
      return get("revancha", id).then(function (old) {
        if (old) { old.repeats = (old.repeats || 0) + 1; old.level = 0; old.due = Date.now(); return put("revancha", old); }
        return put("revancha", Object.assign({ id: id, level: 0, due: Date.now(), fails: 0, repeats: 0, createdAt: Date.now() }, it));
      });
    }));
  }
  function dueRevancha() {
    var now = Date.now();
    return all("revancha").then(function (a) {
      return a.filter(function (x) { return x.due <= now; }).sort(function (x, y) { return x.due - y.due; });
    });
  }
  function reviewRevancha(id, ok) {
    return get("revancha", id).then(function (it) {
      if (!it) return null;
      if (ok) { it.level = Math.min(it.level + 1, STEPS.length - 1); it.due = Date.now() + STEPS[it.level] * DAY; }
      else { it.level = 0; it.fails = (it.fails || 0) + 1; it.due = Date.now() + 10 * 60 * 1000; }
      return put("revancha", it);
    });
  }

  function statsRevancha() {
    var now = Date.now();
    return all("revancha").then(function (a) {
      return { total: a.length, due: a.filter(function (x) { return x.due <= now; }).length, solid: a.filter(function (x) { return x.level >= 3; }).length };
    });
  }

  function getGame(id) { return get("games", id); }
  function kvGet(k) { return get("kv", k).then(function (x) { return x && x.v; }); }
  function kvSet(k, v) { return put("kv", { k: k, v: v }); }

  /* ---------- Perfil del jugador (lo que leerá el entrenador IA) ---------- */
  var PROFILE0 = { elo: 600, goalElo: 1000, username: "", color: "w", notes: [] };
  function getProfile() { return get("kv", "profile").then(function (p) { return Object.assign({}, PROFILE0, p && p.v); }); }
  function updateProfile(patch) {
    return getProfile().then(function (p) { return put("kv", { k: "profile", v: Object.assign(p, patch) }); });
  }

  /* ---------- Diario ---------- */
  function addJournal(entry) { entry.date = entry.date || Date.now(); return put("journal", entry); }
  function listJournal() { return all("journal").then(function (a) { return a.sort(function (x, y) { return y.date - x.date; }); }); }

  /* ---------- Respaldo / base para sincronizar ---------- */
  function exportAll() {
    return Promise.all(Object.keys(STORES).map(function (s) { return all(s); })).then(function (r) {
      var o = { version: V, exportedAt: Date.now() };
      Object.keys(STORES).forEach(function (s, i) { o[s] = r[i]; });
      return o;
    });
  }
  function importAll(o) { // gana el registro con updatedAt más reciente
    return Promise.all(Object.keys(STORES).map(function (s) {
      return Promise.all((o[s] || []).map(function (x) {
        return get(s, x[STORES[s]]).then(function (old) {
          if (!old || (x.updatedAt || 0) > (old.updatedAt || 0)) return run(s, "readwrite", function (st) { st.put(x); });
        });
      }));
    }));
  }

  g.DB = { saveGame: saveGame, listGames: listGames, addRevancha: addRevancha, dueRevancha: dueRevancha,
    reviewRevancha: reviewRevancha, statsRevancha: statsRevancha, getGame: getGame, kvGet: kvGet, kvSet: kvSet, getProfile: getProfile, updateProfile: updateProfile,
    addJournal: addJournal, listJournal: listJournal, exportAll: exportAll, importAll: importAll };
})(self);
