# Delivery

## Cómo se gestiona
El delivery usa **la misma cocina, las mismas cuentas y los mismos comprobantes** que el resto de pedidos; solo cambia lo que se anota y quién entrega.

1. **Toma del pedido (Caja).** El cliente llama o escribe por WhatsApp. En *Caja → Nuevo pedido* elige **Delivery** y llena cliente, teléfono, dirección, referencia, costo de envío (se propone el de Ajustes) y, si paga en efectivo, **«paga con»** (el sistema calcula el vuelto que debe llevar el repartidor). Envía a cocina.
2. **Cocina** lo prepara como siempre. En su pantalla el pedido sale como «Delivery · nombre»; cuando está listo dice **«Listo para despacho»** (cocina no lo entrega: no tiene el permiso `orders.delivery`).
3. **Despacho (pantalla Delivery).** En *Listos para salir* se escribe el nombre del repartidor y se pulsa **«Salió a entregar»**. El pedido pasa a *En camino* con la hora de salida. Desde la tarjeta se puede **llamar**, abrir **WhatsApp** del cliente y ver la dirección en **el mapa**.
4. **Entrega.** Al llegar, **«Marcar como entregado»**. Si se marcó por error, el botón con la flecha deshace la salida.
5. **Cobro.** Se cobra en *Caja → Cuentas* (el botón «Cobrar en Caja» de la tarjeta te lleva allí). El delivery aparece como una cuenta individual con el nombre del cliente. El envío forma parte del total y de la **boleta** (línea «Servicio de delivery»).

## Ajustes (Ajustes → Delivery)
- **Aceptar pedidos a domicilio:** enciende o apaga el modo Delivery en Caja.
- **Costo de envío por defecto** y **pedido mínimo** (0 = sin mínimo; se compara con el consumo, sin contar el envío).
- **WhatsApp del local:** con este número, la carta pública (el QR «solo ver» de *Mesas y QR*, dirección `/menu`) permite al cliente **armar su pedido y enviarlo por WhatsApp**, ya con productos, nombre y dirección. **No entra solo al sistema**: tú lo ves en el chat, confirmas el total y el pago con el cliente, y lo registras en Caja. Así no se puede llenar el sistema de pedidos falsos.

## Puestos y permisos
- Permiso nuevo **`orders.delivery`**: despachar y marcar entregado. Lo tienen **Administrador** y **Caja**.
- Para tener un **repartidor con su propia cuenta**, crea en *Personal → Puestos* uno llamado «Repartidor» con *Ver pedidos* y *Delivery: despachar…*; al ingresar aterriza en la pantalla Delivery. Si tu repartidor no usa el sistema, basta con escribir su nombre en cada despacho (queda guardado el último).

## Reglas que cuida la base de datos
- Un delivery **siempre** tiene cliente, teléfono y dirección, y **nunca** tiene mesa.
- **No se entrega** un delivery que no haya salido con el repartidor, y cocina no puede entregarlo.
- Editar los productos de un delivery pendiente **conserva el envío** en el total.
- Reintentar el mismo envío (mala señal) **no duplica** el pedido ni suma el envío dos veces.
- El teléfono se limpia a solo dígitos y se quita el +51.

## Datos personales de los clientes
El nombre, teléfono y dirección de tus clientes son datos personales: guárdalos solo para entregar, no los compartas y, si te lo piden, bórralos. Hoy **cualquier puesto que pueda ver pedidos** (incluida Cocina) puede verlos en pantalla; si quieres restringirlo, se puede ocultar el teléfono y la dirección a Cocina como mejora futura.

## Actualizar una instalación existente
1. En Supabase → SQL Editor ejecuta `supabase/migrations/20260106000000_delivery.sql` (se puede repetir sin problema; va después de las migraciones 4 y 5).
2. Sube el código nuevo.
3. En **Ajustes → Delivery** define el envío, el mínimo y el WhatsApp.

## Límites actuales
- No hay mapa con rutas ni cálculo de costo por distancia o zona: el costo de envío lo escribe Caja (o se usa el de Ajustes).
- El repartidor es un nombre; no hay aplicación móvil propia para él.
- Los pedidos por WhatsApp se registran a mano en Caja.
