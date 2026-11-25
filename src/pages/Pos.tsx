import { Ticket } from '../components/Ticket'
import { printNode } from '../components/Print'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, Printer, CreditCard, Minus, Pencil, Plus, Search, Send, Smartphone, StickyNote, Trash2, X, Landmark, Wallet } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ChannelBadge, ConnectionPill, Empty, ErrorBox, Loading, StatusBadge } from '../components/ui'
import { useAuth } from '../auth/AuthProvider'
import { useMenu } from '../hooks/useMenu'
import { useOrders } from '../hooks/useOrders'
import { useToast } from '../components/Toast'
import { useSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { api, q } from '../lib/api'
import { errorCode, errorMessage } from '../lib/errors'
import { imageUrl } from '../lib/image'
import { tableLabel, uuid } from '../lib/util'
import { METHOD_LABEL, type CartLine, type MenuProduct, type Order, type PaymentMethod, type TableRow } from '../lib/types'

export default function Pos() {
  const { can } = useAuth()
  const ord = useOrders()
  const [tab, setTab] = useState<'new' | 'accounts'>(can('orders.create') ? 'new' : 'accounts')
  const [editing, setEditing] = useState<Order | null>(null)
  const unpaid = ord.orders.filter((o) => o.payment_status === 'unpaid')

  return (
    <AppShell right={<ConnectionPill conn={ord.conn} />}>
      <div className="mx-auto max-w-[1400px] p-3 sm:p-5">
        <div className="mb-4 flex gap-2">
          {can('orders.create') && (
            <button className={`chip ${tab === 'new' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`} onClick={() => setTab('new')}>
              {editing ? `Editando #${editing.order_number}` : 'Nuevo pedido'}
            </button>
          )}
          <button className={`chip ${tab === 'accounts' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`} onClick={() => setTab('accounts')}>
            Cuentas {unpaid.length > 0 && <span className="rounded-full bg-black/20 px-1.5 text-xs">{unpaid.length}</span>}
          </button>
        </div>
        {tab === 'new' && can('orders.create')
          ? <NewOrder orders={ord.orders} editing={editing} onDone={() => { setEditing(null); void ord.reload() }} onCancelEdit={() => setEditing(null)} />
          : ord.loading ? <Loading /> : ord.error ? <ErrorBox text={ord.error} onRetry={ord.reload} />
          : <Accounts orders={unpaid} reload={ord.reload} onEdit={(o) => { setEditing(o); setTab('new') }} />}
      </div>
    </AppShell>
  )
}

/* ------------------------------------------------------------------ */
function NewOrder({ orders, editing, onDone, onCancelEdit }: {
  orders: Order[]; editing: Order | null; onDone: () => void; onCancelEdit: () => void
}) {
  const { fmt } = useSettings()
  const toast = useToast()
  const menu = useMenu(true)
  const [tables, setTables] = useState<TableRow[]>([])
  const [tableId, setTableId] = useState<string>('')
  const [noTable, setNoTable] = useState(false) // pedido sin mesa (para llevar / mostrador)
  const [lines, setLines] = useState<CartLine[]>([])
  const [note, setNote] = useState('')
  const [cat, setCat] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const requestId = useRef(uuid())

  useEffect(() => {
    q<TableRow[]>(supabase.from('tables').select('*').eq('is_active', true).order('number')).then(setTables).catch((e) => toast(errorMessage(e), 'error'))
  }, [toast])

  // Al editar un pedido, precargar sus líneas
  useEffect(() => {
    if (!editing) return
    setTableId(editing.table_id ?? '')
    setNoTable(!editing.table_id)
    setNote(editing.customer_note ?? '')
    setLines(editing.order_items.slice().sort((a, b) => a.line_no - b.line_no).map((it) => {
      const p = menu.products.find((x) => x.id === it.product_id)
      const product: MenuProduct = p ?? {
        id: it.product_id, category_id: '', name: it.product_name, description: null, ingredients: null,
        price: it.list_price, final_price: it.unit_price, image_path: null, is_available: false, sort_order: 0,
      }
      return { product, quantity: it.quantity, notes: it.notes ?? '' }
    }))
    requestId.current = uuid()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, menu.products.length])

  const touch = () => { requestId.current = uuid() } // cambia el contenido → nueva clave de idempotencia
  const occupied = useMemo(() => new Set(orders.filter((o) => o.payment_status === 'unpaid' && o.table_id).map((o) => o.table_id as string)), [orders])

  const shown = useMemo(() => menu.products.filter((p) =>
    (cat === 'all' || p.category_id === cat) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()))), [menu.products, cat, search])

  const add = (p: MenuProduct) => {
    if (!p.is_available) return
    touch()
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id)
      return i >= 0 ? ls.map((l, k) => (k === i ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l)) : [...ls, { product: p, quantity: 1, notes: '' }]
    })
  }
  const setQty = (id: string, d: number) => { touch(); setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, quantity: Math.max(0, Math.min(99, l.quantity + d)) } : l)).filter((l) => l.quantity > 0)) }
  const setLineNote = (id: string, v: string) => { touch(); setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, notes: v.slice(0, 200) } : l))) }
  const remove = (id: string) => { touch(); setLines((ls) => ls.filter((l) => l.product.id !== id)) }

  const subtotal = lines.reduce((s, l) => s + l.product.price * l.quantity, 0)
  const total = lines.reduce((s, l) => s + l.product.final_price * l.quantity, 0)
  const hasUnavailable = lines.some((l) => !l.product.is_available)

  function reset() { setLines([]); setNote(''); setTableId(''); setNoTable(false); requestId.current = uuid() }

  async function submit() {
    if (!lines.length) return toast('Agrega al menos un producto', 'error')
    if (!editing && !noTable && !tableId) return toast('Selecciona una mesa o elige “Sin mesa”', 'error')
    const items = lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity, notes: l.notes.trim() || undefined }))
    setBusy(true)
    try {
      if (editing) {
        await api.replaceOrderItems(editing.id, items, note)
        toast(`Pedido #${editing.order_number} actualizado`)
      } else {
        const r = await api.createStaffOrder(noTable ? null : tableId, items, note.trim() || undefined, requestId.current)
        toast(`Pedido #${r.order_number} enviado a cocina · ${fmt(r.total)}`)
      }
      reset()
      onDone()
    } catch (e) {
      if (errorCode(e) === 'PRODUCT_UNAVAILABLE') void menu.reload()
      // Pedido sin mesa rechazado como "mesa inválida" = la base de datos aún no tiene la migración 20260103000000_notable_roles.sql
      const staleDb = noTable && !editing && errorCode(e) === 'INVALID_TABLE'
      toast(staleDb ? 'Falta actualizar la base de datos para pedidos sin mesa: ejecuta la migración 20260103000000_notable_roles.sql en Supabase.' : errorMessage(e), 'error') // el carrito se conserva; reintentar es seguro (misma clave)
    } finally { setBusy(false) }
  }

  if (menu.loading) return <Loading />
  if (menu.error) return <ErrorBox text={menu.error} onRetry={menu.reload} />

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      {/* Carta */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input className="input pl-9" placeholder="Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          <button className={`chip ${cat === 'all' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`} onClick={() => setCat('all')}>Todo</button>
          {menu.categories.map((c) => (
            <button key={c.id} className={`chip ${cat === c.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </div>
        {shown.length === 0 ? <Empty text="No hay productos" /> : (
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => {
              const qty = lines.find((l) => l.product.id === p.id)?.quantity
              const img = imageUrl(p.image_path)
              return (
                <button key={p.id} disabled={!p.is_available} onClick={() => add(p)}
                  className={`card relative overflow-hidden text-left ${p.is_available ? 'press' : 'opacity-60'} ${qty ? 'ring-2 ring-brand-500' : ''}`}>
                  {img && <img src={img} alt="" loading="lazy" className="h-24 w-full object-cover" />}
                  <div className="p-3">
                    <div className="text-sm font-semibold leading-tight">{p.name}</div>
                    <div className="mt-1 text-sm">
                      <span className="font-bold text-brand-700">{fmt(p.final_price)}</span>
                      {p.final_price < p.price && <span className="ml-1 text-xs text-slate-400 line-through">{fmt(p.price)}</span>}
                    </div>
                  </div>
                  {!p.is_available && <span className="absolute right-2 top-2 badge bg-red-600 text-white">AGOTADO</span>}
                  {qty && <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-1 text-xs font-bold text-white">{qty}</span>}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Pedido */}
      <aside className="card h-fit p-4 lg:sticky lg:top-16">
        {editing && (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            <span>Editando pedido #{editing.order_number} · {tableLabel(editing.tables)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { reset(); onCancelEdit() }}><X size={14} /> Salir</button>
          </div>
        )}
        {!editing && (
          <div className="mb-4">
            <div className="mb-2 flex gap-1.5">
              <button type="button" onClick={() => setNoTable(false)} className={`chip flex-1 justify-center ${!noTable ? 'chip-on' : 'border-slate-300 bg-white'}`}>Con mesa</button>
              <button type="button" onClick={() => { setNoTable(true); setTableId('') }} className={`chip flex-1 justify-center ${noTable ? 'chip-on' : 'border-slate-300 bg-white'}`}>Sin mesa</button>
            </div>
            {noTable && <p className="rounded-lg bg-slate-100/70 p-2 text-xs text-slate-500">Pedido sin mesa (para llevar o mostrador). Se cobra por separado desde “Cuentas”.</p>}
            {!noTable && <div className="label">Mesa</div>}
            <div className={`grid grid-cols-5 gap-1.5 sm:grid-cols-6 lg:grid-cols-5 ${noTable ? 'hidden' : ''}`}>
              {tables.map((t) => (
                <button key={t.id} onClick={() => setTableId(t.id)} title={t.name ?? ''}
                  className={`press rounded-xl border py-2 text-sm font-semibold ${
                    tableId === t.id ? 'border-brand-600 bg-brand-600 text-white'
                      : occupied.has(t.id) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                  {t.number}
                </button>
              ))}
              {tables.length === 0 && <p className="col-span-full text-sm text-slate-400">No hay mesas. Créalas en “Mesas y QR”.</p>}
            </div>
            {!noTable && <p className="mt-1 text-xs text-slate-400">Azul claro = mesa con cuenta abierta</p>}
          </div>
        )}

        {lines.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Toca un producto para agregarlo</p> : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l) => (
              <li key={l.product.id} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${l.product.is_available ? '' : 'text-red-600'}`}>{l.product.name}{!l.product.is_available && ' (agotado)'}</div>
                    <div className="text-xs text-slate-500">{fmt(l.product.final_price)} c/u</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="btn btn-secondary btn-sm !px-2" onClick={() => setQty(l.product.id, -1)}><Minus size={14} /></button>
                    <span className="w-6 text-center text-sm font-bold">{l.quantity}</span>
                    <button className="btn btn-secondary btn-sm !px-2" onClick={() => setQty(l.product.id, 1)}><Plus size={14} /></button>
                    <button className="btn btn-ghost btn-sm !px-2 text-red-500" onClick={() => remove(l.product.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <StickyNote size={13} className="text-slate-400" />
                  <input className="input !py-1 text-xs" placeholder="Observación (sin cebolla, bien cocido…)" value={l.notes} onChange={(e) => setLineNote(l.product.id, e.target.value)} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <textarea className="input mt-3" rows={2} placeholder="Nota general del pedido (opcional)" maxLength={300} value={note} onChange={(e) => { touch(); setNote(e.target.value) }} />

        <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
          {subtotal !== total && <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>}
          {subtotal !== total && <div className="flex justify-between text-emerald-600"><span>Promociones</span><span>− {fmt(subtotal - total)}</span></div>}
          <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{fmt(total)}</span></div>
        </div>
        {hasUnavailable && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">Hay productos agotados en el pedido. Quítalos para continuar.</p>}
        <button className="btn btn-primary btn-lg mt-3 w-full" disabled={busy || !lines.length || hasUnavailable} onClick={submit}>
          <Send size={18} /> {editing ? 'Guardar cambios' : 'Enviar a cocina'}
        </button>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */
const METHOD_ICON: Record<PaymentMethod, typeof Banknote> = { cash: Banknote, card: CreditCard, wallet: Smartphone, transfer: Landmark, other: Wallet }

function Accounts({ orders, reload, onEdit }: { orders: Order[]; reload: () => Promise<void>; onEdit: (o: Order) => void }) {
  const groups = useMemo(() => {
    // Con mesa: una cuenta por mesa. Sin mesa: cada pedido es su propia cuenta (van al final).
    const m = new Map<string, Order[]>()
    for (const o of orders) { const k = o.table_id ?? `solo:${o.id}`; const a = m.get(k) ?? []; a.push(o); m.set(k, a) }
    const rank = (g: Order[]) => (g[0].table_id ? g[0].tables?.number ?? 0 : 1_000_000 + g[0].order_number)
    return [...m.values()].sort((a, b) => rank(a) - rank(b))
  }, [orders])
  if (!groups.length) return <Empty text="No hay cuentas abiertas. Los pedidos sin pagar aparecerán aquí agrupados por mesa (o solos, si son sin mesa)." />
  return (
    <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => <AccountCard key={g[0].table_id ?? `solo:${g[0].id}`} orders={g} reload={reload} onEdit={onEdit} />)}
    </div>
  )
}

function AccountCard({ orders, reload, onEdit }: { orders: Order[]; reload: () => Promise<void>; onEdit: (o: Order) => void }) {
  const { can } = useAuth()
  const { fmt, settings } = useSettings()
  const toast = useToast()
  const [sel, setSel] = useState<Set<string>>(() => new Set(orders.map((o) => o.id)))
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [ref, setRef] = useState('')
  const [received, setReceived] = useState('')
  const [busy, setBusy] = useState(false)

  // Pedidos nuevos de la mesa entran seleccionados
  const seen = useRef(new Set(orders.map((o) => o.id)))
  useEffect(() => {
    const fresh = orders.filter((o) => !seen.current.has(o.id))
    if (fresh.length) { fresh.forEach((o) => seen.current.add(o.id)); setSel((s) => new Set([...s, ...fresh.map((o) => o.id)])) }
  }, [orders])

  const chosen = orders.filter((o) => sel.has(o.id))
  const total = chosen.reduce((s, o) => s + o.total, 0)
  const change = method === 'cash' && received ? Number(received) - total : null
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const pay = useCallback(async () => {
    setBusy(true)
    try {
      const r = await api.registerPayment(chosen.map((o) => o.id), method, ref.trim() || undefined)
      toast(`Cobrado ${fmt(r.total)} (${r.orders} pedido${r.orders > 1 ? 's' : ''}) · ${METHOD_LABEL[method]}. Ticket y boleta: pestaña Comprobantes.`)
      setReceived(''); setRef('')
      await reload()
    } catch (e) { toast(errorMessage(e), 'error'); void reload() }
    finally { setBusy(false) }
  }, [chosen, method, ref, fmt, toast, reload])

  async function cancel(o: Order) {
    const reason = window.prompt(`¿Cancelar el pedido #${o.order_number}? Motivo (opcional):`)
    if (reason === null) return
    try { await api.cancelOrder(o.id, reason); toast(`Pedido #${o.order_number} cancelado`, 'info'); await reload() }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-lg font-bold">{orders[0].table_id ? tableLabel(orders[0].tables) : `Sin mesa · #${orders[0].order_number}`}</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">{orders.length} pedido{orders.length > 1 ? 's' : ''}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => printNode(<Ticket settings={settings} orders={chosen.length ? chosen : orders} kind="precuenta" />)}><Printer size={13} /> Pre-cuenta</button>
        </div>
      </div>
      <ul className="flex-1 divide-y divide-slate-100">
        {orders.map((o) => (
          <li key={o.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              {can('payments.register') && <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} />}
              <span className="font-bold">#{o.order_number}</span>
              <StatusBadge status={o.status} /><ChannelBadge channel={o.channel} />
              <span className="ml-auto font-semibold">{fmt(o.total)}</span>
            </div>
            <div className="mt-1 pl-6 text-sm text-slate-600">
              {o.order_items.slice().sort((a, b) => a.line_no - b.line_no).map((it) => <div key={it.id}>{it.quantity}× {it.product_name}{it.notes && <span className="text-amber-700"> ({it.notes})</span>}</div>)}
            </div>
            <div className="mt-1 flex gap-1 pl-6">
              {can('orders.edit') && o.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => onEdit(o)}><Pencil size={13} /> Editar</button>}
              {can('orders.cancel') && o.status !== 'delivered' && <button className="btn btn-ghost btn-sm text-red-600" onClick={() => cancel(o)}><X size={13} /> Cancelar</button>}
            </div>
          </li>
        ))}
      </ul>
      {can('payments.register') && (
        <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => {
              const Icon = METHOD_ICON[m]
              return <button key={m} onClick={() => setMethod(m)} className={`chip !px-2.5 !py-1 text-xs ${method === m ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`}><Icon size={13} />{METHOD_LABEL[m]}</button>
            })}
          </div>
          {method === 'cash'
            ? <div className="flex items-center gap-2"><input className="input" inputMode="decimal" placeholder="Efectivo recibido" value={received} onChange={(e) => setReceived(e.target.value.replace(',', '.'))} />
                {change !== null && <span className={`whitespace-nowrap text-sm font-semibold ${change < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{change < 0 ? `Falta ${fmt(-change)}` : `Vuelto ${fmt(change)}`}</span>}</div>
            : <input className="input" placeholder="Referencia / N.º de operación (opcional)" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} />}
          <button className="btn btn-primary btn-lg w-full" disabled={busy || !chosen.length || (method === 'cash' && change !== null && change < 0)} onClick={pay}>
            Cobrar {fmt(total)}
          </button>
        </div>
      )}
    </div>
  )
}
