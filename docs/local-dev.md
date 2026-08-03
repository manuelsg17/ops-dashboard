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

## Estado y siguiente paso

**Funciona hoy** (verificado en navegador): stack arriba, la app apunta a local,
banda de aviso visible, los 4 roles loguean, la sesion se establece y la UI
autenticada renderiza con el gating de rol correcto.

**Bloqueado:** la base local **no tiene las tablas de la app**. La UI carga y
muestra `Error 404 al cargar partners`. Las tablas core (`partners`,
`rendimiento*`, `metas`, `conversion_pais`, `proyectos`) se crearon a mano desde
el panel de Supabase y **no existen como migracion** — `migrations/` solo tiene
los cambios posteriores, que hacen `ALTER` sobre tablas que localmente no estan.
Por eso `supabase db reset` no alcanza para reconstruir el esquema.

Para destrabarlo hace falta un baseline. **La connection string nunca va por el
chat** — el usuario crea el archivo:

```bash
echo 'export OPS_DB_URL="postgresql://..."' > ~/.ops_dashboard.env
chmod 600 ~/.ops_dashboard.env
```

(esta en Supabase → Settings → Database → Connection string → URI). Despues, en
**una sola invocacion** (el estado de shell no persiste entre comandos):

```bash
source ~/.ops_dashboard.env && npx supabase db dump --db-url "$OPS_DB_URL" -f supabase/migrations/00000000000000_baseline.sql
```

Ese dump es **solo esquema, sin datos** — no arrastra CLIDs ni partners reales.
Despues `npx supabase db reset` levanta todo y hay que **generar datos
sinteticos** para probar (no copiar datos de produccion a la maquina).

Alternativa sin credenciales: reconectar el MCP de Supabase a la organizacion de
`ops_dashboard` (hoy apunta a la de `pricing-ci-dashboard`) y reconstruir el
esquema por introspeccion — mas lento y con mas chance de que se escape un
detalle (defaults, triggers, policies).

## Reset

```bash
npx supabase db reset          # re-aplica migraciones + seed
npx supabase stop              # baja el stack (los datos sobreviven)
npx supabase stop --no-backup  # baja y borra el volumen
```
