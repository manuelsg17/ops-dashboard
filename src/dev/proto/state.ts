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
  // Configuración
  cfg: { sec: "partners" as SeccionCfg, panel: null as string | null, buscar: "", kam: "all", estado: "todos" as "todos" | "pendientes", usuario: 1 }
};

export function resetFiltros() {
  PS.F = filtrosPorDefecto();
  PS.rendLine = "comb";
  PS.metasLine = "comb";
}
