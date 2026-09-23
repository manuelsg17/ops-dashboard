import { describe, it, expect } from "vitest";
import { p2Lectura, p2Accion, p2SenalesEjecutivas, SENALES_UMBRALES } from "./lectura.js";

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

  it("sin metas cargadas NO afirma que están cubiertas", () => {
    // Visto en un partner sin metas del mes: la hoja decía "metas cubiertas"
    // junto a tres KPIs rotulados "sin meta cargada" — afirmaba un cumplimiento
    // que nadie midió.
    const sinMetas = { ...base,
      kpis: base.kpis.map(k => ({ ...k, meta: 0, pct: 0 })),
      verticales: [{ label: "Taxi", varPct: 1 }] };
    const t = p2Lectura(sinMetas);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatch(/No hay metas cargadas/);
    expect(t[0]).not.toMatch(/cubiertas/);
  });

  it("con el mes cerrado no promete días que no quedan", () => {
    const t = p2Lectura({ ...base, diasRestantes: 0 }).join(" ");
    expect(t).toMatch(/mes ya cerrado/);
    expect(t).not.toMatch(/quedan 0/);
  });
});

describe("reglas nuevas (sep 2026)", () => {
  // Los kpis del Ejecutivo llevan `flujo`: solo N+R y horas se acumulan, asi que
  // solo esos se pueden comparar contra el calendario.
  const conFlujo = base.kpis.map(k => ({ ...k, flujo: k.key !== "ad" }));

  it("ritmo: dice el % del mes transcurrido y proyecta el cierre", () => {
    // 25% de la meta con 23 de 31 dias pasados (74%) = atrasado de verdad.
    const ctx = { ...base, diasRestantes: 8, diasMes: 31,
      kpis: [{ key: "nr", lbl: "Nuevos + Reactivados", real: 100, meta: 400, pct: 25, fmt, flujo: true }] };
    const t = p2Lectura(ctx).join(" ");
    expect(t).toContain("74%");        // mes transcurrido
    expect(t).toMatch(/en 135 \(34% de la meta\)/);   // 100 / 0.74 al cierre
  });

  it("ritmo NO se aplica a Active Drivers (es un nivel, no se acumula)", () => {
    const ctx = { ...base, diasRestantes: 8, diasMes: 31,
      kpis: [{ key: "ad", lbl: "Conductores Activos", real: 100, meta: 400, pct: 25, fmt, flujo: false }] };
    const t = p2Lectura(ctx).join(" ");
    expect(t).not.toContain("del mes transcurrido");
  });

  it("conductores cumplidos pero horas no: lo llama problema de actividad", () => {
    const ctx = { ...base, verticales: [],
      kpis: [
        { key: "ad", lbl: "Conductores Activos", real: 100, meta: 100, pct: 100, fmt, flujo: false },
        { key: "sh", lbl: "Horas de Conexión",   real: 70,  meta: 100, pct: 70,  fmt, flujo: true }
      ] };
    const t = p2Lectura(ctx).join(" ");
    expect(t).toMatch(/actividad, no de captación/);
  });

  it("benchmark: solo habla si la brecha es material (>=15%)", () => {
    const chico = { ...base, bench: { peor: { label: "Viajes por hora", valor: "1.90", mediana: "2.00", gapPct: -5 } } };
    expect(p2Lectura(chico).join(" ")).not.toContain("por debajo de la mediana");
    const grande = { ...base, bench: { peor: { label: "Viajes por hora", valor: "1.50", mediana: "2.00", gapPct: -25 } } };
    expect(p2Lectura(grande).join(" ")).toMatch(/25% por debajo de la mediana/);
  });

  it("embudo: traduce la fuga a CONDUCTORES, no a puntos porcentuales", () => {
    const ctx = { ...base, funnel: { mio: 21, mediana: 48, faltan: 57, perfiles: 168 } };
    const t = p2Lectura(ctx).join(" ");
    expect(t).toContain("57 conductores más");
    expect(t).toContain("100 perfiles");
  });

  it("con el bloque del embudo al lado, la lectura NO lo repite", () => {
    // El Ejecutivo dibuja el embudo en la columna de al lado: repetir el mismo
    // numero a 3 cm gasta una de las 4 frases y se lee como relleno.
    const ctx = { ...base, funnel: { mio: 21, mediana: 48, faltan: 57, perfiles: 168 }, funnelEnBloque: true };
    expect(p2Lectura(ctx).join(" ")).not.toContain("57 conductores más");
    // la ACCION si lo dice: es lo unico que se pide hacer.
    const sinBrecha = { ...ctx, kpis: base.kpis.map(k => ({ ...k, real: k.meta, pct: 100 })) };
    expect(p2Accion(sinBrecha)).toMatch(/activación/);
  });

  it("nunca mas de 4 frases: la portada no es un informe", () => {
    const ctx = { ...base, diasRestantes: 20, diasMes: 31, kpis: conFlujo,
      bench:  { peor: { label: "Viajes por hora", valor: "1.50", mediana: "2.00", gapPct: -25 } },
      funnel: { mio: 21, mediana: 48, faltan: 57, perfiles: 168 } };
    expect(p2Lectura(ctx).length).toBeLessThanOrEqual(4);
  });

  it("sin brecha de meta pero con fuga de embudo, la accion es activacion", () => {
    const ctx = { ...base, kpis: base.kpis.map(k => ({ ...k, real: k.meta, pct: 100 })),
      funnel: { mio: 21, mediana: 48, faltan: 57, perfiles: 168 } };
    expect(p2Accion(ctx)).toMatch(/activación/);
  });

  it("ruso: no cae a espanol", () => {
    const t = p2Lectura({ ...base, lang: "ru" }).join(" ");
    expect(t).toMatch(/[а-яА-Я]/);
    expect(t).not.toMatch(/quedan|Faltan/);
  });
});

