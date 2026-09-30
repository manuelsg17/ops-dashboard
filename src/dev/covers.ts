// dev/covers.ts — Maquetas de la CARÁTULA del deck (SOLO desarrollo): ?ui=covers
//
// Pedido de Manuel (30-sep-2026), con la pieza de campaña "Yango Ads × Santander"
// de referencia: carátula en degradado; la SEMANAL oscura con rojo (como la
// referencia) y la MENSUAL en degradado con BLANCO como color principal.
// Tres propuestas × {semanal, mensual, portada de sección TukTuk} + la de hoy.
//
// Todo lo decorativo (paneles en diagonal, destellos, brillo) va en un SVG
// inline con colores LITERALES: html2canvas (el motor del PDF) no soporta
// `filter`, `clip-path`, `mix-blend-mode` ni `color-mix()` en CSS, pero sí
// rasteriza un <svg> entero (gradientes y feGaussianBlur incluidos). El botón
// "Probar captura" pasa cada carátula por html2canvas con las MISMAS opciones
// del export real para verlo antes de implementar.
//
// Vendor.ts la importa detrás de `import.meta.env.DEV`: no llega a producción.
//
// ELEGIDA (30-sep-2026): fondo de la A + información de la B, sin la tarjeta
// inclinada ("lo mío no es de tarjetas"). Implementada en
// presentacion2.buildSlide2Cover + styles/views/caratula.css. Esta página queda
// como referencia de las propuestas.

import "./covers.css";
import { registerActions } from "../shared/actions";
import { escapeHTML as e } from "../core/security";
import { ICONS } from "../shared/icons";
import { ensureHtml2Canvas } from "../shared/lazyLibs";

type Prop = "hoy" | "a" | "b" | "c";
type Escala = "semanal" | "mensual";
type Lang = "es" | "en" | "ru";

const CV = { prop: "a" as Prop, partner: 0, lang: "es" as Lang, capturas: {} as Record<string, string>, capturando: false };

