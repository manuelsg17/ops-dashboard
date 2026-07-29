# Dashboard KAMS V1 — Yango Peru

Dashboard para KAMs (partner performance): modulos **TypeScript** bundleados con **Vite**, Supabase como backend (auth + REST + RLS + 2 Edge Functions).

## Stack
- Modulos TS (`src/`), bundleados por Vite. Sin framework de UI, sin JSX — TODA la app (46 archivos) sigue el mismo patron: funciones que devuelven strings de HTML + event delegation via `data-act` (`src/shared/actions.ts`). `index.html` carga UN solo `<script type="module">`.
- **Preact se probo y se descarto** (jul 2026): la migracion a TS de Gemini sumo Preact en un unico componente (`AdminUsers.tsx`, el panel de Usuarios), dejandolo como la UNICA pantalla con un paradigma distinto (JSX + `onClick` nativo) al resto de la app. Revertido a proposito por uniformidad de arquitectura — un panel CRUD simple no justificaba sumar un framework ni la inconsistencia. Si en el futuro se evalua un framework de UI, que sea una decision consciente para TODA la app, no para una pantalla suelta.
- **`strict: false` / `noImplicitAny: false` / la mayoria de los archivos tienen `//@ts-nocheck`** — la migracion de JS a TS (jul 2026, ver abajo) fue mecanica (renombrar + ajustar lo que rompia el build), NO agrego chequeo de tipos real en la mayoria del codigo. Los unicos archivos SIN `@ts-nocheck` (chequeados de verdad): `core/config.ts`, `core/dates.ts`, `core/format.ts`, `core/security.ts`, `domain/types.ts`, `shared/actions.ts`, `shared/pdfmeta.ts`. Tipar en serio el resto se evaluo y se descarto (jul 2026): el costo de modelar `STATE` (objeto global de 40+ campos mutado desde ~39 archivos) no compensa frente al beneficio para un equipo chico — los bugs reales de este proyecto nunca fueron de tipos. Correr `npx tsc --noEmit` de vez en cuando — no esta en ningun script de `package.json` ni en CI, hay que acordarse de correrlo a mano.
- Charts: ApexCharts (Vista Partner + Rendimiento, **eager** — es el tab por defecto) + Chart.js (Presentacion 2.0, **lazy**, importado dentro de `presentacion2.ts` a proposito — ver `vite.config.js`)
- XLSX para subir Excels — vive SOLO en `src/workers/excelWorker.ts` (Web Worker, parsea sin bloquear el hilo principal); html2canvas + jspdf para PDFs/imagenes — carga diferida via `src/shared/lazyLibs.ts` (`ensurePdfLibs()`/`ensureHtml2Canvas()`), nunca en el bundle eager
- Las librerias vienen de **npm** (pineadas en `package-lock`), NO de CDN. Ya no se usa SRI
- CSP estricta: `script-src 'self'` (sin `'unsafe-inline'`, sin dominios externos). Ver A2 abajo
- **Deploy dual**: GitHub Pages (`manuelsg17.github.io/ops-dashboard`, workflow en `.github/workflows/static.yml`) + Vercel (`vercel.json`, headers HTTP que Pages no soporta — HSTS/X-Frame-Options/frame-ancestors/etc). Los dos conviven; `vite.config.js` detecta `GITHUB_ACTIONS` para el `base` de Pages, Vercel sirve en la raiz de su propio dominio sin config adicional.

## Estado actual

### Sesión Julio 2026 (cont.) — Refactor por capas: arranque, capa de dominio, Metas y Rendimiento

Manuel pidió una auditoría a fondo (carga de ~6s, "se traba y muestra páginas en blanco" al cambiar de pestaña) + 12 pedidos de producto, con luz verde para "un refactor gigante". **Decisión tomada con él: refactor incremental por capas, NO rewrite** — las ~15.000 líneas de lógica de negocio ya están validadas contra datos reales y un rewrite arriesga regresiones silenciosas en los cálculos, que es justo lo que no puede fallar.

**Fase 1 — arranque y estabilidad (`8c8c682`, pusheado)**
- **Bug de la recarga al abrir Vista Partner/Calculadora — causa raíz**: el `catch` de `loadViewModule` (`vendor.ts`) llamaba `location.reload()` ante CUALQUIER error del `import()` dinámico, no solo ante un chunk 404 tras deploy — y un `import()` también rechaza por un fallo de red pasajero o una excepción top-level del módulo. Son los únicos dos `location.reload()` de la app. Ahora: predicado `_isChunkError` compartido, reintento en el lugar para fallos de red, reload SOLO ante chunk 404 confirmado, y cualquier otro error se muestra en el panel (`switchTab` lo captura) en vez de esconderse detrás de una recarga.
- **Bundle de arranque 274 kB gzip → 73 kB gzip**: ApexCharts (510 kB / 133 kB gzip) era el chunk eager más grande y se parseaba antes del login. Pasa a `charts.ensureApex()` (import dinámico) y arranca en paralelo con el fetch. `buildLineChart`/`buildDonutChart` y los 8 montajes de `partnerView.ts` se re-encolan solos si la lib aún no llegó — **trampa evitada**: partnerView tenía guards `typeof ApexCharts === "undefined" → return` que con carga diferida habrían dejado las gráficas en blanco EN SILENCIO.
- **Caché local IndexedDB (`src/data/cache.ts`), stale-while-revalidate**: pinta con el último snapshot y refresca por detrás con indicador `#dataRefreshing`. Keyed por `user_id`, se borra en el logout, expira a 24h, `SCHEMA_V` invalida todo de golpe. `loadFromSupabase` se partió en `_applyCoreData` / `_indexCoreData` / `_renderActiveTabAfterLoad` para que caché y red usen EL MISMO pipeline. Ojo: `STATE.rawDataFull` arranca como `[]` (truthy) — el guard mira `.length`.
- Precarga de chunks en `requestIdleCallback` (`prefetchViewModules`).

**Fase 2 — capa de dominio + Metas + Rendimiento**
- **`src/domain/metrics.ts` + Vitest (`npm test`)**: núcleo de cálculo PURO (no lee STATE, no toca el DOM). Nació porque la misma métrica se calculaba en 3 archivos distintos (`metas.ts`, `rendimiento.ts`, `presentacion2.ts`). Define snapshot vs flujo, proyecciones, ponderados. 16 tests que fijan reglas de negocio, no cobertura.
- **Proyección de Active Drivers = máx del rango × 1.4** (`AD_PROJECTION_FACTOR`), pedido explícito de Manuel. El FACT sigue siendo el snapshot del último período. Reemplaza la proyección plana anterior (el comentario del código que decía "no ×1.4" quedó obsoleto). Los flujos (N+R, horas) siguen con extrapolación lineal por ritmo del mes.
- **Metas: misma estructura en las 4 líneas** — General → Ciudad → KAM → Partner. Antes solo Agregador la tenía; Fleet arrancaba directo en tarjetas de partner y TukTuk/Combinado mostraban resumen país y nada más. Renderer único `_renderMetasLineView` + descriptores de KPI por línea. **Fleet lleva KPIs de TASA**: al agrupar por ciudad/KAM se RE-PONDERAN (`weight`: autos para SH/auto, viajes para aceptación) en vez de sumarse — verificado con datos sintéticos: un partner de 100 autos al 90% y uno de 2 autos al 50% dan 89.6% ponderado, no el 70% del promedio simple.
- KPIs solo-meta (Utilización de Fleet) ya no muestran "0.0% de plan" (se leía como incumplimiento cuando en realidad no se mide): `metaResCard`/`miniBar` con `real == null` renderizan "meta · sin actual medible".
- El selector de mes y el botón de PDF ya no desaparecen al cambiar de línea (`_metasControlsHTML` compartido).
- **Bug de cálculo corregido en Rendimiento**: el filtro de KAM no se aplicaba en las líneas TukTuk/Combinado. En Agregador el KAM se aplica indirectamente (los checkboxes del sidebar), pero los partners solo-TukTuk NO están en el sidebar y `_lineSelHas` los da por incluidos SIEMPRE → al filtrar por un KAM se colaban los solo-TukTuk de todos los demás KAMs. Ahora `_rendLineFiltered`/`_rendLinePrev` filtran el KAM de forma explícita (`_lineKamOf`).
- **Métrica de Viajes** en Rendimiento: tarjeta país, KPI por ciudad, breakdown por KAM, columna ordenable en la tabla y gráfica de tendencia (Perú + cada ciudad). Propagada por `aggPD`/`aggDate`/`aggCityDate` y `buildMultiLine`. **Ojo**: `colKeys` de `sortTbl` mapea por ÍNDICE de `<th>` — tiene que seguir el mismo orden que `cols` de `renderTable`.
- **Pestaña "Rend + Metas" (`unifview`) eliminada** de punta a punta (nav, tab-panel, importer, render hooks, archivo) — Manuel confirmó que no la usa.

