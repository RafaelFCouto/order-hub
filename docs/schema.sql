-- OrderHub — schema Postgres (Supabase)
-- Multi-loja, pedido cruza lojas, soft delete global, 3 eixos de status.

-- ENUMS ---------------------------------------------------------------
CREATE TYPE store_role      AS ENUM ('OWNER', 'STAFF');
CREATE TYPE order_status    AS ENUM ('PENDING', 'IN_PRODUCTION', 'READY', 'CANCELED');
CREATE TYPE payment_status  AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', 'REFUNDED');
CREATE TYPE delivery_status AS ENUM ('PENDING', 'SHIPPED', 'RECEIVED');
CREATE TYPE payment_method  AS ENUM ('PIX', 'CASH', 'CARD', 'OTHER');
CREATE TYPE delivery_method AS ENUM ('PICKUP', 'OWN_DELIVERY', 'UBER', 'MOTOBOY', 'CORREIOS', 'OTHER');
CREATE TYPE discount_type   AS ENUM ('NONE', 'FIXED', 'PERCENT');
CREATE TYPE stock_reason    AS ENUM ('SALE', 'CANCEL_RETURN', 'MANUAL', 'ADJUST');
CREATE TYPE product_event_type AS ENUM ('PRICE_CHANGE', 'STOCK_SALE', 'STOCK_RESTOCK', 'STOCK_RETURN', 'STOCK_ADJUST');

