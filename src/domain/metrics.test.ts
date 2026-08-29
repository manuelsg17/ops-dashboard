import { describe, it, expect } from "vitest";
import {
  snapshotValue, flowValue, projectSnapshot, projectFlow,
  weightedAvg, ratio, attainmentPct, sumKpis, groupSum, seriesByDate, retentionSeries,
  AD_PROJECTION_FACTOR
} from "./metrics.js";

// Estos tests no son de cobertura: cada uno fija una regla de NEGOCIO que ya se
// rompió (o casi) alguna vez en este proyecto. Si uno falla, no lo "ajustes"
// para que pase — es la señal de que un cálculo cambió de significado.

describe("snapshot vs flujo", () => {
  it("un snapshot vale el último período, NO la suma", () => {
    // El bug clásico: 100 conductores activos durante 4 semanas son 100, no 400.
    expect(snapshotValue([100, 100, 100, 100])).toBe(100);
    expect(snapshotValue([80, 95, 120])).toBe(120);
  });

  it("un snapshot toma el último período CON dato, ignorando huecos al final", () => {
    expect(snapshotValue([80, 95, null as any])).toBe(95);
    expect(snapshotValue([])).toBe(0);
  });

  it("un flujo sí acumula todo el rango", () => {
    expect(flowValue([10, 20, 30])).toBe(60);
    expect(flowValue([10, null as any, 30])).toBe(40);
  });
});

describe("proyección de Active Drivers", () => {
  it("sin horizonte es PLANA: el último período con dato, no el máximo ni ×1.4", () => {
    // Decisión de Manuel (ago 2026) tras backtest contra producción: el máx
    // ×1.4 sobreestimaba ~46% todos los meses. Ver el comentario largo en
    // metrics.ts antes de volver a tocar esto.
    expect(projectSnapshot([100, 150, 120])).toBe(120);
    expect(AD_PROJECTION_FACTOR).toBe(1.4); // queda exportado como "potencial"
  });

  it("con horizonte extrapola la TENDENCIA media del rango", () => {
    // [100,110,120]: pendiente +10/período; faltan 2 → 140.
    expect(projectSnapshot([100, 110, 120], 2)).toBe(140);
    // en caída no se recorta la tendencia (el churn hay que verlo)…
    expect(projectSnapshot([120, 110, 100], 2)).toBe(80);
    // …pero nunca proyecta negativo.
    expect(projectSnapshot([50, 10], 3)).toBe(0);
    // un solo dato no tiene pendiente: plana.
    expect(projectSnapshot([100], 3)).toBe(100);
  });

  it("ignora nulls al final: proyecta el último dato REAL", () => {
    expect(projectSnapshot([100, 150, null as any])).toBe(150);
  });

  it("una serie vacía o toda en cero proyecta 0, no NaN", () => {
    expect(projectSnapshot([])).toBe(0);
    expect(projectSnapshot([0, 0])).toBe(0);
  });
});

describe("proyección de flujos", () => {
  it("extrapola linealmente al cierre del mes", () => {
    // 300 en 10 días de un mes de 30 → 900 al cierre.
    expect(projectFlow(300, 10, 20)).toBeCloseTo(900, 10);
  });

  it("un mes ya cerrado no se proyecta: devuelve el total tal cual", () => {
    expect(projectFlow(300, 30, 0)).toBe(300);
  });

  it("no divide por cero", () => {
    expect(projectFlow(300, 0, 30)).toBe(300);
    expect(projectFlow(0, 10, 20)).toBe(0);
  });
});

describe("una sola regla por métrica (Metas, Rendimiento y el deck deben coincidir)", () => {
  // Este bloque existe por un bug real: Metas proyectaba Active Drivers como
  // máx × 1.4 y Presentación 2.0 lo proyectaba plano (= último período), con un
  // comentario en el código argumentando explícitamente contra el ×1.4. Para el
  // MISMO partner y el MISMO mes, las dos pantallas daban números distintos — y
  // el deck es lo que ve el partner.
  it("la proyección de AD no depende de quién la llame", () => {
    const serie = [100, 150, 120];
    const desdeMetas = projectSnapshot(serie);
    const desdeDeck  = projectSnapshot(serie);
    expect(desdeMetas).toBe(desdeDeck);
    expect(desdeMetas).toBe(120);
  });

  it("proyectar un flujo desde la serie o desde el total da lo mismo", () => {
    // metas.ts pasa la serie (proyA); presentacion2.ts pasa el total ya sumado.
    // Si estas dos se separaran, N+R diferiría entre Metas y el deck.
    const serie = [100, 120, 80];
    const total = serie.reduce((a, b) => a + b, 0);
    expect(projectFlow(total, 10, 20)).toBeCloseTo(projectFlow(300, 10, 20), 10);
    expect(projectFlow(total, 10, 20)).toBeCloseTo(900, 10);
  });

  it("con proyección PLANA, agregar por ciudad y proyectar da lo mismo", () => {
    // Con el máx ×1.4 esto NO valía (caso Lizzo jul 2026: Lima picaba una
    // semana y Arequipa otra → la suma de máximos era un número que nunca
    // ocurrió; obligó a proyectar sobre la serie agregada vía snapSeries).
    // Con la plana la propiedad se recupera: la suma de los últimos períodos
    // por ciudad ES el último período del total. snapSeries queda inofensivo.
    const lima     = [2490, 2450, 2400];
    const arequipa = [222, 229, 219];
    const trujillo = [50, 39, 40];
    const total    = lima.map((_, i) => lima[i] + arequipa[i] + trujillo[i]);

    const sumaDePlanas  = projectSnapshot(lima) + projectSnapshot(arequipa) + projectSnapshot(trujillo);
    const planaDelTotal = projectSnapshot(total);
    expect(sumaDePlanas).toBe(planaDelTotal);
    expect(planaDelTotal).toBe(2659);
  });

  it("el FACT y la proyección PLANA de un snapshot coinciden a fin de mes", () => {
    // Con la plana, "¿cuántos hay hoy?" y "¿en cuánto cerrará el mes?" dan el
    // mismo número a propósito: el backtest mostró que el nivel actual es el
    // mejor estimador del cierre en una cartera plana (error medio 3.4%).
    const serie = [100, 150, 120];
    expect(snapshotValue(serie)).toBe(120);
    expect(projectSnapshot(serie)).toBe(120);
  });
});

