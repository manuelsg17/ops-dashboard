// Tests de las piezas puras de charts.ts usadas por Rendimiento (Ola 6).
import { describe, it, expect } from "vitest";
import { indiceBase100, rendTopPartners, valorMetricaPartner, TOP_PARTNERS_TENDENCIA } from "./charts";

describe("indiceBase100", () => {
  it("el primer valor > 0 es 100 y el resto se escala contra él", () => {
    expect(indiceBase100([200, 220, 180])).toEqual([100, 110, 90]);
  });
  it("antes de la base queda hueco (null), no 0", () => {
    expect(indiceBase100([0, 0, 50, 75])).toEqual([null, null, 100, 150]);
  });
  it("sin ningún valor > 0 toda la serie es hueco", () => {
    expect(indiceBase100([0, 0])).toEqual([null, null]);
  });
  it("un 0 después de la base es un 0 real (caída total), no un hueco", () => {
    expect(indiceBase100([10, 0, 5])).toEqual([100, 0, 50]);
  });
  it("redondea a un decimal", () => {
    expect(indiceBase100([3, 4])).toEqual([100, 133.3]);
  });
});

describe("rendTopPartners", () => {
  const dates = ["2026-09-07", "2026-09-14"];
  const byDate = {
    "2026-09-14": Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`P${i}`, { activeDrivers: i * 10 }]))
  };
  const partners = Array.from({ length: 12 }, (_, i) => `P${i}`);

  it("toma los 8 más grandes por AD del ÚLTIMO período, en orden descendente", () => {
    const top = rendTopPartners(dates, partners, byDate);
    expect(top).toHaveLength(TOP_PARTNERS_TENDENCIA);
    expect(top[0]).toBe("P11");
    expect(top[7]).toBe("P4");
  });
  it("con 9 partners igual corta en 8 (sin 'Otros' que absorba al noveno)", () => {
    expect(rendTopPartners(dates, partners.slice(0, 9), byDate)).toHaveLength(8);
  });
  it("empate por nombre, estable", () => {
    const bd = { "2026-09-14": { B: { activeDrivers: 5 }, A: { activeDrivers: 5 } } };
    expect(rendTopPartners(dates, ["B", "A"], bd)).toEqual(["A", "B"]);
  });
});

describe("valorMetricaPartner", () => {
  const bd = { d: { P: { activeDrivers: 3, newPartner: 1, newService: 2, reactivated: 4, supplyHours: 9, trips: 7 } } };
  it("N+R suma las tres fuentes; sin fila da 0", () => {
    expect(valorMetricaPartner(bd, "P", "d", "nr")).toBe(7);
    expect(valorMetricaPartner(bd, "P", "d", "sh")).toBe(9);
    expect(valorMetricaPartner(bd, "P", "d", "tr")).toBe(7);
    expect(valorMetricaPartner(bd, "P", "d", "ad")).toBe(3);
    expect(valorMetricaPartner(bd, "Q", "d", "ad")).toBe(0);
  });
});
