-- =====================================================================
--  RestoPOS · Esquema completo desde cero (Supabase / PostgreSQL 15+)
--  POS + Cocina (KDS) + Seguimiento + Menú QR por mesa
--
--  CÓMO EJECUTARLO
--   · Supabase Cloud (Free): Dashboard → SQL Editor → pegar todo → Run.
--   · Supabase local (CLI):  este archivo ya está en supabase/migrations,
--                            `npx supabase db reset` lo aplica solo.
--   · Pensado para un proyecto NUEVO (vacío). Para reiniciar en desarrollo
--     usa supabase/reset.sql y vuelve a ejecutar este script.
--
--  PRINCIPIOS DE DISEÑO
--   1. Datos de configuración (carta, mesas, ajustes) → CRUD directo con RLS.
--   2. Datos transaccionales (pedidos, ítems, pagos)  → SOLO por funciones
--      RPC (SECURITY DEFINER). El cliente NUNCA inserta/actualiza ahí:
--      los precios se calculan en el servidor y no se pueden manipular.
--   3. Clientes anónimos (QR) solo pueden: leer la carta pública y llamar
--      a 3 funciones (get_table_by_token, create_qr_order, get_table_orders).
--   4. Todo es PostgreSQL estándar: se puede migrar a otro plan de Supabase,
--      a Supabase local o a cualquier PostgreSQL sin cambiar el esquema.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Esquemas y tipos
-- ---------------------------------------------------------------------
create schema if not exists private;                 -- helpers no expuestos por la API REST
grant usage on schema public  to anon, authenticated, service_role;
grant usage on schema private to anon, authenticated, service_role;

create type public.order_status   as enum ('pending', 'preparing', 'ready', 'delivered', 'cancelled');
create type public.order_channel  as enum ('internal', 'qr');
create type public.payment_status as enum ('unpaid', 'paid');
create type public.payment_method as enum ('cash', 'card', 'wallet', 'transfer', 'other');  -- wallet = Yape/Plin/etc.
create type public.discount_type  as enum ('percent', 'amount');

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

-- 1.1 roles ------------------------------------------------------------
create table public.roles (
  id           smallint generated always as identity primary key,
  name         text        not null unique check (name ~ '^[a-z_]+$'),
  label        text        not null,
  permissions  text[]      not null default '{}',   -- '*' = todos los permisos
  is_system    boolean     not null default false,
  created_at   timestamptz not null default now()
);
comment on table public.roles is 'Roles del personal. permissions = lista de permisos; ''*'' concede todos.';

