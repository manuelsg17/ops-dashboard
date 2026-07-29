// ingest-taxiparks — Ingesta automática del reporte semanal de taxiparks.
//
// POR QUÉ EXISTE: hasta ahora el reporte se subía A MANO. Todo el parseo vivía
// en el navegador (Web Worker + XLSX + uploadRendimiento), así que no había
// forma de que una automatización lo cargara. Esta función es esa puerta: la
// tarea programada "Dashboard OPS" (proyecto kam-managment, martes 9am Lima)
// consulta DataLens y hace POST acá con las filas ya en JSON.
//
// EL PARSEO NO SE REIMPLEMENTA. `taxiparks.ts` es una COPIA EXACTA de
// src/domain/taxiparks.ts (la sincroniza `npm run sync:ingest` y el CI falla si
// difieren). Ese archivo es el mismo que usa el navegador: el mapeo de las 50
// measures y la expansión de K/M/B existen UNA sola vez, así que el mismo
// reporte entra idéntico venga por donde venga.
//
// ── SEGURIDAD ───────────────────────────────────────────────────────────────
// verify_jwt está en FALSE, a diferencia de admin-users y trigger-fleet-sync:
// quien llama NO es un usuario de Supabase sino una máquina, así que no tiene
// JWT. La contrapartida es que este endpoint es alcanzable por cualquiera, y
// por eso:
//   · Lo PRIMERO que se hace es validar el bearer contra INGEST_TOKEN.
//   · La comparación es de tiempo constante (no `===`), para no filtrar el
//     prefijo correcto midiendo cuánto tarda en responder.
//   · Sin INGEST_TOKEN configurado la función NO abre: responde 500. Un
//     "si no hay token, dejá pasar" convertiría un despiste de configuración en
//     una escritura abierta a la base de producción.
//   · Recién después de validar se instancia el cliente service_role.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseTaxiparksWide } from "./taxiparks.ts";

// Escala → tabla destino, columna de fecha y clave del upsert. El upsert usa la
// UNIQUE real de cada tabla, así que re-ingerir el mismo período ACTUALIZA en
// vez de duplicar: la tarea puede correr dos veces sin ensuciar nada.
const ESCALAS: Record<string, { tabla: string; dateField: string; onConflict: string }> = {
  semanal: { tabla: "rendimiento",          dateField: "fecha", onConflict: "clid,city,fecha,db_id" },
  mensual: { tabla: "rendimiento_mensual",  dateField: "mes",   onConflict: "clid,city,mes,db_id"   },
  diario:  { tabla: "rendimiento_diario",   dateField: "date",  onConflict: "clid,city,date,db_id"  }
};

const MAX_FILAS = 20000;   // el reporte real ronda las 300; esto es un tope de cordura

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Comparación de tiempo constante. Un `a === b` corta en el primer byte
// distinto, y midiendo la latencia se puede adivinar el token carácter a
// carácter. Acá siempre se recorre todo.
function tokenValido(recibido: string, esperado: string): boolean {
  if (recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < recibido.length; i++) {
    dif |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return dif === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Solo POST." }, 405);

  // ── 1. Autenticación de máquina ─────────────────────────────────────────
  const esperado = Deno.env.get("INGEST_TOKEN");
  if (!esperado) {
    return json({ error: "INGEST_TOKEN no configurado en la función." }, 500);
  }
  const auth = req.headers.get("Authorization") ?? "";
  const recibido = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!recibido || !tokenValido(recibido, esperado)) {
    return json({ error: "No autorizado." }, 401);
  }

  // ── 2. Validación del cuerpo ────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: "Cuerpo JSON inválido." }, 400);
  }

  const escala = String(body.scale || "semanal");
  const cfg = ESCALAS[escala];
  if (!cfg) {
    return json({ error: `Escala inválida: ${escala}. Usá semanal | mensual | diario.` }, 400);
  }

  const rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) {
    return json({ error: "Falta `rows` (array de filas del reporte en formato wide)." }, 400);
  }
  if (rows.length > MAX_FILAS) {
    return json({ error: `Demasiadas filas (${rows.length}). Máximo ${MAX_FILAS}.` }, 413);
  }

  // ── 3. Parseo con el MISMO código que el navegador ──────────────────────
  const avisos = new Set<string>();
  let flat: Record<string, unknown>[];
  try {
    flat = parseTaxiparksWide(rows, {
      dateField: cfg.dateField,
      // El KAM no se resuelve acá: la app lo toma de `partners` al leer, así que
      // mandarlo vacío es correcto y evita depender de un mapa desactualizado.
      kamOf: () => "",
      onWarn: (label: string) => avisos.add(label)
    });
  } catch (e) {
    return json({ error: `No se pudo parsear el reporte: ${(e as Error).message}` }, 422);
  }

  // ── 4. Recién ahora, cliente privilegiado ───────────────────────────────
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const periodos = [...new Set(flat.map(r => String(r[cfg.dateField])))].sort();
  try {
    for (let i = 0; i < flat.length; i += 500) {
      const { error } = await admin
        .from(cfg.tabla)
        .upsert(flat.slice(i, i + 500), { onConflict: cfg.onConflict });
      if (error) throw error;
    }
  } catch (e) {
    return json({ error: `Error al escribir en ${cfg.tabla}: ${(e as Error).message}` }, 500);
  }

  return json({
    ok: true,
    escala,
    tabla: cfg.tabla,
    filas_recibidas: rows.length,
    filas_escritas: flat.length,
    periodos,
    // Measures que no se pudieron parsear. Van en la respuesta para que la
    // tarea que llama pueda avisar en vez de que se pierdan en silencio.
    avisos_de_parseo: [...avisos]
  });
});
