//@ts-nocheck
// presentacionLote.ts — Presentación: descarga de la CARTERA de un KAM (30-sep-2026).
//
// Pedido de Manuel: "hay KAMs con 13-19 cuentas y será más rápido para ellos…
// modificar masivamente rápido". Eligió la propuesta 3 de la maqueta (matriz
// partners × tipos de hoja, ?ui=proto&p=pres&bv=b3) y pidió mejorar su UX.
//
// Cómo se lee la matriz:
//   · Columna = tipo de hoja (Carátula, KPIs, Data Raw…). Clic en su nombre la
//     prende o apaga en TODO el lote (y borra las excepciones de ese tipo).
//   · Celda = ese tipo en ese partner. Clic: solo ese partner. Mayús+clic: el
//     mismo valor para todo el tramo de filas desde la última celda tocada.
//   · "—": ese partner no tiene esa hoja (no opera esa línea, sin datos de
//     embudo, sin tareas de seguimiento…). Misma regla que p2Deck.
//   · Vista por partner: automática (Fleet si el partner es Fleet) o forzada.
// Las reglas viven en domain/loteHojas.ts (con tests).
//
// Salida: una presentación por partner, generada con el MISMO motor que la
// descarga individual (p2GenerarPdf). Cada PDF pesa ~15-20 MB, así que NO se
// arma un .zip en memoria (19 cuentas ≈ 350 MB): con "Carpeta" el navegador
// pide elegir una carpeta y cada PDF se escribe apenas termina; sin soporte
// (Safari/Firefox) se descargan uno por uno.
//
// Sin parpadeo: cada acción repinta SOLO #p2LoteBody (matriz + pie), nunca la
// barra ni el resto de la pestaña (en la maqueta cada clic rehacía la página).

import { t, getLang, kamLabel } from "./core/i18n";
import { SIN_KAM } from "./core/config.js";
import { escapeHTML } from "./core/security";
import { d2s } from "./core/format";
import { segmented, infoTip } from "./shared/ui";
import { iconSvg } from "./shared/icons";
import { alertDialog, confirmDialog } from "./shared/confirmDialog";
import { ensurePdfLibs } from "./shared/lazyLibs.js";
import { logAccess } from "./shared/accessLog.js";
import { registerActions } from "./shared/actions.js";
import { mesL } from "./core/i18nExport";
import { ordenarKams } from "./domain/desgloseKam";
import {
  TIPOS, tipoDeEtiqueta, incluida, fijarHoja, fijarTipoTodos, aplicarPlantilla,
  plantillaActiva, tieneExcepciones, limpiarPartner, estadoDe, siguienteValor, PLANTILLAS, reglasIniciales
} from "./domain/loteHojas";
import {
  PRESENT2_STATE, P2_LANGS, p2Deck, p2SlideKey, p2GenerarPdf, p2NombrePdf, p2ChequeoExport, p2SlideLabelUI,
  p2HasTaxi, p2TuktukSectionVisible, p2TieneVertical, p2PartnerList, p2MetaMeses, p2AvanceMes,
  destroyPresent2Charts, renderPresent2, p2PdfOffDefecto
} from "./presentacion2";

// Segundos por hoja medidos (html2canvas a escala 4 + espera de gráficos).
const SEG_POR_HOJA = 1.8, SEG_POR_PDF = 1.5;

export const P2_LOTE = {
  modo: "uno",                  // "uno" | "cartera"
  kam: null,
  reglas: null,                 // domain/loteHojas.Reglas (se crea al abrir)
  vista: {},                    // partner → "auto" | "taxi" | "fleet"
  sel: null,                    // Set de partners elegidos; null = todos
  destino: "carpeta",           // "carpeta" | "descargas"
  fase: "config",               // "config" | "generando" | "listo"
  prog: {},                     // partner → { estado, hechas, total, err }
  cancelar: false,
  anclaFila: null, anclaCelda: null,
  resultado: null
};

const _puedeCarpeta = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

