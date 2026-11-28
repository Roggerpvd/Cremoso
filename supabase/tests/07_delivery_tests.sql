-- =====================================================================
--  Pruebas de la migración 6: delivery (pedido con datos de entrega, envío, despacho y permisos).
--  Se ejecuta DESPUÉS de 01_tests.sql (usa sus usuarios y el producto de 04_notable_roles_tests.sql).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\set uA '00000000-0000-0000-0000-00000000000a'
\set uB '00000000-0000-0000-0000-00000000000b'
\set uD '00000000-0000-0000-0000-00000000000d'
\set uE '00000000-0000-0000-0000-00000000000e'
\set item '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":2}]'
\set item3 '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":3}]'

\echo '=== 9. Delivery'
update public.restaurant_settings set delivery_enabled = true, delivery_fee_default = 3, delivery_min_order = 0 where id = 1;
select (case when prices_include_tax then 3::numeric else round(3 * (1 + tax_rate), 2) end) as fee3 from public.restaurant_settings where id = 1 \gset

begin;
select test.login(:'uB');   -- caja
select (public.create_staff_order(null, :'item'::jsonb, null, gen_random_uuid()) ->> 'total') as local_total \gset
select (public.create_delivery_order(:'item'::jsonb, '  María Pérez ', '+51 987-654-321', ' Av. Los Pinos 123, Ilo ', 'Frente al parque', null, null, 'sin picante', 'c0000000-0000-0000-0000-000000000001') ->> 'order_id') as d1 \gset
select test.ok((select order_kind = 'delivery' and table_id is null and channel = 'internal' from public.orders where id = :'d1'), 'el delivery es un pedido sin mesa, de tipo delivery');
select test.ok((select delivery_name = 'María Pérez' and delivery_phone = '987654321' and delivery_address = 'Av. Los Pinos 123, Ilo' and delivery_reference = 'Frente al parque' from public.orders where id = :'d1'), 'guarda cliente, teléfono limpio (sin +51), dirección y referencia');
select test.ok((select delivery_fee = 3 from public.orders where id = :'d1'), 'sin costo indicado usa el envío por defecto de Ajustes');
select test.ok((select total from public.orders where id = :'d1') = :'local_total'::numeric + :'fee3'::numeric, 'el total suma el envío al consumo');
select test.ok((public.create_delivery_order(:'item'::jsonb, 'María Pérez', '987654321', 'Av. Los Pinos 123', null, null, null, null, 'c0000000-0000-0000-0000-000000000001') ->> 'duplicate')::boolean, 'reintentar el mismo envío no duplica el pedido');
select test.ok((select total from public.orders where id = :'d1') = :'local_total'::numeric + :'fee3'::numeric, 'y no suma el envío por segunda vez');
select (public.create_delivery_order(:'item'::jsonb, 'Luis', '053481234', 'Jr. Lima 45', null, 5, 100, null, gen_random_uuid()) ->> 'order_id') as d2 \gset
select test.ok((select delivery_fee = 5 and delivery_change_for = 100 from public.orders where id = :'d2'), 'se puede indicar otro costo de envío y con cuánto paga el cliente');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''X'', ''987654321'', ''Av. Los Pinos 123'')', :'item'), 'INVALID_CUSTOMER_NAME', 'nombre demasiado corto');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''123'', ''Av. Los Pinos 123'')', :'item'), 'INVALID_PHONE', 'teléfono inválido');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''ab'')', :'item'), 'INVALID_ADDRESS', 'dirección demasiado corta');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'', null, -1)', :'item'), 'INVALID_FEE', 'envío negativo');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'', null, 500)', :'item'), 'INVALID_FEE', 'envío exagerado');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'', null, null, 5)', :'item'), 'INVALID_CHANGE', '«paga con» menor que el total');
commit;

