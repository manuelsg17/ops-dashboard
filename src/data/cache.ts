//@ts-nocheck
// data/cache.js — Caché local del último snapshot de datos (IndexedDB).
//
// POR QUÉ EXISTE: en un hard refresh, el dashboard tardaba ~6s en pintar algo
// porque TODO venía de la red — y la latencia de Supabase (plan gratuito,
// Perú→us-east) no baja por optimizar el cliente. La estrategia es
// stale-while-revalidate: pintar al instante con lo último que se vio y
// refrescar en segundo plano. El usuario ve datos en <500ms en vez de mirar un
// spinner mientras se descargan miles de filas.
//
// POR QUÉ IndexedDB y no localStorage: localStorage es SÍNCRONO (bloquea el
// hilo principal justo en el arranque, que es exactamente lo que queremos
// acelerar), tiene ~5MB de tope, y solo guarda strings — obligaría a un
// JSON.stringify/parse de varios MB en cada carga. IndexedDB guarda los arrays
// de objetos tal cual (structured clone), sin serializar a mano.
//
// ── PRIVACIDAD ──────────────────────────────────────────────────────────────
// Acá quedan datos de negocio en el disco del usuario. Tres reglas:
//   1. El snapshot se guarda bajo la clave del user_id: cambiar de cuenta en el
//      mismo navegador NUNCA lee el snapshot del anterior.
//   2. `snapshotClear()` se llama en el logout (auth.js) — cerrar sesión borra
//      la data, no solo el token.
//   3. `SCHEMA_V` invalida todo de golpe cuando cambia la forma de los datos.
//      Subirlo es la manera correcta de descartar snapshots viejos tras un
//      cambio de columnas o de pipeline.

const DB_NAME  = "yangoDash";
const STORE    = "snapshots";
// v2 (ago-2026): cambió el juego de columnas del fetch eager (6 pasaron a
// diferidas). Los snapshots v1 no rompen nada —traen columnas de más, que se
// ignoran— pero la regla del proyecto es subir la versión ante un cambio de
// columnas, y cuesta un solo arranque sin caché.
const SCHEMA_V = 2;

// Vida del snapshot.
//
// ERA 24 h, Y ESO ANULABA EL CACHÉ JUSTO PARA EL USO NORMAL: un KAM abre el
// dashboard una vez por la mañana, así que entre sesión y sesión pasan 24 h y
// pico y el snapshot SIEMPRE se descartaba. El caché servía solo a quien
// recargaba dos veces el mismo día — es decir, casi nunca a quien lo necesita.
//
// El argumento original ("no pintar con confianza números de la semana pasada")
// tiene respuesta propia y ya construida: se pinta con el indicador
// `#dataRefreshing` visible y, desde ahora, con la ANTIGÜEDAD explícita cuando
// pasa de medio día. El snapshot nunca se muestra solo: la revalidación sale
// disparada en el mismo arranque. 7 días también acota cuánto tiempo quedan
// datos de negocio en el disco, que es la otra razón de que exista este tope.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let _dbPromise = null;

function _openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("Sin IndexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  // Un fallo al abrir no debe dejar la promesa rechazada cacheada para siempre
  // (ej. modo privado de Safari): se reintenta en la próxima llamada.
  _dbPromise.catch(() => { _dbPromise = null; });
  return _dbPromise;
}

function _tx(mode, fn) {
  return _openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req   = fn(store);
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  }));
}

function _key(userId) { return `core:${userId || "anon"}`; }

// Guarda el snapshot. Fire-and-forget por diseño: si IndexedDB falla (cuota
// llena, modo privado, storage bloqueado), la app sigue andando exactamente
// igual — solo pierde el arranque instantáneo de la próxima vez.
export function snapshotSave(payload) {
  const userId = (STATE && STATE.userId) || null;
  const rec = { v: SCHEMA_V, userId, at: Date.now(), ...payload };
  return _tx("readwrite", s => s.put(rec, _key(userId))).catch(err => {
    if (typeof DEBUG !== "undefined" && DEBUG) console.warn("snapshotSave falló:", err);
  });
}

// Devuelve el snapshot del usuario actual, o null si no hay / está vencido /
// es de otro esquema. Nunca lanza: en el peor caso devuelve null y la carga
// sigue por el camino de red de siempre.
export function snapshotLoad() {
  const userId = (STATE && STATE.userId) || null;
  return _tx("readonly", s => s.get(_key(userId))).then(rec => {
    if (!rec) return null;
    if (rec.v !== SCHEMA_V) return null;
    // Defensa extra sobre el keying por usuario: si por lo que sea la clave no
    // coincidiera con el dueño del snapshot, no se usa. Mostrarle a alguien los
    // datos de otra cuenta es mucho peor que un arranque lento.
    if ((rec.userId || null) !== userId) return null;
    if (Date.now() - (rec.at || 0) > MAX_AGE_MS) return null;
    return rec;
  }).catch(() => null);
}

// Borra TODO el caché. Se llama en el logout (auth.js) y ante cualquier
// sospecha de snapshot corrupto.
export function snapshotClear() {
  return _tx("readwrite", s => s.clear()).catch(() => {});
}
