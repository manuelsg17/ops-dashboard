import { describe, it, expect } from "vitest";
import { filtroMetasDeMes } from "./borrarDatos";

describe("filtroMetasDeMes — 'YYYY-MM' → nombre + año (B3)", () => {
  it("2026-06 → JUNIO de 2026 (antes filtraba mes='2026-06' y no borraba nada)", () => {
    const f = filtroMetasDeMes("2026-06")!;
    expect(f.anio).toBe(2026);
    expect(f.nombres).toContain("JUNIO");
    expect(f.nombres).not.toContain("JULIO");
    expect(f.orPostgrest).toBe("mes.ilike.JUNIO,mes.ilike.2026-06");
  });
  it("septiembre incluye el alias SETIEMBRE", () => {
    expect(filtroMetasDeMes("2026-09")!.nombres).toEqual(["SEPTIEMBRE", "SETIEMBRE", "2026-09"]);
  });
  it("enero de un año no es enero de otro: el año viaja aparte", () => {
    expect(filtroMetasDeMes("2027-01")!.anio).toBe(2027);
  });
  it("formato inválido → null", () => {
    expect(filtroMetasDeMes("JUNIO")).toBeNull();
    expect(filtroMetasDeMes("2026-13")).toBeNull();
    expect(filtroMetasDeMes("")).toBeNull();
  });
});
