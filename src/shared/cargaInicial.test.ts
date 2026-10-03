import { describe, it, expect } from "vitest";
import { avanceCarga, siguienteConsejo, PASOS_INICIAL, N_CONSEJOS } from "./cargaInicial";

describe("pantalla de carga de los datos", () => {
  it("el avance es pasos listos sobre el total, acotado a 0-100", () => {
    expect(avanceCarga(0)).toBe(0);
    expect(avanceCarga(2)).toBe(50);
    expect(avanceCarga(PASOS_INICIAL.length)).toBe(100);
    expect(avanceCarga(9)).toBe(100);
    expect(avanceCarga(-1)).toBe(0);
    expect(avanceCarga(1, 0)).toBe(0);
  });
  it("los consejos rotan en círculo", () => {
    expect(siguienteConsejo(0)).toBe(1);
    expect(siguienteConsejo(N_CONSEJOS - 1)).toBe(0);
    expect(siguienteConsejo(3, 0)).toBe(0);
  });
});
