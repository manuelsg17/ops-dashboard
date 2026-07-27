// shared/actions.js — Dispatcher de eventos DELEGADO (Fase A2, event delegation)
//
// Reemplaza los handlers inline (onclick="fn('arg')") por atributos data-* +
// UN listener por tipo de evento a nivel `document`. Ventajas:
//
// 1. SEGURIDAD (el motivo principal): desaparece el contexto "string JS dentro
//    de un atributo HTML". Ese doble contexto es el que obligaba a escapeJSAttr
//    (escapar primero para JS, luego para HTML) — un patrón sutil que YA se
//    rompió una vez en este proyecto (el bug de escapeHTML(x).replace(/'/g,...)
//    que era un no-op). Con data-attributes, el valor es SOLO texto de atributo:
//    alcanza escapeHTML. Menos superficie, menos clase de bug.
// 2. CSP: sin handlers inline se puede quitar 'unsafe-inline' de script-src.
// 3. Sobrevive a innerHTML: el listener vive en `document`, no en los nodos que
//    cada render destruye y recrea. No hay que re-attachear nada tras repintar.
//
// USO
//   HTML:  `<button data-act="rawSortBy" data-col="${escapeHTML(col)}">`
//   JS:    registerActions({ rawSortBy: (d) => rawSortBy(d.col) })
//   El handler recibe (dataset, el, event).
//
// Un atributo distinto por tipo de evento (data-act = click, data-act-change =
// change, …) para que un mismo elemento pueda tener varios sin ambigüedad.

const _ACTIONS = new Map();

/** Registra acciones. Llamar una vez por módulo, al cargar. */
export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (typeof fn === "function") _ACTIONS.set(name, fn);
  }
}

// datasetKey = cómo lo ve el DOM (data-act-change → dataset.actChange)
function _makeHandler(attr, datasetKey) {
  return e => {
    const el = e.target.closest(`[${attr}]`);
    if (!el) return;
    const fn = _ACTIONS.get(el.dataset[datasetKey]);
    if (!fn) return;
    fn(el.dataset, el, e);
  };
}

// focus/blur NO burbujean (a diferencia de click/change/input/keydown) — un
// listener en `document` nunca los vería. focusin/focusout SÍ burbujean y son
// funcionalmente equivalentes, así que el dispatcher escucha esos dos eventos
// pero los expone bajo los atributos data-act-focus/data-act-blur (más
// intuitivos para quien escribe el HTML que "focusin/focusout").
const _WIRED = [
  ["click",     "data-act",           "act"],
  ["change",    "data-act-change",    "actChange"],
  ["input",     "data-act-input",     "actInput"],
  ["keydown",   "data-act-keydown",   "actKeydown"],
  ["mousedown", "data-act-mousedown", "actMousedown"],
  ["focusin",   "data-act-focus",     "actFocus"],
  ["focusout",  "data-act-blur",      "actBlur"],
  ["submit",    "data-act-submit",    "actSubmit"]
];

for (const [evName, attr, datasetKey] of _WIRED) {
  document.addEventListener(evName, _makeHandler(attr, datasetKey));
}
