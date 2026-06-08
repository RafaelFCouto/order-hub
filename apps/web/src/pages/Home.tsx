import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl } from '../lib/format';
import { formatPhone, waLink } from '../lib/whatsapp';
import Select from '../components/Select';
import type { DashboardSummary, Order, Store } from '../types';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function Home() {
  const [storeId, setStoreId] = useState('');

  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });

  const { data: summary } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: () =>
      api<DashboardSummary>(
        `/dashboard/summary${storeId ? `?store_id=${storeId}` : ''}`,
      ),
  });

  // agenda: próximas retiradas (pedidos agendados a partir de hoje)
  const { data: orders } = useQuery({
    queryKey: ['orders', 'agenda', storeId],
    queryFn: () =>
      api<Order[]>(
        `/orders?done=false&from=${encodeURIComponent(startOfToday())}${
          storeId ? `&store_id=${storeId}` : ''
        }`,
      ),
  });

  const agenda = (orders ?? [])
    .filter((o) => o.scheduledFor)
    .sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));

  // agrupa por dia (pt-BR)
  const byDay = agenda.reduce<Record<string, Order[]>>((acc, o) => {
    const day = new Date(o.scheduledFor!).toLocaleDateString('pt-BR');
    (acc[day] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div className="page">
      <div className="page-head">
        <h2>Início</h2>
      </div>

      {stores && stores.length > 1 && (
        <Select
          value={storeId}
          onChange={setStoreId}
          placeholder="Todas as lojas"
          options={[
            { value: '', label: 'Todas as lojas' },
            ...stores.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      )}

      <div className="cards">
        <div className="stat-card">
          <span className="stat-label">Pedidos hoje</span>
          <strong className="stat-value">{summary?.ordersToday ?? '—'}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Retiradas hoje</span>
          <strong className="stat-value">{summary?.pickupsToday ?? '—'}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Faturamento do mês</span>
          <strong className="stat-value">
            {summary ? brl(summary.monthRevenue) : '—'}
          </strong>
          {summary && summary.revenueByStore.length > 1 && (
            <div className="stat-sub">
              {summary.revenueByStore.map((r) => (
                <div key={r.storeId} className="muted small">
                  {r.storeName}: {brl(r.total)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="stat-card">
          <span className="stat-label">A receber</span>
          <strong className="stat-value danger-text">
            {summary ? brl(summary.receivable) : '—'}
          </strong>
        </div>
      </div>

      <h3>Agenda — próximas retiradas</h3>
      {!agenda.length ? (
        <p className="muted">Nenhuma retirada agendada.</p>
      ) : (
        Object.entries(byDay).map(([day, list]) => (
          <div key={day} className="agenda-day">
            <span className="field-label">{day}</span>
            <ul className="list">
              {list.map((o) => (
                <li key={o.id} className="card list-item">
                  <div className="order-line">
                    <Link className="order-link" to={`/orders/${o.id}`}>
                      <strong>#{o.code}</strong> {o.customer?.name ?? 'Cliente'}
                    </Link>
                    {o.customer?.phone && waLink(o.customer.phone) && (
                      <>
                        <span className="muted">-</span>
                        <a
                          className="wa"
                          href={waLink(o.customer.phone)!}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {formatPhone(o.customer.phone)}
                        </a>
                      </>
                    )}
                  </div>
                  <span className="muted small">
                    {new Date(o.scheduledFor!).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
