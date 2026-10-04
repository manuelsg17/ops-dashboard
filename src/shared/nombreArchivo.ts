// shared/nombreArchivo.ts — Nombres de los archivos que descarga la app (3-oct-2026).
//
// Pedido de Manuel: que los nombres de archivo también salgan en el idioma
// (antes: "MiDesempeno_…", "Presentacion2_…", "conciliacion_…" en español en
// cualquier idioma). Cada exportación arma las PARTES ya traducidas; acá solo
// se unen con "_" y se limpian los caracteres que un sistema de archivos no
// acepta (\ / : * ? " < > |). Los nombres en ruso quedan en cirílico: Windows,
// macOS, iOS y Android los aceptan.

/** Une las partes no vacías con "_" y agrega la extensión. Puro (test). */
export function nombreArchivo(partes: Array<string | number | null | undefined>, ext: string): string {
  // Caracteres de control (código < 32) fuera, sin regex (lint: no-control-regex).
  const sinControl = (s: string) => Array.from(s).filter(c => c.charCodeAt(0) >= 32).join("");
  const limpia = (s: string) => sinControl(s).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  const base = partes
    .map(p => (p == null ? "" : limpia(String(p))))
    .filter(Boolean)
    .join("_")
    .slice(0, 150);
  return (base || "archivo") + "." + String(ext).replace(/^\./, "");
}
