// dev/uiKit.ts — Catálogo visual del sistema de diseño (Ola 4, SOLO desarrollo)
//
// Se abre con `npm run dev` + `?ui=kit` en la URL. vendor.ts lo importa detrás
// de `import.meta.env.DEV`, que Vite reemplaza por `false` en el build: el
// import dinámico se elimina y este módulo NO llega a producción (verificado
// buscando sus textos en dist/).
//
// Se monta como una capa fija por encima de todo (incluida la pantalla de
// login), así que se ve SIN sesión: no depende de STATE ni de datos.
//
// Los estilos ad-hoc de esta página (grillas, muestras de color) van inline a
// propósito: son andamiaje del catálogo, no componentes, y así no se suma ni
// una regla al CSS de producción.

import { registerActions } from "../shared/actions";
import {
  btn, kpiCard, badge, chip, segmented, alertBox, emptyState, pageHeader, icon,
  sideNav, rawHtml, type Html, type SideNavGroup
} from "../shared/ui";
import { ICONS, type IconName } from "../shared/icons";
import { confirmDialog, alertDialog } from "../shared/confirmDialog";
import { chartTokens, seriesColor } from "../shared/chartTheme";
import { escapeHTML } from "../core/security";

const KIT = {
  escala: "semanal",
  linea: "combinado",
  nav: "rendimiento",
  chips: [
    { k: "escala", label: "Escala", value: "Semanal" },
    { k: "rango", label: "Rango", value: "01-sep → 21-sep" },
    { k: "ciudad", label: "Ciudad", value: "Lima" },
    { k: "kam", label: "KAM", value: "No KAM" },
    { k: "linea", label: "Línea", value: "Combinado" }
  ],
  lastResult: "—"
};

const NAV: SideNavGroup[] = [
  { label: "Análisis", items: [
    { id: "rendimiento", label: "Rendimiento", icon: "chart-line" },
    { id: "metas", label: "Metas", icon: "target" }
  ] },
  { label: "Planificación", items: [
    { id: "calculator", label: "Calculadora", icon: "calculator" },
    { id: "seguimiento", label: "Seguimiento", icon: "list-check" }
  ] },
  { label: "Entregables", items: [
    { id: "present2", label: "Presentación", icon: "presentation" }
  ] },
  { label: "Datos", items: [
    { id: "rawdata", label: "Data raw", icon: "table" },
    { id: "config", label: "Configuración", icon: "settings" }
  ] }
];

const sec = (title: string, body: string, note = ""): string =>
  `<section style="margin:0 0 32px">` +
  `<h2 style="font-size:var(--text-lg);font-weight:var(--weight-bold);margin:0 0 4px;color:var(--color-text)">${escapeHTML(title)}</h2>` +
  (note ? `<p style="font-size:var(--text-sm);color:var(--color-text-muted);margin:0 0 12px">${escapeHTML(note)}</p>` : `<div style="height:8px"></div>`) +
  body + `</section>`;

const row = (...items: string[]): string =>
  `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">${items.join("")}</div>`;

function swatch(varName: string, label?: string): string {
  return `<div style="display:flex;flex-direction:column;gap:4px;width:96px">` +
    `<div style="height:40px;border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(${varName})"></div>` +
    `<code style="font-size:11px;color:var(--color-text-muted)">${escapeHTML(label ?? varName)}</code></div>`;
}

function colores(): string {
  const neutrals = ["0", "50", "100", "200", "300", "400", "450", "500", "600", "700", "800", "900"].map(n => swatch(`--neutral-${n}`));
  const roles = ["ok", "warn", "bad", "info", "over"].map(r =>
    `<div style="display:flex;flex-direction:column;gap:4px">` +
    `<div style="padding:8px 12px;border-radius:var(--radius-sm);border:1px solid var(--color-${r}-border);background:var(--color-${r}-bg);color:var(--color-${r}-fg);font-size:13px;font-weight:600">${r} · texto AA</div>` +
    `<div style="height:6px;border-radius:99px;background:var(--color-${r}-solid)"></div></div>`);
  const t = chartTokens();
  const cats = t.palette.map((_, i) =>
    `<div style="display:flex;flex-direction:column;gap:4px;width:72px"><div style="height:32px;border-radius:4px;background:${seriesColor(i, t)}"></div>` +
    `<code style="font-size:11px;color:var(--color-text-muted)">cat-${i + 1}</code></div>`).join("") + swatch("--cat-other", "otros");
  return sec("Color", row(swatch("--brand-500", "brand #E1251B"), swatch("--brand-600", "brand hover"), swatch("--color-brand-soft", "brand soft")) +
    `<div style="height:12px"></div>` + row(...neutrals) +
    `<div style="height:12px"></div>` + row(...roles) +
    `<div style="height:12px"></div>` + row(cats),
    "Rojo de marca solo para marca y la acción primaria. Estados con su propia paleta. Categórica en orden fijo, sin rojo.");
}

