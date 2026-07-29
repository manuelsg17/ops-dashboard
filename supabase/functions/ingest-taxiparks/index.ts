// ingest-taxiparks — Ingesta automática del reporte de taxiparks.
//
// POR QUÉ EXISTE: hasta ahora el reporte se subía A MANO. Todo el parseo vivía
// en el navegador (Web Worker + XLSX + uploadRendimiento), así que no había
// forma de que una automatización lo cargara. Esta función es esa puerta: la
// tarea programada "Dashboard OPS" (proyecto kam-managment, martes 9am Lima)
// consulta DataLens y hace POST acá con las filas ya en JSON.
//
// EL PARSEO NO SE REIMPLEMENTA. `taxiparks.ts` es una COPIA EXACTA de
// src/domain/taxiparks.ts (la sincroniza `npm run sync:ingest` y el CI falla si
// difieren). Es el mismo archivo que usa el navegador: el mapeo de las 50
// measures y la expansión de K/M/B existen UNA sola vez, así que el mismo
// reporte entra idéntico venga por donde venga. Hay un test que verifica que
// los formatos wide y long dan exactamente el mismo resultado.
//
// ── MODELO DE AMENAZA ───────────────────────────────────────────────────────
// verify_jwt está en FALSE, a diferencia de admin-users y trigger-fleet-sync:
// quien llama NO es un usuario de Supabase sino una máquina, así que no tiene
// JWT. Eso deja el endpoint alcanzable por cualquiera en internet, y de ahí
// cada defensa de abajo:
//
//   Amenaza                        Defensa
//   ─────────────────────────────  ────────────────────────────────────────────
//   Fuerza bruta del token         Comparación de TIEMPO CONSTANTE. Un `===`
//                                  corta en el primer byte distinto y permite
//                                  adivinar el token midiendo la latencia.
//   Config incompleta              Sin INGEST_TOKEN responde 500 y NO escribe.
//                                  Nunca "si no hay token, dejá pasar".
//   Agotar memoria                 Se rechaza por Content-Length ANTES de leer
//                                  el cuerpo. `await req.json()` de 500MB mata
//                                  el worker.
//   Ingesta infinita / martilleo   Ventana mínima entre ingestas exitosas de la
//                                  misma escala (MIN_INTERVALO_MS). Una tarea
//                                  semanal no tiene por qué correr 2 veces por
//                                  minuto.
//   Volumen absurdo                Tope de filas y de períodos distintos.
//   Envenenar el histórico         Las fechas fuera de una ventana razonable se
//                                  rechazan: nadie escribe el año 3000 ni 2010.
//   Inyectar columnas              El parser SOLO mapea measures conocidas; las
//                                  claves desconocidas se descartan (con test).
//   Borrado de datos               Solo hay UPSERT. Esta función no puede
//                                  borrar ni leer nada de otras tablas.
//
// Todo intento —exitoso, rechazado o fallido— queda en `ingest_log`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseTaxiparksWide, parseTaxiparksLong, coberturaKpis,
         adaptarEsquema, detectarTasasEnPorcentaje } from "./taxiparks.ts";

const ESCALAS: Record<string, { tabla: string; dateField: string; onConflict: string }> = {
  semanal: { tabla: "rendimiento",         dateField: "fecha", onConflict: "clid,city,fecha,db_id" },
  mensual: { tabla: "rendimiento_mensual", dateField: "mes",   onConflict: "clid,city,mes,db_id"   },
  diario:  { tabla: "rendimiento_diario",  dateField: "date",  onConflict: "clid,city,date,db_id"  }
};

const MAX_BYTES       = 8 * 1024 * 1024;  // el reporte real pesa ~2 MB
const MAX_FILAS       = 20000;            // ronda las 300
const MAX_PERIODOS    = 400;              // ~1 año de datos diarios
const MIN_INTERVALO_MS = 60_000;          // una tarea semanal no corre 2 veces por minuto
const ANIOS_ATRAS     = 3;
const DIAS_ADELANTE    = 7;               // margen por zonas horarias

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" }
  });
}

