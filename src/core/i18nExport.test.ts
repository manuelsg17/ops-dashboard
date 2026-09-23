import { describe, it, expect } from "vitest";
import { pick, makeT, exportLang, xl, ciudadL, mesL, fmtL, fmtSmartL, fmtDecL, EXPORT_STR } from "./i18nExport";
import { fmt, fmtSmart } from "./format";
import { I18N, kamLabel, mesLabel, t } from "./i18n";
import { SIN_KAM } from "./config";

// Números que cubren las ramas de fmt/fmtSmart: negativos, null, decimales,
// el corte de 10.000 (sin decimales arriba), K y M.
const MUESTRA = [0, null, undefined, 1, -1, 0.5, 12.345, 999.999, 2415, 9999.99, 10000, 10000.4,
  123456.78, -98765.4, 1_000_000, 3_305_781.38, 12_500, 101_000.7];

describe("pick / makeT — cascada de idioma", () => {
  it("ru → en → es, nunca de ruso a español directo si hay inglés", () => {
    expect(pick({ es: "Hola", en: "Hello", ru: "Привет" }, "ru")).toBe("Привет");
    expect(pick({ es: "Hola", en: "Hello" }, "ru")).toBe("Hello");
    expect(pick({ es: "Hola" }, "ru")).toBe("Hola");
    expect(pick({ es: "Hola" }, "en")).toBe("Hola");
    expect(pick({ es: "Hola", en: "Hello" }, "es")).toBe("Hola");
  });

  it("un idioma desconocido (incluido el 'es-en' de la tarjeta) resuelve como español", () => {
    expect(exportLang("es-en")).toBe("es");
    expect(exportLang(undefined)).toBe("es");
    expect(makeT("xx")("Hola", "Hello", "Привет")).toBe("Hola");
  });

  it("makeT ata traducción, etiquetas, meses, ciudades y números al MISMO idioma", () => {
    const T = makeT("ru");
    expect(T.lang).toBe("ru");
    expect(T("Hola", "Hello", "Привет")).toBe("Привет");
    expect(T("Hola", "Hello")).toBe("Hello");
    expect(T.k("kpi.ad")).toBe("Активные водители");
    expect(T.mes("JULIO")).toBe("Июль");
    expect(T.ciudad("LIMA")).toBe("Лима");
    expect(T.dec(12.5, 1)).toBe("12,5");
    expect(makeT("en").k("sinMeta")).toBe("no target");
  });
});

describe("etiquetas compartidas", () => {
  it("UNA definición por KPI: el deck y la tarjeta dicen lo mismo en español", () => {
    expect(xl("kpi.ad", "es")).toBe("Conductores Activos");
    expect(xl("kpi.sh", "es")).toBe("Horas de Conexión");
    expect(xl("kpi.ad", "en")).toBe("Active Drivers");
  });
  it("'sin meta' ya no queda en español en los otros idiomas", () => {
    expect(xl("sinMeta", "es")).toBe("sin meta");
    expect(xl("sinMeta", "en")).toBe("no target");
    expect(xl("sinMeta", "ru")).toBe("без цели");
  });
  it("clave desconocida → la clave (visible), y los parámetros se interpolan", () => {
    expect(xl("no.existe", "es")).toBe("no.existe");
  });
  it("ciudades: la clave de BD no se toca; lo desconocido se capitaliza igual que siempre", () => {
    expect(ciudadL("LIMA", "es")).toBe("Lima");
    expect(ciudadL(" arequipa ", "ru")).toBe("Арекипа");
    expect(ciudadL("CUSCO", "ru")).toBe("Cusco");
    expect(ciudadL("", "es")).toBe("");
  });
  it("meses desde la clave de BD; lo que no es un mes pasa tal cual", () => {
    expect(mesL("SEPTIEMBRE", "es")).toBe("Septiembre");
    expect(mesL("septiembre", "en")).toBe("September");
    expect(mesL("2026-07", "ru")).toBe("2026-07");
    expect(mesL("DICIEMBRE", "ru", { corto: true })).toBe("Дек");
  });
});

