import { describe, it, expect } from "vitest";
import { lecturaPartner, COLUMNAS_OCULTAS_PARTNER } from "./lecturaPartner";

describe("lectura del rol partner", () => {
  it("quien no es partner lee la tabla tal cual", () => {
    expect(lecturaPartner("rendimiento", "clid,kam,trips_share", false)).toEqual({ tabla: "rendimiento", cols: "clid,kam,trips_share" });
  });
  it("el partner lee por la función, sin columnas ocultas y con id para poder ordenar", () => {
    expect(lecturaPartner("rendimiento", "clid,kam,fecha,trips_share,driver_subsidies_by_gmv,acceptance_rate", true))
      .toEqual({ tabla: "rpc/portal_rendimiento", cols: "clid,fecha,acceptance_rate,id" });
    expect(lecturaPartner("rendimiento_diario", "id,date", true)).toEqual({ tabla: "rpc/portal_rendimiento_diario", cols: "id,date" });
  });
  it("otras tablas no se tocan (RLS ya las recorta por CLID)", () => {
    expect(lecturaPartner("metas", "*", true)).toEqual({ tabla: "metas", cols: "*" });
  });
  it("ninguna columna oculta sobrevive en ninguna escala", () => {
    for (const t of ["rendimiento", "rendimiento_mensual", "rendimiento_diario"]) {
      const { cols } = lecturaPartner(t, COLUMNAS_OCULTAS_PARTNER.join(",") + ",clid", true);
      expect(cols).toBe("clid,id");
    }
  });
});
