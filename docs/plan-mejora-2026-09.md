# Plan de mejora integral — septiembre 2026

Auditoría del 23-sep-2026, hecha sobre el entorno local con datos sintéticos (sin acceso a Supabase de producción). Cubre UX/UI, diccionarios, velocidad de apertura, bugs e integración con Configuración.

**Regla de ejecución**: todo se trabaja en worktrees y se integra en una rama local `mejora/integracion`. Nada llega a `main` ni se pushea hasta que Manuel lo revise en local y lo apruebe. Cualquier cambio de esquema se prueba en el Supabase local y se aplica a producción solo con confirmación explícita.

---

## 1. Diagnóstico

### 1.1 Por qué "no se ve profesional" (medido, no opinado)

| Síntoma | Evidencia |
|---|---|
| Sin sistema de diseño | 1 bloque `:root` con 6 variables (solo Presentación). **128 colores hex distintos**, ~31 grises casi iguales, dos familias Tailwind mezcladas (gray + slate) |
| El rojo de marca significa 4 cosas | `#FF0000` es marca, "malo/atrasado", la ciudad Lima, el KAM Miguel y la métrica AD. Un partner de Lima que va bien se pinta rojo |
| Emojis como iconografía | **234 emojis (65 distintos)**; cambian según el sistema operativo. Navegación con emoji en unos ítems y en otros no |
| Tipografía sin escala | 43 tamaños de letra distintos, 136 declaraciones por debajo de 11 px, 94 declaraciones en peso 800/900 (aspecto "tosco"). `tabular-nums` solo en Presentación: las cifras no se alinean en tablas/KPIs |
| Componentes duplicados | ~11 familias de botón (el primario rojo implementado 7 veces), ~10 constructores de tarjeta KPI, ~15 clases de badge, 52 `confirm()/alert()` nativos, 596 clases `agy-style-N` sin nombre (80 muertas) |
| Arcoíris sin significado | Tarjetas KPI con borde superior de 4 colores distintos; tarjetas de partner con borde del color del hash del nombre |
| Layout | La 4ª tarjeta KPI queda sola en una fila de 3; `.main` sin `max-width`; gráficos que se salen del contenedor al abrir la barra lateral (ver bugs) |
| Gráficos de "spaghetti" | Tendencias "Perú por partner" dibuja una serie por partner (~70 en producción, ~1.200 marcadores por gráfico) sin leyenda legible |
| Navegación escondida | 6 de las 8 secciones viven dentro del desplegable "Análisis"; las cargas de Excel son un icono punteado de 20 px |
| Textos | Voseo rioplatense ("usá", "elegí", "ampliá", "escribile") en una app para Perú; banner permanente "Estamos afinando esta sección" en Vista Partner; jerga interna visible ("criterio TukTuk aparte: 28 N+R") |
| Accesibilidad | 0 `:focus-visible`; `#aaa`/`#ccc`/`#888` sobre blanco en ~195 usos (contraste 1,6–3,5:1); verde/ámbar de `pColor` como texto con 2,2–2,5:1 |

### 1.2 Estado de la base de pruebas

El seed local **termina en julio 2026** (hoy es 23-sep), tiene 12 partners y 3 KAMs (producción: ~70 y 6), **no tiene** tareas de Seguimiento, proyectos, embudo de conversión ni el mapeo `partner_users` del usuario partner (el portal local sale vacío por el kill-switch). Metas abre por defecto en AGOSTO, fuera del rango con datos → pantalla vacía. Con esa base no se puede verificar un rediseño "lo más real posible".

---

## 2. Hallazgos por área

Leyenda: **C** = confirmado leyendo/trazando el código o en pantalla; **P** = probable, se confirma al implementar.

### 2.1 Bugs de cálculo y datos (prioridad máxima: afectan números)

