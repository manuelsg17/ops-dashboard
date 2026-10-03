// shared/tactil.ts — Ayudas para pantallas táctiles (iPad, celular). 3-oct-2026.
//
// Pedido de Manuel: que la app funcione bien en escritorio, iPad y celular.
// Auditoría: no hay controles escondidos tras el hover, pero MUCHA explicación
// vive solo en el atributo `title` (variación contra el período anterior, "N/A"
// y "NEW", corte de la proyección, mercado del portal, cifras exactas de Data
// Raw, íconos de la Calculadora…). Sin mouse el `title` no se ve nunca.
//
// 1. `title` tocable: en un dispositivo sin hover, tocar un elemento NO
//    interactivo que tenga `title` muestra ese texto en una burbuja. Los botones
//    y controles no se tocan (su toque ya hace algo y su texto suele estar a la
//    vista). Una sola burbuja a la vez; se cierra al tocar en otro lado, con
//    scroll o con Esc.
// 2. Burbujas ⓘ (`ui.infoTip`) dentro de la pantalla: al mostrarse se corren
//    hacia adentro si se saldrían por un costado (variable --tip-dx).

const INTERACTIVO = "button, a[href], input, select, textarea, label, summary, [data-act], [data-act-change], [contenteditable='true'], .ui-tip";

/** Desplazamiento horizontal (px) para que una burbuja de `ancho` centrada en
 *  `centro` quede dentro de [margen, vw - margen]. Puro (test). */
export function corrimientoBurbuja(centro: number, ancho: number, vw: number, margen = 12): number {
  const izq = centro - ancho / 2;
  const min = margen, max = vw - margen - ancho;
  if (max < min) return Math.round(min - izq);
  if (izq < min) return Math.round(min - izq);
  if (izq > max) return Math.round(max - izq);
  return 0;
}

/** ¿El `title` aporta algo que no está ya escrito en el elemento? Puro (test). */
export function tituloAporta(titulo: string, texto: string): boolean {
  const n = (s: string) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const tt = n(titulo);
  return !!tt && tt !== n(texto);
}

const sinHover = () => typeof matchMedia === "function" && matchMedia("(hover: none)").matches;

function _cerrar() { document.getElementById("tituloPop")?.remove(); }

function _mostrar(el: Element, texto: string) {
  _cerrar();
  const pop = document.createElement("div");
  pop.id = "tituloPop";
  pop.className = "titulo-pop";
  pop.setAttribute("role", "tooltip");
  pop.textContent = texto;
  document.body.appendChild(pop);
  const r = el.getBoundingClientRect(), M = 8;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.bottom + 6;
  if (y + h > window.innerHeight - M) y = r.top - h - 6;
  x = Math.max(M, Math.min(x, window.innerWidth - w - M));
  pop.style.left = Math.round(x) + "px";
  pop.style.top = Math.round(Math.max(M, y)) + "px";
}

function _ajustarInfoTip(tip: HTMLElement) {
  const vw = document.documentElement.clientWidth;
  const ancho = Math.min(280, vw - 32);
  const r = tip.getBoundingClientRect();
  tip.style.setProperty("--tip-dx", corrimientoBurbuja(r.left + r.width / 2, ancho, vw) + "px");
}

/** ¿iPhone/iPad? (iPadOS se presenta como Mac, pero con pantalla táctil.) Puro (test). */
export function esIOS(ua: string, plataforma: string, puntosTactiles: number): boolean {
  if (/Android/i.test(ua)) return false;   // nunca: ahí maximum-scale sí bloquea el pellizco
  return /iPad|iPhone|iPod/.test(ua) || (plataforma === "MacIntel" && puntosTactiles > 1);
}

/** Agrega `maximum-scale=1` al viewport si no está. Puro (test). */
export function viewportSinZoomDeFoco(content: string): string {
  return /maximum-scale/.test(content) ? content : content.replace(/\s*$/, "") + ", maximum-scale=1";
}

// Safari de iPhone/iPad amplía la página al tocar un campo con letra < 16 px y
// la deja ampliada (3-oct-2026: casi todos los campos de la app son de 12-14 px,
// 189 solo en la tabla de la Calculadora). `maximum-scale=1` lo evita y, desde
// iOS 10, Safari IGNORA ese tope para el pellizco: se sigue pudiendo hacer zoom
// con dos dedos. Solo en iOS: en Android sí bloquearía el pellizco.
function _sinZoomAlEnfocarEnIOS() {
  if (typeof navigator === "undefined" || !esIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0)) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute("content", viewportSinZoomDeFoco(meta.getAttribute("content") || "width=device-width,initial-scale=1"));
}

// Apenas carga el módulo (eager, lo importa app.ts): así ya rige en la pantalla
// de login, antes de iniciar sesión.
if (typeof document !== "undefined") _sinZoomAlEnfocarEnIOS();

let _instalado = false;
export function instalarAyudasTactiles(): void {
  if (_instalado || typeof document === "undefined") return;
  _instalado = true;

  // 1. `title` tocable (solo sin hover).
  document.addEventListener("click", e => {
    if (!sinHover()) return;
    const tg = e.target as Element | null;
    if (!tg || !tg.closest) return;
    if (tg.closest("#tituloPop")) return;
    const conTitulo = tg.closest("[title]") as HTMLElement | null;
    if (!conTitulo) { _cerrar(); return; }
    // Si entre el toque y el elemento con title hay algo interactivo, ese toque
    // es suyo (ordenar, abrir una tarjeta, cambiar de pestaña…).
    const inter = tg.closest(INTERACTIVO);
    if (inter && (inter === conTitulo || conTitulo.contains(inter) || inter.contains(conTitulo))) { _cerrar(); return; }
    const titulo = conTitulo.getAttribute("title") || "";
    if (!tituloAporta(titulo, conTitulo.textContent || "")) { _cerrar(); return; }
    const abierto = document.getElementById("tituloPop");
    if (abierto && abierto.dataset.de === titulo) { _cerrar(); return; }   // segundo toque: cerrar
    _mostrar(conTitulo, titulo);
    const pop = document.getElementById("tituloPop");
    if (pop) pop.dataset.de = titulo;
  });
  document.addEventListener("pointerdown", e => {
    const pop = document.getElementById("tituloPop");
    if (!pop) return;
    const tg = e.target as Element | null;
    if (tg && tg.closest && (tg.closest("#tituloPop") || tg.closest("[title]"))) return;   // lo resuelve el click
    _cerrar();
  }, true);
  document.addEventListener("scroll", () => _cerrar(), { capture: true, passive: true });
  document.addEventListener("keydown", e => { if (e.key === "Escape") _cerrar(); });

  // 2. Burbujas ⓘ dentro de la pantalla, al momento de mostrarse.
  const ajustar = (e: Event) => {
    const tip = (e.target as Element | null)?.closest?.(".ui-tip") as HTMLElement | null;
    if (tip) _ajustarInfoTip(tip);
  };
  document.addEventListener("mouseover", ajustar, { passive: true });
  document.addEventListener("focusin", ajustar);
}
