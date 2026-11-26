-- =====================================================================
--  Pruebas de backend: esquema, integridad, RLS y funciones RPC.
--  Ejecutar con: bash supabase/tests/run_tests.sh
--  Cada prueba imprime "PASS ..." o aborta con "FAIL ...".
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

create schema if not exists test;

-- Estas pruebas cubren el comportamiento base del QR. Las sesiones de mesa y la confirmación del personal
-- (migración 4) se prueban aparte en 05_qr_security_tests.sql, por eso aquí se desactivan.
update public.restaurant_settings set qr_session_minutes = 0, qr_requires_confirmation = false where id = 1;

create or replace function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'PASS: %', p_msg;
end $$;

-- Ejecuta SQL y exige que falle con un mensaje que contenga p_expected
create or replace function test.raises(p_sql text, p_expected text, p_msg text) returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then raise exception 'FAIL: % (no lanzó error)', p_msg; end if;
  if position(lower(p_expected) in lower(v_err)) = 0 then
    raise exception 'FAIL: % (error inesperado: %)', p_msg, v_err;
  end if;
  raise notice 'PASS: % [%]', p_msg, p_expected;
end $$;

create or replace function test.qr_fail(p_token text, p_items jsonb, p_req uuid, p_expected text, p_msg text)
returns void language plpgsql as $$
begin
  perform test.raises(format('select public.create_qr_order(%L, %L::jsonb, %L::uuid)', p_token, p_items::text, p_req), p_expected, p_msg);
end $$;

create or replace function test.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function test.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $$;

create or replace function test.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
end $$;

grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

\set uA '00000000-0000-0000-0000-00000000000a'
\set uB '00000000-0000-0000-0000-00000000000b'
\set uC '00000000-0000-0000-0000-00000000000c'
\set uD '00000000-0000-0000-0000-00000000000d'
\set uE '00000000-0000-0000-0000-00000000000e'
\set hb '20000000-0000-0000-0000-000000000001'
\set pz '20000000-0000-0000-0000-000000000002'
\set gs '20000000-0000-0000-0000-000000000003'
\set rt '20000000-0000-0000-0000-000000000004'
\set eo '20000000-0000-0000-0000-000000000005'

-- ---------------------------------------------------------------------
\echo '=== 1. Usuarios y roles'
-- ---------------------------------------------------------------------
begin;
insert into auth.users (id, email) values
  (:'uA', 'admin@test.pe'), (:'uB', 'caja@test.pe'), (:'uC', 'mozo@test.pe'),
  (:'uD', 'cocina@test.pe'), (:'uE', 'intruso@test.pe');
select test.ok((select r.name from public.users u join public.roles r on r.id = u.role_id where u.email = 'admin@test.pe') = 'admin',
               'el primer usuario creado en Auth queda como administrador');
select test.ok((select count(*) from public.users where role_id is null) = 4,
               'los siguientes usuarios NO reciben rol automáticamente (registro abierto no da acceso)');
commit;

begin;
select test.login(:'uA');
select public.admin_update_user(:'uB', (select id from public.roles where name = 'cashier'), 'Caja 1', true);
select public.admin_update_user(:'uC', (select id from public.roles where name = 'waiter'),  'Mozo 1', true);
select public.admin_update_user(:'uD', (select id from public.roles where name = 'kitchen'), 'Cocina', true);
select test.raises(format('select public.admin_update_user(%L, (select id from public.roles where name = ''cashier''), ''x'', true)', :'uA'),
                   'LAST_ADMIN', 'no se puede quitar el rol de admin al último administrador');
select test.raises(format('select public.admin_update_user(%L, (select id from public.roles where name = ''admin''), ''x'', false)', :'uA'),
                   'LAST_ADMIN', 'no se puede desactivar al último administrador');
commit;

begin;
select test.login(:'uE');
select test.ok(not private.has_perm('orders.view'), 'usuario sin rol no tiene ningún permiso');
select test.ok((select count(*) from public.users) = 1, 'sin permiso users.manage solo ve su propio perfil');
select test.ok((public.get_my_profile() ->> 'role') is null, 'perfil de usuario sin rol: role = null');
commit;

