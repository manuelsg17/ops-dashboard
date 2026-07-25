import { defineConfig } from "vite";

// Deploy: GitHub Pages sirve el repo bajo /ops-dashboard/ (sin dominio propio,
// ver .github/workflows/static.yml) — sin ese base en el BUILD, los assets
// apuntan a la raíz del dominio y 404ean en producción. Solo en build (no en
// dev) para no correr el servidor local bajo /ops-dashboard/.
export default defineConfig(({ command }) => ({
  root: ".",
  base: command === "build" ? "/ops-dashboard/" : "/",
  server: { port: 8765, host: "127.0.0.1" },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
}));
