import { describe, it, expect } from "vitest";
import { repartirPorLinea, pesoNaturalTk, splitPorFraccion } from "./repartoLinea.js";

// La regla de negocio que estos tests fijan: el % de TukTuk que el KAM reporta
// al Loyalty Program y el que efectivamente reparte entre sus partners tienen
// que ser EL MISMO número. Si alguien vuelve al reparto de un solo pozo, el
// total de TukTuk pasa a ser el peso natural y estos tests fallan.

// Cartera con la forma real de Manuel: partners que operan Taxi Y TukTuk en la
// misma ciudad (Lizzo, ArequipaGo, YEGO en Lima) más partners solo-Taxi.
const cartera = [
  { key: "YEGO|||LIMA",       valTotal: 4599, valTk: 170  },
  { key: "Lizzo|||LIMA",      valTotal: 4025, valTk: 1437 },
  { key: "ArequipaGo|||LIMA", valTotal: 676,  valTk: 411  },
  { key: "Otro|||TRUJILLO",   valTotal: 2781, valTk: 0    }
];

describe("carve-out: el % declarado manda", () => {
  it("TukTuk recibe EXACTAMENTE el % declarado, no su peso natural", () => {
    // Peso natural = 2018/12081 = 16,70%. Declarado = 17,0%.
    const r = repartirPorLinea(15473, 0.17, cartera);
    expect(r.totalTk / r.asignado).toBeCloseTo(0.17, 10);
    expect(r.totalTk).toBeCloseTo(15473 * 0.17, 6);   // 2630,41
  });

  it("el peso natural NO es el declarado — por eso hace falta el carve-out", () => {
    // Si fueran iguales, todo esto sobraría: con un solo pozo TukTuk se llevaría
    // su peso natural y coincidiría con lo declarado. No coinciden.
    // (Sobre la cartera COMPLETA de Manuel en producción la brecha es de 46
    //  conductores; esta fixture es un subconjunto y da 45. Lo que fija el test
    //  es que la brecha existe y es material, no la cifra exacta de producción.)
    const natural = pesoNaturalTk(cartera)!;
    expect(natural).toBeCloseTo(0.1670, 4);
    expect(natural).not.toBeCloseTo(0.17, 4);
    expect(Math.round(15473 * 0.17) - Math.round(15473 * natural)).toBe(45);
  });

  it("la meta se reparte COMPLETA: nada se pierde ni se inventa", () => {
    const r = repartirPorLinea(15473, 0.17, cartera);
    expect(r.asignado).toBeCloseTo(15473, 6);
  });

  it("dentro de cada pozo el reparto sigue siendo por peso", () => {
    const r = repartirPorLinea(15473, 0.17, cartera);
    const c = Object.fromEntries(r.cuotas.map(x => [x.key, x]));
    // TukTuk: Lizzo tiene 1437 de 2018 → 71,2% del pozo TukTuk.
    expect(c["Lizzo|||LIMA"].tk / r.totalTk).toBeCloseTo(1437 / 2018, 10);
    // Taxi: YEGO tiene 4429 de 10063 → su parte del pozo Car.
    const potCar = 15473 * 0.83;
    expect(c["YEGO|||LIMA"].car / potCar).toBeCloseTo(4429 / 10063, 10);
  });

  it("un partner con las dos líneas recibe las dos porciones", () => {
    // Es el caso que impide clasificar la unidad con un booleano.
    const r = repartirPorLinea(15473, 0.17, cartera);
    const lizzo = r.cuotas.find(c => c.key === "Lizzo|||LIMA")!;
    expect(lizzo.tk).toBeGreaterThan(0);
    expect(lizzo.car).toBeGreaterThan(0);
    expect(lizzo.total).toBeCloseTo(lizzo.tk + lizzo.car, 10);
  });

  it("un partner sin TukTuk no recibe nada del pozo TukTuk", () => {
    const r = repartirPorLinea(15473, 0.17, cartera);
    expect(r.cuotas.find(c => c.key === "Otro|||TRUJILLO")!.tk).toBe(0);
  });
});

describe("KAM sin TukTuk (caso Álvaro: 0,0% en los tres KPIs)", () => {
  const soloTaxi = [
    { key: "A|||LIMA", valTotal: 1000, valTk: 0 },
    { key: "B|||LIMA", valTotal: 515,  valTk: 0 }
  ];

  it("con 0% declarado reparte todo por Taxi, sin avisos", () => {
    const r = repartirPorLinea(1515, 0, soloTaxi);
    expect(r.totalTk).toBe(0);
    expect(r.asignado).toBeCloseTo(1515, 6);
    expect(r.avisos).toHaveLength(0);
  });

  it("con un % declarado por error, AVISA en vez de corregir en silencio", () => {
    // Que el pozo no tenga dónde caer suele significar un fleetroom sin taggear.
    // Repartirlo calladamente entre los de Taxi escondería ese problema.
    const r = repartirPorLinea(1515, 0.17, soloTaxi);
    expect(r.asignado).toBeCloseTo(1515, 6);       // la meta igual cierra
    expect(r.totalTk).toBe(0);
    expect(r.avisos.join(" ")).toMatch(/no tiene actividad TukTuk/);
    expect(r.avisos.join(" ")).toMatch(/taggear/);
  });
});

