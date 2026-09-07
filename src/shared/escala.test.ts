import { describe, it, expect } from "vitest";
import { normEscala, sufijoEscala, claveSlice, sliceEscala, datasetLinea } from "./escala.js";

// Estos tests fijan la clase de bug MÁS CARA del proyecto: leer los datos de una
// escala y rotularlos con otra. No rompe nada visible — no hay error de consola
// ni fila faltante — así que sobrevive hasta que alguien compara a mano contra
// el portal del partner. Ya pasó tres veces.

// STATE sintético: cada slice lleva una marca que dice de dónde salió, así un
// test que falla dice QUÉ escala se leyó, no solo "esperaba 2, recibí 3".
const S = {
  curMode: "semanal",
  rawData:              [{ m: "sem/agg" }],
  rawDataTuktuk:        [{ m: "sem/tk" }],
  rawDataFleet:         [{ m: "sem/fleet" }],
  rawDataMensual:       [{ m: "men/agg" }],
  rawDataMensualTuktuk: [{ m: "men/tk" }],
  rawDataMensualFleet:  [{ m: "men/fleet" }],
  rawDataDiario:        [{ m: "dia/agg" }],
  rawDataDiarioTuktuk:  [{ m: "dia/tk" }],
  rawDataDiarioFleet:   [{ m: "dia/fleet" }]
};
const marcas = (rows: any[]) => rows.map(r => r.m);

describe("sufijo por escala", () => {
  it("mapea las TRES escalas, no dos", () => {
    expect(sufijoEscala("semanal")).toBe("");
    expect(sufijoEscala("mensual")).toBe("Mensual");
    expect(sufijoEscala("diario")).toBe("Diario");
  });

  it("un valor corrupto cae en semanal, no en undefined", () => {
    // localStorage es manipulable: curMode puede llegar con cualquier cosa.
    // Sin normalizar, claveSlice armaría "rawDataundefinedTuktuk" → [] silencioso.
    expect(normEscala(null)).toBe("semanal");
    expect(normEscala("MENSUAL")).toBe("semanal");   // case-sensitive a propósito
    expect(sufijoEscala(undefined)).toBe("");
  });

  it("arma los nombres reales de las claves de STATE", () => {
    expect(claveSlice("Tuktuk", "diario")).toBe("rawDataDiarioTuktuk");
    expect(claveSlice("Fleet", "mensual")).toBe("rawDataMensualFleet");
    expect(claveSlice("Tuktuk", "semanal")).toBe("rawDataTuktuk");
    expect(claveSlice("", "mensual")).toBe("rawDataMensual");
  });
});

describe("REGRESIÓN: diario nunca cae al slice semanal", () => {
  // El bug original: `mensual ? mensualX : semanalX` — un BOOLEANO para TRES
  // escalas. En diario el ternario daba false y devolvía el slice SEMANAL.
  it("TukTuk en diario lee diario", () => {
    expect(marcas(sliceEscala(S, "Tuktuk", "diario"))).toEqual(["dia/tk"]);
  });

  it("Fleet en diario lee diario", () => {
    expect(marcas(sliceEscala(S, "Fleet", "diario"))).toEqual(["dia/fleet"]);
  });

  it("las tres escalas dan tres resultados DISTINTOS", () => {
    // Si alguien vuelve al booleano, dos de estos tres colapsan al mismo valor.
    const vistos = ["semanal", "mensual", "diario"].map(m => marcas(sliceEscala(S, "Tuktuk", m))[0]);
    expect(new Set(vistos).size).toBe(3);
  });
});

describe("slice ausente", () => {
  it("devuelve [] y no undefined", () => {
    // Una escala sin cargar tiene que dar cero filas, no reventar en .filter().
    expect(sliceEscala({ curMode: "diario" }, "Tuktuk")).toEqual([]);
    expect(sliceEscala(null, "Tuktuk", "diario")).toEqual([]);
  });

  it("no confunde 'no cargado' con 'cero filas'", () => {
    // Ambos son [] — la distinción la hace el llamador mirando si la escala se
    // cargó, nunca este helper. Fijado acá para que nadie le agregue un null.
    expect(sliceEscala({ curMode: "diario", rawDataDiarioTuktuk: [] }, "Tuktuk")).toEqual([]);
  });
});

describe("dataset por línea de negocio", () => {
  it("usa curMode del estado cuando no se pasa escala explícita", () => {
    expect(marcas(datasetLinea({ ...S, curMode: "diario" }, "tk"))).toEqual(["dia/tk"]);
    expect(marcas(datasetLinea({ ...S, curMode: "mensual" }, "fleet"))).toEqual(["men/fleet"]);
  });

  it("Combinado = agregador ∪ TukTuk de la MISMA escala", () => {
    // El bug que esto atrapa: mezclar el agregador de una escala con el TukTuk
    // de otra. El total resultante no corresponde a ningún período real.
    const d = { ...S, curMode: "diario", rawData: S.rawDataDiario };
    expect(marcas(datasetLinea(d, "comb"))).toEqual(["dia/agg", "dia/tk"]);
  });

  it("Combinado no muta el array del agregador", () => {
    // concat() devuelve uno nuevo; un push() acá contaminaría STATE.rawData
    // para todas las demás vistas, que comparten la referencia.
    const d = { ...S, curMode: "semanal" };
    const antes = d.rawData.length;
    datasetLinea(d, "comb");
    expect(d.rawData.length).toBe(antes);
  });

  it("Fleet no incluye TukTuk", () => {
    // Fleet ⊂ Agregador (sus autos hacen Taxi); TukTuk está fuera del agregador.
    // Sumarlos sería doble conteo.
    expect(marcas(datasetLinea({ ...S, curMode: "semanal" }, "fleet"))).toEqual(["sem/fleet"]);
  });

  it("el agregador sale de rawData, que switchMode ya intercambió", () => {
    // Si esto se resolviera por sufijo se leería rawDataMensual directo y se
    // perderían los filtros que la carga aplica solo sobre rawData.
    const d = { ...S, curMode: "mensual", rawData: [{ m: "activo" }] };
    expect(marcas(datasetLinea(d, "agg"))).toEqual(["activo"]);
  });
});