function tipografia(): string {
  const sizes: [string, string][] = [["--text-2xl", "28 · valor KPI"], ["--text-xl", "20 · título de página"], ["--text-lg", "16 · título de sección"],
    ["--text-base", "14 · cuerpo / botones"], ["--text-md", "13 · tablas"], ["--text-sm", "12 · etiquetas"], ["--text-xs", "11 · captions"]];
  return sec("Tipografía", sizes.map(([v, l]) =>
    `<div style="font-size:var(${v});color:var(--color-text);margin-bottom:6px" class="ui-num">${escapeHTML(l)} — 1,234,567.89</div>`).join(""),
    "7 tamaños, pesos 400/600/700 (800 solo en el valor de KPI). Cifras tabulares en tablas y KPIs.");
}

function botones(): string {
  return sec("Botones", row(
    btn({ label: "Guardar metas", variant: "primary", icon: "save" }),
    btn({ label: "Descargar PDF", variant: "secondary", icon: "download" }),
    btn({ label: "Ver detalle", variant: "ghost", icon: "eye" }),
    btn({ label: "Eliminar metas", variant: "danger", icon: "trash" }),
    btn({ label: "Deshabilitado", variant: "primary", disabled: true })
  ) + `<div style="height:12px"></div>` + row(
    btn({ label: "Primario sm", variant: "primary", size: "sm" }),
    btn({ label: "Secundario sm", size: "sm", icon: "filter" }),
    btn({ label: "Ghost sm", variant: "ghost", size: "sm" }),
    btn({ label: "Peligro sm", variant: "danger", size: "sm" }),
    btn({ label: "Actualizar", icon: "refresh", iconOnly: true }),
    btn({ label: "Editar", icon: "edit", iconOnly: true, size: "sm", variant: "ghost" }),
    btn({ label: "Cerrar", icon: "x", iconOnly: true, size: "sm", variant: "ghost" })
  ), "Un solo primario por pantalla. Peligro = contorno, nunca gemelo del primario.");
}

function kpis(): string {
  const main = `<div class="ui-kpi-grid">` +
    kpiCard({ label: "Active Drivers", value: "7,724", delta: 13.1, prevLabel: "vs sem. anterior",
      goal: { pct: 92, caption: "92% de la meta de septiembre (8,400)" } }) +
    kpiCard({ label: "N+R", value: "7,126", delta: 24.2, prevLabel: "vs sem. anterior",
      goal: { pct: 71, projPct: 96, caption: "71% de la meta (10,000) · proyección 96%" } }) +
    kpiCard({ label: "Viajes", value: "4.51M", delta: -2.1, prevLabel: "vs sem. anterior",
      goal: { pct: null, caption: "Sin meta mensual" } }) +
    `</div>`;
  const estados = `<div class="ui-kpi-grid" style="margin-top:16px">` +
    kpiCard({ label: "Aceptación (sin dato)", value: null, delta: null, prevLabel: "vs sem. anterior", sub: "null → “—” y “N/A”, nunca 0" }) +
    kpiCard({ label: "Cancelaciones (bajar es bueno)", value: "3.2%", delta: -8.4, invert: true, prevLabel: "vs sem. anterior" }) +
    kpiCard({ label: "Horas de conexión", value: 412_530, delta: 0, prevLabel: "vs sem. anterior",
      goal: { pct: 101, caption: "101% de la meta (408,000)" } }) +
    kpiCard({ label: "Brandeados", value: "1,090", delta: 3.3, prevLabel: "vs ago",
      goal: { pct: 164, caption: "164% de la meta (665) · revisar la meta" } }) +
    `</div>`;
  return sec("Tarjetas KPI", main + estados,
    "Dirección B: valor, delta vs período anterior y avance contra la meta del mes. Cortes del color = pColor(): <80 · 80–94 · 95–99 · ≥100 (sobre meta).");
}

