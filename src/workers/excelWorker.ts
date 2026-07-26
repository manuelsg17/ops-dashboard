//@ts-nocheck
import * as XLSX from 'xlsx';

self.onmessage = async (e: MessageEvent) => {
  const { fileData, type } = e.data;
  try {
    const wb = XLSX.read(fileData, { type: "binary", raw: false, defval: "" });
    const sheetNames = wb.SheetNames.map(s => s.toUpperCase());
    
    let sheetName = wb.SheetNames[0];
    if (type === "data") {
      sheetName = wb.SheetNames[sheetNames.indexOf("DATOS") >= 0 ? sheetNames.indexOf("DATOS")
        : sheetNames.indexOf("DATA") >= 0 ? sheetNames.indexOf("DATA") : 0];
    } else if (type === "rendimiento" || type === "rendimientoDiario") {
      sheetName = wb.SheetNames[sheetNames.indexOf("RENDIMIENTO") >= 0
        ? sheetNames.indexOf("RENDIMIENTO") : 0];
    } else if (type === "conversion") {
      const ci = sheetNames.findIndex(s => /CONVERSI/.test(s));
      sheetName = wb.SheetNames[ci >= 0 ? ci : 0];
    }

    const sheet = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    self.postMessage({ success: true, rawRows, sheetName, type });
  } catch (err: any) {
    self.postMessage({ success: false, error: err?.message || "Error al procesar el archivo Excel" });
  }
};
