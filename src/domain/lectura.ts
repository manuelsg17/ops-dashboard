// domain/lectura.ts — Texto de la portada ejecutiva. PURO y testeable.
//
// Mismas reglas que domain/metrics.ts: no lee STATE, no toca el DOM, todo entra
// por parámetros. Vive acá y no en presentacion2.ts justamente para poder
// testear el TEXTO — que es contenido de negocio, no decoración.

// ── LECTURA EJECUTIVA (ago 2026, ampliada sep 2026) ──────────────────────────
// Genera las frases de la portada. La regla de oro: NINGUNA frase sin un número
// y una consecuencia. Nada de "el partner muestra buen desempeño" — eso no le
// dice a la gerencia del partner qué hacer el lunes.
//
// Cada regla se dispara SOLO si su condición se cumple, así que el texto cambia
// con los datos en vez de ser una plantilla rellenada. Si no se dispara ninguna,
// no se inventa: se dice que no hay nada para señalar.
//
// LÍMITE DE 4 FRASES, por orden de utilidad. Con más, la hoja deja de ser una
// portada y nadie lee la cuarta; y en el PDF no hay scroll para rescatarla.
//
// PURA: recibe los números ya calculados y devuelve strings. Sin STATE, sin DOM.
// Umbral de meta cumplida: 95%, no 100. Es una regla de negocio de Manuel
// (ago 2026) y tiene que ser LA MISMA que usa el color (pColor/pEstado) — si
// el texto dice "faltan X" mientras la barra ya esta verde, el informe se
// contradice solo.
import { pick } from "../core/i18nExport";

export const META_CUMPLIDA_PCT = 95;
export const LECTURA_MAX = 4;

// Idioma del deck. `ctx.es` se sigue aceptando (llamadas viejas y tests).
function _L(ctx) {
  if (ctx.lang) return ctx.lang;
  return ctx.es === false ? "en" : "es";
}
// Mismo resolver que el resto de las exportaciones (core/i18nExport): ru → en.
function _T(ctx, es, en, ru) {
  return pick({ es, en, ru }, _L(ctx));
}

