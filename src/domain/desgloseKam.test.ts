import { describe, it, expect } from "vitest";
import { particionarPorKam, ordenarKams } from "./desgloseKam";

const SIN = "No KAM";

describe("particionarPorKam", () => {
  const filas = [
    { p: "A", kam: "Ana", ad: 10 },
    { p: "B", kam: "Beto", ad: 5 },
    { p: "C", kam: SIN, ad: 3 },   // huérfano: antes no caía en ningún grupo
    { p: "D", kam: "Ana", ad: 2 }
  ];
  it("las partes suman el total (el invariante que rompía B4)", () => {
    const g = particionarPorKam(filas, r => r.kam);
    const suma = [...g.values()].flat().reduce((s, r) => s + r.ad, 0);
    expect(suma).toBe(filas.reduce((s, r) => s + r.ad, 0));
    expect(g.get(SIN)!.map(r => r.p)).toEqual(["C"]);
    expect(g.get("Ana")!.length).toBe(2);
  });
  it("vacío → mapa vacío", () => {
    expect(particionarPorKam([], (r: any) => r.kam).size).toBe(0);
  });
});

describe("ordenarKams", () => {
  it("alfabético con No KAM al final", () => {
    expect(ordenarKams([SIN, "Carla", "Ana", "Ana"], SIN)).toEqual(["Ana", "Carla", SIN]);
  });
  it("descarta vacíos (el '' de KAM_MAP)", () => {
    expect(ordenarKams(["", "Beto", "  "], SIN)).toEqual(["Beto"]);
  });
});
