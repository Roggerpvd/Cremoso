import type { Order, OrderStatus } from '../lib/types'

type Can = (...perms: string[]) => boolean
export interface Action { to: OrderStatus; label: string }

/** Siguiente paso del flujo según permisos (misma matriz que valida la base de datos). */
export function nextAction(o: Order, can: Can): Action | null {
  if (o.status === 'pending' && can('orders.kitchen')) return { to: 'preparing', label: 'Iniciar preparación' }
  if (o.status === 'preparing' && can('orders.kitchen')) return { to: 'ready', label: 'Marcar listo' }
  if (o.status === 'ready') {
    // Un delivery sale con el repartidor (pantalla Delivery) y luego se marca entregado con orders.delivery
    if (o.order_kind === 'delivery') return o.dispatched_at && can('orders.delivery') ? { to: 'delivered', label: 'Marcar como entregado' } : null
    if (can('orders.serve')) return { to: 'delivered', label: 'Marcar como entregado' }
  }
  return null
}

export function undoAction(o: Order, can: Can): Action | null {
  if (o.status === 'preparing' && can('orders.kitchen')) return { to: 'pending', label: 'Volver a pendiente' }
  if (o.status === 'ready' && can('orders.kitchen')) return { to: 'preparing', label: 'Volver a preparación' }
  if (o.status === 'delivered' && can(o.order_kind === 'delivery' ? 'orders.delivery' : 'orders.serve')) return { to: 'ready', label: 'Reabrir' }
  return null
}
