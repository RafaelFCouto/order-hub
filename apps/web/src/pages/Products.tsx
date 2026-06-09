import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { moneyToMasked, parseMoney } from '../lib/format';
import Select from '../components/Select';
import MoneyInput from '../components/MoneyInput';
import { useUi } from '../lib/ui';
import type { Category, Product, Store } from '../types';

interface FormState {
  id?: string;
  name: string;
  price: string;
  stock: string;
  categoryId: string;
  active: boolean;
  isCombo: boolean;
  comboSize: string;
  comboCategoryId: string;
}

const EMPTY: FormState = {
  name: '',
  price: '',
  stock: '',
  categoryId: '',
  active: true,
  isCombo: false,
  comboSize: '4',
  comboCategoryId: '',
};

export default function Products() {
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [storeId, setStoreId] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
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

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const payload = {
        name: f.name,
        price: parseMoney(f.price),
        stock: f.stock === '' ? undefined : Number(f.stock),
        categoryId: f.categoryId || undefined,
        active: f.active,
        comboSize: f.isCombo ? Number(f.comboSize) || 1 : null,
        comboCategoryId: f.isCombo ? f.comboCategoryId || null : null,
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
      <div className="page-head">
        <h2>Produtos</h2>
        <Link className="link" to="/categories">
          Gerenciar categorias
        </Link>
      </div>

      <div className="field">
        <span className="field-label">Loja</span>
        <Select
          value={storeId}
          onChange={setStoreId}
          options={stores.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>

      <form className="card row-form product-form" onSubmit={onSubmit}>
        <input
          placeholder="Nome do produto *"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          minLength={2}
        />
        <MoneyInput
          placeholder="Preço *"
          value={form.price}
          onChange={(v) => setForm({ ...form, price: v })}
          required
        />
        <input
          type="number"
          placeholder="Estoque"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
        />
        <Select
          value={form.categoryId}
          onChange={(v) => setForm({ ...form, categoryId: v })}
          placeholder="Selecione a Categoria"
          options={[
            { value: '', label: 'Selecione a Categoria' },
            ...(categories?.map((c) => ({ value: c.id, label: c.name })) ?? []),
          ]}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.isCombo}
            onChange={(e) => setForm({ ...form, isCombo: e.target.checked })}
          />
          Combo (cliente escolhe sabores)
        </label>
        {form.isCombo && (
          <>
            <input
              type="number"
              min="1"
              placeholder="Qtd de sabores"
              value={form.comboSize}
              onChange={(e) => setForm({ ...form, comboSize: e.target.value })}
            />
            <Select
              value={form.comboCategoryId}
              onChange={(v) => setForm({ ...form, comboCategoryId: v })}
              placeholder="Categoria dos sabores"
              options={[
                { value: '', label: 'Categoria dos sabores' },
                ...(categories?.map((c) => ({ value: c.id, label: c.name })) ??
                  []),
              ]}
            />
          </>
        )}
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
                {p.comboSize != null && (
                  <span className="badge badge-owner">combo c/ {p.comboSize}</span>
                )}
                {!p.active && <span className="badge badge-staff">inativo</span>}
                {p.stock != null && p.stock <= 0 && (
                  <span
                    className={`badge ${p.stock < 0 ? 'status-late' : 'status-pending'}`}
                  >
                    {p.stock < 0 ? 'estoque negativo' : 'sem estoque'}
                  </span>
                )}
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
                      price: moneyToMasked(p.price),
                      stock: p.stock == null ? '' : String(p.stock),
                      categoryId: p.categoryId ?? '',
                      active: p.active,
                      isCombo: p.comboSize != null,
                      comboSize: p.comboSize ? String(p.comboSize) : '4',
                      comboCategoryId: p.comboCategoryId ?? '',
                    })
                  }
                >
                  Editar
                </button>
                <button
                  className="link danger"
                  onClick={async () => {
                    if (
                      await confirm({
                        message: `Excluir ${p.name}?`,
                        confirmLabel: 'Excluir',
                        danger: true,
                      })
                    )
                      del.mutate(p.id);
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
