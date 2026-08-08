-- ============================================================================
-- BASELINE del esquema de ops_dashboard (produccion), generado 2026-08-07.
--
-- POR QUE EXISTE: las tablas core se crearon a mano desde el panel de Supabase y
-- nunca existieron como migracion, asi que `db reset` no reconstruia nada y el
-- entorno local quedaba inservible (Error 404 al cargar partners).
--
-- COMO SE GENERO: por introspeccion via MCP contra produccion (pg_get_functiondef,
-- pg_get_constraintdef, pg_get_indexdef, pg_get_triggerdef, pg_policies). NO se
-- uso la connection string — no hizo falta pedirsela a nadie.
--
-- SOLO ESQUEMA, SIN DATOS. No hay un solo CLID, partner ni metrica real aca.
-- Para probar hay que generar datos sinteticos (ver seed_synthetic.sql).
--
-- SI EL ESQUEMA DE PRODUCCION CAMBIA: este archivo NO se actualiza solo. Las
-- migraciones nuevas van como archivos aparte con fecha posterior.
-- ============================================================================

-- ── SECUENCIAS (las 3 tablas que usan nextval en vez de IDENTITY) ────────────
CREATE SEQUENCE IF NOT EXISTS public.metas_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.proyectos_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.rendimiento_id_seq;

-- ── TABLAS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_log (
  id bigint NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid DEFAULT auth.uid() NOT NULL,
  user_email text,
  event text NOT NULL,
  detail text
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  user_id uuid DEFAULT auth.uid(),
  user_email text,
  action text NOT NULL,
  table_name text NOT NULL,
  row_key text,
  old_data jsonb,
  new_data jsonb
);

