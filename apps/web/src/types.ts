export type StoreRole = 'OWNER' | 'STAFF';

export interface Store {
  id: string;
  name: string;
  slug: string;
  cnpj: string | null;
  phone: string | null;
  role: StoreRole;
}

export interface Me {
  user: { id: string; email: string; name: string };
  stores: Store[];
}

export interface Category {
  id: string;
  storeId: string;
  name: string;
  updatedUserId: string | null;
  deletedAt: string | null;
  deletedUserId: string | null;
}

export interface Product {
  id: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  price: string;
  stock: number | null;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  totalOrders: number;
  totalSpent: string;
  lastOrderAt: string | null;
}

export type OrderStatus = 'PENDING' | 'IN_PRODUCTION' | 'READY' | 'CANCELED';
export type PaymentStatus =
  | 'UNPAID'
  | 'PARTIAL'
  | 'PAID'
  | 'OVERPAID'
  | 'REFUNDED';
export type DeliveryStatus = 'PENDING' | 'SHIPPED' | 'RECEIVED';
export type DiscountType = 'NONE' | 'FIXED' | 'PERCENT';
export type PaymentMethod = 'PIX' | 'CASH' | 'CARD' | 'OTHER';
export type DeliveryMethod =
  | 'PICKUP'
  | 'OWN_DELIVERY'
  | 'UBER'
  | 'MOTOBOY'
  | 'CORREIOS'
  | 'OTHER';

export interface Delivery {
  id: string;
  method: DeliveryMethod;
  recipientName: string | null;
  address: string | null;
  courierName: string | null;
  cost: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  notes: string | null;
}

export interface Payment {
  id: string;
  amount: string;
  method: PaymentMethod;
  paidAt: string;
  notes: string | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  storeId: string;
  productName: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface Order {
  id: string;
  code: number;
  customerId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  scheduledFor: string | null;
  itemsTotal: string;
  discountType: DiscountType;
  discountValue: string;
  discountAmount: string;
  hasStoreDiscount: boolean;
  deliveryFee: string;
  total: string;
  paidTotal: string;
  balanceDue: string;
  notes: string | null;
  createdAt: string;
  items: OrderItem[];
  customer?: Customer;
  payments?: Payment[];
  deliveries?: Delivery[];
  owner?: { id: string; name: string; email: string };
}