describe("casos degenerados", () => {
  it("cartera 100% TukTuk: la parte Taxi no se pierde", () => {
    const r = repartirPorLinea(1000, 0.2, [{ key: "T|||LIMA", valTotal: 500, valTk: 500 }]);
    expect(r.asignado).toBeCloseTo(1000, 6);
    expect(r.totalTk).toBeCloseTo(1000, 6);
    expect(r.avisos.join(" ")).toMatch(/100% TukTuk/);
  });

  it("sin ninguna base no inventa cuotas", () => {
    const r = repartirPorLinea(1000, 0.17, [{ key: "X|||LIMA", valTotal: 0, valTk: 0 }]);
    expect(r.asignado).toBe(0);
    expect(r.cuotas[0].total).toBe(0);
  });

  it("lista vacía no rompe", () => {
    const r = repartirPorLinea(1000, 0.17, []);
    expect(r.cuotas).toEqual([]);
    expect(r.asignado).toBe(0);
  });

  it("meta 0 da cuotas 0, no NaN", () => {
    const r = repartirPorLinea(0, 0.17, cartera);
    expect(r.asignado).toBe(0);
    expect(r.cuotas.every(c => c.total === 0)).toBe(true);
  });

  it("un % fuera de rango se recorta CON aviso", () => {
    const r = repartirPorLinea(1000, 1.7, cartera);
    expect(r.avisos.join(" ")).toMatch(/fuera de 0–100/);
    expect(r.asignado).toBeCloseTo(1000, 6);
  });

  it("valTk mayor que valTotal no le roba peso al resto", () => {
    // Dato inconsistente: la porción Taxi se recorta a 0, no a un negativo que
    // reduciría el denominador y le subiría la cuota a todos los demás.
    const r = repartirPorLinea(1000, 0.5, [
      { key: "raro|||LIMA", valTotal: 10, valTk: 40 },
      { key: "ok|||LIMA",   valTotal: 90, valTk: 0  }
    ]);
    expect(r.asignado).toBeCloseTo(1000, 6);
    expect(r.cuotas.find(c => c.key === "ok|||LIMA")!.car).toBeCloseTo(500, 6);
  });
});

describe("peso natural", () => {
  it("sin base devuelve null, no 0", () => {
    // 0,0% invita a declarar un cero que nadie midió.
    expect(pesoNaturalTk([])).toBeNull();
    expect(pesoNaturalTk([{ key: "a", valTotal: 0, valTk: 0 }])).toBeNull();
  });

  it("reproduce los % de la tabla de PnL a partir del fact", () => {
    // Rodolfo, agosto 2026: AD TukTuk 4,6%.
    expect(pesoNaturalTk([
      { key: "a", valTotal: 6714 - 309, valTk: 0 },
      { key: "b", valTotal: 309,        valTk: 309 }
    ])!).toBeCloseTo(0.046, 3);
  });
});

describe("splitPorFraccion — la mitad 'mostrar' del carve-out", () => {
  // Fija exactamente el bug real: la tarjeta del partner mostraba "2.414,64
  // conductores" en la fila que se partía, porque el total (3.613, ya entero)
  // se multiplicaba por la fracción TukTuk sin redondear el resultado.
  it("el caso real que rompía: total entero × fracción no entera", () => {
    const r = splitPorFraccion(3613, 1199 / 3613);
    expect(Number.isInteger(r.principal)).toBe(true);
    expect(Number.isInteger(r.secundario)).toBe(true);
    expect(r.principal + r.secundario).toBe(3613);
  });

  it("CASO REAL sep 2026: el desglose NUNCA puede superar al total en la BD", () => {
    // El bug que esto fija: `_calcBuildMetaRows` partía b.adTk (el valor CRUDO
    // del reparto, 573) en vez del total YA AJUSTADO a mano (371, un edit de
    // una sesión anterior con una meta global menor). Se guardó
    // meta_tk_ad=573 > meta_active_drivers=371 en la base real — justo lo que
    // domain/metasGuard existe para evitar. La fracción de una unidad 100%
    // TukTuk es 1.0 (fAd = b.adTk/b.ad = 573/573); partir el total EDITADO por
    // esa fracción tiene que dar el total editado, no el valor viejo.
    const r = splitPorFraccion(371, 1.0);
    expect(r.secundario).toBe(371);
    expect(r.secundario).toBeLessThanOrEqual(371);
    expect(r.principal).toBe(0);
  });

  it("principal + secundario === total, SIEMPRE — la invariante que importa", () => {
    // No "aproximadamente": la tarjeta de un partner con 3 líneas de negocio
    // tiene que sumar exacto o el KAM no puede reconciliarla contra la meta
    // que ya vio en la tabla de reparto.
    for (const [total, f] of [[3613, 0.3318], [1, 0.5], [7, 0.14], [10000, 0.999], [999999, 1/3]]) {
      const r = splitPorFraccion(total, f);
      expect(r.principal + r.secundario).toBe(total);
    }
  });

  it("fracción 0: todo queda en principal", () => {
    expect(splitPorFraccion(3613, 0)).toEqual({ principal: 3613, secundario: 0 });
  });

  it("fracción 1: todo pasa a secundario", () => {
    expect(splitPorFraccion(3613, 1)).toEqual({ principal: 0, secundario: 3613 });
  });

  it("total 0: ambos lados en 0, no NaN", () => {
    expect(splitPorFraccion(0, 0.5)).toEqual({ principal: 0, secundario: 0 });
  });

  it("fracción fuera de 0..1 se recorta, nunca invierte el signo del split", () => {
    // No debería llegar así desde repartirPorLinea, pero un dato corrupto no
    // tiene que producir un secundario mayor que el total ni un principal negativo.
    expect(splitPorFraccion(100, 1.5)).toEqual({ principal: 0, secundario: 100 });
    expect(splitPorFraccion(100, -0.5)).toEqual({ principal: 100, secundario: 0 });
  });

  it("nunca da un principal negativo", () => {
    for (let f = 0; f <= 1; f += 0.05) {
      expect(splitPorFraccion(3613, f).principal).toBeGreaterThanOrEqual(0);
    }
  });
});
