import { useMemo, useState } from 'react'
import { Search, StickyNote } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { ChannelBadge, ConnectionPill, Empty, ErrorBox, Loading, StatusBadge } from '../components/ui'
import { nextAction } from '../components/orderActions'
import { useAuth } from '../auth/AuthProvider'
import { useOrders } from '../hooks/useOrders'
import { useNow } from '../hooks/useNow'
import { useToast } from '../components/Toast'
import { useSettings } from '../lib/settings'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { elapsedLabel, orderPlace, timeHM } from '../lib/util'
import { type Order, type OrderChannel, type OrderStatus } from '../lib/types'

const STATES: OrderStatus[] = ['pending', 'preparing', 'ready', 'delivered']

export default function Tracking() {
  const { can } = useAuth()
  const { fmt } = useSettings()
  const toast = useToast()
  const { orders, conn, loading, error, reload, changeStatus } = useOrders()
  const now = useNow(30000)
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [channel, setChannel] = useState<OrderChannel | 'all'>('all')
  const [search, setSearch] = useState('')
  const [hidePaid, setHidePaid] = useState(true)

  const counts = useMemo(() => Object.fromEntries(STATES.map((s) => [s, orders.filter((o) => o.status === s).length])) as Record<OrderStatus, number>, [orders])
  const rows = useMemo(() => orders.filter((o) =>
    (status === 'all' || o.status === status) &&
    (channel === 'all' || o.channel === channel) &&
    (!hidePaid || !(o.status === 'delivered' && o.payment_status === 'paid')) &&
    (!search || String(o.tables?.number) === search.trim() || String(o.order_number) === search.trim().replace('#', ''))
  ).sort((a, b) => b.created_at.localeCompare(a.created_at)), [orders, status, channel, hidePaid, search])

  async function advance(o: Order, to: OrderStatus) {
    try { await changeStatus(o.id, to) } catch (e) { toast(errorMessage(e), 'error') }
  }
  async function cancel(o: Order) {
    const reason = window.prompt(`¿Cancelar el pedido #${o.order_number}? Escribe el motivo (opcional):`)
    if (reason === null) return
    try { await api.cancelOrder(o.id, reason); toast(`Pedido #${o.order_number} cancelado`, 'info') }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  const sColor: Record<string, string> = { pending: 'text-amber-700', preparing: 'text-sky-700', ready: 'text-emerald-700', delivered: 'text-slate-600' }
  const sPlural: Record<string, string> = { pending: 'Pendientes', preparing: 'En preparación', ready: 'Listos', delivered: 'Entregados' }

  return (
    <AppShell right={<ConnectionPill conn={conn} />}>
      <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATES.map((s) => (
            <button key={s} onClick={() => setStatus(status === s ? 'all' : s)}
              className={`card p-4 text-left transition ${status === s ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}>
              <div className={`text-3xl font-extrabold ${sColor[s]}`}>{counts[s]}</div>
              <div className="text-sm text-slate-600">{sPlural[s]}</div>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-500" />
            <input className="input w-44 pl-9" placeholder="Mesa o #pedido" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {(['all', 'internal', 'qr'] as const).map((c) => (
            <button key={c} onClick={() => setChannel(c)} className={`chip ${channel === c ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 bg-white'}`}>
              {c === 'all' ? 'Todos los canales' : c === 'qr' ? 'QR' : 'Internos'}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={hidePaid} onChange={(e) => setHidePaid(e.target.checked)} /> Ocultar entregados y pagados
          </label>
        </div>

        {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={reload} /> : rows.length === 0 ? <Empty text="No hay pedidos con estos filtros" /> : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
                <tr><th className="p-3">Pedido</th><th className="p-3">Mesa</th><th className="p-3">Hora</th><th className="p-3">Productos</th><th className="p-3">Canal</th><th className="p-3">Estado</th><th className="p-3 text-right">Total</th><th className="p-3" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((o) => {
                  const next = nextAction(o, can)
                  return (
                    <tr key={o.id} className="align-top hover:bg-slate-50">
                      <td className="p-3 text-base font-bold">#{o.order_number}</td>
                      <td className="p-3 font-medium">{orderPlace(o)}</td>
                      <td className="p-3 whitespace-nowrap">{timeHM(o.created_at)}<div className="text-xs text-slate-500">{elapsedLabel(o.created_at, now)}</div></td>
                      <td className="p-3">
                        {o.order_items.slice().sort((a, b) => a.line_no - b.line_no).map((it) => (
                          <div key={it.id}><b>{it.quantity}×</b> {it.product_name}{it.notes && <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-700"><StickyNote size={11} />{it.notes}</span>}</div>
                        ))}
                        {o.customer_note && <div className="text-xs italic text-slate-600">“{o.customer_note}”</div>}
                      </td>
                      <td className="p-3"><ChannelBadge channel={o.channel} /></td>
                      <td className="p-3"><StatusBadge status={o.status} /><div className={`mt-1 text-xs ${o.payment_status === 'paid' ? 'text-emerald-700' : 'text-slate-500'}`}>{o.payment_status === 'paid' ? 'Pagado' : 'Sin pagar'}</div></td>
                      <td className="p-3 text-right font-semibold">{fmt(o.total)}</td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1.5">
                          {next && <button className="btn btn-primary btn-sm" onClick={() => advance(o, next.to)}>{next.label}</button>}
                          {can('orders.cancel') && o.status !== 'delivered' && o.payment_status === 'unpaid' && <button className="btn btn-secondary btn-sm text-red-700" onClick={() => cancel(o)}>Cancelar</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
