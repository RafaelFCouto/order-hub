import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { brl, moneyToMasked, parseMoney } from '../lib/format';
import Select from '../components/Select';
import MoneyInput from '../components/MoneyInput';
import { METHOD_LABEL } from '../lib/orderLabels';
import { maskPhone } from '../lib/whatsapp';
import { useUi } from '../lib/ui';
import type {
  Customer,
  DiscountType,
  Order,
  PaymentMethod,
  Product,
  Store,
} from '../types';

interface LineOption {
  productId: string;
  productName: string;
  quantity: number;
}
interface Line {
  productId: string;
  productName: string;
  storeId: string;
  unitPrice: number;
  quantity: number;
  options?: LineOption[];
}

export default function OrderForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useUi();

  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('NONE');
  const [discountValue, setDiscountValue] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [deliveryByUs, setDeliveryByUs] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // sinal/entrada (só na criação)
  const [hasDownPayment, setHasDownPayment] = useState(false);
  const [downAmount, setDownAmount] = useState('');
  const [downMethod, setDownMethod] = useState<PaymentMethod>('PIX');

  // lançamento passado (só na criação)
  const [placedAt, setPlacedAt] = useState('');
  const [completed, setCompleted] = useState(false);
  const [completedMethod, setCompletedMethod] = useState<PaymentMethod>('CASH');

  // builder de item
  const [pickStore, setPickStore] = useState('');
  const [pickProduct, setPickProduct] = useState('');
  const [pickQty, setPickQty] = useState('1');

  // seletor de sabores (combo)
  const [comboBox, setComboBox] = useState<Product | null>(null);
  const [flavorQty, setFlavorQty] = useState<Record<string, number>>({});

  // cadastro rápido de cliente
  const [newCustomer, setNewCustomer] = useState(false);
  const [ncName, setNcName] = useState('');
  const [ncPhone, setNcPhone] = useState('');
  const [ncError, setNcError] = useState<string | null>(null);

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
  // sabores do combo selecionado
  const { data: flavors } = useQuery({
    queryKey: ['products', comboBox?.storeId, comboBox?.comboCategoryId],
    queryFn: () =>
      api<Product[]>(
        `/products?store_id=${comboBox!.storeId}&category_id=${comboBox!.comboCategoryId}&active=true`,
      ),
    enabled: Boolean(comboBox?.comboCategoryId),
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
        options: i.options?.map((o) => ({
          productId: o.productId,
          productName: o.productName,
          quantity: o.quantity,
        })),
      })),
    );
    setDiscountType(order.discountType);
    setDiscountValue(
      order.discountType === 'FIXED'
        ? moneyToMasked(order.discountValue)
        : order.discountType === 'PERCENT'
          ? String(Number(order.discountValue))
          : '',
    );
    setDeliveryFee(moneyToMasked(order.deliveryFee));
    setDeliveryByUs(order.deliveryByUs);
    setIsScheduled(Boolean(order.scheduledFor));
    setScheduledFor(
      order.scheduledFor ? order.scheduledFor.slice(0, 16) : '',
    );
    setNotes(order.notes ?? '');
  }, [order]);

  const storeName = (sid: string) =>
    stores?.find((s) => s.id === sid)?.name ?? 'Loja';

  const totals = useMemo(() => {
    const itemsTotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    let discount = 0;
    if (discountType === 'FIXED')
      discount = Math.min(parseMoney(discountValue), itemsTotal);
    else if (discountType === 'PERCENT')
      discount = (itemsTotal * (Number(discountValue) || 0)) / 100;
    // frete só entra no total quando a entrega é por nossa conta
    const fee = deliveryByUs ? parseMoney(deliveryFee) : 0;
    const total = itemsTotal - discount + fee;
    return { itemsTotal, discount, total };
  }, [lines, discountType, discountValue, deliveryFee, deliveryByUs]);

  const flavorSum = Object.values(flavorQty).reduce((s, q) => s + q, 0);

  function addLine() {
    const p = products?.find((x) => x.id === pickProduct);
    const qty = Number(pickQty);
    if (!p || qty < 1) return;
    if (p.comboSize != null) {
      // combo: abre seletor de sabores
      setComboBox(p);
      setFlavorQty({});
      return;
    }
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id && !l.options);
      if (i >= 0) {
        return prev.map((l, idx) =>
          idx === i ? { ...l, quantity: l.quantity + qty } : l,
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

  function confirmCombo() {
    if (!comboBox || flavorSum !== comboBox.comboSize) return;
    const options: LineOption[] = Object.entries(flavorQty)
      .filter(([, q]) => q > 0)
      .map(([pid, q]) => ({
        productId: pid,
        productName: flavors?.find((f) => f.id === pid)?.name ?? '',
        quantity: q,
      }));
    setLines((prev) => [
      ...prev,
      {
        productId: comboBox.id,
        productName: comboBox.name,
        storeId: comboBox.storeId,
        unitPrice: Number(comboBox.price),
        quantity: Number(pickQty) || 1,
        options,
      },
    ]);
    setComboBox(null);
    setFlavorQty({});
    setPickProduct('');
    setPickQty('1');
  }

  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  const setQty = (idx: number, qty: number) =>
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, qty) } : l)),
    );

  const createCustomer = useMutation({
    mutationFn: () =>
      api<Customer>('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: ncName.trim(),
          phone: ncPhone.trim() || undefined,
        }),
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setCustomerId(c.id); // já seleciona o novo
      setNewCustomer(false);
      setNcName('');
      setNcPhone('');
      setNcError(null);
    },
    onError: (e) => setNcError(e instanceof Error ? e.message : 'Erro'),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = JSON.stringify({
        customerId,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          options: l.options?.map((o) => ({
            productId: o.productId,
            quantity: o.quantity,
          })),
        })),
        discountType,
        discountValue:
          discountType === 'NONE'
            ? 0
            : discountType === 'FIXED'
              ? parseMoney(discountValue)
              : Number(discountValue) || 0,
        deliveryFee: parseMoney(deliveryFee),
        deliveryByUs,
        scheduledFor:
          isScheduled && scheduledFor
            ? new Date(scheduledFor).toISOString()
            : null,
        notes: notes || undefined,
      });
      if (editing) {
        return api<Order>(`/orders/${id}`, { method: 'PATCH', body });
      }
      const createBody = JSON.stringify({
        customerId,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          options: l.options?.map((o) => ({
            productId: o.productId,
            quantity: o.quantity,
          })),
        })),
        discountType,
        discountValue:
          discountType === 'NONE'
            ? 0
            : discountType === 'FIXED'
              ? parseMoney(discountValue)
              : Number(discountValue) || 0,
        deliveryFee: parseMoney(deliveryFee),
        deliveryByUs,
        scheduledFor:
          isScheduled && scheduledFor
            ? new Date(scheduledFor).toISOString()
            : null,
        notes: notes || undefined,
        placedAt: placedAt ? new Date(placedAt).toISOString() : undefined,
        completed: completed || undefined,
        paymentMethod: completed ? completedMethod : undefined,
      });
      const created = await api<Order>('/orders', {
        method: 'POST',
        body: createBody,
      });
      // sinal só faz sentido em pedido não-concluído
      if (!completed && hasDownPayment && parseMoney(downAmount) > 0) {
        await api(`/orders/${created.id}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            amount: parseMoney(downAmount),
            method: downMethod,
          }),
        });
      }
      return created;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      if (editing) qc.invalidateQueries({ queryKey: ['order', id] });
      const warns = saved.stockWarnings ?? [];
      if (warns.length) {
        toast(
          'Estoque negativo:\n' +
            warns.map((w) => `${w.name}: ${w.stock}`).join('\n'),
          'error',
        );
      }
      navigate(`/orders/${saved.id}`);
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
          <div className="field-with-action">
            <Select
              value={customerId}
              onChange={setCustomerId}
              placeholder="Selecione o cliente"
              searchable
              options={(customers ?? []).map((c) => ({
                value: c.id,
                label: c.name,
              }))}
            />
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setNcError(null);
                setNewCustomer(true);
              }}
            >
              + Novo
            </button>
          </div>
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
              searchable
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
            {lines.map((l, idx) => (
              <li key={idx} className="card list-item">
                <div className="line-info">
                  <strong>{l.productName}</strong>
                  <div>
                    <span className="badge badge-owner">
                      {storeName(l.storeId)}
                    </span>
                  </div>
                  {l.options && l.options.length > 0 && (
                    <div className="muted small">
                      {l.options
                        .map((o) => `${o.quantity}x ${o.productName}`)
                        .join(', ')}
                    </div>
                  )}
                  <div className="muted small">
                    {brl(l.unitPrice)} cada = {brl(l.unitPrice * l.quantity)}
                  </div>
                </div>
                <div className="actions">
                  <div className="qty-stepper">
                    <button
                      type="button"
                      onClick={() => setQty(idx, l.quantity - 1)}
                      disabled={l.quantity <= 1}
                      aria-label="Diminuir"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={l.quantity}
                      onChange={(e) =>
                        setQty(idx, Number(e.target.value) || 1)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setQty(idx, l.quantity + 1)}
                      aria-label="Aumentar"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => removeLine(idx)}
                    aria-label="Remover item"
                    title="Remover"
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
              </li>
            ))}
          </ul>
        )}

        {/* desconto / frete */}
        <div className="row-form">
          <Select
            value={discountType}
            onChange={(v) => {
              setDiscountType(v as DiscountType);
              setDiscountValue('');
            }}
            options={[
              { value: 'NONE', label: 'Sem desconto' },
              { value: 'FIXED', label: 'Desconto R$' },
              { value: 'PERCENT', label: 'Desconto %' },
            ]}
          />
          {discountType === 'FIXED' && (
            <MoneyInput
              placeholder="Desconto R$"
              value={discountValue}
              onChange={setDiscountValue}
            />
          )}
          {discountType === 'PERCENT' && (
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="%"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          )}
          <MoneyInput
            placeholder="Frete R$"
            value={deliveryFee}
            onChange={setDeliveryFee}
          />
        </div>

        {parseMoney(deliveryFee) > 0 && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={deliveryByUs}
              onChange={(e) => setDeliveryByUs(e.target.checked)}
            />
            Entrega por nossa conta (cobrar frete do cliente)
          </label>
        )}

        <div className="field">
          <label className="toggle">
            <input
              type="checkbox"
              checked={isScheduled}
              onChange={(e) => setIsScheduled(e.target.checked)}
            />
            É um agendamento?
          </label>
          {isScheduled && (
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          )}
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
            {deliveryByUs &&
              parseMoney(deliveryFee) > 0 &&
              ` · Frete: ${brl(parseMoney(deliveryFee))}`}
          </div>
          <strong className="order-total">Total: {brl(totals.total)}</strong>
        </div>

        {!editing && (
          <>
            <div className="field">
              <span className="field-label">Data do pedido (opcional)</span>
              <input
                type="datetime-local"
                value={placedAt}
                onChange={(e) => setPlacedAt(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={completed}
                  onChange={(e) => setCompleted(e.target.checked)}
                />
                Venda já paga e entregue (lançamento passado)
              </label>
              {completed && (
                <Select
                  value={completedMethod}
                  onChange={(v) => setCompletedMethod(v as PaymentMethod)}
                  options={(Object.keys(METHOD_LABEL) as PaymentMethod[]).map(
                    (m) => ({ value: m, label: METHOD_LABEL[m] }),
                  )}
                />
              )}
            </div>

            {!completed && (
              <div className="field">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={hasDownPayment}
                    onChange={(e) => setHasDownPayment(e.target.checked)}
                  />
                  Recebeu sinal/entrada?
                </label>
                {hasDownPayment && (
                  <div className="row-form">
                    <MoneyInput
                      placeholder="Valor do sinal R$"
                      value={downAmount}
                      onChange={setDownAmount}
                    />
                    <Select
                      value={downMethod}
                      onChange={(v) => setDownMethod(v as PaymentMethod)}
                      options={(Object.keys(METHOD_LABEL) as PaymentMethod[]).map(
                        (m) => ({ value: m, label: METHOD_LABEL[m] }),
                      )}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/orders')}
          >
            Cancelar
          </button>
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? '...' : editing ? 'Salvar' : 'Criar pedido'}
          </button>
        </div>
      </form>

      {newCustomer && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewCustomer(false);
          }}
        >
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              setNcError(null);
              if (ncName.trim().length >= 2) createCustomer.mutate();
            }}
          >
            <h3>Novo cliente</h3>
            <input
              placeholder="Nome *"
              value={ncName}
              onChange={(e) => setNcName(e.target.value)}
              autoFocus
              required
              minLength={2}
            />
            <input
              placeholder="WhatsApp"
              value={ncPhone}
              inputMode="numeric"
              onChange={(e) => setNcPhone(maskPhone(e.target.value))}
            />
            {ncError && <p className="error">{ncError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="link"
                onClick={() => setNewCustomer(false)}
              >
                Cancelar
              </button>
              <button type="submit" disabled={createCustomer.isPending}>
                {createCustomer.isPending ? '...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {comboBox && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setComboBox(null);
          }}
        >
          <div className="modal">
            <h3>{comboBox.name}</h3>
            <p className="muted small">
              Escolha {comboBox.comboSize} sabor(es) — {flavorSum}/
              {comboBox.comboSize}
            </p>
            <ul className="list-plain">
              {(flavors ?? []).map((f) => {
                const q = flavorQty[f.id] ?? 0;
                const atMax = flavorSum >= (comboBox.comboSize ?? 0);
                return (
                  <li key={f.id} className="line-row">
                    <span>{f.name}</span>
                    <div className="qty-stepper">
                      <button
                        type="button"
                        disabled={q <= 0}
                        onClick={() =>
                          setFlavorQty((m) => ({ ...m, [f.id]: q - 1 }))
                        }
                      >
                        −
                      </button>
                      <span>{q}</span>
                      <button
                        type="button"
                        disabled={atMax}
                        onClick={() =>
                          setFlavorQty((m) => ({ ...m, [f.id]: q + 1 }))
                        }
                      >
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setComboBox(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={flavorSum !== comboBox.comboSize}
                onClick={confirmCombo}
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
