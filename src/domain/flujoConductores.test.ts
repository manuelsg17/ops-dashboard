import { describe, it, expect } from "vitest";
import { flujoCuenta, flujoTotal } from "./flujoConductores";

describe("flujo de conductores", () => {
  it("ganados, perdidos, neto y retención de una cuenta", () => {
    const f = flujoCuenta({ adPrev: 100, ad: 110, nr: 30 });
    expect(f).toMatchObject({ ganados: 30, retenidos: 80, perdidos: 20, neto: 10 });
    expect(f.retencion).toBeCloseTo(0.8);
    expect(f.ganados - f.perdidos).toBe(f.neto);
  });
  it("sin base previa no hay retención (null, no 0) ni bajas", () => {
    const f = flujoCuenta({ adPrev: 0, ad: 40, nr: 40 });
    expect(f.retencion).toBeNull();
    expect(f.perdidos).toBe(0);
  });
  it("dato ruidoso (N+R > AD) no fabrica retenidos negativos y el neto cuadra", () => {
    const f = flujoCuenta({ adPrev: 50, ad: 20, nr: 30 });
    expect(f.retenidos).toBe(0);
    expect(f.ganados + f.volvieron - f.perdidos).toBe(f.neto);
  });
  it("los que faltaron un período y volvieron sin ser reactivados cierran el neto", () => {
    const f = flujoCuenta({ adPrev: 100, ad: 130, nr: 10 });
    // continúan 120 > 100 base: nadie se perdió en neto y 20 volvieron
    expect(f).toMatchObject({ ganados: 10, volvieron: 20, perdidos: 0, neto: 30 });
    expect(f.retencion).toBe(1);
  });
  it("identidad neto = ganados + volvieron − perdidos en muchas combinaciones", () => {
    for (let a = 0; a < 60; a += 7) for (let b = 0; b < 60; b += 5) for (let r = 0; r < 70; r += 9) {
      const f = flujoCuenta({ adPrev: a, ad: b, nr: r });
      expect(f.ganados + f.volvieron - f.perdidos).toBe(f.neto);
    }
  });
  it("el total suma por cuenta: el crecimiento de una no tapa las bajas de otra", () => {
    const t = flujoTotal([{ adPrev: 100, ad: 150, nr: 60 }, { adPrev: 100, ad: 60, nr: 0 }]);
    // cuenta 1: retiene 90, pierde 10; cuenta 2: retiene 60, pierde 40
    expect(t.perdidos).toBe(50);
    expect(t.ganados).toBe(60);
    expect(t.neto).toBe(10);
    expect(t.ganados + t.volvieron - t.perdidos).toBe(t.neto);
    expect(t.retencion).toBeCloseTo(150 / 200);
  });
});
