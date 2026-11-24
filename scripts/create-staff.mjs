#!/usr/bin/env node
/**
 * Crea una cuenta del personal (Supabase Auth) y le asigna un rol.
 * Uso local (NUNCA en el navegador):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-staff.mjs correo@x.com "Nombre" cashier
 * Roles: admin | cashier | waiter | kitchen
 * Contraseña: variable STAFF_PASSWORD o se pide por argumento 4. Mínimo 8 caracteres.
 * El primer usuario del sistema queda como admin automáticamente (trigger en la BD).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

// Carga opcional de .env (sin dependencias)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [email, fullName, roleName = 'waiter', passArg] = process.argv.slice(2);
const password = passArg || process.env.STAFF_PASSWORD;

if (!url || !key || !email || !fullName || !password) {
  console.error('Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… STAFF_PASSWORD=… node scripts/create-staff.mjs correo "Nombre completo" [admin|cashier|waiter|kitchen]');
  process.exit(1);
}
if (password.length < 8) { console.error('La contraseña debe tener al menos 8 caracteres.'); process.exit(1); }
if (!['admin', 'cashier', 'waiter', 'kitchen'].includes(roleName)) { console.error('Rol inválido.'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: created, error } = await sb.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { full_name: fullName },
});
if (error) { console.error('No se pudo crear el usuario:', error.message); process.exit(1); }

const { data: role, error: e2 } = await sb.from('roles').select('id').eq('name', roleName).single();
if (e2) { console.error('No se encontró el rol:', e2.message); process.exit(1); }

// El trigger ya creó la fila en public.users (admin si es el primero). Fijamos el rol pedido.
const { error: e3 } = await sb.from('users').update({ role_id: role.id, full_name: fullName }).eq('id', created.user.id);
if (e3) { console.error('Usuario creado pero no se pudo asignar el rol:', e3.message); process.exit(1); }
console.log(`OK: ${email} creado con rol "${roleName}".`);
