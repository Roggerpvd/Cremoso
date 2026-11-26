// Genera public/images/menu/index.json con los nombres de las imágenes de esa carpeta.
// Se ejecuta solo antes de `npm run dev` y `npm run build` (también: `npm run images`).
// Así, la pantalla Carta puede mostrar una galería para elegir la foto de cada producto.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'menu')
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'])
mkdirSync(dir, { recursive: true })
const files = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isFile() && EXT.has(extname(d.name).toLowerCase()))
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b, 'es'))
writeFileSync(join(dir, 'index.json'), JSON.stringify(files, null, 2) + '\n')
console.log(`Imágenes de la carta: ${files.length} (${dir})`)
