-- Aplicadas 2026-08-15 via MCP apply_migration. Se versionan acá porque
-- `migrations/` es el registro del proyecto: una migración solo en el servidor
-- es una que nadie puede auditar ni reproducir en local.
--
-- 1) metas_backup_miguel_julio2026 estaba SIN RLS -> PostgREST la exponía a anon.
--    Verificado con un curl anónimo ANTES (devolvía filas) y DESPUÉS (devuelve []).
--    NO se borró: tiene 4 filas que no existen en `metas` y su total de supply
--    hours (1.090.507,55) es el estado ERRÓNEO previo a la recarga de julio.
--
-- 2) Backfill de tasas guardadas en escala 0-100. Ver el detalle del alcance y
--    la prueba del corte en la migración aplicada (sum(trips_share) por ciudad y
--    semana = 100 antes del 25-may, 1 después).
--
-- 3) Índices: 9 con 0 usos. Los dos de log no estaban sin usar por casualidad,
--    estaban MAL ARMADOS para las consultas de src/monitoreo.ts.

-- (1)
alter table public.metas_backup_miguel_julio2026 enable row level security;
drop policy if exists metas_backup_miguel_julio2026_select_admin on public.metas_backup_miguel_julio2026;
create policy metas_backup_miguel_julio2026_select_admin
  on public.metas_backup_miguel_julio2026 for select to authenticated using (is_admin());

-- (2) Idempotente: el guard mira si quedan filas en escala 0-100.
do $$
begin
  if (select count(*) from public.rendimiento
      where db_id is not null and db_id <> '' and fecha < '2026-05-25'
        and acceptance_rate > 1.5) > 0 then
    update public.rendimiento set
      acceptance_rate=acceptance_rate/100, completion_rate=completion_rate/100,
      bad_rated_trips_share=bad_rated_trips_share/100, fraud_trips_share=fraud_trips_share/100,
      new_drivers_share=new_drivers_share/100, supply_hours_share=supply_hours_share/100,
      trips_share=trips_share/100, commission_share=commission_share/100,
      driver_subsidies_by_gmv=driver_subsidies_by_gmv/100,
      driver_support_requests_share=driver_support_requests_share/100
    where db_id is not null and db_id <> '' and fecha < '2026-05-25';
  end if;

  if (select count(*) from public.rendimiento_diario
      where date < '2026-05-29' and acceptance_rate > 1.5) > 0 then
    update public.rendimiento_diario set
      acceptance_rate=acceptance_rate/100, completion_rate=completion_rate/100,
      bad_rated_trips_share=bad_rated_trips_share/100, fraud_trips_share=fraud_trips_share/100,
      new_drivers_share=new_drivers_share/100, supply_hours_share=supply_hours_share/100,
      trips_share=trips_share/100, commission_share=commission_share/100,
      driver_subsidies_by_gmv=driver_subsidies_by_gmv/100,
      driver_support_requests_share=driver_support_requests_share/100
    where date < '2026-05-29';
  end if;
end $$;

-- (3)
drop index if exists public.flotas_kam_idx;
drop index if exists public.flotas_ciudad_idx;
drop index if exists public.fleetrooms_clid_idx;
drop index if exists public.fleetrooms_kam_idx;
drop index if exists public.seguimiento_project_idx;
drop index if exists public.partner_users_clid_idx;
drop index if exists public.partner_users_created_by_idx;
drop index if exists public.audit_log_user_id_idx;
drop index if exists public.access_log_user_at_idx;
create index if not exists access_log_at_idx      on public.access_log (at desc);
create index if not exists audit_log_table_at_idx on public.audit_log (table_name, at desc);
