// domain/tableroSeg.ts — Reglas del tablero de Seguimiento (tipo Trello, 1-oct-2026).
// Puro: sin STATE ni DOM. Lo usa seguimiento.ts.

export type ListaSeg = "pendiente" | "en_curso" | "bloqueado" | "hecho";
export const LISTAS_SEG: ListaSeg[] = ["pendiente", "en_curso", "bloqueado", "hecho"];

export interface TarjetaOrden { id: string; status: string; sort_order: number | null }
export interface CambioOrden { id: string; status: ListaSeg; sort_order: number }

/** Tarjetas de una lista en su orden (sort_order; empate → como vienen). */
export function ordenLista<T extends TarjetaOrden>(cards: T[], lista: string): T[] {
  return cards.map((c, i) => ({ c, i }))
    .filter(x => (x.c.status || "pendiente") === lista)
    .sort((a, b) => (a.c.sort_order ?? 0) - (b.c.sort_order ?? 0) || a.i - b.i)
    .map(x => x.c);
}

/**
 * Mover `id` a `destino`, delante de `antesDe` (o al final si es null/no está).
 * Devuelve SOLO las filas cuyo status o sort_order cambian (lo que hay que
 * escribir en la base). La lista destino queda numerada 0..n-1.
 */
export function moverTarjeta(cards: TarjetaOrden[], id: string, destino: ListaSeg, antesDe: string | null): CambioOrden[] {
  const mov = cards.find(c => c.id === id);
  if (!mov) return [];
  const resto = ordenLista(cards.filter(c => c.id !== id), destino);
  let i = antesDe ? resto.findIndex(c => c.id === antesDe) : -1;
  if (i < 0) i = resto.length;
  const nueva = [...resto.slice(0, i), mov, ...resto.slice(i)];
  const out: CambioOrden[] = [];
  nueva.forEach((c, n) => {
    if ((c.status || "pendiente") !== destino || (c.sort_order ?? -1) !== n) out.push({ id: c.id, status: destino, sort_order: n });
  });
  return out;
}

/** Orden para una tarjeta nueva al final de la lista. */
export function ordenAlFinal(cards: TarjetaOrden[], lista: string): number {
  const l = ordenLista(cards, lista);
  return l.length ? Math.max(...l.map(c => c.sort_order ?? 0)) + 1 : 0;
}

/** Vencida = tiene fecha de fin anterior a hoy y no está hecha. Fechas "YYYY-MM-DD". */
export function vencida(r: { status?: string; end_date?: string | null }, hoy: string): boolean {
  const f = (r.end_date || "").slice(0, 10);
  return !!f && f < hoy && r.status !== "hecho";
}
/** Vence en los próximos `dias` días (incluye hoy), sin estar vencida ni hecha. */
export function vencePronto(r: { status?: string; end_date?: string | null }, hoy: string, dias = 7): boolean {
  const f = (r.end_date || "").slice(0, 10);
  if (!f || r.status === "hecho" || f < hoy) return false;
  const lim = new Date(hoy + "T00:00:00Z"); lim.setUTCDate(lim.getUTCDate() + dias);
  return f <= lim.toISOString().slice(0, 10);
}

export interface ItemCheck { t: string; ok: boolean }
/** Normaliza lo que venga de la base (jsonb) a una lista válida. */
export function checklistDe(v: unknown): ItemCheck[] {
  if (!Array.isArray(v)) return [];
  return v.filter(x => x && typeof x === "object" && String((x as any).t || "").trim())
    .map(x => ({ t: String((x as any).t), ok: !!(x as any).ok }));
}
export function avanceChecklist(items: ItemCheck[]): { hechos: number; total: number; pct: number } {
  const total = items.length, hechos = items.filter(x => x.ok).length;
  return { hechos, total, pct: total ? Math.round(hechos / total * 100) : 0 };
}

// ── Presentación al partner (2-oct-2026) ─────────────────────────────────────
/** ¿Sale en la presentación al partner? Solo `visible_partner === false` (interna)
 *  la deja fuera: una fila sin el campo (caché viejo) cuenta como visible. */
export function visibleParaPartner(r: { visible_partner?: boolean | null }): boolean {
  return r.visible_partner !== false;
}
/** "Necesitamos de ti": bloqueada Y marcada como dependiente del partner. */
export function necesitaAlPartner(r: { status?: string; depende_partner?: boolean | null }): boolean {
  return r.status === "bloqueado" && r.depende_partner === true;
}
/** Motivo a mostrar: solo mientras está bloqueada, sin espacios de más. */
export function motivoVisible(r: { status?: string; motivo_bloqueo?: string | null }): string {
  return r.status === "bloqueado" ? String(r.motivo_bloqueo || "").trim() : "";
}

// ── Hoja "Plan de trabajo" del deck (Kanban, 1-oct-2026) ─────────────────────
export interface FilaSeg { status?: string; end_date?: string | null; completed_at?: string | null }
const _dLocal = (ts: string) => { const d = new Date(ts); return isNaN(+d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Día en que se cerró: `completed_at` (lo registra la base al pasar a Hecho, en
 *  hora LOCAL) o, para lo cerrado antes de que existiera, el vencimiento. */
export function fechaCierre(r: FilaSeg): string {
  if (r.completed_at) return _dLocal(r.completed_at);
  return (r.end_date || "").slice(0, 10);
}
export interface KanbanDeck<T> {
  paginas: Record<ListaSeg, T[]>[];   // columnas de cada hoja, ya recortadas
  conteo: Record<ListaSeg, number>;   // totales por columna (logrados = del período)
  logradosAntes: number;              // cerrados ANTES del período (no se muestran)
  total: number; hechas: number; pct: number;
}
/**
 * Arma la hoja Kanban del deck. Logrados = cerrados desde `desde` (el inicio
 * del período del deck), el más reciente primero; el resto por vencimiento más
 * cercano (sin fecha al final). Hasta `porColumna` tarjetas por columna y hoja:
 * lo que no entra sigue en la hoja siguiente, nunca se corta.
 */
export function kanbanDeck<T extends FilaSeg>(rows: T[], desde: string, porColumna = 4): KanbanDeck<T> {
  const st = (r: T) => (LISTAS_SEG as string[]).includes(r.status || "") ? r.status as ListaSeg : "pendiente";
  const porFecha = (a: T, b: T) => (a.end_date || "9999").localeCompare(b.end_date || "9999");
  const hechas = rows.filter(r => st(r) === "hecho");
  const logrados = hechas.filter(r => fechaCierre(r) >= desde).sort((a, b) => fechaCierre(b).localeCompare(fechaCierre(a)));
  const cols: Record<ListaSeg, T[]> = {
    hecho: logrados,
    bloqueado: rows.filter(r => st(r) === "bloqueado").sort(porFecha),
    en_curso: rows.filter(r => st(r) === "en_curso").sort(porFecha),
    pendiente: rows.filter(r => st(r) === "pendiente").sort(porFecha)
  };
  const n = Math.max(1, ...LISTAS_SEG.map(l => Math.ceil(cols[l].length / porColumna)));
  const paginas = Array.from({ length: n }, (_, k) =>
    Object.fromEntries(LISTAS_SEG.map(l => [l, cols[l].slice(k * porColumna, (k + 1) * porColumna)])) as Record<ListaSeg, T[]>);
  const total = rows.length;
  return {
    paginas, total, hechas: hechas.length, pct: total ? Math.round(hechas.length / total * 100) : 0,
    conteo: Object.fromEntries(LISTAS_SEG.map(l => [l, cols[l].length])) as Record<ListaSeg, number>,
    logradosAntes: hechas.length - logrados.length
  };
}
