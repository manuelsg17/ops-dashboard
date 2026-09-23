import { describe, it, expect, beforeAll } from "vitest";
import * as XLSX from "xlsx";
import { writeFileSync, readFileSync } from "node:fs";
import { elegirHoja, hojaCanales, filasComoObjetos, leerLibro } from "./excelParse";

// Libros SINTÉTICOS (CLIDs falsos 9000000000xx) escritos a /tmp y leídos de
// vuelta como string binario — el mismo formato que FileReader.readAsBinaryString
// le pasa al Worker. Así se ejercita el camino real del Worker (leerLibro), no
// una imitación.
const CONV = "/tmp/b2_conversion_sintetica.xlsx";
const METAS = "/tmp/b2_metas_sintetica.xlsx";

function escribir(path: string, hojas: Array<[string, unknown[][]]>) {
  const wb = XLSX.utils.book_new();
  for (const [nombre, aoa] of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombre);
  writeFileSync(path, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
const binario = (path: string) => readFileSync(path).toString("binary");

beforeAll(() => {
  escribir(CONV, [
    ["Conversion", [
      ["CLID", "MAIN PARTNER", "01 first_order", "02 n5_success"],
      ["900000000001", "FLOTA UNO", 55.5, 40.1],
      ["900000000002", "FLOTA DOS", 61.2, 44.9],
    ]],
    ["Adquisition by channel", [
      ["CLID", "MAIN PARTNER", "Agency Scouts", "Organic Partner", "Organic Scouts", "Organic Yango",
       "Paid Yango", "Partner Scouts", "Referral Partner", "Referral Yango", "Suma total"],
      ["900000000001", "FLOTA UNO", 3, 10, 0, 7, 2, 1, 4, 5, 32],
      ["900000000002", "FLOTA DOS", 0, 8, 1, 2, 0, 0, 3, 1, 15],
    ]],
  ]);
  escribir(METAS, [
    ["Instrucciones", [["Llenar la hoja METAS"]]],
    ["Metas", [
      ["CLID", "PARTNER", "CIUDAD", "MES", "AÑO", "ACTIVE DRIVERS", "N+R", "SUPPLY HOURS"],
      ["900000000001", "FLOTA UNO", "Lima", "ENERO", 2027, 120, 30, 5000],
    ]],
  ]);
});

describe("leerLibro — Conversión con 2 pestañas (B2)", () => {
  it("lee la pestaña Conversión Y la de canales", () => {
    const l = leerLibro(XLSX as any, binario(CONV), "conversion");
    expect(l.sheetName).toBe("Conversion");
    expect(l.canales && l.canales.sheetName).toBe("Adquisition by channel");
    const funnel = filasComoObjetos(l.rawRows);
    expect(funnel).toHaveLength(2);
    expect(funnel[0]["01 first_order"]).toBe(55.5);
    const canales = filasComoObjetos(l.canales!.rawRows);
    expect(canales).toHaveLength(2);
    expect(canales[0]["CLID"]).toBe("900000000001");
    expect(canales[0]["Agency Scouts"]).toBe(3);
    expect(canales[1]["Referral Partner"]).toBe(3);
    // Los headers que uploadChannels busca (por inclusión, en minúsculas):
    const hdrs = Object.keys(canales[0]).map(h => h.toLowerCase());
    for (const aguja of ["agency scouts", "organic partner", "organic scouts", "organic yango",
      "paid yango", "partner scouts", "referral partner", "referral yango"]) {
      expect(hdrs.some(h => h.includes(aguja))).toBe(true);
    }
  });
  it("sin pestaña de canales → canales null (no rompe)", () => {
    const p = "/tmp/b2_conversion_sola.xlsx";
    escribir(p, [["Conversion", [["CLID", "01 first_order"], ["900000000003", 50]]]]);
    const l = leerLibro(XLSX as any, binario(p), "conversion");
    expect(l.canales).toBeNull();
  });
  it("otros tipos no leen canales", () => {
    const l = leerLibro(XLSX as any, binario(CONV), "rendimiento");
    expect(l.canales).toBeUndefined();
  });
});

describe("leerLibro — Metas busca la hoja por NOMBRE (B2)", () => {
  it("elige 'Metas' aunque no sea la primera pestaña", () => {
    const l = leerLibro(XLSX as any, binario(METAS), "metas");
    expect(l.sheetName).toBe("Metas");
    const filas = filasComoObjetos(l.rawRows);
    expect(filas[0]["MES"]).toBe("ENERO");
    expect(filas[0]["AÑO"]).toBe(2027);
  });
});

describe("elegirHoja / hojaCanales", () => {
  it("cae a la primera hoja si no encuentra el nombre", () => {
    expect(elegirHoja(["Hoja1", "Otra"], "metas")).toBe("Hoja1");
    expect(elegirHoja(["X", "DATA"], "data")).toBe("DATA");
    expect(elegirHoja(["DATA", "Datos"], "data")).toBe("Datos");
    expect(elegirHoja(["Resumen", "RENDIMIENTO"], "rendimientoMensual")).toBe("RENDIMIENTO");
  });
  it("reconoce la pestaña de canales en es/en", () => {
    expect(hojaCanales(["Conversion", "Adquisition by channel"])).toBe("Adquisition by channel");
    expect(hojaCanales(["Conversión", "Canales"])).toBe("Canales");
    expect(hojaCanales(["Conversion"])).toBeNull();
  });
  it("filasComoObjetos: header vacío se ignora, celda faltante = ''", () => {
    expect(filasComoObjetos([["A", "", "C"], [1, 2]])).toEqual([{ A: 1, C: "" }]);
  });
});
