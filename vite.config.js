import { defineConfig } from "vite";

// Deploy: GitHub Pages sirve el repo bajo /ops-dashboard/ (sin dominio propio,
// ver .github/workflows/static.yml) — sin ese base, los assets buildeados
// apuntan a la raíz del dominio y 404ean en producción.
//
// OJO: `command` NO sirve para distinguir esto — `vite preview` reporta el
// mismo command ("serve") que `vite dev`, así que un check por command deja
// el preview local (que sirve el dist/ YA buildeado con rutas /ops-dashboard/
// horneadas) sirviendo en "/" → 404 en cada asset. Se detecta el entorno real
// de CI (GITHUB_ACTIONS, la única corrida que empuja a Pages) en su lugar.
export default defineConfig(() => ({
  root: ".",
  base: process.env.GITHUB_ACTIONS ? "/ops-dashboard/" : "/",
  server: { port: 8765, host: "127.0.0.1" },
  preview: { port: 4173, host: "127.0.0.1" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Antes: TODO (17 módulos propios + supabase-js + xlsx + apexcharts +
    // chart.js + jspdf + html2canvas) caía en un solo chunk de 2.29MB — hasta
    // la pantalla de login pagaba el peso completo de librerías que solo se
    // usan al subir un Excel o exportar un PDF. Separar por librería (en vez
    // de dejar que Rollup decida) da 2 cosas: descargas en paralelo (HTTP/2,
    // no una sola descarga+parse gigante y bloqueante) y cache de largo plazo
    // — un cambio en el código propio ya no invalida el chunk de las libs de
    // terceros (que casi nunca cambian de versión).
    //
    // OJO con este mismo mecanismo: agrupar por nombre de paquete IGNORA si
    // ese paquete se llega por import estático o dynamic import(). ApexCharts
    // es eager de verdad (lo usa Rendimiento, el tab por defecto) — agruparlo
    // con cualquier lib lazy forzaría a Rollup a tratar TODO el chunk como
    // eager, anulando el beneficio de moverla. Por eso cada lib lazy va en su
    // PROPIO bucket, no todas juntas en un "vendor" compartido: si no, abrir
    // Presentación 2.0 (que solo necesita Chart.js) también pagaría jsPDF +
    // html2canvas de otras vistas. xlsx no tiene regla porque nunca se
    // alcanza por import estático (vive solo dentro de workers/excelWorker.js,
    // que Vite bundlea aparte).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("apexcharts")) return "vendor-apexcharts";
          if (id.includes("chart.js") || id.includes("chartjs-plugin-datalabels")) return "vendor-chartjs";
          if (id.includes("jspdf") || id.includes("html2canvas")) return "vendor-pdf";
          return "vendor";
        }
      }
    }
  }
}));
