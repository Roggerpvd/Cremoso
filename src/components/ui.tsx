import { useEffect, type ReactNode } from 'react'
import { Loader2, Wifi, WifiOff, X, QrCode, Utensils } from 'lucide-react'
import type { OrderChannel, OrderStatus } from '../lib/types'
import { STATUS_LABEL } from '../lib/types'
import type { Conn } from '../hooks/useOrders'

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  preparing: 'bg-sky-100 text-sky-800',
  ready: 'bg-emerald-100 text-emerald-800',
  delivered: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-red-100 text-red-700',
}
export const StatusBadge = ({ status }: { status: OrderStatus }) => (
  <span className={`badge ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
)

export const ChannelBadge = ({ channel }: { channel: OrderChannel }) =>
  channel === 'qr'
    ? <span className="badge bg-violet-100 text-violet-700"><QrCode size={12} /> QR</span>
    : <span className="badge bg-slate-100 text-slate-600"><Utensils size={12} /> Interno</span>

export const Spinner = ({ className = '' }: { className?: string }) => <Loader2 className={`animate-spin ${className}`} size={20} />

export const Loading = ({ text = 'Cargando…' }: { text?: string }) => (
  <div className="flex items-center justify-center gap-2 p-10 text-slate-500"><Spinner /> {text}</div>
)

export const ErrorBox = ({ text, onRetry }: { text: string; onRetry?: () => void }) => (
  <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
    {text}
    {onRetry && <button className="btn btn-secondary btn-sm ml-3" onClick={onRetry}>Reintentar</button>}
  </div>
)

export const ConnectionPill = ({ conn, dark = false }: { conn: Conn; dark?: boolean }) => {
  const map = {
    online: ['bg-emerald-500', 'En vivo', Wifi],
    connecting: ['bg-amber-500', 'Conectando…', Wifi],
    offline: ['bg-red-500', 'Sin conexión · reintentando', WifiOff],
  } as const
  const [dot, label, Icon] = map[conn]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${dark ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'}`}>
      <span className={`h-2 w-2 rounded-full ${dot} ${conn === 'online' ? '' : 'animate-pulse'}`} />
      <Icon size={13} /> {label}
    </span>
  )
}

export function Modal({ title, onClose, children, wide = false, footer }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <div>
    <label className="label">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
)

export const Toggle = ({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) => (
  <label className={`inline-flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
    {label}
  </label>
)

export const Empty = ({ text }: { text: string }) => <div className="p-10 text-center text-sm text-slate-400">{text}</div>

/** Logotipo RestoPOS (cubiertos sobre azul acero). Coincide con public/favicon.svg. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="rp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b93c2" /><stop offset="1" stopColor="#2f5578" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#rp-g)" />
      <path d="M20 14v14a6 6 0 0 0 4 5.6V50h4V33.6A6 6 0 0 0 32 28V14h-3v10h-2V14h-3v10h-2V14zM42 14c-4 0-7 5-7 11 0 4 2 6 4 7v18h4V14z" fill="#fff" />
    </svg>
  )
}
