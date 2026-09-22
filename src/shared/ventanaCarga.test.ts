import { describe, it, expect } from "vitest";
import {
  LOAD_WINDOW, HOLGURA_SEMANAS, computeWindowStart,
  inicioVentanaSemanalCalendario, planVentanaSemanal
} from "./ventanaCarga.js";
import { lunesDe } from "./frescura.js";

const DIA = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const masDias = (s: string, n: number) => iso(new Date(Date.parse(s + "T00:00:00Z") + n * DIA));

/** Lunes consecutivos de `desde` a `hasta` (inclusive), menos los de `sin`. */
function semanas(desde: string, hasta: string, sin: string[] = []): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta; d = masDias(d, 7)) if (!sin.includes(d)) out.push(d);
  return out;
}

/** Todos los días (a las 12:00 UTC) entre dos fechas, inclusive. */
function dias(desde: string, hasta: string): Date[] {
  const out: Date[] = [];
  for (let d = desde; d <= hasta; d = masDias(d, 1)) out.push(new Date(d + "T12:00:00Z"));
  return out;
}

/**
 * Serie realista para un "hoy": historia larga (desde feb-2026) hasta `ultimo`,
 * con `huecos` = índices contados desde el final (0 = el último) a quitar.
 */
function serie(ultimo: string, huecos: number[] = []): string[] {
  const todas = semanas("2026-02-02", ultimo);
  const sin = huecos.map(k => todas[todas.length - 1 - k]);
  return todas.filter(p => !sin.includes(p));
}

// Rangos de "hoy" que cruzan mes (ago→sep) y año (dic→ene), todos los días de
// la semana incluidos. Más un rango en marzo (febrero corto antes).
const HOYS = [
  ...dias("2026-08-24", "2026-09-13"),
  ...dias("2026-12-21", "2027-01-17"),
  ...dias("2027-02-22", "2027-03-07"),
];

describe("inicio de ventana por calendario", () => {
  it("valores concretos (UTC), siempre un lunes", () => {
    // Martes 22-sep-2026 → lunes 21-sep − 9 semanas.
    expect(inicioVentanaSemanalCalendario(new Date("2026-09-22T12:00:00Z"))).toBe("2026-07-20");
    // Cruce de año: martes 5-ene-2027 → lunes 4-ene − 9 semanas.
    expect(inicioVentanaSemanalCalendario(new Date("2027-01-05T12:00:00Z"))).toBe("2026-11-02");
    for (const hoy of HOYS) {
      expect(new Date(inicioVentanaSemanalCalendario(hoy) + "T00:00:00Z").getUTCDay()).toBe(1);
    }
  });

  it("usa UTC: domingo 23:59 y lunes 00:00 UTC caen en semanas distintas", () => {
    expect(inicioVentanaSemanalCalendario(new Date("2026-09-13T23:59:00Z"))).toBe("2026-07-06");
    expect(inicioVentanaSemanalCalendario(new Date("2026-09-14T00:00:00Z"))).toBe("2026-07-13");
  });

  it("el costo está acotado: en el caso normal carga exactamente HOLGURA semanas de más", () => {
    for (const hoy of HOYS) {
      const lunes = iso(lunesDe(hoy));
      const lista = serie(masDias(lunes, -7));           // semana pasada ya ingestada
      const real = computeWindowStart(lista, "semanal")!;
      const cal = inicioVentanaSemanalCalendario(hoy);
      expect(Math.round((Date.parse(real) - Date.parse(cal)) / (7 * DIA))).toBe(HOLGURA_SEMANAS);
    }
  });
});

describe("INVARIANTE: el calendario nunca empieza después que computeWindowStart", () => {
  // Para cada hoy × estado de la ingesta × hueco: inicioCalendario <= inicio real.
  const estados: Array<[string, number]> = [
    ["semana en curso cargada a mano", 0],
    ["semana pasada ya ingestada", -7],
    ["semana pasada todavía sin ingestar (lunes/martes)", -14],
  ];

  for (const [nombre, offset] of estados) {
    it(`${nombre}: sin huecos y con un hueco en cualquier posición de la ventana`, () => {
      for (const hoy of HOYS) {
        const ultimo = masDias(iso(lunesDe(hoy)), offset);
        const cal = inicioVentanaSemanalCalendario(hoy);
        const casos: number[][] = [[]];
        // Un hueco en cada una de las últimas 10 posiciones (cubre toda la ventana
        // de 7 períodos y el borde inmediatamente anterior).
        for (let k = 1; k < 10; k++) casos.push([k]);
        for (const huecos of casos) {
          const real = computeWindowStart(serie(ultimo, huecos), "semanal")!;
          expect(cal <= real, `hoy=${iso(hoy)} ultimo=${ultimo} huecos=${huecos} cal=${cal} real=${real}`).toBe(true);
        }
      }
    });
  }

  it("semana ingestada + dos huecos dentro de la ventana", () => {
    for (const hoy of HOYS) {
      const ultimo = masDias(iso(lunesDe(hoy)), -7);
      const cal = inicioVentanaSemanalCalendario(hoy);
      for (let a = 1; a < 8; a++) for (let b = a + 1; b < 9; b++) {
        const real = computeWindowStart(serie(ultimo, [a, b]), "semanal")!;
        expect(cal <= real, `hoy=${iso(hoy)} huecos=${a},${b}`).toBe(true);
      }
    }
  });

  it("el hueco en el borde: falta justo el período extra del WoW", () => {
    // Hoy miércoles 9-sep-2026, última ingestada 31-ago. Sin huecos el inicio
    // real es 20-jul; si falta el 20-jul, el período anterior es el 13-jul.
    const hoy = new Date("2026-09-09T12:00:00Z");
    const lista = semanas("2026-02-02", "2026-08-31", ["2026-07-20"]);
    expect(computeWindowStart(lista, "semanal")).toBe("2026-07-13");
    expect(inicioVentanaSemanalCalendario(hoy) <= "2026-07-13").toBe(true);
  });

  it("MÁS ALLÁ de la holgura (ingesta parada 3 semanas) el calendario se queda corto — y por eso existe el plan", () => {
    const hoy = new Date("2026-09-23T12:00:00Z");       // miércoles
    const lista = semanas("2026-02-02", "2026-08-24");  // faltan 31-ago, 7-sep, 14-sep
    const cal = inicioVentanaSemanalCalendario(hoy);
    const real = computeWindowStart(lista, "semanal")!;
    expect(cal > real).toBe(true);
    const plan = planVentanaSemanal(cal, lista);
    expect(plan.complemento).toEqual({ desde: real, hasta: cal });
    expect(plan.loadedFrom).toBe(real);
  });
});

