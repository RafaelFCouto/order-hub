import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl } from '../lib/format';
import { formatPhone, waLink } from '../lib/whatsapp';
import Select from '../components/Select';
import type { DashboardSummary, Order, Store } from '../types';

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

  // agenda: agendados ativos (inclui atrasados)
  const { data: active } = useQuery({
    queryKey: ['orders', 'agenda', storeId],
    queryFn: () =>
      api<Order[]>(
        `/orders?done=false${storeId ? `&store_id=${storeId}` : ''}`,
      ),
  });
  // + concluídos de hoje (pra não sumirem da agenda, só marcar entregue)
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const { data: doneToday } = useQuery({
    queryKey: ['orders', 'agenda-done', storeId],
    queryFn: () =>
      api<Order[]>(
        `/orders?done=true&from=${encodeURIComponent(
          dayStart.toISOString(),
        )}&to=${encodeURIComponent(dayEnd.toISOString())}${
          storeId ? `&store_id=${storeId}` : ''
        }`,
      ),
  });

  const now = new Date();
  const isLate = (o: Order) =>
    o.scheduledFor != null &&
    new Date(o.scheduledFor) < now &&
    o.status !== 'READY' &&
    o.deliveryStatus !== 'RECEIVED';

  const agenda = [...(active ?? []), ...(doneToday ?? [])]
    .filter((o) => o.scheduledFor)
    .sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));

  // agrupa por dia (pt-BR)
  const byDay = agenda.reduce<Record<string, Order[]>>((acc, o) => {
    const day = new Date(o.scheduledFor!).toLocaleDateString('pt-BR');
    (acc[day] ??= []).push(o);
    return acc;
  }, {});

  const todayStr = new Date().toLocaleDateString('pt-BR');
  const tmrw = new Date();
  tmrw.setDate(tmrw.getDate() + 1);
  const tomorrowStr = tmrw.toLocaleDateString('pt-BR');
  const dayLabel = (day: string) =>
    day === todayStr ? 'HOJE' : day === tomorrowStr ? 'AMANHÃ' : null;

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
            <span className="field-label">
              {dayLabel(day) && (
                <strong
                  className={`agenda-tag ${
                    dayLabel(day) === 'HOJE' ? 'tag-today' : 'tag-tomorrow'
                  }`}
                >
                  {dayLabel(day)}
                </strong>
              )}
              {day} · {list.length} pedido{list.length > 1 ? 's' : ''}
            </span>
            <ul className="list">
              {list.map((o) => (
                <li key={o.id} className="card list-item">
                  <div className="order-line">
                    <Link className="order-link" to={`/orders/${o.id}`}>
                      <strong>#{o.code}</strong> {o.customer?.name ?? 'Cliente'}
                    </Link>
                    {o.deliveryStatus === 'RECEIVED' ? (
                      <span className="badge status-ready">entregue</span>
                    ) : (
                      isLate(o) && (
                        <span className="badge status-late">atrasado</span>
                      )
                    )}
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