**Fase 3 — Seguimiento como tablero de proyecto (puntos 7 y 10)**
- **El problema que resolvía**: la pestaña abría auto-seleccionando `partners[0]` (el primero alfabético, casi siempre sin tareas) directo en el editor → al entrar parecía que no había nada cargado y no había forma de saber quién tenía seguimiento. Ahora `SEG_STATE.partner = null` es un estado válido y significa "todos".
- **4 vistas** (`SEG_STATE.view`): **Resumen** (default) · **Kanban** · **Gantt** · **Editar**. Gantt y Editar se deshabilitan sin partner elegido (operan sobre UN partner); Resumen y Kanban son globales y leen directo de `STATE.seguimientoData`, sin depender de haber cargado un draft.
- **Resumen**: 4 KPIs (vencidas / bloqueadas / abiertas / hechas) + tabla de partners con seguimiento ordenada **por urgencia** (vencidas → bloqueadas → volumen), con barra de progreso, próxima entrega y botón "Abrir →" que salta al Gantt de ese partner. `_segIsOverdue` = tiene fecha de fin, ya pasó y no está hecha (es un hecho, a diferencia de "bloqueado" que es un estado declarado).
- **Kanban**: una columna por estado de `SEG_STATUS`; global (toda la cartera del KAM) o acotado a un partner. Las vencidas van arriba de cada columna y con borde rojo.
- **Buscador de partner con autocompletado**: mismo patrón que Presentación 2.0 (input + lista flotante + `mousedown` que corre antes del `blur`, con `setTimeout` de 150ms). Ofrece PRIMERO los partners que ya tienen tareas (etiqueta "con seguimiento") y después el resto.
- Filtro por KAM propio de la pestaña (`_segKamOf` vía `getKAMForPartner`), no el del sidebar — Seguimiento está en `NO_SIDEBAR_TABS`.
- CSS nuevo en `styles.css` bajo "SEGUIMIENTO: tablero de proyecto".

**Fase 4 — Presentación 2.0 alineada, portal de partners y monitoreo (puntos 8, 11, 12)**
- **Divergencia de cálculo entre pantallas, corregida (punto 8)**: Metas proyectaba AD como máx × 1.4 y Presentación 2.0 lo proyectaba PLANO (= último período), con un comentario en `p2ProjMTD` argumentando explícitamente en contra del ×1.4. Para el mismo partner y el mismo mes las dos pantallas daban números distintos — y el deck es el que se le manda al partner. Verificado: serie 100/150/120 → Metas 210, deck 120. Además, en la slide "Avance vs Meta Combinado" la proyección de AD estaba literalmente igualada al fact, así que la marca nunca se movía. Ahora `p2ProjMTD` usa `domain/metrics` y coincide al decimal con Metas.
- `projA` (data.ts) delega en `domain/metrics.projectFlow`; conserva la única regla propia (escala mensual = período cerrado, no se proyecta). Las ~10 llamadas con firma de array siguen igual.
- **Retención unificada**: la fórmula estaba escrita TRES veces dentro de `presentacion2.ts` (partner, ciudad, promedio del cohorte). Ahora las tres llaman a `retentionSeries`. Decisiones que estaban implícitas y ahora tienen test: primer período y base 0 → `null` (no 0, que se promediaría como "perdimos a todos"); los negativos NO se recortan (churn severo es justo lo que hay que ver).
- **Portal de partners (punto 11)**: selector de línea (Combinado/Taxi/Fleet/TukTuk, solo las que ese partner tiene), metas por línea con proyección dibujada, 4 gráficas de evolución y detalle por período con WoW %. **Ojo con el WoW**: la tabla va descendente pero el WoW se calcula contra el período anterior EN EL TIEMPO, no contra la fila de abajo; sin base muestra "—", no "0%". Fleet tiene bloque propio (tasas re-ponderadas). La seguridad sigue siendo RLS: no hay ni debe haber un `where clid=...` ahí.
- **Monitoreo (punto 12)**: nueva sub-pestaña de Configuración (`src/monitoreo.ts`, admin-only) con accesos por cuenta (`last_sign_in_at` vía la Edge Function `admin-users`, con foco en cuentas de partner y antigüedad coloreada) + lectura del `audit_log` filtrable por tabla. Carga bajo demanda con un botón, no en cada render. **Lo que NO registra todavía se dice explícitamente en pantalla**: descargas y aperturas de pestaña necesitan tabla propia — `audit_log` no acepta escrituras del cliente A PROPÓSITO (tamper-evident). Migración lista y SIN aplicar: `migrations/2026-07-28_access_log.sql` (`access_log`, INSERT solo de los propios eventos vía `WITH CHECK auth.uid()`, SELECT admin-only, sin UPDATE/DELETE). Distinción importante documentada ahí: `audit_log` lo escribe Postgres y es EVIDENCIA; `access_log` lo escribe el navegador y es TELEMETRÍA — nunca decidir seguridad con la segunda.

**`access_log` APLICADA** (`migrations/2026-07-28_access_log.sql`, aplicada 2026-07-28 vía MCP `apply_migration`). Verificada con la batería de siempre dentro de `BEGIN...ROLLBACK`: un autenticado inserta su propio evento (OK), escribir a nombre de OTRO user_id da 42501, un no-admin lee 0 filas, y el kill-switch de partners sigue en 0. `get_advisors(security)` sin advertencias nuevas (siguen las 6 SECURITY DEFINER intencionales + leaked-password del plan gratuito).
- **Registro conectado** desde `src/shared/accessLog.ts`: `login` (solo en el evento SIGNED_IN — `showApp` también corre al restaurar sesión en cada refresh, loguear ahí infla los ingresos), `tab` (PRIMERA visita a cada pestaña por sesión, no cada switch), `download_pdf`/`download_csv` en los 7 puntos de exportación.
- **Diferido a `requestIdleCallback`**: `sb.from()` necesita el access token y supabase-js SERIALIZA tras un mismo lock — disparar el insert en el acto lo pondría a competir con el fetch de datos, justo el camino crítico que se optimizó en la Fase 1.
- El panel de Monitoreo muestra ingresos, personas activas, descargas y ranking de secciones, en bloque SEPARADO del `audit_log` a propósito: `audit_log` lo escribe Postgres y es EVIDENCIA; `access_log` lo escribe el navegador y es TELEMETRÍA — nunca decidir seguridad con la segunda.

**Rendimiento reordenado y con la mitad de gráficas (punto 4, cierre)**
- **16 gráficas → 8**. Había 4 métricas × CADA ciudad (12 con 3 ciudades) + 4 de Perú. Cada `ApexCharts.render()` bloquea 30-80ms → ~800ms de hilo principal, y encima obligaba a hacer scroll y memorizar para comparar dos ciudades. Ahora las de ciudad son 4 comparativas (una serie por ciudad en el mismo gráfico): menos trabajo y la comparación se lee de una.
- **Sección "Productividad"** (ratios, no volúmenes): horas por conductor, viajes por conductor, viajes por hora. Responden "¿cada conductor rinde más?", pregunta distinta de "¿tenemos más conductores?" — un mes puede crecer en AD y caer en horas/conductor sin que se note.
- **Sección "Quién se movió"**: top 5 que más subieron y top 5 que más cayeron en AD vs el período anterior. Se excluyen los partners sin base previa (no es una caída, es que no había con qué comparar). Evita leer 60 filas para saber a quién llamar.
- Orden final: General → Ciudad → KAM → Tendencias → Productividad → Quién se movió → Tabla → Tarjetas.

**Sobre-conteo en TukTuk/Combinado — encontrado comparando admin vs portal real (jul 29)**
- Con UN partner seleccionado, Perú TukTuk mostraba 145 y Combinado 2.855, mientras el portal de ese partner mostraba 77 y 2.787. La diferencia era **PIAGGIO** (CLID `400011321576`, `is_tuktuk`, KAM Matías, 68 AD): solo-TukTuk → fuera de `rawData` → fuera del sidebar → `_lineSelHas` lo daba por incluido SIEMPRE.
- **Arreglo de fondo**: `STATE.sidebarPartners` (= Taxi ∪ solo-TukTuk) en `updateIndexes`; el sidebar y `_lineSelHas` lo usan. `STATE.allPartners` queda como el universo TAXI a propósito — `presentacion2.p2HasTaxi()` pregunta exactamente eso. Las dos versiones previas de `_lineSelHas` erraban en direcciones opuestas (sub-conteo y sobre-conteo): el problema nunca estuvo en el filtro sino en el sidebar, que no podía expresar esos partners.
- **Bug propio en el portal**: los KPIs de Fleet mostraban `+0.0%` en todo porque se pasaba el MISMO valor como actual y anterior a `_kpiCard`. Ahora el período anterior se calcula de verdad.
- **Fleet en el portal pasa a snapshot del último período** (era ponderado del rango), para dar el mismo número que ve el KAM en Rendimiento con el mismo filtro. El bloque de metas sí usa el acumulado del rango —se compara contra un objetivo mensual— y quedó etiquetado como tal.
- **Método de verificación que conviene repetir**: filtrar la vista admin a UN partner y compararla contra el portal de ese mismo partner. Tienen que dar idéntico; cualquier diferencia es un bug de filtrado o de definición.

