import { describe, it, expect } from "vitest";
import { fechaLimaISO } from "./dates";

describe("fechaLimaISO — nombres de archivo en hora de Lima", () => {
  it("a las 20:00 de Lima (01:00 UTC del día siguiente) sigue siendo HOY", () => {
    expect(fechaLimaISO(new Date("2026-09-24T01:00:00Z"))).toBe("2026-09-23");
  });
  it("a las 00:30 de Lima ya es el día nuevo", () => {
    expect(fechaLimaISO(new Date("2026-09-24T05:30:00Z"))).toBe("2026-09-24");
  });
  it("cruce de año", () => {
    expect(fechaLimaISO(new Date("2027-01-01T03:00:00Z"))).toBe("2026-12-31");
  });
});