// ── Datos de muestra (forma real del deck) ──────────────────────────────────
const LOGO_ANDINA = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><rect x="4" y="14" width="52" height="52" rx="14" fill="#0b5fff"/><path d="M16 54 L30 24 L44 54 Z" fill="#fff"/><text x="68" y="50" font-family="Arial Black,Arial" font-weight="900" font-size="30" fill="#0b2a66">ANDINA</text><text x="70" y="66" font-family="Arial" font-size="11" letter-spacing="3" fill="#5a6a8a">MOVILIDAD</text></svg>`);

const PARTNERS = [
  { nombre: "ANDINA MOVILIDAD", logo: LOGO_ANDINA, ciudades: ["Lima", "Arequipa"], kam: "Ana", tk: true },
  { nombre: "RUTA SUR", logo: "", ciudades: ["Lima"], kam: "Dario", tk: true },
  { nombre: "EMPRESA DE SERVICIOS LA LIBERTAD S.A.C.", logo: "", ciudades: ["Trujillo"], kam: "Rodolfo", tk: false }
];

const TXT = {
  avance: { semanal: { es: "Avance semanal", en: "Weekly update", ru: "Еженедельный отчёт" },
            mensual: { es: "Avance mensual", en: "Monthly update", ru: "Ежемесячный отчёт" } },
  periodo: { semanal: { es: "21 – 27 sep 2026", en: "Sep 21 – 27, 2026", ru: "21–27 сент. 2026" },
             mensual: { es: "Agosto 2026", en: "August 2026", ru: "Август 2026" } },
  tendencia: { semanal: { es: "Tendencia de 6 semanas · desde el 17 ago", en: "6-week trend · since Aug 17", ru: "Динамика за 6 недель · с 17 авг." },
               mensual: { es: "Tendencia de 4 meses · mayo → agosto", en: "4-month trend · May → August", ru: "Динамика за 4 месяца · май → август" } },
  ciudades: { es: "Ciudades", en: "Cities", ru: "Города" },
  kam: { es: "Ejecutivo de cuenta", en: "Account manager", ru: "Менеджер" },
  periodoLbl: { es: "Período", en: "Period", ru: "Период" },
  contenido: { es: "En esta presentación", en: "In this deck", ru: "В презентации" },
  conf: { es: "Confidencial · Preparado para", en: "Confidential · Prepared for", ru: "Конфиденциально · Подготовлено для" },
  numeros: { semanal: { es: "La semana en números", en: "The week in numbers", ru: "Неделя в цифрах" },
             mensual: { es: "El mes en números", en: "The month in numbers", ru: "Месяц в цифрах" } },
  vs: { semanal: { es: "vs semana anterior", en: "vs previous week", ru: "к прошлой неделе" },
        mensual: { es: "vs julio (mes completo)", en: "vs July (full month)", ru: "к июлю (полный месяц)" } },
  seccion: { es: "Sección", en: "Section", ru: "Раздел" },
  seccionSub: { es: "Las métricas a continuación corresponden a TukTuk", en: "The metrics below correspond to TukTuk", ru: "Метрики ниже относятся к ТукТук" }
};
const L = (o: Record<Lang, string>) => o[CV.lang] || o.es;

const SECCIONES = [
  { ico: "lightbulb", es: "Ejecutivo", en: "Executive", ru: "Сводка" },
  { ico: "target", es: "Resumen", en: "Summary", ru: "Итоги" },
  { ico: "chart-line", es: "KPIs", en: "KPIs", ru: "KPI" },
  { ico: "alert-triangle", es: "Alertas", en: "Alerts", ru: "Сигналы" },
  { ico: "table", es: "Anexo", en: "Appendix", ru: "Данные" }
];
const KPIS = {
  semanal: [
    { ico: "users", es: "Conductores activos", en: "Active drivers", ru: "Активные водители", v: "2,415", d: +3.2 },
    { ico: "trending-up", es: "Nuevos + reactivados", en: "New + reactivated", ru: "Новые + реактив.", v: "612", d: -4.1 },
    { ico: "clock", es: "Horas de conexión", en: "Supply hours", ru: "Часы на линии", v: "98,450", d: +1.8 }
  ],
  mensual: [
    { ico: "users", es: "Conductores activos", en: "Active drivers", ru: "Активные водители", v: "4,795", d: +5.6 },
    { ico: "trending-up", es: "Nuevos + reactivados", en: "New + reactivated", ru: "Новые + реактив.", v: "2,530", d: +2.3 },
    { ico: "clock", es: "Horas de conexión", en: "Supply hours", ru: "Часы на линии", v: "412,300", d: -0.9 }
  ]
};

// ── Piezas ──────────────────────────────────────────────────────────────────
// Ícono lucide con color LITERAL: en la captura el SVG se serializa suelto y
// `currentColor` caería a negro.
function ico(name: string, color: string, size = 20, sw = 2): string {
  const node = (ICONS as any)[name];
  if (!node) return "";
  const kids = node.map(([tag, attrs]: [string, Record<string, string>]) =>
    `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${kids}</svg>`;
}
const PULSO = (color: string, size: number, sw = 2.6) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;

function marcaYango(oscuro: boolean): string {
  return `<div class="cv-brand"><span class="cv-brand__sq">${PULSO("#ffffff", 24)}</span>
    <span class="cv-brand__txt" style="color:${oscuro ? "#fff" : "#141418"}">YANGO <span style="color:${oscuro ? "#ff4a3d" : "#E1251B"}">Partners</span></span></div>`;
}
function iniciales(n: string) { return n.trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase(); }
// Logo del partner: en un recuadro blanco (los logos se diseñan para fondo
// claro) o, sin logo, su monograma.
function logoPartner(p: typeof PARTNERS[number], alto: number, oscuro: boolean): string {
  if (p.logo) return `<span class="cv-logo" style="height:${alto}px"><img src="${p.logo}" alt="" style="height:${alto - 16}px"></span>`;
  return `<span class="cv-mono" style="width:${alto}px;height:${alto}px;font-size:${Math.round(alto * .38)}px;${oscuro ? "background:#fff;color:#E1251B" : "background:#E1251B;color:#fff"}">${e(iniciales(p.nombre))}</span>`;
}
function lockup(p: typeof PARTNERS[number], oscuro: boolean): string {
  return `<div class="cv-lockup">${marcaYango(oscuro)}<span class="cv-lockup__sep" style="background:${oscuro ? "rgba(255,255,255,.35)" : "rgba(20,20,24,.2)"}"></span>${logoPartner(p, 52, oscuro)}</div>`;
}
function tamNombre(n: string, base: number): number {
  const L = n.length;
  return L > 34 ? Math.round(base * .66) : L > 24 ? Math.round(base * .8) : base;
}
function cejas(txt: string, color: string, linea = 380): string {
  return `<div class="cv-eyebrow" style="color:${color}">${e(txt)}</div>
    <div class="cv-rule" style="width:${linea}px;background:linear-gradient(90deg,${color},${color}00)"></div>`;
}
function filaIcono(icono: string, lbl: string, val: string, oscuro: boolean, acento: string): string {
  return `<div class="cv-row"><span class="cv-row__ico" style="border-color:${acento}">${ico(icono, acento, 18)}</span>
    <span><span class="cv-row__lbl" style="color:${oscuro ? "rgba(255,255,255,.6)" : "#6b6b76"}">${e(lbl)}</span>
    <span class="cv-row__val" style="color:${oscuro ? "#fff" : "#141418"}">${e(val)}</span></span></div>`;
}
function delta(d: number, sobreRojo: boolean): string {
  const up = d >= 0;
  const bg = sobreRojo ? "rgba(255,255,255,.18)" : up ? "rgba(16,185,129,.14)" : "rgba(225,37,27,.12)";
  const fg = sobreRojo ? "#fff" : up ? "#0f9f6e" : "#E1251B";
  return `<span class="cv-delta" style="background:${bg};color:${fg}">${up ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}%</span>`;
}

