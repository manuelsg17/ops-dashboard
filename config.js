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

// Colores fijos por ciudad
const CITY_COLORS = {
  Lima:     "#FF0000",
  Trujillo: "#06b6d4",
  Arequipa: "#f97316"
};

const CITIES = ["Lima", "Trujillo", "Arequipa"];

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
    if (!STATE.KAM_PARTNERS[kam]) STATE.KAM_PARTNERS[kam] = new Set();
    STATE.KAM_PARTNERS[kam].add(p);
  });
}