// ── Datos ─────────────────────────────────────────────────────────────────────
export function p2LoteKams() {
  const lista = new Set(p2PartnerList());
  const kp = STATE.KAM_PARTNERS || {};
  return ordenarKams(Object.keys(kp).filter(k => [...(kp[k] || [])].some(p => lista.has(p))), SIN_KAM);
}
function _kamPorDefecto() {
  const kams = p2LoteKams();
  const f = document.getElementById("kamFilter")?.value;
  if (STATE.myKam && kams.includes(STATE.myKam)) return STATE.myKam;
  if (f && f !== "all" && kams.includes(f)) return f;
  return kams[0] || null;
}
function _tamanio() {
  const ult = (STATE.allDates || [])[STATE.allDates.length - 1];
  const m = new Map();
  const tk = STATE[STATE.curMode === "mensual" ? "rawDataMensualTuktuk" : STATE.curMode === "diario" ? "rawDataDiarioTuktuk" : "rawDataTuktuk"] || [];
  [...(STATE.rawData || []), ...tk].forEach(r => { if (r.date === ult) m.set(r.partner, (m.get(r.partner) || 0) + (r.activeDrivers || 0)); });
  return m;
}
// Partners de la cartera con sus hojas del PDF (sin las de solo pantalla).
export function p2LotePartners() {
  const lista = new Set(p2PartnerList());
  const suyos = [...((STATE.KAM_PARTNERS || {})[P2_LOTE.kam] || [])].filter(p => lista.has(p));
  const tam = _tamanio();
  return suyos.map(p => ({
    name: p,
    hojas: p2Deck(p).filter(e => !e.def.noPdf).map(e => ({ entry: e, key: p2SlideKey(e), tipo: tipoDeEtiqueta(e.def.es) })),
    taxi: p2HasTaxi(p), tk: p2TuktukSectionVisible(p), dl: p2TieneVertical(p, "delivery"), cg: p2TieneVertical(p, "cargo"),
    fleet: typeof isFleetPartner === "function" && isFleetPartner(p),
    ad: tam.get(p) || 0
  })).sort((a, b) => b.ad - a.ad || a.name.localeCompare(b.name));
}
const _sel = ps => P2_LOTE.sel || new Set(ps.map(p => p.name));
const _vista = p => P2_LOTE.vista[p] || "auto";
const _hojasOn = p => p.hojas.filter(h => incluida(P2_LOTE.reglas, p.name, h.key));
function _asegurar() {
  if (!P2_LOTE.kam || !p2LoteKams().includes(P2_LOTE.kam)) P2_LOTE.kam = _kamPorDefecto();
  // Las hojas que el KAM ya saca en la descarga individual (pdfOff) arrancan
  // fuera también acá: son las mismas claves de hoja. Las que no van por
  // defecto (N+R por origen, Embudo) entran como tipo entero → "Estándar".
  if (!P2_LOTE.reglas) P2_LOTE.reglas = reglasIniciales(PRESENT2_STATE.pdfOff, p2PdfOffDefecto());
  if (!_puedeCarpeta()) P2_LOTE.destino = "descargas";
}

// ── Etiquetas ─────────────────────────────────────────────────────────────────
const _TIPO_LBL = {
  portada: "p2l.t.portada", ejec: "p2l.t.ejec", resumen: "p2l.t.resumen", kpis: "p2l.t.kpis", nrorigen: "p2l.t.nrorigen",
  alertas: "p2l.t.alertas", embudo: "p2l.t.embudo", canal: "p2l.t.canal", seg: "p2l.t.seg", raw: "p2l.t.raw", otra: "p2l.t.otra"
};
const _TIPO_TIP = {
  portada: "p2l.tip.portada", ejec: "p2l.tip.ejec", resumen: "p2l.tip.resumen", kpis: "p2l.tip.kpis", nrorigen: "p2l.tip.nrorigen",
  alertas: "p2l.tip.alertas", embudo: "p2l.tip.embudo", canal: "p2l.tip.canal", seg: "p2l.tip.seg", raw: "p2l.tip.raw", otra: "p2l.tip.otra"
};
const _PLANT_LBL = { estandar: "p2l.plant.estandar", completo: "p2l.plant.completo", ejecutivo: "p2l.plant.ejecutivo", sinanexo: "p2l.plant.sinanexo" };
const _dur = s => s < 90 ? t("p2l.dur.seg", { n: Math.max(5, Math.round(s / 5) * 5) }) : t("p2l.dur.min", { n: Math.round(s / 60) });

// ── Render ────────────────────────────────────────────────────────────────────
export function p2LoteModoHTML() {
  return `<div class="p2-field">${`<span class="p2-field__lbl">${escapeHTML(t("p2l.modo"))}</span>`}${segmented({
    ariaLabel: t("p2l.modo"), act: "p2LoteModo", value: P2_LOTE.modo,
    options: [{ value: "uno", label: t("p2l.modo.uno"), icon: "user" }, { value: "cartera", label: t("p2l.modo.cartera"), icon: "users" }] })}</div>`;
}
export function p2LoteShellHTML() {
  _asegurar();
  const kams = p2LoteKams();
  const gen = P2_LOTE.fase === "generando";
  const meses = p2MetaMeses();
  return `<div class="p2-shell p2l">
    <div class="p2-toolbar" role="toolbar" aria-label="${escapeHTML(t("p2l.aria"))}">
      <div class="p2-toolbar__row">
        ${p2LoteModoHTML()}
        <div class="p2-field"><label class="p2-field__lbl" for="p2LoteKam">KAM</label>
          <select id="p2LoteKam" class="ui-select ui-select--sm p2l-select" data-act-change="p2LoteKam"${gen ? " disabled" : ""}>
            ${kams.map(k => `<option value="${escapeHTML(k)}"${k === P2_LOTE.kam ? " selected" : ""}>${escapeHTML(kamLabel(k))}</option>`).join("")}
          </select></div>
        <div class="p2-field" id="p2LoteLang"><span class="p2-field__lbl">${escapeHTML(t("p2.ctl.idioma"))}</span>${segmented({ ariaLabel: t("p2.ctl.idioma"), act: "p2LoteLang", value: PRESENT2_STATE.lang,
          options: P2_LANGS.map(L => ({ value: L.k, label: L.lbl, disabled: gen })) })}</div>
        ${meses.length ? `<div class="p2-field" title="${escapeHTML(t("p2.ctl.mesMetaHint"))}"><label class="p2-field__lbl" for="p2LoteMes">${escapeHTML(t("p2.ctl.mesMeta"))}</label>
          <select id="p2LoteMes" class="ui-select ui-select--sm" data-act-change="p2LoteMes"${gen ? " disabled" : ""}>
            <option value="">${escapeHTML(t("p2.ctl.mesAuto"))}</option>
            ${meses.map(m => `<option value="${escapeHTML(m)}"${PRESENT2_STATE.avanceMesSel === m ? " selected" : ""}>${escapeHTML(mesL(m, getLang()))}</option>`).join("")}
          </select></div>` : ""}
      </div>
    </div>
    <div id="p2LoteBody">${p2LoteBodyHTML()}</div>
  </div>`;
}

