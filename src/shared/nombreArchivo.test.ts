import { describe, it, expect } from "vitest";
import { nombreArchivo } from "./nombreArchivo";

describe("nombreArchivo", () => {
  it("une las partes con _ y agrega la extensión", () => {
    expect(nombreArchivo(["Presentación", "ANDINA MOVILIDAD", "2026-09-14"], "pdf")).toBe("Presentación_ANDINA MOVILIDAD_2026-09-14.pdf");
  });
  it("saca los caracteres inválidos y las partes vacías", () => {
    expect(nombreArchivo(["A/B: C*D?", null, "", "x"], ".csv")).toBe("A-B- C-D-_x.csv");
  });
  it("acepta cirílico", () => {
    expect(nombreArchivo(["Презентация", "Партнёр"], "pdf")).toBe("Презентация_Партнёр.pdf");
  });
  it("sin partes, un nombre por defecto", () => {
    expect(nombreArchivo([], "png")).toBe("archivo.png");
  });
});
