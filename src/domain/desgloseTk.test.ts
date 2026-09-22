import { describe, it, expect } from "vitest";
import { detectarCambiosTk, hayCambiosTk, mensajeCambiosTk, claveFila } from "./desgloseTk";

// Fila del agregador tal como la arma _calcBuildMetaRows (reparto completo):
// los tres totales siempre, meta_tk_* solo si hay % declarado y porción > 0.
const fila = (extra: Record<string, unknown> = {}) => ({
  clid: "400001", city: "LIMA", partner: "RUTA SUR",
  meta_active_drivers: 3613, meta_nr: 900, meta_supply_hours: 200000,
  ...extra
});
const exMap = (...rows: Record<string, any>[]) =>
  new Map(rows.map(r => [claveFila(r.clid, r.city), r]));
const guardada = (extra: Record<string, unknown> = {}) => ({
  clid: "400001", city: "LIMA",
  meta_active_drivers: 3613, meta_nr: 900, meta_supply_hours: 200000,
  meta_tk_ad: null, meta_tk_nr: null, meta_tk_sh: null,
  ...extra
});

describe("detectarCambiosTk — caso A: des-declarar el % BORRA el desglose", () => {
  it("sin % declarado y con desglose guardado → se borran las 3 columnas", () => {
    const c = detectarCambiosTk([fila()],
      exMap(guardada({ meta_tk_ad: 1198, meta_tk_nr: 140, meta_tk_sh: 40400 })), false);
    expect(hayCambiosTk(c)).toBe(true);
    expect(c.reescribir).toEqual([]);
    expect(c.borrar).toHaveLength(1);
    expect(c.borrar[0].cambios.map(d => [d.col, d.viejo, d.nuevo])).toEqual([
      ["meta_tk_ad", 1198, null], ["meta_tk_nr", 140, null], ["meta_tk_sh", 40400, null]
    ]);
    expect(c.afectadas).toBe(1);
    // Lo que se escribe: NULL explícito, pisando el merge que antes lo conservaba.
    expect(c.aplicar.get(claveFila("400001", "LIMA")))
      .toEqual({ meta_tk_ad: null, meta_tk_nr: null, meta_tk_sh: null });
  });

  it("sin % declarado, un meta_tk_* que venga en la fila igual se ignora (queda NULL)", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 500 })], exMap(guardada({ meta_tk_ad: 1198 })), false);
    expect(c.borrar[0].cambios).toEqual([{ col: "meta_tk_ad", viejo: 1198, nuevo: null }]);
    expect(c.aplicar.get(claveFila("400001", "LIMA"))!.meta_tk_ad).toBeNull();
  });

  it("con % declarado pero sin porción TukTuk en esa unidad → también se borra", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 1198 })],
      exMap(guardada({ meta_tk_ad: 1198, meta_tk_sh: 40400 })), true);
    expect(c.reescribir).toEqual([]);
    expect(c.borrar[0].cambios).toEqual([{ col: "meta_tk_sh", viejo: 40400, nuevo: null }]);
  });
});

describe("detectarCambiosTk — caso B: el % declarado REESCRIBE un valor distinto", () => {
  it("valor nuevo ≠ guardado → reescribir, con viejo y nuevo", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 1250, meta_tk_nr: 140, meta_tk_sh: 40400 })],
      exMap(guardada({ meta_tk_ad: 1198, meta_tk_nr: 140, meta_tk_sh: 40400 })), true);
    expect(c.borrar).toEqual([]);
    expect(c.reescribir).toHaveLength(1);
    expect(c.reescribir[0].cambios).toEqual([{ col: "meta_tk_ad", viejo: 1198, nuevo: 1250 }]);
    expect(c.aplicar.get(claveFila("400001", "LIMA")))
      .toEqual({ meta_tk_ad: 1250, meta_tk_nr: 140, meta_tk_sh: 40400 });
  });

  it("una misma fila puede borrar una columna y reescribir otra; cuenta UNA afectada", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 1250 })],
      exMap(guardada({ meta_tk_ad: 1198, meta_tk_nr: 140 })), true);
    expect(c.borrar[0].cambios.map(d => d.col)).toEqual(["meta_tk_nr"]);
    expect(c.reescribir[0].cambios.map(d => d.col)).toEqual(["meta_tk_ad"]);
    expect(c.afectadas).toBe(1);
  });
});

describe("detectarCambiosTk — ninguno: no hay que molestar al KAM", () => {
  it("sin % y sin desglose guardado → nada", () => {
    const c = detectarCambiosTk([fila()], exMap(guardada()), false);
    expect(hayCambiosTk(c)).toBe(false);
    expect(c.afectadas).toBe(0);
  });

  it("con % y el mismo valor guardado → nada (aunque la base lo devuelva como string)", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 1198, meta_tk_sh: 40400 })],
      exMap(guardada({ meta_tk_ad: "1198", meta_tk_sh: 40400 })), true);
    expect(hayCambiosTk(c)).toBe(false);
  });

  it("con % sobre un desglose guardado en NULL → es escribir algo nuevo, no reescribir", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 1198 })], exMap(guardada()), true);
    expect(hayCambiosTk(c)).toBe(false);
    expect(c.aplicar.get(claveFila("400001", "LIMA"))!.meta_tk_ad).toBe(1198);
  });
});

