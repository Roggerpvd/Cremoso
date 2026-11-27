# Usuarios, puestos y sesiones

## Cómo funciona
- Cada persona entra con **usuario y contraseña** (p. ej. `cocina1`). Internamente Supabase Auth exige un correo, así que el usuario se convierte en `usuario@restopos.local`. **No se envían correos** a esa dirección. Quien ya tenía una cuenta con correo real puede seguir entrando escribiendo ese correo completo en el campo «Usuario».
- Un **puesto** es un conjunto de permisos (Caja, Mozo, Cocina…). El administrador crea, edita y elimina puestos en **Personal → Puestos y permisos**. El puesto «Administrador» no se puede modificar.
- Un usuario sin puesto, o desactivado, no accede a nada.
- El permiso `users.manage` permite crear usuarios y asignar el puesto de Administrador: dalo solo a personas de máxima confianza.

## Publicar la función `staff-admin` (una sola vez)
Crear cuentas exige la clave `service_role`, que **nunca** debe estar en el navegador. Por eso vive en una Edge Function de Supabase, que antes de actuar comprueba que quien llama sea un usuario activo con permiso `users.manage`.

```bash
npx supabase login
npx supabase link --project-ref <tu-project-ref>      # lo ves en Project Settings → General (es el texto antes de .supabase.co)
npx supabase functions deploy staff-admin --no-verify-jwt
```
`--no-verify-jwt` es seguro aquí: la función valida por sí misma la sesión de quien llama y su permiso `users.manage` antes de hacer nada. Si el comando pide Docker, agrega `--use-api`.

**Alternativa sin terminal:** en el panel de Supabase → *Edge Functions* → *Deploy a new function* → *Via Editor*, ponle el nombre exacto `staff-admin`, pega el contenido de `supabase/functions/staff-admin/index.ts` y despliega.

**Cómo comprobar que quedó publicada:** *Supabase → Edge Functions* debe listar `staff-admin` con estado activo. Si al crear o eliminar un usuario sale «No se pudo contactar la función staff-admin» (o *Failed to send a request to the Edge Function*), casi siempre es que no está publicada, o que se publicó con otro nombre o en otro proyecto. Después de cada cambio en este archivo hay que volver a desplegarla.
Supabase le entrega a la función las variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` automáticamente; no tienes que configurarlas.

Si al crear un usuario Supabase rechaza el dominio `restopos.local`, usa un dominio tuyo (no recibirá correos):
1. `npx supabase secrets set STAFF_EMAIL_DOMAIN=tu-dominio.pe`
2. En `public/config.js`: `STAFF_EMAIL_DOMAIN: "tu-dominio.pe"` y vuelve a compilar/desplegar.

Si ves «Falta publicar la función staff-admin», no se ha desplegado o el nombre no coincide.

## Varios usuarios a la vez
- En **equipos distintos** (caja, cocina, celular del mozo) no hay ningún conflicto: cada uno tiene su sesión.
- En el **mismo navegador**, la sesión vive en la **pestaña**: el administrador puede tener su pestaña abierta y cocina entrar en otra pestaña sin cerrar la de él. Al recargar la página la sesión se conserva; al cerrar la pestaña se cierra.
- En el login hay una casilla **«Mantener la sesión en este equipo»**: guarda la sesión aunque cierres el navegador. Úsala solo en equipos dedicados a un único puesto (p. ej. la tableta de cocina): con ella marcada, dos personas en el mismo navegador sí se pisarían.

## Pedidos con mesa y sin mesa
En **Caja → Nuevo pedido** elige **Con mesa** (y la mesa) o **Sin mesa** (para llevar / mostrador). Los pedidos sin mesa aparecen en **Cuentas** como cuentas individuales («Sin mesa · #N») y se cobran por separado. Requiere la migración `20260103000000_notable_roles.sql`.

## Marca
El nombre del software (**RestoPOS**, íconos, favicon y pantalla de acceso) es fijo. El **nombre del local** que sale en el ticket se cambia en **Ajustes**.

## Eliminar personal
En **Personal**, el botón rojo de cada usuario lo elimina. Se borra su cuenta (ya no puede entrar y su usuario queda libre) pero **se conservan** los pedidos, cobros y boletas que registró, con el autor en blanco. No se puede eliminar tu propia cuenta ni al último administrador activo. Si solo quieres que no entre por un tiempo, usa el interruptor **Activo**. Requiere haber publicado la versión actual de `staff-admin`.
