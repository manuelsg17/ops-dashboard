# Dashboard KAMS V1 — Yango Peru

Dashboard para KAMs (partner performance) en JS moderno **sin framework**: modulos ES bundleados con **Vite**, Supabase como backend (auth + REST + RLS + 1 Edge Function).

## Stack
- Modulos ES (`src/`), bundleados por Vite. Sin framework, sin JSX. `index.html` carga UN solo `<script type="module">`
- Charts: ApexCharts (Vista Partner) + Chart.js (Presentacion 2.0)
- XLSX para subir Excels; html2canvas + jspdf para PDFs
- Las 7 librerias vienen de **npm** (pineadas en `package-lock`), NO de CDN. Ya no se usa SRI
- CSP estricta: `script-src 'self'` (sin `'unsafe-inline'`, sin dominios externos). Ver A2 abajo

## Estado actual

Ultimo commit relevante: **`868f648`** (watermark en PDFs).
Historia reciente: `a237ff0` (fix colores Presentacion 2.0) → **plan de arquitectura jul 2026, 20 commits** (`0d0a...`→`868f648`).

### Sesion julio 2026 (cont.) — Plan de arquitectura completo (Vite + seguridad + portal de partners)

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
