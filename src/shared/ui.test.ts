// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  btn, kpiCard, badge, chip, segmented, alertBox, emptyState, pageHeader, icon,
  delta, deltaDir, goalTone, numOrDash, dataAttrs, sideNav, rawHtml
} from "./ui";
import { ICONS, iconSvg } from "./icons";

// Lo que fijan estos tests no es el markup exacto (eso lo decide el diseño y va
// a cambiar) sino los dos contratos que NO pueden romperse:
//   1. Todo texto que entra se escapa: un nombre de partner con <script> o
//      comillas no puede salirse de su nodo ni de su atributo.
//   2. null nunca se pinta como 0: "—" para un valor, "N/A" para un delta.

const EVIL = `"><img src=x onerror=alert(1)>'&`;

/** Se PARSEA el HTML (happy-dom) y se revisa el árbol: ningún elemento
 *  inyectado y ningún atributo on*. Buscar texto no sirve — el payload
 *  escapado sigue conteniendo "onerror=" como TEXTO inofensivo. */
function sinInyeccion(html: string): void {
  const box = document.createElement("div");
  box.innerHTML = html;
  expect(box.querySelectorAll("img, script, iframe").length).toBe(0);
  for (const el of Array.from(box.querySelectorAll("*"))) {
    for (const a of Array.from(el.attributes)) expect(a.name.startsWith("on")).toBe(false);
  }
}

describe("escapado", () => {
  it("el detector muerde (un chequeo que nunca falla no es un control)", () => {
    expect(() => sinInyeccion(`<span title=""><img src=x onerror=alert(1)>"></span>`)).toThrow();
    expect(() => sinInyeccion(`<button data-x="" onclick="alert(1)"></button>`)).toThrow();
  });

  it("btn escapa label, title, id y valores data-*", () => {
    const out = btn({ label: EVIL, title: EVIL, id: EVIL, act: "x", data: { partner: EVIL } });
    sinInyeccion(out);
    expect(out).toContain("&quot;&gt;&lt;img");
    expect(out).toContain('data-act="x"');
  });

  it("btn solo-icono lleva aria-label escapado y no texto visible", () => {
    const out = btn({ label: EVIL, icon: "trash", iconOnly: true });
    sinInyeccion(out);
    expect(out).toContain('aria-label="&quot;&gt;&lt;img');
    expect(out).not.toContain("<span>");
  });

  it("kpiCard escapa label, value, sub, prevLabel y caption", () => {
    const out = kpiCard({ label: EVIL, value: EVIL, sub: EVIL, delta: 3, prevLabel: EVIL, goal: { pct: 50, caption: EVIL } });
    sinInyeccion(out);
  });

  it("badge, chip, segmented, alertBox, emptyState, pageHeader, sideNav escapan texto", () => {
    sinInyeccion(badge(EVIL, "ok"));
    sinInyeccion(chip({ label: EVIL, value: EVIL, removeAct: "quitar", removeData: { k: EVIL } }));
    sinInyeccion(segmented({ options: [{ value: EVIL, label: EVIL }], value: EVIL, act: "seg", ariaLabel: EVIL }));
    sinInyeccion(alertBox({ tone: "bad", title: EVIL, text: EVIL }));
    sinInyeccion(emptyState({ title: EVIL, text: EVIL }));
    sinInyeccion(pageHeader({ title: EVIL, subtitle: EVIL, chips: [{ label: EVIL, value: EVIL }], resetAct: "r", resetLabel: EVIL, freshness: { text: EVIL } }));
    sinInyeccion(sideNav([{ label: EVIL, items: [{ id: EVIL, label: EVIL }] }], EVIL, "nav", EVIL));
  });

  it("dataAttrs descarta claves que no son nombres de atributo válidos", () => {
    const out = dataAttrs({ 'x" onclick="alert(1)': "v", ok: "1", camelCase: "2", nada: null, falso: false, si: true });
    expect(out).not.toContain("onclick");
    expect(out).toContain('data-ok="1"');
    expect(out).toContain('data-camel-case="2"');
    expect(out).toContain('data-si=""');
    expect(out).not.toContain("nada");
    expect(out).not.toContain("falso");
  });

  it("los slots Html se insertan tal cual (ya vienen de un helper)", () => {
    const acciones = btn({ label: "PDF", variant: "primary" });
    const out = pageHeader({ title: "Metas", actions: acciones });
    expect(out).toContain(acciones);
    expect(alertBox({ text: "x", actions: rawHtml("<b>ok</b>") })).toContain("<b>ok</b>");
  });
});