export function p2Lectura(ctx) {
  const { kpis, ciudades, verticales, diasRestantes, diasMes } = ctx;
  const T = (es, en, ru) => _T(ctx, es, en, ru);
  const out = [];
  const pctMes = diasMes > 0 ? ((diasMes - diasRestantes) / diasMes) * 100 : null;

  // 1. La brecha más grande, con cuánto falta y cuánto tiempo queda. Es la
  //    frase que contesta "¿qué me falta y me da el tiempo?".
  const cortos = kpis.filter(k => k.meta > 0 && k.pct < META_CUMPLIDA_PCT).sort((a, b) => a.pct - b.pct);
  if (cortos.length) {
    const k = cortos[0];
    const falta = k.meta - k.real;
    out.push(T(
      `Faltan ${k.fmt(falta)} ${k.lbl.toLowerCase()} para la meta (vas en ${k.pct.toFixed(0)}%)${diasRestantes > 0 ? `, y quedan ${diasRestantes} de los ${diasMes} días del mes` : ", con el mes ya cerrado"}.`,
      `${k.fmt(falta)} short of the ${k.lbl.toLowerCase()} target (at ${k.pct.toFixed(0)}%)${diasRestantes > 0 ? `, with ${diasRestantes} of ${diasMes} days left` : ", month already closed"}.`,
      `До цели по «${k.lbl.toLowerCase()}» не хватает ${k.fmt(falta)} (сейчас ${k.pct.toFixed(0)}%)${diasRestantes > 0 ? `, осталось ${diasRestantes} из ${diasMes} дней месяца` : ", месяц уже закрыт"}.`));
  }

  // 2. RITMO (sep 2026). Un % de meta solo se puede juzgar contra cuánto mes
  //    pasó: 45% a los 5 días es ir volando, y a los 25 días es ir a la mitad.
  //    SOLO para flujos (`flujo: true`): un snapshot no se acumula, así que
  //    compararlo con el calendario inventa un atraso que no existe.
  if (pctMes != null && diasRestantes > 0) {
    const flujos = kpis.filter(k => k.flujo && k.meta > 0);
    const atras = flujos.filter(k => k.pct - pctMes <= -10).sort((a, b) => (a.pct - a.meta) - (b.pct - b.meta));
    const adel  = flujos.filter(k => k.pct - pctMes >= 10);
    if (atras.length) {
      const k = atras[0];
      // Proyección al cierre por ritmo lineal: es la consecuencia concreta de ir
      // atrasado, y evita la discusión de "todavía queda mes".
      const cierre = k.pct > 0 && pctMes > 0 ? (k.real * 100) / pctMes : null;
      const cierrePct = cierre != null && k.meta > 0 ? (cierre / k.meta) * 100 : null;
      out.push(T(
        `Vas al ${k.pct.toFixed(0)}% de ${k.lbl.toLowerCase()} con el ${pctMes.toFixed(0)}% del mes transcurrido${cierrePct != null ? `: a este ritmo cierras en ${k.fmt(cierre)} (${cierrePct.toFixed(0)}% de la meta)` : ""}.`,
        `You are at ${k.pct.toFixed(0)}% of ${k.lbl.toLowerCase()} with ${pctMes.toFixed(0)}% of the month elapsed${cierrePct != null ? `: at this pace you close at ${k.fmt(cierre)} (${cierrePct.toFixed(0)}% of target)` : ""}.`,
        `Вы на ${k.pct.toFixed(0)}% по «${k.lbl.toLowerCase()}» при пройденных ${pctMes.toFixed(0)}% месяца${cierrePct != null ? `: при таком темпе закроете на ${k.fmt(cierre)} (${cierrePct.toFixed(0)}% от цели)` : ""}.`));
    } else if (adel.length && !cortos.length) {
      const k = adel[0];
      out.push(T(
        `Vas adelantado: ${k.pct.toFixed(0)}% de ${k.lbl.toLowerCase()} con solo el ${pctMes.toFixed(0)}% del mes transcurrido.`,
        `You are ahead: ${k.pct.toFixed(0)}% of ${k.lbl.toLowerCase()} with only ${pctMes.toFixed(0)}% of the month elapsed.`,
        `Вы идёте с опережением: ${k.pct.toFixed(0)}% по «${k.lbl.toLowerCase()}» при пройденных всего ${pctMes.toFixed(0)}% месяца.`));
    }
  }

  // 3. CONDUCTORES OK PERO HORAS NO (sep 2026). Es el diagnóstico que más
  //    cambia la acción: con la gente ya adentro, el problema no es captación
  //    sino actividad, y se resuelve con incentivos/turnos, no reclutando.
  const ad = kpis.find(k => k.key === "ad"), sh = kpis.find(k => k.key === "sh");
  if (ad && sh && ad.meta > 0 && sh.meta > 0 && ad.pct >= META_CUMPLIDA_PCT && sh.pct < META_CUMPLIDA_PCT) {
    out.push(T(
      `Tienes los conductores (${ad.pct.toFixed(0)}% de la meta) pero no las horas (${sh.pct.toFixed(0)}%): la gente ya está adentro y conecta menos de lo previsto — es un tema de actividad, no de captación.`,
      `You have the drivers (${ad.pct.toFixed(0)}% of target) but not the hours (${sh.pct.toFixed(0)}%): they are already onboard and connecting less than planned — an activity issue, not an acquisition one.`,
      `Водители есть (${ad.pct.toFixed(0)}% от цели), а часов нет (${sh.pct.toFixed(0)}%): люди уже в парке, но выходят на линию меньше плана — это вопрос активности, а не набора.`));
  }

  // 4. Dónde se concentra esa brecha. Sin esto la gerencia sabe QUÉ falta pero
  //    no DÓNDE actuar.
  if (cortos.length && ciudades.length > 1) {
    const k = cortos[0];
    const gaps = ciudades.map(c => ({ n: c.label, g: Math.max(0, (c[k.key + "Meta"] || 0) - (c[k.key + "Real"] || 0)) }))
                         .filter(x => x.g > 0).sort((a, b) => b.g - a.g);
    const total = gaps.reduce((s, x) => s + x.g, 0);
    if (gaps.length && total > 0) {
      const share = (gaps[0].g / total) * 100;
      if (share >= 45) out.push(T(
        `El ${share.toFixed(0)}% de ese faltante está en ${gaps[0].n}: es donde más rinde poner el esfuerzo.`,
        `${share.toFixed(0)}% of that gap is in ${gaps[0].n}: that is where effort pays off most.`,
        `${share.toFixed(0)}% этого разрыва приходится на ${gaps[0].n} — именно там усилия дадут больше всего.`));
    }
  }

  // 5. BENCHMARK (sep 2026). Explica el POR QUÉ del número propio: dos partners
  //    con los mismos conductores rinden distinto según viajes/hora y horas por
  //    conductor. Solo se nombra la brecha más grande contra la mediana, y solo
  //    si es material (≥15%): abajo de eso es ruido de muestra.
  const B = ctx.bench;
  if (B && B.peor && Math.abs(B.peor.gapPct) >= 15) {
    const p = B.peor;
    out.push(p.gapPct < 0
      ? T(`Tu ${p.label.toLowerCase()} (${p.valor}) está ${Math.abs(p.gapPct).toFixed(0)}% por debajo de la mediana de tus pares (${p.mediana}): ahí está la diferencia de rendimiento por conductor.`,
          `Your ${p.label.toLowerCase()} (${p.valor}) is ${Math.abs(p.gapPct).toFixed(0)}% below your peers' median (${p.mediana}): that is where the per-driver performance gap sits.`,
          `Ваш показатель «${p.label.toLowerCase()}» (${p.valor}) на ${Math.abs(p.gapPct).toFixed(0)}% ниже медианы коллег (${p.mediana}) — здесь и кроется разрыв в отдаче на водителя.`)
      : T(`Tu ${p.label.toLowerCase()} (${p.valor}) está ${p.gapPct.toFixed(0)}% por encima de la mediana de tus pares (${p.mediana}).`,
          `Your ${p.label.toLowerCase()} (${p.valor}) is ${p.gapPct.toFixed(0)}% above your peers' median (${p.mediana}).`,
          `Ваш показатель «${p.label.toLowerCase()}» (${p.valor}) на ${p.gapPct.toFixed(0)}% выше медианы коллег (${p.mediana}).`));
  }

  // 6. EMBUDO (sep 2026). Separa "traigo poca gente" de "la gente que traigo no
  //    arranca" — dos problemas con acciones opuestas.
  //    Se OMITE cuando el Ejecutivo ya dibuja el bloque del embudo al lado:
  //    repetir el mismo número a 3 cm de distancia gasta una de las 4 frases y
  //    hace ver el informe como relleno. La acción prioritaria sí lo repite, y
  //    ahí está bien: es lo único que se pide hacer.
  const F = ctx.funnel;
  if (F && F.faltan >= 5 && !ctx.funnelEnBloque) {
    out.push(T(
      `De cada 100 perfiles que registras, ${F.mio.toFixed(0)} llegan a su primer viaje contra ${F.mediana.toFixed(0)} de tus pares: con esa tasa serían ${Math.round(F.faltan)} conductores más sin traer una persona extra.`,
      `Of every 100 profiles you register, ${F.mio.toFixed(0)} reach their first trip vs ${F.mediana.toFixed(0)} among your peers: at that rate it would be ${Math.round(F.faltan)} more drivers without adding a single person.`,
      `Из каждых 100 зарегистрированных вами профилей ${F.mio.toFixed(0)} доезжают до первой поездки против ${F.mediana.toFixed(0)} у коллег: при их ставке это ${Math.round(F.faltan)} водителей больше без единого нового человека.`));
  }

  // 7. Meta desalineada. Duplicar un objetivo no es un logro que reportar, es
  //    una señal de que el objetivo estaba mal puesto — decirlo protege la
  //    credibilidad del resto del informe.
  const desal = kpis.filter(k => k.meta > 0 && k.pct > 150);
  if (desal.length) {
    const sep = T(" y ", " and ", " и ");
    const n = desal.map(k => `${k.lbl.toLowerCase()} (${k.pct.toFixed(0)}%)`).join(sep);
    out.push(T(
      `${desal.length === 1 ? "La meta de" : "Las metas de"} ${n} ${desal.length === 1 ? "quedó" : "quedaron"} muy por debajo de lo real: conviene recalibrar${desal.length === 1 ? "la" : "las"} con tu KAM para que el objetivo vuelva a ser exigente.`,
      `The ${n} target${desal.length === 1 ? "" : "s"} fell well below actuals: worth recalibrating with your KAM so it stays demanding.`,
      `Цел${desal.length === 1 ? "ь" : "и"} по «${n}» оказал${desal.length === 1 ? "ась" : "ись"} намного ниже факта — стоит пересмотреть ${desal.length === 1 ? "её" : "их"} с вашим KAM, чтобы план снова был требовательным.`));
  }

  // 8. Vertical que arrastra al resto.
  const caen = verticales.filter(v => v.varPct != null && v.varPct <= -8).sort((a, b) => a.varPct - b.varPct);
  const suben = verticales.filter(v => v.varPct != null && v.varPct >= 8);
  if (caen.length) {
    const v = caen[0];
    out.push(T(
      `${v.label} cae ${Math.abs(v.varPct).toFixed(0)}% en conductores activos respecto del período anterior${suben.length ? `, mientras ${suben[0].label} sube ${suben[0].varPct.toFixed(0)}%` : ""}.`,
      `${v.label} is down ${Math.abs(v.varPct).toFixed(0)}% in active drivers vs the prior period${suben.length ? `, while ${suben[0].label} is up ${suben[0].varPct.toFixed(0)}%` : ""}.`,
      `${v.label}: активные водители снизились на ${Math.abs(v.varPct).toFixed(0)}% к прошлому периоду${suben.length ? `, при этом ${suben[0].label} вырос на ${suben[0].varPct.toFixed(0)}%` : ""}.`));
  }

  // 9. Todo en orden: tampoco se rellena con elogios vacíos. Y si NO hay metas
  //    cargadas, se dice eso — no "las metas están cubiertas", que afirmaría un
  //    cumplimiento que nadie midió (visto en un partner sin metas del mes).
  if (!out.length) {
    const conMeta = kpis.filter(k => k.meta > 0).length;
    out.push(!conMeta
      ? T("No hay metas cargadas para este mes, así que no se puede leer cumplimiento: los valores de arriba son el dato del período.",
          "No targets are loaded for this month, so attainment cannot be read: the figures above are the period's actuals.",
          "Цели на этот месяц не загружены, поэтому выполнение оценить нельзя: значения выше — это факт за период.")
      : T("Las metas del mes están cubiertas y no hay caídas relevantes por categoría.",
          "Monthly targets are covered and there are no relevant drops by category.",
          "Цели месяца выполнены, значимых спадов по категориям нет."));
  }
  return out.slice(0, LECTURA_MAX);
}

