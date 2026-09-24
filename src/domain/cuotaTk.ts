// Cuota TukTuk declarada (meta_tk_ad / meta_tk_nr / meta_tk_sh → m.mtkAD /
// mtkNR / mtkSH) — reglas puras para la pestaña Metas.
//
// La cuota TukTuk SOLO existe si el KAM declaró el "% TukTuk de PnL" al guardar
// en la Calculadora: es un DESGLOSE de la meta paraguas (mA/mNR/mH), no una meta
// aparte. Regla de Manuel: nunca estimarla por el peso natural cuando no se
// declaró. Por eso acá no se calcula ninguna cuota: solo se dice QUIÉN la
// declaró y se suman los valores guardados, tal cual.
//
// En producción es la excepción, no la regla (sep-2026: 3 de 94 filas, un solo
// KAM), así que la vista TukTuk tiene que decir de frente que la cobertura es
// parcial en vez de mostrar "sin meta" como si faltara un dato cualquiera.

/** Fila de metas con los campos que importan acá (los de STATE.metasData). */
export interface FilaCuotaTk {
  mtkAD?: number | null;
  mtkNR?: number | null;
  mtkSH?: number | null;
}

/** ¿La fila tiene la cuota TukTuk declarada? (cualquiera de AD / N+R / Horas). */
export function tieneCuotaTk(m: FilaCuotaTk | null | undefined): boolean {
  if (!m) return false;
  return m.mtkAD != null || m.mtkNR != null || m.mtkSH != null;
}

export interface CoberturaCuotaTk {
  /** KAMs con al menos una fila con cuota, ordenados. */
  declarados: string[];
  /** KAMs con metas en el mes y ninguna fila con cuota, ordenados. */
  sinDeclarar: string[];
  /** declarados + sinDeclarar. */
  total: number;
  /** true si todos los KAMs con metas la declararon (o no hay ninguno). */
  completa: boolean;
}

/**
 * Cobertura por KAM: un KAM "declaró" si CUALQUIERA de sus filas del mes tiene
 * cuota (la Calculadora solo escribe el desglose en las unidades con porción
 * TukTuk, así que un KAM que declaró tiene filas sin cuota igual).
 * `excluir`: claves que no son una persona (el bucket "No KAM").
 */
export function coberturaCuotaTk(
  filas: Array<{ kam: string; tieneCuota: boolean }>,
  excluir: string[] = []
): CoberturaCuotaTk {
  const porKam = new Map<string, boolean>();
  for (const f of filas) {
    const k = f.kam || "";
    if (!k || excluir.includes(k)) continue;
    porKam.set(k, (porKam.get(k) || false) || !!f.tieneCuota);
  }
  const orden = (a: string, b: string) => a.localeCompare(b);
  const declarados  = [...porKam].filter(([, v]) => v).map(([k]) => k).sort(orden);
  const sinDeclarar = [...porKam].filter(([, v]) => !v).map(([k]) => k).sort(orden);
  return { declarados, sinDeclarar, total: porKam.size, completa: sinDeclarar.length === 0 };
}

/**
 * Suma de cuotas guardadas de un grupo. null si NINGUNA fila la trae — así el
 * grupo sin cuota no muestra un "TukTuk: 0" que se leería como "la cuota es cero".
 * Un 0 guardado sí cuenta (es un valor declarado).
 */
export function sumaCuotaTk(valores: Array<number | null | undefined>): number | null {
  let s = 0, hay = false;
  for (const v of valores) {
    if (v == null || !isFinite(v)) continue;
    s += v; hay = true;
  }
  return hay ? s : null;
}