// ── Decorado SVG ─────────────────────────────────────────────────────────────
// uid: los ids de <defs> son globales en el documento; dos carátulas en la
// misma página con el mismo id se pisarían los gradientes.
let _uid = 0;
function decoA(oscuro: boolean, acento: string): string {
  const u = "a" + (++_uid);
  // Mensual: el panel arranca casi blanco y recién llega al rojo en el borde,
  // para que el blanco siga siendo el color principal.
  const [c1, c2] = acento === "tk" ? (oscuro ? ["#fbbf24", "#b45309"] : ["#fde9c4", "#f59e0b"])
                                   : (oscuro ? ["#ff3b2f", "#8f0d08"] : ["#ffe1de", "#E1251B"]);
  const brillo = acento === "tk" ? "#fde68a" : "#ff8f86";
  return `<svg class="cv-deco" xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="${u}p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <linearGradient id="${u}q" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}" stop-opacity="${oscuro ? .55 : .35}"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></linearGradient>
      <radialGradient id="${u}g" cx=".82" cy=".78" r=".55"><stop offset="0" stop-color="${c1}" stop-opacity="${oscuro ? .55 : .28}"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient>
      <filter id="${u}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="${u}B" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>
    </defs>
    <rect width="1280" height="720" fill="url(#${u}g)"/>
    <polygon points="930,0 1280,0 1280,720 700,720" fill="url(#${u}p)"/>
    <polygon points="1130,0 1280,0 1280,720 1010,720" fill="${oscuro ? "#000" : c2}" opacity="${oscuro ? .28 : .22}"/>
    <polygon points="860,0 900,0 670,720 630,720" fill="url(#${u}q)"/>
    <line x1="928" y1="-10" x2="698" y2="730" stroke="${brillo}" stroke-width="12" filter="url(#${u}b)" opacity=".85"/>
    <line x1="929" y1="-10" x2="699" y2="730" stroke="#fff" stroke-width="2" opacity=".75"/>
    <line x1="1140" y1="-10" x2="1010" y2="730" stroke="#fff" stroke-width="1.5" opacity=".35"/>
    <circle cx="1120" cy="610" r="150" fill="${brillo}" opacity="${oscuro ? .35 : .45}" filter="url(#${u}B)"/>
    <g opacity=".5" filter="url(#${u}b)"><line x1="1280" y1="160" x2="960" y2="430" stroke="#fff" stroke-width="3"/><line x1="1280" y1="300" x2="1040" y2="520" stroke="#fff" stroke-width="2"/></g>
  </svg>`;
}
function decoB(oscuro: boolean, acento: string): string {
  const u = "b" + (++_uid);
  const [c1, c2] = acento === "tk" ? ["#fbbf24", "#b45309"] : ["#ff3b2f", "#9b0f0a"];
  return `<svg class="cv-deco" xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="${u}p" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${c2}" stop-opacity="${oscuro ? .0 : .0}"/><stop offset=".45" stop-color="${c1}" stop-opacity="${oscuro ? .85 : .9}"/><stop offset="1" stop-color="${c2}" stop-opacity="${oscuro ? .95 : .85}"/></linearGradient>
      <radialGradient id="${u}g" cx=".9" cy=".05" r=".7"><stop offset="0" stop-color="${c1}" stop-opacity="${oscuro ? .6 : .25}"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient>
      <filter id="${u}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    <rect width="1280" height="720" fill="url(#${u}g)"/>
    <polygon points="520,720 1280,120 1280,420 900,720" fill="url(#${u}p)"/>
    <g stroke="#fff" filter="url(#${u}b)" opacity="${oscuro ? .55 : .8}">
      <line x1="560" y1="740" x2="1300" y2="150" stroke-width="5"/>
      <line x1="760" y1="740" x2="1300" y2="310" stroke-width="3"/>
    </g>
    <g stroke="#fff" opacity="${oscuro ? .6 : .9}"><line x1="560" y1="740" x2="1300" y2="150" stroke-width="1.2"/><line x1="900" y1="740" x2="1300" y2="420" stroke-width="1"/></g>
  </svg>`;
}
function decoC(oscuro: boolean, acento: string): string {
  const u = "c" + (++_uid);
  const [c1, c2] = acento === "tk" ? ["#f59e0b", "#92400e"] : ["#E1251B", "#7a0b08"];
  return `<svg class="cv-deco" xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="${u}p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <radialGradient id="${u}g" cx=".15" cy=".95" r=".6"><stop offset="0" stop-color="${c1}" stop-opacity="${oscuro ? .35 : .12}"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient>
      <filter id="${u}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter>
    </defs>
    <rect width="1280" height="720" fill="url(#${u}g)"/>
    <polygon points="860,0 1280,0 1280,720 760,720" fill="url(#${u}p)"/>
    <line x1="861" y1="-10" x2="759" y2="730" stroke="#ff9a92" stroke-width="10" filter="url(#${u}b)" opacity=".7"/>
    <line x1="861" y1="-10" x2="759" y2="730" stroke="#fff" stroke-width="1.5" opacity=".6"/>
    <g stroke="#fff" opacity=".12"><line x1="1280" y1="60" x2="900" y2="720" stroke-width="60"/></g>
  </svg>`;
}

