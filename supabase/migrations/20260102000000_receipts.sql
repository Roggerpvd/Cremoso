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