-- Ajustes: apagado y pedido mínimo
update public.restaurant_settings set delivery_enabled = false where id = 1;
begin;
select test.login(:'uB');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'')', :'item'), 'DELIVERY_DISABLED', 'con el delivery apagado no se aceptan pedidos');
commit;
update public.restaurant_settings set delivery_enabled = true, delivery_min_order = 500 where id = 1;
begin;
select test.login(:'uB');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'')', :'item'), 'BELOW_MIN_ORDER', 'pedido mínimo de delivery');
commit;
select test.ok((select count(*) from public.orders where delivery_name = 'Ana') = 0, 'un delivery rechazado no deja pedidos a medias');
update public.restaurant_settings set delivery_min_order = 0 where id = 1;

-- Permisos de creación
begin;
select test.login(:'uD');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'')', :'item'), 'FORBIDDEN', 'cocina no puede crear deliveries');
commit;
begin;
select test.anon();
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'')', :'item'), 'permission denied for function', 'anónimo no puede crear deliveries');
select test.raises(format('select public.dispatch_delivery(%L)', :'d1'), 'permission denied for function', 'anónimo no puede despachar');
commit;

-- Cocina prepara, pero no entrega un delivery
begin;
select test.login(:'uD');
select test.ok((select count(*) from public.orders where id = :'d1') = 1, 'cocina ve el delivery');
select public.set_order_status(:'d1', 'preparing');
select public.set_order_status(:'d1', 'ready');
select test.raises(format('select public.set_order_status(%L, ''delivered'')', :'d1'), 'FORBIDDEN', 'cocina NO puede marcar entregado un delivery');
select test.raises(format('select public.dispatch_delivery(%L, ''Luis'')', :'d1'), 'FORBIDDEN', 'cocina no despacha');
commit;

-- Despacho (caja tiene orders.delivery)
begin;
select test.login(:'uB');
select test.raises(format('select public.dispatch_delivery(%L, ''Luis'')', :'d2'), 'ORDER_NOT_READY', 'no se despacha un pedido que aún no está listo');
select test.raises(format('select public.set_order_status(%L, ''delivered'')', :'d1'), 'NOT_DISPATCHED', 'no se entrega sin haber salido con el repartidor');
select test.ok((public.dispatch_delivery(:'d1', '  Luis R. ') ->> 'dispatched')::boolean, 'despachar un delivery listo');
select test.ok((select dispatched_at is not null and driver_name = 'Luis R.' from public.orders where id = :'d1'), 'queda la hora de salida y el repartidor');
select public.dispatch_delivery(:'d1', 'Carlos');
select test.ok((select driver_name = 'Carlos' and dispatched_at is not null from public.orders where id = :'d1'), 'volver a despachar solo corrige el repartidor');
select public.undo_dispatch_delivery(:'d1');
select test.ok((select dispatched_at is null and driver_name is null from public.orders where id = :'d1'), 'se puede deshacer la salida');
select public.dispatch_delivery(:'d1', 'Luis');
select test.ok((public.set_order_status(:'d1', 'delivered') ->> 'status') = 'delivered', 'ya despachado, caja lo marca como entregado');
select test.ok((select delivered_at is not null from public.orders where id = :'d1'), 'queda la hora de entrega');
-- un pedido normal no se despacha
select (public.create_staff_order(null, :'item'::jsonb, null, gen_random_uuid()) ->> 'order_id') as loc \gset
commit;
begin;
select test.login(:'uD');
select public.set_order_status(:'loc', 'preparing'); select public.set_order_status(:'loc', 'ready');
commit;
begin;
select test.login(:'uB');
select test.raises(format('select public.dispatch_delivery(%L)', :'loc'), 'NOT_DELIVERY', 'un pedido de local no se despacha');
commit;
-- volver a cocina limpia la salida
begin;
select test.login(:'uD');
select public.set_order_status(:'d2', 'preparing'); select public.set_order_status(:'d2', 'ready');
commit;
begin;
select test.login(:'uB');
select public.dispatch_delivery(:'d2', 'Pedro');
commit;
begin;
select test.login(:'uD');
select public.set_order_status(:'d2', 'preparing');
select test.ok((select dispatched_at is null from public.orders where id = :'d2'), 'si vuelve a preparación, se borra la salida');
commit;

