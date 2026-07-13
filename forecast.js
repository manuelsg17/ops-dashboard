// forecast.js — Motor de pronóstico multi-mes + palancas de crecimiento.
//
// PURO y testeable headless: solo funciones globales que operan sobre arrays de números
// (una serie mensual por KPI). NO lee STATE ni el DOM — el adaptador que arma las series
// desde STATE.rawDataMensual vive en presentacion2.js (p2ForecastBundle).
//
// Diseño (validado con backtest sobre datos reales, ver plan): un ENSEMBLE de métodos
// simples + un BACKTEST holdout que elige el mejor método POR KPI y reporta su error real
// (MAPE). Nunca una sola regresión sobre todo el historial (la rampa inicial la distorsiona
// → 14-38% de error vs ~7-9% del mejor método). La banda de confianza se dimensiona con el
// error observado en el backtest, por horizonte (crece con la distancia).

// ── utilidades ────────────────────────────────────────────────────────────────
function _fcClean(arr) { return (arr || []).map(v => (v == null || v === "" || isNaN(v)) ? null : +v); }
function _fcMape(pred, act) {
  let s = 0, n = 0;
  for (let i = 0; i < act.length; i++) { if (act[i]) { s += Math.abs((pred[i] - act[i]) / act[i]); n++; } }
  return n ? 100 * s / n : Infinity;
}
function _fcMedian(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }
// "2026-06" → "2026-07" (avanza el mes, maneja cambio de año).
function fcNextMonth(ym) {
  const m = String(ym).match(/^(\d{4})-(\d{2})/);
  if (!m) return ym;
  let y = +m[1], mo = +m[2] + 1;
  if (mo > 12) { mo = 1; y++; }
  return y + "-" + String(mo).padStart(2, "0");
}
function fcFutureMonths(lastYm, h) {
  const out = []; let cur = lastYm;
  for (let i = 0; i < h; i++) { cur = fcNextMonth(cur); out.push(cur); }
  return out;
}

// ── métodos base: fit(train[]) → predict(h) con h = 1,2,… pasos adelante ────────
function _fcNaive(y) { const last = y[y.length - 1]; return () => last; }
function _fcMA3(y) { const k = Math.min(3, y.length); const m = y.slice(-k).reduce((a, b) => a + b, 0) / k; return () => m; }
function _fcLinregCoef(y) {
  const n = y.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i]; }
  const den = (n * sxx - sx * sx) || 1;
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  return { a, b };
}
function _fcLinRecent(k) {
  return y => {
    const s = y.slice(-Math.min(k, y.length));
    const f = _fcLinregCoef(s);
    const base = s.length - 1;
    return h => f.a + f.b * (base + h);
  };
}
function _fcCagrRecent(k) {
  return y => {
    const s = y.slice(-Math.min(k + 1, y.length));
    const first = s[0], last = s[s.length - 1], steps = s.length - 1;
    if (first <= 0 || steps <= 0) return () => last;
    const r = Math.pow(last / first, 1 / steps);
    return h => last * Math.pow(r, h);
  };
}
// Holt lineal (nivel+tendencia), opción amortiguada (phi<1). Params por menor SSE
// one-step-ahead sobre el TRAIN (no se elige mirando el holdout → sin fuga de datos).
function _fcHoltRun(y, alpha, beta, phi) {
  let l = y[0], t = (y.length > 1 ? y[1] - y[0] : 0), sse = 0;
  for (let i = 1; i < y.length; i++) {
    const f = l + phi * t;
    sse += (y[i] - f) * (y[i] - f);
    const pl = l;
    l = alpha * y[i] + (1 - alpha) * (l + phi * t);
    t = beta * (l - pl) + (1 - beta) * phi * t;
  }
  return { l, t, sse };
}
function _fcHoltFit(y, damped) {
  const As = [0.1, 0.3, 0.5, 0.7, 0.9], Bs = [0.05, 0.1, 0.2, 0.4], Ps = damped ? [0.80, 0.90, 0.98] : [1];
  let best = null;
  for (const a of As) for (const b of Bs) for (const p of Ps) {
    const r = _fcHoltRun(y, a, b, p);
    if (!best || r.sse < best.sse) best = { a, b, p, l: r.l, t: r.t };
  }
  return best;
}
function _fcHolt(damped) {
  return y => {
    if (y.length < 3) { const last = y[y.length - 1]; return () => last; }
    const f = _fcHoltFit(y, damped);
    return h => {
      let add;
      if (f.p === 1) add = f.t * h;                       // Holt normal: tendencia lineal
      else { let ph = 0; for (let i = 1; i <= h; i++) ph += Math.pow(f.p, i); add = f.t * ph; } // amortiguado
      return f.l + add;
    };
  };
}

