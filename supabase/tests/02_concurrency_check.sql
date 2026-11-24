\set ON_ERROR_STOP on
set client_min_messages = notice;
select test.ok((select count(*) from public.orders where client_request_id = '50000000-0000-0000-0000-000000000001') = 1,
               'concurrencia: 200 envíos simultáneos con la misma clave crearon UN solo pedido');
select test.ok((select count(*) from public.orders) = 201, 'concurrencia: 200 pedidos distintos + 1 = 201 pedidos');
select test.ok((select count(distinct order_number) = count(*) and max(order_number) = count(*) from public.orders), 'concurrencia: numeración correlativa sin huecos ni repetidos (1..201)');
select test.ok((select count(*) from public.order_items) = 201, 'concurrencia: cada pedido tiene sus ítems');
