import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Empty, ErrorBox, Field, Loading, Modal, Spinner, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { useSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { q } from '../lib/api'
import { errorCode, errorMessage } from '../lib/errors'
import { imageUrl, removeProductImage, uploadProductImage } from '../lib/image'
import type { Category, Product, Promotion } from '../lib/types'

type Tab = 'products' | 'categories' | 'promotions'

export default function MenuAdmin() {
  const [tab, setTab] = useState<Tab>('products')
  const [cats, setCats] = useState<Category[]>([])
  const [prods, setProds] = useState<Product[]>([])
  const [promos, setPromos] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [c, p, r] = await Promise.all([
        q<Category[]>(supabase.from('categories').select('*').order('sort_order').order('name')),
        q<Product[]>(supabase.from('products').select('*').order('sort_order').order('name')),
        q<Promotion[]>(supabase.from('promotions').select('*').order('created_at', { ascending: false })),
      ])
      setCats(c); setProds(p.map((x) => ({ ...x, price: Number(x.price) }))); setPromos(r); setError('')
    } catch (e) { setError(errorMessage(e)) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-5">
        <div className="flex gap-2">
          {([['products', 'Productos'], ['categories', 'Categorías'], ['promotions', 'Promociones']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`chip ${tab === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`}>{l}</button>
          ))}
        </div>
        {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={load} /> : (
          tab === 'products' ? <Products cats={cats} prods={prods} reload={load} />
            : tab === 'categories' ? <Categories cats={cats} prods={prods} reload={load} />
            : <Promotions cats={cats} prods={prods} promos={promos} reload={load} />
        )}
      </div>
    </AppShell>
  )
}