-- 1.2 users (perfil enlazado a Supabase Auth) ---------------------------
create table public.users (
  id          uuid        primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text        not null default '',
  role_id     smallint    references public.roles (id) on delete restrict,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index users_role_id_idx on public.users (role_id);
comment on table public.users is 'Perfil del personal. La contraseña vive en auth.users (Supabase Auth).';

-- 1.3 restaurant_settings (una sola fila) -------------------------------
create table public.restaurant_settings (
  id                        smallint     primary key default 1 check (id = 1),
  name                      text         not null default 'Mi Restaurante',
  currency_symbol           text         not null default 'S/',
  tax_rate                  numeric(5,4) not null default 0.18 check (tax_rate >= 0 and tax_rate < 1),
  prices_include_tax        boolean      not null default true,
  timezone                  text         not null default 'America/Lima',
  qr_ordering_enabled       boolean      not null default true,
  qr_max_pending_per_table  smallint     not null default 3 check (qr_max_pending_per_table between 1 and 20),
  public_base_url           text,        -- URL base para los QR (nube o IP local), sin "/" final
  receipt_footer            text,
  updated_at                timestamptz  not null default now()
);

-- 1.4 tables (mesas) -----------------------------------------------------
create table public.tables (
  id          uuid        primary key default gen_random_uuid(),
  number      integer     not null unique check (number > 0),
  name        text,
  capacity    smallint    not null default 4 check (capacity > 0),
  qr_token    text        not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on column public.tables.qr_token is 'Token aleatorio e impredecible que va dentro del QR (no se usa el número de mesa).';

-- 1.5 categories ---------------------------------------------------------
create table public.categories (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (btrim(name) <> ''),
  description text,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index categories_name_uq on public.categories (lower(name));

-- 1.6 products -----------------------------------------------------------
create table public.products (
  id           uuid          primary key default gen_random_uuid(),
  category_id  uuid          not null references public.categories (id) on delete restrict,
  name         text          not null check (btrim(name) <> ''),
  description  text,
  ingredients  text,
  price        numeric(10,2) not null check (price >= 0),
  image_path   text,                         -- ruta en Storage (bucket product-images) o URL externa
  is_available boolean       not null default true,   -- false = "agotado"
  is_active    boolean       not null default true,   -- false = retirado de la carta (borrado lógico)
  sort_order   integer       not null default 0,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);
create index products_category_id_idx on public.products (category_id);
create unique index products_category_name_uq on public.products (category_id, lower(name));

-- 1.7 promotions (extra: la carta debe permitir "administrar promociones") -
create table public.promotions (
  id             uuid                primary key default gen_random_uuid(),
  name           text                not null check (btrim(name) <> ''),
  description    text,
  discount_type  public.discount_type not null,
  discount_value numeric(10,2)       not null check (discount_value > 0),
  product_id     uuid                references public.products (id)   on delete cascade,
  category_id    uuid                references public.categories (id) on delete cascade,
  starts_at      timestamptz,
  ends_at        timestamptz,
  is_active      boolean             not null default true,
  created_at     timestamptz         not null default now(),
  updated_at     timestamptz         not null default now(),
  -- una promoción apunta a un producto, a una categoría o (ambos nulos) a toda la carta
  constraint promotions_single_target check (product_id is null or category_id is null),
  constraint promotions_percent_max   check (discount_type <> 'percent' or discount_value <= 100),
  constraint promotions_dates         check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index promotions_product_id_idx  on public.promotions (product_id);
create index promotions_category_id_idx on public.promotions (category_id);

-- 1.8 orders ---------------------------------------------------------------
create table public.orders (
  id                uuid                 primary key default gen_random_uuid(),
  order_number      integer              not null,
  business_date     date                 not null,
  table_id          uuid                 not null references public.tables (id) on delete restrict,
  channel           public.order_channel not null,
  status            public.order_status  not null default 'pending',
  payment_status    public.payment_status not null default 'unpaid',
  customer_note     text                 check (char_length(customer_note) <= 300),
  subtotal          numeric(12,2)        not null default 0 check (subtotal >= 0),   -- suma a precio de lista
  discount_total    numeric(12,2)        not null default 0 check (discount_total >= 0),
  tax_amount        numeric(12,2)        not null default 0 check (tax_amount >= 0),
  total             numeric(12,2)        not null default 0 check (total >= 0),
  client_request_id uuid                 unique,      -- clave de idempotencia (anti-duplicados)
  created_by        uuid                 references public.users (id) on delete set null,  -- null = QR
  cancelled_by      uuid                 references public.users (id) on delete set null,
  cancelled_reason  text,
  created_at        timestamptz          not null default now(),
  preparing_at      timestamptz,
  ready_at          timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,
  paid_at           timestamptz,
  updated_at        timestamptz          not null default now(),
  constraint orders_number_per_day unique (business_date, order_number)
);
create index orders_table_id_idx        on public.orders (table_id, created_at desc);
create index orders_created_at_idx      on public.orders (created_at desc);
create index orders_business_date_idx   on public.orders (business_date);
create index orders_active_idx          on public.orders (created_at) where status in ('pending', 'preparing', 'ready');
create index orders_unpaid_idx          on public.orders (table_id)   where payment_status = 'unpaid' and status <> 'cancelled';
create index orders_created_by_idx      on public.orders (created_by);

-- 1.9 order_items ----------------------------------------------------------
create table public.order_items (
  id            uuid          primary key default gen_random_uuid(),
  order_id      uuid          not null references public.orders (id) on delete cascade,
  product_id    uuid          not null references public.products (id) on delete restrict,
  line_no       smallint      not null default 0,
  product_name  text          not null,                        -- copia histórica
  list_price    numeric(10,2) not null check (list_price >= 0), -- precio de lista al pedir
  unit_price    numeric(10,2) not null check (unit_price >= 0), -- precio final (con promoción)
  quantity      smallint      not null check (quantity between 1 and 99),
  notes         text          check (char_length(notes) <= 200),
  line_total    numeric(12,2) generated always as (unit_price * quantity) stored,
  created_at    timestamptz   not null default now()
);
create index order_items_order_id_idx   on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

-- 1.10 payments ------------------------------------------------------------
create table public.payments (
  id           uuid                  primary key default gen_random_uuid(),
  order_id     uuid                  not null references public.orders (id) on delete restrict,
  group_id     uuid                  not null default gen_random_uuid(),  -- pagos hechos juntos (cierre de mesa)
  method       public.payment_method not null,
  amount       numeric(12,2)         not null check (amount >= 0),
  reference    text,
  received_by  uuid                  references public.users (id) on delete set null,
  paid_at      timestamptz           not null default now()
);
create index payments_order_id_idx    on public.payments (order_id);
create index payments_group_id_idx    on public.payments (group_id);
create index payments_paid_at_idx     on public.payments (paid_at);
create index payments_received_by_idx on public.payments (received_by);

-- ---------------------------------------------------------------------
-- 2. Datos base (roles y ajustes)
-- ---------------------------------------------------------------------
-- Catálogo de permisos:
--   orders.view      ver pedidos              orders.create   registrar pedidos
--   orders.edit      modificar pedidos        orders.cancel   cancelar pedidos
--   orders.kitchen   pasar a preparando/listo orders.serve    marcar entregado
--   payments.register cobrar y cerrar cuentas menu.manage     carta y promociones
--   tables.manage    mesas y QR               reports.view    reportes
--   users.manage     personal y roles         settings.manage ajustes del local
insert into public.roles (name, label, permissions, is_system) values
  ('admin',   'Administrador', array['*'], true),
  ('cashier', 'Caja',          array['orders.view','orders.create','orders.edit','orders.cancel','orders.serve','payments.register','reports.view'], true),
  ('waiter',  'Mozo',          array['orders.view','orders.create','orders.edit','orders.serve'], true),
  ('kitchen', 'Cocina',        array['orders.view','orders.kitchen'], true);

insert into public.restaurant_settings (id) values (1);

-- ---------------------------------------------------------------------
-- 3. Funciones auxiliares (esquema private: no accesibles como RPC)
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_users_updated      before update on public.users                for each row execute function private.set_updated_at();
create trigger trg_settings_updated   before update on public.restaurant_settings  for each row execute function private.set_updated_at();
create trigger trg_tables_updated     before update on public.tables               for each row execute function private.set_updated_at();
create trigger trg_categories_updated before update on public.categories           for each row execute function private.set_updated_at();
create trigger trg_products_updated   before update on public.products             for each row execute function private.set_updated_at();
create trigger trg_promotions_updated before update on public.promotions           for each row execute function private.set_updated_at();
create trigger trg_orders_updated     before update on public.orders               for each row execute function private.set_updated_at();

-- ¿El usuario actual tiene este permiso? (activo + rol + permiso o '*')
create or replace function private.has_perm(p_perm text)
returns boolean language sql stable security definer set search_path = public, private, pg_temp as $$
  select exists (
    select 1
    from public.users u
    join public.roles r on r.id = u.role_id
    where u.id = auth.uid()
      and u.is_active
      and ('*' = any (r.permissions) or p_perm = any (r.permissions))
  );
$$;

-- ¿El usuario actual es personal activo con rol?
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = public, private, pg_temp as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active and u.role_id is not null
  );
$$;

-- Perfil nuevo en Auth → fila en public.users. El PRIMER usuario del sistema
-- (si aún no hay un admin activo) queda como administrador.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_role smallint;
begin
  if not exists (
    select 1 from public.users u join public.roles r on r.id = u.role_id
    where r.name = 'admin' and u.is_active
  ) then
    select id into v_role from public.roles where name = 'admin';
  end if;

  insert into public.users (id, email, full_name, role_id, is_active)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), v_role, true)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Fecha de negocio y numeración diaria de pedidos (reinicia cada día, sin huecos por concurrencia)
create or replace function private.orders_before_insert()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_tz text;
begin
  select timezone into v_tz from public.restaurant_settings where id = 1;
  new.business_date := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  perform pg_advisory_xact_lock(hashtext('orders_number:' || new.business_date::text));
  select coalesce(max(order_number), 0) + 1 into new.order_number
  from public.orders where business_date = new.business_date;
  return new;
end $$;

create trigger trg_orders_before_insert
  before insert on public.orders
  for each row execute function private.orders_before_insert();

-- Marcas de tiempo por estado
create or replace function private.orders_status_stamps()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.preparing_at := case when new.status = 'preparing' then now()
                             when new.status = 'pending'   then null
                             else new.preparing_at end;
    new.ready_at     := case when new.status = 'ready' then now()
                             when new.status in ('pending', 'preparing') then null
                             else new.ready_at end;
    new.delivered_at := case when new.status = 'delivered' then now() else null end;
    new.cancelled_at := case when new.status = 'cancelled' then coalesce(new.cancelled_at, now()) else null end;
  end if;
  return new;
end $$;

create trigger trg_orders_status_stamps
  before update on public.orders
  for each row execute function private.orders_status_stamps();

-- Mejor precio con promoción vigente (producto, categoría o toda la carta)
create or replace function private.price_with_promotion(p_price numeric, p_product_id uuid, p_category_id uuid)
returns numeric language sql stable security definer set search_path = public, private, pg_temp as $$
  select greatest(0, least(p_price, round(coalesce(min(
           case pr.discount_type
             when 'percent' then p_price * (1 - pr.discount_value / 100)
             else p_price - pr.discount_value
           end), p_price), 2)))
  from public.promotions pr
  where pr.is_active
    and (pr.starts_at is null or pr.starts_at <= now())
    and (pr.ends_at   is null or pr.ends_at   >  now())
    and (pr.product_id = p_product_id
         or pr.category_id = p_category_id
         or (pr.product_id is null and pr.category_id is null));
$$;

-- Valida y valora las líneas de un pedido. El cliente solo manda
-- {product_id, quantity, notes}: precios y nombres salen SIEMPRE de la BD.
create or replace function private.price_items(p_items jsonb)
returns table (line_no integer, product_id uuid, product_name text, list_price numeric,
               unit_price numeric, quantity integer, notes text)
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_bad text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'INVALID_ITEMS';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(e ->> 'quantity', '')   !~  '^[0-9]{1,2}$'
       or case when coalesce(e ->> 'quantity', '') ~ '^[0-9]{1,2}$' then (e ->> 'quantity')::int else 0 end < 1
  ) then
    raise exception 'INVALID_ITEMS';
  end if;

  select string_agg(distinct coalesce(p.name, 'producto desconocido'), ', ')
    into v_bad
  from jsonb_array_elements(p_items) e
  left join public.products   p on p.id = (e ->> 'product_id')::uuid
  left join public.categories c on c.id = p.category_id
  where p.id is null or not p.is_active or not p.is_available or c.is_active is not true;

  if v_bad is not null then
    raise exception 'PRODUCT_UNAVAILABLE' using detail = v_bad;
  end if;

  return query
  select t.ord::int,
         p.id,
         p.name,
         p.price,
         private.price_with_promotion(p.price, p.id, p.category_id),
         (t.e ->> 'quantity')::int,
         nullif(left(btrim(coalesce(t.e ->> 'notes', '')), 200), '')
  from jsonb_array_elements(p_items) with ordinality as t(e, ord)
  join public.products p on p.id = (t.e ->> 'product_id')::uuid
  order by t.ord;
end $$;

-- Núcleo de creación de pedidos (lo usan el flujo interno y el QR)
create or replace function private.create_order_core(
  p_table_id uuid, p_channel public.order_channel, p_items jsonb,
  p_note text, p_request_id uuid, p_user uuid)
returns public.orders
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_order public.orders;
  v_s     public.restaurant_settings;
  v_lines jsonb;
  v_list  numeric;
  v_final numeric;
  v_tax   numeric;
  v_total numeric;
