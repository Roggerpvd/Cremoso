import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Printer, Receipt as ReceiptIcon } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { BoletaModal } from '../components/BoletaModal'
import { printNode } from '../components/Print'
import { Ticket } from '../components/Ticket'
import { Empty, ErrorBox, Loading } from '../components/ui'
import { q } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { tableLabel, timeHM, todayISO } from '../lib/util'
import { METHOD_LABEL, type Order, type PaidGroup, type PaymentMethod, type Receipt } from '../lib/types'

interface PayRow { id: string; group_id: string; method: PaymentMethod; amount: number; reference: string | null; paid_at: string; orders: Order | null }

export default function Receipts() {
  const { settings, fmt } = useSettings()
  const [date, setDate] = useState(todayISO())
  const [groups, setGroups] = useState<PaidGroup[]>([])
  const [receipts, setReceipts] = useState<Map<string, Receipt>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const start = new Date(`${date}T00:00:00`)
      const end = new Date(start); end.setDate(end.getDate() + 1)
      const rows = await q<PayRow[]>(supabase.from('payments')
        .select('id, group_id, method, amount, reference, paid_at, orders(id, order_number, table_id, channel, status, payment_status, customer_note, subtotal, discount_total, tax_amount, total, created_at, preparing_at, ready_at, delivered_at, paid_at, tables(number, name), order_items(*))')
        .gte('paid_at', start.toISOString()).lt('paid_at', end.toISOString()).order('paid_at', { ascending: false }).limit(500))
      const m = new Map<string, PaidGroup>()
      for (const r of rows) {
        if (!r.orders) continue
        const g = m.get(r.group_id) ?? { group_id: r.group_id, paid_at: r.paid_at, method: r.method, reference: r.reference, total: 0, orders: [] }
        g.total = Math.round((g.total + Number(r.amount)) * 100) / 100
        g.orders.push(r.orders as unknown as Order)
        m.set(r.group_id, g)
      }
      const list = [...m.values()].sort((a, b) => b.paid_at.localeCompare(a.paid_at))
      setGroups(list)
      if (list.length) {
        const rc = await q<Receipt[]>(supabase.from('receipts').select('*').in('group_id', list.map((g) => g.group_id)).neq('status', 'void'))
        setReceipts(new Map(rc.map((r) => [r.group_id, r])))
      } else setReceipts(new Map())
      setError('')
    } catch (e) { setError(errorMessage(e)) }
    setLoading(false)
  }, [date])
  useEffect(() => { void load() }, [load])

  const current = useMemo(() => groups.find((g) => g.group_id === open) ?? null, [groups, open])

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-5">
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div><label className="label">Fecha de cobro</label><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} /></div>
          <p className="max-w-md text-xs text-slate-500">Aquí imprimes el <b>ticket</b> de cualquier cuenta cobrada y preparas la <b>boleta</b>. La boleta oficial se emite en SUNAT; el sistema guarda los datos y la serie-número resultante.</p>
        </div>
        {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={load} /> : !groups.length ? <Empty text="No hay cobros en esa fecha." /> : (
          <ul className="space-y-2">
            {groups.map((g) => {
              const r = receipts.get(g.group_id)
              return (
                <li key={g.group_id} className="card flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{[...new Set(g.orders.map((o) => tableLabel(o.tables)))].join(' / ')} · {fmt(g.total)}</div>
                    <div className="text-xs text-slate-500">{timeHM(g.paid_at)} · {METHOD_LABEL[g.method]} · pedidos {g.orders.map((o) => `#${o.order_number}`).join(', ')}</div>
                  </div>
                  {r ? <span className={`badge ${r.status === 'issued' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{r.status === 'issued' ? `Boleta ${r.sunat_ref}` : 'Boleta preparada (falta emitir)'}</span>
                     : <span className="badge bg-slate-100 text-slate-600">Sin boleta</span>}
                  <button className="btn btn-secondary btn-sm" onClick={() => printNode(<Ticket settings={settings} orders={g.orders} kind="consumo" payment={{ method: g.method, reference: g.reference, paid_at: g.paid_at }} boletaRef={r?.sunat_ref ?? null} />)}><Printer size={14} /> Ticket</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setOpen(g.group_id)}>{r ? <FileText size={14} /> : <ReceiptIcon size={14} />} Boleta</button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {current && <BoletaModal key={`${current.group_id}:${receipts.get(current.group_id)?.status ?? 'none'}`} group={current} receipt={receipts.get(current.group_id) ?? null} onClose={() => setOpen(null)} onChanged={load} />}
    </AppShell>
  )
}
