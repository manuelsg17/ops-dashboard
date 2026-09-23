#!/usr/bin/env node
// Compara dos huellas de números (las que arma scripts/huella/huella.js).
//
//   node scripts/huella/compare.mjs antes.json despues.json [--max N]
//
// Imprime, por escenario, las claves AGREGADAS, QUITADAS y CAMBIADAS (con los
// dos valores). Sale con código 1 si hay cualquier diferencia de cifras, 0 si
// son idénticas, 2 si los argumentos o los archivos son inválidos.
//
// Solo compara `escenarios`. De `meta` avisa (sin fallar) si cambió el rango o
// el mes usados en un escenario, porque ESO explica diferencias de cifras que
// no son regresiones: la huella solo es comparable con el mismo rango.
import { readFileSync } from "node:fs";

function uso(msg) {
  if (msg) console.error(msg);
  console.error("Uso: node scripts/huella/compare.mjs <antes.json> <despues.json> [--max N]");
  process.exit(2);
}

const args = process.argv.slice(2);
let max = 200;
const archivos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max") { max = Number(args[++i]); if (!Number.isFinite(max) || max < 1) uso("--max inválido"); }
  else if (args[i] === "-h" || args[i] === "--help") uso();
  else archivos.push(args[i]);
}
if (archivos.length !== 2) uso();

function leer(ruta) {
  let obj;
  try { obj = JSON.parse(readFileSync(ruta, "utf8")); }
  catch (e) { uso(`No se pudo leer ${ruta}: ${e.message}`); }
  if (!obj || typeof obj !== "object" || !obj.escenarios || typeof obj.escenarios !== "object") {
    uso(`${ruta} no parece una huella (falta "escenarios").`);
  }
  return obj;
}

const A = leer(archivos[0]);
const B = leer(archivos[1]);

const escenarios = [...new Set([...Object.keys(A.escenarios), ...Object.keys(B.escenarios)])].sort();
let nAgregadas = 0, nQuitadas = 0, nCambiadas = 0, impresas = 0;
const lineas = [];
const out = s => { if (impresas < max) lineas.push(s); impresas++; };

for (const esc of escenarios) {
  const a = A.escenarios[esc], b = B.escenarios[esc];
  if (!a) { out(`+ escenario nuevo: ${esc} (${Object.keys(b).length} cifras)`); nAgregadas += Object.keys(b).length; continue; }
  if (!b) { out(`- escenario quitado: ${esc} (${Object.keys(a).length} cifras)`); nQuitadas += Object.keys(a).length; continue; }
  const claves = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const difs = [];
  for (const k of claves) {
    if (!(k in a))             { difs.push(`    + ${k} = ${JSON.stringify(b[k])}`); nAgregadas++; }
    else if (!(k in b))        { difs.push(`    - ${k} = ${JSON.stringify(a[k])}`); nQuitadas++; }
    else if (a[k] !== b[k])    { difs.push(`    ~ ${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`); nCambiadas++; }
  }
  if (difs.length) { out(`[${esc}] ${difs.length} diferencia(s)`); difs.forEach(out); }
}

// Contexto que puede explicar diferencias (rango/mes distintos entre corridas).
const avisos = [];
const mA = (A.meta && A.meta.escenarios) || {}, mB = (B.meta && B.meta.escenarios) || {};
for (const esc of escenarios) {
  const x = mA[esc], y = mB[esc];
  if (!x || !y) continue;
  for (const campo of ["desde", "hasta", "mes", "anio", "kam"]) {
    if ((campo in x || campo in y) && x[campo] !== y[campo]) {
      avisos.push(`  [${esc}] ${campo}: ${JSON.stringify(x[campo])} → ${JSON.stringify(y[campo])}`);
    }
  }
  if (y.clavesDuplicadas && y.clavesDuplicadas.length) {
    avisos.push(`  [${esc}] claves data-num DUPLICADAS en la huella nueva: ${y.clavesDuplicadas.slice(0, 5).join(", ")}${y.clavesDuplicadas.length > 5 ? "…" : ""}`);
  }
}
for (const campo of ["rol", "idioma", "url"]) {
  const x = A.meta && A.meta[campo], y = B.meta && B.meta[campo];
  if (x !== y) avisos.push(`  meta.${campo}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
}

lineas.forEach(l => console.log(l));
if (impresas > max) console.log(`… (${impresas - max} líneas más; usar --max para ver todo)`);
if (avisos.length) {
  console.log("\nContexto distinto entre las dos huellas (puede explicar diferencias):");
  avisos.forEach(l => console.log(l));
}
const total = nAgregadas + nQuitadas + nCambiadas;
console.log(`\n${escenarios.length} escenarios · ${nCambiadas} cambiadas · ${nAgregadas} agregadas · ${nQuitadas} quitadas`);
if (total) { console.log("✗ Las huellas DIFIEREN."); process.exit(1); }
console.log("✓ Huellas idénticas.");
process.exit(0);
