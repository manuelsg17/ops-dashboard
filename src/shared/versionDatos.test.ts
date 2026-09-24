import { describe, it, expect } from "vitest";
import { claveVersion, claveVersionTabla, reusarFilas, type VersionDatos } from "./versionDatos.js";

const dv = (over: Partial<VersionDatos> = {}): VersionDatos => ({
  tablas: {
    rendimiento: [120, "2026-09-16T14:00:00+00:00"],
    rendimiento_mensual: [40, "2026-09-02T10:00:00+00:00"],
    partner_users: [3, "2026-08-01T00:00:00+00:00"]
  },
  ingesta: { semanal: "2026-09-16T14:00:05+00:00" },
  ...over
});

describe("claveVersion", () => {
  it("sin respuesta de la RPC no hay clave (→ se descarga como antes)", () => {
    expect(claveVersion(null, "semanal", "admin")).toBeNull();
    expect(claveVersion(undefined, "semanal", "admin")).toBeNull();
    expect(claveVersion({} as VersionDatos, "semanal", "admin")).toBeNull();
    expect(claveVersion(dv(), "anual", "admin")).toBeNull();
  });

  it("es estable para los mismos datos", () => {
    expect(claveVersion(dv(), "semanal", "admin")).toBe(claveVersion(dv(), "semanal", "admin"));
  });

  it("cambia con una escritura a la tabla de ESA escala (conteo o fecha)", () => {
    const base = claveVersion(dv(), "semanal", "admin");
    // Mismo max(at) pero una escritura más (transacción larga que confirmó
    // después de otra más corta): el conteo lo delata.
    const masFilas = dv({ tablas: { ...dv().tablas, rendimiento: [121, "2026-09-16T14:00:00+00:00"] } });
    expect(claveVersion(masFilas, "semanal", "admin")).not.toBe(base);
    const masTarde = dv({ tablas: { ...dv().tablas, rendimiento: [120, "2026-09-17T14:00:00+00:00"] } });
    expect(claveVersion(masTarde, "semanal", "admin")).not.toBe(base);
  });

  it("NO cambia por escrituras a la tabla de OTRA escala", () => {
    const otra = dv({ tablas: { ...dv().tablas, rendimiento_diario: [9, "2026-09-20T00:00:00+00:00"] } });
    expect(claveVersion(otra, "semanal", "admin")).toBe(claveVersion(dv(), "semanal", "admin"));
    expect(claveVersion(otra, "diario", "admin")).not.toBe(claveVersion(dv(), "diario", "admin"));
  });

  it("cambia con una ingesta nueva de la escala, con partner_users y con el rol", () => {
    const base = claveVersion(dv(), "semanal", "admin");
    expect(claveVersion(dv({ ingesta: { semanal: "2026-09-23T14:00:00+00:00" } }), "semanal", "admin")).not.toBe(base);
    expect(claveVersion(dv({ tablas: { ...dv().tablas, partner_users: [4, "2026-09-20T00:00:00+00:00"] } }), "semanal", "admin")).not.toBe(base);
    expect(claveVersion(dv(), "semanal", "partner")).not.toBe(base);
  });

  it("claveVersionTabla: tabla sin escala (conversión) no depende de la ingesta", () => {
    const d = dv({ tablas: { ...dv().tablas, conversion_pais: [6, "2026-09-01T00:00:00+00:00"] } });
    const k = claveVersionTabla(d, "conversion_pais", "admin");
    expect(k).not.toBeNull();
    expect(claveVersionTabla({ ...d, ingesta: { semanal: "otra" } }, "conversion_pais", "admin")).toBe(k);
    expect(claveVersionTabla(d, "", "admin")).toBeNull();
    expect(claveVersion(d, "semanal", "admin")).toBe(claveVersionTabla(d, "rendimiento", "admin", "semanal"));
  });

  it("una tabla nunca escrita entra como null y sigue siendo comparable", () => {
    const k = claveVersion(dv(), "diario", "kam");
    expect(k).not.toBeNull();
    expect(k).toContain("null");
  });
});

describe("reusarFilas", () => {
  const filas = [
    { fecha: "2026-07-27", v: 1 }, { fecha: "2026-08-03", v: 2 },
    { fecha: "2026-08-03", v: 3 }, { fecha: "2026-08-10", v: 4 }
  ];
  const snap = { rows: filas, ver: "V1", desde: "2026-07-27" };

  it("misma versión, misma ventana y mismo conteo → las mismas filas (misma referencia)", () => {
    expect(reusarFilas(snap, "V1", "2026-07-27", "fecha", 4)).toBe(filas);
  });

  it("la ventana avanzó → recorta, igual que la consulta col >= desde", () => {
    expect(reusarFilas(snap, "V1", "2026-08-03", "fecha", 4)).toEqual(filas.slice(1));
  });

  it("versión distinta, ausente o desconocida → null", () => {
    expect(reusarFilas(snap, "V2", "2026-07-27", "fecha", 4)).toBeNull();
    expect(reusarFilas(snap, null, "2026-07-27", "fecha", 4)).toBeNull();
    expect(reusarFilas({ ...snap, ver: null }, "V1", "2026-07-27", "fecha", 4)).toBeNull();
  });

  it("conteo distinto o sin conteo → null (fila nueva/borrada fuera del trigger)", () => {
    expect(reusarFilas(snap, "V1", "2026-07-27", "fecha", 5)).toBeNull();
    expect(reusarFilas(snap, "V1", "2026-07-27", "fecha", 3)).toBeNull();
    expect(reusarFilas(snap, "V1", "2026-07-27", "fecha", null)).toBeNull();
  });

  it("el snapshot no cubre la ventana de hoy (se pidió desde después) → null", () => {
    expect(reusarFilas(snap, "V1", "2026-07-20", "fecha", 4)).toBeNull();
    // hoy hace falta la tabla entera (RPC de períodos caída) y el snapshot tenía cota
    expect(reusarFilas(snap, "V1", null, "fecha", 4)).toBeNull();
  });

  it("snapshot de la tabla entera cubre cualquier ventana", () => {
    const entero = { ...snap, desde: null };
    expect(reusarFilas(entero, "V1", null, "fecha", 4)).toBe(filas);
    expect(reusarFilas(entero, "V1", "2026-08-10", "fecha", 4)).toEqual([filas[3]]);
  });

  it("formato YYYY-MM (mensual)", () => {
    const m = { rows: [{ mes: "2026-02" }, { mes: "2026-03" }, { mes: "2026-10" }], ver: "M", desde: "2026-02" };
    expect(reusarFilas(m, "M", "2026-03", "mes", 3)).toEqual([{ mes: "2026-03" }, { mes: "2026-10" }]);
  });

  it("sin snapshot → null", () => {
    expect(reusarFilas(null, "V1", "2026-07-27", "fecha", 4)).toBeNull();
    expect(reusarFilas({ rows: null as any, ver: "V1", desde: null }, "V1", null, "fecha", 0)).toBeNull();
  });
});
