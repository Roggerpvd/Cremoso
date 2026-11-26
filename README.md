# RestoPOS — Pedidos para restaurante (POS + Cocina + Seguimiento + Menú QR)

Sistema real (no maqueta) de gestión de pedidos: caja/POS, carta digital, QR por mesa, pantalla de cocina (KDS) y pantalla de seguimiento, todo sincronizado en tiempo real mediante una sola base de datos.

**Stack:** React 19 + TypeScript + Vite + Tailwind 4 · Supabase (Postgres, Realtime, Auth, Storage, RLS) · `qrcode.react` (MIT).
**Sin backend propio en Node:** la lógica de negocio vive en funciones SQL (RPC) protegidas por RLS. Node solo se usa para compilar y para scripts de administración. Ver `docs/ARQUITECTURA.md`.

> ⚠️ **Sobre el costo:** el proyecto está diseñado para operar con planes gratuitos, pero **no es "gratis para siempre sin condiciones"**. Los planes gratuitos tienen límites, pausan proyectos inactivos y pueden cambiar sus términos. Lee `docs/LIMITES_PLAN_GRATUITO.md` antes de usarlo en producción.

## Pantallas

| Ruta | Para quién | Qué hace |
|---|---|---|
| `/m/<token>` | Cliente (celular, sin instalar nada) | Ve la carta, arma el carrito, deja notas y confirma. El QR de cada mesa apunta aquí. |
| `/caja` | Caja / Mozo | Toma pedidos internos **con mesa o sin mesa** (para llevar / mostrador), modifica/cancela según permisos, cobra y cierra cuentas. |
| `/cocina` | Cocina | Pendiente → En preparación → Listo; se actualiza solo. |
| `/seguimiento` | Salón / Admin | Mesa, número, hora, productos, estado y canal (interno/QR) de cada pedido. |
| `/carta` | Admin | Categorías, productos, precios, foto, ingredientes, agotado y promociones. |
| `/mesas` | Admin | Mesas y generación/impresión de QR (con regeneración del token). |
| `/comprobantes` | Admin / Caja | Imprime el **ticket** de consumo y prepara la **boleta** (nombre, producto, cantidad, monto en S/). Ver `docs/BOLETAS_SUNAT.md`. |
| `/reportes` | Admin / Caja | Ventas por día, producto, canal y medio de pago. |
| `/usuarios`, `/ajustes` | Admin | **Personal y puestos:** crea usuarios con usuario y contraseña y define puestos con sus permisos, todo desde la app (ver `docs/USUARIOS_Y_PUESTOS.md`). Ajustes: nombre del local, IGV, moneda, URL base del QR. |

## Puesta en marcha (nube gratuita)

1. **Crea un proyecto en Supabase** (plan Free) en <https://supabase.com>.
2. **Base de datos:** en *SQL Editor* pega y ejecuta `supabase/schema_completo.sql` (todo en uno: tablas, índices, RLS, funciones, bucket de fotos y boletas). Si ya tenías el sistema instalado, ejecuta solo lo que te falte: `supabase/migrations/20260102000000_receipts.sql` (boletas), `supabase/migrations/20260103000000_notable_roles.sql` (pedidos sin mesa y puestos administrables) y `supabase/migrations/20260104000000_qr_seguridad_y_personal.sql` (QR seguro: sesiones y confirmación del personal; eliminar personal). Las dos últimas se pueden ejecutar más de una vez sin problema. Después vuelve a publicar la función `staff-admin` (`npx supabase functions deploy staff-admin`): ahora también da de baja usuarios. Opcional: `supabase/seed_demo.sql` para una carta y 8 mesas de ejemplo.
3. **Desactiva el registro público:** *Authentication → Sign In / Providers → desactiva "Allow new users to sign up"*. Así solo tú creas cuentas.
4. **Crea tu primer usuario** (queda como **administrador** automáticamente): *Authentication → Users → Add user → Create new user* (marca "Auto Confirm"). Los siguientes usuarios no reciben rol hasta que el admin se lo asigne en `/usuarios`.
5. **Configura la app:** copia *Project URL* y la clave *anon/publishable* (*Project Settings → API*) en `public/config.js` (o en `.env` para desarrollo). **Nunca** pongas la `service_role` ahí.
6. **Ejecuta:**
   ```bash
   npm install
   npm run dev            # desarrollo: http://localhost:5173
   npm run build          # producción → dist/
   ```
7. **Despliega `dist/`** en Cloudflare Pages (recomendado: ancho de banda ilimitado en Free) o Netlify (créditos mensuales). Para Netlify ya existe `netlify.toml`; para Cloudflare (Workers con archivos estáticos) ya existe `wrangler.jsonc`, que sirve `index.html` en rutas como `/caja`. **No agregues `public/_redirects` en Cloudflare:** provoca el error «Infinite loop detected». **No uses Vercel Hobby:** es solo para uso no comercial.
8. Entra a `/ajustes` y pon la **URL base pública** (la del sitio desplegado) y luego imprime los QR desde `/mesas`.

