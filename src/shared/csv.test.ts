import { describe, it, expect } from "vitest";
import { celdaCSV, filaCSV } from "./csv";

describe("celdaCSV — RFC 4180 + fórmulas neutralizadas (I10)", () => {
  it("duplica las comillas internas y encierra el campo", () => {
    expect(celdaCSV('TAXI "EL RAPIDO"')).toBe('"TAXI ""EL RAPIDO"""');
  });
  it("comas y saltos de línea van entre comillas", () => {
    expect(celdaCSV("Lima, Perú")).toBe('"Lima, Perú"');
    expect(celdaCSV("a\nb")).toBe('"a\nb"');
  });
  it("texto que empieza con = + - @ se prefija con '", () => {
    expect(celdaCSV("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(celdaCSV("+51 999")).toBe("'+51 999");
    expect(celdaCSV("-cmd")).toBe("'-cmd");
    expect(celdaCSV("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("los números (y los textos que son números puros) no se tocan", () => {
    expect(celdaCSV(-12)).toBe("-12");
    expect(celdaCSV("-12.5")).toBe("-12.5");
    expect(celdaCSV(0)).toBe("0");
    expect(celdaCSV("900000000001")).toBe("900000000001");
  });
  it("null/undefined → vacío; una fila entera", () => {
    expect(celdaCSV(null)).toBe("");
    expect(filaCSV(["2026-06-01", 'A"B', null, 3])).toBe('2026-06-01,"A""B",,3');
  });
  it("una fila con comillas NO corre las columnas", () => {
    const fila = filaCSV(["2026-06-01", 'X "Y", Z', "Ana", "LIMA", 10]);
    // 5 campos: al parsear respetando comillas, deben ser 5.
    const campos = fila.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.filter(x => x !== "");
    expect(campos).toHaveLength(5);
  });
});
