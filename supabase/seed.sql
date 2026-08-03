-- ============================================================
-- seed.sql — usuarios de prueba para el Supabase LOCAL
-- ============================================================
-- Corre solo con `supabase start` / `supabase db reset`. NUNCA se aplica a
-- produccion: vive bajo supabase/ y el CLI local es el unico que lo ejecuta.
--
-- El rol se lee del JWT (`app_metadata.role`), igual que en produccion — ver
-- is_admin() / is_kam_or_admin() / is_partner(). Sembrarlo aca reproduce el
-- mismo camino de autorizacion, no un atajo.
--
-- Password de los 4: local-dev-1234
-- ============================================================

-- Los `''` de los *_token NO son decorativos: gotrue escanea esas columnas a
-- string y un NULL revienta el login con "Database error querying schema",
-- que no dice nada sobre la causa real.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_current, email_change_token_new,
  phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id::uuid,
  'authenticated', 'authenticated', u.email,
  crypt('local-dev-1234', gen_salt('bf')),
  now(), now(), now(),
  jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role',u.rol),
  '{}'::jsonb,
  '', '', '', '', '', '', ''
from (values
  ('11111111-1111-1111-1111-111111111111','admin@local.test',  'admin'),
  ('22222222-2222-2222-2222-222222222222','kam@local.test',    'kam'),
  ('33333333-3333-3333-3333-333333333333','viewer@local.test', 'viewer'),
  ('44444444-4444-4444-4444-444444444444','partner@local.test','partner')
) as u(id, email, rol)
on conflict (id) do nothing;

-- Identidad de email: sin esto gotrue rechaza el login con password.
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@local.test'
  and not exists (
    select 1 from auth.identities i
     where i.user_id = u.id and i.provider = 'email'
  );
