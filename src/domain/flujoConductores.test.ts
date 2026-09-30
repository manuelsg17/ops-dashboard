import { describe, it, expect } from "vitest";
import { flujoCuenta, flujoTotal } from "./flujoConductores";
import { retentionSeries } from "./metrics";

describe("flujo de conductores (misma fórmula que la Presentación)", () => {
  it("retención = (AD − nuevos − reactivados) / AD anterior, y perdidos = churn del deck", () => {
    const f = flujoCuenta({ adPrev: 100, ad: 110, nr: 30, re: 18 });
    expect(f).toMatchObject({ ganados: 30, nuevos: 12, reactivados: 18, retenidos: 80, perdidos: 20, neto: 10, volvieron: 0 });
    expect(f.retencion).toBeCloseTo(0.8);
    // Idéntico a metrics.retentionSeries (deck) sobre la misma serie.
    expect(retentionSeries([100, 110], [0, 12], [0, 18])[1]).toBeCloseTo(f.retencion!);
  });
  it("sin base previa no hay retención (null, no 0) ni bajas", () => {
    const f = flujoCuenta({ adPrev: 0, ad: 40, nr: 40 });
    expect(f.retencion).toBeNull();
    expect(f.perdidos).toBe(0);
  });
  it("sin recortes: pasa de 100% con intermitentes y puede dar negativa (como el deck)", () => {
    const a = flujoCuenta({ adPrev: 100, ad: 130, nr: 10 });
    expect(a).toMatchObject({ volvieron: 20, perdidos: 0, neto: 30 });
    expect(a.retencion).toBeCloseTo(1.2);
    const b = flujoCuenta({ adPrev: 50, ad: 20, nr: 30 });
    expect(b.retencion).toBeCloseTo(-0.2);
    expect(b.perdidos).toBe(60);
  });
  it("identidad neto = nuevos + reactivados + intermitentes − perdidos en muchas combinaciones", () => {
    for (let a = 0; a < 60; a += 7) for (let b = 0; b < 60; b += 5) for (let r = 0; r < 70; r += 9) {
      const f = flujoCuenta({ adPrev: a, ad: b, nr: r, re: Math.floor(r / 2) });
      expect(f.nuevos + f.reactivados + f.volvieron - f.perdidos).toBe(f.neto);
      expect(f.volvieron > 0 && f.perdidos > 0).toBe(false);
    }
  });
  it("el total se calcula sobre los totales del nivel (no promedia % ni suma bajas por cuenta)", () => {
    const t = flujoTotal([{ adPrev: 100, ad: 110, nr: 30, re: 18 }, { adPrev: 50, ad: 40, nr: 10, re: 2 }]);
    // (150 − 40) / 150
    expect(t.retencion).toBeCloseTo(110 / 150);
    expect(t).toMatchObject({ base: 150, ganados: 40, nuevos: 20, reactivados: 20, perdidos: 40, neto: 0 });
  });
});
