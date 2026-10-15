create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  stock_symbol text not null,
  shares integer not null check (shares > 0),
  created_at timestamptz not null default now()
);

create index if not exists portfolios_user_id_created_at_idx
  on public.portfolios (user_id, created_at desc);

alter table public.portfolios enable row level security;

create table if not exists public.products (
  id text primary key,
  user_id text,
  name text not null,
  category text not null default 'Others',
  emoji text not null default '',
  price numeric not null default 0,
  stock integer not null default 0,
  sizes jsonb not null default '[]'::jsonb,
  colors jsonb not null default '[]'::jsonb,
  variants jsonb not null default '[]'::jsonb
);

create table if not exists public.transactions (
  id text primary key,
  user_id text,
  product_id text not null references public.products(id) on delete cascade,
  product_name text not null,
  type text not null check (type in ('Sale', 'Stock In', 'Return')),
  quantity integer not null check (quantity > 0),
  amount numeric not null default 0,
  date timestamptz not null default now()
);

alter table public.products add column if not exists user_id text;
alter table public.transactions add column if not exists user_id text;

create index if not exists transactions_date_idx on public.transactions (date desc);
create index if not exists transactions_product_id_idx on public.transactions (product_id);
create index if not exists products_user_id_idx on public.products (user_id, id);
create index if not exists transactions_user_id_date_idx on public.transactions (user_id, date desc);

create table if not exists public.users (
  id text not null unique,
  email text primary key,
  username text not null,
  name text not null,
  role text not null default 'manager',
  provider text not null default 'email',
  totp_secret text not null default '',
  totp_enabled boolean not null default false
);

create table if not exists public.login_challenges (
  email text primary key,
  code_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  last_sent_at timestamptz not null,
  window_start timestamptz not null,
  requests integer not null default 1
);

create table if not exists public.sessions (
  sid text primary key,
  session jsonb not null,
  expires_at timestamptz not null
);

create index if not exists sessions_expires_at_idx on public.sessions (expires_at);
create index if not exists login_challenges_expires_at_idx on public.login_challenges (expires_at);

create table if not exists public.stockpulse_metadata (
  key text primary key,
  value jsonb not null default '{}'::jsonb
);

alter table public.products enable row level security;
alter table public.transactions enable row level security;
alter table public.users enable row level security;
alter table public.login_challenges enable row level security;
alter table public.sessions enable row level security;
alter table public.stockpulse_metadata enable row level security;

create or replace function public.seed_user_inventory(
  p_user_id text,
  p_is_admin boolean,
  p_products jsonb,
  p_transactions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seed_key text := 'inventory_seed:' || p_user_id;
begin
  perform pg_advisory_xact_lock(hashtext(seed_key));
  if exists (select 1 from public.stockpulse_metadata where key = seed_key) then
    return;
  end if;

  if p_is_admin then
    update public.products set user_id = p_user_id where user_id is null;
    update public.transactions set user_id = p_user_id where user_id is null;
  end if;

  if not exists (select 1 from public.products where user_id = p_user_id) then
    insert into public.products (id, user_id, name, category, emoji, price, stock, sizes, colors, variants)
    select id, p_user_id, name, category, emoji, price, stock, sizes, colors, variants
    from jsonb_to_recordset(p_products) as seed(
      id text, name text, category text, emoji text, price numeric, stock integer,
      sizes jsonb, colors jsonb, variants jsonb
    )
    on conflict (id) do nothing;

    insert into public.transactions (id, user_id, product_id, product_name, type, quantity, amount, date)
    select id, p_user_id, product_id, product_name, type, quantity, amount, date
    from jsonb_to_recordset(p_transactions) as seed(
      id text, product_id text, product_name text, type text, quantity integer, amount numeric, date timestamptz
    )
    on conflict (id) do nothing;
  end if;

  insert into public.stockpulse_metadata (key, value)
  values (seed_key, jsonb_build_object('seededAt', now(), 'isAdmin', p_is_admin))
  on conflict (key) do nothing;
end;
$$;

create or replace function public.request_login_code(p_email text, p_code_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge public.login_challenges%rowtype;
  request_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_email));
  select * into challenge from public.login_challenges where email = lower(p_email) for update;

  if found and p_now - challenge.last_sent_at < interval '1 minute' then
    return jsonb_build_object('limited', true, 'retryAfterSeconds', greatest(1, ceil(extract(epoch from interval '1 minute' - (p_now - challenge.last_sent_at)))::integer));
  end if;

  request_count := case
    when found and p_now - challenge.window_start < interval '1 hour' then challenge.requests
    else 0
  end;
  if request_count >= 5 then
    return jsonb_build_object('limited', true, 'retryAfterSeconds', greatest(1, ceil(extract(epoch from interval '1 hour' - (p_now - challenge.window_start)))::integer));
  end if;

  insert into public.login_challenges (email, code_hash, created_at, expires_at, attempts, last_sent_at, window_start, requests)
  values (
    lower(p_email), p_code_hash, p_now, p_now + interval '10 minutes', 0, p_now,
    case when request_count = 0 then p_now else challenge.window_start end,
    request_count + 1
  )
  on conflict (email) do update set
    code_hash = excluded.code_hash,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at,
    attempts = 0,
    last_sent_at = excluded.last_sent_at,
    window_start = excluded.window_start,
    requests = excluded.requests;

  return jsonb_build_object('limited', false);