**Dato sucio detectado (no es código)**: hay CLIDs sin fila en `partners`, así que se muestran con el número crudo. `400011836443` (Dale Taxi SAC) y `400012046457` (FLOTA GBC AUTOMOTRIZ) además tienen `flotas.nombre_asignado` = el propio CLID. Se arregla cargándolos en Configuración → Partners.

**Proyección de snapshots: NO se suma hacia arriba (jul 29, encontrado comparando deck vs Metas con Lizzo)**
- Metas daba 3.876,6 de proyección de AD y el deck/portal 3.866,8 para el MISMO partner y mes. Causa: Metas sumaba los máximos por (partner, ciudad) mientras el deck tomaba el máximo de la serie total. Lima picó 2.490 una semana y Arequipa 229 en OTRA → la suma (2.769) es un número que **nunca ocurrió**; el máximo real de la serie total es 2.762. La regla es "la semana con el número más alto de AD", así que la única lectura fiel es el máximo de la serie del nivel que se muestra.
- **Regla**: una métrica SNAPSHOT se puede sumar entre unidades para el FACT (Lima + Arequipa son conductores distintos) pero su PROYECCIÓN se recalcula sobre la serie agregada del nivel — sumar proyecciones asume que todo picó el mismo período y sobre-estima siempre. Implementado con `snapSeries` en los descriptores de KPI (`_metasAggKpi`) y `_projADde` en el agregador. Test en `domain/metrics.test.ts`.
- **Brandeados NO lleva `snapSeries`**: su proyección es plana (= nivel actual). El ×1.4 es una regla específica de Active Drivers, no de cualquier snapshot.

**Usuarios: eliminar cuentas + rediseño del panel (jul 29)**
- **Edge Function `admin-users` v4** (desplegada vía MCP `deploy_edge_function`): nueva acción `deleteUser` con DOS guards anti-lockout que viven en el SERVIDOR, no en la UI: (1) nadie se borra a sí mismo; (2) no se puede eliminar al ÚLTIMO admin — sin eso, borrarlo dejaba la administración de usuarios inaccesible desde la app y había que arreglarlo por SQL. Los mapeos de `partner_users` y los grants de `user_permissions` se van solos por `ON DELETE CASCADE`; el `audit_log` NO se toca porque guarda `user_email` desnormalizado justamente para que la historia sobreviva a la baja de la cuenta.
- **Panel rediseñado**: de una tabla densa de 5 columnas a **una tarjeta por usuario** — el objeto que se administra es la PERSONA y sus atributos (rol, permisos, CLIDs) son heterogéneos, no se leen bien como columnas. Buscador por email, chips de filtro por rol con conteo, rol como botones (4 opciones mutuamente excluyentes: verlas todas evita abrir un desplegable para descubrir qué hay), antigüedad del último acceso coloreada, "Invitar" plegado (acción ocasional que ocupaba el tope en cada visita). Estado de UI en `AU_UI` (no en el DOM) porque el panel se repinta entero tras cada acción.
- **Confirmación de borrado EN LÍNEA**, no `confirm()`: se ve a QUIÉN se está borrando mientras se confirma. Un diálogo del navegador tapa la pantalla y se acepta por reflejo — justo lo que no querés en la única acción irreversible del panel.
- CSS nuevo en `styles.css` bajo "CONFIGURACIÓN → USUARIOS Y ACCESOS" (prefijo `.au-`).

**Arranque, segunda vuelta (jul 29) — medido, no estimado**
- **Columnas diferidas**: de las 41 columnas de KPIs taxiparks, solo **15** las lee alguna vista del arranque; las otras **26** (incluidas las 12 del funnel `new_profiles_*`) las usan únicamente Presentación 2.0, Vista Partner, Calculadora y Data Raw, que ya son chunks lazy. Traerlas todas costaba **3.195 kB de JSON vs 1.403 kB (−56%)** sobre la ventana real. Ahora `TX_EAGER_COLS` / `TX_DEFERRED_COLS` en `data.ts`, y `ensureFullRendColumns()` trae **solo las que faltan + la clave** y las fusiona sobre las filas ya cargadas (una vez por escala y sesión, disparado desde `switchTab`). Quien abre esas pestañas no descarga nada dos veces.
  - **Por qué el merge es seguro**: `(clid, city, fecha, db_id)` es ÚNICA — verificado contra la BD antes de implementarlo (0 duplicados). Y todas las vistas comparten las MISMAS referencias de fila (`rawDataFull` es copia superficial; los slices son `filter()`), así que mutar la fila una vez se propaga a todos los slices.
  - **Riesgo evaluado antes de tocar nada**: se buscaron accesos dinámicos (`r[key]`) en los módulos eager. Los que hay operan sobre objetos YA AGREGADOS con vocabulario fijo (`ad/nr/sh/tr`, `owned/shCar/accept/...`), nunca sobre columnas arbitrarias de una fila cruda; y ningún módulo itera `Object.keys(row)`.
  - **Al agregar una columna nueva**: decidir a conciencia en qué lista va. En la equivocada no rompe nada visible de inmediato (queda `null` hasta que se dispara la carga diferida).
- **Índice faltante en `rendimiento_diario`** (`migrations/2026-07-29_idx_rendimiento_diario_date.sql`, APLICADA): la tabla se consulta por ventana de fecha pero su único índice útil lideraba con `clid` → Seq Scan + Sort. Medido: **644 ms → 57 ms**. `rendimiento_mensual` ya tenía el equivalente, y por eso esa escala nunca dio problemas.
- **`partners`/`fleetrooms`/`flotas` ya no esperan la RPC `dashboard_dates`** (116 ms + round-trip): no dependen de la ventana, así que se disparan en paralelo. Solo el fetch de `rendimiento` necesita `winStart`.

**Fleet/TukTuk/Combinado habilitados en escala DIARIA (jul 29)**
- **El supuesto que cayó**: "el export diario no trae `db_id`" (Fase F de la sesión de julio). Ya no es cierto — verificado contra la BD: las **5.516 filas** de la ventana diaria tienen `db_id`, y el tagging separa bien (julio: 7.943 de N+R en Taxi vs 1.009 en TukTuk). `loadDiarioIfNeeded` ahora construye `rawDataDiarioTuktuk` / `rawDataDiarioFleet` espejando al mensual, y se retiraron los guards de `_rendLine`/`_metasLine`/`setRendLine`/`setMetasLine`/`_pvLine`/`_portalLine` y los `disabled` de los toggles.
- **Bug latente que esto destapó**: los selectores de dataset eran `mensual ? mensualX : semanalX` — un BOOLEANO para TRES escalas. En diario caían al slice SEMANAL en silencio. Ahora hay un helper `_sliceEscala(base)` en rendimiento/metas/partnerView/partnerPortal que resuelve las tres. Verificado con una fila trampa: ningún dataset diario se contamina con el semanal.
- **Aviso de escala en Metas** (`_metasEscalaAviso`): en diario y semanal se avisa que **el % de cumplimiento no es comparable**, porque la meta es MENSUAL y el FACT de Active Drivers es un SNAPSHOT del período. Caso que lo motivó: el mismo negocio mostraba **25,6% en diario y 54,9% en semanal** — ninguno era el cumplimiento real. El aviso NO aparece en mensual (verificado en las 3 escalas). N+R y Horas sí acumulan, y eso se aclara en el texto.

**Ingesta automática de taxiparks (jul 29) — parser compartido + Edge Function**
- **El problema**: todo el parseo del reporte vivía en el NAVEGADOR (Web Worker + XLSX + `uploadRendimiento`), así que no existía forma de que la tarea programada "Dashboard OPS" (`kam-managment`, martes 9am Lima) cargara nada — había que subir el Excel a mano cada semana.
- **`src/domain/taxiparks.ts`**: parser PURO extraído de `data.ts` (mapeo de las 50 measures, `toN` con expansión K/M/B, `txExtract`/`txConsolidate`, `parseTaxiparksWide`). El navegador y el servidor usan EL MISMO archivo — dos copias del mapeo divergen tarde o temprano y el mismo reporte entraría distinto según por dónde se cargó. 12 tests que fijan el contrato del formato wide y la precisión numérica.
- **Bug encontrado al extraer**: la llamada recursiva de `toN` en la rama de sufijo (`"1.8M"`) no propagaba el callback de aviso — un valor no parseable con sufijo se perdía en silencio. Tiene test.
- **`supabase/functions/ingest-taxiparks`**: recibe `{scale, rows}` con las filas WIDE en JSON (sin Excel de por medio), parsea con el módulo compartido y hace upsert con `service_role`. **`verify_jwt: false` a propósito** —quien llama es una máquina sin JWT—, compensado con: bearer contra `INGEST_TOKEN` validado ANTES de todo, comparación de **tiempo constante** (un `===` filtra el prefijo correcto por latencia), y **500 si no hay token configurado** (nunca "sin token, dejá pasar"). Idempotente: el upsert usa la UNIQUE real, re-enviar un período actualiza.
- **La copia del parser no puede divergir**: `npm run sync:ingest` la regenera y el CI corre `--check`. Ver `docs/ingest-taxiparks.md` para el contrato completo (fuera de la carpeta de la función: todo lo que está ahí entra al bundle).
- **Pendiente de Manuel**: `supabase secrets set INGEST_TOKEN=...` + `supabase functions deploy ingest-taxiparks --no-verify-jwt`, y pasarle URL+token a la sesión de `kam-managment`.

