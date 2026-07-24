// admin-users — Edge Function para administrar usuarios (Track C1).
//
// POR QUÉ EXISTE: crear/invitar usuarios y cambiar su rol (app_metadata.role)
// requiere la Admin API de Supabase, que necesita la service_role key. Esa key
// da acceso TOTAL saltándose RLS, así que JAMÁS puede vivir en el frontend
// (que es público). Acá vive del lado del servidor, en las env vars de la
// función, y el cliente solo puede pedir acciones acotadas.
//
// Lo que NO pasa por acá: los grants de user_permissions y el mapeo
// partner_users se escriben con PostgREST normal desde el cliente — ya están
// protegidos por RLS admin-only y auditados por trigger. Acá solo lo que
// obliga la Admin API.
//
// ── SEGURIDAD ───────────────────────────────────────────────────────────────
// verify_jwt=true (config de la plataforma) SOLO garantiza que el JWT es
// válido — CUALQUIER usuario autenticado (un viewer, un partner externo)
// pasaría ese filtro. Por eso el chequeo real de rol admin va ACÁ ADENTRO,
// validando el token del llamante con la anon key ANTES de tocar el cliente
// service_role. Ese orden es el punto: primero verificar, después privilegiar.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ROLES_VALIDOS = ["admin", "kam", "viewer", "partner"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url     = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const svcKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── 1. Validar QUIÉN llama, con SU token (no con service_role) ────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: { user }, error: authErr } = await asCaller.auth.getUser();
  if (authErr || !user) return json({ error: "No autenticado." }, 401);

  const callerRole = (user.app_metadata as Record<string, unknown> | null)?.role;
  if (callerRole !== "admin") {
    return json({ error: "Requiere rol admin." }, 403);
  }

  // ── 2. Recién ahora, cliente privilegiado ─────────────────────────────────
  const admin = createClient(url, svcKey, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* sin body */ }
  const action = String(body.action || "");

  try {
    // ── LISTAR usuarios (lo único de auth.users que el cliente no puede leer)
    if (action === "list") {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      const users = (data?.users || []).map(u => ({
        id:    u.id,
        email: u.email,
        role:  (u.app_metadata as Record<string, unknown> | null)?.role ?? "viewer",
        lastSignInAt: u.last_sign_in_at,
        createdAt:    u.created_at
      }));
      return json({ users });
    }

    // ── INVITAR usuario nuevo + fijarle rol ──────────────────────────────────
    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const role  = String(body.role || "viewer");
      if (!email)                     return json({ error: "Falta email." }, 400);
      if (!ROLES_VALIDOS.includes(role)) return json({ error: `Rol inválido: ${role}` }, 400);

      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: {}
      });
      if (error) throw error;
      const newId = data?.user?.id;
      if (newId) {
        const { error: upErr } = await admin.auth.admin.updateUserById(newId, {
          app_metadata: { role }
        });
        if (upErr) throw upErr;
      }
      return json({ ok: true, userId: newId, email, role });
    }

    // ── CAMBIAR el rol de un usuario existente ───────────────────────────────
    if (action === "setRole") {
      const userId = String(body.userId || "");
      const role   = String(body.role || "");
      if (!userId)                       return json({ error: "Falta userId." }, 400);
      if (!ROLES_VALIDOS.includes(role)) return json({ error: `Rol inválido: ${role}` }, 400);
      // Guard anti-lockout: no permitir que un admin se quite a SÍ MISMO el rol
      // admin (se quedaría sin poder volver a entrar a administrar).
      if (userId === user.id && role !== "admin") {
        return json({ error: "No podés quitarte tu propio rol admin." }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: { role }
      });
      if (error) throw error;
      return json({ ok: true, userId, role });
    }

    // ── FORZAR logout (el rol se hornea en el JWT: sin re-login no aplica) ───
    if (action === "signOut") {
      const userId = String(body.userId || "");
      if (!userId) return json({ error: "Falta userId." }, 400);
      const { error } = await admin.auth.admin.signOut(userId, "global");
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    // Mensaje acotado: no filtrar internals de Supabase al cliente.
    return json({ error: (e as Error).message || "Error interno." }, 500);
  }
});