-- ---------------------------------------------------------------------
\echo '=== 2. Carta y mesas (admin) + restricciones de integridad'
-- ---------------------------------------------------------------------
begin;
select test.login(:'uA');
insert into public.tables (number, name) values (1, null), (2, null), (3, 'Terraza');
insert into public.categories (id, name, sort_order, is_active) values
  ('10000000-0000-0000-0000-000000000001', 'Comidas', 1, true),
  ('10000000-0000-0000-0000-000000000002', 'Bebidas', 2, true),
  ('10000000-0000-0000-0000-000000000003', 'Oculta',  3, false);
insert into public.products (id, category_id, name, price, is_available, is_active) values
  (:'hb', '10000000-0000-0000-0000-000000000001', 'Hamburguesa', 20.00, true,  true),
  (:'pz', '10000000-0000-0000-0000-000000000001', 'Pizza',       30.00, false, true),   -- agotado
  (:'gs', '10000000-0000-0000-0000-000000000002', 'Gaseosa',     10.00, true,  true),
  (:'rt', '10000000-0000-0000-0000-000000000001', 'Retirado',    10.00, true,  false),  -- desactivado
  (:'eo', '10000000-0000-0000-0000-000000000003', 'EnOculta',    10.00, true,  true);   -- categoría inactiva
insert into public.promotions (name, discount_type, discount_value, category_id)
values ('Bebidas -10%', 'percent', 10, '10000000-0000-0000-0000-000000000002');
commit;

select test.raises($$insert into public.products (category_id, name, price) values ('10000000-0000-0000-0000-000000000001', 'Neg', -1)$$,
                   'products_price_check', 'precio negativo rechazado');
select test.raises($$insert into public.products (category_id, name, price) values ('10000000-0000-0000-0000-000000000001', 'hamburguesa', 5)$$,
                   'products_category_name_uq', 'nombre duplicado (sin distinguir mayúsculas) en la misma categoría rechazado');
select test.raises($$insert into public.promotions (name, discount_type, discount_value, product_id, category_id) values ('x','percent',10,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$$,
                   'promotions_single_target', 'promoción con producto y categoría a la vez rechazada');
select test.raises($$insert into public.promotions (name, discount_type, discount_value) values ('x','percent',150)$$,
                   'promotions_percent_max', 'descuento porcentual >100 rechazado');
select test.raises($$insert into public.tables (number) values (1)$$, 'tables_number_key', 'número de mesa duplicado rechazado');
select test.raises($$insert into public.restaurant_settings (id) values (2)$$, 'restaurant_settings_id_check', 'solo puede existir una fila de ajustes');
select test.raises($$delete from public.categories where name = 'Comidas'$$, 'violates foreign key', 'no se puede borrar una categoría con productos');

select t.qr_token as t1 from public.tables t where number = 1 \gset
select t.qr_token as t2 from public.tables t where number = 2 \gset
select test.ok(length(:'t1') = 20 and :'t1' <> :'t2', 'cada mesa tiene un token QR único y aleatorio');

-- ---------------------------------------------------------------------
\echo '=== 3. Cliente anónimo (QR): lectura pública y bloqueos'
-- ---------------------------------------------------------------------
begin;
select test.anon();
select test.ok((select count(*) from public.categories) = 2, 'anónimo solo ve categorías activas');
select test.ok((select count(*) from public.menu_products) = 3, 'menú público: solo productos activos de categorías activas (incluye el agotado, marcado is_available=false)');
select test.ok((select final_price from public.menu_products where name = 'Gaseosa') = 9.00, 'la vista aplica la promoción vigente (10 % → 9.00)');
select test.ok((select is_available from public.menu_products where name = 'Pizza') = false, 'producto agotado visible pero marcado como no disponible');
select test.raises('select * from public.tables',  'permission denied', 'anónimo NO puede leer mesas (ni sus tokens)');
select test.raises('select * from public.orders',  'permission denied', 'anónimo NO puede leer pedidos');
select test.raises('select * from public.payments','permission denied', 'anónimo NO puede leer pagos');
select test.raises('select * from public.users',   'permission denied', 'anónimo NO puede leer usuarios');
select test.raises($$insert into public.orders (table_id, channel) select id, 'qr' from public.tables limit 1$$, 'permission denied', 'anónimo NO puede insertar pedidos directamente');
select test.raises($$update public.products set price = 0.01$$, 'permission denied', 'anónimo NO puede modificar precios');
select test.raises($$select public.create_staff_order(gen_random_uuid(), '[]'::jsonb)$$, 'permission denied for function', 'anónimo NO puede llamar RPC del personal');
select test.raises($$select public.sales_report(current_date, current_date)$$, 'permission denied for function', 'anónimo NO puede pedir reportes');
select test.raises($$select private.create_order_core(null, 'qr', '[]'::jsonb, null, null, null)$$, 'permission denied', 'anónimo NO puede llamar el núcleo privado');
select test.ok((public.get_table_by_token(:'t1') ->> 'number')::int = 1, 'get_table_by_token resuelve la mesa a partir del token');
select test.raises(format('select public.get_table_by_token(%L)', 'token-inexistente'), 'INVALID_TABLE', 'token inválido rechazado');
commit;

-- ---------------------------------------------------------------------
\echo '=== 4. Pedidos por QR'
-- ---------------------------------------------------------------------
\set r1 '30000000-0000-0000-0000-000000000001'
\set r2 '30000000-0000-0000-0000-000000000002'
\set r3 '30000000-0000-0000-0000-000000000003'
\set r4 '30000000-0000-0000-0000-000000000004'
\set r9 '30000000-0000-0000-0000-000000000009'

begin;
select test.anon();
select (public.create_qr_order(:'t1',
          jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 2, 'notes', 'sin cebolla'),
                            jsonb_build_object('product_id', :'gs', 'quantity', 1)),
          :'r1') ->> 'order_id') as o1 \gset
