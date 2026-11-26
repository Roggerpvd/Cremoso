import { STORAGE_BUCKET } from './config'
import { supabase } from './supabase'
import { uuid } from './util'

// Reduce y comprime la foto en el navegador (≈ 30-80 KB) para cuidar el 1 GB de
// Storage y los 5 GB de transferencia mensual del plan gratuito.
export async function compressImage(file: File, maxSide = 640, quality = 0.8): Promise<{ blob: Blob; ext: string; mime: string }> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tu navegador no puede procesar la imagen.')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const toBlob = (mime: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality))
  let blob = await toBlob('image/webp')
  let mime = 'image/webp'
  let ext = 'webp'
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob('image/jpeg')
    mime = 'image/jpeg'
    ext = 'jpg'
  }
  if (!blob) throw new Error('No se pudo comprimir la imagen.')
  return { blob, ext, mime }
}

export async function uploadProductImage(file: File): Promise<string> {
  const { blob, ext, mime } = await compressImage(file)
  const path = `products/${uuid()}.${ext}`
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
    contentType: mime,
    cacheControl: '31536000', // nombre único → se puede cachear 1 año (menos transferencia)
    upsert: false,
  })
  if (error) throw error
  return path
}

/** Carpeta de imágenes que viaja con el sistema (public/images/menu). Sus archivos se publican tal cual. */
export const LOCAL_IMAGE_DIR = '/images/menu'
export const isLocalImage = (path: string | null | undefined) => !!path && path.startsWith('/')

/** Nombres de archivo de public/images/menu (la lista la genera scripts/gen-image-index.mjs). */
export async function listLocalImages(): Promise<string[]> {
  try {
    const r = await fetch(`${LOCAL_IMAGE_DIR}/index.json`, { cache: 'no-cache' })
    if (!r.ok) return []
    const j = await r.json()
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

export async function removeProductImage(path: string | null | undefined) {
  if (!path || path.startsWith('http') || isLocalImage(path)) return   // solo se borran las subidas a Supabase Storage
  await supabase.storage.from(STORAGE_BUCKET).remove([path]) // mejor esfuerzo
}

export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.startsWith('http') || isLocalImage(path)) return path   // URL externa o archivo de public/images/menu
  return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