// La ACCIÓN es una sola: la palanca de mayor retorno según los datos. Varias
// "recomendaciones" a la vez se leen como una lista de deseos y no se ejecuta
// ninguna.
export function p2Accion(ctx) {
  const { kpis, ciudades } = ctx;
  const T = (es, en, ru) => _T(ctx, es, en, ru);
  const cortos = kpis.filter(k => k.meta > 0 && k.pct < META_CUMPLIDA_PCT).sort((a, b) => a.pct - b.pct);

  // Sin brecha de meta, la acción sale del embudo si ahí hay una fuga clara:
  // "cumplís, y además podrías tener N conductores más con los perfiles que ya
  // traés" es más útil que no decir nada.
  if (!cortos.length) {
    const F = ctx.funnel;
    if (F && F.faltan >= 5) return T(
      `Trabajar la activación: con la tasa de tus pares, los perfiles que ya registras darían ${Math.round(F.faltan)} conductores más.`,
      `Work on activation: at your peers' rate, the profiles you already register would yield ${Math.round(F.faltan)} more drivers.`,
      `Займитесь активацией: при ставке коллег уже привлекаемые профили дали бы ${Math.round(F.faltan)} водителей больше.`);
    return null;
  }
  const k = cortos[0];
  const falta = k.meta - k.real;
  let donde = null;
  if (ciudades.length > 1) {
    const gaps = ciudades.map(c => ({ n: c.label, g: Math.max(0, (c[k.key + "Meta"] || 0) - (c[k.key + "Real"] || 0)) }))
                         .sort((a, b) => b.g - a.g);
    if (gaps.length && gaps[0].g > 0) donde = gaps[0];
  }
  if (k.key === "nr") return T(
    `Empujar captación: faltan ${k.fmt(falta)} nuevos o reactivados${donde ? `, ${k.fmt(donde.g)} de ellos en ${donde.n}` : ""}.`,
    `Push acquisition: ${k.fmt(falta)} new or reactivated missing${donde ? `, ${k.fmt(donde.g)} of them in ${donde.n}` : ""}.`,
    `Усилить привлечение: не хватает ${k.fmt(falta)} новых или реактивированных${donde ? `, из них ${k.fmt(donde.g)} в ${donde.n}` : ""}.`);
  if (k.key === "sh") return T(
    `Subir horas conectadas: faltan ${k.fmt(falta)}${donde ? `, concentradas en ${donde.n}` : ""}. Revisar disponibilidad de la flota en horas pico.`,
    `Increase connected hours: ${k.fmt(falta)} missing${donde ? `, concentrated in ${donde.n}` : ""}. Review fleet availability at peak hours.`,
    `Поднять часы на линии: не хватает ${k.fmt(falta)}${donde ? `, в основном в ${donde.n}` : ""}. Проверьте доступность парка в часы пик.`);
  return T(
    `Reactivar conductores: faltan ${k.fmt(falta)} activos${donde ? `, ${k.fmt(donde.g)} de ellos en ${donde.n}` : ""}.`,
    `Reactivate drivers: ${k.fmt(falta)} active missing${donde ? `, ${k.fmt(donde.g)} of them in ${donde.n}` : ""}.`,
    `Реактивировать водителей: не хватает ${k.fmt(falta)} активных${donde ? `, из них ${k.fmt(donde.g)} в ${donde.n}` : ""}.`);
}

