import { describe, it, expect } from "vitest";
import { traducirErrorAdmin } from "./erroresAdmin";
import { readFileSync } from "node:fs";

// Traductor falso: devuelve la clave y sus variables, así el test no depende del idioma.
const t = (k: string, v?: Record<string, string | number>) => v ? `${k}|${JSON.stringify(v)}` : k;

describe("errores de admin-users en el idioma de la UI", () => {
  it("traduce los textos fijos de la función", () => {
    expect(traducirErrorAdmin("No autenticado.", t)).toBe("au.err.noAutenticado");
    expect(traducirErrorAdmin("Requiere rol admin.", t)).toBe("au.err.requiereAdmin");
    expect(traducirErrorAdmin("No puedes eliminar tu propia cuenta.", t)).toBe("au.err.propiaCuenta");
    expect(traducirErrorAdmin("Es el último administrador: no se puede eliminar.", t)).toBe("au.err.ultimoAdmin");
    // El largo va antes que el genérico: si no, el genérico se lo comería.
    expect(traducirErrorAdmin("KAM inválido: máximo 60 caracteres.", t)).toBe("au.err.kamLargo");
    expect(traducirErrorAdmin("KAM inválido.", t)).toBe("au.err.kamInvalido");
  });
  it("conserva el dato de los mensajes con parámetro", () => {
    expect(traducirErrorAdmin("Rol inválido: superadmin", t)).toBe('au.err.rolInvalido|{"r":"superadmin"}');
    expect(traducirErrorAdmin("Acción desconocida: foo", t)).toBe('au.err.accionDesconocida|{"a":"foo"}');
  });
  it("traduce el email repetido que viene de Supabase Auth", () => {
    expect(traducirErrorAdmin("A user with this email address has already been registered", t)).toBe("au.err.emailExiste");
  });
  it("un mensaje desconocido se muestra tal cual (nunca se pierde)", () => {
    expect(traducirErrorAdmin("algo nuevo que dijo el servidor", t)).toBe("algo nuevo que dijo el servidor");
  });
  it("cubre TODOS los { error: \"…\" } fijos de la función (si se agrega uno, este test avisa)", () => {
    const src = readFileSync("supabase/functions/admin-users/index.ts", "utf8");
    const fijos = [...src.matchAll(/error:\s*"([^"]+)"/g)].map(m => m[1]);
    const conDato = [...src.matchAll(/error:\s*`([^`$]+)\$\{/g)].map(m => m[1] + "X");
    expect(fijos.length).toBeGreaterThan(5);
    [...fijos, ...conDato].forEach(msg => expect(traducirErrorAdmin(msg, t), msg).not.toBe(msg));
  });
});
