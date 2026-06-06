import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Store } from '../types';

export default function Stores() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: stores, isLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; phone?: string }) =>
      api<Store>('/stores', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setName('');
      setPhone('');
      qc.invalidateQueries({ queryKey: ['stores'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({ name, phone: phone || undefined });
  }

  return (
    <div className="page">
      <h2>Lojas</h2>

      <form className="card row-form" onSubmit={onSubmit}>
        <input
          placeholder="Nome da loja"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <input
          placeholder="Telefone (opcional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? '...' : 'Criar loja'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {isLoading ? (
        <p className="muted">Carregando...</p>
      ) : !stores?.length ? (
        <p className="muted">Nenhuma loja ainda. Crie a primeira acima.</p>
      ) : (
        <ul className="list">
          {stores.map((s) => (
            <li key={s.id} className="card list-item">
              <div>
                <strong>{s.name}</strong>
                <span className="muted"> /{s.slug}</span>
              </div>
              <span className={`badge badge-${s.role.toLowerCase()}`}>
                {s.role}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
