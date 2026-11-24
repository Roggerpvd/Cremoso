-- 8 clientes envían EL MISMO pedido (misma clave) a la vez → debe existir 1 solo pedido
select public.create_qr_order((select v from public.race_ctl where k = 'token'),
  jsonb_build_array(jsonb_build_object('product_id', '20000000-0000-0000-0000-000000000001', 'quantity', 1)),
  '50000000-0000-0000-0000-000000000001'::uuid);
