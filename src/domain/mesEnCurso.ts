// ─────────────────────────────────────────────────────────────────────────────
// ¿El mes de una meta sigue EN CURSO? — decide si se muestra la "Proyección al
// cierre".
//
// Decisión de Manuel (23-sep-2026), textual: "en meses pasados ya en el filtro
// mensual no hace sentido seguirla mostrando, porque no logrará más avances en
// ese mes porque ya cerró". Por coherencia aplica a toda vista de metas
// mensuales: portal del partner, pestaña Metas y el "Avance vs Meta" del deck.
//
// UNA sola regla, no tres copias: el mismo mes no puede mostrar proyección en una
// pantalla y no en otra (ya pasó con la fórmula de la proyección de AD entre
// Metas y el deck, y con la escala en cuatro archivos).
//
// "En curso" = el mes de la meta es el mes CALENDARIO de hoy en Lima. La hora de
// Lima importa: a las 20:00 del 30-sep en Lima ya es 1-oct en UTC, y con el mes
// UTC el portal escondería la proyección de septiembre un día antes de tiempo
// (y la mostraría una tarde de más para un mes ya cerrado).
//
// Puro: `hoy` entra por parámetro, sin leer el reloj adentro salvo el default.
// ─────────────────────────────────────────────────────────────────────────────

export const TZ_LIMA = "America/Lima";

/** Año y mes (1-12) calendario de `d` en Lima. */
export function ymLima(d: Date = new Date()): { y: number; m: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_LIMA, year: "numeric", month: "2-digit"
  }).formatToParts(d);
  const y = Number(partes.find(p => p.type === "year")?.value);
  const m = Number(partes.find(p => p.type === "month")?.value);
  return { y, m };
}

/**
 * ¿El mes `mes` (1-12) del año `anio` es el mes en curso en Lima?
 *
 * `anio` null/undefined = la meta no trae año (uploads viejos sin `mes_year`):
 * se compara solo el mes. Es la lectura razonable — una meta "SEPTIEMBRE" sin
 * año vista en septiembre es la de este septiembre — y el error posible (mostrar
 * la proyección de un septiembre de otro año) es el mismo que ya se acepta para
 * esas filas en el resto de la app (ver _metasMatchMes).
 *
 * Un mes inválido (0, NaN, 13) da false: sin saber qué mes es, no se proyecta.
 */
export function esMesEnCurso(mes: number, anio?: number | null, hoy: Date = new Date()): boolean {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return false;
  const h = ymLima(hoy);
  if (mes !== h.m) return false;
  return anio == null || anio === h.y;
}
