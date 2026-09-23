import { describe, it, expect, vi } from "vitest";
import { escalaLista, reintentarCuandoEscalaLista } from "./escalaLista";

const sem = [{ date: "2026-09-07" }];
const men = [{ date: "2026-09-01" }];
const dia = [{ date: "2026-09-20" }];

describe("escalaLista", () => {
  it("semanal con el dataset semanal → lista", () => {
    expect(escalaLista({ curMode: "semanal", rawData: sem, _semanalData: sem })).toBe(true);
  });
  it("B12: curMode ya dice mensual pero rawData sigue semanal → NO lista", () => {
    expect(escalaLista({ curMode: "mensual", rawData: sem, _semanalData: sem, rawDataMensual: [] })).toBe(false);
    expect(escalaLista({ curMode: "mensual", rawData: sem, _semanalData: sem })).toBe(false);
  });
  it("mensual reasignado → lista (aunque venga vacío)", () => {
    const vacio: any[] = [];
    expect(escalaLista({ curMode: "mensual", rawData: men, rawDataMensual: men, _semanalData: sem })).toBe(true);
    expect(escalaLista({ curMode: "mensual", rawData: vacio, rawDataMensual: vacio, _semanalData: sem })).toBe(true);
  });
  it("diario", () => {
    expect(escalaLista({ curMode: "diario", rawData: sem, rawDataDiario: dia, _semanalData: sem })).toBe(false);
    expect(escalaLista({ curMode: "diario", rawData: dia, rawDataDiario: dia, _semanalData: sem })).toBe(true);
  });
  it("volver a semanal antes de reasignar (rawData todavía mensual) → NO lista", () => {
    expect(escalaLista({ curMode: "semanal", rawData: men, rawDataMensual: men, _semanalData: sem })).toBe(false);
  });
  it("antes de la primera carga semanal no hay con qué confundirse", () => {
    expect(escalaLista({ curMode: "semanal", rawData: [] })).toBe(true);
    expect(escalaLista(null)).toBe(false);
  });
});

describe("reintentarCuandoEscalaLista", () => {
  it("renderiza una sola vez cuando la escala queda lista", () => {
    vi.useFakeTimers();
    const st: any = { curMode: "mensual", rawData: sem, _semanalData: sem, rawDataMensual: men };
    const render = vi.fn();
    reintentarCuandoEscalaLista("t1", st, render, () => true, 100);
    reintentarCuandoEscalaLista("t1", st, render, () => true, 100);   // no apila
    vi.advanceTimersByTime(350);
    expect(render).not.toHaveBeenCalled();
    st.rawData = men;
    vi.advanceTimersByTime(150);
    expect(render).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(render).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it("se abandona si el usuario se fue de la pestaña", () => {
    vi.useFakeTimers();
    const st: any = { curMode: "mensual", rawData: sem, _semanalData: sem, rawDataMensual: men };
    const render = vi.fn();
    let sigue = true;
    reintentarCuandoEscalaLista("t2", st, render, () => sigue, 100);
    sigue = false;
    st.rawData = men;
    vi.advanceTimersByTime(500);
    expect(render).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
