//@ts-nocheck
import * as XLSX from 'xlsx';
import { leerLibro } from "./excelParse";

// Toda la lógica de lectura vive en excelParse.ts (probada con un .xlsx real en
// excelParse.test.ts); acá solo el transporte del Worker.
self.onmessage = async (e: MessageEvent) => {
  const { fileData, type } = e.data;
  try {
    const libro = leerLibro(XLSX, fileData, type);
    self.postMessage({ success: true, type, ...libro });
  } catch (err: any) {
    self.postMessage({ success: false, error: err?.message || "Error al procesar el archivo Excel" });
  }
};
