import { describe, it, expect } from "vitest";
import {
  snapshotValue, flowValue, projectSnapshot, projectFlow,
  weightedAvg, ratio, attainmentPct, sumKpis, groupSum, seriesByDate, retentionSeries,
  AD_PROJECTION_FACTOR, horasPorConductorBase, TK_HORAS_BASE_MIN, TK_MIN_ACTIVOS,
  pacingFlujo, median
} from "./metrics.js";
import { pColor, pEstado } from "../core/format.js";

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
  it("usa el MÁXIMO del rango × 1.4 (regla de negocio, RESTAURADA 29-ago-2026)", () => {
    // Se probaron plana y tendencia el mismo día: más precisas como pronóstico
    // pero en una cartera plana coinciden con el avance y "no se ve" la
    // proyección. Manuel decidió volver al ×1.4 con el backtest a la vista:
    // se lee como POTENCIAL, no como estimación fina. Historial en metrics.ts.
    expect(projectSnapshot([100, 150, 120])).toBeCloseTo(150 * 1.4, 10);
    expect(AD_PROJECTION_FACTOR).toBe(1.4);
  });

  it("el 2do argumento (horizonte de calendario) se ignora — plumbing en espera", () => {
    expect(projectSnapshot([100, 150, 120], 2)).toBeCloseTo(210, 10);
  });

  it("ignora nulls: el máximo se toma sobre los datos reales", () => {
    expect(projectSnapshot([100, 150, null as any])).toBeCloseTo(210, 10);
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
    expect(desdeMetas).toBeCloseTo(210, 10);
  });

  it("proyectar un flujo desde la serie o desde el total da lo mismo", () => {
    // metas.ts pasa la serie (proyA); presentacion2.ts pasa el total ya sumado.
    // Si estas dos se separaran, N+R diferiría entre Metas y el deck.
    const serie = [100, 120, 80];
    const total = serie.reduce((a, b) => a + b, 0);
    expect(projectFlow(total, 10, 20)).toBeCloseTo(projectFlow(300, 10, 20), 10);
    expect(projectFlow(total, 10, 20)).toBeCloseTo(900, 10);
  });

  it("la proyección de un snapshot NO se puede sumar hacia arriba", () => {
    // Caso real (Lizzo, jul 2026): Lima picó 2490 en una semana y Arequipa 229
    // en OTRA. Sumar los máximos por ciudad da un número que nunca ocurrió; la
    // única lectura fiel es el máximo de la serie TOTAL. Por eso metas/deck
    // proyectan sobre la serie agregada (snapSeries / _combAdByDate).
    const lima     = [2490, 2450, 2400];
    const arequipa = [222, 229, 219];
    const trujillo = [50, 39, 40];
    const total    = lima.map((_, i) => lima[i] + arequipa[i] + trujillo[i]);

    const sumaDeMaximos  = projectSnapshot(lima) + projectSnapshot(arequipa) + projectSnapshot(trujillo);
    const maximoDelTotal = projectSnapshot(total);
    expect(maximoDelTotal).toBeCloseTo(2762 * 1.4, 6);
    expect(sumaDeMaximos).toBeGreaterThan(maximoDelTotal);
  });

  it("el FACT es el último período; la proyección, el máximo × 1.4 — no se mezclan", () => {
    // El FACT responde "¿cuántos hay hoy?"; la proyección, "¿el potencial del
    // mes?". Colapsarlas fue el origen de una divergencia deck-vs-Metas.
    const serie = [100, 150, 120];
    expect(snapshotValue(serie)).toBe(120);
    expect(projectSnapshot(serie)).toBeCloseTo(210, 10);
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

describe("meta paraguas: AD/N+R/SH de Taxi YA incluyen TukTuk", () => {
  // Regla de negocio confirmada por Manuel (ago 2026) y verificada contra
  // producción: meta_active_drivers/meta_nr/meta_supply_hours cubren Taxi +
  // TukTuk juntos. En los partners con meta TukTuk, meta_tk_ad/meta_ad coincide
  // con la participación de TukTuk sobre el TOTAL (Flota Pe: 167/972 = 17,2% y
  // el real era 116/673 = 17,2%), no sobre el taxi (20,8%).
  //
  // El deck sumaba las dos metas e inflaba el objetivo: TRANSPOTAXI Lima
  // mostraba 3.785 en vez de 2.661 → 60% de avance cuando el real era 86%.
  // Este test fija la aritmética para que no vuelva a pasar.
  const metaUmbrella = 2661;   // meta_active_drivers, Lima, agosto
  const metaTkVieja  = 1124;   // meta_tk_ad (OBSOLETA desde ago 2026)
  const realTaxi     = 1442;
  const realTuktuk   = 835;

  it("el avance combinado se mide contra la meta paraguas sola", () => {
    const avance = (realTaxi + realTuktuk) / metaUmbrella * 100;
    expect(avance).toBeCloseTo(85.6, 1);
  });

  it("sumar meta_tk_* a la paraguas infla el objetivo y hunde el avance", () => {
    const inflada = metaUmbrella + metaTkVieja;
    const avanceMalo = (realTaxi + realTuktuk) / inflada * 100;
    expect(inflada).toBe(3785);
    expect(avanceMalo).toBeCloseTo(60.2, 1);
    expect(avanceMalo).toBeLessThan(70);   // el error se ve como incumplimiento
  });
});

describe("criterios TukTuk: horas por conductor base", () => {
  // Denominador = conductores que YA estaban (activos - nuevos - reactivados).
  // La elección de denominador decide el veredicto, así que va fijada por test.

  it("divide por la BASE, no por los activos — con datos reales de PIAGGIO", () => {
    // PIAGGIO, agosto 2026 (mensual): sh 3363, ad 161, n+r 84 → base 77.
    // Por base:    3363/77  = 43,7h → CUMPLE
    // Por activos: 3363/161 = 20,9h → habría incumplido. No es lo mismo.
    const r = horasPorConductorBase(3363, 161, 84, 0);
    expect(r.base).toBe(77);
    expect(r.valor!).toBeCloseTo(43.7, 1);
    expect(r.estado).toBe("cumple");
    expect(3363 / 161).toBeCloseTo(20.9, 1);   // el otro denominador, para dejarlo a la vista
  });

  it("Lizzo y TRANSPOTAXI de agosto cumplen", () => {
    expect(horasPorConductorBase(102866, 1437, 348, 0).valor!).toBeCloseTo(94.5, 1);
    expect(horasPorConductorBase(79154, 1370, 465, 0).valor!).toBeCloseTo(87.5, 1);
  });

  it("bajo TK_MIN_ACTIVOS el criterio NO aplica: valor null y estado propio", () => {
    // No es "incumple" — es que la muestra es muy chica para que el ratio
    // signifique algo. La UI tiene que decir por qué, no mostrar un 0.
    const r = horasPorConductorBase(1200, 49, 5, 5);
    expect(r.estado).toBe("pocos_activos");
    expect(r.valor).toBeNull();
    expect(TK_MIN_ACTIVOS).toBe(50);
  });

  it("exactamente TK_MIN_ACTIVOS activos SÍ aplica (el umbral es inclusivo)", () => {
    expect(horasPorConductorBase(1200, 50, 5, 5).estado).not.toBe("pocos_activos");
  });

  it("base <= 0 no es incumplimiento: es no medible", () => {
    // Todos los activos entraron este mes → no hay conductores base.
    // Caso real en escala semanal (YevoGo base -6): sin este guard saldría un
    // ratio negativo gigante en pantalla.
    const r = horasPorConductorBase(8256, 81, 87, 0);
    expect(r.base).toBeLessThan(0);
    expect(r.estado).toBe("sin_base");
    expect(r.valor).toBeNull();
  });

  it("el umbral de 24h es inclusivo", () => {
    expect(horasPorConductorBase(24 * 100, 200, 100, 0).estado).toBe("cumple");
    expect(horasPorConductorBase(23.9 * 100, 200, 100, 0).estado).toBe("no_cumple");
    expect(TK_HORAS_BASE_MIN).toBe(24);
  });

  it("no explota con ceros", () => {
    expect(horasPorConductorBase(0, 0, 0, 0).estado).toBe("pocos_activos");
    expect(horasPorConductorBase(0, 100, 0, 0).valor).toBe(0);
  });
});

describe("ritmo del mes (pacing)", () => {
  it("compara avance contra calendario: 50% del mes con 50% de la meta = en ritmo", () => {
    const r = pacingFlujo(50, 100, 15, 30);
    expect(r.pctMeta).toBe(50);
    expect(r.pctMes).toBe(50);
    expect(r.estado).toBe("en_ritmo");
  });

  it("detecta atraso y adelanto con umbral de 5pp", () => {
    expect(pacingFlujo(40, 100, 15, 30).estado).toBe("atrasado");    // 40% vs 50% → -10pp
    expect(pacingFlujo(60, 100, 15, 30).estado).toBe("adelantado");  // +10pp
    expect(pacingFlujo(46, 100, 15, 30).estado).toBe("en_ritmo");    // -4pp, dentro del ruido
  });

  it("sin meta no inventa un ritmo", () => {
    // Un 0% acá se leería como "vas atrasadísimo" cuando en realidad no se mide.
    expect(pacingFlujo(50, 0, 15, 30).estado).toBe("sin_meta");
    expect(pacingFlujo(50, 0, 15, 30).ritmo).toBeNull();
  });

  it("el mes cerrado no pasa de 100% de calendario", () => {
    expect(pacingFlujo(90, 100, 31, 30).pctMes).toBe(100);
  });
});

describe("mediana (para el benchmark del cohorte)", () => {
  it("impar toma el del medio; par promedia los dos centrales", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("ignora nulls y NaN, no los cuenta como 0", () => {
    // Un null contado como 0 hundiría la mediana del cohorte.
    expect(median([2, null, 4, undefined, NaN as any])).toBe(3);
  });

  it("lista vacía da null, no 0", () => {
    expect(median([])).toBeNull();
    expect(median([null, null])).toBeNull();
  });
});

describe("escala de cumplimiento (pColor/pEstado)", () => {
  // Vive en core/format pero la regla es de NEGOCIO: define qué se le muestra
  // en verde a la gerencia del partner. Se testea acá para que un cambio de
  // umbral sea deliberado y no un ajuste suelto.
  it("verde significa CUMPLIÓ, no 'casi'", () => {
    // Antes 80% era verde: un partner 20% corto se leía como cumplido.
    expect(pEstado(80)).toBe("cerca");
    expect(pEstado(99.9)).toBe("cerca");
    expect(pEstado(100)).toBe("cumplio");
  });

  it("sobrecumplir por poco NO es lo mismo que duplicar la meta", () => {
    // 101% y 208% pintaban idénticos. Un 208% es una meta mal calibrada.
    expect(pEstado(105)).toBe("cumplio");
    expect(pEstado(150)).toBe("cumplio");
    expect(pEstado(208)).toBe("meta_desalineada");
  });

  it("debajo de 80 es atrasado", () => {
    expect(pEstado(79.9)).toBe("atrasado");
    expect(pEstado(0)).toBe("atrasado");
  });

  it("el color y la etiqueta usan el MISMO corte (no pueden contradecirse)", () => {
    const verde = "#10b981", ambar = "#f59e0b", rojo = "#FF0000", morado = "#8b5cf6";
    const esperado = { cumplio: verde, cerca: ambar, atrasado: rojo, meta_desalineada: morado };
    for (const p of [0, 50, 79.9, 80, 99.9, 100, 150, 150.1, 208, 400]) {
      expect(pColor(p)).toBe(esperado[pEstado(p)]);
    }
  });
});
