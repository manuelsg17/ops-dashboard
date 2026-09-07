// ─────────────────────────────────────────────────────────────────────────────
// CALCULADORA: ¿hay progreso sin guardar? ¿aplica el draft guardado?
//
// Dos preguntas chicas pero con consecuencias grandes si se responden mal:
//
//   1. Antes de cambiar de KAM, ¿el usuario perdería algo? Si la respuesta es
//      "sí" y no se avisa, se pierde en silencio una meta que costó armar. Si
//      es "no" y se avisa igual, cada cambio de KAM se vuelve una interrupción
//      molesta y el aviso deja de significar algo.
//   2. Al recargar la página, ¿el borrador guardado es DE ESTA pantalla? Si se
//      aplica sin chequear, el borrador de Ana aparece en la de Beto, o el de
//      julio se cuela sobre agosto.
//
// PURO a propósito: calculator.ts es `//@ts-nocheck` y vive de globals/DOM
// (localStorage, CALC_STATE) que este proyecto deja fuera de los archivos
// tipados y testeados (ver CLAUDE.md). Acá vive la REGLA; calculator.ts solo
// hace el I/O alrededor de ella.
// ─────────────────────────────────────────────────────────────────────────────

export interface CalcGoals {
  ad: number; sh: number; nr: number; otherProj: number; fleetA2: number;
}
export interface CalcTkPct {
  ad: number; sh: number; nr: number;
}

const KEYS_META:  (keyof CalcGoals)[] = ["ad", "sh", "nr", "otherProj", "fleetA2"];
const KEYS_TKPCT: (keyof CalcTkPct)[] = ["ad", "sh", "nr"];

export function hayMetaCargada(g: Partial<CalcGoals> | null | undefined): boolean {
  return !!g && KEYS_META.some(k => +(g[k] as any) > 0);
}
export function hayTkPctCargado(p: Partial<CalcTkPct> | null | undefined): boolean {
  return !!p && KEYS_TKPCT.some(k => +(p[k] as any) > 0);
}

/**
 * ¿Hay algo en pantalla que se perdería si el KAM cambia ahora?
 *
 * Las tres condiciones son cosas que el usuario TECLEÓ y que ningún reparto de
 * OTRO KAM puede conservar con sentido (son números de SU cartera): una meta
 * global cargada, un % de TukTuk declarado, o un edit puntual que todavía no
 * está en la base de datos (`cambiosSinGuardar`, ver `_calcContarCambios`).
 */
export function hayProgresoSinGuardar(
  g: Partial<CalcGoals> | null | undefined,
  p: Partial<CalcTkPct> | null | undefined,
  cambiosSinGuardar: number
): boolean {
  return hayMetaCargada(g) || hayTkPctCargado(p) || cambiosSinGuardar > 0;
}

export interface CalcDraft {
  kam: string;
  mesKey: string;
  kamGoals?: Partial<CalcGoals> | null;
  tkPct?: Partial<CalcTkPct> | null;
}

/**
 * ¿El draft persistido aplica a la pantalla actual?
 *
 * Cuatro condiciones, las cuatro necesarias:
 *  - existe un draft;
 *  - el KAM activo no es "all" (ese valor no identifica una cartera real, y
 *    guardar/restaurar un draft ahí no tiene a quién pertenecerle);
 *  - el KAM del draft es EXACTAMENTE el activo (no el de otra persona);
 *  - el mes del draft es EXACTAMENTE el mes objetivo activo (no el ciclo
 *    anterior, que ya cerró y no debería reaparecer sobre el nuevo).
 *
 * El llamador es responsable de solo invocar esto cuando la pantalla está
 * recién servida (sin nada tecleado todavía) — acá no se repite ese chequeo
 * porque depende de en qué momento del render se llama, algo que este módulo,
 * al ser puro, no puede saber por sí solo.
 */
/**
 * ¿Corresponde preseleccionar el KAM del login (STATE.myKam) en la Calculadora?
 *
 * Las cuatro condiciones:
 *  - el usuario todavía no tocó el selector a mano en esta sesión
 *    (`kamTouched` — una vez que lo toca, ni este login ni ningún otro default
 *    debe volver a pisar su elección);
 *  - el login declara un KAM (`myKam`, viene de app_metadata — null para admin
 *    o para un kam sin asignar todavía);
 *  - no es YA el que está activo (evita una asignación redundante en cada
 *    render, no cambia el resultado pero sí ahorra trabajo);
 *  - ese KAM existe REALMENTE en la data cargada — un valor mal escrito al
 *    asignarlo (ver el comando SQL en CLAUDE.md) no debe dejar el selector en
 *    un KAM fantasma que no aparece en ningún reparto.
 */
export function debePreseleccionarKam(
  kamTouched: boolean,
  myKam: string | null | undefined,
  kamActivo: string,
  kamsDisponibles: string[]
): boolean {
  return !kamTouched && !!myKam && kamActivo !== myKam && kamsDisponibles.includes(myKam);
}

export function draftAplica(
  draft: CalcDraft | null | undefined,
  kamActivo: string,
  mesKeyActivo: string
): boolean {
  if (!draft || !kamActivo || kamActivo === "all") return false;
  return draft.kam === kamActivo && draft.mesKey === mesKeyActivo;
}
