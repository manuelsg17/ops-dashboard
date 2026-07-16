// ============================================================
// config.js — Configuración central
// ============================================================

const SUPABASE_URL      = "https://oqakoinyzvdgqilxwjjv.supabase.co";  // ← reemplaza
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xYWtvaW55enZkZ3FpbHh3amp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTgyMTQsImV4cCI6MjA5MDI5NDIxNH0.ODvMd19d7FoPZnYYdHl2a6ifQYVIO9YT8l8UrCMjyiI";                   // ← reemplaza

// Colores fijos por KAM
const KAM_COLORS = {
  Miguel:  "#FF0000",
  Manuel:  "#f97316",
  Matias:  "#8b5cf6",
  Alvaro:  "#06b6d4",
  Rodolfo: "#10b981",
  Diego:   "#f59e0b"
};

// Colores fijos por ciudad. Keys en UPPERCASE: la BD y memoria normalizan a
// UPPERCASE para evitar fragmentacion "Lima" vs "lima" vs "LIMA". Para display
// usar cityLabel() (definida en data.js).
const CITY_COLORS = {
  LIMA:     "#FF0000",
  TRUJILLO: "#06b6d4",
  AREQUIPA: "#f97316"
};

const CITIES = ["LIMA", "TRUJILLO", "AREQUIPA"];

// Nombres canonicos de metricas. Usar METRICS.ad.label en lugar de strings
// hardcodeados para mantener consistencia entre tabs.
const METRICS = {
  ad: {
    key:    "ad",
    label:  "Conductores Activos",
    short:  "Cond. Activos",
    color:  "#FF0000",
    type:   "snapshot",  // valor instantaneo (no acumulativo)
    desc:   "Maximo de conductores activos en una semana del rango"
  },
  nr: {
    key:    "nr",
    label:  "Nuevos + Reactivados",
    short:  "Nuevos+React",
    color:  "#f97316",
    type:   "cumulative",  // suma del rango
    desc:   "Suma de conductores nuevos (from partner + from service) y reactivados"
  },
  sh: {
    key:    "sh",
    label:  "Horas de Conexión",
    short:  "Hs. Conexión",
    color:  "#8b5cf6",
    type:   "cumulative",  // suma del rango
    desc:   "Suma de horas de conexion en el rango"
  }
};

// Estado global de la aplicación
const STATE = {
  rawData:             [],
  rawDataMensual:      [],
  rawDataMensualTuktuk:[],   // Slice mensual TukTuk (Fase 7, para metas TukTuk)
  rawDataFleet:        [],   // Slice semanal Fleet (Fase 2, línea Rendimiento) — Fleet ⊂ Agregador
  rawDataMensualFleet: [],   // Slice mensual Fleet (Fase 2)
  rawDataFull:         [],   // Copia sin filtrar (incluye flotas excluidas)
  rawDataMensualFull:  [],   // Idem para mensual
  metasData:           [],
  allDates:            [],
  allPartners:         [],
  partnerColors:       {},
  CLID_MAP:            {},
  KAM_MAP:             {},
  KAM_PARTNERS:        {},
  charts:              {},
  tblSort:          { col: "ad", dir: "desc" },
  curSummaries:     [],
  curTab:           "rend",
  curMode:          "semanal",
  rendLine:         "agg",     // Línea de negocio en Rendimiento: "agg" | "fleet" | "tk" (Fase 2)
  metasLine:        "agg",     // Línea de negocio en Metas: "agg" | "fleet" | "tk" (Fase 3)
  declineThreshold: 3,
  declineMetric:    "activeDrivers",
  proyectosData:    [],
  seguimientoData:  [],     // tracker de reuniones (tabla seguimiento, Fase 3)
  parseWarnings:    new Set(),
  _mensualLoaded:   false,
  _diarioLoaded:    false,
  conversionData:   [],     // funnel por CLID (tabla conversion_pais)
  _conversionLoaded: false,
  rawDataDiario:      [],
  rawDataDiarioFull:  [],
  _apdFull:         null,
  _byPartner:       null,   // Map<partner, Row[]>
  _byCity:          null,   // Map<city, Row[]>
  _byCityDate:      null,   // Map<"city|||date", Row[]>
  _partnerKAM:      null,   // Map<partner, kam>  (lookup O(1))
  _tabRenderId:     0,      // Token global: se incrementa en cada switchTab.
                            // Cualquier render asincrono captura el id al inicio
                            // y aborta si !==STATE._tabRenderId.
  _switchingTab:    false,  // Guard de reentrancia: evita que doble-click rapido
                            // lance dos secuencias destroy+render concurrentes.
  // Defensivo contra localStorage manipulado: solo strings hasta 40 chars,
  // cap de 100 entradas, fallback al default si el JSON no es array de strings.
  bannedWords: (function() {
    const fallback = ["tuktuk", "tuk tuk", "delivery", "cargo", "mototaxi", "bikes"];
    try {
      const raw = JSON.parse(localStorage.getItem("yangoBannedWords") || "null");
      if (!Array.isArray(raw)) return fallback;
      return raw
        .filter(w => typeof w === "string" && w.length > 0 && w.length <= 40)
        .slice(0, 100);
    } catch { return fallback; }
  })(),
  // Lista SEPARADA de bannedWords: no oculta filas, solo SUGIERE (Vista Flotas)
  // marcar is_tuktuk cuando el Nombre Excel de un CLID matchea. Nunca auto-guarda.
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
function rebuildKAMPartners() {
  STATE.KAM_PARTNERS = {};
  // FUENTE DE VERDAD: tabla `partners` (CLID_MAP + KAM_MAP). Lo que el equipo
  // configuro alli manda. `flotas` solo aporta cuando el CLID NO esta en partners.
  Object.entries(STATE.KAM_MAP).forEach(([clid, kam]) => {
    const p = STATE.CLID_MAP[clid];
    if (!p) return;
    // Excluir si la flota tiene activo=false
    const f = STATE.flotasMap && STATE.flotasMap[clid];
    if (f && f.activo === false) return;
    const kamT = (kam || "").trim();
    if (!kamT) return;
    if (!STATE.KAM_PARTNERS[kamT]) STATE.KAM_PARTNERS[kamT] = new Set();
    STATE.KAM_PARTNERS[kamT].add(p);
  });
  // Fallback: agregar partners que estan en flotas pero NO en partners
  if (STATE.flotasMap) {
    Object.entries(STATE.flotasMap).forEach(([clid, f]) => {
      if (!f || !f.kam || !f.nombre_asignado) return;
      if (f.activo === false) return;
      if (STATE.CLID_MAP && STATE.CLID_MAP[clid]) return;  // ya cubierto por partners
      if (!STATE.KAM_PARTNERS[f.kam]) STATE.KAM_PARTNERS[f.kam] = new Set();
      STATE.KAM_PARTNERS[f.kam].add(f.nombre_asignado);
    });
  }
}