-- el cliente intenta manipular precios enviando campos extra
select (public.create_qr_order(:'t1',
          jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1, 'unit_price', 0.01, 'list_price', 0.01, 'total', 0.01)),
          :'r2') ->> 'order_id') as o2 \gset
select (public.create_qr_order(:'t1', jsonb_build_array(jsonb_build_object('product_id', :'gs', 'quantity', 2)), :'r3') ->> 'order_id') as o3 \gset
commit;

select test.ok((select total from public.orders where id = :'o1') = 49.00, 'total del pedido QR calculado en el servidor (2×20 + 1×9 con promo = 49.00)');
select test.ok((select subtotal from public.orders where id = :'o1') = 50.00 and (select discount_total from public.orders where id = :'o1') = 1.00,
               'subtotal a precio de lista 50.00 y descuento 1.00');
select test.ok((select tax_amount from public.orders where id = :'o1') = 7.47, 'IGV incluido calculado (49 − 49/1.18 = 7.47)');
select test.ok((select channel::text || '/' || status::text || '/' || payment_status::text from public.orders where id = :'o1') = 'qr/pending/unpaid',
               'pedido QR nace como qr / pendiente / sin pagar');
select test.ok((select created_by is null from public.orders where id = :'o1'), 'el pedido QR no tiene usuario creador');
select test.ok((select unit_price from public.order_items where order_id = :'o2') = 20.00, 'precio manipulado por el cliente es ignorado (unit_price = 20.00)');
select test.ok((select total from public.orders where id = :'o2') = 20.00, 'total no manipulable (20.00)');
select test.ok((select string_agg(product_name || ':' || quantity || ':' || coalesce(notes, '-'), ',' order by line_no) from public.order_items where order_id = :'o1') = 'Hamburguesa:2:sin cebolla,Gaseosa:1:-',
               'ítems guardan nombre histórico, cantidad, observaciones y orden de línea');
select test.ok((select array_agg(order_number order by order_number) from public.orders) = array[1,2,3], 'numeración diaria correlativa 1,2,3');

begin;
select test.anon();
-- reintento (red inestable / doble clic) con la MISMA clave
select (public.create_qr_order(:'t1',
          jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 2), jsonb_build_object('product_id', :'gs', 'quantity', 1)),
          :'r1') ->> 'order_id') as o1_retry \gset
commit;
select test.ok(:'o1_retry' = :'o1', 'reenviar con la misma clave devuelve el MISMO pedido');
select test.ok((select count(*) from public.orders) = 3, 'no se duplicó el pedido');

