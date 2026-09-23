import { describe, it, expect } from "vitest";
import { estadoMetaFila } from "./estadoMeta";

describe("estadoMetaFila (chips de Metas, decisión 24-sep-2026)", () => {
  it("sin meta gana a todo", () => {
    expect(estadoMetaFila([50, 200], true)).toBe("sin");
    expect(estadoMetaFila([], true)).toBe("sin");
  });
  it("nada medible contra meta → na", () => {
    expect(estadoMetaFila([])).toBe("na");
    expect(estadoMetaFila([NaN])).toBe("na");
  });
  it("sobre = TODOS ≥100 (incluye exactamente 100 y los >150)", () => {
    expect(estadoMetaFila([100, 100, 100])).toBe("sobre");
    expect(estadoMetaFila([101, 120, 140])).toBe("sobre");
    expect(estadoMetaFila([100, 180])).toBe("sobre");
  });
  it("bajo = ALGUNO <95, aunque los otros pasen del 150", () => {
    expect(estadoMetaFila([94.99, 200, 200])).toBe("bajo");
    expect(estadoMetaFila([10])).toBe("bajo");
  });
  it("en meta = el resto: todos ≥95 y alguno <100", () => {
    expect(estadoMetaFila([95, 120])).toBe("en");
    expect(estadoMetaFila([99.99, 100, 100])).toBe("en");
    expect(estadoMetaFila([97])).toBe("en");
  });
  it("antes 'sobre' exigía alguno >150: una fila 110/120 ahora es sobre, no en", () => {
    expect(estadoMetaFila([110, 120])).toBe("sobre");
  });
  it("los tres grupos son disjuntos y cubren todo lo medible", () => {
    const vals = [0, 50, 94.9, 95, 99, 100, 101, 150, 151, 300];
    for (const a of vals) for (const b of vals) {
      const e = estadoMetaFila([a, b]);
      const bajo = a < 95 || b < 95, sobre = a >= 100 && b >= 100;
      expect(e).toBe(bajo ? "bajo" : sobre ? "sobre" : "en");
    }
  });
});
