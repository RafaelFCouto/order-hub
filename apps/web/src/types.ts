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
