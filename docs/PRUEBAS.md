# Pruebas (Fase 5)

## Automáticas
`npm run test:db` levanta un PostgreSQL temporal con simulación de los roles/tablas de Supabase y ejecuta `supabase/tests/01_tests.sql` (**150 comprobaciones**), `03_receipts_tests.sql` (**42 comprobaciones** de boletas: permisos, validación de nombre/líneas/suma, documento obligatorio sobre S/ 700 y exactamente S/ 700, una boleta vigente por cobro, serie válida, descartar/emitir) `04_notable_roles_tests.sql` (**36 comprobaciones**: pedidos sin mesa —incluido el reintento idempotente con `table_id` nulo—, y puestos administrables: crear/editar/eliminar, permisos válidos, rol admin protegido, usuarios con puesto nuevo) más pruebas de **concurrencia** con `pgbench`.
Resultado de la última ejecución: todas pasan; 0 transacciones fallidas en concurrencia.

| Requisito de Fase 5 | Cobertura |
|---|---|
| Pedido interno y por QR | create_staff_order / create_qr_order |
| Identificación de mesa | token válido/ inválido/ regenerado/ mesa inactiva |
| Sincronización | publicación Realtime solo de `orders` y `products`; (UI: ver manual) |
| Estados | transiciones válidas/ inválidas y permisos por rol |
| Producto agotado | rechazo al crear y al modificar |
| Control de duplicados | misma clave de idempotencia (secuencial y en carrera) → 1 pedido |
| Errores de conexión | reintento seguro con la misma clave; (cliente: ver manual) |
| Seguridad/permisos | anon limitado a 3 RPC, RLS, escrituras directas bloqueadas, private inaccesible, último admin |
| Consistencia | totales, descuentos, IGV, numeración diaria única, pagos que cuadran |

## Interfaz (prueba de humo automatizada)
`npm run build && python3 tests/ui-smoke/smoke.py` abre Chrome real contra un servidor **simulado** y verifica: carta QR, agotado, precio promocional, envío sin precios con clave UUID, login, caja, cocina (cambio de estado), seguimiento el **ticket** (contenido; cierra con «Comprobante» y «¡Gracias por su visita!»), la **boleta** (documento exigido sobre S/ 700, bloqueo si la suma no cuadra, serie F rechazada, registro B001-123) el pedido **sin mesa** (envía `p_table_id` nulo), la creación de usuarios y puestos desde **Personal** (llama a `staff-admin` y `admin_save_role`), y que ninguna pantalla lance errores de JavaScript. La Edge Function `staff-admin` **no** está cubierta por estas pruebas: pruébala tras desplegarla (ver `docs/USUARIOS_Y_PUESTOS.md`). **No sustituye** una prueba con Supabase real.

## Lista de comprobación manual (con Supabase real)
1. Escanea el QR de la mesa 1 desde un celular → ves la carta sin instalar nada.
2. Marca un producto agotado en `/carta` → desaparece/queda bloqueado en el QR en segundos.
3. Envía un pedido QR → aparece en `/cocina` y `/seguimiento` sin recargar, canal "QR".
4. Toma un pedido en `/caja` para la misma mesa → ambos suman en la cuenta de la mesa.
5. Cocina: Iniciar preparación → Listo; caja: Entregado → Cobrar (efectivo/tarjeta/Yape).
6. Pulsa dos veces "Confirmar" en el QR → un solo pedido.
7. Apaga el Wi-Fi del celular, confirma, vuelve a activar y reintenta → un solo pedido.
8. Inicia sesión como cocina: no debe poder cobrar ni editar la carta.
9. Cierra y reabre `/cocina` con Internet cortado y restablecido: se pone al día sola.
10. Regenera el QR de una mesa: el código antiguo deja de funcionar.
11. En Comprobantes, imprime el ticket de un cobro con tu impresora real (térmica 80 mm o normal) y revisa el diseño.
12. Prepara una boleta de un cobro ≤ S/ 700 solo con el nombre, y otra > S/ 700: debe exigir DNI.
13. Emite una boleta de prueba en SUNAT y registra su serie-número.
