export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
export type OrderChannel = 'internal' | 'qr'
export type PaymentStatus = 'unpaid' | 'paid'
export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'transfer' | 'other'

export interface Profile {
  id: string
  email: string | null
  full_name: string
  is_active: boolean
  role: string | null
  role_label: string | null
  permissions: string[]
}

export interface RestaurantSettings {
  id: number
  name: string
  currency_symbol: string
  tax_rate: number
  prices_include_tax: boolean
  timezone: string
  qr_ordering_enabled: boolean
  qr_max_pending_per_table: number
  public_base_url: string | null
  receipt_footer: string | null
  legal_name: string | null
  ruc: string | null
  address: string | null
  phone: string | null
}

export interface TableRow {
  id: string
  number: number
  name: string | null
  capacity: number
  qr_token: string
  is_active: boolean
}

export interface Category {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

export interface Product {
  id: string
  category_id: string
  name: string
  description: string | null
  ingredients: string | null
  price: number
  image_path: string | null
  is_available: boolean
  is_active: boolean
  sort_order: number
}

export interface MenuProduct {
  id: string
  category_id: string
  name: string
  description: string | null
  ingredients: string | null
  price: number
  final_price: number
  image_path: string | null
  is_available: boolean
  sort_order: number
}

export interface Promotion {
  id: string
  name: string
  description: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  product_id: string | null
  category_id: string | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  line_no: number
  product_name: string
  list_price: number
  unit_price: number
  quantity: number
  notes: string | null
  line_total: number
}

export interface Order {
  id: string
  order_number: number
  table_id: string | null   // null = pedido sin mesa (para llevar / mostrador)
  channel: OrderChannel
  status: OrderStatus
  payment_status: PaymentStatus
  customer_note: string | null
  subtotal: number
  discount_total: number
  tax_amount: number
  total: number
  created_at: string
  preparing_at: string | null
  ready_at: string | null
  delivered_at: string | null
  paid_at: string | null
  tables: { number: number; name: string | null } | null
  order_items: OrderItem[]
}

export interface StaffUser {
  id: string
  email: string | null
  full_name: string
  role_id: number | null
  is_active: boolean
  roles: { id: number; name: string; label: string } | null
}

export interface CartLine {
  product: MenuProduct
  quantity: number
  notes: string
}

export interface SalesReport {
  summary: { orders: number; total: number; tax: number; discounts: number; avg_ticket: number }
  cancelled: number
  by_day: { date: string; orders: number; total: number }[]
  by_method: { method: PaymentMethod; payments: number; total: number }[]
  by_channel: { channel: OrderChannel; orders: number; total: number }[]
  top_products: { name: string; quantity: number; total: number }[]
}

export interface TableInfo {
  number: number
  name: string | null
  restaurant: string
  currency: string
  qr_enabled: boolean
}

export interface PublicOrder {
  id: string
  order_number: number
  status: OrderStatus
  total: number
  created_at: string
  channel: OrderChannel
  items: { name: string; quantity: number; notes: string | null }[]
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  wallet: 'Yape / Plin',
  transfer: 'Transferencia',
  other: 'Otro',
}

export type ReceiptStatus = 'prepared' | 'issued' | 'void'
export type DocType = 'DNI' | 'CE' | 'PASAPORTE'

export interface BoletaLine { product: string; quantity: number; amount: number }

export interface Receipt {
  id: string
  group_id: string
  customer_name: string
  doc_type: DocType | null
  doc_number: string | null
  items: BoletaLine[]
  total: number
  status: ReceiptStatus
  sunat_ref: string | null
  issued_at: string | null
  created_at: string
}

/** Un cobro (cierre de cuenta): uno o varios pedidos pagados juntos. */
export interface PaidGroup {
  group_id: string
  paid_at: string
  method: PaymentMethod
  reference: string | null
  total: number
  orders: Order[]
}

/** Umbral de SUNAT: por encima de este total la boleta exige documento de identidad del cliente. */
export const BOLETA_DOC_THRESHOLD = 700
