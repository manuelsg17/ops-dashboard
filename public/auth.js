// auth.js — Autenticación con Supabase Auth

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Estado de sesion. Roles via JWT app_metadata.role: admin > kam > viewer
// (default). STATE.isAdmin gatea lo exclusivo de admin. STATE.perms (Set) trae
// los grants granulares por usuario de la tabla user_permissions (Fase B2) —
// permisos que SUMAN sobre el rol (ej. un viewer con 'write:metas'). userCan()
// combina admin + grants. RLS en el servidor es el guard real: aunque se
// modifique STATE en DevTools, el write falla si el JWT/uid no tiene el permiso.
function _setRoleFromUser(user) {
  const role = (user && user.app_metadata && user.app_metadata.role) || "viewer";
  STATE.userRole  = role;
  STATE.isAdmin   = role === "admin";
  if (!STATE.perms) STATE.perms = new Set();
  _recomputeCanWrite();
  _applyRoleGate();
  _loadPerms();   // async, refina STATE.perms + re-aplica el gate al volver
}

// Permisos de escritura/borrado que, otorgados a un usuario, deben mostrarle la
// UI de escritura (upload). El guard real por-tabla lo hace RLS via can().
const _WRITE_PERMS = ["write:performance", "write:metas", "write:config", "write:seguimiento", "delete:data"];

function _recomputeCanWrite() {
  const base = STATE.userRole === "admin" || STATE.userRole === "kam";
  const granted = STATE.perms && _WRITE_PERMS.some(p => STATE.perms.has(p));
  STATE.canWrite = base || !!granted;
}

// Carga los grants del usuario (RLS self_select → solo los propios). Silencioso
// ante error (tabla ausente / offline): el usuario simplemente queda sin grants
// extra, nunca con permisos de más.
async function _loadPerms() {
  try {
    const { data, error } = await sb.from("user_permissions").select("permission");
    if (error) return;
    STATE.perms = new Set((data || []).map(r => r.permission));
    _recomputeCanWrite();
    _applyRoleGate();
  } catch (_) { /* offline / tabla ausente → sin grants extra */ }
}

// Helper global de permiso: admin siempre; si no, el grant puntual. Usar para
// gatear UI de escritura fina (nunca como seguridad — eso es RLS).
function userCan(perm) {
  return !!STATE.isAdmin || (STATE.perms && STATE.perms.has(perm));
}

function _applyRoleGate() {
  // Esconde UI destructiva/de escritura segun rol. Se llama tras login y tras tab switch.
  const canWrite = !!STATE.canWrite;
  const up = document.getElementById("uploadDropdown");
  if (up) up.style.display = canWrite ? "" : "none";
  // Marcamos el body para usos via CSS si hace falta.
  document.body.classList.toggle("role-admin",  !!STATE.isAdmin);
  document.body.classList.toggle("role-kam",    STATE.userRole === "kam");
  document.body.classList.toggle("role-viewer", STATE.userRole === "viewer");
}

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    showApp(session.user);
  } else {
    showLoginScreen();
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN")        showApp(session.user);
    if (event === "TOKEN_REFRESHED")  _setRoleFromUser(session && session.user);
    if (event === "SIGNED_OUT")       showLoginScreen();
  });
}

async function handleLogin() {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl    = document.getElementById("loginError");
  const btn      = document.getElementById("loginBtn");

  errEl.textContent = "";
  if (!email || !password) { errEl.textContent = "Ingresa tu email y contraseña."; return; }

  btn.textContent = "Ingresando...";
  btn.disabled    = true;

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = "Credenciales incorrectas. Intenta de nuevo.";
    btn.textContent   = "Ingresar";
    btn.disabled      = false;
  }
}

async function handleLogout() {
  // Limpiamos STATE y caches sensibles ANTES de signOut para que el siguiente
  // usuario del navegador no vea data del anterior ni en memoria ni en LS.
  _clearStateAndLocalStorage();
  _appInitialized = false;
  await sb.auth.signOut();
}

function _clearStateAndLocalStorage() {
  // Drop de datos del dataset en memoria.
  ["rawData","rawDataMensual","rawDataMensualTuktuk","rawDataFleet","rawDataMensualFleet",
   "rawDataFull","rawDataMensualFull",
   "rawDataDiario","rawDataDiarioFull","rawDataTuktuk","metasData","proyectosData","seguimientoData",
   "fleetExterno","fleetExternoCols",
   "allDates","allPartners","curSummaries"
  ].forEach(k => { if (Array.isArray(STATE[k])) STATE[k].length = 0; });
  STATE.fleetExternoLoaded = false;
  STATE.fleetExternoError  = null;
  STATE.rendLine  = "agg";
  STATE.metasLine = "agg";
  STATE._tuktukMensualByCityDate = null;
  STATE._tuktukMensualPartners   = null;
  STATE._tuktukMensualDates      = null;
  STATE.CLID_MAP        = {};
  STATE.KAM_MAP         = {};
  STATE.KAM_PARTNERS    = {};
  STATE.partnerColors   = {};
  STATE._byPartner      = null;
  STATE._byCity         = null;
  STATE._byCityDate     = null;
  STATE._partnerKAM     = null;
  STATE._apdFull        = null;
  STATE._mensualLoaded  = false;
  STATE._diarioLoaded   = false;
  STATE.userRole        = null;
  STATE.isAdmin         = false;
  STATE.canWrite        = false;
  if (STATE.perms) STATE.perms = new Set();
  if (STATE.flotasMap) STATE.flotasMap = null;
  // Charts: destruir instancias para liberar memoria.
  if (STATE.charts) {
    Object.values(STATE.charts).forEach(c => { try { c && c.destroy && c.destroy(); } catch {} });
    STATE.charts = {};
  }
  // Sensibles en localStorage. yangoSidebarCollapsed se queda (UI pref, no sensible).
  try {
    localStorage.removeItem("yangoFilters");
    localStorage.removeItem("yangoDecline");
    localStorage.removeItem("yangoFleetExtConfig");
  } catch {}
}

function showLoginScreen() {
  document.getElementById("loginScreen").style.display    = "flex";
  document.getElementById("appContainer").style.display   = "none";
  document.getElementById("loginPassword").value          = "";
  document.getElementById("loginError").textContent       = "";
  // Aplica role-viewer al body para esconder UI destructiva incluso pre-login.
  STATE.isAdmin = false;
  STATE.userRole = null;
  STATE.canWrite = false;
  _applyRoleGate();
  setTimeout(() => document.getElementById("loginEmail").focus(), 100);
}

let _appInitialized = false;

function showApp(user) {
  document.getElementById("loginScreen").style.display  = "none";
  document.getElementById("appContainer").style.display = "flex";
  document.getElementById("userBadge").textContent      = user.email;

  _setRoleFromUser(user);

  if (!_appInitialized) {
    _appInitialized = true;
    initApp();
  }
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginPassword")
    ?.addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  document.getElementById("loginEmail")
    ?.addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("loginPassword").focus();
    });
  initAuth();
});
