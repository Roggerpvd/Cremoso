import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, MenuProduct } from '../lib/types'

/** Carta pública (categorías activas + productos con precio final). Opcionalmente escucha cambios de stock en vivo. */
export function useMenu(live = false) {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<MenuProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('menu_products').select('*').order('sort_order').order('name'),
    ])
    if (c.error || p.error) { setError((c.error ?? p.error)!.message); setLoading(false); return }
    setError(null)
    setCategories((c.data ?? []) as Category[])
    setProducts(((p.data ?? []) as MenuProduct[]).map((x) => ({ ...x, price: Number(x.price), final_price: Number(x.final_price) })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    if (!live) return
    const ch = supabase.channel(`menu-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void load(), 400)
      })
      .subscribe()
    return () => { if (timer.current) clearTimeout(timer.current); void supabase.removeChannel(ch) }
  }, [live, load])

  return { categories, products, loading, error, reload: load }
}
