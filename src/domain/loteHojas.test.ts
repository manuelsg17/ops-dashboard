import { describe, it, expect } from "vitest";
import {
  tipoDeEtiqueta, tipoDeClave, nuevasReglas, incluida, fijarHoja, fijarTipoTodos,
  aplicarPlantilla, plantillaActiva, tieneExcepciones, estadoDe, siguienteValor
} from "./loteHojas";

const RAW_TX = "taxi|Data Raw (#) · Taxi", RAW_TXP = "taxi|Data Raw (%) · Taxi", KPI_TX = "taxi|KPIs por Nivel · Taxi";

describe("lote de presentaciones: qué hojas van", () => {
  it("tipo de hoja por su etiqueta en español, con o sin vertical", () => {
    expect(tipoDeEtiqueta("Carátula")).toBe("portada");
    expect(tipoDeEtiqueta("KPIs por Nivel · TukTuk")).toBe("kpis");
    expect(tipoDeClave(RAW_TXP)).toBe("raw");
    expect(tipoDeEtiqueta("N+R por origen · Taxi")).toBe("nrorigen");
    expect(tipoDeEtiqueta("Algo nuevo")).toBe("otra");
  });
  it("columna apaga un tipo en todo el lote y borra excepciones de ese tipo", () => {
    const r = nuevasReglas();
    fijarHoja(r, "A", RAW_TX, false);
    fijarHoja(r, "B", KPI_TX, false);
    fijarTipoTodos(r, "raw", false);
    expect(incluida(r, "A", RAW_TX)).toBe(false);
    expect(incluida(r, "C", RAW_TXP)).toBe(false);
    expect(tieneExcepciones(r, "A")).toBe(false);       // la excepción de raw se fue
    expect(incluida(r, "B", KPI_TX)).toBe(false);       // la de kpis sigue
    fijarTipoTodos(r, "raw", true);
    expect(incluida(r, "A", RAW_TX)).toBe(true);
  });
  it("una celda puede prender en un partner lo que la columna apagó para todos", () => {
    const r = nuevasReglas(["raw"]);
    fijarHoja(r, "A", RAW_TX, true);
    expect(incluida(r, "A", RAW_TX)).toBe(true);
    expect(incluida(r, "B", RAW_TX)).toBe(false);
    fijarHoja(r, "A", RAW_TX, false);                    // volver a la general no deja rastro
    expect(tieneExcepciones(r, "A")).toBe(false);
  });
  it("hoja suelta para todos (misma clave en todos los partners)", () => {
    const r = nuevasReglas();
    r.offKeys.add(RAW_TX);
    expect(incluida(r, "A", RAW_TX)).toBe(false);
    expect(incluida(r, "A", RAW_TXP)).toBe(true);
  });
  it("plantillas y cuál está activa", () => {
    const r = nuevasReglas();
    aplicarPlantilla(r, "ejecutivo");
    expect(plantillaActiva(r)).toBe("ejecutivo");
    expect(incluida(r, "A", "taxi|Resumen")).toBe(true);
    expect(incluida(r, "A", KPI_TX)).toBe(false);
    fijarHoja(r, "A", KPI_TX, true);
    expect(plantillaActiva(r)).toBe("");                  // tocada a mano
    aplicarPlantilla(r, "completo");
    expect(plantillaActiva(r)).toBe("completo");
    expect(tieneExcepciones(r, "A")).toBe(false);
  });
  it("estado de celda/columna y qué hace el clic", () => {
    expect(estadoDe([])).toBe("na");
    expect(estadoDe([true, true])).toBe("on");
    expect(estadoDe([false, false])).toBe("off");
    expect(estadoDe([true, false])).toBe("mix");
    expect(siguienteValor("on")).toBe(false);
    expect(siguienteValor("mix")).toBe(true);
    expect(siguienteValor("off")).toBe(true);
  });
});
