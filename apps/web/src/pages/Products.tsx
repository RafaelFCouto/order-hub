import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Category, Product, Store } from '../types';

interface FormState {
  id?: string;
  name: string;
  price: string;
  stock: string;
  categoryId: string;
  active: boolean;
}

const EMPTY: FormState = {
  name: '',
  price: '',
  stock: '',
  categoryId: '',
  active: true,
};

export default function Products() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [newCat, setNewCat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(form.id);

  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });

  // seleciona a 1ª loja por padrão
  useEffect(() => {
    if (!storeId && stores?.length) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const { data: categories } = useQuery({
    queryKey: ['categories', storeId],
    queryFn: () => api<Category[]>(`/categories?store_id=${storeId}`),
    enabled: Boolean(storeId),
  });

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', storeId],
    queryFn: () => api<Product[]>(`/products?store_id=${storeId}`),
    enabled: Boolean(storeId),
  });

  const reset = () => {
    setForm(EMPTY);
    setError(null);
  };

  const saveCat = useMutation({
    mutationFn: () =>
      api<Category>('/categories', {
        method: 'POST',
        body: JSON.stringify({ storeId, name: newCat }),
      }),
    onSuccess: () => {
      setNewCat('');
      qc.invalidateQueries({ queryKey: ['categories', storeId] });
    },
  });

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const payload = {
        name: f.name,
        price: Number(f.price),
        stock: f.stock === '' ? undefined : Number(f.stock),
        categoryId: f.categoryId || undefined,
        active: f.active,
      };
      return f.id
        ? api<Product>(`/products/${f.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : api<Product>('/products', {
            method: 'POST',
            body: JSON.stringify({ ...payload, storeId }),
          });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products', storeId] });
      reset();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products', storeId] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate(form);
  }

  if (!stores?.length) {
    return (
      <div className="page">
        <h2>Produtos</h2>
        <p className="muted">Crie uma loja primeiro (aba Lojas).</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Produtos</h2>

      <label>
        Loja
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <form className="card row-form" onSubmit={onSubmit}>
        <input
          placeholder="Nome do produto *"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          minLength={2}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Preço *"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          required
        />
        <input
          type="number"
          placeholder="Estoque"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
        />
        <select
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
        >
          <option value="">Sem categoria</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? '...' : editing ? 'Salvar' : 'Adicionar'}
        </button>
        {editing && (
          <button type="button" className="link" onClick={reset}>
            Cancelar
          </button>
        )}
      </form>
      {error && <p className="error">{error}</p>}

      <form
        className="row-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (newCat.trim()) saveCat.mutate();
        }}
      >
        <input
          placeholder="Nova categoria"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
        />
        <button type="submit" className="link" disabled={saveCat.isPending}>
          + Categoria
        </button>
      </form>

      {isLoading ? (
        <p className="muted">Carregando...</p>
      ) : !products?.length ? (
        <p className="muted">Nenhum produto nesta loja.</p>
      ) : (
        <ul className="list">
          {products.map((p) => (
            <li key={p.id} className="card list-item">
              <div>
                <strong>{p.name}</strong>
                {!p.active && <span className="badge badge-staff"> inativo</span>}
                <div className="muted small">
                  R$ {p.price}
                  {p.stock != null && ` · estoque: ${p.stock}`}
                </div>
              </div>
              <div className="actions">
                <button
                  className="link"
                  onClick={() =>
                    setForm({
                      id: p.id,
                      name: p.name,
                      price: p.price,
                      stock: p.stock == null ? '' : String(p.stock),
                      categoryId: p.categoryId ?? '',
                      active: p.active,
                    })
                  }
                >
                  Editar
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`Excluir ${p.name}?`)) del.mutate(p.id);
                  }}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