// ── SEÑALES EJECUTIVAS (Ola 6, sep 2026) ─────────────────────────────────────
// Cinco reglas que vivían SOLO en Vista Partner (_pvExecutiveSummary) y se
// mudaron acá al retirarla (decisión 2 del plan sep-2026). Van a la hoja de
// Alertas del deck, junto a las señales por ciudad de p2ComputeAlerts, con la
// misma forma { sev, kind, title, detail } — así las agrupa y pinta igual.
//
// Mismos umbrales que tenía Vista Partner (no se recalibraron: cambiarlos es una
// decisión de negocio, no de migración):
//   1. Volatilidad: coeficiente de variación del AD ≥ 25% (con ≥6 períodos en el
//      rango y ≥4 con AD > 0 — con menos, cualquier serie parece volátil).
//   2. Pico histórico: AD actual ≥ 95% del pico del historial cargado (señal
//      POSITIVA) o < 60% (potencial ya demostrado que hoy no se usa). Mismo
//      gate de ≥6 períodos que la volatilidad, como en Vista Partner.
//   3. Comisión por viaje: cae ≥ 10% contra el período anterior.
//   4. Dependencia de leads Yango: ≥ 50% de los nuevos+reactivados del último
//      período vienen de Yango (con ≥ 5 en total). Solo si el partner recibe
//      leads (alguna vez tuvo nuevos por servicio).
//   5. Brecha entre ciudades: la de más AD tiene ≥ 2,5× la de menos (con AD > 0).
//
// PURA: los números entran ya calculados; el formato entra como funciones.
export const SENALES_UMBRALES = {
  cvMin: 0.25, cvMinPeriodos: 6, cvMinConDato: 4,
  picoMejor: 95, picoBajo: 60,
  comisionCaidaPct: 10,
  dependenciaShare: 0.5, dependenciaMinNuevos: 5,
  brechaRatio: 2.5
};

