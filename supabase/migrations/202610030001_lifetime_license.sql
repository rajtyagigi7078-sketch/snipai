create extension if not exists pgcrypto;

create table if not exists public.lifetime_license_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text unique not null,
  key_last4 text not null,
  status text not null default 'issued' check (status in ('issued','active','revoked')),
  user_id uuid references auth.users(id) on delete set null,
  purchaser_email text,
  order_id text unique,
  amount_inr integer not null default 100,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists lifetime_license_user_idx on public.lifetime_license_keys(user_id);
create index if not exists lifetime_license_status_idx on public.lifetime_license_keys(status);

alter table public.lifetime_license_keys enable row level security;

drop policy if exists "lifetime_license_self_read" on public.lifetime_license_keys;
create policy "lifetime_license_self_read"
on public.lifetime_license_keys
for select to authenticated
using (user_id = auth.uid());

create or replace function public.hash_lifetime_license_key(p_license_key text)
returns text
language sql immutable
as $$
  select encode(extensions.digest(upper(trim(p_license_key)), 'sha256'), 'hex');
$$;

create or replace function public.get_lifetime_license_state()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'active', exists(
      select 1 from public.lifetime_license_keys
      where user_id=auth.uid() and status='active'
    ),
    'key_last4', (
      select key_last4 from public.lifetime_license_keys
      where user_id=auth.uid() and status='active'
      order by activated_at desc nulls last limit 1
    )
  );
$$;

create or replace function public.activate_lifetime_license(p_license_key text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_hash text;
  v_key public.lifetime_license_keys%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('active',false,'message','You must be signed in.');
  end if;

  v_hash := public.hash_lifetime_license_key(p_license_key);

  select * into v_key
  from public.lifetime_license_keys
  where key_hash=v_hash
  for update;

  if not found then
    return jsonb_build_object('active',false,'message','Invalid lifetime license key.');
  end if;

  if v_key.status='revoked' then
    return jsonb_build_object('active',false,'message','This license key has been revoked.');
  end if;

  if v_key.user_id is not null and v_key.user_id <> auth.uid() then
    return jsonb_build_object('active',false,'message','This license key is already activated on another account.');
  end if;

  update public.lifetime_license_keys
  set user_id=auth.uid(), status='active', activated_at=coalesce(activated_at,now())
  where id=v_key.id;

  return jsonb_build_object('active',true,'message','Lifetime access activated.','key_last4',v_key.key_last4);
end;
$$;

revoke all on function public.get_lifetime_license_state() from public;
grant execute on function public.get_lifetime_license_state() to authenticated;
revoke all on function public.activate_lifetime_license(text) from public;
grant execute on function public.activate_lifetime_license(text) to authenticated;
