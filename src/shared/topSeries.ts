// ─────────────────────────────────────────────────────────────────────────────
// Gráficos de líneas con una serie por partner (V6).
//
// Acá vivía `topNMasOtros` (top N partners + serie "Otros"), que solo usaba la
// Vista Partner; se borró con ella (sep-2026). Rendimiento arma su top con
// charts.rendTopPartners. Queda el umbral de marcadores, que sí usa charts.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Con más de 8 series los marcadores se apagan (el hover los sigue mostrando). */
export const MAX_SERIES_CON_MARCADORES = 8;