function _estadoCol(ps, sel, tipo) {
  const inc = [];
  ps.forEach(p => { if (!sel.has(p.name)) return; p.hojas.forEach(h => { if (h.tipo === tipo) inc.push(incluida(P2_LOTE.reglas, p.name, h.key)); }); });
  return estadoDe(inc);
}
function _celda(p, tipo, fila) {
  const del = p.hojas.filter(h => h.tipo === tipo);
  if (!del.length) return `<td class="p2l-td"><span class="p2l-na" title="${escapeHTML(t("p2l.noAplica", { p: p.name }))}">—</span></td>`;
  const inc = del.map(h => incluida(P2_LOTE.reglas, p.name, h.key));
  const st = estadoDe(inc), n = inc.filter(Boolean).length;
  const tip = del.map((h, i) => `${inc[i] ? "✓" : "✕"} ${p2SlideLabelUI(h.entry.def)}`).join("\n");
  return `<td class="p2l-td"><button type="button" class="p2l-cell p2l-cell--${st}" data-act="p2LoteCelda" data-fila="${fila}" data-tipo="${tipo}" aria-pressed="${st !== "off"}" aria-label="${escapeHTML(`${p.name} · ${t(_TIPO_LBL[tipo])}`)}" title="${escapeHTML(tip)}">${st === "on" ? iconSvg("check", { size: 13 }) : st === "mix" ? `${n}/${del.length}` : ""}</button></td>`;
}
// Hojas sueltas que NO entran, en texto (3-oct-2026): con un tipo incluido solo
// en parte, la celda dice "n/m" y cuáles quedan afuera vivía solo en su `title`
// (sin mouse no se ve, y tocar la celda cambia la selección). Se listan debajo
// del nombre del partner, en cualquier dispositivo.
function _sueltasFuera(p, cols) {
  const fuera = [];
  cols.forEach(tipo => {
    const del = p.hojas.filter(h => h.tipo === tipo);
    const inc = del.map(h => incluida(P2_LOTE.reglas, p.name, h.key));
    if (estadoDe(inc) !== "mix") return;
    del.forEach((h, i) => { if (!inc[i]) fuera.push(p2SlideLabelUI(h.entry.def)); });
  });
  return fuera.length ? `<small class="p2l-excl">${escapeHTML(t("p2l.sinHojas", { h: fuera.join(" · ") }))}</small>` : "";
}
function _tags(p) {
  const v = _vista(p.name), ef = v === "auto" ? (p.fleet ? "fleet" : "taxi") : v;
  const tag = (cls, ico, txt) => `<span class="p2l-tag p2l-tag--${cls}">${iconSvg(ico, { size: 11 })}${escapeHTML(txt)}</span>`;
  return [p.taxi && tag(ef === "fleet" ? "fleet" : "tx", ef === "fleet" ? "car" : "taxi", ef === "fleet" ? "Fleet" : t("p2l.agregador")),
    p.tk && tag("tk", "tuktuk", "TukTuk"), p.dl && tag("tx", "package", "Delivery"), p.cg && tag("tx", "truck", "Cargo")].filter(Boolean).join("");
}
function _estadoFila(p, i) {
  const g = P2_LOTE.prog[p.name];
  const n = _hojasOn(p).length;
  if (!g) return `<span id="p2lEst${i}" class="p2l-n${n ? "" : " p2l-n--0"}"><b>${n}</b> ${escapeHTML(t(n === 1 ? "p2l.hoja" : "p2l.hojas"))}</span>`;
  const txt = g.estado === "ok" ? `${iconSvg("check-circle", { size: 13 })}${escapeHTML(t("p2l.est.ok"))}`
    : g.estado === "error" ? `${iconSvg("alert-triangle", { size: 13 })}${escapeHTML(t("p2l.est.error"))}`
    : g.estado === "run" ? `<span class="p2l-mini"><span style="width:${Math.round((g.hechas / (g.total || 1)) * 100)}%"></span></span>${g.hechas}/${g.total}`
    : g.estado === "cancelado" ? escapeHTML(t("p2l.est.cancelado")) : escapeHTML(t("p2l.est.cola"));
  // El motivo del error, VISIBLE (3-oct-2026): antes vivía solo en el `title` y en
  // el iPad el KAM veía "Error" sin saber por qué.
  if (g.estado === "error" && g.err) {
    return `<span id="p2lEst${i}" class="p2l-est p2l-est--error p2l-est--conmotivo" title="${escapeHTML(g.err)}"><span class="p2l-est__lbl">${txt}</span><small class="p2l-est__err">${escapeHTML(g.err)}</small></span>`;
  }
  return `<span id="p2lEst${i}" class="p2l-est p2l-est--${g.estado}">${txt}</span>`;
}
export function p2LoteBodyHTML() {
  _asegurar();
  const ps = p2LotePartners();
  if (!P2_LOTE.kam || !ps.length) return `<div class="p2l-vacio">${escapeHTML(t("p2l.vacio"))}</div>`;
  const sel = _sel(ps), gen = P2_LOTE.fase === "generando";
  const cols = TIPOS.filter(tp => ps.some(p => p.hojas.some(h => h.tipo === tp)));
  const act = plantillaActiva(P2_LOTE.reglas);
  const pills = PLANTILLAS.map(pl => `<button type="button" class="p2l-pill${act === pl.k ? " is-on" : ""}" data-act="p2LotePlantilla" data-value="${pl.k}" aria-pressed="${act === pl.k}"${gen ? " disabled" : ""}>${escapeHTML(t(_PLANT_LBL[pl.k]))}</button>`).join("");
  const nSel = ps.filter(p => sel.has(p.name)).length;
  const head = cols.map(tp => {
    const st = _estadoCol(ps, sel, tp);
    return `<th scope="col" class="p2l-th"><button type="button" class="p2l-col p2l-col--${st}" data-act="p2LoteCol" data-tipo="${tp}" aria-pressed="${st !== "off"}" title="${escapeHTML(t(_TIPO_TIP[tp]) + " · " + t(st === "on" ? "p2l.colQuitar" : "p2l.colPoner"))}"${gen ? " disabled" : ""}>${escapeHTML(t(_TIPO_LBL[tp]))}</button></th>`;
  }).join("");
  const filas = ps.map((p, i) => {
    const on = sel.has(p.name), exc = tieneExcepciones(P2_LOTE.reglas, p.name) || !!P2_LOTE.vista[p.name];
    const v = _vista(p.name);
    const vistaSel = `<select class="ui-select ui-select--sm p2l-vista" aria-label="${escapeHTML(t("p2l.vistaDe", { p: p.name }))}" data-act-change="p2LoteVista" data-fila="${i}"${gen ? " disabled" : ""}>
      <option value="auto"${v === "auto" ? " selected" : ""}>${escapeHTML(t("p2l.vista.auto", { v: p.fleet ? "Fleet" : t("p2l.agregador") }))}</option>
      <option value="taxi"${v === "taxi" ? " selected" : ""}>${escapeHTML(t("p2l.agregador"))}</option>
      <option value="fleet"${v === "fleet" ? " selected" : ""}${p.fleet ? "" : " disabled"}>Fleet${p.fleet ? "" : " · " + escapeHTML(t("p2l.noFleet"))}</option></select>`;
    return `<tr class="${on ? "" : "is-off"}">
      <th scope="row" class="p2l-p"><label class="p2l-chk"><input type="checkbox" data-act="p2LoteFila" data-fila="${i}"${on ? " checked" : ""}${gen ? " disabled" : ""}>
        <span class="p2l-p__n">${escapeHTML(p.name)}</span></label>
        <div class="p2l-p__sub">${_tags(p)}${exc ? `<button type="button" class="p2l-reset" data-act="p2LoteLimpiar" data-fila="${i}" title="${escapeHTML(t("p2l.limpiarTip"))}"${gen ? " disabled" : ""}>${iconSvg("refresh", { size: 11 })}${escapeHTML(t("p2l.limpiar"))}</button>` : ""}</div>${_sueltasFuera(p, cols)}</th>
      <td class="p2l-vcell">${vistaSel}</td>${cols.map(tp => _celda(p, tp, i)).join("")}
      <td class="p2l-ncell">${_estadoFila(p, i)}</td></tr>`;
  }).join("");
  return `<div class="p2l-bar">
      <div class="p2l-bar__plant"><span class="p2-field__lbl">${escapeHTML(t("p2l.plantilla"))}</span><div class="p2l-pills">${pills}</div></div>
      <span class="p2l-sp"></span>
      <span class="p2l-help">${escapeHTML(t("p2l.ayuda"))}${infoTip(t("p2l.ayudaTip"))}</span>
    </div>
    <div class="ui-table-wrap p2l-wrap${gen ? " is-busy" : ""}"><table class="ui-table p2l-mx">
      <thead><tr><th scope="col" class="p2l-p"><label class="p2l-chk"><input type="checkbox" id="p2LoteTodos" data-act="p2LoteTodos"${nSel === ps.length ? " checked" : ""}${gen ? " disabled" : ""}>
        <span>${escapeHTML(t("p2l.partners", { n: nSel, t: ps.length }))}</span></label></th>
        <th scope="col" class="p2l-vcell">${escapeHTML(t("p2.ctl.vista"))}</th>${head}<th scope="col" class="p2l-ncell">PDF</th></tr></thead>
      <tbody>${filas}</tbody></table></div>
    ${_pieHTML(ps, sel)}`;
}
function _pieHTML(ps, sel) {
  const elegidos = ps.filter(p => sel.has(p.name));
  const hojas = elegidos.reduce((s, p) => s + _hojasOn(p).length, 0);
  const conHojas = elegidos.filter(p => _hojasOn(p).length).length;
  if (P2_LOTE.fase === "listo" && P2_LOTE.resultado) {
    const R = P2_LOTE.resultado;
    return `<div class="p2l-foot p2l-foot--${R.errores ? "warn" : "ok"}" role="status">${iconSvg(R.errores ? "alert-triangle" : "check-circle", { size: 16 })}
      <span>${escapeHTML(t(R.destino === "carpeta" ? (R.ok === 1 ? "p2l.fin.carpeta1" : "p2l.fin.carpeta") : (R.ok === 1 ? "p2l.fin.descargas1" : "p2l.fin.descargas"), { n: R.ok, c: R.carpeta || "" }))}${R.errores ? " · " + escapeHTML(t("p2l.fin.errores", { n: R.errores })) : ""}${R.cancelado ? " · " + escapeHTML(t("p2l.fin.cancelado")) : ""}</span>
      <span class="p2l-sp"></span><button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="p2LoteNuevo">${escapeHTML(t("p2l.fin.otro"))}</button></div>`;
  }
  if (P2_LOTE.fase === "generando") {
    const tot = elegidos.filter(p => P2_LOTE.prog[p.name]).length;
    const hechos = Object.values(P2_LOTE.prog).filter(g => g.estado === "ok" || g.estado === "error").length;
    const cur = Object.entries(P2_LOTE.prog).find(([, g]) => g.estado === "run");
    // Velo a pantalla completa (3-oct-2026): el motor dibuja cada hoja con
    // gráficos en un div fijo a la vista (z-index 99998) que antes tapaba la UI y
    // a veces el botón Cancelar; y el panel lateral seguía activo (cambiar fechas
    // o escala a mitad del lote mezclaba escalas y repintaba encima de los
    // gráficos temporales, que salían en blanco). Mismo patrón que .p2-progress
    // de la descarga individual, con el progreso y Cancelar arriba de todo.
    return `<div class="p2l-velo"><div class="p2l-velo__card">
      <div class="p2l-foot" role="status" aria-live="polite"><div class="p2l-gen">
        <div class="p2l-gen__txt" id="p2LoteGenTxt">${escapeHTML(t("p2l.gen", { i: Math.min(hechos + 1, tot), n: tot, p: cur ? cur[0] : "", h: cur ? cur[1].hechas : 0, t: cur ? cur[1].total : 0 }))}</div>
        <div class="p2l-gen__bar"><span id="p2LoteGenBar" style="width:${Math.round(hechos / (tot || 1) * 100)}%"></span></div></div>
      <span class="p2l-sp"></span>
      <button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-act="p2LoteCancelar"${P2_LOTE.cancelar ? " disabled" : ""}>${iconSvg("x", { size: 14 })}<span>${escapeHTML(t(P2_LOTE.cancelar ? "p2l.cancelando" : "p2l.cancelar"))}</span></button></div>
    </div></div>`;
  }
  const destino = segmented({ ariaLabel: t("p2l.destino"), act: "p2LoteDestino", value: P2_LOTE.destino,
    options: [{ value: "carpeta", label: t("p2l.destino.carpeta"), icon: "database", disabled: !_puedeCarpeta() },
              { value: "descargas", label: t("p2l.destino.descargas"), icon: "download" }] });
  return `<div class="p2l-foot">
    <div class="p2l-foot__sum"><b>${conHojas}</b> ${escapeHTML(t("p2l.pres"))} · <b>${hojas}</b> ${escapeHTML(t("p2l.hojas"))} · ${escapeHTML(_dur(hojas * SEG_POR_HOJA + conHojas * SEG_POR_PDF))}${infoTip(t(_puedeCarpeta() ? "p2l.destinoTip" : "p2l.destinoTipSin"))}</div>
    <span class="p2l-sp"></span>
    <div class="p2-field p2-field--inline"><span class="p2-field__lbl">${escapeHTML(t("p2l.destino"))}</span>${destino}</div>
    <button type="button" class="ui-btn ui-btn--primary ui-btn--sm" data-act="p2LoteDescargar"${conHojas ? "" : " disabled"}>${iconSvg("download", { size: 14 })}<span>${escapeHTML(t("p2l.descargar", { n: conHojas }))}</span></button>
  </div>`;
}
// Solo el cuerpo: sin parpadeo del resto de la pestaña.
export function p2LotePintar() {
  const el = document.getElementById("p2LoteBody");
  if (!el) { renderPresent2(); return; }
  const wrap = el.querySelector(".p2l-wrap");
  const sx = wrap ? wrap.scrollLeft : 0;
  el.innerHTML = p2LoteBodyHTML();
  const w2 = el.querySelector(".p2l-wrap"); if (w2) w2.scrollLeft = sx;
  const todos = document.getElementById("p2LoteTodos");
  if (todos) {
    const ps = p2LotePartners(), n = ps.filter(p => _sel(ps).has(p.name)).length;
    todos.indeterminate = n > 0 && n < ps.length;
  }
}
function _pintarProgreso(p, i) {
  const est = document.getElementById("p2lEst" + i);
  if (est) est.outerHTML = _estadoFila(p, i);
  const g = P2_LOTE.prog[p.name];
  const txt = document.getElementById("p2LoteGenTxt"), bar = document.getElementById("p2LoteGenBar");
  const vals = Object.values(P2_LOTE.prog);
  const hechos = vals.filter(x => x.estado === "ok" || x.estado === "error").length;
  if (txt && g) txt.textContent = t("p2l.gen", { i: Math.min(hechos + 1, vals.length), n: vals.length, p: p.name, h: g.hechas, t: g.total });
  if (bar) bar.style.width = Math.round(((hechos + (g && g.total ? g.hechas / g.total : 0)) / (vals.length || 1)) * 100) + "%";
}

