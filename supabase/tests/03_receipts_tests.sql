-- =====================================================================
--  Pruebas de la migración 2: datos del local y boletas (SUNAT).
--  Se ejecuta DESPUÉS de 01_tests.sql (reutiliza sus usuarios y cobros).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;
\set uA '00000000-0000-0000-0000-00000000000a'
\set uB '00000000-0000-0000-0000-00000000000b'
\set uC '00000000-0000-0000-0000-00000000000c'
\set uD '00000000-0000-0000-0000-00000000000d'
\set uE '00000000-0000-0000-0000-00000000000e'
\echo '=== 12. Boletas: datos del local, validaciones y permisos'

-- Cobro de prueba creado en la sección 8 (49 + 20 = 69.00)
-- (se elige por contenido: dos pagos que suman 69.00; el orden por fecha no es determinista dentro de una transacción)
select group_id as g1, sum(amount) as g1_total from public.payments group by group_id having count(*) = 2 and sum(amount) = 69.00 limit 1 \gset
select test.ok(:'g1_total'::numeric = 69.00, 'cobro de referencia: total 69.00');

-- Datos del local
begin;
select test.login(:'uA');
update public.restaurant_settings set legal_name = 'Cremoso SAC', ruc = '20123456789', address = 'Av. Demo 123, Ilo', phone = '053-123456' where id = 1;
select test.ok((select ruc from public.restaurant_settings) = '20123456789', 'el admin guarda RUC y dirección del local');
select test.raises($$update public.restaurant_settings set ruc = '123' where id = 1$$, 'restaurant_settings_ruc_chk', 'el RUC debe tener 11 dígitos');
commit;

-- Permisos
begin;
select test.login(:'uC');  -- mozo
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'FORBIDDEN', 'el mozo NO puede preparar boletas');
select test.ok((select count(*) from public.receipts) = 0, 'el mozo no ve boletas');
commit;
begin;
select test.anon();
select test.raises('select * from public.receipts', 'permission denied', 'anónimo NO lee boletas');
select test.raises(format($$select public.register_boleta(%L, 'Ana', null, null, '[]'::jsonb)$$, :'g1'), 'permission denied', 'anónimo NO ejecuta register_boleta');
select test.raises('select public.mark_boleta_issued(gen_random_uuid(), ''B001-1'')', 'permission denied', 'anónimo NO ejecuta mark_boleta_issued');
commit;

