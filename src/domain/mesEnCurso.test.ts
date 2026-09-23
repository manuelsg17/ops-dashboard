import { describe, it, expect } from "vitest";
import { ymLima, esMesEnCurso } from "./mesEnCurso";

// Lima es UTC-5 todo el año (sin horario de verano).
const d = (iso: string) => new Date(iso);

describe("ymLima", () => {
  it("usa la hora de Lima, no la UTC", () => {
    // 30-sep 20:00 en Lima = 1-oct 01:00 UTC → sigue siendo septiembre en Lima.
    expect(ymLima(d("2026-10-01T01:00:00Z"))).toEqual({ y: 2026, m: 9 });
    // 1-oct 00:30 en Lima = 1-oct 05:30 UTC → octubre.
    expect(ymLima(d("2026-10-01T05:30:00Z"))).toEqual({ y: 2026, m: 10 });
  });
  it("cruce de año", () => {
    expect(ymLima(d("2027-01-01T03:00:00Z"))).toEqual({ y: 2026, m: 12 });
    expect(ymLima(d("2027-01-01T06:00:00Z"))).toEqual({ y: 2027, m: 1 });
  });
});

describe("esMesEnCurso", () => {
  const hoy = d("2026-09-23T15:00:00Z");
  it("el mes de hoy (con y sin año) está en curso", () => {
    expect(esMesEnCurso(9, 2026, hoy)).toBe(true);
    expect(esMesEnCurso(9, null, hoy)).toBe(true);
    expect(esMesEnCurso(9, undefined, hoy)).toBe(true);
  });
  it("un mes pasado ya cerró: no se proyecta", () => {
    expect(esMesEnCurso(8, 2026, hoy)).toBe(false);
    expect(esMesEnCurso(8, null, hoy)).toBe(false);
  });
  it("mismo número de mes de otro año no está en curso", () => {
    expect(esMesEnCurso(9, 2025, hoy)).toBe(false);
  });
  it("un mes futuro tampoco (todavía no empezó)", () => {
    expect(esMesEnCurso(10, 2026, hoy)).toBe(false);
  });
  it("la última tarde del mes en Lima sigue en curso aunque en UTC ya sea el siguiente", () => {
    const ultimaTarde = d("2026-10-01T02:00:00Z");   // 30-sep 21:00 Lima
    expect(esMesEnCurso(9, 2026, ultimaTarde)).toBe(true);
    expect(esMesEnCurso(10, 2026, ultimaTarde)).toBe(false);
  });
  it("mes inválido → false", () => {
    expect(esMesEnCurso(0, 2026, hoy)).toBe(false);
    expect(esMesEnCurso(13, 2026, hoy)).toBe(false);
    expect(esMesEnCurso(NaN, 2026, hoy)).toBe(false);
  });
});
