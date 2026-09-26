-- =====================================================================
-- Esquema completo de la plataforma de campañas (Supabase / Postgres)
-- Para duplicar el proyecto: ejecutar este archivo una vez en un proyecto nuevo (SQL Editor).
-- No contiene secretos: el secreto de sincronización se genera aquí mismo al azar
-- y las llaves de Composio / Resend se cargan después desde el panel de Configuración.
-- =====================================================================
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- Tablas
create table if not exists private.config (key text primary key, value text not null);
create table if not exists private.invite_allow (email text primary key, created_at timestamptz not null default now());

create table if not exists public.ga4_utm_daily (
  date date not null, campaign text not null, source text not null, medium text not null,
  term text not null, content text not null, landing_page text not null,
  host text not null default '', users integer not null default 0,
  cotiza_producto integer not null default 0, cotizacion_credito integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (date, campaign, source, medium, term, content, landing_page)
);
create index if not exists ga4_utm_daily_date_idx on public.ga4_utm_daily (date);

create table if not exists public.ga4_sync_log (
  id bigserial primary key, ran_at timestamptz not null default now(),
  date_from date, date_to date, rows_upserted integer, note text
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null, full_name text not null default '',
  role text not null default 'especialista' check (role in ('admin','subgerente','jefe','especialista')),
  canal text check (canal in ('Directos','Redes','Pauta')),
  active boolean not null default true, created_at timestamptz not null default now(), last_seen timestamptz
);

create table if not exists public.utm_links (
  id uuid primary key default gen_random_uuid(),
  url text not null, source text not null, medium text not null, campaign text not null,
  term text not null default '', content text not null default '', note text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  zone text not null default '', created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text not null default '', canal text not null default 'Otros',
  constraint utm_links_len check (length(url) <= 2000 and length(source) <= 200 and length(medium) <= 60 and length(campaign) <= 300
    and length(term) <= 300 and length(content) <= 300 and length(note) <= 1000 and url ~ '^https?://')
);
create index if not exists utm_links_campaign_idx on public.utm_links (campaign);

create table if not exists public.activity_log (
  id bigserial primary key, at timestamptz not null default now(), user_id uuid,
  user_name text not null default '', user_role text not null default '', action text not null,
  entity text not null default '', entity_id text not null default '', summary text not null default '',
  detail jsonb not null default '{}'
);
create index if not exists activity_log_at_idx on public.activity_log (at desc);

create table if not exists public.push_subscriptions (
  endpoint text primary key check (length(endpoint) < 1000 and endpoint like 'https://%'),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null check (length(p256dh) < 200), auth text not null check (length(auth) < 100),
  created_at timestamptz not null default now()
);

-- Configuración editable desde el panel (una sola fila). Cambia los valores por defecto al duplicar
-- o edítalos después en la pantalla Configuración.
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  brand_name text not null default 'Motomundo' check (length(brand_name) between 1 and 60),
  app_name text not null default 'Campañas' check (length(app_name) between 1 and 60),
  app_url text not null default 'https://motomundo-ga4-panel.vercel.app' check (app_url ~ '^https://[^/\s]+$'),
  color_primary text not null default '#d71920' check (color_primary ~ '^#[0-9a-fA-F]{6}$'),
  color_dark text not null default '#0d0e10' check (color_dark ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  favicon_url text check (favicon_url is null or favicon_url ~ '^https://'),
  ga4_property text not null default 'properties/349018417' check (ga4_property ~ '^properties/\d+$'),
  composio_user_id text not null default 'sistema-et-motomundo' check (length(composio_user_id) between 1 and 120),
  mail_from_name text not null default 'Motomundo Campañas' check (length(mail_from_name) between 1 and 80),
  updated_at timestamptz not null default now(), updated_by uuid
);
insert into public.app_settings(id) values (1) on conflict do nothing;

-- Secreto de sincronización (se copia a la variable SYNC_SECRET de Vercel: select value from private.config where key='sync_secret')
insert into private.config values ('sync_secret', encode(gen_random_bytes(32), 'hex')) on conflict do nothing;

-- ---------------------------------------------------------------- Funciones
create or replace function public.my_role() returns text language sql stable security definer set search_path to 'public' as $$
  select role from profiles where id = auth.uid() and active
$$;
create or replace function public.my_name() returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(full_name, ''), email) from profiles where id = auth.uid()
$$;
create or replace function public.get_secret(p_key text) returns text language sql stable security definer set search_path to 'private' as $$
  select value from private.config where key = p_key
