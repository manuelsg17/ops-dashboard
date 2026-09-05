# Entorno local (Supabase en Docker)

Sirve para **probar flujos con sesion real** — login, permisos por rol, RLS,
uploads, exports — sin tocar produccion.

Escrito para que otra IA (o persona) lo retome sin contexto previo. Lo que ya
funciona esta marcado como **verificado**; lo que falta esta en
[Estado y siguiente paso](#estado-y-siguiente-paso), al final.

---

## Puertos

Elegidos **+10** sobre los del CLI por defecto porque `pricing-ci-dashboard`
ocupa 54321-54324 en la misma maquina. Los dos stacks conviven.

| Servicio | Puerto |
|---|---|
| API (Kong) | 54331 |
| Postgres | 54332 |
| Studio | http://localhost:54333 |
| Mailpit (correos) | http://localhost:54334 |

## Arranque

```bash
npx supabase start
npm run dev
```

Copiar el `anon key` que imprime a `.env.local` (ver `.env.local.example`).
`src/core/config.ts` lee `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` y **cae a
produccion si no hay `.env.local`** — por eso el build de Vercel/Pages no cambia.

Cuando la app apunta a local, una **banda naranja fija** lo avisa arriba de todo
(`IS_LOCAL_SUPABASE` en `core/config.ts`, se pinta en `vendor.ts`). Confundir una
pantalla local con produccion —o al reves, borrar datos reales creyendo que era
la copia— es el error caro de este setup.

Para volver a produccion: borrar `.env.local` y reiniciar `npm run dev`.

## Abrir sesion (sin tipear la password)

```bash
npm run local:session admin      # o kam | viewer | partner
```

Imprime un `window.sb.auth.setSession(...)` para pegar en la consola del
navegador con la app abierta; despues recargar. **Verificado**: deja la UI
autenticada completa, con el rol aplicado.

Existe porque la regla del proyecto (ver CLAUDE.md) es que **un agente no tipea
contraseñas en formularios, ni siquiera locales**. Sin esto, toda vista
autenticada queda fuera de alcance y el entorno sirve solo a medias. No es un
bypass de seguridad: el token sale del mismo endpoint que usa el formulario y
lleva el mismo claim `app_metadata.role`, asi que la app recorre su camino real
de autorizacion (`is_admin()` / `is_kam_or_admin()` / `is_partner()` + RLS). Un
rol mal configurado falla acá igual que en produccion.

Una persona puede simplemente escribir la password en el formulario; a la IA le
toca esta via.

## Usuarios de prueba

Los siembra `supabase/seed.sql` en cada `supabase start` / `db reset`.
Password de los cuatro: **`local-dev-1234`**

| Email | Rol | Para probar |
|---|---|---|
| `admin@local.test` | admin | Usuarios, Monitoreo, borrado masivo, Seguimiento |
| `kam@local.test` | kam | Escritura sin admin (guardar metas), 42501 en delete |
| `viewer@local.test` | viewer | Solo lectura; que las pestañas admin no aparezcan |
| `partner@local.test` | partner | Portal + kill-switch de `my_clids()` |

**Verificado** contra `/auth/v1/token`: los cuatro loguean y el claim
`app_metadata.role` llega correcto en el JWT.

Al partner hay que mapearle CLIDs en `partner_users` para que vea algo: **sin
filas no ve nada, y eso es lo correcto** (kill-switch, ver
`migrations/2026-07-24_partner_portal_rls.sql`).

---

## Trampas ya resueltas

Las cuatro costaron tiempo y **ninguna dice en el error cual es la causa**. Si
algo de esto reaparece, ya esta diagnosticado.

**1. CSP bloquea todo el stack local.** `connect-src` de `index.html` solo
permitia `https://*.supabase.co`, asi que contra local **nada** funcionaba —
tampoco el formulario de login. El sintoma es un `TypeError: Failed to fetch`
pelado que no menciona la CSP. Resuelto agregando `http://127.0.0.1:54331` y
`http://localhost:54331`. No debilita produccion: `connect-src` esta para
impedir exfiltracion hacia un dominio del atacante, y el localhost de la victima
no sirve para eso (ya habia precedente con los `ws://` de HMR).
**Al cambiar el puerto de la API hay que tocar la CSP tambien.**

**2. `Database error querying schema` al loguear.** Un `NULL` en las columnas
`*_token` de `auth.users`; gotrue las escanea a string. El seed las siembra en
`''` a proposito — no sacar esos `''`.

**3. `[analytics]` desactivado en `config.toml`.** Logflare y vector son las
imagenes mas pesadas del stack y su healthcheck tumbaba el arranque entero
(`LegacyHealthCheckTimeoutError`) sin aportar nada para probar flujos.

**4. `npm run preview` tambien toma `.env.local`.** Con el archivo presente el
`dist/` apunta a **local**, no a produccion. Vercel y Pages buildean sin ese
archivo, asi que el deploy no se ve afectado — pero un `dist/` viejo en la
maquina puede confundir.

---

## Estado

**Entorno completo y verificado (2026-08-07).** El bloqueador del esquema quedo
resuelto: hay baseline, datos sinteticos y la UI autenticada renderiza con datos.

### Puesta en marcha desde cero

```bash
npx supabase start                     # stack en Docker (aplica migrations + seed de usuarios)
cp .env.local.example .env.local       # y pegar el ANON_KEY que imprime supabase start
psql "postgresql://postgres:postgres@127.0.0.1:54332/postgres" -f supabase/seed_synthetic.sql
npm run dev
npm run local:session admin            # pegar el snippet en la consola y recargar
```

### El baseline del esquema

`supabase/migrations/00000000000000_baseline.sql` — 16 tablas, 49 policies, 10
funciones, 28 indices, 14 triggers. **Se genero por introspeccion via el MCP de
Supabase**, no con `db dump`: no hizo falta la connection string, asi que nunca
hubo que pasar credenciales por ningun lado.

Lleva **solo esquema**. Los CLID, partners y metricas reales no estan ni deben
estar en la maquina.

**Si el esquema de produccion cambia**, este archivo NO se actualiza solo: las
migraciones nuevas van como archivos aparte con fecha posterior. Regenerarlo
entero solo si el drift se vuelve inmanejable.

### Los datos sinteticos

`supabase/seed_synthetic.sql` — 12 partners inventados (CLID `9000000000xx`, un
rango que no existe en produccion) repartidos en 24 sub-flotas, 3 ciudades,
4 verticales y 16 semanas (con mensual y diario DERIVADOS de la semanal).

**Copian la FORMA de los tres partners grandes de produccion, no sus datos**
(sep 2026). La forma se midio con consultas agregadas — escala, volatilidad,
ratios, reparto entre ciudades y verticales — y los valores se generan aca. No se
baja ni una fila real a la maquina: es la regla del proyecto y ademas es lo unico
que sirve, porque lo que hace realista una prueba es el comportamiento, no los
digitos.

| perfil | imita | forma |
|---|---|---|
| ANDINA MOVILIDAD | Yego | ~2.450 AD en Lima, muy estable (CV 6%), 3 ciudades, las 4 verticales, 17 hojas de deck |
| RUTA SUR | Lizzo | ~1.280 en Lima + TukTuk grande, CV 12% |
| EXPRESO CAPITAL | TRANSPOTAXI | ~1.430 en Lima pero **CV 41%** y en caida: es el que dispara alertas, lecturas y trayectorias con forma |

Los otros 9 existen para que las COHORTES tengan contra que compararse: el
benchmark del Ejecutivo exige **>=3 pares con 50+ activos en las mismas ciudades**
del partner, y sin relleno por ciudad esa tira simplemente no se dibuja. Con este
seed hay 6 pares en Lima, 6 en Trujillo y 5 en Arequipa.

Que cubre que la version anterior no cubria: el **embudo de captacion** (las
columnas `new_profiles_partner_reg*`, que son proporciones y no conteos), las
**metas** de las tres lineas, la volatilidad por flota, y ratios en el rango real
(aceptacion 0,57-0,68, horas/conductor 14-24 por semana, viajes/hora 1,5 taxi /
3,9 tuktuk). Con los ratios de la version vieja (aceptacion 0,74-0,95) el
benchmark comparaba contra medianas que no existen en ningun mercado.

Los **invariantes** que hay que sostener estan listados al final del archivo — son
lo que se verifica, no numeros fijos: los numeros cambian si se toca el `setseed`.

### Trampa que sigue viva

`npm run build` **tambien lee `.env.local`**, asi que con el archivo presente el
`dist/` local apunta a Supabase local. No afecta al deploy (Vercel y Pages buildean
sin ese archivo, y `dist/` esta en `.gitignore`), pero un `npm run preview` despues
de un build local va contra local, no contra produccion.

## Reset

```bash
npx supabase db reset          # re-aplica migraciones + seed (hay que re-correr seed_synthetic)
npx supabase stop              # baja el stack (los datos sobreviven)
npx supabase stop --no-backup  # baja y borra el volumen
```
