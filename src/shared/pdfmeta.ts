// pdfmeta.js — Metadatos de exportación en los PDFs.
//
// Versión anterior agregaba también un pie de página VISIBLE en cada hoja con
// el email de quien exportó ("exportado por fulano@..."). Manuel pidió
// eliminarlo explícitamente (jul 2026): no quiere que su correo quede
// impreso en documentos que se comparten con partners/management. Se
// mantienen solo los metadatos del documento (Propiedades del PDF — no
// visibles al abrirlo, solo consultando "Propiedades"), sin email, para no
// perder del todo el dato de qué generó el archivo.
export function stampPDF(pdf, title) {
  try {
    pdf.setProperties({
      title:   title || "Dashboard KAMs — Yango Perú",
      subject: "Documento interno de Yango Perú. Distribución restringida.",
      creator: "Dashboard KAMs"
    });
  } catch (_) { /* si la build de jsPDF no expone setProperties, no romper el export */ }

  return pdf;
}
