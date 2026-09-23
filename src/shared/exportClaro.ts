// shared/exportClaro.ts — Las exportaciones salen SIEMPRE claras (Ola 7)
//
// Un PDF o PNG es un documento que se le manda a alguien (el deck al partner,
// la tarjeta de metas, el PDF de Metas o del portal): no puede depender del
// tema que tenía elegido quien lo exportó.
//
// Cómo, sin tocar la pantalla: html2canvas CLONA el documento en un iframe y
// recién ahí lee los estilos. En `onclone` se pone data-theme="light" en el
// <html> de la COPIA (todos los tokens vuelven al claro) y se reescriben los
// colores que los gráficos ya hornearon en su SVG (ApexCharts escribe el hex
// del tema oscuro en fill/stroke/style al dibujar): cada color de un token
// oscuro se cambia por el MISMO token en claro. La pantalla no parpadea.

import { chartTokens, lightChartTokens, lightScope, cssVar, type ChartTokens } from "./chartTheme";
import { temaActual } from "./theme";

/** Valor de un token en el tema CLARO (p.ej. el fondo de un PNG). */
export function tokenClaro(nombre: string, fallback: string): string {
  return cssVar(nombre, fallback, lightScope());
}

function _rgb(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** Pares color oscuro → color claro para cada token que usan los gráficos.
 *  Cada color va en sus dos escrituras: #hex (atributos SVG) y rgb(…) (lo que
 *  devuelve el navegador al serializar un style). Puro. */
export function mapaColoresClaro(oscuro: ChartTokens, claro: ChartTokens): Map<string, string> {
  const pares: [string, string][] = [];
  oscuro.palette.forEach((c, i) => pares.push([c, claro.palette[i]]));
  pares.push([oscuro.other, claro.other], [oscuro.grid, claro.grid], [oscuro.axis, claro.axis],
    [oscuro.label, claro.label], [oscuro.text, claro.text], [oscuro.textMuted, claro.textMuted],
    [oscuro.surface, claro.surface], [oscuro.border, claro.border]);
  const mapa = new Map<string, string>();
  for (const [o, c] of pares) {
    if (!o || !c) continue;
    const k = o.trim().toLowerCase();
    if (!mapa.has(k)) mapa.set(k, c);
    const r = _rgb(k);
    if (r && !mapa.has(r)) mapa.set(r, _rgb(c) || c);
  }
  return mapa;
}

const _ATTRS = ["fill", "stroke", "stop-color", "color", "flood-color"];

/** Reescribe, en `root` y sus descendientes, los colores del mapa en los
 *  atributos de pintura y en `style`. Devuelve cuántos cambió. */
export function aclararColores(root: Element, mapa: Map<string, string>): number {
  if (!mapa.size) return 0;
  const claves = [...mapa.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(claves.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  let n = 0;
  const els = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of els) {
    for (const a of _ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const nuevo = mapa.get(v.trim().toLowerCase());
      if (nuevo) { el.setAttribute(a, nuevo); n++; }
    }
    const st = el.getAttribute("style");
    if (st && re.test(st)) {
      re.lastIndex = 0;
      el.setAttribute("style", st.replace(re, m => mapa.get(m.toLowerCase()) || m));
      n++;
    }
    re.lastIndex = 0;
  }
  return n;
}

/** Tokens de color que re-apunta el modo oscuro (tokens.css, sección 2). */
export const TOKENS_COLOR = [
  "--color-bg", "--color-surface", "--color-surface-muted", "--color-surface-sunken",
  "--color-text", "--color-text-muted", "--color-text-subtle", "--color-text-disabled", "--color-text-inverse",
  "--color-border", "--color-border-strong", "--color-border-input",
  "--color-brand", "--color-brand-hover", "--color-brand-soft", "--color-on-brand", "--color-brand-text",
  ...["ok", "warn", "bad", "info", "over"].flatMap(k => ["fg", "bg", "border", "solid"].map(p => `--color-${k}-${p}`)),
  "--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8", "--cat-9", "--cat-other",
  "--chart-grid", "--chart-axis", "--chart-label", "--focus-ring-color"
];

/** html2canvas, al clonar, copia a cada nodo SVG sus estilos COMPUTADOS en la
 *  página (que está en oscuro) como estilo inline: los íconos (currentColor)
 *  salían con el color oscuro aunque la copia ya estuviera en claro. Este mapa
 *  traduce cada token de color de su valor oscuro a su valor claro. */
export function mapaTokensClaro(oscuro: Element | null, claro: Element | null, tokens: readonly string[] = TOKENS_COLOR): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const t of tokens) {
    const o = cssVar(t, "", oscuro).toLowerCase(), c = cssVar(t, "", claro);
    if (!o || !c || o === c.toLowerCase()) continue;
    if (!mapa.has(o)) mapa.set(o, c);
    const ro = _rgb(o), rc = _rgb(c);
    if (ro && !mapa.has(ro)) mapa.set(ro, rc || c);
  }
  return mapa;
}

/**
 * Opciones de html2canvas para una captura CLARA. Se combinan con las propias
 * de cada exportación (un `onclone` propio se respeta y corre después).
 * Con la app en claro no cambia nada respecto de antes.
 */
export function opcionesCapturaClara<T extends Record<string, any>>(extra: T = {} as T): T & { onclone: (doc: Document, el: HTMLElement) => void } {
  const oscuro = temaActual() === "dark";
  let mapa: Map<string, string> | null = null;
  if (oscuro) {
    mapa = mapaColoresClaro(chartTokens(), lightChartTokens());
    for (const [k, v] of mapaTokensClaro(document.documentElement, lightScope())) if (!mapa.has(k)) mapa.set(k, v);
  }
  const propio = extra && typeof extra.onclone === "function" ? extra.onclone : null;
  return {
    ...extra,
    onclone: (doc: Document, el: HTMLElement) => {
      if (oscuro && doc && doc.documentElement) {
        doc.documentElement.setAttribute("data-theme", "light");
        if (el) {
          el.setAttribute("data-theme", "light");
          if (mapa) aclararColores(el, mapa);
        }
      }
      if (propio) propio(doc, el);
    }
  };
}
