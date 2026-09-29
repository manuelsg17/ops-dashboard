import { describe, it, expect } from "vitest";
import { calcularBrecha } from "./brechaMeta";

describe("brecha contra la meta", () => {
  it("flujo: faltan y ritmos por semana", () => {
    const b = calcularBrecha({ tipo: "flujo", actual: 6000, meta: 9000, proj: 9300, diasTranscurridos: 20, diasRestantes: 10 })!;
    expect(b.falta).toBe(3000);
    expect(b.ritmoActual).toBeCloseTo(2100);
    expect(b.ritmoNecesario).toBeCloseTo(2100);
    expect(b.llega).toBe(true);
  });
  it("el veredicto sale de la proyección de la app, no de otro criterio", () => {
    const b = calcularBrecha({ tipo: "nivel", actual: 28668, meta: 37248, proj: 40135, diasTranscurridos: 20, diasRestantes: 10 })!;
    expect(b.falta).toBe(8580);
    expect(b.llega).toBe(true);           // proyección 107.8% ⇒ llega (aunque hoy falten 8,580)
    expect(b.ritmoNecesario).toBeNull();  // AD es nivel, no ritmo
  });
  it("sin meta no hay brecha; mes cerrado no tiene veredicto de proyección", () => {
    expect(calcularBrecha({ tipo: "flujo", actual: 10, meta: 0, proj: null, diasTranscurridos: 30, diasRestantes: 0 })).toBeNull();
    const c = calcularBrecha({ tipo: "flujo", actual: 95, meta: 100, proj: null, diasTranscurridos: 30, diasRestantes: 0 })!;
    expect(c.cerrado).toBe(true);
    expect(c.llega).toBeNull();
  });
});