function fondo(oscuro: boolean): string {
  return oscuro
    ? "background:linear-gradient(115deg,#09090b 0%,#140707 40%,#3b0707 68%,#7d0d09 100%)"
    : "background:linear-gradient(115deg,#ffffff 0%,#ffffff 42%,#fff3f2 66%,#ffe0dd 100%)";
}

// ── Propuesta A · "Campaña" (la más cercana a la referencia) ────────────────
function coverA(p: typeof PARTNERS[number], esc: Escala): string {
  const osc = esc === "semanal", acento = osc ? "#ff4a3d" : "#E1251B";
  const txt = osc ? "#fff" : "#141418";
  const circulos = SECCIONES.concat(p.tk ? [{ ico: "tuktuk", es: "TukTuk", en: "TukTuk", ru: "ТукТук" }] : []).map(s =>
    `<div class="cv-circ"><span class="cv-circ__o" style="border-color:${acento};${osc ? "background:rgba(255,255,255,.04)" : "background:#fff"}">${ico(s.ico, acento, 24)}</span>
      <span class="cv-circ__t" style="color:${osc ? "rgba(255,255,255,.85)" : "#33333b"}">${e(L(s as any))}</span></div>`).join("");
  const card = `<div class="cv-card" style="${osc ? "" : "box-shadow:0 30px 60px rgba(122,11,8,.35)"}">
      <div class="cv-card__top">${p.logo ? `<img src="${p.logo}" alt="" style="height:58px">` : `<span class="cv-mono" style="width:64px;height:64px;font-size:26px;background:#E1251B;color:#fff">${e(iniciales(p.nombre))}</span>`}
        <span class="cv-card__pulse">${PULSO("#E1251B", 26)}</span></div>
      <div class="cv-card__name" style="font-size:${p.nombre.length > 24 ? 16 : 20}px">${e(p.nombre)}</div>
      <div class="cv-card__foot"><span>YANGO Partners</span><span>${e(L(TXT.periodo[esc]))}</span></div>
    </div>`;
  return `<div class="cv-slide" style="${fondo(osc)};color:${txt}">
    ${decoA(osc, "")}
    <div class="cv-a">
      ${lockup(p, osc)}
      <div class="cv-a__main">
        ${cejas(L(TXT.avance[esc]).toUpperCase(), acento)}
        <div class="cv-name" style="font-size:${tamNombre(p.nombre, 64)}px;color:${txt}">${e(p.nombre)}</div>
        <div class="cv-period" style="color:${txt}">${e(L(TXT.periodo[esc]))}</div>
        <div class="cv-trend" style="color:${osc ? "rgba(255,255,255,.62)" : "#6b6b76"}">${e(L(TXT.tendencia[esc]))}</div>
        <div class="cv-rows">
          ${filaIcono("map-pin", L(TXT.ciudades), p.ciudades.join(" · "), osc, acento)}
          ${filaIcono("user", L(TXT.kam), p.kam, osc, acento)}
        </div>
      </div>
      <div class="cv-a__foot">
        <div class="cv-eyebrow cv-eyebrow--sm" style="color:${acento}">${e(L(TXT.contenido).toUpperCase())}</div>
        <div class="cv-circs">${circulos}</div>
      </div>
    </div>
    ${card}
    <div class="cv-conf" style="color:${osc ? "rgba(255,255,255,.45)" : "#8a8a94"}">${e(L(TXT.conf))} ${e(p.nombre)}</div>
  </div>`;
}

