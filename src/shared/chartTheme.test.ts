import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FALLBACK, chartTokens, seriesColor, apexBase, chartjsBase } from "./chartTheme";

// chartTheme lee los tokens del CSS en tiempo de ejecución y cae a FALLBACK
// cuando no hay DOM. Si alguien cambia un color en tokens.css y no acá, los
// gráficos que se pinten sin CSS (tests, export) saldrían con el color viejo:
// este test lo detecta.
const TOKENS = readFileSync(fileURLToPath(new URL("../styles/tokens.css", import.meta.url)), "utf8");
function tokenHex(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(TOKENS);
  if (!m) throw new Error(`token ${name} no encontrado`);
  return m[1].toLowerCase();
}

describe("FALLBACK = tokens.css", () => {
  it("paleta categórica, en el mismo orden", () => {
    FALLBACK.palette.forEach((hex, i) => expect(tokenHex(`--cat-${i + 1}`)).toBe(hex));
  });
  it("neutros usados por los gráficos", () => {
    expect(tokenHex("--neutral-200")).toBe(FALLBACK.grid);
    expect(tokenHex("--neutral-300")).toBe(FALLBACK.axis);
    expect(tokenHex("--neutral-500")).toBe(FALLBACK.label);
    expect(tokenHex("--neutral-400")).toBe(FALLBACK.other);
  });
  it("la paleta categórica no incluye el rojo de marca ni rojos de estado", () => {
    const rojos = ["--brand-500", "--brand-600", "--red-600", "--red-700"].map(tokenHex);
    for (const r of rojos) expect(FALLBACK.palette).not.toContain(r);
  });
});

describe("seriesColor", () => {
  const t = chartTokens();   // sin DOM → FALLBACK
  it("orden fijo", () => {
    expect(seriesColor(0, t)).toBe(FALLBACK.palette[0]);
    expect(seriesColor(8, t)).toBe(FALLBACK.palette[8]);
  });
  it("fuera de la paleta → gris 'Otros', nunca un color reciclado", () => {
    expect(seriesColor(9, t)).toBe(FALLBACK.other);
    expect(seriesColor(-1, t)).toBe(FALLBACK.other);
    expect(seriesColor(1.5, t)).toBe(FALLBACK.other);
  });
});

describe("opciones base", () => {
  it("ninguna fuente por debajo de 11px", () => {
    const tamaños: number[] = [];
    const walk = (o: unknown, k = ""): void => {
      if (o && typeof o === "object") for (const [kk, v] of Object.entries(o)) walk(v, kk);
      else if (k === "fontSize" && typeof o === "string") tamaños.push(parseFloat(o));
      else if (k === "size" && typeof o === "number") tamaños.push(o);
    };
    const apex = apexBase();
    walk({ legend: apex.legend, xaxis: apex.xaxis, yaxis: apex.yaxis, tooltip: apex.tooltip });
    walk(chartjsBase().plugins);
    walk(chartjsBase().scales);
    expect(tamaños.length).toBeGreaterThan(3);
    for (const s of tamaños) expect(s).toBeGreaterThanOrEqual(11);
  });
  it("apex usa la paleta completa y sin marcadores por defecto", () => {
    const a = apexBase();
    expect(a.colors).toEqual([...FALLBACK.palette]);
    expect(a.markers.size).toBe(0);
  });
});