| # | Hallazgo | Dónde | Estado |
|---|---|---|---|
| B1 | **Metas entre años**: `UNIQUE (clid, city, mes)` sin `mes_year`. Guardar ENERO 2027 reescribe ENERO 2026 y hereda sus columnas Fleet/`meta_tk_cars`. En enero, Metas y el PDF abren DICIEMBRE (orden `2000+mes`). El deck (`p2MetaFor`) y el forecast comparan solo `mes` | baseline `:400`, `calculator.ts:2027`, `metas.ts:40,834`, `presentacion2.ts:1233,2458` | C (constraint verificado en local) |
| B2 | **La pestaña "Adquisición por canal" del Excel de Conversión se descarta en silencio** desde la migración al Web Worker; `uploadChannels` y `describeUploadError` quedaron sin llamar. Probable también: la hoja "METAS" ya no se detecta por nombre | `data.ts:1880-1907`, `workers/excelWorker.ts` | C |
| B3 | **Mantenimiento → borrar metas de un mes no borra nada y avisa éxito**: filtra `mes = "2026-06"` pero `metas.mes` es `"JUNIO"`. Sin mes, borra las metas de todos los años | `app.ts:1437` | C |
| B4 | "Por KAM" y el desglose por KAM de cada tarjeta iteran `KAM_MAP`, que nunca trae "No KAM": el desglose no suma el total (en local: 7.724+4.883+1.273 ≠ 14.637) y con filtro "No KAM" la sección queda vacía | `rendimiento.ts:360,553` | C (visto en pantalla) |
| B5 | La tarjeta de partner usa la última fila del partner aunque no sea la del último período: muestra un dato viejo rotulado como actual | `rendimiento.ts:766` | C |
| B6 | Portal: la meta Fleet se promedia sin ponderar (90%·100 autos + 50%·2 autos = 70% en el portal vs ~89% en Metas) | `partnerPortal.ts:231` | C |
| B7 | `calcDeleteMetasKam` informa "N eliminadas" pero no borra filas con `mes_year` NULL ni CLIDs cuyo KAM viene de `flotas` | `calculator.ts:2124-2150` | C |
| B8 | Cambios en Configuración (KAM de un partner, tagging de fleetroom, flota activa) **no llegan a mensual, diario ni conversión** hasta recargar: `loadFromSupabase` rehace solo semanal y nada resetea `_mensualLoaded/_diarioLoaded/_conversionLoaded` | `app.ts:1303-1356`, `rawdata.ts:658-756`, `data.ts` | C (trazado) |
| B9 | Metas con filtro "No KAM": `m.kam` queda en `""`, no en `SIN_KAM` | `metas.ts:698,868,1091` | P |
| B10 | Metas semanal/diario: AD Perú ≠ suma de ciudades (snapshot por partner toma su último período con dato, no el del rango) | `metas.ts:964,1126` | P |
| B11 | Tagging por CLID vs por fleetroom se contradicen: marcar "Fleet" en una sub-flota de un partner TukTuk la pasa a Taxi sin aviso; las casillas por CLID en Config no tienen efecto si hay fleetrooms | `data.ts:625-686,2091`, `rawdata.ts:504` | C (trazado) |
| B12 | Portal partner con escala mensual guardada: primero pinta números **semanales** con rótulos "mensual", y segundos después cambia | `partnerPortal.ts`, `app.ts:283` | C (visto en pantalla) |

### 2.2 Bugs de interacción y robustez