const FC_METHODS = [
  { key: "naive",  es: "Nivel actual",          en: "Current level",       fit: _fcNaive },
  { key: "ma3",    es: "Promedio 3 meses",       en: "3-month average",     fit: _fcMA3 },
  { key: "lin6",   es: "Tendencia 6 meses",      en: "6-month trend",       fit: _fcLinRecent(6) },
  { key: "holt",   es: "Suavizado (nivel+tendencia)", en: "Smoothing (Holt)", fit: _fcHolt(false) },
  { key: "damped", es: "Suavizado amortiguado",  en: "Damped smoothing",    fit: _fcHolt(true) },
  { key: "cagr6",  es: "Crecimiento compuesto 6m", en: "6-month CAGR",      fit: _fcCagrRecent(6) }
];
function fcMethodName(key, es) { const m = FC_METHODS.find(x => x.key === key); return m ? (es ? m.es : m.en) : key; }

// ── detección de mes parcial (dato aún cargándose) ──────────────────────────────
// TRUE si el último punto está muy por debajo de la mediana de los 3 previos (típico de
// un mes que todavía no se subió completo). El slide ofrece un toggle para excluirlo.
function fcIsPartialLast(series) {
  const y = _fcClean(series).filter(v => v != null);
  if (y.length < 4) return false;
  const last = y[y.length - 1];
  const prev = y.slice(-4, -1).filter(v => v > 0);
  if (!prev.length) return false;
  return last < 0.6 * _fcMedian(prev);
}

// ── pronóstico de UNA serie ─────────────────────────────────────────────────────
// opts = { horizon=3, dropLast=false }. Devuelve historia + forecast + banda + método + mape.
function fcForecastSeries(rawSeries, opts) {
  opts = opts || {};
  const horizon = opts.horizon || 3;
  let y = _fcClean(rawSeries).filter(v => v != null);
  if (opts.dropLast && y.length > 3) y = y.slice(0, -1);
  const n = y.length;

  if (n < 4) {   // insuficiente para backtest: nivel plano, sin banda fiable
    const last = n ? y[n - 1] : 0;
    const f = Array.from({ length: horizon }, () => last);
    return { ok: n > 0, insufficient: true, history: y, forecast: f, lower: f.slice(), upper: f.slice(),
      method: "naive", mape: null, errByStep: [], n, horizon };
  }

  // Holdout: reservar hasta 6 meses para validar, dejando >=6 para entrenar cuando se pueda.
  const H = n >= 8 ? Math.min(6, n - 6) : Math.max(1, n - 3);
  const train = y.slice(0, n - H), test = y.slice(n - H);
  let best = null;
  for (const m of FC_METHODS) {
    let pf; try { pf = m.fit(train); } catch (e) { continue; }
    const pred = Array.from({ length: H }, (_, i) => pf(i + 1));
    const e = _fcMape(pred, test);
    if (e < Infinity && (!best || e < best.e)) best = { m, e, pred };
  }
  if (!best) { const pf = _fcNaive(train); best = { m: FC_METHODS[0], e: null, pred: Array.from({ length: H }, () => pf()) }; }

  // Error por paso (banda horizonte-aware): |pred_i − real_i| / real_i en el holdout.
  const errByStep = [];
  for (let i = 0; i < H; i++) errByStep.push(test[i] ? Math.abs((best.pred[i] - test[i]) / test[i]) : null);

  // Reajustar el método ganador sobre TODA la serie y proyectar.
  const fitFull = best.m.fit(y);
  const forecast = Array.from({ length: horizon }, (_, i) => Math.max(0, fitFull(i + 1)));
  // Banda = ±(error observado en el backtest), como FRACCIÓN monótona no-decreciente
  // (running max): la incertidumbre no debe "encogerse" con la distancia; nunca por
  // debajo del error real medido a ese paso. Honesto e intuitivo.
  const overall = best.e != null ? best.e / 100 : 0.15;
  const lower = [], upper = [];
  let running = 0;
  for (let h = 1; h <= horizon; h++) {
    const ef = errByStep[h - 1] != null ? errByStep[h - 1] : overall;
    running = Math.max(running, ef);
    const f = forecast[h - 1];
    lower.push(Math.max(0, f * (1 - running)));
    upper.push(f * (1 + running));
  }
  return { ok: true, insufficient: false, history: y, forecast, lower, upper,
    method: best.m.key, mape: best.e, errByStep, n, horizon, droppedLast: !!(opts.dropLast && rawSeries.length !== n) };
}

