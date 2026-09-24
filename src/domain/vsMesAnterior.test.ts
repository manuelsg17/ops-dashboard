import { describe, it, expect } from "vitest";
import { variacionPct, mesAnterior, fechasMesAnteriorCompleto, mesEnFrase } from "./vsMesAnterior";

// Mes de reporte simple por prefijo (escala mensual/diaria).
const ymPrefijo = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) });

describe("variacionPct", () => {
  it("(actual − previo) / previo", () => {
    expect(variacionPct(110, 100)).toBeCloseTo(10, 10);
    expect(variacionPct(74, 100)).toBeCloseTo(-26, 10);
  });
  it("sin base (0) o sin dato → null", () => {
    expect(variacionPct(5, 0)).toBeNull();
    expect(variacionPct(null, 10)).toBeNull();
    expect(variacionPct(10, undefined)).toBeNull();
    expect(variacionPct(NaN, 10)).toBeNull();
  });
});

describe("mesAnterior", () => {
  it("cruza el año en enero", () => {
    expect(mesAnterior(2027, 1)).toEqual({ y: 2026, m: 12 });
    expect(mesAnterior(2026, 9)).toEqual({ y: 2026, m: 8 });
  });
});

describe("fechasMesAnteriorCompleto", () => {
  const todas = ["2026-07-28", "2026-08-01", "2026-08-15", "2026-08-31", "2026-09-01", "2026-09-10"];
  it("TODOS los períodos del mes anterior, no 'al mismo punto'", () => {
    const r = fechasMesAnteriorCompleto(["2026-09-01"], todas, ymPrefijo, "2026-07-28");
    expect(r).toEqual({ fechas: ["2026-08-01", "2026-08-15", "2026-08-31"], y: 2026, m: 8 });
  });
  it("el mes anterior arrancó antes de lo cargado → null (no comparar contra un mes a medias)", () => {
    expect(fechasMesAnteriorCompleto(["2026-09-01"], todas, ymPrefijo, "2026-08-15")).toBeNull();
  });
  it("sin mes anterior en los datos, o sin nada cargado → null", () => {
    expect(fechasMesAnteriorCompleto(["2026-08-01"], ["2026-08-01"], ymPrefijo, "2026-08-01")).toBeNull();
    expect(fechasMesAnteriorCompleto(["2026-09-01"], todas, ymPrefijo, "")).toBeNull();
    expect(fechasMesAnteriorCompleto([], todas, ymPrefijo, "2026-07-01")).toBeNull();
  });
  it("usa el mes de REPORTE de la escala (semanal: la semana del 31-ago reporta en septiembre)", () => {
    const ymSemana = (d: string) => d === "2026-08-31" ? { y: 2026, m: 9 } : ymPrefijo(d);
    const r = fechasMesAnteriorCompleto(["2026-08-31", "2026-09-07"], ["2026-08-03", "2026-08-24", "2026-08-31", "2026-09-07"], ymSemana, "2026-08-03");
    expect(r && r.fechas).toEqual(["2026-08-03", "2026-08-24"]);
  });
  it("enero compara contra diciembre del año anterior", () => {
    const r = fechasMesAnteriorCompleto(["2027-01-01"], ["2026-12-01", "2027-01-01"], ymPrefijo, "2026-12-01");
    expect(r).toEqual({ fechas: ["2026-12-01"], y: 2026, m: 12 });
  });
});

describe("mesEnFrase", () => {
  it("nombre del mes dentro de una frase en cada idioma", () => {
    expect(mesEnFrase(8, "es")).toBe("agosto");
    expect(mesEnFrase(8, "en")).toBe("August");
    expect(mesEnFrase(8, "ru")).toMatch(/^август/);
  });
});
