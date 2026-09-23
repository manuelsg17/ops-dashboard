import { describe, it, expect } from "vitest";
import {
  mesNumero, mesCanonico, ordenMes, anioMasCercano, limaYM,
  opcionesMesMeta, mesPorDefecto, claveMes, parseClaveMes, anioParaFilaMeta
} from "./mesesMeta";

describe("anioParaFilaMeta — uploadMetas nunca deja mes_year en NULL", () => {
  const dic = { y: 2026, m: 12 };
  it("la columna AÑO manda", () => {
    expect(anioParaFilaMeta("ENERO", 2026, dic)).toEqual({ anio: 2026, derivado: false });
    expect(anioParaFilaMeta("ENERO", "2027", dic)).toEqual({ anio: 2027, derivado: false });
  });
  it("sin AÑO (o vacío/basura): el año que se está cargando, marcado como derivado", () => {
    expect(anioParaFilaMeta("ENERO", "", dic)).toEqual({ anio: 2027, derivado: true });
    expect(anioParaFilaMeta("DICIEMBRE", undefined, dic)).toEqual({ anio: 2026, derivado: true });
    expect(anioParaFilaMeta("ENERO", "abc", dic)).toEqual({ anio: 2027, derivado: true });
  });
  it("MES en formato YYYY-MM trae su año", () => {
    expect(anioParaFilaMeta("2025-11", "", dic)).toEqual({ anio: 2025, derivado: false });
  });
  it("mes irreconocible sin año → null (se rechaza la fila)", () => {
    expect(anioParaFilaMeta("TRECE", "", dic)).toEqual({ anio: null, derivado: false });
  });
});

// Metas como las del seed local (DICIEMBRE 2025, ENERO 2026, JUN–SEP 2026).
const SEED = [
  { mes: "DICIEMBRE", mYear: 2025 }, { mes: "ENERO", mYear: 2026 },
  { mes: "JUNIO", mYear: 2026 }, { mes: "JULIO", mYear: 2026 },
  { mes: "AGOSTO", mYear: 2026 }, { mes: "SEPTIEMBRE", mYear: 2026 },
];

describe("mesNumero / mesCanonico", () => {
  it("reconoce español, 'SETIEMBRE', inglés, abreviaturas, ISO y número", () => {
    expect(mesNumero("ENERO")).toBe(1);
    expect(mesNumero(" setiembre ")).toBe(9);
    expect(mesNumero("September")).toBe(9);
    expect(mesNumero("dic")).toBe(12);
    expect(mesNumero("2027-01")).toBe(1);
    expect(mesNumero("7")).toBe(7);
    expect(mesNumero("TRECE")).toBe(0);
    expect(mesNumero("")).toBe(0);
  });
  it("canoniza al nombre que usa la app (un mes = un nombre)", () => {
    expect(mesCanonico("Setiembre")).toBe("SEPTIEMBRE");
    expect(mesCanonico("january")).toBe("ENERO");
    expect(mesCanonico("2026-06")).toBe("2026-06");
    expect(mesCanonico("raro")).toBe("RARO");
  });
});

describe("ordenMes — año*100 + mes", () => {
  it("con año, ENERO 2027 va después de DICIEMBRE 2026", () => {
    expect(ordenMes("ENERO", 2027)).toBe(202701);
    expect(ordenMes("DICIEMBRE", 2026)).toBe(202612);
    expect(ordenMes("ENERO", 2027)).toBeGreaterThan(ordenMes("DICIEMBRE", 2026));
  });
  it("el orden VIEJO (2000+mes, sin año) ponía DICIEMBRE primero — el bug", () => {
    expect(ordenMes("DICIEMBRE")).toBeGreaterThan(ordenMes("ENERO"));
  });
  it("ISO trae su propio año; irreconocible = 0", () => {
    expect(ordenMes("2025-11")).toBe(202511);
    expect(ordenMes("2025-11", 2030)).toBe(202511);
    expect(ordenMes("xx", 2026)).toBe(0);
  });
});

describe("anioMasCercano — misma regla que el backfill de la migración", () => {
  it("en diciembre, ENERO es del año siguiente", () => {
    expect(anioMasCercano(1, { y: 2026, m: 12 })).toBe(2027);
  });
  it("en enero, DICIEMBRE es del año anterior", () => {
    expect(anioMasCercano(12, { y: 2027, m: 1 })).toBe(2026);
  });
  it("el mismo mes y los vecinos quedan en el año en curso", () => {
    expect(anioMasCercano(9, { y: 2026, m: 9 })).toBe(2026);
    expect(anioMasCercano(10, { y: 2026, m: 9 })).toBe(2026);
    expect(anioMasCercano(6, { y: 2026, m: 5 })).toBe(2026);
  });
  it("empate a 6 meses → el más tardío (una meta se arma por adelantado)", () => {
    expect(anioMasCercano(1, { y: 2026, m: 7 })).toBe(2027);
  });
});

