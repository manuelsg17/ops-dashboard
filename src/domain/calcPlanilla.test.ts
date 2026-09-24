import { describe, it, expect } from "vitest";
import { ATAJOS_META, metaAtajo, variacionPct, textoVariacion, estadoCelda, soltarCeldas, ordenarUnidades } from "./calcPlanilla";

describe("metaAtajo", () => {
  it("base × factor redondeado al entero (Math.round, como _calcGoalFor)", () => {
    expect(metaAtajo(8483, 1.05)).toBe(8907);        // 8907.15
    expect(metaAtajo(8483, 1.10)).toBe(9331);        // 9331.3
    expect(metaAtajo(8483, 1.15)).toBe(9755);        // 9755.45
    expect(metaAtajo(418124.4, 1)).toBe(418124);     // "Igual que {mes}" redondea la base de horas
    expect(metaAtajo(1443, 1.10)).toBe(1587);        // 1587.3
  });
  it("los atajos van en el orden de la pantalla", () => {
    expect(ATAJOS_META).toEqual([1.05, 1.10, 1.15, 1]);
  });
  it("base 0 da 0 y valores inválidos dan null (no se toca la meta)", () => {
    expect(metaAtajo(0, 1.1)).toBe(0);
    expect(metaAtajo(NaN, 1.1)).toBeNull();
    expect(metaAtajo(-5, 1.1)).toBeNull();
    expect(metaAtajo(100, NaN)).toBeNull();
  });
});

describe("variacionPct / textoVariacion", () => {
  it("(meta − base) / base", () => {
    expect(variacionPct(10000, 8483)).toBeCloseTo(17.883, 3);
    expect(textoVariacion(variacionPct(10000, 8483))).toBe("+17.9%");
    expect(textoVariacion(variacionPct(900, 1000))).toBe("−10.0%");
  });
  it("sin base o sin meta no hay variación (no es un −100%)", () => {
    expect(variacionPct(0, 1000)).toBeNull();
    expect(variacionPct(1000, 0)).toBeNull();
    expect(textoVariacion(null)).toBe("");
  });
  it("una variación que redondea a cero no lleva signo menos", () => {
    expect(textoVariacion(-0.01)).toBe("+0.0%");
  });
});

describe("estadoCelda", () => {
  it("sin edit = sigue el reparto", () => {
    expect(estadoCelda(undefined, undefined)).toEqual({ fijada: false, sobrescribe: false });
    expect(estadoCelda("", 50)).toEqual({ fijada: false, sobrescribe: false });
  });
  it("igual a lo guardado = viene de la base, no está fijada", () => {
    expect(estadoCelda(120, 120)).toEqual({ fijada: false, sobrescribe: false });
    expect(estadoCelda("120", 120)).toEqual({ fijada: false, sobrescribe: false });
  });
  it("tecleada sin nada guardado = fijada, no pisa nada", () => {
    expect(estadoCelda(300, undefined)).toEqual({ fijada: true, sobrescribe: false });
  });
  it("tecleada distinta de lo guardado = fijada y sobrescribe", () => {
    expect(estadoCelda(300, 250)).toEqual({ fijada: true, sobrescribe: true });
    expect(estadoCelda(0, 250)).toEqual({ fijada: true, sobrescribe: true });   // un 0 tecleado es un valor
  });
});

describe("soltarCeldas", () => {
  const k = (m: string) => `P|||LIMA|||${m}`;
  it("vuelve al guardado si lo hay, o quita el edit", () => {
    const edits = { [k("ad")]: 300, [k("sh")]: 9000, [k("nr")]: 40, "Q|||LIMA|||ad": 7 };
    const saved = { [k("ad")]: 250 };
    const out = soltarCeldas(edits, saved, [k("ad"), k("sh"), k("nr")]);
    expect(out).toEqual({ [k("ad")]: 250, "Q|||LIMA|||ad": 7 });
  });
  it("no muta el objeto recibido", () => {
    const edits = { [k("ad")]: 300 };
    soltarCeldas(edits, {}, [k("ad")]);
    expect(edits).toEqual({ [k("ad")]: 300 });
  });
});

describe("ordenarUnidades", () => {
  it("de mayor a menor AD; empate alfabético por partner y ciudad", () => {
    const u = [
      { partner: "B", city: "LIMA", ad: 10 },
      { partner: "A", city: "TRUJILLO", ad: 50 },
      { partner: "A", city: "AREQUIPA", ad: 10 },
      { partner: "C", city: "LIMA", ad: 50 }
    ];
    expect(ordenarUnidades(u).map(x => `${x.partner}@${x.city}`))
      .toEqual(["A@TRUJILLO", "C@LIMA", "A@AREQUIPA", "B@LIMA"]);
    expect(u[0].partner).toBe("B");   // no muta
  });
});
