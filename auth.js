// auth.js — Autenticación con Supabase Auth

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    showApp(session.user);
  } else {
    showLoginScreen();
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN")  showApp(session.user);
    if (event === "SIGNED_OUT") showLoginScreen();
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
  _appInitialized = false;
  await sb.auth.signOut();
}
function showLoginScreen() {
  document.getElementById("loginScreen").style.display    = "flex";
  document.getElementById("appContainer").style.display   = "none";
  document.getElementById("loginPassword").value          = "";
  document.getElementById("loginError").textContent       = "";
  setTimeout(() => document.getElementById("loginEmail").focus(), 100);
}

let _appInitialized = false;

function showApp(user) {
  document.getElementById("loginScreen").style.display  = "none";
  document.getElementById("appContainer").style.display = "flex";
  document.getElementById("userBadge").textContent      = user.email;
  
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
