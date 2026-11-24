# Límites y condiciones de los planes gratuitos

**Fecha de verificación: 2026-11-21 (pausa y Vercel reverificados el 2026-11-23).** Los proveedores cambian sus planes sin previo aviso: confirma en sus páginas oficiales antes de contratar o desplegar.

## Conclusión honesta
El sistema **puede operar sin pagar** con los planes gratuitos para un restaurante pequeño o mediano, pero **no se puede afirmar que sea "100% gratis para siempre"**: existen límites de uso, un mecanismo de pausa por inactividad, ausencia de respaldos automáticos y términos que el proveedor puede modificar. Si se superan los límites, el servicio se restringe o se debe pasar a un plan de pago.

## Supabase Free (base de datos, Auth, Realtime, Storage)
| Recurso | Límite Free | Observación para este sistema |
|---|---|---|
| Base de datos | 500 MB | Un pedido con 4 ítems pesa unos pocos KB: miles de pedidos caben. Vigila el crecimiento. |
| Storage (fotos) | 1 GB | Las fotos se comprimen en el navegador (WebP 640 px, ~30–80 KB). |
| Egress (transferencia) | 5 GB + 5 GB en caché | Fotos con cache de 1 año y carga diferida; el QR consulta cada 15 s. |
| Usuarios activos (MAU) | 50 000 | El personal usa Auth; los clientes QR no necesitan cuenta. |
| Realtime | 200 conexiones simultáneas y 100 mensajes/s (página de límites); 2 M mensajes/mes (página de precios) | Solo el personal usa Realtime; los clientes QR usan consultas periódicas para no gastar conexiones. |
| Proyectos activos | 2 | |
| **Inactividad** | **El proyecto se pausa tras ~7 días sin actividad** | Se considera inactivo si recibe poca actividad de base de datos en una semana. Se restaura desde el panel; la documentación indica una ventana de restauración de 1 año (confírmala, puede cambiar). |
| **Respaldos** | **No incluye respaldos automáticos** | Usa `npm run backup` o `supabase db dump`. |
| Soporte | Comunitario | Sin SLA. |

## Hosting del front-end
| Servicio | Plan gratuito | Idoneidad |
|---|---|---|
| **Cloudflare Pages** | Ancho de banda ilimitado, 500 compilaciones/mes, uso comercial permitido | **Recomendado.** |
| Netlify Free | Modelo por créditos (300/mes): cada deploy ≈ 15 créditos y ≈ 10 créditos por GB; al agotarse el sitio se suspende | Válido con pocos deploys; el riesgo es quedarse sin créditos. |
| Vercel Hobby | Solo uso **no comercial** | **No apto** para un restaurante. |
| GitHub | Repos y Actions gratis con cuota | Opcional (keepalive y control de versiones). |

## Otros costos o condiciones potenciales
- **Dominio propio:** no es gratuito. Sin dominio funciona con el subdominio gratuito del hosting (`*.pages.dev`, `*.netlify.app`).
- **Impresión de QR y tickets:** papel/tinta a cargo del restaurante.
- **Instalación local:** requiere una PC encendida en el local (electricidad, mantenimiento, respaldos propios). Docker Desktop tiene condiciones de licencia para empresas grandes; en Linux se usa Docker Engine.
- **Dependencias:** React, Vite, Tailwind, Supabase JS, qrcode.react y lucide-react son de código abierto (MIT/ISC/Apache-2.0). No se usa ninguna API de pago.
- **Boleta electrónica SUNAT:** el sistema no la emite; se emite en SEE-SOL (gratuito, requiere RUC habido y Clave SOL). La emisión automática vía proveedor autorizado (PSE/OSE) suele tener costo y no está incluida. Un certificado digital tributario gratuito de SUNAT solo está disponible si se cumplen sus requisitos.
- **Cambios de términos:** cualquier proveedor puede reducir límites o cambiar el plan gratuito.

## Estimación orientada (no garantía)
Un local con 40 pedidos/día × 30 días ≈ 1 200 pedidos/mes: base de datos y Realtime quedan muy por debajo de los límites. El factor que más puede acercarse al límite es el **egress** si se suben fotos pesadas o hay mucho tráfico QR; por eso las imágenes se comprimen y se cachean.

## Señales para pasar a un plan superior
Base de datos > ~400 MB · Realtime cerca de 200 conexiones o 2 M mensajes/mes · necesitas respaldos automáticos/PITR · no toleras la pausa por inactividad. Ver `MIGRACION_A_PLAN_SUPERIOR.md`.

## Fuentes (consultadas entre el 2026-11-21 y el 2026-11-23)
- Supabase — precios y límites del plan Free: https://supabase.com/pricing
- Supabase — límites de Realtime: https://supabase.com/docs/guides/realtime/limits
- Supabase — pausa de proyectos Free: https://supabase.com/docs/guides/platform/free-project-pausing
- Netlify — precios y créditos: https://www.netlify.com/pricing/
- Cloudflare Pages — límites: https://developers.cloudflare.com/pages/platform/limits/
- Vercel — Hobby solo uso personal/no comercial: https://vercel.com/docs/limits/fair-use-guidelines y https://vercel.com/terms