begin;
select test.anon();
select test.raises(format('select public.create_qr_order(%L, %L::jsonb, %L::uuid)', :'t2', '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]', :'r1'),
                   'REQUEST_ID_CONFLICT', 'misma clave en OTRA mesa rechazada (no se filtran pedidos ajenos)');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'pz', 'quantity', 1)), :'r9', 'PRODUCT_UNAVAILABLE', 'producto agotado rechazado');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'rt', 'quantity', 1)), :'r9', 'PRODUCT_UNAVAILABLE', 'producto desactivado rechazado');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'eo', 'quantity', 1)), :'r9', 'PRODUCT_UNAVAILABLE', 'producto de categoría inactiva rechazado');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 1)), :'r9', 'PRODUCT_UNAVAILABLE', 'producto inexistente rechazado');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 0)),   :'r9', 'INVALID_ITEMS', 'cantidad 0 rechazada');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 100)), :'r9', 'INVALID_ITEMS', 'cantidad 100 rechazada');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', -1)),  :'r9', 'INVALID_ITEMS', 'cantidad negativa rechazada');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 'abc')), :'r9', 'INVALID_ITEMS', 'cantidad no numérica rechazada');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', 'no-es-uuid', 'quantity', 1)), :'r9', 'INVALID_ITEMS', 'product_id inválido rechazado');
select test.qr_fail(:'t2', '[]'::jsonb, :'r9', 'INVALID_ITEMS', 'carrito vacío rechazado');
select test.qr_fail(:'t2', '{"a":1}'::jsonb, :'r9', 'INVALID_ITEMS', 'items que no es arreglo rechazado');
select test.qr_fail(:'t2', (select jsonb_agg(jsonb_build_object('product_id', :'hb', 'quantity', 1)) from generate_series(1, 51)), :'r9', 'INVALID_ITEMS', 'más de 50 líneas rechazado');
select test.qr_fail('token-falso', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1)), :'r9', 'INVALID_TABLE', 'token QR inválido rechazado');
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1)), null, 'INVALID_REQUEST', 'el QR exige clave de idempotencia');
-- freno anti-spam: ya hay 3 pendientes en la mesa 1 (límite por defecto = 3)
select test.qr_fail(:'t1', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1)), :'r4', 'TOO_MANY_PENDING', 'límite de pedidos QR pendientes por mesa');
commit;

select test.ok((select count(*) from public.orders) = 3, 'los rechazos no dejaron pedidos a medias (sigue habiendo 3)');

begin;
select test.anon();
select test.ok(jsonb_array_length((public.get_table_orders(:'t1'))::jsonb) = 3, 'get_table_orders: la mesa 1 ve sus 3 pedidos en curso');
select test.ok(jsonb_array_length((public.get_table_orders(:'t2'))::jsonb) = 0, 'get_table_orders: la mesa 2 NO ve pedidos de la mesa 1');
commit;

-- interruptor general del QR
begin;
select test.login(:'uA');
update public.restaurant_settings set qr_ordering_enabled = false;
select test.anon();
select test.qr_fail(:'t2', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1)), :'r9', 'QR_DISABLED', 'pedidos QR desactivados desde Ajustes');
commit;
update public.restaurant_settings set qr_ordering_enabled = true;

-- vigencia de promociones
begin;
update public.promotions set ends_at = now() - interval '1 hour';
select test.anon();
select test.ok((select final_price from public.menu_products where name = 'Gaseosa') = 10.00, 'promoción vencida deja de aplicarse');
commit;
update public.promotions set ends_at = null;

-- ---------------------------------------------------------------------
\echo '=== 5. Pedidos internos (caja / mozo) y RLS del personal'
-- ---------------------------------------------------------------------
\set s1 '40000000-0000-0000-0000-000000000001'
begin;
select test.login(:'uC');   -- mozo
select (public.create_staff_order((select id from public.tables where number = 2),
          jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1), jsonb_build_object('product_id', :'gs', 'quantity', 1)),
          'mesa de cumpleaños', :'s1') ->> 'order_id') as os1 \gset
