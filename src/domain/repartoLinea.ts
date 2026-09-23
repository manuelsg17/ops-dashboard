import { t } from "../core/i18n";
// ─────────────────────────────────────────────────────────────────────────────
// REPARTO CON CARVE-OUT DE TUKTUK
//
// QUE PROBLEMA RESUELVE. La meta que baja de PnL es UNA por KAM (ej. AD 15.473),
// y por separado viene qué PORCENTAJE de esa meta corresponde a TukTuk (17,0%).
// Ese porcentaje se declara en los Loyalty Programs, así que el número que el
// KAM reporta y el que efectivamente reparte entre sus partners tienen que ser
// EL MISMO. Decisión de Manuel (sep 2026): manda el porcentaje DECLARADO.
//
// Eso obliga a repartir en dos pozos y no en uno:
//
//     pozo TukTuk = meta × pct        → entre las porciones TukTuk, por su peso
//     pozo Car    = meta × (1 − pct)  → entre las porciones Taxi,   por su peso
//
// Antes había UN solo pozo sobre la base combinada, y TukTuk se llevaba su peso
// NATURAL. Medido contra producción (agosto 2026), el peso natural y el
// declarado casi coinciden —el jefe calculó el declarado MIRANDO ese peso— pero
// no son idénticos: para Manuel da 16,70% real contra 17,0% declarado, que sobre
// 15.473 son 46 conductores. Con un solo pozo esa diferencia es imposible de
// cerrar; con dos, el total de TukTuk cae exactamente en el declarado.
//
// POR QUE UNA UNIDAD PUEDE TENER LAS DOS PORCIONES. La unidad de reparto es
// (partner, ciudad), y hay partners que operan Taxi Y TukTuk en la MISMA ciudad
// —Lizzo, ArequipaGo y YEGO en Lima, verificado contra la BD—. Por eso cada
// unidad lleva `valTk` aparte de `valTotal` en vez de una bandera booleana: no
// se puede clasificar la unidad entera de un lado.
//
// PURO: no lee STATE ni toca el DOM.
// ─────────────────────────────────────────────────────────────────────────────

export interface UnidadReparto {
  /** Clave de la unidad, típicamente "partner|||ciudad". */
  key: string;
  /** Valor total de la unidad en el KPI (Taxi + TukTuk). */
  valTotal: number;
  /** Porción TukTuk de ese valor. 0 si la unidad no tiene TukTuk. */
  valTk: number;
}

export interface CuotaUnidad {
  key: string;
  /** Cuota total asignada a la unidad (car + tk). */
  total: number;
  /** Parte de la cuota que corresponde a TukTuk → va a meta_tk_*. */
  tk: number;
  /** Parte Taxi. `total − tk`. */
  car: number;
}

export interface ResultadoReparto {
  cuotas: CuotaUnidad[];
  /** Suma repartida. Debe dar `meta` salvo que no haya ninguna base. */
  asignado: number;
  /** Total que cayó en TukTuk. Con base suficiente = meta × pct exacto. */
  totalTk: number;
  /**
   * Avisos accionables. NO se corrige en silencio: que el pozo TukTuk no tenga
   * dónde caer es un dato de configuración (falta taggear un fleetroom), y
   * repartirlo calladamente entre los de Taxi escondería el problema.
   */
  avisos: string[];
}

/**
 * Reparte `meta` entre las unidades respetando el % declarado de TukTuk.
 *
 * @param meta  Meta global del KAM para este KPI.
 * @param pctTk Fracción declarada de TukTuk, 0..1 (0,17 = 17%).
 */
