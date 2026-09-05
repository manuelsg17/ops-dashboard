// domain/lectura.ts — Texto de la portada ejecutiva. PURO y testeable.
//
// Mismas reglas que domain/metrics.ts: no lee STATE, no toca el DOM, todo entra
// por parámetros. Vive acá y no en presentacion2.ts justamente para poder
// testear el TEXTO — que es contenido de negocio, no decoración.

// ── LECTURA EJECUTIVA (ago 2026) ──────────────────────────────────────────────
// Genera las frases de la portada. La regla de oro: NINGUNA frase sin un número
// y una consecuencia. Nada de "el partner muestra buen desempeño" — eso no le
// dice a la gerencia del partner qué hacer el lunes.
//
// Cada regla se dispara SOLO si su condición se cumple, así que el texto cambia
// con los datos en vez de ser una plantilla rellenada. Si no se dispara ninguna,
// no se inventa: se dice que no hay nada para señalar.
//
// PURA: recibe los números ya calculados y devuelve strings. Sin STATE, sin DOM.
// Umbral de meta cumplida: 95%, no 100. Es una regla de negocio de Manuel
// (ago 2026) y tiene que ser LA MISMA que usa el color (pColor/pEstado) — si
// el texto dice "faltan X" mientras la barra ya esta verde, el informe se
// contradice solo.
export const META_CUMPLIDA_PCT = 95;

export function p2Lectura(ctx) {
  const { es, kpis, ciudades, verticales, diasRestantes, diasMes } = ctx;
  const out = [];

  // 1. La brecha más grande, con cuánto falta y cuánto tiempo queda. Es la
  //    frase que contesta "¿qué me falta y me da el tiempo?".
  const cortos = kpis.filter(k => k.meta > 0 && k.pct < META_CUMPLIDA_PCT).sort((a, b) => a.pct - b.pct);
  if (cortos.length) {
    const k = cortos[0];
    const falta = k.meta - k.real;
    out.push(es
      ? `Faltan ${k.fmt(falta)} ${k.lbl.toLowerCase()} para la meta (vas en ${k.pct.toFixed(0)}%)${diasRestantes > 0 ? `, y quedan ${diasRestantes} de los ${diasMes} días del mes` : ", con el mes ya cerrado"}.`
      : `${k.fmt(falta)} short of the ${k.lbl.toLowerCase()} target (at ${k.pct.toFixed(0)}%)${diasRestantes > 0 ? `, with ${diasRestantes} of ${diasMes} days left` : ", month already closed"}.`);
  }

  // 2. Dónde se concentra esa brecha. Sin esto la gerencia sabe QUÉ falta pero
  //    no DÓNDE actuar.
  if (cortos.length && ciudades.length > 1) {
    const k = cortos[0];
    const gaps = ciudades.map(c => ({ n: c.label, g: Math.max(0, (c[k.key + "Meta"] || 0) - (c[k.key + "Real"] || 0)) }))
                         .filter(x => x.g > 0).sort((a, b) => b.g - a.g);
    const total = gaps.reduce((s, x) => s + x.g, 0);
    if (gaps.length && total > 0) {
      const share = (gaps[0].g / total) * 100;
      if (share >= 45) out.push(es
        ? `El ${share.toFixed(0)}% de ese faltante está en ${gaps[0].n}: es donde más rinde poner el esfuerzo.`
        : `${share.toFixed(0)}% of that gap is in ${gaps[0].n}: that is where effort pays off most.`);
    }
  }

  // 3. Meta desalineada. Duplicar un objetivo no es un logro que reportar, es
  //    una señal de que el objetivo estaba mal puesto — decirlo protege la
  //    credibilidad del resto del informe.
  const desal = kpis.filter(k => k.meta > 0 && k.pct > 150);
  if (desal.length) {
    const n = desal.map(k => `${k.lbl.toLowerCase()} (${k.pct.toFixed(0)}%)`).join(es ? " y " : " and ");
    out.push(es
      ? `${desal.length === 1 ? "La meta de" : "Las metas de"} ${n} ${desal.length === 1 ? "quedó" : "quedaron"} muy por debajo de lo real: conviene recalibrar${desal.length === 1 ? "la" : "las"} con tu KAM para que el objetivo vuelva a ser exigente.`
      : `The ${n} target${desal.length === 1 ? "" : "s"} fell well below actuals: worth recalibrating with your KAM so it stays demanding.`);
  }

  // 4. Vertical que arrastra al resto.
  const caen = verticales.filter(v => v.varPct != null && v.varPct <= -8).sort((a, b) => a.varPct - b.varPct);
  const suben = verticales.filter(v => v.varPct != null && v.varPct >= 8);
  if (caen.length) {
    const v = caen[0];
    out.push(es
      ? `${v.label} cae ${Math.abs(v.varPct).toFixed(0)}% en conductores activos respecto del período anterior${suben.length ? `, mientras ${suben[0].label} sube ${suben[0].varPct.toFixed(0)}%` : ""}.`
      : `${v.label} is down ${Math.abs(v.varPct).toFixed(0)}% in active drivers vs the prior period${suben.length ? `, while ${suben[0].label} is up ${suben[0].varPct.toFixed(0)}%` : ""}.`);
  }

  // 5. Todo en orden: tampoco se rellena con elogios vacíos. Y si NO hay metas
  //    cargadas, se dice eso — no "las metas están cubiertas", que afirmaría un
  //    cumplimiento que nadie midió (visto en un partner sin metas del mes).
  if (!out.length) {
    const conMeta = kpis.filter(k => k.meta > 0).length;
    out.push(!conMeta
      ? (es ? "No hay metas cargadas para este mes, así que no se puede leer cumplimiento: los valores de arriba son el dato del período."
            : "No targets are loaded for this month, so attainment cannot be read: the figures above are the period's actuals.")
      : (es ? "Las metas del mes están cubiertas y no hay caídas relevantes por categoría."
            : "Monthly targets are covered and there are no relevant drops by category."));
  }
  return out;
}

