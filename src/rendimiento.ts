//@ts-nocheck
// rendimiento.js — Pestaña Rendimiento

// Núcleo de cálculo compartido (ver domain/metrics.ts).
import { ratio, tasaAcum, sumarTasa, leerTasa, AD_PROJECTION_FACTOR } from "./domain/metrics.js";
import { sliceEscala, datasetLinea } from "./shared/escala.js";
import { SIN_KAM, normKamValor } from "./core/config.js";
import { t, kamLabel, mesLabel, getLang } from "./core/i18n";
import { dn } from "./shared/huella";
import { particionarPorKam, ordenarKams } from "./domain/desgloseKam";
import { escalaLista, reintentarCuandoEscalaLista } from "./shared/escalaLista";
import { partesAlcance } from "./shared/alcance";
import { segmented, btn, badge, alertBox, emptyState, progressRing } from "./shared/ui";
import { iconSvg } from "./shared/icons";
import { chartTokens, seriesColor } from "./shared/chartTheme";
import { rendTopPartners, valorMetricaPartner, indiceBase100, ESTILO_SUAVE } from "./charts.js";
import { metasResumenPais, metasCuentasLinea, _metasFechasDelMes, _metasFechasMesCompleto, etiquetaMesCompleto } from "./metas.js";
import { variacionPct, mesAnterior } from "./domain/vsMesAnterior";
import { reportYM, diasMesReporteDe } from "./shared/mesReporte.js";
import { parseLocalDate } from "./core/dates";
import { opcionesMesMeta, mesNumero } from "./domain/mesesMeta";
import { esMesEnCurso } from "./domain/mesEnCurso";
import { flujoTotal, flujoCuenta } from "./domain/flujoConductores";
import { calcularBrecha } from "./domain/brechaMeta";
import { generarAccionables } from "./domain/accionables";

// ── LÍNEA DE NEGOCIO (Agregador / Fleet / TukTuk / Combinado) ─────────────────
// Localizado a Rendimiento: NO muta STATE.rawData (el agregador queda intacto para
// Metas/Calculadora/etc). Se filtra el slice de la línea con los MISMOS filtros del
// sidebar (ciudad/fecha/partner). Agregador incluye Fleet (Fleet ⊂ Taxi). Combinado
// = Taxi + TukTuk (conjuntos disjuntos: TukTuk se excluye de rawData al cargar, así
// que el concat no double-cuenta). El diario no trae db_id (sin sub-flota) →
// Fleet/TukTuk/Combinado se deshabilitan y cae a Agregador.
export function _rendLine() {
  // Las 4 líneas funcionan en las 3 escalas. El guard que forzaba "agg" en
  // diario existía porque el export diario no traía db_id — dejó de ser cierto
  // (verificado contra la BD el 2026-07-29: las 5.516 filas de la ventana lo
  // tienen), y ahora loadDiarioIfNeeded construye los slices Fleet/TukTuk.
  return STATE.rendLine || "comb";
}
// Dataset completo (todas las fechas) de la línea activa para la escala actual.
// La resolución por escala vive en shared/escala.ts (con tests): estuvo copiada
// en cuatro archivos y en todos estuvo mal a la vez — un booleano para TRES
// escalas, que en diario devolvía el slice SEMANAL sin decir nada.
const _sliceEscala = base => sliceEscala(STATE, base);

export function _rendLineDataset() {
  return datasetLinea(STATE, _rendLine());
}
// ¿Este partner está incluido en la selección del sidebar?
//
// HISTORIA (importante, tuvo dos versiones incorrectas): los partners solo-TukTuk
// (ej. PIAGGIO) no llegaban al sidebar porque la lista salía del dataset Taxi.
//   v1: `selSet.has(partner)` a secas → nunca aparecían: SUB-conteo.
//   v2: `selSet.has(partner) || !sidebarSet.has(partner)` → aparecían SIEMPRE,
//       incluso al elegir un único partner: SOBRE-conteo (se veía "Perú 145"
//       con un partner de 77 seleccionado, los otros 68 eran PIAGGIO).
// Ninguna de las dos es correcta porque el problema no estaba acá sino en el
// sidebar, que no podía expresar esos partners. Ahora `STATE.sidebarPartners`
// los incluye (ver updateIndexes en data.js), así que la selección alcanza y
// esta función vuelve a ser lo simple que siempre debió ser.
//
// El segundo parámetro se conserva por compatibilidad con los call sites y como
// red de seguridad: si algún partner quedara fuera del sidebar por un camino no
// previsto, se lo sigue incluyendo (preferimos sobre-contar visiblemente antes
// que perder data en silencio).
export function _lineSelHas(selSet, sidebarSet, partner) {
  if (selSet.has(partner)) return true;
  return !!sidebarSet && !sidebarSet.has(partner);
}

// KAM efectivo de una fila. `partners`/`flotas` mandan (getKAMForPartner); el KAM
// que vino en el Excel es solo fallback.
//
// El último fallback es SIN_KAM y no "": una fila sin KAM por ningún lado tiene
// que caer en un grupo REAL para que el filtro pueda alcanzarla. Con "" quedaba
// fuera de todos los grupos y solo se la veía en "Todos", así que sus números
// aparecían en el total del país sin pertenecer a nadie.
export function _lineKamOf(row) {
  const k = (typeof getKAMForPartner === "function" && getKAMForPartner(row.partner)) || "";
  return k || normKamValor(row.kam) || SIN_KAM;
}

