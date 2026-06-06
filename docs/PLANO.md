# OrderHub — Plano do Sistema

Sistema de gestão de pedidos para as lojas (multi-loja). Cadastro de lojas, clientes, produtos e gestão completa de pedidos com pagamentos parciais.

## 1. Decisões

| Tema | Decisão |
|------|---------|
| Multi-loja | **Multi-tenant**. Usuário gere N lojas. Listagem de pedidos é **unificada** (todas as lojas dele), com filtro opcional por loja. |
| Pedido cruza lojas | **Sim (modelo marketplace)**. `order` **não** tem `store_id`. A loja vem do item (`order_item → product.store_id`). 1 pedido pode misturar itens de lojas diferentes. |
| Cliente | **Obrigatório** em toda order (`customer_id` NOT NULL). **Compartilhado** entre as lojas do dono (não tem `store_id`), pois 1 pedido pode cruzar lojas. |
| Produto | **Por loja** (`product.store_id` NOT NULL). |
| Pagamento | **Pagamentos parciais**. Tabela `payments` separada. Calcula saldo devedor do pedido. |
| Exclusão | **Soft delete em tudo** (`deleted_at`). Nunca apaga de verdade — principalmente `order` e `order_item`. Queries filtram `deleted_at IS NULL`. |
| Auth | Login por usuário (dono/funcionário). Papéis por loja. |
| Hospedagem | Supabase (Postgres + Auth) · Front no Vercel · API NestJS no Render. Custo ~zero no free tier. |

## 2. Stack

- **Frontend:** React + Vite + TypeScript, React Router, TanStack Query (cache/fetch), React Hook Form + Zod (validação), Tailwind + shadcn/ui (componentes).
- **Backend:** NestJS + TypeScript, Prisma (ORM), Zod/class-validator (DTO).
- **Banco:** Postgres no Supabase.
- **Auth:** Supabase Auth (JWT). NestJS valida o JWT do Supabase.
- **Deploy:** Front → Vercel · API → Render · DB → Supabase.

> Por que NestJS na frente do Supabase em vez de chamar Supabase direto do front? Centraliza regra de negócio (cálculo de saldo, mudança de status, totais do pedido), valida tudo no servidor e não expõe lógica no client. Supabase entra como Postgres + Auth.

## 3. Modelo de dados

**Regras transversais:**
- **Soft delete em todas as tabelas:** coluna `deleted_at timestamptz null`. Delete = `SET deleted_at = now()`. Toda query padrão filtra `deleted_at IS NULL`.
- **`store_id` mora em `product`** (e em `order_item` congelado), **não** em `order`. A loja de um pedido é derivada dos seus itens.
- **`customer` é compartilhado** entre as lojas do dono (sem `store_id`).

### store
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| name | text | nome da loja |
| slug | text unique | |
| phone | text | |
| created_at / updated_at | timestamptz | |
| deleted_at | timestamptz null | soft delete |

### user (espelha auth do Supabase)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | = id do Supabase Auth |
| email | text unique | |
| name | text | |
| created_at | timestamptz | |

### store_member (usuário ↔ loja, com papel)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| store_id | uuid FK | |
| user_id | uuid FK | |
| role | enum | `OWNER` \| `STAFF` |
| created_at | timestamptz | |

Unique (store_id, user_id).

### customer (compartilhado entre as lojas do dono)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| owner_id | uuid FK → user | dono do cadastro. Sem `store_id` — serve todas as lojas dele. |
| name | text | |
| phone | text | whatsapp |
| email | text null | |
| notes | text null | |
| total_orders | int | **resumo** denormalizado (backend mantém) |
| total_spent | numeric(12,2) | soma dos pedidos do cliente |
| last_order_at | timestamptz null | data do último pedido |
| created_at / updated_at / deleted_at | timestamptz | soft delete |

> **Histórico do cliente:** lista de pedidos = `SELECT em order WHERE customer_id` (sem join). Resumo (gasto/qtd/último) = campos acima. **Sem tabela `customer_history`** (seria espelho redundante dos pedidos).