### QR de mesa seguro
El cliente que escanea el QR no puede instalar la app, el token no queda en la dirección del celular, la sesión vence y los pedidos esperan la confirmación de Caja antes de llegar a cocina. Detalle y límites en `docs/QR_SEGURIDAD.md`.

### Imágenes de la carta desde la carpeta `public`
Copia las fotos en `public/images/menu/` y elígelas en **Carta → Editar producto → Elegir de la carpeta del sistema**. Instrucciones en `public/images/menu/LEEME.txt`.

### Diseño y movimiento
Tema azul acero, calendario propio y animaciones cortas y suaves. Criterios y valores en `docs/DISENO.md`.

### Emitir la boleta con un agente de navegador (opcional)
En **Comprobantes → Boleta**, el botón **Copiar para el agente** genera un bloque para el atajo `/emitir-boleta-sunat` de Claude en Chrome: el agente llena el formulario de SUNAT con tu sesión ya abierta y se detiene; **tú presionas Emitir**. Guía, riesgos y el archivo del atajo en `docs/EMISION_CON_AGENTE.md` y `agent/skills/emitir-boleta-sunat/SKILL.md`. No está probado contra el portal real.

### Crear personal desde la app (recomendado)
Con el administrador logueado: **Personal → Crear usuario** (usuario, nombre, contraseña y puesto) y **Puestos y permisos → Nuevo puesto**. Requiere publicar una vez la función `staff-admin`; pasos en `docs/USUARIOS_Y_PUESTOS.md`. Los usuarios entran con **usuario y contraseña** (no necesitan correo).

### Crear más personal por script (opcional)
```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… STAFF_PASSWORD='ClaveSegura1' \
  npm run create-staff -- mozo@local.pe "Ana Pérez" waiter     # admin | cashier | waiter | kitchen
```
La `service_role` es secreta: úsala solo en tu PC, nunca la subas a Git ni al navegador.

## Instalación en red local (Wi-Fi del restaurante, funciona sin Internet)
Ver `docs/INSTALACION_LOCAL.md` (Supabase CLI + Docker + una PC en el local).

## Respaldos y mantenimiento
- El plan Free **no incluye respaldos automáticos**: ejecuta `npm run backup` cada semana y guarda la carpeta fuera del local.
- Supabase Free **pausa** el proyecto tras ~7 días sin actividad. Un restaurante abierto no lo notará; si cierras varios días, usa el flujo opcional `.github/workflows/keepalive.yml`.

## Pruebas
```bash
npm run test:db                                  # 150 pruebas SQL + 42 de boletas + 36 de pedidos sin mesa/puestos + 43 de QR seguro/baja de personal + concurrencia (PostgreSQL local temporal)
npm run build && python3 tests/ui-smoke/smoke.py # prueba de humo de la interfaz en Chrome con servidor simulado
```
Detalle en `docs/PRUEBAS.md`.

## Estructura
```
supabase/schema_completo.sql  migraciones 1 + 2 en un solo archivo (para el SQL Editor)
supabase/migrations/   esquema (1: tablas, RLS, RPC, storage · 2: datos del local y boletas)
supabase/seed_demo.sql datos de ejemplo        supabase/reset.sql  reinicio (solo desarrollo)
supabase/tests/        pruebas SQL y de concurrencia
src/                   app React (pages/, components/, hooks/, lib/, auth/)
supabase/functions/staff-admin  Edge Function: crear usuarios y cambiar contraseñas desde la app
scripts/               create-staff.mjs, backup-json.mjs
tests/ui-smoke/        prueba de humo del navegador
docs/                  arquitectura, límites, boletas SUNAT, instalación local, migración, pruebas
```

## Alcance y advertencias
- **No emite comprobantes ante SUNAT.** El ticket de consumo dice «Comprobante» al pie, pero eso **no lo convierte en boleta electrónica**: la boleta válida es la que lleva serie-número emitida en SUNAT o por un proveedor autorizado (PSE/OSE). Imprime el *ticket* y prepara los datos de la *boleta*, que se emite en SUNAT (SEE-SOL, gratuito, con tu Clave SOL); el sistema registra la serie-número resultante. Las facturas y la emisión automática no están incluidas. Ver `docs/BOLETAS_SUNAT.md`.
- En modo nube, si se cae Internet, el sistema no registra pedidos nuevos (no hay cola offline). Para operar sin Internet usa la instalación local.
- Licencia del código: MIT. Revisa las licencias de las dependencias si las redistribuyes.
