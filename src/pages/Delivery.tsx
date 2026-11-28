import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike, MapPin, MessageCircle, Phone, Undo2, Wallet } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ConnectionPill, ErrorBox, Loading } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../auth/AuthProvider'
import { useOrders } from '../hooks/useOrders'
import { useNow } from '../hooks/useNow'
import { useSettings } from '../lib/settings'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { elapsedLabel, minutesSince, phonePretty, timeHM } from '../lib/util'
import type { Order } from '../lib/types'

/* Gestión de deliveries: en cocina → listo para salir → en camino → entregado.
   · Cocina prepara igual que siempre; aquí se asigna el repartidor y se marca la salida y la entrega.
   · Cobrar se hace en Caja → Cuentas (el delivery aparece como una cuenta individual). */

const LAST_DRIVER = 'delivery-driver'

type ColKey = 'kitchen' | 'ready' | 'road' | 'done'
const COLS: { key: ColKey; title: string; dot: string; glow: string; empty: string }[] = [
  { key: 'kitchen', title: 'En cocina', dot: 'bg-amber-500', glow: 'shadow-[0_0_0_4px_rgba(245,158,11,.20)]', empty: 'Sin pedidos en cocina' },
  { key: 'ready', title: 'Listos para salir', dot: 'bg-emerald-500', glow: 'shadow-[0_0_0_4px_rgba(16,185,129,.22)]', empty: 'Nada listo todavía' },
  { key: 'road', title: 'En camino', dot: 'bg-sky-500', glow: 'shadow-[0_0_0_4px_rgba(14,165,233,.20)]', empty: 'Ningún repartidor en la calle' },
  { key: 'done', title: 'Entregados', dot: 'bg-slate-500', glow: 'shadow-[0_0_0_4px_rgba(100,116,139,.20)]', empty: 'Aún no hay entregas' },
]

const colOf = (o: Order): ColKey =>
  o.status === 'delivered' ? 'done' : o.status === 'ready' ? (o.dispatched_at ? 'road' : 'ready') : 'kitchen'

