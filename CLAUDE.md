# Dashboard KAMS V1 — Yango Peru

Vanilla JS dashboard para KAMs (partner performance). Frontend-only (sin build), Supabase como backend (auth + REST).

## Stack
- HTML + vanilla JS (funciones globales, scripts en orden via `index.html`)
- Charts: ApexCharts (Vista Partner) + Chart.js (Presentacion)
- XLSX para subir Excels; html2canvas + jspdf para PDFs
- Supabase JS pineado a `@2.45.4`. Las 7 librerias CDN tienen SRI sha384

## Estado actual

Ultimo commit relevante: **`a237ff0`** (fix colores Avance Presentacion 2.0).
Historia reciente: `bce50ff` (Fleet propio + TukTuk SH + Avance Combinado) → `b269b07` (Seguridad: XSS/CSP/rol KAM) → `a237ff0` (fix colores/proyeccion Presentacion 2.0).

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

## Sprint 1 pendiente (backlog priorizado)

1. **CSP** en `<meta http-equiv="Content-Security-Policy">` de `index.html`. Allowlist: `script-src 'self' cdn.jsdelivr.net cdnjs.cloudflare.com; connect-src 'self' *.supabase.co`. Ojo con ApexCharts que inyecta SVG inline.
2. **Watermark en PDFs** — email del exportador + timestamp en `jspdf.setProperties()` y como texto faded en el footer. Editar `partnerView.js` (`exportPartnerPDF`) y `presentacion.js`.
3. **Limpiar `console.*`** — 16+ logs filtran data de negocio (CLIDs, breakdowns N+R, errores de upload con nombres). Sustituir por flag `DEBUG` global.
4. **Custom claim por KAM** — ampliar `is_admin()` a tabla `app_users(user_id, role, kam, city)` y policies que filtren por KAM/ciudad. Asi los KAMs solo ven su slice.
5. **Headers HTTP** en el hosting (HSTS, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy minima).

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

## Estructura de archivos

- `config.js` — STATE global, KAM_COLORS, CITY_COLORS, METRICS, anon key
- `data.js` — Supabase loaders, parsers Excel, `escapeHTML`, `fmtSmart`, `normCity`, `applyFlotasOverride`
- `auth.js` — login, deteccion de rol (`STATE.isAdmin`), logout con cleanup completo
- `app.js` — init, sidebar, filtros LRU, `renderConfig`, `deleteDashboardData` (gated)
- `rendimiento.js` — tab Analisis (semanal/mensual) + selector de linea Agregador/Fleet/TukTuk (`STATE.rendLine`, vista Fleet solo-KPIs)
- `metas.js` — tab Metas + selector de linea (`STATE.metasLine`); secciones Fleet/TukTuk meta-vs-actual
- `partnerView.js` — Vista Partner (i18n ES/EN, export PDF): Resumen Ejecutivo, Peru General + provincias, cohortes Top1/2-3/4-5/6-10, Embudo de Conversion y Adquisicion por canal (partner vs promedio Top5/Top10)
- `presentacion.js` — tab Presentacion (Chart.js)
- `rawdata.js` — raw data + Vista Flotas (CLID->nombre/KAM mapping)
- `presentacion2.js` — tab Presentacion 2.0 (deck por partner, Taxi/TukTuk, "Avance vs Meta" con metas Fleet/TukTuk + selector "Mes meta")
- `calculator.js` — Calculadora de Metas (pestañas por linea, reparto goal×share, guardar directo a BD, tarjeta compartible bilingue)
- `ops.js`, `proyectos.js`, `unifview.js`, `insights.js`, `charts.js`
- `migrations/` — SQL versionado; se aplica via MCP Supabase (`apply_migration`, project `oqakoinyzvdgqilxwjjv`) o manualmente en el SQL editor. Ver memoria `supabase-mcp-direct-changes`

## Modelo de datos

- `partners` (CLID, partner, kam) — fuente de verdad del mapeo CLID->nombre/KAM
- `flotas` (clid, nombre_asignado, kam, ciudad, activo) — solo fallback si CLID no esta en `partners`, o para marcar `activo=false`
- `rendimiento` (semanal), `rendimiento_mensual`, `rendimiento_diario` — series temporales; ~48 columnas (7 core historicas + ~41 KPIs taxiparks, incl. `gmv`). UNIQUE (clid,city,fecha|mes|date) para el upsert
- `conversion_pais` (clid, partner, mes; funnel `first_order`/`n5_success`..`n100_success` + 8 columnas de canal: `agency_scouts`, `organic_partner`, `organic_scouts`, `organic_yango`, `paid_yango`, `partner_scouts`, `referral_partner`, `referral_yango`). UNIQUE (clid,mes). RLS espejo del Sprint 0
- `metas` (clid, city, mes; UNIQUE clid,city,mes) — objetivos mensuales por partner. Agregador: `meta_active_drivers`/`meta_nr`/`meta_supply_hours`. Fleet: `meta_sh_car`/`meta_acceptance`/`meta_utilization` (nullable). TukTuk: `meta_tk_ad`/`meta_tk_nr`/`meta_tk_cars` (nullable). `mes` = NOMBRE mayus sin año + `mes_year` (desambigua). Ver `migrations/2026-07-08_metas_fleet_tuktuk.sql`
- `proyectos` — proyectos en curso por partner

`rebuildKAMPartners` (en `config.js`) reconstruye `STATE.KAM_PARTNERS` priorizando `partners`, y agrega flotas solo cuando el CLID NO esta cubierto.

## Comandos comunes

```bash
# Dev local
python3 -m http.server 8765 --bind 127.0.0.1
open http://127.0.0.1:8765/index.html

# Recalcular SRI tras actualizar una libreria
curl -sSL <url> | openssl dgst -sha384 -binary | openssl base64 -A

# Verificar policies en Supabase SQL editor
SELECT tablename, policyname, cmd, roles
  FROM pg_policies WHERE schemaname='public'
 ORDER BY tablename, cmd;

# Promover otro admin
UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
                         || jsonb_build_object('role','admin')
 WHERE email = '...@...';
```

## Caveats

- **Proton Drive sync** ha causado archivos de conflicto silenciosos (`(# Edit conflict ... #).js`) que sobreescribieron cambios. Si aparecen archivos desconocidos, NO borrar — investigar primero y consultar al usuario.
- **Excel en varios formatos** (numero completo o texto "1.8M"). Los uploads de rendimiento/conversion usan `raw:true` + `toN` (expande K/M/B y pasa numeros tal cual). NO volver a `raw:false` ni quitar el passthrough de numeros en `toN` → rompe precision/decimales. Ver memoria `excel-upload-full-precision`.
- **Excel de Conversion = 2 pestañas**: "Conversion" (funnel) y "Adquisition by channel". `handleFile` lee ambas en una sola subida; el upsert por (clid,mes) actualiza solo funnel o solo canal sin pisar el otro.
- `node` SI esta disponible: usar `node --check <archivo>` como gate de sintaxis antes de commitear. No hay bundler — los scripts se cargan en orden via `index.html`.
- El anon key vive en `config.js` (es publico por diseno, pero no debe filtrarse en screenshots ni en repos publicos).
- `bannedWords` viene de `localStorage` y puede ser manipulado — siempre re-escapar al renderizar.
- Si cambias la URL/version de una libreria CDN, recalcula su SRI o el browser bloquea el script.