-- Validaciones (caja)
begin;
select test.login(:'uB');
select test.raises(format($$select public.register_boleta(%L, 'A', null, null, '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'INVALID_CUSTOMER_NAME', 'nombre demasiado corto rechazado');
select test.raises(format($$select public.register_boleta(%L, '   ', null, null, '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'INVALID_CUSTOMER_NAME', 'nombre vacío rechazado');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[]'::jsonb)$$, :'g1'), 'INVALID_ITEMS', 'sin líneas rechazado');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[{"product":"","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'INVALID_ITEMS', 'producto vacío rechazado');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[{"product":"Consumo","quantity":0,"amount":69}]'::jsonb)$$, :'g1'), 'INVALID_ITEMS', 'cantidad cero rechazada');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[{"product":"Consumo","quantity":"2","amount":69}]'::jsonb)$$, :'g1'), 'INVALID_ITEMS', 'cantidad como texto rechazada');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[{"product":"Consumo","quantity":1,"amount":-5}]'::jsonb)$$, :'g1'), 'INVALID_ITEMS', 'monto negativo rechazado');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[{"product":"Consumo","quantity":1,"amount":60}]'::jsonb)$$, :'g1'), 'AMOUNT_MISMATCH', 'la suma de líneas debe igualar el total cobrado (60 ≠ 69)');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', null, null, '[{"product":"Consumo","quantity":1,"amount":70}]'::jsonb)$$, :'g1'), 'AMOUNT_MISMATCH', 'no se puede inflar el monto (70 ≠ 69)');
select test.raises(format('select public.register_boleta(%L, ''Ana Pérez'', null, null, ''[{"product":"Consumo","quantity":1,"amount":69}]''::jsonb)', gen_random_uuid()), 'PAYMENT_NOT_FOUND', 'cobro inexistente rechazado');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', 'DNI', null, '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'INVALID_DOCUMENT', 'tipo de documento sin número rechazado');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', 'DNI', '1234', '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'INVALID_DOCUMENT', 'DNI de 4 dígitos rechazado');
select test.raises(format($$select public.register_boleta(%L, 'Ana Pérez', 'RUC', '20123456789', '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'INVALID_DOCUMENT', 'una boleta no admite RUC (eso es factura)');
select test.ok((select count(*) from public.receipts) = 0, 'ninguna validación fallida dejó boletas a medias');
commit;

-- Boleta correcta ≤ S/ 700: solo el nombre
begin;
select test.login(:'uB');
select (public.register_boleta(:'g1', '  Ana  Pérez ', null, null,
  '[{"product":"Hamburguesa","quantity":2,"amount":40},{"product":"Gaseosa","quantity":3,"amount":29}]'::jsonb) ->> 'receipt_id') as r1 \gset
select test.ok((select customer_name = 'Ana  Pérez' and doc_type is null and status = 'prepared' and total = 69.00 and created_by = :'uB' from public.receipts where id = :'r1'),
               'boleta ≤ S/ 700 con solo el nombre del cliente queda preparada');
select test.ok((select jsonb_array_length(items) = 2 from public.receipts where id = :'r1'), 'se guardan las líneas Producto/Cantidad/Monto');
select test.raises(format($$select public.register_boleta(%L, 'Otro Cliente', null, null, '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'RECEIPT_ALREADY_EXISTS', 'un cobro no admite dos boletas vigentes');
select test.raises(format('select public.mark_boleta_issued(%L, ''F001-12'')', :'r1'), 'INVALID_SUNAT_REF', 'la serie de boleta debe empezar con B (F = factura)');
select test.raises(format('select public.mark_boleta_issued(%L, ''B001'')', :'r1'), 'INVALID_SUNAT_REF', 'falta el número correlativo');
select test.raises('select public.mark_boleta_issued(gen_random_uuid(), ''B001-1'')', 'RECEIPT_NOT_FOUND', 'boleta inexistente');
commit;

-- Corregir: anular la preparada y volver a prepararla; luego emitir
begin;
select test.login(:'uB');
select public.void_boleta(:'r1');
select test.ok((select status = 'void' from public.receipts where id = :'r1'), 'una boleta preparada se puede descartar para corregirla');
select (public.register_boleta(:'g1', 'Ana Pérez Rojas', 'DNI', '12345678', '[{"product":"Consumo en restaurante","quantity":1,"amount":69}]'::jsonb) ->> 'receipt_id') as r2 \gset
select test.ok((select doc_type = 'DNI' and doc_number = '12345678' and status = 'prepared' from public.receipts where id = :'r2'), 'tras descartar, se prepara de nuevo (con DNI opcional)');
select public.mark_boleta_issued(:'r2', ' b001-123 ');
select test.ok((select status = 'issued' and sunat_ref = 'B001-123' and issued_at is not null from public.receipts where id = :'r2'), 'se registra la serie-número emitida en SUNAT (normalizada a B001-123)');
select test.raises(format('select public.mark_boleta_issued(%L, ''B001-124'')', :'r2'), 'RECEIPT_NOT_PENDING', 'una boleta emitida no se vuelve a marcar');
select test.raises(format('select public.void_boleta(%L)', :'r2'), 'RECEIPT_ALREADY_ISSUED', 'una boleta emitida NO se descarta aquí (se anula en SUNAT)');
select test.raises(format($$select public.register_boleta(%L, 'Otra Persona', null, null, '[{"product":"Consumo","quantity":1,"amount":69}]'::jsonb)$$, :'g1'), 'RECEIPT_ALREADY_EXISTS', 'con una boleta emitida vigente no se crea otra para el mismo cobro');
select test.raises($$insert into public.receipts (group_id, customer_name, items, total) values (gen_random_uuid(), 'Xx', '[]', 1)$$, 'permission denied', 'nadie inserta boletas con INSERT directo');
select test.raises(format($$update public.receipts set status = 'issued', sunat_ref = 'B001-1' where id = %L$$, :'r2'), 'permission denied', 'nadie modifica boletas con UPDATE directo');
commit;

-- Regla S/ 700: se necesita un cobro mayor. Se crea con pedidos nuevos de mesa 2 (datos del test).
begin;
select test.login(:'uA');
insert into public.products (id, category_id, name, price) values ('20000000-0000-0000-0000-0000000000f1', (select id from public.categories limit 1), 'Parrilla familiar', 750);
commit;
begin;
select test.login(:'uB');
select (public.create_staff_order((select id from public.tables where number = 2), '[{"product_id":"20000000-0000-0000-0000-0000000000f1","quantity":1}]'::jsonb, null, gen_random_uuid()) ->> 'order_id') as ob \gset
select (public.register_payment(array[:'ob']::uuid[], 'card', null) ->> 'group_id') as g2 \gset
select test.raises(format($$select public.register_boleta(%L, 'Luis Gómez', null, null, '[{"product":"Parrilla familiar","quantity":1,"amount":750}]'::jsonb)$$, :'g2'), 'DOCUMENT_REQUIRED', 'total > S/ 700 exige documento de identidad (solo nombre NO basta)');
select (public.register_boleta(:'g2', 'Luis Gómez', 'DNI', '87654321', '[{"product":"Parrilla familiar","quantity":1,"amount":750}]'::jsonb) ->> 'total') as t2 \gset
select test.ok(:'t2'::numeric = 750.00, 'total > S/ 700 con DNI válido se prepara');
commit;

-- Límite exacto: S/ 700.00 NO supera 700
begin;
select test.login(:'uA');
insert into public.products (id, category_id, name, price) values ('20000000-0000-0000-0000-0000000000f2', (select id from public.categories limit 1), 'Banquete', 700);
commit;
begin;
select test.login(:'uB');
select (public.create_staff_order((select id from public.tables where number = 2), '[{"product_id":"20000000-0000-0000-0000-0000000000f2","quantity":1}]'::jsonb, null, gen_random_uuid()) ->> 'order_id') as oc \gset
select (public.register_payment(array[:'oc']::uuid[], 'cash', null) ->> 'group_id') as g3 \gset
select test.ok((public.register_boleta(:'g3', 'Rosa Díaz', null, null, '[{"product":"Banquete","quantity":1,"amount":700}]'::jsonb) ->> 'status') = 'prepared',
               'exactamente S/ 700.00 no supera el umbral: basta el nombre');
commit;

-- Lectura por rol
begin;
select test.login(:'uD');  -- cocina
select test.ok((select count(*) from public.receipts) = 0, 'cocina no ve boletas');
select test.raises(format('select public.void_boleta(%L)', :'r2'), 'FORBIDDEN', 'cocina NO ejecuta void_boleta');
commit;
begin;
select test.login(:'uB');
select test.ok((select count(*) from public.receipts) >= 4, 'caja ve las boletas');
commit;
\echo '=== Boletas OK'
