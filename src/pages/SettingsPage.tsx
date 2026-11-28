import { useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Field, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { normalizeBaseUrl, qrBaseUrl, useSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { q } from '../lib/api'
import { errorMessage } from '../lib/errors'
import type { RestaurantSettings } from '../lib/types'

export default function SettingsPage() {
  const { settings, reload } = useSettings()
  const toast = useToast()
  const [s, setS] = useState<RestaurantSettings>(settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => setS(settings), [settings])
  const legacyDlv = settings.delivery_enabled === undefined      // falta la migración 6 (delivery)
  const legacy = settings.qr_session_minutes === undefined   // la base de datos aún no tiene la migración 4

  async function save() {
    if (s.ruc && !/^\d{11}$/.test(s.ruc.trim())) { toast('El RUC debe tener 11 dígitos.', 'error'); return }
    const base = normalizeBaseUrl(s.public_base_url)
    // WhatsApp: solo dígitos con código de país (51 + 9 dígitos); si escriben 987654321 se completa con 51
    const waDigits = (s.delivery_whatsapp ?? '').replace(/\D/g, '')
    const dlvWa = !waDigits ? null : waDigits.length === 9 ? `51${waDigits}` : waDigits
    if (dlvWa && !/^\d{9,15}$/.test(dlvWa)) { toast('El WhatsApp no es válido. Ejemplo: 987654321', 'error'); return }
    if (s.public_base_url?.trim() && !base) { toast('La URL pública no es válida. Ejemplo: https://cremoso.pages.dev', 'error'); return }
    setBusy(true)
    try {
      await q(supabase.from('restaurant_settings').update({
        name: s.name.trim() || 'Mi Restaurante', currency_symbol: s.currency_symbol.trim() || 'S/',
        tax_rate: Number(s.tax_rate), prices_include_tax: s.prices_include_tax, timezone: s.timezone.trim() || 'America/Lima',
        qr_ordering_enabled: s.qr_ordering_enabled, qr_max_pending_per_table: Number(s.qr_max_pending_per_table),
        // Los dos ajustes de QR seguro solo existen si ya se ejecutó la migración 4; si no, no se envían (así el resto se puede guardar)
        ...(legacy ? {} : { qr_session_minutes: Math.max(0, Math.min(1440, Math.round(Number(s.qr_session_minutes) || 0))), qr_requires_confirmation: s.qr_requires_confirmation }),
        ...(legacyDlv ? {} : { delivery_enabled: s.delivery_enabled, delivery_fee_default: Math.max(0, Math.min(200, Number(s.delivery_fee_default) || 0)), delivery_min_order: Math.max(0, Math.min(5000, Number(s.delivery_min_order) || 0)), delivery_whatsapp: dlvWa }),
        public_base_url: base, receipt_footer: s.receipt_footer?.trim() || null,
        legal_name: s.legal_name?.trim() || null, ruc: s.ruc?.trim() || null, address: s.address?.trim() || null, phone: s.phone?.trim() || null,
      }).eq('id', 1))
      await reload(); toast('Ajustes guardados')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-4 p-3 sm:p-5">
        <h1 className="text-lg font-bold">Ajustes del local</h1>
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Nombre del restaurante"><input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field></div>
          <Field label="Símbolo de moneda"><input className="input" value={s.currency_symbol} maxLength={4} onChange={(e) => setS({ ...s, currency_symbol: e.target.value })} /></Field>
          <Field label="Zona horaria" hint="Define el “día” de los pedidos y reportes."><input className="input" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} /></Field>
          <Field label="Impuesto (IGV/IVA) como decimal" hint="0.18 = 18 %"><input className="input" inputMode="decimal" value={s.tax_rate} onChange={(e) => setS({ ...s, tax_rate: e.target.value.replace(',', '.') as unknown as number })} /></Field>
          <div className="flex items-end"><Toggle checked={s.prices_include_tax} onChange={(v) => setS({ ...s, prices_include_tax: v })} label="Los precios ya incluyen impuesto" /></div>
          <div className="sm:col-span-2 border-t border-slate-200 pt-4"><h2 className="font-semibold">Datos del negocio (ticket y boleta)</h2>
            <p className="text-xs text-slate-600">Se imprimen en el encabezado del ticket. La boleta oficial se emite en SUNAT con estos mismos datos.</p></div>
          <div className="sm:col-span-2"><Field label="Razón social o nombre comercial (opcional)"><input className="input" value={s.legal_name ?? ''} onChange={(e) => setS({ ...s, legal_name: e.target.value })} /></Field></div>
          <Field label="RUC" hint="11 dígitos."><input className="input" inputMode="numeric" maxLength={11} value={s.ruc ?? ''} onChange={(e) => setS({ ...s, ruc: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Teléfono (opcional)"><input className="input" value={s.phone ?? ''} onChange={(e) => setS({ ...s, phone: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Dirección (opcional)"><input className="input" value={s.address ?? ''} onChange={(e) => setS({ ...s, address: e.target.value })} /></Field></div>
          <div className="sm:col-span-2 border-t border-slate-200 pt-4"><h2 className="font-semibold">Delivery</h2></div>
          {legacyDlv ? <div className="sm:col-span-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><b>Falta actualizar la base de datos.</b> Ejecuta en Supabase el archivo <code>supabase/migrations/20260106000000_delivery.sql</code> para activar el delivery.</div> : (
            <>
              <div className="sm:col-span-2"><Toggle checked={s.delivery_enabled} onChange={(v) => setS({ ...s, delivery_enabled: v })} label="Aceptar pedidos a domicilio (delivery)" /></div>
              <Field label={`Costo de envío por defecto (${s.currency_symbol})`} hint="Se propone en cada delivery; Caja puede cambiarlo en cada pedido."><input className="input" type="number" min={0} max={200} step="0.5" value={s.delivery_fee_default} onChange={(e) => setS({ ...s, delivery_fee_default: Number(e.target.value) })} /></Field>
              <Field label={`Pedido mínimo para delivery (${s.currency_symbol})`} hint="0 = sin mínimo. Se compara con el consumo, sin contar el envío."><input className="input" type="number" min={0} max={5000} step="1" value={s.delivery_min_order} onChange={(e) => setS({ ...s, delivery_min_order: Number(e.target.value) })} /></Field>
              <div className="sm:col-span-2"><Field label="WhatsApp del local para pedidos" hint="Con este número, la carta pública (QR de la carta) muestra «Pedir por WhatsApp» y el cliente te envía su pedido armado. Ejemplo: 987654321."><input className="input" inputMode="tel" placeholder="987654321" value={s.delivery_whatsapp ?? ''} onChange={(e) => setS({ ...s, delivery_whatsapp: e.target.value })} /></Field></div>
            </>
          )}
          <div className="sm:col-span-2 border-t border-slate-200 pt-4"><h2 className="font-semibold">Pedidos por QR</h2></div>
          <div className="sm:col-span-2"><Toggle checked={s.qr_ordering_enabled} onChange={(v) => setS({ ...s, qr_ordering_enabled: v })} label="Permitir pedir desde el celular (si lo apagas, la carta queda solo para ver)" /></div>
          <Field label="Máx. pedidos QR pendientes por mesa" hint="Freno anti-spam: cuántos pedidos puede tener una mesa esperando a cocina."><input className="input" type="number" min={1} max={20} value={s.qr_max_pending_per_table} onChange={(e) => setS({ ...s, qr_max_pending_per_table: Number(e.target.value) })} /></Field>
          {legacy && <div className="sm:col-span-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><b>Falta actualizar la base de datos.</b> Ejecuta en Supabase (SQL Editor) el archivo <code>supabase/migrations/20260104000000_qr_seguridad_y_personal.sql</code>. Mientras tanto el resto de los ajustes se guarda con normalidad, pero la carta del QR no funcionará.</div>}
          {!legacy && <div className="sm:col-span-2"><Toggle checked={s.qr_requires_confirmation} onChange={(v) => setS({ ...s, qr_requires_confirmation: v })} label="Los pedidos del QR esperan la confirmación de Caja (recomendado)" />
            <p className="mt-1 text-xs text-slate-600">Un pedido hecho desde el celular no llega a cocina hasta que el personal lo acepta en Caja. Así una broma o un pedido de alguien que no está en el local no genera trabajo ni cobro. Si lo apagas, los pedidos llegan directo a cocina.</p></div>}
          {!legacy && <Field label="Duración de la sesión del QR (minutos)" hint="Al escanear el QR el cliente puede pedir durante este tiempo. También se cierra al pagar la cuenta de la mesa. 0 = sin límite (no recomendado)."><input className="input" type="number" min={0} max={1440} value={s.qr_session_minutes} onChange={(e) => setS({ ...s, qr_session_minutes: Number(e.target.value) })} /></Field>}
          <div className="sm:col-span-2"><Field label="URL pública del sistema (para los QR)" hint="Solo la dirección del sistema, sin /login ni otra ruta. Ej.: https://cremoso.pages.dev · Red local: http://192.168.1.50:8080. Si cambia, hay que reimprimir los QR.">
            <input className="input" placeholder="https://…" value={s.public_base_url ?? ''} onChange={(e) => setS({ ...s, public_base_url: e.target.value })} /></Field>
            <p className="mt-2 text-sm text-slate-700">Los QR abrirán: <b className="break-all">{qrBaseUrl({ ...s, public_base_url: s.public_base_url })}/m/…</b> ·{' '}
              <a className="font-semibold text-brand-700 underline" href={`${qrBaseUrl(s)}/menu`} target="_blank" rel="noreferrer">Probar la carta pública</a></p></div>
          <div className="sm:col-span-2"><Field label="Pie del ticket (opcional)"><input className="input" value={s.receipt_footer ?? ''} onChange={(e) => setS({ ...s, receipt_footer: e.target.value })} /></Field></div>
          <div className="sm:col-span-2 flex justify-end"><button className="btn btn-primary" disabled={busy} onClick={save}>Guardar ajustes</button></div>
        </div>
      </div>
    </AppShell>
  )
}
