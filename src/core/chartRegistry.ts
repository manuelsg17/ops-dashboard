//@ts-nocheck
/**
 * ChartRegistry — Registro centralizado de instancias de gráficos para evitar Fugas de Memoria (Memory Leaks).
 */
class ChartRegistryManager {
  private charts: Map<string, any> = new Map();

  register(id: string, chartInstance: any) {
    this.destroy(id);
    this.charts.set(id, chartInstance);
  }

  destroy(id: string) {
    if (this.charts.has(id)) {
      const instance = this.charts.get(id);
      try {
        if (instance && typeof instance.destroy === "function") {
          instance.destroy();
        }
      } catch (e) {
        console.warn(`Error destruyendo gráfica ${id}:`, e);
      }
      this.charts.delete(id);
    }
  }

  destroyAll() {
    this.charts.forEach((instance, id) => {
      try {
        if (instance && typeof instance.destroy === "function") {
          instance.destroy();
        }
      } catch (e) {}
    });
    this.charts.clear();
  }

  has(id: string): boolean {
    return this.charts.has(id);
  }
}

export const ChartRegistry = new ChartRegistryManager();
