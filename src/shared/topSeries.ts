// ─────────────────────────────────────────────────────────────────────────────
// Top-N + "Otros" para los gráficos de líneas con una serie por partner (V6).
//
// "Perú total · por partner" dibujaba UNA línea por partner: ~60-70 en
// producción, ~1.200 marcadores por gráfico, sin leyenda legible (se oculta con
// más de 8 series) y con el hilo principal trabado al pasar el mouse. Ahora: los
// N partners más grandes por Active Drivers del ÚLTIMO período (el mismo orden
// en los cuatro gráficos, para que un color signifique lo mismo en todos) y el
// resto sumado en una serie "Otros".
//
// Solo cambia el DIBUJO: ningún número mostrado en tarjetas/tablas sale de acá
// (las claves data-num no se tocan). La suma de todas las series por fecha es la
// misma que antes: "Otros" es exactamente lo que dejó de dibujarse.
//
// Puro: sin STATE ni DOM.
// ─────────────────────────────────────────────────────────────────────────────

export interface SerieTop { name: string; data: number[]; otros?: boolean }

/**
 * @param partners  universo (en el orden del llamador)
 * @param dates     eje X
 * @param valor     valor de la métrica del gráfico para (partner, fecha)
 * @param peso      criterio de orden (AD del último período); empate → nombre
 * @param n         cuántos partners se dibujan sueltos
 * @returns series (top N en orden de peso desc + "Otros" al final si hay resto)
 *          y `resto` = cuántos partners quedaron dentro de "Otros".
 *          Si el universo cabe en N+1 series, se dibuja completo (una serie
 *          "Otros" con un solo partner no ayuda a nadie).
 */
export function topNMasOtros(
  partners: string[], dates: string[],
  valor: (p: string, d: string) => number,
  peso: (p: string) => number,
  n = 8
): { series: SerieTop[]; top: string[]; resto: number } {
  const serieDe = (p: string): SerieTop => ({ name: p, data: dates.map(d => valor(p, d) || 0) });
  if (partners.length <= n + 1) {
    return { series: partners.map(serieDe), top: partners.slice(), resto: 0 };
  }
  const orden = partners.slice().sort((a, b) => (peso(b) || 0) - (peso(a) || 0) || (a < b ? -1 : a > b ? 1 : 0));
  const top = orden.slice(0, n);
  const resto = orden.slice(n);
  const otros = dates.map(d => resto.reduce((s, p) => s + (valor(p, d) || 0), 0));
  return {
    series: [...top.map(serieDe), { name: "", data: otros, otros: true }],
    top,
    resto: resto.length
  };
}

/** Con más de 8 series los marcadores se apagan (el hover los sigue mostrando). */
export const MAX_SERIES_CON_MARCADORES = 8;
