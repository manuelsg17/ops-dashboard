// ─────────────────────────────────────────────────────────────────────────────
// Instrumentación del arranque (Ola 2 — "medido, no supuesto").
//
// Se activa con `?perf=1` en la URL (también en producción: solo agrega marcas
// de `performance` y un registro de requests en memoria, no manda nada a
// ningún lado) o con `localStorage.yangoPerf = "1"`. Apagado no hace NADA: ni
// marcas ni envoltorio de fetch.
//
// Qué deja en `window.__perf()`:
//   - marks: las marcas del arranque en ms desde el inicio de la navegación
//     (app:start, auth:*, paint:*, net:*, render2:*).
//   - requests: cada fetch a Supabase con inicio/fin y su PROFUNDIDAD en la
//     cadena: 1 + la mayor profundidad entre los requests que terminaron antes de
//     que este empezara. La profundidad del último request que hizo falta para
//     pintar = cantidad de round-trips EN SERIE del camino crítico, que es lo
//     que manda con latencia real (Lima→us-east ≈ 300 ms cada uno).
//
// LATENCIA SIMULADA (`?lat=300`): SOLO en DEV (import.meta.env.DEV — Vite la
// elimina del build de producción). Demora cada request a Supabase N ms antes
// de salir, para comparar tiempos con una latencia parecida a la real (en local
// es ≈0 y todo parece instantáneo).
//
// ORDEN: este módulo es el PRIMER import de vendor.ts a propósito. supabase-js
// captura `fetch` al crear el cliente (auth.ts, al evaluar el módulo): el
// envoltorio tiene que estar puesto antes para ver también el refresh del token.
// ─────────────────────────────────────────────────────────────────────────────

type Req = { url: string; method: string; start: number; end: number; status: number; depth?: number };

// `(import.meta as any)`: el tsconfig no trae los tipos de Vite. En el build de
// producción Vite reemplaza `import.meta.env` por un literal con DEV=false.
const _DEV: boolean = (import.meta as any).env?.DEV === true;
const _qs = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
const _ls = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export const PERF_ON: boolean = _qs.get("perf") === "1" || _ls("yangoPerf") === "1";

const _marks: Record<string, number> = {};
const _reqs: Req[] = [];

export function perfMark(name: string): void {
  if (!PERF_ON) return;
  try { performance.mark(name); } catch { /* navegador viejo */ }
  if (!(name in _marks)) _marks[name] = Math.round(performance.now());
}

const _notas: Record<string, unknown> = {};
/** Dato de diagnóstico suelto (p.ej. por qué no se saltó el segundo render). */
export function perfNote(name: string, value: unknown): void {
  if (PERF_ON) _notas[name] = value;
}

/** Mide la duración (ms de hilo principal) de un bloque síncrono. */
export function perfMeasure<T>(name: string, fn: () => T): T {
  if (!PERF_ON) return fn();
  const t0 = performance.now();
  try { return fn(); }
  finally {
    const d = performance.now() - t0;
    _marks[name + ":ms"] = Math.round(d * 10) / 10;
    try { performance.measure(name, { start: t0, duration: d }); } catch { /* ok */ }
  }
}

function _esSupabase(url: string): boolean {
  return /\/(rest|auth|functions)\/v1\//.test(url);
}

function _profundidades(): Req[] {
  const rs = _reqs.slice().sort((a, b) => a.start - b.start);
  for (const r of rs) {
    let d = 0;
    for (const q of rs) if (q !== r && q.end <= r.start && (q.depth || 0) > d) d = q.depth || 0;
    r.depth = d + 1;
  }
  return rs;
}

/** Profundidad máxima entre los requests que terminaron antes de `t` (ms). */
export function perfDepthBefore(t: number): number {
  return _profundidades().filter(r => r.end <= t).reduce((m, r) => Math.max(m, r.depth || 0), 0);
}

if (PERF_ON || (_DEV && _qs.get("lat"))) {
  const lat = _DEV ? Math.max(0, +(_qs.get("lat") || 0)) : 0;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (!_esSupabase(url)) return orig(input, init);
    const method = (init && init.method) || (input && input.method) || "GET";
    const start = performance.now();
    if (lat) await new Promise(r => setTimeout(r, lat));
    try {
      const res = await orig(input, init);
      if (PERF_ON) _reqs.push({ url, method, start, end: performance.now(), status: res.status });
      return res;
    } catch (e) {
      if (PERF_ON) _reqs.push({ url, method, start, end: performance.now(), status: 0 });
      throw e;
    }
  };
}

if (PERF_ON) {
  (window as any).__perf = () => {
    const reqs = _profundidades().map(r => ({
      what: `${r.method} ${r.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`,
      start: Math.round(r.start), end: Math.round(r.end), status: r.status, depth: r.depth
    }));
    const primerPintado = Math.min(_marks["paint:cache"] ?? Infinity, _marks["net:applied"] ?? Infinity);
    return {
      marks: { ..._marks },
      notas: { ..._notas },
      requests: reqs,
      depthAntesDelPrimerPintado: isFinite(primerPintado) ? perfDepthBefore(primerPintado) : null,
      depthAntesDeRed: _marks["net:applied"] != null ? perfDepthBefore(_marks["net:applied"]) : null
    };
  };
}

perfMark("app:start");
