// domain/flujoConductores.ts — entran, se pierden, neto y retención (puro).
//
// Pedido de Manuel (29-sep-2026): "saber cuántos drivers pierden y cuántos
// están añadiendo… de acuerdo a la retención y cuántos pierden y cuántos
// añaden es que puedo estimar si caen, suben o se mantienen".
//
// MISMA FÓRMULA que la Presentación y la página de proyección (30-sep-2026,
// pedido de Manuel: "que uses la misma"):
//   retención = (AD − nuevos − reactivados) / AD anterior
//               (metrics.retentionSeries y forecast.fcGrowthLevers)
//   perdidos  = AD anterior + nuevos + reactivados − AD, si es positivo
//               (el `churn` de fcGrowthLevers)
// Sin recortes: la retención puede pasar de 100% o dar negativa, igual que en
// el deck (recortarla escondería justo el caso a mirar).
//
// Se aplica al NIVEL QUE SE MUESTRA (país, KAM o partner) sobre los totales de
// ese nivel — como el deck, que la calcula sobre la serie del partner. Hasta el
// 30-sep se calculaba por cuenta con min(continúan, AD anterior) y se sumaba:
// daba lo mismo ±0.2 pp (producción, semana 21-sep: 87.6% vs 87.7%; agosto:
// 72.7% vs 72.8%), pero no era LA fórmula.
//
// Descomposición del neto (exacta): neto = AD − AD anterior
//   = nuevos + reactivados + intermitentes − perdidos
// donde intermitentes = AD − N+R − AD anterior, si es positivo: activos que no
// estaban el período anterior y no cuentan como reactivados (en semanal, los
// que faltaron una semana). Perdidos e intermitentes nunca son ambos > 0.
//
// OJO con la escala: en semanal la retención es de UNA semana a la siguiente
// (~88% en producción) y no se compara con la mensual (~73%) de la
// Presentación. La vista lo dice y ofrece la mensual como referencia.

export interface CuentaFlujo {
  /** AD del período anterior (base). */
  adPrev: number;
  /** AD del período. */
  ad: number;
  /** Nuevos + reactivados del período. */
  nr: number;
  /** Reactivados del período (parte de nr). Sin dato: 0. */
  re?: number;
}
export interface Flujo {
  /** nuevos + reactivados. */
  ganados: number;
  nuevos: number;
  reactivados: number;
  /** Intermitentes: activos que no estaban el período anterior y no son N+R. */
  volvieron: number;
  perdidos: number;
  /** AD − N+R: los que ya estaban (numerador de la retención). */
  retenidos: number;
  neto: number;
  base: number;
  /** (AD − N+R) / AD anterior; null sin base (primer período / cuenta nueva). */
  retencion: number | null;
}

const n = (v: unknown) => Math.max(Number(v) || 0, 0);

export function flujoCuenta(c: CuentaFlujo): Flujo {
  const adPrev = n(c.adPrev), ad = n(c.ad), ganados = n(c.nr);
  const reactivados = Math.min(n(c.re), ganados);
  const retenidos = ad - ganados;
  return {
    ganados, nuevos: ganados - reactivados, reactivados,
    volvieron: Math.max(retenidos - adPrev, 0),
    perdidos: Math.max(adPrev - retenidos, 0),
    retenidos, neto: ad - adPrev, base: adPrev,
    retencion: adPrev > 0 ? retenidos / adPrev : null
  };
}

/** Flujo del NIVEL: suma las cuentas y aplica la fórmula sobre los totales. */
export function flujoTotal(cuentas: Iterable<CuentaFlujo>): Flujo {
  const t = { adPrev: 0, ad: 0, nr: 0, re: 0 };
  for (const c of cuentas) { t.adPrev += n(c.adPrev); t.ad += n(c.ad); t.nr += n(c.nr); t.re += Math.min(n(c.re), n(c.nr)); }
  return flujoCuenta(t);
}
