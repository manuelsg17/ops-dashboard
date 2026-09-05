import { describe, it, expect } from "vitest";
import { reportYM, diasMesReporte } from "./mesReporte";
import { parseLocalDate } from "../core/dates";

const dias = (d: string, modo: string) => diasMesReporte(d, modo, parseLocalDate);

describe("reportYM", () => {
  it("semanal: la semana pertenece al mes de su jueves", () => {
    expect(reportYM("2026-06-29", "semanal", parseLocalDate)).toEqual({ y: 2026, m: 7 });
    expect(reportYM("2026-07-27", "semanal", parseLocalDate)).toEqual({ y: 2026, m: 7 });
    expect(reportYM("2025-12-29", "semanal", parseLocalDate)).toEqual({ y: 2026, m: 1 });
  });
  it("mensual/diario: el mes de la fecha misma", () => {
    expect(reportYM("2026-07-01", "mensual", parseLocalDate)).toEqual({ y: 2026, m: 7 });
    expect(reportYM("2026-06-29", "diario", parseLocalDate)).toEqual({ y: 2026, m: 6 });
  });
});

describe("diasMesReporte", () => {
  // El caso que motivó la función: la semana del Lun 29-jun reporta en JULIO.
  // Con el mes calendario daba "30 de 30 · mes cerrado" (junio) bajo la meta de
  // julio, con la marca de calendario clavada al 100%.
  it("semanal cruzando de mes: cuenta contra el mes de reporte, no el calendario", () => {
    expect(dias("2026-06-29", "semanal")).toEqual({ daysElapsed: 5, daysRemaining: 26, daysInMonth: 31 });
  });
  it("semanal cruzando de año", () => {
    // Lun 29-dic-2025 → jueves 1-ene-2026 → reporta en ENERO; cierra el dom 4-ene.
    expect(dias("2025-12-29", "semanal")).toEqual({ daysElapsed: 4, daysRemaining: 27, daysInMonth: 31 });
  });
  it("semanal que cierra después de su mes de reporte: mes completo", () => {
    // Lun 27-jul → jueves 30-jul (JULIO), cierra el dom 2-ago → julio ya está entero.
    expect(dias("2026-07-27", "semanal")).toEqual({ daysElapsed: 31, daysRemaining: 0, daysInMonth: 31 });
  });
  it("semanal dentro del mismo mes: día de cierre de la semana", () => {
    expect(dias("2026-07-06", "semanal")).toEqual({ daysElapsed: 12, daysRemaining: 19, daysInMonth: 31 });
  });
  it("mensual: el período ES el mes cerrado", () => {
    expect(dias("2026-06-01", "mensual")).toEqual({ daysElapsed: 30, daysRemaining: 0, daysInMonth: 30 });
  });
  it("diario: el día del mes", () => {
    expect(dias("2026-02-18", "diario")).toEqual({ daysElapsed: 18, daysRemaining: 10, daysInMonth: 28 });
  });
  it("sin fecha: no divide por cero", () => {
    expect(dias("", "semanal").daysInMonth).toBe(30);
  });
});