-- Editar los productos de un delivery pendiente conserva el envío
begin;
select test.login(:'uB');
select (public.create_delivery_order(:'item'::jsonb, 'Rosa', '987654322', 'Calle Mar 10', null, 4, null, null, gen_random_uuid()) ->> 'order_id') as d3 \gset
select (case when prices_include_tax then 4::numeric else round(4 * (1 + tax_rate), 2) end) as fee4 from public.restaurant_settings where id = 1 \gset
select public.replace_order_items(:'d3', :'item3'::jsonb);
select test.ok((select total from public.orders where id = :'d3') = (select sum(line_total) from public.order_items where order_id = :'d3') * (select case when prices_include_tax then 1 else 1 + tax_rate end from public.restaurant_settings where id = 1) + :'fee4'::numeric, 'al editar los productos, el total sigue incluyendo el envío');
commit;

-- Cobro de un delivery (el envío forma parte del total)
begin;
select test.login(:'uB');
select test.ok((public.register_payment(array[:'d3']::uuid[], 'cash', null) ->> 'orders')::int = 1, 'se cobra el delivery con su envío');
commit;

-- Integridad
select test.raises(format('update public.orders set delivery_name = null where id = %L', :'d2'), 'violates check constraint', 'un delivery no puede quedar sin nombre, teléfono o dirección');
select test.raises(format('update public.orders set table_id = (select id from public.tables limit 1) where id = %L', :'d2'), 'violates check constraint', 'un delivery no puede tener mesa');

-- Permisos y puestos
select test.ok((select 'orders.delivery' = any (permissions) from public.roles where name = 'cashier'), 'Caja puede despachar y entregar deliveries');
select test.ok(not (select 'orders.delivery' = any (permissions) from public.roles where name = 'kitchen'), 'Cocina no tiene ese permiso');
begin;
select test.login(:'uA');
select (public.admin_save_role(null, 'Repartidor', array['orders.view','orders.delivery']) ->> 'role_id') as rr \gset
select public.admin_update_user(:'uE', :'rr'::smallint, 'Repartidor prueba', true);
commit;
begin;
select test.login(:'uB');
select (public.create_delivery_order(:'item'::jsonb, 'Elena', '987654323', 'Calle Sol 5', null, 3, null, null, gen_random_uuid()) ->> 'order_id') as d4 \gset
commit;
begin;
select test.login(:'uD');
select public.set_order_status(:'d4', 'preparing'); select public.set_order_status(:'d4', 'ready');
commit;
begin;
select test.login(:'uE');
select test.ok((public.dispatch_delivery(:'d4', 'Repartidor 1') ->> 'dispatched')::boolean, 'el puesto Repartidor despacha');
select test.ok((public.set_order_status(:'d4', 'delivered') ->> 'status') = 'delivered', 'y marca el delivery como entregado');
select test.raises(format('select public.set_order_status(%L, ''ready'')', :'d2'), 'FORBIDDEN', 'pero no puede marcar pedidos como listos (eso es de cocina)');
commit;
begin;
select test.login(:'uE');
select test.raises(format('select public.create_delivery_order(%L::jsonb, ''Ana'', ''987654321'', ''Av. Los Pinos 123'')', :'item'), 'FORBIDDEN', 'el puesto Repartidor no puede crear pedidos');
commit;

-- Datos públicos de la carta
begin;
select test.anon();
select test.ok((public.get_public_info() -> 'delivery_enabled')::text = 'true' and (public.get_public_info() ->> 'delivery_fee')::numeric = 3, 'get_public_info incluye lo necesario para pedir por WhatsApp');
commit;

-- Limpieza para no afectar a las demás pruebas
update public.users set role_id = null where id = :'uE';
delete from public.roles where id = :'rr';
update public.restaurant_settings set delivery_fee_default = 0 where id = 1;
\echo '=== Delivery OK'