/* ---------------- Categorías ---------------- */
function Categories({ cats, prods, reload }: { cats: Category[]; prods: Product[]; reload: () => Promise<void> }) {
  const toast = useToast()
  const [edit, setEdit] = useState<Partial<Category> | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!edit?.name?.trim()) return toast('El nombre es obligatorio', 'error')
    setBusy(true)
    try {
      const row = { name: edit.name.trim(), description: edit.description?.trim() || null, sort_order: Number(edit.sort_order) || 0, is_active: edit.is_active ?? true }
      if (edit.id) await q(supabase.from('categories').update(row).eq('id', edit.id))
      else await q(supabase.from('categories').insert(row))
      setEdit(null); await reload(); toast('Categoría guardada')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  async function del(c: Category) {
    if (!window.confirm(`¿Eliminar la categoría “${c.name}”?`)) return
    try { await q(supabase.from('categories').delete().eq('id', c.id)); await reload(); toast('Categoría eliminada') }
    catch (e) { toast(errorCode(e) === 'FK_VIOLATION' ? 'Tiene productos: muévelos o desactiva la categoría.' : errorMessage(e), 'error') }
  }
  async function toggle(c: Category, v: boolean) {
    try { await q(supabase.from('categories').update({ is_active: v }).eq('id', c.id)); await reload() } catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <>
      <div className="flex justify-end"><button className="btn btn-primary" onClick={() => setEdit({ is_active: true, sort_order: cats.length + 1 })}><Plus size={16} /> Nueva categoría</button></div>
      {cats.length === 0 ? <Empty text="Aún no hay categorías" /> : (
        <div className="card divide-y divide-slate-100">
          {cats.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3">
              <span className="w-8 text-center text-sm text-slate-400">{c.sort_order}</span>
              <div className="flex-1"><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{prods.filter((p) => p.category_id === c.id).length} productos{c.description ? ` · ${c.description}` : ''}</div></div>
              <Toggle checked={c.is_active} onChange={(v) => toggle(c, v)} label="Visible" />
              <button className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil size={15} /></button>
              <button className="btn btn-ghost btn-sm text-red-600" onClick={() => del(c)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Editar categoría' : 'Nueva categoría'} onClose={() => setEdit(null)}
          footer={<><button className="btn btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>Guardar</button></>}>
          <div className="space-y-3">
            <Field label="Nombre"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Descripción (opcional)"><input className="input" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Orden en la carta"><input className="input" type="number" value={edit.sort_order ?? 0} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></Field>
            <Toggle checked={edit.is_active ?? true} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Visible en la carta" />
          </div>
        </Modal>
      )}
    </>
  )
}

/* ---------------- Productos ---------------- */
function Products({ cats, prods, reload }: { cats: Category[]; prods: Product[]; reload: () => Promise<void> }) {
  const toast = useToast()
  const { fmt } = useSettings()
  const [filter, setFilter] = useState('all')
  const [edit, setEdit] = useState<Partial<Product> | null>(null)
  const list = useMemo(() => prods.filter((p) => filter === 'all' || p.category_id === filter), [prods, filter])

  async function patch(p: Product, values: Partial<Product>) {
    try { await q(supabase.from('products').update(values).eq('id', p.id)); await reload() } catch (e) { toast(errorMessage(e), 'error') }
  }
  async function del(p: Product) {
    if (!window.confirm(`¿Eliminar “${p.name}”?`)) return
    try {
      await q(supabase.from('products').delete().eq('id', p.id))
      await removeProductImage(p.image_path); await reload(); toast('Producto eliminado')
    } catch (e) {
      if (errorCode(e) === 'FK_VIOLATION') { await patch(p, { is_active: false }); toast('Tiene pedidos en el historial: se retiró de la carta (desactivado) en vez de borrarse.', 'info') }
      else toast(errorMessage(e), 'error')
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todas las categorías</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn btn-primary ml-auto" disabled={!cats.length} onClick={() => setEdit({ is_available: true, is_active: true, category_id: filter !== 'all' ? filter : cats[0]?.id, sort_order: 0 })}>
          <Plus size={16} /> Nuevo producto
        </button>
      </div>
      {!cats.length && <p className="text-sm text-amber-700">Primero crea una categoría.</p>}
      {list.length === 0 ? <Empty text="No hay productos" /> : (
        <div className="card divide-y divide-slate-100">
          {list.map((p) => {
            const img = imageUrl(p.image_path)
            return (
              <div key={p.id} className={`flex flex-wrap items-center gap-3 p-3 ${p.is_active ? '' : 'opacity-50'}`}>
                {img ? <img src={img} alt="" loading="lazy" className="h-12 w-12 rounded-lg object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-300"><ImagePlus size={18} /></div>}
                <div className="min-w-40 flex-1">
                  <div className="font-medium">{p.name}{!p.is_active && <span className="ml-2 badge bg-slate-200 text-slate-600">Retirado</span>}</div>
                  <div className="text-xs text-slate-500">{cats.find((c) => c.id === p.category_id)?.name} · {fmt(p.price)}</div>
                </div>
                <Toggle checked={p.is_available} onChange={(v) => patch(p, { is_available: v })} label={p.is_available ? 'Disponible' : 'Agotado'} />
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit(p)}><Pencil size={15} /></button>
                <button className="btn btn-ghost btn-sm text-red-600" onClick={() => del(p)}><Trash2 size={15} /></button>
              </div>
            )
          })}
        </div>
      )}
      {edit && <ProductForm initial={edit} cats={cats} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload() }} />}
    </>
  )
}

function ProductForm({ initial, cats, onClose, onSaved }: { initial: Partial<Product>; cats: Category[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [p, setP] = useState<Partial<Product>>(initial)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(imageUrl(initial.image_path))
  const [removeImg, setRemoveImg] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!p.name?.trim()) return toast('El nombre es obligatorio', 'error')
    if (!p.category_id) return toast('Elige una categoría', 'error')
    const price = Number(p.price)
    if (!Number.isFinite(price) || price < 0) return toast('Precio no válido', 'error')
    setBusy(true)
    try {
      let image_path = p.image_path ?? null
      const old = image_path
      if (file) image_path = await uploadProductImage(file)
      else if (removeImg) image_path = null
      const row = {
        category_id: p.category_id, name: p.name.trim(), description: p.description?.trim() || null,
        ingredients: p.ingredients?.trim() || null, price, image_path,
        is_available: p.is_available ?? true, is_active: p.is_active ?? true, sort_order: Number(p.sort_order) || 0,
      }
      if (p.id) await q(supabase.from('products').update(row).eq('id', p.id))
      else await q(supabase.from('products').insert(row))
      if (old && old !== image_path) await removeProductImage(old)
      toast('Producto guardado'); await onSaved()
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title={p.id ? 'Editar producto' : 'Nuevo producto'} wide onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Guardar'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre"><input className="input" value={p.name ?? ''} onChange={(e) => setP({ ...p, name: e.target.value })} autoFocus /></Field>
        <Field label="Categoría">
          <select className="input" value={p.category_id ?? ''} onChange={(e) => setP({ ...p, category_id: e.target.value })}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Precio"><input className="input" inputMode="decimal" value={p.price ?? ''} onChange={(e) => setP({ ...p, price: e.target.value.replace(',', '.') as unknown as number })} /></Field>
        <Field label="Orden"><input className="input" type="number" value={p.sort_order ?? 0} onChange={(e) => setP({ ...p, sort_order: Number(e.target.value) })} /></Field>
        <div className="sm:col-span-2"><Field label="Descripción"><textarea className="input" rows={2} value={p.description ?? ''} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Ingredientes / características"><input className="input" value={p.ingredients ?? ''} onChange={(e) => setP({ ...p, ingredients: e.target.value })} /></Field></div>
        <div className="sm:col-span-2">
          <label className="label">Fotografía (se reduce y comprime automáticamente para cuidar el almacenamiento gratuito)</label>
          <div className="flex items-center gap-3">
            {preview && !removeImg ? <img src={preview} alt="" className="h-20 w-20 rounded-lg object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-slate-100 text-slate-300"><ImagePlus /></div>}
            <div className="space-y-1">
              <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setRemoveImg(false); setPreview(URL.createObjectURL(f)) } }} className="text-sm" />
              {(preview || p.image_path) && !removeImg && <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => { setRemoveImg(true); setFile(null) }}>Quitar foto</button>}
            </div>
          </div>
        </div>
        <Toggle checked={p.is_available ?? true} onChange={(v) => setP({ ...p, is_available: v })} label="Disponible (apágalo si está agotado)" />
        <Toggle checked={p.is_active ?? true} onChange={(v) => setP({ ...p, is_active: v })} label="En la carta (apágalo para retirarlo)" />
      </div>
    </Modal>
  )
}

