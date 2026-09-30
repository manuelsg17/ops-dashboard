// shared/cargaPresentacion.ts — Pantalla de carga de Presentación (30-sep-2026)
//
// Pedido de Manuel: al abrir Presentación por primera vez en la sesión se veía
// solo "Cargando…" sobre fondo blanco. La espera es real (chunk de la vista +
// columnas de detalle + escala mensual, ver switchTab en app.ts), así que en vez
// de disimularla se muestra QUÉ se está cargando: la silueta de la barra y de
// la hoja, la carátula nueva de fondo, y los pasos con su estado.
//
// Eager a propósito (y chico): se pinta ANTES de que llegue el chunk de la
// vista, que es justamente lo que se está esperando.

import { t } from "../core/i18n";
import { escapeHTML } from "../core/security";

export type PasoCarga = "modulo" | "detalle" | "mensual" | "hojas";
const PASOS: PasoCarga[] = ["modulo", "detalle", "mensual", "hojas"];
const CLAVE: Record<PasoCarga, string> = {
  modulo: "p2.carga.modulo", detalle: "p2.carga.detalle", mensual: "p2.carga.mensual", hojas: "p2.carga.hojas"
};

const PULSO = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline class="p2-carga__trazo" points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

export function cargaPresentacionHTML(): string {
  const sk = (cls: string, n: number) => Array.from({ length: n }, () => `<span class="p2-sk ${cls}"></span>`).join("");
  const pasos = PASOS.map((p, i) => `<li class="p2-carga__paso${i === 0 ? " is-activo" : ""}" data-paso="${p}">
      <span class="p2-carga__marca">${CHECK}</span><span>${escapeHTML(t(CLAVE[p]))}</span></li>`).join("");
  return `<div class="p2-carga" role="status" aria-live="polite" aria-busy="true">
    <div class="p2-carga__barra">${sk("p2-sk--campo", 4)}<span class="p2-carga__esp"></span>${sk("p2-sk--boton", 2)}</div>
    <div class="p2-carga__chips">${sk("p2-sk--chip", 9)}</div>
    <div class="p2-carga__hoja">
      <svg class="p2-carga__fondo" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs><linearGradient id="p2cargaG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3b2f"/><stop offset="1" stop-color="#8f0d08"/></linearGradient></defs>
        <polygon points="990,0 1280,0 1280,720 860,720" fill="url(#p2cargaG)" opacity=".9"/>
        <polygon points="1160,0 1280,0 1280,720 1070,720" fill="#000" opacity=".25"/>
        <line x1="989" y1="-10" x2="859" y2="730" stroke="#fff" stroke-width="2" opacity=".6"/>
      </svg>
      <span class="p2-carga__brillo"></span>
      <div class="p2-carga__centro">
        <span class="p2-carga__logo">${PULSO}</span>
        <strong class="p2-carga__titulo">${escapeHTML(t("p2.carga.titulo"))}</strong>
        <ol class="p2-carga__pasos">${pasos}</ol>
      </div>
    </div>
  </div>`;
}

/** Marca un paso como listo y activa el siguiente. No-op si la pantalla de
 *  carga ya no está (la vista ya pintó, o no era la primera visita). */
export function marcarPasoCarga(box: Element | null, paso: PasoCarga): void {
  if (!box) return;
  const li = box.querySelector(`.p2-carga__paso[data-paso="${paso}"]`);
  if (!li) return;
  const i = PASOS.indexOf(paso);
  PASOS.slice(0, i + 1).forEach(p => {
    const el = box.querySelector(`.p2-carga__paso[data-paso="${p}"]`);
    el?.classList.remove("is-activo"); el?.classList.add("is-listo");
  });
  const sig = PASOS[i + 1] && box.querySelector(`.p2-carga__paso[data-paso="${PASOS[i + 1]}"]`);
  sig?.classList.add("is-activo");
}
