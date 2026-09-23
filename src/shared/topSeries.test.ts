import { describe, it, expect } from "vitest";
import { topNMasOtros } from "./topSeries";

const dates = ["d1", "d2", "d3"];
// partner Pi tiene valor i en cada fecha; su AD del último período = i
const partners = Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
const valor = (p: string, d: string) => +p.slice(1) * (d === "d3" ? 2 : 1);
const peso = (p: string) => valor(p, "d3");

describe("topNMasOtros", () => {
  it("con pocos partners dibuja todos, sin 'Otros'", () => {
    const r = topNMasOtros(partners.slice(0, 9), dates, valor, peso, 8);
    expect(r.series).toHaveLength(9);
    expect(r.resto).toBe(0);
    expect(r.series.some(s => s.otros)).toBe(false);
  });

  it("top 8 por el peso del último período + 'Otros' con la suma exacta del resto", () => {
    const r = topNMasOtros(partners, dates, valor, peso, 8);
    expect(r.series).toHaveLength(9);
    expect(r.top).toEqual(["P12", "P11", "P10", "P9", "P8", "P7", "P6", "P5"]);
    expect(r.resto).toBe(4);
    const otros = r.series[8];
    expect(otros.otros).toBe(true);
    expect(otros.data).toEqual([1 + 2 + 3 + 4, 10, 20]);
  });

  it("no cambia el total por fecha (Otros = exactamente lo que dejó de dibujarse)", () => {
    const r = topNMasOtros(partners, dates, valor, peso, 8);
    dates.forEach((d, i) => {
      const total = partners.reduce((s, p) => s + valor(p, d), 0);
      expect(r.series.reduce((s, x) => s + x.data[i], 0)).toBe(total);
    });
  });

  it("orden determinístico ante empates (por nombre)", () => {
    const r = topNMasOtros(["B", "A", "C", "D"], ["x"], () => 1, () => 5, 2);
    expect(r.top).toEqual(["A", "B"]);
  });

  it("valores faltantes cuentan 0", () => {
    const r = topNMasOtros(["A"], ["x", "y"], (_p, d) => (d === "x" ? NaN : 3), () => 1, 8);
    expect(r.series[0].data).toEqual([0, 3]);
  });
});
