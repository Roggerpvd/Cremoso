import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Maximize, StickyNote, Undo2, Volume2, VolumeX } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ChannelBadge, ConnectionPill, Loading, ErrorBox } from '../components/ui'
import { nextAction, undoAction } from '../components/orderActions'
import { useAuth } from '../auth/AuthProvider'
import { useOrders } from '../hooks/useOrders'
import { useNow } from '../hooks/useNow'
import { useToast } from '../components/Toast'
import { beep, elapsedLabel, minutesSince, tableLabel, timeHM, unlockAudio } from '../lib/util'
import { errorMessage } from '../lib/errors'
import type { Order, OrderStatus } from '../lib/types'

const COLUMNS: { status: OrderStatus; title: string; head: string }[] = [
  { status: 'pending', title: 'Pendientes', head: 'bg-amber-500' },
  { status: 'preparing', title: 'En preparación', head: 'bg-sky-500' },
  { status: 'ready', title: 'Listos', head: 'bg-emerald-500' },
  { status: 'delivered', title: 'Entregados', head: 'bg-slate-500' },
]

export default function Kitchen() {
  const { can } = useAuth()
  const toast = useToast()
  const [sound, setSound] = useState(() => localStorage.getItem('kds-sound') === '1')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const now = useNow(20000)

  const soundRef = useMemo(() => ({ on: sound }), [sound])
  const onNew = useCallback((o: Order) => {
    if (soundRef.on) beep(3)
    toast(`Nuevo pedido #${o.order_number} · ${tableLabel(o.tables)}`, 'info')
  }, [soundRef, toast])
  const onCancelled = useCallback((o: Order) => {
    if (soundRef.on) beep(1)
    toast(`Pedido #${o.order_number} (${tableLabel(o.tables)}) fue CANCELADO`, 'error')
  }, [soundRef, toast])
  const { orders, conn, loading, error, reload, changeStatus } = useOrders({ onNew, onCancelled })

  useEffect(() => { localStorage.setItem('kds-sound', sound ? '1' : '0') }, [sound])

  const cols = useMemo(() => {
    const recent = now - 60 * 60000
    const by = (s: OrderStatus) => orders.filter((o) => o.status === s && (s !== 'delivered' || (o.delivered_at && new Date(o.delivered_at).getTime() > recent)))
    return Object.fromEntries(COLUMNS.map((c) => [c.status, by(c.status)])) as Record<OrderStatus, Order[]>
  }, [orders, now])

  async function move(o: Order, to: OrderStatus) {
    setBusy((b) => new Set(b).add(o.id))
    try { await changeStatus(o.id, to) }
    catch (e) { toast(errorMessage(e), 'error') }
    finally { setBusy((b) => { const n = new Set(b); n.delete(o.id); return n }) }
  }

  const right = (
    <div className="flex items-center gap-2">
      <ConnectionPill conn={conn} dark />
      <button className={`btn btn-sm ${sound ? 'bg-emerald-600 text-white' : 'bg-white/10 text-slate-200'}`}
        onClick={() => { unlockAudio(); setSound(!sound); if (!sound) beep(1) }}
        title="Sonido al llegar un pedido (el navegador exige activarlo con un clic)">
        {sound ? <Volume2 size={15} /> : <VolumeX size={15} />} <span className="hidden sm:inline">{sound ? 'Sonido activo' : 'Activar sonido'}</span>
      </button>
      <button className="btn btn-sm bg-white/10 text-slate-200" onClick={() => document.documentElement.requestFullscreen?.()} title="Pantalla completa">
        <Maximize size={15} />
      </button>
    </div>
  )

  return (
    <AppShell dark right={right}>
      {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={reload} /> : (
        <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((c) => (
            <section key={c.status} className="flex min-h-[40vh] flex-col rounded-xl bg-slate-800/60">
              <h2 className={`flex items-center justify-between rounded-t-xl px-4 py-2.5 text-lg font-bold text-white ${c.head}`}>
                {c.title}
                <span className="rounded-full bg-black/25 px-2.5 text-base">{cols[c.status].length}</span>
              </h2>
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {cols[c.status].length === 0 && <p className="py-8 text-center text-slate-500">Sin pedidos</p>}
                {cols[c.status].map((o) => {
                  const next = nextAction(o, can)
                  const undo = undoAction(o, can)
                  const mins = minutesSince(o.created_at, now)
                  const late = (o.status === 'pending' || o.status === 'preparing') && mins >= 15
                  return (
                    <article key={o.id} className={`rounded-xl bg-white p-4 text-slate-900 shadow ${late ? 'ring-4 ring-red-500' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-3xl font-extrabold leading-none">#{o.order_number}</div>
                          <div className="mt-1 text-lg font-semibold text-brand-700">{tableLabel(o.tables)}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xl font-bold ${late ? 'text-red-600' : ''}`}>{elapsedLabel(o.created_at, now)}</div>
                          <div className="text-xs text-slate-500">ingresó {timeHM(o.created_at)}</div>
                          <div className="mt-1"><ChannelBadge channel={o.channel} /></div>
                        </div>
                      </div>
                      <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-200">
                        {o.order_items.slice().sort((a, b) => a.line_no - b.line_no).map((it) => (
                          <li key={it.id} className="py-2">
                            <div className="flex gap-3 text-xl font-semibold">
                              <span className="min-w-8 rounded bg-slate-900 px-2 text-center text-white">{it.quantity}</span>
                              <span>{it.product_name}</span>
                            </div>
                            {it.notes && <div className="mt-1 flex items-start gap-1 rounded bg-amber-100 px-2 py-1 text-base font-medium text-amber-900"><StickyNote size={16} className="mt-0.5 shrink-0" />{it.notes}</div>}
                          </li>
                        ))}
                      </ul>
                      {o.customer_note && <div className="mt-2 flex items-start gap-1 rounded bg-amber-100 px-2 py-1 text-base font-medium text-amber-900"><Bell size={16} className="mt-0.5 shrink-0" />{o.customer_note}</div>}
                      {(next || undo) && (
                        <div className="mt-3 flex gap-2">
                          {next && (
                            <button disabled={busy.has(o.id)} onClick={() => move(o, next.to)}
                              className={`btn btn-lg flex-1 text-white ${o.status === 'pending' ? 'bg-sky-600 hover:bg-sky-700' : o.status === 'preparing' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-700 hover:bg-slate-800'}`}>
                              {next.label}
                            </button>
                          )}
                          {undo && <button disabled={busy.has(o.id)} onClick={() => move(o, undo.to)} className="btn btn-secondary" title={undo.label}><Undo2 size={18} /></button>}
                        </div>
                      )}
                      {!next && o.status === 'ready' && <p className="mt-3 text-center text-sm font-medium text-emerald-700">Esperando que el mozo lo entregue</p>}
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  )
}
