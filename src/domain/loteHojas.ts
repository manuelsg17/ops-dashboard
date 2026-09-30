// domain/loteHojas.ts — qué hojas van en cada PDF de un lote (puro, sin DOM).
//
// Descarga masiva de presentaciones por KAM (Manuel, 30-sep-2026: "hay KAMs con
// 13-19 cuentas… modificar masivamente rápido"). La matriz es partners × tipos
// de hoja y las reglas se apilan en tres niveles, del más general al más fino:
//   1. TIPO para todos      (columna: "sin Data Raw" en todo el lote)
//   2. HOJA suelta para todos (misma clave de hoja en todos los partners,
//      p.ej. solo "Data Raw (#) · Taxi")
//   3. EXCEPCIÓN por partner (celda u hoja de un partner puntual)
// Lo más fino gana. Las claves de hoja son las de presentacion2.p2SlideKey
// ("<vertical>|<etiqueta es>"), iguales entre partners a propósito.

export type Tipo = "portada" | "ejec" | "resumen" | "kpis" | "nrorigen" | "alertas" | "embudo" | "canal" | "seg" | "raw" | "otra";

/** Orden de las columnas = orden del deck. */
export const TIPOS: Tipo[] = ["portada", "ejec", "resumen", "kpis", "nrorigen", "alertas", "embudo", "canal", "seg", "raw", "otra"];

// Etiqueta BASE en español (sin el " · Taxi" de la vertical) → tipo.
const _POR_BASE: Record<string, Tipo> = {
  "Carátula": "portada", "Ejecutivo": "ejec", "Resumen": "resumen", "KPIs por Nivel": "kpis",
  "N+R por origen": "nrorigen", "Alertas": "alertas", "Embudo de conversión": "embudo",
  "Adquisición por canal": "canal", "Seguimiento": "seg", "Data Raw (#)": "raw", "Data Raw (%)": "raw"
};
export function tipoDeEtiqueta(es: string): Tipo {
  const base = String(es || "").split(" · ")[0].trim();
  return _POR_BASE[base] || "otra";
}
/** Tipo a partir de la clave de hoja "<vertical>|<etiqueta es>". */
export function tipoDeClave(clave: string): Tipo {
  const i = clave.indexOf("|");
  return tipoDeEtiqueta(i >= 0 ? clave.slice(i + 1) : clave);
}

export const PLANTILLAS: { k: string; off: Tipo[] }[] = [
  { k: "completo", off: [] },
  { k: "ejecutivo", off: ["kpis", "nrorigen", "embudo", "canal", "seg", "raw"] },
  { k: "sinanexo", off: ["raw"] }
];

export interface Reglas {
  off: Set<Tipo>;                          // 1. tipos apagados para todos
  offKeys: Set<string>;                    // 2. hojas sueltas apagadas para todos
  offP: Map<string, Set<string>>;          // 3. excepciones: apagadas en un partner
  onP: Map<string, Set<string>>;           // 3. excepciones: prendidas en un partner
}
export function nuevasReglas(off: Tipo[] = []): Reglas {
  return { off: new Set(off), offKeys: new Set(), offP: new Map(), onP: new Map() };
}
const _set = (m: Map<string, Set<string>>, p: string) => { let s = m.get(p); if (!s) { s = new Set(); m.set(p, s); } return s; };

/** Lo que dice la regla GENERAL (niveles 1 y 2) para una hoja. */
export function incluidaGeneral(r: Reglas, clave: string): boolean {
  return !r.off.has(tipoDeClave(clave)) && !r.offKeys.has(clave);
}
export function incluida(r: Reglas, partner: string, clave: string): boolean {
  if (r.offP.get(partner)?.has(clave)) return false;
  if (r.onP.get(partner)?.has(clave)) return true;
  return incluidaGeneral(r, clave);
}
/** Fija una hoja de UN partner; si coincide con la regla general, no deja excepción. */
export function fijarHoja(r: Reglas, partner: string, clave: string, on: boolean): void {
  r.offP.get(partner)?.delete(clave);
  r.onP.get(partner)?.delete(clave);
  if (on === incluidaGeneral(r, clave)) return;
  _set(on ? r.onP : r.offP, partner).add(clave);
}
/** Columna: prende o apaga un tipo en TODO el lote y borra las excepciones de ese tipo. */
export function fijarTipoTodos(r: Reglas, tipo: Tipo, on: boolean): void {
  if (on) r.off.delete(tipo); else r.off.add(tipo);
  for (const k of Array.from(r.offKeys)) if (tipoDeClave(k) === tipo) r.offKeys.delete(k);
  for (const m of [r.offP, r.onP]) for (const s of m.values()) for (const k of Array.from(s)) if (tipoDeClave(k) === tipo) s.delete(k);
}
export function aplicarPlantilla(r: Reglas, k: string): void {
  const p = PLANTILLAS.find(x => x.k === k);
  if (!p) return;
  r.off = new Set(p.off); r.offKeys.clear(); r.offP.clear(); r.onP.clear();
}
/** Plantilla que describe EXACTO las reglas actuales, o "" si se tocó algo a mano. */
export function plantillaActiva(r: Reglas): string {
  if (r.offKeys.size || [...r.offP.values(), ...r.onP.values()].some(s => s.size)) return "";
  const p = PLANTILLAS.find(x => x.off.length === r.off.size && x.off.every(t => r.off.has(t)));
  return p ? p.k : "";
}
/** ¿Este partner tiene excepciones propias? */
export function tieneExcepciones(r: Reglas, partner: string): boolean {
  return !!(r.offP.get(partner)?.size || r.onP.get(partner)?.size);
}
export function limpiarPartner(r: Reglas, partner: string): void { r.offP.delete(partner); r.onP.delete(partner); }

export type EstadoCelda = "on" | "off" | "mix" | "na";
/** Estado de un grupo de hojas (celda = hojas de un tipo de un partner; columna = de todos). */
export function estadoDe(inc: boolean[]): EstadoCelda {
  if (!inc.length) return "na";
  const n = inc.filter(Boolean).length;
  return n === 0 ? "off" : n === inc.length ? "on" : "mix";
}
/** Qué hace un clic sobre un grupo: "on" → apagar; "off"/"mix" → prender. */
export const siguienteValor = (e: EstadoCelda) => e !== "on";
