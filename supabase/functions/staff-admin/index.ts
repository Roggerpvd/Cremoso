// Edge Function "staff-admin": el administrador crea cuentas (usuario + contraseña) y cambia contraseñas
// desde la pantalla Personal, sin entrar al panel de Supabase.
//
// Seguridad:
//  · La clave service_role vive SOLO aquí (variable de entorno del servidor). Nunca llega al navegador.
//  · Antes de hacer nada se verifica, con el JWT de quien llama, que sea personal activo con permiso
//    "users.manage" (o "*").
//
// Despliegue (una sola vez):
//   npx supabase login
//   npx supabase link --project-ref <tu-project-ref>
//   npx supabase functions deploy staff-admin
// Opcional (si el dominio por defecto es rechazado por Supabase Auth, usa uno tuyo; no se envían correos):
//   npx supabase secrets set STAFF_EMAIL_DOMAIN=tu-dominio.pe
// Debe coincidir con STAFF_EMAIL_DOMAIN de public/config.js.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const DOMAIN = (Deno.env.get('STAFF_EMAIL_DOMAIN') || 'restopos.local').toLowerCase()
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'FORBIDDEN' }, 401)

  // 1. ¿Quién llama y qué permisos tiene? (con su propio JWT, respetando RLS)
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const { data: userData, error: userErr } = await caller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'FORBIDDEN' }, 401)
  const { data: profile, error: profErr } = await caller.rpc('get_my_profile')
  if (profErr || !profile || !profile.is_active || !profile.role) return json({ error: 'FORBIDDEN' }, 403)
  const perms: string[] = profile.permissions ?? []
  if (!perms.includes('*') && !perms.includes('users.manage')) return json({ error: 'FORBIDDEN' }, 403)

  // 2. Acción solicitada
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

  if (body.action === 'create') {
    const username = String(body.username ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const fullName = String(body.full_name ?? '').trim().slice(0, 80)
    const roleId = body.role_id == null || body.role_id === '' ? null : Number(body.role_id)
    if (!USERNAME_RE.test(username)) return json({ error: 'INVALID_USERNAME' }, 400)
    if (password.length < 8) return json({ error: 'WEAK_PASSWORD' }, 400)
    if (roleId !== null) {
      const { data: role } = await admin.from('roles').select('id').eq('id', roleId).maybeSingle()
      if (!role) return json({ error: 'ROLE_NOT_FOUND' }, 400)
    }
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${username}@${DOMAIN}`, password, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (error || !created.user) {
      const dup = /already|registered|exists/i.test(error?.message ?? '')
      return json({ error: dup ? 'USERNAME_TAKEN' : 'CREATE_FAILED', detail: error?.message }, dup ? 409 : 400)
    }
    // El trigger de la BD ya creó la fila en public.users; fijamos puesto y nombre.
    const { error: upErr } = await admin.from('users').update({ role_id: roleId, full_name: fullName }).eq('id', created.user.id)
    if (upErr) return json({ error: 'ROLE_ASSIGN_FAILED', detail: upErr.message, user_id: created.user.id }, 500)
    return json({ user_id: created.user.id })
  }

  if (body.action === 'set_password') {
    const userId = String(body.user_id ?? '')
    const password = String(body.password ?? '')
    if (!userId) return json({ error: 'INVALID_REQUEST' }, 400)
    if (password.length < 8) return json({ error: 'WEAK_PASSWORD' }, 400)
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return json({ error: 'UPDATE_FAILED', detail: error.message }, 400)
    return json({ user_id: userId })
  }

  return json({ error: 'INVALID_REQUEST' }, 400)
})