describe("null no es 0", () => {
  it("numOrDash", () => {
    expect(numOrDash(null)).toBe("—");
    expect(numOrDash(undefined)).toBe("—");
    expect(numOrDash(NaN)).toBe("—");
    expect(numOrDash("")).toBe("—");
    expect(numOrDash(0)).toBe("0");                 // un 0 real SÍ es 0
    expect(numOrDash(8400)).toBe("8,400");          // es-PE: coma de miles
    expect(numOrDash("4.51M")).toBe("4.51M");       // ya formateado: tal cual
  });

  it("kpiCard con value null muestra — y nunca 0", () => {
    const out = kpiCard({ label: "Aceptación", value: null });
    expect(out).toContain(">—<");
    expect(out).not.toMatch(/ui-kpi__value">0</);
  });

  it("delta null → N/A (no 0,0%); sin delta no hay badge", () => {
    expect(delta(null)).toContain("N/A");
    expect(delta(undefined)).toContain("N/A");
    expect(delta(NaN)).toContain("N/A");
    expect(delta(null)).not.toContain("0.0%");
    expect(kpiCard({ label: "AD", value: 1, delta: null })).toContain("N/A");
    expect(kpiCard({ label: "AD", value: 1 })).not.toContain("ui-delta");
  });

  it("goal con pct null muestra solo el caption, sin barra", () => {
    const out = kpiCard({ label: "Viajes", value: "4.51M", goal: { pct: null, caption: "Sin meta mensual" } });
    expect(out).toContain("Sin meta mensual");
    expect(out).not.toContain("ui-progress");
  });
});

describe("delta", () => {
  it("dirección y umbral de plano", () => {
    expect(deltaDir(13.1)).toBe("up");
    expect(deltaDir(-2.1)).toBe("down");
    expect(deltaDir(0.04)).toBe("flat");
    expect(deltaDir(-0.04)).toBe("flat");
    expect(deltaDir(null)).toBe("na");
  });

  it("subir es bueno por defecto; invert lo da vuelta", () => {
    expect(delta(13.1)).toContain("ui-delta--good");
    expect(delta(-2.1)).toContain("ui-delta--bad");
    expect(delta(13.1, { invert: true })).toContain("ui-delta--bad");
    expect(delta(-2.1, { invert: true })).toContain("ui-delta--good");
  });

  it("signo explícito y un decimal", () => {
    expect(delta(13.1)).toContain("+13.1%");
    expect(delta(-2.1)).toContain("−2.1%");
    expect(delta(0)).toContain("ui-delta--flat");
  });
});

describe("avance contra la meta", () => {
  it("goalTone usa los cortes de pColor/pEstado", () => {
    expect(goalTone(null)).toBeNull();
    expect(goalTone(79.9)).toBe("bad");
    expect(goalTone(80)).toBe("warn");
    expect(goalTone(94.9)).toBe("warn");
    expect(goalTone(95)).toBe("ok");
    expect(goalTone(99.9)).toBe("ok");
    expect(goalTone(100)).toBe("over");
    expect(goalTone(150.1)).toBe("over");
  });

  it("la barra se recorta a 0–100 pero el caption dice el número real", () => {
    const out = kpiCard({ label: "AD", value: 1, goal: { pct: 180, caption: "180% de la meta", projPct: 250 } });
    expect(out).toContain('style="width:100.0%"');
    expect(out).toContain('aria-valuenow="100"');
    expect(out).toContain("180% de la meta");
    expect(out).toContain("ui-progress__proj");
  });
});

describe("segmented", () => {
  it("marca aria-pressed solo en la opción activa y pasa data-value", () => {
    const out = segmented({
      options: [{ value: "semanal", label: "Semanal" }, { value: "mensual", label: "Mensual" }],
      value: "mensual", act: "setEscala", ariaLabel: "Escala"
    });
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-pressed="true" data-act="setEscala" data-value="mensual"/);
    expect(out).toContain('role="group" aria-label="Escala"');
  });
});

describe("chip", () => {
  it("sin removeAct no hay botón; con removeAct el botón tiene nombre accesible", () => {
    expect(chip({ value: "Lima" })).not.toContain("<button");
    const out = chip({ label: "Ciudad", value: "Lima", removeAct: "quitarFiltro", removeData: { k: "city" } });
    expect(out).toContain('aria-label="Quitar filtro Ciudad: Lima"');
    expect(out).toContain('data-act="quitarFiltro" data-k="city"');
  });
});

describe("iconos", () => {
  it("todos los iconos del set generan un <svg> sin script ni handlers", () => {
    for (const name of Object.keys(ICONS)) {
      const svg = iconSvg(name);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      sinInyeccion(svg);
      expect(svg).not.toMatch(/style=/);
    }
  });

  it("nombre desconocido → string vacío (no rompe el render)", () => {
    expect(iconSvg("no-existe")).toBe("");
  });

  it("con label es role=img y el label se escapa", () => {
    const out = icon("info", { label: EVIL, size: 20 });
    expect(out).toContain('role="img"');
    expect(out).toContain('width="20"');
    sinInyeccion(out);
  });
});
