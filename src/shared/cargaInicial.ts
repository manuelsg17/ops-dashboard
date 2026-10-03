// shared/cargaInicial.ts — Pantalla de carga de los datos (3-oct-2026)
//
// Pedido de Manuel: "algo similar" a la pantalla de carga de Presentación para
// el "Cargando datos desde Supabase…" de la vista principal, "simple pero
// entretenido, que transmita que avanza". Antes era un spinner y una línea.
//
// Igual que en Presentación, los pasos son REALES (no un temporizador): se
// tildan cuando resuelve cada grupo de pedidos de loadFromSupabase (data.ts).
// Mientras tanto, unas barras que crecen (la idea de una serie semanal
// armándose) y un consejo de uso que rota cada pocos segundos.
//
// Reutiliza el mismo nodo `#loadingEl` que showLoad (app.ts), así que
// `showLoad(false)` también la quita: ningún camino de error la deja colgada.

import { t } from "../core/i18n";
import { escapeHTML } from "../core/security";

export type PasoInicial = "conexion" | "maestros" | "rendimiento" | "armando";
export const PASOS_INICIAL: PasoInicial[] = ["conexion", "maestros", "rendimiento", "armando"];
const CLAVE: Record<PasoInicial, string> = {
  conexion: "carga.paso.conexion", maestros: "carga.paso.maestros",
  rendimiento: "carga.paso.rendimiento", armando: "carga.paso.armando"
};
const CONSEJOS = ["carga.tip0", "carga.tip1", "carga.tip2", "carga.tip3", "carga.tip4", "carga.tip5"];
export const N_CONSEJOS = CONSEJOS.length;
const ROTACION_MS = 3800;

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const PULSO = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline class="ci-trazo" points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;

/** % de avance para la barra: pasos listos sobre el total. Puro (test). */
export function avanceCarga(listos: number, total = PASOS_INICIAL.length): number {
  if (total <= 0) return 0;
  return Math.round(Math.max(0, Math.min(listos, total)) / total * 100);
}

/** Índice del consejo que sigue (circular). Puro (test). */
export function siguienteConsejo(i: number, n = N_CONSEJOS): number {
  return n > 0 ? (i + 1) % n : 0;
}

export function cargaInicialHTML(consejo = 0): string {
  const barras = Array.from({ length: 7 }, (_, i) => `<span class="ci-barra" style="--i:${i}"></span>`).join("");
  const pasos = PASOS_INICIAL.map((p, i) => `<li class="ci-paso${i === 0 ? " is-activo" : ""}" data-paso="${p}">
      <span class="ci-marca">${CHECK}</span><span>${escapeHTML(t(CLAVE[p]))}</span></li>`).join("");
  return `<div class="ci-card" role="status" aria-live="polite" aria-busy="true">
    <div class="ci-cabeza">
      <span class="ci-logo">${PULSO}</span>
      <div><strong class="ci-titulo">${escapeHTML(t("carga.titulo"))}</strong>
        <span class="ci-sub">${escapeHTML(t("carga.sub"))}</span></div>
    </div>
    <div class="ci-grafico" aria-hidden="true">${barras}</div>
    <div class="ci-progreso" aria-hidden="true"><span class="ci-progreso__barra" style="width:0%"></span></div>
    <ol class="ci-pasos">${pasos}</ol>
    <p class="ci-consejo"><span class="ci-consejo__rot">${escapeHTML(t("carga.consejo"))}</span>
      <span class="ci-consejo__txt">${escapeHTML(t(CONSEJOS[consejo % N_CONSEJOS]))}</span></p>
  </div>`;
}

let _timer: ReturnType<typeof setInterval> | null = null;

function _caja(): HTMLElement | null {
  const el = document.getElementById("loadingEl");
  return el && el.querySelector(".ci-card") ? el : null;
}

/** Muestra la pantalla de carga (reemplaza el contenido de #loadingEl). */
export function mostrarCargaInicial(): void {
  let el = document.getElementById("loadingEl");
  if (!el) {
    el = document.createElement("div");
    el.id = "loadingEl";
    el.className = "overlay";
    document.body.appendChild(el);
  }
  el.classList.add("overlay--carga");
  let consejo = Math.floor(Math.random() * N_CONSEJOS);
  el.innerHTML = cargaInicialHTML(consejo);
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => {
    const caja = _caja();
    if (!caja) { if (_timer) clearInterval(_timer); _timer = null; return; }
    const txt = caja.querySelector(".ci-consejo__txt");
    if (!txt) return;
    consejo = siguienteConsejo(consejo);
    txt.classList.remove("is-entra");
    void (txt as HTMLElement).offsetWidth;   // reinicia la animación de entrada
    txt.textContent = t(CONSEJOS[consejo]);
    txt.classList.add("is-entra");
  }, ROTACION_MS);
}

/** Tilda un paso. Los pedidos resuelven en cualquier orden, así que cada paso
 *  se tilda por su cuenta y "en curso" es siempre el primero sin tildar.
 *  No-op si la pantalla ya no está (la carga terminó o se mostró otro aviso). */
export function marcarPasoInicial(paso: PasoInicial): void {
  const caja = _caja();
  if (!caja) return;
  const li = caja.querySelector(`.ci-paso[data-paso="${paso}"]`);
  if (!li) return;
  li.classList.add("is-listo");
  const items = Array.from(caja.querySelectorAll(".ci-paso"));
  items.forEach(x => x.classList.remove("is-activo"));
  items.find(x => !x.classList.contains("is-listo"))?.classList.add("is-activo");
  const listos = caja.querySelectorAll(".ci-paso.is-listo").length;
  const barra = caja.querySelector(".ci-progreso__barra") as HTMLElement | null;
  if (barra) barra.style.width = avanceCarga(listos) + "%";
}

/** Detiene la rotación de consejos (la quita de la pantalla showLoad(false)). */
export function detenerCargaInicial(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
