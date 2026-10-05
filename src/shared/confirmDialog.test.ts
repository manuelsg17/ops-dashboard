// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { confirmDialog, alertDialog, validarNuevaClave, passwordDialog } from "./confirmDialog";

// Contratos del diálogo que reemplaza confirm()/alert():
//   · Esc y clic en el velo CANCELAN; nunca confirman por accidente.
//   · Enter confirma solo si no hay requireText.
//   · Con requireText el botón queda deshabilitado hasta teclear el texto exacto.
//   · El texto se inserta como texto (no HTML) y el foco vuelve al origen.

const key = (el: Element, k: string, extra: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));

const dlg = () => document.querySelector(".ui-dialog") as HTMLElement;
const btns = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".ui-dialog__actions button"));

afterEach(() => { document.body.innerHTML = ""; });

describe("confirmDialog", () => {
  it("Esc cancela y quita el diálogo del DOM", async () => {
    const p = confirmDialog({ title: "¿Borrar?", body: "x" });
    key(document.activeElement as Element, "Escape");
    expect(await p).toBe(false);
    expect(document.querySelector(".ui-dialog-backdrop")).toBeNull();
  });

  it("Enter confirma cuando no hay requireText (foco en el diálogo, no en un botón)", async () => {
    const p = confirmDialog({ title: "¿Seguir?" });
    key(dlg(), "Enter");
    expect(await p).toBe(true);
  });

  it("clic en el velo cancela; clic dentro del diálogo no", async () => {
    const p = confirmDialog({ title: "t" });
    dlg().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".ui-dialog")).not.toBeNull();
    const bd = document.querySelector(".ui-dialog-backdrop") as HTMLElement;
    bd.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(await p).toBe(false);
  });

  it("botones Cancelar / Confirmar resuelven false / true", async () => {
    const p1 = confirmDialog({ title: "a", confirmLabel: "Sí", cancelLabel: "No" });
    expect(btns().map(b => b.textContent)).toEqual(["No", "Sí"]);
    btns()[0].click();
    expect(await p1).toBe(false);
    const p2 = confirmDialog({ title: "b" });
    btns()[1].click();
    expect(await p2).toBe(true);
  });

  it("danger: foco inicial en Cancelar y botón rojo sólido", async () => {
    const p = confirmDialog({ title: "Eliminar", danger: true });
    const [cancel, ok] = btns();
    expect(document.activeElement).toBe(cancel);
    expect(ok.className).toContain("ui-btn--danger-solid");
    expect(dlg().getAttribute("role")).toBe("alertdialog");
    expect(dlg().getAttribute("aria-modal")).toBe("true");
    cancel.click();
    expect(await p).toBe(false);
  });

  it("requireText: deshabilitado hasta el texto exacto; Enter NO confirma", async () => {
    const p = confirmDialog({ title: "Eliminar metas", danger: true, requireText: "JULIO" });
    const input = document.querySelector(".ui-dialog input") as HTMLInputElement;
    const ok = btns()[1];
    expect(document.activeElement).toBe(input);
    expect(ok.disabled).toBe(true);

    input.value = "julio";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ok.disabled).toBe(true);           // distingue mayúsculas

    input.value = "JULIO";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ok.disabled).toBe(false);

    key(input, "Enter");                      // aún habilitado, Enter no confirma
    expect(document.querySelector(".ui-dialog")).not.toBeNull();

    ok.click();
    expect(await p).toBe(true);
  });

  it("requireTextIgnoreCase: 'ana' vale por 'Ana', se muestra el nombre exacto; otro texto no", async () => {
    const p = confirmDialog({ title: "Eliminar metas de Ana", danger: true, requireText: "Ana", requireTextIgnoreCase: true });
    const input = document.querySelector(".ui-dialog input") as HTMLInputElement;
    const ok = btns()[1];
    expect(dlg().querySelector("code")?.textContent).toBe("Ana");
    const typ = (v: string) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); };
    typ("An");      expect(ok.disabled).toBe(true);
    typ("Bruno");   expect(ok.disabled).toBe(true);
    typ("  aNA ");  expect(ok.disabled).toBe(false);
    typ("ana x");   expect(ok.disabled).toBe(true);
    btns()[0].click();
    expect(await p).toBe(false);
  });

  it("title/body se insertan como TEXTO, no como HTML", async () => {
    const p = confirmDialog({ title: `<img src=x onerror=alert(1)>`, body: `<b>hola</b>` });
    expect(dlg().querySelector("img")).toBeNull();
    expect(dlg().querySelector("b")).toBeNull();
    expect(dlg().textContent).toContain("<b>hola</b>");
    btns()[0].click();
    await p;
  });

  it("Tab queda atrapado dentro del diálogo", async () => {
    const p = confirmDialog({ title: "t" });
    const [cancel, ok] = btns();
    ok.focus();
    key(ok, "Tab");
    expect(document.activeElement).toBe(cancel);
    key(cancel, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(ok);
    cancel.click();
    await p;
  });

  it("devuelve el foco al elemento que lo tenía", async () => {
    const origen = document.createElement("button");
    document.body.appendChild(origen);
    origen.focus();
    const p = confirmDialog({ title: "t" });
    expect(document.activeElement).not.toBe(origen);
    btns()[0].click();
    await p;
    expect(document.activeElement).toBe(origen);
  });
});

describe("alertDialog", () => {
  it("se cierra con el botón o con Esc", async () => {
    const p1 = alertDialog({ title: "Listo", body: "Se guardaron 8 filas" });
    expect(dlg().getAttribute("role")).toBe("dialog");
    btns()[0].click();
    await p1;
    expect(document.querySelector(".ui-dialog")).toBeNull();

    const p2 = alertDialog({ title: "Error", tone: "bad" });
    key(document.activeElement as Element, "Escape");
    await p2;
    expect(document.querySelector(".ui-dialog")).toBeNull();
  });
});

describe("contraseña nueva", () => {
  it("valida largo, mezcla de letras y números, y que coincidan", () => {
    expect(validarNuevaClave("abc12", "abc12")).toBe("clave.err.corta");
    expect(validarNuevaClave("abcdefgh", "abcdefgh")).toBe("clave.err.mezcla");
    expect(validarNuevaClave("12345678", "12345678")).toBe("clave.err.mezcla");
    expect(validarNuevaClave("partner2026", "partner2025")).toBe("clave.err.noCoinciden");
    expect(validarNuevaClave("partner2026", "partner2026")).toBeNull();
  });
  it("el diálogo no deja guardar si no coinciden y devuelve la contraseña cuando sí", async () => {
    const p = passwordDialog({ title: "x" });
    const [a, b] = Array.from(document.querySelectorAll<HTMLInputElement>(".ui-dialog input[type=password]"));
    const ok = document.querySelector<HTMLButtonElement>(".ui-dialog .ui-btn--primary")!;
    a.value = "partner2026"; b.value = "otra2026x"; ok.click();
    expect(document.querySelector(".ui-dialog")).not.toBeNull();          // sigue abierto
    expect(document.querySelector(".ui-dialog__err")!.textContent).not.toBe("");
    b.value = "partner2026"; ok.click();
    await expect(p).resolves.toBe("partner2026");
    expect(document.querySelector(".ui-dialog")).toBeNull();
  });
});
