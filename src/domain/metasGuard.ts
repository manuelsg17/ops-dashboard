// Validación de las filas de metas ANTES de escribirlas.
//
// POR QUÉ EXISTE ESTE ARCHIVO: el 13-ago-2026 la Calculadora guardó 14 filas de
// AGOSTO en 0 y borró metas reales (AD 4.791 → 0, SH 247.084 → 0). Se
// recuperaron del audit_log. La causa fue que `CALC_STATE.kamGoals` arranca en
// {ad:0, sh:0, nr:0} y solo se llena cuando el usuario escribe: guardar antes de
// cargar los objetivos escribía ceros sobre lo que ya existía, sin ninguna
// validación de por medio.
//
// Vive en `domain/` y es PURO (no lee STATE, no toca el DOM) justamente para que
// se pueda testear. Ese fue el hueco real: los 47 tests del proyecto cubrían el
// cálculo de métricas, pero la ÚNICA acción destructiva de la app no tenía
// ninguno.
//
// El upsert de metas escribe SIEMPRE las tres columnas del agregador, así que una
// meta ausente no se "omite": se guarda como 0 y pisa la que había. Por eso se
// valida cada métrica por separado y no solo el caso "todo en cero".

export interface MetaRow {
  meta_active_drivers?: number | string | null;
  meta_supply_hours?:   number | string | null;
  meta_nr?:             number | string | null;
  [k: string]: unknown;
}

export interface MetasCheck {
  ok: boolean;
  /** Nombres legibles de las métricas cuyo TOTAL da 0. Vacío si todo bien. */
  faltantes: string[];
  totales: { ad: number; sh: number; nr: number };
}

const _num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Se mira el TOTAL de la cartera, no fila por fila: que UN partner tenga meta 0
 * puede ser legítimo (un negocio que se frena), pero que la suma de TODO el KAM
 * dé 0 no lo es nunca — significa que no se cargaron los objetivos.
 */
export function validarMetas(rows: MetaRow[] | null | undefined): MetasCheck {
  const list = rows || [];
  const totales = {
    ad: list.reduce((s, r) => s + _num(r.meta_active_drivers), 0),
    sh: list.reduce((s, r) => s + _num(r.meta_supply_hours),   0),
    nr: list.reduce((s, r) => s + _num(r.meta_nr),             0)
  };
  const faltantes = ([
    ["Active Drivers", totales.ad],
    ["Supply Hours",   totales.sh],
    ["N+R",            totales.nr]
  ] as [string, number][]).filter(([, v]) => !v).map(([n]) => n);

  // Sin filas NO es un error de este validador: calcSaveMetas ya corta antes con
  // su propio mensaje ("No hay metas para guardar en este KAM"). Devolver
  // faltantes acá solo duplicaría el aviso con peor texto.
  if (!list.length) return { ok: true, faltantes: [], totales };

  return { ok: !faltantes.length, faltantes, totales };
}

/** Mensaje al usuario. Separado de la validación para poder testear ambos. */
export function mensajeMetasInvalidas(faltantes: string[]): string {
  return `No se guardó nada: la meta de ${faltantes.join(" y ")} da 0.\n\n` +
    "Causa habitual: no cargaste los objetivos del KAM arriba (arrancan en 0), " +
    "o saliste del campo sin que se aplicara el valor.\n\n" +
    "Se frenó a propósito: guardar así BORRARÍA las metas que ya tienes de ese mes.";
}