### product_category (opcional, organiza catálogo)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| store_id | uuid FK | |
| name | text | |

### product
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| store_id | uuid FK | |
| category_id | uuid FK null | |
| name | text | |
| description | text null | |
| price | numeric(10,2) | preço atual de catálogo |
| stock | int null | estoque (null = não controla) |
| active | bool | default true |
| created_at / updated_at / deleted_at | timestamptz | |

### order (pedido)
**Sem `store_id`** — a loja é derivada de `order_item`. Pode cruzar lojas.
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| owner_id | uuid FK → user | dono do pedido (escopo das queries) |
| customer_id | uuid FK | **NOT NULL** — toda order tem cliente |
| code | int/serial | número amigável por dono (ex: #1023) |
| status | enum `order_status` | produção: PENDING / IN_PRODUCTION / READY / CANCELED |
| payment_status | enum `payment_status` | **derivado**: UNPAID / PARTIAL / PAID / OVERPAID / REFUNDED |
| delivery_status | enum `delivery_status` | PENDING / SHIPPED / RECEIVED |
| scheduled_for | timestamptz null | agendamento da retirada/entrega. null = pronta-entrega. `agendado` e `atrasado` derivam disto |
| items_total | numeric(10,2) | soma dos itens |
| discount_type | enum `discount_type` | NONE / FIXED / PERCENT |
| discount_value | numeric(10,2) | input cru: R$ se FIXED, % se PERCENT |
| discount_amount | numeric(10,2) | **derivado** em R$ (desconto resolvido) |
| has_store_discount | bool | **flag**: loja deu desconto |
| override_value | numeric(10,2) null | derivado: total final fechado quando houve desconto |
| delivery_fee | numeric(10,2) | quanto cobro do cliente pela entrega. default 0 |
| total | numeric(10,2) | items_total − discount_amount + delivery_fee |
| paid_total | numeric(10,2) | soma dos pagamentos ativos (derivado) |
| balance_due | numeric(10,2) | total − paid_total (derivado) |
| notes | text null | |
| created_at / updated_at / deleted_at | timestamptz | soft delete |

**3 eixos de status independentes** (cada um uma coluna):
| Coluna | Mede | Valores |
|--------|------|---------|
| `status` | produção (nosso lado) | PENDING → IN_PRODUCTION → READY · CANCELED |
| `payment_status` | pagamento (derivado dos `payment`) | UNPAID → PARTIAL → PAID · OVERPAID · REFUNDED |
| `delivery_status` | entrega | PENDING → SHIPPED → RECEIVED |

**Desconto de loja:** `discount_amount` = FIXED→`discount_value` · PERCENT→`items_total × discount_value/100` · NONE→0. Ao aplicar: seta `has_store_discount=true`, `override_value=total`, recalcula `total` e `payment_status` (se zerar saldo → PAID → libera fechamento). Não fura a regra dura — o desconto reduz o total, não pula o bloqueio.

### order_item (linha do pedido) — **carrega a loja**
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| order_id | uuid FK | |
| product_id | uuid FK | rastreia origem (produto pode ser soft-deleted depois) |
| store_id | uuid FK | **congela** `product.store_id`. Faz a listagem/faturamento por loja. |
| product_name | text | **congela** nome no momento |
| unit_price | numeric(10,2) | **congela** preço no momento |
| quantity | int | |
| line_total | numeric(10,2) | unit_price × quantity |
| created_at / updated_at / deleted_at | timestamptz | soft delete |

> **Congelar `store_id`/nome/preço:** se produto mudar de preço/loja ou for soft-deleted, o pedido antigo mantém o valor histórico correto. Faturamento por loja lê só `order_item.store_id` sem join.
> **Loja(s) do pedido** = `SELECT DISTINCT store_id FROM order_item WHERE order_id = ? AND deleted_at IS NULL` → vira os badges na listagem.

### payment (pagamento parcial)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| order_id | uuid FK | |
| amount | numeric(10,2) | > 0 |
| method | enum `payment_method` | `PIX` \| `CASH` \| `CARD` \| `OTHER` |
| paid_at | timestamptz | |
| notes | text null | |
| created_at / deleted_at | timestamptz | soft delete (estornar = soft delete) |

### delivery (detalhe da entrega — quem/como/quanto)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| order_id | uuid FK | **1 entrega por pedido** (1-pra-1), mesmo com itens de lojas diferentes |
| method | enum `delivery_method` | `PICKUP` \| `OWN_DELIVERY` \| `UBER` \| `MOTOBOY` \| `CORREIOS` \| `OTHER` |
| recipient_name | text null | pra quem entregou |
| address | text null | onde (null se PICKUP) |
| delivered_by | uuid FK → user null | qual funcionário (se OWN_DELIVERY) |
| courier_name | text null | nome motoboy / cód rastreio Uber/Correios |
| cost | numeric(10,2) null | quanto a entrega me **custou** (≠ delivery_fee cobrado) |
| shipped_at | timestamptz null | saiu pra entrega → seta order.delivery_status = SHIPPED |
| received_at | timestamptz null | confirmado recebido → seta order.delivery_status = RECEIVED |
| notes | text null | |
| created_at / deleted_at | timestamptz | soft delete |

### stock_movement (log de estoque — `product.stock` é cache derivado)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| product_id | uuid FK | |
| order_item_id | uuid FK null | null se ajuste manual |
| qty_change | int | negativo = saída (venda), positivo = entrada (devolução/ajuste) |
| reason | enum `stock_reason` | `SALE` \| `CANCEL_RETURN` \| `MANUAL` \| `ADJUST` |
| created_at | timestamptz | |

> **Baixa automática:** ao registrar o pedido (POST /orders) → 1 movimento `SALE (-qty)` por item, decrementa `product.stock`. **Não bloqueia**: se `qty > stock`, avisa e salva mesmo assim (estoque fica negativo). Cancelar pedido → `CANCEL_RETURN (+qty)`, devolve ao estoque.

### product_history (auditoria do produto — preço e estoque, com anterior/atual)
| Campo | Tipo | Nota |
|-------|------|------|
| id | uuid PK | |
| product_id | uuid FK | |
| event_type | enum `product_event_type` | `PRICE_CHANGE` \| `STOCK_SALE` \| `STOCK_RESTOCK` \| `STOCK_RETURN` \| `STOCK_ADJUST` |
| field | text | `stock` \| `price` |
| old_value | numeric(10,2) null | **anterior** (ex: tinha 5) |
| new_value | numeric(10,2) null | **atual** (ex: ficou -5) |
| qty_change | int null | delta p/ estoque (-10, +5); null p/ preço |
| order_item_id | uuid FK null | se veio de venda/cancelamento |
| actor_id | uuid FK null | quem fez (null se automático) |
| note | text null | ex: "estoque ficou negativo" |
| created_at | timestamptz | |

> Grava 1 linha a cada mudança de **estoque OU preço**, sempre com `old_value`/`new_value`. Ex: vendeu 10 tendo 5 → `STOCK_SALE old=5 new=-5 qty=-10`; preço 10→12 → `PRICE_CHANGE old=10 new=12`. **Coexiste** com `stock_movement` (ledger p/ somar estoque) — `product_history` é a auditoria legível com antes/depois (e cobre preço).

> `order.delivery_status` = badge rápido na listagem. `delivery` = detalhe rico p/ análise (método mais usado, custo de frete, lucro de entrega = `delivery_fee − cost`, quem mais entrega). Backend mantém os dois sincronizados.

## 4. Status do pedido (3 eixos)

### 4.1 `status` — produção
```
PENDING → IN_PRODUCTION → READY
   └──────────────────────────→ CANCELED   (de qualquer ponto)
```
- `PENDING` — criado, aguardando.
- `IN_PRODUCTION` — em preparo.
- `READY` — pronto do nosso lado.
- `CANCELED` — cancelado.

### 4.2 `payment_status` — pagamento (derivado, nunca setado à mão)
```
paid = soma dos payment ativos
  paid <= 0          → UNPAID
  paid <  total      → PARTIAL      (o caso do sinal)
  paid == total      → PAID
  paid >  total      → OVERPAID     (pagou a mais / troco a dar)
REFUNDED = marca manual quando estorna tudo após ter pago (soft delete dos payments).
```
Recalculado em 3 gatilhos: adiciona payment, remove/estorna payment, edita itens/desconto/frete (muda `total`).

### 4.3 `delivery_status` — entrega
```
PENDING → SHIPPED → RECEIVED
PICKUP:  PENDING → RECEIVED   (pula SHIPPED)
```

### 4.4 Regras duras (backend, sem override)
1. **Fechamento:** `delivery_status → RECEIVED` bloqueado se `payment_status NOT IN ('PAID','OVERPAID')`. Botão "Receber" desabilitado enquanto `balance_due > 0`. Pagar o que falta **antes** de receber.
2. **Edição:** itens/desconto/frete editáveis só com `status IN ('PENDING','IN_PRODUCTION')`. Após `READY` → bloqueia edição; só **cancelar e refazer**.
3. **Cancelar com pagamento:** **não** estorna automático. Avisa que há valor pago; dono estorna **manual** (soft delete dos payments → `REFUNDED`) se quiser.

## 5. API (NestJS) — rotas principais

Todas exigem JWT. Backend resolve o **dono** pelo usuário do JWT e escopa tudo por ele. `store_id` é **filtro opcional** (não header fixo): omitido = todas as lojas do dono; informado = backend valida que ele é membro daquela loja antes de filtrar. Toda query ignora registros com `deleted_at`.

```
Auth (via Supabase no front; backend só valida JWT)
GET    /me                      → usuário + lojas que participa

Lojas
GET    /stores                  → lojas do usuário
POST   /stores                  → cria loja (vira OWNER)
PATCH  /stores/:id

Clientes
GET    /customers               ?search=
POST   /customers
PATCH  /customers/:id
DELETE /customers/:id           (soft delete)

Produtos
GET    /products                ?category=&active=
POST   /products
PATCH  /products/:id
DELETE /products/:id
GET    /categories  POST /categories

Pedidos
GET    /orders                  ?status=&payment_status=&delivery_status=&customer=&store_id=&from=&to=
GET    /orders/:id              → pedido + itens + pagamentos + entregas
POST   /orders                  → cria com itens (calcula totais no server)
PATCH  /orders/:id              → edita itens/desconto/retirada (recalcula totais + payment_status)
PATCH  /orders/:id/status       → muda status de produção (valida transição)
DELETE /orders/:id              (soft delete / cancela)

Pagamentos
POST   /orders/:id/payments     → registra pagamento (recalcula saldo + payment_status)
DELETE /payments/:id            (estorna = soft delete, recalcula)

Entrega
POST   /orders/:id/deliveries   → cria entrega (método, recipient, custo...)
PATCH  /deliveries/:id          → atualiza (shipped_at → SHIPPED, received_at → RECEIVED)
                                  ⚠️ RECEIVED bloqueado se payment_status != PAID (regra 4.4)

Dashboard
GET    /dashboard/summary       ?store_id=  → faturamento mês, pedidos hoje, retiradas hoje, saldo a receber
                                  (faturamento por loja = soma order_item.line_total agrupado por store_id)
```

## 6. Telas (Frontend)

1. **Login** — Supabase Auth.
2. **Filtro de loja (topo)** — dropdown "Todas as lojas" (default) + cada loja. Não força escolher uma; só filtra.
3. **Dashboard** — cards: pedidos do dia, retiradas de hoje, faturamento do mês (por loja + total), total a receber.
4. **Pedidos** — lista unificada (todas as lojas) com filtro (produção/pagamento/entrega, data, cliente, loja). Badges: status produção + `payment_status` (🔴 UNPAID/🟡 PARTIAL/🟢 PAID) + `delivery_status` + **badge(s) de loja** (DISTINCT dos itens).
5. **Novo/Editar pedido** — escolhe cliente (obrigatório), adiciona itens (busca produto de qualquer loja + qty), desconto/frete, data retirada. Mostra total ao vivo. Itens podem ser de lojas diferentes.
6. **Detalhe do pedido** — itens (agrupados por loja), status de produção (botões de avançar), pagamentos (adicionar parcial + saldo devedor), entrega (método/quem/custo). Botão **"Receber" desabilitado enquanto `balance_due > 0`** (regra 4.4).
7. **Clientes** — CRUD (compartilhado entre lojas) + histórico de pedidos do cliente.
8. **Produtos** — CRUD por loja + categorias.
9. **Config** — dados das lojas, membros/usuários.

## 7. Fases de entrega (refinado — cada fase = API + UI + teste, entregável)

- **Fase 0 — Setup:** ✅ monorepo pnpm, NestJS + Prisma 7, React/Vite, Postgres (Docker) + migrations, testes SQLite.
- **Fase 1 — Auth + Lojas:** ✅ login Supabase, upsert `app_user`, CRUD de loja (criador vira OWNER).
- **Fase 2 — Clientes:** CRUD owner-scoped + busca. (independe de loja)
- **Fase 3 — Produtos:** categorias + produtos por loja + estoque inicial. Loja escolhida via `<select>` no form (sem seletor global por ora). (depende de Loja)
- **Fase 4 — Pedidos (núcleo):** criar/editar com itens (mistura lojas), totais no server, 3 status, listagem unificada. (depende de F2 + F3)
- **Fase 5 — Pagamentos:** parciais, saldo devedor, `payment_status` derivado, OVERPAID. (depende de F4)
- **Fase 6 — Entrega:** `delivery`, método/custo, `delivery_status`, regra de fechamento 4.4. (depende de F4)
- **Fase 7 — Estoque:** `stock_movement`, baixa no registro, `product_history`, devolução no cancelamento. (depende de F4)
- **Fase 8 — Dashboard + Agenda:** resumos, filtros, calendário. (depende de F4)
- **Fase 9 — Extras:** lembrete WhatsApp (`wa.me`), relatórios, `order_event` (timeline).

> Onboarding/seletor de loja global: adiado. Produto pega a loja por `<select>` no próprio form. Revisitar quando incomodar.

## 8. Decidido

- ✅ Pedido cruza lojas (loja vem do `order_item`).
- ✅ Cliente compartilhado entre lojas, obrigatório no pedido.
- ✅ 3 status: produção / pagamento (derivado) / entrega.
- ✅ Pagamento inferido (inclusive na criação): UNPAID/PARTIAL/PAID/**OVERPAID**(pagou a mais)/REFUNDED.
- ✅ Fechamento (`RECEIVED`) exige `payment_status IN (PAID, OVERPAID)` (regra 4.4.1).
- ✅ Editar só antes de `READY`; depois só cancela e refaz (4.4.2).
- ✅ Cancelar com pagamento = estorno **manual**, nunca automático (4.4.3).
- ✅ Pedido misto = **1 entrega** pro pedido todo (delivery 1-pra-1).
- ✅ Desconto de loja: só **fixo (R$) ou percentual (%)**; `override_value` derivado. Recalcula total + payment_status.
- ✅ Estoque: **baixa automática** no registro do pedido via `stock_movement`. **Não bloqueia** — avisa se ficar negativo. Cancelar devolve.
- ✅ Auditoria do produto: tabela `product_history` (preço + estoque, com anterior/atual). Coexiste com `stock_movement`.
- ✅ Histórico do cliente: lista via `order.customer_id` (sem join) + resumo denormalizado no `customer` (`total_orders`/`total_spent`/`last_order_at`). **Sem** tabela `customer_history`.
- ✅ Soft delete em tudo.
- ✅ Locale fixo BRL / pt-BR.
- ✅ WhatsApp via link `wa.me` (grátis) — API oficial só se precisar (Fase 8).
- ✅ Restaurar excluídos: sem tela por ora (fica no banco).
- ✅ `order_event` (timeline): adotar depois (Fase 8).

## 9. Em aberto (decidir depois)

- _(nada pendente — todos os pontos de arquitetura/regra decididos)_
