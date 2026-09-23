import { describe, it, expect } from "vitest";
import { partesAlcance } from "./alcance";

const t = (k: string, o?: Record<string, unknown>) =>
  k === "alcance.kam" ? `KAM: ${o!.k}` : k === "alcance.partners" ? `${o!.n} de ${o!.total} partners` : k;
const lbl = (c: string) => c.charAt(0) + c.slice(1).toLowerCase();

describe("partesAlcance", () => {
  it("sin filtros → vacío (el título puede decir Perú)", () => {
    expect(partesAlcance({ city: "all", kam: "all", nSel: 58, nTotal: 58 }, t, lbl)).toEqual([]);
  });
  it("el caso del plan: No KAM + Lima restaurados", () => {
    expect(partesAlcance({ city: "LIMA", kam: "No KAM", nSel: 5, nTotal: 58 }, t, lbl))
      .toEqual(["Lima", "KAM: No KAM"]);
  });
  it("selección parcial sin KAM se declara", () => {
    expect(partesAlcance({ city: "all", kam: "all", nSel: 3, nTotal: 58 }, t, lbl)).toEqual(["3 de 58 partners"]);
  });
  it("selección vacía no se declara como recorte", () => {
    expect(partesAlcance({ city: "all", kam: "all", nSel: 0, nTotal: 58 }, t, lbl)).toEqual([]);
  });
});
