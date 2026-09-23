// shared/theme.ts — Modo oscuro (Ola 7, sep-2026)
//
// Tres preferencias: "light" (Claro), "dark" (Oscuro) y "system" (Sistema:
// sigue a prefers-color-scheme). Se guarda la PREFERENCIA en localStorage y se
// aplica el tema RESUELTO como `data-theme` en <html>; tokens.css re-apunta los
// semánticos con [data-theme="dark"].
//
// ANTES DEL PRIMER PINTADO lo aplica public/theme-init.js (script clásico,
// bloqueante, en el <head>): este módulo llega recién con el grafo de módulos,
// que es diferido, y sin ese script la app parpadearía en claro al abrir con
// el tema oscuro elegido. La CSP prohíbe scripts inline, por eso es un archivo.
// Las dos copias de la regla (esta y la de theme-init.js) las ata un test
// (theme.test.ts): misma clave, mismos valores.
//
// EXPORTACIONES: los PDF/PNG salen SIEMPRE claros, sin tocar la pantalla:
// shared/exportClaro.ts pone el claro en la COPIA que arma html2canvas (onclone)
// y dlChart (charts.ts) exporta una copia clara del gráfico. Las hojas del deck
// llevan data-theme="light" fijo (son un documento, también en pantalla).

export type PrefTema = "light" | "dark" | "system";
export type Tema = "light" | "dark";

export const TEMA_KEY = "yangoTheme";
export const PREFS_TEMA: readonly PrefTema[] = ["light", "dark", "system"];
/** Evento que se dispara en window cuando cambia el tema RESUELTO. */
export const EVENTO_TEMA = "yango:tema";

export function normalizarPref(v: unknown): PrefTema {
  return v === "light" || v === "dark" ? v : "system";
}

export function resolverTema(pref: PrefTema, sistemaOscuro: boolean): Tema {
  if (pref === "light" || pref === "dark") return pref;
  return sistemaOscuro ? "dark" : "light";
}

function _mq(): MediaQueryList | null {
  try { return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null; } catch { return null; }
}

export function sistemaOscuro(): boolean {
  const mq = _mq();
  return !!(mq && mq.matches);
}

export function leerPref(): PrefTema {
  try { return normalizarPref(localStorage.getItem(TEMA_KEY)); } catch { return "system"; }
}

/** Tema que tiene <html> ahora. */
export function temaActual(): Tema {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function _poner(tema: Tema): boolean {
  const html = document.documentElement;
  const antes = html.getAttribute("data-theme");
  html.setAttribute("data-theme", tema);
  if (antes === tema) return false;
  try { window.dispatchEvent(new CustomEvent(EVENTO_TEMA, { detail: { tema } })); } catch { /* sin window */ }
  return true;
}

/** Aplica la preferencia guardada (o la dada). Devuelve el tema resuelto. */
export function aplicarTema(pref: PrefTema = leerPref()): Tema {
  const tema = resolverTema(pref, sistemaOscuro());
  if (typeof document === "undefined") return tema;
  document.documentElement.setAttribute("data-theme-pref", pref);
  _poner(tema);
  return tema;
}

export function guardarPref(pref: PrefTema): Tema {
  const p = normalizarPref(pref);
  try {
    if (p === "system") localStorage.removeItem(TEMA_KEY);
    else localStorage.setItem(TEMA_KEY, p);
  } catch { /* modo privado: vale solo para esta sesión */ }
  return aplicarTema(p);
}

let _instalado = false;
/** Sigue al sistema en vivo cuando la preferencia es "Sistema". */
export function instalarTema(): void {
  if (_instalado) return;
  _instalado = true;
  aplicarTema();
  const mq = _mq();
  if (!mq) return;
  const alCambiar = () => { if (leerPref() === "system") aplicarTema("system"); };
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", alCambiar);
  else if (typeof (mq as any).addListener === "function") (mq as any).addListener(alCambiar);
}
