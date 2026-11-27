import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { money } from './util'
import type { RestaurantSettings } from './types'

const DEFAULTS: RestaurantSettings = {
  id: 1, name: 'Restaurante', currency_symbol: 'S/', tax_rate: 0.18, prices_include_tax: true,
  timezone: 'America/Lima', qr_ordering_enabled: true, qr_max_pending_per_table: 3,
  qr_session_minutes: 180, qr_requires_confirmation: true,
  public_base_url: null, receipt_footer: null, legal_name: null, ruc: null, address: null, phone: null,
}

interface Value { settings: RestaurantSettings; loaded: boolean; fmt: (n: number) => string; reload: () => Promise<void> }
const Ctx = createContext<Value>({ settings: DEFAULTS, loaded: false, fmt: (n) => money(n), reload: async () => {} })
export const useSettings = () => useContext(Ctx)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<RestaurantSettings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    const { data } = await supabase.from('restaurant_settings').select('*').eq('id', 1).maybeSingle()
    if (data) setSettings(data as RestaurantSettings)
    setLoaded(true)
  }, [])
  useEffect(() => { void reload() }, [reload])

  const value = useMemo<Value>(
    () => ({ settings, loaded, reload, fmt: (n: number) => money(n, settings.currency_symbol) }),
    [settings, loaded, reload],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Deja solo el origen de la dirección: "https://sitio.pe/login" → "https://sitio.pe".
 * Si falta el protocolo se asume https. Devuelve null si no es una dirección válida.
 */
export function normalizeBaseUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch { return null }
}

/** URL base de los QR: la configurada en Ajustes (solo el dominio) o, si no hay, la del navegador actual. */
export function qrBaseUrl(s: RestaurantSettings): string {
  return normalizeBaseUrl(s.public_base_url) ?? window.location.origin
}