// Comparación de tiempo constante: siempre recorre todo, sin cortar al primer
// byte distinto.
function tokenValido(recibido: string, esperado: string): boolean {
  if (recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < recibido.length; i++) dif |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return dif === 0;
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Bitácora. Se llama en TODOS los caminos de salida —incluidos los rechazos—
  // para que un intento fallido no desaparezca sin dejar rastro.
  let escala = "?", formato = "?", origen = "";
  const bitacora = async (status: string, extra: Record<string, unknown> = {}) => {
    try {
      await admin.from("ingest_log").insert({
        scale: escala, tabla: ESCALAS[escala]?.tabla ?? "?", status,
        formato, origen, duracion_ms: Date.now() - t0, ...extra
      });
    } catch (_) { /* la bitácora nunca debe tumbar la ingesta */ }
  };

  if (req.method !== "POST") return json({ error: "Solo POST." }, 405);

  // ── 1. Autenticación ────────────────────────────────────────────────────
  const esperado = Deno.env.get("INGEST_TOKEN");
  if (!esperado) {
    await bitacora("error", { error: "INGEST_TOKEN no configurado" });
    return json({ error: "INGEST_TOKEN no configurado en la función." }, 500);
  }
  const auth = req.headers.get("Authorization") ?? "";
  const recibido = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!recibido || !tokenValido(recibido, esperado)) {
    // No se escribe bitácora en el 401 a propósito: si no, cualquiera puede
    // llenar la tabla sin autenticarse — el propio registro sería el vector.
    return json({ error: "No autorizado." }, 401);
  }

  // ── 2. Tamaño, antes de leer el cuerpo ──────────────────────────────────
  const largo = Number(req.headers.get("content-length") || 0);
  if (largo > MAX_BYTES) {
    await bitacora("rechazado", { error: `Cuerpo de ${largo} bytes (máx ${MAX_BYTES})` });
    return json({ error: `Cuerpo demasiado grande: ${largo} bytes. Máximo ${MAX_BYTES}.` }, 413);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch (_) {
    await bitacora("rechazado", { error: "JSON inválido" });
    return json({ error: "Cuerpo JSON inválido." }, 400);
  }

  escala = String(body.scale || "semanal");
  origen = String(body.source || "").slice(0, 120);
  const cfg = ESCALAS[escala];
  if (!cfg) {
    await bitacora("rechazado", { error: `Escala inválida: ${escala}` });
    return json({ error: `Escala inválida: ${escala}. Usá semanal | mensual | diario.` }, 400);
  }

  // ── 3. Ventana mínima entre ingestas ────────────────────────────────────
  // Con `dry_run` no se aplica: probar no debería quedar bloqueado.
  const dryRun = body.dry_run === true;
  if (!dryRun) {
    const desde = new Date(Date.now() - MIN_INTERVALO_MS).toISOString();
    const { data: recientes } = await admin.from("ingest_log")
      .select("at").eq("scale", escala).eq("status", "ok").gte("at", desde).limit(1);
    if (recientes && recientes.length) {
      await bitacora("rechazado", { error: "Ventana mínima entre ingestas" });
      return json({
        error: `Ya hubo una ingesta ${escala} exitosa hace menos de ${MIN_INTERVALO_MS / 1000}s. ` +
               `Si es intencional, esperá; si estás probando, usá "dry_run": true.`
      }, 429);
    }
  }

  // ── 4. Forma del cuerpo ─────────────────────────────────────────────────
  // `records` (long) es el formato recomendado; `rows` (wide) se acepta porque
  // es lo que sale nativo de DataLens y lo que usa la subida manual del Excel.
  const records = body.records;
  const rows    = body.rows;
  const entrada = Array.isArray(records) ? records : Array.isArray(rows) ? rows : null;
  formato = Array.isArray(records) ? "long" : Array.isArray(rows) ? "wide" : "?";
  if (!entrada || !entrada.length) {
    await bitacora("rechazado", { error: "Sin records ni rows" });
    return json({ error: 'Falta `records` (formato long, recomendado) o `rows` (formato wide).' }, 400);
  }
  if (entrada.length > MAX_FILAS) {
    await bitacora("rechazado", { error: `${entrada.length} filas (máx ${MAX_FILAS})`, filas_recibidas: entrada.length });
    return json({ error: `Demasiadas filas (${entrada.length}). Máximo ${MAX_FILAS}.` }, 413);
  }

  // ── 5. Parseo con el MISMO código que el navegador ──────────────────────
  const avisos = new Set<string>();
  let flat: Record<string, unknown>[];
  try {
    const opts = {
      dateField: cfg.dateField,
      // El KAM no se resuelve acá: la app lo toma de `partners` al leer, así que
      // mandarlo vacío evita depender de un mapa desactualizado.
      kamOf: () => "",
      onWarn: (l: string) => avisos.add(l)
    };
    flat = formato === "long" ? parseTaxiparksLong(entrada, opts) : parseTaxiparksWide(entrada, opts);
  } catch (e) {
    await bitacora("error", { error: `Parseo: ${(e as Error).message}`, filas_recibidas: entrada.length });
    return json({ error: `No se pudo parsear el reporte: ${(e as Error).message}` }, 422);
  }

  // ── 6. Sanidad de las fechas ────────────────────────────────────────────
  const periodos = [...new Set(flat.map(r => String(r[cfg.dateField])))].sort();
  if (periodos.length > MAX_PERIODOS) {
    await bitacora("rechazado", { error: `${periodos.length} períodos (máx ${MAX_PERIODOS})`, filas_recibidas: entrada.length });
    return json({ error: `Demasiados períodos distintos (${periodos.length}). Máximo ${MAX_PERIODOS}.` }, 413);
  }
  const hoy = new Date();
  const min = new Date(hoy); min.setFullYear(min.getFullYear() - ANIOS_ATRAS);
  const max = new Date(hoy); max.setDate(max.getDate() + DIAS_ADELANTE);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fueraDeRango = periodos.filter(p => {
    const d = p.length === 7 ? p + "-01" : p;   // mensual llega como YYYY-MM
    return d < iso(min) || d > iso(max);
  });
  if (fueraDeRango.length) {
    await bitacora("rechazado", { error: `Fechas fuera de rango: ${fueraDeRango.slice(0, 5).join(", ")}`, periodos, filas_recibidas: entrada.length });
    return json({
      error: `Períodos fuera de la ventana permitida (${iso(min)} … ${iso(max)}): ` +
             fueraDeRango.slice(0, 5).join(", ")
    }, 422);
  }

  const cob = coberturaKpis(flat);

  // Aviso de escala: si las tasas llegan en 0-100 en vez de 0-1, los calculos
  // del dashboard dan valores x100. No se corrige solo (ver el comentario en
  // detectarTasasEnPorcentaje) — se avisa y la corrida queda marcada.
  const tasasSospechosas = detectarTasasEnPorcentaje(flat);
  if (tasasSospechosas.length) {
    avisos.add(`Tasas en escala 0-100 (se esperan 0-1): ${tasasSospechosas.join(", ")}. ` +
               `Mandalas como fraccion, o con el simbolo % ("91.45%").`);
  }

  // El esquema de rendimiento_diario NO tiene partner/kam y usa
  // new_partner/new_service. Traducir antes de escribir.
  flat = adaptarEsquema(flat, escala);

  // ── 7. dry_run: valida y reporta, sin escribir ──────────────────────────
  const resumen = {
    ok: true, escala, formato, tabla: cfg.tabla,
    filas_recibidas: entrada.length, filas_escritas: flat.length,
    periodos,
    kpis: { esperados: cob.total, con_datos: cob.ok, faltantes: cob.faltantes },
    avisos_de_parseo: [...avisos]
  };
  if (dryRun) {
    await bitacora("ok", {
      filas_recibidas: entrada.length, filas_escritas: 0, periodos,
      kpis_ok: cob.ok, kpis_faltantes: cob.faltantes, avisos: [...avisos],
      error: "dry_run (no se escribió)"
    });
    return json({ ...resumen, dry_run: true, filas_escritas: 0 });
  }

  // ── 8. Escritura ────────────────────────────────────────────────────────
  try {
    for (let i = 0; i < flat.length; i += 500) {
      const { error } = await admin.from(cfg.tabla)
        .upsert(flat.slice(i, i + 500), { onConflict: cfg.onConflict });
      if (error) throw error;
    }
  } catch (e) {
    await bitacora("error", {
      error: `Escritura en ${cfg.tabla}: ${(e as Error).message}`,
      filas_recibidas: entrada.length, periodos
    });
    return json({ error: `Error al escribir en ${cfg.tabla}: ${(e as Error).message}` }, 500);
  }

  await bitacora("ok", {
    filas_recibidas: entrada.length, filas_escritas: flat.length, periodos,
    kpis_ok: cob.ok, kpis_faltantes: cob.faltantes, avisos: [...avisos]
  });
  return json(resumen);
});
