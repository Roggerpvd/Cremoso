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
