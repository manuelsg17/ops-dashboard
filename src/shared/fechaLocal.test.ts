import { describe, it, expect } from "vitest";
import { fechaLocalISO } from "./fechaLocal";

describe("fechaLocalISO", () => {
  it("después de las 19:00 en Lima sigue siendo HOY (toISOString daba mañana)", () => {
    const noche = new Date("2026-10-01T01:30:00Z");   // 30-sep 20:30 Lima
    expect(noche.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(fechaLocalISO(noche)).toBe("2026-09-30");
  });
  it("formato YYYY-MM-DD con ceros", () => {
    expect(fechaLocalISO(new Date("2026-03-05T15:00:00Z"))).toBe("2026-03-05");
  });
  it("cruce de año", () => {
    expect(fechaLocalISO(new Date("2027-01-01T04:59:00Z"))).toBe("2026-12-31");
    expect(fechaLocalISO(new Date("2027-01-01T05:00:00Z"))).toBe("2027-01-01");
  });
});
