import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Pencil, Plus, Save, Trash2, UserPlus } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ErrorBox, Loading, Modal, Spinner, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { api, q } from '../lib/api'
import { emailToUsername } from '../lib/config'
import { errorMessage } from '../lib/errors'
import type { StaffUser } from '../lib/types'

interface Role { id: number; name: string; label: string; permissions: string[]; is_system: boolean }
interface Draft { role_id: number | null; full_name: string; is_active: boolean }

/** Permisos agrupados por área, con su descripción en lenguaje claro. */
const PERMISSION_GROUPS: { title: string; items: { key: string; label: string }[] }[] = [
  { title: 'Pedidos', items: [
    { key: 'orders.view', label: 'Ver pedidos y seguimiento' },
    { key: 'orders.create', label: 'Tomar pedidos (Caja)' },
    { key: 'orders.edit', label: 'Modificar pedidos pendientes' },
    { key: 'orders.cancel', label: 'Cancelar pedidos' },
    { key: 'orders.serve', label: 'Marcar pedidos como entregados' },
    { key: 'orders.kitchen', label: 'Cocina: pasar a “en preparación” y “listo”' },
  ] },
  { title: 'Dinero', items: [
    { key: 'payments.register', label: 'Cobrar y emitir comprobantes' },
    { key: 'reports.view', label: 'Ver reportes de ventas' },
  ] },
  { title: 'Administración', items: [
    { key: 'menu.manage', label: 'Editar la carta y promociones' },
    { key: 'tables.manage', label: 'Mesas y códigos QR' },
    { key: 'settings.manage', label: 'Ajustes del local' },
    { key: 'users.manage', label: 'Personal y puestos (equivale a ser administrador)' },
  ] },
]

