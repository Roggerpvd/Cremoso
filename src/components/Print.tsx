import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Impresión sin dependencias: el contenido se monta en #print-root (oculto en pantalla) y se llama a window.print().
// Las reglas @media print de index.css ocultan todo lo demás.
let current: ReactNode = null
const subs = new Set<() => void>()

export function printNode(node: ReactNode) {
  current = node
  subs.forEach((f) => f())
}

export function PrintHost() {
  const [node, setNode] = useState<ReactNode>(null)
  useEffect(() => {
    const f = () => setNode(current)
    subs.add(f)
    return () => { subs.delete(f) }
  }, [])
  useEffect(() => {
    if (!node) return
    const done = () => { current = null; setNode(null) }
    const t = setTimeout(() => { window.print() }, 120)
    window.addEventListener('afterprint', done, { once: true })
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [node])
  return node ? createPortal(<div id="print-root" className="print-area">{node}</div>, document.body) : null
}