select (public.create_staff_order((select id from public.tables where number = 2),
          jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1), jsonb_build_object('product_id', :'gs', 'quantity', 1)),
          'mesa de cumpleaños', :'s1') ->> 'order_id') as os1_retry \gset
commit;
select test.ok(:'os1' = :'os1_retry', 'pedido interno idempotente (misma clave → mismo pedido)');
select test.ok((select channel::text from public.orders where id = :'os1') = 'internal', 'pedido interno con canal = internal');
select test.ok((select created_by from public.orders where id = :'os1') = :'uC', 'pedido interno registra quién lo creó');
select test.ok((select order_number from public.orders where id = :'os1') = 4, 'el pedido interno continúa la numeración diaria (4)');
select test.ok((select total from public.orders where id = :'os1') = 29.00, 'total interno 20 + 9 = 29.00');
select test.ok((select customer_note from public.orders where id = :'os1') = 'mesa de cumpleaños', 'observación general guardada');

begin;
select test.login(:'uD');   -- cocina
select test.raises(format('select public.create_staff_order(%L, %L::jsonb)', (select id from public.tables where number = 1), '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'),
                   'FORBIDDEN', 'cocina NO puede registrar pedidos');
select test.ok((select count(*) from public.orders) = 4, 'cocina puede ver los pedidos (RLS orders.view)');
select test.ok((select count(*) from public.order_items) >= 5, 'cocina puede ver los ítems');
commit;

begin;
select test.login(:'uE');   -- sin rol
select test.raises(format('select public.create_staff_order(%L, %L::jsonb)', (select id from public.tables where number = 1), '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'),
                   'FORBIDDEN', 'usuario sin rol NO puede registrar pedidos');
select test.ok((select count(*) from public.orders) = 0, 'usuario sin rol NO ve pedidos (RLS)');
select test.ok((select count(*) from public.tables) = 0, 'usuario sin rol NO ve mesas ni tokens (RLS)');
commit;

begin;
select test.login(:'uC');
select test.raises($$update public.orders set status = 'ready'$$, 'permission denied', 'el mozo NO puede cambiar estados con UPDATE directo');
select test.raises($$insert into public.order_items (order_id, product_id, product_name, list_price, unit_price, quantity) select id, '20000000-0000-0000-0000-000000000001', 'x', 0, 0, 1 from public.orders limit 1$$,
                   'permission denied', 'el mozo NO puede insertar ítems directamente');
select test.raises($$delete from public.orders$$, 'permission denied', 'el mozo NO puede borrar pedidos');
select test.raises(format('select public.create_staff_order(%L, %L::jsonb)', gen_random_uuid(), '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'),
                   'INVALID_TABLE', 'mesa inexistente rechazada');
commit;

-- ---------------------------------------------------------------------
\echo '=== 6. Estados: matriz de transiciones y permisos'
-- ---------------------------------------------------------------------
begin;
select test.login(:'uD');   -- cocina
select public.set_order_status(:'o1', 'preparing');
select test.ok((select preparing_at is not null from public.orders where id = :'o1'), 'pendiente → en preparación registra preparing_at');
select test.raises(format('select public.set_order_status(%L, ''delivered'')', :'o2'), 'INVALID_TRANSITION', 'pendiente → entregado está prohibido (no se saltan estados)');
select public.set_order_status(:'o1', 'ready');
select test.ok((select ready_at is not null from public.orders where id = :'o1'), 'en preparación → listo registra ready_at');
select test.raises(format('select public.set_order_status(%L, ''delivered'')', :'o1'), 'FORBIDDEN', 'cocina NO puede marcar entregado');
commit;

begin;
select test.login(:'uC');   -- mozo
select test.raises(format('select public.set_order_status(%L, ''preparing'')', :'o2'), 'FORBIDDEN', 'el mozo NO puede iniciar preparación');
select public.set_order_status(:'o1', 'delivered');
select test.ok((select delivered_at is not null from public.orders where id = :'o1'), 'listo → entregado registra delivered_at');
select test.ok((public.set_order_status(:'o1', 'delivered') ->> 'status') = 'delivered', 'doble toque en el mismo estado es inofensivo');
commit;