Pendiente: verificación con datos y sesión reales (lo de arriba se validó con build real + datos sintéticos en `npm run preview`; no hay login por la regla de contraseñas).

### Sesión Julio 2026 (cont.) — Fix PDF Presentación 2.0 + reorden de Configuración + retiro de Palabras Prohibidas

**PDF de Presentación 2.0** (`downloadPresent2PDF`, `presentacion2.ts`) — Manuel reportó tipografía distinta a la de antes, gráficos borrosos y contenido que no encuadraba bien en la hoja. Diagnóstico: nunca hubo `font-family` explícito en ningún lado del PDF (la app entera depende del `body { font-family: ... }` de `styles.css`, que sí sigue intacto) — el PDF quedaba a merced del navegador/SO de quien exporta. Fijado explícito en cada slide (misma familia que `body`) + esperar `document.fonts.ready`. Nitidez: el Chart.js de `p2Chart` no fijaba `devicePixelRatio` — en un monitor no-retina el canvas quedaba a 1x y el `scale:4` de html2canvas solo ampliaba píxeles ya borrosos (fix: `devicePixelRatio: 3` fijo). Encuadre: `jsPDF({unit:"px", ...})` sin `hotfixes:["px_scaling"]` (bug documentado de la librería, desajuste DPI 96↔72 entre el `format` de la página y `addImage`) + `html2canvas` sin `windowWidth`/`windowHeight` fijos (usaba el viewport real de quien exporta). PNG en vez de JPEG para el `addImage` final (elimina artefactos de compresión). Verificado con build limpio + un PDF de prueba standalone en Node confirmando que el marco cae exacto en los bordes de la hoja — falta la verificación con datos reales (requiere sesión logueada).

**Reorden de Configuración** — antes una sola página larga con 5 bloques sin agrupar (alerta de declive, eliminar datos, usuarios y accesos, palabras prohibidas, CRUD de partners). Ahora 3 sub-pestañas (mismo patrón `.mode-toggle-row`/`.mode-btn` que el selector de línea de Rendimiento/Metas, `CONFIG_STATE.section`): **Partners** (CRUD CLID/nombre/KAM, vista por defecto), **Usuarios y Accesos** (admin-only), **Mantenimiento** (alerta de declive + eliminar datos, admin-only). Un viewer/kam sin acceso a las admin-only cae automáticamente a Partners.

**Retiro completo de "Palabras Prohibidas"** — confirmado con el propio usuario (captura: 0 registros/0 partners excluidos por palabra, vs 249 por tagging de fleetroom/db_id) que ya no cumplía ninguna función real: los partners TukTuk/excluidos se gestionan hoy 100% por `db_id` en Data Raso → Vista Flotas. Se retiró de punta a punta, no solo la UI: `STATE.bannedWords` (`core/config.ts`), los 3 filtros en `data.ts` (semanal/mensual/diario), el toggle "Mostrar excluidos 🚫" + badge de fila + columna CSV en `rawdata.ts`, el badge "Palabra prohibida" en Vista Flotas, y `addBannedWord`/`removeBannedWord` + sus `data-act` en `app.ts`. Confirmado 0 referencias remanentes por grep. **No confundir con `STATE.tuktukPatterns`** (`rawdata.ts`) — es una feature totalmente distinta (solo sugiere en Vista Flotas qué CLIDs podrían ser TukTuk por nombre, no filtra nada), no se tocó.

Ultimo commit relevante: **`868f648`** (watermark en PDFs).
Historia reciente: `a237ff0` (fix colores Presentacion 2.0) → **plan de arquitectura jul 2026, 20 commits** (`0d0a...`→`868f648`).

### Sesión Julio 2026 — Migración a TypeScript + Preact (parcial) + optimización exhaustiva

Manuel corrió una sesión en paralelo con **Gemini** que reescribió todo `src/` de `.js` a `.ts`, sumó Preact (1 componente), un Web Worker para XLSX, y extrajo ~1200 estilos inline a CSS. Quedó sin commitear, sin revisar, con `npm run build` pasando en verde — que NO es lo mismo que "andaba": antes de adoptarlo se auditó a fondo y aparecieron varios defectos reales, todos corregidos antes de este commit:

