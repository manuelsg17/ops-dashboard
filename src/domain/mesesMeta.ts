// ============================================================
// domain/mesesMeta.ts — Mes + AÑO de una meta (bug B1, sep-2026)
// ============================================================
// `metas.mes` es el NOMBRE del mes sin año ("ENERO") y el año vive aparte en
// `metas.mes_year`. Hasta sep-2026 todo el orden se hacía con `2000 + mes`, así
// que en enero DICIEMBRE (2012) le ganaba a ENERO (2001): Metas y el PDF abrían
// el mes viejo, y ENERO 2026 / ENERO 2027 eran indistinguibles.
//
// Este módulo es PURO (sin STATE ni DOM) para poder probar el escenario de
// enero sin esperar a enero. Regla única de orden: año*100 + mes.

export const MESES_ES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

const _NUM: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sep: 9, set: 9, sept: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, dec: 12, december: 12
};

const _ISO = /^(\d{4})-(\d{1,2})/;

/** Número de mes (1-12) de un nombre (es/en, abreviado, "SETIEMBRE"), de un
 *  "YYYY-MM" o de un número suelto. 0 si no se reconoce. */
export function mesNumero(mes: unknown): number {
  if (mes == null) return 0;
  const s = String(mes).trim().toLowerCase();
  if (!s) return 0;
  const iso = s.match(_ISO);
  if (iso) { const m = +iso[2]; return m >= 1 && m <= 12 ? m : 0; }
  if (_NUM[s]) return _NUM[s];
  if (/^\d{1,2}$/.test(s)) { const n = +s; return n >= 1 && n <= 12 ? n : 0; }
  return 0;
}

/** Nombre canónico con el que se guarda `metas.mes` (ENERO…DICIEMBRE). Un
 *  "SETIEMBRE" o "September" se guarda como "SEPTIEMBRE": si no, el mismo mes
 *  quedaba en dos filas y la app los trataba como meses distintos. Un "YYYY-MM"
 *  se respeta tal cual. Lo que no se reconoce vuelve en mayúsculas. */
export function mesCanonico(mes: unknown): string {
  const s = String(mes ?? "").trim();
  if (_ISO.test(s)) return s;
  const n = mesNumero(s);
  return n ? MESES_ES[n - 1] : s.toUpperCase();
}

/** Año explícito si `mes` es "YYYY-MM"; si no, null. */
export function anioDeIso(mes: unknown): number | null {
  const m = String(mes ?? "").trim().match(_ISO);
  return m ? +m[1] : null;
}

/** Clave de orden. REGLA: año*100 + mes.
 *  - "YYYY-MM" → su año*100 + mes.
 *  - nombre + año → año*100 + mes.
 *  - nombre SIN año (filas legacy anteriores a la migración 2026-09-23) → 2000 + mes:
 *    se conserva el valor viejo para que los consumidores que distinguen "ISO"
 *    (≥ 100000) de "nombre sin año" (2001..2012) sigan funcionando.
 *  - irreconocible → 0. */
export function ordenMes(mes: unknown, anio?: number | null): number {
  const iso = anioDeIso(mes);
  const n = mesNumero(mes);
  if (!n) return 0;
  if (iso != null) return iso * 100 + n;
  if (anio != null && Number.isFinite(+anio) && +anio > 0) return +anio * 100 + n;
  return 2000 + n;
}

export interface YM { y: number; m: number }

/** Año y mes de una fecha en hora de LIMA (UTC-5 fijo, Perú no tiene horario de
 *  verano). No se usa la zona del navegador: el veredicto no puede depender de
 *  dónde está quien mira. */
export function limaYM(d: Date): YM {
  const lima = new Date(d.getTime() - 5 * 3600 * 1000);
  return { y: lima.getUTCFullYear(), m: lima.getUTCMonth() + 1 };
}

/** Año de la ocurrencia de `mesNum` MÁS CERCANA a `ref` (entre ref.y-1, ref.y y
 *  ref.y+1). Empate → la más tardía: una meta se arma por adelantado, no por
 *  detrás. Es EXACTAMENTE la regla del backfill de la migración
 *  2026-09-23_metas_unique_mes_year.sql, para que una fila cargada hoy sin año y
 *  una fila vieja rellenada por la migración reciban el mismo año.
 *  Ej.: en dic-2026 → ENERO es 2027; en ene-2027 → DICIEMBRE es 2026. */