-- ---------------------------------------------------------------------
\echo '=== 7. Modificar y cancelar pedidos'
-- ---------------------------------------------------------------------
begin;
select test.login(:'uC');   -- mozo
select test.raises(format('select public.replace_order_items(%L, %L::jsonb)', :'os1', '[{"product_id":"20000000-0000-0000-0000-000000000002","quantity":1}]'),
                   'PRODUCT_UNAVAILABLE', 'al modificar, un producto agotado se rechaza');
select public.replace_order_items(:'os1', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 3, 'notes', 'bien cocida')), 'sin salsas');
select test.ok((select total from public.orders where id = :'os1') = 60.00, 'pedido modificado: total recalculado (3×20 = 60.00)');
select test.ok((select count(*) from public.order_items where order_id = :'os1') = 1, 'pedido modificado: ítems reemplazados');
select test.ok((select customer_note from public.orders where id = :'os1') = 'sin salsas', 'pedido modificado: observación actualizada');
select test.raises(format('select public.replace_order_items(%L, %L::jsonb)', :'o1', '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'),
                   'ORDER_NOT_EDITABLE', 'un pedido ya entregado NO se puede modificar');
select test.raises(format('select public.cancel_order(%L)', :'o3'), 'FORBIDDEN', 'el mozo NO puede cancelar pedidos');
commit;

begin;
select test.login(:'uD');   -- cocina
select test.raises(format('select public.replace_order_items(%L, %L::jsonb)', :'os1', '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'),
                   'FORBIDDEN', 'cocina NO puede modificar pedidos');
commit;

begin;
select test.login(:'uB');   -- caja
select public.cancel_order(:'o3', 'cliente se fue');
select test.ok((select status::text || '/' || cancelled_reason from public.orders where id = :'o3') = 'cancelled/cliente se fue', 'caja cancela pedido con motivo');
select test.ok((select cancelled_at is not null and cancelled_by = :'uB' from public.orders where id = :'o3'), 'se registra quién y cuándo canceló');
select test.raises(format('select public.cancel_order(%L)', :'o3'), 'ORDER_NOT_CANCELLABLE', 'no se cancela dos veces');
select test.raises(format('select public.cancel_order(%L)', :'o1'), 'ORDER_NOT_CANCELLABLE', 'no se cancela un pedido ya entregado');
select test.raises(format('select public.set_order_status(%L, ''preparing'')', :'o3'), 'INVALID_TRANSITION', 'un pedido cancelado no cambia de estado');
commit;

-- al cancelar un pendiente se libera cupo QR en la mesa 1 → el cliente puede volver a pedir
begin;
select test.anon();
select (public.create_qr_order(:'t1', jsonb_build_array(jsonb_build_object('product_id', :'hb', 'quantity', 1)), :'r4') ->> 'order_id') as o4 \gset
commit;
select test.ok((select order_number from public.orders where id = :'o4') = 5, 'tras cancelar, la mesa vuelve a poder pedir (pedido #5)');

-- ---------------------------------------------------------------------
\echo '=== 8. Pagos y cierre de cuenta'
-- ---------------------------------------------------------------------
begin;
select test.login(:'uC');   -- mozo
select test.raises(format('select public.register_payment(array[%L]::uuid[], ''cash'')', :'o2'), 'FORBIDDEN', 'el mozo NO puede cobrar');
select test.raises($$insert into public.payments (order_id, method, amount) select id, 'cash', 1 from public.orders limit 1$$, 'permission denied', 'nadie inserta pagos con INSERT directo');
commit;

