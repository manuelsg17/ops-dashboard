import { describe, it, expect } from "vitest";
import { fechaLima, diasMesEnCursoMensual, corteDatosMensual } from "./diasMesEnCurso";
import { projectFlow } from "./metrics";

// Lima es UTC-5 todo el año (sin horario de verano).
const d = (iso: string) => new Date(iso);

describe("fechaLima", () => {
  it("usa el día de Lima, no el UTC", () => {
    expect(fechaLima(d("2026-10-01T01:00:00Z"))).toEqual({ y: 2026, m: 9, d: 30 });
    expect(fechaLima(d("2026-10-01T05:30:00Z"))).toEqual({ y: 2026, m: 10, d: 1 });
  });
});

describe("corteDatosMensual", () => {
  const hoy = d("2026-09-24T15:00:00Z");   // jueves 24-sep en Lima
  it("sin períodos semanales: ayer en Lima", () => {
    expect(corteDatosMensual(undefined, hoy)).toBe("2026-09-23");
    expect(corteDatosMensual([], hoy)).toBe("2026-09-23");
    expect(corteDatosMensual(null, hoy)).toBe("2026-09-23");
  });
  it("fin del último período semanal (lunes + 6), sin importar el orden", () => {
    expect(corteDatosMensual(["2026-09-07", "2026-09-14", "2026-08-31"], hoy)).toBe("2026-09-20");
  });
  it("tope en ayer: la semana en curso no puede pasar de ayer", () => {
    expect(corteDatosMensual(["2026-09-21"], hoy)).toBe("2026-09-23");
  });
  it("cruce de mes y de año en el lunes + 6", () => {
    expect(corteDatosMensual(["2026-09-28"], d("2026-10-10T15:00:00Z"))).toBe("2026-10-04");
    expect(corteDatosMensual(["2026-12-28"], d("2027-01-10T15:00:00Z"))).toBe("2027-01-03");
  });
  it("valores basura se ignoran (cae a ayer)", () => {
    expect(corteDatosMensual(["", "xx"], hoy)).toBe("2026-09-23");
  });
});

describe("diasMesEnCursoMensual", () => {
  const hoy = d("2026-09-24T15:00:00Z");   // 24-sep en Lima
  const sem = ["2026-08-31", "2026-09-07", "2026-09-14"];

  it("mes en curso sin semanas conocidas: días cerrados hasta ayer", () => {
    expect(diasMesEnCursoMensual(9, 2026, hoy)).toEqual({ daysElapsed: 23, daysRemaining: 7, daysInMonth: 30, corte: "2026-09-23" });
    expect(diasMesEnCursoMensual(9, null, hoy)?.daysElapsed).toBe(23);
  });

  it("mes en curso con semanas: hasta el fin de la última semana cargada", () => {
    expect(diasMesEnCursoMensual(9, 2026, hoy, sem)).toEqual({ daysElapsed: 20, daysRemaining: 10, daysInMonth: 30, corte: "2026-09-20" });
  });

  it("la última semana todavía es del mes anterior: sin días con datos → null", () => {
    expect(diasMesEnCursoMensual(9, 2026, d("2026-09-05T15:00:00Z"), ["2026-08-24"])).toBeNull();
  });

  it("mes cerrado, futuro o de otro año: null (se conserva el período completo)", () => {
    expect(diasMesEnCursoMensual(8, 2026, hoy, sem)).toBeNull();
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
    expect(diasMesEnCursoMensual(9, 2026, d("2026-09-02T15:00:00Z"))).toEqual({ daysElapsed: 1, daysRemaining: 29, daysInMonth: 30, corte: "2026-09-01" });
  });

  it("la última tarde del mes en Lima (ya 1-oct en UTC) sigue siendo septiembre", () => {
    expect(diasMesEnCursoMensual(9, 2026, d("2026-10-01T02:00:00Z"))?.daysElapsed).toBe(29);
    expect(diasMesEnCursoMensual(10, 2026, d("2026-10-01T02:00:00Z"))).toBeNull();
  });

  it("febrero bisiesto y no bisiesto", () => {
    expect(diasMesEnCursoMensual(2, 2028, d("2028-02-15T15:00:00Z"))?.daysInMonth).toBe(29);
    expect(diasMesEnCursoMensual(2, 2027, d("2027-02-15T15:00:00Z"))?.daysInMonth).toBe(28);
  });

  it("con projectFlow: el caso reportado (6,371 al 20-sep) proyecta por ritmo", () => {
    const dm = diasMesEnCursoMensual(9, 2026, hoy, sem)!;
    const proj = projectFlow(6371, dm.daysElapsed, dm.daysRemaining);
    expect(proj).toBeCloseTo(6371 * 30 / 20, 6);
  });
});