// La ACCIÓN es una sola: la palanca de mayor retorno según los datos. Varias
// "recomendaciones" a la vez se leen como una lista de deseos y no se ejecuta
// ninguna.
export function p2Accion(ctx) {
  const { es, kpis, ciudades } = ctx;
  const cortos = kpis.filter(k => k.meta > 0 && k.pct < META_CUMPLIDA_PCT).sort((a, b) => a.pct - b.pct);
  if (!cortos.length) return null;
  const k = cortos[0];
  const falta = k.meta - k.real;
  let donde = null;
  if (ciudades.length > 1) {
    const gaps = ciudades.map(c => ({ n: c.label, g: Math.max(0, (c[k.key + "Meta"] || 0) - (c[k.key + "Real"] || 0)) }))
                         .sort((a, b) => b.g - a.g);
    if (gaps.length && gaps[0].g > 0) donde = gaps[0];
  }
  if (k.key === "nr") return es
    ? `Empujar captación: faltan ${k.fmt(falta)} nuevos o reactivados${donde ? `, ${k.fmt(donde.g)} de ellos en ${donde.n}` : ""}.`
    : `Push acquisition: ${k.fmt(falta)} new or reactivated missing${donde ? `, ${k.fmt(donde.g)} of them in ${donde.n}` : ""}.`;
  if (k.key === "sh") return es
    ? `Subir horas conectadas: faltan ${k.fmt(falta)}${donde ? `, concentradas en ${donde.n}` : ""}. Revisar disponibilidad de la flota en horas pico.`
    : `Increase connected hours: ${k.fmt(falta)} missing${donde ? `, concentrated in ${donde.n}` : ""}. Review fleet availability at peak hours.`;
  return es
    ? `Reactivar conductores: faltan ${k.fmt(falta)} activos${donde ? `, ${k.fmt(donde.g)} de ellos en ${donde.n}` : ""}.`
    : `Reactivate drivers: ${k.fmt(falta)} active missing${donde ? `, ${k.fmt(donde.g)} of them in ${donde.n}` : ""}.`;
}
