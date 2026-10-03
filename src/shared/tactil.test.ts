import { describe, it, expect } from "vitest";
import { corrimientoBurbuja, tituloAporta, esIOS, viewportSinZoomDeFoco } from "./tactil";

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

describe("iOS: sin zoom al tocar un campo", () => {
  it("reconoce iPhone, iPad viejo e iPadOS (que dice ser Mac con pantalla táctil)", () => {
    expect(esIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)", "iPhone", 5)).toBe(true);
    expect(esIOS("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad", 5)).toBe(true);
    expect(esIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(esIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(esIOS("Mozilla/5.0 (Linux; Android 14; Pixel 8)", "Linux armv8l", 5)).toBe(false);
    // Emulación de Android en un navegador de escritorio de Mac: platform sigue siendo MacIntel.
    expect(esIOS("Mozilla/5.0 (Linux; Android 14; Pixel 8)", "MacIntel", 5)).toBe(false);
  });
  it("agrega maximum-scale=1 una sola vez", () => {
    expect(viewportSinZoomDeFoco("width=device-width,initial-scale=1.0")).toBe("width=device-width,initial-scale=1.0, maximum-scale=1");
    expect(viewportSinZoomDeFoco("width=device-width, maximum-scale=1")).toBe("width=device-width, maximum-scale=1");
  });
});
