// ============================================================
// domain/partnersMaestro.ts — Datos maestros de partners (Ola 6, Configuración)
// ============================================================
// Lógica PURA (sin STATE ni DOM) de Configuración → Partners y → Clasificación:
//
//   · armarFilasPartners: una fila por CLID con TODOS los CLIDs que el
//     dashboard conoce — los de `partners` y también los que solo existen en
//     los datos o en `flotas` ("Sin alta"). Antes Configuración listaba solo
//     `partners`, así que los CLIDs huérfanos eran invisibles justo para quien
//     tenía que darlos de alta (plan de mejora §2.3).
//   · kamsCanonicos / kamDuplicado: la lista de KAMs es la unión de partners y
//     flotas, y un KAM nuevo que solo difiere en mayúsculas/tildes/espacios de
//     uno existente ("manuel" vs "Manuel") es casi seguro un error de tipeo que
//     partiría la cartera en dos grupos.
//   · clasifSubflota / patchMaterializar: valor EFECTIVO de cada línea de una
//     sub-flota (db_id) y si es explícito (fila en `fleetrooms`) o heredado del
//     CLID (`partners.is_fleet/is_tuktuk`). Replica EXACTAMENTE la precedencia
//     de rowIsFleet / rowIsTuktuk / rowExcludedFromTaxi / rowIsDelivery /
//     rowIsCargo de data.ts (que no se toca); los tests fijan esa equivalencia.

export interface PartnerDB { partner: string; kam: string; isFleet?: boolean; isTuktuk?: boolean }
export interface FlotaDB { nombre_asignado?: string; kam?: string; ciudad?: string; activo?: boolean }
/** Fila de datos (rendimiento) reducida a lo que importa acá. */
export interface FilaDato { clid: string; partnerExcel?: string; kam?: string; city?: string; dbId?: string }

export type FuenteNombre = "partners" | "flotas" | "excel" | "clid";
export type FuenteKam = "partners" | "flotas" | "excel" | "ninguna";

export interface FilaPartner {
  clid: string;
  /** true = tiene fila en `partners`. */
  alta: boolean;
  nombre: string;
  nombreFuente: FuenteNombre;
  /** KAM efectivo; "" = sin KAM. */
  kam: string;
  kamFuente: FuenteKam;
  ciudades: string[];
  /** Tiene al menos una sub-flota con db_id en los datos cargados. */
  tieneSubflotas: boolean;
  isFleet: boolean;
  isTuktuk: boolean;
  /** Valores propuestos para "Dar de alta" (o para completar lo que falta). */
  sugerido: { nombre: string; kam: string; ciudad: string };
  pendiente: { sinAlta: boolean; sinKam: boolean; nombreEsClid: boolean };
}

const _masFrecuente = (m: Map<string, number>): string => {
  let best = "", n = -1;
  for (const [k, v] of m) if (v > n || (v === n && k < best)) { best = k; n = v; }
  return best;
};

