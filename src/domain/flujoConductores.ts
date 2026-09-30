// domain/flujoConductores.ts — ganados, perdidos, neto y retención (puro).
//
// Pedido de Manuel (29-sep-2026): "saber cuántos drivers pierden y cuántos
// están añadiendo… de acuerdo a la retención y cuántos pierden y cuántos
// añaden es que puedo estimar si caen, suben o se mantienen".
//
// Misma base que la retención del deck (metrics.retentionSeries):
//   continúan = AD(t) − N+R(t)          (activos que no son nuevos ni reactivados)
//   ganados   = N+R(t)
//   perdidos  = AD(t−1) − continúan, si es positivo (del período anterior que no siguieron)
//   volvieron = continúan − AD(t−1), si es positivo — activos que NO estaban el
//               período anterior pero tampoco cuentan como reactivados (en
//               semanal: faltaron una semana y regresaron). Sin este término el
//               neto no cuadraba: probando en local daba ganados 2,158 −
//               perdidos 2,889 ≠ neto +508.
//   neto      = AD(t) − AD(t−1) = ganados + volvieron − perdidos (exacto)
//   retención = retenidos / AD(t−1), retenidos = min(continúan, AD(t−1))
//
// Ganados se parte en NUEVOS y REACTIVADOS (30-sep-2026): los partners crecen
// sobre todo por reactivación (sem. 21-sep en producción: 1,045 nuevos vs 1,510
// reactivados) y "ganados" a secas lo escondía. `volvieron` NO son los
// reactivados: son intermitentes (faltaron un período, sin llegar a contar como
// reactivados en el reporte) y en semanal suelen ser casi 0.
//
// Se calcula POR CUENTA y después se suma: una cuenta que crece con nuevos no
// puede tapar las bajas de otra. En cada cuenta y en el total se cumple
// neto = ganados + volvieron − perdidos.

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
  ganados: number;
  /** ganados = nuevos + reactivados. */
  nuevos: number;
  reactivados: number;
  /** Activos que no estaban el período anterior y no cuentan como N+R. */
  volvieron: number;
  perdidos: number;
  retenidos: number;
  neto: number;
  base: number;
  /** 0..1, o null sin base (primer período / cuenta nueva). */
  retencion: number | null;
}

const n = (v: unknown) => Math.max(Number(v) || 0, 0);

export function flujoCuenta(c: CuentaFlujo): Flujo {
  const adPrev = n(c.adPrev), ad = n(c.ad);
  // N+R no puede superar a los activos del período (dato ruidoso): se acota
  // para que la identidad del neto se mantenga.
  const ganados = Math.min(n(c.nr), ad);
  const reactivados = Math.min(n(c.re), ganados);
  const nuevos = ganados - reactivados;
  const continuan = ad - ganados;
  const retenidos = Math.min(continuan, adPrev);
  const perdidos = Math.max(adPrev - continuan, 0);
  const volvieron = Math.max(continuan - adPrev, 0);
  return { ganados, nuevos, reactivados, volvieron, perdidos, retenidos, neto: ad - adPrev, base: adPrev, retencion: adPrev > 0 ? retenidos / adPrev : null };
}

/** Suma de cuentas; la retención agregada es Σretenidos / Σbase (no un promedio de %). */
export function flujoTotal(cuentas: Iterable<CuentaFlujo>): Flujo {
  const t: Flujo = { ganados: 0, nuevos: 0, reactivados: 0, volvieron: 0, perdidos: 0, retenidos: 0, neto: 0, base: 0, retencion: null };
  for (const c of cuentas) {
    const f = flujoCuenta(c);
    t.ganados += f.ganados; t.nuevos += f.nuevos; t.reactivados += f.reactivados; t.volvieron += f.volvieron; t.perdidos += f.perdidos; t.retenidos += f.retenidos;
    t.neto += f.neto; t.base += f.base;
  }
  t.retencion = t.base > 0 ? t.retenidos / t.base : null;
  return t;
}
