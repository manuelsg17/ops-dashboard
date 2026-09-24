// @vitest-environment happy-dom
// Anillo de avance (ui.progressRing, fase 8 — Rendimiento "B · Suave").
import { describe, it, expect } from "vitest";
import { progressRing } from "./ui";

function parse(html: string): SVGElement {
  const box = document.createElement("div");
  box.innerHTML = html;
  return box.querySelector("svg") as SVGElement;
}

describe("progressRing", () => {
  it("es accesible: role=img y el caption completo como nombre", () => {
    const svg = parse(progressRing({ pct: 72.7, label: "Septiembre: 6,371 de 8,758 · 72.7%" }));
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Septiembre: 6,371 de 8,758 · 72.7%");
    expect(svg.querySelector("text")!.textContent).toBe("73%");
  });

  it("usa los mismos cortes que la barra (goalTone)", () => {
    const tono = (p: number) => parse(progressRing({ pct: p, label: "x" })).getAttribute("class");
    expect(tono(120)).toContain("ui-ring--over");
    expect(tono(100)).toContain("ui-ring--over");
    expect(tono(97)).toContain("ui-ring--ok");
    expect(tono(85)).toContain("ui-ring--warn");
    expect(tono(40)).toContain("ui-ring--bad");
  });

  it("no muestra 100% si la meta no se cumplió", () => {
    expect(parse(progressRing({ pct: 99.6, label: "x" })).querySelector("text")!.textContent).toBe("99%");
    expect(parse(progressRing({ pct: 100, label: "x" })).querySelector("text")!.textContent).toBe("100%");
  });

  it("sin % no inventa un 0: guion y sin arco de avance", () => {
    const svg = parse(progressRing({ pct: null, label: "Sin meta" }));
    expect(svg.querySelector("text")!.textContent).toBe("—");
    expect(svg.querySelector(".ui-ring__bar")).toBeNull();
    expect(svg.getAttribute("class")).toContain("ui-ring--neutral");
  });

  it("dibuja la proyección solo si supera al avance", () => {
    expect(parse(progressRing({ pct: 70, projPct: 110, label: "x" })).querySelector(".ui-ring__proj")).not.toBeNull();
    expect(parse(progressRing({ pct: 70, projPct: 60, label: "x" })).querySelector(".ui-ring__proj")).toBeNull();
  });

  it("escapa el caption", () => {
    const html = progressRing({ pct: 50, label: `"><img src=x onerror=alert(1)>` });
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(box.querySelectorAll("img").length).toBe(0);
  });
});
