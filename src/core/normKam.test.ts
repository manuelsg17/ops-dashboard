import { describe, it, expect } from "vitest";
import { normKamValor } from "./config";

describe("normKamValor", () => {
  it("los 'sin KAM' escritos a mano cuentan como vacío (caen al bucket No KAM)", () => {
    for (const v of ["SIN KAM", "Sin Kam", " sin kam ", "NO KAM", "no-kam", "SIN_KAM", "-", "--", "", null, undefined])
      expect(normKamValor(v)).toBe("");
  });
  it("un KAM real queda igual (solo sin espacios)", () => {
    expect(normKamValor(" Manuel ")).toBe("Manuel");
    expect(normKamValor("Sinkamil")).toBe("Sinkamil");
    expect(normKamValor("Kam")).toBe("Kam");
  });
});