function badgesChips(): string {
  return sec("Badges y chips", row(
    badge("Cumplió", "ok", { icon: "check" }), badge("Cerca", "warn"), badge("Atrasado", "bad", { icon: "alert-triangle" }),
    badge("Nuevo", "info"), badge("Meta desalineada", "over"), badge("Sin meta", "neutral")
  ) + `<div style="height:12px"></div>` + row(
    chip({ label: "Ciudad", value: "Lima", removeAct: "uiKitChipRemove", removeData: { k: "demo" } }),
    chip({ value: "Solo lectura" }),
    chip({ label: "Partner", value: "TRANSPORTES Y SERVICIOS DEL NORTE S.A.C. (nombre largo)", removeAct: "uiKitChipRemove", removeData: { k: "demo" } })
  ));
}

function segmentos(): string {
  return sec("Control segmentado", row(
    segmented({ ariaLabel: "Escala", act: "uiKitSeg", data: { g: "escala" }, value: KIT.escala, options: [
      { value: "diario", label: "Diario" }, { value: "semanal", label: "Semanal" }, { value: "mensual", label: "Mensual" }] }),
    segmented({ ariaLabel: "Línea de negocio", act: "uiKitSeg", data: { g: "linea" }, value: KIT.linea, options: [
      { value: "combinado", label: "Combinado" }, { value: "taxi", label: "Taxi", icon: "taxi" },
      { value: "tuktuk", label: "TukTuk", icon: "tuktuk" }, { value: "fleet", label: "Fleet", icon: "car", disabled: true }] })
  ), "aria-pressed marca la opción activa; se opera con Tab + Enter/Espacio.");
}

function tabla(): string {
  const rows = [
    ["ANDINA MOVILIDAD", "Lima", "Ana", 2415, 13.1, 1198, 92],
    ["RUTA SUR", "Arequipa", "Ana", 845, -2.1, 402, 71],
    ["TRANSPOFLEET", "Lima", "Miguel", 78, null, 31, null],
    ["LIZZO", "Lima", "Matías", 2762, 4.5, 1422, 101],
    ["PIAGGIO", "Trujillo", "Matías", 68, 0, 12, 164]
  ] as const;
  const extra = ["Horas", "Viajes", "GMV", "Aceptación", "Brandeados"];
  const head = `<tr><th>Partner</th><th>Ciudad</th><th>KAM</th><th class="ui-num" aria-sort="descending">AD</th><th class="ui-num">Δ AD</th><th class="ui-num">N+R</th><th>Meta</th>` +
    extra.map(e => `<th class="ui-num">${e}</th>`).join("") + `</tr>`;
  const body = rows.map(([p, c, k, ad, d, nr, pct]) => {
    const tone = pct == null ? "neutral" : pct >= 100 ? "over" : pct >= 95 ? "ok" : pct >= 80 ? "warn" : "bad";
    return `<tr><td>${escapeHTML(p)}</td><td>${escapeHTML(c)}</td><td>${escapeHTML(k)}</td>` +
      `<td class="ui-num">${ad.toLocaleString("es-PE")}</td>` +
      `<td class="ui-num">${d == null ? "N/A" : (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d).toFixed(1) + "%"}</td>` +
      `<td class="ui-num">${nr.toLocaleString("es-PE")}</td>` +
      `<td>${badge(pct == null ? "Sin meta" : pct + "%", tone)}</td>` +
      extra.map((_, i) => `<td class="ui-num">${((ad * (i + 3)) * 37).toLocaleString("es-PE")}</td>`).join("") + `</tr>`;
  }).join("");
  return sec("Tabla",
    `<div class="ui-table-wrap ui-table-wrap--scroll" style="max-height:220px"><table class="ui-table ui-table--sticky-first"><thead>${head}</thead><tbody>${body}${body}</tbody></table></div>`,
    "Encabezado fijo, primera columna fija, números a la derecha con cifras tabulares, hover de fila, sin cebra.");
}

