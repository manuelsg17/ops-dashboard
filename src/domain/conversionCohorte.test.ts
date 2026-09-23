import { describe, it, expect } from "vitest";
import { embudoCohorte, canalCohorte, COHORTE_MIN, FILTRO_DEFECTO, EMBUDO_COLS, CANALES } from "./conversionCohorte";

// Filas con la forma de STATE.conversionData (data.ts loadConversionIfNeeded).
const fila = (partner: string, ad: number, nd: number, n5: number | null, extra: Record<string, unknown> = {}, mes = "2026-08") => ({
  partner, mes, activeDrivers: ad, newDrivers: nd,
  firstOrder: 40, n5, n10: n5 == null ? null : n5 / 2, n25: null, n50: null, n100: null,
  agencyScouts: 0, organicPartner: 10, organicScouts: 0, organicYango: 5, paidYango: 0,
  partnerScouts: 0, referralPartner: 2, referralYango: 1, ...extra
});

// 12 partners elegibles (nd ≥ 50), ordenados por AD de P1 (1200) a P12 (100).
const base = Array.from({ length: 12 }, (_, i) => fila(`P${i + 1}`, 1200 - i * 100, 60, 10 + i));

describe("embudo: partner vs promedio del cohorte", () => {
  it("usa el mes más reciente y promedia simple el Top 5 / Top 10 por AD", () => {
    const viejo = fila("P1", 5000, 60, 99, {}, "2026-07");
    const r = embudoCohorte([...base, viejo], "P7");
    expect(r.mes).toBe("2026-08");
    expect(r.nPares).toBe(12);
    expect(r.top5!.n5).toBeCloseTo((10 + 11 + 12 + 13 + 14) / 5);
    expect(r.top10!.n5).toBeCloseTo((10 + 11 + 12 + 13 + 14 + 15 + 16 + 17 + 18 + 19) / 10);
    expect(r.partner.n5).toBe(16);
  });

  it("partner con varios CLIDs: ponderado por nuevos conductores", () => {
    const rows = [...base, fila("MULTI", 50, 30, 10), fila("MULTI", 50, 90, 30)];
    // (10·30 + 30·90) / 120 = 25
    expect(embudoCohorte(rows, "MULTI").partner.n5).toBeCloseTo(25);
  });

  it("filtros AD/ND recortan los pares elegibles", () => {
    const r = embudoCohorte(base, "P1", { adMin: 0, adMax: 700, ndMin: 0 });
    expect(r.nPares).toBe(7);                     // P6..P12
    expect(r.top5!.n5).toBeCloseTo((15 + 16 + 17 + 18 + 19) / 5);
  });

  it("filas con nuevos bajo el mínimo no entran al cohorte", () => {
    const rows = base.map((r, i) => i < 3 ? { ...r, newDrivers: 10 } : r);
    expect(embudoCohorte(rows, "P1").nPares).toBe(9);
    expect(FILTRO_DEFECTO.ndMin).toBe(50);
  });

  it("PRIVACIDAD: un cohorte de menos de COHORTE_MIN miembros no devuelve promedio", () => {
    const dos = [fila("A", 500, 60, 10), fila("B", 400, 60, 30)];
    const r = embudoCohorte(dos, "A");
    expect(COHORTE_MIN).toBe(3);
    expect(r.top5).toBeNull();                    // con A + B, A despejaría a B
    expect(r.top10).toBeNull();
    expect(r.partner.n5).toBe(10);                // el propio sí
  });

  it("PRIVACIDAD: el resultado solo tiene el partner y promedios, nunca filas de otros", () => {
    // Valores no lineales (raíces): ningún promedio coincide por casualidad
    // con el valor de un partner individual.
    const rows = base.map((r, i) => ({ ...r, n5: 10 + Math.sqrt(i + 2) * 3, n10: 3 + Math.sqrt(i + 3) * 2 }));
    const r = embudoCohorte(rows, "P7");
    const claves = Object.keys(r).sort();
    expect(claves).toEqual(["hayDatoPartner", "mes", "nPares", "nTop10", "nTop5", "partner", "tienePartner", "top10", "top5"]);
    expect(Object.keys(r.partner).sort()).toEqual([...EMBUDO_COLS].sort());
    const vals = [...Object.values(r.top5!), ...Object.values(r.top10!)].filter(v => v != null && v !== 40);
    rows.filter(x => x.partner !== "P7").forEach(x => {
      expect(vals).not.toContain(x.n5);
      expect(vals).not.toContain(x.n10);
    });
  });

  it("partner sin filas en el mes: sin dato, pero el cohorte igual se calcula", () => {
    const r = embudoCohorte(base, "NO_EXISTE");
    expect(r.tienePartner).toBe(false);
    expect(r.hayDatoPartner).toBe(false);
    expect(r.top5).not.toBeNull();
  });

  it("valores nulos no cuentan como 0 en el promedio del cohorte", () => {
    const rows = base.map((r, i) => i === 0 ? { ...r, n5: null } : r);
    expect(embudoCohorte(rows, "P1").top5!.n5).toBeCloseTo((11 + 12 + 13 + 14) / 4);
  });

  it("tabla vacía: nada que mostrar, sin romper", () => {
    const r = embudoCohorte([], "X");
    expect(r.mes).toBeNull();
    expect(r.hayDatoPartner).toBe(false);
    expect(r.top5).toBeNull();
  });
});

describe("adquisición por canal", () => {
  it("partner = SUMA de sus CLIDs; cohorte = promedio simple de conteos", () => {
    const rows = [...base, fila("MULTI", 50, 30, 10, { organicPartner: 4 }), fila("MULTI", 50, 90, 30, { organicPartner: 6 })];
    const r = canalCohorte(rows, "MULTI");
    expect(r.partner.organicPartner).toBe(10);
    expect(r.top5!.organicPartner).toBe(10);
    expect(r.hayDatoPartner).toBe(true);
    expect(r.hayDatoMes).toBe(true);
    expect(Object.keys(r.partner)).toEqual(CANALES.map(c => c.key));
  });

  it("sin canales cargados en el mes: hayDatoMes = false (la hoja se oculta)", () => {
    const vacio = base.map(r => ({ ...r, organicPartner: 0, organicYango: 0, referralPartner: 0, referralYango: 0 }));
    expect(canalCohorte(vacio, "P1").hayDatoMes).toBe(false);
    expect(canalCohorte(vacio, "P1").hayDatoPartner).toBe(false);
  });

  it("PRIVACIDAD: mismo guard de cohorte mínimo que el embudo", () => {
    expect(canalCohorte([fila("A", 500, 60, 10), fila("B", 400, 60, 30)], "A").top5).toBeNull();
  });
});
