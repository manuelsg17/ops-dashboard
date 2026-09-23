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
// Avisos: se imprimen pero NO hacen fallar (p.ej. claves de i18n sin uso).
const avisos = [];

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


// ─────────────────────────────────────────────────────────────────────────────
// 3. Claves de i18n usadas  vs  declaradas en core/i18n.ts
//
// Sin esto, una clave mal escrita o no declarada se muestra CRUDA en pantalla
// ("preset.hoy" en vez de "Hoy") y solo se descubre mirando esa pestana en ese
// idioma. Paso exactamente eso al armar la fase 1: un reemplazo fallo en
// silencio y los presets de diario/mensual quedaron sin clave.
//
// Tambien exige que cada clave tenga los 3 idiomas: el fallback a ingles/espanol
// evita el texto crudo, pero una clave a medio traducir no deberia pasar
// desapercibida.
// ─────────────────────────────────────────────────────────────────────────────
function chequearI18n() {
  const declaradas = leerDiccionario("src/core/i18n.ts", "export const I18N");
  if (!declaradas.size) { fallo("i18n", "no pude leer I18N — el chequeo quedo ciego."); return; }

  const usadas = new Map();
  for (const f of ["index.html", ...listarSrc()]) {
    // Sin comentarios: este mismo archivo documenta el uso con
    // data-i18n="clave" como EJEMPLO, y eso se reportaba como clave inexistente.
    const txt = sinComentarios(leer(f));
    for (const m of txt.matchAll(/data-i18n(?:-title|-ph|-html|-aria)?="([a-zA-Z0-9_.]+)"/g))
      if (!usadas.has(m[1])) usadas.set(m[1], f);
    // t(...) — todo literal "a.b" dentro del PRIMER argumento, no solo el caso
    // t("clave"): `t(uno ? "x.uno" : "x.varios", …)` también tiene que existir.
    // Los dinámicos (t(`seg.view.${k}`)) no se pueden verificar estático.
    for (const arg of primerosArgumentos(txt, /(?<![\w.$])t\(/g))
      for (const m of arg.matchAll(/"([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)"/g))
        if (!usadas.has(m[1])) usadas.set(m[1], f);
  }

  for (const [k, f] of usadas)
    if (!declaradas.has(k))
      fallo("i18n", `la clave "${k}" (${f}) NO esta en core/i18n.ts — se veria cruda en pantalla.`);

  chequearTrios("i18n", declaradas);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Tríos de idioma: los 3 idiomas + los MISMOS {placeholders} en los tres
//
// Una traducción que se come un `{s}` no da error: t() deja el texto sin el
// dato y la pantalla dice "Resultados:" en ruso donde en español dice
// "Resultados: 12" (pasó con cfg.resultados). Aplica a los TRES diccionarios:
// I18N (interfaz), EXPORT_STR (lo que se entrega al partner) y CALC_EXPORT_STR
// (la tarjeta de la Calculadora).
// ─────────────────────────────────────────────────────────────────────────────
function chequearTrios(nombre, dic) {
  for (const [k, tr] of dic) {
    const faltan = ["es", "en", "ru"].filter(l => tr[l] == null);
    if (faltan.length) { fallo(nombre, `la clave "${k}" no tiene: ${faltan.join(", ")}`); continue; }
    const ph = l => [...new Set([...tr[l].matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(x => x[1]))].sort().join(",");
    const base = ph("es");
    for (const l of ["en", "ru"]) {
      if (ph(l) !== base)
        fallo(nombre, `la clave "${k}" tiene placeholders distintos: es {${base}} vs ${l} {${ph(l)}} — el dato desaparece en ${l}.`);
    }
  }
}

function chequearDiccionariosExport() {
  const exp = leerDiccionario("src/core/i18nExport.ts", "export const EXPORT_STR");
  if (!exp.size) { fallo("i18n-export", "no pude leer EXPORT_STR — el chequeo quedo ciego."); return; }
  chequearTrios("i18n-export", exp);
  const calc = leerDiccionario("src/calculator.ts", "export const CALC_EXPORT_STR");
  if (!calc.size) { fallo("i18n-export", "no pude leer CALC_EXPORT_STR — el chequeo quedo ciego."); return; }
  chequearTrios("i18n-export", calc);
  // Las claves pedidas por nombre tienen que existir: xl("clave") / _calcLab("clave").
  const compartidas = new Set(["city", "ad", "sh", "nr", "cars", "shcar", "accept", "util"]);
  for (const f of listarSrc()) {
    const txt = sinComentarios(leer(f));
    for (const m of txt.matchAll(/(?<![\w.$])xl\(\s*"([^"]+)"/g))
      if (!exp.has(m[1])) fallo("i18n-export", `xl("${m[1]}") (${f}) no está en EXPORT_STR.`);
    for (const m of txt.matchAll(/(?<![\w.$])_calcLab\(\s*"([^"]+)"/g))
      if (!calc.has(m[1]) && !compartidas.has(m[1])) fallo("i18n-export", `_calcLab("${m[1]}") (${f}) no está en CALC_EXPORT_STR.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3c. Frases del deck sin ruso
//
// P2T(es, en, ru) cae a inglés si falta el ruso: un deck en ruso con una frase
// en inglés en medio. Mismo contrato para el T(…) de la lectura ejecutiva.
// ─────────────────────────────────────────────────────────────────────────────
function chequearFrasesExport() {
  const casos = [
    ...listarSrc().map(f => [f, /(?<![\w.$])P2T\(/g]),
    ["src/domain/lectura.ts", /(?<![\w.$])T\(/g]
  ];
  for (const [f, re] of casos) {
    const txt = sinComentarios(leer(f));
    for (const m of txt.matchAll(re)) {
      if (/function\s+$/.test(txt.slice(Math.max(0, m.index - 12), m.index))) continue;   // la definición
      const args = argumentos(txt, txt.indexOf("(", m.index));
      if (args.length && args.length < 3) {
        const linea = txt.slice(0, m.index).split("\n").length;
        fallo("i18n-export", `${f}:${linea} ${m[0].slice(0, -1)} con ${args.length} argumento(s): falta el ruso, y el deck ruso mostraría inglés.`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3d. Ternarios BINARIOS de idioma
//
// `lang === "es" ? a : b` o `es ? a : b` tienen dos ramas para TRES idiomas: en
// ruso cae a la rama "no español" (inglés) en silencio. Es el mismo bug de
// forma que el de las escalas: apareció en el deck (4 avisos), en el Gantt que
// entra al PDF y en los nombres de los métodos de pronóstico. Lo correcto es
// pick()/makeT() de core/i18nExport o t() de core/i18n.
// Escape puntual: `// i18n-binario-ok`.
// ─────────────────────────────────────────────────────────────────────────────
function chequearTernariosIdioma() {
  const R_IGUAL = /\b\w*(?:[lL]ang|idioma|LANG)\w*\s*[!=]==?\s*"(?:es|en|ru)"\s*\?/;
  // `es ? …` / `isEN ? …` como bandera de idioma. NO cuenta `a === en ? …`:
  // ahí `en` es un valor (p.ej. el nombre del mes en inglés), no una bandera.
  const R_FLAG  = /(?<![\w.$"'`])(?<![=!]=\s*)(?<![=!]==\s*)(?:es|en|isEN|isEn|isEs|esES)\s*\?(?![?.:])/;
  const R_DEF   = /\b(?:const|let|var)\s+(?:es|en|isEN|isEn|isEs)\s*=\s*[^;\n]*[lL]ang\w*\s*[!=]==?\s*"(?:es|en)"/;
  for (const f of listarSrc()) {
    const lineas = sinComentarios(leer(f)).split("\n");
    lineas.forEach((ln, i) => {
      if (/i18n-binario-ok/.test(leer(f).split("\n")[i] || "")) return;
      // Sin el TEXTO de los strings (una frase en español puede decir "es ?"),
      // pero conservando los códigos de idioma, que es lo que se busca.
      // (Con un callback y no con un lookahead: el lookahead volvía a arrancar
      // en la comilla de CIERRE de "es" y se comía el `?` que se busca.)
      const codigo = ln
        .replace(/"(?:[^"\\]|\\.)*"/g, s => /^"(?:es|en|ru)"$/.test(s) ? s : '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`[^`]*`/g, "``");
      if (R_IGUAL.test(codigo) || R_FLAG.test(codigo) || R_DEF.test(codigo))
        fallo("idioma-binario",
          `${f}:${i + 1} decide el idioma con un booleano/ternario de dos ramas: en ruso cae a la otra rama.\n` +
          `      Usar pick()/makeT() (core/i18nExport) o t() (core/i18n).\n      → ${ln.trim().slice(0, 120)}`);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3e. Claves muertas (AVISO, no falla)
//
// Una clave declarada que nadie usa suele ser peor que ruido: es la señal de
// que el texto quedó HARDCODEADO al lado (login.loading vs "Ingresando..." en
// auth.ts). Se cuenta como uso cualquier literal idéntico a la clave (cubre
// `t(cond ? "a.x" : "a.y")` y claves guardadas en variables) y los prefijos de
// las claves dinámicas (`t(\`seg.view.${k}\`)`).
// ─────────────────────────────────────────────────────────────────────────────
function avisarClavesMuertas() {
  const i18n = leerDiccionario("src/core/i18n.ts", "export const I18N");
  const exp  = leerDiccionario("src/core/i18nExport.ts", "export const EXPORT_STR");
  const literales = new Set(), prefijos = new Set();
  for (const f of ["index.html", ...listarSrc()]) {
    let txt = sinComentarios(leer(f));
    if (f.endsWith("core/i18n.ts"))       txt = txt.replace(recortarBloque(txt, txt.indexOf("{", txt.indexOf("export const I18N"))), "");
    if (f.endsWith("core/i18nExport.ts")) txt = txt.replace(recortarBloque(txt, txt.indexOf("= {", txt.indexOf("export const EXPORT_STR")) + 2), "");
    // Cualquier literal con forma de clave (las de EXPORT_STR pueden no tener punto: "peru").
    for (const m of txt.matchAll(/["'=]([a-zA-Z0-9_.]+)["']/g)) literales.add(m[1]);
    // Prefijos de claves armadas en el momento: t(`seg.view.${k}`), t("mode." + x).
    for (const m of txt.matchAll(/`([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*)\$\{/g)) prefijos.add(m[1]);
    for (const m of txt.matchAll(/"([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*)"\s*\+/g)) prefijos.add(m[1]);
  }
  const muerta = k => !literales.has(k) && ![...prefijos].some(p => k.startsWith(p));
  const m1 = [...i18n.keys()].filter(muerta), m2 = [...exp.keys()].filter(muerta);
  if (m1.length || m2.length) {
    avisos.push(`[i18n] ${m1.length + m2.length} clave(s) declaradas sin ningún uso` +
      ` (¿el texto quedó hardcodeado al lado?): ${[...m1, ...m2].join(", ")}`);
  }
}

/** Lee un diccionario `{clave: {es, en, ru}}` → Map(clave → {es?, en?, ru?}). */
function leerDiccionario(archivo, ancla) {
  const src = leer(archivo);
  const i = src.indexOf(ancla);
  if (i < 0) return new Map();
  const dict = recortarBloque(src, src.indexOf("{", src.indexOf("=", i)));
  const out = new Map();
  for (const entrada of entradasDeObjeto(dict)) {
    const m = /^(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*(\{[\s\S]*)$/.exec(entrada.trim());
    if (!m) continue;
    const tr = {};
    for (const v of m[3].matchAll(/\b(es|en|ru)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g))
      tr[v[1]] = v[2].slice(1, -1);
    out.set(m[1] || m[2], tr);
  }
  return out;
}

/** Argumentos de primer nivel de la llamada cuyo "(" está en `ini`. */
function argumentos(txt, ini) {
  // Pila de contextos: "code" (con su propia profundidad de paréntesis) y "`"
  // (texto de un template). Un `${` dentro del template abre otro "code" que se
  // cierra con su `}` — sin la pila, una coma dentro de `${a, b}` partía el
  // argumento, y un `)` dentro del texto del template cerraba la llamada.
  const pila = [{ t: "code", d: 0 }];
  let desde = ini + 1;
  const out = [];
  for (let i = ini; i < txt.length; i++) {
    const c = txt[i], top = pila[pila.length - 1];
    if (top.t === "`") {
      if (c === "\\") { i++; continue; }
      if (c === "$" && txt[i + 1] === "{") { pila.push({ t: "code", d: 0, tpl: true }); i++; continue; }
      if (c === "`") pila.pop();
      continue;
    }
    if (c === '"' || c === "'") {                     // string simple: saltarla entera
      for (i++; i < txt.length && txt[i] !== c; i++) if (txt[i] === "\\") i++;
      continue;
    }
    if (c === "`") { pila.push({ t: "`" }); continue; }
    if ("([{".includes(c)) { top.d++; continue; }
    if (")]}".includes(c)) {
      if (c === "}" && top.tpl && top.d === 0) { pila.pop(); continue; }   // fin de ${…}
      top.d--;
      if (pila.length === 1 && top.d === 0) { const a = txt.slice(desde, i).trim(); if (a) out.push(a); return out; }
      continue;
    }
    if (c === "," && pila.length === 1 && top.d === 1) { out.push(txt.slice(desde, i).trim()); desde = i + 1; }
  }
  return out;
}
function primerosArgumentos(txt, re) {
  const out = [];
  for (const m of txt.matchAll(re)) {
    const a = argumentos(txt, txt.indexOf("(", m.index));
    if (a.length) out.push(a[0]);
  }
  return out;
}

/** Quita comentarios //, /* *\/ y <!-- --> para no escanear texto de ejemplo. */
function sinComentarios(txt) {
  return txt
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

// ── helpers ──────────────────────────────────────────────────────────────────
function listarSrc(dir = "src") {
  const out = [];
  for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...listarSrc(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
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

// ─────────────────────────────────────────────────────────────────────────────
// 4. Un BOOLEANO para TRES escalas
//
// El bug más caro y más repetido del proyecto: escribir
//
//     const src = mensual ? rawDataMensual : rawData;
//
// para elegir entre semanal / mensual / DIARIO. En diario el ternario da false
// y devuelve el slice SEMANAL. No hay error de consola ni fila faltante: son
// números de otra escala con el rótulo de la escala elegida. Apareció TRES
// veces (Fleet/TukTuk en diario, el sidebar de solo-TukTuk, los slices del
// portal) porque arreglar una copia no arregla las otras.
//
// La forma correcta es shared/escala.ts (sliceEscala/datasetLinea), que tiene
// tests. Este chequeo existe para que la forma incorrecta no pueda volver a
// entrar sin que alguien lo note.
//
// Detecta el patrón "elegir un rawData* con una condición de mensual que NO
// menciona diario". Deliberadamente NO prohíbe todo ternario con `mensual`:
// los de ROTULADO ("último mes" vs "última semana") son legítimos y abundantes.
// ─────────────────────────────────────────────────────────────────────────────
function chequearEscalaBinaria() {
  const RE = /(?:mensual|curMode\s*===\s*"mensual")\s*\?[^;\n]*rawData/;
  for (const f of listarSrc()) {
    if (f.endsWith("shared/escala.ts") || f.endsWith(".test.ts")) continue;
    const lineas = leer(f).split("\n");
    lineas.forEach((ln, i) => {
      if (!RE.test(ln)) return;
      // Si la MISMA expresión contempla diario, es un ternario de tres ramas
      // bien escrito (o el arranque de uno). Solo nos importan los de dos.
      const ventana = lineas.slice(i, i + 3).join(" ");
      if (/diario/i.test(ventana)) return;
      fallo("escala-binaria",
        `${f}:${i + 1} elige un slice de datos con un booleano de "mensual" y no menciona "diario".\n` +
        `      En escala DIARIA esto devuelve el slice SEMANAL en silencio.\n` +
        `      Usar sliceEscala()/datasetLinea() de src/shared/escala.ts.\n` +
        `      → ${ln.trim().slice(0, 120)}`);
    });
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
chequearAcciones();
chequearColumnas();
chequearI18n();
chequearDiccionariosExport();
chequearFrasesExport();
chequearTernariosIdioma();
avisarClavesMuertas();
chequearEscalaBinaria();

for (const a of avisos) console.warn(`⚠ ${a}\n`);
if (problemas.length) {
  console.error(`\n✗ ${problemas.length} problema(s) de deriva:\n`);
  for (const p of problemas) console.error(`  [${p.chequeo}] ${p.msg}\n`);
  process.exit(1);
}
console.log("✓ deriva: acciones, columnas, i18n (claves, tríos, placeholders, idioma de exportación) y escalas consistentes");