function campos(): string {
  const f = (label: string, control: string, hint = "", err = "") =>
    `<label class="ui-field" style="width:240px"><span class="ui-field__label">${label}</span>${control}` +
    (hint ? `<span class="ui-field__hint">${hint}</span>` : "") + (err ? `<span class="ui-field__error">${err}</span>` : "") + `</label>`;
  return sec("Campos", row(
    f("Meta de AD", `<input class="ui-input ui-num" inputmode="numeric" placeholder="p. ej. 8,400">`, "Meta mensual del KAM"),
    f("KAM", `<select class="ui-select"><option>Todos los KAMs</option><option>Ana</option><option>Miguel</option></select>`),
    f("% TukTuk (AD)", `<input class="ui-input" value="170" aria-invalid="true">`, "", "Debe estar entre 0 y 100"),
    f("Deshabilitado", `<input class="ui-input" value="—" disabled>`)
  ));
}

function alertas(): string {
  return sec("Alertas", `<div style="display:flex;flex-direction:column;gap:8px">` +
    alertBox({ tone: "info", title: "Escala semanal", text: "El % de cumplimiento no es comparable: la meta es mensual y Active Drivers es un snapshot del período." }) +
    alertBox({ tone: "ok", text: "Metas guardadas en la base de datos (8 filas)." }) +
    alertBox({ tone: "warn", title: "Datos diarios atrasados", text: "Faltan 6 períodos: el último dato es del 31-ago.",
      actions: btn({ label: "Ver frescura", size: "sm", variant: "secondary" }) }) +
    alertBox({ tone: "bad", title: "No se pudo refrescar la pantalla", text: "Las metas se guardaron, pero no se pudo recargar. Recarga la página — no vuelvas a guardar.",
      actions: btn({ label: "Recargar", size: "sm", variant: "primary", icon: "refresh" }) }) +
    `</div>`);
}

function vacio(): string {
  return sec("Estado vacío", emptyState({ icon: "target", title: "Sin metas para septiembre",
    text: "Todavía no se cargaron metas para este mes. Ármalas en la Calculadora o súbelas desde Configuración.",
    action: btn({ label: "Abrir Calculadora", variant: "primary", icon: "calculator" }) }));
}

function encabezado(): string {
  return sec("Encabezado de página", `<div class="ui-card">` + pageHeader({
    title: "Rendimiento",
    subtitle: "Perú · 12 de 60 partners seleccionados",
    actions: rawHtml(btn({ label: "Exportar CSV", icon: "download" }) + btn({ label: "Presentación", variant: "primary", icon: "presentation" })),
    chips: KIT.chips.map(c => ({ label: c.label, value: c.value, removeAct: "uiKitChipRemove", removeData: { k: c.k } })),
    resetAct: "uiKitReset",
    freshness: { text: "Datos hasta la semana del 15-sep · diario: faltan 6 períodos", stale: true }
  }) + `<p style="font-size:13px;color:var(--color-text-muted)">Quitar un chip lo saca de la fila; “Restablecer” los vuelve a poner.</p></div>`,
  "Título, subtítulo, acciones, chips de filtros activos y frescura: nunca un subconjunto rotulado como “Perú”.");
}

function dialogos(): string {
  return sec("Diálogos", row(
    btn({ label: "Confirmar (normal)", act: "uiKitDialog", data: { kind: "normal" } }),
    btn({ label: "Confirmar (peligro)", variant: "danger", act: "uiKitDialog", data: { kind: "danger" } }),
    btn({ label: "Peligro con texto", variant: "danger", icon: "trash", act: "uiKitDialog", data: { kind: "require" } }),
    btn({ label: "Aviso", variant: "ghost", icon: "info", act: "uiKitDialog", data: { kind: "alert" } }),
    `<span style="font-size:13px;color:var(--color-text-muted)">Último resultado: <b id="uiKitResult">${escapeHTML(KIT.lastResult)}</b></span>`
  ), "Esc cancela, Enter confirma solo sin texto requerido, Tab queda dentro, el foco vuelve al botón.");
}

function iconos(): string {
  const names = Object.keys(ICONS) as IconName[];
  return sec(`Iconos (${names.length}, lucide)`, `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px">` +
    names.map(n => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);padding:6px 8px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px">` +
      `${icon(n, { size: 18 })}<code>${n}</code></div>`).join("") + `</div>`);
}