begin
  -- Idempotencia: la misma clave devuelve el pedido ya creado
  if p_request_id is not null then
    select * into v_order from public.orders where client_request_id = p_request_id;
    if found then
      if v_order.table_id <> p_table_id then raise exception 'REQUEST_ID_CONFLICT'; end if;
      return v_order;
    end if;
  end if;

  select * into v_s from public.restaurant_settings where id = 1;

  select jsonb_agg(to_jsonb(l)) into v_lines from private.price_items(p_items) l;

  select coalesce(sum(x.list_price * x.quantity), 0), coalesce(sum(x.unit_price * x.quantity), 0)
    into v_list, v_final
  from jsonb_to_recordset(v_lines) as x(line_no int, product_id uuid, product_name text,
                                        list_price numeric, unit_price numeric, quantity int, notes text);

  if v_s.prices_include_tax then
    v_tax := round(v_final - v_final / (1 + v_s.tax_rate), 2);
    v_total := v_final;
  else
    v_tax := round(v_final * v_s.tax_rate, 2);
    v_total := v_final + v_tax;
  end if;

  begin
    insert into public.orders (table_id, channel, customer_note, subtotal, discount_total,
                               tax_amount, total, client_request_id, created_by)
    values (p_table_id, p_channel, nullif(btrim(p_note), ''), v_list, v_list - v_final,
            v_tax, v_total, p_request_id, p_user)
    returning * into v_order;
  exception when unique_violation then
    -- carrera: dos envíos simultáneos con la misma clave
    select * into v_order from public.orders where client_request_id = p_request_id;
    if not found then raise; end if;
    return v_order;
  end;

  insert into public.order_items (order_id, product_id, line_no, product_name, list_price, unit_price, quantity, notes)
  select v_order.id, x.product_id, x.line_no, x.product_name, x.list_price, x.unit_price, x.quantity, x.notes
  from jsonb_to_recordset(v_lines) as x(line_no int, product_id uuid, product_name text,
                                        list_price numeric, unit_price numeric, quantity int, notes text);

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- 4. Vista pública de la carta (precio final con promociones)
-- ---------------------------------------------------------------------
create or replace view public.menu_products with (security_invoker = true) as
select p.id, p.category_id, p.name, p.description, p.ingredients, p.price,
       private.price_with_promotion(p.price, p.id, p.category_id) as final_price,
       p.image_path, p.is_available, p.sort_order
from public.products p
join public.categories c on c.id = p.category_id
where p.is_active and c.is_active;

-- ---------------------------------------------------------------------
-- 5. RPC públicas para el menú QR (clientes anónimos)
-- ---------------------------------------------------------------------
create or replace function public.get_table_by_token(p_token text)
returns json language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare
  v_t public.tables;
  v_s public.restaurant_settings;
begin
  select * into v_t from public.tables where qr_token = p_token and is_active;
  if not found then raise exception 'INVALID_TABLE'; end if;
  select * into v_s from public.restaurant_settings where id = 1;
  return json_build_object(
    'number', v_t.number, 'name', v_t.name,
    'restaurant', v_s.name, 'currency', v_s.currency_symbol,
    'qr_enabled', v_s.qr_ordering_enabled);
end $$;

create or replace function public.create_qr_order(
  p_token text, p_items jsonb, p_request_id uuid, p_note text default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_t       public.tables;
  v_s       public.restaurant_settings;
  v_order   public.orders;
  v_pending int;
begin
  if p_request_id is null then raise exception 'INVALID_REQUEST'; end if;

  select * into v_t from public.tables where qr_token = p_token and is_active;
  if not found then raise exception 'INVALID_TABLE'; end if;

  select * into v_s from public.restaurant_settings where id = 1;
  if not v_s.qr_ordering_enabled then raise exception 'QR_DISABLED'; end if;

  -- reintento del mismo envío → mismo pedido (sin duplicar)
  select * into v_order from public.orders where client_request_id = p_request_id;
  if found then
    if v_order.table_id <> v_t.id then raise exception 'REQUEST_ID_CONFLICT'; end if;
    return json_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                             'status', v_order.status, 'total', v_order.total, 'duplicate', true);
  end if;

  -- freno anti-spam: pedidos QR aún sin atender en esta mesa
  select count(*) into v_pending from public.orders
  where table_id = v_t.id and channel = 'qr' and status = 'pending';
  if v_pending >= v_s.qr_max_pending_per_table then raise exception 'TOO_MANY_PENDING'; end if;

  v_order := private.create_order_core(v_t.id, 'qr', p_items, left(btrim(p_note), 300), p_request_id, null);
  return json_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                           'status', v_order.status, 'total', v_order.total, 'duplicate', false);
end $$;

-- Pedidos "vivos" de la mesa (sin pagar, últimas 8 h) para que el cliente vea el estado
create or replace function public.get_table_orders(p_token text)
returns json language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare
  v_t public.tables;
begin
  select * into v_t from public.tables where qr_token = p_token and is_active;
  if not found then raise exception 'INVALID_TABLE'; end if;

  return (
    select coalesce(json_agg(o order by o.created_at), '[]'::json)
    from (
      select ord.id, ord.order_number, ord.status, ord.total, ord.created_at, ord.channel,
             (select coalesce(json_agg(json_build_object('name', oi.product_name, 'quantity', oi.quantity,
                                                          'notes', oi.notes) order by oi.line_no), '[]'::json)
                from public.order_items oi where oi.order_id = ord.id) as items
      from public.orders ord
      where ord.table_id = v_t.id
        and ord.payment_status = 'unpaid'
        and ord.created_at > now() - interval '8 hours'
    ) o
  );
end $$;

-- ---------------------------------------------------------------------
-- 6. RPC del personal (usuarios autenticados con permisos)
-- ---------------------------------------------------------------------
create or replace function public.get_my_profile()
returns json language sql stable security definer set search_path = public, private, pg_temp as $$
  select json_build_object(
    'id', u.id, 'email', u.email, 'full_name', u.full_name, 'is_active', u.is_active,
    'role', r.name, 'role_label', r.label, 'permissions', coalesce(r.permissions, '{}'))
  from public.users u left join public.roles r on r.id = u.role_id
  where u.id = auth.uid();
$$;

create or replace function public.create_staff_order(
  p_table_id uuid, p_items jsonb, p_note text default null, p_request_id uuid default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_order public.orders;
begin
  if not private.has_perm('orders.create') then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.tables where id = p_table_id and is_active) then
    raise exception 'INVALID_TABLE';
  end if;
  v_order := private.create_order_core(p_table_id, 'internal', p_items, left(btrim(p_note), 300), p_request_id, auth.uid());
  return json_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                           'status', v_order.status, 'total', v_order.total);
end $$;

-- Modificar un pedido: solo mientras esté "pendiente" (cocina aún no lo toca) y sin pagar
create or replace function public.replace_order_items(p_order_id uuid, p_items jsonb, p_note text default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_o     public.orders;
  v_s     public.restaurant_settings;
  v_lines jsonb;
  v_list  numeric;
  v_final numeric;
  v_tax   numeric;
  v_total numeric;
begin
  if not private.has_perm('orders.edit') then raise exception 'FORBIDDEN'; end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.status <> 'pending' or v_o.payment_status <> 'unpaid' then raise exception 'ORDER_NOT_EDITABLE'; end if;

  select * into v_s from public.restaurant_settings where id = 1;
  select jsonb_agg(to_jsonb(l)) into v_lines from private.price_items(p_items) l;

  select coalesce(sum(x.list_price * x.quantity), 0), coalesce(sum(x.unit_price * x.quantity), 0)
    into v_list, v_final
  from jsonb_to_recordset(v_lines) as x(line_no int, product_id uuid, product_name text,
                                        list_price numeric, unit_price numeric, quantity int, notes text);

  if v_s.prices_include_tax then
    v_tax := round(v_final - v_final / (1 + v_s.tax_rate), 2); v_total := v_final;
  else
    v_tax := round(v_final * v_s.tax_rate, 2); v_total := v_final + v_tax;
  end if;

  delete from public.order_items where order_id = v_o.id;
  insert into public.order_items (order_id, product_id, line_no, product_name, list_price, unit_price, quantity, notes)
  select v_o.id, x.product_id, x.line_no, x.product_name, x.list_price, x.unit_price, x.quantity, x.notes
  from jsonb_to_recordset(v_lines) as x(line_no int, product_id uuid, product_name text,
                                        list_price numeric, unit_price numeric, quantity int, notes text);

  update public.orders
     set subtotal = v_list, discount_total = v_list - v_final, tax_amount = v_tax, total = v_total,
         customer_note = nullif(btrim(coalesce(left(p_note, 300), v_o.customer_note)), '')
   where id = v_o.id;

  return json_build_object('order_id', v_o.id, 'order_number', v_o.order_number, 'total', v_total);
end $$;

-- Cambio de estado con matriz de transiciones y permisos
create or replace function public.set_order_status(p_order_id uuid, p_status public.order_status)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_o    public.orders;
  v_perm text;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_o.status = p_status then   -- doble toque: no hace nada
    return json_build_object('order_id', v_o.id, 'status', v_o.status);
  end if;

  v_perm := case
    when v_o.status = 'pending'   and p_status = 'preparing'             then 'orders.kitchen'
    when v_o.status = 'preparing' and p_status in ('ready', 'pending')   then 'orders.kitchen'
    when v_o.status = 'ready'     and p_status = 'preparing'             then 'orders.kitchen'
    when v_o.status = 'ready'     and p_status = 'delivered'             then 'orders.serve'
    when v_o.status = 'delivered' and p_status = 'ready'                 then 'orders.serve'
    else null end;

  if v_perm is null then raise exception 'INVALID_TRANSITION'; end if;
  if not private.has_perm(v_perm) then raise exception 'FORBIDDEN'; end if;

  update public.orders set status = p_status where id = v_o.id;
  return json_build_object('order_id', v_o.id, 'status', p_status);
end $$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_o public.orders;
begin
  if not private.has_perm('orders.cancel') then raise exception 'FORBIDDEN'; end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.status in ('delivered', 'cancelled') or v_o.payment_status = 'paid' then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.orders
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancelled_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), '')
   where id = v_o.id;
  return json_build_object('order_id', v_o.id, 'status', 'cancelled');
