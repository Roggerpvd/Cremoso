-- =====================================================================
--  Pruebas de la migración 4: sesiones de mesa, confirmación del personal y baja de personal.
--  Se ejecuta DESPUÉS de 01_tests.sql y 04_notable_roles_tests.sql (usa sus usuarios y mesas).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\set uA '00000000-0000-0000-0000-00000000000a'
\set uB '00000000-0000-0000-0000-00000000000b'
\set uD '00000000-0000-0000-0000-00000000000d'
\set uE '00000000-0000-0000-0000-00000000000e'
\set pn '20000000-0000-0000-0000-0000000000a1'
\set item '[{"product_id":"20000000-0000-0000-0000-0000000000a1","quantity":1}]'

\echo '=== 6. Sesiones de mesa y pedidos por confirmar'
update public.restaurant_settings set qr_session_minutes = 60, qr_requires_confirmation = true, qr_max_pending_per_table = 6, qr_ordering_enabled = true where id = 1;
select qr_token as tk  from public.tables where number = 1 \gset
select qr_token as tk2 from public.tables where number = 2 \gset
select id as t2id from public.tables where number = 2 \gset

begin;
select test.anon();
select test.raises(format('select public.create_qr_order(%L, %L::jsonb, gen_random_uuid())', :'tk', :'item'), 'SESSION_REQUIRED', 'pedir sin sesión se rechaza');
select test.raises(format('select public.create_qr_order(%L, %L::jsonb, gen_random_uuid(), null, gen_random_uuid())', :'tk', :'item'), 'SESSION_EXPIRED', 'una sesión inventada se rechaza');
select test.raises(format('select public.get_table_orders(%L)', :'tk'), 'SESSION_REQUIRED', 'ver los pedidos de la mesa exige sesión');
select (public.open_table_session(:'tk') ->> 'session_id') as s1 \gset
select test.ok(:'s1' <> '', 'escanear el QR abre una sesión');
select test.ok((public.open_table_session(:'tk') ->> 'number')::int = 1 and (public.open_table_session(:'tk') ->> 'requires_confirmation')::boolean, 'la sesión informa mesa y si hace falta confirmación');
select test.ok((public.open_table_session(:'tk', :'s1'::uuid) ->> 'session_id') = :'s1', 'volver a abrir con la misma sesión la reutiliza');
select test.ok((public.open_table_session(:'tk', gen_random_uuid()) ->> 'session_id') <> :'s1', 'una sesión desconocida no se reutiliza: se abre otra');
select test.raises(format('select public.open_table_session(%L)', 'token-inexistente'), 'INVALID_TABLE', 'token inexistente no abre sesión');
select test.raises(format('select public.create_qr_order(%L, %L::jsonb, gen_random_uuid(), null, %L::uuid)', :'tk2', :'item', :'s1'), 'SESSION_EXPIRED', 'la sesión de una mesa no sirve en otra mesa');
select (public.create_qr_order(:'tk', :'item'::jsonb, 'b0000000-0000-0000-0000-000000000001', 'sin hielo', :'s1'::uuid) ->> 'order_id') as q1 \gset
select test.ok((public.create_qr_order(:'tk', :'item'::jsonb, 'b0000000-0000-0000-0000-000000000001', 'sin hielo', :'s1'::uuid) ->> 'duplicate')::boolean, 'reintentar el mismo envío no duplica el pedido');
select test.ok((select get_table_orders from (select public.get_table_orders(:'tk', :'s1'::uuid)) x)::jsonb @> format('[{"id":"%s","is_confirmed":false}]', :'q1')::jsonb, 'el cliente ve su pedido como "por confirmar"');
commit;

select test.ok((select not is_confirmed and channel = 'qr' and status = 'pending' from public.orders where id = :'q1'), 'el pedido del QR queda sin confirmar');

