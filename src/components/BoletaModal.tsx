import { useMemo, useState } from 'react'
import { Copy, ExternalLink, Printer, Trash2 } from 'lucide-react'
import { Field, Modal } from './ui'
import { printNode } from './Print'
import { useToast } from './Toast'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useSettings } from '../lib/settings'
import { APP_NAME } from '../lib/brand'
import { copyText, money } from '../lib/util'
import { BOLETA_DOC_THRESHOLD, type BoletaLine, type DocType, type PaidGroup, type Receipt, type RestaurantSettings } from '../lib/types'

const cents = (n: number) => Math.round(n * 100)
const DOC_HINT: Record<DocType, string> = { DNI: '8 dígitos', CE: '9 a 12 letras o números', PASAPORTE: '6 a 12 letras o números' }

/** Líneas iniciales: una por producto vendido (suma de las líneas de todos los pedidos del cobro). */
function initialLines(g: PaidGroup): BoletaLine[] {
  const m = new Map<string, BoletaLine>()
  for (const o of g.orders) for (const it of o.order_items) {
    const k = `${it.product_id}|${it.unit_price}`
    const cur = m.get(k)
    if (cur) { cur.quantity += it.quantity; cur.amount = Math.round((cur.amount + Number(it.line_total)) * 100) / 100 }
    else m.set(k, { product: it.product_name, quantity: it.quantity, amount: Number(it.line_total) })
  }
  const lines = [...m.values()]
  // El envío de un delivery se cobra al cliente, así que va como una línea más de la boleta (si no, el total no cuadraría)
  const fee = g.orders.reduce((t, o) => t + (o.order_kind === 'delivery' ? Number(o.delivery_fee) : 0), 0)
  if (fee > 0) lines.push({ product: 'Servicio de delivery', quantity: 1, amount: Math.round(fee * 100) / 100 })
  // Si por redondeo/impuestos la suma no coincide con lo cobrado, ajusta la última línea para cuadrar.
  const diff = cents(g.total) - cents(lines.reduce((t, l) => t + l.amount, 0))
  if (lines.length && diff !== 0) lines[lines.length - 1].amount = (cents(lines[lines.length - 1].amount) + diff) / 100
  return lines
}

/** Hoja imprimible con los datos para emitir la boleta en SUNAT (NO es la boleta). */
function BoletaSheet({ s, name, doc, lines, total, sunatRef }: {
  s: RestaurantSettings; name: string; doc: string | null; lines: BoletaLine[]; total: number; sunatRef: string | null
}) {
  const fmt = (n: number) => money(n, s.currency_symbol)
  return (
    <div className="sheet">
      <h1>{sunatRef ? `Constancia interna · Boleta ${sunatRef}` : 'Datos para emitir la boleta de venta electrónica'}</h1>
      <div><b>{s.name || APP_NAME}</b>{s.legal_name && s.legal_name !== s.name ? ` · ${s.legal_name}` : ''}{s.ruc ? ` · RUC ${s.ruc}` : ''}</div>
      <p style={{ margin: '8px 0' }}><b>Cliente:</b> {name}{doc ? ` · ${doc}` : ''}</p>
      <table>
        <thead><tr><th>Producto</th><th className="r">Cantidad</th><th className="r">Monto ({s.currency_symbol})</th></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}><td>{l.product}</td><td className="r">{l.quantity}</td><td className="r">{fmt(l.amount)}</td></tr>)}</tbody>
        <tfoot><tr><th colSpan={2} className="r">TOTAL</th><th className="r">{fmt(total)}</th></tr></tfoot>
      </table>
      <p style={{ marginTop: 14, border: '1px solid #000', padding: 6, fontWeight: 700 }}>
        {sunatRef
          ? 'Este documento es solo una constancia interna. El comprobante válido es la boleta electrónica emitida en SUNAT.'
          : 'ESTE DOCUMENTO NO ES UNA BOLETA. Sirve para digitar los datos en SUNAT (SEE-SOL). La boleta válida es la que SUNAT emite.'}
      </p>
    </div>
  )
}

