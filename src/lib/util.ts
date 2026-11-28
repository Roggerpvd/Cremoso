// UUID v4 que funciona también en HTTP (red local): crypto.randomUUID() exige HTTPS.
export function uuid(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function money(n: number | null | undefined, symbol = 'S/'): string {
  const v = Number(n ?? 0)
  return `${symbol} ${v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const timeHM = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'

export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))

export function elapsedLabel(iso: string, now = Date.now()): string {
  const m = minutesSince(iso, now)
  if (m < 1) return 'ahora'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export const tableLabel = (t: { number: number; name: string | null } | null | undefined) =>
  t ? `Mesa ${t.number}${t.name ? ` · ${t.name}` : ''}` : 'Sin mesa'

/** Dónde va un pedido: «Mesa 5», «Sin mesa» o «Delivery · Nombre del cliente». */
export const orderPlace = (o: { order_kind?: string; delivery_name?: string | null; tables?: { number: number; name: string | null } | null }) =>
  o.order_kind === 'delivery' ? `Delivery${o.delivery_name ? ` · ${o.delivery_name}` : ''}` : tableLabel(o.tables)

/** Teléfono peruano legible: 987654321 → 987 654 321 */
export const phonePretty = (p: string | null | undefined) => (p ?? '').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

export const todayISO = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Copiar al portapapeles también en HTTP (navigator.clipboard exige HTTPS)
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* cae al método clásico */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  return ok
}

let audioCtx: AudioContext | null = null
export function unlockAudio() {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch { /* sin audio */ }
}
export function beep(times = 2) {
  try {
    audioCtx ??= new AudioContext()
    const ctx = audioCtx
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = i % 2 === 0 ? 880 : 660
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25)
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + i * 0.25 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.22)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.25)
      o.stop(ctx.currentTime + i * 0.25 + 0.24)
    }
  } catch { /* sin audio */ }
}