export function anioMasCercano(mesNum: number, ref: YM): number {
  const base = ref.y * 12 + ref.m;
  let best = ref.y, bestD = Infinity;
  for (const y of [ref.y + 1, ref.y, ref.y - 1]) {       // más tardío primero → gana el empate
    const d = Math.abs(y * 12 + mesNum - base);
    if (d < bestD) { bestD = d; best = y; }
  }
  return best;
}

export interface OpcionMes { mes: string; anio: number | null; ord: number; clave: string }

export function claveMes(mes: string, anio: number | null | undefined): string {
  return `${mes}|${anio ?? ""}`;
}
export function parseClaveMes(clave: unknown): { mes: string; anio: number | null } {
  const s = String(clave ?? "");
  const i = s.lastIndexOf("|");
  if (i < 0) return { mes: s, anio: null };
  const a = s.slice(i + 1);
  return { mes: s.slice(0, i), anio: a === "" || !Number.isFinite(+a) ? null : +a };
}

/** Opciones (mes, año) presentes en las metas, de la más reciente a la más vieja.
 *  `rows` son filas de STATE.metasData ({ mes, mYear }). Una fila legacy sin año
 *  se funde con la opción de ese nombre que sí tenga año (no se puede saber a
 *  cuál pertenece); si no hay ninguna, queda como opción propia sin año. */
export function opcionesMesMeta(rows: Array<{ mes?: string; mYear?: number | null }>): OpcionMes[] {
  const conAnio = new Map<string, OpcionMes>();
  const sinAnio = new Set<string>();
  for (const r of rows || []) {
    const mes = (r && r.mes ? String(r.mes) : "").trim();
    if (!mes) continue;
    const anio = r.mYear != null && Number.isFinite(+r.mYear) ? +r.mYear : null;
    if (anio == null) { sinAnio.add(mes); continue; }
    const k = claveMes(mes, anio);
    if (!conAnio.has(k)) conAnio.set(k, { mes, anio, ord: ordenMes(mes, anio), clave: k });
  }
  const out = [...conAnio.values()];
  const nombresConAnio = new Set(out.map(o => o.mes));
  for (const mes of sinAnio) {
    if (nombresConAnio.has(mes)) continue;
    out.push({ mes, anio: null, ord: ordenMes(mes), clave: claveMes(mes, null) });
  }
  return out.sort((a, b) => b.ord - a.ord || a.mes.localeCompare(b.mes));
}

/** Mes que Metas muestra por defecto: el ÚLTIMO MES CON DATOS, no la meta más
 *  nueva. Con metas cargadas por adelantado (se arma octubre a fines de
 *  septiembre) abrir en octubre daba una pantalla vacía.
 *  - Hay meta para el mes del último dato → esa.
 *  - Si no, la meta más reciente ANTERIOR a ese mes.
 *  - Si todas son posteriores, la más cercana (la más vieja de las futuras).
 *  - Sin datos (ultimoDato null) → la meta más reciente.
 *  Las opciones legacy sin año (ord < 100000) no se comparan contra el dato. */
export function mesPorDefecto(opciones: OpcionMes[], ultimoDato: YM | null): OpcionMes | null {
  if (!opciones || !opciones.length) return null;
  if (!ultimoDato) return opciones[0];
  const tope = ultimoDato.y * 100 + ultimoDato.m;
  const fechadas = opciones.filter(o => o.ord >= 100000);
  if (!fechadas.length) return opciones[0];
  const previa = fechadas.find(o => o.ord <= tope);        // ya vienen de mayor a menor
  return previa || fechadas[fechadas.length - 1];
}

/** Año con el que se guarda una fila de metas subida por Excel (B1).
 *  - Celda AÑO válida (1900-2999) → esa, derivado=false.
 *  - "YYYY-MM" en MES → ese año, derivado=false.
 *  - Si no: el año de la ocurrencia más cercana a HOY en Lima (anioMasCercano),
 *    derivado=true — uploadMetas se lo muestra al usuario para que lo confirme
 *    antes de escribir. Nunca devuelve null si el mes se reconoce.
 *  - Mes irreconocible y sin AÑO → anio null (la fila se rechaza). */
export function anioParaFilaMeta(mes: unknown, anioCelda: unknown, hoy: YM): { anio: number | null; derivado: boolean } {
  const txt = anioCelda == null ? "" : String(anioCelda).trim();
  const c = txt === "" ? NaN : Math.trunc(+txt);
  if (Number.isFinite(c) && c >= 1900 && c <= 2999) return { anio: c, derivado: false };
  const iso = anioDeIso(mes);
  if (iso != null) return { anio: iso, derivado: false };
  const n = mesNumero(mes);
  if (!n) return { anio: null, derivado: false };
  return { anio: anioMasCercano(n, hoy), derivado: true };
}