// ── Propuesta B · "Diagonal" (limpia, tipográfica) ──────────────────────────
function coverB(p: typeof PARTNERS[number], esc: Escala): string {
  const osc = esc === "semanal", acento = osc ? "#ff4a3d" : "#E1251B";
  const txt = osc ? "#fff" : "#141418";
  const col = (lbl: string, val: string) => `<div class="cv-b__col"><span class="cv-b__lbl" style="color:${acento}">${e(lbl.toUpperCase())}</span><span class="cv-b__val" style="color:${txt}">${e(val)}</span></div>`;
  const sep = `<span class="cv-b__sep" style="background:${osc ? "rgba(255,255,255,.22)" : "rgba(225,37,27,.35)"}"></span>`;
  const logo = p.logo
    ? `<span class="cv-b__logo"><img src="${p.logo}" alt="" style="width:170px"></span>`
    : `<span class="cv-b__logo"><span class="cv-b__mono">${e(iniciales(p.nombre))}</span></span>`;
  return `<div class="cv-slide" style="${fondo(osc)};color:${txt}">
    ${decoB(osc, "")}
    <div class="cv-b">
      <div class="cv-b__top">${marcaYango(osc)}<span class="cv-b__conf" style="color:${osc ? "rgba(255,255,255,.5)" : "#8a8a94"}">${e(L(TXT.conf).split(" · ")[0].toUpperCase())}</span></div>
      <div class="cv-b__main">
        ${cejas(L(TXT.avance[esc]).toUpperCase(), acento, 300)}
        <div class="cv-name cv-name--xl" style="font-size:${tamNombre(p.nombre, 84)}px;color:${txt}">${e(p.nombre)}</div>
        <div class="cv-period cv-period--xl" style="color:${acento}">${e(L(TXT.periodo[esc]))}</div>
      </div>
      <div class="cv-b__strip">
        ${col(L(TXT.periodoLbl), L(TXT.tendencia[esc]))}${sep}${col(L(TXT.ciudades), p.ciudades.join(" · "))}${sep}${col(L(TXT.kam), p.kam)}
      </div>
    </div>
    ${logo}
  </div>`;
}

