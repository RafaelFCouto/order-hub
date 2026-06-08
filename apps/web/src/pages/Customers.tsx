import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatPhone, maskPhone, waLink } from '../lib/whatsapp';
import type { Customer } from '../types';

interface FormState {
  id?: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

const EMPTY: FormState = { name: '', phone: '', email: '', notes: '' };

export default function Customers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(form.id);

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () =>
      api<Customer[]>(
        `/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ),
  });

  const reset = () => {
    setForm(EMPTY);
    setError(null);
  };
  const done = () => {
    qc.invalidateQueries({ queryKey: ['customers'] });
    reset();
  };

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const body = JSON.stringify({
        name: f.name,
        phone: f.phone || undefined,
        email: f.email || undefined,
        notes: f.notes || undefined,
      });
      return f.id
        ? api<Customer>(`/customers/${f.id}`, { method: 'PATCH', body })
        : api<Customer>('/customers', { method: 'POST', body });
    },
    onSuccess: done,
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate(form);
  }

  return (
    <div className="page">
      <h2>Clientes</h2>

      <form className="card row-form" onSubmit={onSubmit}>
        <input
          placeholder="Nome *"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          minLength={2}
        />
        <input
          placeholder="WhatsApp"
          value={form.phone}
          inputMode="numeric"
          onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })}
        />
        <input
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
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

      <input
        placeholder="Buscar por nome ou telefone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading ? (
        <p className="muted">Carregando...</p>
      ) : !customers?.length ? (
        <p className="muted">Nenhum cliente.</p>
      ) : (
        <ul className="list">
          {customers.map((c) => (
            <li key={c.id} className="card list-item">
              <div>
                <strong>{c.name}</strong>
                {c.phone &&
                  (waLink(c.phone) ? (
                    <a
                      className="wa"
                      href={waLink(c.phone)!}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir no WhatsApp"
                    >
                      {' · '}
                      {formatPhone(c.phone)}
                    </a>
                  ) : (
                    <span className="muted"> · {formatPhone(c.phone)}</span>
                  ))}
                <div className="muted small">
                  {c.totalOrders} pedido(s) · R$ {c.totalSpent}
                </div>
              </div>
              <div className="actions">
                <button
                  className="link"
                  onClick={() =>
                    setForm({
                      id: c.id,
                      name: c.name,
                      phone: maskPhone(c.phone ?? ''),
                      email: c.email ?? '',
                      notes: c.notes ?? '',
                    })
                  }
                >
                  Editar
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`Excluir ${c.name}?`)) del.mutate(c.id);
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
