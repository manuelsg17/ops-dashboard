import { describe, it, expect } from "vitest";
import {
  armarFilasPartners, esPendiente, kamsCanonicos, kamDuplicado,
  clasifSubflota, patchMaterializar, type MapasClasif
} from "./partnersMaestro";

describe("armarFilasPartners", () => {
  const partners = {
    "1": { partner: "ANDINA", kam: "Ana", isFleet: true },
    "2": { partner: "SIN KAM SA", kam: "" },
    "3": { partner: "3", kam: "Beto" }                 // nombre = CLID
  };
  const flotas = {
    "4": { nombre_asignado: "NORTE SEGURO", kam: "", ciudad: "TRUJILLO" },
    "5": { nombre_asignado: "5", kam: "Carla", ciudad: "LIMA" }   // dato sucio: nombre = CLID
  };
  const datos = [
    { clid: "1", partnerExcel: "Andina Excel", kam: "Ana", city: "LIMA", dbId: "db-a" },
    { clid: "1", partnerExcel: "Andina Excel", kam: "Ana", city: "AREQUIPA" },
    { clid: "4", partnerExcel: "Norte Excel", kam: "Dario", city: "TRUJILLO" },
    { clid: "5", partnerExcel: "Flota Cinco", kam: "", city: "LIMA" },
    { clid: "6", partnerExcel: "SOLO DATOS", kam: "Elena", city: "LIMA" },
    { clid: "6", partnerExcel: "SOLO DATOS", kam: "Elena", city: "AREQUIPA" },
    { clid: "6", partnerExcel: "SOLO DATOS", kam: "Elena", city: "LIMA" }
  ];
  const filas = armarFilasPartners(partners, flotas, datos);
  const f = (c: string) => filas.find(x => x.clid === c)!;

  it("incluye a todos los CLIDs: partners ∪ flotas ∪ datos", () => {
    expect(filas.map(x => x.clid).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(f("1").alta).toBe(true);
    expect(f("4").alta).toBe(false);
    expect(f("6").alta).toBe(false);
  });

  it("nombre efectivo: partners > flotas > Excel", () => {
    expect(f("1")).toMatchObject({ nombre: "ANDINA", nombreFuente: "partners" });
    expect(f("4")).toMatchObject({ nombre: "NORTE SEGURO", nombreFuente: "flotas" });
    expect(f("6")).toMatchObject({ nombre: "SOLO DATOS", nombreFuente: "excel" });
  });

  it("KAM: con fila en partners manda aunque esté vacío; sin fila cae a flotas y luego al Excel", () => {
    expect(f("2")).toMatchObject({ kam: "", kamFuente: "ninguna" });
    expect(f("4")).toMatchObject({ kam: "Dario", kamFuente: "excel" });   // flotas.kam vacío
    expect(f("5")).toMatchObject({ kam: "Carla", kamFuente: "flotas" });
  });

  it("pendientes: sin alta, sin KAM, nombre = CLID", () => {
    expect(f("1").pendiente).toEqual({ sinAlta: false, sinKam: false, nombreEsClid: false });
    expect(esPendiente(f("1"))).toBe(false);
    expect(f("2").pendiente.sinKam).toBe(true);
    expect(f("3").pendiente.nombreEsClid).toBe(true);
    expect(f("5").pendiente).toEqual({ sinAlta: true, sinKam: false, nombreEsClid: true });
  });

  it("sugerencias para dar de alta: nunca el CLID como nombre; ciudad de flotas o la más frecuente", () => {
    expect(f("5").sugerido).toEqual({ nombre: "Flota Cinco", kam: "Carla", ciudad: "LIMA" });
    expect(f("6").sugerido).toEqual({ nombre: "SOLO DATOS", kam: "Elena", ciudad: "LIMA" });
    expect(f("4").sugerido.ciudad).toBe("TRUJILLO");
  });

  it("marca si el CLID tiene sub-flotas y sus ciudades", () => {
    expect(f("1").tieneSubflotas).toBe(true);
    expect(f("6").tieneSubflotas).toBe(false);
    expect(f("1").ciudades).toEqual(["AREQUIPA", "LIMA"]);
    expect(f("1").isFleet).toBe(true);
  });
});

describe("KAMs canónicos", () => {
  it("unión sin vacíos ni espacios, ordenada", () => {
    expect(kamsCanonicos(["Ana", " Beto ", ""], ["Beto", "Carla", null])).toEqual(["Ana", "Beto", "Carla"]);
  });
  it("detecta un duplicado por mayúsculas, tildes o espacios", () => {
    expect(kamDuplicado("manuel", ["Manuel", "Ana"])).toBe("Manuel");
    expect(kamDuplicado("  matias ", ["Matías"])).toBe("Matías");
    expect(kamDuplicado("Ana  Maria", ["Ana Maria"])).toBe("Ana Maria");
  });
  it("coincidencia exacta o nombre nuevo de verdad → null", () => {
    expect(kamDuplicado("Manuel", ["manuel", "Manuel"])).toBeNull();
    expect(kamDuplicado("Rodolfo", ["Manuel"])).toBeNull();
    expect(kamDuplicado("", ["Manuel"])).toBeNull();
  });
});

describe("clasifSubflota — misma precedencia que los predicados de data.ts", () => {
  const M: MapasClasif = {
    FLEETROOM_IS_FLEET:     { "db-x": false, "db-c": false },
    FLEETROOM_IS_TUKTUK:    { "db-x": true,  "db-c": false },
    FLEETROOM_EXCLUDE_TAXI: { "db-x": false, "db-c": false },
    FLEETROOM_IS_DELIVERY:  { "db-x": false, "db-c": false },
    FLEETROOM_IS_CARGO:     { "db-x": false, "db-c": true },
    CLID_IS_FLEET:  { A: true },
    CLID_IS_TUKTUK: { B: true }
  };

  it("sin fila en fleetrooms hereda Fleet/TukTuk del CLID", () => {
    expect(clasifSubflota("db-n", "A", M)).toMatchObject({ explicito: false, fleet: true, tuktuk: false, cuentaEnTaxi: true, linea: "taxi" });
    expect(clasifSubflota("db-n", "B", M)).toMatchObject({ explicito: false, tuktuk: true, cuentaEnTaxi: false, linea: "tuktuk" });
  });
  it("con fila explícita manda la sub-flota, no el CLID", () => {
    expect(clasifSubflota("db-x", "A", M)).toMatchObject({ explicito: true, fleet: false, tuktuk: true, cuentaEnTaxi: false });
    expect(clasifSubflota("db-c", "B", M)).toMatchObject({ explicito: true, tuktuk: false, cargo: true, cuentaEnTaxi: false, linea: "cargo" });
  });
  it("db_id vacío (legacy) usa el CLID", () => {
    expect(clasifSubflota("", "B", M)).toMatchObject({ explicito: false, tuktuk: true, cuentaEnTaxi: false });
  });
});

describe("patchMaterializar", () => {
  const M: MapasClasif = { CLID_IS_TUKTUK: { B: true }, CLID_IS_FLEET: { B: true } };
  it("al crear la fila conserva lo heredado (no vuelve Taxi a una sub-flota TukTuk)", () => {
    const c = clasifSubflota("db-n", "B", M);
    expect(patchMaterializar(c, "is_fleet", false)).toEqual({
      is_fleet: false, is_tuktuk: true, exclude_from_taxi: false, is_delivery: false, is_cargo: false
    });
  });
  it("Delivery y Cargo son excluyentes al tildar, no al destildar", () => {
    const c = { ...clasifSubflota("db-n", "B", M), delivery: true };
    expect(patchMaterializar(c, "is_cargo", true)).toMatchObject({ is_cargo: true, is_delivery: false });
    const d = { ...c, cargo: true };
    expect(patchMaterializar(d, "is_cargo", false)).toMatchObject({ is_cargo: false, is_delivery: true });
  });
});
