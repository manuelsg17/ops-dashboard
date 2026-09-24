// shared/ui.ts — Helpers de componentes del sistema de diseño (Ola 4, sep-2026)
//
// Mismo paradigma que el resto de la app: funciones que DEVUELVEN STRINGS de
// HTML + eventos por `data-act` (shared/actions.ts). Sin framework.
//
// Contrato de seguridad (el motivo de que este archivo esté tipado de verdad):
//   · Todo parámetro de TEXTO (label, title, caption, value…) se escapa con
//     escapeHTML. Pasar un nombre de partner tal cual es seguro.
//   · Los "slots" que aceptan HTML (acciones de un encabezado, cuerpo extra de
//     una alerta…) piden el tipo `Html`, que SOLO devuelven estos helpers o
//     `rawHtml()`. Así el compilador obliga a que un string crudo pase por un
//     helper — o a firmar explícitamente con rawHtml() que ya viene escapado.
//   · Las claves de `data` se validan (nombre de atributo) y sus valores se
//     escapan: data-* es la vía para pasar parámetros a una acción.
//
// Nulos: en esta app `fmt(null)` devuelve "0" (core/format.ts). Estos helpers
// NUNCA convierten null en 0: un KPI sin dato muestra "—" y un delta sin base
// "N/A". Un 0 que parece real es peor que un hueco.
//
// Estilos: src/styles/components.css (prefijo ui-). Catálogo visual en modo
// dev: ?ui=kit (src/dev/uiKit.ts).

import { escapeHTML } from "../core/security";
import { iconSvg, type IconName } from "./icons";

// ── Tipos base ────────────────────────────────────────────────────────────────

declare const __html: unique symbol;
/** HTML ya escapado/confiable. Solo lo producen los helpers de este archivo
 *  (e icon()) o rawHtml(). */
export type Html = string & { readonly [__html]: true };

/** Firma explícita: "esto ya es HTML seguro". Usar solo con strings armados
 *  con escapeHTML o salidas de otros helpers. */
export function rawHtml(s: string): Html {
  return s as Html;
}

const h = (s: string): Html => s as Html;
const esc = (s: unknown): string => escapeHTML(s == null ? "" : String(s));

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "over";
export type DataAttrs = Record<string, string | number | boolean | null | undefined>;

const _DATA_KEY = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/** `{act: "guardar", partnerId: 7}` → ` data-act=(guardar) data-partner-id=(7)` (con comillas).
 *  Claves inválidas (espacios, comillas, `=`…) se DESCARTAN: una clave no se
 *  puede escapar, solo validar. null/undefined/false se omiten. */
export function dataAttrs(data?: DataAttrs): string {
  if (!data) return "";
  let out = "";
  for (const [k, v] of Object.entries(data)) {
    if (v == null || v === false || !_DATA_KEY.test(k)) continue;
    const kebab = k.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
    out += ` data-${kebab}="${esc(v === true ? "" : v)}"`;
  }
  return out;
}

/** Icono SVG inline (ver shared/icons.ts). Decorativo salvo que se pase label. */
export function icon(name: IconName, opts: { size?: number; label?: string; strokeWidth?: number } = {}): Html {
  return h(iconSvg(name, opts));
}

// ── Formato ──────────────────────────────────────────────────────────────────

const LOCALE = "es-PE";
const DASH = "—";

/** Número para mostrar; null/undefined/NaN → "—" (nunca "0"). */
export function numOrDash(v: number | string | null | undefined, maxDecimals = 0): string {
  if (v == null || v === "") return DASH;
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return DASH;
  return v.toLocaleString(LOCALE, { maximumFractionDigits: maxDecimals });
}

// ── Botón ────────────────────────────────────────────────────────────────────

export type BtnVariant = "primary" | "secondary" | "ghost" | "danger";

export interface BtnOptions {
  label: string;
  variant?: BtnVariant;
  size?: "sm" | "md";
  icon?: IconName;
  /** Solo icono: `label` pasa a ser el aria-label (y el tooltip). */
  iconOnly?: boolean;
  /** Acción del dispatcher (data-act). Atajo de data.act. */
  act?: string;
  data?: DataAttrs;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  id?: string;
}

