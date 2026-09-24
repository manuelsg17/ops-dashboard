import { describe, it, expect } from "vitest";
import { absolutoTk, sumaPorcionesTk } from "./tkResumen";

describe("absolutoTk — el número que se declara en el Loyalty Program", () => {
  it("meta × % redondeado (caso de Ana: 10.000 / 600.000 / 2.500 con 17 / 20,2 / 15,6)", () => {
    expect(absolutoTk(10000, 17)).toBe(1700);
    expect(absolutoTk(600000, 20.2)).toBe(121200);
    expect(absolutoTk(2500, 15.6)).toBe(390);
  });
  it("sin % o sin meta no hay cifra (null, no 0)", () => {
    expect(absolutoTk(10000, 0)).toBeNull();
    expect(absolutoTk(0, 17)).toBeNull();
    expect(absolutoTk(undefined, 17)).toBeNull();
    expect(absolutoTk(10000, "")).toBeNull();
  });
});

describe("sumaPorcionesTk — total del cuadre = suma de las sub-líneas de la tabla", () => {
  it("redondea fila por fila (puede diferir en ±n del absoluto declarado)", () => {
    // Total exacto 1.700, pero la tabla muestra 127 + 1.173 + 401 = 1.701.
    const bases = [{ adTk: 126.6 }, { adTk: 1172.6 }, { adTk: 400.8 }];
    expect(sumaPorcionesTk(bases).ad).toBe(1701);
  });
  it("ignora filas sin porción (la tabla no las muestra)", () => {
    expect(sumaPorcionesTk([{ adTk: 0, shTk: 10.4, nrTk: -1 }, {}])).toEqual({ ad: 0, sh: 10, nr: 0 });
  });
});