export function BoletaModal({ group, receipt, onClose, onChanged }: {
  group: PaidGroup; receipt: Receipt | null; onClose: () => void; onChanged: () => Promise<void> | void
}) {
  const { settings } = useSettings()
  const toast = useToast()
  const fmt = (n: number) => money(n, settings.currency_symbol)

  const [name, setName] = useState('')
  const [docType, setDocType] = useState<DocType | ''>('')
  const [docNumber, setDocNumber] = useState('')
  const [lines, setLines] = useState<BoletaLine[]>(() => initialLines(group))
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)

  const needsDoc = group.total > BOLETA_DOC_THRESHOLD
  const sum = useMemo(() => lines.reduce((t, l) => t + (Number(l.amount) || 0), 0), [lines])
  const balanced = cents(sum) === cents(group.total)
  const upd = (i: number, p: Partial<BoletaLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))

  const formError = (() => {
    if (name.trim().length < 2) return 'Escribe el nombre del cliente.'
    if (needsDoc && !docType) return `El total supera ${fmt(BOLETA_DOC_THRESHOLD)}: SUNAT exige el documento de identidad del cliente.`
    if (docType && !docNumber.trim()) return 'Escribe el número del documento.'
    if (docType === 'DNI' && !/^\d{8}$/.test(docNumber.trim())) return 'El DNI debe tener 8 dígitos.'
    if (!lines.length || lines.some((l) => !l.product.trim() || !(Number(l.quantity) > 0) || !(Number(l.amount) >= 0))) return 'Revisa producto, cantidad y monto de cada línea.'
    if (!balanced) return `La suma de montos (${fmt(sum)}) debe ser igual al total cobrado (${fmt(group.total)}).`
    return ''
  })()

  async function prepare() {
    setBusy(true)
    try {
      await api.registerBoleta(group.group_id, name.trim(), docType || null, docType ? docNumber.trim() : null,
        lines.map((l) => ({ product: l.product.trim(), quantity: Number(l.quantity), amount: Math.round(Number(l.amount) * 100) / 100 })))
      toast('Datos de la boleta guardados. Ahora emítela en SUNAT.')
      await onChanged()
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  async function markIssued() {
    if (!receipt) return
    setBusy(true)
    try { await api.markBoletaIssued(receipt.id, ref); toast('Boleta registrada como emitida'); await onChanged() }
    catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  async function discard() {
    if (!receipt || !window.confirm('¿Descartar estos datos para corregirlos? (Solo si aún NO emitiste la boleta en SUNAT)')) return
    setBusy(true)
    try { await api.voidBoleta(receipt.id); toast('Datos descartados', 'info'); await onChanged() }
    catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  const docText = (r: Receipt) => (r.doc_type ? `${r.doc_type} ${r.doc_number}` : null)
  const plain = (r: Receipt) => [`Cliente: ${r.customer_name}`, docText(r) ? `Documento: ${docText(r)}` : '',
    ...r.items.map((l) => `${l.product} | cant. ${l.quantity} | ${settings.currency_symbol} ${Number(l.amount).toFixed(2)}`),
    `TOTAL: ${settings.currency_symbol} ${Number(r.total).toFixed(2)}`].filter(Boolean).join('\n')
  /** Bloque para el atajo /emitir-boleta-sunat del agente de navegador (ver docs/EMISION_CON_AGENTE.md). */
  const agentPrompt = (r: Receipt) => [
    '/emitir-boleta-sunat',
    settings.ruc ? `EMISOR_RUC: ${settings.ruc}` : 'EMISOR_RUC: (no configurado en Ajustes)',
    `EMISOR: ${settings.legal_name || settings.name}`,
    `REFERENCIA: Cobro ${r.group_id}`,
    `CLIENTE: ${r.customer_name}`,
    `DOCUMENTO: ${docText(r) ?? 'ninguno'}`,
    'ITEMS:',
    ...r.items.map((l) => `- ${l.product} | cantidad ${l.quantity} | monto ${settings.currency_symbol} ${Number(l.amount).toFixed(2)}`),
    `TOTAL: ${settings.currency_symbol} ${Number(r.total).toFixed(2)}`,
  ].join('\n')
  const printSheet = (r: Receipt) => printNode(<BoletaSheet s={settings} name={r.customer_name} doc={docText(r)} lines={r.items} total={Number(r.total)} sunatRef={r.sunat_ref} />)

  /* ---- Paso 2/3: boleta preparada o emitida ---- */
  if (receipt && receipt.status !== 'void') {
    const issued = receipt.status === 'issued'
    return (
      <Modal wide title={issued ? `Boleta ${receipt.sunat_ref}` : 'Boleta preparada — falta emitirla en SUNAT'} onClose={onClose}
        footer={<button className="btn btn-secondary" onClick={onClose}>Cerrar</button>}>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-slate-200 p-3">
            <p><b>Cliente:</b> {receipt.customer_name}{docText(receipt) && ` · ${docText(receipt)}`}</p>
            <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs text-slate-600"><th>Producto</th><th className="text-right">Cantidad</th><th className="text-right">Monto</th></tr></thead>
              <tbody>{receipt.items.map((l, i) => <tr key={i}><td>{l.product}</td><td className="text-right">{l.quantity}</td><td className="text-right">{fmt(l.amount)}</td></tr>)}</tbody>
              <tfoot><tr className="font-bold"><td colSpan={2} className="pt-1 text-right">Total</td><td className="pt-1 text-right">{fmt(receipt.total)}</td></tr></tfoot></table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-secondary btn-sm" onClick={async () => toast((await copyText(plain(receipt))) ? 'Datos copiados' : 'No se pudo copiar', 'info')}><Copy size={14} /> Copiar datos</button>
            {!issued && <button className="btn btn-primary btn-sm" onClick={async () => toast((await copyText(agentPrompt(receipt))) ? 'Copiado: pégalo en Claude en Chrome' : 'No se pudo copiar', 'info')}><Copy size={14} /> Copiar para el agente</button>}
            <button className="btn btn-secondary btn-sm" onClick={() => printSheet(receipt)}><Printer size={14} /> Imprimir {issued ? 'constancia' : 'hoja de datos'}</button>
          </div>
          {!issued && (
            <div className="space-y-3 rounded-lg bg-brand-50 p-3">
              <p className="font-semibold">Opción A · Con el agente de navegador (Claude en Chrome):</p>
              <ol className="list-decimal space-y-1 pl-5 text-slate-700">
                <li>Inicia sesión tú mismo en SUNAT en Chrome (la Clave SOL nunca se la das al agente).</li>
                <li>Pulsa <b>Copiar para el agente</b> y pégalo en el panel de Claude en Chrome: el agente llena el formulario y se detiene.</li>
                <li><b>Revisa y presiona Emitir tú.</b> Imprime la boleta con el botón del portal de SUNAT.</li>
                <li>Pega aquí la línea <code>BOLETA_EMITIDA: …</code> que te devuelve el agente (o escribe la serie-número).</li>
              </ol>
              <p className="pt-1 font-semibold">Opción B · A mano (gratis, con tu Clave SOL):</p>
              <ol className="list-decimal space-y-1 pl-5 text-slate-700">
                <li>Entra a <a className="inline-flex items-center gap-1 font-medium text-brand-700 underline" href="https://www.sunat.gob.pe" target="_blank" rel="noreferrer">SUNAT Operaciones en Línea <ExternalLink size={12} /></a> o a la app Emprender SUNAT con tu RUC y Clave SOL.</li>
                <li>Comprobantes de pago → SEE-SOL → Boleta de Venta Electrónica → Emitir.</li>
                <li>Digita los datos de arriba (puedes copiarlos) y emite. Descarga o imprime la boleta que genera SUNAT: esa es la válida.</li>
                <li>Escribe aquí la serie y número que te dio SUNAT para dejar constancia.</li>
              </ol>
              <div className="flex gap-2">
                <input className="input" placeholder="Serie-número, ej. B001-123" value={ref} onChange={(e) => { const v = e.target.value.toUpperCase(); const m = v.match(/[A-Z0-9]{4}-\d{1,8}/); setRef(m ? m[0] : v.slice(0, 13)) }} />
                <button className="btn btn-primary" disabled={busy || !ref.trim()} onClick={markIssued}>Registrar emitida</button>
              </div>
              <button className="btn btn-ghost btn-sm text-red-700" disabled={busy} onClick={discard}><Trash2 size={14} /> Descartar y corregir datos</button>
              <p className="text-xs text-slate-600">La Clave SOL se escribe solo en el sitio de SUNAT; este sistema nunca la pide ni la guarda.</p>
            </div>
          )}
          {issued && <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Registrada como emitida en SUNAT el {new Date(receipt.issued_at ?? receipt.created_at).toLocaleString('es-PE')}. Si hay un error en la boleta, se corrige o anula en SUNAT (no aquí).</p>}
        </div>
      </Modal>
    )
  }

  /* ---- Paso 1: pedir los datos ---- */
  return (
    <Modal wide title="Preparar boleta de venta" onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy || !!formError} onClick={prepare}>Guardar datos de la boleta</button></>}>
      <div className="space-y-4">
        <Field label="Nombre del cliente"><input className="input" autoFocus value={name} maxLength={150} onChange={(e) => setName(e.target.value)} placeholder="Nombres y apellidos" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={needsDoc ? 'Documento (obligatorio)' : 'Documento (opcional)'}>
            <select className="input" value={docType} onChange={(e) => setDocType(e.target.value as DocType | '')}>
              <option value="">{needsDoc ? 'Elige…' : 'Sin documento'}</option>
              <option value="DNI">DNI</option><option value="CE">Carné de extranjería</option><option value="PASAPORTE">Pasaporte</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Número de documento" hint={docType ? DOC_HINT[docType] : undefined}>
              <input className="input" disabled={!docType} value={docNumber} inputMode={docType === 'DNI' ? 'numeric' : 'text'} maxLength={12} onChange={(e) => setDocNumber(e.target.value)} />
            </Field>
          </div>
        </div>
        {needsDoc && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">El total ({fmt(group.total)}) supera {fmt(BOLETA_DOC_THRESHOLD)}: SUNAT exige identificar al cliente con su documento, no basta el nombre.</p>}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label !mb-0">Producto · Cantidad · Monto ({settings.currency_symbol})</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setLines([{ product: 'Consumo en restaurante', quantity: 1, amount: group.total }])}>Consolidar en una línea</button>
          </div>
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-1.5">
                <input className="input" aria-label="Producto" value={l.product} maxLength={150} onChange={(e) => upd(i, { product: e.target.value })} />
                <input className="input !w-20" aria-label="Cantidad" inputMode="decimal" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value.replace(',', '.') as unknown as number })} />
                <input className="input !w-28" aria-label="Monto en soles" inputMode="decimal" value={l.amount} onChange={(e) => upd(i, { amount: e.target.value.replace(',', '.') as unknown as number })} />
                <button className="btn btn-ghost btn-sm" aria-label="Quitar línea" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className={`mt-2 flex justify-between text-sm font-semibold ${balanced ? 'text-emerald-700' : 'text-red-700'}`}>
            <span>Suma de montos {fmt(sum)}</span><span>Total cobrado {fmt(group.total)}</span>
          </div>
        </div>
        {formError && <p className="text-xs text-red-700">{formError}</p>}
      </div>
    </Modal>
  )
}
