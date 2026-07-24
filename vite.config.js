import { defineConfig } from "vite";

// Fase A1: raíz del proyecto = raíz del repo (index.html vive acá). Los archivos
// .js de la app siguen en la raíz por ahora, servidos como <script defer>; se
// irán moviendo a src/ a medida que se conviertan a módulos ES (Fase A2).
export default defineConfig({
  root: ".",
  server: { port: 8765, host: "127.0.0.1" },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