export interface SenalCtx {
  lang?: string;
  es?: boolean;
  /** AD por período del rango (suma de las ciudades del partner), en orden. */
  serieAD: number[];
  /** Unidad de período ya traducida y en plural ("semanas", "months"…). */
  unidades: string;
  /** Máximo AD por período en TODO el historial cargado del partner. */
  picoAD: number;
  /** Último período: nuevos+reactivados totales y los que vienen de Yango. */
  nuevos?: { total: number; yango: number } | null;
  /** ¿El partner recibe leads Yango? (alguna vez tuvo nuevos por servicio). */
  recibeLeads?: boolean;
  /** Comisión y viajes del período anterior y del último. */
  comision?: { comPrev: number; viajesPrev: number; comAct: number; viajesAct: number } | null;
  /** AD del último período por ciudad (etiqueta ya traducida). */
  ciudades: { label: string; ad: number }[];
  fmt: (n: number) => string;
  fmtDec: (n: number, d: number) => string;
}

export interface Senal { sev: "mid" | "ok"; kind: string; title: string; detail: string }

export function p2SenalesEjecutivas(ctx: SenalCtx): Senal[] {
  const U = SENALES_UMBRALES;
  const T = (es: string, en: string, ru: string) => _T(ctx, es, en, ru);
  const out: Senal[] = [];
  const serie = (ctx.serieAD || []).map(x => +x || 0);
  const adActual = serie.length ? serie[serie.length - 1] : 0;

  if (serie.length >= U.cvMinPeriodos) {
    // 1. Volatilidad (desvío poblacional / media, sobre los períodos con AD).
    const conDato = serie.filter(x => x > 0);
    if (conDato.length >= U.cvMinConDato) {
      const media = conDato.reduce((s, x) => s + x, 0) / conDato.length;
      const varianza = conDato.reduce((s, x) => s + (x - media) ** 2, 0) / conDato.length;
      const cv = media > 0 ? Math.sqrt(varianza) / media : 0;
      if (cv >= U.cvMin) {
        const pct = ctx.fmtDec(cv * 100, 0);
        out.push({ sev: "mid", kind: "volatilidad",
          title: T("Conductores activos muy variables", "Highly volatile active drivers", "Сильные колебания активных водителей"),
          detail: T(`varían ${pct}% sobre su promedio en ${conDato.length} ${ctx.unidades}`,
                    `they swing ${pct}% around their average over ${conDato.length} ${ctx.unidades}`,
                    `колебания ${pct}% от среднего за ${conDato.length} ${ctx.unidades}`) });
      }
    }
    // 2. Pico histórico.
    const pico = +ctx.picoAD || 0;
    if (pico > 0 && adActual > 0) {
      const ratio = (adActual / pico) * 100;
      const r = ctx.fmtDec(ratio, 0), a = ctx.fmt(adActual), p = ctx.fmt(pico);
      if (ratio >= U.picoMejor) {
        out.push({ sev: "ok", kind: "pico_mejor",
          title: T("En su mejor nivel histórico", "At its best historical level", "На историческом максимуме"),
          detail: T(`hoy ${a} · ${r}% del pico (${p})`,
                    `now ${a} · ${r}% of the peak (${p})`,
                    `сейчас ${a} · ${r}% от пика (${p})`) });
      } else if (ratio < U.picoBajo) {
        out.push({ sev: "mid", kind: "pico_bajo",
          title: T("Por debajo del potencial ya demostrado", "Below its proven potential", "Ниже уже достигнутого потенциала"),
          detail: T(`hoy ${a} · ${r}% del pico (${p})`,
                    `now ${a} · ${r}% of the peak (${p})`,
                    `сейчас ${a} · ${r}% от пика (${p})`) });
      }
    }
  }

  // 3. Comisión por viaje.
  const C = ctx.comision;
  if (C && C.viajesPrev > 0 && C.comPrev > 0 && C.viajesAct > 0 && C.comAct > 0) {
    const antes = C.comPrev / C.viajesPrev, ahora = C.comAct / C.viajesAct;
    const caida = ((antes - ahora) / antes) * 100;
    if (caida >= U.comisionCaidaPct) {
      out.push({ sev: "mid", kind: "comision_viaje",
        title: T("Comisión por viaje a la baja", "Commission per trip declining", "Комиссия за поездку снижается"),
        detail: `$${ctx.fmtDec(antes, 2)} → $${ctx.fmtDec(ahora, 2)} (−${ctx.fmtDec(caida, 1)}%)` });
    }
  }

  // 4. Dependencia de leads Yango.
  const N = ctx.nuevos;
  if (ctx.recibeLeads && N && N.total >= U.dependenciaMinNuevos && N.yango / N.total >= U.dependenciaShare) {
    const pct = ctx.fmtDec((N.yango / N.total) * 100, 0), y = ctx.fmt(N.yango), tot = ctx.fmt(N.total);
    out.push({ sev: "mid", kind: "dependencia_leads",
      title: T("Alta dependencia de leads Yango", "High reliance on Yango leads", "Сильная зависимость от лидов Yango"),
      detail: T(`${pct}% de los nuevos y reactivados (${y} de ${tot})`,
                `${pct}% of new and reactivated (${y} of ${tot})`,
                `${pct}% новых и реактивированных (${y} из ${tot})`) });
  }

  // 5. Brecha entre ciudades.
  const conAD = (ctx.ciudades || []).filter(c => c.ad > 0).sort((a, b) => b.ad - a.ad);
  if (conAD.length >= 2) {
    const mejor = conAD[0], peor = conAD[conAD.length - 1];
    const ratio = mejor.ad / peor.ad;
    if (ratio >= U.brechaRatio) {
      out.push({ sev: "mid", kind: "brecha_ciudades",
        title: T("Brecha grande entre ciudades", "Large gap between cities", "Большой разрыв между городами"),
        detail: `${mejor.label} ${ctx.fmt(mejor.ad)} vs ${peor.label} ${ctx.fmt(peor.ad)} (${ctx.fmtDec(ratio, 1)}×)` });
    }
  }
  return out;
}
