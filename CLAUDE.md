# Dashboard KAMS V1 — Yango Peru

Vanilla JS dashboard para KAMs (partner performance). Frontend-only (sin build), Supabase como backend (auth + REST).

## Stack
- HTML + vanilla JS (funciones globales, scripts en orden via `index.html`)
- Charts: ApexCharts (Vista Partner) + Chart.js (Presentacion)
- XLSX para subir Excels; html2canvas + jspdf para PDFs
- Supabase JS pineado a `@2.45.4`. Las 7 librerias CDN tienen SRI sha384

## Estado actual

Ultimo commit relevante: **`93ef1be` (Seguridad Sprint 0)**

Resuelve los 4 hallazgos CRITICOS de la auditoria de seguridad:
- **C1 RLS estricto** — `migrations/2026-05-27_strict_rls.sql` ya corrida en Supabase. Helper `is_admin()` + 28 policies. SELECT a autenticados, INSERT/UPDATE/DELETE solo admin. Cerro el hueco de `rendimiento_diario` que estaba abierto a `public`.
- **C2 XSS** — `escapeHTML()` aplicado a todas las interpolaciones de partner/kam/city en `rawdata.js`, `rendimiento.js`, `metas.js`, `app.js`. `bannedWords` con `JSON.stringify` + escape. `config.js` valida defensivamente el LS.
- **C3 Borrado masivo** — UI "Eliminar Datos" gated por `STATE.isAdmin`. Guard server-side via RLS.
- **C4 SRI** — 7 librerias CDN con `integrity` + `crossorigin="anonymous"` + `referrerpolicy="no-referrer"`. Supabase pineado a version exacta.

Bonus: `auth.js` detecta rol desde `user.app_metadata.role`, `handleLogout` limpia STATE + localStorage sensible antes de signOut.

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
- `rendimiento.js` — tab Analisis (semanal/mensual)
- `metas.js` — tab Metas
- `partnerView.js` — Vista Partner con i18n ES/EN, export PDF
- `presentacion.js` — tab Presentacion (Chart.js)
- `rawdata.js` — raw data + Vista Flotas (CLID->nombre/KAM mapping)
- `ops.js`, `proyectos.js`, `unifview.js`, `insights.js`, `calculator.js`, `charts.js`
- `migrations/` — SQL que se corre manualmente en Supabase Dashboard

## Modelo de datos

- `partners` (CLID, partner, kam) — fuente de verdad del mapeo CLID->nombre/KAM
- `flotas` (clid, nombre_asignado, kam, ciudad, activo) — solo fallback si CLID no esta en `partners`, o para marcar `activo=false`
- `rendimiento` (semanal), `rendimiento_mensual`, `rendimiento_diario` — series temporales
- `metas` — objetivos mensuales por partner
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
- No hay `node`/`deno`/`esbuild` localmente. La sintaxis JS se valida visualmente o en el browser.
- El anon key vive en `config.js` (es publico por diseno, pero no debe filtrarse en screenshots ni en repos publicos).
- `bannedWords` viene de `localStorage` y puede ser manipulado — siempre re-escapar al renderizar.
- Si cambias la URL/version de una libreria CDN, recalcula su SRI o el browser bloquea el script.
