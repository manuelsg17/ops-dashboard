import { describe, it, expect } from "vitest";
import { claveNum, dn } from "./huella";

describe("huella de números — claves data-num", () => {
  it("une las partes con punto", () => {
    expect(claveNum("rend", "ciudad", "ad", "LIMA")).toBe("rend.ciudad.ad.LIMA");
  });

  it("omite partes vacías o nulas (un KAM vacío no deja '..')", () => {
    expect(claveNum("rend", "kam", "ad", "")).toBe("rend.kam.ad");
    expect(claveNum("rend", null, "ad", undefined, "  ")).toBe("rend.ad");
  });

  it("conserva el 0 numérico como parte", () => {
    expect(claveNum("x", 0)).toBe("x.0");
  });

  it("dn() devuelve el atributo con espacio inicial y escapa la entidad", () => {
    expect(dn("metas", "agg", "partner", "ad", `A "B" & C@LIMA`))
      .toBe(' data-num="metas.agg.partner.ad.A &quot;B&quot; &amp; C@LIMA"');
  });

  it("dn() con una clave ya armada + sufijo (patrón de metas/portal)", () => {
    expect(dn("metas.comb.pais.ad", "real")).toBe(' data-num="metas.comb.pais.ad.real"');
  });
});
