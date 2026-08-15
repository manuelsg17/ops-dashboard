import { describe, it, expect } from "vitest";
import { validarMetas, mensajeMetasInvalidas } from "./metasGuard";

// Los valores de estos tests NO son inventados: son las filas reales que se
// borraron el 13-ago-2026 (KAM Manuel, AGOSTO 2026), recuperadas del audit_log.
// Si alguien afloja este guard, estos casos se caen.
const AGOSTO_MANUEL = [
  { clid: "400006292084", city: "LIMA",     meta_active_drivers: 4791, meta_supply_hours: 247084, meta_nr: 1099 },
  { clid: "400001264902", city: "LIMA",     meta_active_drivers: 4115, meta_supply_hours: 275797, meta_nr: 875  },
  { clid: "400001604401", city: "AREQUIPA", meta_active_drivers: 904,  meta_supply_hours: 57049,  meta_nr: 136  },
  { clid: "400006292084", city: "TRUJILLO", meta_active_drivers: 242,  meta_supply_hours: 10563,  meta_nr: 61   }
];
const enCero = (n: number) => Array.from({ length: n }, () => ({
  meta_active_drivers: 0, meta_supply_hours: 0, meta_nr: 0
}));

describe("validarMetas — el incidente del 13-ago-2026", () => {
  it("bloquea las 14 filas en cero que borraron AGOSTO", () => {
    const r = validarMetas(enCero(14));
    expect(r.ok).toBe(false);
    expect(r.faltantes).toEqual(["Active Drivers", "Supply Hours", "N+R"]);
  });

  it("deja pasar las metas reales que se restauraron", () => {
    const r = validarMetas(AGOSTO_MANUEL);
    expect(r.ok).toBe(true);
    expect(r.faltantes).toEqual([]);
    expect(r.totales.ad).toBe(10052);
    expect(r.totales.sh).toBe(590493);
  });
});

describe("validarMetas — una métrica vacía también destruye", () => {
  // El upsert escribe SIEMPRE las 3 columnas: guardar con SH vacío no "omite"
  // Supply Hours, lo pisa con 0. Por eso se valida cada métrica por separado.
  it("bloquea si SOLO falta Supply Hours", () => {
    const r = validarMetas(AGOSTO_MANUEL.map(x => ({ ...x, meta_supply_hours: 0 })));
    expect(r.ok).toBe(false);
    expect(r.faltantes).toEqual(["Supply Hours"]);
  });

  it("bloquea si SOLO falta Active Drivers", () => {
    const r = validarMetas(AGOSTO_MANUEL.map(x => ({ ...x, meta_active_drivers: 0 })));
    expect(r.faltantes).toEqual(["Active Drivers"]);
  });

  it("bloquea si SOLO falta N+R", () => {
    const r = validarMetas(AGOSTO_MANUEL.map(x => ({ ...x, meta_nr: null })));
    expect(r.faltantes).toEqual(["N+R"]);
  });
});

describe("validarMetas — lo que NO debe bloquear", () => {
  it("un partner en 0 con la cartera sana es legítimo (negocio frenado)", () => {
    const r = validarMetas([...AGOSTO_MANUEL, { meta_active_drivers: 0, meta_supply_hours: 0, meta_nr: 0 }]);
    expect(r.ok).toBe(true);
  });

  it("acepta valores como string: vienen de inputs del DOM", () => {
    const r = validarMetas([{ meta_active_drivers: "4791", meta_supply_hours: "247084", meta_nr: "1099" }]);
    expect(r.ok).toBe(true);
    expect(r.totales.ad).toBe(4791);
  });

  it("no bloquea con lista vacía: calcSaveMetas ya corta antes con su propio aviso", () => {
    expect(validarMetas([]).ok).toBe(true);
    expect(validarMetas(null).ok).toBe(true);
  });

  it("ignora basura no numérica en vez de romper", () => {
    const r = validarMetas([{ meta_active_drivers: "abc", meta_supply_hours: undefined, meta_nr: NaN }]);
    expect(r.ok).toBe(false);
    expect(r.totales.ad).toBe(0);
  });
});

describe("mensajeMetasInvalidas", () => {
  it("nombra la métrica que falta y avisa del borrado", () => {
    const m = mensajeMetasInvalidas(["Supply Hours"]);
    expect(m).toContain("Supply Hours");
    expect(m).toContain("BORRARÍA");
  });
});
