import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl } from '../lib/format';
import { formatPhone, waLink } from '../lib/whatsapp';
import { NEXT_STATUS, PAYMENT_LABEL, STATUS_LABEL, isEditable } from '../lib/orderLabels';
import Select from '../components/Select';
import { useUi } from '../lib/ui';
import type { Order, OrderStatus, Store } from '../types';

export default function Orders() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { confirm } = useUi();
  const [tab, setTab] = useState<'active' | 'scheduled' | 'done'>('active');
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });

  const storeName = (id: string) =>
    stores?.find((s) => s.id === id)?.name ?? 'Loja';

  const storeQs = storeId ? `&store_id=${storeId}` : '';
  const { data: activeOrders, isLoading } = useQuery({
    queryKey: ['orders', 'active', storeId],
    queryFn: () => api<Order[]>(`/orders?done=false${storeQs}`),
  });
  const { data: doneOrders } = useQuery({
    queryKey: ['orders', 'done', storeId],
    queryFn: () => api<Order[]>(`/orders?done=true${storeQs}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };

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

  const active = activeOrders ?? [];
  const ativos = active.filter((o) => !o.scheduledFor);
  const agendados = active
    .filter((o) => o.scheduledFor)
    .sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));
  const concluidos = doneOrders ?? [];

  const counts = {
    active: ativos.length,
    scheduled: agendados.length,
    done: concluidos.length,
  };
  const base =
    tab === 'done' ? concluidos : tab === 'scheduled' ? agendados : ativos;

  const term = search.trim().toLowerCase();
  const filtered = base.filter((o) => {
    if (status && tab !== 'done' && o.status !== status) return false;
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
          Ativos <span className="tab-count">{counts.active}</span>
        </button>
        <button
          className={`tab ${tab === 'scheduled' ? 'active' : ''}`}
          onClick={() => setTab('scheduled')}
        >
          Agendados <span className="tab-count">{counts.scheduled}</span>
        </button>
        <button
          className={`tab ${tab === 'done' ? 'active' : ''}`}
          onClick={() => setTab('done')}
        >
          Concluídos <span className="tab-count">{counts.done}</span>
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
        {tab !== 'done' && (
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
          {tab === 'done'
            ? 'Nenhum pedido concluído.'
            : tab === 'scheduled'
              ? 'Nenhum pedido agendado.'
              : 'Nenhum pedido ativo.'}
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
              <li
                key={o.id}
                className="card order-item clickable"
                onClick={() => navigate(`/orders/${o.id}`)}
              >
                <div className="order-main">
                  <div className="order-line">
                    <strong>#{o.code}</strong>
                    <span className="muted">{brl(o.total)}</span>
                  </div>
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
                          {formatPhone(o.customer.phone)}
                        </a>
                      ) : (
                        <span className="muted">
                          {formatPhone(o.customer.phone)}
                        </span>
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
                {tab !== 'done' && (
                  <div className="actions">
                    {next && o.status !== 'CANCELED' && (
                      <button
                        className="link"
                        disabled={advance.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          advance.mutate({ id: o.id, to: next.to });
                        }}
                      >
                        {next.label}
                      </button>
                    )}
                    {isEditable(o.status) && (
                      <button
                        className="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/orders/${o.id}/edit`);
                        }}
                      >
                        Editar
                      </button>
                    )}
                    {o.status !== 'CANCELED' && (
                      <button
                        className="link danger"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (
                            await confirm({
                              message: `Cancelar pedido #${o.code}?`,
                              confirmLabel: 'Cancelar pedido',
                              danger: true,
                            })
                          )
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
