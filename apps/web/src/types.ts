export type StoreRole = 'OWNER' | 'STAFF';

export interface Store {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  role: StoreRole;
}

export interface Me {
  user: { id: string; email: string; name: string };
  stores: Store[];
}