describe("números por idioma", () => {
  it("en español son EXACTAMENTE fmt() y fmtSmart() de siempre (la huella no cambia)", () => {
    for (const n of MUESTRA) {
      expect(fmtL(n, "es")).toBe(fmt(n));
      expect(fmtSmartL(n, "es")).toBe(fmtSmart(n));
    }
  });

  it("fmtDecL en es/en es exactamente toFixed (porcentajes y ratios del deck sin cambios)", () => {
    for (const n of [0, 0.05, 1.25, 12.345, 99.95, 1234.5, -3.14159])
      for (const d of [1, 2]) {
        expect(fmtDecL(n, d, "es")).toBe(n.toFixed(d));
        expect(fmtDecL(n, d, "en")).toBe(n.toFixed(d));
      }
  });

  it("en ruso: coma decimal y espacio de miles, con las mismas reglas de redondeo", () => {
    expect(fmtL(2415, "ru")).toBe((2415).toLocaleString("ru-RU"));
    expect(fmtL(2415, "ru")).toMatch(/^2\s415$/u);
    expect(fmtL(12.345, "ru")).toBe("12,35");
    expect(fmtL(10000.4, "ru")).toMatch(/^10\s000$/u);          // ≥10.000 sin decimales, como fmt
    expect(fmtSmartL(897_600, "ru")).toBe("897,6K");
    expect(fmtSmartL(-3_305_781, "ru")).toBe("-3,3M");
    expect(fmtDecL(1234.5, 1, "ru")).toBe("1234,5");             // sin separador de miles, como toFixed
    expect(fmtDecL(99.95, 1, "ru")).toBe((99.95).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }));
  });

  it("en inglés usa en-US (miles con coma, decimal con punto)", () => {
    expect(fmtL(2415.5, "en")).toBe("2,415.5");
    expect(fmtSmartL(12_500, "en")).toBe("12.5K");
  });

  it("null/undefined/NaN no rompen (mismo contrato que fmt/fmtSmart)", () => {
    expect(fmtL(null, "ru")).toBe("0");
    expect(fmtSmartL(NaN, "ru")).toBe("0");
  });
});

// Paridad de placeholders: una traducción que se come un {x} deja la frase sin
// el dato EN SILENCIO. check:drift lo vigila sobre el código fuente; esto lo
// fija sobre los objetos reales que usa la app.
const placeholders = (s: string) => [...new Set([...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]))].sort().join(",");
function sinParidad(dic: Record<string, { es: string; en?: string; ru?: string }>) {
  const malas: string[] = [];
  for (const [k, tr] of Object.entries(dic)) {
    for (const l of ["en", "ru"] as const) {
      if (tr[l] == null) { malas.push(`${k}: falta ${l}`); continue; }
      if (placeholders(tr[l] as string) !== placeholders(tr.es)) malas.push(`${k} (${l})`);
    }
  }
  return malas;
}

describe("paridad de placeholders y de idiomas", () => {
  it("I18N: los 3 idiomas y los mismos {placeholders} en cada clave", () => {
    expect(sinParidad(I18N as never)).toEqual([]);
  });
  it("EXPORT_STR: ídem", () => {
    expect(sinParidad(EXPORT_STR as never)).toEqual([]);
  });
  it("el detector detecta: un {n} que falta en ruso se reporta", () => {
    expect(sinParidad({ x: { es: "Hay {n}", en: "There are {n}", ru: "Есть" } })).toEqual(["x (ru)"]);
  });
});

describe("SIN_KAM: la clave no se traduce, solo lo que se pinta", () => {
  it("kamLabel traduce la etiqueta y deja intactos los KAM reales", () => {
    expect(SIN_KAM).toBe("No KAM");                  // valor de comparación: NO cambia
    expect(kamLabel(SIN_KAM)).toBe(t("metas.sinKam"));
    expect(kamLabel("Ana")).toBe("Ana");
  });
  it("mesLabel (interfaz) usa la tabla única de meses", () => {
    expect(mesLabel("JULIO")).toBe("Julio");
    expect(mesLabel("2026-07")).toBe("2026-07");
  });
});
