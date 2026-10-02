import { describe, it, expect } from "vitest";
import { tipoSubflota, subflotasDe, veredictoMercado } from "./portalPartner";

const M = {
  FLEETROOM_NAME: { a: "Lima", b: "TukTuk", c: "Delivery", d: "Cargo" },
  FLEETROOM_IS_FLEET: { a: true }, FLEETROOM_IS_TUKTUK: { b: true },
  FLEETROOM_IS_DELIVERY: { c: true }, FLEETROOM_IS_CARGO: { d: true }, FLEETROOM_EXCLUDE_TAXI: { c: true, d: true, e: true }
};

describe("portal del partner", () => {
  it("tipo de subflota: Delivery/Cargo antes que la marca de excluida", () => {
    expect(tipoSubflota("a", M)).toBe("fleet");
    expect(tipoSubflota("b", M)).toBe("tuktuk");
    expect(tipoSubflota("c", M)).toBe("delivery");
    expect(tipoSubflota("d", M)).toBe("cargo");
    expect(tipoSubflota("e", M)).toBe("otra");
    expect(tipoSubflota(null, M)).toBe("taxi");
  });
  it("subflotas: las del total primero, por conductores del último período", () => {
    const rows = [
      { db_id: "a", city: "LIMA", date: "2026-09-07", activeDrivers: 999 }, { db_id: "a", city: "LIMA", date: "2026-09-14", activeDrivers: 100 },
      { db_id: "b", city: "LIMA", date: "2026-09-14", activeDrivers: 300 }, { db_id: "c", city: "LIMA", date: "2026-09-14", activeDrivers: 900 },
      { db_id: null, fleetroom: "Sin sub", city: "LIMA", date: "2026-09-14", activeDrivers: 50 }
    ];
    const s = subflotasDe(rows, M);
    expect(s.map(x => x.nombre)).toEqual(["TukTuk", "Lima", "Sin sub", "Delivery"]);
    expect(s.find(x => x.id === "a")!.ad).toBe(100);
    expect(s.find(x => x.id === "c")!.enTotal).toBe(false);
  });
  it("veredicto contra el mercado, también cuando menos es mejor", () => {
    expect(veredictoMercado(0.9, 0.8, 0.85)).toBe("mejor");
    expect(veredictoMercado(0.7, 0.8, 0.85)).toBe("peor");
    expect(veredictoMercado(0.82, 0.8, 0.85)).toBe("normal");
    expect(veredictoMercado(0.01, 0.02, 0.03, true)).toBe("mejor");
    expect(veredictoMercado(0.9, null, null)).toBe("normal");
    expect(veredictoMercado(null, 0.8, 0.85)).toBe("normal");
  });
});