| # | Hallazgo | Dónde | Estado |
|---|---|---|---|
| I1 | Enter en los 4 buscadores de partner no selecciona nada (`MouseEvent` sin `bubbles:true`, el dispatcher está en `document`) | `seguimiento.ts:583`, `presentacion2.ts:2991`, `calculator.ts:2310`, `partnerView.ts:1416` | C |
| I2 | Salir y volver a entrar sin recargar **duplica listeners**: cada Excel se sube dos veces; `CALC_STATE` del usuario anterior queda en memoria | `auth.ts:246`, `app.ts:46` | C |
| I3 | Se muestra "guardado/eliminado OK" cuando RLS bloqueó la escritura (UPDATE/DELETE afectan 0 filas sin error). CRUD de Partners y Flotas visible para cualquier rol | `app.ts:1220,1348`, `rawdata.ts:658-710` | C |
| I4 | El banner verde de Config tapa el fallo de refresco (mismo patrón ya corregido en Calculadora) | `app.ts:1318,1343,1355` | C |
| I5 | Gráficos no se re-dimensionan al abrir/cerrar la barra lateral: desborde horizontal de 123 px a 1440 px | `rendimiento.ts`, `charts.ts` | C (medido en pantalla) |
| I6 | Inyección de HTML con datos guardados: `showBanner` usa `innerHTML` con nombres de BD/Excel; tooltip de `charts.ts:25`; `CALC_STATE.kam`; ciudades en `<option>` sin escapar | `app.ts:1366` y otros | C |
| I7 | "Eliminar datos" en mensual/diario no refresca la vista; upload sin `worker.onerror` (spinner colgado); el input de archivo no se resetea | `app.ts:1454`, `data.ts:1880` | C/P |
| I8 | Usuarios: el buscador pierde el foco en cada tecla; errores de permisos/CLIDs no revisados | `adminUsers.ts:455,63` | C/P |
| I9 | Config → Partners: tarjeta de KAM sin nombre (el KAM vacío), fila "Agregar" con casillas encimadas sobre el input, fila en edición con 6 celdas para 7 columnas | `app.ts:1082,1273` | C (visto en pantalla) |
| I10 | CSV de Data Raw: `"` rompe columnas y `=+-@` al inicio se ejecuta como fórmula en Excel | `rawdata.ts:247` | C |
| I11 | Nombres de archivo con `toISOString()` → fecha de mañana después de las 19:00 en Lima | 4 archivos | C |
| I12 | Menores: barras de Monitoreo al 500%, embudo con "AD máx" vacío = 0, Vista Partner no permite elegir partners solo-TukTuk, Seguimiento descarta el borrador sin preguntar | varios | C/P |
| I13 | Filtros persistidos (ej. KAM "No KAM" + Lima) se restauran sin ningún indicador en la pantalla: el título dice "Perú – Vista General" mientras muestra un subconjunto | `app.ts` restoreFilters | C (visto en pantalla) |

### 2.3 Configuración: integración y arquitectura de información

- Los 16 CLIDs sin fila en `partners` no aparecen en Configuración; editar su tagging crea una fila con `kam=""` que los fija en "No KAM" para siempre (`data.ts:2062`).
- `app_metadata.kam` (preselección de la Calculadora) solo se asigna por SQL.
- Cada casilla de tagging recarga todo (8 requests + pantalla de carga).
- Renombrar un partner deja huérfanas sus tareas de Seguimiento/proyectos (enlazan por nombre) y su logo.
- La lista de KAMs acepta texto libre y distingue mayúsculas ("manuel" ≠ "Manuel").
- "Fleet Externo — Sincronizar ahora" sigue visible aunque la función está pausada y el secret no existe: dispara una ejecución que falla.
- Permisos `delete:data`/`write:config` funcionan en RLS pero la UI solo mira `isAdmin`.

### 2.4 Velocidad de apertura

Lo grande ya está hecho (caché IndexedDB, ApexCharts diferido, columnas diferidas, RPC en paralelo). Quedan:

| # | Propuesta | Ganancia estimada | Riesgo |
|---|---|---|---|
| V1 | **No esperar el refresh del token para pintar la caché.** El KAM entra una vez al día → el JWT (1 h) siempre venció → `getSession()` hace un round-trip en serie antes de pintar nada. Además `#loginScreen` es visible por defecto: parpadeo del login | ~300–450 ms en cada apertura diaria + sin parpadeo | Medio |
| V2 | Disparar la red **antes** de hidratar la caché (hoy espera a IndexedDB + render) | 50–200 ms | Bajo |
| V3 | Guardar la escala en el snapshot y pedir mensual desde el arranque si es la guardada (hoy para ellos la caché no sirve y se pinta semanal de más; es la causa de B12) | la caché pasa a servirles | Bajo-medio |
| V4 | Saltar el segundo render si los datos no cambiaron (huella) — 6 de cada 7 días | 100–400 ms de hilo principal, sin parpadeo | Bajo-medio |
| V5 | Página especulativa en `fetchAllPages` (hoy la página 2 espera al HEAD `count`) | ~1 round-trip sin caché | Bajo |
| V6 | Gráficos: sin marcadores con más de 8 series; top-N + "Otros" en vez de 70 líneas | trabas por frame | Bajo |
| V7 | `manualChunks`: `@kurkle/color` a `vendor-chartjs`, canvg/dompurify/core-js/fflate a `vendor-pdf` | −68 kB gzip al abrir Presentación | Bajo |
| V8 | Adelgazar el entry: i18n de vistas lazy (≈60 kB) fuera del entry | 30–80 ms de parseo (más en iPad) | Medio |