export function repartirPorLinea(
  meta: number,
  pctTk: number,
  unidades: UnidadReparto[]
): ResultadoReparto {
  const avisos: string[] = [];
  const m = +meta || 0;
  // Fuera de 0..1 no es una fracción: recortar en silencio daría un reparto que
  // no suma la meta y nadie sabría por qué.
  let p = +pctTk || 0;
  if (p < 0 || p > 1) {
    avisos.push(t("reparto.pctFuera", { p: (p * 100).toFixed(1), v: p < 0 ? "0" : "100" }));
    p = p < 0 ? 0 : 1;
  }

  const us = (unidades || []).map(u => ({
    key: u.key,
    tk:  Math.max(+u.valTk || 0, 0),
    // Una porción Taxi negativa solo puede venir de datos inconsistentes
    // (valTk > valTotal). Se recorta a 0 en vez de restarle peso al resto.
    car: Math.max((+u.valTotal || 0) - (+u.valTk || 0), 0)
  }));

  const sumTk  = us.reduce((s, u) => s + u.tk, 0);
  const sumCar = us.reduce((s, u) => s + u.car, 0);

  let potTk  = m * p;
  let potCar = m - potTk;

  // Un pozo sin base no se puede repartir. Se pasa al otro para que la meta del
  // KAM siga cerrando —perder la diferencia sería peor—, pero SIEMPRE avisando.
  if (potTk > 0 && sumTk === 0) {
    avisos.push(t("reparto.sinTk", { p: (p * 100).toFixed(1) }));
    potCar += potTk; potTk = 0;
  }
  if (potCar > 0 && sumCar === 0 && sumTk > 0) {
    avisos.push(t("reparto.soloTk"));
    potTk += potCar; potCar = 0;
  }

  const cuotas = us.map(u => {
    const tk  = sumTk  > 0 ? potTk  * (u.tk  / sumTk)  : 0;
    const car = sumCar > 0 ? potCar * (u.car / sumCar) : 0;
    return { key: u.key, total: tk + car, tk, car };
  });

  return {
    cuotas,
    asignado: cuotas.reduce((s, c) => s + c.total, 0),
    totalTk:  cuotas.reduce((s, c) => s + c.tk, 0),
    avisos
  };
}

/**
 * Peso NATURAL de TukTuk en una base, como fracción 0..1. `null` si no hay base
 * —no 0: "no se puede medir" y "es cero" son cosas distintas, y mostrar 0,0%
 * cuando no hay datos invita a declarar un 0 que nadie midió.
 *
 * Sirve para contrastar contra el % declarado por PnL y mostrar la brecha.
 */
export function pesoNaturalTk(unidades: UnidadReparto[]): number | null {
  const tot = (unidades || []).reduce((s, u) => s + (+u.valTotal || 0), 0);
  if (tot <= 0) return null;
  const tk = (unidades || []).reduce((s, u) => s + (+u.valTk || 0), 0);
  return tk / tot;
}

export interface SplitResultado {
  /** La parte que queda después de sacar `secundario` — nunca negativa. */
  principal: number;
  /** `round(total × fracción)`. */
  secundario: number;
}

/**
 * Divide un total YA CALCULADO en dos partes según una fracción conocida —
 * esta es la mitad "mostrar" del carve-out, la contraparte de repartirPorLinea
 * (que es la mitad "repartir"). Sirve para la tarjeta del partner: cuando el
 * KAM ajusta a mano el total de una meta, la porción TukTuk tiene que re-partir
 * ESE número nuevo con la misma proporción, no quedar pegada al valor de antes
 * del ajuste.
 *
 * REDONDEA EL SECUNDARIO PRIMERO Y RESTA PARA EL PRINCIPAL — nunca al revés.
 * Redondear los dos lados por separado puede no sumar el total exacto (fue un
 * bug real: una tarjeta mostrando "2.414,64 conductores" en la fila partida,
 * porque el total ya venía entero pero el producto por la fracción no). Con
 * esta construcción, `principal + secundario === total` SIEMPRE, sin excepción.
 */
export function splitPorFraccion(total: number, fraccion: number): SplitResultado {
  const t = +total || 0;
  const f = Math.min(Math.max(+fraccion || 0, 0), 1);
  const secundario = Math.round(t * f);
  return { principal: t - secundario, secundario };
}
