-- =====================================================================
--  Migración 6 — Delivery
--  Se aplica DESPUÉS de 20260105000000_sin_mozo_entrega_cocina.sql. Es idempotente.
--
--  Un delivery es un pedido normal (misma cocina, mismas cuentas y comprobantes) con
--  datos de entrega: cliente, teléfono, dirección, referencia, costo de envío, "paga con"
--  y repartidor. Flujo:  pendiente → en preparación → listo → SALIÓ (repartidor) → entregado.
--  Permiso nuevo: orders.delivery (despachar y marcar entregado). Cocina NO lo tiene.
-- =====================================================================

-- 1. Ajustes --------------------------------------------------------------------
alter table public.restaurant_settings
  add column if not exists delivery_enabled     boolean       not null default true,
  add column if not exists delivery_fee_default numeric(8,2)  not null default 0 check (delivery_fee_default between 0 and 200),
  add column if not exists delivery_min_order   numeric(8,2)  not null default 0 check (delivery_min_order between 0 and 5000),
  add column if not exists delivery_whatsapp    text          check (delivery_whatsapp is null or delivery_whatsapp ~ '^[0-9]{9,15}$');

-- 2. Datos de entrega en el pedido -----------------------------------------------
alter table public.orders
  add column if not exists order_kind          text          not null default 'local' check (order_kind in ('local', 'delivery')),
  add column if not exists delivery_name       text,
  add column if not exists delivery_phone      text,
  add column if not exists delivery_address    text,
  add column if not exists delivery_reference  text,
  add column if not exists delivery_fee        numeric(8,2)  not null default 0 check (delivery_fee >= 0),
  add column if not exists delivery_change_for numeric(10,2) check (delivery_change_for is null or delivery_change_for > 0),
  add column if not exists driver_name         text,
  add column if not exists dispatched_at       timestamptz;
alter table public.orders drop constraint if exists orders_delivery_chk;
alter table public.orders add constraint orders_delivery_chk check (
  order_kind = 'local' or (table_id is null and delivery_name is not null and delivery_phone is not null and delivery_address is not null));
create index if not exists orders_delivery_idx on public.orders (created_at) where order_kind = 'delivery';

-- 3. Permiso nuevo ------------------------------------------------------------
create or replace function private.valid_permissions()
returns text[] language sql immutable as $$
  select array['orders.view','orders.create','orders.edit','orders.cancel','orders.kitchen','orders.serve','orders.delivery',
               'payments.register','menu.manage','tables.manage','reports.view','users.manage','settings.manage'];
$$;
update public.roles
   set permissions = (select array_agg(distinct p order by p) from unnest(permissions || array['orders.delivery']) as p)
 where name = 'cashier' and not ('orders.delivery' = any (permissions));

