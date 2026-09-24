import { describe, it, expect } from "vitest";
import { avanceSobreCuota, type Agregado } from "./avanceCuota";

// Unidad de prueba: actual, cuota (null = no declarada), proyección.
type U = { a: number | null; c: number | null; p?: number | null };
const suma = (us: U[]): Agregado => {
  let a = 0, m = 0, p = 0, hA = false, hM = false, hP = false;
  us.forEach(u => {
    if (u.a != null) { a += u.a; hA = true; }
    if (u.c != null) { m += u.c; hM = true; }
    const pv = u.p !== undefined ? u.p : u.a;
    if (pv != null) { p += pv; hP = true; }
  });
  return { actual: hA ? a : null, meta: hM ? m : null, proj: hP ? p : null };
};
const opts = { declarada: (u: U) => u.c != null, conDato: (u: U) => u.a != null, agregar: suma };

describe("avanceSobreCuota", () => {
  it("el actual es de TODAS las cuentas; el % solo de las que tienen cuota", () => {
    const us: U[] = [
      { a: 200, c: 210 }, { a: 150, c: 160 }, { a: 62, c: 68 },     // con cuota: 412 de 438
      { a: 500, c: null }, { a: 388, c: null }                      // sin cuota
    ];
    const r = avanceSobreCuota(us, opts);
    expect(r.actual).toBe(1300);
    expect(r.meta).toBe(438);
    expect(r.actualCuota).toBe(412);
    expect(r.pct).toBeCloseTo(94.06, 2);
    expect(r.nCuota).toBe(3);
    expect(r.nTotal).toBe(5);
  });

  it("antes daba 1300/438 = 297%: la regla nueva no deja que las cuentas sin cuota inflen el %", () => {
    const us: U[] = [{ a: 412, c: 438 }, { a: 888, c: null }];
    expect(avanceSobreCuota(us, opts).pct).toBeLessThan(100);
  });

  it("ninguna cuenta con cuota → sin meta ni %, pero el actual se sigue mostrando", () => {
    const r = avanceSobreCuota([{ a: 10, c: null }, { a: 5, c: null }], opts);
    expect(r.actual).toBe(15);
    expect(r.meta).toBeNull();
    expect(r.pct).toBeNull();
    expect(r.pctProj).toBeNull();
    expect(r.nCuota).toBe(0);
    expect(r.nTotal).toBe(2);
  });

  it("cuota declarada en 0 cuenta como declarada, pero sin meta > 0 no hay %", () => {
    const r = avanceSobreCuota([{ a: 10, c: 0 }, { a: 5, c: null }], opts);
    expect(r.nCuota).toBe(1);
    expect(r.meta).toBe(0);
    expect(r.pct).toBeNull();
  });

  it("las cuentas con cuota no operaron (sin actual) y otras sí → 0%, no 'sin dato'", () => {
    const r = avanceSobreCuota([{ a: null, c: 100 }, { a: 40, c: null }], opts);
    expect(r.actual).toBe(40);
    expect(r.actualCuota).toBe(0);
    expect(r.pct).toBe(0);
    expect(r.nTotal).toBe(2);
  });

  it("sin ningún actual → sin % (la vista muestra 'meta sin actual')", () => {
    const r = avanceSobreCuota([{ a: null, c: 100, p: null }], opts);
    expect(r.actual).toBeNull();
    expect(r.meta).toBe(100);
    expect(r.pct).toBeNull();
  });

  it("la proyección del % también es solo de las cuentas con cuota", () => {
    const us: U[] = [{ a: 50, c: 100, p: 120 }, { a: 900, c: null, p: 1800 }];
    const r = avanceSobreCuota(us, opts);
    expect(r.proj).toBe(1920);       // acompaña al actual (todas)
    expect(r.projCuota).toBe(120);
    expect(r.pctProj).toBe(120);
  });

  it("sin proyección (mes cerrado) → pctProj null", () => {
    const agregar = (us: U[]) => ({ ...suma(us), proj: null });
    const r = avanceSobreCuota([{ a: 50, c: 100 }], { ...opts, agregar });
    expect(r.pct).toBe(50);
    expect(r.pctProj).toBeNull();
  });

  it("respeta la agregación de quien llama (snapshot: máximo de la serie agregada)", () => {
    type S = { serie: Record<string, number>; c: number | null };
    const agregar = (us: S[]): Agregado => {
      const tot: Record<string, number> = {};
      us.forEach(u => Object.entries(u.serie).forEach(([d, v]) => { tot[d] = (tot[d] || 0) + v; }));
      const ds = Object.keys(tot).sort();
      const metas = us.filter(u => u.c != null);
      return { actual: ds.length ? tot[ds[ds.length - 1]] : null,
               meta: metas.length ? metas.reduce((s, u) => s + (u.c || 0), 0) : null,
               proj: ds.length ? Math.max(...ds.map(d => tot[d])) * 1.4 : null };
    };
    const us: S[] = [
      { serie: { "2026-09-01": 10, "2026-09-08": 20 }, c: 25 },
      { serie: { "2026-09-01": 30, "2026-09-08": 5 }, c: null }
    ];
    const r = avanceSobreCuota(us, { declarada: u => u.c != null, conDato: u => Object.keys(u.serie).length > 0, agregar });
    expect(r.actual).toBe(25);
    expect(r.actualCuota).toBe(20);
    expect(r.pct).toBe(80);
    expect(r.projCuota).toBeCloseTo(28, 6);   // máx 20 × 1.4, solo la cuenta con cuota
    expect(r.pctProj).toBeCloseTo(112, 6);
  });

  it("cuenta el total solo con las unidades que tienen dato de este KPI", () => {
    const r = avanceSobreCuota([{ a: null, c: null }, { a: 3, c: 4 }], opts);
    expect(r.nTotal).toBe(1);
  });
});
