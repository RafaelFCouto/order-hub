import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl } from '../lib/format';
import Select from '../components/Select';
import type { Customer, DiscountType, Order, Product, Store } from '../types';

interface Line {
  productId: string;
  productName: string;
  storeId: string;
  unitPrice: number;
  quantity: number;
}

export default function OrderForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('NONE');
  const [discountValue, setDiscountValue] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // builder de item
  const [pickStore, setPickStore] = useState('');
  const [pickProduct, setPickProduct] = useState('');
  const [pickQty, setPickQty] = useState('1');

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Customer[]>('/customers'),
  });
  const { data: stores } = useQuery({
    queryKey: ['stores'],
    queryFn: () => api<Store[]>('/stores'),
  });
  const { data: products } = useQuery({
    queryKey: ['products', pickStore],
    queryFn: () => api<Product[]>(`/products?store_id=${pickStore}&active=true`),
    enabled: Boolean(pickStore),
  });

  // carrega pedido em edição
  const { data: order } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<Order>(`/orders/${id}`),
    enabled: editing,
  });

  useEffect(() => {
    if (!order) return;
    setCustomerId(order.customerId);
    setLines(
      order.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        storeId: i.storeId,
        unitPrice: Number(i.unitPrice),
        quantity: i.quantity,
      })),
    );
    setDiscountType(order.discountType);
    setDiscountValue(order.discountType === 'NONE' ? '' : order.discountValue);
    setDeliveryFee(Number(order.deliveryFee) ? order.deliveryFee : '');
    setScheduledFor(
      order.scheduledFor ? order.scheduledFor.slice(0, 16) : '',
    );
    setNotes(order.notes ?? '');
  }, [order]);

  const storeName = (sid: string) =>
    stores?.find((s) => s.id === sid)?.name ?? 'Loja';

  const totals = useMemo(() => {
    const itemsTotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const dv = Number(discountValue) || 0;
    let discount = 0;
    if (discountType === 'FIXED') discount = Math.min(dv, itemsTotal);
    else if (discountType === 'PERCENT') discount = (itemsTotal * dv) / 100;
    const fee = Number(deliveryFee) || 0;
    const total = itemsTotal - discount + fee;
    return { itemsTotal, discount, total };
  }, [lines, discountType, discountValue, deliveryFee]);

  function addLine() {
    const p = products?.find((x) => x.id === pickProduct);
    const qty = Number(pickQty);
    if (!p || qty < 1) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === p.id ? { ...l, quantity: l.quantity + qty } : l,
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          productName: p.name,
          storeId: p.storeId,
          unitPrice: Number(p.price),
          quantity: qty,
        },
      ];
    });
    setPickProduct('');
    setPickQty('1');
  }

  const removeLine = (productId: string) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId));

  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        customerId,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
        })),
        discountType,
        discountValue: discountType === 'NONE' ? 0 : Number(discountValue) || 0,
        deliveryFee: Number(deliveryFee) || 0,
        scheduledFor: scheduledFor
          ? new Date(scheduledFor).toISOString()
          : undefined,
        notes: notes || undefined,
      });
      return editing
        ? api<Order>(`/orders/${id}`, { method: 'PATCH', body })
        : api<Order>('/orders', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      navigate('/orders');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!customerId) return setError('Selecione um cliente.');
    if (!lines.length) return setError('Adicione ao menos um item.');
    save.mutate();
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>{editing ? `Editar pedido #${order?.code ?? ''}` : 'Novo pedido'}</h2>
        <Link className="link" to="/orders">
          ← Pedidos
        </Link>
      </div>

      <form className="order-form" onSubmit={onSubmit}>
        <div className="field">
          <span className="field-label">Cliente *</span>
          <Select
            value={customerId}
            onChange={setCustomerId}
            placeholder="Selecione o cliente"
            options={(customers ?? []).map((c) => ({
              value: c.id,
              label: c.name,
            }))}
          />
        </div>

        {/* builder de itens */}
        <div className="card">
          <span className="field-label">Adicionar item</span>
          <div className="item-builder">
            <Select
              value={pickStore}
              onChange={(v) => {
                setPickStore(v);
                setPickProduct('');
              }}
              placeholder="Loja"
              options={(stores ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            />
            <Select
              value={pickProduct}
              onChange={setPickProduct}
              placeholder={pickStore ? 'Produto' : 'Escolha a loja'}
              options={(products ?? []).map((p) => ({
                value: p.id,
                label: `${p.name} — ${brl(p.price)}`,
              }))}
            />
            <input
              type="number"
              min="1"
              value={pickQty}
              onChange={(e) => setPickQty(e.target.value)}
            />
            <button type="button" onClick={addLine} disabled={!pickProduct}>
              Adicionar
            </button>
          </div>
        </div>

        {lines.length > 0 && (
          <ul className="list">
            {lines.map((l) => (
              <li key={l.productId} className="card list-item">
                <div>
                  <strong>{l.productName}</strong>
                  <span className="badge badge-owner"> {storeName(l.storeId)}</span>
                  <div className="muted small">
                    {l.quantity} × {brl(l.unitPrice)} ={' '}
                    {brl(l.unitPrice * l.quantity)}
                  </div>
                </div>
                <button
                  type="button"
                  className="link danger"
                  onClick={() => removeLine(l.productId)}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* desconto / frete */}
        <div className="row-form">
          <Select
            value={discountType}
            onChange={(v) => setDiscountType(v as DiscountType)}
            options={[
              { value: 'NONE', label: 'Sem desconto' },
              { value: 'FIXED', label: 'Desconto R$' },
              { value: 'PERCENT', label: 'Desconto %' },
            ]}
          />
          {discountType !== 'NONE' && (
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={discountType === 'PERCENT' ? '%' : 'R$'}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          )}
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Frete R$"
            value={deliveryFee}
            onChange={(e) => setDeliveryFee(e.target.value)}
          />
        </div>

        <div className="field">
          <span className="field-label">Agendamento (opcional)</span>
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
        </div>

        <textarea
          placeholder="Observações"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />

        <div className="order-totals card">
          <div className="muted">
            Itens: {brl(totals.itemsTotal)}
            {totals.discount > 0 && ` · Desconto: −${brl(totals.discount)}`}
            {Number(deliveryFee) > 0 && ` · Frete: ${brl(Number(deliveryFee))}`}
          </div>
          <strong className="order-total">Total: {brl(totals.total)}</strong>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="actions">
          <Link className="link" to="/orders">
            Cancelar
          </Link>
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? '...' : editing ? 'Salvar' : 'Criar pedido'}
          </button>
        </div>
      </form>
    </div>
  );
}
