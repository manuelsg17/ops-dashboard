import { describe, it, expect } from "vitest";
import { p2Lectura, p2Accion } from "./lectura.js";

// La portada la lee la GERENCIA DEL PARTNER. Estos tests fijan que el texto
// diga algo accionable: cada frase con su número y su consecuencia. Si alguien
// lo vuelve genérico ("buen desempeño"), estos tests fallan.

const fmt = (n: number) => String(Math.round(n));
const base = {
  es: true, diasRestantes: 8, diasMes: 31,
  kpis: [
    { key: "ad", lbl: "Conductores Activos", real: 2160, meta: 2520, pct: 85.7, fmt },
    { key: "nr", lbl: "Nuevos + Reactivados", real: 432, meta: 390, pct: 110.8, fmt },
    { key: "sh", lbl: "Horas de Conexión",    real: 321000, meta: 154000, pct: 208.4, fmt }
  ],
  ciudades: [
    { label: "Lima",     adReal: 1550, adMeta: 1800 },
    { label: "Arequipa", adReal: 430,  adMeta: 500  },
    { label: "Trujillo", adReal: 180,  adMeta: 220  }
  ],
  verticales: [{ label: "Taxi", varPct: 3 }, { label: "TukTuk", varPct: -12 }]
};

describe("lectura ejecutiva: frases con número y consecuencia", () => {
  it("nombra el faltante concreto y el tiempo que queda", () => {
    const t = p2Lectura(base).join(" ");
    expect(t).toContain("360");            // 2520 - 2160
    expect(t).toContain("86%");            // el % de avance
    expect(t).toContain("8");              // días restantes
  });

  it("dice DÓNDE está la brecha, no solo cuánta es", () => {
    // Lima concentra 250 de 360 = 69% del faltante.
    expect(p2Lectura(base).join(" ")).toMatch(/69%.*Lima/);
  });

  it("señala la meta desalineada en vez de celebrar el 208%", () => {
    // Un 208% no es un logro que reportar: es un objetivo mal puesto.
    const t = p2Lectura(base).join(" ");
    expect(t).toContain("208%");
    expect(t).toMatch(/recalibrar/i);
  });

  it("contrasta la vertical que cae con la que sube", () => {
    const conSubida = { ...base, verticales: [{ label: "Taxi", varPct: 11 }, { label: "TukTuk", varPct: -12 }] };
    const t = p2Lectura(conSubida).join(" ");
    expect(t).toMatch(/TukTuk cae 12%/);
    expect(t).toMatch(/Taxi sube 11%/);
  });

  it("un movimiento chico NO se reporta como noticia", () => {
    // Taxi +3% es ruido: contrastarlo con la caída de TukTuk sería inventar
    // una historia que los datos no sostienen.
    const t = p2Lectura(base).join(" ");   // base tiene Taxi en +3
    expect(t).toMatch(/TukTuk cae 12%/);
    expect(t).not.toMatch(/Taxi sube/);
  });

  it("sin hallazgos NO rellena con elogios vacíos", () => {
    const ok = { ...base,
      kpis: base.kpis.map(k => ({ ...k, real: k.meta, pct: 100 })),
      verticales: [{ label: "Taxi", varPct: 1 }] };
    const t = p2Lectura(ok);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatch(/cubiertas/);
    expect(t[0]).not.toMatch(/excelente|felicitaciones|buen desempeño/i);
  });

  it("con el mes cerrado no promete días que no quedan", () => {
    const t = p2Lectura({ ...base, diasRestantes: 0 }).join(" ");
    expect(t).toMatch(/mes ya cerrado/);
    expect(t).not.toMatch(/quedan 0/);
  });
});

describe("acción ejecutiva: UNA sola palanca", () => {
  it("elige el KPI más atrasado y lo aterriza en la ciudad que más pesa", () => {
    const a = p2Accion(base)!;
    expect(a).toMatch(/Reactivar conductores/);
    expect(a).toContain("360");
    expect(a).toContain("Lima");
    expect(a).toContain("250");           // el faltante de Lima
  });

  it("cambia la palanca según qué KPI esté corto", () => {
    const soloNR = { ...base, kpis: [{ key: "nr", lbl: "Nuevos + Reactivados", real: 100, meta: 390, pct: 25.6, fmt }] };
    expect(p2Accion(soloNR)!).toMatch(/captación/i);
    const soloSH = { ...base, kpis: [{ key: "sh", lbl: "Horas de Conexión", real: 100, meta: 390, pct: 25.6, fmt }] };
    expect(p2Accion(soloSH)!).toMatch(/horas conectadas/i);
  });

  it("sin nada atrasado no inventa una acción", () => {
    expect(p2Accion({ ...base, kpis: base.kpis.map(k => ({ ...k, pct: 120, real: k.meta * 1.2 })) })).toBeNull();
  });
});
