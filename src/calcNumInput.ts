// calcNumInput.ts — Lectura de los campos numéricos de la Calculadora (Ola 6)
//
// Los campos de meta muestran la cifra con separador de miles mientras no
// tienen el foco ("10,000", mismo formato que fmt() en toda la app) y la cifra
// CRUDA mientras se edita ("10000"). Este archivo decide qué número es lo que
// quedó escrito. Puro, sin DOM: lo prueban los tests de al lado.
//
// Por qué no parseFloat a secas: parseFloat("10,000") da 10 — un KAM que pega
// la meta tal cual la ve en pantalla guardaría 10 conductores en vez de diez
// mil, sin ningún aviso. Acá:
//   · "," seguida de grupos de 3 dígitos = miles ("10,000" → 10000), igual que
//     el formato es-PE que muestra la app.
//   · Un solo "." = decimal ("12.5"); varios "." = miles al estilo europeo
//     ("1.234.567" → 1234567).
//   · Si vienen "," y "." juntos, el ÚLTIMO de los dos es el decimal
//     ("1,234.5" y "1.234,5" → 1234.5).
//   · Una "," que no forma grupos de miles es decimal ("12,5" → 12.5).
// Vacío o basura → NaN (el llamador decide: borrar la edición o poner 0).

export function parseNumInput(raw: unknown): number {
  if (raw == null) return NaN;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  let s = String(raw).trim().replace(/[\s\u00a0\u202f']/g, "");
  if (!s) return NaN;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let norm: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Los dos separadores: el que aparece último es el decimal.
    const dec = lastComma > lastDot ? "," : ".";
    const mil = dec === "," ? "." : ",";
    const partes = s.split(dec);
    if (partes.length !== 2) return NaN;
    norm = partes[0].split(mil).join("") + "." + partes[1];
  } else if (lastComma >= 0) {
    const miles = /^\d{1,3}(,\d{3})+$/.test(s);
    if (!miles && (s.match(/,/g) || []).length > 1) return NaN;
    norm = miles ? s.split(",").join("") : s.replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return NaN;
    norm = s.split(".").join("");
  } else {
    norm = s;
  }
  if (!/^\d*\.?\d*$/.test(norm) || norm === ".") return NaN;
  const n = Number(norm);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

/** Texto crudo para editar: el número tal cual, sin separadores ("10000",
 *  "8794.5"). null/NaN → "". */
export function rawNumText(v: unknown): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? String(n) : "";
}