end $$;

-- Cobro: paga uno o varios pedidos (cierre de cuenta de una mesa) en una transacción
create or replace function public.register_payment(
  p_order_ids uuid[], p_method public.payment_method, p_reference text default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_ids   uuid[];
  v_found int;
  v_group uuid := gen_random_uuid();
  v_total numeric;
begin
  if not private.has_perm('payments.register') then raise exception 'FORBIDDEN'; end if;
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 50 then raise exception 'INVALID_REQUEST'; end if;

  select array_agg(distinct x) into v_ids from unnest(p_order_ids) x;

  perform 1 from public.orders where id = any (v_ids) order by id for update;
  select count(*) into v_found from public.orders where id = any (v_ids);
  if v_found <> cardinality(v_ids) then raise exception 'ORDER_NOT_FOUND'; end if;
  if exists (select 1 from public.orders where id = any (v_ids) and status = 'cancelled') then raise exception 'ORDER_CANCELLED'; end if;
  if exists (select 1 from public.orders where id = any (v_ids) and payment_status = 'paid') then raise exception 'ALREADY_PAID'; end if;

  insert into public.payments (order_id, group_id, method, amount, reference, received_by)
  select o.id, v_group, p_method, o.total, nullif(left(btrim(coalesce(p_reference, '')), 100), ''), auth.uid()
  from public.orders o where o.id = any (v_ids);

  update public.orders set payment_status = 'paid', paid_at = now() where id = any (v_ids);
  select sum(total) into v_total from public.orders where id = any (v_ids);

  return json_build_object('group_id', v_group, 'total', v_total, 'orders', cardinality(v_ids));
end $$;

-- Gestión de personal (el alta de cuentas se hace en Supabase Auth, ver README)
create or replace function public.admin_update_user(
  p_user_id uuid, p_role_id smallint, p_full_name text, p_is_active boolean)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_u            public.users;
  v_was_admin    boolean;
  v_will_be_admin boolean;
  v_admins       int;
begin
  if not private.has_perm('users.manage') then raise exception 'FORBIDDEN'; end if;
  select * into v_u from public.users where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  select exists (select 1 from public.roles where id = v_u.role_id and name = 'admin') and v_u.is_active into v_was_admin;
  select coalesce((select name = 'admin' from public.roles where id = p_role_id), false) and p_is_active into v_will_be_admin;

  if v_was_admin and not v_will_be_admin then
    select count(*) into v_admins from public.users u join public.roles r on r.id = u.role_id
    where r.name = 'admin' and u.is_active;
    if v_admins <= 1 then raise exception 'LAST_ADMIN'; end if;
  end if;

  update public.users
     set role_id = p_role_id, full_name = left(btrim(coalesce(p_full_name, '')), 80), is_active = p_is_active
   where id = p_user_id;
  return json_build_object('user_id', p_user_id);
end $$;

create or replace function public.regenerate_table_token(p_table_id uuid)
returns text language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_token text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
begin
  if not private.has_perm('tables.manage') then raise exception 'FORBIDDEN'; end if;
  update public.tables set qr_token = v_token where id = p_table_id;
  if not found then raise exception 'INVALID_TABLE'; end if;
  return v_token;
end $$;

-- Reporte de ventas (pedidos pagados, por fecha de negocio)
create or replace function public.sales_report(p_from date, p_to date)
returns json language plpgsql stable security definer set search_path = public, private, pg_temp as $$
begin
  if not private.has_perm('reports.view') then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'INVALID_RANGE'; end if;

  return json_build_object(
    'summary', (select json_build_object(
                  'orders', count(*), 'total', coalesce(sum(total), 0), 'tax', coalesce(sum(tax_amount), 0),
                  'discounts', coalesce(sum(discount_total), 0), 'avg_ticket', coalesce(round(avg(total), 2), 0))
                from public.orders
                where business_date between p_from and p_to and payment_status = 'paid' and status <> 'cancelled'),
    'cancelled', (select count(*) from public.orders
                  where business_date between p_from and p_to and status = 'cancelled'),
    'by_day', (select coalesce(json_agg(d order by d.date), '[]'::json) from (
                 select business_date as date, count(*) as orders, sum(total) as total
                 from public.orders
                 where business_date between p_from and p_to and payment_status = 'paid' and status <> 'cancelled'
                 group by 1) d),
    'by_method', (select coalesce(json_agg(m order by m.total desc), '[]'::json) from (
                    select p.method, count(*) as payments, sum(p.amount) as total
                    from public.payments p join public.orders o on o.id = p.order_id
                    where o.business_date between p_from and p_to and o.status <> 'cancelled'
                    group by 1) m),
    'by_channel', (select coalesce(json_agg(c order by c.total desc), '[]'::json) from (
                     select channel, count(*) as orders, sum(total) as total
                     from public.orders
                     where business_date between p_from and p_to and payment_status = 'paid' and status <> 'cancelled'
                     group by 1) c),
    'top_products', (select coalesce(json_agg(t order by t.total desc), '[]'::json) from (
                       select oi.product_name as name, sum(oi.quantity) as quantity, sum(oi.line_total) as total
                       from public.order_items oi join public.orders o on o.id = oi.order_id
                       where o.business_date between p_from and p_to and o.payment_status = 'paid' and o.status <> 'cancelled'
                       group by 1 order by 3 desc limit 10) t)
  );
end $$;

-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
alter table public.roles               enable row level security;
alter table public.users               enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.tables              enable row level security;
alter table public.categories          enable row level security;
alter table public.products            enable row level security;
alter table public.promotions          enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.payments            enable row level security;

-- Se usa (select ...) para que Postgres evalúe la función una sola vez por consulta.
create policy roles_select on public.roles for select to authenticated using ((select private.is_staff()));

create policy users_select on public.users for select to authenticated
  using (id = (select auth.uid()) or (select private.has_perm('users.manage')));

create policy settings_select on public.restaurant_settings for select to anon, authenticated using (true);
create policy settings_update on public.restaurant_settings for update to authenticated
  using ((select private.has_perm('settings.manage'))) with check ((select private.has_perm('settings.manage')));

create policy tables_select on public.tables for select to authenticated using ((select private.is_staff()));
create policy tables_write  on public.tables for all    to authenticated
  using ((select private.has_perm('tables.manage'))) with check ((select private.has_perm('tables.manage')));

create policy categories_select on public.categories for select to anon, authenticated
  using (is_active or (select private.has_perm('menu.manage')));
create policy categories_write on public.categories for all to authenticated
  using ((select private.has_perm('menu.manage'))) with check ((select private.has_perm('menu.manage')));

create policy products_select on public.products for select to anon, authenticated
  using (is_active or (select private.has_perm('menu.manage')));
create policy products_write on public.products for all to authenticated
  using ((select private.has_perm('menu.manage'))) with check ((select private.has_perm('menu.manage')));

create policy promotions_select on public.promotions for select to anon, authenticated
  using (is_active or (select private.has_perm('menu.manage')));
create policy promotions_write on public.promotions for all to authenticated
  using ((select private.has_perm('menu.manage'))) with check ((select private.has_perm('menu.manage')));

create policy orders_select      on public.orders      for select to authenticated using ((select private.has_perm('orders.view')));
create policy order_items_select on public.order_items for select to authenticated using ((select private.has_perm('orders.view')));
create policy payments_select    on public.payments    for select to authenticated
  using ((select private.has_perm('payments.register')) or (select private.has_perm('reports.view')));
-- orders / order_items / payments: sin políticas de escritura → solo las funciones RPC pueden escribir.

-- ---------------------------------------------------------------------
-- 8. Permisos a nivel de tabla/función (mínimo privilegio, defensa en profundidad)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.categories, public.products, public.promotions,
                public.restaurant_settings, public.menu_products            to anon, authenticated;
grant select on public.roles, public.users, public.tables,
                public.orders, public.order_items, public.payments          to authenticated;
grant insert, update, delete on public.categories, public.products,
                                public.promotions, public.tables            to authenticated;
grant update on public.restaurant_settings                                  to authenticated;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Funciones: nadie ejecuta nada por defecto; se concede lo estrictamente necesario.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_table_by_token(text)                          to anon, authenticated;
grant execute on function public.create_qr_order(text, jsonb, uuid, text)          to anon, authenticated;
grant execute on function public.get_table_orders(text)                            to anon, authenticated;

grant execute on function public.get_my_profile()                                  to authenticated;
grant execute on function public.create_staff_order(uuid, jsonb, text, uuid)       to authenticated;
grant execute on function public.replace_order_items(uuid, jsonb, text)            to authenticated;
grant execute on function public.set_order_status(uuid, public.order_status)       to authenticated;
grant execute on function public.cancel_order(uuid, text)                          to authenticated;
grant execute on function public.register_payment(uuid[], public.payment_method, text) to authenticated;
grant execute on function public.admin_update_user(uuid, smallint, text, boolean)  to authenticated;
grant execute on function public.regenerate_table_token(uuid)                      to authenticated;
grant execute on function public.sales_report(date, date)                          to authenticated;

-- Esquema private: PostgreSQL concede EXECUTE a PUBLIC por defecto, así que se revoca
-- explícitamente y solo se reabren los helpers que usan las políticas RLS y la vista.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_perm(text)                                   to anon, authenticated;
grant execute on function private.is_staff()                                       to anon, authenticated;
grant execute on function private.price_with_promotion(numeric, uuid, uuid)        to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Tiempo real (Supabase Realtime)
--    Solo se publican las tablas necesarias: menos mensajes = más holgura
--    en el plan gratuito (2 M mensajes/mes). Los ítems NO se publican:
--    el cliente relee el pedido completo al recibir el evento de "orders".
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.orders;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. Storage: bucket público de imágenes de productos (límite 1 MB c/u)
--     Subida/borrado solo para quien tenga el permiso menu.manage.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-images', 'product-images', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = excluded.public, file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists product_images_insert on storage.objects';
    execute 'drop policy if exists product_images_update on storage.objects';
    execute 'drop policy if exists product_images_delete on storage.objects';
    execute $p$create policy product_images_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'product-images' and (select private.has_perm('menu.manage')))$p$;
    execute $p$create policy product_images_update on storage.objects for update to authenticated
               using (bucket_id = 'product-images' and (select private.has_perm('menu.manage')))$p$;
    execute $p$create policy product_images_delete on storage.objects for delete to authenticated
               using (bucket_id = 'product-images' and (select private.has_perm('menu.manage')))$p$;
  end if;