end;
$$;

create or replace function public.consume_login_code(p_email text, p_code_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  challenge public.login_challenges%rowtype;
begin
  select * into challenge from public.login_challenges where email = lower(p_email) for update;
  if not found then return jsonb_build_object('valid', false); end if;

  if challenge.expires_at <= p_now or challenge.attempts >= 5 then
    delete from public.login_challenges where email = lower(p_email);
    return jsonb_build_object('valid', false);
  end if;

  if challenge.code_hash <> p_code_hash then
    if challenge.attempts + 1 >= 5 then
      delete from public.login_challenges where email = lower(p_email);
    else
      update public.login_challenges set attempts = attempts + 1 where email = lower(p_email);
    end if;
    return jsonb_build_object('valid', false);
  end if;

  delete from public.login_challenges where email = lower(p_email);
  return jsonb_build_object('valid', true);
end;
$$;

create or replace function public.record_inventory_transaction(p_user_id text, p_record jsonb, p_stock_delta integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_product public.products%rowtype;
  updated_product public.products%rowtype;
begin
  select * into current_product
  from public.products
  where id = p_record->>'productId' and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('error', 'Product not found.', 'status', 404);
  end if;

  if p_record->>'type' = 'Sale' and current_product.stock < (p_record->>'quantity')::integer then
    return jsonb_build_object('error', 'Not enough stock for this sale.', 'status', 400);
  end if;

  update public.products
  set stock = stock + p_stock_delta
  where id = current_product.id and user_id = p_user_id
  returning * into updated_product;

  insert into public.transactions (id, user_id, product_id, product_name, type, quantity, amount, date)
  values (
    p_record->>'id', p_user_id, p_record->>'productId', p_record->>'productName', p_record->>'type',
    (p_record->>'quantity')::integer, (p_record->>'amount')::numeric,
    coalesce((p_record->>'date')::timestamptz, now())
  );

  return jsonb_build_object('transaction', p_record, 'product', to_jsonb(updated_product));
end;
$$;

revoke all on function public.request_login_code(text, text, timestamptz) from public;
revoke all on function public.consume_login_code(text, text, timestamptz) from public;
revoke all on function public.seed_user_inventory(text, boolean, jsonb, jsonb) from public;
revoke all on function public.record_inventory_transaction(text, jsonb, integer) from public;
grant execute on function public.request_login_code(text, text, timestamptz) to service_role;
grant execute on function public.consume_login_code(text, text, timestamptz) to service_role;
grant execute on function public.seed_user_inventory(text, boolean, jsonb, jsonb) to service_role;
grant execute on function public.record_inventory_transaction(text, jsonb, integer) to service_role;