// ── Propuesta C · "Resultados en portada" ───────────────────────────────────
function coverC(p: typeof PARTNERS[number], esc: Escala): string {
  const osc = esc === "semanal", acento = osc ? "#ff4a3d" : "#E1251B";
  const txt = osc ? "#fff" : "#141418";
  const kpis = KPIS[esc].map(k => `<div class="cv-c__kpi"><span class="cv-c__o">${ico(k.ico, "#ffffff", 22)}</span>
      <span class="cv-c__kv"><span class="cv-c__v">${k.v}</span><span class="cv-c__l">${e(L(k as any))}</span></span>${delta(k.d, true)}</div>`).join("");
  return `<div class="cv-slide" style="${fondo(osc)};color:${txt}">
    ${decoC(osc, "")}
    <div class="cv-c">
      ${lockup(p, osc)}
      <div class="cv-a__main">
        ${cejas(L(TXT.avance[esc]).toUpperCase(), acento, 340)}
        <div class="cv-name" style="font-size:${tamNombre(p.nombre, 60)}px;color:${txt};max-width:600px">${e(p.nombre)}</div>
        <div class="cv-period" style="color:${txt}">${e(L(TXT.periodo[esc]))}</div>
        <div class="cv-trend" style="color:${osc ? "rgba(255,255,255,.62)" : "#6b6b76"}">${e(L(TXT.tendencia[esc]))}</div>
        <div class="cv-rows">
          ${filaIcono("map-pin", L(TXT.ciudades), p.ciudades.join(" · "), osc, acento)}
          ${filaIcono("user", L(TXT.kam), p.kam, osc, acento)}
        </div>
      </div>
    </div>
    <div class="cv-c__panel">
      <div class="cv-eyebrow cv-eyebrow--sm" style="color:#fff">${e(L(TXT.numeros[esc]).toUpperCase())}</div>
      <div class="cv-rule" style="width:220px;background:linear-gradient(90deg,#fff,rgba(255,255,255,0))"></div>
      ${kpis}
      <div class="cv-c__vs">${e(L(TXT.vs[esc]))}</div>
    </div>
    <div class="cv-conf" style="color:${osc ? "rgba(255,255,255,.45)" : "#8a8a94"}">${e(L(TXT.conf))} ${e(p.nombre)}</div>
  </div>`;
}

