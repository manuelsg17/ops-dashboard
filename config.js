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
  declineThreshold: 3,
  declineMetric:    "activeDrivers",
  proyectosData:    [],
  parseWarnings:    new Set(),
  _mensualLoaded:   false,
  _diarioLoaded:    false,
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
  bannedWords: JSON.parse(
    localStorage.getItem("yangoBannedWords") ||
    JSON.stringify(["tuktuk", "tuk tuk", "delivery", "cargo", "mototaxi", "bikes"])
  )
};
function rebuildKAMPartners() {
  STATE.KAM_PARTNERS = {};
  Object.entries(STATE.KAM_MAP).forEach(([clid, kam]) => {
    const p = STATE.CLID_MAP[clid];
    if (!p) return;
    const kamT = (kam || "").trim();
    if (!kamT) return;  // skip CLIDs sin KAM asignado
    if (!STATE.KAM_PARTNERS[kamT]) STATE.KAM_PARTNERS[kamT] = new Set();
    STATE.KAM_PARTNERS[kamT].add(p);
  });
}
