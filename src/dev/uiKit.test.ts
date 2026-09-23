// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mountUiKit } from "./uiKit";

// Humo del kit: que monte sin excepciones, que muestre cada familia de
// componentes y que el cableado data-act → registerActions funcione (el
// dispatcher de shared/actions.ts escucha en `document`).

describe("kit del sistema de diseño", () => {
  mountUiKit();
  const root = () => document.getElementById("uiKitRoot") as HTMLElement;

  it("monta todas las familias de componentes", () => {
    expect(root()).not.toBeNull();
    for (const sel of [".ui-kpi", ".ui-btn--primary", ".ui-btn--danger", ".ui-badge--over", ".ui-chip",
      ".ui-segmented", ".ui-table", ".ui-input", ".ui-select", ".ui-alert--bad", ".ui-empty",
      ".ui-page-header", ".ui-sidenav", ".ui-icon", ".ui-progress__proj"]) {
      expect(root().querySelector(sel), sel).not.toBeNull();
    }
    expect(root().querySelectorAll(".ui-kpi").length).toBe(7);
    expect(root().textContent).toContain("92% de la meta de septiembre (8,400)");
    expect(root().textContent).toContain("Sin meta mensual");
  });

  it("el segmentado cambia aria-pressed vía data-act", () => {
    const b = Array.from(root().querySelectorAll<HTMLButtonElement>(".ui-segmented__btn")).find(x => x.textContent === "Mensual")!;
    b.click();
    const again = Array.from(root().querySelectorAll<HTMLButtonElement>(".ui-segmented__btn")).find(x => x.textContent === "Mensual")!;
    expect(again.getAttribute("aria-pressed")).toBe("true");
  });

  it("la navegación marca aria-current en el ítem elegido", () => {
    const item = Array.from(root().querySelectorAll<HTMLButtonElement>(".ui-sidenav__item")).find(x => x.textContent === "Metas")!;
    item.click();
    expect(root().querySelector('.ui-sidenav__item[aria-current="page"]')?.textContent).toBe("Metas");
  });

  it("quitar un chip y restablecer", () => {
    const n = () => root().querySelectorAll(".ui-page-header .ui-chip").length;
    expect(n()).toBe(5);
    (root().querySelector(".ui-page-header .ui-chip__remove") as HTMLButtonElement).click();
    expect(n()).toBe(4);
    (root().querySelector(".ui-page-header .ui-link-btn") as HTMLButtonElement).click();
    expect(n()).toBe(5);
  });

  it("el botón de diálogo abre un ui-dialog y Esc lo cierra", async () => {
    const b = Array.from(root().querySelectorAll<HTMLButtonElement>(".ui-btn")).find(x => x.textContent === "Peligro con texto")!;
    b.click();
    await Promise.resolve();
    const d = document.querySelector(".ui-dialog") as HTMLElement;
    expect(d).not.toBeNull();
    expect(d.querySelector("input")).not.toBeNull();
    d.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelector(".ui-dialog")).toBeNull();
    expect(document.getElementById("uiKitResult")?.textContent).toBe("canceló");
  });
});
