// shared/confirmDialog.ts — Diálogos en la página (Ola 4, sep-2026)
//
// Reemplazo de los confirm()/alert() nativos (52 en la app, se migran en la
// Ola 6). Por qué no el nativo:
//   · Tapa la pantalla: no se ve QUÉ se está por borrar mientras se confirma.
//   · Se acepta por reflejo (Enter) — justo lo que no se quiere en lo
//     irreversible. Acá, con `requireText`, hay que teclear algo concreto.
//   · No se puede estilar ni traducir el "Aceptar/Cancelar".
//
// CSP: el DOM se arma con createElement/textContent (nada de innerHTML con
// datos) y los listeners se enganchan por addEventListener — sin handlers
// inline, así que `script-src 'self'` no se entera. El icono sí es un string
// SVG propio (sin datos del usuario).
//
// Teclado: el foco queda atrapado dentro del diálogo (Tab / Shift+Tab ciclan),
// Esc cancela, Enter confirma SOLO si no hay requireText (y si el foco no está
// sobre otro botón — ahí Enter activa ese botón, como siempre). Al cerrar, el
// foco vuelve al elemento que lo tenía.

import { iconSvg } from "./icons";
import { t } from "../core/i18n";

export interface ConfirmDialogOptions {
  title: string;
  /** Texto plano; los saltos de línea se respetan. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva: botón de confirmar en rojo y foco inicial en Cancelar. */
  danger?: boolean;
  /** Hay que teclear este texto EXACTO para habilitar Confirmar (p.ej. "JULIO"). */
  requireText?: string;
}

export interface AlertDialogOptions {
  title: string;
  body?: string;
  okLabel?: string;
  tone?: "info" | "bad";
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
let _seq = 0;

function _el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

interface _Built {
  backdrop: HTMLDivElement;
  dialog: HTMLDivElement;
  actions: HTMLDivElement;
  content: HTMLDivElement;
}

function _build(role: "alertdialog" | "dialog", title: string, body: string | undefined, tone: "bad" | "info" | null): _Built {
  const id = `ui-dlg-${++_seq}`;
  const backdrop = _el("div", "ui-dialog-backdrop");
  const dialog = _el("div", "ui-dialog");
  dialog.setAttribute("role", role);
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", `${id}-t`);

  const head = _el("div", "ui-dialog__head" + (tone ? ` ui-dialog__head--${tone}` : ""));
  if (tone) {
    // SVG propio (constante), no datos de usuario.
    const ic = _el("span");
    ic.innerHTML = iconSvg(tone === "bad" ? "alert-triangle" : "info", { size: 20 });
    head.appendChild(ic.firstChild as Node);
  }
  const h = _el("h2", "ui-dialog__title", title);
  h.id = `${id}-t`;
  head.appendChild(h);
  dialog.appendChild(head);

  const content = _el("div");
  if (body) {
    const b = _el("div", "ui-dialog__body", body);
    b.id = `${id}-d`;
    dialog.setAttribute("aria-describedby", b.id);
    content.appendChild(b);
  }
  dialog.appendChild(content);

  const actions = _el("div", "ui-dialog__actions");
  dialog.appendChild(actions);
  backdrop.appendChild(dialog);
  return { backdrop, dialog, actions, content };
}

function _trapTab(e: KeyboardEvent, dialog: HTMLElement): void {
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !dialog.contains(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !dialog.contains(active))) { e.preventDefault(); first.focus(); }
}

/** Confirmación en la página. Resuelve true (confirmó) o false (canceló,
 *  Esc, clic fuera). Nunca rechaza. */
export function confirmDialog(o: ConfirmDialogOptions): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const { backdrop, dialog, actions, content } = _build("alertdialog", o.title, o.body, o.danger ? "bad" : null);

    const cancel = _el("button", "ui-btn ui-btn--secondary", o.cancelLabel ?? t("dialogo.cancelar"));
    cancel.type = "button";
    const ok = _el("button", `ui-btn ${o.danger ? "ui-btn--danger-solid" : "ui-btn--primary"}`, o.confirmLabel ?? t("dialogo.confirmar"));
    ok.type = "button";
    actions.append(cancel, ok);

    let input: HTMLInputElement | null = null;
    if (o.requireText) {
      const lbl = _el("label", "ui-dialog__confirm-text");
      const txt = _el("span");
      txt.append(t("dialogo.paraConfirmar") + " ", _el("code", undefined, o.requireText));
      input = _el("input", "ui-input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      lbl.append(txt, input);
      content.appendChild(lbl);
      ok.disabled = true;
      const need = o.requireText;
      input.addEventListener("input", () => { ok.disabled = (input as HTMLInputElement).value.trim() !== need; });
    }

    let done = false;
    const close = (result: boolean): void => {
      if (done) return;
      done = true;
      backdrop.remove();
      if (prevFocus && typeof prevFocus.focus === "function" && document.contains(prevFocus)) prevFocus.focus();
      resolve(result);
    };

    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => { if (!ok.disabled) close(true); });
    // Clic en el velo (no dentro del diálogo) = cancelar.
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(false); });
    backdrop.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); return; }
      if (e.key === "Tab") { _trapTab(e, dialog); return; }
      if (e.key === "Enter") {
        const t = e.target as HTMLElement;
        if (t && t.tagName === "BUTTON") return;      // Enter activa ESE botón (nativo)
        e.preventDefault();
        if (!o.requireText) close(true);              // con requireText Enter no confirma
      }
    });

    document.body.appendChild(backdrop);
    (input ?? (o.danger ? cancel : ok)).focus();
  });
}

/** Aviso en la página (reemplazo de alert()). Resuelve al cerrar. */
export function alertDialog(o: AlertDialogOptions): Promise<void> {
  return new Promise<void>(resolve => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const { backdrop, dialog, actions } = _build("dialog", o.title, o.body, o.tone ?? "info");
    const ok = _el("button", "ui-btn ui-btn--primary", o.okLabel ?? t("dialogo.entendido"));
    ok.type = "button";
    actions.appendChild(ok);

    let done = false;
    const close = (): void => {
      if (done) return;
      done = true;
      backdrop.remove();
      if (prevFocus && typeof prevFocus.focus === "function" && document.contains(prevFocus)) prevFocus.focus();
      resolve();
    };
    ok.addEventListener("click", close);
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(); });
    backdrop.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") _trapTab(e, dialog);
    });

    document.body.appendChild(backdrop);
    ok.focus();
  });
}
