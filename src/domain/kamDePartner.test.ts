import { describe, it, expect } from "vitest";

// PRECEDENCIA DEL KAM DE UN PARTNER.
//
// El contrato del proyecto dice que la tabla `partners` es la FUENTE DE VERDAD
// para nombre y KAM, y que el `kam` que viene en la fila de rendimiento es solo
// un fallback. Había DOS implementaciones de eso y una lo hacía al revés.
//
// Coincidían mientras `partners.kam` estuviera cargado —el loader ya hace
// `kam: KAM_MAP[clid] || r.kam`— y divergían justo cuando está VACÍO: la fila
// conserva el KAM viejo del Excel, así que el partner aparecía bajo "No KAM" en
// el sidebar y bajo su KAM anterior en Rendimiento, Metas y la Calculadora. Los
// números de un mismo partner se contaban en dos grupos distintos según la
// pantalla.
//
// Este test replica la lógica de `_buildPartnerKAM` (data.ts) sin importar el
// módulo, que arrastra STATE global y el DOM. Lo que fija es la REGLA.

const SIN_KAM = "No KAM";

function buildPartnerKAM(
  { CLID_MAP, KAM_MAP }: { CLID_MAP: Record<string, string>; KAM_MAP: Record<string, string> },
  kamDeFilas?: Map<string, string>
) {
  const map = new Map<string, string>();
  Object.entries(KAM_MAP || {}).forEach(([clid, kam]) => {
    const p = CLID_MAP[clid];
    if (!p) return;
    const kamT = (kam || "").trim();
    const previo = map.get(p);
    if (previo && previo !== SIN_KAM) return;
    if (previo === SIN_KAM && !kamT) return;
    map.set(p, kamT || SIN_KAM);
  });
  (kamDeFilas || new Map()).forEach((kam, partner) => {
    if (!map.has(partner) && kam) map.set(partner, kam);
  });
  return map;
}

describe("`partners` manda sobre el kam de la fila", () => {
  it("un KAM vaciado en Configuración deja al partner en No KAM, NO en el viejo", () => {
    // El caso real: VIA RAPIDA con kam='' en `partners` pero 'Carla' todavía
    // grabado en las filas de rendimiento.
    const m = buildPartnerKAM(
      { CLID_MAP: { "900000000007": "VIA RAPIDA" }, KAM_MAP: { "900000000007": "" } },
      new Map([["VIA RAPIDA", "Carla"]])
    );
    expect(m.get("VIA RAPIDA")).toBe(SIN_KAM);
    expect(m.get("VIA RAPIDA")).not.toBe("Carla");
  });

  it("con KAM cargado, gana el de `partners` aunque la fila diga otro", () => {
    // Reasignar un partner en Configuración tiene que verse YA, sin esperar a la
    // próxima ingesta del Excel.
    const m = buildPartnerKAM(
      { CLID_MAP: { c1: "ANDINA" }, KAM_MAP: { c1: "Ana" } },
      new Map([["ANDINA", "Beto"]])
    );
    expect(m.get("ANDINA")).toBe("Ana");
  });

  it("un CLID que NO está en `partners` sí usa el kam de la fila", () => {
    // Los 16 CLIDs sueltos de producción: ahí la fila es la única información.
    const m = buildPartnerKAM(
      { CLID_MAP: {}, KAM_MAP: {} },
      new Map([["Vip Silver", "Miguel"]])
    );
    expect(m.get("Vip Silver")).toBe("Miguel");
  });

  it("sin KAM en ningún lado queda sin entrada (el llamador cae a No KAM)", () => {
    const m = buildPartnerKAM({ CLID_MAP: {}, KAM_MAP: {} }, new Map([["Huérfano", ""]]));
    expect(m.has("Huérfano")).toBe(false);
  });
});

describe("un partner con varios CLIDs", () => {
  const CLID_MAP = { c1: "MULTI", c2: "MULTI", c3: "MULTI" };

  it("un KAM real le gana a SIN_KAM, venga en el orden que venga", () => {
    // Sin esta regla el resultado dependía del orden de las claves del objeto:
    // el mismo partner caía en "No KAM" o en su KAM según cómo iterara.
    expect(buildPartnerKAM({ CLID_MAP, KAM_MAP: { c1: "", c2: "Ana", c3: "" } }).get("MULTI")).toBe("Ana");
    expect(buildPartnerKAM({ CLID_MAP, KAM_MAP: { c1: "Ana", c2: "", c3: "" } }).get("MULTI")).toBe("Ana");
    expect(buildPartnerKAM({ CLID_MAP, KAM_MAP: { c1: "", c2: "", c3: "Ana" } }).get("MULTI")).toBe("Ana");
  });

  it("todos vacíos → No KAM", () => {
    expect(buildPartnerKAM({ CLID_MAP, KAM_MAP: { c1: "", c2: "", c3: "" } }).get("MULTI")).toBe(SIN_KAM);
  });

  it("dos KAMs distintos: gana el primero, de forma determinista", () => {
    // No es "correcto" tener un partner con dos KAMs — es un dato a arreglar en
    // Configuración. Lo que fija el test es que no oscile entre renders.
    const m = buildPartnerKAM({ CLID_MAP, KAM_MAP: { c1: "Ana", c2: "Beto", c3: "" } });
    expect(m.get("MULTI")).toBe("Ana");
  });
});

describe("SIN_KAM no se escribe en la base", () => {
  // `metas.kam` significa "persona a cargo". Un KAM llamado "No KAM" ensuciaría
  // los reportes y podría terminar en la tabla `partners` por un upsert.
  const kamGuardar = (sel: string, delPartner: string) => {
    const k = sel === "all" ? (delPartner || "") : sel;
    return k === SIN_KAM ? "" : k;
  };

  it("con el filtro en No KAM se guarda cadena vacía", () => {
    expect(kamGuardar(SIN_KAM, "")).toBe("");
  });

  it("con un KAM real se guarda su nombre", () => {
    expect(kamGuardar("Ana", "")).toBe("Ana");
  });

  it("en 'todos', un partner sin KAM guarda vacío y no el bucket", () => {
    expect(kamGuardar("all", SIN_KAM)).toBe("");
    expect(kamGuardar("all", "Ana")).toBe("Ana");
  });
});