CREATE TABLE IF NOT EXISTS public.conversion_pais (
  id bigint NOT NULL,
  clid text NOT NULL,
  partner text,
  mes text NOT NULL,
  active_drivers numeric DEFAULT 0,
  new_drivers numeric DEFAULT 0,
  first_order numeric,
  n5_success numeric,
  n10_success numeric,
  n25_success numeric,
  n50_success numeric,
  n100_success numeric,
  created_at timestamp with time zone DEFAULT now(),
  agency_scouts numeric DEFAULT 0,
  organic_partner numeric DEFAULT 0,
  organic_scouts numeric DEFAULT 0,
  organic_yango numeric DEFAULT 0,
  paid_yango numeric DEFAULT 0,
  partner_scouts numeric DEFAULT 0,
  referral_partner numeric DEFAULT 0,
  referral_yango numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.fleetrooms (
  db_id text NOT NULL,
  clid text,
  name text DEFAULT ''::text NOT NULL,
  kam text,
  city text,
  is_fleet boolean DEFAULT false NOT NULL,
  is_tuktuk boolean DEFAULT false NOT NULL,
  exclude_from_taxi boolean DEFAULT false NOT NULL,
  activo boolean DEFAULT true NOT NULL,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.flotas (
  clid text NOT NULL,
  ciudad text,
  nombre_original text,
  nombre_asignado text NOT NULL,
  kam text,
  activo boolean DEFAULT true,
  creado_en timestamp with time zone DEFAULT now(),
  actualizado_en timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ingest_log (
  id bigint NOT NULL,
  at timestamp with time zone DEFAULT now() NOT NULL,
  scale text NOT NULL,
  tabla text NOT NULL,
  status text NOT NULL,
  formato text,
  origen text,
  filas_recibidas integer,
  filas_escritas integer,
  periodos text[],
  kpis_ok integer,
  kpis_faltantes text[],
  avisos text[],
  error text,
  duracion_ms integer
);

CREATE TABLE IF NOT EXISTS public.metas (
  id bigint DEFAULT nextval('metas_id_seq'::regclass) NOT NULL,
  clid text NOT NULL,
  partner text NOT NULL,
  kam text,
  city text,
  mes text NOT NULL,
  meta_active_drivers numeric DEFAULT 0,
  meta_nr numeric DEFAULT 0,
  meta_supply_hours numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  meta_sh_car numeric,
  meta_acceptance numeric,
  meta_utilization numeric,
  meta_tk_ad numeric,
  meta_tk_nr numeric,
  meta_tk_cars numeric,
  mes_year smallint,
  meta_tk_sh numeric
);

CREATE TABLE IF NOT EXISTS public.partner_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  clid text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid
);

CREATE TABLE IF NOT EXISTS public.partners (
  clid text NOT NULL,
  partner text NOT NULL,
  kam text NOT NULL,
  city text,
  activo boolean DEFAULT true,
  updated_at timestamp with time zone DEFAULT now(),
  is_fleet boolean DEFAULT false NOT NULL,
  is_tuktuk boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.proyectos (
  id bigint DEFAULT nextval('proyectos_id_seq'::regclass) NOT NULL,
  semana date NOT NULL,
  partner text NOT NULL,
  clid text,
  city text,
  tipo text NOT NULL,
  scouts_count integer DEFAULT 0,
  scouts_new_drivers integer DEFAULT 0,
  scouts_conv_pct numeric(6,2) DEFAULT 0,
  cc_calls integer DEFAULT 0,
  cc_conv_1trip_act numeric(6,2) DEFAULT 0,
  cc_conv_50trip_act numeric(6,2) DEFAULT 0,
  cc_conv_1trip_react numeric(6,2) DEFAULT 0,
  cc_conv_50trip_react numeric(6,2) DEFAULT 0,
  off_drivers_attracted integer DEFAULT 0,
  off_conv_1trip numeric(6,2) DEFAULT 0,
  off_conv_50trip numeric(6,2) DEFAULT 0,
  online_registrations integer DEFAULT 0,
  online_conv_1trip numeric(6,2) DEFAULT 0,
  online_conv_50trip numeric(6,2) DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rendimiento (
  id bigint DEFAULT nextval('rendimiento_id_seq'::regclass) NOT NULL,
  clid text NOT NULL,
  partner text NOT NULL,
  kam text,
  city text,
  fecha date NOT NULL,
  active_drivers numeric DEFAULT 0,
  new_from_partner numeric DEFAULT 0,
  new_from_service numeric DEFAULT 0,
  reactivated numeric DEFAULT 0,
  supply_hours numeric DEFAULT 0,
  commission numeric DEFAULT 0,
  trips numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  gmv numeric DEFAULT 0,
  new_drivers numeric DEFAULT 0,
  new_from_partner_50t numeric DEFAULT 0,
  new_from_service_50t numeric DEFAULT 0,
  active_cars numeric DEFAULT 0,
  branded_active_cars numeric DEFAULT 0,
  owned_fleet_active_cars numeric DEFAULT 0,
  owned_fleet_branded_active_cars numeric DEFAULT 0,
  internal_fleet_sh numeric DEFAULT 0,
  external_fleet_sh numeric DEFAULT 0,
  new_profiles numeric DEFAULT 0,
  new_profiles_partner numeric DEFAULT 0,
  new_profiles_partner_50t numeric DEFAULT 0,
  new_profiles_service numeric DEFAULT 0,
  new_profiles_service_50t numeric DEFAULT 0,
  new_drivers_share numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  trips_per_hour numeric,
  money_per_hour numeric,
  avg_driver_rating numeric,
  avg_fare_after_surge numeric,
  bad_rated_trips_share numeric,
  fraud_trips_share numeric,
  driver_subsidies_by_gmv numeric,
  driver_support_requests_share numeric,
  internal_fleet_sh_share numeric,
  internal_fleet_sh_per_active_car numeric,
  sh_per_active_car numeric,
  sh_per_active_driver numeric,
  supply_hours_share numeric,
  trips_share numeric,
  commission_share numeric,
  new_profiles_partner_reg1 numeric,
  new_profiles_partner_reg10 numeric,
  new_profiles_partner_reg50 numeric,
  new_profiles_partner_reg100 numeric,
  new_profiles_service_reg1 numeric,
  new_profiles_service_reg10 numeric,
  new_profiles_service_reg50 numeric,
  new_profiles_service_reg100 numeric,
  db_id text DEFAULT ''::text NOT NULL,
  fleetroom text DEFAULT ''::text NOT NULL
);

-- OJO: rendimiento_diario NO tiene partner ni kam, y usa new_partner/new_service
-- en vez de new_from_*. Es la diferencia que rompio la ingesta automatica (jul 2026);
-- domain/taxiparks.adaptarEsquema() la traduce. No "arreglar" agregando columnas.
CREATE TABLE IF NOT EXISTS public.rendimiento_diario (
  id bigint NOT NULL,
  clid text NOT NULL,
  city text,
  date date NOT NULL,
  active_drivers numeric DEFAULT 0,
  new_partner numeric DEFAULT 0,
  new_service numeric DEFAULT 0,
  reactivated numeric DEFAULT 0,
  supply_hours numeric DEFAULT 0,
  commission numeric DEFAULT 0,
  trips numeric DEFAULT 0,
  gmv numeric DEFAULT 0,
  new_drivers numeric DEFAULT 0,
  new_from_partner_50t numeric DEFAULT 0,
  new_from_service_50t numeric DEFAULT 0,
  active_cars numeric DEFAULT 0,
  branded_active_cars numeric DEFAULT 0,
  owned_fleet_active_cars numeric DEFAULT 0,
  owned_fleet_branded_active_cars numeric DEFAULT 0,
  internal_fleet_sh numeric DEFAULT 0,
  external_fleet_sh numeric DEFAULT 0,
  new_profiles numeric DEFAULT 0,
  new_profiles_partner numeric DEFAULT 0,
  new_profiles_partner_50t numeric DEFAULT 0,
  new_profiles_service numeric DEFAULT 0,
  new_profiles_service_50t numeric DEFAULT 0,
  new_drivers_share numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  trips_per_hour numeric,
  money_per_hour numeric,
  avg_driver_rating numeric,
  avg_fare_after_surge numeric,
  bad_rated_trips_share numeric,
  fraud_trips_share numeric,
  driver_subsidies_by_gmv numeric,
  driver_support_requests_share numeric,
  internal_fleet_sh_share numeric,
  internal_fleet_sh_per_active_car numeric,
  sh_per_active_car numeric,
  sh_per_active_driver numeric,
  supply_hours_share numeric,
  trips_share numeric,
  commission_share numeric,
  new_profiles_partner_reg1 numeric,
  new_profiles_partner_reg10 numeric,
  new_profiles_partner_reg50 numeric,
  new_profiles_partner_reg100 numeric,
  new_profiles_service_reg1 numeric,
  new_profiles_service_reg10 numeric,
  new_profiles_service_reg50 numeric,
  new_profiles_service_reg100 numeric,
  db_id text DEFAULT ''::text NOT NULL,
  fleetroom text DEFAULT ''::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rendimiento_mensual (
  id bigint NOT NULL,
  clid text,
  partner text,
  kam text,
  city text,
  mes text,
  active_drivers numeric DEFAULT 0,
  new_from_partner numeric DEFAULT 0,
  new_from_service numeric DEFAULT 0,
  reactivated numeric DEFAULT 0,
  supply_hours numeric DEFAULT 0,
  commission numeric DEFAULT 0,
  trips numeric DEFAULT 0,
  gmv numeric DEFAULT 0,
  new_drivers numeric DEFAULT 0,
  new_from_partner_50t numeric DEFAULT 0,
  new_from_service_50t numeric DEFAULT 0,
  active_cars numeric DEFAULT 0,
  branded_active_cars numeric DEFAULT 0,
  owned_fleet_active_cars numeric DEFAULT 0,
  owned_fleet_branded_active_cars numeric DEFAULT 0,
  internal_fleet_sh numeric DEFAULT 0,
  external_fleet_sh numeric DEFAULT 0,
  new_profiles numeric DEFAULT 0,
  new_profiles_partner numeric DEFAULT 0,
  new_profiles_partner_50t numeric DEFAULT 0,
  new_profiles_service numeric DEFAULT 0,
  new_profiles_service_50t numeric DEFAULT 0,
  new_drivers_share numeric,
  acceptance_rate numeric,
  completion_rate numeric,
  trips_per_hour numeric,
  money_per_hour numeric,
  avg_driver_rating numeric,
  avg_fare_after_surge numeric,
  bad_rated_trips_share numeric,
  fraud_trips_share numeric,
  driver_subsidies_by_gmv numeric,
  driver_support_requests_share numeric,
  internal_fleet_sh_share numeric,
  internal_fleet_sh_per_active_car numeric,
  sh_per_active_car numeric,
  sh_per_active_driver numeric,
  supply_hours_share numeric,
  trips_share numeric,
  commission_share numeric,
  new_profiles_partner_reg1 numeric,
  new_profiles_partner_reg10 numeric,
  new_profiles_partner_reg50 numeric,
  new_profiles_partner_reg100 numeric,
  new_profiles_service_reg1 numeric,
  new_profiles_service_reg10 numeric,
  new_profiles_service_reg50 numeric,
  new_profiles_service_reg100 numeric,
  db_id text DEFAULT ''::text NOT NULL,
  fleetroom text DEFAULT ''::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.seguimiento (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  kam text,
  partner text NOT NULL,
  clid text,
  city text,
  owner text,
  task text NOT NULL,
  start_date date,
  end_date date,
  expected_result text,
  status text DEFAULT 'pendiente'::text,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  project text
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id uuid NOT NULL,
  permission text NOT NULL,
  granted_by uuid,
  granted_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── IDENTITY ─────────────────────────────────────────────────────────────────
ALTER TABLE public.access_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.conversion_pais ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.ingest_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.rendimiento_diario ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.rendimiento_mensual ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;

-- ── CONSTRAINTS ──────────────────────────────────────────────────────────────
ALTER TABLE public.access_log ADD CONSTRAINT access_log_pkey PRIMARY KEY (id);
ALTER TABLE public.access_log ADD CONSTRAINT access_log_detail_len CHECK (((detail IS NULL) OR (length(detail) <= 200)));
ALTER TABLE public.access_log ADD CONSTRAINT access_log_event_chk CHECK ((event = ANY (ARRAY['login'::text, 'tab'::text, 'download_pdf'::text, 'download_csv'::text, 'upload'::text])));
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.conversion_pais ADD CONSTRAINT conversion_pais_pkey PRIMARY KEY (id);
ALTER TABLE public.conversion_pais ADD CONSTRAINT conversion_pais_clid_mes_key UNIQUE (clid, mes);
ALTER TABLE public.fleetrooms ADD CONSTRAINT fleetrooms_pkey PRIMARY KEY (db_id);
ALTER TABLE public.flotas ADD CONSTRAINT flotas_pkey PRIMARY KEY (clid);
ALTER TABLE public.ingest_log ADD CONSTRAINT ingest_log_pkey PRIMARY KEY (id);
ALTER TABLE public.metas ADD CONSTRAINT metas_pkey PRIMARY KEY (id);
ALTER TABLE public.metas ADD CONSTRAINT metas_clid_city_mes_key UNIQUE (clid, city, mes);
ALTER TABLE public.partners ADD CONSTRAINT partners_pkey PRIMARY KEY (clid);
ALTER TABLE public.partner_users ADD CONSTRAINT partner_users_pkey PRIMARY KEY (id);
ALTER TABLE public.partner_users ADD CONSTRAINT partner_users_user_id_clid_key UNIQUE (user_id, clid);
ALTER TABLE public.partner_users ADD CONSTRAINT partner_users_clid_fkey FOREIGN KEY (clid) REFERENCES partners(clid) ON DELETE RESTRICT;
ALTER TABLE public.partner_users ADD CONSTRAINT partner_users_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.partner_users ADD CONSTRAINT partner_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.proyectos ADD CONSTRAINT proyectos_pkey PRIMARY KEY (id);
ALTER TABLE public.rendimiento ADD CONSTRAINT rendimiento_pkey PRIMARY KEY (id);
ALTER TABLE public.rendimiento ADD CONSTRAINT rendimiento_clid_city_fecha_dbid_key UNIQUE (clid, city, fecha, db_id);
ALTER TABLE public.rendimiento_diario ADD CONSTRAINT rendimiento_diario_pkey PRIMARY KEY (id);
ALTER TABLE public.rendimiento_diario ADD CONSTRAINT rendimiento_diario_clid_city_date_dbid_key UNIQUE (clid, city, date, db_id);
ALTER TABLE public.rendimiento_mensual ADD CONSTRAINT rendimiento_mensual_pkey PRIMARY KEY (id);
ALTER TABLE public.rendimiento_mensual ADD CONSTRAINT rendimiento_mensual_clid_city_mes_dbid_key UNIQUE (clid, city, mes, db_id);
ALTER TABLE public.seguimiento ADD CONSTRAINT seguimiento_pkey PRIMARY KEY (id);
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, permission);
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id);
ALTER TABLE public.user_permissions ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── INDICES ──────────────────────────────────────────────────────────────────
CREATE INDEX access_log_at_idx ON public.access_log USING btree (at DESC);
CREATE INDEX access_log_user_at_idx ON public.access_log USING btree (user_id, at DESC);
CREATE INDEX audit_log_at_idx ON public.audit_log USING btree (at DESC);
CREATE INDEX audit_log_table_name_idx ON public.audit_log USING btree (table_name);
CREATE INDEX audit_log_user_id_idx ON public.audit_log USING btree (user_id);
CREATE INDEX fleetrooms_clid_idx ON public.fleetrooms USING btree (clid) WHERE (clid IS NOT NULL);
CREATE INDEX fleetrooms_kam_idx ON public.fleetrooms USING btree (kam) WHERE (kam IS NOT NULL);
CREATE INDEX flotas_ciudad_idx ON public.flotas USING btree (ciudad) WHERE (ciudad IS NOT NULL);
CREATE INDEX flotas_kam_idx ON public.flotas USING btree (kam) WHERE (kam IS NOT NULL);
CREATE INDEX idx_metas_mes ON public.metas USING btree (mes);
CREATE INDEX idx_partners_kam ON public.partners USING btree (kam);
CREATE INDEX idx_rend_city ON public.rendimiento USING btree (city);
CREATE INDEX idx_rend_fecha ON public.rendimiento USING btree (fecha);
CREATE INDEX idx_rend_kam ON public.rendimiento USING btree (kam);
CREATE INDEX idx_rend_partner ON public.rendimiento USING btree (partner);
CREATE INDEX ingest_log_at_idx ON public.ingest_log USING btree (at DESC);
CREATE INDEX ingest_log_scale_at_idx ON public.ingest_log USING btree (scale, at DESC);
CREATE INDEX metas_clid_mes_idx ON public.metas USING btree (clid, mes);
CREATE INDEX partner_users_clid_idx ON public.partner_users USING btree (clid);
CREATE INDEX partner_users_created_by_idx ON public.partner_users USING btree (created_by);
CREATE INDEX partner_users_user_id_idx ON public.partner_users USING btree (user_id);
-- Este es el indice que bajo la consulta diaria de 644 ms a 57 ms: la tabla se
-- consulta por ventana de fecha y el unico indice util lideraba con clid.
CREATE INDEX rendimiento_diario_date_clid_idx ON public.rendimiento_diario USING btree (date, clid);
CREATE INDEX rendimiento_fecha_clid_idx ON public.rendimiento USING btree (fecha, clid);
CREATE INDEX rendimiento_mensual_mes_clid_idx ON public.rendimiento_mensual USING btree (mes, clid);
CREATE INDEX seguimiento_kam_idx ON public.seguimiento USING btree (kam);
CREATE INDEX seguimiento_partner_idx ON public.seguimiento USING btree (partner);
CREATE INDEX seguimiento_project_idx ON public.seguimiento USING btree (partner, project);
CREATE INDEX user_permissions_granted_by_idx ON public.user_permissions USING btree (granted_by);

-- ── FUNCIONES ────────────────────────────────────────────────────────────────
-- NUNCA revocar EXECUTE de is_admin() a authenticated: rompe las escrituras de
-- admin con 42501 porque las policies la llaman en el contexto del usuario.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$function$;

CREATE OR REPLACE FUNCTION public.is_kam_or_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'kam'), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_partner()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'partner', false);
$function$;

-- my_clids() vacio = kill-switch: un partner sin mapeo no ve NADA (nunca "todo").
CREATE OR REPLACE FUNCTION public.my_clids()
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(pu.clid), ARRAY[]::text[])
  FROM public.partner_users pu
  WHERE pu.user_id = auth.uid();
$function$;

-- Los grants SUMAN sobre el rol; nunca restan (evita la clase clasica de bugs
-- de autorizacion donde un deny mal puesto bloquea a un admin).
CREATE OR REPLACE FUNCTION public.can(perm text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (select public.is_admin())
      OR EXISTS (
        SELECT 1 FROM public.user_permissions
        WHERE user_id = auth.uid() AND permission = perm
      );
$function$;

CREATE OR REPLACE FUNCTION public._fleetrooms_touch()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN NEW.actualizado_en = now(); RETURN NEW; END;
$function$;

CREATE OR REPLACE FUNCTION public._flotas_touch_actualizado()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$function$;

-- Tamper-evident: audit_log NO tiene policies de escritura a proposito. Solo
-- escribe este trigger (SECURITY DEFINER) — ni un admin reescribe la historia.
CREATE OR REPLACE FUNCTION public.audit_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  full_columns boolean := TG_ARGV[0]::boolean;
  key_cols     text[]  := TG_ARGV[1:array_length(TG_ARGV, 1)];
  rec          jsonb;
  key_parts    text[] := ARRAY[]::text[];
  col          text;
BEGIN
  rec := to_jsonb(COALESCE(NEW, OLD));
  FOREACH col IN ARRAY key_cols LOOP
    key_parts := key_parts || COALESCE(rec ->> col, '');
  END LOOP;

  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
    RETURN NEW;   -- no-op (upsert que no cambio nada) → no loguear ruido
  END IF;

  INSERT INTO public.audit_log (user_id, user_email, action, table_name, row_key, old_data, new_data)
  VALUES (
    auth.uid(),
    (auth.jwt() ->> 'email'),
    TG_OP,
    TG_TABLE_NAME,
    array_to_string(key_parts, '·'),
    CASE WHEN full_columns AND TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN full_columns AND TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- SECURITY INVOKER a proposito: asi un partner solo ve SUS periodos.
CREATE OR REPLACE FUNCTION public.dashboard_dates(scale text)
 RETURNS TABLE(periodo text) LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
BEGIN
  IF scale = 'semanal' THEN
    RETURN QUERY SELECT DISTINCT r.fecha::text FROM public.rendimiento r
                  WHERE r.fecha IS NOT NULL ORDER BY 1;
  ELSIF scale = 'mensual' THEN
    RETURN QUERY SELECT DISTINCT r.mes::text FROM public.rendimiento_mensual r
                  WHERE r.mes IS NOT NULL ORDER BY 1;
  ELSIF scale = 'diario' THEN
    RETURN QUERY SELECT DISTINCT r.date::text FROM public.rendimiento_diario r
                  WHERE r.date IS NOT NULL ORDER BY 1;
  ELSE
    RAISE EXCEPTION 'escala invalida: % (esperado: semanal|mensual|diario)', scale;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_partner_kpi_summary(p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS TABLE(clid text, total_trips numeric, max_active_drivers numeric, total_supply_hours numeric, total_gmv numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    r.clid,
    COALESCE(SUM(r.trips), 0) AS total_trips,
    COALESCE(MAX(r.active_drivers), 0) AS max_active_drivers,
    COALESCE(SUM(r.supply_hours), 0) AS total_supply_hours,
    COALESCE(SUM(r.gmv), 0) AS total_gmv
  FROM public.rendimiento r
  WHERE (p_start_date IS NULL OR r.fecha >= p_start_date)
    AND (p_end_date IS NULL OR r.fecha <= p_end_date)
    AND ((NOT (select public.is_partner())) OR (r.clid = ANY (public.my_clids())))
  GROUP BY r.clid;
$function$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversion_pais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleetrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendimiento_diario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendimiento_mensual ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- ── POLICIES ─────────────────────────────────────────────────────────────────
CREATE POLICY access_log_insert_own ON public.access_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY access_log_select_admin ON public.access_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT is_admin() AS is_admin));
CREATE POLICY audit_log_admin_select ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT is_admin() AS is_admin));
CREATE POLICY conversion_pais_admin_delete ON public.conversion_pais AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY conversion_pais_admin_insert ON public.conversion_pais AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY conversion_pais_admin_update ON public.conversion_pais AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can))) WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY conversion_pais_select ON public.conversion_pais AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY fleetrooms_admin_delete ON public.fleetrooms AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY fleetrooms_admin_insert ON public.fleetrooms AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY fleetrooms_admin_update ON public.fleetrooms AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_admin() OR ( SELECT can('write:config'::text) AS can))) WITH CHECK ((is_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY fleetrooms_select ON public.fleetrooms AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY flotas_admin_delete ON public.flotas AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY flotas_admin_insert ON public.flotas AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY flotas_admin_update ON public.flotas AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can))) WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY flotas_select ON public.flotas AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY ingest_log_select_admin ON public.ingest_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT is_admin() AS is_admin));
CREATE POLICY metas_admin_delete ON public.metas AS PERMISSIVE FOR DELETE TO authenticated USING ((is_admin() OR ( SELECT can('delete:data'::text) AS can)));
CREATE POLICY metas_admin_insert ON public.metas AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:metas'::text) AS can)));
CREATE POLICY metas_admin_update ON public.metas AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_kam_or_admin() OR ( SELECT can('write:metas'::text) AS can))) WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:metas'::text) AS can)));
CREATE POLICY metas_select ON public.metas AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY partner_users_admin_all ON public.partner_users AS PERMISSIVE FOR ALL TO authenticated USING (( SELECT is_admin() AS is_admin)) WITH CHECK (( SELECT is_admin() AS is_admin));
CREATE POLICY partners_admin_delete ON public.partners AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY partners_admin_insert ON public.partners AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY partners_admin_update ON public.partners AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can))) WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:config'::text) AS can)));
CREATE POLICY partners_select ON public.partners AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY proyectos_admin_delete ON public.proyectos AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY proyectos_admin_insert ON public.proyectos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY proyectos_admin_update ON public.proyectos AS PERMISSIVE FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY proyectos_select_internal ON public.proyectos AS PERMISSIVE FOR SELECT TO authenticated USING ((NOT ( SELECT is_partner() AS is_partner)));
CREATE POLICY rendimiento_admin_delete ON public.rendimiento AS PERMISSIVE FOR DELETE TO authenticated USING ((is_admin() OR ( SELECT can('delete:data'::text) AS can)));
CREATE POLICY rendimiento_admin_insert ON public.rendimiento AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can)));
CREATE POLICY rendimiento_admin_update ON public.rendimiento AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can))) WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can)));
CREATE POLICY rendimiento_select ON public.rendimiento AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY rendimiento_diario_admin_delete ON public.rendimiento_diario AS PERMISSIVE FOR DELETE TO authenticated USING ((is_admin() OR ( SELECT can('delete:data'::text) AS can)));
CREATE POLICY rendimiento_diario_admin_insert ON public.rendimiento_diario AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can)));
CREATE POLICY rendimiento_diario_admin_update ON public.rendimiento_diario AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can))) WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can)));
CREATE POLICY rendimiento_diario_select ON public.rendimiento_diario AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY rendimiento_mensual_admin_delete ON public.rendimiento_mensual AS PERMISSIVE FOR DELETE TO authenticated USING ((is_admin() OR ( SELECT can('delete:data'::text) AS can)));
CREATE POLICY rendimiento_mensual_admin_insert ON public.rendimiento_mensual AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can)));
CREATE POLICY rendimiento_mensual_admin_update ON public.rendimiento_mensual AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can))) WITH CHECK ((is_kam_or_admin() OR ( SELECT can('write:performance'::text) AS can)));
CREATE POLICY rendimiento_mensual_select ON public.rendimiento_mensual AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT ( SELECT is_partner() AS is_partner)) OR (clid = ANY (my_clids()))));
CREATE POLICY seguimiento_admin_delete ON public.seguimiento AS PERMISSIVE FOR DELETE TO authenticated USING ((is_admin() OR ( SELECT can('write:seguimiento'::text) AS can)));
CREATE POLICY seguimiento_admin_insert ON public.seguimiento AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_admin() OR ( SELECT can('write:seguimiento'::text) AS can)));
CREATE POLICY seguimiento_admin_update ON public.seguimiento AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_admin() OR ( SELECT can('write:seguimiento'::text) AS can))) WITH CHECK ((is_admin() OR ( SELECT can('write:seguimiento'::text) AS can)));
CREATE POLICY seguimiento_select_internal ON public.seguimiento AS PERMISSIVE FOR SELECT TO authenticated USING ((NOT ( SELECT is_partner() AS is_partner)));
CREATE POLICY user_permissions_admin_delete ON public.user_permissions AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT is_admin() AS is_admin));
CREATE POLICY user_permissions_admin_insert ON public.user_permissions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT is_admin() AS is_admin));
CREATE POLICY user_permissions_admin_update ON public.user_permissions AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT is_admin() AS is_admin));
CREATE POLICY user_permissions_select ON public.user_permissions AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT is_admin() AS is_admin) OR (user_id = ( SELECT auth.uid() AS uid))));

