import { describe, it, expect } from "vitest";
import { huellaDatos, huellaTabla } from "./huellaDatos";

const rend = [
  { clid: "1", city: "LIMA", fecha: "2026-09-07", active_drivers: 10, trips: 100 },
  { clid: "2", city: "LIMA", fecha: "2026-09-07", active_drivers: 20, trips: 200 },
  { clid: "1", city: "LIMA", fecha: "2026-09-14", active_drivers: 11, trips: 110 }
];
const partners = [{ clid: "1", partner: "A", kam: "Ana" }, { clid: "2", partner: "B", kam: "Beto" }];
const frooms = [{ db_id: "x", is_tuktuk: false }];

describe("huellaDatos", () => {
  it("misma data → misma huella, aunque cambie el orden de las filas", () => {
    const a = huellaDatos([partners, rend, frooms, ["2026-09-07"], "2026-09-07"]);
    const b = huellaDatos([partners.slice().reverse(), [rend[2], rend[0], rend[1]], frooms, ["2026-09-07"], "2026-09-07"]);
    expect(a).toBe(b);
  });

  it("un número distinto en rendimiento cambia la huella", () => {
    const otra = rend.map((r, i) => (i === 1 ? { ...r, trips: 201 } : r));
    expect(huellaTabla(otra)).not.toBe(huellaTabla(rend));
  });

  it("un cambio SOLO en el tagging cambia la huella (no se salta el render)", () => {
    const a = huellaDatos([partners, rend, frooms]);
    const b = huellaDatos([partners, rend, [{ db_id: "x", is_tuktuk: true }]]);
    expect(a).not.toBe(b);
  });

  it("cambiar el KAM de un partner cambia la huella", () => {
    const b = huellaDatos([[partners[0], { ...partners[1], kam: "Ana" }], rend, frooms]);
    expect(b).not.toBe(huellaDatos([partners, rend, frooms]));
  });

  it("una fila de más o de menos cambia la huella; mover filas entre tablas también", () => {
    expect(huellaTabla(rend.slice(0, 2))).not.toBe(huellaTabla(rend));
    expect(huellaDatos([rend, []])).not.toBe(huellaDatos([[], rend]));
  });

  it("las partes escalares (ventana cargada) entran en la huella", () => {
    expect(huellaDatos([rend, "2026-09-07"])).not.toBe(huellaDatos([rend, null]));
  });

  it("filas duplicadas no se cancelan (XOR solo no alcanzaría)", () => {
    expect(huellaTabla([rend[0], rend[0]])).not.toBe(huellaTabla([]));
  });
});