// ── Portada de sección TukTuk, con el lenguaje de cada propuesta ───────────
function divisor(prop: Prop, p: typeof PARTNERS[number], esc: Escala): string {
  const osc = esc === "semanal", acento = osc ? "#fbbf24" : "#d97706";
  const txt = osc ? "#fff" : "#141418";
  const deco = prop === "b" ? decoB(osc, "tk") : prop === "c" ? decoC(osc, "tk") : decoA(osc, "tk");
  return `<div class="cv-slide" style="${fondo(osc).replace(/#3b0707|#7d0d09/g, m => m === "#3b0707" ? "#2e1a05" : "#6b3a06").replace(/#fff3f2|#ffe0dd/g, m => m === "#fff3f2" ? "#fff8eb" : "#fdecc8")};color:${txt}">
    ${deco}
    <div class="cv-div">
      ${marcaYango(osc)}
      <div class="cv-div__main">
        <span class="cv-div__ico" style="border-color:${acento}">${ico("tuktuk", acento, 56, 1.6)}</span>
        ${cejas(L(TXT.seccion).toUpperCase(), acento, 260)}
        <div class="cv-name cv-name--xl" style="font-size:92px;color:${txt}">TukTuk</div>
        <div class="cv-period" style="color:${acento}">${e(p.nombre)}</div>
        <div class="cv-trend" style="color:${osc ? "rgba(255,255,255,.62)" : "#6b6b76"}">${e(L(TXT.seccionSub))}</div>
      </div>
    </div>
  </div>`;
}

// ── La de hoy (referencia) ──────────────────────────────────────────────────
function coverHoy(p: typeof PARTNERS[number], esc: Escala): string {
  const col = "#FF0000";
  const per = esc === "semanal" ? "17/08/2026 → 21/09/2026" : "01/05/2026 → 01/08/2026";
  return `<div class="cv-slide"><div class="agy-style-342">
      <div style="position:absolute;top:-80px;right:-80px;width:320px;height:320px;border-radius:50%;background:${col};opacity:.08"></div>
      <div class="agy-style-343"></div>
      <div class="agy-style-344"><div class="agy-style-345">${PULSO("#fff", 26, 2.5)}</div><div class="agy-style-346">YANGO <span class="agy-style-51">Partners</span></div></div>
      ${p.logo ? `<img class="p2-cover-logo" src="${p.logo}" alt="">` : `<div class="p2-cover-logo p2-cover-monogram" style="color:${col};border-color:${col}33;background:${col}0d">${e(iniciales(p.nombre))}</div>`}
      <div class="agy-style-175"><div style="width:14px;height:14px;border-radius:50%;background:${col}"></div><div class="agy-style-347">${e(p.nombre)}</div></div>
      <div class="agy-style-348">${esc === "semanal" ? "Avance Semanal" : "Avance Mensual"} · ${per}</div>
      <div class="agy-style-349">${e(p.ciudades.join(" · "))}</div>
      <div class="agy-style-351">Ejecutivo de Cuenta: <strong class="agy-style-352">${e(p.kam)}</strong></div>
    </div></div>`;
}

function cover(prop: Prop, p: typeof PARTNERS[number], esc: Escala): string {
  return prop === "a" ? coverA(p, esc) : prop === "b" ? coverB(p, esc) : prop === "c" ? coverC(p, esc) : coverHoy(p, esc);
}

// ── Página ──────────────────────────────────────────────────────────────────
const PROPS: { k: Prop; t: string; d: string }[] = [
  { k: "a", t: "A · Campaña", d: "La más cercana a la referencia: paneles en diagonal con destello, la tarjeta del partner inclinada (como la tarjeta Santander) y los círculos con el contenido del deck." },
  { k: "b", t: "B · Diagonal", d: "Tipográfica y limpia: el nombre del partner en grande, una banda diagonal con destellos y una franja inferior con período, ciudades y ejecutivo." },
  { k: "c", t: "C · Resultados en portada", d: "Como A pero con un panel rojo que adelanta los 3 números del período (los mismos del Resumen) y su variación." },
  { k: "hoy", t: "Hoy", d: "La carátula actual, como referencia." }
];

function escala(w: number): number { return Math.min(.8, (w - 80) / 1280); }

