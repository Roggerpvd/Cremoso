#!/usr/bin/env node
/**
 * Respaldo gratuito en JSON (el plan Free de Supabase NO incluye backups automáticos).
 * Uso:  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-json.mjs [carpeta]
 * Genera backups/AAAA-MM-DD_HHMM/<tabla>.json. Ejecútalo semanalmente y guarda la carpeta fuera de la PC del local.
 * Para un respaldo completo de Postgres también puedes usar:  npx supabase db dump --db-url "<cadena de conexión>" -f backup.sql
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const tables = ['roles', 'users', 'restaurant_settings', 'tables', 'categories', 'products', 'promotions', 'orders', 'order_items', 'payments'];
const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const dir = join(process.argv[2] || 'backups', stamp);
mkdirSync(dir, { recursive: true });

for (const t of tables) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    // Orden por clave primaria (todas las tablas tienen "id") para que la paginación sea estable.
    const { data, error } = await sb.from(t).select('*').order('id', { ascending: true }).range(from, from + 999);
    if (error) { console.error(`✗ ${t}: ${error.message}`); process.exit(1); }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, 2));
  console.log(`✓ ${t}: ${rows.length} filas`);
}
console.log(`Respaldo guardado en ${dir}`);
