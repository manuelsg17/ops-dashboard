// dev/proto/bits.ts — Piezas chicas del prototipo (mismo marcado que la app).

import { escapeHTML as e } from "../../core/security";
import { iconSvg } from "../../shared/icons";
import { progressBar, goalTone, type GoalProgress } from "../../shared/ui";
import { fmt } from "../../core/format";
import { signo, pct1 } from "./model";

/** Delta vs período anterior: mismo texto y aspecto que _rdDelta (rendimiento.ts). */
export function dl(c: number | null, p: number | null, o: { invert?: boolean; tip?: string } = {}): string {
  if (p == null || c == null) return `<span class="ui-delta ui-delta--na">N/A</span>`;
  if (p === 0) return c > 0 ? `<span class="ui-delta ui-delta--good">NEW</span>` : `<span class="ui-delta ui-delta--flat">--</span>`;
  const v = (c - p) / p * 100, up = v >= 0;
  const tone = Math.abs(v) < 0.05 ? "flat" : (up !== !!o.invert ? "good" : "bad");
  return `<span class="ui-delta ui-delta--${tone}"${o.tip ? ` title="${e(o.tip)}"` : ""}>${iconSvg(up ? "arrow-up" : "arrow-down", { size: 12 })}` +
    `<span class="ui-sr-only">${up ? "↑" : "↓"}</span><span>${up ? "+" : ""}${v.toFixed(1)}%</span></span>`;
}
export const dlPct = (v: number | null) => v == null ? `<span class="ui-delta ui-delta--na">N/A</span>` :
  `<span class="ui-delta ui-delta--${Math.abs(v) < 0.05 ? "flat" : v > 0 ? "good" : "bad"}">${iconSvg(v >= 0 ? "arrow-up" : "arrow-down", { size: 12 })}<span>${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span></span>`;

export const dot = (color: string) => `<span class="rd-dot" style="background:${e(color)}" aria-hidden="true"></span>`;
export const catVar = (i: number) => i >= 0 ? `var(--cat-${(i % 9) + 1})` : "var(--cat-other)";

export function sec(title: string, sub = "", right = ""): string {
  return `<div class="rd-sec"><div class="rd-sec__titles"><h2 class="rd-sec__title">${e(title)}</h2>` +
    (sub ? `<div class="rd-sec__sub">${e(sub)}</div>` : "") + `</div>${right}</div>`;
}

/** Tarjeta KPI de Rendimiento (ui-kpi + delta + barra de avance). */
export function kpi(o: { label: string; value: string; cur?: number | null; prev?: number | null; prevLbl?: string; sub?: string; goal?: GoalProgress; cls?: string }): string {
  const d = o.cur !== undefined ? dl(o.cur ?? null, o.prev ?? null) : "";
  return `<div class="ui-kpi rd-kpi${o.cls ? " " + o.cls : ""}">
    <div class="ui-kpi__label">${e(o.label)}</div>
    <div class="ui-kpi__row"><span class="ui-kpi__value">${e(o.value)}</span>${d ? `<span class="ui-kpi__delta">${d}<span class="ui-kpi__prev">${e(o.prevLbl || "vs sem. anterior")}</span></span>` : ""}</div>
    ${o.sub ? `<div class="ui-kpi__sub">${e(o.sub)}</div>` : ""}
    ${o.goal ? progressBar(o.goal) : ""}
  </div>`;
}

export function chartCard(id: string, title: string, caption = "", cls = "ui-card rd-chart"): string {
  return `<div class="${cls}"><div class="rd-chart__head"><span class="rd-chart__title">${e(title)}</span>` +
    `<button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-act="prToast" data-msg="Descargaría el gráfico en PNG" title="Descargar PNG">${iconSvg("download", { size: 14 })}<span>PNG</span></button></div>` +
    `<div id="${e(id)}" class="rd-chart__plot"></div>${caption ? `<div class="rd-chart__caption">${e(caption)}</div>` : ""}</div>`;
}

export const tone = (pct: number | null) => goalTone(pct) || "neutral";

/** Anillo de progreso (versión B). */
export function ring(pct: number | null, size = 76, stroke = 8, label?: string): string {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const t = tone(pct);
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return `<svg class="pr-ring pr-ring--${t}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${e(label || pct1(pct))}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" class="pr-ring__track"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" class="pr-ring__bar" stroke-linecap="round"
      stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" class="pr-ring__txt">${pct == null ? "—" : Math.round(pct) + "%"}</text></svg>`;
}

/** Minigráfico de línea (versión C). */
export function spark(vals: number[], w = 88, h = 24): string {
  const v = vals.filter(x => x != null);
  if (v.length < 2) return "";
  const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
  const pts = vals.map((x, i) => `${(i / (vals.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 2 - (x - mn) / rg * (h - 4)).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[vals.length - 2];
  return `<svg class="pr-spark pr-spark--${up ? "up" : "down"}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke-width="1.5"/></svg>`;
}

/** Barra de avance simple (ui-progress) sin caption. */
export function bar(pct: number | null, projPct?: number | null, cls = ""): string {
  const t = tone(pct);
  const w = (n: number) => Math.max(0, Math.min(100, n)).toFixed(1);
  return `<div class="ui-progress ui-progress--${t === "neutral" ? "bad" : t}${cls ? " " + cls : ""}${pct == null ? " pr-progress--none" : ""}">` +
    (projPct != null ? `<div class="ui-progress__proj" style="width:${w(projPct)}%"></div>` : "") +
    `<div class="ui-progress__bar" style="width:${w(pct || 0)}%"></div></div>`;
}

export const toneTxt = (pct: number | null) => pct == null ? `<span class="mt-tone mt-tone--neutral">—</span>` : `<span class="mt-tone mt-tone--${tone(pct)}">${pct1(pct)}</span>`;
export const n0 = (v: number) => fmt(Math.round(v));
export { signo };