function page(): string {
  const p = PARTNERS[CV.partner];
  const prop = PROPS.find(x => x.k === CV.prop)!;
  const W = Math.max(640, (document.getElementById("cvRoot")?.clientWidth || window.innerWidth));
  const s = escala(W), sm = Math.min(.42, (W - 110) / 2 / 1280);
  const marco = (id: string, titulo: string, html: string, sc: number) => `
    <figure class="cvp-fig">
      <figcaption>${e(titulo)}</figcaption>
      <div class="cvp-frame" style="width:${1280 * sc}px;height:${720 * sc}px"><div class="cvp-scale" style="transform:scale(${sc})" data-cover="${id}">${html}</div></div>
      ${CV.capturas[id] ? `<div class="cvp-cap"><span>Captura con el motor del PDF (html2canvas):</span><img src="${CV.capturas[id]}" style="width:${1280 * sc}px"></div>` : ""}
    </figure>`;
  const seg = (act: string, val: string, opts: [string, string][]) =>
    `<div class="cvp-seg">${opts.map(([k, l]) => `<button type="button" data-act="${act}" data-value="${k}" class="${val === k ? "is-on" : ""}">${e(l)}</button>`).join("")}</div>`;
  return `<div class="cvp-bar">
      <strong>Carátulas del deck · propuestas</strong>
      ${seg("cvProp", CV.prop, PROPS.map(x => [x.k, x.t]))}
      ${seg("cvPartner", String(CV.partner), [["0", "Con logo"], ["1", "Sin logo (monograma)"], ["2", "Nombre largo"]])}
      ${seg("cvLang", CV.lang, [["es", "ES"], ["en", "EN"], ["ru", "RU"]])}
      <button type="button" class="cvp-btn" data-act="cvCaptura"${CV.capturando ? " disabled" : ""}>${CV.capturando ? "Capturando…" : "Probar captura PDF"}</button>
    </div>
    <p class="cvp-desc">${e(prop.d)}</p>
    ${marco("sem", "Semanal — degradado oscuro con rojo", cover(CV.prop, p, "semanal"), s)}
    ${marco("men", "Mensual — degradado con blanco como principal", cover(CV.prop, p, "mensual"), s)}
    ${CV.prop === "hoy" ? "" : `<div class="cvp-row">
      ${marco("tks", "Portada de sección TukTuk · semanal", divisor(CV.prop, p, "semanal"), sm)}
      ${marco("tkm", "Portada de sección TukTuk · mensual", divisor(CV.prop, p, "mensual"), sm)}
    </div>`}`;
}

function render(): void {
  const root = document.getElementById("cvRoot");
  if (root) root.innerHTML = page();
}

// Mismo camino que el export real (p2GenerarPdf): div fuera de pantalla de
// 1280×720 con la fuente del PDF, html2canvas con windowWidth/Height fijos.
async function capturar(): Promise<void> {
  CV.capturando = true; CV.capturas = {}; render();
  await ensureHtml2Canvas();
  const h2c = (window as any).html2canvas;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-cover]"))) {
    const id = el.dataset.cover!;
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;left:-9999px;top:0;width:1280px;height:720px;overflow:hidden;background:#fff;z-index:99998;font-family:-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif";
    div.innerHTML = el.innerHTML;
    document.body.appendChild(div);
    try {
      const c = await h2c(div, { width: 1280, height: 720, windowWidth: 1280, windowHeight: 720, scale: 1.5, useCORS: true, logging: false, backgroundColor: "#fff" });
      CV.capturas[id] = c.toDataURL("image/jpeg", .9);
    } catch (err) { console.error("[covers] captura", id, err); }
    finally { div.remove(); }
  }
  CV.capturando = false; render();
}

export function mountCovers(): void {
  const q = new URLSearchParams(location.search);
  if (q.get("prop")) CV.prop = q.get("prop") as Prop;
  const root = document.createElement("div");
  root.id = "cvRoot";
  root.className = "cvp-root";
  document.body.appendChild(root);
  registerActions({
    cvProp: (d: DOMStringMap) => { CV.prop = d.value as Prop; CV.capturas = {}; render(); },
    cvPartner: (d: DOMStringMap) => { CV.partner = Number(d.value) || 0; CV.capturas = {}; render(); },
    cvLang: (d: DOMStringMap) => { CV.lang = d.value as Lang; CV.capturas = {}; render(); },
    cvCaptura: () => { capturar(); }
  });
  render();
  let t: any = null;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(render, 150); });
}
