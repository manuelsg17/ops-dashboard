import { describe, it, expect } from "vitest";
import { clasificarErrorSubida, describirErrorSubida, ErrorSubida } from "./erroresSubida";

describe("clasificarErrorSubida — por código, no por texto", () => {
  it("códigos de Postgres/PostgREST", () => {
    expect(clasificarErrorSubida({ code: "42501", message: "new row violates row-level security policy" })).toBe("permiso");
    expect(clasificarErrorSubida({ code: "23505", message: "duplicate key" })).toBe("conflicto");
    expect(clasificarErrorSubida({ code: "21000", message: "cannot affect row a second time" })).toBe("conflicto");
    expect(clasificarErrorSubida({ code: "23502", message: "null value in column" })).toBe("formato");
    expect(clasificarErrorSubida({ code: "PGRST204", message: "Could not find the 'x' column" })).toBe("formato");
    expect(clasificarErrorSubida({ code: "42P10", message: "there is no unique or exclusion constraint" })).toBe("esquema");
    expect(clasificarErrorSubida({ code: "PGRST301", message: "JWT expired" })).toBe("auth");
  });
  it("el texto ya NO decide: un mensaje con 'duplicate' sin código no es 'conflicto'", () => {
    const e = new Error("duplicate en el Excel: revisá la fila 3");
    expect(clasificarErrorSubida(e)).toBe("validacion");
  });
  it("ErrorSubida propio manda su código", () => {
    expect(clasificarErrorSubida(new ErrorSubida("cancelado", "x"))).toBe("cancelado");
  });
  it("caída de red (TypeError de fetch) y status HTTP", () => {
    expect(clasificarErrorSubida(new TypeError("Failed to fetch"))).toBe("red");
    expect(clasificarErrorSubida(new TypeError("Cannot read properties of undefined"))).toBe("desconocido");
    expect(clasificarErrorSubida({ status: 401, message: "Unauthorized" })).toBe("auth");
  });
});

describe("describirErrorSubida", () => {
  it("nombra la carga y no dice 'datos actualizados' ante un error", () => {
    const m = describirErrorSubida("metas", { code: "23505", message: "duplicate key value" });
    expect(m).toContain("Metas");
    expect(m).not.toMatch(/fueron actualizados/);
  });
  it("una migración faltante se dice como tal", () => {
    expect(describirErrorSubida("metas", { code: "42P10", message: "no unique constraint" })).toMatch(/migración/);
  });
  it("cancelar no se presenta como error de datos", () => {
    expect(describirErrorSubida("metas", new ErrorSubida("cancelado", ""))).toMatch(/cancelada/);
  });
});
