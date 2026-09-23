import { describe, it, expect } from "vitest";
import { chipsAlcance, hayRecorte, seleccionImplicita, type FotoAlcance } from "./chipsAlcance";

const UNI = ["A", "B", "C", "D"];
const base = (o: Partial<FotoAlcance> = {}): FotoAlcance => ({
  claves: ["escala", "rango", "ciudad", "kam", "linea", "partners"],
  escala: "semanal", desde: "2026-07-27", hasta: "2026-09-07",
  desdeDef: "2026-07-27", hastaDef: "2026-09-07",
  ciudad: "all", kam: "all", linea: "comb",
  seleccion: UNI.slice(), universo: UNI.slice(), deKam: null,
  ...o
});
const ks = (f: FotoAlcance) => chipsAlcance(f).map(c => `${c.k}${c.quitable ? "×" : ""}`);

describe("chipsAlcance", () => {
  it("todo en default: escala y rango informativos, nada que restablecer", () => {
    const c = chipsAlcance(base());
    expect(ks(base())).toEqual(["escala", "rango"]);
    expect(hayRecorte(c)).toBe(false);
  });

  it("escala y rango fuera de default se pueden quitar", () => {
    expect(ks(base({ escala: "mensual" }))).toEqual(["escala×", "rango"]);
    expect(ks(base({ desde: "2026-08-03" }))).toEqual(["escala", "rango×"]);
    expect(hayRecorte(chipsAlcance(base({ hasta: "2026-08-31" })))).toBe(true);
  });

  it("ciudad, KAM y línea aparecen solo si filtran", () => {
    expect(ks(base({ ciudad: "LIMA" }))).toEqual(["escala", "rango", "ciudad×"]);
    expect(ks(base({ linea: "tk" }))).toEqual(["escala", "rango", "linea×"]);
    expect(ks(base({ linea: null }))).toEqual(["escala", "rango"]);
  });

  it("KAM con sus partners tildados: sin chip de partners (no repite el KAM)", () => {
    const f = base({ kam: "Ana", deKam: ["A", "B", "Z"], seleccion: ["A", "B"] });
    expect(ks(f)).toEqual(["escala", "rango", "kam×"]);
  });

  it("selección parcial sin KAM: chip de partners con n de total", () => {
    const c = chipsAlcance(base({ seleccion: ["A", "C"] }));
    const p = c.find(x => x.k === "partners");
    expect(p).toEqual({ k: "partners", quitable: true, n: 2, total: 4 });
  });

  it("KAM elegido pero la selección se tocó a mano: aparece partners", () => {
    const f = base({ kam: "Ana", deKam: ["A", "B"], seleccion: ["A"] });
    expect(ks(f)).toEqual(["escala", "rango", "kam×", "partners×"]);
  });

  it("partners tildados fuera de la lista no cuentan (lista virtualizada/filtrada)", () => {
    const f = base({ seleccion: [...UNI, "X"] });
    expect(ks(f)).toEqual(["escala", "rango"]);
  });

  it("ninguno tildado es un recorte (0 de N)", () => {
    const p = chipsAlcance(base({ seleccion: [] })).find(x => x.k === "partners");
    expect(p?.n).toBe(0);
    expect(p?.total).toBe(4);
  });

  it("respeta las claves de la vista (Vista partner: solo escala)", () => {
    expect(ks(base({ claves: ["escala"], ciudad: "LIMA", escala: "diario" }))).toEqual(["escala×"]);
  });

  it("sin rango cargado todavía no inventa un chip", () => {
    expect(ks(base({ desde: "", hasta: "" }))).toEqual(["escala"]);
  });

  it("seleccionImplicita: KAM ∩ lista", () => {
    expect([...seleccionImplicita({ kam: "Ana", universo: UNI, deKam: new Set(["B", "Q"]) })]).toEqual(["B"]);
    expect(seleccionImplicita({ kam: "all", universo: UNI, deKam: null }).size).toBe(4);
  });
});
