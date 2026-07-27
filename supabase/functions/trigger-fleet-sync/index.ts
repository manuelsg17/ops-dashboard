// trigger-fleet-sync — Edge Function para el botón "Sincronizar ahora" de
// Fleet Externo (Configuración → Mantenimiento).
//
// POR QUÉ EXISTE: disparar un workflow_dispatch de GitHub Actions requiere un
// Personal Access Token de GitHub con permiso sobre el repo — esa credencial
// NO puede vivir en el frontend (público). Vive acá, en las env vars de la
// función, y el cliente solo pide "disparalo", nunca ve el token.
//
// El trabajo pesado (leer la base del colega, escribir fleetext_*) lo hace
// enteramente el workflow (.github/workflows/fleet-sync.yml) corriendo en
// GitHub — esta función NO toca ninguna base de datos de terceros, solo le
// avisa a GitHub "corré ahora" en vez de esperar al cron semanal.
//
// ── SEGURIDAD ────────────────────────────────────────────────────────────
// Mismo patrón que admin-users: verify_jwt=true de la plataforma solo
// garantiza un JWT válido (cualquier viewer pasaría). El chequeo de rol admin
// va ACÁ, validando con la anon key ANTES de usar el GITHUB_TOKEN.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://manuelsg17.github.io",
  "https://ops-dashboard-opsteam1.vercel.app",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(req) });

  const url     = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // ── 1. Validar QUIÉN llama, con SU token ──────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: { user }, error: authErr } = await asCaller.auth.getUser();
  if (authErr || !user) return json(req, { error: "No autenticado." }, 401);

  const callerRole = (user.app_metadata as Record<string, unknown> | null)?.role;
  if (callerRole !== "admin") {
    return json(req, { error: "Requiere rol admin." }, 403);
  }

  // ── 2. Disparar el workflow_dispatch de GitHub Actions ────────────────────
  const ghToken = Deno.env.get("GITHUB_PAT");
  const ghOwner = Deno.env.get("GITHUB_REPO_OWNER") || "manuelsg17";
  const ghRepo  = Deno.env.get("GITHUB_REPO_NAME")  || "ops-dashboard";
  if (!ghToken) return json(req, { error: "GITHUB_PAT no configurado en la función." }, 500);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/fleet-sync.yml/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ghToken}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({ ref: "main" })
      }
    );
    // GitHub responde 204 sin body si aceptó el dispatch.
    if (res.status !== 204) {
      const detail = await res.text().catch(() => "");
      return json(req, { error: `GitHub respondió ${res.status}: ${detail}` }, 502);
    }
    return json(req, { ok: true, message: "Sincronización disparada. Puede tardar unos minutos en aparecer en Actions." });
  } catch (e) {
    return json(req, { error: (e as Error).message || "Error al contactar GitHub." }, 500);
  }
});
