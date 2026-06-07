import type {
  DeliveryMethod,
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  IN_PRODUCTION: 'Em produção',
  READY: 'Pronto',
  CANCELED: 'Cancelado',
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  UNPAID: '🔴 Não pago',
  PARTIAL: '🟡 Parcial',
  PAID: '🟢 Pago',
  OVERPAID: '🔵 Pago a mais',
  REFUNDED: '↩️ Estornado',
};

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Entrega pendente',
  SHIPPED: 'Enviado',
  RECEIVED: 'Recebido',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: 'PIX',
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  OTHER: 'Outro',
};

export const DELIVERY_METHOD_LABEL: Record<DeliveryMethod, string> = {
  PICKUP: 'Retirada',
  OWN_DELIVERY: 'Entrega própria',
  UBER: 'Uber',
  MOTOBOY: 'Motoboy',
  CORREIOS: 'Correios',
  OTHER: 'Outro',
};

// próximo passo de produção (botão de avançar)
export const NEXT_STATUS: Partial<
  Record<OrderStatus, { to: OrderStatus; label: string }>
> = {
  PENDING: { to: 'IN_PRODUCTION', label: 'Iniciar produção' },
  IN_PRODUCTION: { to: 'READY', label: 'Marcar pronto' },
};

export const isEditable = (s: OrderStatus) =>
  s === 'PENDING' || s === 'IN_PRODUCTION';