function render(): void {
  const root = document.getElementById("uiKitRoot");
  if (!root) return;
  const scrollTop = (root.querySelector("#uiKitMain") as HTMLElement | null)?.scrollTop ?? 0;
  const content: Html = rawHtml(
    `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">` +
    `<div><div style="font-size:var(--text-xl);font-weight:700">Sistema de diseño — kit</div>` +
    `<div style="font-size:var(--text-sm);color:var(--color-text-muted)">Solo en <code>npm run dev</code> con <code>?ui=kit</code>. No existe en producción.</div></div>` +
    btn({ label: "Cerrar kit", icon: "x", act: "uiKitClose" }) + `</div>` +
    kpis() + encabezado() + botones() + badgesChips() + segmentos() + tabla() + campos() + alertas() + vacio() + dialogos() + colores() + tipografia() + iconos()
  );
  root.innerHTML =
    `<div style="display:flex;height:100%">` +
    `<div style="display:flex;flex-direction:column;flex:0 0 auto;background:var(--color-surface);border-right:1px solid var(--color-border)">` +
    `<div style="display:flex;align-items:center;gap:8px;padding:16px 24px 0;font-weight:700;font-size:16px">` +
    `<span style="width:24px;height:24px;border-radius:6px;background:var(--color-brand);display:inline-block"></span>Yango KAMs</div>` +
    sideNav(NAV, KIT.nav, "uiKitNav") + `</div>` +
    `<main id="uiKitMain" style="flex:1;overflow:auto;padding:24px 32px">` +
    `<div style="max-width:var(--layout-content-max);margin:0 auto">${content}</div></main></div>`;
  const main = root.querySelector("#uiKitMain") as HTMLElement | null;
  if (main) main.scrollTop = scrollTop;
}

function setResult(v: string): void {
  KIT.lastResult = v;
  const el = document.getElementById("uiKitResult");
  if (el) el.textContent = v;
}

const _INITIAL_CHIPS = KIT.chips.slice();

registerActions({
  uiKitClose: () => {
    document.getElementById("uiKitRoot")?.remove();
    document.body.style.overflow = "";
    const u = new URL(location.href);
    u.searchParams.delete("ui");
    history.replaceState(null, "", u.toString());
  },
  uiKitNav: (d: DOMStringMap) => { KIT.nav = d.tab ?? KIT.nav; render(); },
  uiKitSeg: (d: DOMStringMap) => {
    if (d.g === "escala" && d.value) KIT.escala = d.value;
    if (d.g === "linea" && d.value) KIT.linea = d.value;
    render();
  },
  uiKitChipRemove: (d: DOMStringMap) => { KIT.chips = KIT.chips.filter(c => c.k !== d.k); render(); },
  uiKitReset: () => { KIT.chips = _INITIAL_CHIPS.slice(); render(); },
  uiKitDialog: async (d: DOMStringMap) => {
    if (d.kind === "alert") {
      await alertDialog({ title: "Datos cargados", body: "Se cargaron 168 filas de rendimiento semanal.\nLa próxima ingesta es el martes." });
      setResult("aviso cerrado");
      return;
    }
    const ok = d.kind === "require"
      ? await confirmDialog({ title: "Eliminar metas de JULIO 2026", danger: true, requireText: "JULIO", confirmLabel: "Eliminar 44 filas",
          body: "Se eliminarán 44 filas de metas (6 KAMs, 3 ciudades).\nEsta acción no se puede deshacer." })
      : d.kind === "danger"
        ? await confirmDialog({ title: "¿Descartar los cambios?", danger: true, confirmLabel: "Descartar", body: "Tienes 3 metas editadas sin guardar." })
        : await confirmDialog({ title: "Guardar metas de septiembre", confirmLabel: "Guardar", body: "Se escribirán 8 filas (Reparto completo)." });
    setResult(ok ? "confirmó" : "canceló");
  }
});

export function mountUiKit(): void {
  if (document.getElementById("uiKitRoot")) return;
  const root = document.createElement("div");
  root.id = "uiKitRoot";
  root.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--color-bg);" +
    "color:var(--color-text);font-family:var(--font-sans);font-size:var(--text-base)";
  document.body.appendChild(root);
  document.body.style.overflow = "hidden";
  render();
}
