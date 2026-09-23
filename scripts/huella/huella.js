// ============================================================================
// HUELLA DE NÚMEROS — snippet para la CONSOLA del navegador (Ola 0).
//
// Qué hace: con la app ya abierta y con sesión, recorre escalas (semanal /
// mensual / diario) × líneas (combinado / agregador / fleet / tuktuk) × vistas
// (Rendimiento, Metas con el mes más reciente que tiene datos, y Calculadora
// una vez) usando las funciones globales de la propia app (switchMode,
// switchTab, setRendLine, setMetasLine, setMetasMes, onKAMChange,
// applyFilters…), y junta {clave: texto} de cada elemento con `data-num`
// (ver src/shared/huella.ts). Con rol partner recorre el portal en vez de
// Rendimiento/Metas.
//
// Para qué: probar que un rediseño NO movió ningún número. Se saca la huella
// antes y después de una ola y se comparan con scripts/huella/compare.mjs.
//
// Uso: pegar TODO este archivo en la consola y esperar el "✓ huella lista".
// El JSON queda en `window.__huella` (objeto) y `window.__huellaJSON` (texto);
// en Chrome, `copy(window.__huellaJSON)` lo copia al portapapeles.
// Opciones: antes de pegar, `window.__huellaOpts = { escalas: ["semanal"],
// vistas: ["rend"], lineas: ["comb"] }` para acotar el recorrido.
//
// Sin imports ni dependencias: JS plano, corre tal cual en la consola.
//
// DETERMINISMO: el rango de fechas NO se deja al azar del sidebar (depende de
// filtros guardados). Se fija por escala contra los períodos existentes:
//   Rendimiento: últimos 6 (semanal) / 3 (mensual) / 14 (diario) períodos.
//   Metas: el mes de meta más reciente que tiene períodos, completo.
// Nunca antes del inicio de lo CARGADO (si no, applyFilters dispararía una
// recarga ampliando la ventana). Ciudad = todas, KAM = todos, todos los
// partners tildados, buscador vacío. El rango usado queda en `meta`.
//
// TRAMPA CONOCIDA (CLAUDE.md, sep-2026): con la pestaña/panel OCULTO,
// requestAnimationFrame NO dispara, y switchMode/switchTab lo esperan → se
// cuelgan para siempre con un síntoma idéntico a un bug. Si `document.hidden`,
// el script reemplaza rAF por un setTimeout SOLO mientras corre y lo restaura
// al final. Las esperas del propio script son todas por setTimeout + sondeo
// del DOM, nunca por rAF.
// ============================================================================
(async () => {
  "use strict";
  const OPTS = Object.assign({
    escalas: ["semanal", "mensual", "diario"],
    lineas:  ["comb", "agg", "fleet", "tk"],
    vistas:  ["rend", "metas", "calculator"],
    rango:   { semanal: 6, mensual: 3, diario: 14 },
    timeoutMs: 20000
  }, window.__huellaOpts || {});

  const W = window;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Esperar a que la carga inicial TERMINE antes de empezar ──────────────
  // Pegado justo después de un reload, el snippet arrancaba con la app a mitad
  // de camino (pintado desde el caché, red en vuelo, restoreFilters cambiando de
  // escala) y el primer switchMode chocaba con uno en curso → "timeout esperando:
  // escala semanal". Se espera: STATE con datos, sin spinner, sin el indicador
  // "↻ Actualizando…", sin cambio de pestaña en curso y con el dataset de la
  // escala activa ya asignado. Timeout generoso: una carga en frío con latencia
  // real tarda varios segundos.
  function escalaListaAhora(S) {
    if (!S || !S.rawData || !S.rawData.length) return false;
    if (S.curMode === "mensual") return S.rawData === S.rawDataMensual;
    if (S.curMode === "diario")  return S.rawData === S.rawDataDiario;
    return !S._semanalData || S.rawData === S._semanalData;
  }
  function appQuieta() {
    const S = W.STATE;
    const ref = document.getElementById("dataRefreshing");
    return !!S && escalaListaAhora(S) && !document.getElementById("loadingEl") &&
      !(ref && ref.style.display !== "none") && !S._switchingTab;
  }
  {
    const t0 = Date.now(), MAX = 120000;
    let quietas = 0;
    // Dos sondeos quietos seguidos: entre el pintado del caché y la llegada de la
    // red hay un instante en que todo parece terminado.
    while (quietas < 3) {
      if (Date.now() - t0 > MAX) {
        console.error("[huella] la app no terminó de cargar en 120 s: ¿hay sesión y datos?");
        return;
      }
      quietas = appQuieta() ? quietas + 1 : 0;
      await sleep(250);
    }
  }
  const S = W.STATE;
  async function waitFor(pred, what, timeout = OPTS.timeoutMs) {
    const t0 = Date.now();
    for (;;) {
      let ok = false;
      try { ok = !!pred(); } catch (e) { ok = false; }
      if (ok) return true;
      if (Date.now() - t0 > timeout) throw new Error("[huella] timeout esperando: " + what);
      await sleep(80);
    }
  }
  // Espera a que la cantidad de [data-num] del panel se estabilice (dos sondeos
  // iguales seguidos, y no está el cartel de "Cargando…" ni el spinner global).
  async function waitStable(root, what) {
    let prev = -1, iguales = 0;
    const t0 = Date.now();
    for (;;) {
      await sleep(120);
      // showLoad() (app.ts) crea #loadingEl mientras trabaja y lo REMUEVE al terminar.
      const cargando = !!document.getElementById("loadingEl");
      const n = root ? root.querySelectorAll("[data-num]").length : 0;
      if (!cargando && !S._switchingTab && n === prev) { if (++iguales >= 2) return n; }
      else iguales = 0;
      prev = n;
      if (Date.now() - t0 > OPTS.timeoutMs) { console.warn("[huella] sin estabilizar:", what); return n; }
    }
  }

  // ── Parche de rAF solo si la pestaña está oculta ──────────────────────────
  const rafOriginal = W.requestAnimationFrame;
  const rafParchado = document.hidden;
  if (rafParchado) {
    W.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
    console.info("[huella] pestaña oculta: requestAnimationFrame → setTimeout mientras corre");
  }

  const $ = id => document.getElementById(id);
  // Los filtros guardados (localStorage "yangoFilters") se reescriben en cada
  // applyFilters() del recorrido; al volver a la escala original, restoreFilters
  // los relee. Se guarda el texto EXACTO para devolverlo tal cual al final.
  const lsFiltrosInicial = (() => { try { return localStorage.getItem("yangoFilters"); } catch (e) { return null; } })();
  const estadoInicial = {
    tab: S.curTab, mode: S.curMode, rendLine: S.rendLine, metasLine: S.metasLine,
    metasMesSel: S.metasMesSel,
    dateFrom: $("dateFrom") && $("dateFrom").value, dateTo: $("dateTo") && $("dateTo").value,
    city: $("cityFilter") && $("cityFilter").value, kam: $("kamFilter") && $("kamFilter").value,
    search: $("partnerSearch") && $("partnerSearch").value,
    selected: typeof W.getSel === "function" ? W.getSel() : null,
    portalLine: W.PORTAL_STATE ? W.PORTAL_STATE.line : null
  };

  const esPartner = S.userRole === "partner";
  const out = {
    meta: {
      version: 1,
      generado: new Date().toISOString(),
      url: location.origin + location.pathname,
      rol: S.userRole || null,
      idioma: (document.documentElement.lang || "") || null,
      supabaseLocal: !!W.IS_LOCAL_SUPABASE,
      rafParchado,
      opciones: OPTS,
      escenarios: {}
    },
    escenarios: {}
  };

  // ── Helpers de la app ─────────────────────────────────────────────────────
  async function irATab(tab) {
    if (S.curTab !== tab) {
      if (typeof W.switchTab !== "function") throw new Error("[huella] falta switchTab");
      W.switchTab(tab);
    }
    await waitFor(() => S.curTab === tab && !S._switchingTab &&
      $("tab-" + tab) && $("tab-" + tab).classList.contains("active"), "tab " + tab);
  }
  async function irAEscala(mode, timeout) {
    // switchMode es async y resuelve al terminar su render — SALVO que ya haya
    // otro en curso: ahí vuelve en el acto sin hacer nada (guard _inSwitchMode,
    // que no se puede leer desde acá: es un `let` exportado y
    // Object.assign(window, app) copió su valor inicial). Por eso se reintenta
    // hasta que la escala pedida quede activa Y con su dataset asignado.
    const t0 = Date.now(), max = timeout || OPTS.timeoutMs;
    while (!(S.curMode === mode && escalaListaAhora(S) && !document.getElementById("loadingEl"))) {
      if (Date.now() - t0 > max) throw new Error("[huella] timeout esperando: escala " + mode);
      if (S.curMode !== mode) await W.switchMode(mode);
      await sleep(120);
    }
  }
  // Fechas cargadas de verdad (no el catálogo de la RPC): elegir un "Desde"
  // anterior dispararía needsWiderRange → recarga completa.
  function fechasCargadas() {
    const set = new Set((S.rawData || []).map(r => r.date).filter(Boolean));
    return [...set].sort();
  }
  function opcionesDe(sel) { return sel ? [...sel.options].map(o => o.value) : []; }
  // Resetea ciudad/KAM/buscador/selección y fija el rango. NO renderiza: el
  // render lo hace applyFilters() del llamador (una sola vez).
  function resetFiltros(desde, hasta) {
    if ($("cityFilter")) $("cityFilter").value = "all";
    if ($("partnerSearch")) {
      $("partnerSearch").value = "";
      if (typeof W.filterPList === "function") W.filterPList();
    }
    if ($("kamFilter")) $("kamFilter").value = "all";
    document.querySelectorAll("#pList input").forEach(c => { c.checked = true; });
    if (desde && $("dateFrom")) $("dateFrom").value = desde;
    if (hasta && $("dateTo")) $("dateTo").value = hasta;
  }
  function rangoRend(mode) {
    const cargadas = fechasCargadas();
    const opts = opcionesDe($("dateTo")).filter(d => cargadas.includes(d));
    const lista = opts.length ? opts : cargadas;
    const n = OPTS.rango[mode] || 6;
    return { desde: lista[Math.max(0, lista.length - n)], hasta: lista[lista.length - 1] };
  }
  function mesMetas() {
    const meses = [...new Set((S.metasData || []).map(m => m.mes).filter(Boolean))]
      .sort((a, b) => W._metasMesOrden(b) - W._metasMesOrden(a));
    const cargadas = fechasCargadas();
    const hastaMax = cargadas[cargadas.length - 1];
    for (const mes of meses) {
      const anio = W._metasMesActualYear(mes);
      const fechas = W._metasFechasMesCompleto(mes, anio, hastaMax).filter(d => cargadas.includes(d));
      if (fechas.length) return { mes, anio, desde: fechas[0], hasta: fechas[fechas.length - 1], periodos: fechas.length };
    }
    return null;
  }

  function recolectar(root) {
    const res = {}, dup = [];
    if (!root) return { res, dup };
    root.querySelectorAll("[data-num]").forEach(el => {
      let k = el.getAttribute("data-num");
      const v = (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")
        ? String(el.value)
        : (el.textContent || "").replace(/\s+/g, " ").trim();
      if (k in res) {                       // clave repetida: se conserva y se avisa
        let i = 2; while ((k + "#" + i) in res) i++;
        dup.push(k); k = k + "#" + i;
      }
      res[k] = v;
    });
    return { res, dup };
  }
  function guardar(nombre, root, extra) {
    const { res, dup } = recolectar(root);
    out.escenarios[nombre] = res;
    out.meta.escenarios[nombre] = Object.assign({ n: Object.keys(res).length }, extra || {},
      dup.length ? { clavesDuplicadas: dup } : {});
    console.info("[huella]", nombre, "→", Object.keys(res).length, "cifras", dup.length ? "(DUPLICADAS: " + dup.length + ")" : "");
  }

  try {
    for (const mode of OPTS.escalas) {
      await irAEscala(mode);

      if (esPartner) {
        // ── PORTAL (rol partner) ──────────────────────────────────────────────
        await irATab("portal");
        const r = rangoRend(mode);
        resetFiltros(r.desde, r.hasta);
        W.applyFilters();
        await waitStable($("portalContent"), "portal");
        const disponibles = [...document.querySelectorAll('#portalContent [data-act="portalSetLine"]')]
          .map(b => b.getAttribute("data-line"));
        const lineas = OPTS.lineas.filter(l => disponibles.length ? disponibles.includes(l) : l === "agg");
        for (const line of lineas) {
          W.portalSetLine(line);
          await waitStable($("portalContent"), "portal " + line);
          guardar(`${mode}|portal|${line}`, $("portalContent"), { desde: r.desde, hasta: r.hasta });
        }
        continue;
      }

      // ── RENDIMIENTO ─────────────────────────────────────────────────────────
      if (OPTS.vistas.includes("rend")) {
        await irATab("rend");
        const r = rangoRend(mode);
        for (const line of OPTS.lineas) {
          await W.setRendLine(line);
          resetFiltros(r.desde, r.hasta);
          W.applyFilters();
          await waitStable($("rendContent"), "rend " + line);
          guardar(`${mode}|rend|${line}`, $("rendContent"), { desde: r.desde, hasta: r.hasta });
        }
      }

      // ── METAS ───────────────────────────────────────────────────────────────
      if (OPTS.vistas.includes("metas") && (S.metasData || []).length) {
        await irATab("metas");
        const m = mesMetas();
        if (!m) {
          console.warn("[huella] metas: ningún mes de meta tiene períodos cargados en", mode);
        } else {
          for (const line of OPTS.lineas) {
            await W.setMetasLine(line);
            W.setMetasMes(m.mes);
            resetFiltros(m.desde, m.hasta);
            W.applyFilters();
            await waitStable($("metasContent"), "metas " + line);
            guardar(`${mode}|metas|${line}`, $("metasContent"),
              { mes: m.mes, anio: m.anio, desde: m.desde, hasta: m.hasta, periodos: m.periodos });
          }
        }
      }
    }

    // ── CALCULADORA (una vez: su base es mensual, no depende de la escala) ────
    if (!esPartner && OPTS.vistas.includes("calculator")) {
      await irATab("calculator");
      await waitFor(() => $("calculatorContent") && $("calculatorContent").querySelector("[data-num]"),
        "calculadora con data-num");
      await waitStable($("calculatorContent"), "calculadora");
      guardar(`calculadora`, $("calculatorContent"),
        { kam: W.CALC_STATE ? W.CALC_STATE.kam : null, escala: S.curMode });
    }
  } catch (e) {
    console.error(e);
    out.meta.error = String(e && e.message || e);
  } finally {
    // ── Restaurar lo que se tocó ───────────────────────────────────────────
    // Orden: (1) devolver los filtros guardados ANTES de cambiar de escala,
    // porque switchMode → popSidebarUI → restoreFilters los relee; (2) escala
    // (esperando a que quede de verdad, ver irAEscala); (3) líneas y mes;
    // (4) pestaña; (5) los valores exactos del sidebar; (6) un applyFilters,
    // que vuelve a guardar los filtros — y (7) se re-escribe el texto original
    // de localStorage para que quede byte a byte como estaba.
    const restaurarLS = () => {
      try {
        if (lsFiltrosInicial == null) localStorage.removeItem("yangoFilters");
        else localStorage.setItem("yangoFilters", lsFiltrosInicial);
      } catch (e) { /* storage bloqueado: nada que restaurar */ }
    };
    const problemas = [];
    const paso = async (nombre, fn) => {
      try { await fn(); } catch (e) { problemas.push(nombre + ": " + (e && e.message || e)); }
    };
    restaurarLS();
    await paso("escala", () => estadoInicial.mode ? irAEscala(estadoInicial.mode, 60000) : null);
    await paso("líneas", async () => {
      if (!esPartner) {
        if (estadoInicial.rendLine) S.rendLine = estadoInicial.rendLine;
        if (estadoInicial.metasLine) S.metasLine = estadoInicial.metasLine;
        S.metasMesSel = estadoInicial.metasMesSel;
      } else if (W.PORTAL_STATE && estadoInicial.portalLine) {
        W.PORTAL_STATE.line = estadoInicial.portalLine;
      }
    });
    await paso("pestaña", async () => {
      if (estadoInicial.tab && S.curTab !== estadoInicial.tab) {
        W.switchTab(estadoInicial.tab);
        await waitFor(() => S.curTab === estadoInicial.tab && !S._switchingTab, "tab inicial", 15000);
      }
    });
    await paso("filtros", async () => {
      const fijar = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
      fijar("dateFrom", estadoInicial.dateFrom);
      fijar("dateTo", estadoInicial.dateTo);
      fijar("cityFilter", estadoInicial.city);
      fijar("kamFilter", estadoInicial.kam);
      if ($("partnerSearch") && estadoInicial.search != null) {
        $("partnerSearch").value = estadoInicial.search;
        if (typeof W.filterPList === "function") W.filterPList();
      }
      if (estadoInicial.selected) {
        const sel = new Set(estadoInicial.selected);
        document.querySelectorAll("#pList input").forEach(c => { c.checked = sel.has(c.value); });
      }
      if (typeof W.applyFilters === "function") W.applyFilters();
      await sleep(400);
      await waitFor(() => !document.getElementById("loadingEl") && !S._switchingTab, "render final", 15000);
    });
    restaurarLS();
    // Verificación: lo que quedó tiene que ser lo que había.
    const fin = {
      tab: S.curTab, mode: S.curMode,
      dateFrom: $("dateFrom") && $("dateFrom").value, dateTo: $("dateTo") && $("dateTo").value,
      city: $("cityFilter") && $("cityFilter").value, kam: $("kamFilter") && $("kamFilter").value
    };
    for (const k of Object.keys(fin)) {
      if (estadoInicial[k] != null && fin[k] !== estadoInicial[k]) problemas.push(`${k}: quedó ${fin[k]}, era ${estadoInicial[k]}`);
    }
    if (problemas.length) {
      out.meta.restauracion = problemas;
      console.warn("[huella] la restauración no quedó exacta:", problemas);
    }
    if (rafParchado) W.requestAnimationFrame = rafOriginal;
  }

  const total = Object.values(out.escenarios).reduce((s, e) => s + Object.keys(e).length, 0);
  W.__huella = out;
  W.__huellaJSON = JSON.stringify(out, null, 2);
  console.info(`✓ huella lista: ${Object.keys(out.escenarios).length} escenarios, ${total} cifras. ` +
    "JSON en window.__huellaJSON — en Chrome: copy(window.__huellaJSON)");
  return out;
})();
