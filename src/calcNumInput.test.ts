import { describe, it, expect } from "vitest";
import { parseNumInput, rawNumText } from "./calcNumInput";

describe("parseNumInput — campos de meta de la Calculadora", () => {
  it("lee la cifra cruda que se edita", () => {
    expect(parseNumInput("10000")).toBe(10000);
    expect(parseNumInput("8794.5")).toBe(8794.5);
    expect(parseNumInput("0")).toBe(0);
    expect(parseNumInput(" 250 ")).toBe(250);
  });

  it("acepta la cifra tal como se muestra (miles con coma, formato es-PE)", () => {
    // El caso que motiva el archivo: parseFloat("10,000") daría 10.
    expect(parseNumInput("10,000")).toBe(10000);
    expect(parseNumInput("3,324,180")).toBe(3324180);
    expect(parseNumInput("1,234.5")).toBe(1234.5);
  });

  it("acepta miles con punto (estilo europeo) y coma decimal", () => {
    expect(parseNumInput("1.234.567")).toBe(1234567);
    expect(parseNumInput("1.234,5")).toBe(1234.5);
    expect(parseNumInput("12,5")).toBe(12.5);
  });

  it("un solo punto es decimal (igual que en pantalla)", () => {
    expect(parseNumInput("1.5")).toBe(1.5);
    expect(parseNumInput("20.2")).toBe(20.2);
  });

  it("ignora espacios, espacios duros y apóstrofos de miles", () => {
    expect(parseNumInput("10 000")).toBe(10000);
    expect(parseNumInput("10\u00a0000")).toBe(10000);
    expect(parseNumInput("10'000")).toBe(10000);
  });

  it("vacío o basura → NaN, nunca un número inventado", () => {
    expect(parseNumInput("")).toBeNaN();
    expect(parseNumInput("   ")).toBeNaN();
    expect(parseNumInput(null)).toBeNaN();
    expect(parseNumInput(undefined)).toBeNaN();
    expect(parseNumInput("abc")).toBeNaN();
    expect(parseNumInput("12abc")).toBeNaN();
    expect(parseNumInput(".")).toBeNaN();
    expect(parseNumInput("1,2,3")).toBeNaN();
    expect(parseNumInput("1.2.3")).toBeNaN();
    expect(parseNumInput("1,234.5.6")).toBeNaN();
  });

  it("números pasan tal cual; negativos se leen (el llamador decide)", () => {
    expect(parseNumInput(42)).toBe(42);
    expect(parseNumInput(NaN)).toBeNaN();
    expect(parseNumInput("-5")).toBe(-5);
  });
});

describe("rawNumText", () => {
  it("devuelve la cifra sin separadores para editar", () => {
    expect(rawNumText(10000)).toBe("10000");
    expect(rawNumText(8794.5)).toBe("8794.5");
    expect(rawNumText("207")).toBe("207");
    expect(rawNumText(0)).toBe("0");
  });
  it("sin valor → texto vacío", () => {
    expect(rawNumText(null)).toBe("");
    expect(rawNumText(undefined)).toBe("");
    expect(rawNumText("")).toBe("");
    expect(rawNumText("x")).toBe("");
  });
});
