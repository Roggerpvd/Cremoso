// Traduce los códigos de error de la base de datos (RAISE EXCEPTION) y de red a mensajes claros.
const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'No tienes permiso para realizar esta acción.',
  INVALID_TABLE: 'La mesa no es válida o está desactivada. Si usas el QR, escanéalo de nuevo.',
  INVALID_ITEMS: 'El pedido tiene productos o cantidades no válidas.',
  INVALID_REQUEST: 'La solicitud no es válida. Inténtalo de nuevo.',
  INVALID_RANGE: 'El rango de fechas no es válido (máximo 1 año).',
  INVALID_TRANSITION: 'Ese cambio de estado no está permitido.',
  PRODUCT_UNAVAILABLE: 'Algún producto ya no está disponible.',
  QR_DISABLED: 'Los pedidos por QR están desactivados. Pídele al personal.',
  TOO_MANY_PENDING: 'Ya hay varios pedidos de esta mesa esperando. Espera a que cocina los reciba.',
  REQUEST_ID_CONFLICT: 'No se pudo registrar el pedido. Inténtalo de nuevo.',
  ORDER_NOT_FOUND: 'El pedido no existe.',
  ORDER_NOT_EDITABLE: 'Solo se pueden modificar pedidos pendientes y sin pagar.',
  ORDER_NOT_CANCELLABLE: 'Este pedido ya no se puede cancelar (entregado, pagado o cancelado).',
  ORDER_CANCELLED: 'Uno de los pedidos está cancelado.',
  ALREADY_PAID: 'Uno de los pedidos ya está pagado.',
  LAST_ADMIN: 'Debe quedar al menos un administrador activo.',
  USER_NOT_FOUND: 'El usuario no existe.',
  SESSION_REQUIRED: 'Escanea el código QR de tu mesa para poder pedir.',
  SESSION_EXPIRED: 'Tu sesión terminó. Escanea de nuevo el QR de tu mesa para seguir pidiendo.',
  TOO_MANY_REQUESTS: 'Demasiados intentos seguidos. Espera unos minutos o pide ayuda al personal.',
  ORDER_NOT_CONFIRMED: 'Este pedido del QR aún no fue confirmado. Acéptalo primero en Caja.',
  CANNOT_DELETE_SELF: 'No puedes eliminar tu propia cuenta.',
  INVALID_ROLE: 'Escribe un nombre para el puesto (mínimo 2 letras).',
  INVALID_PERMISSION: 'Alguno de los permisos no es válido.',
  ROLE_NOT_FOUND: 'El puesto no existe.',
  SYSTEM_ROLE: 'Este puesto del sistema no se puede modificar ni eliminar.',
  ROLE_IN_USE: 'No se puede eliminar: hay usuarios con este puesto. Cámbiales el puesto primero.',
  INVALID_USERNAME: 'El usuario debe tener de 3 a 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.',
  WEAK_PASSWORD: 'La contraseña debe tener al menos 8 caracteres.',
  USERNAME_TAKEN: 'Ya existe un usuario con ese nombre.',
  CREATE_FAILED: 'No se pudo crear el usuario. Revisa los datos e inténtalo de nuevo.',
  ROLE_ASSIGN_FAILED: 'El usuario se creó pero no se pudo asignar el puesto. Asígnalo desde la lista.',
  FUNCTION_UNREACHABLE: 'No se pudo contactar la función «staff-admin» de Supabase. Casi siempre es porque aún no está publicada: sigue los pasos de docs/USUARIOS_Y_PUESTOS.md (sección «Publicar la función»).',
  FUNCTION_NOT_DEPLOYED: 'Falta publicar la función staff-admin en Supabase (ver docs/USUARIOS_Y_PUESTOS.md).',
  DELETE_FAILED: 'No se pudo eliminar el usuario.',
  UPDATE_FAILED: 'No se pudo actualizar la contraseña.',
  PAYMENT_NOT_FOUND: 'No se encontró el cobro de esta cuenta.',
  DELIVERY_DISABLED: 'El delivery está desactivado. Actívalo en Ajustes.',
  BELOW_MIN_ORDER: 'El pedido no llega al mínimo para delivery. Agrega más productos.',
  INVALID_PHONE: 'El teléfono no es válido (solo números, de 6 a 12 dígitos).',
  INVALID_ADDRESS: 'Escribe la dirección de entrega (mínimo 5 letras).',
  INVALID_FEE: 'El costo de envío debe estar entre 0 y 200.',
  INVALID_CHANGE: 'El monto con el que paga el cliente debe ser mayor o igual al total.',
  NOT_DISPATCHED: 'Primero marca «Salió a entregar» con el repartidor.',
  NOT_DELIVERY: 'Este pedido no es un delivery.',
  ORDER_NOT_READY: 'El pedido aún no está listo en cocina.',
  INVALID_CUSTOMER_NAME: 'Escribe el nombre del cliente (mínimo 2 letras).',
  DOCUMENT_REQUIRED: 'Si el total supera S/ 700, SUNAT exige el documento de identidad del cliente (DNI, CE o pasaporte).',
  INVALID_DOCUMENT: 'El documento de identidad no es válido (DNI: 8 dígitos).',
  AMOUNT_MISMATCH: 'La suma de los montos debe ser igual al total cobrado.',
  RECEIPT_ALREADY_EXISTS: 'Este cobro ya tiene una boleta vigente.',
  RECEIPT_NOT_FOUND: 'La boleta no existe.',
  RECEIPT_NOT_PENDING: 'Esta boleta ya fue registrada como emitida o descartada.',
  RECEIPT_ALREADY_ISSUED: 'Una boleta ya emitida no se descarta aquí: se anula o corrige en SUNAT.',
  INVALID_SUNAT_REF: 'Escribe la serie y el número de la boleta tal como los muestra SUNAT, por ejemplo B001-123.',
  DUPLICATE_SUNAT_REF: 'Esa serie y número ya están registrados en otra boleta.',
}

