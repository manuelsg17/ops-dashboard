import { describe, it, expect } from "vitest";
import { MES_NOMBRES, mesNombre, mesIndice } from "./meses";
import { MES_NOMBRES as MES_REPORTE } from "../shared/mesReporte";
import { MESES_ES, mesCanonico } from "../domain/mesesMeta";

describe("core/meses — la tabla única", () => {
  it("las claves de BD son las de siempre: español, mayúsculas, SEPTIEMBRE (no SETIEMBRE)", () => {
    expect(MES_NOMBRES).toEqual(["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
      "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"]);
  });

  it("las demás tablas de claves SON esta misma (no copias que puedan divergir)", () => {
    expect(MES_REPORTE).toBe(MES_NOMBRES);
    expect(MESES_ES).toBe(MES_NOMBRES);
    expect(mesCanonico("setiembre")).toBe("SEPTIEMBRE");
  });

  it("mesNombre: largo y corto en los tres idiomas", () => {
    expect(mesNombre(0, "es")).toBe("Enero");
    expect(mesNombre(8, "en")).toBe("September");
    expect(mesNombre(11, "ru")).toBe("Декабрь");
    expect(mesNombre(7, "es", { corto: true })).toBe("Ago");
    expect(mesNombre(7, "en", { corto: true })).toBe("Aug");
    expect(mesNombre(4, "ru", { corto: true })).toBe("Май");
    for (const l of ["es", "en", "ru"])
      for (let i = 0; i < 12; i++) {
        expect(mesNombre(i, l)).toBeTruthy();
        expect(mesNombre(i, l, { corto: true })).toBeTruthy();
      }
  });

  it("idioma desconocido → español; índice fuera de rango → vacío", () => {
    expect(mesNombre(6, "fr")).toBe("Julio");
    expect(mesNombre(12, "es")).toBe("");
    expect(mesNombre(-1, "es")).toBe("");
    expect(mesNombre(1.5, "es")).toBe("");
  });

  it("mesIndice acepta la clave con cualquier caja/espacios; lo demás es -1", () => {
    expect(mesIndice("JULIO")).toBe(6);
    expect(mesIndice(" julio ")).toBe(6);
    expect(mesIndice("2026-07")).toBe(-1);
    expect(mesIndice(null)).toBe(-1);
  });
});
