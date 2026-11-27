import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { DatePicker } from '../components/DatePicker'
import { Empty, ErrorBox, Loading } from '../components/ui'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useSettings } from '../lib/settings'
import { downloadCSV, todayISO } from '../lib/util'
import { METHOD_LABEL, type SalesReport } from '../lib/types'

const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return todayISO(d) }

export default function Reports() {
  const { fmt } = useSettings()
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [data, setData] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.salesReport(from, to)); setError('') } catch (e) { setError(errorMessage(e)) }
    setLoading(false)
  }, [from, to])
  useEffect(() => { void load() }, [load])

  const maxDay = Math.max(1, ...(data?.by_day.map((d) => Number(d.total)) ?? [1]))

  function exportCsv() {
    if (!data) return
    downloadCSV(`ventas_${from}_${to}.csv`, [
      ['Resumen'], ['Pedidos pagados', data.summary.orders], ['Ventas', data.summary.total], ['Ticket promedio', data.summary.avg_ticket], ['Impuesto incluido', data.summary.tax], ['Descuentos', data.summary.discounts], ['Cancelados', data.cancelled], [],
      ['Ventas por día'], ['Fecha', 'Pedidos', 'Total'], ...data.by_day.map((d) => [d.date, d.orders, d.total]), [],
      ['Por método de pago'], ['Método', 'Pagos', 'Total'], ...data.by_method.map((m) => [METHOD_LABEL[m.method], m.payments, m.total]), [],
      ['Productos más vendidos'], ['Producto', 'Unidades', 'Total'], ...data.top_products.map((p) => [p.name, p.quantity, p.total]),
    ])
  }

  const preset = (a: number, b = 0) => { setFrom(addDays(a)); setTo(addDays(b)) }
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-5">
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div><label className="label">Desde</label><DatePicker value={from} max={to} range={[from, to]} onChange={setFrom} /></div>
          <div><label className="label">Hasta</label><DatePicker value={to} min={from} range={[from, to]} onChange={setTo} /></div>
          <div className="flex gap-1.5">
            <button className="btn btn-secondary btn-sm" onClick={() => preset(0)}>Hoy</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset(-1, -1)}>Ayer</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset(-6)}>7 días</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset(-29)}>30 días</button>
          </div>
          <button className="btn btn-primary ml-auto" onClick={exportCsv} disabled={!data}><FileSpreadsheet size={16} /> Exportar CSV</button>
        </div>
        {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={load} /> : data && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[['Ventas', fmt(data.summary.total)], ['Pedidos pagados', String(data.summary.orders)], ['Ticket promedio', fmt(data.summary.avg_ticket)], ['Cancelados', String(data.cancelled)]].map(([l, v]) => (
                <div key={l} className="card p-4"><div className="text-xs text-slate-600">{l}</div><div className="mt-1 text-2xl font-extrabold">{v}</div></div>
              ))}
            </div>
            <div className="card p-4">
              <h2 className="mb-3 font-semibold">Ventas por día</h2>
              {data.by_day.length === 0 ? <Empty text="Sin ventas en el período" /> : (
                <div className="space-y-1.5">
                  {data.by_day.map((d) => (
                    <div key={d.date} className="flex items-center gap-3 text-sm">
                      <span className="w-24 text-slate-600">{d.date}</span>
                      <div className="h-5 flex-1 rounded bg-slate-100"><div className="h-5 rounded bg-brand-500" style={{ width: `${(Number(d.total) / maxDay) * 100}%` }} /></div>
                      <span className="w-28 text-right font-semibold">{fmt(Number(d.total))}</span>
                      <span className="w-16 text-right text-xs text-slate-500">{d.orders} ped.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="card p-4">
                <h2 className="mb-2 font-semibold">Por método de pago</h2>
                {data.by_method.length === 0 ? <Empty text="—" /> : data.by_method.map((m) => <div key={m.method} className="flex justify-between border-b border-slate-100 py-1.5 text-sm last:border-0"><span>{METHOD_LABEL[m.method]} <span className="text-slate-500">({m.payments})</span></span><b>{fmt(Number(m.total))}</b></div>)}
                <h2 className="mb-2 mt-4 font-semibold">Por canal</h2>
                {data.by_channel.map((c) => <div key={c.channel} className="flex justify-between border-b border-slate-100 py-1.5 text-sm last:border-0"><span>{c.channel === 'qr' ? 'Código QR' : 'Interno (personal)'} <span className="text-slate-500">({c.orders})</span></span><b>{fmt(Number(c.total))}</b></div>)}
              </div>
              <div className="card p-4">
                <h2 className="mb-2 font-semibold">Productos más vendidos</h2>
                {data.top_products.length === 0 ? <Empty text="—" /> : data.top_products.map((p, i) => <div key={p.name} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0"><span className="w-5 text-slate-500">{i + 1}</span><span className="flex-1">{p.name}</span><span className="text-slate-600">{p.quantity} u.</span><b className="w-24 text-right">{fmt(Number(p.total))}</b></div>)}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