export default function Delivery() {
  const { can } = useAuth()
  const { fmt, settings } = useSettings()
  const toast = useToast()
  const { orders, conn, loading, error, reload, changeStatus } = useOrders()
  const now = useNow(20000)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [drivers, setDrivers] = useState<Record<string, string>>({})

  const mine = useMemo(() => orders.filter((o) => o.order_kind === 'delivery'), [orders])
  const cols = useMemo(() => {
    const c: Record<ColKey, Order[]> = { kitchen: [], ready: [], road: [], done: [] }
    for (const o of mine) c[colOf(o)].push(o)
    c.done.reverse()
    return c
  }, [mine])
  const canDeliver = can('orders.delivery')

  async function run(o: Order, fn: () => Promise<unknown>, okMsg: string) {
    setBusy((b) => new Set(b).add(o.id))
    try { await fn(); toast(okMsg); reload() }
    catch (e) { toast(errorMessage(e), 'error') }
    finally { setBusy((b) => { const n = new Set(b); n.delete(o.id); return n }) }
  }
  const dispatch = (o: Order) => {
    const driver = (drivers[o.id] ?? localStorage.getItem(LAST_DRIVER) ?? '').trim()
    if (driver) { try { localStorage.setItem(LAST_DRIVER, driver) } catch { /* nada */ } }
    return run(o, () => api.dispatchDelivery(o.id, driver), `Delivery #${o.order_number} salió${driver ? ` con ${driver}` : ''}`)
  }

  const right = <ConnectionPill conn={conn} />

  return (
    <AppShell plain right={right}>
      <div className="p-3 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl"><Bike size={26} className="text-brand-600" /> Delivery</h1>
            <p className="text-sm text-slate-600">Sigue cada pedido a domicilio desde la cocina hasta la puerta del cliente.{!settings.delivery_enabled && <b className="text-red-700"> El delivery está desactivado en Ajustes.</b>}</p>
          </div>
        </div>

        {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={reload} /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLS.map((c) => (
              <section key={c.key} className="flex min-h-[30vh] flex-col rounded-2xl border border-slate-200 bg-white" aria-label={c.title}>
                <h2 className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-lg font-bold text-slate-900">
                  <span className="flex items-center gap-2.5">
                    <span className={`inline-flex h-3 w-3 shrink-0 rounded-full transition-[background-color,box-shadow] duration-300 ${cols[c.key].length ? `${c.dot} ${c.glow}` : 'bg-slate-300'}`} aria-hidden />
                    {c.title}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 text-base font-semibold text-slate-600">{cols[c.key].length}</span>
                </h2>
                <div className="stagger flex-1 space-y-3 overflow-y-auto p-3">
                  {cols[c.key].length === 0 && <p className="py-8 text-center text-slate-500">{c.empty}</p>}
                  {cols[c.key].map((o) => {
                    const paid = o.payment_status === 'paid'
                    const late = c.key !== 'done' && minutesSince(o.created_at, now) >= 45
                    const change = o.delivery_change_for ? Math.max(0, Number(o.delivery_change_for) - Number(o.total)) : 0
                    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.delivery_address ?? '')}`
                    const wa = `https://wa.me/51${o.delivery_phone ?? ''}`
                    return (
                      <article key={o.id} className={`enter rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm ${late ? 'ring-2 ring-red-400' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xl font-extrabold leading-tight">#{o.order_number} · {o.delivery_name}</div>
                            <div className="text-xs text-slate-600">{timeHM(o.created_at)} · hace {elapsedLabel(o.created_at, now)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold">{fmt(Number(o.total))}</div>
                            {paid ? <span className="badge bg-emerald-100 text-emerald-800">Pagado</span> : <span className="badge bg-amber-100 text-amber-900">Por cobrar</span>}
                          </div>
                        </div>

                        <div className="mt-2 space-y-1 text-sm">
                          <a className="flex items-start gap-2 font-medium text-brand-700 underline-offset-2 hover:underline" href={maps} target="_blank" rel="noreferrer">
                            <MapPin size={16} className="mt-0.5 shrink-0" /><span>{o.delivery_address}{o.delivery_reference ? <span className="block font-normal text-slate-700">Ref.: {o.delivery_reference}</span> : null}</span>
                          </a>
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <a className="btn btn-secondary btn-sm !px-2" href={`tel:${o.delivery_phone}`}><Phone size={14} /> {phonePretty(o.delivery_phone)}</a>
                            <a className="btn btn-secondary btn-sm !px-2" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>
                          </div>
                        </div>

                        <ul className="mt-2.5 border-t border-slate-100 pt-2 text-sm text-slate-800">
                          {o.order_items.slice().sort((a, b) => a.line_no - b.line_no).map((it) => (
                            <li key={it.id}>{it.quantity}× {it.product_name}{it.notes && <span className="text-amber-800"> ({it.notes})</span>}</li>
                          ))}
                          {Number(o.delivery_fee) > 0 && <li className="text-slate-600">Envío {fmt(Number(o.delivery_fee))}</li>}
                        </ul>
                        {o.customer_note && <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">{o.customer_note}</p>}
                        {!paid && o.delivery_change_for ? <p className="mt-1.5 text-sm font-medium text-slate-800">Paga con {fmt(Number(o.delivery_change_for))} · lleva vuelto {fmt(change)}</p> : null}
                        {o.driver_name && <p className="mt-1.5 text-sm text-slate-700">Repartidor: <b>{o.driver_name}</b>{o.dispatched_at ? ` · salió ${timeHM(o.dispatched_at)}` : ''}</p>}

                        <div className="mt-3 space-y-2">
                          {c.key === 'ready' && canDeliver && (
                            <>
                              <label className="label" htmlFor={`dr-${o.id}`}>Repartidor</label>
                              <input id={`dr-${o.id}`} className="input" maxLength={60} placeholder="Nombre del repartidor"
                                value={drivers[o.id] ?? localStorage.getItem(LAST_DRIVER) ?? ''} onChange={(e) => setDrivers({ ...drivers, [o.id]: e.target.value })} />
                              <button className="btn btn-primary w-full" disabled={busy.has(o.id)} onClick={() => dispatch(o)}><Bike size={16} /> Salió a entregar</button>
                            </>
                          )}
                          {c.key === 'ready' && !canDeliver && <p className="text-center text-sm font-medium text-emerald-800">Listo para despacho</p>}
                          {c.key === 'road' && canDeliver && (
                            <div className="flex gap-2">
                              <button className="btn btn-primary min-w-0 flex-1 whitespace-nowrap !px-3" disabled={busy.has(o.id)} onClick={() => run(o, () => changeStatus(o.id, 'delivered'), `Delivery #${o.order_number} entregado`)}>Marcar como entregado</button>
                              <button className="btn btn-secondary shrink-0 !px-4" title="Deshacer la salida" aria-label="Deshacer la salida" disabled={busy.has(o.id)} onClick={() => run(o, () => api.undoDispatchDelivery(o.id), `Delivery #${o.order_number} volvió a «listo»`)}><Undo2 size={16} /></button>
                            </div>
                          )}
                          {c.key !== 'kitchen' && !paid && can('payments.register') && (
                            <Link className="btn btn-secondary w-full" to="/caja?tab=cuentas"><Wallet size={16} /> Cobrar en Caja</Link>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
