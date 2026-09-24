// Upsert de `metas` compatible con la base ANTES y DESPUÉS de la migración
// 2026-09-23_metas_unique_mes_year.sql.
//
// Con la migración, la UNIQUE es (clid, city, mes, mes_year): ENERO 2026 y
// ENERO 2027 son filas distintas. Sin ella, la UNIQUE sigue siendo
// (clid, city, mes) y un upsert con la clave nueva falla con 42P10 ("there is
// no unique or exclusion constraint matching the ON CONFLICT specification").
//
// Por qué existe: el código y la migración no se despliegan en el mismo
// instante (el deploy de Pages tarda ~1 min y la migración la aplica otra
// persona/herramienta). Sin este respaldo, en esa ventana —o si la migración
// se demora— guardar metas quedaba roto. Con él, antes de la migración se
// comporta EXACTAMENTE como el código anterior (incluido el bug entre años, que
// es lo que la migración arregla); después, usa la clave con año.
export const CLAVE_METAS = "clid,city,mes,mes_year";
export const CLAVE_METAS_VIEJA = "clid,city,mes";

type Resultado = { error: { code?: string; message?: string } | null };
type Cliente = { from: (t: string) => { upsert: (rows: unknown[], o: { onConflict: string }) => PromiseLike<Resultado> } };

export async function upsertMetas(cliente: Cliente, filas: unknown[]): Promise<Resultado> {
  const r = await cliente.from("metas").upsert(filas, { onConflict: CLAVE_METAS });
  if (r.error && r.error.code === "42P10") {
    console.warn("[metas] la base aún no tiene UNIQUE (clid,city,mes,mes_year): se usa la clave anterior. Aplicar migrations/2026-09-23_metas_unique_mes_year.sql.");
    return await cliente.from("metas").upsert(filas, { onConflict: CLAVE_METAS_VIEJA });
  }
  return r;
}
