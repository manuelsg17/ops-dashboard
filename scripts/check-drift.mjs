#!/usr/bin/env node
// Chequeos de DERIVA: cosas que el compilador no ve y que en este proyecto ya
// causaron bugs reales que sobrevivieron semanas en producción.
//
// Los dos que están acá venían documentados en CLAUDE.md como "acordate de
// correr este grep a mano". Eso no es un control: es una intención. Ahora corren
// en CI y en el pre-commit.
//
//   npm run check:drift
//
// Cada chequeo devuelve una lista de problemas. Ninguno consulta la BD ni la red:
// se pueden correr sin credenciales, que es lo que permite meterlos en CI.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const leer = p => readFileSync(join(RAIZ, p), "utf8");
const problemas = [];
const fallo = (chequeo, msg) => problemas.push({ chequeo, msg });

// ─────────────────────────────────────────────────────────────────────────────
// 1. data-act* del HTML  vs  registerActions()
//
// El bug que lo motiva: handleLogin/handleLogout nunca se registraron en el
// dispatcher tras la migración A2, y 3 onfocus/onblur de búsqueda de partner
// quedaron muertos. Semanas en producción: un botón sin handler no da error de
// consola, simplemente no hace nada.
// ─────────────────────────────────────────────────────────────────────────────
function chequearAcciones() {
  const fuentes = ["index.html", ...listarSrc()];
  const usados = new Map();          // accion -> archivo donde aparece
  const RE = /data-act(?:-change|-input|-keydown|-mousedown|-focus|-blur)?="([a-zA-Z0-9_]+)"/g;
  for (const f of fuentes) {
    const txt = leer(f);
    for (const m of txt.matchAll(RE)) if (!usados.has(m[1])) usados.set(m[1], f);
  }

  // Claves registradas. OJO: no alcanza con buscar `nombre:` — la mitad de los
  // registros usan forma ABREVIADA (`onKAMChange, selectAll, deselectAll`), sin
  // dos puntos. La primera versión de este script las ignoraba y reportaba 45
  // falsos positivos sobre código que funciona. Un chequeo que grita en falso se
  // desactiva a la semana, así que se parsean las entradas de primer nivel.
  const registradas = new Set();
  for (const f of listarSrc()) {
    const txt = leer(f);
    for (const m of txt.matchAll(/registerActions\(\s*\{/g)) {
      const bloque = recortarBloque(txt, txt.indexOf("{", m.index));
      for (const entrada of entradasDeObjeto(bloque)) {
        const clave = /^([a-zA-Z0-9_$]+)\s*(?::|$)/.exec(entrada.trim());
        if (clave) registradas.add(clave[1]);
      }
    }
  }

  for (const [accion, archivo] of usados) {
    if (!registradas.has(accion)) {
      fallo("acciones", `data-act="${accion}" (${archivo}) no está en ningún registerActions() — el control no hará NADA al usarse.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. TX_EAGER_COLS + TX_DEFERRED_COLS  vs  TX_ALL_COLS del parser
//
// CLAUDE.md ya avisa: "Al agregar una columna nueva: decidir a conciencia en qué
// lista va. En la equivocada no rompe nada visible de inmediato (queda null hasta
// que se dispara la carga diferida)". Una columna OLVIDADA en ambas listas es
// peor: no se pide nunca y la vista muestra guiones para siempre, sin error.
// ─────────────────────────────────────────────────────────────────────────────
function chequearColumnas() {
  const data = leer("src/data.ts");
  const eager    = arrayLiteral(data, "TX_EAGER_COLS");
  const deferred = arrayLiteral(data, "TX_DEFERRED_COLS");
  const todas    = Object.values(mapaTaxiparks());

  const core = new Set(arrayLiteral(data, "REND_CORE_COLS")
    .concat(["fecha", "mes", "date", "new_from_partner", "new_from_service",
             "new_partner", "new_service", "partner", "kam"]));

  const dup = eager.filter(c => deferred.includes(c));
  if (dup.length) fallo("columnas", `en EAGER y DEFERRED a la vez: ${dup.join(", ")} — se descargarían dos veces.`);

  for (const lista of [["EAGER", eager], ["DEFERRED", deferred]]) {
    const vistos = new Set(), rep = new Set();
    for (const c of lista[1]) (vistos.has(c) ? rep : vistos).add(c);
    if (rep.size) fallo("columnas", `repetidas dentro de TX_${lista[0]}_COLS: ${[...rep].join(", ")}`);
  }

  const cubiertas = new Set([...eager, ...deferred]);
  const huerfanas = todas.filter(c => !cubiertas.has(c) && !core.has(c));
  if (huerfanas.length) {
    fallo("columnas", `el parser conoce estas columnas pero NINGUNA lista las pide, así que nunca se descargan y las vistas mostrarán "—": ${huerfanas.join(", ")}`);
  }

  const fantasma = [...cubiertas].filter(c => !todas.includes(c));
  if (fantasma.length) {
    fallo("columnas", `se piden a PostgREST pero el parser no las conoce (¿renombradas en la BD?): ${fantasma.join(", ")}`);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function listarSrc(dir = "src") {
  const out = [];
  for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...listarSrc(p));
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Recorta desde `{` hasta su llave de cierre, respetando anidamiento y strings. */
function recortarBloque(txt, ini) {
  let d = 0, s = null;
  for (let i = ini; i < txt.length; i++) {
    const c = txt[i];
    if (s) { if (c === "\\") i++; else if (c === s) s = null; continue; }
    if (c === '"' || c === "'" || c === "`") { s = c; continue; }
    if (c === "{") d++;
    else if (c === "}" && --d === 0) return txt.slice(ini, i + 1);
  }
  return txt.slice(ini);
}

/**
 * Parte el cuerpo de un objeto `{...}` en sus entradas de PRIMER nivel, cortando
 * por las comas que están a profundidad 0. Ignora comas dentro de funciones
 * flecha, objetos anidados, arrays, strings y comentarios — que es justo donde
 * un split(",") a secas se rompe (`(d, el) => f(d.x)` tiene 2 comas propias).
 */
function entradasDeObjeto(bloque) {
  const cuerpo = bloque.slice(1, -1);
  const out = [];
  let d = 0, s = null, ini = 0;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i], sig = cuerpo[i + 1];
    if (s) { if (c === "\\") i++; else if (c === s) s = null; continue; }
    if (c === "/" && sig === "/") { i = cuerpo.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && sig === "*") { i = cuerpo.indexOf("*/", i) + 1; if (i < 1) break; continue; }
    if (c === '"' || c === "'" || c === "`") { s = c; continue; }
    if ("{[(".includes(c)) d++;
    else if ("}])".includes(c)) d--;
    else if (c === "," && d === 0) { out.push(cuerpo.slice(ini, i)); ini = i + 1; }
  }
  out.push(cuerpo.slice(ini));
  // Se limpian los comentarios que preceden a la clave. El `\s*` va DENTRO de la
  // repetición: dos comentarios de línea seguidos llevan indentación entre medio
  // y, sin eso, la clave quedaba escondida detrás del segundo (dio 2 falsos
  // positivos sobre handlers que sí estaban registrados).
  return out.map(e => e.replace(/^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "")).filter(e => e.trim());
}

/** Extrae los strings de `const NOMBRE = [...]`. */
function arrayLiteral(txt, nombre) {
  const m = new RegExp(`${nombre}\\s*(?::[^=]+)?=\\s*\\[`).exec(txt);
  if (!m) throw new Error(`No encontré ${nombre} — ¿lo renombraron? Este chequeo quedó ciego.`);
  const ini = txt.indexOf("[", m.index);
  let d = 0, fin = ini;
  for (let i = ini; i < txt.length; i++) {
    if (txt[i] === "[") d++;
    else if (txt[i] === "]" && --d === 0) { fin = i; break; }
  }
  return [...txt.slice(ini, fin).matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

/** Valores (nombres de columna) de TX_COL_BY_NORM en domain/taxiparks.ts. */
function mapaTaxiparks() {
  const txt = leer("src/domain/taxiparks.ts");
  const ini = txt.indexOf("{", txt.indexOf("TX_COL_BY_NORM"));
  const bloque = recortarBloque(txt, ini);
  const o = {};
  for (const m of bloque.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) o[m[1]] = m[2];
  if (!Object.keys(o).length) throw new Error("TX_COL_BY_NORM vacío — el chequeo de columnas quedó ciego.");
  return o;
}

// ── main ─────────────────────────────────────────────────────────────────────
chequearAcciones();
chequearColumnas();

if (problemas.length) {
  console.error(`\n✗ ${problemas.length} problema(s) de deriva:\n`);
  for (const p of problemas) console.error(`  [${p.chequeo}] ${p.msg}\n`);
  process.exit(1);
}
console.log("✓ deriva: acciones y columnas consistentes");
