import { describe, it, expect } from "vitest";
import { cuadreMetrica } from "./cuadre";

describe("cuadre del reparto contra la meta del KAM", () => {
  it("cuadra solo si la suma es la meta (en enteros)", () => {
    expect(cuadreMetrica(3000, 3000).ok).toBe(true);
    expect(cuadreMetrica(3000.4, 3000).ok).toBe(true);     // ruido de coma flotante
  });
  it("una celda editada en +10 sobre 3,000 NO cuadra (antes pasaba por la tolerancia de 0.5%)", () => {
    const c = cuadreMetrica(3010, 3000);
    expect(c.ok).toBe(false);
    expect(c.gap).toBe(10);
    expect(cuadreMetrica(2999, 3000).ok).toBe(false);
  });
  it("sin meta no hay cuadre", () => {
    expect(cuadreMetrica(100, 0)).toMatchObject({ ok: false, hasGoal: false });
  });
});