describe("umbral de meta cumplida = 95%", () => {
  it("un 96% NO se reporta como faltante: ya cumplió", () => {
    // Con el corte en 100 este caso decia "faltan X" mientras la barra estaba
    // verde — el informe se contradecia solo.
    // verticales sin movimiento: aisla la regla del KPI (si no, la caída de
    // TukTuk que trae `base` dispara otra frase y el test mide otra cosa).
    const casi = { ...base, verticales: [{ label: "Taxi", varPct: 1 }],
      kpis: [{ key: "ad", lbl: "Conductores Activos", real: 960, meta: 1000, pct: 96, fmt }] };
    expect(p2Lectura(casi)[0]).toMatch(/cubiertas/);
    expect(p2Accion(casi)).toBeNull();
  });

  it("un 94% sí es faltante", () => {
    const corto = { ...base, kpis: [{ key: "ad", lbl: "Conductores Activos", real: 940, meta: 1000, pct: 94, fmt }] };
    expect(p2Lectura(corto).join(" ")).toContain("60");
    expect(p2Accion(corto)).not.toBeNull();
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

// ── Señales ejecutivas (mudadas desde Vista Partner, Ola 6) ──────────────────
// Mismos umbrales que tenía _pvExecutiveSummary. Cada test aísla UNA regla con
// un contexto "neutro" que no dispara ninguna otra.
describe("señales ejecutivas del deck (ex Vista Partner)", () => {
  const fmtN = (n: number) => String(Math.round(n));
  const fmtDec = (n: number, d: number) => n.toFixed(d);
  const neutro = {
    lang: "es", unidades: "semanas", fmt: fmtN, fmtDec,
    serieAD: [100, 102, 101, 99, 100, 101],   // estable, 6 períodos
    picoAD: 120,                              // 101/120 = 84%: ni pico ni bajo
    recibeLeads: true, nuevos: { total: 20, yango: 4 },
    comision: { comPrev: 1000, viajesPrev: 1000, comAct: 1000, viajesAct: 1000 },
    ciudades: [{ label: "Lima", ad: 80 }, { label: "Arequipa", ad: 40 }]
  };
  const kinds = (ctx: any) => p2SenalesEjecutivas(ctx).map(s => s.kind);

  it("un contexto neutro no dispara nada", () => {
    expect(p2SenalesEjecutivas(neutro)).toEqual([]);
  });

  it("volatilidad: CV ≥ 25% con 6+ períodos", () => {
    const s = p2SenalesEjecutivas({ ...neutro, serieAD: [50, 150, 60, 140, 55, 101], picoAD: 150 });
    const v = s.find(x => x.kind === "volatilidad")!;
    expect(v.sev).toBe("mid");
    expect(v.detail).toMatch(/\d+% .*6 semanas/);
  });

  it("volatilidad: con menos de 6 períodos no se juzga", () => {
    expect(kinds({ ...neutro, serieAD: [50, 150, 60, 140, 101], picoAD: 150 })).not.toContain("volatilidad");
  });

  it("volatilidad: los períodos en 0 no cuentan (y con <4 con dato no se juzga)", () => {
    expect(kinds({ ...neutro, serieAD: [0, 0, 0, 50, 150, 101], picoAD: 150 })).not.toContain("volatilidad");
  });

  it("pico: ≥95% del pico es señal POSITIVA (sev ok) con los tres números", () => {
    const s = p2SenalesEjecutivas({ ...neutro, picoAD: 104 }).find(x => x.kind === "pico_mejor")!;
    expect(s.sev).toBe("ok");
    expect(s.detail).toContain("101");
    expect(s.detail).toContain("97%");
    expect(s.detail).toContain("104");
  });

  it("pico: <60% del pico avisa potencial desaprovechado; entre 60 y 95 no dice nada", () => {
    expect(kinds({ ...neutro, picoAD: 200 })).toContain("pico_bajo");
    expect(kinds({ ...neutro, picoAD: 150 })).not.toContain("pico_bajo");
    expect(kinds({ ...neutro, picoAD: 150 })).not.toContain("pico_mejor");
  });

  it("comisión por viaje: cae ≥10% → señal con antes, después y caída", () => {
    const s = p2SenalesEjecutivas({ ...neutro, comision: { comPrev: 1200, viajesPrev: 1000, comAct: 1000, viajesAct: 1000 } })
      .find(x => x.kind === "comision_viaje")!;
    expect(s.detail).toBe("$1.20 → $1.00 (−16.7%)");
    expect(kinds({ ...neutro, comision: { comPrev: 1050, viajesPrev: 1000, comAct: 1000, viajesAct: 1000 } })).not.toContain("comision_viaje");
  });

  it("comisión por viaje: sin base (0 viajes o 0 comisión) no se juzga", () => {
    expect(kinds({ ...neutro, comision: { comPrev: 0, viajesPrev: 1000, comAct: 10, viajesAct: 1000 } })).toEqual([]);
    expect(kinds({ ...neutro, comision: null })).toEqual([]);
  });

  it("dependencia de leads: ≥50% Yango con ≥5 nuevos, solo si recibe leads", () => {
    const d = p2SenalesEjecutivas({ ...neutro, nuevos: { total: 10, yango: 6 } }).find(x => x.kind === "dependencia_leads")!;
    expect(d.detail).toContain("60%");
    expect(d.detail).toContain("6 de 10");
    expect(kinds({ ...neutro, nuevos: { total: 4, yango: 4 } })).not.toContain("dependencia_leads");    // muy pocos
    expect(kinds({ ...neutro, recibeLeads: false, nuevos: { total: 10, yango: 6 } })).not.toContain("dependencia_leads");
  });

  it("brecha entre ciudades: ≥2,5× entre la mejor y la peor con AD", () => {
    const b = p2SenalesEjecutivas({ ...neutro, ciudades: [{ label: "Lima", ad: 300 }, { label: "Trujillo", ad: 100 }, { label: "Arequipa", ad: 0 }] })
      .find(x => x.kind === "brecha_ciudades")!;
    expect(b.detail).toBe("Lima 300 vs Trujillo 100 (3.0×)");   // Arequipa (0) no cuenta
    expect(kinds({ ...neutro, ciudades: [{ label: "Lima", ad: 240 }, { label: "Trujillo", ad: 100 }] })).not.toContain("brecha_ciudades");
    expect(kinds({ ...neutro, ciudades: [{ label: "Lima", ad: 900 }] })).not.toContain("brecha_ciudades");
  });

  it("los umbrales son los de Vista Partner (no se recalibraron al mudar)", () => {
    expect(SENALES_UMBRALES).toMatchObject({ cvMin: 0.25, picoMejor: 95, picoBajo: 60, comisionCaidaPct: 10,
      dependenciaShare: 0.5, dependenciaMinNuevos: 5, brechaRatio: 2.5 });
  });

  it("ruso e inglés: sin español colado", () => {
    const ctx = { ...neutro, serieAD: [50, 150, 60, 140, 55, 101], picoAD: 400, nuevos: { total: 10, yango: 8 } };
    const ru = p2SenalesEjecutivas({ ...ctx, lang: "ru", unidades: "нед." }).map(s => s.title + " " + s.detail).join(" ");
    expect(ru).toMatch(/[а-яА-Я]/);
    expect(ru).not.toMatch(/conductores|de los nuevos|variables/);
    const en = p2SenalesEjecutivas({ ...ctx, lang: "en", unidades: "weeks" }).map(s => s.title + " " + s.detail).join(" ");
    expect(en).not.toMatch(/conductores|de los nuevos/);
  });
});
