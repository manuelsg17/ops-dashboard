// Copia src/domain/taxiparks.ts dentro de la Edge Function ingest-taxiparks.
//
// POR QUE HACE FALTA: una Edge Function se despliega con SU bundle, no puede
// importar de src/. Sin esta copia habria que reescribir el parser del lado del
// servidor — dos versiones del mapeo de 50 measures que tarde o temprano
// divergen, que es exactamente lo que este proyecto viene evitando.
//
//   npm run sync:ingest        genera la copia
//   npm run sync:ingest -- --check   falla si estan desincronizadas (lo usa el CI)
import { readFileSync, writeFileSync } from "node:fs";

const ORIGEN  = "src/domain/taxiparks.ts";
const DESTINO = "supabase/functions/ingest-taxiparks/taxiparks.ts";
const AVISO =
`// ⚠️ ARCHIVO GENERADO — NO EDITAR ACA.
// Copia exacta de ${ORIGEN}, sincronizada por scripts/sync-ingest-parser.mjs.
// Editá el original y corré \`npm run sync:ingest\`. El CI falla si difieren.
`;

const contenido = AVISO + readFileSync(ORIGEN, "utf8");

if (process.argv.includes("--check")) {
  let actual = "";
  try { actual = readFileSync(DESTINO, "utf8"); } catch { /* no existe */ }
  if (actual !== contenido) {
    console.error(
      `\n✗ ${DESTINO} esta desincronizado con ${ORIGEN}.\n` +
      `  Corré: npm run sync:ingest\n`
    );
    process.exit(1);
  }
  console.log(`✓ ${DESTINO} sincronizado con ${ORIGEN}`);
} else {
  writeFileSync(DESTINO, contenido);
  console.log(`✓ ${DESTINO} regenerado desde ${ORIGEN}`);
}
