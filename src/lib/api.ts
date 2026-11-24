import { AppError } from './errors'
import { supabase } from './supabase'
import type {
  BoletaLine, DocType, PaymentMethod, OrderStatus, Profile, PublicOrder, SalesReport, TableInfo,
} from './types'

export interface LineInput { product_id: string; quantity: number; notes?: string }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw new AppError(error)
    return data as T
  } catch (e) {
    throw e instanceof AppError ? e : new AppError(e)
  }
}

/** Ejecuta una consulta/mutación de tabla y lanza AppError si falla. */
export async function q<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  try {
    const { data, error } = await p
    if (error) throw new AppError(error)
    return data as T
  } catch (e) {
    throw e instanceof AppError ? e : new AppError(e)
  }
}

/** Llama a la Edge Function staff-admin y convierte sus errores en AppError (códigos traducibles). */
async function staffAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body })
  if (error) {
    // FunctionsHttpError trae la respuesta en error.context; FunctionsFetchError = sin red
    let code = ''
    try { code = (await (error as unknown as { context: Response }).context.json())?.error ?? '' } catch { /* sin cuerpo */ }
    if (!code && /not found|404/i.test(String(error.message))) code = 'FUNCTION_NOT_DEPLOYED'
    throw new AppError({ message: code || error.message })
  }
  if (data?.error) throw new AppError({ message: String(data.error) })
  return data as T
}

export const api = {
  myProfile: () => rpc<Profile | null>('get_my_profile'),

  // Público (QR)
  tableByToken: (token: string) => rpc<TableInfo>('get_table_by_token', { p_token: token }),
  createQrOrder: (token: string, items: LineInput[], requestId: string, note?: string) =>
    rpc<{ order_id: string; order_number: number; status: OrderStatus; total: number; duplicate: boolean }>(
      'create_qr_order', { p_token: token, p_items: items, p_request_id: requestId, p_note: note || null }),
  tableOrders: (token: string) => rpc<PublicOrder[]>('get_table_orders', { p_token: token }),

  // Personal
  createStaffOrder: (tableId: string | null, items: LineInput[], note: string | undefined, requestId: string) =>
    rpc<{ order_id: string; order_number: number; total: number }>(
      'create_staff_order', { p_table_id: tableId, p_items: items, p_note: note || null, p_request_id: requestId }),
  replaceOrderItems: (orderId: string, items: LineInput[], note?: string) =>
    rpc<{ order_id: string; total: number }>('replace_order_items', { p_order_id: orderId, p_items: items, p_note: note ?? null }),
  setOrderStatus: (orderId: string, status: OrderStatus) =>
    rpc<{ order_id: string; status: OrderStatus }>('set_order_status', { p_order_id: orderId, p_status: status }),
  cancelOrder: (orderId: string, reason?: string) =>
    rpc<{ order_id: string }>('cancel_order', { p_order_id: orderId, p_reason: reason || null }),
  registerPayment: (orderIds: string[], method: PaymentMethod, reference?: string) =>
    rpc<{ group_id: string; total: number; orders: number }>(
      'register_payment', { p_order_ids: orderIds, p_method: method, p_reference: reference || null }),
  adminUpdateUser: (userId: string, roleId: number | null, fullName: string, active: boolean) =>
    rpc<{ user_id: string }>('admin_update_user', { p_user_id: userId, p_role_id: roleId, p_full_name: fullName, p_is_active: active }),
  saveRole: (id: number | null, label: string, permissions: string[]) =>
    rpc<{ role_id: number; name: string }>('admin_save_role', { p_id: id, p_label: label, p_permissions: permissions }),
  deleteRole: (id: number) => rpc<{ role_id: number }>('admin_delete_role', { p_id: id }),
  /** Crea una cuenta (usuario + contraseña) mediante la Edge Function staff-admin. */
  createStaffUser: (username: string, password: string, fullName: string, roleId: number | null) =>
    staffAdmin<{ user_id: string }>({ action: 'create', username, password, full_name: fullName, role_id: roleId }),
  setStaffPassword: (userId: string, password: string) =>
    staffAdmin<{ user_id: string }>({ action: 'set_password', user_id: userId, password }),
  regenerateToken: (tableId: string) => rpc<string>('regenerate_table_token', { p_table_id: tableId }),
  registerBoleta: (groupId: string, customerName: string, docType: DocType | null, docNumber: string | null, items: BoletaLine[]) =>
    rpc<{ receipt_id: string; total: number; status: string }>('register_boleta', {
      p_group_id: groupId, p_customer_name: customerName, p_doc_type: docType, p_doc_number: docNumber, p_items: items }),
  markBoletaIssued: (receiptId: string, sunatRef: string) =>
    rpc<{ receipt_id: string; sunat_ref: string }>('mark_boleta_issued', { p_receipt_id: receiptId, p_sunat_ref: sunatRef }),
  voidBoleta: (receiptId: string) => rpc<{ receipt_id: string }>('void_boleta', { p_receipt_id: receiptId }),
  salesReport: (from: string, to: string) => rpc<SalesReport>('sales_report', { p_from: from, p_to: to }),
}
