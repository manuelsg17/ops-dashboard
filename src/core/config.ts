// ============================================================
// core/config.js — Configuración central (Fase A2: módulo ES)
// ============================================================
// Primer archivo convertido a módulo ES. vendor.js lo importa y espeja sus
// exports a window para que los archivos aún clásicos (public/*.js) sigan
// leyéndolos como globales durante la transición A2.

// Sin `.env.local` apunta a produccion, que es lo que hace el deploy (Vercel y
// Pages buildean sin env vars). Con `.env.local` presente Vite inyecta el
// Supabase local de Docker y la app corre contra datos de prueba.
const _ENV = (import.meta as any).env || {};

export const SUPABASE_URL      = _ENV.VITE_SUPABASE_URL      || "https://oqakoinyzvdgqilxwjjv.supabase.co";
export const SUPABASE_ANON_KEY = _ENV.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xYWtvaW55enZkZ3FpbHh3amp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTgyMTQsImV4cCI6MjA5MDI5NDIxNH0.ODvMd19d7FoPZnYYdHl2a6ifQYVIO9YT8l8UrCMjyiI";

// Aviso visible: correr contra local y creer que son datos reales (o al reves)
// es el error caro de este setup.
export const IS_LOCAL_SUPABASE = /localhost|127\.0\.0\.1/.test(SUPABASE_URL);

// Flag de debug: false por default (no filtrar CLIDs/partners en consola).
// Activar desde DevTools con `window.DEBUG = true`. Nota (A2): mientras los
// consumidores (data.js/metas.js) sigan siendo scripts clásicos, leen la copia
// window.DEBUG que espeja vendor.js. Al convertirlos a módulos, importar DEBUG
// desde acá o usar window.DEBUG de forma consistente.
export let DEBUG = false;

export const KAM_COLORS = {
  Miguel:  "#FF0000",
  Manuel:  "#f97316",
  Matias:  "#8b5cf6",
  Alvaro:  "#06b6d4",
  Rodolfo: "#10b981",
  Diego:   "#f59e0b"
};

// Colores por ciudad. Keys UPPERCASE (BD/memoria normalizan). Display: cityLabel().
export const CITY_COLORS = {
  LIMA:     "#FF0000",
  TRUJILLO: "#06b6d4",
  AREQUIPA: "#f97316"
};

export const CITIES = ["LIMA", "TRUJILLO", "AREQUIPA"];

// Nombres canónicos de métricas (usar METRICS.ad.label, no strings sueltos).
export const METRICS = {
  ad: {
    key:    "ad",
    label:  "Conductores Activos",
    short:  "Cond. Activos",
    color:  "#FF0000",
    type:   "snapshot",
    desc:   "Maximo de conductores activos en una semana del rango"
  },
  nr: {
    key:    "nr",
    label:  "Nuevos + Reactivados",
    short:  "Nuevos+React",
    color:  "#f97316",
    type:   "cumulative",
    desc:   "Suma de conductores nuevos (from partner + from service) y reactivados"
  },
  sh: {
    key:    "sh",
    label:  "Horas de Conexión",
    short:  "Hs. Conexión",
    color:  "#8b5cf6",
    type:   "cumulative",
    desc:   "Suma de horas de conexion en el rango"
  },
  tr: {
    key:    "tr",
    label:  "Viajes",
    short:  "Viajes",
    color:  "#0ea5e9",
    type:   "cumulative",
    desc:   "Suma de viajes completados en el rango"
  }
};

// ── FLEET EXTERNO (Supabase de un colega, solo-lectura) ──────────────────────
// Config desde la UI (tab Fleet Externo), guardada en localStorage — la
// credencial del colega NO se commitea. Solo anon key pública (RLS del colega).
export const FLEET_EXT = (function () {
  const def = { enabled: false, url: "", anonKey: "", table: "" };
  try {
    const s = JSON.parse(localStorage.getItem("yangoFleetExtConfig") || "null");
    if (s && s.url && s.anonKey) {
      return { enabled: true, url: s.url.trim(), anonKey: s.anonKey.trim(), table: (s.table || "").trim() };
    }
  } catch (_) {}
  return def;
})();