- **`ROLES_VALIDOS` sin declarar** en `supabase/functions/admin-users/index.ts` — se borró por accidente junto con el bloque de CORS viejo. Sin el fix, `invite`/`setRole` tiraban `ReferenceError` en cada llamada.
- **CSS huérfano — el más grave**: el script de extracción (`scripts/extract_css.mjs`) generó `src/styles.css` (591 clases `agy-style-N`) pero nadie lo importaba. Toda la UI tocada por la extracción se habría renderizado sin ningún estilo. Fix: `import "./styles.css"` en `vendor.ts`.
- **12 errores reales de `tsc`** en `core/config.ts` (`STATE.flotasMap` no existía en el tipo inferido) — nadie había corrido `npx tsc --noEmit` ni una vez (no hay script para eso, ni está en CI). Ahora da 0.
- **Bundle eager de ~2.29MB** (ApexCharts + Chart.js + XLSX + jsPDF + html2canvas, todo junto, cargado hasta en la pantalla de login). Se separó por consumidor real (`vite.config.js` `manualChunks` + `src/shared/lazyLibs.ts` para jsPDF/html2canvas + Chart.js movido dentro de `presentacion2.ts`, el único que lo usa) → **carga inicial real bajó a ~840KB (~227KB gzip), verificado con traza de red real, no estimado**. XLSX resultó que Gemini ya lo había aislado bien en `workers/excelWorker.ts` (Web Worker, solo se instancia al subir un Excel).
- **`select("*")` en `rendimiento`/`_mensual`/`_diario`** (pendiente desde la Fase A3 original, nunca se hizo): se armó la proyección explícita de columnas (`REND_COLS_SEMANAL/MENSUAL/DIARIO` en `data.ts`, `core = 9 campos + TX_NEW_COLS` de 41) verificada 1 por 1 contra `information_schema.columns` real antes de aplicar — `rendimiento_diario` NO tiene columnas `partner`/`kam` (a diferencia de semanal/mensual), un desajuste que se detectó ahí y no en producción.
- **Deploy dual GitHub Pages + Vercel**: `vercel.json` nuevo con los headers HTTP que Pages nunca soportó (Sprint 1 backlog #5, ver abajo) + fusión de políticas RLS SELECT duplicadas (`multiple_permissive_policies` del advisor de performance) en 8 tablas, re-testeado con la misma batería SQL de siempre (kill-switch, scoping, 42501).

**Decisión de arquitectura, explícita y consciente** (no silenciosa): Gemini había adoptado Preact SOLO en `AdminUsers.tsx` — se probó, y se **revirtió** en una vuelta posterior el mismo día por pedido explícito de Manuel de mantener uniformidad ("no quiero ver múltiples desarrollos"): un panel CRUD simple no justificaba ser la única pantalla con un paradigma distinto (JSX + `onClick` nativo) al resto de la app. Hoy las 46 vistas siguen el mismo patrón, sin excepciones. La migración a TS es real en 7 archivos (`core/*`, `shared/actions.ts`, `shared/pdfmeta.ts`) y cosmética (`@ts-nocheck`) en el resto — tipar en serio las ~39 vistas/lógica de negocio grandes se evaluó y se descartó (mismo motivo: costo de modelar `STATE` vs. beneficio real para este equipo).

**Bug crítico encontrado y corregido con sesión real** (verificado por Manuel logueado en Vercel, revisado por la IA en modo solo-lectura): la extracción de estilos convirtió `style="display:none"` en clases CSS para `#dsBanner`/`#rendContent`/`#metasContent`, pero el código que los revela (`renderRend`/`renderMetas`) solo limpia el estilo INLINE — la clase que oculta nunca se quitaba, dejando Rendimiento y Metas en blanco pese a tener el HTML ya renderizado en el DOM. Revertidos esos 3 divs específicos a inline (con `style-src 'unsafe-inline'` ya restaurado, no cuesta nada de CSP). Moraleja para la próxima extracción de estilos: nunca tocar un elemento cuyo `id` aparezca en un `.style.xxx =` en JS sin verificar que el toggle siga funcionando.

Plan de 3 tracks ejecutado entero. **Track A** (frontend), **Track B** (SQL, corrio en paralelo), **Track C** (pantallas nuevas).

- **A0** — `fmt5()` (Data Raw a 5 decimales; las sumas internas SIEMPRE fueron exactas, solo el display truncaba), fix del contador de Configuracion (mezclaba palabras prohibidas con flotas inactivas → 2 contadores), borrado de JS muerto (`ops.js`/`proyectos.js`/`insights.js`/`presentacion.js`), reorden del nav, y **toggle "🔀 Combinado"** (Taxi+TukTuk, lineas disjuntas) en Rendimiento y Metas.
- **A1** — scaffold Vite: `npm run dev` reemplaza a `python3 -m http.server`; las 7 libs CDN pasan a npm.
- **A2** — los 17 .js convertidos a modulos ES (`public/` → `src/`), **173 handlers inline → event delegation** (`data-act`/`data-act-change`/`-input`/`-keydown`/`-mousedown`, dispatcher en `src/shared/actions.js`), y con eso **CSP `script-src 'self'`**. Al desaparecer el contexto "string JS dentro de atributo HTML", **`escapeJSAttr` se ELIMINO** (queda una nota explicando por que ya no hace falta) — con data-attributes alcanza `escapeHTML`.
- **A3** — **paginacion por ventana de fechas**: `loadFromSupabase` ya no trae la tabla entera; filtra server-side con `.gte()` (16 semanas / 6 meses / 90 dias por defecto) → −61% de payload, y desacoplado del crecimiento de la tabla para siempre. Bloqueador que hubo que resolver antes: `STATE.allDates` se derivaba de la data cargada, asi que ventanear a secas dejaba al usuario atrapado en la ventana inicial → RPC `dashboard_dates(scale)` (**SECURITY INVOKER** a proposito: asi un partner solo ve SUS periodos). `computeWindowStart` carga 1 periodo extra para no romper el WoW.
- **B1** — `audit_log` + `audit_trigger()` en 10 tablas. **Tamper-evident**: la tabla NO tiene politicas de INSERT/UPDATE/DELETE, solo escribe el trigger (SECURITY DEFINER) — ni un admin reescribe la historia via API. Un audit del lado del cliente seria decorativo (con la anon key se llama a PostgREST directo sin pasar por nuestro JS).
- **B2** — `user_permissions` + `can(perm)`: grants que **SUMAN** sobre el rol (nunca deny — evita la clase clasica de bugs de autorizacion). `STATE.perms` en el cliente solo decide que UI mostrar; el guard real es RLS.
- **B3** — hardening de cuentas (leaked-password protection, `search_path` de `_fleetrooms_touch`).
- **B4** — **RLS del portal de partners**: `partner_users` (user→CLID, N CLIDs por usuario), `is_partner()`, `my_clids()`. Detalle de diseño que casi sale mal: las politicas permissive se **OR-ean**, asi que agregar una politica scoped NO alcanzaba (la vieja `USING(true)` seguia dando todo) → hubo que partir en `_select_internal USING (NOT is_partner())` + `_select_partner`. `my_clids()` vacio = **kill-switch**: un partner sin mapeo no ve NADA (nunca "ve todo por error").
- **B5** — tests de RLS a nivel SQL (`SET ROLE` + `request.jwt.claims`): kill-switch (0 filas), scoping (863 filas / 1 partner vs 9458 / 69), KAM sin regresiones, escrituras de partner → 42501.
- **C1** — administracion de usuarios en Configuracion + **Edge Function `admin-users`**: unica pieza server-side nueva, porque setear `app_metadata.role` necesita la Admin API (`service_role`, que **JAMAS** puede tocar el cliente). Valida el JWT del llamador con la anon key ANTES de instanciar el cliente service_role.
- **C2** — portal de partner (`src/partnerPortal.js`): KPIs, metas vs actual, evolucion y detalle. **No tiene ningun filtro `where clid=...`, a proposito**: el recorte lo hace RLS. Un filtro en el cliente seria teatro y daria la falsa impresion de que la seguridad vive en el frontend.
- **Watermark en PDFs** (`src/shared/pdfmeta.js`, backlog Sprint 1 #2) — `stampPDF(pdf, titulo)` sella metadatos (author = email de la sesion, subject "uso interno") + un pie visible en CADA pagina con email y timestamp. Trampa resuelta: el tamaño de fuente de jsPDF va en PUNTOS pero las coordenadas en la unidad del doc — sin dividir por `internal.scaleFactor`, el pie quedaba microscopico en los PDFs con `unit:"px"` (paginas de ~2400 de ancho). Aplicado en Vista Partner, Presentacion 2.0, Metas y el portal.

**Pendientes menores** (nada bloqueante): test del 403 de `admin-users` con un JWT no-admin (requiere loguearse con una cuenta no-admin — verificado solo por lectura de codigo); end-to-end con sesion real de partner (el scoping SI esta probado a nivel SQL en B5, lo que falta es la vuelta completa por el navegador); recorte opcional de 17 columnas sin uso (no aplicado: el analisis estatico no descarta acceso dinamico `r[key]`); MFA/TOTP para admins.

### Sesion julio 2026 (cont.) — Seguridad (3 fases) + fix Presentacion 2.0 + Fleet Externo (pausado)

**Seguridad, `b269b07`, ya pusheado** — plan de 3 fases ejecutado completo:
- **Fase 1 (XSS almacenado)**: `escapeJSAttr(s)` nueva en `data.js` (junto a `escapeHTML`) — escapa PRIMERO para string JS (`\`/`'`) y LUEGO para atributo HTML; reemplaza el patron roto `escapeHTML(x).replace(/'/g,"\\'")` (no-op, `escapeHTML` ya convirtio `'`→`&#39;` antes del replace) y el patron sin escapar `x.replace(/'/g,"\\'")` en `onclick`/`onchange` inline. Tocados: `presentacion.js`, `ops.js`, `proyectos.js`, `unifview.js`, `calculator.js`, `partnerView.js`, `fleetexterno.js`, `rawdata.js`, `app.js`, `rendimiento.js`, `data.js` (11 archivos). Verificado con round-trip headless (payloads con comillas/backslash) + `node --check`.
- **Fase 2 (defensa en profundidad)**: CSP en `index.html` (`script-src`/`style-src 'unsafe-inline'` — **inevitable**, hay ~183 handlers inline + 1200+ `style=` sin build step que genere nonces; el valor real de la CSP es `connect-src`/`object-src`/`base-uri`, NO bloquea un XSS por atributo si el escape se rompe de nuevo — ver comentario en el propio `index.html`). Flag `DEBUG` global en `config.js` (default `false`) gateando 7 `console.warn/error/log` que filtraban CLIDs/partners en `data.js`/`metas.js`. Logout (`auth.js`) ahora tambien limpia `yangoFleetExtConfig` de localStorage.
- **Fase 3 (rol KAM de permisos, NO de datos)** — **ojo, hubo un pivote a mitad de camino**: el primer intento fue RLS con filtrado de datos por KAM (tabla `app_users`, row-level scoping) — el usuario lo frenó explicitamente: no quiere que los datos se filtren por KAM, todos deben seguir viendo lo mismo, "roles" es solo de PERMISOS de accion. Se revirtio esa tabla/politicas por completo (`DROP TABLE app_users`, `DROP FUNCTION my_kam/my_allowed_clids`, SELECT vuelto a `USING (true)` en las 10 tablas). Diseño final, mas simple: nueva funcion `is_kam_or_admin()` (mismo patron JWT que `is_admin()`, sin tabla nueva) — permite INSERT/UPDATE (NO delete) con `role IN ('admin','kam')` en `rendimiento`/`rendimiento_mensual`/`rendimiento_diario`/`metas`/`partners`/`flotas`/`conversion_pais`. Cliente: `auth.js` ahora deriva `STATE.userRole` (admin/kam/viewer) + `STATE.canWrite` (admin o kam) — `calculator.js` usa `canWrite` para habilitar "Guardar metas". Borrado masivo, eliminar metas y Seguimiento siguen 100% admin-only (`STATE.isAdmin`), sin cambios. Migracion: `migrations/2026-07-18_kam_write_role.sql`. **Rollout pendiente**: para dar de alta un KAM real, correr el mismo comando de "Promover otro admin" (ver seccion Comandos comunes) con `role='kam'` — requiere que ese login YA exista en Supabase Auth de este proyecto.

**Fix Presentacion 2.0 (`a237ff0`, pusheado)**: las barras de "Avance vs Meta"/"Avance Combinado" pintaban TODO <80% en rojo (corte propio de `p2AvanceColor`), desalineado con el resto del dashboard. Ahora `p2AvanceColor` delega en `pColor()` (data.js) — mismos rangos que Metas/Ops/Insights (rojo <50, amarillo 50-79, verde ≥80, morado >100). La marca de proyeccion (antes una linea negra de 2px, opacidad .55, poco visible) ahora es una barra translucida que se extiende hasta el % proyectado — mismo patron visual que `.bar-proj`/`.bar-real` de Metas.

**Fleet Externo — PAUSADO, retomar con cuidado**: el usuario obtuvo acceso de organizacion a un proyecto de Supabase de un colega ("Fleet_Dashboard", ref `kkngykpwpppkiaubpoeg`, organizacion Supabase separada — **no es la misma org que `ops_dashboard`/`pricing-ci-dashboard`**). El conector MCP de Supabase en claude.ai **solo autoriza UNA organizacion a la vez** — reconectar hacia el proyecto del colega corta el acceso al proyecto propio (`ops_dashboard`, ref `oqakoinyzvdgqilxwjjv`) y viceversa. Verificar con `list_projects` cual esta activa antes de asumir.
- Ese proyecto SI tiene datos reales de flota (no es solo su tracker de tareas interno): tablas `fleet_base`, `fleet_utilization`, `fleet_partners_monthly/weekly` (agregado por partner/ciudad/mes: active/churn/retained/new_cars/reactivated/sh + tiers top/normal/low), `fleet_plates_monthly/weekly` (~27k filas, detalle por PATENTE con make/model/year), `fleet_churn_monthly/weekly` (motivo de baja por patente). Todas con RLS activado y **CERO politicas** (hoy nadie las lee via API, ni con login). Tambien existe `audit_log` (emails/roles de SU equipo — nunca exponer) y un tracker de tareas propio (`ft_streams`/`ft_tasks`/`pipeline_cards`/`pipeline_columns`/`projects`/`tasks`/`tracker_tasks`) que **si esta 100% publico sin login** (`FOR ALL TO anon/public USING (true)`) — hallazgo de paso, no es nuestro sistema, no se toco, solo se le aviso al usuario.
- **Enfoque descartado**: exponer vistas de solo-lectura + `GRANT SELECT ... TO anon` para leer en vivo desde el navegador (un segundo cliente Supabase, como el scaffold abandonado de `fleetexterno.js` ya hacia). El harness de Claude Code **bloqueo esta accion dos veces** (primero como permiso, luego como HARD BLOCK de "exfiltracion de datos" — no se puede levantar ni con consentimiento explicito del usuario). **No reintentar este camino** (anon key publica sobre datos de un tercero) — el sistema lo va a bloquear de nuevo.
- **Enfoque acordado, no ejecutado todavia**: importar la data UNA VEZ (o periodicamente, a mano) a tablas propias nuevas (`fleetext_base`, `fleetext_utilization`, `fleetext_partners_monthly/weekly`, `fleetext_plates_monthly/weekly`, `fleetext_churn_monthly/weekly`) en `ops_dashboard`, via `psql`/`pg_dump` directo (Bash tiene ambos instalados, Postgres 18.4) usando las **connection strings de Postgres** (Settings → Database → Connection string → URI) de AMBOS proyectos — esto evita el limite de "una org a la vez" del conector MCP (no lo usa) y evita mover ~30k filas a traves del contexto de conversacion (pg_dump/psql corren en shell local, no cuestan tokens). **Pendiente critico de seguridad**: las contraseñas de BD NUNCA deben pasar por el chat — pedirle al usuario que cree un archivo local el mismo (ej. `~/.fleet_import.env` con `export FLEET_DB_URL=...` / `export OPS_DB_URL=...`), y referenciarlo solo por variable de entorno dentro de un unico comando Bash (recordar: el estado de shell NO persiste entre llamadas a Bash, hay que hacer `source` + `pg_dump` + `psql` en una sola invocacion). El usuario nunca creo ese archivo — quedo ahi la conversacion.
- Se genero un `fleet_classification.json` (clasificacion Fleet/TukTuk/Normal/Descartar por partner, para una IA externa del usuario) a partir de `fleetrooms`+`partners`+`flotas` de `ops_dashboard` — **ya usado y borrado por el usuario**, no es necesario regenerarlo salvo que lo pida de nuevo (si lo pide, recordar: `fleetrooms` es de EXCEPCIONES curadas, no de todos los CLIDs — un partner sin fila en `fleetrooms` es 100% "normal"; varios CLIDs tienen sub-flotas de mas de un tipo → categoria "mixta" a nivel partner, con detalle por `db_id` en `subflotas[]`).

**Uncommitted, sin tocar (intencional)**: `app.js`/`index.html` tienen las 3-4 lineas del scaffold abandonado "Fleet Externo" (tab nav, tab-panel, script tag, dispatch) modificadas pero NUNCA commiteadas — se restauran deliberadamente despues de cada commit para no perder ese trabajo ni mezclarlo con lo aprobado. `fleetexterno.js` sigue sin trackear (`git status` = `??`). Si en algun momento se retoma Fleet Externo de verdad, decidir ahi si se commitea todo junto o se sigue descartando.

### Sesion julio 2026 — Fleet + TukTuk de primera clase (Calculadora → BD → Rendimiento → Metas → Presentacion 2.0)

Las 3 lineas de negocio (Agregador/Fleet/TukTuk) tratadas como **lentes independientes sobre datos ya deduplicados, nunca aditivas**. Fleet ⊂ Agregador (sus autos hacen Taxi); TukTuk se excluye de Taxi. Slices Fleet materializados desde el agregador deduplicado con `rowIsFleet` (`STATE.rawDataFleet` / `rawDataMensualFleet`), sin re-fetch ni doble conteo.

- **Fase 1 — esquema `metas` + Calculadora** (`75eedb8`, migra `migrations/2026-07-08_metas_fleet_tuktuk.sql`): +6 cols nullable (`meta_sh_car`/`meta_acceptance`/`meta_utilization` Fleet + `meta_tk_ad`/`meta_tk_nr`/`meta_tk_cars` TukTuk) + `mes_year` (desambigua cross-year). Loader mapea a `mSHcar/mAcc/mUtil/mtkAD/mtkNR/mtkCars` (NULL≠0). `uploadMetas` detecta headers opcionales; celda vacia → omite la clave (columnas disjuntas, no pisa otras lineas). Calculadora: Fleet ENTRA al reparto con la MISMA ecuacion (goal×share, denominador = TODOS) → no sobre-exige a los no-fleet; **fix precision AD/Cars** (suma fleetrooms por fecha, max entre fechas — antes max sobre todas las filas subcontaba multi-fleetroom); guardar directo `calcSaveMetas` (admin-gated, read-merge-write upsert onConflict clid,city,mes → REEMPLAZA el mes, no acumula); tarjeta compartible **bilingue ES/EN/ES-EN** con crecimiento vs ultimo mes + bloque KPIs Fleet solo para partners fleet.
- **Fase 2 — Rendimiento por linea** (`23e99c1`): selector `STATE.rendLine` (`_rendLine`/`_rendLineDataset`/`_rendLineFiltered`/`_rendLinePrev` en `rendimiento.js`). **NO muta `STATE.rawData`** (agregador intacto para otras pestañas); filtra el slice de la linea con los mismos filtros del sidebar. Vista **Fleet = SOLO KPIs de flota** (owned cars, SH/auto interno = Σinternal_fleet_sh/Σowned_cars, aceptacion = Σ(rate×trips)/Σtrips, branded) — NO AD/SH/N+R (a nivel fleetroom mezclan agregador+fleet → falso negativo). Diario deshabilita Fleet/TukTuk (sin db_id).
- **Fase 3 — Metas por linea** (`23e99c1`): `STATE.metasLine` (independiente de `rendLine`). Fleet: tarjeta por (partner,ciudad) con SH/Auto + Aceptacion (meta vs actual) + Utilizacion (solo meta). TukTuk: resumen Peru (AD/N+R/Brandeados) + tarjetas por partner. Actuales de los slices; AD=max snapshot, N+R=Σ.
- **Fase 4 — Presentacion 2.0** (`c155af5`): "Avance vs Meta" usa metas reales (TukTuk `meta_tk_*`; Fleet Aceptacion/SH-auto como metas, Utilizacion solo meta, Owned Cars referencia). `p2MetaFor` extendido. **Mes de la meta**: `p2AvanceMes()` AUTO = mes del "Hasta" (ves junio → compara vs meta de junio) + selector manual "Mes meta" (Auto/fijo); `p2MonthDates` capa en el "Hasta" (avance MTD); `applyFilters()` re-renderiza el slide. Fix preset "Este mes" (`app.js`): ancla al ULTIMO MES CON DATOS, no al mes calendario de hoy.
- **Fase F (pendiente de DATOS, no de codigo)**: el export **diario no trae `db_id`** → Fleet/TukTuk deshabilitados en escala diaria. Cuando llegue la sub-flota diaria, reactivar sin codigo nuevo.

### Sesion junio 2026 — Taxiparks, Vista Partner, Conversion/Canal
- **Taxiparks KPIs (esquema unificado)** — `migrations/2026-06-02_taxiparks_kpis_y_conversion.sql`: +41 columnas (GMV, ratios, fleet, funnels, shares) en `rendimiento` / `rendimiento_mensual` / `rendimiento_diario`, **conservando los nombres de las 7 columnas viejas** (no rompe graficos existentes). Parser en `data.js`: `TX_COL_BY_NORM` (match exacto header→columna normalizada) + fuzzy fallback solo para las 7 core; `txExtract` / `txConsolidate` / `txRowExtra`.
- **Fix de precision GMV** — el GMV de las flotas grandes de LIMA salia mal (saltos ×3-4 / clavado). Causa: `toN` no expandia la "M" (`"1.8M"`→`1.8`) y `raw:false` entregaba el texto de display perdiendo decimales. Fix: uploads de rendimiento/conversion con `raw:true` + `toN` devuelve numeros tal cual y expande K/M/B. Validacion: GMV ≈ `avg_fare_after_surge × trips` ≈ `comision / ~3%`. Ver memoria `excel-upload-full-precision`. **No revertir.**
- **Vista Partner rediseñada** (`partnerView.js`) — seccion "Peru (General)" (partner combinado entre sus ciudades) + bloques por provincia; comparacion vs cohortes por tamaño (bandas Top1 / Top2-3 / Top4-5 / Top6-10 via `#pvCohortBar`). Charts via `_pvMountChart` (registro keyed, re-render en sitio sin re-render total). Scope a **2 columnas** + GMV/N+R a ancho completo; lineas con headroom de eje Y + `grid.padding` para que las etiquetas no se corten/encimen.
- **Embudo de Conversion** — tabla `conversion_pais` (clid, partner, mes, funnel `first_order`/`n5`..`n100`). UI: SOLO el partner seleccionado vs **PROMEDIO del cohorte** (Top 5 / Top 10 por Active Drivers), barras + tabla agregada — **no expone la conversion de competidores individuales**. Toggle Top5/Top10 (`pvConvCohort`) + filtros AD/ND.
- **Adquisicion por canal** — `migrations/2026-06-06_adquisicion_canal.sql`: 8 columnas de canal en `conversion_pais`. Es la **2da pestaña** del mismo Excel de Conversion ("Adquisition by channel"); `uploadChannels` + `handleFile` lee ambas pestañas; upsert por (clid,mes) actualiza solo funnel o solo canal sin pisarse. UI atada al MISMO toggle Top5/Top10.
- **Hallazgos AD unificados** — el Resumen Ejecutivo ya no muestra "Caida fuerte" (MoM) y "Crecimiento sostenido" (3m) a la vez; un solo bloque (`#5b`) reconcilia ambas señales (mixto / consistente).

### Seguridad (Sprint 0, base vigente — commit `93ef1be`)
RLS estricto (`is_admin()` + 28 policies; **NUNCA revocar EXECUTE de `is_admin()` a `authenticated`** → rompe escrituras admin con 42501, ver memoria `is-admin-execute-required-for-rls`), XSS (`escapeHTML` en todas las interpolaciones + `bannedWords` re-escapado), borrado masivo gated por `STATE.isAdmin`, SRI sha384 en las 7 librerias CDN. `auth.js` detecta rol desde `user.app_metadata.role`.

## Sprint 1 — estado del backlog

1. ~~**CSP**~~ — HECHO y endurecido en A2: `script-src 'self'` (sin `'unsafe-inline'`, sin CDNs). `style-src` conserva `'unsafe-inline'` a proposito (1200+ atributos `style=` + ApexCharts; el costo/beneficio no paga, esta documentado como aceptado en `index.html`).
2. ~~**Watermark en PDFs**~~ — HECHO (`src/shared/pdfmeta.js`).
3. ~~**Limpiar `console.*`**~~ — HECHO (flag `DEBUG` en `core/config.js`).
4. ~~**Custom claim por KAM**~~ — **DESCARTADO por decision del usuario**: los roles internos son de PERMISOS, no de filtrado de datos. Todos los KAMs siguen viendo lo mismo. El scoping por CLID aplica SOLO al rol `partner` (B4). No reintentar filtrar data por KAM sin pedirselo de nuevo.
5. **Headers HTTP** en el hosting (HSTS, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy minima) — PENDIENTE, depende del hosting definitivo.

## Git workflow — CRITICO

- **NUNCA modificar `git config`**. Cada commit usa flags por comando:
  ```
  git -c user.name="Manuel alexis Santillana garabito" \
      -c user.email="masantillanag@yandex-team.ru" \
      commit -m "..."
  ```
- Todo commit termina con `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- Solo commitear/pushear cuando el usuario lo pida explicitamente.
- Branch principal: `main`. Remote: `https://github.com/manuelsg17/ops-dashboard.git`.

## Reglas de testing, seguridad y optimizacion — CRITICO (post-auditoria jul 2026)

Nacieron de bugs reales que pasaron desapercibidos en produccion (deploy roto por dias sin build de Vite, botones muertos sin ningun error en consola, RLS evaluando politicas duplicadas en cada query). Tratarlas como checklist obligatorio antes de dar por "completa" una migracion de patron, un deploy, o un cambio de RLS — no como sugerencia.

**Auditar exhaustivo, no incremental.** Arreglar el bug que se encontro NO alcanza — hay que comparar el universo completo antes de decir "listo". El bug de `auth.js` (handleLogin/handleLogout nunca registrados en el dispatcher) y los 3 `onfocus`/`onblur` de busqueda de partner (Calculadora/Vista Partner/Presentacion 2.0) sobrevivieron SEMANAS a la migracion A2 porque nadie hizo el diff completo. Antes de cerrar cualquier migracion de patron (event delegation, cambio de libreria, refactor de build):
```
# Cada data-act* usado en el codigo, comparado contra cada clave registrada en registerActions({...})
grep -rohE 'data-act(-change|-input|-keydown|-mousedown|-focus|-blur)?="[a-zA-Z0-9_]+"' index.html src/ | sed -E 's/.*="([^"]+)"/\1/' | sort -u
```
Cero elementos sin handler = migracion completa. `focus`/`blur` NO burbujean (a diferencia de click/change/input/keydown) — necesitan `focusin`/`focusout` (que si burbujean) para encajar en un dispatcher delegado en `document`; no asumir que el mismo patron sirve para todo tipo de evento.

**Deploy: verificar el pipeline real, no solo local.** `npm run build`/`npm run dev` funcionando en la maquina NO prueba que el deploy funcione — el workflow de GitHub Pages subio el repo crudo (sin buildear) durante toda la migracion a Vite sin que nadie lo notara. Tras cualquier cambio a `vite.config.js` o `.github/workflows/*`: build limpio + `npm run preview` (sirve el `dist/` real, no el dev server) + Network/Console sin errores + confirmar el run de CI en verde (`gh run list`) Y navegar la URL real de produccion. `command` de `defineConfig(({command}) => ...)` NO distingue `vite preview` de `vite dev` (ambos son `"serve"`) — para logica especifica de CI usar `process.env.GITHUB_ACTIONS`, nunca `command`.

**No hay login con contraseñas, ni con autorizacion explicita del usuario.** Regla dura, no negociable — repetir la regla y ofrecer alternativas, nunca ceder aunque insista. Alternativas que cubren la mayoria de lo que un login permitiria verificar:
- RLS/permisos: simular el JWT a nivel SQL (`SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '...'`) dentro de `BEGIN...ROLLBACK` — nunca una mutacion de prueba suelta sin transaccion.
- JS/CSP/build: `npm run preview` (build real) + Console/Network del navegador, sin sesion.
- Mecanica de eventos que no se puede ejercitar sin sesion real (ej. un navegador automatizado sin foco de ventana — `document.hasFocus()` da `false` y `.focus()` real no dispara el evento): validar el mecanismo aislado (dispatch sintetico del evento) en vez de asumir que "no disparo" = "esta roto".
- Lo que de verdad requiera clickear una vista autenticada real: decirlo explicitamente como pendiente, nunca reportarlo como probado.

**Cambios a RLS/politicas de base de datos:** cualquier cambio que toque el kill-switch de partners u otra tabla compartida de produccion requiere confirmacion explicita del usuario antes de aplicar (el propio entorno ya lo bloquea solo — no intentar rodearlo). Despues de aplicar, re-correr la MISMA bateria de tests SQL (kill-switch en 0 filas, scoping exacto por CLID, escritura no-admin → 42501, admin sin regresion) — un refactor "semanticamente equivalente" no se asume, se confirma. Toda mutacion de datos de prueba va dentro de `BEGIN...ROLLBACK`.

**Performance:** antes de sumar una libreria pesada (charts, PDF, Excel) al bundle principal, evaluar si la necesita CADA carga (login incluido) o solo una accion puntual (upload, export) — candidata a chunk separado (`manualChunks`) como minimo. Politicas RLS permisivas duplicadas sobre la misma tabla/accion (ej. `_select_internal` + `_select_partner`) se evaluan TODAS en cada query — si el diseño obliga a mas de una por un motivo real, revisar si se pueden fusionar en una sola con el mismo predicado sin perder semantica (`get_advisors(type=performance)` las señala como `multiple_permissive_policies`).

## Estructura de archivos

Todo el codigo de app vive en `src/` como modulos ES. `index.html` esta en la raiz y carga solo `src/vendor.js`.

- `src/vendor.js` — entry: importa los 19 modulos + las libs npm y espeja los globales (`Object.assign(window, ...)`). **Ojo con el orden**: los imports de un modulo se resuelven ANTES del cuerpo del archivo que los importa, asi que cualquier codigo top-level que corra al evaluar un modulo NO puede depender de esos globales (ver el comentario largo en `auth.js` — esto rompio el login una vez, en silencio)
- `src/core/config.js` — STATE global, KAM_COLORS, CITY_COLORS, METRICS, DEBUG, anon key
- `src/core/security.js` — `escapeHTML`
- `src/core/format.js` — `fmt`, `fmt5`, `fmtK`, `fmtSmart`, `pColor`, `normCity`, `cityLabel`, `hashColor`
- `src/core/dates.js` — `parseLocalDate`
- `src/shared/actions.js` — dispatcher del event delegation (`registerActions`). Todo handler nuevo va aca, NUNCA `onclick=` inline (rompe la CSP)
- `src/shared/pdfmeta.js` — `stampPDF`: watermark + metadatos de exportacion. Llamar justo antes de `pdf.save()`
- `src/data.js` — loaders Supabase (ventaneados por fecha, A3), parsers Excel, `applyFlotasOverride`
- `src/auth.js` — login, rol (`STATE.userRole`/`isAdmin`/`canWrite`/`perms`), gate de UI por rol, logout con cleanup
- `src/app.js` — init, sidebar, filtros LRU, `renderConfig`, `deleteDashboardData` (gated)
- `src/rendimiento.js` — tab Analisis + selector de linea Agregador/Fleet/TukTuk/Combinado (`STATE.rendLine`)
- `src/metas.js` — tab Metas + selector de linea (`STATE.metasLine`); Fleet/TukTuk/Combinado meta-vs-actual
- `src/partnerView.js` — Vista Partner (i18n ES/EN, PDF): Resumen Ejecutivo, Peru General + provincias, cohortes, Embudo de Conversion y Adquisicion por canal
- `src/presentacion2.js` — tab Presentacion 2.0 (deck por partner, Taxi/TukTuk, "Avance vs Meta")
- `src/calculator.js` — Calculadora de Metas (reparto goal×share, guardar a BD, tarjeta bilingue)
- `src/rawdata.js` — Data Raw + Vista Flotas
- `src/adminUsers.js` — administracion de usuarios (roles, permisos, mapeo de partners). Admin-only
- `src/partnerPortal.js` — portal del rol `partner`
- `src/unifview.js`, `src/seguimiento.js`, `src/charts.js`
- `supabase/functions/admin-users/` — Edge Function (Deno). Lo unico que usa `service_role`
- `migrations/` — SQL versionado; se aplica via MCP Supabase (`apply_migration`, project `oqakoinyzvdgqilxwjjv`) o en el SQL editor. Ver memoria `supabase-mcp-direct-changes`

## Modelo de datos

- `partners` (CLID, partner, kam) — fuente de verdad del mapeo CLID->nombre/KAM
- `flotas` (clid, nombre_asignado, kam, ciudad, activo) — solo fallback si CLID no esta en `partners`, o para marcar `activo=false`
- `rendimiento` (semanal), `rendimiento_mensual`, `rendimiento_diario` — series temporales; ~48 columnas (7 core historicas + ~41 KPIs taxiparks, incl. `gmv`). UNIQUE (clid,city,fecha|mes|date) para el upsert
- `conversion_pais` (clid, partner, mes; funnel `first_order`/`n5_success`..`n100_success` + 8 columnas de canal: `agency_scouts`, `organic_partner`, `organic_scouts`, `organic_yango`, `paid_yango`, `partner_scouts`, `referral_partner`, `referral_yango`). UNIQUE (clid,mes). RLS espejo del Sprint 0
- `metas` (clid, city, mes; UNIQUE clid,city,mes) — objetivos mensuales por partner. Agregador: `meta_active_drivers`/`meta_nr`/`meta_supply_hours`. Fleet: `meta_sh_car`/`meta_acceptance`/`meta_utilization` (nullable). TukTuk: `meta_tk_ad`/`meta_tk_nr`/`meta_tk_cars` (nullable). `mes` = NOMBRE mayus sin año + `mes_year` (desambigua). Ver `migrations/2026-07-08_metas_fleet_tuktuk.sql`
- `proyectos` — proyectos en curso por partner
- `audit_log` (at, user_id, user_email, action, table_name, row_key, old_data, new_data) — lo escriben SOLO los triggers. SELECT admin-only; **sin politicas de escritura a proposito** (tamper-evident). Retencion: purga manual >180 dias, comando en la migracion
- `user_permissions` (user_id, permission) — grants que SUMAN sobre el rol. `can(perm)` los lee desde RLS
- `partner_users` (user_id, clid) — mapeo del rol `partner` a sus CLIDs. Sin filas para un usuario = no ve nada

`rebuildKAMPartners` (en `config.js`) reconstruye `STATE.KAM_PARTNERS` priorizando `partners`, y agrega flotas solo cuando el CLID NO esta cubierto.

## Comandos comunes

```bash
# Dev local (Vite — ya NO python http.server)
npm install        # primera vez
npm run dev        # dev server en http://localhost:8765 (HMR)
npm run build      # build de produccion a dist/
npm run preview    # sirve dist/ para verificar el build
npm test           # Vitest — tests del nucleo de calculo (src/domain/)
npm run typecheck  # tsc --noEmit (no esta en CI: correrlo a mano)

# Ya NO se usa SRI: las 7 librerias vienen de npm (pineadas en package.json +
# package-lock), bundleadas por Vite. Ver src/vendor.js.

# Verificar policies en Supabase SQL editor
SELECT tablename, policyname, cmd, roles
  FROM pg_policies WHERE schemaname='public'
 ORDER BY tablename, cmd;

# Promover otro admin (o 'kam' / 'partner'). Preferir la UI de Configuracion →
# Usuarios (C1), que ademas queda auditada. Este SQL es el fallback.
# OJO: el rol se hornea al emitir el JWT → el usuario debe RE-LOGUEARSE.
UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
                         || jsonb_build_object('role','admin')
 WHERE email = '...@...';

# Quien cambio que (auditoria)
SELECT at, user_email, action, table_name, row_key
  FROM audit_log ORDER BY at DESC LIMIT 50;
```

## Caveats

- **Proton Drive sync** ha causado archivos de conflicto silenciosos (`(# Edit conflict ... #).js`) que sobreescribieron cambios. Si aparecen archivos desconocidos, NO borrar — investigar primero y consultar al usuario.
- **Excel en varios formatos** (numero completo o texto "1.8M"). Los uploads de rendimiento/conversion usan `raw:true` + `toN` (expande K/M/B y pasa numeros tal cual). NO volver a `raw:false` ni quitar el passthrough de numeros en `toN` → rompe precision/decimales. Ver memoria `excel-upload-full-precision`.
- **Excel de Conversion = 2 pestañas**: "Conversion" (funnel) y "Adquisition by channel". `handleFile` lee ambas en una sola subida; el upsert por (clid,mes) actualiza solo funnel o solo canal sin pisar el otro.
- Gate antes de commitear: `npm run build` sin errores (Vite valida al bundlear) + smoke test del tab tocado en `npm run dev`.
- **NUNCA agregar `onclick=`/`onchange=` inline** — la CSP (`script-src 'self'`) los bloquea. Usar `data-act="..."` + `registerActions({...})` de `src/shared/actions.js`.
- **NO agregar libs por CDN** — van por npm, se bundlean.
- Cuidado con el codigo **top-level** en un modulo: corre antes de que `vendor.js` espeje los globales. Si necesita algo de otro modulo, importarlo explicitamente (ver `auth.js`).
- El anon key vive en `core/config.js` (es publico por diseno, pero no debe filtrarse en screenshots ni en repos publicos). El `service_role` **solo** existe dentro de la Edge Function.
- `bannedWords` viene de `localStorage` y puede ser manipulado — siempre re-escapar al renderizar.
- **Proton Drive**: `node_modules/` debe quedar fuera del sync ademas del `.gitignore`.