-- 4. Crear un delivery (Caja) --------------------------------------------------------
create or replace function public.create_delivery_order(
  p_items jsonb, p_name text, p_phone text, p_address text,
  p_reference text default null, p_fee numeric default null, p_change_for numeric default null,
  p_note text default null, p_request_id uuid default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_s      public.restaurant_settings;
  v_o      public.orders;
  v_name   text := btrim(coalesce(p_name, ''));
  v_phone  text;
  v_addr   text := btrim(coalesce(p_address, ''));
  v_ref    text := nullif(btrim(coalesce(p_reference, '')), '');
  v_fee    numeric;
  v_ftax   numeric;
  v_fadd   numeric;
begin
  if not private.has_perm('orders.create') then raise exception 'FORBIDDEN'; end if;
  select * into v_s from public.restaurant_settings where id = 1;
  if not v_s.delivery_enabled then raise exception 'DELIVERY_DISABLED'; end if;

  if char_length(v_name) not between 2 and 80 then raise exception 'INVALID_CUSTOMER_NAME'; end if;
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');                    -- solo dígitos
  if length(v_phone) = 11 and left(v_phone, 2) = '51' then v_phone := substr(v_phone, 3); end if;   -- quita el +51
  if v_phone !~ '^[0-9]{6,12}$' then raise exception 'INVALID_PHONE'; end if;
  if char_length(v_addr) not between 5 and 200 or char_length(coalesce(v_ref, '')) > 200 then raise exception 'INVALID_ADDRESS'; end if;
  v_fee := round(coalesce(p_fee, v_s.delivery_fee_default), 2);
  if v_fee < 0 or v_fee > 200 then raise exception 'INVALID_FEE'; end if;

  -- reintento del mismo envío → mismo pedido (sin duplicar ni sumar dos veces el envío)
  if p_request_id is not null then
    select * into v_o from public.orders where client_request_id = p_request_id;
    if found then
      if v_o.order_kind <> 'delivery' then raise exception 'REQUEST_ID_CONFLICT'; end if;
      return json_build_object('order_id', v_o.id, 'order_number', v_o.order_number, 'status', v_o.status,
                               'total', v_o.total, 'delivery_fee', v_o.delivery_fee, 'duplicate', true);
    end if;
  end if;

  v_o := private.create_order_core(null, 'internal', p_items, left(btrim(p_note), 300), p_request_id, auth.uid());
  if v_s.delivery_min_order > 0 and v_o.total < v_s.delivery_min_order then raise exception 'BELOW_MIN_ORDER'; end if;

  if v_s.prices_include_tax then v_ftax := round(v_fee - v_fee / (1 + v_s.tax_rate), 2); v_fadd := v_fee;
  else v_ftax := round(v_fee * v_s.tax_rate, 2); v_fadd := v_fee + v_ftax; end if;
  if p_change_for is not null and p_change_for < v_o.total + v_fadd then raise exception 'INVALID_CHANGE'; end if;

  update public.orders
     set order_kind = 'delivery', delivery_name = v_name, delivery_phone = v_phone, delivery_address = v_addr,
         delivery_reference = v_ref, delivery_fee = v_fee, delivery_change_for = round(p_change_for, 2),
         tax_amount = tax_amount + v_ftax, total = total + v_fadd
   where id = v_o.id and order_kind = 'local'
   returning * into v_o;
  if not found then   -- carrera: otro envío con la misma clave ya lo convirtió
    select * into v_o from public.orders where client_request_id = p_request_id;
    return json_build_object('order_id', v_o.id, 'order_number', v_o.order_number, 'status', v_o.status,
                             'total', v_o.total, 'delivery_fee', v_o.delivery_fee, 'duplicate', true);
  end if;
  return json_build_object('order_id', v_o.id, 'order_number', v_o.order_number, 'status', v_o.status,
                           'total', v_o.total, 'delivery_fee', v_o.delivery_fee, 'duplicate', false);
end $$;

-- 5. Despacho: salida con el repartidor -----------------------------------------------
create or replace function public.dispatch_delivery(p_order_id uuid, p_driver text default null)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  v_o public.orders;
  v_d text := nullif(left(btrim(coalesce(p_driver, '')), 60), '');
begin
  if not private.has_perm('orders.delivery') then raise exception 'FORBIDDEN'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.order_kind <> 'delivery' then raise exception 'NOT_DELIVERY'; end if;
  if v_o.status <> 'ready' then raise exception 'ORDER_NOT_READY'; end if;
  if v_o.dispatched_at is null then
    update public.orders set dispatched_at = now(), driver_name = v_d where id = v_o.id;
  elsif v_d is not null and v_d is distinct from v_o.driver_name then
    update public.orders set driver_name = v_d where id = v_o.id;        -- doble toque: solo corrige el nombre
  end if;
  return json_build_object('order_id', v_o.id, 'dispatched', true);
end $$;

create or replace function public.undo_dispatch_delivery(p_order_id uuid)
returns json language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_o public.orders;
begin
  if not private.has_perm('orders.delivery') then raise exception 'FORBIDDEN'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.order_kind <> 'delivery' then raise exception 'NOT_DELIVERY'; end if;
  if v_o.status <> 'ready' then raise exception 'ORDER_NOT_READY'; end if;
  update public.orders set dispatched_at = null, driver_name = null where id = v_o.id;
  return json_build_object('order_id', v_o.id, 'dispatched', false);
end $$;

-- 6. Funciones existentes que ahora conocen el delivery ----------------------------------
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
    when v_o.status = 'ready'     and p_status = 'delivered'             then case when v_o.order_kind = 'delivery' then 'orders.delivery' else 'orders.serve' end
    when v_o.status = 'delivered' and p_status = 'ready'                 then case when v_o.order_kind = 'delivery' then 'orders.delivery' else 'orders.serve' end
    else null end;

  if v_perm is null then raise exception 'INVALID_TRANSITION'; end if;
  if not private.has_perm(v_perm) then raise exception 'FORBIDDEN'; end if;
  -- un delivery solo se entrega si ya salió con el repartidor
  if v_o.order_kind = 'delivery' and p_status = 'delivered' and v_o.dispatched_at is null then raise exception 'NOT_DISPATCHED'; end if;

  update public.orders
     set status = p_status,
         dispatched_at = case when v_o.order_kind = 'delivery' and p_status in ('pending', 'preparing') then null else dispatched_at end
   where id = v_o.id;
  return json_build_object('order_id', v_o.id, 'status', p_status);
end $$;

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

  -- en un delivery el costo de envío forma parte del total: se vuelve a sumar
  if v_o.order_kind = 'delivery' and v_o.delivery_fee > 0 then
    if v_s.prices_include_tax then
      v_tax := v_tax + round(v_o.delivery_fee - v_o.delivery_fee / (1 + v_s.tax_rate), 2); v_total := v_total + v_o.delivery_fee;
    else
      v_tax := v_tax + round(v_o.delivery_fee * v_s.tax_rate, 2); v_total := v_total + v_o.delivery_fee + round(v_o.delivery_fee * v_s.tax_rate, 2);
    end if;
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

-- 7. Datos públicos de la carta (incluye lo necesario para pedir por WhatsApp) -------------------
create or replace function public.get_public_info()
returns json language sql stable security definer set search_path = public, private, pg_temp as $$
  select json_build_object('restaurant', name, 'currency', currency_symbol,
                           'delivery_enabled', delivery_enabled, 'delivery_whatsapp', delivery_whatsapp,
                           'delivery_fee', delivery_fee_default, 'delivery_min_order', delivery_min_order)
  from public.restaurant_settings where id = 1;
$$;

-- 8. Permisos (mínimo privilegio) --------------------------------------------------------------
revoke execute on function public.create_delivery_order(jsonb, text, text, text, text, numeric, numeric, text, uuid) from public, anon, authenticated;
revoke execute on function public.dispatch_delivery(uuid, text)      from public, anon, authenticated;
revoke execute on function public.undo_dispatch_delivery(uuid)       from public, anon, authenticated;
grant  execute on function public.create_delivery_order(jsonb, text, text, text, text, numeric, numeric, text, uuid) to authenticated;
grant  execute on function public.dispatch_delivery(uuid, text)      to authenticated;
grant  execute on function public.undo_dispatch_delivery(uuid)       to authenticated;
revoke execute on function public.get_public_info() from public, anon, authenticated;
grant  execute on function public.get_public_info() to anon, authenticated;