describe("detectarCambiosTk — fila nueva sin registro previo", () => {
  it("con % declarado: se escribe el desglose, sin aviso", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 1198 })], new Map(), true);
    expect(hayCambiosTk(c)).toBe(false);
    expect(c.aplicar.get(claveFila("400001", "LIMA")))
      .toEqual({ meta_tk_ad: 1198, meta_tk_nr: null, meta_tk_sh: null });
  });
  it("sin % declarado: nada que borrar", () => {
    expect(hayCambiosTk(detectarCambiosTk([fila()], new Map(), false))).toBe(false);
  });
  it("otra ciudad del mismo CLID no cuenta como registro previo", () => {
    const c = detectarCambiosTk([fila()],
      exMap(guardada({ city: "AREQUIPA", meta_tk_ad: 50 })), false);
    expect(hayCambiosTk(c)).toBe(false);
  });
});

describe("detectarCambiosTk — NULL frente a 0", () => {
  it("un 0 guardado es un valor declarado: des-declarar lo BORRA (0 → vacío)", () => {
    const c = detectarCambiosTk([fila()], exMap(guardada({ meta_tk_ad: 0 })), false);
    expect(c.borrar[0].cambios).toEqual([{ col: "meta_tk_ad", viejo: 0, nuevo: null }]);
  });
  it("0 guardado → valor nuevo > 0 es una REESCRITURA", () => {
    const c = detectarCambiosTk([fila({ meta_tk_ad: 5 })], exMap(guardada({ meta_tk_ad: 0 })), true);
    expect(c.reescribir[0].cambios).toEqual([{ col: "meta_tk_ad", viejo: 0, nuevo: 5 }]);
  });
  it("0 nuevo sobre 0 guardado → sin cambio; 0 nuevo sobre NULL → sin aviso", () => {
    expect(hayCambiosTk(detectarCambiosTk([fila({ meta_tk_ad: 0 })],
      exMap(guardada({ meta_tk_ad: 0 })), true))).toBe(false);
    const c = detectarCambiosTk([fila({ meta_tk_ad: 0 })], exMap(guardada()), true);
    expect(hayCambiosTk(c)).toBe(false);
    expect(c.aplicar.get(claveFila("400001", "LIMA"))!.meta_tk_ad).toBe(0);
  });
  it("NULL guardado no se puede borrar: no genera aviso", () => {
    expect(hayCambiosTk(detectarCambiosTk([fila()], exMap(guardada()), false))).toBe(false);
  });
});

describe("detectarCambiosTk — alcance: el desglose solo se toca si viaja su total", () => {
  it("'Solo lo que cambié' con solo AD tecleado → solo meta_tk_ad en juego", () => {
    const soloAD = { clid: "400001", city: "LIMA", partner: "RUTA SUR", meta_active_drivers: 3000 };
    const c = detectarCambiosTk([soloAD],
      exMap(guardada({ meta_tk_ad: 1198, meta_tk_nr: 140, meta_tk_sh: 40400 })), false);
    expect(c.borrar[0].cambios.map(d => d.col)).toEqual(["meta_tk_ad"]);
    expect(c.aplicar.get(claveFila("400001", "LIMA"))).toEqual({ meta_tk_ad: null });
  });
  it("fila solo-Fleet (sin totales del agregador) → no toca el desglose", () => {
    const fleet = { clid: "400001", city: "LIMA", partner: "RUTA SUR", meta_sh_car: 60 };
    const c = detectarCambiosTk([fleet], exMap(guardada({ meta_tk_ad: 1198 })), false);
    expect(hayCambiosTk(c)).toBe(false);
    expect(c.aplicar.has(claveFila("400001", "LIMA"))).toBe(false);
  });
});

describe("mensajeCambiosTk", () => {
  const ctx = { kam: "Ana", mes: "SEPTIEMBRE", anio: 2026, hayPctDeclarado: false };

  it("dice cuántos, qué se borra, con viejo → nuevo, y que cancelar no guarda nada", () => {
    const c = detectarCambiosTk([fila()], exMap(guardada({ meta_tk_ad: 1198 })), false);
    const txt = mensajeCambiosTk(c, ctx, n => n.toLocaleString("es-PE"));
    expect(txt).toContain("Ana · SEPTIEMBRE 2026 · 1 partner-ciudad afectado(s)");
    expect(txt).toContain("Se BORRAN (1)");
    expect(txt).toContain("• RUTA SUR · LIMA · AD TukTuk 1,198 → vacío");
    expect(txt).not.toContain("REESCRIBEN");
    expect(txt).toContain("NO se guarda NADA");
  });

  it("recorta a ~8 ejemplos con '…y N más', repartidos entre las dos listas", () => {
    const filas: any[] = [], ex: any[] = [];
    for (let i = 0; i < 10; i++) {
      filas.push(fila({ clid: `B${i}`, meta_tk_ad: undefined }));
      ex.push(guardada({ clid: `B${i}`, meta_tk_ad: 10 }));
      filas.push(fila({ clid: `R${i}`, meta_tk_ad: 20 }));
      ex.push(guardada({ clid: `R${i}`, meta_tk_ad: 10 }));
    }
    const c = detectarCambiosTk(filas, exMap(...ex), true);
    expect(c.afectadas).toBe(20);
    const txt = mensajeCambiosTk(c, { ...ctx, hayPctDeclarado: true });
    expect(txt).toContain("Se BORRAN (10) — en el reparto actual no tienen porción TukTuk");
    expect(txt).toContain("Se REESCRIBEN (10)");
    expect(txt.match(/^• /gm)).toHaveLength(8);
    expect(txt.match(/…y 6 más/g)).toHaveLength(2);
  });
});
