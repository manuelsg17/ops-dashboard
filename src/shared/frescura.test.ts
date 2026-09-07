import { describe, it, expect } from "vitest";
import { ultimoPeriodoCerrado, finDePeriodo, contarPeriodos, evaluarFrescura } from "./frescura.js";

// Fechas de referencia (UTC). 2026-09-06 es DOMINGO; 2026-09-07, LUNES.
const dom6  = new Date("2026-09-06T12:00:00Z");
const lun7  = new Date("2026-09-07T12:00:00Z");
const mie9  = new Date("2026-09-09T12:00:00Z");

describe("último período cerrado", () => {
  it("semanal: el lunes de la semana pasada, nunca la semana en curso", () => {
    // Domingo 6: la semana del lunes 31-ago cierra HOY, todavía no cerró.
    expect(ultimoPeriodoCerrado("semanal", dom6)).toBe("2026-08-24");
    // Lunes 7: ya cerró la del 31.
    expect(ultimoPeriodoCerrado("semanal", lun7)).toBe("2026-08-31");
  });

  it("diario: ayer", () => {
    expect(ultimoPeriodoCerrado("diario", dom6)).toBe("2026-09-05");
  });

  it("mensual: el mes anterior, no el corriente", () => {
    expect(ultimoPeriodoCerrado("mensual", dom6)).toBe("2026-08");
  });

  it("mensual cruzando año", () => {
    expect(ultimoPeriodoCerrado("mensual", new Date("2026-01-15T12:00:00Z"))).toBe("2025-12");
  });
});

describe("fin de período", () => {
  it("una semana termina 6 días después de su lunes", () => {
    expect(finDePeriodo("semanal", "2026-08-24").toISOString().slice(0, 10)).toBe("2026-08-30");
  });

  it("un mes termina en su último día real (incluye febrero)", () => {
    expect(finDePeriodo("mensual", "2026-08").toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(finDePeriodo("mensual", "2026-02").toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(finDePeriodo("mensual", "2028-02").toISOString().slice(0, 10)).toBe("2028-02-29");
  });
});

describe("conteo de períodos faltantes", () => {
  it("semanas", () => expect(contarPeriodos("semanal", "2026-08-10", "2026-08-31")).toBe(3));
  it("días",   () => expect(contarPeriodos("diario",  "2026-08-31", "2026-09-05")).toBe(5));
  it("meses cruzando año", () => expect(contarPeriodos("mensual", "2025-11", "2026-02")).toBe(3));
});

describe("evaluación de frescura", () => {
  it("CASO REAL sep 2026: diario clavado en 31-ago", () => {
    // Este es el caso que motivó todo: el badge decía "BD actualizada hace 3
    // días" (la ingesta SÍ había corrido) mientras la escala diaria terminaba
    // el 31-ago. Presentar en diario ese día mostraba datos de casi una semana
    // atrás con el rótulo del día de hoy.
    const f = evaluarFrescura("diario", ["2026-08-29", "2026-08-30", "2026-08-31"], dom6);
    expect(f.ultimo).toBe("2026-08-31");
    expect(f.esperado).toBe("2026-09-05");
    expect(f.faltan).toBe(5);
    expect(f.atrasado).toBe(true);
  });

  it("CASO REAL sep 2026: semanal SÍ estaba al día", () => {
    // Contraste deliberado con el test de arriba: la misma app, el mismo día,
    // una escala atrasada y la otra no. Un badge global no puede expresar esto.
    const f = evaluarFrescura("semanal", ["2026-08-10", "2026-08-17", "2026-08-24"], dom6);
    expect(f.faltan).toBe(0);
    expect(f.atrasado).toBe(false);
  });

  it("no marca atraso dentro de la ventana de gracia de la ingesta", () => {
    // Lunes: la semana del 31 cerró ayer, pero la tarea corre recién el martes.
    // Falta un período y aun así NO está atrasado — si esto diera rojo todos los
    // lunes, el indicador se volvería ruido y nadie lo miraría el día que importa.
    const f = evaluarFrescura("semanal", ["2026-08-17", "2026-08-24"], lun7);
    expect(f.faltan).toBe(1);
    expect(f.atrasado).toBe(false);
  });

  it("pasada la gracia sí marca atraso", () => {
    // Miércoles 9: la tarea del martes debería haber corrido. Ahora sí.
    const f = evaluarFrescura("semanal", ["2026-08-17", "2026-08-24"], mie9);
    expect(f.faltan).toBe(1);
    expect(f.atrasado).toBe(true);
  });

  it("un período MÁS NUEVO que el esperado no es un error", () => {
    // Puede pasar con una carga manual adelantada. Cero faltantes, sin alarma.
    const f = evaluarFrescura("semanal", ["2026-08-31"], dom6);
    expect(f.faltan).toBe(0);
    expect(f.atrasado).toBe(false);
  });

  it("sin datos NO inventa un atraso", () => {
    // Antes de que cargue la primera respuesta la lista está vacía. Decir
    // "atrasado" ahí sería un falso positivo en CADA arranque.
    const f = evaluarFrescura("semanal", [], dom6);
    expect(f.ultimo).toBeNull();
    expect(f.atrasado).toBe(false);
    expect(evaluarFrescura("semanal", null, dom6).atrasado).toBe(false);
  });

  it("no asume que la lista viene ordenada", () => {
    const f = evaluarFrescura("semanal", ["2026-08-24", "2026-08-10", "2026-08-17"], dom6);
    expect(f.ultimo).toBe("2026-08-24");
  });

  it("el huso horario no cambia el veredicto", () => {
    // Misma instante, distinta representación. Si esto fallara, un KAM en Lima y
    // el runner de CI en UTC verían estados distintos.
    const a = evaluarFrescura("diario", ["2026-08-31"], new Date("2026-09-06T04:00:00Z"));
    const b = evaluarFrescura("diario", ["2026-08-31"], new Date("2026-09-06T23:00:00Z"));
    expect(a.esperado).toBe(b.esperado);
    expect(a.faltan).toBe(b.faltan);
  });
});
