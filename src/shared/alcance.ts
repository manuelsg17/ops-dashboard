// Alcance de los filtros activos, en texto (I13, plan de mejora sep-2026).
//
// Los filtros del sidebar se restauran de la sesión anterior (localStorage) sin
// ningún indicador: el título decía "Perú – Vista General" mientras la pantalla
// mostraba, por ejemplo, solo "No KAM" en Lima. Esto arma las partes que el
// título/subtítulo tiene que declarar. Los chips completos llegan en la Ola 5;
// esto es el mínimo para que un subconjunto nunca se rotule como el país.
//
// Puro: la traducción y el rótulo de ciudad entran por parámetro.

export interface FiltrosAlcance {
  city?: string | null;     // "all" o la ciudad
  kam?: string | null;      // "all" o el KAM (incluido el bucket "No KAM")
  nSel?: number;            // partners seleccionados en el sidebar
  nTotal?: number;          // partners disponibles en el sidebar
}

export function partesAlcance(
  f: FiltrosAlcance,
  t: (k: string, o?: Record<string, unknown>) => string,
  cityLabel: (c: string) => string = c => c
): string[] {
  const out: string[] = [];
  if (f.city && f.city !== "all") out.push(cityLabel(f.city));
  const hayKam = !!(f.kam && f.kam !== "all");
  if (hayKam) out.push(t("alcance.kam", { k: f.kam }));
  // Con un KAM elegido la selección ya es "sus partners": repetir el conteo
  // sería ruido. Sin KAM, una selección parcial SÍ es un recorte que hay que decir.
  if (!hayKam && f.nTotal && f.nSel != null && f.nSel > 0 && f.nSel < f.nTotal) {
    out.push(t("alcance.partners", { n: f.nSel, total: f.nTotal }));
  }
  return out;
}