begin;
select test.login(:'uB');   -- caja
select (public.register_payment(array[:'o1', :'o2']::uuid[], 'cash', 'billete de 100') ->> 'total') as paid_total \gset
select test.ok(:'paid_total'::numeric = 69.00, 'cierre de cuenta de varios pedidos: total cobrado 49 + 20 = 69.00');
select test.ok((select count(*) from public.payments) = 2, 'se crea un pago por pedido');
select test.ok((select count(distinct group_id) from public.payments) = 1, 'los pagos del mismo cierre comparten group_id');
select test.ok((select bool_and(p.amount = o.total and p.method = 'cash' and p.received_by = :'uB') from public.payments p join public.orders o on o.id = p.order_id), 'pago = total del pedido, método y cajero registrados');
select test.ok((select bool_and(payment_status = 'paid' and paid_at is not null) from public.orders where id in (:'o1', :'o2')), 'pedidos quedan pagados con paid_at');
select test.raises(format('select public.register_payment(array[%L]::uuid[], ''card'')', :'o1'), 'ALREADY_PAID', 'no se cobra dos veces el mismo pedido');
select test.raises(format('select public.register_payment(array[%L]::uuid[], ''card'')', :'o3'), 'ORDER_CANCELLED', 'no se cobra un pedido cancelado');
select test.raises(format('select public.register_payment(array[%L]::uuid[], ''card'')', gen_random_uuid()), 'ORDER_NOT_FOUND', 'pedido inexistente rechazado');
select test.raises($$select public.register_payment(array[]::uuid[], 'card')$$, 'INVALID_REQUEST', 'lista de pedidos vacía rechazada');
select test.raises(format('select public.register_payment(array[%L, %L]::uuid[], ''card'')', :'o4', :'o3'), 'ORDER_CANCELLED', 'si uno de los pedidos es inválido NO se cobra ninguno');
select test.ok((select payment_status::text from public.orders where id = :'o4') = 'unpaid', 'la transacción fallida no dejó pedidos a medias');
select public.register_payment(array[:'o4', :'o4']::uuid[], 'wallet', 'Yape 987');
select test.ok((select count(*) from public.payments where order_id = :'o4') = 1, 'ids repetidos en la lista se cobran una sola vez');
select test.raises(format('select public.replace_order_items(%L, %L::jsonb)', :'o4', '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'), 'ORDER_NOT_EDITABLE', 'un pedido pagado no se modifica');
select test.raises(format('select public.cancel_order(%L)', :'o4'), 'ORDER_NOT_CANCELLABLE', 'un pedido pagado no se cancela');
select test.ok((select count(*) from public.payments) = 3, 'caja puede leer los pagos');
commit;

begin;
select test.login(:'uD');   -- cocina
select test.ok((select count(*) from public.payments) = 0, 'cocina NO ve pagos (RLS)');
commit;
begin;
select test.login(:'uC');   -- mozo
select test.ok((select count(*) from public.payments) = 0, 'el mozo NO ve pagos (RLS)');
commit;

begin;
select test.anon();
select test.ok(jsonb_array_length((public.get_table_orders(:'t1'))::jsonb) = 1, 'el cliente deja de ver los pedidos ya pagados (solo queda el cancelado sin pagar)');
commit;

-- ---------------------------------------------------------------------
\echo '=== 9. Permisos de administración (RLS de configuración)'
-- ---------------------------------------------------------------------
begin;
select test.login(:'uB');   -- caja
select test.raises($$insert into public.products (category_id, name, price) values ('10000000-0000-0000-0000-000000000001', 'Hack', 1)$$,
                   'row-level security', 'caja NO puede crear productos (RLS)');
select test.ok(test.affected($q$update public.restaurant_settings set name = 'Hack'$q$) = 0, 'caja NO puede cambiar los ajustes (0 filas afectadas)');
select test.ok(test.affected($q$update public.products set price = 0.01$q$) = 0, 'caja NO puede cambiar precios (0 filas afectadas)');
select test.raises(format('select public.regenerate_table_token(%L)', (select id from public.tables where number = 1)), 'FORBIDDEN', 'caja NO regenera tokens QR');
select test.raises(format('select public.admin_update_user(%L, 1::smallint, ''x'', true)', :'uC'), 'FORBIDDEN', 'caja NO administra usuarios');
select test.ok((select count(*) from public.users) = 1, 'caja solo ve su propio usuario');
commit;
select test.ok((select name from public.restaurant_settings) = 'Mi Restaurante', 'los ajustes siguen intactos');

begin;
select test.login(:'uA');   -- admin
select public.regenerate_table_token((select id from public.tables where number = 1)) as newtok \gset
commit;
select test.ok(:'newtok' <> :'t1', 'el admin regenera el token QR de una mesa');
begin;
select test.anon();
select test.raises(format('select public.get_table_by_token(%L)', :'t1'), 'INVALID_TABLE', 'el QR impreso anterior deja de funcionar');
select test.ok((public.get_table_by_token(:'newtok') ->> 'number')::int = 1, 'el token nuevo funciona');
commit;

