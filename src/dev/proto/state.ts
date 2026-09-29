// dev/proto/state.ts — Estado del prototipo ?ui=proto (SOLO desarrollo).
// Todo vive en memoria: nada se escribe en la base ni en localStorage.

import { filtrosPorDefecto, type Filtros, type Linea } from "./model";

export type Version = "elegida" | "a" | "b" | "c";
export type Pagina = "rend" | "metas" | "calc" | "config";
export type SeccionCfg = "partners" | "clasificacion" | "cargas" | "usuarios" | "monitoreo" | "preferencias" | "mantenimiento";

export const VERSIONES: { id: Version; label: string; desc: string }[] = [
  { id: "elegida", label: "Elegida", desc: "La actual, más suave" },
  { id: "a", label: "A · Lienzo abierto", desc: "Sin tarjetas, tipo informe" },
  { id: "b", label: "B · Suave", desc: "Muy redondeada, anillos" },
  { id: "c", label: "C · Mesa de trabajo", desc: "Lista + detalle, densa" }
];

export type K3 = "ad" | "sh" | "nr";
// Calculadora, segunda vuelta (pCalc2.ts): tres propuestas propias.
export type CalcV = "p1" | "p2" | "p3";
export const VERSIONES_CALC: { id: CalcV; label: string; desc: string }[] = [
  { id: "p1", label: "1 · Pestañas por línea", desc: "Metas a la izquierda; a la derecha una pestaña por línea (Taxi, TukTuk, Fleet…), cada una editable" },
  { id: "p2", label: "2 · Un indicador a la vez", desc: "Eliges AD, Horas o N+R y ves Taxi y TukTuk lado a lado, editables, con el total del partner" },
  { id: "p3", label: "3 · Líneas arriba", desc: "Sin panel lateral: metas y tarjetas por línea arriba, la tabla a todo el ancho" }
];
export interface Calc2State {
  v: CalcV;
  kam: string;
  total: Record<K3, number | null>;
  tkModo: "pct" | "abs";
  tkPct: Record<K3, number | null>;
  tkAbs: Record<K3, number | null>;
  tab: "total" | "taxi" | "tk" | "fleet";
  kpi: K3;
  fijos: Record<string, number>;          // `${partner@city}|${taxi|tk}|${k}`
  fleet: Record<string, number | null>;   // `${partner@city}|${shcar|acc|util}`
}

export interface CalcState {
  kam: string;
  goals: { ad: number | null; sh: number | null; nr: number | null };
  fijos: Record<string, { ad?: number; sh?: number; nr?: number }>;
  tkPct: { ad: string; sh: string; nr: string };
  modo: "edits" | "full";
  vista: "agg" | "fleet";
  refAbierta: boolean;
  avanzados: boolean;
  paso: number;            // asistente de la versión B
  sel: string | null;      // fila elegida (versión C)
}

export const PS = {
  v: "elegida" as Version,
  page: "rend" as Pagina,
  theme: "light" as "light" | "dark",
  rail: false,
  filtros: true,
  switchAbierto: true,
  F: filtrosPorDefecto() as Filtros,
  menu: "" as "" | "upload" | "user" | "metas",
  // Rendimiento
  rendLine: "comb" as Linea,
  ciudadModo: "indice" as "indice" | "valores",
  sort: { col: "ad", dir: "desc" as "asc" | "desc" },
  rSel: null as string | null,
  // Metas
  metasLine: "comb" as Linea,
  metasMes: "2026-09",
  metasFiltro: "todos" as "todos" | "bajo" | "en" | "sobre" | "sin",
  metasSort: { col: "peor", dir: "asc" as "asc" | "desc" },
  metasVista: "tabla" as "tabla" | "tarjetas",
  mSel: null as string | null,
  // Calculadora
  calc: {
    kam: "Ana", goals: { ad: 10000, sh: 640000, nr: 2200 }, fijos: {}, tkPct: { ad: "", sh: "", nr: "" },
    modo: "full", vista: "agg", refAbierta: false, avanzados: false, paso: 1, sel: null
  } as CalcState,
  c2: {
    v: "p1", kam: "Ana", total: { ad: 10000, sh: 640000, nr: 2200 }, tkModo: "pct",
    tkPct: { ad: 17, sh: 20.2, nr: 15.6 }, tkAbs: { ad: null, sh: null, nr: null },
    tab: "taxi", kpi: "ad", fijos: {}, fleet: {}
  } as Calc2State,
  // Configuración
  cfg: { sec: "partners" as SeccionCfg, panel: null as string | null, buscar: "", kam: "all", estado: "todos" as "todos" | "pendientes", usuario: 1 }
};

export function resetFiltros() {
  PS.F = filtrosPorDefecto();
  PS.rendLine = "comb";
  PS.metasLine = "comb";
}
