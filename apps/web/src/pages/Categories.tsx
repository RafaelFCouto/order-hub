import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import Select from '../components/Select';
import { useUi } from '../lib/ui';
import type { Category, Store } from '../types';

export default function Categories() {
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [storeId, setStoreId] = useState('');
  const [name, setName] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });

  useEffect(() => {
    if (!storeId && stores?.length) setStoreId(stores[0].id);
  }, [stores, storeId]);

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories', storeId, showDeleted],
    queryFn: () =>
      api<Category[]>(
        `/categories?store_id=${storeId}${showDeleted ? '&include_deleted=true' : ''}`,
      ),
    enabled: Boolean(storeId),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['categories', storeId] });

  const create = useMutation({
    mutationFn: () =>
      api<Category>('/categories', {
        method: 'POST',
        body: JSON.stringify({ storeId, name }),
      }),
    onSuccess: () => {
      setName('');
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const rename = useMutation({
    mutationFn: (vars: { id: string; name: string }) =>
      api<Category>(`/categories/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: vars.name }),
      }),
    onSuccess: () => {
      closeEdit();
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) =>
      api<Category>(`/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim()) create.mutate();
  }

  function openEdit(c: Category) {
    setEditing(c);
    setEditName(c.name);
    setError(null);
  }

  function closeEdit() {
    setEditing(null);
    setEditName('');
  }

  function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (editing && editName.trim().length >= 2) {
      rename.mutate({ id: editing.id, name: editName.trim() });
    }
  }

  // checkbox marcado = ver SÓ as excluídas; senão, só as ativas
  const visible = (categories ?? []).filter((c) =>
    showDeleted ? c.deletedAt : !c.deletedAt,
  );

  if (!stores?.length) {
    return (
      <div className="page">
        <h2>Categorias</h2>
        <p className="muted">Crie uma loja primeiro (aba Lojas).</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Categorias</h2>
        <Link className="link" to="/products">
          ← Produtos
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

      <form className="card row-form" onSubmit={onSubmit}>
        <input
          placeholder="Nome da categoria"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? '...' : 'Adicionar'}
        </button>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          Mostrar excluídas
        </label>
      </form>
      {error && !editing && <p className="error">{error}</p>}

      {isLoading ? (
        <p className="muted">Carregando...</p>
      ) : !visible.length ? (
        <p className="muted">
          {showDeleted
            ? 'Nenhuma categoria excluída.'
            : 'Nenhuma categoria nesta loja.'}
        </p>
      ) : (
        <ul className="list">
          {visible.map((c) => {
            const deleted = Boolean(c.deletedAt);
            return (
              <li key={c.id} className="card list-item">
                <div>
                  <strong>{c.name}</strong>
                  {deleted && (
                    <span className="badge badge-staff"> excluída</span>
                  )}
                </div>
                <div className="actions">
                  {deleted ? (
                    <button
                      className="link"
                      onClick={() => reactivate.mutate(c.id)}
                    >
                      Reativar
                    </button>
                  ) : (
                    <>
                      <button className="link" onClick={() => openEdit(c)}>
                        Editar
                      </button>
                      <button
                        className="link danger"
                        onClick={async () => {
                          if (
                            await confirm({
                              message: `Excluir "${c.name}"? Produtos vinculados ficam sem categoria.`,
                              confirmLabel: 'Excluir',
                              danger: true,
                            })
                          ) {
                            remove.mutate(c.id);
                          }
                        }}
                      >
                        Excluir
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <form className="modal" onSubmit={onSaveEdit}>
            <h3>Editar categoria</h3>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              required
              minLength={2}
              placeholder="Nome da categoria"
            />
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="link"
                onClick={closeEdit}
              >
                Cancelar
              </button>
              <button type="submit" disabled={rename.isPending}>
                {rename.isPending ? '...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