-- ---------------------------------------------------------------------
\echo '=== 10. Reportes'
-- ---------------------------------------------------------------------
begin;
select test.login(:'uC');
select test.raises($$select public.sales_report(current_date - 2, current_date + 2)$$, 'FORBIDDEN', 'el mozo NO ve reportes');
select test.login(:'uB');
select test.raises($$select public.sales_report(current_date, current_date - 1)$$, 'INVALID_RANGE', 'rango de fechas inválido rechazado');
select public.sales_report(current_date - 2, current_date + 2)::jsonb as rep \gset
commit;
select test.ok((:'rep'::jsonb #>> '{summary,orders}')::int = 3, 'reporte: 3 pedidos pagados');
select test.ok((:'rep'::jsonb #>> '{summary,total}')::numeric = 89.00, 'reporte: ventas 49 + 20 + 20 = 89.00');
select test.ok((:'rep'::jsonb ->> 'cancelled')::int = 1, 'reporte: 1 pedido cancelado');
select test.ok((:'rep'::jsonb #>> '{by_method,0,method}') = 'cash' or (:'rep'::jsonb #>> '{by_method,1,method}') = 'cash', 'reporte: desglose por método de pago');
select test.ok((:'rep'::jsonb #>> '{top_products,0,name}') = 'Hamburguesa' and (:'rep'::jsonb #>> '{top_products,0,quantity}')::int = 4, 'reporte: producto más vendido (Hamburguesa ×4)');

-- ---------------------------------------------------------------------
\echo '=== 11. Numeración, impuestos, Realtime, Storage y privilegios'
-- ---------------------------------------------------------------------
select test.ok((select count(*) = count(distinct order_number) and max(order_number) = count(*) from public.orders), 'numeración diaria sin huecos ni repetidos');

update public.restaurant_settings set prices_include_tax = false;
begin;
select test.login(:'uC');
select (public.create_staff_order((select id from public.tables where number = 3), jsonb_build_array(jsonb_build_object('product_id', :'gs', 'quantity', 1))) ->> 'order_id') as otax \gset
commit;
update public.restaurant_settings set prices_include_tax = true;
select test.ok((select total from public.orders where id = :'otax') = 10.62, 'precios SIN impuesto incluido: 9.00 + 18 % = 10.62');

select test.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'orders'), 'Realtime publica orders');
select test.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'products'), 'Realtime publica products');
select test.ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_items'), 'Realtime NO publica order_items (ahorra mensajes del plan gratuito)');
select test.ok((select count(*) from storage.buckets where id = 'product-images' and public) = 1, 'bucket público product-images creado');
select test.ok((select count(*) from pg_policies where schemaname = 'storage' and policyname like 'product_images_%') = 3, 'políticas de Storage: solo menu.manage escribe');

select test.ok(has_function_privilege('anon', 'public.create_qr_order(text,jsonb,uuid,text,uuid)', 'execute'), 'anon puede llamar create_qr_order');
select test.ok(has_function_privilege('anon', 'public.get_table_by_token(text)', 'execute'), 'anon puede llamar get_table_by_token');
select test.ok(has_function_privilege('anon', 'public.get_table_orders(text,uuid)', 'execute'), 'anon puede llamar get_table_orders');
select test.ok(not has_function_privilege('anon', 'public.create_staff_order(uuid,jsonb,text,uuid)', 'execute'), 'anon NO puede llamar create_staff_order');
select test.ok(not has_function_privilege('anon', 'public.register_payment(uuid[],public.payment_method,text)', 'execute'), 'anon NO puede llamar register_payment');
select test.ok(not has_function_privilege('authenticated', 'private.create_order_core(uuid,public.order_channel,jsonb,text,uuid,uuid)', 'execute'), 'ni siquiera authenticated puede llamar el núcleo privado');
select test.ok(not has_function_privilege('authenticated', 'private.price_items(jsonb)', 'execute'), 'authenticated NO puede llamar price_items directamente');
select test.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'TODAS las tablas de public tienen RLS activado');

\echo '=== TODAS LAS PRUEBAS PASARON ==='