### 2.5 Diccionarios (i18n)

- `I18N`/`t()` está completo (621 claves × 3 idiomas) y ya lo vigila `check:drift`. El problema está en las **exportaciones**: 4 helpers distintos (`_t` de Vista Partner cae a español, `P2T`/`_calcLab` caen a inglés), 4 estados de idioma de exportación sin tipo común.
- **El idioma de la interfaz se filtra en los PDF/tarjetas del partner**: un PDF en inglés sale con tarjetas Fleet en español; ternarios `es ? … : …` hacen que el deck en ruso muestre avisos en inglés; "sin meta" fijo en español.
- **Números `es-PE` en exportaciones en inglés/ruso** ("2.415" se lee como 2,4 en inglés).
- **7 tablas de meses** y **6 definiciones de nombres de KPI** que no coinciden entre sí ("Active Drivers" en la tarjeta vs "Conductores Activos" en el deck).
- Sin i18n: Seguimiento, Portal, login, errores de subida (`data.ts` clasifica errores **buscando texto en español**).
- Vista Partner no tiene ruso (140 claves).
- Tono: voseo mezclado con tuteo.

---

## 3. Dirección de rediseño

Principios (el mockup de Rendimiento acompaña este plan):

1. **Neutro por defecto, color con significado.** Superficies blancas/grises, el rojo Yango solo para marca y la acción principal. Estados con su propia paleta semántica (ok / alerta / mal / info / sobre-cumplimiento), accesible (AA). Ciudades y KAMs con una paleta categórica que **no** reutiliza el rojo.
2. **Navegación lateral agrupada** (Análisis · Planificación · Entregables · Datos · Configuración), visible según rol. Adiós al desplegable "Análisis".
3. **Encabezado de página con el alcance visible**: título, chips de los filtros activos (escala, rango, ciudad, KAM, línea) con "Restablecer", y la frescura de datos. Nunca más un subconjunto rotulado como "Perú".
4. **Iconos SVG** (set único por npm, tree-shaken, sin romper la CSP) en lugar de emojis.
5. **Tipografía con escala** (11/12/13/14/16/20/28 px, pesos 400/600/700) y `tabular-nums` en toda cifra.
6. **Tablas antes que mosaicos** cuando se compara: Metas por partner como tabla ordenable por cumplimiento (con vista de tarjetas opcional); ciudades como tabla compacta.
7. **Acciones destructivas fuera del camino**: "Eliminar metas de JULIO" deja de ser un botón rojo gemelo de "Descargar PDF"; confirmación en la página (no `confirm()`), con conteo de filas afectadas.
8. **Mismo número en todas partes**: el rediseño no cambia ninguna cifra salvo las que corrige un bug documentado (ver "huella de números").

---

## 4. Plan de ejecución por olas

Cada ola: worktree(s) en `.claude/worktrees/`, integración en `mejora/integracion`, compuertas de la sección 5, revisión de Manuel en local. Las olas que tocan los mismos archivos van en serie; las que no, en paralelo.

### Ola 0 — Base de verificación (prerrequisito)
- **Seed sintético "vivo"** con generador determinista (script, no SQL a mano): hasta la semana cerrada más reciente (sep-2026), 6 KAMs, ~60 partners, 3 ciudades, Taxi+TukTuk en el mismo partner-ciudad, Delivery/Cargo, los dos casos de "No KAM", metas jun–sep 2026 **y ene/dic** (para probar B1), filas de meta en cero, desglose `meta_tk_*`, tareas de Seguimiento (vencidas/bloqueadas), embudo + canales, `partner_users` del usuario partner y `app_metadata.kam` del KAM.
- **Huella de números**: script que recorre cada vista × escala × línea y exporta las cifras mostradas a JSON; se compara antes/después de cada ola.
- Capturas de referencia por vista a 1440 y 1024 px.
- `vitest`: excluir `.claude/**` (trampa de los worktrees).