export function armarFilasPartners(
  partners: Record<string, PartnerDB>,
  flotas: Record<string, FlotaDB>,
  datos: Iterable<FilaDato>
): FilaPartner[] {
  interface Acc { excel: Map<string, number>; kam: Map<string, number>; city: Map<string, number>; subflotas: boolean }
  const porClid = new Map<string, Acc>();
  for (const r of datos) {
    const clid = (r.clid || "").trim();
    if (!clid) continue;
    let a = porClid.get(clid);
    if (!a) { a = { excel: new Map(), kam: new Map(), city: new Map(), subflotas: false }; porClid.set(clid, a); }
    const inc = (m: Map<string, number>, v?: string) => { const s = (v || "").trim(); if (s) m.set(s, (m.get(s) || 0) + 1); };
    inc(a.excel, r.partnerExcel);
    inc(a.kam, r.kam);
    inc(a.city, r.city);
    if ((r.dbId || "").trim()) a.subflotas = true;
  }

  const clids = new Set<string>([...Object.keys(partners), ...Object.keys(flotas), ...porClid.keys()]);
  const out: FilaPartner[] = [];
  for (const clid of clids) {
    if (!clid) continue;
    const p = partners[clid];
    const f = flotas[clid];
    const a = porClid.get(clid);
    const nomP = (p?.partner || "").trim();
    const nomF = (f?.nombre_asignado || "").trim();
    const nomX = a ? _masFrecuente(a.excel) : "";
    const kamP = (p?.kam || "").trim();
    const kamF = (f?.kam || "").trim();
    const kamX = a ? _masFrecuente(a.kam) : "";

    let nombre = clid, nombreFuente: FuenteNombre = "clid";
    if (nomP) { nombre = nomP; nombreFuente = "partners"; }
    else if (nomF) { nombre = nomF; nombreFuente = "flotas"; }
    else if (nomX) { nombre = nomX; nombreFuente = "excel"; }

    // Con fila en `partners`, su KAM manda aunque esté vacío (es un hecho
    // conocido: "No KAM"). Sin fila, cae a flotas y después al Excel — la
    // misma precedencia que _buildPartnerKAM (data.ts).
    let kam = "", kamFuente: FuenteKam = "ninguna";
    if (p) { kam = kamP; kamFuente = kamP ? "partners" : "ninguna"; }
    else if (kamF) { kam = kamF; kamFuente = "flotas"; }
    else if (kamX) { kam = kamX; kamFuente = "excel"; }

    const ciudades = a ? [...a.city.keys()].sort() : [];
    const ciudadSug = (f?.ciudad || "").trim() || (a ? _masFrecuente(a.city) : "");
    // Sugerencia de nombre: nunca proponer el propio CLID como nombre.
    const nombreSug = [nomP, nomF, nomX].find(n => n && n !== clid) || "";
    const kamSug = kamP || kamF || kamX;

    out.push({
      clid, alta: !!p, nombre, nombreFuente, kam, kamFuente, ciudades,
      tieneSubflotas: !!a?.subflotas,
      isFleet: !!p?.isFleet, isTuktuk: !!p?.isTuktuk,
      sugerido: { nombre: nombreSug, kam: kamSug, ciudad: ciudadSug },
      pendiente: { sinAlta: !p, sinKam: !kam, nombreEsClid: nombre === clid }
    });
  }
  return out.sort((x, y) => x.nombre.localeCompare(y.nombre) || x.clid.localeCompare(y.clid));
}

export function esPendiente(f: FilaPartner): boolean {
  return f.pendiente.sinAlta || f.pendiente.sinKam || f.pendiente.nombreEsClid;
}

// ── KAMs ─────────────────────────────────────────────────────────────────────

/** Unión de KAMs (partners ∪ flotas), sin vacíos, recortados y ordenados.
 *  Si dos difieren solo en mayúsculas quedan los dos: es justamente el dato
 *  sucio que kamDuplicado() ayuda a no seguir multiplicando. */
export function kamsCanonicos(...listas: Iterable<string | null | undefined>[]): string[] {
  const s = new Set<string>();
  for (const l of listas) for (const k of l) { const v = (k || "").trim(); if (v) s.add(v); }
  return [...s].sort((a, b) => a.localeCompare(b));
}

const _norm = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Si `nuevo` coincide con un KAM existente salvo mayúsculas, tildes o
 *  espacios, devuelve ese KAM existente. Coincidencia exacta o sin parecido → null. */
export function kamDuplicado(nuevo: string, existentes: Iterable<string>): string | null {
  const n = (nuevo || "").trim();
  if (!n) return null;
  const nn = _norm(n);
  let parecido: string | null = null;
  for (const k of existentes) {
    if (k === n) return null;
    if (!parecido && _norm(k) === nn) parecido = k;
  }
  return parecido;
}

// ── Clasificación de sub-flotas ─────────────────────────────────────────────

export type ClaveFlag = "is_fleet" | "is_tuktuk" | "exclude_from_taxi" | "is_delivery" | "is_cargo";