// Filas de la línea filtradas por ciudad/fecha/partner/KAM (espeja getFiltered()).
//
// OJO con el filtro de KAM — acá había un sobreconteo real: en Agregador el KAM se
// aplica indirectamente (onKAMChange marca/desmarca los checkboxes del sidebar, así
// que `selected` ya viene acotado), pero los partners solo-TukTuk NO están en el
// sidebar y `_lineSelHas` los da por incluidos SIEMPRE. Resultado: al filtrar por un
// KAM en TukTuk/Combinado se colaban los partners solo-TukTuk de TODOS los demás
// KAMs, inflando los totales. Por eso el KAM se filtra acá de forma EXPLÍCITA en vez
// de confiar en la selección del sidebar.
export function _rendLineFiltered() {
  if (_rendLine() === "agg") return getFiltered();
  const f = getCurrentFilters();
  const selSet = new Set(f.selected);
  const sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  return _rendLineDataset().filter(r =>
    (f.city === "all" || r.city === f.city) &&
    r.date >= f.from && r.date <= f.to &&
    (f.kam === "all" || _lineKamOf(r) === f.kam) &&
    _lineSelHas(selSet, sidebar, r.partner)
  );
}
// Filas de prevDate (fuera del rango) para la línea. Agregador usa el índice _byDate;
// Fleet/TukTuk filtran su slice (arrays pequeños, sin índice dedicado).
// El KAM se aplica por el mismo motivo que arriba: si no, el período anterior de la
// comparación WoW incluiría partners que el período actual ya excluyó → un WoW que
// compara dos universos distintos y siempre da caída.
export function _rendLinePrev(prevDate, city) {
  if (!prevDate) return [];
  if (_rendLine() === "agg") {
    const base = (STATE._byDate && STATE._byDate.get(prevDate))
      || STATE.rawData.filter(r => r.date === prevDate);
    return city ? base.filter(r => r.city === city) : base;
  }
  const kam = (getCurrentFilters().kam) || "all";
  return _rendLineDataset().filter(r =>
    r.date === prevDate &&
    (!city || r.city === city) &&
    (kam === "all" || _lineKamOf(r) === kam)
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// PRESENTACIÓN (Ola 6, sep-2026) — sistema de diseño (ui-*, tokens) + rd-*
// (src/styles/views/rendimiento.css). Reglas de esta vista:
//   · Ningún número cambia: cada cifra conserva su `data-num` (huella) y su
//     formato (fmt / fmtSmart / fmtK). Los deltas de tablas y tarjetas conservan
//     el TEXTO de bdg() ("↑+5.0%", "N/A", "NEW", "--"), porque en la tabla Fleet
//     el badge vive dentro de la celda marcada y entra en la huella.
//   · Color con significado: estados con ok/warn/bad; ciudades y KAMs con la
//     paleta categórica (--cat-N), nunca el rojo de marca.
//   · Sin emojis en la interfaz: iconos de shared/icons.ts.
// ═════════════════════════════════════════════════════════════════════════════

// Etiqueta del periodo del snapshot, segun la escala activa.
export function _rendPeriodLabel() {
  return STATE.curMode === "mensual" ? t("rend.per.ultimoMes")
       : STATE.curMode === "diario"  ? t("rend.per.ultimoDia")
       : t("rend.per.ultimaSemana");
}
// Escala MENSUAL con el último período = mes EN CURSO: mes (1-12) del mes
// anterior, cuyo resultado FINAL es contra lo que se compara (decisión de
// Manuel, 24-sep-2026: "tiene que compararse contra el resultado final del mes
// anterior, así de simple"). La variación de un mes a medias contra uno completo
// sale negativa por construcción, así que el rótulo lo dice en todas las
// secciones: "vs agosto (mes completo)" — el mismo texto que Metas. 0 en
// cualquier otro caso. Se fija al comienzo de cada render (_renderRendImpl).
let _rdMesPrevCompleto = 0;
function _rdCompLabel() {
  if (_rdMesPrevCompleto && STATE.curMode === "mensual") return etiquetaMesCompleto(_rdMesPrevCompleto, false);
  return STATE.curMode === "mensual" ? t("rend.cmp.mesAnterior")
       : STATE.curMode === "diario"  ? t("rend.cmp.diaAnterior")
       : t("rend.cmp.semAnterior");
}
const _rdPrevLbl = () => _rdMesPrevCompleto && STATE.curMode === "mensual"
  ? etiquetaMesCompleto(_rdMesPrevCompleto, true)
  : t("rend.cmp.vs", { p: _rdCompLabel() });

// ── Colores categóricos (tokens) ─────────────────────────────────────────────
// Ciudad: posición fija en CITIES (Lima = cat-1). KAM: posición en la lista
// ORDENADA de KAMs reales (estable mientras no cambie la cartera); "No KAM" va
// en el gris de "Otros". Para el DOM se usa la variable CSS; para ApexCharts el
// valor resuelto (seriesColor lee el mismo token).
function _rdCityIdx(city) { return CITIES.indexOf(city); }
function _rdCityVar(city) {
  const i = _rdCityIdx(city);
  return i >= 0 && i < 9 ? `var(--cat-${i + 1})` : "var(--cat-other)";
}
function _rdKamIdx(kam) {
  if (!kam || kam === SIN_KAM) return -1;
  const kams = Object.keys(STATE.KAM_PARTNERS || {}).filter(k => k && k !== SIN_KAM).sort();
  if (!kams.includes(kam)) kams.push(kam);
  return kams.indexOf(kam) % 9;
}
function _rdKamVar(kam) {
  const i = _rdKamIdx(kam);
  return i >= 0 ? `var(--cat-${i + 1})` : "var(--cat-other)";
}
// Punto de color (dato, no decoración): el color viene de datos/tokens.
// Horas de conexión siempre enteras: fmt() conserva 2 decimales debajo de
// 10,000 (pensado para tasas) y en diario o cuentas chicas salía "7,473.47".
const _fmtH = v => fmt(Math.round(v || 0));

function _rdDot(color) {
  return `<span class="rd-dot" style="background:${escapeHTML(color)}" aria-hidden="true"></span>`;
}

// ── Delta vs período anterior ────────────────────────────────────────────────
// Misma semántica y MISMO TEXTO que bdgMode() (data.ts): en diario no se
// compara; sin base "N/A"; base 0 → "NEW"/"--"; si no "↑+5.0%". Lo que cambia es
// el aspecto: el de ui-delta (icono + color), con la flecha de texto solo para
// lectores de pantalla. `invert`: métricas donde bajar es bueno (fraude…).
function _rdDelta(c, p, o = {}) {
  if (STATE.curMode === "diario") return "";
  const comp = _rdCompLabel();
  if (p === null || p === undefined)
    return `<span class="ui-delta ui-delta--na" title="${escapeHTML(t("bdg.sinPrevio"))}">N/A</span>`;
  if (c === null || c === undefined)
    return `<span class="ui-delta ui-delta--na" title="${escapeHTML(t("bdg.sinDato"))}">N/A</span>`;
  if (p === 0)
    return c > 0 ? `<span class="ui-delta ui-delta--good" title="${escapeHTML(t("bdg.primero", { c: comp }))}">NEW</span>`
                 : `<span class="ui-delta ui-delta--flat" title="${escapeHTML(t("bdg.sinMov"))}">--</span>`;
  // Misma cuenta que Metas (domain/vsMesAnterior).
  const v  = variacionPct(c, p);
  if (v == null)
    return `<span class="ui-delta ui-delta--na" title="${escapeHTML(t("bdg.sinDato"))}">N/A</span>`;
  const up = v >= 0;
  const s  = up ? "+" : "";
  const tone = Math.abs(v) < 0.05 ? "flat" : (up !== !!o.invert ? "good" : "bad");
  const tip = t("bdg.tip", { a: fmt(c), c: comp, p: fmt(p), v: `${s}${v.toFixed(1)}` });
  return `<span class="ui-delta ui-delta--${tone}" title="${escapeHTML(tip)}">` +
    iconSvg(up ? "arrow-up" : "arrow-down", { size: 12 }) +
    `<span class="ui-sr-only">${up ? "↑" : "↓"}</span><span>${s}${v.toFixed(1)}%</span></span>`;
}

// Tendencia de los últimos períodos (trendI): icono + tono, sin colores hex.
function _rdTrend(vals) {
  const ti = trendI(vals);
  const up = ti.i === "↑", down = ti.i === "↓";
  const cls = up ? "rd-trend--up" : down ? "rd-trend--down" : "rd-trend--flat";
  const lbl = t(up ? "rd.tend.sube" : down ? "rd.tend.baja" : "rd.tend.estable");
  return `<span class="rd-trend ${cls}" title="${escapeHTML(lbl)}">${iconSvg(up ? "trending-up" : down ? "trending-down" : "minus", { size: 14, label: lbl })}</span>`;
}

// Raíz de la vista. `rd-view--suave` = estilo "B · Suave" que eligió Manuel
// (fase 8, 24-sep-2026): superficies redondeadas con tinte, sin bordes duros,
// anillo de avance arriba de cada KPI con meta. Va en un modificador (y no en
// .rd-view a secas) porque el prototipo de dev (src/dev/proto) reusa las clases
// rd-* para su versión "Elegida" y tiene que seguir viéndose como se revisó.
const RD_VIEW = "rd-view rd-view--suave";

// ── Tarjeta KPI ("tile" suave) ───────────────────────────────────────────────
// Valor · delta vs período anterior · avance contra la meta del mes. El avance
// es un ANILLO arriba a la derecha (lo que Manuel eligió del prototipo B) y el
// caption completo ("Septiembre: 6,371 de 8,758 · 72.7% · proyección 109.1%")
// sigue visible abajo — y además es el nombre accesible del anillo. Sin meta
// (Viajes, productividad…) el hueco del anillo lleva un icono neutro, o nada.
// No se usa ui.kpiCard() porque la cifra lleva su `data-num` y el delta sigue
// la semántica de bdgMode (NEW, nada en diario).
//
// Escala mensual con el mes EN CURSO: el delta es contra el resultado FINAL del
// mes anterior y el rótulo lo dice ("vs agosto (mes completo)", _rdPrevLbl).
// `extra`: HTML ya escapado de una línea secundaria (p.ej. el acumulado del
// rango cuando el valor grande pasa a ser el del mes).
function _rdKpi(o) {
  const d = _rdDelta(o.cur, o.prev, { invert: o.invert });
  const g = o.goal;
  const conAnillo = !!g && g.pct != null && Number.isFinite(g.pct);
  const slot = conAnillo
    ? progressRing({ pct: g.pct, projPct: g.projPct, label: g.caption, size: 64, stroke: 7 })
    : o.icon ? `<span class="rd-tile__ico">${iconSvg(o.icon, { size: 20 })}</span>` : "";
  return `<div class="rd-tile${slot ? " rd-tile--slot" : ""}">
    ${slot ? `<div class="rd-tile__slot">${slot}</div>` : ""}
    <div class="rd-tile__lbl">${escapeHTML(o.label)}</div>
    <div class="rd-tile__val"${o.numKey ? dn(o.numKey) : ""}>${escapeHTML(o.value)}</div>
    ${d ? `<div class="rd-tile__delta">${d}<span class="rd-tile__prev">${escapeHTML(_rdPrevLbl())}</span></div>` : ""}
    ${o.sub ? `<div class="rd-tile__sub">${escapeHTML(o.sub)}</div>` : ""}
    ${o.extra ? `<div class="rd-tile__extra">${o.extra}</div>` : ""}
    ${o.pie || ""}
    ${g && !o.sinCaption ? `<div class="rd-tile__cap${conAnillo ? "" : " rd-tile__cap--none"}"${g.tip ? ` title="${escapeHTML(g.tip)}"` : ""}>${escapeHTML(g.caption)}</div>` : ""}
  </div>`;
}

// Minigráfico de línea (tiles por ciudad). Decorativo en lo visual pero con
// nombre accesible: la cifra y su variación ya están en texto al lado.
function _rdSpark(vals, label, color, w = 96, h = 28) {
  const v = vals.filter(x => x != null && Number.isFinite(x));
  if (v.length < 2) return "";
  const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
  const pts = vals.map((x, i) => x == null || !Number.isFinite(x) ? null :
    `${(i / (vals.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (x - mn) / rg * (h - 6)).toFixed(1)}`)
    .filter(Boolean).join(" ");
  return `<svg class="rd-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHTML(label)}" style="color:${escapeHTML(color)}">` +
    `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Encabezado de sección (sin icono ni color: el título de la PÁGINA y su
// alcance ya los pinta el shell).
function _rdSec(title, sub = "", right = "") {
  return `<div class="rd-sec"><div class="rd-sec__titles"><h2 class="rd-sec__title">${escapeHTML(title)}</h2>` +
    (sub ? `<div class="rd-sec__sub">${escapeHTML(sub)}</div>` : "") + `</div>${right}</div>`;
}

// Tarjeta de gráfico con botón PNG (dlChart).
function _rdChart(id, title, name, caption = "") {
  return `<div class="ui-card rd-chart">
    <div class="rd-chart__head"><span class="rd-chart__title">${escapeHTML(title)}</span>${
      btn({ label: "PNG", variant: "ghost", size: "sm", icon: "download", act: "dlChart", data: { chart: id, name }, title: t("rd.png") })}</div>
    <div id="${escapeHTML(id)}" class="rd-chart__plot"></div>
    ${caption ? `<div class="rd-chart__caption">${escapeHTML(caption)}</div>` : ""}
  </div>`;
}

function _rdEmpty(title, text) {
  return `<div class="${RD_VIEW}">${rendLineToggleHTML()}${emptyState({ icon: "filter", title, text })}</div>`;
}

// ── Avance contra la meta del mes (lo que muestra la pestaña Metas) ──────────
// El % y la meta tienen que ser EXACTAMENTE los de Metas para la misma línea,
// filtros y mes: salen de metas.metasResumenPais, la MISMA función con la que
// Metas arma sus tarjetas del resumen (única fuente). La proyección (solo el mes
// en curso, domain/mesEnCurso) se decide dentro de cada llamada — no depende de
// qué se abrió antes en Metas.
//
// OJO al leer la tarjeta: el valor grande de N+R/Horas es el ACUMULADO DEL
// RANGO (puede abarcar varios meses), mientras el avance compara el actual DEL
// MES de la meta. Por eso el caption dice ese actual explícito ("Septiembre:
// 6,371 de 8,758 · 72.7%"): sin él, los dos números no cuadran a simple vista.
// Excepción: escala mensual con el mes EN CURSO — ahí el valor grande ES el del
// mes y el acumulado del rango va en una línea chica (ver _renderRendImpl).
export function _rendMetaMes(line, lastDate, over = null) {
  if (!lastDate || !(STATE.metasData || []).length) return null;
  const ym = reportYM(lastDate, STATE.curMode, parseLocalDate);
  const op = opcionesMesMeta(STATE.metasData).find(o => mesNumero(o.mes) === ym.m && (o.anio == null || o.anio === ym.y));
  if (!op) return null;
  const f = getCurrentFilters();
  const mesDates = _metasFechasDelMes(op.mes, op.anio, f.from, f.to);
  const total = _metasFechasMesCompleto(op.mes, op.anio, f.to).length;
  if (!mesDates.length) return null;
  // `over`: filtros que pisan a los del panel (Desempeño pide la meta por
  // ciudad y por KAM con la MISMA función que el total).
  const filtros = { city: f.city, kam: f.kam, selected: f.selected, ...over };
  let res;
  try {
    res = metasResumenPais({ line, mesName: op.mes, anio: op.anio, fechas: mesDates, filtros });
  } catch (e) {
    console.warn("[rend] no se pudo calcular la meta del mes", e);
    return null;
  }
  if (!res || res.sinMetas) return null;
  let kpis = res.kpis || {};
  if (!Object.values(kpis).some(k => k && k.meta != null && k.meta > 0)) return null;
  // Diario: el AD de UN día contra la meta MENSUAL (conductores del mes) no se
  // compara — daba "no llega · faltan 24,788" (30-sep-2026). N+R y Horas sí
  // acumulan dentro del mes, así que siguen.
  if (STATE.curMode === "diario" && kpis.ad) kpis = { ...kpis, ad: { ...kpis.ad, actual: null, pct: null, proj: null, pctProj: null, noComparable: true } };
  // Semanal: el AD de UNA semana contra la meta de conductores del MES tampoco
  // es comparable (prod. agosto: ~27,500 por semana vs 47,816 en el mes → la
  // tarjeta de Miguel decía 44%). Decisión de Manuel (30-sep-2026): en semanal
  // AD se lee SOLO por su proyección (máx × 1.4). La proyección pasa a ser el
  // "actual" de AD para todo lo de abajo (anillo, ¿llegamos?, ciudades, KAMs);
  // `adSemana` conserva el nivel de la semana. Sin proyección (mes cerrado) no
  // se compara, igual que en diario.
  if (STATE.curMode === "semanal" && kpis.ad && kpis.ad.meta > 0) {
    const a = kpis.ad, cu = a.cuota;
    const pp = cu ? a.pctProj : (a.proj != null && Number.isFinite(a.proj) ? a.proj / a.meta * 100 : null);
    kpis = { ...kpis, ad: pp == null || !Number.isFinite(pp)
      ? { ...a, actual: null, pct: null, proj: null, pctProj: null, noComparable: true, noCompSemanal: true }
      : { ...a, adSemana: a.actual, actual: cu ? cu.proj : a.proj, pct: pp, proj: null, pctProj: null, soloProy: true,
          cuota: cu ? { ...cu, actual: cu.proj, pct: pp, proj: null, pctProj: null } : cu } };
  }
  // Nombre del mes con la mayúscula natural de cada idioma dentro de una frase
  // ("septiembre" / "September" / "сентябрь"); sin Intl, el de mesLabel.
  let mesTxt = mesLabel(op.mes);
  try {
    mesTxt = new Intl.DateTimeFormat(getLang(), { month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(2000, ym.m - 1, 15)));
  } catch (e) { /* mesLabel */ }
  // Mensual con el mes en curso: hasta qué día llegan los datos con los que se
  // proyecta (el mismo corte que usa Metas — shared/mesReporte).
  const corte = STATE.curMode === "mensual" && res.proyOn
    ? (diasMesReporteDe(STATE, mesDates[mesDates.length - 1], parseLocalDate).corte || "") : "";
  return {
    mes: op.mes, anio: op.anio, corte,
    mesTxt,                         // dentro de una frase
    mesCap: mesLabel(op.mes),       // al comienzo del caption
    enRango: mesDates.length, total,
    kpis, mesDates, filtros, proyOn: !!res.proyOn
  };
}
// Cómo se lee el actual de cada KPI contra la meta del mes: nivel del último
// período (snapshots), acumulado del mes (flujos) o tasa del mes (Fleet).
const _RD_META_TIPO = { ad: "nivel", cars: "nivel", nr: "mes", sh: "mes", shCar: "tasa", accept: "tasa" };
function _rdGoal(info, id) {
  if (!info) return undefined;
  const k = info.kpis[id];
  if (!k || !(k.meta > 0)) return { pct: null, caption: t("rd.meta.sinMetaDe", { m: info.mesTxt }) };
  if (k.noComparable) return { pct: null, caption: t(k.noCompSemanal ? "ds.ad.semCerrado" : "ds.ad.diario", { n: k.F(k.meta) }) };
  if (k.soloProy) return { pct: k.pct, caption: t("ds.ad.semProy", { m: info.mesCap, a: k.F(Math.round(k.actual)), n: k.F(k.meta), p: k.pct.toFixed(1) + "%" }) };
  if (k.actual == null || k.pct == null || !Number.isFinite(k.pct))
    return { pct: null, caption: t("rd.meta.soloMeta", { m: info.mesTxt, n: k.F(k.meta) }) };
  const tipo = _RD_META_TIPO[id] || "mes";
  const key = tipo === "nivel" ? "rd.meta.capNivel" : tipo === "tasa" ? "rd.meta.capTasa" : "rd.meta.capMes";
  // Línea TukTuk: el % es el de las cuentas con cuota declarada (mismo cálculo
  // que Metas, viene en k.cuota) y el caption dice sobre qué cifra se mide.
  const cu = k.cuota;
  let caption = cu
    ? t("rd.meta.capCuota", { m: info.mesCap, a: k.F(cu.actual ?? 0), n: k.F(k.meta), p: k.pct.toFixed(1) + "%", c: cu.n, t: cu.total })
    : t(key, { m: info.mesCap, a: k.F(k.actual), n: k.F(k.meta), p: k.pct.toFixed(1) + "%" });
  let projPct = null;
  // Decisión 4 de Manuel (domain/mesEnCurso): la proyección solo para el mes en
  // curso — ya viene en null si no corresponde.
  if (cu ? k.pctProj != null && Number.isFinite(k.pctProj) : k.proj != null && Number.isFinite(k.proj)) {
    projPct = cu ? k.pctProj : (k.proj / k.meta) * 100;
    caption += " · " + t("rd.meta.proy", { p: projPct.toFixed(1) + "%" });
  }
  // Solo en los FLUJOS: la proyección de AD (máx × 1.4) no depende del corte.
  const tip = projPct != null && info.corte && tipo === "mes" ? t("rd.mesCurso.corte", { c: d2s(info.corte) }) : "";
  return { pct: k.pct, caption, projPct, tip };
}
function _rdGoalNota(info) {
  if (!info) return "";
  let txt = t("rd.meta.nota", { m: info.mesTxt, n: info.enRango, t: info.total });
  if (STATE.curMode !== "mensual") txt += " " + t("rd.meta.notaEscala");
  if (info.kpis.ad && info.kpis.ad.soloProy) txt += " " + t("ds.ad.notaSem");
  return `<p class="rd-note">${iconSvg("info", { size: 14 })}<span>${escapeHTML(txt)}</span></p>`;
}

// ── Selector de línea ────────────────────────────────────────────────────────
const _RD_LINEAS = [
  { value: "comb",  icon: "activity", label: () => t("rend.linea.comb") },
  { value: "agg",   icon: "taxi",     label: () => t("rend.linea.agg") },
  { value: "fleet", icon: "car",      label: () => "Fleet" },
  { value: "tk",    icon: "tuktuk",   label: () => "TukTuk" }
];
export function rendLineToggleHTML() {
  const line = _rendLine();
  // `data-line` además de `data-value`: el shell (quitar el chip de línea)
  // busca [data-act="setRendLine"][data-line="comb"].
  const seg = String(segmented({
    options: _RD_LINEAS.map(d => ({ value: d.value, label: d.label(), icon: d.icon })),
    value: line, act: "setRendLine", ariaLabel: t("rd.linea.aria")
  })).replace(/data-value="([a-z]+)"/g, 'data-value="$1" data-line="$1"');
  return `<div class="rd-toolbar">${seg}</div>`;
}
export async function setRendLine(line) {
  if (!line) return;
  if ((STATE.rendLine || "comb") === line) return;
  STATE.rendLine = line;
  // El scorecard "Fleet · Calidad y Dependencia" lee 6 columnas que el arranque
  // NO pide (ver TX_DEFERRED_COLS). Sin esperarlas, la tarjeta se pintaría con
  // ceros — que no se distinguen de un negocio con 0% de fraude. La precarga en
  // idle suele haberlas traído ya, así que en la práctica esto no espera nada.
  if (line === "fleet" && typeof ensureFullRendColumns === "function") {
    try { await ensureFullRendColumns(); } catch (e) { /* nunca bloquear el render */ }
    if ((STATE.rendLine || "comb") !== line) return;   // el usuario ya cambió de línea
  }
  renderRend();
}

// Guard de reentrancia: evita que dos renderRend() concurrentes se pisen.
// Si llega un segundo render mientras el primero corre, se descarta.
export let _renderRendBusy  = false;
// Token incremental: la cola de charts diferidos verifica este token. Si llega
// un nuevo renderRend, el pump de charts del render anterior se aborta.
export let _renderRendToken = 0;

export function renderRend() {
  if (_renderRendBusy) return;
  if (!STATE.rawData.length) return;
  // B12: con la escala recién cambiada (o la mensual restaurada al arrancar)
  // curMode ya dice "mensual" pero rawData sigue siendo el semanal hasta que
  // switchMode termina la carga. Pintar en ese hueco mostraba números semanales
  // bajo rótulos mensuales. Se muestra "cargando" y se reintenta solo.
  if (!escalaLista(STATE)) {
    _rendPintarCargandoEscala();
    // 2-oct-2026 — "se queda cargando para siempre": si curMode dice mensual/
    // diario pero NADIE está cargando esa escala (pasó al entrar con otro
    // usuario sin recargar: la escala del anterior quedaba en memoria y los
    // datos que llegaban eran semanales), esperar no sirve de nada. Se pide la
    // carga; switchMode ignora el pedido si ya hay una en curso.
    if (typeof window.switchMode === "function" && STATE.curMode !== "semanal") window.switchMode(STATE.curMode);
    reintentarCuandoEscalaLista("rend", STATE, renderRend, () => STATE.curTab === "rend", 200, 60000, _rendPintarEscalaFallida);
    return;
  }
  _renderRendBusy  = true;
  _renderRendToken++;
  try {
    _renderRendImpl();
  } finally {
    _renderRendBusy = false;
  }
}

function _rendPintarCargandoEscala() {
  const empty   = document.getElementById("rendEmpty");
  const content = document.getElementById("rendContent");
  if (!content) return;
  if (empty) empty.style.display = "none";
  content.style.display = "";
  destroyAllCharts();
  content.innerHTML = `<div class="${RD_VIEW}">${rendLineToggleHTML()}${emptyState({
    icon: "refresh", title: t("carga.escala", { e: t("mode." + (STATE.curMode || "semanal")) }) })}</div>`;
}

// Se agotó la espera: decirlo y dar una salida (antes quedaba el spinner eterno).
function _rendPintarEscalaFallida() {
  const content = document.getElementById("rendContent");
  if (!content || STATE.curTab !== "rend") return;
  content.innerHTML = `<div class="${RD_VIEW}">${rendLineToggleHTML()}${emptyState({
    icon: "alert-triangle", title: t("carga.escalaFalla", { e: t("mode." + (STATE.curMode || "semanal")) }),
    text: t("carga.escalaFallaTxt"),
    action: btn({ label: t("app.reintentar"), icon: "refresh", variant: "primary", act: "reloadApp" }) })}</div>`;
}

// Alcance de los filtros activos (I13). Vacío = sin recorte. Hoy el título y
// los chips de alcance los pinta el shell; se conserva para quien lo use.
export function _rendAlcance() {
  const f = getCurrentFilters();
  return partesAlcance({
    city: f.city, kam: kamLabel(f.kam),   // SIN_KAM → etiqueta traducida ("all" pasa igual)
    nSel: (f.selected || []).length,
    nTotal: document.querySelectorAll("#pList input").length
  }, t, cityLabel);
}

// Comparativa entre ciudades: valores absolutos o índice base 100 (ver
// _rdPintarCiudades). Estado de la sesión, no persistido.
let _rdCiudadModo = "indice";
let _rdCiudadData = null;

export function _renderRendImpl() {
  // Garantiza índices secundarios construidos (defensivo contra cache/races)
  ensureIndexes();

  // Destruir charts existentes ANTES de borrar sus DIVs con innerHTML
  // (evita instancias huérfanas y memory leak en cada re-render)
  destroyAllCharts();

  const line      = _rendLine();
  const filtered  = _rendLineFiltered();
  const apd       = aggPDc(filtered);
  const byDate    = aggDatec(filtered);
  const dates     = [...new Set(apd.map(r => r.date))].sort();
  const partners  = getSel();
  const empty     = document.getElementById("rendEmpty");
  const content   = document.getElementById("rendContent");

  // Sin partners seleccionados → empty global (mensaje de carga: aún no hay data en
  // memoria, o el usuario deschequeó todo).
  if (!partners.length) {
    empty.style.display   = "";
    content.style.display = "none";
    return;
  }
  // Agregador con partners seleccionados pero 0 filas en el filtro actual: NO es "falta
  // cargar data" (el empty global mentiría) — casi siempre Ciudad+KAM/partners sin overlap
  // (ej. Ciudad=Arequipa + KAM cuyos partners solo operan en Lima). Mensaje inline nombrando
  // la combinación exacta, mismo patrón que el empty de Fleet/TukTuk de abajo.
  if (!filtered.length && line === "agg") {
    empty.style.display   = "none";
    content.style.display = "";
    const f = getCurrentFilters();
    const partes = [];
    if (f.kam  !== "all") partes.push(t("alcance.kam", { k: kamLabel(f.kam) }));
    if (f.city !== "all") partes.push(cityLabel(f.city));
    content.innerHTML = _rdEmpty(t("rd.sinOverlap.titulo"),
      t("rd.sinOverlap.texto", { a: partes.length ? partes.join(" · ") : t("rd.filtrosActuales") }));
    return;
  }
  // Fleet/TukTuk sin datos para el filtro: mantener el toggle visible (para volver a
  // Agregador) + empty inline. NO usar el empty global (dejaría al usuario atrapado).
  if (!filtered.length) {
    empty.style.display   = "none";
    content.style.display = "";
    const lname = line === "fleet" ? "Fleet" : line === "comb" ? t("rend.lineaCombTxt") : "TukTuk";
    content.innerHTML = _rdEmpty(t("rd.sinDatosLinea.titulo", { l: lname }), t("rd.sinDatosLinea.texto"));
    return;
  }
  empty.style.display   = "none";
  content.style.display = "";

  // Cachear filtered por ciudad (se usa en la tabla por ciudad y en los charts)
  const filteredByCity = {};
  CITIES.forEach(city => {
    filteredByCity[city] = filtered.filter(r => r.city === city);
  });

  // lastDate = fecha "Hasta" del filtro
  const toDate   = document.getElementById("dateTo").value;
  const lastDate = dates.filter(d => d <= toDate).slice(-1)[0] || dates[dates.length - 1] || "";

  // prevDate = semana inmediatamente anterior a lastDate en TODOS los datos
  const allDates = STATE.allDates;
  const lastIdx  = allDates.indexOf(lastDate);
  const prevDate = lastIdx > 0 ? allDates[lastIdx - 1] : "";

  // Mensual con el mes EN CURSO: los deltas son contra el mes anterior COMPLETO
  // y lo dicen (ver _rdMesPrevCompleto). Antes del corte de Fleet: su vista
  // también compara el mes a medias contra el anterior completo.
  const ymUlt = lastDate ? reportYM(lastDate, STATE.curMode, parseLocalDate) : null;
  const mesParcial = STATE.curMode === "mensual" && !!ymUlt && esMesEnCurso(ymUlt.m, ymUlt.y);
  _rdMesPrevCompleto = mesParcial ? mesAnterior(ymUlt.y, ymUlt.m).m : 0;

  // prevRows: datos de prevDate fuera del rango filtrado
  const cityFilter = document.getElementById("cityFilter").value;
  const selSet     = new Set(getSel());
  const _sidebarSet = new Set(STATE.sidebarPartners || STATE.allPartners);
  // Lookup de la línea activa (agg usa _byDate; fleet/tk/comb filtran su slice).
  const _prevAll = _rendLinePrev(prevDate, null);
  const prevFiltered = _prevAll.filter(r =>
    (cityFilter === "all" || r.city === cityFilter) &&
    _lineSelHas(selSet, _sidebarSet, r.partner)
  );
  const prevAPD = aggPD(prevFiltered);

  // Fleet: vista SOLO de KPIs de flota (columnas fleet-scoped). El AD/SH/N+R a nivel
  // fleetroom mezcla actividad agregador+fleet del MISMO fleetroom → sería un falso
  // negativo. Solo se muestran owned cars / SH-auto interno / aceptación / branded,
  // que sí son columnas propias de la sub-flota. Se corta antes de las secciones
  // genéricas y del pump de charts.
  if (line === "fleet") {
    const fLastRows = filtered.filter(r => r.date === lastDate);
    content.innerHTML = _renderFleetView(fLastRows, prevFiltered, lastDate, prevDate);
    _scheduleFleetCharts(filtered, dates, fLastRows);
    return;
  }

  const lastRows = apd.filter(r => r.date === lastDate);
  const prevRows = prevAPD;

  const tAD = sumR(lastRows, r => r.activeDrivers);
  const pAD = sumR(prevRows, r => r.activeDrivers);
  const tNR = sumR(apd,      r => r.newPartner + r.newService + r.reactivated);
  const lNR = sumR(lastRows, r => r.newPartner + r.newService + r.reactivated);
  const pNR = sumR(prevRows, r => r.newPartner + r.newService + r.reactivated);
  const tSH = sumR(apd,      r => r.supplyHours);
  const lSH = sumR(lastRows, r => r.supplyHours);
  const pSH = sumR(prevRows, r => r.supplyHours);
  const tTR = sumR(apd,      r => r.trips || 0);
  const lTR = sumR(lastRows, r => r.trips || 0);
  const pTR = sumR(prevRows, r => r.trips || 0);

  const periodLabel = _rendPeriodLabel();
  let html = `<div class="${RD_VIEW}">` + rendLineToggleHTML();

  // ── 1. KPIs del país (o del alcance filtrado) ─────────────────────────────
  // El valor de N+R/Horas/Viajes es el ACUMULADO del rango; el delta compara el
  // último período contra el anterior (igual que antes). El avance contra la meta
  // es el de la pestaña Metas para el mes del último período (ver _rendMetaMes).
  const metaInfo = _rendMetaMes(line, lastDate);
  const acum = t("rend.lbl.acumRango");
  // ── Escala MENSUAL con el último período = mes EN CURSO (24-sep-2026) ──────
  // La fila del mes es el acumulado A LA FECHA:
  //   1. N+R/Horas mostraban el ACUMULADO DEL RANGO (p.ej. mar–sep: 61,645)
  //      mientras el anillo habla solo de septiembre (6,371 de 8,758). Con meta,
  //      el valor grande pasa a ser el del mes (el MISMO actual del anillo, de
  //      metasResumenPais) y el del rango queda en una línea chica (conserva su
  //      data-num). AD ya era el nivel del último período = el del anillo.
  //   2. El delta compara el mes a la fecha contra el resultado FINAL del mes
  //      anterior (decisión de Manuel: "así de simple") y el rótulo lo dice:
  //      "vs agosto (mes completo)" (_rdPrevLbl), igual que en Metas.
  //   3. La proyección de flujos se prorratea por días en metas.ts
  //      (_metasDiasProy), así Rendimiento y Metas dan la misma.
  // Fuera de este caso (semanal, diario o mes cerrado) nada cambia.
  const flujoMes = (id, totalRango, numKey) => {
    const k = mesParcial && metaInfo ? metaInfo.kpis[id] : null;
    if (!k || !(k.meta > 0) || k.actual == null || !Number.isFinite(k.actual)) {
      return { value: fmt(totalRango), numKey, sub: acum };
    }
    return {
      value: fmt(k.actual), numKey: numKey + ".mes",
      sub: t("rd.mesCurso.sub", { m: metaInfo.mesCap }),
      extra: `<span>${escapeHTML(t("rd.mesCurso.rango"))}:</span> <strong${dn(numKey)}>${escapeHTML(fmt(totalRango))}</strong>`
    };
  };
  const vNR = flujoMes("nr", tNR, "rend.pais.nr");
  const vSH = flujoMes("sh", tSH, "rend.pais.sh");
  // Sin encabezado de sección (como el prototipo B): qué mide cada tile lo dice
  // su propia línea "última semana (14/09/2026)" / "acumulado del rango".
  // Franja "¿Llegamos a la meta?" (Desempeño, 29-sep-2026).
  // "¿Llegamos?": una mini-tarjeta al pie de cada KPI (Manuel, 30-sep).
  const franja = _dsLlegamos(metaInfo, lastDate);
  html += `<h2 class="ui-sr-only">${escapeHTML(t("rd.kpis.titulo"))}</h2>`;
  html += `<div class="rd-kpis rd-kpis--tiles">
    ${_rdKpi({ label: t("metric.ad.label"), value: fmt(tAD), numKey: "rend.pais.ad", cur: tAD, prev: pAD, sub: `${periodLabel} (${d2s(lastDate)})`, goal: _rdGoal(metaInfo, "ad"), icon: "users", sinCaption: !!franja, pie: franja && franja.ad })}
    ${_rdKpi({ label: t("metric.nr.label"), ...vNR, cur: lNR, prev: pNR, goal: _rdGoal(metaInfo, "nr"), icon: "user", sinCaption: !!franja, pie: franja && franja.nr })}
    ${_rdKpi({ label: t("metric.sh.label"), ...vSH, cur: lSH, prev: pSH, goal: _rdGoal(metaInfo, "sh"), icon: "clock", sinCaption: !!franja, pie: franja && franja.sh })}
    ${_rdKpi({ label: t("metric.tr.label"), value: fmt(tTR), numKey: "rend.pais.tr", cur: lTR, prev: pTR, sub: acum, icon: "car",
               goal: metaInfo ? { pct: null, caption: t("rd.meta.sinMetaMensual") } : undefined })}
  </div>`;
  html += _rdGoalNota(metaInfo);

  // ── 1b. KPIs propios de TukTuk (Fleet tiene su vista dedicada arriba) ───────
  if (line === "tk") {
    html += _rendTkKPIs(filtered.filter(r => r.date === lastDate), prevFiltered, metaInfo);
  }

  // ── 1c. Flujo de conductores: ganados, perdidos, neto y retención ──────────
  const _filtrarPrev = d => aggPD(_rendLinePrev(d, null).filter(r =>
    (cityFilter === "all" || r.city === cityFilter) && _lineSelHas(selSet, _sidebarSet, r.partner)));
  const flujo = _dsFlujoData(apd, dates, lastDate, prevDate, prevRows, mesParcial, _filtrarPrev);
  // ORDEN DE LECTURA (Manuel, 30-sep-2026, "imagina que eres el Head de
  // Partners"): KPIs → ciudades → KAMs → gráficas de partners → quién se movió
  // → lo demás (flujo, tendencias contra la meta, comparativa…). Cada bloque se
  // arma donde tiene sus datos y se reordena abajo con estas marcas.
  const _m0 = html.length;
  html += _dsFlujoHTML(flujo);
  const _m1 = html.length;
  // Estado contra la meta por partner: tabla de partners y "más lejos de su meta".
  const estados = _dsEstadoPorPartner(line, metaInfo);
  _dsTablaCtx = { estados, flujo };

  // ── 2. Por ciudad (un tile por ciudad, con minigráfico) ─────────────────────
  const ciudades = [];
  CITIES.forEach(city => {
    const cr = filteredByCity[city];
    if (!cr.length) return;
    const ca   = aggPD(cr);
    const cL   = ca.filter(r => r.date === lastDate);
    // prevDate para ciudad, según la línea activa (agg usa índice; fleet/tk/comb su slice)
    const _cPrev = _rendLinePrev(prevDate, city);
    const cPraw = _cPrev.filter(r => _lineSelHas(selSet, _sidebarSet, r.partner));
    const cP   = aggPD(cPraw);
    ciudades.push({
      city,
      ad:  sumR(cL, r => r.activeDrivers),
      nr:  sumR(cL, r => r.newPartner + r.newService + r.reactivated),
      sh:  sumR(cL, r => r.supplyHours),
      tr:  sumR(cL, r => r.trips || 0),
      pad: sumR(cP, r => r.activeDrivers),
      pnr: sumR(cP, r => r.newPartner + r.newService + r.reactivated),
      psh: sumR(cP, r => r.supplyHours),
      ptr: sumR(cP, r => r.trips || 0)
    });
  });
  // Serie por fecha de cada ciudad con datos: la usan los minigráficos de los
  // tiles y las 4 gráficas de "Comparativa por ciudad" (ver _rdPintarCiudad).
  const citiesWithData = CITIES.filter(c => (filteredByCity[c] || []).length);
  _rdCiudadData = {
    dates,
    cities: citiesWithData,
    byDate: citiesWithData.map(c => aggCityDatec(filteredByCity[c], c))
  };
  const metaCiudad = {};
  if (ciudades.length) {
    html += _rdSec(t("rend.ciudad.titulo"), mesParcial
      ? t("rd.ciudad.subVs", { p: periodLabel, v: _rdPrevLbl() })
      : t("rd.ciudad.sub", { p: periodLabel }));
    if (metaInfo) ciudades.forEach(c => { metaCiudad[c.city] = _dsMetaGrupo(line, lastDate, { city: c.city }); });
    html += _rdCiudadTiles(ciudades, _rdCiudadData, metaCiudad);
  }

  const _m2 = html.length;
  // ── 3. Quién se movió (lo más accionable: a quién llamar) ──────────────────
  // Los 5 que más subieron y los 5 que más cayeron en Conductores Activos vs el
  // período anterior. Se excluyen los partners sin base previa (no es una caída,
  // es que no había con qué comparar).
  // Métrica elegible (N+R por defecto — la que más le dice a Manuel si un
  // partner va a crecer; AD en semanal/diario casi no se mueve de un período a
  // otro porque es un nivel, no un acumulado).
  _dsMovCtx = { lastRows, prevRows, estados, prevDate };
  html += `<div id="dsMovers">${_dsMoversHTML()}</div>`;

  const _m3 = html.length;
  // ── 4. Tendencias ─────────────────────────────────────────────────────────
  // Perú por partner: top 8 por Conductores Activos del último período, sin
  // "Otros" dibujado (ni segundo eje): lo que queda fuera se dice en el pie.
  const partnersConDatos = [...new Set(apd.map(r => r.partner))];
  const top = rendTopPartners(dates, partnersConDatos, byDate);
  const ultima = dates[dates.length - 1];
  const pieTop = metric => {
    if (partnersConDatos.length <= top.length) return t("rd.tend.todos", { n: partnersConDatos.length });
    const topSet = new Set(top);
    const resto = partnersConDatos.filter(p => !topSet.has(p))
      .reduce((s, p) => s + (valorMetricaPartner(byDate, p, ultima, metric) || 0), 0);
    return t("rd.tend.pie", { k: top.length, n: partnersConDatos.length, x: metric === "tr" || metric === "sh" ? fmtSmart(resto) : fmt(resto) });
  };
  // Tendencia con la meta DIBUJADA (Desempeño): AD contra el nivel de meta del
  // mes; N+R acumulado del mes contra el ritmo lineal que llega a la meta.
  const adMetaOk = !!(metaInfo && metaInfo.kpis.ad && metaInfo.kpis.ad.meta > 0 && !metaInfo.kpis.ad.noComparable);
  const nrMetaOk = !!(metaInfo && metaInfo.kpis.nr && metaInfo.kpis.nr.meta > 0);
  const conMetaChart = adMetaOk || nrMetaOk;
  if (conMetaChart) {
    html += _rdSec(t("ds.tend.meta.titulo", { m: metaInfo.mesTxt }), t("ds.tend.meta.sub"));
    const adSP = metaInfo.kpis.ad && metaInfo.kpis.ad.soloProy;
    html += `<div class="rd-grid-2">${adMetaOk ? _rdChart("dsCh_adMeta", t(adSP ? "ds.tend.adMetaProy" : "ds.tend.adMeta"), "AD_vs_meta", t(adSP ? "ds.tend.adMetaProyPie" : "ds.tend.adMetaPie")) : ""}${nrMetaOk ? _rdChart("dsCh_nrMeta", t("ds.tend.nrMeta"), "NR_vs_meta", t("ds.tend.nrMetaPie")) : ""}</div>`;
  }
  const _m4 = html.length;
  html += _rdSec(t("rend.tend.titulo"), t("rd.tend.sub"));
  html += `<div class="rd-grid-2">
    ${_rdChart("chP_ad", t("rend.ch.condActivos"), "AD_Peru", pieTop("ad"))}
    ${_rdChart("chP_nr", t("rend.ch.nuevosReact"), "NR_Peru", pieTop("nr"))}
    ${_rdChart("chP_sh", t("metric.sh.label"),     "SH_Peru", pieTop("sh"))}
    ${_rdChart("chP_tr", t("metric.tr.label"),     "Viajes_Peru", pieTop("tr"))}
  </div>`;

  const _m5 = html.length;
  // ── 5. Comparativa entre ciudades: UNA gráfica por métrica con una línea por ciudad.
  // Lima es ~7 veces Trujillo/Arequipa: en valores absolutos las dos quedan
  // aplastadas contra el piso. Por defecto se muestra el ÍNDICE (primer período
  // del rango = 100), que compara RITMOS; "Valores" vuelve a las cifras. Se
  // eligió el índice y no small multiples (3 ciudades × 4 métricas = 12 gráficos)
  // porque cada render de ApexCharts bloquea 30-80 ms y la vista ya pasó de 16 a
  // 8 gráficos por eso; además el índice responde directo "¿qué ciudad crece más?".
  if (citiesWithData.length) {
    const toggle = String(segmented({
      options: [{ value: "indice", label: t("rd.ciudad.indice") }, { value: "valores", label: t("rd.ciudad.valores") }],
      value: _rdCiudadModo, act: "setRendCiudadModo", ariaLabel: t("rd.ciudad.modoAria")
    }));
    html += _rdSec(t("rend.comparativaCiudad"), "", `<div class="rd-sec__right" id="rdCiudadModo">${toggle}</div>`);
    html += `<p class="rd-note" id="rdCiudadNota">${iconSvg("info", { size: 14 })}<span>${escapeHTML(_rdCiudadNota(dates))}</span></p>`;
    html += `<div class="rd-grid-2">
      ${_rdChart("chC_ad", t("rend.ch.condActivos"), "AD_Ciudades")}
      ${_rdChart("chC_nr", t("rend.ch.nuevosReact"), "NR_Ciudades")}
      ${_rdChart("chC_sh", t("metric.sh.label"),     "SH_Ciudades")}
      ${_rdChart("chC_tr", t("metric.tr.label"),     "Viajes_Ciudades")}
    </div>`;
  }

  const _m6 = html.length;
  // ── 6. Por KAM (tabla: último período + acumulado del rango) ────────────────
  const metaKam = {};
  // Por KAM: el ACTUAL también se acota a sus partners (metasResumenPais filtra
  // la meta por `kam` pero el actual solo por `selected`): sin esto el % daba
  // 340% (actual de todos contra la meta de uno).
  if (metaInfo) Object.keys(STATE.KAM_PARTNERS || {}).forEach(k => {
    const suyos = new Set(STATE.KAM_PARTNERS[k] || []);
    metaKam[k] = _dsMetaGrupo(line, lastDate, { kam: k, selected: (metaInfo.filtros.selected || []).filter(p => suyos.has(p)) });
  });
  if (metaInfo) {
    // Avance de cada KAM en tarjetas con barras (Manuel, 30-sep: "más visual y
    // que entienda rápido cuánto va de avance de su meta"); la tabla de
    // último período y acumulado queda plegada debajo.
    html += _dsKamAvanceHTML(metaInfo, metaKam, lastRows, estados);
    html += `<details class="ds-kam-det"><summary>${iconSvg("chevron-down", { size: 14 })}<span>${escapeHTML(t("ds.kamc.detalle"))}</span></summary>${_rendKamSeccion(apd, lastRows, prevRows, null, true)}</details>`;
  } else {
    html += _rendKamSeccion(apd, lastRows, prevRows, null);
  }
  // Accionables (experimental): se llenan después de buildTable, que arma el
  // resumen por partner con su historia (declive) y su estado contra la meta.
  html += `<div id="dsAcc"></div>`;
  {
    const _m7 = html.length;
    const parte = (a, b) => html.slice(a, b);
    const flujoH = parte(_m0, _m1), ciudadH = parte(_m1, _m2), moversH = parte(_m2, _m3),
          tendMetaH = parte(_m3, _m4), tendH = parte(_m4, _m5), compH = parte(_m5, _m6), kamH = parte(_m6, _m7);
    html = html.slice(0, _m0) + ciudadH + kamH + tendH + moversH + flujoH + tendMetaH + compH;
  }

  // ── 7. Productividad ──────────────────────────────────────────────────────
  // Ratios, no volúmenes: responden "¿cada conductor rinde más o menos?", que es
  // una pregunta distinta de "¿tenemos más conductores?". Un mes puede crecer en
  // AD y caer en horas por conductor — sin estos ratios eso pasa desapercibido.
  const prodOf = rs => {
    const ad = sumR(rs, r => r.activeDrivers), sh = sumR(rs, r => r.supplyHours), tr = sumR(rs, r => r.trips || 0);
    return { shAd: ratio(sh, ad), trAd: ratio(tr, ad), trSh: ratio(tr, sh) };
  };
  const pNow = prodOf(lastRows), pPrev = prodOf(prevRows);
  html += _rdSec(t("rend.prod.titulo"), mesParcial
    ? t("rd.prod.subVs", { d: d2s(lastDate), v: _rdPrevLbl() })
    : t("rend.prod.sub", { d: d2s(lastDate) }));
  html += `<div class="rd-kpis rd-kpis--3 rd-kpis--tiles">
    ${_rdKpi({ label: t("rend.kpi.horasCond"),  value: fmt(pNow.shAd),        numKey: "rend.prod.shAd", icon: "clock", cur: pNow.shAd, prev: pPrev.shAd, sub: t("rend.snapshotUlt") })}
    ${_rdKpi({ label: t("rend.kpi.viajesCond"), value: fmt(pNow.trAd),        numKey: "rend.prod.trAd", icon: "car", cur: pNow.trAd, prev: pPrev.trAd, sub: t("rend.snapshotUlt") })}
    ${_rdKpi({ label: t("rend.kpi.viajesHora"), value: pNow.trSh.toFixed(2),  numKey: "rend.prod.trSh", icon: "activity", cur: pNow.trSh, prev: pPrev.trSh, sub: t("rend.snapshotUlt") })}
  </div>`;

  // ── 8. Tabla ───────────────────────────────────────────────────────────────
  // Resumen de leads Yango para el encabezado
  const leadsSet  = new Set(apd.filter(r => r.date === lastDate && r.newService > 0).map(r => r.partner));
  const leadsNote = leadsSet.size > 0
    ? `<div class="rd-leads">${badge(t(leadsSet.size > 1 ? "rd.leadsN" : "rd.leads1", { n: leadsSet.size }), "info", { icon: "star" })}</div>`
    : "";
  html += _rdSec(t("rend.tabla.titulo"), t("ds.tabla.sub"), leadsNote);
  html += `<div id="dsChips"></div>`;
  html += `<div class="ui-table-wrap ui-table-wrap--scroll rd-tabla-wrap rd-tabla-compacta"><div id="tblContainer"></div></div>`;
  // Leyenda de columnas para pantallas táctiles (3-oct-2026): los nombres
  // completos ("Conductores activos" por "Activos"…) vivían solo en el `title`
  // de cada encabezado, que sin mouse no se ve, y tocar el encabezado ordena.
  // Se muestra solo con (hover: none); en escritorio sigue el tooltip.
  html += `<p class="rd-tabla-leyenda">${escapeHTML(t("ds.tabla.leyenda", { ad: t("metric.ad.label"), nr: t("metric.nr.label"), sh: t("metric.sh.label") }))}</p>`;

  // ── 9. Tarjetas por Partner ────────────────────────────────────────────────
  html += _rdSec(t("rend.cards.titulo"), t("rend.cards.sub"));
  html += `<div class="rd-pcards" id="partnerCards"></div>`;
  html += `</div>`;

  content.innerHTML = html;

  // Renders sincronos de tablas (datos, no charts) — relativamente baratos
  buildTable(apd, lastDate, prevDate, partners);
  const _chips = document.getElementById("dsChips");
  if (_chips) _chips.innerHTML = _dsChipsEstado();
  buildPartnerCards(apd, lastDate, prevDate, partners, partners);
  try { _dsPintarAccionables({ flujo, estados, metaInfo, metaCiudad }); }
  catch (e) { console.warn("[desempeño] accionables", e); }

  // ── DIFERIR CHARTS con RAF ─────────────────────────────────────────────────
  // Cada ApexCharts.render() bloquea 30-80ms. Construir 8 en serie congela
  // el main thread ~400ms. Yieldeando entre cada uno: la UI aparece instantanea
  // y los charts pop-in progresivamente sin freezar inputs/scroll del usuario.
  const tokenAtSchedule = _renderRendToken;
  const tabTokenAtSched = STATE._tabRenderId;
  const chartJobs = [
    () => _dsPintarFlujo(flujo),
    () => { if (conMetaChart) _dsPintarMeta(metaInfo, apd, dates); },
    () => buildMultiLine("chP_ad", dates, partnersConDatos, byDate, "ad", null, ESTILO_SUAVE),
    () => buildMultiLine("chP_nr", dates, partnersConDatos, byDate, "nr", null, ESTILO_SUAVE),
    () => buildMultiLine("chP_sh", dates, partnersConDatos, byDate, "sh", null, ESTILO_SUAVE),
    () => buildMultiLine("chP_tr", dates, partnersConDatos, byDate, "tr", null, ESTILO_SUAVE),
  ];
  // Una gráfica por métrica con una serie por ciudad (ver el comentario en la
  // sección de comparativa): 4 renders en vez de 4 × nº de ciudades.
  ["ad", "nr", "sh", "tr"].forEach(metric => {
    chartJobs.push(() => _rdPintarCiudad(metric));
  });

  function pumpCharts(i) {
    if (i >= chartJobs.length) return;
    // Abort si otro renderRend arranco, cambio el tab, o salio de "rend"
    if (_renderRendToken !== tokenAtSchedule)   return;
    if (STATE._tabRenderId !== tabTokenAtSched) return;
    if (STATE.curTab !== "rend")                return;
    try { chartJobs[i](); } catch(e) { console.warn("Chart job", i, "failed:", e); }
    requestAnimationFrame(() => pumpCharts(i + 1));
  }
  requestAnimationFrame(() => pumpCharts(0));
}

// ── Comparativa por ciudad: valores / índice base 100 ────────────────────────
function _rdCiudadNota(dates) {
  return _rdCiudadModo === "indice"
    ? t("rd.ciudad.notaIndice", { d: dates && dates.length ? d2s(dates[0]) : "" })
    : t("rd.ciudad.notaValores");
}
function _rdPintarCiudad(metric) {
  const d = _rdCiudadData;
  if (!d || !d.cities.length) return;
  const tk = chartTokens();
  const series = d.cities.map((c, i) => {
    const vals = d.dates.map(dt => (d.byDate[i][dt] || {})[metric] || 0);
    return { name: cityLabel(c), data: _rdCiudadModo === "indice" ? indiceBase100(vals) : vals };
  });
  const colors = d.cities.map(c => seriesColor(_rdCityIdx(c), tk));
  const extra = _rdCiudadModo === "indice"
    ? { ...ESTILO_SUAVE, yaxis: { labels: { formatter: v => v == null ? "" : Math.round(v) } } }
    : ESTILO_SUAVE;
  buildLineChart("chC_" + metric, d.dates, series, colors, extra);
}
export function setRendCiudadModo(modo) {
  if (modo !== "indice" && modo !== "valores") return;
  if (_rdCiudadModo === modo) return;
  _rdCiudadModo = modo;
  document.querySelectorAll('#rdCiudadModo [data-act="setRendCiudadModo"]').forEach(b =>
    b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === modo)));
  const nota = document.querySelector("#rdCiudadNota span");
  if (nota && _rdCiudadData) nota.textContent = _rdCiudadNota(_rdCiudadData.dates);
  // Re-crear (no updateOptions): cambia el formato del eje Y.
  ["ad", "nr", "sh", "tr"].forEach(m => {
    const id = "chC_" + m;
    if (STATE.charts[id]) { try { STATE.charts[id].destroy(); } catch (e) {} delete STATE.charts[id]; }
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
    _rdPintarCiudad(m);
  });
}

// ── Por ciudad: un tile por ciudad ───────────────────────────────────────────
// Reemplaza a la tabla compacta (prototipo B): conductores activos grandes con
// su variación y minigráfico del rango; N+R, horas y viajes del último período
// con su variación debajo. Mismas cifras, mismo formato y mismas claves de
// huella (rend.ciudad.<métrica>.<ciudad>) que la tabla.
function _rdCiudadTiles(ciudades, serie, metas = null) {
  const rows = ciudades.slice().sort((a, b) => b.ad - a.ad);
  const filas = [
    { k: "nr", l: t("metric.nr.short"), f: fmt,      p: "pnr" },
    { k: "sh", l: t("metric.sh.short"), f: _fmtH,    p: "psh" },
    { k: "tr", l: t("metric.tr.short"), f: fmtSmart, p: "ptr" }
  ];
  return `<div class="rd-cities">${rows.map(r => {
    const i = serie ? serie.cities.indexOf(r.city) : -1;
    const vals = i >= 0 ? serie.dates.map(dt => (serie.byDate[i][dt] || {}).ad || 0) : [];
    const spark = _rdSpark(vals, t("rd.ciudad.sparkAria", { c: cityLabel(r.city) }), _rdCityVar(r.city));
    return `<div class="rd-city">
      <div class="rd-city__head"><span class="rd-city__name">${_rdDot(_rdCityVar(r.city))}${escapeHTML(cityLabel(r.city))}</span>${spark}</div>
      <div class="rd-city__big"><span class="rd-city__val"${dn("rend", "ciudad", "ad", r.city)}>${fmt(r.ad)}</span><span class="rd-city__unit">${escapeHTML(t("rd.ciudad.unidad"))}</span>${_rdDelta(r.ad, r.pad)}</div>
      <dl class="rd-city__rows">${filas.map(c => `<div class="rd-city__row"><dt>${escapeHTML(c.l)}</dt>` +
        `<dd><span class="rd-city__num"${dn("rend", "ciudad", c.k, r.city)}>${c.f(r[c.k])}</span>${_rdDelta(r[c.k], r[c.p])}</dd></div>`).join("")}</dl>
      ${metas && metas[r.city] ? `<div class="ds-city-meta"><div class="ds-city-meta__t">${escapeHTML(t("ds.meta.delMes"))}</div>${_dsMetaFilas(metas[r.city], "ds.ciudad." + r.city)}</div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

// ── Quién se movió ───────────────────────────────────────────────────────────
function _rdMovers(titulo, ico, tono, items, signo) {
  const filas = items.length
    ? items.map(m => `<li class="rd-mov__row">
        <span class="rd-mov__name">${_rdDot(STATE.partnerColors[m.partner] || "var(--cat-other)")}<span>${escapeHTML(m.partner)}</span></span>
        <span class="rd-mov__abs rd-mov__abs--${tono}">${signo}${_fmtH(Math.abs(m.delta))}</span>
        <span class="rd-mov__pct">${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}%</span>
      </li>`).join("")
    : `<li class="rd-mov__vacio">${escapeHTML(t("rend.mov.sinMov"))}</li>`;
  return `<div class="ui-card rd-mov">
    <div class="rd-mov__head rd-mov__head--${tono}">${iconSvg(ico, { size: 16 })}<span>${escapeHTML(titulo)}</span></div>
    <ul class="rd-mov__list">${filas}</ul>
  </div>`;
}

// ── Por KAM ──────────────────────────────────────────────────────────────────
// Una fila por KAM con dos grupos de columnas:
//   · Último período (AD, N+R, Horas, Viajes + delta vs el anterior) — lo que
//     antes eran las tarjetas "Por KAM" (claves rend.kam.*).
//   · Acumulado del rango (N+R, Horas, Viajes) — el desglose que antes vivía
//     dentro de las tarjetas KPI del país (claves rend.pais-kam.*): suma el
//     valor grande de la tarjeta por construcción (B4, partición por KAM).
// Las dos familias tenían reglas de visibilidad distintas y se conservan tal
// cual: rend.kam.* solo para KAMs con filas en el último período (y respetando
// el filtro de KAM); rend.pais-kam.<m> cuando el valor o su previo no es cero.
// El AD del último período es la misma cifra en las dos familias: la celda lleva
// las dos claves anidadas.
function _rendKamSeccion(apd, lastRows, prevRows, metaKam = null, sinTitulo = false) {
  const kamFilterVal = document.getElementById("kamFilter")?.value || "all";
  const kLastBy = particionarPorKam(lastRows, _lineKamOf);
  const kPrevBy = particionarPorKam(prevRows, _lineKamOf);
  const kAllBy  = particionarPorKam(apd, _lineKamOf);
  const gv = (rows, m) =>
    m === "nr" ? sumR(rows, r => r.newPartner + r.newService + r.reactivated)
    : m === "sh" ? sumR(rows, r => r.supplyHours)
    : m === "tr" ? sumR(rows, r => r.trips || 0)
    : sumR(rows, r => r.activeDrivers);
  const kams = ordenarKams([...kLastBy.keys(), ...kAllBy.keys(), ...kPrevBy.keys()], SIN_KAM);
  const filas = [];
  kams.forEach(kam => {
    const kl = kLastBy.get(kam) || [], kp = kPrevBy.get(kam) || [], ka = kAllBy.get(kam) || [];
    const enSeccion = !!kl.length && (kamFilterVal === "all" || kam === kamFilterVal);
    const pais = {};
    if (kl.length || ka.length || kp.length) {
      ["ad", "nr", "sh", "tr"].forEach(m => {
        const kv = gv(m === "ad" ? kl : ka, m), kpv = gv(kp, m);
        pais[m] = !!(kv || kpv);   // un KAM en 0 con previo >0 ES noticia
      });
    }
    if (!enSeccion && !Object.values(pais).some(Boolean)) return;
    filas.push({
      kam, enSeccion, pais,
      ad: gv(kl, "ad"), nr: gv(kl, "nr"), sh: gv(kl, "sh"), tr: gv(kl, "tr"),
      pad: gv(kp, "ad"), pnr: gv(kp, "nr"), psh: gv(kp, "sh"), ptr: gv(kp, "tr"),
      anr: gv(ka, "nr"), ash: gv(ka, "sh"), atr: gv(ka, "tr")
    });
  });
  if (!filas.length) return "";
  filas.sort((a, b) => (a.kam === SIN_KAM) - (b.kam === SIN_KAM) || b.ad - a.ad || a.kam.localeCompare(b.kam));

  // Valor y variación en la MISMA celda (la variación va a la derecha de la
  // cifra): con 12 columnas la tabla no entraba al lado del panel de filtros.
  // El data-num va en el <span> de la cifra, no en la celda.
  let h = sinTitulo ? "" : _rdSec(t("rend.kam.titulo"), _rdMesPrevCompleto && STATE.curMode === "mensual"
    ? t("rd.kam.subVs", { p: _rendPeriodLabel(), v: _rdPrevLbl() })
    : t("rd.kam.sub", { p: _rendPeriodLabel() }));
  if (sinTitulo) h += `<p class="rd-note ds-kam-det__sub">${escapeHTML(_rdMesPrevCompleto && STATE.curMode === "mensual"
    ? t("rd.kam.subVs", { p: _rendPeriodLabel(), v: _rdPrevLbl() })
    : t("rd.kam.sub", { p: _rendPeriodLabel() }))}</p>`;
  h += `<div class="ui-table-wrap rd-tabla-compacta"><table class="ui-table rd-table rd-table--kam">
    <thead>
      <tr class="rd-thgroup"><th></th><th colspan="4" scope="colgroup">${escapeHTML(_rendPeriodLabel())}</th><th colspan="3" scope="colgroup" class="rd-thgroup--acum">${escapeHTML(t("rd.kam.acum"))}</th>${metaKam ? `<th colspan="3" scope="colgroup" class="rd-thgroup--acum">${escapeHTML(t("ds.meta.delMes"))}</th>` : ""}</tr>
      <tr><th scope="col">KAM</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.ad.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.nr.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.sh.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.tr.short"))}</th>
        <th scope="col" class="ui-num rd-acum">${escapeHTML(t("metric.nr.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.sh.short"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("metric.tr.short"))}</th>
        ${metaKam ? _DS_K3.map((k, i) => `<th scope="col" class="ui-num${i === 0 ? " rd-acum" : ""}">% ${escapeHTML(_dsLblK(k))}</th>`).join("") : ""}
      </tr>
    </thead><tbody>`;
  filas.forEach(r => {
    const k = r.kam;
    // AD: clave(s) anidadas; la cifra es una sola.
    let adCell = fmt(r.ad);
    if (r.pais.ad) adCell = `<span${dn("rend", "pais-kam", "ad", k)}>${adCell}</span>`;
    if (r.enSeccion) adCell = `<span${dn("rend", "kam", "ad", k)}>${adCell}</span>`;
    const conD = (html, m, p) => {
      const d = _rdDelta(r[m], r[p]);
      return `<td class="ui-num"><span class="rd-vd">${html}${d ? `<span class="rd-vd__d">${d}</span>` : ""}</span></td>`;
    };
    const ult = (m, f) => r.enSeccion ? `<span${dn("rend", "kam", m, k)}>${f(r[m])}</span>` : f(r[m]);
    const acu = (m, v, extra = "") => `<td class="ui-num${extra}"${r.pais[m] ? dn("rend", "pais-kam", m, k) : ""}>${m === "sh" ? _fmtH(v) : fmt(v)}</td>`;
    h += `<tr><th scope="row" class="rd-rowhead">${_rdDot(_rdKamVar(k))}${escapeHTML(kamLabel(k))}</th>
      ${conD(adCell, "ad", "pad")}
      ${conD(ult("nr", fmt), "nr", "pnr")}
      ${conD(ult("sh", _fmtH), "sh", "psh")}
      ${conD(ult("tr", fmtSmart), "tr", "ptr")}
      ${acu("nr", r.anr, " rd-acum")}${acu("sh", r.ash)}${acu("tr", r.atr)}
      ${metaKam ? _DS_K3.map((m, i) => { const x = metaKam[k] && metaKam[k][m];
        return `<td class="ui-num${i === 0 ? " rd-acum" : ""}"${x ? ` title="${escapeHTML(t("ds.meta.tip", { a: x.F(x.actual), m: x.F(x.meta) }))}"` : ""}>${_dsPct(x ? x.pct : null, x ? `ds.kam.${k}.${m}.pct` : null)}</td>`; }).join("") : ""}
    </tr>`;
  });
  return h + `</tbody></table></div>`;
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
export function buildTable(apd, lastDate, prevDate, sel) {
  const selSet = new Set(sel);
  const lR    = apd.filter(r => r.date === lastDate);
  // El período previo DEBE pasar por el mismo filtro de ciudad que `apd` (que
  // ya viene acotado por el sidebar): sin esto, con Ciudad=Lima la columna WoW
  // comparaba Lima actual vs TODAS las ciudades previo → caídas falsas.
  const _cityF = document.getElementById("cityFilter")?.value || "all";
  const _pAll = _rendLinePrev(prevDate, null);
  const pRraw = _pAll.filter(r =>
    (_cityF === "all" || r.city === _cityF) && selSet.has(r.partner));
  const pR    = aggPD(pRraw);
  // Historia completa (todas las fechas) para detectar declive, ignorando el rango.
  // Agregador cachea en STATE._apdFull; Fleet/TukTuk recomputan del slice (arrays chicos).
  let apdFullBase;
  if (_rendLine() === "agg") {
    if (!STATE._apdFull) STATE._apdFull = aggPD(STATE.rawData);
    apdFullBase = STATE._apdFull;
  } else {
    apdFullBase = aggPD(_rendLineDataset());
  }
  const apdFull = apdFullBase.filter(r => selSet.has(r.partner));
  const partners = [...new Set(apd.map(r => r.partner))];

  // Pre-indexar lR, pR y apd por partner UNA vez. Reemplaza 3 filter()
  // O(n) por partner = O(n × partners) → O(1) lookup por partner.
  const lByPartner    = new Map();
  const prByPartner   = new Map();
  const apdByPartner  = new Map();
  const apdFullByPartner = new Map();
  const push = (m, r) => { let a = m.get(r.partner); if (!a) { a = []; m.set(r.partner, a); } a.push(r); };
  lR.forEach(r => push(lByPartner, r));
  pR.forEach(r => push(prByPartner, r));
  apd.forEach(r => push(apdByPartner, r));
  apdFull.forEach(r => push(apdFullByPartner, r));

  STATE.curSummaries = partners.map(p => {
    const l    = lByPartner.get(p) || [];
    const pr   = prByPartner.get(p) || [];
    const rows = (apdByPartner.get(p) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return {
      partner:      p,
      kam:          _lineKamOf(l[0] || { partner: p }),
      re:           sumR(l,  r => r.reactivated),
      pre:          sumR(pr, r => r.reactivated),
      ad:           sumR(l,  r => r.activeDrivers),
      nr:           sumR(l,  r => r.newPartner + r.newService + r.reactivated),
      sh:           sumR(l,  r => r.supplyHours),
      tr:           sumR(l,  r => r.trips || 0),
      co:           sumR(l,  r => r.commission),
      ns:           sumR(l,  r => r.newService),
      pad:          sumR(pr, r => r.activeDrivers),
      pnr:          sumR(pr, r => r.newPartner + r.newService + r.reactivated),
      psh:          sumR(pr, r => r.supplyHours),
      ptr:          sumR(pr, r => r.trips || 0),
      ...(() => {
        // Desempeño: estado contra la meta del mes + retención del partner.
        const e = _dsTablaCtx.estados.get(p);
        const f = flujoTotal([{ ad: sumR(l, r => r.activeDrivers), adPrev: sumR(pr, r => r.activeDrivers), nr: sumR(l, r => r.newPartner + r.newService + r.reactivated) }]);
        return { estado: e ? e.estado : "", pctPeor: e && e.peor != null ? e.peor : 9999, metaPct: e ? e.eva : null,
                 ret: f.retencion == null ? _DS_SIN_RET : f.retencion, perdidos: f.perdidos };
      })(),
      adSerie:      rows.map(r => r.activeDrivers),
      declineAlert: hasConsecutiveDecline(apdFullByPartner, p)
    };
  });
  renderTable();
}

// Columnas ordenables de la tabla de partners. sortTbl mapea por ÍNDICE de <th>
// (colKeys): tiene que seguir este mismo orden.
const _RD_TBL_COLS = [
  { k: "partner", l: () => t("rend.col.partner") },
  { k: "ad", l: () => t("ds.col.ad"), tip: () => t("metric.ad.label"), num: 1 },  { k: "nr", l: () => t("ds.col.nr"), tip: () => t("metric.nr.label"), num: 1 },
  { k: "sh", l: () => t("ds.col.sh"), tip: () => t("metric.sh.label"), num: 1 },  { k: "tr", l: () => t("metric.tr.short"), num: 1 },
  { k: "co", l: () => t("rend.col.comision"), num: 1 },{ k: "ns", l: () => t("ds.col.leads"), num: 1 },
  { k: "pctPeor", l: () => t("ds.col.meta"), num: 1 }, { k: "ret", l: () => t("ds.col.ret"), num: 1 }
];
function _rdSortAttrs(k) {
  const on = STATE.tblSort.col === k;
  const dir = on ? (STATE.tblSort.dir === "asc" ? "ascending" : "descending") : "none";
  return { cls: on ? (STATE.tblSort.dir === "asc" ? "sa" : "sd") : "", aria: dir };
}
export function renderTable() {
  const fe = _dsGetFiltroEstado();
  const sorted = STATE.curSummaries.filter(r => fe === "todos" || r.estado === fe).slice().sort((a, b) => {
    const va = a[STATE.tblSort.col], vb = b[STATE.tblSort.col];
    if (typeof va === "string")
      return STATE.tblSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return STATE.tblSort.dir === "asc" ? va - vb : vb - va;
  });

  // Todo a la vista sin scroll horizontal (Manuel, 30-sep: "un head no va a
  // scrollear a la derecha"): el KAM va debajo del nombre y la variación debajo
  // de cada cifra, en vez de columnas propias.
  let h = `<table class="ui-table rd-table rd-table--partners"><thead><tr>`;
  _RD_TBL_COLS.forEach(c => {
    const s = _rdSortAttrs(c.k);
    h += `<th scope="col" class="rd-sortable${c.num ? " ui-num" : ""}${s.cls ? " " + s.cls : ""}"${c.tip ? ` title="${escapeHTML(c.tip())}"` : ""} aria-sort="${s.aria}" data-act="sortTbl" data-act-keydown="sortTblKey" data-col="${escapeHTML(c.k)}" tabindex="0">` +
      `<span class="rd-th">${escapeHTML(c.l())}${iconSvg("chevron-down", { size: 12, className: "rd-sort-ico" })}</span></th>`;
  });
  h += `</tr></thead><tbody>`;

  sorted.forEach(r => {
    const alertBd = r.declineAlert
      ? `<span class="rd-alert" title="${escapeHTML(t("rend.declive", { n: STATE.declineThreshold, m: STATE.declineMetric === "activeDrivers" ? t("rend.lbl.activos") : STATE.declineMetric === "supplyHours" ? t("rend.declive.horas") : "N+R" }))}">${iconSvg("alert-triangle", { size: 14, label: t("rd.declive") })}</span>`
      : "";
    const nsCell  = r.ns > 0
      ? `<span class="ui-badge ui-badge--info rd-leads-badge" title="${escapeHTML(t("rend.recibeLeads"))}">★ ${fmt(r.ns)}</span>`
      : `<span class="rd-muted">${fmt(r.ns)}</span>`;
    h += `<tr data-partner="${escapeHTML(r.partner)}">
      <th scope="row" class="rd-rowhead rd-pcell"><span class="rd-pcell__n">${_rdDot(STATE.partnerColors[r.partner] || "var(--cat-other)")}${alertBd}<span>${escapeHTML(r.partner)}</span></span><span class="rd-pcell__kam">${_rdDot(_rdKamVar(r.kam))}${escapeHTML(kamLabel(r.kam))}<span class="rd-pcell__tend">${_rdTrend(r.adSerie || [])}</span></span></th>
      <td class="ui-num"><span class="rd-vd rd-vd--stack"><span${dn("rend", "tabla", "ad", r.partner)}>${fmt(r.ad)}</span><span class="rd-vd__d">${_rdDelta(r.ad, r.pad)}</span></span></td>
      <td class="ui-num"><span class="rd-vd rd-vd--stack"><span${dn("rend", "tabla", "nr", r.partner)}>${fmt(r.nr)}</span><span class="rd-vd__d">${_rdDelta(r.nr, r.pnr)}</span></span></td>
      <td class="ui-num"><span class="rd-vd rd-vd--stack"><span${dn("rend", "tabla", "sh", r.partner)}>${_fmtH(r.sh)}</span><span class="rd-vd__d">${_rdDelta(r.sh, r.psh)}</span></span></td>
      <td class="ui-num"><span class="rd-vd rd-vd--stack"><span${dn("rend", "tabla", "tr", r.partner)}>${fmtSmart(r.tr)}</span><span class="rd-vd__d">${_rdDelta(r.tr, r.ptr)}</span></span></td>
      <td class="ui-num"${dn("rend", "tabla", "co", r.partner)}>${fmtK(r.co)}</td>
      <td class="ui-num"${dn("rend", "tabla", "ns", r.partner)}>${nsCell}</td>
      <td class="ui-num">${_dsEstadoCelda(r)}</td>
      <td class="ui-num"${r.ret > _DS_SIN_RET ? dn("ds", "tabla", "ret", r.partner) : ""}>${r.ret > _DS_SIN_RET ? `${(r.ret * 100).toFixed(1)}%<small class="ds-perd">−${fmt(r.perdidos)}</small>` : `<span class="rd-muted">—</span>`}</td>
    </tr>`;
  });
  h += `</tbody></table>`;
  _dsCerrarEstadoPop();   // la tarjeta del % meta es de la tabla anterior
  const el = document.getElementById("tblContainer");
  if (el) el.innerHTML = h;
}

export function sortTbl(col) {
  _dsCerrarEstadoPop();
  if (STATE.tblSort.col === col)
    STATE.tblSort.dir = STATE.tblSort.dir === "asc" ? "desc" : "asc";
  else { STATE.tblSort.col = col; STATE.tblSort.dir = "desc"; }

  // Intentar reordenar filas existentes sin reconstruir el HTML
  const tbody = document.querySelector("#tblContainer tbody");
  if (!tbody || !STATE.curSummaries.length) { renderTable(); return; }

  const dir = STATE.tblSort.dir === "asc" ? 1 : -1;
  const k   = STATE.tblSort.col;
  const sorted = STATE.curSummaries.slice().sort((a, b) => {
    const av = a[k], bv = b[k];
    return (typeof av === "string" ? av.localeCompare(bv) : (av - bv)) * dir;
  });

  // Actualizar indicadores de orden en cabeceras.
  // Mismo orden que _RD_TBL_COLS en renderTable: se mapea por ÍNDICE de <th>.
  const colKeys = _RD_TBL_COLS.map(c => c.k);
  document.querySelectorAll("#tblContainer thead th").forEach((th, i) => {
    if (i < colKeys.length) {
      const s = _rdSortAttrs(colKeys[i]);
      th.classList.remove("sa", "sd");
      if (s.cls) th.classList.add(s.cls);
      th.setAttribute("aria-sort", s.aria);
    }
  });

  // Reordenar <tr> existentes vía DocumentFragment (cero re-parse de HTML)
  const rowMap = new Map(
    [...tbody.querySelectorAll("tr")].map(tr => [tr.dataset.partner, tr])
  );
  const frag = document.createDocumentFragment();
  sorted.forEach(s => { const tr = rowMap.get(s.partner); if (tr) frag.appendChild(tr); });
  tbody.appendChild(frag);
}

// ── PARTNER CARDS ─────────────────────────────────────────────────────────────
export function buildPartnerCards(apd, lastDate, prevDate, partners, sel) {
  const grid = document.getElementById("partnerCards");
  if (!grid) return;

  const selSet  = new Set(sel);
  // Mismo fix que buildTable: el previo respeta el filtro de ciudad activo,
  // si no los badges WoW de las tarjetas comparan universos distintos.
  const _cityF = document.getElementById("cityFilter")?.value || "all";
  const _pdAll = _rendLinePrev(prevDate, null);
  const prevRaw = _pdAll.filter(r =>
    (_cityF === "all" || r.city === _cityF) && selSet.has(r.partner));
  const prevAPD = aggPD(prevRaw);

  // Pre-indexar apd y prevAPD por partner una sola vez.
  const apdByPartner = new Map();
  const prevByPartner = new Map();
  for (const r of apd) {
    let a = apdByPartner.get(r.partner);
    if (!a) { a = []; apdByPartner.set(r.partner, a); }
    a.push(r);
  }
  for (const r of prevAPD) prevByPartner.set(r.partner, r);

  let html = "";
  partners.forEach(partner => {
    const rows = (apdByPartner.get(partner) || [])
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return;
    // B5 (sep-2026): antes era rows[rows.length - 1] — la ÚLTIMA fila del
    // partner, aunque fuera de un período anterior a lastDate. Un partner que
    // dejó de reportar mostraba un dato viejo rotulado como el del período
    // actual. Ahora es la fila de lastDate; sin ella, "—" (sin dato), no el viejo.
    const last    = rows.find(r => r.date === lastDate) || null;
    const prevRow = prevByPartner.get(partner) || null;
    // KAM efectivo (misma precedencia que el resto de la vista), no el que
    // traía la fila del Excel.
    const kam     = _lineKamOf(rows[rows.length - 1]);
    const v       = k => last ? (k === "supplyHours" ? _fmtH(last[k]) : fmt(last[k])) : "—";
    const cur     = k => last ? last[k] : null;

    const lastNR = last ? last.newPartner + last.newService + last.reactivated : null;
    const prevNR = prevRow ? prevRow.newPartner + prevRow.newService + prevRow.reactivated : null;
    const sub = (lbl, k) => `<div class="rd-pcard__sub">
      <div class="rd-pcard__sublbl">${escapeHTML(lbl)}</div>
      <div class="rd-pcard__subval">${v(k)}</div>${_rdDelta(cur(k), prevRow?.[k] ?? null)}
    </div>`;
    html += `<div class="ui-card rd-pcard">
      <div class="rd-pcard__head">
        <div class="rd-pcard__name">${_rdDot(STATE.partnerColors[partner] || "var(--cat-other)")}<span>${escapeHTML(partner)}</span></div>
        <div class="rd-pcard__meta">${_rdDot(_rdKamVar(kam))}${escapeHTML(kamLabel(kam))} · ${prevRow ? d2s(prevDate) + " → " : ""}${d2s(lastDate)}${last ? "" : ` · <em>${escapeHTML(t("rend.pcard.sinDato"))}</em>`}</div>
      </div>
      <div class="rd-pcard__kpis">
        <div class="rd-pcard__kpi">
          <div class="rd-pcard__lbl">${escapeHTML(t("metric.ad.short"))}</div>
          <div class="rd-pcard__val">${v("activeDrivers")}</div>
          <div class="rd-pcard__foot">${_rdDelta(cur("activeDrivers"), prevRow?.activeDrivers ?? null)}${_rdTrend(rows.map(r => r.activeDrivers))}</div>
        </div>
        <div class="rd-pcard__kpi">
          <div class="rd-pcard__lbl">${escapeHTML(t("metric.sh.short"))}</div>
          <div class="rd-pcard__val">${v("supplyHours")}</div>
          <div class="rd-pcard__foot">${_rdDelta(cur("supplyHours"), prevRow?.supplyHours ?? null)}${_rdTrend(rows.map(r => r.supplyHours))}</div>
        </div>
      </div>
      <div class="rd-pcard__nr">
        <div class="rd-pcard__lbl rd-pcard__lbl--row">${escapeHTML(t("metric.nr.label"))} ${_rdDelta(lastNR, prevNR)}${_rdTrend(rows.map(r => r.newPartner + r.newService + r.reactivated))}</div>
        <div class="rd-pcard__subs">
          ${sub(t("rd.pcard.partner"), "newPartner")}
          ${sub(t("rd.pcard.servicio"), "newService")}
          ${sub(t("rd.pcard.reactivados"), "reactivated")}
        </div>
      </div>
    </div>`;
  });
  grid.innerHTML = html; // un solo reflow al final
}

// Suma/pondera KPIs Fleet sobre filas crudas (una por fleetroom-ciudad de una fecha).
// SH/Auto interno = Σ internalFleetSh / Σ ownedFleetActiveCars; Aceptación = Σ(rate×trips)/Σtrips
// (mismas fórmulas que presentacion2.p2FleetSeries). Cars/Branded = snapshots sumados.
// Revenue/productividad (gmv, comisión, tripsPerHour, moneyPerHour) se recalculan EXACTOS
// desde las sumas crudas (gmv, trips, SH) — no se reusa la columna-ratio precalculada por
// fila, para no perder precisión al agregar varias filas (misma lección que
// excel-upload-full-precision: sumar crudo, no promediar ratios ya redondeados).
// Calidad/riesgo/dependencia (fraude, mal calificados, completion, subsidio, soporte,
// % SH externo) SÍ son shares sin numerador/denominador propio en la BD → se ponderan
// por trips (o por gmv en el caso de subsidio) igual que Aceptación.
export function _rendFleetAgg(rows) {
  let owned = 0, intSh = 0, extSh = 0, trips = 0, branded = 0, actCars = 0,
      gmv = 0, commission = 0;
  // Tasas: una fila sin el dato queda fuera del numerador Y del denominador
  // (ver tasaAcum en domain/metrics) — si no, diluye el promedio hacia 0.
  const acc = tasaAcum(), fraud = tasaAcum(), badRated = tasaAcum(),
        compl = tasaAcum(), support = tasaAcum(), subsidy = tasaAcum();
  rows.forEach(r => {
    owned      += r.ownedFleetActiveCars || 0;
    intSh      += r.internalFleetSh || 0;
    extSh      += r.externalFleetSh || 0;
    trips      += r.trips || 0;
    branded    += r.brandedActiveCars || 0;
    actCars    += r.activeCars || 0;
    gmv        += r.gmv || 0;
    commission += r.commission || 0;
    sumarTasa(acc,      r.acceptanceRate,             r.trips);
    sumarTasa(fraud,    r.fraudTripsShare,            r.trips);
    sumarTasa(badRated, r.badRatedTripsShare,         r.trips);
    sumarTasa(compl,    r.completionRate,             r.trips);
    sumarTasa(support,  r.driverSupportRequestsShare, r.trips);
    sumarTasa(subsidy,  r.driverSubsidiesByGmv,       r.gmv);
  });
  const totalSh = intSh + extSh;
  // Sin base → null ("—" en pantalla), no 0: un 0 se lee como un dato real.
  const div = (n, d) => d > 0 ? n / d : null;
  const pct = a => { const v = leerTasa(a); return v == null ? null : v * 100; };
  return {
    owned, branded, actCars, gmv, commission,
    shCar:            div(intSh, owned),
    accept:           pct(acc),
    pctBranded:       owned > 0 ? (branded / owned) * 100 : null,
    gmvPerCar:        div(gmv, owned),
    commissionPerCar: div(commission, owned),
    tripsPerCar:      div(trips, owned),
    tripsPerHour:     div(trips, totalSh),
    moneyPerHour:     div(gmv, totalSh),
    externalShShare:  totalSh > 0 ? (extSh / totalSh) * 100 : null,
    fraudShare:       pct(fraud),
    badRatedShare:    pct(badRated),
    completionRate:   pct(compl),
    supportReqShare:  pct(support),
    subsidyByGmv:     pct(subsidy)
  };
}
// Agrega KPIs Fleet por fecha (Peru total, todas las ciudades) — mismas fórmulas
// que _rendFleetAgg, indexadas por fecha. Insumo de los charts de Tendencias.
export function _fleetAggByDate(rows) {
  const m = new Map();
  rows.forEach(r => { let a = m.get(r.date); if (!a) { a = []; m.set(r.date, a); } a.push(r); });
  const out = {};
  m.forEach((rs, d) => { out[d] = _rendFleetAgg(rs); });
  return out;
}
// Línea de un KPI de flota (Peru total) a lo largo del rango filtrado (no solo el
// último período — a diferencia de las tarjetas/tabla, que son snapshot).
const _FLEET_TREND_KEY = {
  owned: "rd.fleet.ch.owned", shCar: "rd.fleet.ch.shCar", accept: "rd.fleet.ch.accept",
  branded: "rd.fleet.ch.branded", gmvPerCar: "rd.fleet.ch.gmvCar", externalShShare: "rd.fleet.ch.extSh"
};
export function buildFleetTrendLine(elId, dates, byDate, key, color) {
  // null (tasa sin base) queda como hueco en la línea, no como un punto en 0.
  const data = dates.map(d => { const v = byDate[d] ? byDate[d][key] : 0; return v == null ? null : (v || 0); });
  buildLineChart(elId, dates, [{ name: _FLEET_TREND_KEY[key] ? t(_FLEET_TREND_KEY[key]) : key, data }], [color], ESTILO_SUAVE);
}
// Donut "Owned Cars por Partner" — snapshot del último período, Top 6 + Otros.
// Parts-of-whole (dónde se concentra la flota) → donut es la elección correcta,
// no una línea (no es serie de tiempo).
export function _buildFleetOwnedDonut(lastRows) {
  const byP = new Map();
  lastRows.forEach(r => {
    const v = r.ownedFleetActiveCars || 0;
    if (!v) return;
    byP.set(r.partner, (byP.get(r.partner) || 0) + v);
  });
  const sorted  = [...byP.entries()].sort((a, b) => b[1] - a[1]);
  const TOP     = 6;
  const top     = sorted.slice(0, TOP);
  const restSum = sumR(sorted.slice(TOP), ([, v]) => v);
  const tk      = chartTokens();
  const labels  = top.map(([p]) => p);
  const series  = top.map(([, v]) => v);
  const colors  = top.map((_, i) => seriesColor(i, tk));
  if (restSum > 0) { labels.push(t("rd.otros")); series.push(restSum); colors.push(tk.other); }
  buildDonutChart("chF_ownedDonut", labels, series, colors);
}
// Donut "Brandeados vs No Brandeados" — snapshot del último período, Peru total.
export function _buildFleetBrandedDonut(lastRows) {
  const agg = _rendFleetAgg(lastRows);
  const noBranded = Math.max(agg.owned - agg.branded, 0);
  const tk = chartTokens();
  buildDonutChart("chF_brandedDonut", [t("rd.fleet.brandeados"), t("rd.fleet.noBrandeados")], [agg.branded, noBranded], [seriesColor(0, tk), tk.other]);
}
// Programa los charts de Fleet (tendencias + composición) diferidos con RAF — mismo
// patrón anti-freeze que pumpCharts() de Agregador. Aborta si cambia filtro/tab/línea
// mientras corre (evita pintar charts sobre un render ya obsoleto).
export function _scheduleFleetCharts(filtered, dates, lastRows) {
  const tokenAtSchedule = _renderRendToken;
  const tabTokenAtSched = STATE._tabRenderId;
  const byDate = _fleetAggByDate(filtered);
  const tk = chartTokens();
  const keys = ["owned", "shCar", "accept", "branded", "gmvPerCar", "externalShShare"];
  const ids  = ["chF_owned", "chF_shcar", "chF_accept", "chF_branded", "chF_gmvcar", "chF_extsh"];
  const jobs = keys.map((k, i) => () => buildFleetTrendLine(ids[i], dates, byDate, k, seriesColor(i, tk)));
  jobs.push(() => _buildFleetOwnedDonut(lastRows), () => _buildFleetBrandedDonut(lastRows));
  function pump(i) {
    if (i >= jobs.length) return;
    if (_renderRendToken !== tokenAtSchedule)   return;
    if (STATE._tabRenderId !== tabTokenAtSched) return;
    if (STATE.curTab !== "rend")                return;
    try { jobs[i](); } catch (e) { console.warn("Fleet chart job", i, "failed:", e); }
    requestAnimationFrame(() => pump(i + 1));
  }
  requestAnimationFrame(() => pump(0));
}
// Vista Fleet completa (SOLO KPIs de flota): Perú general + por ciudad + por partner.
// lastRows/prevRows = filas CRUDAS de sub-flotas Fleet (una por fleetroom-ciudad) del
// último período y del anterior. NO se usan AD/SH/N+R (mezclados a nivel fleetroom).
export function _renderFleetView(lastRows, prevRows, lastDate, _prevDate) {
  const periodLabel = _rendPeriodLabel();
  let html = `<div class="${RD_VIEW}">` + rendLineToggleHTML();
  const c = _rendFleetAgg(lastRows), p = _rendFleetAgg(prevRows);
  const metaInfo = _rendMetaMes("fleet", lastDate);

  // Perú general (10 KPIs de flota: presencia/calidad + revenue/productividad)
  html += _rdSec(t("rd.fleet.kpis"), t("rend.fleet.peruSub", { p: periodLabel }));
  html += _rdFleetKpis(c, p, metaInfo);
  html += _rdGoalNota(metaInfo);

  // Por ciudad (tabla)
  const ciudades = CITIES.filter(city => lastRows.some(r => r.city === city)).map(city => ({
    city, c: _rendFleetAgg(lastRows.filter(r => r.city === city)),
    p: _rendFleetAgg(prevRows.filter(r => r.city === city))
  }));
  if (ciudades.length) {
    html += _rdSec(t("rend.fleet.ciudad"), t("rend.fleet.ciudadSub"));
    html += _rdFleetCiudadTabla(ciudades);
  }

  // Calidad y dependencia (métricas de riesgo/madurez, secundarias)
  const pct = v => fmt(v) + "%";
  html += _rdSec(t("rend.fleet.calidad"), t("rend.fleet.calidadSub", { p: periodLabel }));
  html += _rendFleetScorecard([
    { label: t("rend.fleet.shExterno"), key: "externalShShare", val: c.externalShShare, prev: p.externalShShare, fmtFn: pct, invert: true },
    { label: t("rend.fleet.fraude"),    key: "fraudShare",      val: c.fraudShare,      prev: p.fraudShare,      fmtFn: pct, invert: true },
    { label: t("rend.fleet.malCalif"),  key: "badRatedShare",   val: c.badRatedShare,   prev: p.badRatedShare,   fmtFn: pct, invert: true },
    { label: t("rd.fleet.completion"),  key: "completionRate",  val: c.completionRate,  prev: p.completionRate,  fmtFn: pct },
    { label: t("rend.fleet.subsidio"),  key: "subsidyByGmv",    val: c.subsidyByGmv,    prev: p.subsidyByGmv,    fmtFn: pct },
    { label: t("rend.fleet.soporte"),   key: "supportReqShare", val: c.supportReqShare, prev: p.supportReqShare, fmtFn: pct, invert: true }
  ]);

  // Tendencias (línea, Perú total, evolución del rango filtrado)
  html += _rdSec(t("rend.fleet.tend"), t("rend.fleet.tendSub"));
  html += `<div class="rd-grid-2">
    ${_rdChart("chF_owned",   t("rd.fleet.ch.owned"),   "Fleet_OwnedCars")}
    ${_rdChart("chF_shcar",   t("rd.fleet.ch.shCar"),   "Fleet_SHAuto")}
    ${_rdChart("chF_accept",  t("rd.fleet.ch.accept"),  "Fleet_Aceptacion")}
    ${_rdChart("chF_branded", t("rd.fleet.ch.branded"), "Fleet_Branded")}
    ${_rdChart("chF_gmvcar",  t("rd.fleet.ch.gmvCar"),  "Fleet_GMVporAuto")}
    ${_rdChart("chF_extsh",   t("rd.fleet.ch.extSh"),   "Fleet_PctSHExterno")}
  </div>`;

  // Composición (donut, snapshot del último período)
  html += _rdSec(t("rend.fleet.comp"), t("rend.fleet.compSub", { d: d2s(lastDate) }));
  html += `<div class="rd-grid-2">
    ${_rdChart("chF_ownedDonut",   t("rend.fleet.ownedDonut"), "Fleet_OwnedPorPartner")}
    ${_rdChart("chF_brandedDonut", t("rend.fleet.brandDonut"), "Fleet_Brandeados")}
  </div>`;

  // Por partner (tabla)
  html += _rdSec(t("rend.fleet.partner"), t("rend.fleet.partnerSub"));
  html += _rendFleetPartnerTable(lastRows, prevRows);
  return html + `</div>`;
}
function _rdFleetKpis(c, p, metaInfo) {
  // Las tasas/ratios pueden venir en null (sin base): "—", nunca "0".
  const num = v => v == null ? "—" : fmt(v);
  const pct = v => v == null ? "—" : fmt(v) + "%";
  const snap = t("rend.snapshotUlt");
  const k = (label, val, prev, f, numKey, goal) => _rdKpi({ label, value: f(val), numKey, cur: val, prev, sub: snap, goal });
  return `<div class="rd-kpis rd-kpis--auto rd-kpis--tiles">
    ${k(t("rend.kpi.ownedCars"),   c.owned,            p.owned,            fmt, "rend.fleet.owned")}
    ${k(t("rend.kpi.shAuto"),      c.shCar,            p.shCar,            num, "rend.fleet.shCar", _rdGoal(metaInfo, "shCar"))}
    ${k(t("rend.kpi.aceptacion"),  c.accept,           p.accept,           pct, "rend.fleet.accept", _rdGoal(metaInfo, "accept"))}
    ${k(t("rend.kpi.brandedCars"), c.branded,          p.branded,          fmt, "rend.fleet.branded")}
    ${k(t("rend.kpi.pctBrand"),    c.pctBranded,       p.pctBranded,       pct, "rend.fleet.pctBranded")}
    ${k(t("rend.kpi.gmvAuto"),     c.gmvPerCar,        p.gmvPerCar,        num, "rend.fleet.gmvPerCar")}
    ${k(t("rend.kpi.comAuto"),     c.commissionPerCar, p.commissionPerCar, num, "rend.fleet.commissionPerCar")}
    ${k(t("rend.kpi.viajesAuto"),  c.tripsPerCar,      p.tripsPerCar,      num, "rend.fleet.tripsPerCar")}
    ${k(t("rd.kpi.viajesHora"),    c.tripsPerHour,     p.tripsPerHour,     num, "rend.fleet.tripsPerHour")}
    ${k(t("rend.kpi.gmvHora"),     c.moneyPerHour,     p.moneyPerHour,     num, "rend.fleet.moneyPerHour")}
  </div>`;
}
// Scorecard compacto de calidad/riesgo: una tabla label · valor · delta (se
// leen mejor como checklist que como 6 tarjetas grandes).
export function _rendFleetScorecard(items) {
  return `<div class="ui-table-wrap rd-tabla-compacta rd-score"><table class="ui-table rd-table">
    <thead><tr><th scope="col">${escapeHTML(t("rd.col.metrica"))}</th><th scope="col" class="ui-num">${escapeHTML(_rendPeriodLabel())}</th>${
      STATE.curMode !== "diario" ? `<th scope="col" class="rd-dcol">${escapeHTML(_rdPrevLbl())}</th>` : ""}</tr></thead><tbody>
    ${items.map(it => `<tr>
      <th scope="row" class="rd-rowhead">${escapeHTML(it.label)}</th>
      <td class="ui-num"${it.key ? dn("rend", "fleet-calidad", it.key) : ""}>${it.val == null ? "—" : it.fmtFn(it.val)}</td>
      ${STATE.curMode !== "diario" ? `<td class="rd-dcol">${_rdDelta(it.val, it.prev, { invert: it.invert })}</td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}
function _rdFleetCiudadTabla(ciudades) {
  const conDelta = STATE.curMode !== "diario";
  const num = v => v == null ? "—" : fmt(v);
  const pct = v => v == null ? "—" : fmt(v) + "%";
  const cols = [
    { k: "owned",      l: t("rend.kpi.ownedCars"),   f: fmt },
    { k: "shCar",      l: t("rend.kpi.shAuto"),      f: num },
    { k: "accept",     l: t("rend.kpi.aceptacion"),  f: pct },
    { k: "branded",    l: t("rend.kpi.brandedCars"), f: fmt },
    { k: "pctBranded", l: t("rend.kpi.pctBrand"),    f: pct }
  ];
  const rows = ciudades.slice().sort((a, b) => b.c.owned - a.c.owned);
  let h = `<div class="ui-table-wrap rd-tabla-compacta"><table class="ui-table rd-table">
    <thead><tr><th scope="col">${escapeHTML(t("rd.col.ciudad"))}</th>${cols.map(c =>
      `<th scope="col" class="ui-num">${escapeHTML(c.l)}</th>${conDelta ? `<th scope="col" class="rd-dcol"><span class="ui-sr-only">${escapeHTML(t("rd.col.delta", { m: c.l }))}</span>Δ</th>` : ""}`).join("")}</tr></thead><tbody>`;
  rows.forEach(r => {
    h += `<tr><th scope="row" class="rd-rowhead">${_rdDot(_rdCityVar(r.city))}${escapeHTML(cityLabel(r.city))}</th>` +
      cols.map(c => `<td class="ui-num"${dn(`rend.fleet-ciudad.${c.k}.${r.city}`)}>${r.c[c.k] == null ? "—" : c.f(r.c[c.k])}</td>` +
        (conDelta ? `<td class="rd-dcol">${_rdDelta(r.c[c.k], r.p[c.k])}</td>` : "")).join("") + `</tr>`;
  });
  return h + `</tbody></table></div>`;
}
export function _rendFleetPartnerTable(lastRows, prevRows) {
  const groupBy = (rows) => {
    const m = new Map();
    rows.forEach(r => { let a = m.get(r.partner); if (!a) { a = []; m.set(r.partner, a); } a.push(r); });
    return m;
  };
  const byP = groupBy(lastRows), prevByP = groupBy(prevRows);
  const rows = [...byP.entries()].map(([p, rs]) => {
    const c  = _rendFleetAgg(rs);
    const pr = _rendFleetAgg(prevByP.get(p) || []);
    return { partner: p, kam: (rs[0] || {}).kam || "", ...c, prev: pr };
  }).sort((a, b) => b.owned - a.owned);
  if (!rows.length) return emptyState({ icon: "car", title: t("rd.fleet.sinPartners") });
  // Delta inline junto al valor: cada métrica trae su propio WoW/MoM. El texto
  // "valor delta" (con el espacio) es el que registra la huella.
  const num = v => v == null ? "—" : fmt(v);
  const pct = v => v == null ? "—" : fmt(v) + "%";
  const cel = (key, partner, txt, d) => `<td class="ui-num"${dn("rend", "fleet-tabla", key, partner)}>${txt}${d ? " " + d : ""}</td>`;
  let h = `<div class="ui-table-wrap ui-table-wrap--scroll rd-tabla-wrap"><table class="ui-table ui-table--sticky-first rd-table rd-table--fleet"><thead><tr>
    <th scope="col">${escapeHTML(t("rend.col.partner"))}</th><th scope="col">KAM</th>
    <th scope="col" class="ui-num">${escapeHTML(t("rend.kpi.ownedCars"))}</th><th scope="col" class="ui-num">${escapeHTML(t("rend.kpi.shAuto"))}</th>
    <th scope="col" class="ui-num">${escapeHTML(t("portal.aceptacion"))}</th><th scope="col" class="ui-num">${escapeHTML(t("rend.kpi.brandeados"))}</th>
    <th scope="col" class="ui-num">${escapeHTML(t("rend.fleet.pctBrandeado"))}</th><th scope="col" class="ui-num">${escapeHTML(t("rend.kpi.gmvAuto"))}</th>
    <th scope="col" class="ui-num">${escapeHTML(t("rend.fleet.comisionAuto"))}</th></tr></thead><tbody>`;
  rows.forEach(r => {
    h += `<tr>
      <th scope="row" class="rd-rowhead">${_rdDot(STATE.partnerColors[r.partner] || "var(--cat-other)")}<span>${escapeHTML(r.partner)}</span></th>
      <td class="rd-kamcell">${_rdDot(_rdKamVar(r.kam))}${escapeHTML(kamLabel(r.kam))}</td>
      ${cel("owned", r.partner, fmt(r.owned), _rdDelta(r.owned, r.prev.owned))}
      ${cel("shCar", r.partner, num(r.shCar), _rdDelta(r.shCar, r.prev.shCar))}
      ${cel("accept", r.partner, pct(r.accept), _rdDelta(r.accept, r.prev.accept))}
      ${cel("branded", r.partner, fmt(r.branded), "")}
      ${cel("pctBranded", r.partner, pct(r.pctBranded), _rdDelta(r.pctBranded, r.prev.pctBranded))}
      ${cel("gmvPerCar", r.partner, num(r.gmvPerCar), _rdDelta(r.gmvPerCar, r.prev.gmvPerCar))}
      ${cel("commissionPerCar", r.partner, num(r.commissionPerCar), _rdDelta(r.commissionPerCar, r.prev.commissionPerCar))}
    </tr>`;
  });
  return h + `</tbody></table></div>`;
}
export function _rendTkKPIs(lastRows, prevRows, metaInfo) {
  const agg = rows => {
    let branded = 0, actCars = 0;
    rows.forEach(r => { branded += r.brandedActiveCars || 0; actCars += r.activeCars || 0; });
    return { branded, actCars };
  };
  const c = agg(lastRows), p = agg(prevRows);
  const snap = t("rend.snapshotUlt");
  return _rdSec(t("rend.tk.autos"), t("rend.tk.autosSub")) +
    `<div class="rd-kpis rd-kpis--2 rd-kpis--tiles">
      ${_rdKpi({ label: t("rend.kpi.brandeados"), value: fmt(c.branded), numKey: "rend.tk.branded", cur: c.branded, prev: p.branded, sub: snap, goal: _rdGoal(metaInfo, "cars") })}
      ${_rdKpi({ label: t("rend.kpi.activeCars"), value: fmt(c.actCars), numKey: "rend.tk.activeCars", cur: c.actCars, prev: p.actCars, sub: snap })}
    </div>` +
    _rendTkAdquisicion(lastRows, prevRows);
}

// ── TukTuk · Adquisición propia (criterio "Las 6 metas del mes") ──────────────
// Meta del criterio: 100 conductores nuevos al mes de ADQUISICIÓN PROPIA. La
// letra chica importa y define la métrica: "no contempla self-registration", que
// es exactamente la distinción entre las dos columnas de la fuente:
//   new_from_partner  → los trae el partner   (cuentan)
//   new_from_service  → self-registration     (NO cuentan)
// Por eso la tarjeta de self-registration se muestra al lado: deja la definición
// a la vista y auditable, en vez de que el número salga de una caja negra.
export const TK_META_NUEVOS_MES = 100;

// OJO CON LA VENTANA: la meta es de 100 al MES, así que esta sección mide el
// ÚLTIMO PERÍODO, no el acumulado del rango. Con el acumulado, un rango de 3
// meses daba 97,2 contra una meta de 100 y parecía "casi cumplida" cuando en
// realidad el mes cerró en 36 — el mismo error de escala que ya obligó a poner
// un aviso en Metas. Comparar contra el período anterior, no contra el rango.
export function _rendTkAdquisicion(lastRows, prevRows) {
  const sum = (rows, get) => rows.reduce((a, r) => a + (get(r) || 0), 0);
  const propios  = sum(lastRows, r => r.newPartner);
  const self     = sum(lastRows, r => r.newService);
  const pPropios = sum(prevRows, r => r.newPartner);
  const pSelf    = sum(prevRows, r => r.newService);
  const total    = propios + self;
  const pTotal   = pPropios + pSelf;
  const pct      = total  > 0 ? (propios  / total)  * 100 : 0;
  const pPct     = pTotal > 0 ? (pPropios / pTotal) * 100 : 0;

  // Por partner: lo accionable es a quién llamar, no el total país.
  const byPartner = new Map();
  lastRows.forEach(r => {
    byPartner.set(r.partner, (byPartner.get(r.partner) || 0) + (r.newPartner || 0));
  });
  const filas = [...byPartner.entries()].sort((a, b) => b[1] - a[1]);

  // La meta es MENSUAL. En semanal/diario el "último período" es una semana o un
  // día, así que compararlo contra 100 daría un incumplimiento falso → el
  // semáforo queda en gris (mismo criterio que el aviso de escala de Metas).
  const mensual = STATE.curMode === "mensual";
  const rangoTxt = t(mensual ? "rend.tk.ultMes" : "rend.tk.ultPeriodo");

  const filasHTML = filas.length ? filas.map(([partner, n]) => {
    const ok  = n >= TK_META_NUEVOS_MES;
    const tone = !mensual ? "neutral" : ok ? "ok" : n >= TK_META_NUEVOS_MES * 0.5 ? "warn" : "bad";
    const pctMeta = Math.min(100, (n / TK_META_NUEVOS_MES) * 100);
    return `<tr>
      <th scope="row" class="rd-rowhead">${escapeHTML(partner)}</th>
      <td class="ui-num rd-tone rd-tone--${tone}">${fmt(n)}</td>
      <td class="rd-barcell"><div class="ui-progress ${tone === "neutral" ? "rd-progress--neutral" : "ui-progress--" + tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pctMeta)}">` +
        `<div class="ui-progress__bar" style="width:${pctMeta.toFixed(1)}%"></div></div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="3" class="rd-muted">${escapeHTML(t("rend.tk.sinNuevos"))}</td></tr>`;

  return _rdSec(t("rend.tk.adq"), t("rend.tk.adqSub", { n: TK_META_NUEVOS_MES })) +
    `<div class="rd-kpis rd-kpis--3 rd-kpis--tiles">
      ${_rdKpi({ label: t("rend.kpi.nuevosProp"), value: fmt(propios), cur: propios, prev: pPropios, sub: rangoTxt })}
      ${_rdKpi({ label: t("rend.kpi.selfReg"),    value: fmt(self),    cur: self,    prev: pSelf,    sub: t("rend.tk.noCuenta") })}
      ${_rdKpi({ label: t("rend.kpi.pctAdq"),     value: pct.toFixed(1) + "%", cur: pct, prev: pPct, sub: t("rend.tk.propiosTotal") })}
    </div>
    ${!mensual ? alertBox({ tone: "info", text: t(STATE.curMode === "diario" ? "rd.tk.avisoDiario" : "rd.tk.avisoSemanal", { n: TK_META_NUEVOS_MES }) }) : ""}
    <div class="ui-table-wrap rd-tabla-compacta"><table class="ui-table rd-table rd-table--tkadq">
      <thead><tr>
        <th scope="col">${escapeHTML(t("rend.col.partner"))}</th>
        <th scope="col" class="ui-num">${escapeHTML(t("rd.tk.thPropios"))}</th>
        <th scope="col">${escapeHTML(t("rd.tk.thVsMeta", { n: TK_META_NUEVOS_MES }))}</th>
      </tr></thead>
      <tbody>${filasHTML}</tbody>
    </table></div>`;
}

// ── ACCIONES DELEGADAS (Fase A2) ─────────────────────────────────────────────
import { registerActions } from "./shared/actions.js";

registerActions({
  dsEstadoInfo: (d, el) => _dsEstadoPop(d, el),
  // data-line (y data-value del control segmentado): el mismo valor.
  setRendLine:       d => setRendLine(d.line || d.value),
  setRendCiudadModo: d => setRendCiudadModo(d.value),
  sortTbl:           d => sortTbl(d.col),
  // Encabezado ordenable con teclado (Enter / Espacio), igual que el click.
  sortTblKey:        (d, _el, e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortTbl(d.col); } },
  dlChart:           d => dlChart(d.chart, d.name),
  dsSetEstado:       d => dsSetEstado(d.value),
  dsSetMovMetric:    d => dsSetMovMetric(d.value),
  dsSetAccTab:       d => dsSetAccTab(d.value),
  dsRetMensual:      () => dsRetMensual()
});

// ═════════════════════════════════════════════════════════════════════════════
// DESEMPEÑO (29-sep-2026) — Rendimiento + Metas en una sola vista.
// Manuel eligió la propuesta 1 del prototipo (?ui=proto&p=perf) con la franja
// "¿Llegamos?" de la 3. Todo lo de meta sale de las MISMAS funciones que usa
// Metas (metasResumenPais / metasCuentasLinea): ninguna cifra puede diferir
// entre las dos pestañas. Piezas nuevas de este bloque:
//   · Franja "¿Llegamos a la meta?" (domain/brechaMeta).
//   · Flujo de conductores: ganados, perdidos, neto y retención
//     (domain/flujoConductores), por período y por KAM.
//   · Metas por ciudad y por KAM, estado por partner, "más lejos de su meta".
//   · Tendencias con la meta dibujada.
// ═════════════════════════════════════════════════════════════════════════════

// Estado de la sesión (no persistido): métrica de "Quién se movió" y filtro
// de estado de la tabla de partners.
let _dsMovMetric = "nr";
// Lo que la tabla de partners necesita del render (estado vs meta y flujo por
// partner); se fija en _renderRendImpl antes de buildTable.
let _dsTablaCtx = { estados: new Map(), flujo: null };          // N+R por defecto: la que más le importa a Manuel
let _dsFiltroEstado = "todos";
// "Sin retención" en la tabla (sin base previa). No es −1: con la fórmula de la
// Presentación la retención puede ser negativa y tiene que verse.
const _DS_SIN_RET = -1e9;

const _DS_K3 = ["ad", "nr", "sh"];
const _dsLblK = k => t(k === "ad" ? "metric.ad.short" : k === "nr" ? "metric.nr.short" : "metric.sh.short");
const _dsNR = r => r.newPartner + r.newService + r.reactivated;
const _dsTone = p => p == null ? "neutral" : p >= 100 ? "over" : p >= 95 ? "ok" : p >= 80 ? "warn" : "bad";
const _dsPct = (p, numKey) => p == null || !Number.isFinite(p)
  ? `<span class="ds-pct ds-pct--neutral">—</span>`
  : `<span class="ds-pct ds-pct--${_dsTone(p)}"${numKey ? dn(numKey) : ""}>${p.toFixed(1)}%</span>`;
function _dsBar(p, pp) {
  const w = v => Math.max(0, Math.min(100, v || 0)).toFixed(1);
  return `<div class="ui-progress ui-progress--${_dsTone(p) === "neutral" ? "bad" : _dsTone(p)} ds-bar">` +
    (pp != null && Number.isFinite(pp) ? `<div class="ui-progress__proj" style="width:${w(pp)}%"></div>` : "") +
    `<div class="ui-progress__bar" style="width:${w(p)}%"></div></div>`;
}

// ── Quién se movió (se repinta EN SU LUGAR al cambiar la métrica) ───────────
// Antes el selector llamaba a renderRend(): se destruía y rearmaba toda la vista
// (gráficos incluidos), la página se achicaba un instante y el navegador
// saltaba hacia arriba (Manuel, 30-sep). Ahora solo cambia este bloque.
let _dsMovCtx = null;
function _dsMoversHTML() {
  const c = _dsMovCtx;
  if (!c) return "";
  const { lastRows, prevRows, estados, prevDate } = c;
  const movM = _dsMovMetric;
  const movV = r => movM === "nr" ? _dsNR(r) : movM === "sh" ? (r.supplyHours || 0) : (r.activeDrivers || 0);
  const prevByPartner = new Map();
  prevRows.forEach(r => prevByPartner.set(r.partner, (prevByPartner.get(r.partner) || 0) + movV(r)));
  const nowByPartner = new Map();
  lastRows.forEach(r => nowByPartner.set(r.partner, (nowByPartner.get(r.partner) || 0) + movV(r)));
  // Unión actual ∪ previo: un partner con base previa y SIN fila esta semana
  // (churn total, el caso más urgente de llamar) entra a "bajan" con −100%.
  const movers = [...new Set([...nowByPartner.keys(), ...prevByPartner.keys()])].map(p => {
    const now  = nowByPartner.get(p)  || 0;
    const prev = prevByPartner.get(p) || 0;
    return { partner: p, now, prev, delta: now - prev, pct: prev > 0 ? ((now - prev) / prev) * 100 : null };
  }).filter(m => m.pct != null);
  const suben = movers.slice().sort((a, b) => b.delta - a.delta).filter(m => m.delta > 0).slice(0, 5);
  const bajan = movers.slice().sort((a, b) => a.delta - b.delta).filter(m => m.delta < 0).slice(0, 5);
  // "Más atrasados a la fecha" en la métrica elegida (Combinado/TukTuk).
  const lejos = [...estados.entries()]
    .map(([p, e]) => ({ partner: p, falta: e.falta ? e.falta[movM] || 0 : 0, pct: e.eva ? e.eva[movM] : null }))
    .filter(x => x.falta > 0 && x.pct != null).sort((a, b) => b.falta - a.falta).slice(0, 5);
  if (!suben.length && !bajan.length && !lejos.length) return "";
  const selM = String(segmented({ ariaLabel: t("ds.mov.metricaAria"), act: "dsSetMovMetric", value: movM,
    options: [{ value: "nr", label: t("metric.nr.short") }, { value: "ad", label: t("metric.ad.short") }, { value: "sh", label: t("metric.sh.short") }] }));
  return _rdSec(t("rend.mov.titulo"),
    t("ds.mov.sub", { m: _dsLblK(movM), d: prevDate ? d2s(prevDate) : t("rend.per.periodoAnterior") }), `<div class="rd-sec__right">${selM}</div>`) +
    `<div class="${lejos.length ? "ds-grid-3" : "rd-grid-2"}">
      ${_rdMovers(t("rd.mov.suben"), "trending-up", "good", suben, "+")}
      ${_rdMovers(t("rd.mov.bajan"), "trending-down", "bad", bajan, "−")}
      ${lejos.length ? `<div class="ui-card rd-mov"><div class="rd-mov__head rd-mov__head--warn">${iconSvg("target", { size: 16 })}<span>${escapeHTML(t("ds.mov.lejos", { m: _dsLblK(movM) }))}</span></div>
        <ul class="rd-mov__list">${lejos.map(x => `<li class="rd-mov__row"><span class="rd-mov__name">${_rdDot(STATE.partnerColors[x.partner] || "var(--cat-other)")}<span>${escapeHTML(x.partner)}</span></span>
          <span class="rd-mov__abs rd-mov__abs--bad">${escapeHTML(t("ds.mov.faltan", { n: _fmtH(x.falta) }))}</span><span class="rd-mov__pct">${x.pct.toFixed(1)}%</span></li>`).join("")}</ul></div>` : ""}
    </div>`;
}

// ── Avance por KAM: una tarjeta con barras por KPI ──────────────────────────
// Barra = avance del mes (actual / meta). Sombra = proyección al cierre (la
// MISMA de Metas). Marca = dónde debería ir hoy si avanzara parejo (solo flujos;
// AD es un nivel). El COLOR sale de lo que se espera al cierre (proyección, o
// el ritmo lineal sin proyección): a mitad de mes el acumulado contra la meta
// entera pintaba todo de rojo aunque el KAM fuera en camino.
function _dsEvalKpi(x, k, frac, proyOn) {
  if (!x || x.pct == null || !Number.isFinite(x.pct)) return null;
  if (proyOn && x.projPct != null && Number.isFinite(x.projPct)) return x.projPct;
  return k !== "ad" && frac > 0 && frac < 1 ? x.pct / frac : x.pct;
}
const _dsEstadoDe = v => v == null ? null : v >= 100 ? "sobre" : v >= 95 ? "camino" : v >= 80 ? "riesgo" : "atrasado";
const _DS_KC_TONO = { sobre: "over", camino: "ok", riesgo: "warn", atrasado: "bad" };
const _DS_KC_EST = { sobre: "ds.kamc.est.sobre", camino: "ds.kamc.est.camino", riesgo: "ds.kamc.est.riesgo", atrasado: "ds.kamc.est.atrasado" };
function _dsKamAvanceHTML(info, metaKam, lastRows, estados) {
  const dm = diasMesReporteDe(STATE, info.mesDates[info.mesDates.length - 1], parseLocalDate);
  const frac = dm.daysInMonth ? Math.min(dm.daysElapsed / dm.daysInMonth, 1) : 1;
  const enCurso = info.proyOn && frac < 1;
  const kamF = document.getElementById("kamFilter")?.value || "all";
  const conFilas = new Set(lastRows.map(r => _lineKamOf(r)));
  // Partners con meta y cuántos van bajo meta, por KAM.
  const porKam = new Map();
  estados.forEach((e, p) => {
    if (!e || e.estado === "sin") return;
    const k = _lineKamOf({ partner: p });
    const o = porKam.get(k) || { n: 0, bajo: 0 };
    o.n++; if (e.estado === "bajo") o.bajo++;
    porKam.set(k, o);
  });
  const cards = Object.keys(metaKam).filter(k => metaKam[k] && conFilas.has(k) && (kamF === "all" || kamF === k)).map(k => {
    const m = metaKam[k];
    const ev = {};
    _DS_K3.forEach(id => { ev[id] = m[id] && m[id].noComparable ? null : _dsEvalKpi(m[id], id, frac, info.proyOn); });
    const vals = _DS_K3.map(id => ev[id]).filter(v => v != null);
    const peor = vals.length ? Math.min(...vals) : null;
    return { k, m, ev, peor, est: _dsEstadoDe(peor) };
  });
  if (!cards.length) return "";
  cards.sort((a, b) => (a.k === SIN_KAM) - (b.k === SIN_KAM) || (a.peor ?? 1e9) - (b.peor ?? 1e9) || a.k.localeCompare(b.k));
  const w = v => Math.max(0, Math.min(100, v || 0)).toFixed(1);
  const fila = (k, id, x, ev) => {
    if (!x || x.noComparable) return `<div class="ds-kc__row ds-kc__row--vacia"><span class="ds-kc__k">${escapeHTML(_dsLblK(id))}</span><span class="rd-muted">${escapeHTML(t(x ? "ds.ad.noCompCorto" : "ds.kamc.sinMeta"))}</span></div>`;
    const tono = _DS_KC_TONO[_dsEstadoDe(ev)] || "neutral";
    const marca = enCurso && id !== "ad" ? `<span class="ds-kc__tick" style="left:${w(frac * 100)}%" title="${escapeHTML(t("ds.kamc.hoy", { p: (frac * 100).toFixed(0) }))}"></span>` : "";
    const proj = x.projPct != null && Number.isFinite(x.projPct) && info.proyOn
      ? `<span class="ds-kc__proj" style="width:${w(x.projPct)}%"></span>` : "";
    // El % grande es el avance real (neutro); el color va en lo que se espera
    // al cierre, que es el veredicto — un 70% morado se leía como "sobre meta".
    const projTxt = x.projPct != null && Number.isFinite(x.projPct) && info.proyOn
      ? `<small class="ds-pct--${tono}">${escapeHTML(t("ds.kamc.proy", { p: x.projPct.toFixed(0) + "%" }))}</small>` : "";
    return `<div class="ds-kc__row" title="${escapeHTML(t(x.soloProy ? "ds.meta.tipProy" : "ds.meta.tip", { a: x.F(Math.round(x.actual)), m: x.F(x.meta) }))}">
      <div class="ds-kc__lbl"><span class="ds-kc__k">${escapeHTML(_dsLblK(id))}${x.soloProy ? ` <small>${escapeHTML(t("ds.ad.proyCorto"))}</small>` : ""}</span><span class="ds-kc__nums">${escapeHTML(x.F(Math.round(x.actual)))} <span>/ ${escapeHTML(x.F(x.meta))}</span></span></div>
      <div class="ds-kc__track ds-kc__track--${tono}">${proj}<span class="ds-kc__fill" style="width:${w(x.pct)}%"></span>${marca}</div>
      <div class="ds-kc__pct"><span class="ds-pct"${dn("ds", "kam", k, id, "pct")}>${x.pct.toFixed(1)}%</span>${projTxt}</div>
    </div>`;
  };
  const leyenda = t(info.proyOn ? "ds.kamc.leyenda" : "ds.kamc.leyendaSinProy");
  let h = _rdSec(t("rend.kam.titulo"), t("ds.kamc.sub", { m: info.mesTxt }));
  h += `<p class="rd-note ds-kc-leyenda"><span class="ds-kc-ley ds-kc-ley--fill"></span>${escapeHTML(t("ds.kamc.ley.avance"))}` +
    (info.proyOn ? `<span class="ds-kc-ley ds-kc-ley--proj"></span>${escapeHTML(t("ds.kamc.ley.proy"))}` : "") +
    (enCurso ? `<span class="ds-kc-ley ds-kc-ley--tick"></span>${escapeHTML(t("ds.kamc.ley.hoy", { p: (frac * 100).toFixed(0) }))}` : "") +
    `<span class="ds-kc-leyenda__txt">${escapeHTML(leyenda)}</span></p>`;
  h += `<div class="ds-kcs">${cards.map(c => {
    const pk = porKam.get(c.k);
    const tono = _DS_KC_TONO[c.est] || "neutral";
    return `<div class="ds-kc ds-kc--${tono}">
      <div class="ds-kc__head"><span class="ds-kc__name">${_rdDot(_rdKamVar(c.k))}${escapeHTML(kamLabel(c.k))}</span>
        ${c.est ? `<span class="ds-estado ds-estado--${tono}">${escapeHTML(t(_DS_KC_EST[c.est]))}</span>` : ""}</div>
      ${pk ? `<div class="ds-kc__sub">${escapeHTML(t(pk.bajo ? "ds.kamc.partnersBajo" : "ds.kamc.partners", { n: pk.n, b: pk.bajo }))}</div>` : ""}
      <div class="ds-kc__rows">${_DS_K3.map(id => fila(c.k, id, c.m[id], c.ev[id])).join("")}</div>
    </div>`;
  }).join("")}</div>`;
  return h;
}

// ── Accionables (EXPERIMENTAL) ──────────────────────────────────────────────
// Reglas de domain/accionables.ts sobre lo que ya calculó la vista: resumen por
// partner (buildTable), estado contra la meta, flujo y metas por ciudad.
let _dsAccTab = "mercado";
const _DS_ACC_TXT = {
  brecha_nr: ["ds.acc.brecha_nr.t", "ds.acc.brecha_nr.a"],
  fuga: ["ds.acc.fuga.t", "ds.acc.fuga.a"],
  reactivar: ["ds.acc.reactivar.t", "ds.acc.reactivar.a"],
  sin_leads: ["ds.acc.sin_leads.t", "ds.acc.sin_leads.a"],
  declive: ["ds.acc.declive.t", "ds.acc.declive.a"],
  horas: ["ds.acc.horas.t", "ds.acc.horas.a"],
  replicar: ["ds.acc.replicar.t", "ds.acc.replicar.a"],
  kam_concentracion: ["ds.acc.kam_concentracion.t", "ds.acc.kam_concentracion.a"],
  kam_brecha: ["ds.acc.kam_brecha.t", "ds.acc.kam_brecha.a"],
  kam_retencion: ["ds.acc.kam_retencion.t", "ds.acc.kam_retencion.a"],
  kam_reactivar: ["ds.acc.kam_reactivar.t", "ds.acc.kam_reactivar.a"],
  re_cae: ["ds.acc.re_cae.t", "ds.acc.re_cae.a"],
  base_cae: ["ds.acc.base_cae.t", "ds.acc.base_cae.a"],
  ret_cae: ["ds.acc.ret_cae.t", "ds.acc.ret_cae.a"],
  ciudad_brecha: ["ds.acc.ciudad_brecha.t", "ds.acc.ciudad_brecha.a"],
  depende_react: ["ds.acc.depende_react.t", "ds.acc.depende_react.a"],
};
const _DS_ACC_PRIO = { alta: "ds.acc.prio.alta", media: "ds.acc.prio.media" };
function _dsAccTexto(a) {
  const pr = { ...a.params, sujeto: a.nivel === "mercado" && a.tipo === "ciudad_brecha" ? cityLabel(a.sujeto) : a.sujeto };
  Object.keys(pr).forEach(k => { if (typeof pr[k] === "number" && !["pct", "ret", "retPais", "retPrev", "tasa", "tasaPais", "caida", "crec", "hNow", "hPrev", "share"].includes(k)) pr[k] = fmt(pr[k]); });
  const k = _DS_ACC_TXT[a.tipo];
  return k ? { tit: t(k[0], pr), acc: t(k[1], pr) } : { tit: a.tipo, acc: "" };
}
function _dsAccLista(items, conSujeto) {
  if (!items.length) return `<p class="ds-acc__vacio">${escapeHTML(t("ds.acc.vacio"))}</p>`;
  return `<ul class="ds-acc__list">${items.map(a => {
    const x = _dsAccTexto(a);
    const suj = conSujeto && a.sujeto ? `<span class="ds-acc__suj">${a.nivel === "partner" ? _rdDot(STATE.partnerColors[a.sujeto] || "var(--cat-other)") : _rdDot(_rdKamVar(a.sujeto))}${escapeHTML(a.nivel === "kam" ? kamLabel(a.sujeto) : a.sujeto)}${a.nivel === "partner" && a.kam ? `<small>${escapeHTML(kamLabel(a.kam))}</small>` : ""}</span>` : "";
    return `<li class="ds-acc__it ds-acc__it--${a.prioridad}">
      <span class="ds-acc__prio" title="${escapeHTML(t(_DS_ACC_PRIO[a.prioridad] || "ds.acc.prio.media"))}"></span>
      <div class="ds-acc__body">${suj}<div class="ds-acc__t">${escapeHTML(x.tit)}</div><div class="ds-acc__a">${iconSvg("chevron-right", { size: 13 })}<span>${escapeHTML(x.acc)}</span></div></div>
    </li>`;
  }).join("")}</ul>`;
}
function _dsPintarAccionables({ flujo, estados, metaInfo, metaCiudad }) {
  const el = document.getElementById("dsAcc");
  if (!el) return;
  const diario = STATE.curMode === "diario";
  let frac = 1, semRest = 1, semTrans = 1;
  if (metaInfo) {
    const dm = diasMesReporteDe(STATE, metaInfo.mesDates[metaInfo.mesDates.length - 1], parseLocalDate);
    frac = dm.daysInMonth ? Math.min(dm.daysElapsed / dm.daysInMonth, 1) : 1;
    semRest = Math.max((dm.daysRemaining || 0) / 7, 1);
    semTrans = Math.max((dm.daysElapsed || 0) / 7, 1);
  }
  const partnersIn = (STATE.curSummaries || []).map(r => {
    const e = estados.get(r.partner);
    return {
      partner: r.partner, kam: r.kam, ad: r.ad, pad: r.pad, nr: r.nr, pnr: r.pnr, re: r.re || 0, pre: r.pre || 0,
      sh: r.sh, psh: r.psh, ns: r.ns, perdidos: diario ? 0 : r.perdidos || 0,
      retencion: diario || !(r.ret > _DS_SIN_RET) ? null : r.ret,
      eva: e && e.eva ? e.eva : null, declive: !!r.declineAlert,
      nrMeta: e && e.res && e.res.nr && e.res.nr.meta > 0 ? { meta: e.res.nr.meta, actual: e.res.nr.actual || 0 } : null
    };
  });
  const F = flujo && flujo.actual;
  const ciudades = Object.entries(metaCiudad || {}).map(([city, m]) => {
    const x = m && m.nr;
    if (!x) return { city, evaNr: null, faltaNr: null };
    return { city, evaNr: _dsEvalKpi(x, "nr", frac, metaInfo && metaInfo.proyOn),
      faltaNr: Math.max(x.meta * (metaInfo && metaInfo.proyOn && frac < 1 ? frac : 1) - (x.actual || 0), 0) };
  });
  const r = generarAccionables({
    partners: partnersIn, semanasRestantes: semRest, semanasTranscurridas: semTrans,
    mercado: {
      retencion: diario || !F ? null : F.retencion,
      retencionPrev: diario || !flujo.anterior ? null : flujo.anterior.retencion,
      entran: diario || !F ? 0 : F.ganados + F.volvieron, perdidos: diario || !F ? 0 : F.perdidos,
      serieRe: diario || !flujo ? [] : flujo.serie.map(x => x.reactivados), ciudades
    }
  });
  const listas = { mercado: r.mercado.slice(0, 6), kam: r.kam.slice(0, 6), partner: r.partner.slice(0, 10) };
  if (!listas.mercado.length && !listas.kam.length && !listas.partner.length) { el.innerHTML = ""; return; }
  if (!listas[_dsAccTab].length) _dsAccTab = ["mercado", "kam", "partner"].find(k => listas[k].length);
  const tabs = String(segmented({ ariaLabel: t("ds.acc.aria"), act: "dsSetAccTab", value: _dsAccTab,
    options: [["mercado", "ds.acc.tab.mercado"], ["kam", "ds.acc.tab.kam"], ["partner", "ds.acc.tab.partner"]]
      .map(([v, k]) => ({ value: v, label: `${t(k)} · ${listas[v].length}` })) }));
  el.innerHTML = _rdSec(t("ds.acc.titulo"), t("ds.acc.sub"),
      `<div class="rd-sec__right ds-acc__right"><span class="ds-acc__badge">${iconSvg("lightbulb", { size: 12 })}${escapeHTML(t("ds.acc.exp"))}</span>${tabs}</div>`) +
    `<div class="ui-card ds-acc">` +
    ["mercado", "kam", "partner"].map(k => `<div class="ds-acc__panel" data-acc="${k}"${k === _dsAccTab ? "" : " hidden"}>${_dsAccLista(listas[k], k !== "mercado")}</div>`).join("") +
    (diario ? `<p class="rd-note">${iconSvg("info", { size: 14 })}<span>${escapeHTML(t("ds.acc.diario"))}</span></p>` : "") +
    `</div>`;
}
export function dsSetAccTab(v) {
  if (!["mercado", "kam", "partner"].includes(v)) return;
  _dsAccTab = v;
  document.querySelectorAll('#dsAcc [data-act="dsSetAccTab"]').forEach(b => b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === v)));
  document.querySelectorAll("#dsAcc .ds-acc__panel").forEach(p => { p.hidden = p.getAttribute("data-acc") !== v; });
}

// ── Franja "¿Llegamos a la meta?" ────────────────────────────────────────────
export function _dsLlegamos(info, lastDate) {
  if (!info) return "";
  const dias = diasMesReporteDe(STATE, info.mesDates[info.mesDates.length - 1] || lastDate, parseLocalDate);
  let hay = false;
  // Una mini-tarjeta por KPI que va AL PIE de su propia tarjeta (Manuel,
  // 30-sep: "algo sutil… debajo de los principales KPIs"): así queda debajo de
  // su número en cualquier ancho (con 2 columnas una fila aparte se desalinea).
  const out = {};
  _DS_K3.forEach(k => {
    const x = info.kpis[k];
    if (x && x.noComparable) {
      out[k] = `<div class="ds-gap ds-gap--neutral"><div class="ds-gap__big">${escapeHTML(t(x.noCompSemanal ? "ds.ad.semCerrado" : "ds.ad.diario", { n: (x.F || fmt)(x.meta) }))}</div></div>`;
      hay = true;
      return;
    }
    if (x && x.soloProy) {
      // Semanal: el actual de AD YA es la proyección. Veredicto y cuánto le
      // falta a la proyección para la meta; sin "ritmo" (AD es un nivel).
      const F = x.F || fmt, p = x.pct, ok = p >= 100;
      hay = true;
      out[k] = `<div class="ds-gap ds-gap--${ok ? "ok" : "warn"}" title="${escapeHTML(t("ds.ad.semTip"))}">
        <div class="ds-gap__verd">${iconSvg(ok ? "check-circle" : "alert-triangle", { size: 13 })}<span>${escapeHTML(t(ok ? "ds.lleg.llega" : "ds.lleg.noLlega", { p: p.toFixed(1) + "%" }))}</span></div>
        <div class="ds-gap__big">${ok ? `${escapeHTML(t("ds.ad.semSupera"))} <b>${F(Math.round(x.actual - x.meta))}</b>` : `${escapeHTML(t("ds.ad.semFalta"))} <b${dn("ds", "falta", k)}>${F(Math.round(Math.max(x.meta - x.actual, 0)))}</b>`}</div>
        <div class="ds-gap__ritmo">${escapeHTML(t("ds.ad.semPie", { a: F(Math.round(x.actual)), n: F(x.meta) }))}</div>
      </div>`;
      return;
    }
    if (!x || !(x.meta > 0) || x.actual == null) return;
    const b = calcularBrecha({ tipo: k === "ad" ? "nivel" : "flujo", actual: x.actual, meta: x.meta,
      proj: info.proyOn ? x.proj : null, diasTranscurridos: dias.daysElapsed, diasRestantes: dias.daysRemaining });
    if (!b) return;
    hay = true;
    const F = x.F || fmt;
    const tono = b.cerrado ? (b.pct >= 100 ? "ok" : "warn") : (b.llega ? "ok" : "warn");
    const verd = b.cerrado
      ? t("ds.lleg.cerro", { p: b.pct.toFixed(1) + "%" })
      : t(b.llega ? "ds.lleg.llega" : "ds.lleg.noLlega", { p: b.projPct.toFixed(1) + "%" });
    const falta = b.falta <= 0 ? escapeHTML(t("ds.lleg.alcanzada"))
      : `${escapeHTML(t("ds.lleg.faltan"))} <b${dn("ds", "falta", k)}>${F(Math.round(b.falta))}</b>` +
        (k !== "ad" && !b.cerrado ? ` ${escapeHTML(t("ds.lleg.enDias", { n: dias.daysRemaining }))}` : "");
    const ritmo = k !== "ad" && !b.cerrado && b.falta > 0 && b.ritmoActual != null
      ? `<div class="ds-gap__ritmo">${escapeHTML(t("ds.lleg.ritmoAct"))} <b>${F(Math.round(b.ritmoActual))}</b>/${escapeHTML(t("ds.lleg.sem"))} · ${escapeHTML(t("ds.lleg.ritmoNec"))} <b class="${b.ritmoNecesario > b.ritmoActual ? "ds-bad" : ""}">${b.ritmoNecesario == null ? "—" : F(Math.round(b.ritmoNecesario))}</b>/${escapeHTML(t("ds.lleg.sem"))}</div>`
      : "";
    out[k] = `<div class="ds-gap ds-gap--${tono}" role="group" aria-label="${escapeHTML(t("ds.lleg.titulo", { m: info.mesTxt }))}" title="${escapeHTML(info.proyOn ? t("ds.lleg.sub") : t("ds.lleg.subCerrado"))}">
      <div class="ds-gap__verd">${iconSvg(tono === "ok" ? "check-circle" : "alert-triangle", { size: 13 })}<span>${escapeHTML(verd)}</span></div>
      <div class="ds-gap__big">${falta}</div>${ritmo}
    </div>`;
  });
  return hay ? out : null;
}

// ── Flujo de conductores ─────────────────────────────────────────────────────
// Cuentas = partners del alcance (filas de aggPD: una por partner y fecha).
function _dsCuentas(rowsNow, rowsPrev) {
  const m = new Map();
  const g = p => { let o = m.get(p); if (!o) { o = { ad: 0, adPrev: 0, nr: 0, re: 0 }; m.set(p, o); } return o; };
  rowsNow.forEach(r => { const o = g(r.partner); o.ad += r.activeDrivers || 0; o.nr += _dsNR(r); o.re += r.reactivated || 0; });
  rowsPrev.forEach(r => { g(r.partner).adPrev += r.activeDrivers || 0; });
  return m;
}
/** Flujo del período y del anterior, más la serie por período del rango.
 *  Mensual con el mes EN CURSO: el último mes está a medias (su AD es parcial y
 *  fabricaría bajas), así que se usa el último mes CERRADO y se dice. */
function _dsFlujoData(apd, dates, lastDate, prevDate, prevRows, mesParcial, filtrarPrev) {
  let rNow = apd.filter(r => r.date === lastDate), rPrev = prevRows;
  let dNow = lastDate, dPrev = prevDate;
  const idx = STATE.allDates.indexOf(lastDate);
  if (mesParcial && prevDate) {
    const pp = idx > 1 ? STATE.allDates[idx - 2] : "";
    rNow = prevRows; rPrev = pp ? filtrarPrev(pp) : [];
    dNow = prevDate; dPrev = pp;
  }
  const actual = flujoTotal(_dsCuentas(rNow, rPrev).values());
  // Período anterior al mostrado, para el delta de cada tarjeta.
  const i2 = STATE.allDates.indexOf(dPrev);
  const dPP = i2 > 0 ? STATE.allDates[i2 - 1] : "";
  const anterior = dPP ? flujoTotal(_dsCuentas(rPrev, filtrarPrev(dPP)).values()) : null;
  // Serie: cada período del rango contra el anterior (dentro del rango).
  const porFecha = new Map();
  apd.forEach(r => { let a = porFecha.get(r.date); if (!a) { a = []; porFecha.set(r.date, a); } a.push(r); });
  const serie = [];
  dates.forEach((d, i) => {
    if (i === 0) return;
    if (mesParcial && d === lastDate) return;
    const f = flujoTotal(_dsCuentas(porFecha.get(d) || [], porFecha.get(dates[i - 1]) || []).values());
    serie.push({ date: d, ...f });
  });
  return { actual, anterior, dNow, dPrev, serie, rNow, rPrev };
}
function _dsFlujoTile(label, valor, cur, prev, sub, numKey, opts = {}) {
  const d = prev == null ? "" : _rdDelta(cur, prev, { invert: !!opts.invert });
  return `<div class="rd-tile ds-flujo__tile${opts.cls ? " " + opts.cls : ""}">
    <div class="rd-tile__lbl">${escapeHTML(label)}</div>
    <div class="rd-tile__val"${numKey ? dn(numKey) : ""}>${escapeHTML(valor)}</div>
    ${d ? `<div class="rd-tile__delta">${d}<span class="rd-tile__prev">${escapeHTML(t("ds.flujo.vsAnt"))}</span></div>` : ""}
    <div class="rd-tile__sub">${escapeHTML(sub)}</div></div>`;
}
export function _dsFlujoHTML(F) {
  _dsRetLastDate = F ? F.dNow : "";
  // En diario el flujo no se lee: un conductor que no maneja todos los días
  // aparece como "perdido" y "vuelve" al día siguiente.
  if (STATE.curMode === "diario") {
    return _rdSec(t("ds.flujo.titulo"), "") + `<p class="rd-note">${iconSvg("info", { size: 14 })}<span>${escapeHTML(t("ds.flujo.diario"))}</span></p>`;
  }
  const a = F.actual, p = F.anterior;
  if (!(a.base > 0)) return "";
  const ret = v => v == null ? "—" : (v * 100).toFixed(1) + "%";
  const sub = t("ds.flujo.sub", { a: d2s(F.dNow), b: d2s(F.dPrev) });
  let h = _rdSec(t("ds.flujo.titulo"), sub);
  const pctRe = a.ganados > 0 ? Math.round(a.reactivados / a.ganados * 100) : null;
  h += `<div class="rd-kpis rd-kpis--tiles ds-flujo">
    ${_dsFlujoTile(t("ds.flujo.nuevos"), "+" + fmt(a.nuevos), a.nuevos, p && p.nuevos, t("ds.flujo.nuevosSub"), "ds.flujo.nuevos")}
    ${_dsFlujoTile(t("ds.flujo.reactivados"), "+" + fmt(a.reactivados), a.reactivados, p && p.reactivados, pctRe == null ? "" : t("ds.flujo.reactivadosSub", { p: pctRe }), "ds.flujo.reactivados")}
    ${_dsFlujoTile(t("ds.flujo.perdidos"), "−" + fmt(a.perdidos), a.perdidos, p && p.perdidos, t("ds.flujo.perdidosSub"), "ds.flujo.perdidos", { invert: true })}
    ${_dsFlujoTile(t("ds.flujo.neto"), (a.neto >= 0 ? "+" : "−") + fmt(Math.abs(a.neto)), a.neto, null, t(a.neto > 0 ? "ds.flujo.crece" : a.neto < 0 ? "ds.flujo.cae" : "ds.flujo.estable") + (a.volvieron > 0 ? " · " + t("ds.flujo.intermit", { n: fmt(a.volvieron) }) : ""), "ds.flujo.neto", { cls: a.neto >= 0 ? "ds-neto--up" : "ds-neto--down" })}
    ${_dsFlujoTile(t(STATE.curMode === "mensual" ? "ds.flujo.retMes" : "ds.flujo.retSem"), ret(a.retencion), a.retencion, p && p.retencion, t("ds.flujo.retSub", { r: fmt(a.retenidos), b: fmt(a.base) }), "ds.flujo.ret")}
  </div>`;
  // Fórmula a la vista (la misma de la Presentación) y, en semanal, la
  // retención MENSUAL como referencia: la semanal (~88%) no se compara con la
  // mensual (~73%) del deck. La mensual se calcula si ya está en memoria (la
  // cargan Presentación y Calculadora); si no, un botón la trae — no se
  // precarga para no volver a subir el egress (ver "Egress de Supabase").
  h += `<p class="rd-note ds-ret-nota">${iconSvg("info", { size: 14 })}<span>${escapeHTML(t("ds.flujo.formula"))}${STATE.curMode === "semanal" ? " " + escapeHTML(t("ds.flujo.escalaSem")) : ""}</span>` +
    (STATE.curMode === "semanal" ? `<span id="dsRetRef" class="ds-ret-ref">${_dsRetMensualRefHTML()}</span>` : "") + `</p>`;
  // Por KAM: dónde se ganan y dónde se pierden conductores.
  const kNow = particionarPorKam(F.rNow, _lineKamOf), kPrev = particionarPorKam(F.rPrev, _lineKamOf);
  const kams = ordenarKams([...kNow.keys(), ...kPrev.keys()], SIN_KAM);
  const filas = kams.map(k => ({ k, f: flujoTotal(_dsCuentas(kNow.get(k) || [], kPrev.get(k) || []).values()) }))
    .filter(x => x.f.base > 0 || x.f.ganados > 0);
  if (filas.length > 1) {
    h += `<div class="ui-table-wrap rd-tabla-compacta ds-flujo__kam"><table class="ui-table rd-table"><thead><tr>
      <th scope="col">KAM</th><th scope="col" class="ui-num">${escapeHTML(t("ds.flujo.nuevos"))}</th><th scope="col" class="ui-num">${escapeHTML(t("ds.flujo.reactivados"))}</th><th scope="col" class="ui-num" title="${escapeHTML(t("ds.flujo.volvieronSub"))}">${escapeHTML(t("ds.flujo.volvieron"))}</th><th scope="col" class="ui-num">${escapeHTML(t("ds.flujo.perdidos"))}</th>
      <th scope="col" class="ui-num">${escapeHTML(t("ds.flujo.neto"))}</th><th scope="col" class="ui-num">${escapeHTML(t("ds.flujo.retencion"))}</th></tr></thead><tbody>` +
      filas.map(({ k, f }) => `<tr><th scope="row" class="rd-rowhead">${_rdDot(_rdKamVar(k))}${escapeHTML(kamLabel(k))}</th>
        <td class="ui-num ds-pos"${dn("ds", "flujo", "kam", "nuevos", k)}>+${fmt(f.nuevos)}</td>
        <td class="ui-num ds-pos"${dn("ds", "flujo", "kam", "reactivados", k)}>+${fmt(f.reactivados)}</td>
        <td class="ui-num rd-muted">+${fmt(f.volvieron)}</td>
        <td class="ui-num ds-neg"${dn("ds", "flujo", "kam", "perdidos", k)}>−${fmt(f.perdidos)}</td>
        <td class="ui-num ${f.neto >= 0 ? "ds-pos" : "ds-neg"}">${f.neto >= 0 ? "+" : "−"}${fmt(Math.abs(f.neto))}</td>
        <td class="ui-num"${dn("ds", "flujo", "kam", "ret", k)}>${ret(f.retencion)}</td></tr>`).join("") + `</tbody></table></div>`;
  }
  if (F.serie.length >= 2) {
    h += `<div class="rd-grid-2">${_rdChart("dsCh_flujo", t("ds.flujo.chGanPer"), "Flujo_conductores")}${_rdChart("dsCh_ret", t("ds.flujo.chRet"), "Retencion")}</div>`;
  }
  return h;
}
export function _dsPintarFlujo(F) {
  if (!F || F.serie.length < 2) return;
  const tk = chartTokens();
  const cats = F.serie.map(x => x.date);
  if (document.getElementById("dsCh_flujo"))
    buildLineChart("dsCh_flujo", cats, [
      { name: t("ds.flujo.nuevos"), data: F.serie.map(x => x.nuevos) },
      { name: t("ds.flujo.reactivados"), data: F.serie.map(x => x.reactivados) },
      { name: t("ds.flujo.perdidos"), data: F.serie.map(x => x.perdidos) }
    ], [seriesColor(2, tk), seriesColor(4, tk), seriesColor(3, tk)], ESTILO_SUAVE);
  if (document.getElementById("dsCh_ret"))
    buildLineChart("dsCh_ret", cats, [{ name: t("ds.flujo.retencion"), data: F.serie.map(x => x.retencion == null ? null : Math.round(x.retencion * 1000) / 10) }],
      [seriesColor(0, tk)], { ...ESTILO_SUAVE, yaxis: { labels: { formatter: v => v == null ? "" : v.toFixed(0) + "%" } } });
}

// Retención MENSUAL de referencia (último mes cerrado antes del período
// mostrado) con el mismo alcance que la vista: línea, ciudad, KAM y partners.
let _dsRetLastDate = "";
function _dsRetMensualRef(lastDate) {
  if (!STATE._mensualLoaded) return null;
  const line = _rendLine();
  const aggM = STATE.rawDataMensual || [], tkM = sliceEscala(STATE, "Tuktuk", "mensual");
  const base = line === "tk" ? tkM : line === "comb" ? aggM.concat(tkM) : line === "agg" ? aggM : [];
  if (!base.length) return null;
  const f = getCurrentFilters();
  const selSet = new Set(f.selected), sidebar = new Set(STATE.sidebarPartners || STATE.allPartners);
  const rows = base.filter(r => (f.city === "all" || r.city === f.city) &&
    (f.kam === "all" || _lineKamOf(r) === f.kam) && _lineSelHas(selSet, sidebar, r.partner));
  const ym = String(lastDate || "").slice(0, 7);
  const meses = [...new Set(rows.map(r => String(r.date).slice(0, 7)))].sort().filter(m => m < ym);
  if (meses.length < 2) return null;
  const m1 = meses[meses.length - 1], m0 = meses[meses.length - 2];
  const tot = m => rows.filter(r => String(r.date).slice(0, 7) === m).reduce((o, r) => {
    o.ad += r.activeDrivers || 0; o.nr += (r.newPartner || 0) + (r.newService || 0) + (r.reactivated || 0); o.re += r.reactivated || 0; return o;
  }, { ad: 0, nr: 0, re: 0 });
  const a = tot(m1), b = tot(m0);
  const fl = flujoCuenta({ ad: a.ad, adPrev: b.ad, nr: a.nr, re: a.re });
  return fl.retencion == null ? null : { ret: fl.retencion, m1, m0 };
}
function _dsRetMensualRefHTML() {
  const r = _dsRetMensualRef(_dsRetLastDate);
  if (r) {
    const mes = m => {
      try { return new Intl.DateTimeFormat(getLang(), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, +m.slice(5, 7) - 1, 15))); }
      catch (e) { return m; }
    };
    return `${escapeHTML(t("ds.flujo.refMensual", { a: mes(r.m1), b: mes(r.m0) }))} <b${dn("ds", "flujo", "retMensual")}>${(r.ret * 100).toFixed(1)}%</b>`;
  }
  return STATE._mensualLoaded ? "" : `<button type="button" class="ds-ret-btn" data-act="dsRetMensual">${escapeHTML(t("ds.flujo.verMensual"))}</button>`;
}
export async function dsRetMensual() {
  const el = document.getElementById("dsRetRef");
  if (el) el.innerHTML = `<span class="rd-muted">${escapeHTML(t("ds.flujo.cargandoMensual"))}</span>`;
  try { if (typeof loadMensualIfNeeded === "function") await loadMensualIfNeeded(true); } catch (e) { /* el aviso lo da la carga */ }
  const el2 = document.getElementById("dsRetRef");
  if (el2) el2.innerHTML = _dsRetMensualRefHTML() || `<span class="rd-muted">${escapeHTML(t("ds.flujo.sinMensual"))}</span>`;
}

// ── Meta por grupo (ciudad / KAM), con la MISMA función que el total ──────────
export function _dsMetaGrupo(line, lastDate, over) {
  const r = _rendMetaMes(line, lastDate, over);
  if (!r) return null;
  const out = {};
  _DS_K3.forEach(k => {
    const x = r.kpis[k];
    if (x && x.noComparable) { out[k] = { noComparable: true }; return; }
    out[k] = x && x.meta > 0 && x.pct != null ? { pct: x.pct, projPct: x.proj != null && r.proyOn ? x.proj / x.meta * 100 : null, actual: x.actual, meta: x.meta, F: x.F || fmt, soloProy: !!x.soloProy } : null;
  });
  return out;
}
export function _dsMetaFilas(m, numKeyBase) {
  if (!m) return "";
  return `<div class="ds-metarows">${_DS_K3.map(k => {
    const x = m[k] && m[k].noComparable ? null : m[k];
    const tip = x ? t(x.soloProy ? "ds.meta.tipProy" : "ds.meta.tip", { a: x.F(Math.round(x.actual)), m: x.F(x.meta) })
      : m[k] && m[k].noComparable ? t("ds.ad.noCompCorto") : "";
    return `<div class="ds-metarow" title="${escapeHTML(tip)}">
      <span class="ds-metarow__k">${escapeHTML(_dsLblK(k))}${x && x.soloProy ? ` <small>${escapeHTML(t("ds.ad.proyCorto"))}</small>` : ""}</span>${_dsBar(x ? x.pct : null, x ? x.projPct : null)}${_dsPct(x ? x.pct : null, x ? [numKeyBase, k, "pct"].join(".") : null)}</div>`;
  }).join("")}</div>`;
}

// ── Estado contra la meta por partner (tabla) ────────────────────────────────
// Combinado y TukTuk: cuentas de metasCuentasLinea agrupadas por partner
// (sus ciudades juntas, como la tabla). Agregador no tiene esta ruta en Metas:
// la columna queda en "—".
export function _dsEstadoPorPartner(line, info) {
  const out = new Map();
  if (!info || (line !== "comb" && line !== "tk")) return out;
  const c = metasCuentasLinea({ line, mesName: info.mes, anio: info.anio, fechas: info.mesDates, filtros: info.filtros });
  if (!c) return out;
  const dm = diasMesReporteDe(STATE, info.mesDates[info.mesDates.length - 1], parseLocalDate);
  const frac = dm.daysInMonth ? Math.min(dm.daysElapsed / dm.daysInMonth, 1) : 1;
  const porP = new Map();
  c.cuentas.forEach(x => { let a = porP.get(x.partner); if (!a) { a = []; porP.set(x.partner, a); } a.push(x); });
  porP.forEach((xs, p) => {
    const conMeta = xs.filter(x => !x.sinMeta);
    if (!conMeta.length) { out.set(p, { estado: "sin", peor: null, pct: {} }); return; }
    const res = c.resumen(xs.map(x => x.u));
    // Con el mes EN CURSO el estado se lee por la PROYECCIÓN al cierre (la
    // misma de la franja y de Metas): el acumulado a mitad de mes contra la
    // meta del mes entero pintaba "bajo meta" a casi todos. Mes cerrado: el %.
    const pct = {}, eva = {};
    const diario = STATE.curMode === "diario";
    // Semanal: AD solo por su proyección (sin ella, no se compara).
    const semanal = STATE.curMode === "semanal";
    const adFuera = diario || (semanal && !(c.proyOn && res.ad && res.ad.proj != null));
    _DS_K3.forEach(k => {
      const x = adFuera && k === "ad" ? null : res[k];
      pct[k] = x && x.meta > 0 ? x.pct : null;
      // Sin proyección con el mes en curso (Metas no proyecta en diario): el %
      // se lee contra lo esperado a la fecha (ritmo lineal) en los flujos.
      eva[k] = x && x.meta > 0 ? (c.proyOn && x.proj != null ? x.proj / x.meta * 100
        : (k !== "ad" && frac > 0 && frac < 1 && x.pct != null ? x.pct / frac : x.pct)) : null;
    });
    const ps = _DS_K3.map(k => eva[k]).filter(v => v != null && Number.isFinite(v));
    const peor = ps.length ? Math.min(...ps) : null;
    // Atraso A LA FECHA: flujos contra el ritmo lineal de su meta; AD (nivel)
    // contra la meta directa.
    const falta = {};
    _DS_K3.forEach(k => {
      const x = adFuera && k === "ad" ? null : res[k];
      if (!x || !(x.meta > 0)) { falta[k] = 0; return; }
      const esperado = k === "ad" || !c.proyOn ? x.meta : x.meta * frac;
      const act = k === "ad" && semanal ? x.proj : x.actual;
      falta[k] = Math.max(esperado - (act || 0), 0);
    });
    out.set(p, { estado: peor == null ? "sin" : ps.some(v => v < 95) ? "bajo" : ps.every(v => v >= 100) ? "sobre" : "en", peor, pct, eva, falta, res });
  });
  return out;
}
const _DS_ESTADOS = [["todos", "ds.est.todos", "neutral"], ["bajo", "ds.est.bajo", "bad"], ["en", "ds.est.en", "ok"], ["sobre", "ds.est.sobre", "over"], ["sin", "ds.est.sin", "neutral"]];
export function _dsChipsEstado() {
  const S = STATE.curSummaries || [];
  if (!S.some(s => s.estado)) return "";
  const n = v => v === "todos" ? S.length : S.filter(s => s.estado === v).length;
  return `<div class="ds-chips" role="group" aria-label="${escapeHTML(t("ds.est.aria"))}">${_DS_ESTADOS.map(([v, key, tono]) =>
    `<button type="button" class="ds-chip ds-chip--${tono}${_dsFiltroEstado === v ? " is-on" : ""}" data-act="dsSetEstado" data-value="${v}" aria-pressed="${_dsFiltroEstado === v}">${escapeHTML(t(key))}<b>${n(v)}</b></button>`).join("")}</div>`;
}
export function dsSetEstado(v) {
  _dsFiltroEstado = _DS_ESTADOS.some(e => e[0] === v) ? v : "todos";
  const c = document.getElementById("dsChips");
  if (c) c.innerHTML = _dsChipsEstado();
  renderTable();
}
export function dsSetMovMetric(v) {
  if (!["nr", "ad", "sh"].includes(v)) return;
  if (_dsMovMetric === v) return;
  _dsMovMetric = v;
  const el = document.getElementById("dsMovers");
  if (el && _dsMovCtx) el.innerHTML = _dsMoversHTML();
  else renderRend();
}
export const _dsGetFiltroEstado = () => _dsFiltroEstado;
export const _dsGetMovMetric = () => _dsMovMetric;

// Tendencias contra la meta: AD del alcance por período vs el nivel de meta;
// N+R acumulado dentro del mes de la meta vs el ritmo lineal hasta la meta.
export function _dsPintarMeta(info, apd, dates) {
  const tk = chartTokens();
  const tot = new Map();
  apd.forEach(r => { const o = tot.get(r.date) || { ad: 0, nr: 0 }; o.ad += r.activeDrivers || 0; o.nr += _dsNR(r); tot.set(r.date, o); });
  const ad = info.kpis.ad, nr = info.kpis.nr;
  if (document.getElementById("dsCh_adMeta") && ad && ad.meta > 0) {
    // Semanal: solo la proyección (AD de la semana × 1.4, la regla de Metas),
    // no el nivel semanal contra una meta mensual (decisión de Manuel, 30-sep).
    const f = ad.soloProy ? AD_PROJECTION_FACTOR : 1;
    buildLineChart("dsCh_adMeta", dates, [
      { name: ad.soloProy ? t("ds.tend.adProy") : t("metric.ad.label"), data: dates.map(d => Math.round(((tot.get(d) || {}).ad || 0) * f)) },
      { name: t("ds.tend.metaMes"), data: dates.map(() => ad.meta) }
    ], [seriesColor(0, tk), tk.textMuted], { ...ESTILO_SUAVE, stroke: { width: [3, 2], dashArray: [0, 6] } });
  }
  if (document.getElementById("dsCh_nrMeta") && nr && nr.meta > 0) {
    const md = info.mesDates.filter(d => tot.has(d));
    let acc = 0;
    const acum = md.map(d => (acc += (tot.get(d) || {}).nr || 0));
    const ritmo = md.map(d => {
      const x = diasMesReporteDe(STATE, d, parseLocalDate);
      return Math.round(nr.meta * x.daysElapsed / (x.daysInMonth || 30));
    });
    buildLineChart("dsCh_nrMeta", md, [
      { name: t("ds.tend.acumMes"), data: acum },
      { name: t("ds.tend.ritmoMeta"), data: ritmo }
    ], [seriesColor(1, tk), tk.textMuted], { ...ESTILO_SUAVE, stroke: { width: [3, 2], dashArray: [0, 6] } });
  }
}
const _DS_EST_CLS = { bajo: "bad", en: "ok", sobre: "over", sin: "neutral" };
function _dsEstadoCelda(r) {
  if (!r.estado) return `<span class="rd-muted">—</span>`;
  const lbl = t({ bajo: "ds.est.bajo", en: "ds.est.en", sobre: "ds.est.sobre", sin: "ds.est.sin" }[r.estado]);
  const tip = r.metaPct ? t("ds.est.tip") + " " + _DS_K3.map(k => `${_dsLblK(k)} ${r.metaPct[k] == null ? "—" : r.metaPct[k].toFixed(1) + "%"}`).join(" · ") : "";
  // Compacto (la tabla entra sin scroll horizontal): solo el % coloreado; el
  // estado en palabras va en el tooltip y en los chips de filtro de arriba.
  const tit = lbl + (tip ? " · " + tip : "");
  // Botón (3-oct-2026): en el celular no hay hover, así que el estado y el % de
  // cada KPI, que vivían solo en el `title`, no se podían ver. Tocar la píldora
  // abre una tarjetita con el detalle (_dsEstadoPop); el `title` queda para el
  // mouse.
  return `<button type="button" class="ds-estado ds-estado--${_DS_EST_CLS[r.estado]} ds-estado--btn" title="${escapeHTML(tit)}" aria-label="${escapeHTML(tit)}" aria-expanded="false" data-act="dsEstadoInfo" data-partner="${escapeHTML(r.partner)}">${r.pctPeor < 9999 ? `<b${dn("ds", "tabla", "peor", r.partner)}>${r.pctPeor.toFixed(1)}%</b>` : escapeHTML(lbl)}</button>`;
}

// ── Detalle del % meta al tocar (táctil y mouse) ─────────────────────────────
function _dsCerrarEstadoPop() {
  document.getElementById("dsEstadoPop")?.remove();
  document.querySelectorAll('[data-act="dsEstadoInfo"][aria-expanded="true"]').forEach(b => b.setAttribute("aria-expanded", "false"));
}
let _dsEstadoCierre = false;
function _dsInstalarCierreEstado() {
  if (_dsEstadoCierre) return;
  _dsEstadoCierre = true;
  document.addEventListener("pointerdown", e => {
    const tg = e.target;
    if (!document.getElementById("dsEstadoPop")) return;
    if (tg && tg.closest && (tg.closest("#dsEstadoPop") || tg.closest('[data-act="dsEstadoInfo"]'))) return;
    _dsCerrarEstadoPop();
  }, true);
  document.addEventListener("scroll", () => { if (document.getElementById("dsEstadoPop")) _dsCerrarEstadoPop(); }, { capture: true, passive: true });
  document.addEventListener("keydown", e => { if (e.key === "Escape") _dsCerrarEstadoPop(); });
}
function _dsEstadoPop(d, el) {
  const abierto = el.getAttribute("aria-expanded") === "true";
  _dsCerrarEstadoPop();
  if (abierto) return;                                   // segundo toque: cerrar
  const r = (STATE.curSummaries || []).find(x => x.partner === d.partner);
  if (!r || !r.estado) return;
  _dsInstalarCierreEstado();
  const est = _DS_EST_CLS[r.estado];
  const lbl = t({ bajo: "ds.est.bajo", en: "ds.est.en", sobre: "ds.est.sobre", sin: "ds.est.sin" }[r.estado]);
  const filas = r.metaPct ? _DS_K3.map(k => {
    const v = r.metaPct[k];
    return `<li><span>${escapeHTML(_dsLblK(k))}</span><b class="ds-estado-pop__v ds-estado-pop__v--${_dsTone(v)}">${v == null ? "—" : v.toFixed(1) + "%"}</b></li>`;
  }).join("") : "";
  const pop = document.createElement("div");
  pop.id = "dsEstadoPop";
  pop.className = "ds-estado-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", d.partner + " · " + lbl);
  pop.innerHTML = `<div class="ds-estado-pop__h"><strong>${escapeHTML(d.partner)}</strong><span class="ds-estado ds-estado--${est}">${escapeHTML(lbl)}</span></div>
    ${filas ? `<p class="ds-estado-pop__sub">${escapeHTML(t("ds.est.tip"))}</p><ul class="ds-estado-pop__l">${filas}</ul>` : ""}`;
  document.body.appendChild(pop);
  // Debajo de la píldora (o arriba si no entra), siempre dentro de la pantalla.
  const b = el.getBoundingClientRect(), M = 8;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = b.right - w, y = b.bottom + 6;
  if (y + h > window.innerHeight - M) y = b.top - h - 6;
  x = Math.max(M, Math.min(x, window.innerWidth - w - M));
  y = Math.max(M, y);
  pop.style.left = Math.round(x) + "px";
  pop.style.top = Math.round(y) + "px";
  el.setAttribute("aria-expanded", "true");
}
