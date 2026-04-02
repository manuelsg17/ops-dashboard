# Yango Dashboard — Guía de Configuración Completa

## Estructura de archivos

```
yango-dashboard/
├── index.html        ← entrada principal (solo HTML, sin lógica)
├── styles.css        ← todos los estilos
├── config.js         ← credenciales Supabase y estado global
├── auth.js           ← login/logout con Supabase Auth
├── data.js           ← carga, parseo y agregación de datos
├── charts.js         ← gráficas ApexCharts
├── rendimiento.js    ← pestaña Rendimiento
├── metas.js          ← pestaña Metas
├── app.js            ← sidebar, tabs, helpers de UI
└── README.md         ← esta guía
```

---

## FASE 1 — Configurar Supabase (30 min)

### 1.1 Crear proyecto
1. Ve a https://supabase.com → Sign Up con GitHub
2. New Project → nombre: `yango-dashboard`
3. Región: **South America (São Paulo)**
4. Guarda la contraseña del proyecto

### 1.2 Crear tablas
1. En tu proyecto Supabase ve a **SQL Editor**
2. Pega y ejecuta el contenido del archivo `supabase_schema.sql`
3. Verifica que aparezcan 3 tablas: `partners`, `rendimiento`, `metas`

### 1.3 Obtener credenciales
1. Ve a **Settings → API**
2. Copia:
   - `Project URL` → ej: `https://oqakoinyzvdgqilxwjjv.supabase.co`
   - `anon public key` → el JWT largo que empieza con `eyJ...`

> ⚠️ **IMPORTANTE**: Regenera la anon key si la compartiste públicamente:
> Settings → API → Regenerate anon key

### 1.4 Crear usuarios del equipo
1. Ve a **Authentication → Users → Add user**
2. Crea un usuario por cada persona que usará el dashboard:
   - Email: el correo de trabajo
   - Password: una contraseña temporal (ellos la pueden cambiar)

---

## FASE 2 — Configurar el código

### 2.1 Editar config.js
Abre `config.js` y reemplaza las credenciales:

```javascript
const SUPABASE_URL      = "https://TU_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "TU_ANON_KEY_AQUI";
```

### 2.2 Verificar el orden de scripts en index.html
Los scripts deben cargarse en este orden exacto (ya está configurado):
```html
<script src="config.js"></script>
<script src="data.js"></script>
<script src="auth.js"></script>
<script src="charts.js"></script>
<script src="rendimiento.js"></script>
<script src="metas.js"></script>
<script src="app.js"></script>
```

---

## FASE 3 — Subir a GitHub Pages

### 3.1 Crear repositorio
1. Ve a https://github.com → New repository
2. Nombre: `yango-dashboard` (o el nombre discreto que prefieras)
3. Visibilidad: **Public** (requerido para GitHub Pages gratis)
4. No inicialices con README

### 3.2 Subir los archivos
**Opción A — Desde el navegador (más fácil):**
1. En tu repo recién creado, clic en **Add file → Upload files**
2. Arrastra los 9 archivos de una sola vez:
   `index.html`, `styles.css`, `config.js`, `auth.js`,
   `data.js`, `charts.js`, `rendimiento.js`, `metas.js`, `app.js`
3. Commit message: `Initial dashboard setup`
4. Clic en **Commit changes**

**Opción B — Con Git (si lo tienes instalado):**
```bash
git init
git add .
git commit -m "Initial dashboard setup"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/yango-dashboard.git
git push -u origin main
```

### 3.3 Activar GitHub Pages
1. En tu repo, ve a **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** / folder: **/ (root)**
4. Clic en **Save**
5. Espera ~2 minutos
6. Tu URL será: `https://TU_USUARIO.github.io/yango-dashboard/`

### 3.4 Verificar que funciona
Abre la URL → debe aparecer la pantalla de login de Yango

---

## FASE 4 — Cargar datos por primera vez

### 4.1 Preparar el Excel de Partners (hoja DATOS)
Tu Excel debe tener una hoja llamada **DATOS** con estas columnas exactas:

| CLID | KAM | PARTNER |
|------|-----|---------|
| 400003338829 | Miguel | TRANSPOTAXI |
| 400001264902 | Manuel | Lizzo |
| ... | ... | ... |

### 4.2 Cargar Partners
1. Abre el dashboard → Login
2. Clic en botón verde **Partners** en el topbar
3. Selecciona tu Excel
4. Espera confirmación en el banner verde del sidebar

### 4.3 Cargar Rendimiento
1. Clic en botón rojo **Rendimiento**
2. Selecciona tu Excel con formato pivotado:
   `CLID | City | 26.01.2026 - Active Drivers | 26.01.2026 - Supply Hours | ...`
3. El sistema transforma automáticamente el formato pivotado a filas antes de guardar

### 4.4 Cargar Metas
1. Clic en botón morado **Metas**
2. Selecciona tu Excel con hoja **METAS**:
   `CLID | MES | CIUDAD | SUPPLY HOURS | ACTIVE DRIVERS | N+R`

---

## FASE 5 — Uso semanal

Cada semana cuando tengas datos nuevos:
1. Abre el dashboard
2. Clic en **Rendimiento** → sube el nuevo Excel
3. Los datos se agregan automáticamente (upsert — no duplica)
4. Listo — todos los que tengan acceso ven los datos actualizados

---

## Actualizar el código en GitHub

Cuando hagas cambios en los archivos:

**Desde el navegador:**
1. Ve al repo en GitHub
2. Clic en el archivo que quieres editar → ícono de lápiz
3. Edita → Commit changes

**Con Git:**
```bash
git add .
git commit -m "Descripción del cambio"
git push
```

GitHub Pages se actualiza automáticamente en ~1 minuto.

---

## Reglas de negocio del dashboard

| KPI | Cálculo | Lógica |
|-----|---------|--------|
| Conductores Activos | Última semana del rango | Snapshot, no acumula |
| Nuevos + Reactivados | Suma de todas las semanas del rango | Acumulado |
| Horas de Conexión | Suma de todas las semanas del rango | Acumulado |
| Proyección Activos | Max semana del mes × 1.4 | Estimado cierre |
| Proyección N+R / Horas | Promedio últimas 3 semanas × semanas restantes | Tendencia lineal |
| Partners multi-CLID | Se consolidan por nombre antes de mostrar | YEGO(×3), REDI(×2), Taxigo(×2) |

---

## Solución de problemas comunes

**Login no funciona:**
- Verifica que el usuario existe en Supabase → Authentication → Users
- Verifica que `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `config.js` son correctos

**Los datos no cargan:**
- Abre DevTools (F12) → Console → busca errores en rojo
- Verifica que las tablas existen en Supabase → Table Editor
- Verifica que RLS está configurado correctamente

**Error al subir Excel:**
- La hoja de Rendimiento debe tener columnas con formato `DD.MM.YYYY - Nombre Métrica`
- La hoja DATOS debe tener exactamente las columnas: CLID, KAM, PARTNER
- La hoja METAS debe tener: CLID, MES, CIUDAD, SUPPLY HOURS, ACTIVE DRIVERS, N+R

**GitHub Pages no actualiza:**
- Espera 2-3 minutos después de hacer push
- Hard refresh: Ctrl+Shift+R (Windows) o Cmd+Shift+R (Mac)

---

## Contacto técnico
Dashboard desarrollado para Yango Peru · Partner Performance Analytics
