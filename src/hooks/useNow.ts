import { useEffect, useState } from 'react'
/** Reloj que se actualiza cada `ms` (para "hace 5 min"). */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}
