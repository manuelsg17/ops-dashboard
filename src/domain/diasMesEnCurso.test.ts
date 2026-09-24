import { describe, it, expect } from "vitest";
import { fechaLima, diasMesEnCursoMensual } from "./diasMesEnCurso";
import { projectFlow } from "./metrics";

// Lima es UTC-5 todo el año (sin horario de verano).
const d = (iso: string) => new Date(iso);

describe("fechaLima", () => {
  it("usa el día de Lima, no el UTC", () => {
    expect(fechaLima(d("2026-10-01T01:00:00Z"))).toEqual({ y: 2026, m: 9, d: 30 });
    expect(fechaLima(d("2026-10-01T05:30:00Z"))).toEqual({ y: 2026, m: 10, d: 1 });
  });
});

describe("diasMesEnCursoMensual", () => {
  const hoy = d("2026-09-24T15:00:00Z");   // 24-sep en Lima

  it("mes en curso: días cerrados hasta ayer", () => {
    expect(diasMesEnCursoMensual(9, 2026, hoy)).toEqual({ daysElapsed: 23, daysRemaining: 7, daysInMonth: 30 });
    expect(diasMesEnCursoMensual(9, null, hoy)).toEqual({ daysElapsed: 23, daysRemaining: 7, daysInMonth: 30 });
  });

  it("mes cerrado, futuro o de otro año: null (se conserva el período completo)", () => {
    expect(diasMesEnCursoMensual(8, 2026, hoy)).toBeNull();
    expect(diasMesEnCursoMensual(10, 2026, hoy)).toBeNull();
    expect(diasMesEnCursoMensual(9, 2025, hoy)).toBeNull();
  });

  it("mes inválido: null", () => {
    expect(diasMesEnCursoMensual(0, 2026, hoy)).toBeNull();
    expect(diasMesEnCursoMensual(13, 2026, hoy)).toBeNull();
    expect(diasMesEnCursoMensual(NaN, 2026, hoy)).toBeNull();
  });

  it("el 1ro del mes no hay días cerrados: null (no se extrapola)", () => {
    expect(diasMesEnCursoMensual(9, 2026, d("2026-09-01T15:00:00Z"))).toBeNull();
    expect(diasMesEnCursoMensual(9, 2026, d("2026-09-02T15:00:00Z"))).toEqual({ daysElapsed: 1, daysRemaining: 29, daysInMonth: 30 });
  });

  it("la última tarde del mes en Lima (ya 1-oct en UTC) sigue siendo septiembre", () => {
    expect(diasMesEnCursoMensual(9, 2026, d("2026-10-01T02:00:00Z"))).toEqual({ daysElapsed: 29, daysRemaining: 1, daysInMonth: 30 });
    expect(diasMesEnCursoMensual(10, 2026, d("2026-10-01T02:00:00Z"))).toBeNull();
  });

  it("febrero bisiesto y no bisiesto", () => {
    expect(diasMesEnCursoMensual(2, 2028, d("2028-02-15T15:00:00Z"))?.daysInMonth).toBe(29);
    expect(diasMesEnCursoMensual(2, 2027, d("2027-02-15T15:00:00Z"))?.daysInMonth).toBe(28);
  });

  it("con projectFlow: el caso reportado (6,371 al 24-sep) proyecta por ritmo, no queda igual al actual", () => {
    const dm = diasMesEnCursoMensual(9, 2026, hoy)!;
    const proj = projectFlow(6371, dm.daysElapsed, dm.daysRemaining);
    expect(proj).toBeCloseTo(6371 * 30 / 23, 6);
    expect(proj).toBeGreaterThan(6371);
  });
});