### Ola 1 — Bugs (dos worktrees en paralelo, separados por archivo)
- **1a · datos y Configuración** (`data.ts`, `app.ts`, `auth.ts`, `rawdata.ts`, `excelWorker.ts`): B2, B3, B7, B8, I2, I3, I4, I6, I7, I10, I11 + código muerto (`fleetexterno.ts`, exports sin uso, botón Fleet Externo). Parte de código de B1 (select por `mes_year`, orden por año).
- **1b · vistas** (`rendimiento.ts`, `metas.ts`, `partnerPortal.ts`, `partnerView.ts`, `seguimiento.ts`, `adminUsers.ts`, `monitoreo.ts`, `charts.ts`): B4, B5, B6, B9, B10, B12 (parte de vista), I1, I5, I8, I9, I12, I13.
- **1c · migración B1**: `UNIQUE (clid, city, mes, mes_year)` preparada y probada en local. **Producción: solo con tu confirmación**, y antes de que alguien arme las metas de enero 2027.

### Ola 2 — Velocidad (después de 1a; toca `data.ts`/`auth.ts`)
V1–V7 (V8 opcional). Medición: marcas `performance.mark` + conteo de round-trips en serie, en local con latencia simulada, antes y después.

### Ola 3 — Diccionarios (después de Ola 1; en paralelo con Ola 2)
`check:drift` ampliado (placeholders, `PV_I18N`, `CALC_EXPORT_STR`, claves muertas, prohibir `lang === "es" ?`) → una tabla de meses y una de KPIs → `core/i18nExport.ts` (`makeT(lang)` único + `fmtL(n, lang)`) → migrar deck, tarjeta y Vista Partner → texto hardcodeado a `I18N` (Seguimiento, portal, login, errores de subida con códigos) → tuteo en toda la app → etiqueta visible de `SIN_KAM` separada de su valor.

### Ola 4 — Sistema de diseño (puede arrancar en paralelo con la Ola 1: son archivos nuevos)
`src/styles/tokens.css`, `src/styles/components.css` (btn, card, kpi, badge, table con encabezado fijo, field, alert, segmented, chip), `src/shared/ui.ts` (helpers que devuelven string), `confirmDialog()` que reemplaza los 52 `confirm()/alert()`, set de iconos SVG, `src/shared/chartTheme.ts` (Apex y Chart.js desde los mismos tokens), `:focus-visible`, borrar las 80 reglas `agy` muertas. Chequeo nuevo en `check:drift`: sin hex ni `agy-` en archivos ya migrados.

### Ola 5 — Estructura (shell) y navegación (después de la Ola 4)
Navegación lateral por grupos y rol, encabezado de página con chips de alcance + frescura, panel de filtros rediseñado, `max-width`, cargas de Excel movidas a Configuración → Cargas (atajo en la barra), shell propio y limpio para el portal del partner (sin avisos internos como "faltan N meses").

### Ola 6 — Rediseño vista por vista (worktrees en paralelo, uno por vista)
| Vista | Cambios principales |
|---|---|
| Rendimiento | 4 KPIs en una fila sin arcoíris; ciudades como tabla; tendencias top-N + "Otros" y comparación por ciudad indexada (hoy Lima aplasta a las demás); "Quién se movió" arriba |
| Metas | Resumen + tabla ordenable por cumplimiento (semáforo accesible) con vista de tarjetas opcional; mes por defecto = último mes con datos; eliminar metas en un menú con confirmación en página |
| Calculadora | Flujo en pasos: 1 metas del KAM → 2 % TukTuk → 3 revisar reparto → 4 guardar/compartir; inputs con formato de miles; aviso del hueco conocido de "Solo lo que cambié" |
| Configuración | Partners (incluye "pendientes de alta" y reasignar KAM en bloque) · Clasificación (Vista Flotas movida desde Data Raw, valor efectivo/heredado) · Cargas · Usuarios (con KAM vinculado) · Mantenimiento (borrado con conteo previo) · Monitoreo |
| Data Raw | Barra de filtros en una línea, tabla con encabezado y primera columna fijos; solo consulta |
| Seguimiento | Estados vacíos con acción; tarjetas y Kanban sobre los componentes nuevos |
| Vista Partner | Según tu decisión (terminarla o retirarla a favor de Presentación) |
| Portal partner | Shell propio, lenguaje para partner, sin datos internos |
| Presentación | Solo la barra de control (agrupada, ocultar líneas sin datos); en las diapositivas, "sin dato" en vez de líneas planas en 0 y etiquetas traducidas. El PDF se toca al final y con cuidado |

