# Diseño y movimiento

Guía de lo aplicado a la interfaz y de dónde sale. Las tres referencias son repositorios públicos de GitHub; se leyeron sus reglas y se aplicó lo que corresponde a una **aplicación de trabajo** (caja y cocina), no a una página de marketing.

| Referencia | Licencia | Qué se tomó |
|---|---|---|
| Emil Kowalski, `emilkowalski/skills` (`emil-design-eng`) | MIT | Curvas ease-out fuertes, duraciones cortas, `scale(.97)` al presionar, entradas desde `scale(.96)` (nunca 0), solo transform/opacity, sin `transition: all`, transiciones en vez de keyframes para lo interrumpible, popover con origen en su disparador |
| `pbakaus/impeccable` | Apache 2.0 | Modo «Operate»: la velocidad y la claridad pesan más que la expresión; sin coreografías largas; estados (hover, foco, carga, vacío); números tabulares; selección, foco y barras de desplazamiento con la paleta; evitar tarjetas anidadas y barras laterales decorativas |
| `Leonxlnx/taste-skill` | MIT | Microinteracciones: el elemento tocable sube 2 px al pasar el cursor, los botones se hunden al presionar, jerarquía tipográfica. Está pensada para sitios de marketing, así que **no** se aplicó lo de fotografías, secciones por pantalla ni efectos |

## Valores usados (`src/index.css`)
- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` · `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` · `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`
- Presión de botones y fichas: 140–160 ms · hover: 160–200 ms · diálogos: 260 ms (salida 150 ms) · avisos: 320 ms · calendario: 180 ms · indicador del menú: 320 ms
- Entradas de lista: escalonado de 28 ms con tope de 8 elementos (`.stagger`); una sola entrada por pantalla (`.page-enter`, 240 ms)
- Todo se desactiva con `prefers-reduced-motion`

## Legibilidad (tipografía, espaciado y contraste)
- **Base de 17 px** (`html { font-size: 106.25% }`): `text-sm` ≈ 16 px para el cuerpo y `text-xs` ≈ 13,6 px para lo secundario (nada por debajo). Interlineado 1,5–1,6, sin tracking negativo en el texto corriente.
- **Contraste:** los textos secundarios pasaron de `slate-400/500` a `slate-500/600`, y los colores de estado a la gama 700. Se midió con axe-core (WCAG AA): 0 textos con poco contraste en todas las pantallas (`AXE=1 python3 tests/ui-smoke/smoke.py`).
- **Espaciado:** botones y campos de al menos 40 px de alto, más aire interno en chips, etiquetas y fichas.
- **Menú superior:** en pantallas menores de 1536 px solo la pantalla activa muestra su nombre; el resto son íconos con su nombre al pasar el cursor.

## Componentes
- **Calendario** (`DatePicker.tsx`): primera semana en lunes, hoy marcado, rango sombreado en Reportes, teclado (flechas, AvPág/RePág, Inicio/Fin, Esc), atajos «Hoy» y «Ayer».
- **Menú superior:** el indicador azul desliza entre pantallas.
- **Carga:** esqueletos en lugar de un spinner.
- **Estilo:** Inter variable, vidrio (glassmorphism) en tarjetas y diálogos, relieve (neumorfismo) en campos, botones y chips.

## Cómo cambiarlo
El color principal está en `@theme` (`--color-brand-*`). Las duraciones y curvas, en las variables de `:root`.
