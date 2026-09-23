/* theme-init.js — Tema (claro/oscuro) ANTES del primer pintado (Ola 7).
   Script clásico y bloqueante en el <head>: el grafo de módulos (vendor.ts) es
   diferido y llegaría tarde — la app parpadearía en claro con el oscuro
   elegido. Es un archivo y no un <script> inline porque la CSP es
   script-src 'self'. Misma regla que src/shared/theme.ts (clave "yangoTheme",
   valores light | dark | ausente = sistema); un test las mantiene iguales. */
(function () {
  try {
    var p = null;
    try { p = localStorage.getItem("yangoTheme"); } catch (e) { /* privado */ }
    if (p !== "light" && p !== "dark") p = "system";
    var oscuro = p === "dark" ||
      (p === "system" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var html = document.documentElement;
    html.setAttribute("data-theme", oscuro ? "dark" : "light");
    html.setAttribute("data-theme-pref", p);
  } catch (e) { /* sin tema: queda el claro de :root */ }
})();
