import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl } from '../lib/format';
import { waLink } from '../lib/whatsapp';
import {
  DELIVERY_LABEL,
  DELIVERY_METHOD_LABEL,
  METHOD_LABEL,
  NEXT_STATUS,
  PAYMENT_LABEL,
  STATUS_LABEL,
  isEditable,
} from '../lib/orderLabels';
import Select from '../components/Select';
import type {
  DeliveryMethod,
  Order,
  OrderStatus,
  PaymentMethod,
  Store,
} from '../types';

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [error, setError] = useState<string | null>(null);

  // entrega
  const [delMethod, setDelMethod] = useState<DeliveryMethod>('PICKUP');
  const [delRecipient, setDelRecipient] = useState('');
  const [delAddress, setDelAddress] = useState('');
  const [delCourier, setDelCourier] = useState('');
  const [delCost, setDelCost] = useState('');

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<Order>(`/orders/${id}`),
    enabled: Boolean(id),
  });
  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });
  const storeName = (sid: string) =>
    stores?.find((s) => s.id === sid)?.name ?? 'Loja';

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const addPayment = useMutation({
    mutationFn: () =>
      api(`/orders/${id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(amount), method }),
      }),
    onSuccess: () => {
      setAmount('');
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const removePayment = useMutation({
    mutationFn: (pid: string) => api(`/payments/${pid}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const createDelivery = useMutation({
    mutationFn: () =>
      api(`/orders/${id}/deliveries`, {
        method: 'POST',
        body: JSON.stringify({
          method: delMethod,
          recipientName: delRecipient || undefined,
          address: delAddress || undefined,
          courierName: delCourier || undefined,
          cost: delCost ? Number(delCost) : undefined,
        }),
      }),
    onSuccess: () => {
      setDelRecipient('');
      setDelAddress('');
      setDelCourier('');
      setDelCost('');
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const patchDelivery = useMutation({
    mutationFn: (vars: { did: string; body: Record<string, unknown> }) =>
      api(`/deliveries/${vars.did}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.body),
      }),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  const removeDelivery = useMutation({
    mutationFn: (did: string) =>
      api(`/deliveries/${did}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const advance = useMutation({
    mutationFn: (to: OrderStatus) =>
      api(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: to }),
      }),
    onSuccess: refresh,
  });

  const cancel = useMutation({
    mutationFn: () => api(`/orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      navigate('/orders');
    },
  });

  function onAddPayment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (Number(amount) > 0) addPayment.mutate();
  }

  if (isLoading) return <div className="page muted">Carregando...</div>;
  if (!order) return <div className="page muted">Pedido não encontrado.</div>;

  // itens agrupados por loja
  const byStore = order.items.reduce<Record<string, typeof order.items>>(
    (acc, it) => {
      (acc[it.storeId] ??= []).push(it);
      return acc;
    },
    {},
  );
  const next = NEXT_STATUS[order.status];
  const delivery = order.deliveries?.[0];
  const balanceOpen = Number(order.balanceDue) > 0;

  return (
    <div className="page">
      <div className="page-head">
        <h2>Pedido #{order.code}</h2>
        <Link className="link" to="/orders">
          ← Pedidos
        </Link>
      </div>

      <div className="badges">
        <span className={`badge status-${order.status.toLowerCase()}`}>
          {STATUS_LABEL[order.status]}
        </span>
        <span className="badge">
          {PAYMENT_LABEL[order.paymentStatus] ?? order.paymentStatus}
        </span>
        <span className="badge">{DELIVERY_LABEL[order.deliveryStatus]}</span>
      </div>

      <div className="card customer-block">
        <strong>{order.customer?.name ?? 'Cliente'}</strong>
        {order.customer?.phone &&
          (waLink(order.customer.phone) ? (
            <a
              className="wa"
              href={waLink(order.customer.phone)!}
              target="_blank"
              rel="noreferrer"
            >
              {order.customer.phone}
            </a>
          ) : (
            <span className="muted">{order.customer.phone}</span>
          ))}
        <div className="muted small">
          Registrado por {order.owner?.name ?? '—'} ·{' '}
          {new Date(order.createdAt).toLocaleString('pt-BR')}
        </div>
        {order.scheduledFor && (
          <div className="muted small">
            Agendado para {new Date(order.scheduledFor).toLocaleString('pt-BR')}
          </div>
        )}
      </div>

      {/* itens por loja */}
      {Object.entries(byStore).map(([sid, items]) => {
        const subtotal = items.reduce((s, i) => s + Number(i.lineTotal), 0);
        return (
          <div key={sid} className="card">
            <span className="field-label">{storeName(sid)}</span>
            <ul className="list-plain">
              {items.map((i) => (
                <li key={i.id} className="line-row">
                  <span>
                    {i.quantity}× {i.productName}
                  </span>
                  <span className="muted">{brl(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <div className="line-row store-subtotal">
              <span className="muted">Subtotal</span>
              <strong>{brl(subtotal)}</strong>
            </div>
          </div>
        );
      })}

      {/* totais */}
      <div className="card totals-box">
        <div className="line-row muted">
          <span>Itens</span>
          <span>{brl(order.itemsTotal)}</span>
        </div>
        {Number(order.discountAmount) > 0 && (
          <div className="line-row muted">
            <span>Desconto</span>
            <span>−{brl(order.discountAmount)}</span>
          </div>
        )}
        {Number(order.deliveryFee) > 0 && (
          <div className="line-row muted">
            <span>Frete</span>
            <span>{brl(order.deliveryFee)}</span>
          </div>
        )}
        <div className="line-row">
          <strong>Total</strong>
          <strong>{brl(order.total)}</strong>
        </div>
        <div className="line-row muted">
          <span>Pago</span>
          <span>{brl(order.paidTotal)}</span>
        </div>
        <div className="line-row balance">
          <strong>Saldo devedor</strong>
          <strong>{brl(order.balanceDue)}</strong>
        </div>
      </div>

      {/* pagamentos */}
      <div className="card">
        <span className="field-label">Pagamentos</span>
        {order.payments?.length ? (
          <ul className="list-plain">
            {order.payments.map((p) => (
              <li key={p.id} className="line-row">
                <span>
                  {brl(p.amount)}{' '}
                  <span className="muted small">
                    {METHOD_LABEL[p.method]} ·{' '}
                    {new Date(p.paidAt).toLocaleDateString('pt-BR')}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label="Estornar"
                  title="Estornar"
                  onClick={() => {
                    if (confirm(`Estornar ${brl(p.amount)}?`))
                      removePayment.mutate(p.id);
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nenhum pagamento ainda.</p>
        )}

        {Number(order.balanceDue) > 0 && order.status !== 'CANCELED' && (
          <form className="row-form pay-form" onSubmit={onAddPayment}>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Valor R$"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <Select
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
              options={(Object.keys(METHOD_LABEL) as PaymentMethod[]).map(
                (m) => ({ value: m, label: METHOD_LABEL[m] }),
              )}
            />
            <button type="submit" disabled={addPayment.isPending}>
              {addPayment.isPending ? '...' : 'Adicionar pagamento'}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {/* entrega */}
      {order.status !== 'CANCELED' && (
        <div className="card">
          <span className="field-label">Entrega</span>
          {!delivery ? (
            <div className="row-form">
              <Select
                value={delMethod}
                onChange={(v) => setDelMethod(v as DeliveryMethod)}
                options={(
                  Object.keys(DELIVERY_METHOD_LABEL) as DeliveryMethod[]
                ).map((m) => ({ value: m, label: DELIVERY_METHOD_LABEL[m] }))}
              />
              {delMethod !== 'PICKUP' && (
                <input
                  placeholder="Endereço"
                  value={delAddress}
                  onChange={(e) => setDelAddress(e.target.value)}
                />
              )}
              <input
                placeholder="Destinatário"
                value={delRecipient}
                onChange={(e) => setDelRecipient(e.target.value)}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Custo R$"
                value={delCost}
                onChange={(e) => setDelCost(e.target.value)}
              />
              <button
                type="button"
                disabled={createDelivery.isPending}
                onClick={() => createDelivery.mutate()}
              >
                Registrar entrega
              </button>
            </div>
          ) : (
            <div className="delivery-info">
              <div className="line-row">
                <strong>{DELIVERY_METHOD_LABEL[delivery.method]}</strong>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label="Remover entrega"
                  title="Remover entrega"
                  onClick={() => {
                    if (confirm('Remover entrega?'))
                      removeDelivery.mutate(delivery.id);
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
              {delivery.address && (
                <div className="muted small">{delivery.address}</div>
              )}
              {delivery.recipientName && (
                <div className="muted small">Para: {delivery.recipientName}</div>
              )}
              {delivery.cost && Number(delivery.cost) > 0 && (
                <div className="muted small">Custo: {brl(delivery.cost)}</div>
              )}
              <div className="actions">
                {delivery.method !== 'PICKUP' &&
                  !delivery.shippedAt &&
                  !delivery.receivedAt && (
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        patchDelivery.mutate({
                          did: delivery.id,
                          body: { setShipped: true },
                        })
                      }
                    >
                      Marcar enviado
                    </button>
                  )}
                {!delivery.receivedAt && (
                  <button
                    onClick={() =>
                      patchDelivery.mutate({
                        did: delivery.id,
                        body: { setReceived: true },
                      })
                    }
                    disabled={balanceOpen}
                    title={
                      balanceOpen ? 'Pague o saldo para marcar recebido' : ''
                    }
                  >
                    Marcar recebido
                  </button>
                )}
                {delivery.receivedAt && (
                  <span className="muted small">
                    Recebido em{' '}
                    {new Date(delivery.receivedAt).toLocaleString('pt-BR')}
                  </span>
                )}
              </div>
              {balanceOpen && !delivery.receivedAt && (
                <p className="muted small">
                  Saldo em aberto — quite para liberar "Receber".
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ações */}
      {order.status !== 'CANCELED' && (
        <div className="actions">
          {next && (
            <button onClick={() => advance.mutate(next.to)}>{next.label}</button>
          )}
          {isEditable(order.status) && (
            <button
              className="btn-secondary"
              onClick={() => navigate(`/orders/${order.id}/edit`)}
            >
              Editar
            </button>
          )}
          <button
            className="link danger"
            onClick={() => {
              if (confirm(`Cancelar pedido #${order.code}?`)) cancel.mutate();
            }}
          >
            Cancelar pedido
          </button>
        </div>
      )}
    </div>
  );
}
