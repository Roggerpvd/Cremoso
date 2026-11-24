import { useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Field, Toggle } from '../components/ui'
import { useToast } from '../components/Toast'
import { useSettings } from '../lib/settings'
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

  async function save() {
    if (s.ruc && !/^\d{11}$/.test(s.ruc.trim())) { toast('El RUC debe tener 11 dígitos.', 'error'); return }
    setBusy(true)
    try {
      await q(supabase.from('restaurant_settings').update({
        name: s.name.trim() || 'Mi Restaurante', currency_symbol: s.currency_symbol.trim() || 'S/',
        tax_rate: Number(s.tax_rate), prices_include_tax: s.prices_include_tax, timezone: s.timezone.trim() || 'America/Lima',
        qr_ordering_enabled: s.qr_ordering_enabled, qr_max_pending_per_table: Number(s.qr_max_pending_per_table),
        public_base_url: s.public_base_url?.trim().replace(/\/+$/, '') || null, receipt_footer: s.receipt_footer?.trim() || null,
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
            <p className="text-xs text-slate-500">Se imprimen en el encabezado del ticket. La boleta oficial se emite en SUNAT con estos mismos datos.</p></div>
          <div className="sm:col-span-2"><Field label="Razón social o nombre comercial (opcional)"><input className="input" value={s.legal_name ?? ''} onChange={(e) => setS({ ...s, legal_name: e.target.value })} /></Field></div>
          <Field label="RUC" hint="11 dígitos."><input className="input" inputMode="numeric" maxLength={11} value={s.ruc ?? ''} onChange={(e) => setS({ ...s, ruc: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Teléfono (opcional)"><input className="input" value={s.phone ?? ''} onChange={(e) => setS({ ...s, phone: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Dirección (opcional)"><input className="input" value={s.address ?? ''} onChange={(e) => setS({ ...s, address: e.target.value })} /></Field></div>
          <div className="sm:col-span-2 border-t border-slate-200 pt-4"><h2 className="font-semibold">Pedidos por QR</h2></div>
          <div className="sm:col-span-2"><Toggle checked={s.qr_ordering_enabled} onChange={(v) => setS({ ...s, qr_ordering_enabled: v })} label="Permitir pedir desde el celular (si lo apagas, la carta queda solo para ver)" /></div>
          <Field label="Máx. pedidos QR pendientes por mesa" hint="Freno anti-spam: cuántos pedidos puede tener una mesa esperando a cocina."><input className="input" type="number" min={1} max={20} value={s.qr_max_pending_per_table} onChange={(e) => setS({ ...s, qr_max_pending_per_table: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2"><Field label="URL pública del sistema (para los QR)" hint="Nube: https://tu-sitio.netlify.app · Red local: http://192.168.1.50:8080. Si cambia, hay que reimprimir los QR.">
            <input className="input" placeholder="https://…" value={s.public_base_url ?? ''} onChange={(e) => setS({ ...s, public_base_url: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Pie del ticket (opcional)"><input className="input" value={s.receipt_footer ?? ''} onChange={(e) => setS({ ...s, receipt_footer: e.target.value })} /></Field></div>
          <div className="sm:col-span-2 flex justify-end"><button className="btn btn-primary" disabled={busy} onClick={save}>Guardar ajustes</button></div>
        </div>
      </div>
    </AppShell>
  )
}