---

## 5. Compuertas por ola (todas obligatorias)

1. `npm run verify` (lint + typecheck + check:drift + tests) y `npm run build`.
2. Diff `data-act` ↔ `registerActions` en cero.
3. **Huella de números**: idéntica a la anterior, salvo diferencias explicadas por un bug corregido (listadas).
4. Sesiones locales de los 4 roles (admin, kam, viewer, partner): consola sin errores, capturas a 1440 y 1024 px.
5. Exportaciones (PDF de Metas, deck, tarjeta) en es/en/ru cuando la ola las toca.
6. Revisión de Manuel en local → recién ahí merge a `main` y push.

---

## 6. Decisiones (23-sep-2026)

1. **Dirección visual (elegida tras ver 3 alternativas)**: la **estructura clara de A** (navegación lateral clara agrupada, superficies neutras, rojo solo para marca/acción principal, chips de filtros activos) + las **tarjetas KPI de B** con barra de **avance contra la meta** y su **delta** vs período anterior. De la alternativa C (analítica densa, pestañas arriba, tabla con minigráficos) **no se toma nada**, por decisión explícita de Manuel. **Modo oscuro: sí, al final** (después de la Ola 6), apoyado en los tokens.
2. **Vista Partner: se retira.** Lo único que tiene (embudo de conversión, adquisición por canal, cohortes) se muda a Presentación/Rendimiento antes de borrarla. Va en la Ola 6, pero el inventario de "qué es único" se hace en la Ola 1b.
3. **Migración de la UNIQUE de `metas` (B1)**: se prepara y prueba en local en la Ola 1c; producción solo con confirmación explícita.
4. **Proyección al cierre** (portal, y por coherencia en toda vista mensual): **solo para el mes en curso**. En un mes ya cerrado no se muestra, porque ya no puede avanzar. Textual de Manuel: *"en meses pasados ya en el filtro mensual no hace sentido seguirla mostrando, porque no logrará más avances en ese mes porque ya cerró"*. Va en la Ola 1b.
5. **Modo de ejecución**: todo el plan de corrido, ola por ola, mostrando cada una en local antes de pasar a la siguiente. Nada a `main` sin revisión.

## 7. Trampas de los worktrees (leer antes de lanzar uno)

- `.env.local` **no está versionado**: un worktree recién creado no lo tiene y `npm run dev`/`build` apuntaría a **PRODUCCIÓN**. Copiarlo siempre desde el repo principal antes de levantar nada.
- `node_modules` tampoco: `npm ci` en el worktree (o symlink al del principal).
- **El Supabase local es uno solo y compartido** entre worktrees: nadie re-siembra ni trunca mientras otro prueba; toda mutación de prueba se revierte (re-sembrar al terminar o `BEGIN…ROLLBACK`).
- Puerto propio por worktree (el 8765 es el de la sesión coordinadora).
- Con worktrees vivos en `.claude/worktrees/`, Vitest corre también sus tests (la Ola 0 lo excluye).

## 8. Bitácora de ejecución

