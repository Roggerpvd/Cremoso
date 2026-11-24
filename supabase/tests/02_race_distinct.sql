-- 8 clientes crean pedidos DISTINTOS en mesas distintas a la vez → numeración sin huecos ni repetidos
\set n random(102, 140)
select public.create_qr_order((select qr_token from public.tables where number = :n),
  jsonb_build_array(jsonb_build_object('product_id', '20000000-0000-0000-0000-000000000001', 'quantity', 1)),
  gen_random_uuid());
