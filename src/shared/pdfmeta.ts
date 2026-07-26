// pdfmeta.js — Marca de agua y metadatos de exportación en los PDFs.
//
// POR QUÉ: los PDFs de este dashboard salen del edificio (se los mandamos a
// partners, a management, por WhatsApp). Si uno aparece donde no debía, hay que
// poder saber de qué cuenta salió. Esto NO impide filtrar un PDF — nada lo
// impide — solo hace que filtrarlo deje rastro y que el que lo reciba vea que
// es material interno.
//
// Dos capas, a propósito:
//  1. Metadatos del documento (Propiedades del PDF): sobreviven a la impresión
//     a PDF y al reenvío, pero se editan fácil.
//  2. Texto visible en el pie de CADA página: no se puede quitar sin reeditar
//     el PDF, y es lo que ve el humano que lo abre.

// Email de la sesión. Cae a "sin-sesion" en vez de romper: un PDF sin firma es
// preferible a un export que falla.
function _quien() {
  return (STATE && STATE.userEmail) || "sin-sesion";
}

// Sella `pdf` (instancia jsPDF, ya con todas sus páginas agregadas) y devuelve
// la misma instancia. Llamar SIEMPRE justo antes de `pdf.save()`: recorre las
// páginas existentes, así que agregar páginas después dejaría las nuevas sin pie.
export function stampPDF(pdf, title) {
  const email = _quien();
  const when  = new Date();
  const legible = when.toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" });

  try {
    pdf.setProperties({
      title:    title || "Dashboard KAMs — Yango Perú",
      subject:  "Documento interno de Yango Perú. Distribución restringida.",
      author:   email,
      creator:  "Dashboard KAMs",
      keywords: `confidencial, interno, ${email}, ${when.toISOString()}`
    });
  } catch (_) { /* si la build de jsPDF no expone setProperties, seguimos con el pie */ }

  const txt = `Yango Perú · uso interno — exportado por ${email} · ${legible}`;

  try {
    const n  = pdf.internal.getNumberOfPages();
    const W  = pdf.internal.pageSize.getWidth();
    const H  = pdf.internal.pageSize.getHeight();
    // El tamaño de fuente de jsPDF SIEMPRE va en puntos, pero las coordenadas van
    // en la unidad del documento ("pt" en Metas, "px" en Vista Partner/Presentación,
    // donde una página puede medir 2400 unidades de ancho). Sin esta conversión el
    // pie quedaba ilegible (microscópico) en los PDFs con unidad px.
    const sf   = pdf.internal.scaleFactor || 1;      // unidades del doc por punto
    const alto = Math.max(7 * sf, W / 105);          // alto deseado, en unidades del doc
    const y    = H - alto * 0.75;

    for (let p = 1; p <= n; p++) {
      pdf.setPage(p);
      // Banda clara semitransparente detrás del texto: el pie cae encima de la
      // captura de pantalla, que puede tener cualquier color debajo.
      try {
        pdf.setGState(new pdf.GState({ opacity: 0.55 }));
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, H - alto * 1.9, W, alto * 1.9, "F");
        pdf.setGState(new pdf.GState({ opacity: 1 }));
      } catch (_) { /* GState requiere jsPDF ≥2: sin banda, el texto igual se dibuja */ }
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(alto / sf);
      pdf.setTextColor(110, 110, 110);
      pdf.text(txt, W / 2, y, { align: "center" });
    }
    pdf.setPage(n);
  } catch (_) { /* nunca romper un export por el sello */ }

  return pdf;
}