| Ola | Estado | Verificación |
|---|---|---|
| 0 — base de verificación | Integrada (`53a5ece`) | Seed al 14-sep-2026 (58 partners, 6 KAMs, metas dic-2025→sep-2026, 25 tareas, embudo, portal mapeado). Huella base: 25 escenarios, 0 claves duplicadas |
| 4 — sistema de diseño (base) | Integrada (`974ed6f`) | Kit en `?ui=kit` revisado en pantalla. **Huella idéntica (0 diferencias)**: las pantallas actuales no cambiaron |
| 1b — bugs de vistas | Integrada (`8d53b3b`) | Huella: 262 diferencias, todas esperadas (fila "No KAM" nueva en Rendimiento; en Metas VIA RAPIDA y RUTA DEL SILLAR pasan de Carla/Beto a "No KAM": −604/−51/+655, totales país iguales; ahora Metas y Rendimiento coinciden por KAM). Desborde de gráficos resuelto (medido); título "Vista filtrada — Lima" |
| 1a + 1c — bugs de datos/Config + migración `metas` por año (solo local) | Integrada (`37f1908`) | Huella: mismas 262 diferencias, ninguna nueva. Metas en mes cerrado (agosto) sin proyección; selector con año y orden correcto; Config con tarjeta "No KAM". Migración **no aplicada en producción** |
| 2 — velocidad | Integrada (`0ae1080`) | Huella: 0 diferencias. Medido con 300 ms de latencia simulada (Chrome headless, token vencido, KAM): primer pintado con caché 448→88 ms (semanal) y 827→108 ms (mensual); 0 frames con el login visible (antes ~23); segundo render salteado si los datos no cambiaron; abrir Presentación 180,8→116,0 kB gzip. Sesión vencida verificada en pantalla: se renueva sola y la app sigue abierta |
| 3 — diccionarios | Integrada (`1974389`) | Huella: 0 diferencias. Deck en ruso verificado en pantalla sin claves crudas. `check:drift` ampliado (placeholders, tríos, ternarios de idioma) con prueba de que dispara. 8 tablas de meses → 1; tuteo en toda la app |
| 5 — shell y navegación | Integrada (`20b6a96`) | Huella: 0 diferencias. Revisado en pantalla: navegación lateral agrupada, encabezado con chips de alcance ("Ciudad: Arequipa ×", "Restablecer" vuelve todo a por defecto), panel de Filtros plegable. El agente verificó 4 roles × 8 pestañas × 1440/1024 sin errores ni desborde |
| 6 — rediseño por vista | Integrada (`e26fa54`) | Calculadora, Metas, Configuración + Data Raw, Rendimiento, Presentación (+ retiro de Vista Partner), Seguimiento + Portal, y una pasada de integración (meta de Rendimiento y Metas desde una sola función `metasResumenPais`; cruce Rendimiento↔Metas en 73 comparaciones, 0 diferencias). **Huella completa vs Ola 3: 0 cifras cambiadas, 0 quitadas, 24 nuevas** (variaciones de Metas). 484 tests |
| 7 — modo oscuro + limpieza de CSS | En curso | — |

Decisiones abiertas para Manuel (surgidas en la Ola 6):
1. Metas → filtro "Sobre meta" usa el corte vigente de la app (>150%, el morado de "revisa la meta"). ¿O ≥100%?
2. Metas mensual con el mes en curso no muestra variación (un mes parcial contra uno completo siempre da negativo). ¿OK?
3. Deck: la banda "Top 1" es un solo partner (su valor se ve en el tooltip en pantalla, no en el PDF). ¿Se quita?
4. Deck: las hojas nuevas (embudo, canales, N+R por origen) entran al PDF por defecto. ¿O a mano?
5. Calculadora: eliminar las metas de un KAM pide confirmación pero no exige teclear el nombre. ¿Agregar esa protección?
6. "Salir" cierra la sesión en todos los dispositivos (signOut global). ¿Solo el dispositivo actual?
7. Usuarios → "KAM vinculado" es solo lectura: fijarlo desde la app exige una acción nueva en la Edge Function `admin-users` y desplegarla en producción.
8. Móvil: se quitó el botón flotante de Filtros (tapaba contenido); para filtrar se usa el botón del encabezado.

Nota de producto (pregunta para Manuel, no es regresión): "Salir" llama a `sb.auth.signOut()` sin `scope`, que por defecto es **global**: cerrar sesión en un dispositivo cierra la sesión del mismo usuario en todos los demás. Así se cerró dos veces la sesión de prueba del coordinador cuando un agente probó "Salir" con el mismo usuario.

Anotado para la Ola 6:
- Rendimiento → Tendencias "Perú por partner": la Ola 2 dejó top 8 + "Otros" en un **segundo eje Y**, que se presta a confusión; además varios partners comparten tonos casi iguales. Rediseñar esa sección (sin doble eje; paleta categórica de los tokens).
- Presentación: la barra de controles del deck sigue el idioma del DECK (en ruso muestra "ЯЗЫК", "СРАВНИТЬ С"); tendría que seguir el idioma de la interfaz.
- Portal: pedir las columnas diferidas desde `partnerPortal.ts` (la Ola 2 lo cubrió con la precarga en `app.ts`).

Pendiente conocido del entorno local (no es del producto): la RPC `get_last_ingest_at` existe solo en producción y nunca se versionó, así que en local responde 404 (el código lo tolera).
