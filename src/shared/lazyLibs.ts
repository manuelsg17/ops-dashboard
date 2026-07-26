// shared/lazyLibs.ts — Carga diferida de librerías pesadas de uso puntual.
//
// jsPDF y html2canvas solo hacen falta cuando alguien exporta un PDF (4 vistas)
// o una imagen compartible (Calculadora) — antes vendor.js las importaba de
// forma síncrona y esa carga se pagaba hasta en la pantalla de login. Cada
// función memoiza su propia promesa: la segunda exportación en la misma
// sesión no vuelve a pedir red, reusa lo ya descargado.
//
// Mismo patrón de "espejo a window" que vendor.js usaba para que el resto del
// código (que las referencia como globals bare: `html2canvas(...)`,
// `window.jspdf.jsPDF`) siga funcionando sin cambios en el resto de los
// call sites — solo cambia CUÁNDO se cargan, no cómo se usan.
let _html2canvasPromise: Promise<void> | null = null;
export function ensureHtml2Canvas() {
  if (!_html2canvasPromise) {
    _html2canvasPromise = import("html2canvas").then(mod => {
      window.html2canvas = mod.default;
    });
  }
  return _html2canvasPromise;
}

let _jsPDFPromise: Promise<void> | null = null;
export function ensureJsPDF() {
  if (!_jsPDFPromise) {
    _jsPDFPromise = import("jspdf").then(mod => {
      window.jspdf = { jsPDF: mod.jsPDF };
    });
  }
  return _jsPDFPromise;
}

export function ensurePdfLibs() {
  return Promise.all([ensureJsPDF(), ensureHtml2Canvas()]);
}
