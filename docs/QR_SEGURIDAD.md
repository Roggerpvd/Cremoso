# QR de mesa: instalación, pedidos falsos y sesiones

## Qué se corrigió
| Problema | Qué pasa ahora |
|---|---|
| El cliente podía **instalar la app** al escanear | La carta del cliente (`/m`, `/menu`) ya no declara el manifest, así que el navegador no ofrece instalarla. El manifest y el ícono solo se agregan en las pantallas del personal (`src/lib/pwa.ts`). |
| La página **se quedaba en el celular** y servía después | El token del QR se guarda solo en la pestaña (`sessionStorage`) y se **quita de la dirección** (queda `/m`). Un marcador, un acceso directo o el historial ya no abren la mesa: piden escanear de nuevo. |
| Se podía **pedir desde fuera del local** o por broma | (1) Hace falta una **sesión vigente** (se abre al escanear, dura lo que indiques en Ajustes y se cierra al pagar la cuenta de la mesa o al regenerar el QR). (2) Los pedidos del QR **esperan la confirmación de Caja**: no llegan a cocina ni a las cuentas hasta que alguien los acepta; si no hay nadie en esa mesa, se rechazan. (3) Sigue el freno de pedidos pendientes por mesa. |

## Cómo se usa
- **Caja** muestra el panel **Por confirmar** con cada pedido del QR (mesa, productos, total). *Aceptar* lo envía a cocina; *Rechazar* lo cancela.
- **Ajustes → Pedidos por QR:** «Los pedidos del QR esperan la confirmación de Caja» (recomendado) y «Duración de la sesión del QR» en minutos.
- **Mesas y QR:** además de un QR por mesa hay un **QR de la carta (solo ver)** que abre `/menu`, sin mesa y sin poder pedir.
- Si alguien se lleva una foto del QR de una mesa, usa **Regenerar** en esa mesa: el QR anterior y sus sesiones dejan de funcionar.

## Límites (sin rodeos)
- **No hay forma de comprobar desde el celular que el cliente está dentro del local.** Quien tenga el QR (o una foto) puede escanearlo desde afuera y abrir una sesión. Lo que lo frena es la **confirmación de Caja**: sin ella, su pedido no llega a cocina ni se cobra. Por eso se recomienda dejarla activada y que Caja confirme solo si hay alguien en la mesa.
- **Instalar como acceso directo en iPhone** (Compartir → Añadir a pantalla de inicio) no se puede bloquear desde una página web. Sin manifest, ese acceso directo apunta a `/m` (sin token), así que solo muestra «Escanea el código QR».
- Si Caja no está atendiendo, los pedidos del QR quedan esperando (y la mesa se frena al llegar al máximo de pendientes). Si prefieres que lleguen directo a cocina, apaga la confirmación en Ajustes.

## Actualizar una instalación existente
1. En Supabase → SQL Editor ejecuta `supabase/migrations/20260104000000_qr_seguridad_y_personal.sql` (se puede repetir sin problema).
2. Sube el código nuevo (Cloudflare lo despliega solo con el `push`).
3. **Reimprime nada:** los QR de mesa siguen siendo válidos; solo cambia lo que el cliente ve al abrirlos.
4. Si ya usabas la carta antes de actualizar, cada cliente deberá volver a escanear una vez.
