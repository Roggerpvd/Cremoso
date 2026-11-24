# Migración a un plan superior (sin reconstruir)

El esquema es PostgreSQL estándar y la app solo usa la API pública de Supabase, por lo que **no hay que reescribir código**.

1. **Subir de plan:** en Supabase → Billing → Upgrade a Pro. El mismo proyecto conserva URL, claves, datos y usuarios; desaparece la pausa por inactividad y se activan los respaldos diarios.
2. **Cambiar de proyecto (opcional):** crea otro proyecto, ejecuta la migración SQL, restaura datos (`pg_dump`/`supabase db dump` → `psql`), copia usuarios de Auth con las herramientas de Supabase y actualiza `public/config.js`.
3. **Hosting:** Cloudflare Pages/Netlify siguen funcionando; cambia de plan solo si superas sus límites. Para uso comercial en Vercel se requiere plan Pro.
4. **Auto-alojar Supabase:** misma migración; sigue su guía oficial de self-hosting.
5. **Antes de migrar:** haz `npm run backup`, prueba en un proyecto aparte y ejecuta `npm run test:db` contra la nueva base si es posible.
