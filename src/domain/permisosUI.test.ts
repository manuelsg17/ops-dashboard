import { describe, it, expect } from "vitest";
import { puede } from "./permisosUI";

// Espejo de RLS (baseline): si una de estas expectativas cambia, cambió una
// política — revisar que sea a propósito.
describe("puede — espejo de las políticas RLS", () => {
  const S = (rol: string, perms: string[] = []) => ({ rol, perms });
  it("partners: escribir kam/admin/write:config; borrar solo admin", () => {
    expect(puede("partners.escribir", S("kam"))).toBe(true);
    expect(puede("partners.escribir", S("viewer"))).toBe(false);
    expect(puede("partners.escribir", S("viewer", ["write:config"]))).toBe(true);
    expect(puede("partners.borrar", S("kam"))).toBe(false);
    expect(puede("partners.borrar", S("viewer", ["write:config", "delete:data"]))).toBe(false);
    expect(puede("partners.borrar", S("admin"))).toBe(true);
  });
  it("flotas: un viewer NO; kam sí", () => {
    expect(puede("flotas.escribir", S("viewer"))).toBe(false);
    expect(puede("flotas.escribir", S("kam"))).toBe(true);
  });
  it("fleetrooms: admin o write:config — un kam NO", () => {
    expect(puede("fleetrooms.escribir", S("kam"))).toBe(false);
    expect(puede("fleetrooms.escribir", S("kam", ["write:config"]))).toBe(true);
    expect(puede("fleetrooms.escribir", S("admin"))).toBe(true);
  });
  it("borrar datos: admin o delete:data", () => {
    expect(puede("datos.borrar", S("kam"))).toBe(false);
    expect(puede("datos.borrar", S("viewer", ["delete:data"]))).toBe(true);
  });
  it("un partner nunca escribe, aunque tenga grants", () => {
    expect(puede("partners.escribir", S("partner", ["write:config"]))).toBe(false);
    expect(puede("datos.borrar", S("partner", ["delete:data"]))).toBe(false);
  });
  it("sin sesión → nada", () => {
    expect(puede("partners.escribir", { rol: null })).toBe(false);
  });
});