export function btn(o: BtnOptions): Html {
  const cls = ["ui-btn", `ui-btn--${o.variant ?? "secondary"}`];
  if (o.size === "sm") cls.push("ui-btn--sm");
  if (o.iconOnly) cls.push("ui-btn--icon");
  const ico = o.icon ? iconSvg(o.icon, { size: o.size === "sm" ? 14 : 16 }) : "";
  const text = o.iconOnly ? "" : `<span>${esc(o.label)}</span>`;
  const title = o.title ?? (o.iconOnly ? o.label : undefined);
  return h(
    `<button type="${o.type === "submit" ? "submit" : "button"}" class="${cls.join(" ")}"` +
    (o.id ? ` id="${esc(o.id)}"` : "") +
    (o.iconOnly ? ` aria-label="${esc(o.label)}"` : "") +
    (title ? ` title="${esc(title)}"` : "") +
    (o.disabled ? " disabled" : "") +
    dataAttrs({ act: o.act, ...o.data }) +
    `>${ico}${text}</button>`
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────

export function badge(text: string, tone: Tone = "neutral", opts: { icon?: IconName } = {}): Html {
  const ico = opts.icon ? iconSvg(opts.icon, { size: 12 }) : "";
  return h(`<span class="ui-badge ui-badge--${tone}">${ico}${esc(text)}</span>`);
}

// ── Delta vs período anterior ────────────────────────────────────────────────

export interface DeltaOptions {
  /** true si BAJAR es bueno (p.ej. cancelaciones, tiempo de espera). */
  invert?: boolean;
  /** Por debajo de este |Δ| (en puntos %) se considera plano. Default 0.05. */
  flatThreshold?: number;
  decimals?: number;
  /** Texto cuando no hay base de comparación. Default "N/A". */
  naLabel?: string;
}

export type DeltaDir = "up" | "down" | "flat" | "na";

/** Clasifica un delta EN PORCENTAJE (13.1 = +13,1%). null/NaN → "na". */
export function deltaDir(delta: number | null | undefined, flatThreshold = 0.05): DeltaDir {
  if (delta == null || !Number.isFinite(delta)) return "na";
  if (Math.abs(delta) < flatThreshold) return "flat";
  return delta > 0 ? "up" : "down";
}

/** Badge de variación: flecha + signo + color (nunca solo color). */
export function delta(value: number | null | undefined, o: DeltaOptions = {}): Html {
  const dir = deltaDir(value, o.flatThreshold ?? 0.05);
  if (dir === "na") {
    return h(`<span class="ui-delta ui-delta--na">${esc(o.naLabel ?? "N/A")}</span>`);
  }
  const v = value as number;
  const dec = o.decimals ?? 1;
  const abs = Math.abs(v).toLocaleString(LOCALE, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (dir === "flat") {
    return h(`<span class="ui-delta ui-delta--flat">${iconSvg("minus", { size: 12 })}<span>${abs}%</span></span>`);
  }
  const good = (dir === "up") !== !!o.invert;
  const sign = dir === "up" ? "+" : "−";
  const sr = dir === "up" ? "sube" : "baja";
  return h(
    `<span class="ui-delta ui-delta--${good ? "good" : "bad"}">` +
    iconSvg(dir === "up" ? "arrow-up" : "arrow-down", { size: 12 }) +
    `<span class="ui-sr-only">${sr} </span><span>${sign}${abs}%</span></span>`
  );
}

// ── Avance contra la meta ────────────────────────────────────────────────────

/** Mismos cortes que pColor()/pEstado() (core/format.ts), para que un % se
 *  lea igual en toda la app: <80 atrasado (bad) · 80–94 cerca (warn) ·
 *  95–99 cumplió (ok) · ≥100 sobre meta (over, morado — decisión de Manuel
 *  24-sep-2026; >150 sigue siendo "meta desalineada" como estado aparte). */
export function goalTone(pct: number | null | undefined): Exclude<Tone, "neutral" | "info"> | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 100) return "over";
  if (pct >= 95) return "ok";
  if (pct >= 80) return "warn";
  return "bad";
}

export interface GoalProgress {
  /** % de avance (92 = 92%). null = sin meta → solo se muestra el caption. */
  pct: number | null;
  /** "92% de la meta de septiembre (8,400)" / "Sin meta mensual". */
  caption: string;
  /** % proyectado al cierre (franja translúcida detrás de la barra). */
  projPct?: number | null;
}

const _clampPct = (n: number): number => Math.max(0, Math.min(100, n));

export function progressBar(g: GoalProgress): Html {
  const tone = goalTone(g.pct);
  if (tone == null) {
    return h(`<div class="ui-kpi__goal"><div class="ui-kpi__caption ui-kpi__caption--none">${esc(g.caption)}</div></div>`);
  }
  const pct = g.pct as number;
  const proj = g.projPct != null && Number.isFinite(g.projPct)
    ? `<div class="ui-progress__proj" style="width:${_clampPct(g.projPct).toFixed(1)}%"></div>` : "";
  return h(
    `<div class="ui-kpi__goal">` +
    `<div class="ui-progress ui-progress--${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" ` +
    `aria-valuenow="${Math.round(_clampPct(pct))}" aria-label="${esc(g.caption)}">` +
    `${proj}<div class="ui-progress__bar" style="width:${_clampPct(pct).toFixed(1)}%"></div></div>` +
    `<div class="ui-kpi__caption">${esc(g.caption)}</div></div>`
  );
}

// ── Anillo de avance (fase 8, Rendimiento "B · Suave") ───────────────────────

export interface ProgressRingOptions {
  /** % de avance (77 = 77%). null → anillo vacío en gris con "—". */
  pct: number | null;
  /** % proyectado al cierre: arco translúcido detrás del avance. */
  projPct?: number | null;
  /** Nombre accesible completo, ya traducido (el caption de la meta). */
  label: string;
  /** Diámetro en px (default 64). */
  size?: number;
  /** Grosor del trazo en px (default 7). */
  stroke?: number;
}

/** Anillo de avance contra la meta: mismo tono que progressBar (goalTone:
 *  morado ≥100 · verde 95–99 · ámbar 80–94 · rojo <80). Es un <svg role="img">
 *  con el caption como aria-label, así un lector de pantalla oye la frase
 *  entera y no solo "77%". El % del centro se redondea (igual que el caption),
 *  salvo entre 99,5 y 100: ahí queda en "99%", porque "100%" en verde se leería
 *  como meta cumplida.
 *  Estilos: src/styles/ring.css (prefijo ui-ring). */
export function progressRing(o: ProgressRingOptions): Html {
  const size = o.size ?? 64, sw = o.stroke ?? 7;
  const r = (size - sw) / 2, c = 2 * Math.PI * r, mid = size / 2;
  const tone = goalTone(o.pct) ?? "neutral";
  const ok = o.pct != null && Number.isFinite(o.pct);
  const pct = ok ? (o.pct as number) : 0;
  const txt = ok ? `${pct < 100 ? Math.min(99, Math.round(pct)) : Math.round(pct)}%` : DASH;
  const arco = (p: number, cls: string): string =>
    `<circle class="${cls}" cx="${mid}" cy="${mid}" r="${r.toFixed(2)}" fill="none" stroke-width="${sw}" stroke-linecap="round" ` +
    `stroke-dasharray="${(c * _clampPct(p) / 100).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>`;
  const proj = ok && o.projPct != null && Number.isFinite(o.projPct) && o.projPct > pct
    ? arco(o.projPct, "ui-ring__proj") : "";
  return h(
    `<svg class="ui-ring ui-ring--${tone}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(o.label)}">` +
    `<title>${esc(o.label)}</title>` +
    `<circle class="ui-ring__track" cx="${mid}" cy="${mid}" r="${r.toFixed(2)}" fill="none" stroke-width="${sw}"/>` +
    proj + (ok && pct > 0 ? arco(pct, "ui-ring__bar") : "") +
    `<text class="ui-ring__txt${txt.length > 3 ? " ui-ring__txt--long" : ""}" x="50%" y="50%" dominant-baseline="central" text-anchor="middle" aria-hidden="true">${txt}</text></svg>`
  );
}

// ── Tarjeta KPI ──────────────────────────────────────────────────────────────

export interface KpiCardOptions {
  label: string;
  /** Ya formateado ("7,724", "4.51M") o número (se formatea es-PE). null → "—". */
  value: string | number | null | undefined;
  /** Variación % vs período anterior (13.1 = +13,1%). null → "N/A". */
  delta?: number | null;
  /** "vs sem. anterior", "vs jul". */
  prevLabel?: string;
  /** Si bajar es bueno. */
  invert?: boolean;
  goal?: GoalProgress;
  sub?: string;
  /** data-* extra en la tarjeta (p.ej. para un drill-down por data-act). */
  data?: DataAttrs;
}

export function kpiCard(o: KpiCardOptions): Html {
  const value = numOrDash(o.value);
  const hasDelta = o.delta !== undefined;
  const deltaHtml = hasDelta ? delta(o.delta, { invert: o.invert }) : "";
  const prev = hasDelta && o.prevLabel ? `<span class="ui-kpi__prev">${esc(o.prevLabel)}</span>` : "";
  return h(
    `<div class="ui-kpi"${dataAttrs(o.data)}>` +
    `<div class="ui-kpi__label">${esc(o.label)}</div>` +
    `<div class="ui-kpi__row"><span class="ui-kpi__value">${esc(value)}</span>` +
    (hasDelta ? `<span class="ui-kpi__delta">${deltaHtml}${prev}</span>` : "") +
    `</div>` +
    (o.sub ? `<div class="ui-kpi__sub">${esc(o.sub)}</div>` : "") +
    (o.goal ? progressBar(o.goal) : "") +
    `</div>`
  );
}

// ── Chip de filtro ───────────────────────────────────────────────────────────

export interface ChipOptions {
  /** "Ciudad", "KAM"… (opcional). */
  label?: string;
  value: string;
  /** Acción para quitar el filtro. Sin ella el chip es solo informativo. */
  removeAct?: string;
  removeData?: DataAttrs;
  /** Nombre accesible del botón de quitar, ya traducido ("Quitar filtro Ciudad: Lima").
   *  Default en español. */
  removeLabel?: string;
}

export function chip(o: ChipOptions): Html {
  const key = o.label ? `<span class="ui-chip__key">${esc(o.label)}:</span>` : "";
  const val = `<span class="ui-chip__val" title="${esc(o.value)}">${esc(o.value)}</span>`;
  if (!o.removeAct) return h(`<span class="ui-chip ui-chip--static">${key}${val}</span>`);
  const aria = o.removeLabel ?? `Quitar filtro ${o.label ? o.label + ": " : ""}${o.value}`;
  return h(
    `<span class="ui-chip">${key}${val}` +
    `<button type="button" class="ui-chip__remove" aria-label="${esc(aria)}" title="${esc(aria)}"` +
    `${dataAttrs({ act: o.removeAct, ...o.removeData })}>${iconSvg("x", { size: 12 })}</button></span>`
  );
}

// ── Control segmentado ───────────────────────────────────────────────────────

export interface SegmentOption {
  value: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedOptions {
  options: SegmentOption[];
  value: string;
  /** Acción que recibe el dataset con `value` del botón pulsado. */
  act: string;
  /** Nombre accesible del grupo ("Escala", "Línea de negocio"). */
  ariaLabel: string;
  data?: DataAttrs;
}

export function segmented(o: SegmentedOptions): Html {
  const btns = o.options.map(opt => {
    const on = opt.value === o.value;
    return `<button type="button" class="ui-segmented__btn" aria-pressed="${on}"` +
      (opt.disabled ? " disabled" : "") +
      dataAttrs({ act: o.act, ...o.data, value: opt.value }) + `>` +
      (opt.icon ? iconSvg(opt.icon, { size: 14 }) : "") + `<span>${esc(opt.label)}</span></button>`;
  }).join("");
  return h(`<div class="ui-segmented" role="group" aria-label="${esc(o.ariaLabel)}">${btns}</div>`);
}

// ── Alerta / banner ──────────────────────────────────────────────────────────

export type AlertTone = "info" | "ok" | "warn" | "bad";
const _ALERT_ICON: Record<AlertTone, IconName> = {
  info: "info", ok: "check-circle", warn: "alert-triangle", bad: "alert-circle"
};

export interface AlertOptions {
  tone?: AlertTone;
  title?: string;
  text?: string;
  /** Botones (salida de btn()). */
  actions?: Html;
}

export function alertBox(o: AlertOptions): Html {
  const tone = o.tone ?? "info";
  // "bad"/"warn" interrumpen al lector de pantalla; info/ok no.
  const role = tone === "bad" || tone === "warn" ? "alert" : "status";
  return h(
    `<div class="ui-alert ui-alert--${tone}" role="${role}">` +
    iconSvg(_ALERT_ICON[tone], { size: 18 }) +
    `<div class="ui-alert__body">` +
    (o.title ? `<div class="ui-alert__title">${esc(o.title)}</div>` : "") +
    (o.text ? `<div class="ui-alert__text">${esc(o.text)}</div>` : "") +
    `</div>` +
    (o.actions ? `<div class="ui-alert__actions">${o.actions}</div>` : "") +
    `</div>`
  );
}

// ── Estado vacío ─────────────────────────────────────────────────────────────

export interface EmptyStateOptions {
  title: string;
  text?: string;
  icon?: IconName;
  /** Acción principal para salir del vacío (salida de btn()). */
  action?: Html;
}

export function emptyState(o: EmptyStateOptions): Html {
  return h(
    `<div class="ui-empty">` +
    (o.icon ? `<div class="ui-empty__icon">${iconSvg(o.icon, { size: 32, strokeWidth: 1.75 })}</div>` : "") +
    `<div class="ui-empty__title">${esc(o.title)}</div>` +
    (o.text ? `<div class="ui-empty__text">${esc(o.text)}</div>` : "") +
    (o.action ? `<div class="ui-empty__action">${o.action}</div>` : "") +
    `</div>`
  );
}

// ── Encabezado de página ─────────────────────────────────────────────────────

export interface PageHeaderOptions {
  title: string;
  subtitle?: string;
  /** Botones a la derecha (salidas de btn()). */
  actions?: Html;
  /** Filtros activos. Si hay al menos uno y resetAct, aparece "Restablecer". */
  chips?: ChipOptions[];
  resetAct?: string;
  resetLabel?: string;
  /** "Datos hasta 21-sep" ; stale=true lo pinta en ámbar. `title` = detalle (tooltip). */
  freshness?: { text: string; stale?: boolean; title?: string };
  /** Nombre accesible de la fila de chips (default "Filtros activos"). */
  chipsLabel?: string;
  /** HTML extra a la derecha de la fila de metadatos (junto a la frescura). */
  metaExtra?: Html;
  /** HTML extra al pie del encabezado (p.ej. un aviso de estado). */
  footer?: Html;
}

export function pageHeader(o: PageHeaderOptions): Html {
  const chips = o.chips?.length
    ? `<div class="ui-chips" role="group" aria-label="${esc(o.chipsLabel ?? "Filtros activos")}">${o.chips.map(chip).join("")}` +
      (o.resetAct ? `<button type="button" class="ui-link-btn"${dataAttrs({ act: o.resetAct })}>${esc(o.resetLabel ?? "Restablecer")}</button>` : "") +
      `</div>`
    : "";
  const fresh = o.freshness
    ? `<span class="ui-freshness${o.freshness.stale ? " ui-freshness--stale" : ""}"` +
      (o.freshness.title ? ` title="${esc(o.freshness.title)}"` : "") + `>` +
      iconSvg(o.freshness.stale ? "alert-triangle" : "clock", { size: 12 }) + `${esc(o.freshness.text)}</span>`
    : "";
  const right = o.metaExtra ? `<div class="ui-page-header__meta-end">${o.metaExtra}${fresh}</div>` : fresh;
  const meta = chips || right ? `<div class="ui-page-header__meta">${chips || "<span></span>"}${right}</div>` : "";
  return h(
    `<header class="ui-page-header"><div class="ui-page-header__top">` +
    `<div class="ui-page-header__titles"><h1 class="ui-page-header__title">${esc(o.title)}</h1>` +
    (o.subtitle ? `<div class="ui-page-header__subtitle">${esc(o.subtitle)}</div>` : "") +
    `</div>` +
    (o.actions ? `<div class="ui-page-header__actions">${o.actions}</div>` : "") +
    `</div>${meta}${o.footer ?? ""}</header>`
  );
}

// ── Navegación lateral ───────────────────────────────────────────────────────

export interface SideNavItem { id: string; label: string; icon?: IconName }
export interface SideNavGroup { label: string; items: SideNavItem[] }
export interface SideNavOptions {
  /** id del <nav>. */
  id?: string;
  /** title (tooltip) en cada ítem: hace falta cuando la navegación se contrae a
   *  solo iconos y el texto queda visible solo para lectores de pantalla. */
  itemTitles?: boolean;
}

/** Navegación agrupada. `act` recibe data-tab con el id del ítem. */
export function sideNav(groups: SideNavGroup[], current: string, act: string, ariaLabel = "Secciones", opts: SideNavOptions = {}): Html {
  const body = groups.map(g =>
    `<div class="ui-sidenav__group" role="group" aria-label="${esc(g.label)}"><div class="ui-sidenav__label" aria-hidden="true">${esc(g.label)}</div>` +
    g.items.map(it =>
      `<button type="button" class="ui-sidenav__item"${it.id === current ? ' aria-current="page"' : ""}` +
      (opts.itemTitles ? ` title="${esc(it.label)}"` : "") +
      `${dataAttrs({ act, tab: it.id })}>${it.icon ? iconSvg(it.icon, { size: 18 }) : ""}<span class="ui-sidenav__text">${esc(it.label)}</span></button>`
    ).join("") +
    `</div>`
  ).join("");
  return h(`<nav class="ui-sidenav"${opts.id ? ` id="${esc(opts.id)}"` : ""} aria-label="${esc(ariaLabel)}">${body}</nav>`);
}
