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