-- ── TRIGGERS ─────────────────────────────────────────────────────────────────
-- El primer argumento es full_columns: 'true' guarda old_data/new_data completos.
-- Las tablas de rendimiento van en 'false' a proposito — con ~48 columnas y miles
-- de filas por carga, guardar el JSON entero inflaria audit_log sin aportar nada.
CREATE TRIGGER audit_conversion_pais AFTER INSERT OR DELETE OR UPDATE ON public.conversion_pais FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'clid', 'mes');
CREATE TRIGGER audit_fleetrooms AFTER INSERT OR DELETE OR UPDATE ON public.fleetrooms FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'db_id');
CREATE TRIGGER fleetrooms_touch BEFORE UPDATE ON public.fleetrooms FOR EACH ROW EXECUTE FUNCTION _fleetrooms_touch();
CREATE TRIGGER audit_flotas AFTER INSERT OR DELETE OR UPDATE ON public.flotas FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'clid');
CREATE TRIGGER flotas_touch_actualizado BEFORE UPDATE ON public.flotas FOR EACH ROW EXECUTE FUNCTION _flotas_touch_actualizado();
CREATE TRIGGER audit_metas AFTER INSERT OR DELETE OR UPDATE ON public.metas FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'clid', 'city', 'mes');
CREATE TRIGGER audit_partner_users AFTER INSERT OR DELETE OR UPDATE ON public.partner_users FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'user_id', 'clid');
CREATE TRIGGER audit_partners AFTER INSERT OR DELETE OR UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'clid');
CREATE TRIGGER audit_proyectos AFTER INSERT OR DELETE OR UPDATE ON public.proyectos FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'id');
CREATE TRIGGER audit_rendimiento AFTER INSERT OR DELETE OR UPDATE ON public.rendimiento FOR EACH ROW EXECUTE FUNCTION audit_trigger('false', 'clid', 'city', 'fecha', 'db_id');
CREATE TRIGGER audit_rendimiento_diario AFTER INSERT OR DELETE OR UPDATE ON public.rendimiento_diario FOR EACH ROW EXECUTE FUNCTION audit_trigger('false', 'clid', 'city', 'date', 'db_id');
CREATE TRIGGER audit_rendimiento_mensual AFTER INSERT OR DELETE OR UPDATE ON public.rendimiento_mensual FOR EACH ROW EXECUTE FUNCTION audit_trigger('false', 'clid', 'city', 'mes', 'db_id');
CREATE TRIGGER audit_seguimiento AFTER INSERT OR DELETE OR UPDATE ON public.seguimiento FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'id');
CREATE TRIGGER audit_user_permissions AFTER INSERT OR DELETE OR UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION audit_trigger('true', 'user_id', 'permission');

-- ── GRANTS (espejo de los defaults de Supabase; RLS sigue mandando) ──────────
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
