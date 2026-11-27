-- =====================================================================
--  Migración 5 — Sin puesto "Mozo" y Cocina marca los pedidos como entregados
--  Se aplica DESPUÉS de 20260104000000_qr_seguridad_y_personal.sql. Es idempotente.
--
--  1. El puesto "Mozo" desaparece. Si algún usuario lo tenía, pasa a "Caja" (puede tomar pedidos y cobrar).
--  2. El puesto "Cocina" puede marcar un pedido listo como entregado (permiso orders.serve),
--     que es lo que hace el botón «Marcar como entregado» de la pantalla Cocina.
-- =====================================================================

-- 1. Quitar el puesto Mozo
update public.users
   set role_id = (select id from public.roles where name = 'cashier')
 where role_id = (select id from public.roles where name = 'waiter')
   and exists (select 1 from public.roles where name = 'cashier');

delete from public.roles where name = 'waiter';

-- 2. Cocina también entrega
update public.roles
   set permissions = (select array_agg(distinct p order by p) from unnest(permissions || array['orders.serve']) as p)
 where name = 'kitchen' and not ('orders.serve' = any (permissions));