// Estado global de la aplicación.
export const STATE = {
  rawData:             [],
  rawDataMensual:      [],
  rawDataMensualTuktuk:[],
  rawDataDiarioTuktuk: [],
  rawDataFleet:        [],
  rawDataMensualFleet: [],
  rawDataDiarioFleet:  [],
  rawDataFull:         [],
  rawDataMensualFull:  [],
  metasData:           [],
  allDates:            [],
  allPartners:         [],
  partnerColors:       {} as Record<string, string>,
  // Logo de cada partner (data URL), indexado por NOMBRE porque asi lo consume
  // la carátula del deck. Se carga DIFERIDO (partner_logos, ver la migración):
  // no viaja en el arranque.
  partnerLogos:        {} as Record<string, string>,
  _logosCargados:      false,
  CLID_MAP:            {} as Record<string, string>,
  KAM_MAP:             {} as Record<string, string>,
  KAM_PARTNERS:        {} as Record<string, Set<string>>,
  // Mapa clid -> fila de `flotas` (kam, nombre_asignado, activo, ciudad).
  // null hasta que se carga el Excel de Flotas (data.ts); auth.ts lo resetea
  // a null en logout. Sin este tipo explícito, el literal `{}` infiere sin
  // index signature y Object.entries(...) devuelve `unknown` (12 errores TS).
  flotasMap:           null as Record<string, any> | null,
  charts:              {},
  tblSort:          { col: "ad", dir: "desc" },
  curSummaries:     [],
  curTab:           "rend",
  curMode:          "semanal",
  // KAM al que pertenece ESTE login (app_metadata.kam del JWT, ver auth.ts).
  // Null para cuentas sin ese campo (admin, o un kam sin asignar todavía). Solo
  // se usa como DEFAULT de conveniencia (ej. preseleccionar en la Calculadora,
  // ver calculator.ts) — nunca para filtrar datos: los roles acá son de
  // PERMISOS, no de scoping (decisión de Manuel, jul 2026); un KAM logueado
  // sigue viendo todos los partners igual que antes.
  myKam:            null as string | null,
  rendLine:         "comb",
  metasLine:        "comb",
  // Mes de Metas elegido a mano en el selector: NOMBRE + AÑO (B1). null = el
  // default (último mes con datos, ver metas._metasMesElegido).
  metasMesSel:      null as string | null,
  metasMesSelYear:  null as number | null,
  declineThreshold: 3,
  declineMetric:    "activeDrivers",
  proyectosData:    [],
  seguimientoData:  [],
  fleetExterno:     [],
  fleetExternoCols: [],
  fleetExternoError: null,
  fleetExternoLoaded: false,
  perms:            new Set(),   // grants granulares por usuario (Fase B2)
  parseWarnings:    new Set(),
  _mensualLoaded:   false,
  _diarioLoaded:    false,
  conversionData:   [],
  _conversionLoaded: false,
  rawDataDiario:      [],
  rawDataDiarioFull:  [],
  _apdFull:         null,
  _byPartner:       null,
  _byCity:          null,
  _byCityDate:      null,
  _partnerKAM:      null,
  _tabRenderId:     0,
  _switchingTab:    false,
  tuktukPatterns: (function() {
    const fallback = ["tuktuk", "tuk tuk", "tuk-tuk", "mototaxi"];
    try {
      const raw = JSON.parse(localStorage.getItem("yangoTuktukPatterns") || "null");
      if (!Array.isArray(raw)) return fallback;
      return raw
        .filter(w => typeof w === "string" && w.length > 0 && w.length <= 40)
        .slice(0, 100);
    } catch { return fallback; }
  })()
};

// Bucket para los partners que NO tienen KAM asignado.
//
// POR QUE EXISTE. Antes, un partner sin KAM simplemente no entraba a
// KAM_PARTNERS: no aparecía bajo ningún KAM del filtro y no había forma de
// verlo agrupado. Eso lo volvía INVISIBLE justo para la persona que tenía que
// arreglarlo — para asignarle un KAM en Configuración primero hay que saber que
// existe. En producción (sep 2026) eran 12 partners con fila en `partners` y
// KAM vacío, más 16 CLIDs con datos que ni siquiera tienen fila en `partners`.
//
// NO SE TRADUCE, a propósito. Este string es una CLAVE: es el `value` de la
// opción del filtro, la clave de KAM_PARTNERS y el valor que devuelve
// getKAMForPartner, y todo eso se compara por igualdad. Traducirlo haría que al
// cambiar de idioma el filtro dejara de matchear en silencio — exactamente la
// clase de bug que este archivo ya arrastró con las escalas.
export const SIN_KAM = "No KAM";

export function rebuildKAMPartners() {
  STATE.KAM_PARTNERS = {};
  const agregar = (kam, partner) => {
    if (!partner) return;
    const k = (kam || "").trim() || SIN_KAM;
    if (!STATE.KAM_PARTNERS[k]) STATE.KAM_PARTNERS[k] = new Set();
    STATE.KAM_PARTNERS[k].add(partner);
  };
  // FUENTE DE VERDAD: tabla `partners` (CLID_MAP + KAM_MAP). `flotas` solo aporta
  // cuando el CLID NO está en partners.
  Object.entries(STATE.KAM_MAP).forEach(([clid, kam]) => {
    const p = STATE.CLID_MAP[clid];
    if (!p) return;
    const f = STATE.flotasMap && STATE.flotasMap[clid];
    if (f && f.activo === false) return;
    // Sin KAM ya NO se descarta: cae al bucket SIN_KAM (ver arriba).
    agregar(kam, p);
  });
  if (STATE.flotasMap) {
    Object.entries(STATE.flotasMap).forEach(([clid, f]) => {
      // `nombre_asignado` sigue siendo obligatorio: sin nombre no hay nada que
      // listar. El KAM vacío, en cambio, ahora es un caso válido.
      if (!f || !f.nombre_asignado) return;
      if (f.activo === false) return;
      if (STATE.CLID_MAP && STATE.CLID_MAP[clid]) return;
      // MISMA precedencia que _buildPartnerKAM (data.ts): `partners` → `flotas`
      // → el kam que traía la fila. Sin el último escalón, el sidebar mandaba a
      // "No KAM" a partners que las demás pantallas sí atribuían a alguien, y
      // los mismos números aparecían en dos grupos distintos según la pantalla.
      // En producción 15 de los 16 CLIDs sueltos tienen la fila vacía y caen en
      // "No KAM" igual; el escalón importa para el que sí trae KAM.
      agregar(f.kam || STATE._partnerKAM?.get(f.nombre_asignado), f.nombre_asignado);
    });
  }
}
