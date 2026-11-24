import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, ChefHat, ClipboardList, Minus, Plus, ShoppingBag, StickyNote, X } from 'lucide-react'
import { Loading, Spinner } from '../../components/ui'
import { api } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { errorCode, errorMessage } from '../../lib/errors'
import { imageUrl } from '../../lib/image'
import { money, uuid } from '../../lib/util'
import type { Category, MenuProduct, OrderStatus, PublicOrder, TableInfo } from '../../lib/types'

interface StoredCart { lines: { id: string; q: number; n: string }[]; note: string; rid: string }

const CUSTOMER_STATUS: Record<OrderStatus, { text: string; cls: string }> = {
  pending: { text: 'Recibido · esperando a cocina', cls: 'bg-amber-100 text-amber-800' },
  preparing: { text: 'En preparación', cls: 'bg-sky-100 text-sky-800' },
  ready: { text: '¡Listo! Ya sale a tu mesa', cls: 'bg-emerald-100 text-emerald-800' },
  delivered: { text: 'Entregado · ¡buen provecho!', cls: 'bg-slate-200 text-slate-700' },
  cancelled: { text: 'Cancelado', cls: 'bg-red-100 text-red-700' },
}

export default function QrMenu() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<TableInfo | null>(null)
  const [fatal, setFatal] = useState('')
  const [cats, setCats] = useState<Category[]>([])
  const [prods, setProds] = useState<MenuProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState('all')
  const [view, setView] = useState<'menu' | 'orders'>('menu')
  const [sheet, setSheet] = useState(false)
  const [orders, setOrders] = useState<PublicOrder[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [justSent, setJustSent] = useState<number | null>(null)

  const storeKey = `cart:${token}`
  const [cart, setCartState] = useState<Record<string, { q: number; n: string }>>({})
  const [note, setNoteState] = useState('')
  const rid = useRef(uuid())

  // Carrito persistente (si recarga la página no pierde lo elegido)
  useEffect(() => {
    try {
      const s: StoredCart | null = JSON.parse(localStorage.getItem(storeKey) ?? 'null')
      if (s) { setCartState(Object.fromEntries(s.lines.map((l) => [l.id, { q: l.q, n: l.n }]))); setNoteState(s.note); rid.current = s.rid }
    } catch { /* ignorar */ }
  }, [storeKey])
  const persist = useCallback((c: typeof cart, n: string) => {
    try { localStorage.setItem(storeKey, JSON.stringify({ lines: Object.entries(c).map(([id, v]) => ({ id, q: v.q, n: v.n })), note: n, rid: rid.current } satisfies StoredCart)) } catch { /* modo privado */ }
  }, [storeKey])
  // Cualquier cambio de contenido genera una clave nueva; reintentar SIN cambios reutiliza la misma (anti-duplicados)
  const setCart = (fn: (c: typeof cart) => typeof cart) => setCartState((c) => { const n = fn(c); rid.current = uuid(); persist(n, note); return n })
  const setNote = (v: string) => { rid.current = uuid(); setNoteState(v); persist(cart, v) }

  const loadMenu = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('menu_products').select('*').order('sort_order').order('name'),
    ])
    if (!c.error) setCats(c.data as Category[])
    if (!p.error) setProds((p.data as MenuProduct[]).map((x) => ({ ...x, price: Number(x.price), final_price: Number(x.final_price) })))
  }, [])

  const loadOrders = useCallback(async () => {
    try { setOrders(await api.tableOrders(token)) } catch { /* se reintenta con el siguiente ciclo */ }
  }, [token])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const t = await api.tableByToken(token)
        if (!alive) return
        setInfo(t)
        document.title = `${t.restaurant} · Mesa ${t.number}`
        await Promise.all([loadMenu(), loadOrders()])
      } catch (e) {
        if (alive) setFatal(errorCode(e) === 'INVALID_TABLE' ? 'Este código QR no es válido o la mesa está desactivada. Pide ayuda al personal.' : errorMessage(e))
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [token, loadMenu, loadOrders])

  // Estado de los pedidos: sondeo ligero cada 15 s solo con la pestaña visible (no consume conexiones Realtime)
  useEffect(() => {
    if (view !== 'orders') return
    void loadOrders()
    const t = setInterval(() => { if (!document.hidden) void loadOrders() }, 15000)
    return () => clearInterval(t)
  }, [view, loadOrders])

  const money_ = (n: number) => money(n, info?.currency ?? 'S/')
  const byId = useMemo(() => new Map(prods.map((p) => [p.id, p])), [prods])
  const lines = useMemo(() => Object.entries(cart).flatMap(([id, v]) => { const p = byId.get(id); return p ? [{ p, q: v.q, n: v.n }] : [] }), [cart, byId])
  const count = lines.reduce((s, l) => s + l.q, 0)
  const total = lines.reduce((s, l) => s + l.q * l.p.final_price, 0)
  const bad = lines.filter((l) => !l.p.is_available)
  const canOrder = info?.qr_enabled ?? false
  const shown = prods.filter((p) => cat === 'all' || p.category_id === cat)

  const setQty = (id: string, d: number) => setCart((c) => {
    const cur = c[id]?.q ?? 0
    const nq = Math.max(0, Math.min(99, cur + d))
    const n = { ...c }
    if (nq === 0) delete n[id]; else n[id] = { q: nq, n: c[id]?.n ?? '' }
    return n
  })
  const setLineNote = (id: string, v: string) => setCart((c) => (c[id] ? { ...c, [id]: { ...c[id], n: v.slice(0, 200) } } : c))

  async function send() {
    if (!lines.length || bad.length) return
    setSending(true); setError('')
    try {
      const r = await api.createQrOrder(token, lines.map((l) => ({ product_id: l.p.id, quantity: l.q, notes: l.n.trim() || undefined })), rid.current, note.trim() || undefined)
      setCartState({}); setNoteState(''); rid.current = uuid()
      try { localStorage.removeItem(storeKey) } catch { /* nada */ }
      setSheet(false); setJustSent(r.order_number); setView('orders'); void loadOrders()
    } catch (e) {
      if (errorCode(e) === 'PRODUCT_UNAVAILABLE') void loadMenu()
      setError(errorMessage(e)) // el carrito se conserva; reintentar es seguro
    } finally { setSending(false) }
  }

  if (loading) return <Loading />
  if (fatal || !info) return <div className="flex min-h-screen items-center justify-center p-6 text-center text-slate-600">{fatal || 'No se pudo cargar la carta.'}</div>

  const myTotal = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0)

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-white pb-28 shadow-sm">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold">{info.restaurant}</h1>
          <span className="rounded-full bg-brand-600 px-3 py-1 text-sm font-semibold text-white">Mesa {info.number}</span>
        </div>
        <div className="flex border-t border-slate-100">
          {([['menu', 'Carta', ChefHat], ['orders', `Mis pedidos${orders.length ? ` (${orders.length})` : ''}`, ClipboardList]] as const).map(([k, l, Icon]) => (
            <button key={k} onClick={() => setView(k)} className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium ${view === k ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`}><Icon size={16} />{l}</button>
          ))}
        </div>
        {view === 'menu' && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2">
            <button className={`chip ${cat === 'all' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`} onClick={() => setCat('all')}>Todo</button>
            {cats.map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
          </div>
        )}
      </header>

      {view === 'menu' ? (
        <main>
          {!canOrder && <p className="m-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Los pedidos desde el celular están desactivados por ahora. Puedes ver la carta y pedirle al mozo.</p>}
          {shown.length === 0 && <p className="p-10 text-center text-sm text-slate-400">No hay productos en esta categoría.</p>}
          <ul className="divide-y divide-slate-100">
            {shown.map((p) => {
              const img = imageUrl(p.image_path)
              const qty = cart[p.id]?.q ?? 0
              return (
                <li key={p.id} className={`flex gap-3 p-4 ${p.is_available ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-tight">{p.name}</h3>
                    {p.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{p.description}</p>}
                    {p.ingredients && <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{p.ingredients}</p>}
                    <div className="mt-1.5">
                      <span className="font-bold text-brand-700">{money_(p.final_price)}</span>
                      {p.final_price < p.price && <span className="ml-2 text-xs text-slate-400 line-through">{money_(p.price)}</span>}
                    </div>
                  </div>
                  <div className="flex w-24 shrink-0 flex-col items-center gap-2">
                    {img && <img src={img} alt="" loading="lazy" decoding="async" className="h-20 w-24 rounded-xl object-cover" />}
                    {!p.is_available ? <span className="badge bg-red-100 text-red-700">AGOTADO</span>
                      : !canOrder ? null
                      : qty === 0 ? <button className="btn btn-primary btn-sm w-full" onClick={() => setQty(p.id, 1)}><Plus size={14} /> Agregar</button>
                      : <div className="flex w-full items-center justify-between rounded-lg border border-brand-600 text-brand-700">
                          <button className="p-1.5" onClick={() => setQty(p.id, -1)} aria-label="Quitar uno"><Minus size={16} /></button>
                          <span className="font-bold">{qty}</span>
                          <button className="p-1.5" onClick={() => setQty(p.id, 1)} aria-label="Agregar uno"><Plus size={16} /></button>
                        </div>}
                  </div>
                </li>
              )
            })}
          </ul>
        </main>
      ) : (
        <main className="space-y-3 p-4">
          {justSent && (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              <CheckCircle2 className="mt-0.5 shrink-0" />
              <div><div className="font-bold">¡Pedido #{justSent} enviado a cocina!</div><div className="text-sm">Aquí puedes ver cómo avanza. Para pagar, pide la cuenta al personal.</div></div>
            </div>
          )}
          {orders.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">Todavía no has hecho pedidos en esta mesa.</p> : orders.map((o) => (
            <div key={o.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold">Pedido #{o.order_number}</span>
                <span className={`badge ${CUSTOMER_STATUS[o.status].cls}`}>{CUSTOMER_STATUS[o.status].text}</span>
              </div>
              <ul className="mt-2 text-sm text-slate-600">{o.items.map((it, i) => <li key={i}>{it.quantity}× {it.name}{it.notes && <span className="text-amber-700"> ({it.notes})</span>}</li>)}</ul>
              <div className="mt-2 text-right text-sm font-semibold">{money_(o.total)}</div>
            </div>
          ))}
          {orders.length > 0 && <div className="flex justify-between rounded-xl bg-slate-100 p-4 font-bold"><span>Total de la mesa</span><span>{money_(myTotal)}</span></div>}
          <button className="btn btn-secondary w-full" onClick={() => { setJustSent(null); setView('menu') }}>Seguir pidiendo</button>
        </main>
      )}

      {view === 'menu' && count > 0 && canOrder && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-xl bg-gradient-to-t from-white via-white to-transparent p-4 pt-8">
          <button className="btn btn-primary btn-lg w-full justify-between shadow-lg" onClick={() => { setError(''); setSheet(true) }}>
            <span className="flex items-center gap-2"><ShoppingBag size={20} /> Ver mi pedido ({count})</span><span>{money_(total)}</span>
          </button>
        </div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-900/50" onMouseDown={() => !sending && setSheet(false)}>
          <div className="mx-auto flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-3xl bg-white" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold">Tu pedido · Mesa {info.number}</h2>
              <button onClick={() => setSheet(false)} disabled={sending} aria-label="Cerrar"><X /></button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {lines.map((l) => (
                <div key={l.p.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1"><div className={`font-medium ${l.p.is_available ? '' : 'text-red-600'}`}>{l.p.name}{!l.p.is_available && ' — agotado, quítalo'}</div><div className="text-xs text-slate-500">{money_(l.p.final_price)} c/u</div></div>
                    <div className="flex items-center gap-2 rounded-lg border border-slate-300">
                      <button className="p-1.5" onClick={() => setQty(l.p.id, -1)}><Minus size={16} /></button>
                      <span className="w-5 text-center font-bold">{l.q}</span>
                      <button className="p-1.5" onClick={() => setQty(l.p.id, 1)}><Plus size={16} /></button>
                    </div>
                    <div className="w-20 text-right font-semibold">{money_(l.q * l.p.final_price)}</div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5"><StickyNote size={14} className="text-slate-400" />
                    <input className="input !py-1.5 text-sm" placeholder="¿Alguna indicación? (sin cebolla, poco picante…)" value={l.n} maxLength={200} onChange={(e) => setLineNote(l.p.id, e.target.value)} /></div>
                </div>
              ))}
              <textarea className="input" rows={2} maxLength={300} placeholder="Comentario general para cocina (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            </div>
            <div className="space-y-3 border-t border-slate-200 p-5">
              <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{money_(total)}</span></div>
              <button className="btn btn-primary btn-lg w-full" disabled={sending || bad.length > 0 || !lines.length} onClick={send}>{sending ? <><Spinner /> Enviando…</> : 'Confirmar pedido'}</button>
              <p className="text-center text-xs text-slate-400">Tu pedido llegará directo a la cocina. El pago se realiza con el personal.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