begin;
select test.login(:'uD');   -- cocina
select test.raises(format('select public.set_order_status(%L, ''preparing'')', :'q1'), 'ORDER_NOT_CONFIRMED', 'cocina no puede avanzar un pedido sin confirmar');
select test.raises(format('select public.confirm_qr_order(%L)', :'q1'), 'FORBIDDEN', 'cocina no puede confirmar pedidos');
commit;
begin;
select test.login(:'uB');   -- caja
select test.raises(format('select public.register_payment(array[%L]::uuid[], ''cash'', null)', :'q1'), 'ORDER_NOT_CONFIRMED', 'no se cobra un pedido sin confirmar');
select test.ok((public.confirm_qr_order(:'q1') ->> 'confirmed')::boolean, 'caja confirma el pedido');
select test.ok((public.confirm_qr_order(:'q1') ->> 'confirmed')::boolean, 'confirmar dos veces no falla');
select test.raises(format('select public.reject_qr_order(%L)', :'q1'), 'ORDER_NOT_CANCELLABLE', 'un pedido ya confirmado no se rechaza (se cancela con cancel_order)');
commit;
begin;
select test.login(:'uD');
select test.ok((public.set_order_status(:'q1', 'preparing') ->> 'status') = 'preparing', 'ya confirmado, cocina lo puede preparar');
commit;

-- Rechazar
begin;
select test.anon();
select (public.create_qr_order(:'tk', :'item'::jsonb, 'b0000000-0000-0000-0000-000000000002', null, :'s1'::uuid) ->> 'order_id') as q2 \gset
commit;
begin;
select test.login(:'uB');
select test.ok((public.reject_qr_order(:'q2') ->> 'status') = 'cancelled', 'caja rechaza un pedido por confirmar');
select test.ok((select cancelled_reason from public.orders where id = :'q2') = 'Rechazado por el personal', 'queda el motivo "Rechazado por el personal"');
commit;

-- Sesión vencida
update public.table_sessions set expires_at = now() - interval '1 minute' where id = :'s1';
begin;
select test.anon();
select test.raises(format('select public.create_qr_order(%L, %L::jsonb, gen_random_uuid(), null, %L::uuid)', :'tk', :'item', :'s1'), 'SESSION_EXPIRED', 'con la sesión vencida ya no se puede pedir');
select test.raises(format('select public.get_table_orders(%L, %L::uuid)', :'tk', :'s1'), 'SESSION_EXPIRED', 'ni ver los pedidos');
select test.ok((public.create_qr_order(:'tk', :'item'::jsonb, 'b0000000-0000-0000-0000-000000000001', 'sin hielo', :'s1'::uuid) ->> 'duplicate')::boolean, 'pero el reintento de un pedido ya enviado sigue devolviendo ese pedido');
commit;

-- Pagar la última cuenta cierra la sesión
begin;
select test.anon();
select (public.open_table_session(:'tk2') ->> 'session_id') as s2 \gset
select (public.create_qr_order(:'tk2', :'item'::jsonb, 'b0000000-0000-0000-0000-000000000003', null, :'s2'::uuid) ->> 'order_id') as q3 \gset
commit;
update public.orders set is_confirmed = true where table_id = :'t2id';
begin;
select test.login(:'uB');
select public.register_payment((select array_agg(id) from public.orders where table_id = :'t2id' and payment_status = 'unpaid' and status <> 'cancelled'), 'cash', null);
commit;
select test.ok((select closed_at is not null from public.table_sessions where id = :'s2'), 'al pagar la última cuenta de la mesa, su sesión se cierra');
begin;
select test.anon();
select test.raises(format('select public.create_qr_order(%L, %L::jsonb, gen_random_uuid(), null, %L::uuid)', :'tk2', :'item', :'s2'), 'SESSION_EXPIRED', 'con la cuenta pagada, la página que quedó abierta ya no puede pedir');
select (public.open_table_session(:'tk2') ->> 'session_id') as s3 \gset
commit;

-- Regenerar el QR cierra las sesiones
begin;
select test.login(:'uA');
select public.regenerate_table_token(:'t2id');
commit;
select test.ok((select closed_at is not null from public.table_sessions where id = :'s3'), 'regenerar el QR cierra las sesiones abiertas de esa mesa');