export class AppError extends Error {
  code: string
  detail?: string
  network: boolean
  constructor(raw: { message?: string; details?: string | null; code?: string } | unknown) {
    const r = (raw ?? {}) as { message?: string; details?: string | null; code?: string }
    const msg = String(r.message ?? raw ?? 'Error')
    super(msg)
    this.code = msg.trim().split(/\s/)[0]
    this.detail = r.details ?? undefined
    this.network = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)
    // 23503 = clave foránea (p. ej. borrar algo con historial)
    if (r.code === '23503') this.code = 'FK_VIOLATION'
    if (r.code === '23505') this.code = 'UNIQUE_VIOLATION'
    if (r.code === '42501' || /row-level security/i.test(msg)) this.code = 'FORBIDDEN'
  }
}

export function errorMessage(e: unknown): string {
  const err = e instanceof AppError ? e : new AppError(e)
  if (err.network) return 'Sin conexión con el servidor. Revisa tu Internet o la red Wi-Fi e inténtalo de nuevo.'
  if (err.code === 'PRODUCT_UNAVAILABLE' && err.detail) return `Ya no está disponible: ${err.detail}.`
  if (err.code === 'UNIQUE_VIOLATION') return 'Ya existe un registro con ese nombre o número.'
  if (err.code === 'FK_VIOLATION') return 'No se puede eliminar porque tiene registros asociados.'
  if (MESSAGES[err.code]) return MESSAGES[err.code]
  if (/invalid login credentials/i.test(err.message)) return 'Usuario o contraseña incorrectos.'
  if (/schema cache|could not find the function/i.test(err.message)) return 'Falta aplicar una actualización de la base de datos (migración pendiente). Revisa el README, sección «Base de datos».'
  return err.message.length > 160 ? 'Ocurrió un error inesperado.' : err.message
}

export const errorCode = (e: unknown) => (e instanceof AppError ? e.code : new AppError(e).code)
