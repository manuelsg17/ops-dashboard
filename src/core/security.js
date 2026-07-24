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

// NOTA (Fase A2): acá vivía escapeJSAttr(), necesaria mientras la UI usaba
// handlers inline (onclick="fn('...')"), donde un mismo valor atravesaba DOS
// contextos anidados — string JS dentro de atributo HTML — y había que escapar
// en ese orden exacto. Ese patrón ya se rompió una vez en este proyecto (el
// escapeHTML(x).replace(/'/g,"\\'") que era un no-op, porque escapeHTML ya
// había convertido la comilla en &#39; antes del replace).
//
// Se ELIMINÓ al migrar los ~173 handlers inline a event delegation
// (shared/actions.js): ahora los valores viajan en data-attributes, un solo
// contexto, y alcanza escapeHTML. Si en el futuro alguien vuelve a necesitar
// algo así, es señal de que se está reintroduciendo un handler inline —
// preferir una acción delegada.
