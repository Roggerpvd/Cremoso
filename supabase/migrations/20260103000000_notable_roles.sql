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
