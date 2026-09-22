// ─────────────────────────────────────────────────────────────────────────────
// DESGLOSE TUKTUK AL GUARDAR: ¿qué se BORRA y qué se REESCRIBE de lo ya guardado?
//
// POR QUÉ EXISTE ESTE ARCHIVO. `meta_tk_ad/_nr/_sh` es el DESGLOSE TukTuk de la
// meta paraguas (ver repartoLinea.ts y el comentario de `_calcBuildMetaRows`).
// Solo se escribe cuando el KAM declaró un % de TukTuk. Hasta sep-2026 el merge
// `{...existente, ...nuevo}` de `calcSaveMetas` CONSERVABA el desglose viejo
// cuando la fila nueva no traía esas columnas — a propósito, para no perder
// histórico. El hueco: un KAM declara el %, guarda, lo vuelve a 0 y guarda de
// nuevo → el desglose viejo quedaba en la base, desalineado de la meta nueva.
//
// DECISIÓN DE MANUEL (textual): "mostrar un mensaje de alerta que esa opción
// borrará o reescribirá lo anterior guardado y pedir confirmación". Acá vive la
// REGLA (qué columnas cambian respecto de la base); calculator.ts solo hace el
// I/O (leer la base, el confirm(), el upsert).
//
// ALCANCE — una columna de desglose entra en juego SOLO si la fila que se va a
// escribir trae su total paraguas (meta_tk_ad ↔ meta_active_drivers, etc.):
//  - "Reparto completo": las filas del agregador traen los tres totales → los
//    tres desgloses quedan alineados con lo que el KAM ve.
//  - "Solo lo que cambié": solo el total que se tecleó viaja → solo SU desglose
//    se toca. El de un total que no se reescribe tampoco se reescribe: partiría
//    un número que no es el que queda en la base.
//  - Una fila Fleet sin totales del agregador no toca ningún desglose.
//
// NULL ≠ 0. Un 0 guardado es un valor DECLARADO (no "vacío"): borrarlo es un
// cambio y se avisa. Un NULL guardado no tiene nada que perder.
//
// PURO: sin STATE, sin DOM, sin imports (mismo patrón que metasGuard/calcDraft).
// ─────────────────────────────────────────────────────────────────────────────

export type TkCol = "meta_tk_ad" | "meta_tk_nr" | "meta_tk_sh";

/** Desglose → su total paraguas. El desglose solo se toca si viaja su total. */
export const TK_PARAGUAS: Record<TkCol, string> = {
  meta_tk_ad: "meta_active_drivers",
  meta_tk_nr: "meta_nr",
  meta_tk_sh: "meta_supply_hours"
};
const TK_COLS = Object.keys(TK_PARAGUAS) as TkCol[];

const TK_LABEL: Record<TkCol, string> = {
  meta_tk_ad: "AD", meta_tk_nr: "N+R", meta_tk_sh: "SH"
};

export interface FilaMeta {
  clid: string;
  city: string;
  partner?: string;
  [k: string]: unknown;
}

export interface DetalleTk {
  col: TkCol;
  viejo: number;          // siempre había algo (null no se puede borrar ni reescribir)
  nuevo: number | null;   // null = queda vacío
}
export interface FilaCambioTk {
  clave: string;
  clid: string;
  city: string;
  partner: string;
  cambios: DetalleTk[];
}
export interface CambiosTk {
  /** Filas con algún desglose que pasa de un valor a vacío. */
  borrar: FilaCambioTk[];
  /** Filas con algún desglose que pasa de un valor a OTRO valor. */
  reescribir: FilaCambioTk[];
  /** Partner-ciudad distintos afectados (una fila puede estar en las dos listas). */
  afectadas: number;
  /**
   * Valor FINAL de cada desglose en alcance, por fila (clave). El llamador lo
   * aplica sobre el merge para que la base quede igual a lo que el KAM ve —
   * incluido NULL explícito donde antes el merge conservaba el valor viejo.
   */
  aplicar: Map<string, Partial<Record<TkCol, number | null>>>;
}

/** Clave de fila: MISMA convención que el `exMap` de calcSaveMetas. */
export function claveFila(clid: string, city: string): string {
  return `${clid}|||${city}`;
}

const _num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Compara el desglose TukTuk que se va a escribir contra el que ya está en la base.
 *
 * @param filas      Filas que se van a escribir. `meta_tk_*` ausente = el reparto
 *                   actual no le asigna porción TukTuk (queda vacío).
 * @param existentes Filas ya guardadas, por `claveFila(clid, city)`.
 * @param hayPctDeclarado Sin % declarado no hay desglose que escribir: todo lo
 *                   que esté en alcance queda NULL, venga lo que venga en la fila.
 */