end $$;


-- =====================================================================
--  Migración 2 — Datos del local, ticket y boleta de venta electrónica (SUNAT)
--  Se aplica DESPUÉS de 20260101000000_init_schema.sql.
--
--  IMPORTANTE: este sistema NO emite por sí mismo comprobantes ante SUNAT.
--  Prepara los datos (Nombre, Producto, Cantidad, Monto en S/), la boleta se
--  emite en SUNAT (SEE-SOL, gratuito, con Clave SOL) y aquí se REGISTRA la
--  serie-número que SUNAT devuelve (p. ej. B001-123) para evitar duplicados
--  y poder conciliar. La Clave SOL nunca pasa por este sistema.
-- =====================================================================

-- 1. Datos del local para el encabezado del ticket / hoja de boleta --------
alter table public.restaurant_settings
  add column legal_name text,
  add column ruc        text,
  add column address    text,
  add column phone      text;
alter table public.restaurant_settings
  add constraint restaurant_settings_ruc_chk check (ruc is null or ruc ~ '^[0-9]{11}$');
comment on column public.restaurant_settings.ruc is 'RUC de 11 dígitos del negocio (dato público que se imprime en el ticket).';

-- 2. Boletas preparadas / emitidas -------------------------------------------
create type public.receipt_status as enum ('prepared', 'issued', 'void');

create table public.receipts (
  id            uuid                  primary key default gen_random_uuid(),
  group_id      uuid                  not null,          -- cobro (payments.group_id) al que corresponde
  customer_name text                  not null check (char_length(btrim(customer_name)) between 2 and 150),
  doc_type      text                  check (doc_type in ('DNI', 'CE', 'PASAPORTE')),
  doc_number    text,
  items         jsonb                 not null check (jsonb_typeof(items) = 'array'),  -- [{product, quantity, amount}]
  total         numeric(12,2)         not null check (total > 0),
  status        public.receipt_status not null default 'prepared',
  sunat_ref     text                  check (sunat_ref ~ '^B[A-Z0-9]{3}-[0-9]{1,8}$'),  -- serie-número emitido en SUNAT
  issued_at     timestamptz,
  created_by    uuid                  references public.users (id) on delete set null,
  created_at    timestamptz           not null default now(),
  constraint receipts_doc_pair   check ((doc_type is null) = (doc_number is null)),
  constraint receipts_issued_ref check ((status = 'issued') = (sunat_ref is not null))
);
-- Un cobro solo puede tener UNA boleta vigente (preparada o emitida); las anuladas no cuentan.
create unique index receipts_one_active_per_group on public.receipts (group_id) where status <> 'void';
create unique index receipts_sunat_ref_uq         on public.receipts (sunat_ref) where sunat_ref is not null;
create index receipts_created_at_idx on public.receipts (created_at);
create index receipts_created_by_idx on public.receipts (created_by);
comment on table public.receipts is 'Boletas de venta: datos preparados en el sistema y serie-número emitido en SUNAT. No contiene Clave SOL ni certificados.';

alter table public.receipts enable row level security;
create policy receipts_select on public.receipts for select to authenticated
  using ((select private.has_perm('payments.register')) or (select private.has_perm('reports.view')));
-- sin políticas de escritura: solo las funciones RPC escriben.

-- 3. Funciones ---------------------------------------------------------------
-- Prepara la boleta de un cobro. Valida en el servidor: nombre, líneas, que la suma = total cobrado,
-- y documento de identidad obligatorio si el total SUPERA S/ 700 (regla de SUNAT para boletas).
create or replace function public.register_boleta(
  p_group_id uuid, p_customer_name text, p_doc_type text, p_doc_number text, p_items jsonb)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_total  numeric;
  v_name   text := btrim(coalesce(p_customer_name, ''));
  v_type   text := nullif(upper(btrim(coalesce(p_doc_type, ''))), '');
  v_num    text := nullif(upper(btrim(coalesce(p_doc_number, ''))), '');
  v_it     jsonb;
  v_sum    numeric := 0;
  v_clean  jsonb := '[]'::jsonb;
  v_prod   text;
  v_qty    numeric;
  v_amt    numeric;
  v_id     uuid;