// ── Acciones ──────────────────────────────────────────────────────────────────
const _ps = () => p2LotePartners();
export function p2LoteModo(v) {
  if (P2_LOTE.fase === "generando") return;
  P2_LOTE.modo = v === "cartera" ? "cartera" : "uno";
  renderPresent2();
}
function p2LoteKam(v) {
  if (P2_LOTE.fase === "generando" || v === P2_LOTE.kam) return;
  P2_LOTE.kam = v; P2_LOTE.sel = null; P2_LOTE.vista = {}; P2_LOTE.prog = {}; P2_LOTE.fase = "config"; P2_LOTE.resultado = null;
  // Las excepciones son de partners puntuales: al cambiar de cartera no aplican.
  P2_LOTE.reglas.offP.clear(); P2_LOTE.reglas.onP.clear();
  P2_LOTE.anclaFila = P2_LOTE.anclaCelda = null;
  p2LotePintar();
}
function p2LoteLang(v) {
  if (P2_LOTE.fase === "generando" || !P2_LANGS.some(L => L.k === v)) return;
  PRESENT2_STATE.lang = v;
  document.querySelectorAll('#p2LoteLang [data-act="p2LoteLang"]').forEach(b => b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === v)));
}
function p2LoteMes(v) { PRESENT2_STATE.avanceMesSel = v || null; }
function p2LotePlantilla(k) { if (P2_LOTE.fase === "generando") return; aplicarPlantilla(P2_LOTE.reglas, k); P2_LOTE.fase = P2_LOTE.fase === "listo" ? "config" : P2_LOTE.fase; p2LotePintar(); }
function p2LoteCol(tipo) {
  if (P2_LOTE.fase === "generando") return;   // no cambiar las hojas de lo que falta generar
  const ps = _ps();
  fijarTipoTodos(P2_LOTE.reglas, tipo, siguienteValor(_estadoCol(ps, _sel(ps), tipo)));
  p2LotePintar();
}
function p2LoteCelda(d, e) {
  if (P2_LOTE.fase === "generando") return;
  const ps = _ps(), i = +d.fila, tipo = d.tipo, p = ps[i];
  if (!p) return;
  const del = h => h.tipo === tipo;
  const on = siguienteValor(estadoDe(p.hojas.filter(del).map(h => incluida(P2_LOTE.reglas, p.name, h.key))));
  // Mayús+clic: el mismo valor en todo el tramo de la columna desde la última celda.
  const a = e && e.shiftKey && P2_LOTE.anclaCelda && P2_LOTE.anclaCelda.tipo === tipo ? P2_LOTE.anclaCelda.fila : i;
  for (let f = Math.min(a, i); f <= Math.max(a, i); f++) {
    const q = ps[f]; if (!q) continue;
    q.hojas.filter(del).forEach(h => fijarHoja(P2_LOTE.reglas, q.name, h.key, on));
  }
  P2_LOTE.anclaCelda = { tipo, fila: i };
  p2LotePintar();
}
function p2LoteFila(d, el, e) {
  const ps = _ps(), i = +d.fila, s = new Set(_sel(ps));
  const on = !!el.checked;
  const a = e && e.shiftKey && P2_LOTE.anclaFila != null ? P2_LOTE.anclaFila : i;
  for (let f = Math.min(a, i); f <= Math.max(a, i); f++) { const q = ps[f]; if (q) { if (on) s.add(q.name); else s.delete(q.name); } }
  P2_LOTE.sel = s; P2_LOTE.anclaFila = i;
  p2LotePintar();
}
function p2LoteTodos(el) {
  const ps = _ps();
  P2_LOTE.sel = el.checked ? new Set(ps.map(p => p.name)) : new Set();
  p2LotePintar();
}
function p2LoteVista(d, el) {
  const p = _ps()[+d.fila]; if (!p) return;
  if (el.value === "auto") delete P2_LOTE.vista[p.name]; else P2_LOTE.vista[p.name] = el.value;
  p2LotePintar();
}
function p2LoteLimpiar(d) {
  const p = _ps()[+d.fila]; if (!p) return;
  limpiarPartner(P2_LOTE.reglas, p.name); delete P2_LOTE.vista[p.name];
  p2LotePintar();
}
function p2LoteDestino(v) {
  if (v === "carpeta" && !_puedeCarpeta()) return;
  P2_LOTE.destino = v === "carpeta" ? "carpeta" : "descargas";
  p2LotePintar();
}

