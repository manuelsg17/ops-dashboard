import { describe, it, expect } from "vitest";
import { upsertMetas, CLAVE_METAS, CLAVE_METAS_VIEJA } from "./upsertMetas";

function clienteFalso(respuestas: Record<string, { error: any }>) {
  const llamadas: string[] = [];
  return {
    llamadas,
    from: (tabla: string) => ({
      upsert: async (_filas: unknown[], o: { onConflict: string }) => {
        llamadas.push(`${tabla}:${o.onConflict}`);
        return respuestas[o.onConflict] ?? { error: null };
      }
    })
  };
}

describe("upsertMetas", () => {
  it("con la migración aplicada usa la clave con año, una sola llamada", async () => {
    const c = clienteFalso({});
    const r = await upsertMetas(c, [{}]);
    expect(r.error).toBeNull();
    expect(c.llamadas).toEqual([`metas:${CLAVE_METAS}`]);
  });

  it("sin la migración (42P10) reintenta con la clave anterior", async () => {
    const c = clienteFalso({ [CLAVE_METAS]: { error: { code: "42P10", message: "no unique constraint" } } });
    const r = await upsertMetas(c, [{}]);
    expect(r.error).toBeNull();
    expect(c.llamadas).toEqual([`metas:${CLAVE_METAS}`, `metas:${CLAVE_METAS_VIEJA}`]);
  });

  it("cualquier otro error NO se esconde detrás del reintento", async () => {
    const c = clienteFalso({ [CLAVE_METAS]: { error: { code: "42501", message: "permission denied" } } });
    const r = await upsertMetas(c, [{}]);
    expect(r.error?.code).toBe("42501");
    expect(c.llamadas).toEqual([`metas:${CLAVE_METAS}`]);
  });
});
