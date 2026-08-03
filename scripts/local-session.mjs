#!/usr/bin/env node
// ============================================================
// local-session.mjs — abre sesion en el Supabase LOCAL sin tipear la password
// ============================================================
//   node scripts/local-session.mjs admin|kam|viewer|partner
//
// Imprime un snippet JS para pegar en la consola del navegador con la app
// abierta. Equivale a loguearse, pero por la API en vez del formulario.
//
// POR QUE EXISTE: la regla del proyecto (CLAUDE.md) es que un agente no tipea
// contraseñas en formularios, ni siquiera locales. Sin esto, toda vista
// autenticada queda fuera de alcance y el entorno local sirve solo a medias.
// Acá no hay secreto que proteger: la password es un valor de juguete que vive
// en texto plano en supabase/seed.sql, sobre una base descartable.
//
// El token sale del MISMO endpoint que usa el formulario y lleva el mismo
// claim `app_metadata.role`, asi que la app recorre su camino real de
// autorizacion (is_admin / is_kam_or_admin / is_partner + RLS). No es un
// bypass: un rol mal configurado falla acá igual que en produccion.
// ============================================================

const API  = process.env.LOCAL_SUPABASE_URL || "http://127.0.0.1:54331";
const PASS = "local-dev-1234";                       // ver supabase/seed.sql
const ROLES = ["admin", "kam", "viewer", "partner"];

const rol = (process.argv[2] || "admin").toLowerCase();
if (!ROLES.includes(rol)) {
  console.error(`Rol invalido: "${rol}". Opciones: ${ROLES.join(" | ")}`);
  process.exit(1);
}

// El anon key local es fijo (lo deriva el CLI del JWT_SECRET de demo, que es el
// mismo en todas las instalaciones). Se puede pisar por env si algun dia cambia.
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9." +
  "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

let res;
try {
  res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method:  "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body:    JSON.stringify({ email: `${rol}@local.test`, password: PASS }),
  });
} catch {
  console.error(`No hay nadie escuchando en ${API}.\n` +
                `Levantar el stack con:  npx supabase start`);
  process.exit(1);
}

const data = await res.json();

if (!data.access_token) {
  const msg = data.error_description || data.msg || JSON.stringify(data);
  console.error(`Login rechazado para ${rol}@local.test: ${msg}\n`);
  if (/querying schema/i.test(msg)) {
    // Falla con un mensaje que no dice nada de la causa real. Ver local-dev.md.
    console.error("Sintoma conocido: alguna columna *_token de auth.users quedo\n" +
                  "en NULL y gotrue las escanea a string. Arregla:  npx supabase db reset");
  } else {
    console.error("Si los usuarios no existen todavia:  npx supabase db reset");
  }
  process.exit(1);
}

const sesion = {
  access_token:  data.access_token,
  refresh_token: data.refresh_token,
};

console.log(`\n# Sesion de ${rol}@local.test (rol: ${data.user?.app_metadata?.role})`);
console.log(`# Pegar en la consola del navegador con la app abierta, y recargar.\n`);
console.log(
  `window.sb.auth.setSession(${JSON.stringify(sesion)})` +
  `.then(r => console.log(r.error ? "ERROR: " + r.error.message ` +
  `: "sesion OK: " + r.data.user.email))\n`
);