-- USER (espelha Supabase Auth) ----------------------------------------
CREATE TABLE app_user (
  id          uuid PRIMARY KEY,                 -- = id do Supabase Auth
  email       text UNIQUE NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- STORE ----------------------------------------------------------------
CREATE TABLE store (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                            -- único por dono (validado na app)
  slug        text UNIQUE NOT NULL,
  cnpj        text,                                     -- opcional
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- STORE_MEMBER (usuário <-> loja + papel) -----------------------------
CREATE TABLE store_member (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES store(id),
  user_id     uuid NOT NULL REFERENCES app_user(id),
  role        store_role NOT NULL DEFAULT 'STAFF',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);

-- CUSTOMER (compartilhado entre as lojas do dono) ---------------------
CREATE TABLE customer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES app_user(id),   -- sem store_id
  name        text NOT NULL,
  phone       text,                                     -- whatsapp
  email       text,
  notes       text,
  total_orders  int           NOT NULL DEFAULT 0,       -- resumo denormalizado (backend mantém)
  total_spent   numeric(12,2) NOT NULL DEFAULT 0,       -- soma dos pedidos do cliente
  last_order_at timestamptz,                            -- data do último pedido
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX customer_owner_idx ON customer (owner_id) WHERE deleted_at IS NULL;

-- PRODUCT_CATEGORY -----------------------------------------------------
CREATE TABLE product_category (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES store(id),
  name        text NOT NULL,
  deleted_at  timestamptz
);

-- PRODUCT (por loja) ---------------------------------------------------
CREATE TABLE product (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES store(id),
  category_id uuid REFERENCES product_category(id),
  name        text NOT NULL,
  description text,
  price       numeric(10,2) NOT NULL,
  stock       int,                                       -- qtd ATUAL (cache; null = não controla). Fonte da verdade: stock_movement
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX product_store_idx ON product (store_id) WHERE deleted_at IS NULL;

-- ORDER (sem store_id — a loja vem dos itens; cruza lojas) -------------
CREATE TABLE "order" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES app_user(id),
  customer_id     uuid NOT NULL REFERENCES customer(id),    -- obrigatório
  code            serial,                                   -- número amigável
  status          order_status    NOT NULL DEFAULT 'PENDING',
  payment_status  payment_status  NOT NULL DEFAULT 'UNPAID', -- derivado
  delivery_status delivery_status NOT NULL DEFAULT 'PENDING',
  scheduled_for   timestamptz,                             -- agendamento (null = pronta-entrega)
  items_total        numeric(10,2) NOT NULL DEFAULT 0,
  discount_type      discount_type NOT NULL DEFAULT 'NONE', -- como o desconto foi dado
  discount_value     numeric(10,2) NOT NULL DEFAULT 0,      -- input cru: R$ se FIXED, % se PERCENT
  discount_amount    numeric(10,2) NOT NULL DEFAULT 0,      -- derivado em R$ (desconto resolvido)
  has_store_discount boolean NOT NULL DEFAULT false,        -- flag: loja deu desconto
  override_value     numeric(10,2),                         -- derivado: total final fechado quando houve desconto
  delivery_fee       numeric(10,2) NOT NULL DEFAULT 0,      -- cobrado do cliente
  total              numeric(10,2) NOT NULL DEFAULT 0,      -- items_total - discount_amount + delivery_fee
  paid_total      numeric(10,2) NOT NULL DEFAULT 0,         -- derivado (soma payments ativos)
  balance_due     numeric(10,2) NOT NULL DEFAULT 0,         -- derivado (total - paid_total)
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX order_owner_idx     ON "order" (owner_id)      WHERE deleted_at IS NULL;
CREATE INDEX order_customer_idx  ON "order" (customer_id)   WHERE deleted_at IS NULL;
CREATE INDEX order_scheduled_idx ON "order" (scheduled_for) WHERE deleted_at IS NULL;

-- ORDER_ITEM (carrega a loja; congela nome/preço) ---------------------
CREATE TABLE order_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES "order"(id),
  product_id    uuid NOT NULL REFERENCES product(id),       -- rastreia origem
  store_id      uuid NOT NULL REFERENCES store(id),         -- congelado de product.store_id
  product_name  text NOT NULL,                              -- congelado
  unit_price    numeric(10,2) NOT NULL,                     -- congelado
  quantity      int NOT NULL CHECK (quantity > 0),
  line_total    numeric(10,2) NOT NULL,                     -- unit_price * quantity
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX order_item_order_idx ON order_item (order_id) WHERE deleted_at IS NULL;
CREATE INDEX order_item_store_idx ON order_item (store_id) WHERE deleted_at IS NULL;

-- PAYMENT (parciais; estorno = soft delete) ---------------------------
CREATE TABLE payment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES "order"(id),
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  method      payment_method NOT NULL,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX payment_order_idx ON payment (order_id) WHERE deleted_at IS NULL;

-- DELIVERY (quem/como/quanto; 1 pedido pode ter N entregas) -----------
CREATE TABLE delivery (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES "order"(id),
  method          delivery_method NOT NULL,
  recipient_name  text,                                      -- pra quem
  address         text,                                      -- onde (null se PICKUP)
  delivered_by    uuid REFERENCES app_user(id),              -- qual funcionário
  courier_name    text,                                      -- motoboy / cód rastreio
  cost            numeric(10,2),                             -- custo real da entrega
  shipped_at      timestamptz,                               -- -> delivery_status = SHIPPED
  received_at     timestamptz,                               -- -> delivery_status = RECEIVED
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX delivery_order_idx     ON delivery (order_id)     WHERE deleted_at IS NULL;
CREATE INDEX delivery_delivered_idx ON delivery (delivered_by);
CREATE INDEX delivery_method_idx    ON delivery (method);

-- STOCK_MOVEMENT (log de estoque; product.stock = cache derivado) ------
CREATE TABLE stock_movement (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES product(id),
  order_item_id uuid REFERENCES order_item(id),            -- null se ajuste manual
  qty_change    int NOT NULL,                              -- negativo = saída, positivo = entrada
  reason        stock_reason NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movement_product_idx ON stock_movement (product_id);

-- PRODUCT_HISTORY (auditoria do produto: preço e estoque, com anterior/atual) --
CREATE TABLE product_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES product(id),
  event_type    product_event_type NOT NULL,
  field         text NOT NULL,                          -- 'stock' | 'price'
  old_value     numeric(10,2),                          -- valor anterior (ex: tinha 5)
  new_value     numeric(10,2),                          -- valor atual   (ex: ficou -5)
  qty_change    int,                                    -- delta p/ estoque (-10, +5); null p/ preço
  order_item_id uuid REFERENCES order_item(id),         -- se veio de venda/cancelamento
  actor_id      uuid REFERENCES app_user(id),           -- quem fez (null se automático)
  note          text,                                   -- ex: "estoque ficou negativo"
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_history_product_idx ON product_history (product_id, created_at);

-- REGRAS DE NEGÓCIO (aplicadas no NestJS, não no banco):
--  1. order.total/paid_total/balance_due/payment_status: recalcular a cada
--     mudança de item, desconto, frete ou payment.
--  2. payment_status: paid<=0 UNPAID | paid<total PARTIAL | paid=total PAID |
--     paid>total OVERPAID. REFUNDED = estorno manual (soft delete dos payments).
--  3. FECHAMENTO: bloquear delivery_status -> RECEIVED se payment_status NOT IN (PAID, OVERPAID).
--  4. order_item.store_id/product_name/unit_price: congelar no momento da criação.
--  5. delivery shipped_at/received_at: sincronizar order.delivery_status. 1 delivery por pedido.
--  6. EDITAR: itens/desconto/frete editáveis só enquanto status IN (PENDING, IN_PRODUCTION).
--     Após READY: bloquear edição — só CANCELAR e refazer.
--  7. CANCELAR pedido com pagamento: NÃO estorna automático. Avisa que há valor pago;
--     dono estorna manual (soft delete dos payments -> REFUNDED) se quiser.
--  8. DESCONTO de loja: discount_amount = FIXED->discount_value | PERCENT->items_total*value/100 | NONE->0.
--     total = items_total - discount_amount + delivery_fee. has_store_discount=true e override_value=total
--     quando houver desconto. Recalcula payment_status com os payments existentes (pode virar PAID e liberar fechamento).
--  9. ESTOQUE: baixa no momento do REGISTRO do pedido (POST /orders) -> 1 stock_movement (SALE, -qty) por item,
--     decrementa product.stock. NÃO bloqueia: se qty > stock, AVISA e deixa salvar (stock fica negativo).
-- 10. CANCELAR pedido: devolve estoque -> stock_movement (CANCEL_RETURN, +qty) por item, incrementa product.stock.
-- 11. PRODUCT_HISTORY: gravar 1 linha a cada mudança de stock OU price, sempre com old_value/new_value.
--     stock: STOCK_SALE/RESTOCK/RETURN/ADJUST (+ qty_change). price: PRICE_CHANGE. note p/ casos como negativo.
--     (stock_movement = ledger p/ somar; product_history = auditoria legível com antes/depois. Os dois coexistem.)
-- 12. CUSTOMER resumo: ao criar/pagar/cancelar pedido, atualizar customer.total_orders / total_spent / last_order_at.
--     Lista de pedidos do cliente = SELECT em order WHERE customer_id (sem join). Sem tabela customer_history.