// ── Generación ────────────────────────────────────────────────────────────────
async function _chequeo(elegidos, hojas) {
  const from = document.getElementById("dateFrom")?.value || "", to = document.getElementById("dateTo")?.value || "";
  const mes = p2AvanceMes();
  const mesTxt = mes ? mesL(mes, getLang()) : "—";
  // Avisos del chequeo individual: los globales (rango, frescura, escala) una
  // vez, y "sin metas del mes" contado por partner.
  const globales = new Set(); const sinMetas = [];
  const avSinMetas = t("p2.chk.aviso.sinMetas", { mes: mesTxt });
  const savedP = PRESENT2_STATE.partner;
  elegidos.forEach(p => {
    PRESENT2_STATE.partner = p.name;
    const C = p2ChequeoExport(p.name);
    C.avisos.forEach(a => { if (a === avSinMetas) sinMetas.push(p.name); else globales.add(a); });
  });
  PRESENT2_STATE.partner = savedP;
  const escala = t(`mode.${STATE.curMode === "mensual" ? "mensual" : STATE.curMode === "diario" ? "diario" : "semanal"}`);
  const lineas = [
    `KAM: ${kamLabel(P2_LOTE.kam)}`,
    `${t("p2l.chk.pres")}: ${elegidos.length} · ${t("p2l.hojas")}: ${hojas}`,
    `${t("p2.chk.idioma")}: ${(P2_LANGS.find(l => l.k === PRESENT2_STATE.lang) || {}).lbl}`,
    `${t("p2.chk.escala")}: ${escala} · ${t("p2.chk.rango")}: ${d2s(from)} → ${d2s(to)}`,
    `${t("p2.chk.mes")}: ${mesTxt}`,
    `${t("p2l.destino")}: ${t(P2_LOTE.destino === "carpeta" ? "p2l.destino.carpetaLargo" : "p2l.destino.descargasLargo")}`,
    `${t("p2l.chk.tiempo")}: ${_dur(hojas * SEG_POR_HOJA + elegidos.length * SEG_POR_PDF)}`
  ];
  const av = [...globales];
  if (sinMetas.length) av.push(t("p2l.chk.sinMetas", { n: sinMetas.length, mes: mesTxt, lista: sinMetas.slice(0, 5).join(", ") + (sinMetas.length > 5 ? "…" : "") }));
  const body = lineas.join("\n") + (av.length ? `\n\n${t("p2.chk.revisar")}\n` + av.map(a => `• ${a}`).join("\n") : "") + `\n\n${t("p2l.chk.noCerrar")}`;
  return confirmDialog({ title: t("p2l.chk.titulo"), body, confirmLabel: t("p2l.descargar", { n: elegidos.length }), cancelLabel: t("dialogo.cancelar") });
}
function _antesDeSalir(e) { e.preventDefault(); e.returnValue = ""; return ""; }