export interface MapasClasif {
  FLEETROOM_IS_FLEET?: Record<string, boolean>;
  FLEETROOM_IS_TUKTUK?: Record<string, boolean>;
  FLEETROOM_EXCLUDE_TAXI?: Record<string, boolean>;
  FLEETROOM_IS_DELIVERY?: Record<string, boolean>;
  FLEETROOM_IS_CARGO?: Record<string, boolean>;
  CLID_IS_FLEET?: Record<string, boolean>;
  CLID_IS_TUKTUK?: Record<string, boolean>;
}

export interface ClasifSubflota {
  /** Tiene fila propia en `fleetrooms` (todas sus marcas son explícitas). */
  explicito: boolean;
  fleet: boolean;
  tuktuk: boolean;
  /** Marca manual "Excluir de Taxi" (solo existe explícita). */
  excluir: boolean;
  delivery: boolean;
  cargo: boolean;
  /** Efectivo: la sub-flota cuenta dentro de Taxi (= !rowExcludedFromTaxi). */
  cuentaEnTaxi: boolean;
  /** Partición de rowVertical(): cargo > delivery > tuktuk > taxi. */
  linea: "cargo" | "delivery" | "tuktuk" | "taxi";
}

const _has = (m: Record<string, boolean> | undefined, id: string): boolean =>
  !!id && !!m && Object.prototype.hasOwnProperty.call(m, id);

export function clasifSubflota(dbId: string, clid: string, M: MapasClasif): ClasifSubflota {
  const id = (dbId || "").trim();
  // En `_applyCoreData` las cinco marcas se cargan juntas por fila de
  // fleetrooms, pero se mira cada mapa como lo hacen los predicados de data.ts.
  const fleet = _has(M.FLEETROOM_IS_FLEET, id) ? !!M.FLEETROOM_IS_FLEET![id] : !!(M.CLID_IS_FLEET || {})[clid];
  const tuktuk = _has(M.FLEETROOM_IS_TUKTUK, id) ? !!M.FLEETROOM_IS_TUKTUK![id] : !!(M.CLID_IS_TUKTUK || {})[clid];
  const excluir = !!(M.FLEETROOM_EXCLUDE_TAXI || {})[id];
  const delivery = !!(M.FLEETROOM_IS_DELIVERY || {})[id];
  const cargo = !!(M.FLEETROOM_IS_CARGO || {})[id];
  const algunoExplicito = _has(M.FLEETROOM_IS_TUKTUK, id) || _has(M.FLEETROOM_EXCLUDE_TAXI, id)
    || _has(M.FLEETROOM_IS_DELIVERY, id) || _has(M.FLEETROOM_IS_CARGO, id);
  const excluidaDeTaxi = algunoExplicito ? (tuktuk || excluir || delivery || cargo) : !!(M.CLID_IS_TUKTUK || {})[clid];
  const linea = cargo ? "cargo" : delivery ? "delivery" : tuktuk ? "tuktuk" : "taxi";
  return {
    explicito: algunoExplicito || _has(M.FLEETROOM_IS_FLEET, id),
    fleet, tuktuk, excluir, delivery, cargo,
    cuentaEnTaxi: !excluidaDeTaxi, linea
  };
}

/** Patch COMPLETO para setFleetroomFlags al tildar/destildar una marca.
 *  Una sub-flota que hereda del CLID no tiene fila en `fleetrooms`: el primer
 *  guardado la crea, y setFleetroomFlags rellena las marcas que no vienen en el
 *  patch con `false`. Sin mandar todas, tildar "Fleet" en una sub-flota de un
 *  CLID TukTuk la volvía Taxi en silencio. Por eso el patch lleva el valor
 *  EFECTIVO actual de las cinco marcas + el cambio pedido.
 *  Delivery y Cargo son excluyentes: tildar una destilda la otra. */
export function patchMaterializar(c: ClasifSubflota, key: ClaveFlag, valor: boolean): Record<ClaveFlag, boolean> {
  const p: Record<ClaveFlag, boolean> = {
    is_fleet: c.fleet, is_tuktuk: c.tuktuk, exclude_from_taxi: c.excluir,
    is_delivery: c.delivery, is_cargo: c.cargo
  };
  p[key] = valor;
  if (valor && key === "is_delivery") p.is_cargo = false;
  if (valor && key === "is_cargo") p.is_delivery = false;
  return p;
}