// ── palancas de crecimiento ─────────────────────────────────────────────────────
// m = objeto de arrays mensuales ALINEADOS: ad, newP, newS, react, sh, trips,
//     regP1/10/50/100, regS1/10/50/100. Devuelve la descomposición del último mes +
//     cuello del embudo + productividad. La narrativa/target la arma el slide.
function fcGrowthLevers(m) {
  const n = (m.ad || []).length;
  if (!n) return null;
  const L = n - 1;
  const v = (a, i) => (a && a[i] != null && !isNaN(a[i])) ? +a[i] : 0;
  const newP = v(m.newP, L), newS = v(m.newS, L), react = v(m.react, L);
  const newT = newP + newS;
  const adNow = v(m.ad, L), adPrev = n > 1 ? v(m.ad, L - 1) : null;
  const retention = adPrev ? (adNow - newT - react) / adPrev : null;
  const churn = adPrev ? Math.max(0, adPrev + newT + react - adNow) : null;

  // Embudo registro→viajes (partner + service combinados).
  const reg1  = v(m.regP1, L)  + v(m.regS1, L);
  const reg10 = v(m.regP10, L) + v(m.regS10, L);
  const reg50 = v(m.regP50, L) + v(m.regS50, L);
  const reg100 = v(m.regP100, L) + v(m.regS100, L);
  const stages = [
    { key: "r1_10",   es: "Registro → 10 viajes",  en: "Signup → 10 trips",  from: reg1,  to: reg10 },
    { key: "r10_50",  es: "10 → 50 viajes",         en: "10 → 50 trips",      from: reg10, to: reg50 },
    { key: "r50_100", es: "50 → 100 viajes",        en: "50 → 100 trips",     from: reg50, to: reg100 }
  ].map(s => ({ ...s, conv: s.from > 0 ? s.to / s.from : null }));
  const withConv = stages.filter(s => s.conv != null);
  const bottleneck = withConv.length ? withConv.slice().sort((a, b) => a.conv - b.conv)[0] : null;
  const funnelHasData = reg1 > 0 || reg10 > 0 || reg50 > 0 || reg100 > 0;

  // Productividad (nivel + tendencia 3m del SH/AD).
  const sh = v(m.sh, L), trips = v(m.trips, L);
  const shPerAd = adNow ? sh / adNow : null;
  const tripsPerAd = adNow ? trips / adNow : null;
  const tripsPerSh = sh ? trips / sh : null;
  let shPerAdTrend = null;
  if (n >= 4) {
    const r = i => (v(m.ad, i) ? v(m.sh, i) / v(m.ad, i) : null);
    const a = r(L), b = r(L - 3);
    if (a != null && b) shPerAdTrend = (a - b) / b * 100;
  }

  // Nuevos+Reactivados de los últimos 3 meses (base para "cuántos necesito"). Incluye
  // reactivados: el flujo que repone la rotación = nuevos + reactivados, consistente con
  // newNeeded = meta − AD·retención (que se cubre con ambos, no solo con nuevos).
  let newAvg3 = newT + react;
  if (n >= 3) { let s = 0; for (let i = L - 2; i <= L; i++) s += v(m.newP, i) + v(m.newS, i) + v(m.react, i); newAvg3 = s / 3; }

  return {
    adNow, adPrev, newP, newS, newT, react, retention, churn,
    funnel: { reg1, reg10, reg50, reg100, stages, bottleneck, hasData: funnelHasData },
    prod: { shPerAd, tripsPerAd, tripsPerSh, shPerAdTrend },
    newAvg3,
    leadDependency: newT > 0 ? newS / newT : null   // % de nuevos que vienen de leads Yango
  };
}

// Dado el estado actual (levers) y un objetivo de AD para el próximo mes, cuánto mover
// cada palanca. AD_next ≈ AD·retención + Nuevos.  →  Nuevos_necesarios = T − AD·retención;
// retención_necesaria = (T − Nuevos_actuales) / AD.
function fcLeversToTarget(levers, targetAD) {
  if (!levers || !targetAD || !levers.adNow) return null;
  const ret = levers.retention != null ? levers.retention : 1;
  const keep = levers.adNow * ret;                       // conductores que se quedan
  const newNeeded = Math.max(0, targetAD - keep);        // nuevos para cerrar el gap
  const retNeeded = levers.adNow ? (targetAD - levers.newAvg3) / levers.adNow : null;
  return {
    targetAD, keep, newNeeded, newNow: levers.newAvg3,
    newDelta: newNeeded - levers.newAvg3,
    retNow: levers.retention, retNeeded: retNeeded != null ? Math.min(1.2, retNeeded) : null,
    gap: targetAD - levers.adNow
  };
}