/* ---------------- Promociones ---------------- */
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

function Promotions({ cats, prods, promos, reload }: { cats: Category[]; prods: Product[]; promos: Promotion[]; reload: () => Promise<void> }) {
  const toast = useToast()
  const { fmt } = useSettings()
  const [edit, setEdit] = useState<(Partial<Promotion> & { target?: 'all' | 'category' | 'product' }) | null>(null)
  const [busy, setBusy] = useState(false)

  const targetOf = (p: Promotion) => p.product_id ? `Producto: ${prods.find((x) => x.id === p.product_id)?.name ?? '?'}` : p.category_id ? `Categoría: ${cats.find((x) => x.id === p.category_id)?.name ?? '?'}` : 'Toda la carta'

  async function save() {
    if (!edit?.name?.trim()) return toast('El nombre es obligatorio', 'error')
    const value = Number(edit.discount_value)
    if (!(value > 0)) return toast('El descuento debe ser mayor que 0', 'error')
    if (edit.target === 'category' && !edit.category_id) return toast('Elige la categoría', 'error')
    if (edit.target === 'product' && !edit.product_id) return toast('Elige el producto', 'error')
    setBusy(true)
    try {
      const row = {
        name: edit.name.trim(), description: edit.description?.trim() || null,
        discount_type: edit.discount_type ?? 'percent', discount_value: value,
        product_id: edit.target === 'product' ? edit.product_id : null,
        category_id: edit.target === 'category' ? edit.category_id : null,
        starts_at: edit.starts_at ? new Date(edit.starts_at).toISOString() : null,
        ends_at: edit.ends_at ? new Date(edit.ends_at).toISOString() : null,
        is_active: edit.is_active ?? true,
      }
      if (edit.id) await q(supabase.from('promotions').update(row).eq('id', edit.id))
      else await q(supabase.from('promotions').insert(row))
      setEdit(null); await reload(); toast('Promoción guardada')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  async function del(p: Promotion) {
    if (!window.confirm(`¿Eliminar la promoción “${p.name}”?`)) return
    try { await q(supabase.from('promotions').delete().eq('id', p.id)); await reload() } catch (e) { toast(errorMessage(e), 'error') }
  }
  async function toggle(p: Promotion, v: boolean) {
    try { await q(supabase.from('promotions').update({ is_active: v }).eq('id', p.id)); await reload() } catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <>
      <div className="flex justify-end"><button className="btn btn-primary" onClick={() => setEdit({ target: 'all', discount_type: 'percent', is_active: true })}><Plus size={16} /> Nueva promoción</button></div>
      <p className="text-sm text-slate-500">Las promociones se aplican automáticamente al precio en la caja y en el menú QR. Si varias coinciden, se usa la que deja el precio más bajo.</p>
      {promos.length === 0 ? <Empty text="No hay promociones" /> : (
        <div className="card divide-y divide-slate-100">
          {promos.map((p) => {
            const expired = p.ends_at && new Date(p.ends_at) < new Date()
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-48 flex-1">
                  <div className="font-medium">{p.name} {expired && <span className="badge bg-slate-200 text-slate-600">Vencida</span>}</div>
                  <div className="text-xs text-slate-500">
                    {p.discount_type === 'percent' ? `${p.discount_value}%` : fmt(p.discount_value)} de descuento · {targetOf(p)}
                    {p.starts_at && ` · desde ${new Date(p.starts_at).toLocaleString('es-PE')}`}{p.ends_at && ` · hasta ${new Date(p.ends_at).toLocaleString('es-PE')}`}
                  </div>
                </div>
                <Toggle checked={p.is_active} onChange={(v) => toggle(p, v)} label="Activa" />
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...p, target: p.product_id ? 'product' : p.category_id ? 'category' : 'all', starts_at: toLocalInput(p.starts_at), ends_at: toLocalInput(p.ends_at) })}><Pencil size={15} /></button>
                <button className="btn btn-ghost btn-sm text-red-600" onClick={() => del(p)}><Trash2 size={15} /></button>
              </div>
            )
          })}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Editar promoción' : 'Nueva promoción'} wide onClose={() => setEdit(null)}
          footer={<><button className="btn btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>Guardar</button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Nombre"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field></div>
            <Field label="Tipo de descuento">
              <select className="input" value={edit.discount_type} onChange={(e) => setEdit({ ...edit, discount_type: e.target.value as 'percent' | 'amount' })}>
                <option value="percent">Porcentaje (%)</option><option value="amount">Monto fijo por unidad</option>
              </select>
            </Field>
            <Field label="Valor"><input className="input" inputMode="decimal" value={edit.discount_value ?? ''} onChange={(e) => setEdit({ ...edit, discount_value: e.target.value.replace(',', '.') as unknown as number })} /></Field>
            <Field label="Se aplica a">
              <select className="input" value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value as 'all' | 'category' | 'product' })}>
                <option value="all">Toda la carta</option><option value="category">Una categoría</option><option value="product">Un producto</option>
              </select>
            </Field>
            {edit.target === 'category' && <Field label="Categoría"><select className="input" value={edit.category_id ?? ''} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            {edit.target === 'product' && <Field label="Producto"><select className="input" value={edit.product_id ?? ''} onChange={(e) => setEdit({ ...edit, product_id: e.target.value })}><option value="">—</option>{prods.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field label="Desde (opcional)"><input className="input" type="datetime-local" value={edit.starts_at ?? ''} onChange={(e) => setEdit({ ...edit, starts_at: e.target.value })} /></Field>
            <Field label="Hasta (opcional)"><input className="input" type="datetime-local" value={edit.ends_at ?? ''} onChange={(e) => setEdit({ ...edit, ends_at: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Descripción (opcional)"><input className="input" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field></div>
            <Toggle checked={edit.is_active ?? true} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Activa" />
          </div>
        </Modal>
      )}
    </>
  )
}