-- Sin confirmación / sin sesiones (opciones de Ajustes)
update public.restaurant_settings set qr_requires_confirmation = false where id = 1;
begin;
select test.anon();
select (public.open_table_session(:'tk') ->> 'session_id') as s4 \gset
select (public.create_qr_order(:'tk', :'item'::jsonb, 'b0000000-0000-0000-0000-000000000004', null, :'s4'::uuid) ->> 'order_id') as q4 \gset
commit;
select test.ok((select is_confirmed from public.orders where id = :'q4'), 'con la confirmación desactivada, el pedido llega directo a cocina');
update public.restaurant_settings set qr_session_minutes = 0 where id = 1;
begin;
select test.anon();
select test.ok((public.open_table_session(:'tk') ->> 'session_id') is null, 'con las sesiones desactivadas no se crea ninguna');
select test.ok((public.create_qr_order(:'tk', :'item'::jsonb, 'b0000000-0000-0000-0000-000000000005') ->> 'order_number') is not null, 'y se puede pedir sin sesión');
select test.ok((public.get_public_info() ->> 'restaurant') is not null and (public.get_public_info() ->> 'currency') is not null, 'get_public_info devuelve nombre y moneda');
commit;

-- Permisos y firmas
select test.ok(to_regprocedure('public.create_qr_order(text,jsonb,uuid,text)') is null, 'la firma antigua de create_qr_order (sin sesión) ya no existe');
select test.ok(to_regprocedure('public.get_table_orders(text)') is null, 'la firma antigua de get_table_orders ya no existe');
select test.ok(has_function_privilege('anon', 'public.open_table_session(text,uuid)', 'execute') and has_function_privilege('anon', 'public.get_public_info()', 'execute'), 'anon puede abrir sesión y ver la carta pública');
select test.ok(not has_function_privilege('anon', 'public.confirm_qr_order(uuid)', 'execute') and not has_function_privilege('anon', 'public.reject_qr_order(uuid,text)', 'execute') and not has_function_privilege('anon', 'public.admin_check_delete_user(uuid)', 'execute'), 'anon NO puede confirmar, rechazar ni dar de baja');
begin;
select test.anon();
select test.raises('select * from public.table_sessions', 'permission denied', 'anon no lee las sesiones');
commit;
begin;
select test.login(:'uA');
select test.raises('select * from public.table_sessions', 'permission denied', 'ni siquiera el administrador las lee desde la API');
commit;

\echo '=== 7. Eliminar personal (reglas)'
begin;
select test.login(:'uA');
select test.ok((public.admin_check_delete_user(:'uB') ->> 'user_id') = :'uB', 'el administrador puede dar de baja a un usuario');
select test.raises(format('select public.admin_check_delete_user(%L)', :'uA'), 'CANNOT_DELETE_SELF', 'nadie puede eliminarse a sí mismo');
select test.raises('select public.admin_check_delete_user(gen_random_uuid())', 'USER_NOT_FOUND', 'usuario inexistente');
commit;
begin;
select test.login(:'uB');
select test.raises(format('select public.admin_check_delete_user(%L)', :'uD'), 'FORBIDDEN', 'caja no puede eliminar personal');
commit;
-- El último administrador activo no se puede eliminar
begin;
select test.login(:'uA');
select public.admin_update_user(:'uE', (select id from public.roles where name = 'cashier'), 'Gerente prueba', true);
select (public.admin_save_role(null, 'Gerencia prueba', array['users.manage']) ->> 'role_id') as rg \gset
select public.admin_update_user(:'uE', :'rg'::smallint, 'Gerente prueba', true);
commit;
begin;
select test.login(:'uE');
select test.raises(format('select public.admin_check_delete_user(%L)', :'uA'), 'LAST_ADMIN', 'no se puede eliminar al último administrador activo');
commit;
update public.users set role_id = (select id from public.roles where name = 'admin') where id = :'uE';
begin;
select test.login(:'uE');
select test.ok((public.admin_check_delete_user(:'uA') ->> 'user_id') = :'uA', 'con otro administrador activo, sí se puede eliminar a uno');
commit;
-- Limpieza para no afectar a las demás pruebas
update public.users set role_id = null where id = :'uE';
delete from public.roles where id = :'rg';
update public.restaurant_settings set qr_session_minutes = 0, qr_requires_confirmation = false where id = 1;
\echo '=== QR seguro y baja de personal OK'
