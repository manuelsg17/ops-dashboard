import { describe, it, expect } from "vitest";
import { toN, parseTaxiparksWide, _txNorm, TX_COL_BY_NORM } from "./taxiparks.js";

// Estos tests fijan el CONTRATO del reporte de taxiparks. Importan más que de
// costumbre porque el mismo parser corre en dos lugares (navegador y Edge
// Function): si el contrato se rompe, el mismo reporte entraría distinto según
// por dónde se cargó.

describe("precisión numérica (toN)", () => {
  it("expande los sufijos de magnitud", () => {
    // El bug real de jun 2026: "1.8M" caía en parseFloat = 1.8 y el GMV
    // perdía el 99.9% de su valor.
    expect(toN("1.8M")).toBe(1_800_000);
    expect(toN("51.7K")).toBe(51_700);
    expect(toN("2B")).toBe(2_000_000_000);
  });

  it("deja pasar los números tal cual, sin heurísticas de separador", () => {
    // Si XLSX/DataLens ya entregó un number, ESE es el valor exacto. Aplicarle
    // la lógica de separadores rompería los decimales reales (1611576.849
    // se leería como 1611576849, error ×1000).
    expect(toN(1611576.849)).toBe(1611576.849);
    expect(toN(0)).toBe(0);
  });

  it("resuelve el separador decimal por la posición, no por el símbolo", () => {
    expect(toN("1.234,56")).toBeCloseTo(1234.56, 10);   // formato europeo
    expect(toN("1,234.56")).toBeCloseTo(1234.56, 10);   // formato inglés
    expect(toN("1,234")).toBe(1234);                     // miles, no decimal
    expect(toN("12,5")).toBeCloseTo(12.5, 10);           // decimal
  });

  it("avisa por callback cuando no puede parsear, sin romper", () => {
    const avisos: string[] = [];
    expect(toN("no es un numero", "gmv", (l: string) => avisos.push(l))).toBe(0);
    expect(avisos).toEqual(["gmv"]);
  });

  it("propaga el aviso también en la rama de sufijo", () => {
    // La llamada recursiva de la rama K/M/B perdía el callback.
    const avisos: string[] = [];
    toN("xK", "trips", (l: string) => avisos.push(l));
    expect(avisos).toEqual(["trips"]);
  });
});

describe("formato wide del reporte", () => {
  const fila = (extra: Record<string, unknown> = {}) => ({
    City: "Lima", CLID: "400001264902", db_id: "sub1", Partner: "Lizzo",
    "01.07.2026 - Active Drivers": 100,
    "01.07.2026 - GMV": "1.8M",
    "08.07.2026 - Active Drivers": 150,
    ...extra
  });

  it("convierte columnas fecha×measure en una fila por período", () => {
    const out = parseTaxiparksWide([fila()], { dateField: "fecha" });
    expect(out).toHaveLength(2);
    const p1 = out.find((r: any) => r.fecha === "2026-07-01")!;
    expect(p1.clid).toBe("400001264902");
    expect(p1.city).toBe("LIMA");            // normalizada a mayúsculas
    expect(p1.db_id).toBe("sub1");
    expect(p1.active_drivers).toBe(100);
    expect(p1.gmv).toBe(1_800_000);          // sufijo expandido
    expect(out.find((r: any) => r.fecha === "2026-07-08")!.active_drivers).toBe(150);
  });

  it("separa sub-flotas del MISMO clid por db_id", () => {
    // Sin esto se colapsarían en una sola fila y se perdería el desglose
    // Taxi/Fleet/TukTuk, que es lo que distingue las líneas de negocio.
    const out = parseTaxiparksWide(
      [fila(), fila({ db_id: "sub2", "01.07.2026 - Active Drivers": 40 })],
      { dateField: "fecha" }
    );
    const p1 = out.filter((r: any) => r.fecha === "2026-07-01");
    expect(p1).toHaveLength(2);
    expect(p1.map((r: any) => r.db_id).sort()).toEqual(["sub1", "sub2"]);
  });

  it("omite los períodos sin ningún valor", () => {
    // El reporte trae la grilla completa aunque el partner no haya operado:
    // escribir esas filas ensuciaría la base con ceros que no son ceros reales.
    const out = parseTaxiparksWide(
      [fila({ "15.07.2026 - Active Drivers": "", "15.07.2026 - GMV": "" })],
      { dateField: "fecha" }
    );
    expect(out.some((r: any) => r.fecha === "2026-07-15")).toBe(false);
  });

  it("respeta el campo de fecha de cada escala", () => {
    expect(parseTaxiparksWide([fila()], { dateField: "mes" })[0]).toHaveProperty("mes");
    expect(parseTaxiparksWide([fila()], { dateField: "date" })[0]).toHaveProperty("date");
  });

  it("falla con un mensaje útil si el layout no es el esperado", () => {
    expect(() => parseTaxiparksWide([{ City: "Lima", CLID: "1" }], {}))
      .toThrow(/DD\.MM\.YYYY/);
    expect(() => parseTaxiparksWide([], {})).toThrow(/vacio/i);
  });
});

describe("mapeo de measures", () => {
  it("normaliza los nombres antes de matchear", () => {
    expect(_txNorm("Active  Drivers")).toBe("active drivers");
    expect(_txNorm("Bad-Rated Trips Share")).toBe("bad rated trips share");
  });

  it("conserva los nombres históricos de las columnas core", () => {
    // Renombrarlos rompería los gráficos y las vistas que ya existen.
    expect(TX_COL_BY_NORM["active drivers"]).toBe("active_drivers");
    expect(TX_COL_BY_NORM["gmv"]).toBe("gmv");
    expect(TX_COL_BY_NORM["trips"]).toBe("trips");
  });
});
