import { describe, it, expect } from "vitest";
import { metaTasaPonderada } from "./metaTasa";

type M = { city: string; mAcc: number | null };
const peso: Record<string, number> = { LIMA: 100, AREQUIPA: 2 };

describe("metaTasaPonderada", () => {
  it("pondera por el peso de CADA unidad (caso del plan: 90%·100 + 50%·2 ≈ 89,2%, no 70%)", () => {
    const rows: M[] = [{ city: "LIMA", mAcc: 90 }, { city: "AREQUIPA", mAcc: 50 }];
    const v = metaTasaPonderada(rows, m => m.mAcc, m => peso[m.city]);
    expect(v).toBeCloseTo((90 * 100 + 50 * 2) / 102, 6);
    expect(v).not.toBeCloseTo(70, 0);
  });
  it("una sola unidad → su meta tal cual", () => {
    expect(metaTasaPonderada([{ city: "LIMA", mAcc: 85 }], m => m.mAcc, m => peso[m.city])).toBe(85);
  });
  it("filas sin esa meta quedan fuera", () => {
    const rows: M[] = [{ city: "LIMA", mAcc: 90 }, { city: "AREQUIPA", mAcc: null }];
    expect(metaTasaPonderada(rows, m => m.mAcc, m => peso[m.city])).toBe(90);
  });
  it("sin peso en ninguna unidad → promedio simple, no 0", () => {
    const rows: M[] = [{ city: "X", mAcc: 80 }, { city: "Y", mAcc: 60 }];
    expect(metaTasaPonderada(rows, m => m.mAcc, () => 0)).toBe(70);
  });
  it("sin ninguna meta cargada → null", () => {
    expect(metaTasaPonderada([{ city: "LIMA", mAcc: null }], m => m.mAcc, () => 1)).toBeNull();
    expect(metaTasaPonderada([], (m: M) => m.mAcc, () => 1)).toBeNull();
  });
});
