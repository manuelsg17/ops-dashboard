// shared/chipsAlcance.ts — Qué chips de alcance muestra el encabezado (Ola 5)
//
// El encabezado de cada vista declara el ALCANCE real de lo que se ve: escala,
// rango, ciudad, KAM, línea y selección de partners. Es la versión completa de
// shared/alcance.ts (I13): con filtros restaurados de la sesión anterior, la
// pantalla ya no puede mostrar un subconjunto sin decirlo.
//
// Puro: recibe una FOTO del estado (lo que leen las vistas: getCurrentFilters,
// STATE.curMode, STATE.rendLine/metasLine…) y devuelve descriptores. La
// traducción y el DOM los pone shell.ts.
//
// Reglas:
//   · Escala y rango se muestran SIEMPRE (son parte del alcance aunque estén en
//     su valor por defecto); se pueden quitar solo si NO están en el default.
//   · Ciudad, KAM y línea aparecen solo si difieren del default ("all"/"comb").
//   · Partners aparece solo si la selección NO es la que implica el filtro de
//     KAM (todos los de la lista, o todos los del KAM elegido). Con un KAM
//     elegido y sus partners tildados, un chip de partners repetiría el KAM.

export type ClaveChip = "escala" | "rango" | "ciudad" | "kam" | "linea" | "partners";

export const ESCALA_DEF = "semanal";
export const LINEA_DEF = "comb";

export interface FotoAlcance {
  /** Chips que aplican a la vista (en el orden en que se muestran). */
  claves: ClaveChip[];
  escala: string;
  desde: string;
  hasta: string;
  /** Rango por defecto de la escala (el que pone popDates). */
  desdeDef: string;
  hastaDef: string;
  ciudad: string;
  kam: string;
  /** Línea de negocio de la vista (null si la vista no tiene selector). */
  linea?: string | null;
  /** Partners tildados. */
  seleccion: string[];
  /** Partners de la lista del panel. */
  universo: string[];
  /** Partners del KAM elegido (null/undefined si kam = "all"). */
  deKam?: Iterable<string> | null;
}

export interface ChipAlcance {
  k: ClaveChip;
  /** Se puede quitar (tiene botón ×): el valor difiere del default. */
  quitable: boolean;
  /** Solo partners: cuántos tildados (dentro de la lista) y de cuántos. */
  n?: number;
  total?: number;
}

function _mismoConjunto(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Partners que implica el filtro de KAM (dentro de la lista del panel). */
export function seleccionImplicita(f: Pick<FotoAlcance, "kam" | "universo" | "deKam">): Set<string> {
  const uni = new Set(f.universo);
  if (!f.kam || f.kam === "all") return uni;
  const out = new Set<string>();
  for (const p of f.deKam ?? []) if (uni.has(p)) out.add(p);
  return out;
}

export function chipsAlcance(f: FotoAlcance): ChipAlcance[] {
  const out: ChipAlcance[] = [];
  for (const k of f.claves) {
    switch (k) {
      case "escala":
        out.push({ k, quitable: (f.escala || ESCALA_DEF) !== ESCALA_DEF });
        break;
      case "rango":
        if (f.desde && f.hasta) {
          out.push({ k, quitable: !!(f.desdeDef && f.hastaDef) && (f.desde !== f.desdeDef || f.hasta !== f.hastaDef) });
        }
        break;
      case "ciudad":
        if (f.ciudad && f.ciudad !== "all") out.push({ k, quitable: true });
        break;
      case "kam":
        if (f.kam && f.kam !== "all") out.push({ k, quitable: true });
        break;
      case "linea":
        if (f.linea && f.linea !== LINEA_DEF) out.push({ k, quitable: true });
        break;
      case "partners": {
        if (!f.universo.length) break;
        const uni = new Set(f.universo);
        const sel = new Set(f.seleccion.filter(p => uni.has(p)));
        if (!_mismoConjunto(sel, seleccionImplicita(f))) {
          out.push({ k, quitable: true, n: sel.size, total: uni.size });
        }
        break;
      }
    }
  }
  return out;
}

/** ¿Hay algo que "Restablecer" pueda devolver al default? */
export function hayRecorte(chips: ChipAlcance[]): boolean {
  return chips.some(c => c.quitable);
}
