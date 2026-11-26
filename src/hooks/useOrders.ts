import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { AppError } from '../lib/errors'
import type { Order, OrderStatus } from '../lib/types'

export type Conn = 'connecting' | 'online' | 'offline'
const SELECT = '*, order_items(*), tables(number,name)'

interface Options {
  onNew?: (o: Order) => void        // llegó un pedido pendiente nuevo YA CONFIRMADO (para el sonido de cocina)
  onAwaiting?: (o: Order) => void   // llegó un pedido del QR que espera confirmación de Caja
  onCancelled?: (o: Order) => void  // un pedido visible fue cancelado
}

/**
 * Pedidos "vivos" sincronizados en tiempo real.
 *  · Carga inicial + suscripción Realtime a `orders` (solo esa tabla: ahorra mensajes).
 *  · Ante cada evento relee el pedido completo con sus ítems (una consulta ligera, en lote).
 *  · Si el WebSocket cae: indicador "sin conexión", sondeo de respaldo cada 20 s y recarga completa al reconectar.
 */
export function useOrders(opts: Options = {}) {
  const [orders, setOrders] = useState<Order[]>([])
  const [awaiting, setAwaiting] = useState<Order[]>([])
  const [conn, setConn] = useState<Conn>('connecting')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const map = useRef(new Map<string, Order>())
  const ready = useRef(false)
  const cb = useRef(opts)
  cb.current = opts
  const pendingIds = useRef(new Set<string>())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publish = useCallback(() => {
    const all = [...map.current.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
    setOrders(all.filter((o) => o.is_confirmed !== false))    // cocina, cuentas y seguimiento solo ven pedidos confirmados
    setAwaiting(all.filter((o) => o.is_confirmed === false))  // Caja los acepta o rechaza
  }, [])

  const merge = useCallback((incoming: Order[], replaceAll: boolean) => {
    const prev = map.current
    const next = replaceAll ? new Map<string, Order>() : new Map(prev)
    for (const o of incoming) {
      const old = prev.get(o.id)
      if (o.status === 'cancelled') {
        next.delete(o.id)
        if (old && old.status !== 'cancelled' && old.is_confirmed !== false) cb.current.onCancelled?.(o)
        continue
      }
      const wasVisible = !!old && old.is_confirmed !== false
      if (ready.current && o.status === 'pending' && o.is_confirmed !== false && !wasVisible) cb.current.onNew?.(o)
      if (ready.current && o.status === 'pending' && o.is_confirmed === false && !old) cb.current.onAwaiting?.(o)
      next.set(o.id, o)
    }
    map.current = next
    publish()
  }, [publish])

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 36 * 3600e3).toISOString()
    const recent = new Date(Date.now() - 2 * 3600e3).toISOString()
    const { data, error: err } = await supabase.from('orders').select(SELECT)
      .gte('created_at', since)
      .neq('status', 'cancelled')
      .or(`status.in.(pending,preparing,ready),payment_status.eq.unpaid,delivered_at.gte.${recent},paid_at.gte.${recent}`)
      .order('created_at', { ascending: true })
      .limit(300)
    if (err) { setError(new AppError(err).message); setLoading(false); return }
    setError(null)
    merge((data ?? []) as Order[], true)
    ready.current = true
    setLoading(false)
  }, [merge])

  const flush = useCallback(async () => {
    const ids = [...pendingIds.current]
    pendingIds.current.clear()
    flushTimer.current = null
    if (!ids.length) return
    const { data, error: err } = await supabase.from('orders').select(SELECT).in('id', ids)
    if (err) { void load(); return }
    merge((data ?? []) as Order[], false)
  }, [load, merge])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel(`orders-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (p) => {
        const id = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id
        if (!id) return
        pendingIds.current.add(id)
        if (!flushTimer.current) flushTimer.current = setTimeout(() => void flush(), 150)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { setConn('online'); void load() }       // al (re)conectar: recarga completa
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConn('offline')
      })

    const poll = setInterval(() => { if (!document.hidden) void load() }, 20000) // red de seguridad (WebSocket "dormido")
    const onVisible = () => { if (!document.hidden) void load() }
    const onOnline = () => void load()
    const onOffline = () => setConn('offline')
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      clearInterval(poll)
      if (flushTimer.current) clearTimeout(flushTimer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      void supabase.removeChannel(ch)
    }
  }, [load, flush])

  /** Cambia el estado con actualización optimista; si falla, vuelve a cargar y relanza el error. */
  const changeStatus = useCallback(async (id: string, status: OrderStatus) => {
    const cur = map.current.get(id)
    if (cur) { map.current.set(id, { ...cur, status }); publish() }
    try {
      await api.setOrderStatus(id, status)
    } catch (e) {
      void load()
      throw e
    }
  }, [load, publish])

  return { orders, awaiting, conn, loading, error, reload: load, changeStatus }
}