describe("plan de reconciliación", () => {
  it("caso normal: recorta al inicio real, sin complemento", () => {
    const lista = semanas("2026-02-02", "2026-09-14");
    const plan = planVentanaSemanal("2026-07-20", lista);
    expect(plan).toEqual({ loadedFrom: "2026-08-03", recortarDesde: "2026-08-03", complemento: null });
  });

  it("RPC caída (lista vacía): pide todo lo anterior al calendario, como antes (tabla entera)", () => {
    expect(planVentanaSemanal("2026-07-20", [])).toEqual({
      loadedFrom: null, recortarDesde: null, complemento: { desde: null, hasta: "2026-07-20" }
    });
    expect(planVentanaSemanal("2026-07-20", null).complemento).toEqual({ desde: null, hasta: "2026-07-20" });
  });

  it("inicio real igual al del calendario: nada que recortar ni pedir", () => {
    const lista = semanas("2026-02-02", "2026-09-07", ["2026-08-31", "2026-08-24"]);
    const real = computeWindowStart(lista, "semanal")!;
    const plan = planVentanaSemanal(real, lista);
    expect(plan.complemento).toBeNull();
    expect(plan.loadedFrom).toBe(real);
  });

  // Simulación del pipeline completo de _fetchRendSemanal contra una tabla con
  // UNA fila por período: lo que queda en memoria tiene que ser IDÉNTICO a lo
  // que dejaba el camino anterior (RPC → computeWindowStart → gte), en cualquier
  // escenario — incluidos los que la holgura no cubre y la RPC caída.
  it("el resultado final es idéntico al camino anterior en escenarios al azar (semilla fija)", () => {
    // mulberry32: PRNG determinístico de 32 bits (sin pérdida de precisión).
    let seed = 12345;
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ramas = { recorte: 0, complemento: 0, rpcCaida: 0 };

    for (let caso = 0; caso < 2000; caso++) {
      const hoy = new Date(Date.parse("2026-06-01T00:00:00Z") + Math.floor(rnd() * 400) * DIA + Math.floor(rnd() * 24) * 3600000);
      const atraso = Math.floor(rnd() * 6);                          // 0..5 semanas sin ingestar
      const ultimo = masDias(iso(lunesDe(hoy)), -7 * atraso);
      const historia = semanas("2025-10-06", ultimo);
      const tabla = historia.filter(() => rnd() > 0.15);           // ~15% de huecos
      const rpcCaida = rnd() < 0.1;
      const periodosRPC = rpcCaida ? [] : tabla;

      // Camino anterior.
      const winViejo = computeWindowStart(periodosRPC, "semanal");
      const esperado = tabla.filter(f => !winViejo || f >= winViejo);

      // Camino nuevo: ventana por calendario + plan.
      const cal = inicioVentanaSemanalCalendario(hoy);
      const ventana = tabla.filter(f => f >= cal);
      const plan = planVentanaSemanal(cal, periodosRPC);
      let filas = plan.recortarDesde ? ventana.filter(f => f >= plan.recortarDesde!) : ventana;
      if (plan.complemento) {
        const { desde, hasta } = plan.complemento;
        filas = tabla.filter(f => (!desde || f >= desde) && f < hasta).concat(filas);
      }

      expect(filas, `caso ${caso} hoy=${iso(hoy)} atraso=${atraso} rpcCaida=${rpcCaida}`).toEqual(esperado);
      expect(plan.loadedFrom).toBe(winViejo);
      if (rpcCaida) ramas.rpcCaida++;
      else if (plan.complemento) ramas.complemento++;
      else ramas.recorte++;
    }
    // La simulación tiene que haber pasado por las tres ramas, o no prueba nada.
    expect(ramas.recorte).toBeGreaterThan(100);
    expect(ramas.complemento).toBeGreaterThan(100);
    expect(ramas.rpcCaida).toBeGreaterThan(100);
  });
});

describe("computeWindowStart (semántica conservada al moverla)", () => {
  const lista = semanas("2026-06-01", "2026-09-14");
  it("últimos N + uno extra", () => {
    expect(LOAD_WINDOW.semanal).toBe(6);
    expect(computeWindowStart(lista, "semanal")).toBe("2026-08-03");
  });
  it("wantFrom más viejo se respeta, con su período anterior", () => {
    expect(computeWindowStart(lista, "semanal", "2026-07-06")).toBe("2026-06-29");
  });
  it("wantFrom fuera de la lista cae a toda la historia; lista vacía → null", () => {
    expect(computeWindowStart(lista, "semanal", "2026-07-07")).toBe("2026-06-01");
    expect(computeWindowStart([], "semanal")).toBeNull();
  });
});
