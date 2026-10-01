import { describe, it, expect } from "vitest";
import { moverTarjeta, ordenLista, ordenAlFinal, vencida, vencePronto, checklistDe, avanceChecklist, kanbanDeck, fechaCierre } from "./tableroSeg";

const C = (id: string, status: string, sort_order: number) => ({ id, status, sort_order });
const base = [C("a", "pendiente", 0), C("b", "pendiente", 1), C("c", "pendiente", 2), C("x", "hecho", 0)];

describe("tablero de seguimiento", () => {
  it("ordena una lista por sort_order", () => {
    expect(ordenLista([C("b", "pendiente", 5), C("a", "pendiente", 1), C("z", "hecho", 0)], "pendiente").map(c => c.id)).toEqual(["a", "b"]);
  });
  it("mover a otra lista al final: solo escribe la tarjeta movida", () => {
    expect(moverTarjeta(base, "b", "hecho", null)).toEqual([{ id: "b", status: "hecho", sort_order: 1 }]);
  });
  it("mover delante de otra tarjeta renumera lo que corresponde", () => {
    expect(moverTarjeta(base, "b", "hecho", "x")).toEqual([
      { id: "b", status: "hecho", sort_order: 0 }, { id: "x", status: "hecho", sort_order: 1 }]);
  });
  it("reordenar dentro de la misma lista", () => {
    expect(moverTarjeta(base, "c", "pendiente", "a")).toEqual([
      { id: "c", status: "pendiente", sort_order: 0 }, { id: "a", status: "pendiente", sort_order: 1 }, { id: "b", status: "pendiente", sort_order: 2 }]);
    expect(moverTarjeta(base, "a", "pendiente", "b")).toEqual([]);   // ya estaba ahí
  });
  it("orden al final y lista vacía", () => {
    expect(ordenAlFinal(base, "pendiente")).toBe(3);
    expect(ordenAlFinal(base, "bloqueado")).toBe(0);
  });
  it("vencida y vence pronto", () => {
    expect(vencida({ status: "en_curso", end_date: "2026-09-30" }, "2026-10-01")).toBe(true);
    expect(vencida({ status: "hecho", end_date: "2026-09-30" }, "2026-10-01")).toBe(false);
    expect(vencida({ status: "pendiente", end_date: null }, "2026-10-01")).toBe(false);
    expect(vencePronto({ status: "pendiente", end_date: "2026-10-08" }, "2026-10-01")).toBe(true);
    expect(vencePronto({ status: "pendiente", end_date: "2026-10-09" }, "2026-10-01")).toBe(false);
    expect(vencePronto({ status: "pendiente", end_date: "2026-09-30" }, "2026-10-01")).toBe(false);
  });
  it("checklist: normaliza y calcula avance", () => {
    const l = checklistDe([{ t: "a", ok: true }, { t: " " }, null, { t: "b" }, "x"]);
    expect(l).toEqual([{ t: "a", ok: true }, { t: "b", ok: false }]);
    expect(avanceChecklist(l)).toEqual({ hechos: 1, total: 2, pct: 50 });
    expect(checklistDe(undefined)).toEqual([]);
  });
});

describe("hoja Kanban del deck", () => {
  const R = (status: string, end_date: string | null, completed_at: string | null = null) => ({ status, end_date, completed_at });
  it("logrados: solo los cerrados en el período, el más reciente primero; cuenta los de antes", () => {
    const k = kanbanDeck([R("hecho", "2026-09-10"), R("hecho", "2026-07-01"), R("hecho", "2026-06-01", "2026-09-20T15:00:00"), R("en_curso", "2026-10-05")], "2026-09-01");
    expect(k.paginas[0].hecho.map(r => fechaCierre(r))).toEqual(["2026-09-20", "2026-09-10"]);
    expect(k.logradosAntes).toBe(1);
    expect(k.hechas).toBe(3); expect(k.total).toBe(4); expect(k.pct).toBe(75);
  });
  it("pagina de a 4 por columna y nunca pierde tarjetas", () => {
    const rows = Array.from({ length: 9 }, (_, i) => R("en_curso", `2026-10-${String(10 - i).padStart(2, "0")}`));
    const k = kanbanDeck([...rows, R("pendiente", null), R("pendiente", "2026-10-02")], "2026-09-01");
    expect(k.paginas.length).toBe(3);
    expect(k.paginas.flatMap(p => p.en_curso).length).toBe(9);
    expect(k.paginas[0].en_curso[0].end_date).toBe("2026-10-02");        // lo más urgente primero
    expect(k.paginas[0].pendiente.map(r => r.end_date)).toEqual(["2026-10-02", null]);   // sin fecha al final
    expect(k.paginas[2].pendiente).toEqual([]);
  });
  it("sin tareas: una hoja vacía", () => {
    const k = kanbanDeck([], "2026-09-01");
    expect(k.paginas.length).toBe(1); expect(k.pct).toBe(0);
  });
});