export function detectarCambiosTk(
  filas: FilaMeta[] | null | undefined,
  existentes: Map<string, Record<string, unknown>>,
  hayPctDeclarado: boolean
): CambiosTk {
  const borrar: FilaCambioTk[] = [];
  const reescribir: FilaCambioTk[] = [];
  const aplicar = new Map<string, Partial<Record<TkCol, number | null>>>();
  const tocadas = new Set<string>();

  (filas || []).forEach(f => {
    const clave = claveFila(f.clid, f.city);
    const ex = existentes.get(clave);
    const enAlcance = TK_COLS.filter(c => f[TK_PARAGUAS[c]] !== undefined);
    if (!enAlcance.length) return;

    const valores: Partial<Record<TkCol, number | null>> = {};
    const b: DetalleTk[] = [];
    const r: DetalleTk[] = [];
    enAlcance.forEach(col => {
      const nuevo = hayPctDeclarado ? _num(f[col]) : null;
      valores[col] = nuevo;
      const viejo = ex ? _num(ex[col]) : null;
      if (viejo === null) return;              // nada guardado → nada que perder
      if (nuevo === null) b.push({ col, viejo, nuevo });
      else if (nuevo !== viejo) r.push({ col, viejo, nuevo });
    });
    aplicar.set(clave, valores);

    const base = { clave, clid: f.clid, city: f.city, partner: String(f.partner ?? f.clid) };
    if (b.length) borrar.push({ ...base, cambios: b });
    if (r.length) reescribir.push({ ...base, cambios: r });
    if (b.length || r.length) tocadas.add(clave);
  });

  return { borrar, reescribir, afectadas: tocadas.size, aplicar };
}

/** ¿Hay que pedir confirmación? Sin borrados ni reescrituras no se agrega ruido. */
export function hayCambiosTk(c: CambiosTk): boolean {
  return c.borrar.length > 0 || c.reescribir.length > 0;
}

const MAX_EJEMPLOS = 8;

/**
 * Texto del confirm(). Separado de la detección para poder testear los dos.
 * `fmtNum` lo pasa el llamador (el `fmt` de la app) — este módulo no importa nada.
 */
export function mensajeCambiosTk(
  c: CambiosTk,
  ctx: { kam: string; mes: string; anio: number | string | null; hayPctDeclarado: boolean },
  fmtNum: (n: number) => string = n => String(n)
): string {
  // Presupuesto compartido de ~8 ejemplos: si las dos listas tienen, se reparten;
  // si una tiene pocos, la otra usa lo que sobra.
  const nB = Math.min(c.borrar.length, MAX_EJEMPLOS - Math.min(c.reescribir.length, MAX_EJEMPLOS / 2));
  const nR = Math.min(c.reescribir.length, MAX_EJEMPLOS - nB);
  const linea = (f: FilaCambioTk) => `• ${f.partner} · ${f.city} · ` + f.cambios
    .map(d => `${TK_LABEL[d.col]} TukTuk ${fmtNum(d.viejo)} → ${d.nuevo === null ? "vacío" : fmtNum(d.nuevo)}`)
    .join(" · ");
  const bloque = (lista: FilaCambioTk[], n: number) =>
    lista.slice(0, n).map(linea).join("\n") +
    (lista.length > n ? `\n…y ${lista.length - n} más` : "");

  let txt =
    `⚠️ Este guardado BORRA o REESCRIBE el desglose TukTuk que ya estaba guardado\n` +
    `${ctx.kam} · ${ctx.mes}${ctx.anio != null ? " " + ctx.anio : ""} · ` +
    `${c.afectadas} partner-ciudad afectado(s)\n`;
  if (c.borrar.length) {
    txt += `\nSe BORRAN (${c.borrar.length}) — ` +
      (ctx.hayPctDeclarado
        ? `en el reparto actual no tienen porción TukTuk:\n`
        : `no hay % de TukTuk declarado, así que el desglose anterior ya no corresponde a la meta:\n`) +
      bloque(c.borrar, nB) + "\n";
  }
  if (c.reescribir.length) {
    txt += `\nSe REESCRIBEN (${c.reescribir.length}) — el % declarado da un valor distinto al guardado:\n` +
      bloque(c.reescribir, nR) + "\n";
  }
  txt += `\nSi cancelas, NO se guarda NADA (ni las metas ni el desglose).\n` +
    `¿Confirmar y guardar?`;
  return txt;
}
