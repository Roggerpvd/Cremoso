// Configuración en tiempo de ejecución (public/config.js) con respaldo en variables VITE_* (.env)
declare global {
  interface Window {
    __APP_CONFIG__?: { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; STAFF_EMAIL_DOMAIN?: string }
  }
}

const rt = typeof window !== 'undefined' ? (window.__APP_CONFIG__ ?? {}) : {}

export const SUPABASE_URL: string = (rt.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '').trim()
export const SUPABASE_ANON_KEY: string = (rt.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
export const STORAGE_BUCKET = 'product-images'

// Dominio interno con el que se convierte un "usuario" en el correo que exige Supabase Auth
// (p. ej. "maria" → maria@restopos.local). No se envían correos a esa dirección.
// Debe coincidir con el secreto STAFF_EMAIL_DOMAIN de la Edge Function staff-admin.
export const STAFF_EMAIL_DOMAIN: string = (rt.STAFF_EMAIL_DOMAIN || import.meta.env.VITE_STAFF_EMAIL_DOMAIN || 'restopos.local').trim().toLowerCase()

/** "maria" → "maria@restopos.local"; si ya es un correo (tiene @) se deja igual. */
export const identifierToEmail = (id: string): string => {
  const v = id.trim()
  return v.includes('@') ? v : `${v.toLowerCase()}@${STAFF_EMAIL_DOMAIN}`
}
/** Lo contrario, para mostrar: "maria@restopos.local" → "maria". */
export const emailToUsername = (email: string | null | undefined): string => {
  if (!email) return ''
  return email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`) ? email.slice(0, email.lastIndexOf('@')) : email
}
