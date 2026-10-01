import { describe, it, expect } from "vitest";
import { moverTarjeta, ordenLista, ordenAlFinal, vencida, vencePronto, checklistDe, avanceChecklist } from "./tableroSeg";

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
