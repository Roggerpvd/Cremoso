-- =====================================================================
--  Pruebas de la migración 5: sin puesto "Mozo" y Cocina marca entregado.
--  Se ejecuta DESPUÉS de 01_tests.sql (usa sus usuarios) y todo se deshace al final (rollback).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\set uA '00000000-0000-0000-0000-00000000000a'
\set uB '00000000-0000-0000-0000-00000000000b'
\set uC '00000000-0000-0000-0000-00000000000c'
\set uD '00000000-0000-0000-0000-00000000000d'
\set uE '00000000-0000-0000-0000-00000000000e'
\set item '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":1}]'

\echo '=== 8. Migración 5: sin Mozo, Cocina entrega'
begin;
-- uC tiene el puesto de pruebas "waiter" (lo creó 01_tests): la migración lo retira y lo pasa a Caja
select test.ok((select role_id from public.users where id = :'uC') = (select id from public.roles where name = 'waiter'), 'antes: el usuario de prueba tiene el puesto waiter');
\i supabase/migrations/20260105000000_sin_mozo_entrega_cocina.sql
select test.ok(not exists (select 1 from public.roles where name = 'waiter'), 'el puesto Mozo desaparece');
select test.ok((select role_id from public.users where id = :'uC') = (select id from public.roles where name = 'cashier'), 'sus usuarios pasan a Caja (no se quedan sin acceso)');
select test.ok((select 'orders.serve' = any (permissions) from public.roles where name = 'kitchen'), 'Cocina tiene el permiso de entregar');
select test.ok((select permissions from public.roles where name = 'kitchen') = array['orders.kitchen','orders.serve','orders.view'], 'Cocina conserva sus demás permisos, sin duplicados');
\i supabase/migrations/20260105000000_sin_mozo_entrega_cocina.sql
select test.ok((select permissions from public.roles where name = 'kitchen') = array['orders.kitchen','orders.serve','orders.view'], 'repetir la migración no cambia nada (idempotente)');
select test.ok((select array_agg(name order by name) from public.roles where is_system) = array['admin','cashier','kitchen'], 'los puestos del sistema son solo Administrador, Caja y Cocina');

-- Cocina entrega de punta a punta
select test.login(:'uB');
select (public.create_staff_order(null, :'item'::jsonb, null, gen_random_uuid()) ->> 'order_id') as ox \gset
select test.login(:'uD');
select public.set_order_status(:'ox', 'preparing');
select public.set_order_status(:'ox', 'ready');
select test.ok((public.set_order_status(:'ox', 'delivered') ->> 'status') = 'delivered', 'Cocina: pendiente → preparación → listo → «Marcar como entregado»');
select test.ok((select delivered_at is not null from public.orders where id = :'ox'), 'queda registrada la hora de entrega');

-- Un puesto sin el permiso de entregar sigue sin poder hacerlo
select test.login(:'uB');
select (public.create_staff_order(null, :'item'::jsonb, null, gen_random_uuid()) ->> 'order_id') as oy \gset
select test.login(:'uD');
select public.set_order_status(:'oy', 'preparing');
select public.set_order_status(:'oy', 'ready');
select test.login(:'uA');
select (public.admin_save_role(null, 'Solo preparar', array['orders.view','orders.kitchen']) ->> 'role_id') as rp \gset
select public.admin_update_user(:'uE', :'rp'::smallint, 'Prepara', true);
select test.login(:'uE');
select test.raises(format('select public.set_order_status(%L, ''delivered'')', :'oy'), 'FORBIDDEN', 'un puesto sin orders.serve no puede marcar entregado');
rollback;
\echo '=== Sin Mozo y entrega desde Cocina OK'
