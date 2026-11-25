import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'

type Kind = 'ok' | 'error' | 'info'
interface ToastItem { id: number; text: string; kind: Kind }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, kind: Kind = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x.slice(-3), { id, text, kind }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 print:hidden">
        {items.map((t) => (
          <div key={t.id}
            className={`toast pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl px-4 py-3 text-sm text-white shadow-[0_16px_32px_-12px_rgba(15,23,42,.45)] ${
              t.kind === 'error' ? 'bg-red-600' : t.kind === 'info' ? 'bg-slate-700' : 'bg-emerald-600'}`}>
            {t.kind === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <Check size={18} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Cerrar"><X size={16} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
