// core/security.js — Escapado de strings no confiables (Fase A2: módulo ES)

// Escapa caracteres HTML peligrosos en strings de input (partner names, tooltips, etc.).
// Usar SIEMPRE al interpolar valores no controlados en HTML.
export function escapeHTML(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Para interpolar un valor DENTRO de un argumento de string JS de un manejador inline
// (onclick="fn('...')") que a su vez vive en un atributo HTML entre comillas dobles.
// Orden importa: escapar PRIMERO para el string JS (\ y '), LUEGO para el atributo HTML.
// Así el navegador decodifica las entidades de vuelta a \' y \\ ANTES de que el motor JS
// los lea, sin que ninguno de los dos contextos (atributo / string JS) pueda romperse.
// NUNCA usar escapeHTML(x).replace(/'/g,"\\'") — para cuando corre el replace, escapeHTML
// ya convirtió ' en &#39; y el replace es un no-op (la comilla cruda vuelve al decodificar).
export function escapeJSAttr(s) {
  return escapeHTML(String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
}
