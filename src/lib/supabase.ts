import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/**
 * Almacenamiento de la sesión.
 *  · Por defecto la sesión vive en la PESTAÑA (sessionStorage): así el administrador puede tener su sesión abierta
 *    en una pestaña y cocina entrar en otra del mismo navegador sin pisarse. Al recargar la página se conserva;
 *    al cerrar la pestaña se cierra la sesión.
 *  · Si en el login se marca "Mantener sesión en este equipo", se guarda en localStorage (sobrevive a cerrar el
 *    navegador). Úsalo solo en equipos dedicados a un único puesto (p. ej. la tableta de cocina).
 */
const PERSIST_FLAG = 'restopos.persist'
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn() } catch { return fallback } }

export const setPersistSession = (persist: boolean) =>
  safe(() => (persist ? sessionStorage.setItem(PERSIST_FLAG, '1') : sessionStorage.removeItem(PERSIST_FLAG)), undefined)

const storage = {
  getItem: (k: string) => safe(() => sessionStorage.getItem(k) ?? localStorage.getItem(k), null),
  setItem: (k: string, v: string) => safe(() => {
    if (sessionStorage.getItem(PERSIST_FLAG) === '1') { localStorage.setItem(k, v); sessionStorage.removeItem(k) }
    else { sessionStorage.setItem(k, v); localStorage.removeItem(k) }
  }, undefined),
  removeItem: (k: string) => safe(() => { sessionStorage.removeItem(k); localStorage.removeItem(k) }, undefined),
}

// Un único cliente para toda la app. Si falta la configuración se usa un valor
// de relleno para no romper la carga; App.tsx muestra la pantalla de ayuda.
export const supabase = createClient(
  SUPABASE_URL || 'http://localhost:54321',
  SUPABASE_ANON_KEY || 'sin-configurar',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage },
    realtime: { params: { eventsPerSecond: 10 } },
  },
)
