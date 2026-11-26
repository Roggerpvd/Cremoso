import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'
import { AlertTriangle, Copy, Download, Pencil, Plus, Printer, RefreshCw } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Empty, ErrorBox, Field, Loading, Modal, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { qrBaseUrl, useSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { api, q } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { copyText } from '../lib/util'
import type { TableRow } from '../lib/types'

export default function Tables() {
  const toast = useToast()
  const { settings } = useSettings()
  const [tables, setTables] = useState<TableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<Partial<TableRow> | null>(null)
  const [printing, setPrinting] = useState<TableRow[] | null>(null)
  const base = qrBaseUrl(settings)
  const urlOf = (t: TableRow) => `${base}/m/${t.qr_token}`
  const isLocalhost = /localhost|127\.0\.0\.1/.test(base)

  const load = useCallback(async () => {
    try { setTables(await q<TableRow[]>(supabase.from('tables').select('*').order('number'))); setError('') }
    catch (e) { setError(errorMessage(e)) }
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(null)
    window.addEventListener('afterprint', done)
    const t = setTimeout(() => window.print(), 250)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [printing])

  async function save() {
    if (!edit?.number || edit.number < 1) return toast('Indica un número de mesa válido', 'error')
    try {
      const row = { number: Number(edit.number), name: edit.name?.trim() || null, capacity: Number(edit.capacity) || 4, is_active: edit.is_active ?? true }
      if (edit.id) await q(supabase.from('tables').update(row).eq('id', edit.id))
      else await q(supabase.from('tables').insert(row))
      setEdit(null); await load(); toast('Mesa guardada')
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  async function regen(t: TableRow) {
    if (!window.confirm(`Se generará un QR NUEVO para la mesa ${t.number}. El QR impreso actual dejará de funcionar. ¿Continuar?`)) return
    try { await api.regenerateToken(t.id); await load(); toast('QR regenerado: imprime el nuevo') } catch (e) { toast(errorMessage(e), 'error') }
  }
  async function copy(t: TableRow) { toast((await copyText(urlOf(t))) ? 'Enlace copiado' : 'No se pudo copiar', 'info') }

  return (
    <>
      <AppShell>
        <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold">Mesas y códigos QR</h1>
            <div className="ml-auto flex gap-2">
              <button className="btn btn-secondary" disabled={!tables.length} onClick={() => setPrinting(tables.filter((t) => t.is_active))}><Printer size={16} /> Imprimir todos</button>
              <button className="btn btn-primary" onClick={() => setEdit({ number: (tables.at(-1)?.number ?? 0) + 1, capacity: 4, is_active: true })}><Plus size={16} /> Nueva mesa</button>
            </div>
          </div>
          {isLocalhost && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>Los QR apuntan a <b>{base}</b>, que los celulares de los clientes no pueden abrir. En <b>Ajustes → URL pública</b> escribe la dirección real (la de Netlify/Cloudflare o la IP de tu red local, p. ej. <code>http://192.168.1.50:8080</code>) y vuelve a imprimir los QR.</span>
            </div>
          )}
          <div className="card flex flex-wrap items-center gap-4 p-4">
            <div className="rounded-xl bg-white p-2"><QRCodeCanvas id="qr-carta" value={`${base}/menu`} size={512} marginSize={2} level="M" style={{ width: 96, height: 96 }} /></div>
            <div className="min-w-48 flex-1">
              <div className="font-semibold">QR de la carta (solo ver)</div>
              <p className="text-xs text-slate-500">Abre directo la carta, sin mesa y sin poder pedir. Sirve para la entrada, la vitrina o redes sociales. Los pedidos solo se hacen con el QR de cada mesa.</p>
              <p className="mt-1 break-all text-xs text-slate-400">{base}/menu</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => {
              const c = document.getElementById('qr-carta') as HTMLCanvasElement | null
              if (!c) return
              const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = 'QR-carta.png'; a.click()
            }}><Download size={13} /> Descargar</button>
          </div>
          {loading ? <Loading /> : error ? <ErrorBox text={error} onRetry={load} /> : tables.length === 0 ? <Empty text="Aún no hay mesas" /> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tables.map((t) => (
                <div key={t.id} className={`card p-4 ${t.is_active ? '' : 'opacity-50'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xl font-bold">Mesa {t.number}</div>
                      <div className="text-xs text-slate-500">{t.name ? `${t.name} · ` : ''}{t.capacity} personas{!t.is_active && ' · desactivada'}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEdit(t)}><Pencil size={15} /></button>
                  </div>
                  <div className="my-3 flex justify-center rounded-lg bg-white p-2">
                    <QRCodeCanvas id={`qr-${t.id}`} value={urlOf(t)} size={512} marginSize={2} level="M" style={{ width: 150, height: 150 }} />
                  </div>
                  <p className="truncate text-center text-[11px] text-slate-400">{urlOf(t)}</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    <button className="btn btn-secondary btn-sm" onClick={() => setPrinting([t])}><Printer size={13} /> Imprimir</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      const c = document.getElementById(`qr-${t.id}`) as HTMLCanvasElement | null
                      if (!c) return
                      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `QR-mesa-${t.number}.png`; a.click()
                    }}><Download size={13} /> PNG</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => copy(t)}><Copy size={13} /> Enlace</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => regen(t)} title="Invalida el QR impreso"><RefreshCw size={13} /> Regenerar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {edit && (
          <Modal title={edit.id ? `Editar mesa ${edit.number}` : 'Nueva mesa'} onClose={() => setEdit(null)}
            footer={<><button className="btn btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
            <div className="space-y-3">
              <Field label="Número"><input className="input" type="number" min={1} value={edit.number ?? ''} onChange={(e) => setEdit({ ...edit, number: Number(e.target.value) })} /></Field>
              <Field label="Nombre / zona (opcional)"><input className="input" placeholder="Terraza, Barra…" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Capacidad"><input className="input" type="number" min={1} value={edit.capacity ?? 4} onChange={(e) => setEdit({ ...edit, capacity: Number(e.target.value) })} /></Field>
              <Toggle checked={edit.is_active ?? true} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Mesa activa (su QR funciona)" />
            </div>
          </Modal>
        )}
      </AppShell>
      <PrintSheet tables={printing} name={settings.name} urlOf={urlOf} />
    </>
  )
}

/** Hoja de impresión: solo se ve al imprimir (CSS @media print en index.css). */
function PrintSheet({ tables, name, urlOf }: { tables: TableRow[] | null; name: string; urlOf: (t: TableRow) => string }) {
  const ref = useRef<HTMLDivElement>(null)
  if (!tables) return null
  return (
    <div ref={ref} className="print-area hidden print:block">
      <div className="grid grid-cols-2 gap-6">
        {tables.map((t) => (
          <div key={t.id} className="print-card flex flex-col items-center rounded-2xl border-2 border-slate-800 p-6 text-center">
            <div className="text-xl font-bold">{name}</div>
            <div className="mt-1 text-5xl font-extrabold">Mesa {t.number}</div>
            <div className="my-4"><QRCodeSVG value={urlOf(t)} size={230} marginSize={1} level="M" /></div>
            <div className="text-lg font-semibold">Escanea, mira la carta y pide desde tu celular</div>
            <div className="mt-1 text-sm text-slate-600">No necesitas instalar nada</div>
          </div>
        ))}
      </div>
    </div>
  )
}
