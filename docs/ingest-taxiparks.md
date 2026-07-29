# ingest-taxiparks — contrato de ingesta automática

Endpoint para que la tarea programada **"Dashboard OPS"** (proyecto
`kam-managment`, martes 9am hora Lima) cargue el reporte semanal de taxiparks
sin que nadie tenga que subir el Excel a mano.

```
POST https://oqakoinyzvdgqilxwjjv.supabase.co/functions/v1/ingest-taxiparks
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

## Cuerpo — usá `records` (formato long)

**Recomendado.** Un registro por (clid, ciudad, sub-flota, período). Las measures
van con **su nombre de DataLens**, no en snake_case: el mapeo de las 50 measures
queda de nuestro lado, así que kam-managment no tiene que conocerlo ni mantenerlo.

```jsonc
{
  "scale": "semanal",              // "semanal" | "mensual" | "diario"
  "source": "dashboard-ops-cron",  // opcional, queda en la bitácora
  "dry_run": false,                // true = valida y reporta, NO escribe
  "records": [
    {
      "city": "Lima",
      "clid": "400001264902",
      "db_id": "0777bab3fb404f8894e566c7a99c38a6",
      "partner": "Lizzo",
      "date": "2026-07-01",        // ISO, DD.MM.YYYY o YYYY-MM (mensual)
      "Active Drivers": 2490,
      "GMV": "1.8M",
      "Trips": 18432
      // … el resto de las measures, con su nombre del reporte
    }
  ]
}
```

### Por qué long y no wide

Medido con el reporte real (312 filas × 4 semanas × 50 measures):

| | crudo | gzip |
|---|---|---|
| wide | 2.587 kB | 22 kB |
| **long** | **1.914 kB** | **14 kB** |

Pero el argumento fuerte no es el tamaño: **el formato wide depende del string
del header** (`"DD.MM.YYYY - Measure"`). Si DataLens cambia el separador o el
formato de fecha, ninguna columna matchea y entran **cero filas** — un 422, no un
error evidente. En long la fecha es un campo propio.

Hay un test que verifica que ambos formatos producen **exactamente el mismo
resultado**, así que migrar de uno a otro no cambia ningún número.

## Cuerpo alternativo — `rows` (formato wide)

Se acepta porque es lo que sale nativo de DataLens y lo que usa la subida manual
del Excel.

```jsonc
{
  "scale": "semanal",
  "rows": [                  // filas del reporte en formato WIDE
    {
      "City": "Lima",
      "CLID": "400001264902",
      "db_id": "0777bab3fb404f8894e566c7a99c38a6",
      "Partner": "Lizzo",
      "01.07.2026 - Active Drivers": 2490,
      "01.07.2026 - GMV": "1.8M",
      "01.07.2026 - Trips": 18432,
      "08.07.2026 - Active Drivers": 2450
      // … una columna por cada combinación fecha × measure
    }
  ]
}
```

### Reglas del formato

| Campo | Obligatorio | Notas |
|---|---|---|
| `City` | sí | Se normaliza a mayúsculas (`Lima` → `LIMA`) |
| `CLID` | sí | Se normaliza a entero en string |
| `db_id` | **sí en la práctica** | Identifica la sub-flota. Ver abajo por qué importa |
| `Partner` | sí | Se guarda tal cual; el nombre "oficial" se resuelve al leer, desde la tabla `partners` |
| `"DD.MM.YYYY - Measure"` | al menos una | Si no hay ninguna columna con ese patrón, la función responde 422 |

**`db_id` no es opcional en los hechos.** Es lo que separa las sub-flotas del
mismo CLID, y de eso dependen las líneas Taxi / Fleet / TukTuk. Si el reporte
llega sin `db_id`, todas las filas de un CLID colapsan en una sola y se pierde
el desglose por línea de negocio.

**Los períodos vacíos se descartan.** El reporte trae la grilla completa aunque
el partner no haya operado; escribir esas filas metería ceros que no son ceros
reales.

## Respuesta

```jsonc
{
  "ok": true,
  "escala": "semanal",
  "tabla": "rendimiento",
  "filas_recibidas": 312,
  "filas_escritas": 1248,        // una por (clid, ciudad, período, db_id)
  "periodos": ["2026-07-01", "2026-07-08"],
  "avisos_de_parseo": []         // measures que no se pudieron leer — revisar si no está vacío
}
```

`avisos_de_parseo` viaja en la respuesta a propósito: si una measure cambia de
nombre en DataLens, el valor entraría como 0 y nadie se enteraría. La tarea que
llama debería avisar cuando ese array no viene vacío.

### Errores

| Código | Significado |
|---|---|
| 401 | Token ausente o incorrecto |
| 400 | `scale` inválida o `rows` ausente/vacío |
| 413 | Más de 20.000 filas |
| 422 | El layout no tiene columnas `"DD.MM.YYYY - Measure"` |
| 500 | `INGEST_TOKEN` sin configurar, o error al escribir |

## Idempotencia

El upsert usa la clave `UNIQUE` real de cada tabla
(`clid, city, fecha, db_id`). **Re-enviar el mismo período actualiza en vez de
duplicar**, así que la tarea puede reintentar sin ensuciar nada.

## Puesta en marcha

```bash
# 1. Generar un token largo y guardarlo (no queda en el repo)
openssl rand -base64 32

# 2. Configurarlo en la función
supabase secrets set INGEST_TOKEN='<el-token>' --project-ref oqakoinyzvdgqilxwjjv

# 3. Desplegar. --no-verify-jwt porque quien llama es una MÁQUINA, no un
#    usuario de Supabase: no tiene JWT. La autenticación la hace el bearer.
supabase functions deploy ingest-taxiparks --project-ref oqakoinyzvdgqilxwjjv --no-verify-jwt
```

Sin `INGEST_TOKEN` configurado la función responde 500 y **no escribe nada** —
es deliberado: un despiste de configuración no debe dejar abierta una escritura
a la base de producción.

### Prueba

```bash
curl -sS -X POST "https://oqakoinyzvdgqilxwjjv.supabase.co/functions/v1/ingest-taxiparks" \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"scale":"semanal","rows":[{"City":"Lima","CLID":"999","db_id":"test","Partner":"PRUEBA","01.07.2026 - Active Drivers":1}]}'
```

Deja una fila de prueba real. Para borrarla:

```sql
DELETE FROM rendimiento WHERE clid = '999' AND db_id = 'test';
```

## El parser no se reimplementa

`taxiparks.ts` es una **copia generada** de `src/domain/taxiparks.ts` — el mismo
archivo que usa el navegador para la subida manual. Una Edge Function se
despliega con su propio bundle y no puede importar de `src/`, de ahí la copia.

```bash
npm run sync:ingest            # regenerar tras editar el original
npm run sync:ingest -- --check # el CI corre esto y falla si difieren
```

El mapeo de las 50 measures y la expansión de K/M/B existen **una sola vez**: el
mismo reporte entra idéntico venga por la web o por la API. Si se hubieran
escrito dos veces, tarde o temprano divergen y nadie se entera hasta que los
números no cuadran.
