import { describe, it, expect } from "vitest";
import { hayMetaCargada, hayTkPctCargado, hayProgresoSinGuardar, draftAplica, debePreseleccionarKam } from "./calcDraft.js";

const CERO_G = { ad: 0, sh: 0, nr: 0, otherProj: 0, fleetA2: 0 };
const CERO_P = { ad: 0, sh: 0, nr: 0 };

describe("hay meta / % cargado", () => {
  it("todo en cero no es progreso", () => {
    expect(hayMetaCargada(CERO_G)).toBe(false);
    expect(hayTkPctCargado(CERO_P)).toBe(false);
  });

  it("un solo campo alcanza", () => {
    expect(hayMetaCargada({ ...CERO_G, sh: 500000 })).toBe(true);
    expect(hayTkPctCargado({ ...CERO_P, nr: 0.1 })).toBe(true);   // el mínimo declarable
  });

  it("null/undefined no es progreso, no revienta", () => {
    expect(hayMetaCargada(null)).toBe(false);
    expect(hayMetaCargada(undefined)).toBe(false);
    expect(hayTkPctCargado(null)).toBe(false);
  });

  it("un negativo (dato corrupto) no cuenta como carga", () => {
    // No debería poder pasar por la UI (los inputs tienen min=0), pero si un
    // valor corrupto llega igual, no queremos un falso "hay progreso".
    expect(hayMetaCargada({ ...CERO_G, ad: -5 })).toBe(false);
  });
});

describe("hay progreso sin guardar — la pregunta antes de cambiar de KAM", () => {
  it("todo vacío: no hay nada que perder, no hace falta avisar", () => {
    expect(hayProgresoSinGuardar(CERO_G, CERO_P, 0)).toBe(false);
  });

  it("una meta global cargada sola ya es progreso", () => {
    expect(hayProgresoSinGuardar({ ...CERO_G, ad: 15473 }, CERO_P, 0)).toBe(true);
  });

  it("un % TukTuk declarado solo ya es progreso", () => {
    // Caso real: el KAM cargó el 17% antes que la meta global.
    expect(hayProgresoSinGuardar(CERO_G, { ...CERO_P, ad: 17 }, 0)).toBe(true);
  });

  it("un edit puntual sin meta global cargada también cuenta", () => {
    // Ajustó a mano una celda de la tabla sin tocar el bloque de arriba.
    expect(hayProgresoSinGuardar(CERO_G, CERO_P, 1)).toBe(true);
  });

  it("las tres fuentes se combinan con OR, no hace falta que coincidan todas", () => {
    expect(hayProgresoSinGuardar({ ...CERO_G, sh: 1 }, { ...CERO_P, nr: 1 }, 3)).toBe(true);
  });
});

describe("el draft aplica solo cuando corresponde EXACTAMENTE", () => {
  const draft = { kam: "Ana", mesKey: "AGOSTO-2026", kamGoals: { ad: 10000 } };

  it("mismo KAM, mismo mes: aplica", () => {
    expect(draftAplica(draft, "Ana", "AGOSTO-2026")).toBe(true);
  });

  it("otro KAM: NO aplica — el draft de Ana no puede aparecer en la pantalla de Beto", () => {
    expect(draftAplica(draft, "Beto", "AGOSTO-2026")).toBe(false);
  });

  it("otro mes: NO aplica — un draft de julio no se cuela sobre agosto", () => {
    expect(draftAplica(draft, "Ana", "JULIO-2026")).toBe(false);
  });

  it("\"all\" nunca tiene draft: no identifica una cartera real", () => {
    expect(draftAplica({ kam: "all", mesKey: "AGOSTO-2026" }, "all", "AGOSTO-2026")).toBe(false);
  });

  it("sin draft (null/undefined) no aplica, no revienta", () => {
    expect(draftAplica(null, "Ana", "AGOSTO-2026")).toBe(false);
    expect(draftAplica(undefined, "Ana", "AGOSTO-2026")).toBe(false);
  });

  it("kamActivo vacío no aplica", () => {
    expect(draftAplica(draft, "", "AGOSTO-2026")).toBe(false);
  });
});

describe("preselección del KAM del login", () => {
  const KAMS = ["Ana", "Beto", "Carla"];

  it("caso normal: login de Ana, selector en \"all\" → se preselecciona", () => {
    expect(debePreseleccionarKam(false, "Ana", "all", KAMS)).toBe(true);
  });

  it("ya tocado a mano: no vuelve a pisar aunque siga sin coincidir", () => {
    // El caso que motivó el flag: sin esto, cada re-render (dispara con cada
    // tecla) revertiría al KAM del login apenas alguien mirara la meta de otro.
    expect(debePreseleccionarKam(true, "Ana", "Beto", KAMS)).toBe(false);
  });

  it("admin sin KAM declarado (myKam null): nunca preselecciona", () => {
    expect(debePreseleccionarKam(false, null, "all", KAMS)).toBe(false);
    expect(debePreseleccionarKam(false, undefined, "all", KAMS)).toBe(false);
  });

  it("ya es el activo: no hace falta re-asignar", () => {
    expect(debePreseleccionarKam(false, "Ana", "Ana", KAMS)).toBe(false);
  });

  it("un KAM mal escrito (no existe en la data) no deja el selector en un fantasma", () => {
    // Ej. error de tipeo en el comando SQL de CLAUDE.md: jsonb_build_object('kam','ana')
    // en minúscula no matchea "Ana".
    expect(debePreseleccionarKam(false, "ana", "all", KAMS)).toBe(false);
  });
});
