# Instalación local y en red del restaurante (funciona sin Internet)

Sirve para **desarrollo/pruebas** y para **operar con el Wi-Fi del local** aunque se caiga Internet.

## Requisitos
- Una PC (o mini-PC) encendida durante el servicio, con **Docker** (Docker Desktop o Docker Engine en Linux), **Node.js 22** y Git.
- Router Wi-Fi del local. Celulares de clientes conectados a ese Wi-Fi (para el QR local).

## Pasos
1. `npm install`
2. Levantar Supabase local (Postgres, Auth, Realtime, Storage en Docker):
   ```bash
   npx supabase init        # una sola vez
   npx supabase start       # imprime API URL y anon key
   ```
   Las migraciones (`20260101000000_init_schema.sql` y `20260102000000_receipts.sql`) ya están en `supabase/migrations/`; ejecuta `npx supabase db reset` para aplicarlas (¡borra datos locales!). Opcional: carga `supabase/seed_demo.sql` desde Studio (http://127.0.0.1:54323).
3. Crea el primer usuario en Studio → Authentication → Users (será admin).
4. **Fija la IP de la PC** (reserva DHCP en el router, p. ej. `192.168.1.50`) para que los QR no cambien.
5. Edita `public/config.js` con la **IP de la PC**, no `127.0.0.1` (los celulares no la alcanzarían):
   ```js
   window.__APP_CONFIG__ = { SUPABASE_URL: "http://192.168.1.50:54321", SUPABASE_ANON_KEY: "<anon key de supabase start>" };
   ```
6. Compila y sirve en la red:
   ```bash
   npm run build
   npm run preview        # http://192.168.1.50:8080 (escucha en toda la red)
   ```
7. En `/ajustes` → **URL base pública** = `http://192.168.1.50:8080`; imprime los QR desde `/mesas`.
8. Abre en el firewall de la PC los puertos **8080** y **54321**.

## Notas
- Funciona por **HTTP**: la app evita APIs que exigen HTTPS (`crypto.randomUUID` tiene alternativa, copiar usa un método de respaldo).
- **No hay sincronización automática nube ↔ local.** Son dos bases independientes: elige una como fuente de verdad. Para pasar datos, usa `npm run backup` y restaura manualmente.
- El respaldo y el mantenimiento de la PC son responsabilidad del restaurante. Programa `npm run backup` y guarda copias fuera del equipo.
- Los clientes fuera del Wi-Fi no podrán abrir el QR local; para atender por Internet usa el modo nube.
- Para producción local seria, cambia las claves JWT por defecto de Supabase local (ver su documentación de autoalojamiento).
