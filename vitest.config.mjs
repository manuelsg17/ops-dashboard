// Config de Vitest. Existe SOLO para excluir `.claude/**`: con worktrees vivos
// en `.claude/worktrees/` (ver docs/plan-mejora-2026-09.md §7), Vitest — y por
// lo tanto el pre-commit — corria tambien los tests de esas copias (43 archivos
// en vez de 11), con el codigo de OTRA rama.
//
// Va en un archivo aparte (y no como bloque `test` en vite.config.js) para que
// `vite build` no importe nada de vitest: el build de Vercel/Pages no depende de
// una devDependency de tests. Vitest le da prioridad a este archivo sobre
// vite.config.js, por eso se FUSIONA con el de Vite en vez de reemplazarlo —
// cualquier cosa que se agregue alla (alias, plugins) sigue valiendo en tests.
import { defineConfig, mergeConfig, configDefaults } from "vitest/config";
import viteConfig from "./vite.config.js";

export default defineConfig(env => mergeConfig(viteConfig(env), {
  test: {
    // Se CONSERVAN los excludes por defecto (node_modules, dist, .git, ...).
    exclude: [...configDefaults.exclude, "**/.claude/**"]
  }
}));
