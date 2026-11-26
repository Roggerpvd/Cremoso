/**
 * La app instalable (manifest + ícono de pantalla de inicio) es SOLO para el personal.
 * Por eso el index.html NO declara el manifest: se agrega aquí cuando se abre una pantalla del personal.
 * Las páginas del cliente (/m, /menu) nunca lo agregan, así que el navegador no les ofrece instalar la app.
 */
export function enableStaffInstall() {
  if (typeof document === 'undefined' || document.querySelector('link[rel="manifest"]')) return
  const m = document.createElement('link')
  m.rel = 'manifest'; m.href = '/manifest.webmanifest'
  document.head.appendChild(m)
  const a = document.createElement('link')
  a.rel = 'apple-touch-icon'; a.href = '/apple-touch-icon.png'
  document.head.appendChild(a)
}
