import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl } from '../lib/format';
import Select from '../components/Select';
import type { Order, OrderStatus, Store } from '../types';

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  IN_PRODUCTION: 'Em produção',
  READY: 'Pronto',
  CANCELED: 'Cancelado',
};

const PAYMENT_LABEL: Record<string, string> = {
  UNPAID: '🔴 Não pago',
  PARTIAL: '🟡 Parcial',
  PAID: '🟢 Pago',
  OVERPAID: '🔵 Pago a mais',
  REFUNDED: '↩️ Estornado',
};

// próximo passo de produção (botão de avançar)
const NEXT_STATUS: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PENDING: { to: 'IN_PRODUCTION', label: 'Iniciar produção' },
  IN_PRODUCTION: { to: 'READY', label: 'Marcar pronto' },
};

export default function Orders() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState('');

  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });

  const storeName = (id: string) =>
    stores?.find((s) => s.id === id)?.name ?? 'Loja';

  const params = new URLSearchParams();
  if (storeId) params.set('store_id', storeId);
  if (status) params.set('status', status);
  const qs = params.toString();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', storeId, status],
    queryFn: () => api<Order[]>(`/orders${qs ? `?${qs}` : ''}`),
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

  return (
    <div className="page">
      <div className="page-head">
        <h2>Pedidos</h2>
        <Link className="btn-link" to="/orders/new">
          + Novo pedido
        </Link>
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
      </div>

      {isLoading ? (
        <p className="muted">Carregando...</p>
      ) : !orders?.length ? (
        <p className="muted">Nenhum pedido.</p>
      ) : (
        <ul className="list">
          {orders.map((o) => {
            const lojas = [...new Set(o.items.map((i) => i.storeId))];
            const next = NEXT_STATUS[o.status];
            const editable =
              o.status === 'PENDING' || o.status === 'IN_PRODUCTION';
            return (
              <li key={o.id} className="card order-item">
                <div className="order-main">
                  <div className="order-line">
                    <strong>#{o.code}</strong>
                    <span>{o.customer?.name ?? 'Cliente'}</span>
                    <span className="muted">{brl(o.total)}</span>
                  </div>
                  <div className="badges">
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
                  {editable && (
                    <Link className="link" to={`/orders/${o.id}`}>
                      Editar
                    </Link>
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