export default function Users() {
  const toast = useToast()
  const { profile } = useAuth()
  const [users, setUsers] = useState<StaffUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [roleModal, setRoleModal] = useState<Role | 'new' | null>(null)

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([
        q<StaffUser[]>(supabase.from('users').select('*, roles(id,name,label)').order('created_at')),
        q<Role[]>(supabase.from('roles').select('*').order('id')),
      ])
      setUsers(u); setRoles(r); setDrafts({}); setError('')
    } catch (e) { setError(errorMessage(e)) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const val = (u: StaffUser): Draft => drafts[u.id] ?? { role_id: u.role_id, full_name: u.full_name, is_active: u.is_active }
  const set = (u: StaffUser, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [u.id]: { ...val(u), ...patch } }))

  async function save(u: StaffUser) {
    const d = val(u)
    try { await api.adminUpdateUser(u.id, d.role_id, d.full_name, d.is_active); toast('Usuario actualizado'); await load() }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  async function resetPassword(u: StaffUser) {
    const pw = window.prompt(`Nueva contraseña para ${emailToUsername(u.email)} (mínimo 8 caracteres):`)
    if (pw === null) return
    try { await api.setStaffPassword(u.id, pw); toast('Contraseña actualizada') }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  async function removeRole(r: Role) {
    if (!window.confirm(`¿Eliminar el puesto “${r.label}”?`)) return
    try { await api.deleteRole(r.id); toast('Puesto eliminado'); await load() }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6 p-3 sm:p-6">
        <div>
          <h1 className="text-3xl">Personal y puestos</h1>
          <p className="mt-1 text-sm text-slate-500">Crea cuentas con usuario y contraseña y define qué puede hacer cada puesto. No necesitas entrar a Supabase.</p>
        </div>

        {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={load} /> : (
          <>
            <CreateUser roles={roles} onCreated={load} />

            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Usuarios</h2>
              <div className="card divide-y divide-slate-200/60">
                {users.map((u) => {
                  const d = val(u)
                  const dirty = !!drafts[u.id]
                  return (
                    <div key={u.id} className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-48 flex-1">
                        <input className="input mb-1.5" placeholder="Nombre" value={d.full_name} onChange={(e) => set(u, { full_name: e.target.value })} />
                        <div className="text-xs text-slate-500">
                          Usuario: <b className="text-slate-700">{emailToUsername(u.email)}</b>{u.id === profile?.id && ' (tú)'}
                        </div>
                      </div>
                      <select className="input w-44" value={d.role_id ?? ''} onChange={(e) => set(u, { role_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">Sin puesto</option>
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                      <Toggle checked={d.is_active} onChange={(v) => set(u, { is_active: v })} label="Activo" />
                      <button className="btn btn-secondary btn-sm" onClick={() => resetPassword(u)} title="Cambiar contraseña"><KeyRound size={14} /> Contraseña</button>
                      <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => save(u)}><Save size={14} /> Guardar</button>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Puestos y permisos</h2>
                <button className="btn btn-primary btn-sm" onClick={() => setRoleModal('new')}><Plus size={14} /> Nuevo puesto</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {roles.map((r) => {
                  const all = r.permissions.includes('*')
                  const count = users.filter((u) => u.role_id === r.id).length
                  return (
                    <div key={r.id} className="card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">{r.label}</div>
                          <div className="text-xs text-slate-500">{count} usuario{count === 1 ? '' : 's'}{r.is_system && ' · del sistema'}</div>
                        </div>
                        {r.name !== 'admin' && (
                          <div className="flex gap-1">
                            <button className="btn btn-ghost btn-sm !px-2" title="Editar" onClick={() => setRoleModal(r)}><Pencil size={14} /></button>
                            {!r.is_system && <button className="btn btn-ghost btn-sm !px-2 text-red-600" title="Eliminar" onClick={() => removeRole(r)}><Trash2 size={14} /></button>}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {all ? <span className="badge bg-brand-100 text-brand-800">Todos los permisos</span>
                          : r.permissions.length === 0 ? <span className="text-xs text-slate-400">Sin permisos</span>
                          : r.permissions.map((p) => <span key={p} className="badge bg-slate-100 text-slate-600">{permLabel(p)}</span>)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>

      {roleModal && <RoleModal role={roleModal === 'new' ? null : roleModal} onClose={() => setRoleModal(null)} onSaved={() => { setRoleModal(null); void load() }} />}
    </AppShell>
  )
}

const permLabel = (key: string) => PERMISSION_GROUPS.flatMap((g) => g.items).find((i) => i.key === key)?.label.split(' (')[0] ?? key

/* ------------------------------------------------------------------ */
function CreateUser({ roles, onCreated }: { roles: Role[]; onCreated: () => void }) {
  const toast = useToast()
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.createStaffUser(username.trim().toLowerCase(), password, fullName.trim(), roleId ? Number(roleId) : null)
      toast(`Usuario “${username.trim().toLowerCase()}” creado`)
      setUsername(''); setFullName(''); setPassword(''); setRoleId('')
      onCreated()
    } catch (x) { toast(errorMessage(x), 'error') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><UserPlus size={18} /> Crear usuario</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="nu-user">Usuario</label>
          <input id="nu-user" className="input" required minLength={3} maxLength={30} autoCapitalize="none" spellCheck={false} placeholder="ej. cocina1" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="nu-name">Nombre</label>
          <input id="nu-name" className="input" maxLength={80} placeholder="ej. María Pérez" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="nu-pw">Contraseña (mín. 8)</label>
          <input id="nu-pw" className="input" type="text" required minLength={8} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="nu-role">Puesto</label>
          <select id="nu-role" className="input" required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Elegir…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Entrégale el usuario y la contraseña a la persona; podrás cambiarla cuando quieras. Minúsculas, números, punto, guion y guion bajo.</p>
        <button className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : <><UserPlus size={15} /> Crear</>}</button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
function RoleModal({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(role?.label ?? '')
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []))
  const [busy, setBusy] = useState(false)

  const toggle = (k: string) => setPerms((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  async function save() {
    setBusy(true)
    try { await api.saveRole(role?.id ?? null, label, [...perms]); toast(role ? 'Puesto actualizado' : 'Puesto creado'); onSaved() }
    catch (e) { toast(errorMessage(e), 'error') }
    finally { setBusy(false) }
  }

  return (
    <Modal title={role ? `Editar puesto: ${role.label}` : 'Nuevo puesto'} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy || label.trim().length < 2} onClick={save}>{busy ? <Spinner /> : 'Guardar'}</button></>}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="role-label">Nombre del puesto</label>
          <input id="role-label" className="input" maxLength={40} placeholder="ej. Barista, Supervisor…" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="label">{g.title}</legend>
            <div className="space-y-1.5">
              {g.items.map((i) => (
                <label key={i.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={perms.has(i.key)} onChange={() => toggle(i.key)} />
                  <span>{i.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {perms.has('users.manage') && <p className="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">Este permiso permite crear usuarios y asignar el puesto de Administrador: úsalo solo para personas de máxima confianza.</p>}
      </div>
    </Modal>
  )
}