describe("tasas", () => {
  it("la aceptación se pondera por viajes, no se promedia a secas", () => {
    // Partner A: 90% sobre 1000 viajes. Partner B: 50% sobre 10 viajes.
    // Promedio simple daría 70% — engañoso. Ponderado ≈ 89.6%.
    const w = weightedAvg([[90, 1000], [50, 10]]);
    expect(w).toBeCloseTo((90 * 1000 + 50 * 10) / 1010, 10);
    expect(w).toBeGreaterThan(89);
  });

  it("peso total 0 devuelve 0, nunca NaN", () => {
    expect(weightedAvg([[90, 0]])).toBe(0);
    expect(weightedAvg([])).toBe(0);
    expect(ratio(5, 0)).toBe(0);
  });

  it("el % de cumplimiento con meta 0 es 0, no Infinity", () => {
    expect(attainmentPct(50, 0)).toBe(0);
    expect(attainmentPct(50, 100)).toBe(50);
    expect(attainmentPct(150, 100)).toBe(150);   // el overachievement no se recorta
  });
});

describe("retención", () => {
  it("descuenta del AD actual lo que entró en el período", () => {
    // Base 100 → hoy 110, de los cuales 20 son nuevos y 5 reactivados:
    // sobreviven 110-20-5 = 85 de los 100 anteriores → 85%.
    expect(retentionSeries([100, 110], [0, 20], [0, 5])![1]).toBeCloseTo(0.85, 10);
  });

  it("el primer período y una base de 0 dan null, no 0", () => {
    // Un 0 se promediaría después como "perdimos a todos"; null se excluye.
    const r = retentionSeries([0, 50, 60], [0, 10, 5], [0, 0, 0]);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();       // AD anterior = 0 → indefinida
    expect(r[2]).toBeCloseTo((60 - 5) / 50, 10);
  });

  it("no recorta los negativos", () => {
    // Entraron más de los que hay activos hoy: churn severo. Recortarlo a 0
    // escondería justo el caso que hay que mirar.
    expect(retentionSeries([100, 50], [0, 60], [0, 0])![1]).toBeLessThan(0);
  });

  it("un hueco en el AD actual da null, no fabrica churn", () => {
    // ad[1] = null (ese período no tiene dato, no es "cero conductores").
    // Antes (ad[i]||0) lo trataba como 0 → (0-10-0)/100 = -0.10, un "churn
    // severo" falso por un dato faltante.
    const r = retentionSeries([100, null as any, 90], [0, 5, 3], [0, 0, 1]);
    expect(r[1]).toBeNull();
    // prev de i=2 es ad[1]=null → también indefinida (no se puede tomar % de un hueco)
    expect(r[2]).toBeNull();
  });
});

describe("rollups", () => {
  const A = { ad: 10, nr: 5, sh: 100, projAd: 14, projNr: 10, projSh: 200 };
  const B = { ad: 20, nr: 7, sh: 300, projAd: 28, projNr: 14, projSh: 600 };

  it("suma snapshots de unidades distintas (Lima + Arequipa son gente distinta)", () => {
    expect(sumKpis([A, B]).ad).toBe(30);
    expect(sumKpis([A, B]).sh).toBe(400);
  });

  it("tolera huecos sin romperse", () => {
    expect(sumKpis([A, null as any, B]).nr).toBe(12);
    expect(sumKpis([])).toEqual({ ad: 0, nr: 0, sh: 0, projAd: 0, projNr: 0, projSh: 0 });
  });

  it("agrupa por clave derivada y suma", () => {
    const units = new Map([["P1|||LIMA", A], ["P2|||LIMA", B], ["P3|||AQP", A]]);
    const byCity = groupSum(units, k => k.split("|||")[1], v => v);
    expect(byCity.get("LIMA")!.ad).toBe(30);
    expect(byCity.get("AQP")!.ad).toBe(10);
  });

  it("una clave null excluye la unidad del rollup", () => {
    const units = new Map([["P1|||LIMA", A], ["P2|||", B]]);
    const byCity = groupSum(units, k => k.split("|||")[1] || null, v => v);
    expect(byCity.size).toBe(1);
    expect(byCity.get("LIMA")!.ad).toBe(10);
  });
});

describe("seriesByDate", () => {
  it("ordena por fecha ascendente — el orden define cuál es 'el último'", () => {
    // Iterar el objeto en su orden de inserción daría 80 como último y por lo
    // tanto un snapshot equivocado.
    expect(seriesByDate({ "2026-03-01": 120, "2026-01-01": 80, "2026-02-01": 95 }))
      .toEqual([80, 95, 120]);
    expect(snapshotValue(seriesByDate({ "2026-03-01": 120, "2026-01-01": 80 }))).toBe(120);
  });
});
