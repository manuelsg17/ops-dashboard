// @vitest-environment happy-dom
// Exportaciones siempre claras (Ola 7): traducción de colores oscuro → claro en
// la copia que captura html2canvas, y los tokens del modo oscuro.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapaColoresClaro, aclararColores, opcionesCapturaClara, TOKENS_COLOR } from "./exportClaro";
import { FALLBACK, remapColor, type ChartTokens } from "./chartTheme";

const CLARO: ChartTokens = { theme: "light", palette: [...FALLBACK.palette], other: FALLBACK.other, grid: FALLBACK.grid,
  axis: FALLBACK.axis, label: FALLBACK.label, text: FALLBACK.text, textMuted: FALLBACK.textMuted,
  surface: FALLBACK.surface, border: FALLBACK.border, font: FALLBACK.font };
const OSCURO: ChartTokens = { ...CLARO, theme: "dark",
  palette: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#1aa3b5", "#b8752a"],
  other: "#5f6775", grid: "#2b313c", axis: "#3a414e", label: "#9199a6", text: "#e6e8ec", textMuted: "#aab1bd",
  surface: "#161a21", border: "#2b313c" };

describe("remapColor", () => {
  it("un color de la paleta pasa al MISMO slot del otro tema", () => {
    OSCURO.palette.forEach((c, i) => expect(remapColor(c, OSCURO, CLARO)).toBe(CLARO.palette[i]));
    expect(remapColor("#3987E5", OSCURO, CLARO)).toBe(CLARO.palette[0]);   // sin importar mayúsculas
  });
  it("lo que no es de la paleta (marca, estados) queda igual", () => {
    expect(remapColor("#E1251B", OSCURO, CLARO)).toBe("#E1251B");
  });
});

describe("mapaColoresClaro / aclararColores", () => {
  const mapa = mapaColoresClaro(OSCURO, CLARO);
  it("cubre las dos escrituras de cada color: #hex y rgb()", () => {
    expect(mapa.get("#2b313c")).toBe(CLARO.grid);
    expect(mapa.get("rgb(57, 135, 229)")).toBe("rgb(42, 120, 214)");
  });
  it("reescribe atributos de pintura y estilos, y deja el resto", () => {
    const d = document.createElement("div");
    d.innerHTML = `<svg><line stroke="#2b313c"/><text fill="#9199A6">x</text><rect fill="#E1251B"/></svg>` +
      `<span style="color: rgb(170, 177, 189); background: rgb(57, 135, 229)">l</span>`;
    const n = aclararColores(d, mapa);
    expect(n).toBe(3);
    expect(d.querySelector("line")!.getAttribute("stroke")).toBe(CLARO.grid);
    expect(d.querySelector("text")!.getAttribute("fill")).toBe(CLARO.label);
    expect(d.querySelector("rect")!.getAttribute("fill")).toBe("#E1251B");
    const st = d.querySelector("span")!.getAttribute("style")!;
    expect(st).toContain("rgb(75, 85, 99)");      // text-muted claro
    expect(st).toContain("rgb(42, 120, 214)");    // cat-1 claro
  });
});

describe("opcionesCapturaClara", () => {
  it("con la app en claro no toca la copia", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const o = opcionesCapturaClara({ scale: 2 });
    const doc = document.implementation.createHTMLDocument("x");
    const el = doc.createElement("div");
    o.onclone(doc, el);
    expect(o.scale).toBe(2);
    expect(doc.documentElement.getAttribute("data-theme")).toBeNull();
  });
  it("con la app en oscuro pone la copia en claro y respeta el onclone propio", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    let propio = false;
    const o = opcionesCapturaClara({ onclone: () => { propio = true; } });
    const doc = document.implementation.createHTMLDocument("x");
    const el = doc.createElement("div");
    o.onclone(doc, el);
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
    expect(el.getAttribute("data-theme")).toBe("light");
    expect(propio).toBe(true);
    document.documentElement.setAttribute("data-theme", "light");
  });
});

describe("tokens.css: bloque del modo oscuro", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
  const i = css.indexOf('[data-theme="dark"] {');
  const oscuro = css.slice(i);
  it("existe y re-apunta cada token de color que traduce la exportación", () => {
    expect(i).toBeGreaterThan(0);
    for (const t of TOKENS_COLOR) {
      if (t === "--focus-ring-color") continue;
      expect(oscuro, t).toContain(`${t}:`);
    }
  });
  it("la paleta categórica oscura es la de los tests (9 slots, mismo orden)", () => {
    OSCURO.palette.forEach((hex, n) => expect(oscuro).toMatch(new RegExp(`--cat-${n + 1}:\\s*${hex}`, "i")));
  });
  it("el claro también se declara en [data-theme=\"light\"] (islas claras: deck, exportaciones)", () => {
    expect(css).toContain(':root, [data-theme="light"] {');
  });
});
