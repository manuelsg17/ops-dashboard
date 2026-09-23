// ============================================================
// workers/excelParse.ts — Lectura del Excel, sin DOM ni Worker (B2)
// ============================================================
// Lo usa el Web Worker (excelWorker.ts) y los tests. Separado del worker porque
// este no se puede importar desde Node (asigna `self.onmessage` al evaluarse).
//
// QUÉ SE HABÍA PERDIDO al pasar la lectura al Worker (jul-2026), y vuelve acá:
//  - La 2da pestaña del Excel de Conversión ("Adquisition by channel") ya no se
//    leía: la adquisición por canal se descartaba EN SILENCIO en cada carga.
//  - La hoja "METAS" ya no se buscaba por nombre: con un Excel de metas cuya
//    primera pestaña no fuera METAS se cargaba otra hoja.
// El formato de las filas (array-de-arrays → objetos con la fila 1 como header)
// es el MISMO que el Worker entrega desde jul-2026: no se toca, para no cambiar
// cómo se leen los uploads que hoy funcionan.

// XLSX se inyecta (el Worker lo trae de npm; los tests también) para que este
// archivo no arrastre la librería a ningún otro bundle.
type XLSXLike = {
  read: (data: unknown, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json: (ws: unknown, opts: Record<string, unknown>) => unknown[][] };
};

/** Nombre de la hoja principal a leer para cada tipo de carga. */
export function elegirHoja(sheetNames: string[], type: string): string {
  const up = sheetNames.map(s => String(s).toUpperCase().trim());
  const idx = (pred: (s: string) => boolean) => { const i = up.findIndex(pred); return i >= 0 ? i : 0; };
  let i = 0;
  if (type === "data")                                   i = up.indexOf("DATOS") >= 0 ? up.indexOf("DATOS") : idx(s => s === "DATA");
  else if (type === "rendimiento" || type === "rendimientoDiario" || type === "rendimientoMensual")
                                                         i = idx(s => s === "RENDIMIENTO");
  else if (type === "conversion")                        i = idx(s => /CONVERSI/.test(s));
  else if (type === "metas")                             i = idx(s => s === "METAS");
  else if (type === "flotas")                            i = idx(s => s === "FLOTAS");
  return sheetNames[i];
}

/** Pestaña de "Adquisición por canal" del Excel de Conversión, o null. */
export function hojaCanales(sheetNames: string[]): string | null {
  const s = sheetNames.find(n => /ADQUIS|ADQUISIT|CHANNEL|CANAL/i.test(String(n)));
  return s == null ? null : s;
}

/** array-de-arrays (fila 1 = headers) → array de objetos. Headers vacíos se
 *  ignoran; celdas ausentes quedan en "". Mismo contrato que handleFile usaba. */
export function filasComoObjetos(rawRows: unknown[][]): Record<string, unknown>[] {
  const headers = (rawRows && rawRows[0]) || [];
  return (rawRows || []).slice(1).map(row => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { if (h) obj[String(h)] = row && row[i] !== undefined ? row[i] : ""; });
    return obj;
  });
}

export interface LibroLeido {
  sheetName: string;
  rawRows: unknown[][];
  /** Solo en Conversión: filas crudas de la pestaña de canales (si existe). */
  canales?: { sheetName: string; rawRows: unknown[][] } | null;
}

/** Lee el libro (string binario, como lo entrega FileReader.readAsBinaryString). */
export function leerLibro(XLSX: XLSXLike, fileData: unknown, type: string): LibroLeido {
  const wb = XLSX.read(fileData, { type: "binary", raw: false, defval: "" });
  const sheetName = elegirHoja(wb.SheetNames, type);
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
  const out: LibroLeido = { sheetName, rawRows };
  if (type === "conversion") {
    const ch = hojaCanales(wb.SheetNames.filter(n => n !== sheetName));
    out.canales = ch
      ? { sheetName: ch, rawRows: XLSX.utils.sheet_to_json(wb.Sheets[ch], { header: 1, defval: "" }) }
      : null;
  }
  return out;
}
