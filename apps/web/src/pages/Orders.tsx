import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl } from '../lib/format';
import { waLink } from '../lib/whatsapp';
import { NEXT_STATUS, PAYMENT_LABEL, STATUS_LABEL, isEditable } from '../lib/orderLabels';
import Select from '../components/Select';
import type { Order, OrderStatus, Store } from '../types';

export default function Orders() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });

  const storeName = (id: string) =>
    stores?.find((s) => s.id === id)?.name ?? 'Loja';

  const params = new URLSearchParams();
  if (storeId) params.set('store_id', storeId);
  if (status && tab === 'active') params.set('status', status);
  params.set('done', tab === 'done' ? 'true' : 'false');
  const qs = params.toString();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', tab, storeId, status],
    queryFn: () => api<Order[]>(`/orders?${qs}`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['orders'] });

  const advance = useMutation({
    mutationFn: (vars: { id: string; to: OrderStatus }) =>
      api(`/orders/${vars.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: vars.to }),
      }),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/orders/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const term = search.trim().toLowerCase();
  const filtered = (orders ?? []).filter((o) => {
    if (!term) return true;
    const name = o.customer?.name?.toLowerCase() ?? '';
    const phone = o.customer?.phone ?? '';
    return name.includes(term) || phone.includes(term);
  });

  return (
    <div className="page">
      <div className="page-head">
        <h2>Pedidos</h2>
        <Link className="btn-link" to="/orders/new">
          + Novo pedido
        </Link>
      </div>

      <div className="tabs">
        <button
          className={`tab ${tab === 'active' ? 'active' : ''}`}
          onClick={() => setTab('active')}
        >
          Ativos
        </button>
        <button
          className={`tab ${tab === 'done' ? 'active' : ''}`}
          onClick={() => setTab('done')}
        >
          Concluídos
        </button>
      </div>

      <div className="filters">
        <Select
          value={storeId}
          onChange={setStoreId}
          placeholder="Todas as lojas"
          options={[
            { value: '', label: 'Todas as lojas' },
            ...(stores?.map((s) => ({ value: s.id, label: s.name })) ?? []),
          ]}
        />
        {tab === 'active' && (
          <Select
            value={status}
            onChange={setStatus}
            placeholder="Todos os status"
            options={[
              { value: '', label: 'Todos os status' },
              ...(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => ({
                value: s,
                label: STATUS_LABEL[s],
              })),
            ]}
          />
        )}
      </div>
      <input
        placeholder="Buscar cliente (nome ou telefone)..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading ? (
        <p className="muted">Carregando...</p>
      ) : !filtered.length ? (
        <p className="muted">
          {tab === 'done' ? 'Nenhum pedido concluído.' : 'Nenhum pedido ativo.'}
        </p>
      ) : (
        <ul className="list">
          {filtered.map((o) => {
            const lojas = [...new Set(o.items.map((i) => i.storeId))];
            const next = NEXT_STATUS[o.status];
            const parts = o.items.map((i) => `${i.quantity}× ${i.productName}`);
            const resumo =
              parts.slice(0, 2).join(', ') +
              (parts.length > 2 ? ` +${parts.length - 2}` : '');
            return (
              <li key={o.id} className="card order-item">
                <div className="order-main">
                  <Link className="order-line" to={`/orders/${o.id}`}>
                    <strong>#{o.code}</strong>
                    <span className="muted">{brl(o.total)}</span>
                  </Link>
                  {resumo && <div className="muted small order-summary">{resumo}</div>}

                  <div className="customer-inline">
                    <strong>{o.customer?.name ?? 'Cliente'}</strong>
                    {o.customer?.phone &&
                      (waLink(o.customer.phone) ? (
                        <a
                          className="wa"
                          href={waLink(o.customer.phone)!}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {o.customer.phone}
                        </a>
                      ) : (
                        <span className="muted">{o.customer.phone}</span>
                      ))}
                  </div>

                  <div className="badges">
                    {o.scheduledFor &&
                      (() => {
                        const d = new Date(o.scheduledFor);
                        const late =
                          d < new Date() &&
                          o.status !== 'READY' &&
                          o.status !== 'CANCELED';
                        return (
                          <span
                            className={`badge ${late ? 'status-late' : 'status-scheduled'}`}
                          >
                            📅{' '}
                            {d.toLocaleString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {late && ' · atrasado'}
                          </span>
                        );
                      })()}
                    <span className={`badge status-${o.status.toLowerCase()}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                    <span className="badge">
                      {PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}
                    </span>
                    {lojas.map((id) => (
                      <span key={id} className="badge badge-owner">
                        {storeName(id)}
                      </span>
                    ))}
                  </div>
                </div>
                {tab === 'active' && (
                  <div className="actions">
                    {next && o.status !== 'CANCELED' && (
                      <button
                        className="link"
                        disabled={advance.isPending}
                        onClick={() => advance.mutate({ id: o.id, to: next.to })}
                      >
                        {next.label}
                      </button>
                    )}
                    {isEditable(o.status) && (
                      <button
                        className="link"
                        onClick={() => navigate(`/orders/${o.id}/edit`)}
                      >
                        Editar
                      </button>
                    )}
                    {o.status !== 'CANCELED' && (
                      <button
                        className="link danger"
                        onClick={() => {
                          if (confirm(`Cancelar pedido #${o.code}?`))
                            cancel.mutate(o.id);
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
