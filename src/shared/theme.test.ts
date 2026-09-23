// Tema claro/oscuro (Ola 7): la regla de theme.ts y la COPIA de public/theme-init.js
// (script clásico que corre antes del primer pintado) tienen que decidir lo mismo.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { normalizarPref, resolverTema, TEMA_KEY, PREFS_TEMA } from "./theme";

const INIT = readFileSync(fileURLToPath(new URL("../../public/theme-init.js", import.meta.url)), "utf8");

/** Corre theme-init.js en un entorno falso y devuelve lo que puso en <html>. */
function correrInit(guardado: string | null, sistemaOscuro: boolean, lsRoto = false) {
  const attrs: Record<string, string> = {};
  const ctx = {
    localStorage: { getItem: (k: string) => { if (lsRoto) throw new Error("privado"); return k === TEMA_KEY ? guardado : null; } },
    window: { matchMedia: (q: string) => ({ matches: q.includes("dark") && sistemaOscuro }) },
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } }
  };
  runInNewContext(INIT, ctx);
  return attrs;
}

describe("normalizarPref / resolverTema", () => {
  it("solo light y dark son explícitos; cualquier otra cosa es 'system'", () => {
    expect(normalizarPref("light")).toBe("light");
    expect(normalizarPref("dark")).toBe("dark");
    for (const v of [null, undefined, "", "sistema", "DARK", 1]) expect(normalizarPref(v)).toBe("system");
  });
  it("'system' sigue al sistema; lo explícito le gana", () => {
    expect(resolverTema("system", true)).toBe("dark");
    expect(resolverTema("system", false)).toBe("light");
    expect(resolverTema("light", true)).toBe("light");
    expect(resolverTema("dark", false)).toBe("dark");
  });
  it("las tres opciones del menú", () => {
    expect([...PREFS_TEMA]).toEqual(["light", "dark", "system"]);
  });
});

describe("public/theme-init.js = theme.ts", () => {
  it("usa la misma clave de localStorage", () => {
    expect(INIT).toContain(`"${TEMA_KEY}"`);
  });
  it("decide lo mismo en todas las combinaciones", () => {
    for (const guardado of [null, "light", "dark", "system", "basura"]) {
      for (const sis of [false, true]) {
        const a = correrInit(guardado, sis);
        const pref = normalizarPref(guardado);
        expect(a["data-theme"], `${guardado}/${sis}`).toBe(resolverTema(pref, sis));
        expect(a["data-theme-pref"]).toBe(pref);
      }
    }
  });
  it("sin localStorage (modo privado) cae a 'Sistema', no rompe", () => {
    expect(correrInit(null, true, true)["data-theme"]).toBe("dark");
    expect(correrInit(null, false, true)["data-theme"]).toBe("light");
  });
});
