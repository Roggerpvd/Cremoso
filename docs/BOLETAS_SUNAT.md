# Ticket y boleta de venta electrónica (SUNAT)

## Qué hace el sistema y qué NO hace
| | Ticket | Boleta |
|---|---|---|
| Qué es | Documento **interno** con todos los datos de consumo (negocio, mesa, pedidos, hora, canal, ítems con observaciones, descuentos, impuesto, total, forma de pago). | Comprobante de pago **oficial** de SUNAT. |
| Quién lo genera | El sistema (impresión de 80 mm). | **SUNAT** (SEE-SOL, gratuito, con tu RUC y Clave SOL). |
| Qué guarda/prepara el sistema | — | **Nombre del cliente, Producto, Cantidad y Monto en soles** (más documento si corresponde), y la **serie-número** que SUNAT devuelve (p. ej. `B001-123`). |
| Válido ante SUNAT | **No.** Aunque al pie diga «Comprobante», es un documento interno del sistema. | Sí, la que emite SUNAT (o un PSE/OSE autorizado) con serie-número. |

**El sistema NO emite la boleta por sí mismo ni se conecta a SUNAT.** No existe en este entorno una herramienta `/emitir-factura-boleta-sunat`, y emitir de forma automática exige credenciales y un servicio que solo tú puedes contratar o activar (ver "Emisión automática" abajo). La Clave SOL **jamás** se escribe en este sistema.

## Flujo
1. Cobra la cuenta en **Caja** (Cuentas por mesa → Cobrar).
2. Entra a **Comprobantes**, elige la fecha y el cobro.
3. **Ticket**: pulsa *Ticket* → se abre la impresión (impresora térmica de 80 mm o cualquier impresora).
4. **Boleta**: pulsa *Boleta* → escribe el **nombre del cliente**; revisa **producto, cantidad y monto** (vienen precargados; puedes consolidar en una línea "Consumo en restaurante"); *Guardar datos*.
5. Emite la boleta en SUNAT (portal SOL → Comprobantes de pago → SEE-SOL → Boleta de Venta Electrónica, o la app Emprender SUNAT) copiando los datos con *Copiar datos* o imprimiendo la *hoja de datos*.
6. Vuelve y escribe la **serie-número** (`B001-123`) en *Registrar emitida*. Queda enlazada al cobro y el ticket la muestra.

## Reglas que aplica el sistema
- Con total **hasta S/ 700.00** basta el **nombre** del cliente (el documento es opcional). Con total **mayor a S/ 700.00** el sistema **exige tipo y número de documento** (DNI de 8 dígitos, CE o pasaporte); solo el nombre no es suficiente. Ver fuentes en la respuesta de entrega.
- La suma de los montos de las líneas debe ser **igual** al total cobrado (se valida en el servidor).
- Un cobro tiene **una sola** boleta vigente. Si te equivocaste **antes** de emitir, *Descartar y corregir*. Una boleta **ya emitida** se corrige o anula **en SUNAT**, no aquí.
- La serie debe empezar con **B** (las facturas usan F y no se manejan en este sistema).
- Pueden usarlo solo roles con permiso `payments.register` (admin y caja).

## Antes de emitir (lo que debes tener tú)
RUC activo y habido, Clave SOL, y la configuración de emisor electrónico que SUNAT exija a tu régimen. Consulta con tu contador qué comprobantes te corresponden según tu régimen tributario.

## Emisión automática (opcional, no incluida)
Para que el sistema emita sin que entres al portal SUNAT, hay que integrar un **Proveedor de Servicios Electrónicos (PSE)/OSE** o firmar XML con tu certificado digital y enviarlo a SUNAT. Eso requiere cuentas, credenciales y, normalmente, un plan de pago del proveedor, lo que contradice la restricción de costo cero. Si lo quieres: dime qué proveedor usarás y reviso sus condiciones; el diseño actual (tabla `receipts` + funciones `register_boleta`/`mark_boleta_issued`) está pensado para que ese paso solo reemplace el "emitir manualmente".

## Datos del negocio
En **Ajustes** completa razón social, **RUC (11 dígitos)**, dirección y teléfono: aparecen en el encabezado del ticket y de la hoja de datos.


## Emisión asistida por agente de navegador
Ver `docs/EMISION_CON_AGENTE.md` (opcional, supervisada: el dueño presiona Emitir).