begin
  if not private.has_perm('payments.register') then raise exception 'FORBIDDEN'; end if;
  if p_group_id is null then raise exception 'INVALID_REQUEST'; end if;

  select sum(amount) into v_total from public.payments where group_id = p_group_id;
  if v_total is null or v_total <= 0 then raise exception 'PAYMENT_NOT_FOUND'; end if;

  if char_length(v_name) not between 2 and 150 then raise exception 'INVALID_CUSTOMER_NAME'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'INVALID_ITEMS';
  end if;
  for v_it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_it) <> 'object'
       or jsonb_typeof(v_it -> 'product') <> 'string'
       or jsonb_typeof(v_it -> 'quantity') <> 'number'
       or jsonb_typeof(v_it -> 'amount') <> 'number' then
      raise exception 'INVALID_ITEMS';
    end if;
    v_prod := btrim(v_it ->> 'product');
    v_qty  := (v_it ->> 'quantity')::numeric;
    v_amt  := round((v_it ->> 'amount')::numeric, 2);
    if char_length(v_prod) not between 1 and 150 or v_qty <= 0 or v_qty > 9999 or v_amt < 0 or v_amt > 9999999 then
      raise exception 'INVALID_ITEMS';
    end if;
    v_sum   := v_sum + v_amt;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('product', v_prod, 'quantity', v_qty, 'amount', v_amt));
  end loop;
  if v_sum <> round(v_total, 2) then raise exception 'AMOUNT_MISMATCH'; end if;

  -- Documento del cliente
  if (v_type is null) <> (v_num is null) then raise exception 'INVALID_DOCUMENT'; end if;
  if v_total > 700 and v_type is null then raise exception 'DOCUMENT_REQUIRED'; end if;
  if v_type is not null then
    if v_type = 'DNI'        and v_num !~ '^[0-9]{8}$'          then raise exception 'INVALID_DOCUMENT'; end if;
    if v_type = 'CE'         and v_num !~ '^[A-Z0-9]{9,12}$'    then raise exception 'INVALID_DOCUMENT'; end if;
    if v_type = 'PASAPORTE'  and v_num !~ '^[A-Z0-9]{6,12}$'    then raise exception 'INVALID_DOCUMENT'; end if;
    if v_type not in ('DNI', 'CE', 'PASAPORTE')                  then raise exception 'INVALID_DOCUMENT'; end if;
  end if;

  begin
    insert into public.receipts (group_id, customer_name, doc_type, doc_number, items, total, created_by)
    values (p_group_id, v_name, v_type, v_num, v_clean, round(v_total, 2), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'RECEIPT_ALREADY_EXISTS';
  end;
  return json_build_object('receipt_id', v_id, 'total', round(v_total, 2), 'status', 'prepared');
end $$;

-- Registra la serie-número que SUNAT devolvió al emitir la boleta (p. ej. B001-123).
create or replace function public.mark_boleta_issued(p_receipt_id uuid, p_sunat_ref text)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_ref text := upper(btrim(coalesce(p_sunat_ref, '')));
  v_r   public.receipts;
begin
  if not private.has_perm('payments.register') then raise exception 'FORBIDDEN'; end if;
  if v_ref !~ '^B[A-Z0-9]{3}-[0-9]{1,8}$' then raise exception 'INVALID_SUNAT_REF'; end if;
  select * into v_r from public.receipts where id = p_receipt_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if v_r.status <> 'prepared' then raise exception 'RECEIPT_NOT_PENDING'; end if;
  begin
    update public.receipts set status = 'issued', sunat_ref = v_ref, issued_at = now() where id = v_r.id;
  exception when unique_violation then
    raise exception 'DUPLICATE_SUNAT_REF';
  end;
  return json_build_object('receipt_id', v_r.id, 'status', 'issued', 'sunat_ref', v_ref);
end $$;

-- Descarta una boleta preparada (corregir nombre/líneas). Una boleta YA emitida no se toca aquí:
-- se anula/ corrige en SUNAT (nota de crédito o comunicación de baja según corresponda).
create or replace function public.void_boleta(p_receipt_id uuid)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_r public.receipts;
begin
  if not private.has_perm('payments.register') then raise exception 'FORBIDDEN'; end if;
  select * into v_r from public.receipts where id = p_receipt_id for update;
  if not found then raise exception 'RECEIPT_NOT_FOUND'; end if;
  if v_r.status = 'issued' then raise exception 'RECEIPT_ALREADY_ISSUED'; end if;
  update public.receipts set status = 'void' where id = v_r.id and status = 'prepared';
  return json_build_object('receipt_id', v_r.id, 'status', 'void');
end $$;

-- 4. Permisos (mínimo privilegio) ---------------------------------------------
revoke all on public.receipts from anon, authenticated;
grant select on public.receipts to authenticated;
grant all    on public.receipts to service_role;

revoke execute on function public.register_boleta(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_boleta_issued(uuid, text)                 from public, anon, authenticated;
revoke execute on function public.void_boleta(uuid)                               from public, anon, authenticated;
grant  execute on function public.register_boleta(uuid, text, text, text, jsonb) to authenticated;
grant  execute on function public.mark_boleta_issued(uuid, text)                 to authenticated;
grant  execute on function public.void_boleta(uuid)                               to authenticated;


-- =====================================================================
--  Migración 3 — Pedidos sin mesa + puestos (roles) administrables desde la app
--  Se aplica DESPUÉS de 20260102000000_receipts.sql.
--  Es idempotente: se puede ejecutar más de una vez.
--
--  1. orders.table_id pasa a ser opcional (pedido "sin mesa": para llevar / mostrador).
--  2. RPC admin_save_role / admin_delete_role: el administrador crea y edita puestos
--     con sus permisos desde la pantalla Personal (sin entrar a Supabase).
--  La creación de cuentas (usuario + contraseña) la hace la Edge Function
--  supabase/functions/staff-admin (usa la service_role en el servidor, nunca en el navegador).
-- =====================================================================

-- 1. Pedidos sin mesa ------------------------------------------------------
alter table public.orders alter column table_id drop not null;

create or replace function private.create_order_core(
  p_table_id uuid, p_channel public.order_channel, p_items jsonb,
  p_note text, p_request_id uuid, p_user uuid)
returns public.orders
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_order public.orders;
  v_s     public.restaurant_settings;
  v_lines jsonb;
  v_list  numeric;
  v_final numeric;
  v_tax   numeric;
  v_total numeric;
begin
  -- Idempotencia: la misma clave devuelve el pedido ya creado
  if p_request_id is not null then
    select * into v_order from public.orders where client_request_id = p_request_id;
    if found then
      if v_order.table_id is distinct from p_table_id then raise exception 'REQUEST_ID_CONFLICT'; end if;
      return v_order;
    end if;
  end if;

  select * into v_s from public.restaurant_settings where id = 1;

  select jsonb_agg(to_jsonb(l)) into v_lines from private.price_items(p_items) l;

  select coalesce(sum(x.list_price * x.quantity), 0), coalesce(sum(x.unit_price * x.quantity), 0)
    into v_list, v_final
  from jsonb_to_recordset(v_lines) as x(line_no int, product_id uuid, product_name text,
                                        list_price numeric, unit_price numeric, quantity int, notes text);

  if v_s.prices_include_tax then
    v_tax := round(v_final - v_final / (1 + v_s.tax_rate), 2);
    v_total := v_final;
  else
    v_tax := round(v_final * v_s.tax_rate, 2);
    v_total := v_final + v_tax;
  end if;

  begin
    insert into public.orders (table_id, channel, customer_note, subtotal, discount_total,
                               tax_amount, total, client_request_id, created_by)
    values (p_table_id, p_channel, nullif(btrim(p_note), ''), v_list, v_list - v_final,
            v_tax, v_total, p_request_id, p_user)
    returning * into v_order;
  exception when unique_violation then
    -- carrera: dos envíos simultáneos con la misma clave
    select * into v_order from public.orders where client_request_id = p_request_id;
    if not found then raise; end if;
    return v_order;
  end;

  insert into public.order_items (order_id, product_id, line_no, product_name, list_price, unit_price, quantity, notes)
  select v_order.id, x.product_id, x.line_no, x.product_name, x.list_price, x.unit_price, x.quantity, x.notes
  from jsonb_to_recordset(v_lines) as x(line_no int, product_id uuid, product_name text,
                                        list_price numeric, unit_price numeric, quantity int, notes text);

  return v_order;
end $$;

create or replace function public.create_staff_order(
  p_table_id uuid, p_items jsonb, p_note text default null, p_request_id uuid default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_order public.orders;
begin
  if not private.has_perm('orders.create') then raise exception 'FORBIDDEN'; end if;
  -- p_table_id nulo = pedido SIN MESA (para llevar / mostrador). Si viene una mesa, debe existir y estar activa.
  if p_table_id is not null and not exists (select 1 from public.tables where id = p_table_id and is_active) then
    raise exception 'INVALID_TABLE';
  end if;
  v_order := private.create_order_core(p_table_id, 'internal', p_items, left(btrim(p_note), 300), p_request_id, auth.uid());
  return json_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                           'status', v_order.status, 'total', v_order.total);
end $$;

-- 2. Puestos (roles) y permisos ----------------------------------------------
-- Permisos válidos (el comodín '*' solo lo tiene el rol "admin" del sistema).
create or replace function private.valid_permissions()
returns text[] language sql immutable as $$
  select array['orders.view','orders.create','orders.edit','orders.cancel','orders.kitchen','orders.serve',
               'payments.register','menu.manage','tables.manage','reports.view','users.manage','settings.manage'];
$$;

-- Crea (p_id nulo) o edita un puesto. El rol "admin" no se puede modificar.
create or replace function public.admin_save_role(p_id smallint, p_label text, p_permissions text[])
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_label text := left(btrim(coalesce(p_label, '')), 40);
  v_perms text[];
  v_role  public.roles;
  v_base  text;
  v_name  text;
begin
  if not private.has_perm('users.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_label) < 2 then raise exception 'INVALID_ROLE'; end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_perms from unnest(coalesce(p_permissions, '{}')) x;
  if exists (select 1 from unnest(v_perms) x where not (x = any (private.valid_permissions()))) then
    raise exception 'INVALID_PERMISSION';
  end if;

  if p_id is null then
    -- name: solo letras minúsculas y "_" (restricción de la tabla); si ya existe se agregan letras al azar
    v_base := regexp_replace(translate(lower(v_label), 'áéíóúüñ', 'aeiouun'), '[^a-z]+', '_', 'g');
    v_base := btrim(v_base, '_');
    if v_base = '' then v_base := 'puesto'; end if;
    v_name := v_base;
    while exists (select 1 from public.roles where name = v_name) loop
      v_name := v_base || '_' || chr(97 + floor(random() * 26)::int) || chr(97 + floor(random() * 26)::int) || chr(97 + floor(random() * 26)::int);
    end loop;
    insert into public.roles (name, label, permissions, is_system) values (v_name, v_label, v_perms, false)
    returning * into v_role;
  else
    select * into v_role from public.roles where id = p_id for update;
    if not found then raise exception 'ROLE_NOT_FOUND'; end if;
    if v_role.name = 'admin' then raise exception 'SYSTEM_ROLE'; end if;
    update public.roles set label = v_label, permissions = v_perms where id = p_id returning * into v_role;
  end if;
  return json_build_object('role_id', v_role.id, 'name', v_role.name);
end $$;

-- Elimina un puesto creado por el administrador, solo si no tiene usuarios asignados.
create or replace function public.admin_delete_role(p_id smallint)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_role public.roles;
begin
  if not private.has_perm('users.manage') then raise exception 'FORBIDDEN'; end if;
  select * into v_role from public.roles where id = p_id for update;
  if not found then raise exception 'ROLE_NOT_FOUND'; end if;
  if v_role.is_system or v_role.name = 'admin' then raise exception 'SYSTEM_ROLE'; end if;
  if exists (select 1 from public.users where role_id = p_id) then raise exception 'ROLE_IN_USE'; end if;
  delete from public.roles where id = p_id;
  return json_build_object('role_id', p_id);
end $$;

revoke execute on function public.admin_save_role(smallint, text, text[]) from public, anon, authenticated;
revoke execute on function public.admin_delete_role(smallint)             from public, anon, authenticated;
grant  execute on function public.admin_save_role(smallint, text, text[]) to authenticated;
grant  execute on function public.admin_delete_role(smallint)             to authenticated;


-- =====================================================================
--  Migración 4 — Seguridad de los pedidos por QR + eliminar personal
--  Se aplica DESPUÉS de 20260103000000_notable_roles.sql. Es idempotente.
--
--  1. Sesiones de mesa: el cliente recibe una sesión con vencimiento al escanear el QR;
--     sin sesión vigente no puede pedir ni ver pedidos. La sesión se cierra sola cuando se
--     paga la última cuenta de la mesa o cuando se regenera el QR.
--  2. Confirmación del personal: los pedidos del QR quedan "por confirmar" y NO llegan a
--     cocina ni a las cuentas hasta que Caja los acepta (o los rechaza).
--  3. get_public_info: datos mínimos para mostrar la carta sin mesa (solo lectura).
--  4. admin_check_delete_user: reglas para eliminar personal (la baja la hace la Edge Function).
-- =====================================================================

-- 1. Ajustes ----------------------------------------------------------------
alter table public.restaurant_settings
  add column if not exists qr_session_minutes int not null default 180 check (qr_session_minutes between 0 and 1440),
  add column if not exists qr_requires_confirmation boolean not null default true;
comment on column public.restaurant_settings.qr_session_minutes is 'Duración (min) de la sesión que se abre al escanear el QR. 0 = sin sesiones (no recomendado).';
comment on column public.restaurant_settings.qr_requires_confirmation is 'true = los pedidos del QR esperan la confirmación del personal antes de llegar a cocina.';

-- 2. Pedidos por confirmar -------------------------------------------------------
alter table public.orders add column if not exists is_confirmed boolean not null default true;
create index if not exists orders_unconfirmed_idx on public.orders (created_at) where not is_confirmed;

-- 3. Sesiones de mesa --------------------------------------------------------
create table if not exists public.table_sessions (
  id         uuid        primary key default gen_random_uuid(),
  table_id   uuid        not null references public.tables (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at  timestamptz
);
create index if not exists table_sessions_table_idx   on public.table_sessions (table_id, created_at desc);
create index if not exists table_sessions_expires_idx on public.table_sessions (expires_at);
alter table public.table_sessions enable row level security;   -- sin políticas: solo las funciones tocan esta tabla
revoke all on public.table_sessions from anon, authenticated;
grant  all on public.table_sessions to service_role;

create or replace function private.require_session(p_table_id uuid, p_session_id uuid)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_min int;
begin
  select qr_session_minutes into v_min from public.restaurant_settings where id = 1;
  if v_min = 0 then return; end if;                       -- sesiones desactivadas en Ajustes
  if p_session_id is null then raise exception 'SESSION_REQUIRED'; end if;
  if not exists (select 1 from public.table_sessions
                  where id = p_session_id and table_id = p_table_id and closed_at is null and expires_at > now()) then
    raise exception 'SESSION_EXPIRED';
  end if;
end $$;

-- Se llama al abrir la carta desde el QR. Si el cliente ya tenía una sesión vigente de esa mesa, la reutiliza.
create or replace function public.open_table_session(p_token text, p_session_id uuid default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_t      public.tables;
  v_s      public.restaurant_settings;
  v_id     uuid;
  v_exp    timestamptz;
  v_recent int;
begin
  select * into v_t from public.tables where qr_token = p_token and is_active;
  if not found then raise exception 'INVALID_TABLE'; end if;
  select * into v_s from public.restaurant_settings where id = 1;

  if v_s.qr_session_minutes > 0 then
    if p_session_id is not null then
      select id, expires_at into v_id, v_exp from public.table_sessions
       where id = p_session_id and table_id = v_t.id and closed_at is null and expires_at > now();
    end if;
    if v_id is null then
      select count(*) into v_recent from public.table_sessions where table_id = v_t.id and created_at > now() - interval '10 minutes';
      if v_recent >= 60 then raise exception 'TOO_MANY_REQUESTS'; end if;
      insert into public.table_sessions (table_id, expires_at)
        values (v_t.id, now() + make_interval(mins => v_s.qr_session_minutes))
        returning id, expires_at into v_id, v_exp;
      delete from public.table_sessions where expires_at < now() - interval '2 days';   -- limpieza oportunista
    end if;
  end if;

  return json_build_object(
    'session_id', v_id, 'expires_at', v_exp,
    'number', v_t.number, 'name', v_t.name,
    'restaurant', v_s.name, 'currency', v_s.currency_symbol,
    'qr_enabled', v_s.qr_ordering_enabled, 'requires_confirmation', v_s.qr_requires_confirmation);
end $$;

-- Datos mínimos para la carta de solo lectura (sin mesa)
create or replace function public.get_public_info()
returns json language sql stable security definer set search_path = public, private, pg_temp as $$
  select json_build_object('restaurant', name, 'currency', currency_symbol) from public.restaurant_settings where id = 1;
$$;

-- Pedido del cliente: ahora exige sesión vigente y puede quedar "por confirmar"
drop function if exists public.create_qr_order(text, jsonb, uuid, text);
create or replace function public.create_qr_order(
  p_token text, p_items jsonb, p_request_id uuid, p_note text default null, p_session_id uuid default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_t       public.tables;
  v_s       public.restaurant_settings;
  v_order   public.orders;
  v_pending int;
begin
  if p_request_id is null then raise exception 'INVALID_REQUEST'; end if;

  select * into v_t from public.tables where qr_token = p_token and is_active;
  if not found then raise exception 'INVALID_TABLE'; end if;

  select * into v_s from public.restaurant_settings where id = 1;
  if not v_s.qr_ordering_enabled then raise exception 'QR_DISABLED'; end if;

  -- reintento del mismo envío → mismo pedido (sin duplicar), aunque la sesión haya vencido justo ahora
  select * into v_order from public.orders where client_request_id = p_request_id;
  if found then
    if v_order.table_id is distinct from v_t.id then raise exception 'REQUEST_ID_CONFLICT'; end if;
    return json_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                             'status', v_order.status, 'total', v_order.total, 'duplicate', true,
                             'awaiting_confirmation', not v_order.is_confirmed);
  end if;

  perform private.require_session(v_t.id, p_session_id);

  -- freno anti-spam: pedidos QR aún sin atender en esta mesa (incluye los que esperan confirmación)
  select count(*) into v_pending from public.orders
  where table_id = v_t.id and channel = 'qr' and status = 'pending';
  if v_pending >= v_s.qr_max_pending_per_table then raise exception 'TOO_MANY_PENDING'; end if;

  v_order := private.create_order_core(v_t.id, 'qr', p_items, left(btrim(p_note), 300), p_request_id, null);
  if v_s.qr_requires_confirmation then
    update public.orders set is_confirmed = false where id = v_order.id;
    v_order.is_confirmed := false;
  end if;
  return json_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                           'status', v_order.status, 'total', v_order.total, 'duplicate', false,
                           'awaiting_confirmation', not v_order.is_confirmed);
end $$;

-- Pedidos "vivos" de la mesa para el cliente (exige sesión vigente)
drop function if exists public.get_table_orders(text);
create or replace function public.get_table_orders(p_token text, p_session_id uuid default null)
returns json language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare
  v_t public.tables;
begin
  select * into v_t from public.tables where qr_token = p_token and is_active;
  if not found then raise exception 'INVALID_TABLE'; end if;
  perform private.require_session(v_t.id, p_session_id);

  return (
    select coalesce(json_agg(o order by o.created_at), '[]'::json)
    from (
      select ord.id, ord.order_number, ord.status, ord.total, ord.created_at, ord.channel, ord.is_confirmed,
             (select coalesce(json_agg(json_build_object('name', oi.product_name, 'quantity', oi.quantity,
                                                          'notes', oi.notes) order by oi.line_no), '[]'::json)
                from public.order_items oi where oi.order_id = ord.id) as items
      from public.orders ord
      where ord.table_id = v_t.id
        and ord.payment_status = 'unpaid'
        and ord.created_at > now() - interval '8 hours'
    ) o
  );
end $$;

-- Confirmar / rechazar un pedido del QR (Caja)
create or replace function public.confirm_qr_order(p_order_id uuid)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_o public.orders;
begin
  if not private.has_perm('orders.create') then raise exception 'FORBIDDEN'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.status = 'cancelled' then raise exception 'ORDER_CANCELLED'; end if;
  if not v_o.is_confirmed then update public.orders set is_confirmed = true where id = v_o.id; end if;
  return json_build_object('order_id', v_o.id, 'confirmed', true);
end $$;

create or replace function public.reject_qr_order(p_order_id uuid, p_reason text default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_o public.orders;
begin
  if not private.has_perm('orders.create') then raise exception 'FORBIDDEN'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.is_confirmed or v_o.status <> 'pending' then raise exception 'ORDER_NOT_CANCELLABLE'; end if;
  update public.orders
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancelled_reason = coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'Rechazado por el personal')
   where id = v_o.id;
  return json_build_object('order_id', v_o.id, 'status', 'cancelled');
end $$;

-- Funciones existentes que ahora respetan la confirmación / cierran sesiones
create or replace function public.set_order_status(p_order_id uuid, p_status public.order_status)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_o    public.orders;
  v_perm text;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  -- un pedido del QR que el personal aún no confirmó no avanza por cocina
  if not v_o.is_confirmed then raise exception 'ORDER_NOT_CONFIRMED'; end if;

  if v_o.status = p_status then   -- doble toque: no hace nada
    return json_build_object('order_id', v_o.id, 'status', v_o.status);
  end if;

  v_perm := case
    when v_o.status = 'pending'   and p_status = 'preparing'             then 'orders.kitchen'
    when v_o.status = 'preparing' and p_status in ('ready', 'pending')   then 'orders.kitchen'
    when v_o.status = 'ready'     and p_status = 'preparing'             then 'orders.kitchen'
    when v_o.status = 'ready'     and p_status = 'delivered'             then 'orders.serve'
    when v_o.status = 'delivered' and p_status = 'ready'                 then 'orders.serve'
    else null end;

  if v_perm is null then raise exception 'INVALID_TRANSITION'; end if;
  if not private.has_perm(v_perm) then raise exception 'FORBIDDEN'; end if;

  update public.orders set status = p_status where id = v_o.id;
  return json_build_object('order_id', v_o.id, 'status', p_status);
end $$;

create or replace function public.register_payment(
  p_order_ids uuid[], p_method public.payment_method, p_reference text default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_ids   uuid[];
  v_found int;
  v_group uuid := gen_random_uuid();
  v_total numeric;
begin
  if not private.has_perm('payments.register') then raise exception 'FORBIDDEN'; end if;
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 50 then raise exception 'INVALID_REQUEST'; end if;

  select array_agg(distinct x) into v_ids from unnest(p_order_ids) x;

  perform 1 from public.orders where id = any (v_ids) order by id for update;
  select count(*) into v_found from public.orders where id = any (v_ids);
  if v_found <> cardinality(v_ids) then raise exception 'ORDER_NOT_FOUND'; end if;
  if exists (select 1 from public.orders where id = any (v_ids) and status = 'cancelled') then raise exception 'ORDER_CANCELLED'; end if;
  if exists (select 1 from public.orders where id = any (v_ids) and payment_status = 'paid') then raise exception 'ALREADY_PAID'; end if;
  if exists (select 1 from public.orders where id = any (v_ids) and not is_confirmed) then raise exception 'ORDER_NOT_CONFIRMED'; end if;

  insert into public.payments (order_id, group_id, method, amount, reference, received_by)
  select o.id, v_group, p_method, o.total, nullif(left(btrim(coalesce(p_reference, '')), 100), ''), auth.uid()
  from public.orders o where o.id = any (v_ids);

  update public.orders set payment_status = 'paid', paid_at = now() where id = any (v_ids);
  select sum(total) into v_total from public.orders where id = any (v_ids);

  return json_build_object('group_id', v_group, 'total', v_total, 'orders', cardinality(v_ids));
end $$;

create or replace function public.regenerate_table_token(p_table_id uuid)
returns text language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_token text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
begin
  if not private.has_perm('tables.manage') then raise exception 'FORBIDDEN'; end if;
  update public.tables set qr_token = v_token where id = p_table_id;
  if not found then raise exception 'INVALID_TABLE'; end if;
  -- el QR anterior y las páginas abiertas con él dejan de poder pedir
  update public.table_sessions set closed_at = now() where table_id = p_table_id and closed_at is null;
  return v_token;
end $$;

-- La sesión de la mesa se cierra cuando se paga su última cuenta abierta
create or replace function private.close_table_sessions()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if new.table_id is not null and not exists (
       select 1 from public.orders where table_id = new.table_id and payment_status = 'unpaid' and status <> 'cancelled') then
    update public.table_sessions set closed_at = now() where table_id = new.table_id and closed_at is null;
  end if;
  return null;
end $$;
drop trigger if exists orders_close_sessions on public.orders;
create trigger orders_close_sessions after update of payment_status on public.orders
  for each row when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function private.close_table_sessions();

-- 4. Eliminar personal --------------------------------------------------------
-- Comprueba las reglas; la baja de la cuenta (Auth) la ejecuta la Edge Function staff-admin con la service_role.
-- Pedidos, cobros y boletas que el usuario registró se conservan (su autor queda en blanco).
create or replace function public.admin_check_delete_user(p_user_id uuid)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_is_admin boolean;
begin
  if not private.has_perm('users.manage') then raise exception 'FORBIDDEN'; end if;
  if p_user_id = auth.uid() then raise exception 'CANNOT_DELETE_SELF'; end if;
  if not exists (select 1 from public.users where id = p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  select exists (select 1 from public.users u join public.roles r on r.id = u.role_id where u.id = p_user_id and r.name = 'admin') into v_is_admin;
  if v_is_admin and not exists (
       select 1 from public.users u join public.roles r on r.id = u.role_id
        where r.name = 'admin' and u.is_active and u.id <> p_user_id) then
    raise exception 'LAST_ADMIN';
  end if;
  return json_build_object('user_id', p_user_id);
end $$;

-- 5. Permisos (mínimo privilegio) -----------------------------------------------
revoke execute on function public.open_table_session(text, uuid)                       from public, anon, authenticated;
revoke execute on function public.get_public_info()                                    from public, anon, authenticated;
revoke execute on function public.create_qr_order(text, jsonb, uuid, text, uuid)       from public, anon, authenticated;
revoke execute on function public.get_table_orders(text, uuid)                         from public, anon, authenticated;
revoke execute on function public.confirm_qr_order(uuid)                               from public, anon, authenticated;
revoke execute on function public.reject_qr_order(uuid, text)                          from public, anon, authenticated;
revoke execute on function public.admin_check_delete_user(uuid)                        from public, anon, authenticated;
grant  execute on function public.open_table_session(text, uuid)                       to anon, authenticated;
grant  execute on function public.get_public_info()                                    to anon, authenticated;
grant  execute on function public.create_qr_order(text, jsonb, uuid, text, uuid)       to anon, authenticated;
grant  execute on function public.get_table_orders(text, uuid)                         to anon, authenticated;
grant  execute on function public.confirm_qr_order(uuid)                               to authenticated;
grant  execute on function public.reject_qr_order(uuid, text)                          to authenticated;
grant  execute on function public.admin_check_delete_user(uuid)                        to authenticated;
