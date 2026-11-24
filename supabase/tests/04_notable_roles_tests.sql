-- =====================================================================
--  Pruebas de la migración 3: pedidos sin mesa y puestos (roles) administrables.
--  Se ejecuta DESPUÉS de 01_tests.sql (usa sus usuarios y funciones test.*).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\set uA '00000000-0000-0000-0000-00000000000a'
\set uB '00000000-0000-0000-0000-00000000000b'
\set uC '00000000-0000-0000-0000-00000000000c'
\set uD '00000000-0000-0000-0000-00000000000d'
\set uE '00000000-0000-0000-0000-00000000000e'
\set pn '20000000-0000-0000-0000-0000000000a1'

\echo '=== 4. Pedidos sin mesa'
begin;
select test.login(:'uA');
insert into public.products (id, category_id, name, price) values (:'pn', (select id from public.categories order by created_at limit 1), 'Café para llevar', 10);
commit;

begin;
select test.login(:'uB');  -- caja
select (public.create_staff_order(null, '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb, 'para llevar', 'a0000000-0000-0000-0000-000000000001') ->> 'order_id') as n1 \gset
select test.ok((select table_id from public.orders where id = :'n1') is null, 'pedido sin mesa: se guarda con table_id nulo');
select test.ok((select channel::text from public.orders where id = :'n1') = 'internal', 'pedido sin mesa: canal interno');
select test.ok((select total from public.orders where id = :'n1') = 20, 'pedido sin mesa: calcula el total igual que uno con mesa');
-- idempotencia con table_id nulo (antes del cambio, "null <> null" rompía el reintento)
select test.ok((public.create_staff_order(null, '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb, 'para llevar', 'a0000000-0000-0000-0000-000000000001') ->> 'order_id') = :'n1',
               'pedido sin mesa: repetir la misma clave devuelve el mismo pedido (sin duplicar)');
select test.raises($$select public.create_staff_order((select id from public.tables order by number limit 1), '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":2}]'::jsonb, 'para llevar', 'a0000000-0000-0000-0000-000000000001')$$,
                   'REQUEST_ID_CONFLICT', 'misma clave con otra mesa (o con/sin mesa) se rechaza');
select test.raises($$select public.create_staff_order(gen_random_uuid(), '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":1}]'::jsonb)$$,
                   'INVALID_TABLE', 'una mesa inexistente sigue siendo inválida (solo null significa "sin mesa")');
select (public.create_staff_order(null, '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":1}]'::jsonb, null, gen_random_uuid()) ->> 'order_id') as n2 \gset
commit;

begin;
select test.login(:'uD');  -- cocina ve y trabaja el pedido sin mesa
select test.ok((select count(*) from public.orders where id in (:'n1', :'n2')) = 2, 'cocina ve los pedidos sin mesa');
select test.ok((public.set_order_status(:'n1', 'preparing') ->> 'status') = 'preparing', 'cocina pasa un pedido sin mesa a "en preparación"');
commit;

begin;
select test.login(:'uB');
select test.ok((public.register_payment(array[:'n1']::uuid[], 'cash', null) ->> 'orders')::int = 1, 'se cobra un pedido sin mesa por separado');
select test.ok((public.register_payment(array[:'n2']::uuid[], 'card', 'Visa 0000') ->> 'orders')::int = 1, 'otro pedido sin mesa se cobra aparte (no se agrupan entre sí)');
select test.ok((select payment_status::text from public.orders where id = :'n1') = 'paid', 'el pedido sin mesa queda pagado');
commit;

\echo '=== 5. Puestos (roles) administrables'
begin;
select test.login(:'uA');
select (public.admin_save_role(null, '  Barista  ', array['orders.view','orders.create','orders.create']) ->> 'role_id') as r1 \gset
select test.ok((select name from public.roles where id = :'r1') = 'barista', 'puesto nuevo: el identificador se genera del nombre');
select test.ok((select label from public.roles where id = :'r1') = 'Barista', 'puesto nuevo: se recorta el nombre');
select test.ok(not (select is_system from public.roles where id = :'r1'), 'puesto nuevo: no es del sistema');
select test.ok((select permissions from public.roles where id = :'r1') = array['orders.create','orders.view'], 'puesto nuevo: permisos sin repetidos');
select (public.admin_save_role(null, 'Barista', array['orders.view']) ->> 'role_id') as r2 \gset
select test.ok((select name from public.roles where id = :'r2') <> 'barista', 'dos puestos con el mismo nombre reciben identificadores distintos');
select (public.admin_save_role(null, 'Cajero Noche 2', array[]::text[]) ->> 'role_id') as r3 \gset
select test.ok((select name from public.roles where id = :'r3') ~ '^cajero_noche', 'el identificador respeta la restricción (solo letras y guion bajo)');
select public.admin_save_role(:'r1'::smallint, 'Barista Senior', array['orders.view','orders.create','orders.serve']);
select test.ok((select label from public.roles where id = :'r1') = 'Barista Senior' and (select 'orders.serve' = any(permissions) from public.roles where id = :'r1'), 'se puede editar un puesto');
select test.raises($$select public.admin_save_role(null, 'X', array['orders.view'])$$, 'INVALID_ROLE', 'nombre demasiado corto');
select test.raises($$select public.admin_save_role(null, 'Hacker', array['*'])$$, 'INVALID_PERMISSION', 'el comodín * no se puede asignar a un puesto nuevo');
select test.raises($$select public.admin_save_role(null, 'Hacker', array['orders.view','inventado.todo'])$$, 'INVALID_PERMISSION', 'un permiso desconocido se rechaza');
select test.raises($$select public.admin_save_role((select id from public.roles where name = 'admin'), 'Admin', array['orders.view'])$$, 'SYSTEM_ROLE', 'el rol admin no se puede modificar');
select test.raises($$select public.admin_delete_role((select id from public.roles where name = 'admin'))$$, 'SYSTEM_ROLE', 'el rol admin no se puede eliminar');
select test.raises($$select public.admin_delete_role((select id from public.roles where name = 'cashier'))$$, 'SYSTEM_ROLE', 'los puestos del sistema no se eliminan');
select test.raises($$select public.admin_save_role(32000::smallint, 'Fantasma', array['orders.view'])$$, 'ROLE_NOT_FOUND', 'editar un puesto inexistente');
commit;

-- Un usuario con el puesto nuevo recibe exactamente esos permisos
begin;
select test.login(:'uA');
select public.admin_update_user(:'uE', :'r1'::smallint, 'Barista 1', true);
commit;
begin;
select test.login(:'uE');
select test.ok(private.has_perm('orders.create') and private.has_perm('orders.serve'), 'el usuario con el puesto nuevo tiene sus permisos');
select test.ok(not private.has_perm('payments.register') and not private.has_perm('orders.cancel'), 'y NO tiene permisos que el puesto no incluye');
select test.ok((public.create_staff_order(null, '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":1}]'::jsonb, null, gen_random_uuid()) ->> 'order_number') is not null, 'el puesto nuevo puede tomar pedidos sin mesa');
select test.raises($$select public.register_payment(array[gen_random_uuid()]::uuid[], 'cash', null)$$, 'FORBIDDEN', 'el puesto nuevo no puede cobrar');
select test.raises($$select public.admin_save_role(null, 'Otro', array['orders.view'])$$, 'FORBIDDEN', 'sin users.manage no se crean puestos');
commit;

begin;
select test.login(:'uB');  -- caja
select test.raises($$select public.admin_save_role(null, 'Otro', array['orders.view'])$$, 'FORBIDDEN', 'caja no puede crear puestos');
select test.raises($$select public.admin_delete_role(1::smallint)$$, 'FORBIDDEN', 'caja no puede eliminar puestos');
commit;
begin;
select test.anon();
select test.raises($$select public.admin_save_role(null, 'Anon', array['orders.view'])$$, 'permission denied for function', 'anónimo no puede llamar admin_save_role');
select test.raises($$select public.admin_delete_role(1::smallint)$$, 'permission denied for function', 'anónimo no puede llamar admin_delete_role');
commit;

begin;
select test.login(:'uA');
select test.raises(format('select public.admin_delete_role(%L::smallint)', :'r1'), 'ROLE_IN_USE', 'no se elimina un puesto con usuarios asignados');
select public.admin_update_user(:'uE', null, 'Barista 1', true);
select public.admin_delete_role(:'r1'::smallint);
select test.ok(not exists (select 1 from public.roles where id = :'r1'), 'sin usuarios, el puesto se elimina');
commit;
\echo '=== Pedidos sin mesa y puestos OK'
