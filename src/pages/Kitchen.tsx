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

// Las columnas ya no llevan color: solo un punto que se enciende con el color de la fase cuando hay pedidos en ella.
const COLUMNS: { status: OrderStatus; title: string; dot: string; glow: string }[] = [
  { status: 'pending', title: 'Pendientes', dot: 'bg-amber-500', glow: 'shadow-[0_0_0_4px_rgba(245,158,11,.20)]' },
  { status: 'preparing', title: 'En preparación', dot: 'bg-sky-500', glow: 'shadow-[0_0_0_4px_rgba(14,165,233,.20)]' },
  { status: 'ready', title: 'Listos', dot: 'bg-emerald-500', glow: 'shadow-[0_0_0_4px_rgba(16,185,129,.22)]' },
  { status: 'delivered', title: 'Entregados', dot: 'bg-slate-500', glow: 'shadow-[0_0_0_4px_rgba(100,116,139,.20)]' },
]
const DOT_BY_STATUS = Object.fromEntries(COLUMNS.map((c) => [c.status, c.dot])) as Record<string, string>

/** Punto de fase: apagado (gris) o encendido con el color de la fase; el cambio es una transición suave. */
function PhaseDot({ on, dot, glow, pulse = false, size = 'h-3 w-3' }: { on: boolean; dot: string; glow: string; pulse?: boolean; size?: string }) {
  return (
    <span className="relative inline-flex shrink-0" aria-hidden>
      {on && pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${dot}`} />}
      <span className={`relative inline-flex rounded-full transition-[background-color,box-shadow] duration-300 ${size} ${on ? `${dot} ${glow}` : 'bg-slate-300'}`} />
    </span>
  )
}

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
      <ConnectionPill conn={conn} />
      <button className={`btn btn-sm ${sound ? 'btn-primary' : 'btn-secondary'}`}
        onClick={() => { unlockAudio(); setSound(!sound); if (!sound) beep(1) }}
        title="Sonido al llegar un pedido (el navegador exige activarlo con un clic)">
        {sound ? <Volume2 size={15} /> : <VolumeX size={15} />} <span className="hidden 2xl:inline">{sound ? 'Sonido activo' : 'Activar sonido'}</span>
      </button>
      <button className="btn btn-sm btn-secondary" onClick={() => document.documentElement.requestFullscreen?.()} title="Pantalla completa">
        <Maximize size={15} />
      </button>
    </div>
  )

  return (
    <AppShell plain right={right}>
      {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={reload} /> : (
        <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((c) => (
            <section key={c.status} className="flex min-h-[40vh] flex-col rounded-2xl border border-slate-200 bg-white">
              <h2 className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-lg font-bold text-slate-900">
                <span className="flex items-center gap-2.5">
                  <PhaseDot on={cols[c.status].length > 0} dot={c.dot} glow={c.glow} pulse={c.status === 'pending'} />
                  {c.title}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 text-base font-semibold text-slate-600">{cols[c.status].length}</span>
              </h2>
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {cols[c.status].length === 0 && <p className="py-8 text-center text-slate-500">Sin pedidos</p>}
                {cols[c.status].map((o) => {
                  const next = nextAction(o, can)
                  const undo = undoAction(o, can)
                  const mins = minutesSince(o.created_at, now)
                  const late = (o.status === 'pending' || o.status === 'preparing') && mins >= 15
                  return (
                    <article key={o.id} className={`enter rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm ${late ? 'ring-2 ring-red-400' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 text-3xl font-extrabold leading-none"><PhaseDot on dot={DOT_BY_STATUS[o.status]} glow={COLUMNS.find((x) => x.status === o.status)?.glow ?? ''} size="h-2.5 w-2.5" />#{o.order_number}</div>
                          <div className="mt-1 text-lg font-semibold text-brand-700">{tableLabel(o.tables)}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xl font-bold ${late ? 'text-red-700' : ''}`}>{elapsedLabel(o.created_at, now)}</div>
                          <div className="text-xs text-slate-600">ingresó {timeHM(o.created_at)}</div>
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
                              className="btn btn-primary btn-lg flex-1 whitespace-nowrap !px-3">
                              {next.label}
                            </button>
                          )}
                          {undo && <button disabled={busy.has(o.id)} onClick={() => move(o, undo.to)} className="btn btn-secondary btn-lg !px-4" title={undo.label}><Undo2 size={18} /></button>}
                        </div>
                      )}
                      {!next && o.status === 'ready' && <p className="mt-3 text-center text-sm font-medium text-emerald-800">Listo para entregar</p>}
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
