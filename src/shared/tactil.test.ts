import { describe, it, expect } from "vitest";
import { corrimientoBurbuja, tituloAporta } from "./tactil";

describe("ayudas táctiles", () => {
  it("una burbuja centrada que entra no se corre", () => {
    expect(corrimientoBurbuja(400, 280, 800)).toBe(0);
  });
  it("cerca del borde derecho se corre hacia la izquierda lo justo", () => {
    // centro 740, ancho 280 → iría de 600 a 880; el máximo a la izquierda es 800-12-280=508
    expect(corrimientoBurbuja(740, 280, 800)).toBe(508 - 600);
  });
  it("cerca del borde izquierdo se corre hacia la derecha", () => {
    expect(corrimientoBurbuja(20, 280, 800)).toBe(12 - (20 - 140));
  });
  it("si es más ancha que la pantalla, queda pegada al margen izquierdo", () => {
    expect(corrimientoBurbuja(100, 400, 375)).toBe(12 - (100 - 200));
  });
  it("un title que repite el texto visible no aporta nada", () => {
    expect(tituloAporta("Retención", " retención ")).toBe(false);
    expect(tituloAporta("", "x")).toBe(false);
    expect(tituloAporta("Actual 120 vs semana anterior: 100 → +20%", "+20%")).toBe(true);
  });
});
