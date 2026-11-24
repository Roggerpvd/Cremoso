import { APP_NAME } from '../lib/brand'
import { METHOD_LABEL, type Order, type PaymentMethod, type RestaurantSettings } from '../lib/types'
import { money, tableLabel } from '../lib/util'

export interface TicketPayment { method: PaymentMethod; reference: string | null; paid_at: string }

const CHANNEL = { internal: 'Caja/Salón', qr: 'QR' } as const

/**
 * Ticket de consumo (80 mm) con TODOS los datos de la cuenta: negocio, mesa, pedidos, hora, canal, ítems con
 * observaciones, descuentos, impuesto, total y forma de pago.
 * kind = 'precuenta' → cuenta aún no pagada (no es comprobante).
 * kind = 'consumo'   → cuenta pagada.
 * Al pie, el ticket de consumo dice "Comprobante" (la pre-cuenta conserva su aviso de que aún no es un comprobante).
 * Ojo: este ticket lo genera el sistema; la boleta electrónica válida ante SUNAT es la que lleva serie-número (boletaRef).
 */
export function Ticket({ settings: s, orders, kind, payment, boletaRef }: {
  settings: RestaurantSettings
  orders: Order[]
  kind: 'precuenta' | 'consumo'
  payment?: TicketPayment | null
  boletaRef?: string | null
}) {
  const fmt = (n: number) => money(n, s.currency_symbol)
  const tz = s.timezone || 'America/Lima'
  const when = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  const sorted = orders.slice().sort((a, b) => a.order_number - b.order_number)
  const sum = (k: 'subtotal' | 'discount_total' | 'tax_amount' | 'total') => sorted.reduce((t, o) => t + Number(o[k]), 0)
  const total = sum('total'), discount = sum('discount_total'), tax = sum('tax_amount')
  const tables = [...new Set(sorted.map((o) => tableLabel(o.tables)))].join(' / ')
  const pct = Math.round(Number(s.tax_rate) * 10000) / 100

  return (
    <div className="ticket">
      <h1>{s.name || APP_NAME}</h1>
      {s.legal_name && s.legal_name !== s.name && <div className="c">{s.legal_name}</div>}
      {s.ruc && <div className="c">RUC {s.ruc}</div>}
      {s.address && <div className="c">{s.address}</div>}
      {s.phone && <div className="c">Tel. {s.phone}</div>}
      <hr />
      <div className="c big">{kind === 'precuenta' ? 'PRE-CUENTA' : 'TICKET DE CONSUMO'}</div>
      <div className="c">{when(payment?.paid_at ?? new Date().toISOString())}</div>
      <div>{tables}</div>
      <hr />
      {sorted.map((o) => (
        <div key={o.id} style={{ marginBottom: 4 }}>
          <div><b>Pedido #{o.order_number}</b> · {when(o.created_at).slice(-5)} · {CHANNEL[o.channel]}</div>
          <table><tbody>
            {o.order_items.slice().sort((a, b) => a.line_no - b.line_no).map((it) => (
              <tr key={it.id}>
                <td colSpan={2}>
                  {it.quantity} × {it.product_name}
                  {it.notes && <div className="note">• {it.notes}</div>}
                  {it.unit_price < it.list_price && <div className="note">(precio lista {fmt(it.list_price)}, promoción)</div>}
                </td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>{fmt(it.line_total)}</td>
              </tr>
            ))}
          </tbody></table>
          {o.customer_note && <div className="note">Nota: {o.customer_note}</div>}
        </div>
      ))}
      <hr />
      <table><tbody>
        <tr><td>Subtotal</td><td className="r">{fmt(sum('subtotal'))}</td></tr>
        {discount > 0 && <tr><td>Descuentos</td><td className="r">- {fmt(discount)}</td></tr>}
        {pct > 0 && <tr><td>{s.prices_include_tax ? `Incluye IGV/IVA ${pct}%` : `IGV/IVA ${pct}%`}</td><td className="r">{fmt(tax)}</td></tr>}
        <tr className="big"><td>TOTAL</td><td className="r">{fmt(total)}</td></tr>
      </tbody></table>
      {payment && (
        <>
          <hr />
          <div>Pagado con: <b>{METHOD_LABEL[payment.method]}</b></div>
          {payment.reference && <div>Ref.: {payment.reference}</div>}
        </>
      )}
      {boletaRef && <div>Boleta electrónica: <b>{boletaRef}</b></div>}
      <hr />
      {kind === 'precuenta'
        ? <div className="warn">PRE-CUENTA · NO ES COMPROBANTE DE PAGO</div>
        : <div className="c big">Comprobante</div>}
      {s.receipt_footer && <div className="c" style={{ marginTop: 4 }}>{s.receipt_footer}</div>}
      <div className="c" style={{ marginTop: 4 }}>¡Gracias por su visita!</div>
    </div>
  )
}