$$;
create or replace function public.set_secret(p_key text, p_value text) returns void language plpgsql security definer set search_path to 'private' as $$
begin
  if p_key not in ('composio_api_key','resend_api_key','mail_from') then raise exception 'clave no permitida'; end if;
  if p_value is null or p_value = '' then delete from private.config where key = p_key;
  else insert into private.config(key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value; end if;
end $$;
create or replace function public.set_secret_once(p_key text, p_value text) returns boolean language plpgsql security definer set search_path to 'private' as $$
begin
  if p_key not in ('vapid_public','vapid_private') then raise exception 'clave no permitida'; end if;
  insert into private.config(key, value) values (p_key, p_value) on conflict (key) do nothing;
  return found;
end $$;
create or replace function public.vapid_public() returns text language sql stable security definer set search_path to 'private' as $$
  select value from private.config where key = 'vapid_public' and public.my_role() is not null
$$;

create or replace function public.ga4_sync_upsert(p_secret text, p_from date, p_to date, p_rows jsonb) returns integer
language plpgsql security definer set search_path to 'public', 'private' as $$
declare n integer;
begin
  if p_secret is distinct from (select value from private.config where key = 'sync_secret') then raise exception 'no autorizado'; end if;
  delete from ga4_utm_daily where date between p_from and p_to;
  insert into ga4_utm_daily (date, campaign, source, medium, term, content, landing_page, host, users, cotiza_producto, cotizacion_credito)
  select (r->>'date')::date, r->>'campaign', r->>'source', r->>'medium', r->>'term', r->>'content', r->>'landing_page',
         coalesce(r->>'host', ''), coalesce((r->>'users')::int, 0), coalesce((r->>'cotiza_producto')::int, 0), coalesce((r->>'cotizacion_credito')::int, 0)
  from jsonb_array_elements(p_rows) r
  on conflict (date, campaign, source, medium, term, content, landing_page) do update set
    host = excluded.host, users = excluded.users, cotiza_producto = excluded.cotiza_producto,
    cotizacion_credito = excluded.cotizacion_credito, synced_at = now();
  get diagnostics n = row_count;
  insert into ga4_sync_log (date_from, date_to, rows_upserted) values (p_from, p_to, n);
  return n;
end $$;

create or replace function private.log_internal(p_action text, p_entity text, p_entity_id text, p_summary text, p_detail jsonb) returns void
language sql security definer set search_path to 'public' as $$
  insert into activity_log (user_id, user_name, user_role, action, entity, entity_id, summary, detail)
  values (auth.uid(), coalesce(public.my_name(), 'Sistema'), coalesce(public.my_role(), ''), p_action, p_entity, p_entity_id, p_summary, p_detail)
$$;
create or replace function public.log_activity(p_action text, p_entity text default '', p_entity_id text default '', p_summary text default '', p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or public.my_role() is null then raise exception 'no autorizado'; end if;
  if p_action not in ('auth.ingreso','auth.salida','auth.contrasena_creada','auth.contrasena_cambiada') then raise exception 'acción no permitida'; end if;
  insert into activity_log (user_id, user_name, user_role, action, entity, entity_id, summary, detail)
  values (auth.uid(), public.my_name(), public.my_role(), p_action, 'auth', '', left(p_summary, 200), '{}');
  update profiles set last_seen = now() where id = auth.uid();
end $$;

create or replace function public.utm_links_stamp() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_by_name := coalesce(public.my_name(), ''); new.created_at := now();
  else new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
create or replace function public.utm_links_log() returns trigger language plpgsql security definer set search_path to 'public', 'private' as $$
declare r utm_links;
begin
  r := coalesce(new, old);
  perform private.log_internal(
    case tg_op when 'INSERT' then 'utm.crear' when 'UPDATE' then 'utm.editar' else 'utm.eliminar' end,
    'utm', r.id::text, r.campaign,
    jsonb_build_object('source', r.source, 'medium', r.medium, 'campaign', r.campaign, 'term', r.term, 'zone', r.zone, 'canal', r.canal, 'url', r.url));
  return null;
end $$;

-- Registro público bloqueado: solo se crean cuentas invitadas por el admin (función admin-users)
create or replace function private.block_public_signup() returns trigger language plpgsql security definer set search_path to 'private', 'public' as $$
begin
  if not exists (select 1 from private.invite_allow where email = lower(new.email) and created_at > now() - interval '10 minutes') then
    raise exception 'Registro deshabilitado: solicita una invitación al administrador';
  end if;
  delete from private.invite_allow where email = lower(new.email);
  return new;
end $$;
create or replace function public.allow_invite(p_email text) returns void language sql security definer set search_path to 'private' as $$
  insert into private.invite_allow (email) values (lower(p_email)) on conflict (email) do update set created_at = now()
$$;

create or replace function public.branding() returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object('brand_name',brand_name,'app_name',app_name,'color_primary',color_primary,'color_dark',color_dark,'logo_url',logo_url,'favicon_url',favicon_url) from public.app_settings where id = 1
$$;
create or replace function public.system_health() returns json language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'solo admin'; end if;
  return json_build_object(
    'now', now(),
    'last_sync', (select max(ran_at) from ga4_sync_log),
    'last_sync_rows', (select coalesce(sum(rows_upserted),0) from ga4_sync_log where ran_at > (select max(ran_at) from ga4_sync_log) - interval '10 minutes'),
    'max_date', (select max(date) from ga4_utm_daily),
    'purge_last', (select json_build_object('status',d.status,'at',d.start_time) from cron.job_run_details d join cron.job j using (jobid) where j.jobname='purge_activity_log' order by d.start_time desc limit 1),
    'secrets', (select json_object_agg(key, true) from private.config where key in ('resend_api_key','composio_api_key','vapid_public')),
    'push_devices', (select count(*) from push_subscriptions),
    'users_active', (select count(*) from profiles where active)
  );
end $$;

-- ---------------------------------------------------------------- Permisos de funciones
revoke all on function public.get_secret(text), public.set_secret(text,text), public.set_secret_once(text,text),
  public.ga4_sync_upsert(text,date,date,jsonb), public.allow_invite(text), public.utm_links_stamp(), public.utm_links_log(),
  private.log_internal(text,text,text,text,jsonb), private.block_public_signup() from public, anon, authenticated;
grant execute on function public.get_secret(text), public.set_secret(text,text), public.set_secret_once(text,text),
  public.ga4_sync_upsert(text,date,date,jsonb), public.allow_invite(text) to service_role;
revoke all on function public.my_role(), public.my_name(), public.log_activity(text,text,text,text,jsonb), public.vapid_public(), public.system_health() from public, anon;
grant execute on function public.my_role(), public.my_name(), public.log_activity(text,text,text,text,jsonb), public.vapid_public(), public.system_health() to authenticated;
revoke all on function public.branding() from public;
grant execute on function public.branding() to anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.block_public_signup() to supabase_auth_admin;

-- ---------------------------------------------------------------- Triggers
drop trigger if exists utm_links_stamp on public.utm_links;
create trigger utm_links_stamp before insert or update on public.utm_links for each row execute function public.utm_links_stamp();
drop trigger if exists utm_links_log on public.utm_links;
create trigger utm_links_log after insert or delete or update on public.utm_links for each row execute function public.utm_links_log();
drop trigger if exists block_public_signup on auth.users;
create trigger block_public_signup before insert on auth.users for each row execute function private.block_public_signup();

-- ---------------------------------------------------------------- Seguridad por filas (RLS)
alter table public.ga4_utm_daily enable row level security;
alter table public.ga4_sync_log enable row level security;
alter table public.profiles enable row level security;
alter table public.utm_links enable row level security;
alter table public.activity_log enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.app_settings enable row level security;

create policy "usuarios activos" on public.ga4_utm_daily for select to authenticated using (my_role() is not null);
create policy "usuarios activos" on public.ga4_sync_log for select to authenticated using (my_role() is not null);
create policy "ver perfiles" on public.profiles for select to authenticated using (id = auth.uid() or my_role() = 'admin');
create policy "solo admin" on public.activity_log for select to authenticated using (my_role() = 'admin');
create policy "ver utms" on public.utm_links for select to authenticated using (my_role() is not null);
create policy "crear utms" on public.utm_links for insert to authenticated
  with check (my_role() in ('admin','jefe','especialista') and created_by = auth.uid());
create policy "editar utms" on public.utm_links for update to authenticated
  using (my_role() = 'admin' or created_by = auth.uid() or (my_role() = 'jefe' and canal = (select p.canal from profiles p where p.id = auth.uid())))
  with check (my_role() in ('admin','jefe','especialista') and (my_role() = 'admin' or created_by = auth.uid()
    or (my_role() = 'jefe' and canal = (select p.canal from profiles p where p.id = auth.uid()))));
create policy "eliminar utms" on public.utm_links for delete to authenticated
  using (my_role() = 'admin' or created_by = auth.uid() or (my_role() = 'jefe' and canal = (select p.canal from profiles p where p.id = auth.uid())));
create policy push_own_sel on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_ins on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid() and my_role() is not null);
create policy push_own_upd on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own_del on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
create policy settings_admin_sel on public.app_settings for select to authenticated using (my_role() = 'admin');
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
revoke all on public.push_subscriptions from anon;

-- ---------------------------------------------------------------- Tiempo real
alter publication supabase_realtime add table public.utm_links, public.activity_log, public.ga4_sync_log;

-- ---------------------------------------------------------------- Archivos de marca (logo, favicon)
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 1048576, array['image/png','image/jpeg','image/webp','image/x-icon']) on conflict (id) do nothing;
create policy brand_admin_ins on storage.objects for insert to authenticated with check (bucket_id = 'brand' and public.my_role() = 'admin');
create policy brand_admin_upd on storage.objects for update to authenticated using (bucket_id = 'brand' and public.my_role() = 'admin');
create policy brand_admin_del on storage.objects for delete to authenticated using (bucket_id = 'brand' and public.my_role() = 'admin');

-- ---------------------------------------------------------------- Bitácora temporal (7 días)
select cron.schedule('purge_activity_log', '15 6 * * *', $$delete from public.activity_log where at < now() - interval '7 days'$$);

-- ---------------------------------------------------------------- Mapa de canales (agrupación editable desde el reporte)
alter table public.app_settings add column if not exists channel_map jsonb not null default '{}'::jsonb
  check (jsonb_typeof(channel_map) = 'object' and length(channel_map::text) < 20000);
create or replace function public.channel_map() returns jsonb language sql stable security definer set search_path = public as $$
  select channel_map from public.app_settings where id = 1 and public.my_role() is not null
$$;
revoke all on function public.channel_map() from public, anon;
grant execute on function public.channel_map() to authenticated;
