import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

/* Selector de fecha propio (reemplaza al <input type="date"> del navegador).
   · Fechas en formato ISO "AAAA-MM-DD" (hora local; Perú no usa horario de verano).
   · Teclado: flechas = ±1 día / ±1 semana, AvPág/RePág = mes, Inicio/Fin = semana, Esc = cerrar.
   · `range` sombrea los días entre dos fechas (para rangos con dos selectores). */

const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const pad = (n: number) => String(n).padStart(2, '0')
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12) }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d: Date, n: number) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1, 12); return x }
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const monthLabel = (d: Date) => cap(new Intl.DateTimeFormat('es-PE', { month: 'long' }).format(d)) + ' ' + d.getFullYear()
const shortLabel = (s: string) => new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(parse(s))

interface Props {
  value: string
  onChange: (iso: string) => void
  min?: string
  max?: string
  range?: [string, string]
  id?: string
}

export function DatePicker({ value, onChange, min, max, range, id }: Props) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => parse(value))     // mes visible
  const [focus, setFocus] = useState(value)                // día con foco de teclado
  const [dir, setDir] = useState<'next' | 'prev'>('next')
  const [align, setAlign] = useState<'left' | 'right'>('left')
  const root = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const today = toISO(new Date())

  const disabled = useCallback((iso: string) => (!!min && iso < min) || (!!max && iso > max), [min, max])

  const openIt = () => { setView(parse(value)); setFocus(value); setOpen(true) }
  const close = useCallback(() => setOpen(false), [])

  // Alinea el panel para que no se salga de la pantalla
  useLayoutEffect(() => {
    if (!open || !root.current) return
    const r = root.current.getBoundingClientRect()
    setAlign(r.left + 304 > window.innerWidth - 8 ? 'right' : 'left')
  }, [open])

  // Cierra al hacer clic fuera o con Esc
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) close() }
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { close(); root.current?.querySelector<HTMLButtonElement>('[data-trigger]')?.focus() } }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, close])

  // Lleva el foco al día activo
  useEffect(() => {
    if (!open) return
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus({ preventScroll: true })
  }, [open, focus, view])

  const go = (n: number) => { setDir(n > 0 ? 'next' : 'prev'); setView((v) => addMonths(v, n)) }
  const pick = (iso: string) => { if (disabled(iso)) return; onChange(iso); close(); root.current?.querySelector<HTMLButtonElement>('[data-trigger]')?.focus() }

  const moveFocus = (iso: string) => {
    if (disabled(iso)) return
    const d = parse(iso)
    if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) { setDir(d > view ? 'next' : 'prev'); setView(new Date(d.getFullYear(), d.getMonth(), 1, 12)) }
    setFocus(iso)
  }
  const onKey = (e: KeyboardEvent) => {
    const d = parse(focus)
    const map: Record<string, Date> = {
      ArrowLeft: addDays(d, -1), ArrowRight: addDays(d, 1), ArrowUp: addDays(d, -7), ArrowDown: addDays(d, 7),
      PageUp: new Date(d.getFullYear(), d.getMonth() - 1, d.getDate(), 12), PageDown: new Date(d.getFullYear(), d.getMonth() + 1, d.getDate(), 12),
      Home: addDays(d, -((d.getDay() + 6) % 7)), End: addDays(d, 6 - ((d.getDay() + 6) % 7)),
    }
    if (map[e.key]) { e.preventDefault(); moveFocus(toISO(map[e.key])) }
  }

  // 6 semanas, empezando en lunes
  const first = new Date(view.getFullYear(), view.getMonth(), 1, 12)
  const start = addDays(first, -((first.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const inRange = (iso: string) => !!range && iso >= range[0] && iso <= range[1]

  const quick = (label: string, iso: string) => (
    <button type="button" className="chip !px-3 !py-1 !text-xs" disabled={disabled(iso)} onClick={() => pick(iso)}>{label}</button>
  )

  return (
    <div ref={root} className="relative">
      <button id={id} type="button" data-trigger aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : openIt())}
        className="input flex items-center justify-between gap-2 text-left">
        <span>{cap(shortLabel(value))}</span>
        <CalendarDays size={16} className="shrink-0 text-brand-600" />
      </button>

      {open && (
        <div role="dialog" aria-label="Elegir fecha" data-align={align}
          className={`pop card absolute z-40 mt-2 w-[19rem] max-w-[calc(100vw-1rem)] !bg-white p-3 shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => go(-1)} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
            <div className="text-sm font-semibold" aria-live="polite">{monthLabel(view)}</div>
            <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => go(1)} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-400">{DOW.map((d, i) => <div key={i} className="py-1">{d}</div>)}</div>
          <div ref={grid} key={`${view.getFullYear()}-${view.getMonth()}`} onKeyDown={onKey} role="grid" className={`grid grid-cols-7 gap-y-0.5 ${dir === 'next' ? 'cal-next' : 'cal-prev'}`}>
            {days.map((d) => {
              const iso = toISO(d)
              const outside = d.getMonth() !== view.getMonth()
              const sel = iso === value, isToday = iso === today, dis = disabled(iso), rng = inRange(iso) && !sel
              return (
                <button key={iso} type="button" role="gridcell" data-date={iso} disabled={dis} tabIndex={iso === focus ? 0 : -1}
                  aria-selected={sel} aria-current={isToday ? 'date' : undefined} onClick={() => pick(iso)}
                  className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm transition-[transform,background-color,color] duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30
                    ${sel ? 'bg-brand-600 font-semibold text-white shadow-[0_6px_12px_-6px_rgba(40,69,97,.8)]'
                      : rng ? 'bg-brand-100 text-brand-800'
                      : outside ? 'text-slate-300 hover:bg-white/70' : 'text-slate-700 hover:bg-white/80'}
                    ${isToday && !sel ? 'ring-1 ring-brand-400' : ''}`}>
                  {d.getDate()}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-slate-200/60 pt-2">
            {quick('Hoy', today)}
            {quick('Ayer', toISO(addDays(new Date(), -1)))}
          </div>
        </div>
      )}
    </div>
  )
}
