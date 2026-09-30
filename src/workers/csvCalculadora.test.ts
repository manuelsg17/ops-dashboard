// Ida y vuelta: Calculadora → CSV → Configuración → Cargas → Metas. El CSV lleva
// BOM UTF-8 y se lee como string binario (FileReader.readAsBinaryString): con
// esto "AÑO" y las columnas TukTuk/Fleet tienen que llegar intactas.
import { it, expect } from "vitest";
import * as XLSX from "xlsx";
import { leerLibro } from "./excelParse";
const CSV = "﻿CLID,PARTNER,CIUDAD,MES,AÑO,ACTIVE DRIVERS,N+R,SUPPLY HOURS,META SH/AUTO,META ACEPTACION,META UTILIZACION,META TK AD,META TK N+R,META TK SH\n\"900000000039\",\"LAS DUNAS\",\"TRUJILLO\",\"OCTUBRE\",2026,325,61,12441,,,,,,\n\"900000000002\",\"RUTA SUR\",\"LIMA\",\"OCTUBRE\",2026,3949,871,248612,,,,1372,377,\n\"900000000001\",\"ANDINA MOVILIDAD\",\"LIMA\",\"OCTUBRE\",2026,4795,1545,277698,,,85,148,45,";
it("el CSV que exporta la Calculadora se vuelve a leer en la subida de metas (ida y vuelta, 30-sep-2026)", () => {
  const bytes = new TextEncoder().encode(CSV);
  const bin = Array.from(bytes, b => String.fromCharCode(b)).join("");
  const l: any = leerLibro(XLSX as any, bin, "metas");
  expect(l.rawRows[0][4]).toBe("AÑO");
  expect(String(l.rawRows[1][0])).toBe("900000000039");
  expect(l.rawRows.length).toBe(4);
});