describe("limaYM — hora de Lima, no la del navegador", () => {
  it("el 1-ene 03:00 UTC todavía es diciembre en Lima", () => {
    expect(limaYM(new Date("2027-01-01T03:00:00Z"))).toEqual({ y: 2026, m: 12 });
    expect(limaYM(new Date("2027-01-01T06:00:00Z"))).toEqual({ y: 2027, m: 1 });
  });
});

describe("opcionesMesMeta", () => {
  it("una opción por (mes, año), de la más nueva a la más vieja", () => {
    const ops = opcionesMesMeta([...SEED, { mes: "ENERO", mYear: 2027 }, { mes: "SEPTIEMBRE", mYear: 2026 }]);
    expect(ops.map(o => o.clave)).toEqual([
      "ENERO|2027", "SEPTIEMBRE|2026", "AGOSTO|2026", "JULIO|2026", "JUNIO|2026",
      "ENERO|2026", "DICIEMBRE|2025"]);
  });
  it("ENERO 2026 y ENERO 2027 son opciones distintas", () => {
    const ops = opcionesMesMeta([{ mes: "ENERO", mYear: 2026 }, { mes: "ENERO", mYear: 2027 }]);
    expect(ops).toHaveLength(2);
  });
  it("una fila legacy sin año se funde con el mismo nombre con año", () => {
    const ops = opcionesMesMeta([{ mes: "JULIO", mYear: null }, { mes: "JULIO", mYear: 2026 }]);
    expect(ops.map(o => o.clave)).toEqual(["JULIO|2026"]);
    const solo = opcionesMesMeta([{ mes: "JULIO", mYear: null }]);
    expect(solo[0].anio).toBeNull();
  });
  it("clave ida y vuelta", () => {
    expect(parseClaveMes(claveMes("ENERO", 2027))).toEqual({ mes: "ENERO", anio: 2027 });
    expect(parseClaveMes(claveMes("ENERO", null))).toEqual({ mes: "ENERO", anio: null });
    expect(parseClaveMes("AGOSTO")).toEqual({ mes: "AGOSTO", anio: null });
  });
});

describe("mesPorDefecto — el último mes CON DATOS, no la meta más nueva", () => {
  it("ESCENARIO ENERO: con metas de DIC-2026 y ENE-2027 y datos de enero → ENERO 2027", () => {
    const ops = opcionesMesMeta([...SEED, { mes: "DICIEMBRE", mYear: 2026 }, { mes: "ENERO", mYear: 2027 }]);
    const d = mesPorDefecto(ops, { y: 2027, m: 1 });
    expect(d && d.clave).toBe("ENERO|2027");
  });
  it("la primera semana de enero sin datos todavía → DICIEMBRE 2026 (el último con datos)", () => {
    const ops = opcionesMesMeta([{ mes: "DICIEMBRE", mYear: 2026 }, { mes: "ENERO", mYear: 2027 }]);
    expect(mesPorDefecto(ops, { y: 2026, m: 12 })!.clave).toBe("DICIEMBRE|2026");
  });
  it("metas cargadas por adelantado (OCTUBRE) con datos hasta septiembre → SEPTIEMBRE", () => {
    const ops = opcionesMesMeta([...SEED, { mes: "OCTUBRE", mYear: 2026 }]);
    expect(mesPorDefecto(ops, { y: 2026, m: 9 })!.clave).toBe("SEPTIEMBRE|2026");
  });
  it("seed local (datos hasta julio) → JULIO, no la meta de septiembre", () => {
    expect(mesPorDefecto(opcionesMesMeta(SEED), { y: 2026, m: 7 })!.clave).toBe("JULIO|2026");
  });
  it("hueco: sin meta para el mes del dato → la anterior más reciente", () => {
    const ops = opcionesMesMeta([{ mes: "JUNIO", mYear: 2026 }, { mes: "SEPTIEMBRE", mYear: 2026 }]);
    expect(mesPorDefecto(ops, { y: 2026, m: 8 })!.clave).toBe("JUNIO|2026");
  });
  it("todas las metas son futuras → la más cercana", () => {
    const ops = opcionesMesMeta([{ mes: "NOVIEMBRE", mYear: 2026 }, { mes: "OCTUBRE", mYear: 2026 }]);
    expect(mesPorDefecto(ops, { y: 2026, m: 9 })!.clave).toBe("OCTUBRE|2026");
  });
  it("sin datos → la meta más reciente; sin metas → null", () => {
    expect(mesPorDefecto(opcionesMesMeta(SEED), null)!.clave).toBe("SEPTIEMBRE|2026");
    expect(mesPorDefecto([], { y: 2026, m: 9 })).toBeNull();
  });
});