export async function p2LoteDescargar() {
  if (P2_LOTE.fase === "generando") return;
  const ps = _ps(), sel = _sel(ps);
  const elegidos = ps.filter(p => sel.has(p.name) && _hojasOn(p).length);
  if (!elegidos.length) { await alertDialog({ title: t("p2l.err.nada") }); return; }
  const hojas = elegidos.reduce((s, p) => s + _hojasOn(p).length, 0);
  if (!(await _chequeo(elegidos, hojas))) return;
  // La carpeta se pide YA (el navegador exige que venga de un clic).
  let dir = null;
  if (P2_LOTE.destino === "carpeta" && _puedeCarpeta()) {
    try { dir = await window.showDirectoryPicker({ id: "p2-cartera", mode: "readwrite" }); }
    catch (e) { if (e && e.name === "AbortError") return; P2_LOTE.destino = "descargas"; }
  }
  try { await ensurePdfLibs(); } catch (e) { await alertDialog({ title: t("p2.err.libs"), tone: "bad" }); return; }

  const from = document.getElementById("dateFrom") ? document.getElementById("dateFrom").value : STATE.allDates[0];
  const to   = document.getElementById("dateTo")   ? document.getElementById("dateTo").value   : STATE.allDates[STATE.allDates.length - 1];
  const saved = { partner: PRESENT2_STATE.partner, fleetMode: PRESENT2_STATE.fleetMode, pdfOff: PRESENT2_STATE.pdfOff };
  P2_LOTE.fase = "generando"; P2_LOTE.cancelar = false; P2_LOTE.resultado = null; P2_LOTE.prog = {};
  elegidos.forEach(p => { P2_LOTE.prog[p.name] = { estado: "cola", hechas: 0, total: _hojasOn(p).length }; });
  destroyPresent2Charts();
  window.addEventListener("beforeunload", _antesDeSalir);
  // Mientras se genera, la pestaña no debe repintarse (un repinte a mitad borra
  // el estado de la matriz y los divs temporales del motor): renderPresent2 lo
  // respeta desde el 3-oct-2026, así que acá se repinta SOLO el cuerpo del lote.
  p2LotePintar();
  const R = { ok: 0, errores: 0, cancelado: false, destino: dir ? "carpeta" : "descargas", carpeta: dir ? dir.name : "" };
  try {
    for (const p of elegidos) {
      if (P2_LOTE.cancelar) { R.cancelado = true; break; }
      const i = ps.indexOf(p), g = P2_LOTE.prog[p.name];
      g.estado = "run"; _pintarProgreso(p, i);
      PRESENT2_STATE.partner = p.name;
      PRESENT2_STATE.fleetMode = _vista(p.name);
      PRESENT2_STATE.pdfOff = new Set();          // el deck ya viene filtrado por las reglas del lote
      const deck = _hojasOn(p).map(h => h.entry);
      try {
        const pdf = await p2GenerarPdf(p.name, deck, from, to, {
          onHoja: (h, n) => { g.hechas = h; g.total = n; _pintarProgreso(p, i); },
          cancelado: () => P2_LOTE.cancelar
        });
        if (!pdf) { g.estado = "cancelado"; R.cancelado = true; _pintarProgreso(p, i); break; }
        const nombre = p2NombrePdf(p.name, to);
        if (dir) {
          const fh = await dir.getFileHandle(nombre, { create: true });
          const w = await fh.createWritable();
          await w.write(pdf.output("blob"));
          await w.close();
        } else {
          pdf.save(nombre);
          // Pausa corta entre descargas: muchas seguidas activan el bloqueo de
          // "este sitio quiere descargar varios archivos".
          await new Promise(r => setTimeout(r, 700));
        }
        logAccess("download_pdf", "presentacion2-lote:" + p.name);
        g.estado = "ok"; R.ok++;
      } catch (err) {
        console.error("[lote]", p.name, err);
        g.estado = "error"; g.err = err && err.message ? err.message : String(err); R.errores++;
      }
      _pintarProgreso(p, i);
    }
  } finally {
    PRESENT2_STATE.partner = saved.partner; PRESENT2_STATE.fleetMode = saved.fleetMode; PRESENT2_STATE.pdfOff = saved.pdfOff;
    window.removeEventListener("beforeunload", _antesDeSalir);
    Object.values(P2_LOTE.prog).forEach(g => { if (g.estado === "cola") g.estado = "cancelado"; });
    P2_LOTE.fase = "listo"; P2_LOTE.resultado = R; P2_LOTE.cancelar = false;
    PRESENT2_STATE._repintarAlTerminar = false;
    if (STATE.curTab === "present2") renderPresent2();
  }
}
function p2LoteCancelar() { if (P2_LOTE.fase === "generando") { P2_LOTE.cancelar = true; p2LotePintar(); } }
function p2LoteNuevo() { P2_LOTE.fase = "config"; P2_LOTE.prog = {}; P2_LOTE.resultado = null; p2LotePintar(); }

registerActions({
  p2LoteModo:      d => p2LoteModo(d.value),
  p2LoteKam:       (d, el) => p2LoteKam(el.value),
  p2LoteLang:      d => p2LoteLang(d.value),
  p2LoteMes:       (d, el) => p2LoteMes(el.value),
  p2LotePlantilla: d => p2LotePlantilla(d.value),
  p2LoteCol:       d => p2LoteCol(d.tipo),
  p2LoteCelda:     (d, el, e) => p2LoteCelda(d, e),
  p2LoteFila:      (d, el, e) => p2LoteFila(d, el, e),
  p2LoteTodos:     (d, el) => p2LoteTodos(el),
  p2LoteVista:     (d, el) => p2LoteVista(d, el),
  p2LoteLimpiar:   d => p2LoteLimpiar(d),
  p2LoteDestino:   d => p2LoteDestino(d.value),
  p2LoteDescargar: () => p2LoteDescargar(),
  p2LoteCancelar:  () => p2LoteCancelar(),
  p2LoteNuevo:     () => p2LoteNuevo()
});
