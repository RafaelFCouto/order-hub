# OrderHub — Fluxos do Frontend

Jornadas do usuário (a esposa) antes de implementar. **Mobile-first, mas responsivo** — prioridade no celular (balcão/loja), porém o sistema deve ser plenamente acessível e usável em tablet e desktop. Complementa [PLANO.md](./PLANO.md).

## Princípios

- **Mobile-first:** botões grandes, fluxo vertical, 1 ação principal por tela. Bottom nav.
- **Responsivo de verdade:** funciona bem do celular ao desktop. Em telas grandes (tablet/PC) aproveita o espaço — bottom nav vira sidebar, cards viram tabela com mais colunas, detalhe do pedido pode usar 2 colunas (itens | painel de status). Nada de "site de celular esticado". Breakpoints: `sm` celular · `md` tablet · `lg+` desktop.
- **Loja default = "Todas":** tudo é o agregado das 2 lojas; filtro por loja é opcional.
- **3 eixos independentes** (produção / pagamento / entrega): a esposa mexe em qualquer um, na ordem do dia real. Única trava firme: `RECEIVED` exige `PAID`.
- **Status nunca escolhido à mão quando dá pra inferir:** `payment_status` é sempre derivado dos pagamentos.

## Navegação (bottom nav mobile)

```
[ 🏠 Início ]  [ 📋 Pedidos ]  [ 📅 Agenda ]  [ 👥 Clientes ]  [ ⋯ Mais ]
Topo fixo:  [ Loja: Todas ▾ ]            [ + ]
```
"Mais" = Produtos, Config, lojas.

---

## Fluxo 0 — Entrar
```
Login (Supabase) → Início (Dashboard)
```

## Fluxo 1 — Criar pedido (núcleo)
```
[ + ] Novo pedido
  1. CLIENTE
       busca por nome/telefone
       ├─ achou → seleciona
       └─ não achou → [+ novo cliente] inline (nome + whatsapp) → volta
  2. ITENS
       busca produto (qualquer loja) → add → ajusta qty
       repete N (pode misturar lojas)
       linha: produto · [loja] · preço · qty · subtotal
       ⚠️ se qty > estoque → avisa "estoque ficará negativo" (NÃO bloqueia)
  3. AJUSTES
       desconto (fixo R$ ou %) · frete (delivery_fee) · agendamento (scheduled_for, opcional)
  4. PAGAMENTO AGORA (opcional)
       "Valor pago agora" + método → sistema INFERE payment_status
  5. RESUMO ao vivo: items_total − desconto + frete = TOTAL · pago · saldo
  6. [ Salvar ]
```
Nasce: `status=PENDING` · `payment_status` inferido · `delivery_status=PENDING`.

**Inferência do pagamento (passo 4):**
```
paid = valor pago informado (cria 1 payment se > 0)
  paid <= 0      → UNPAID
  paid <  total  → PARTIAL   (sinal)
  paid >= total  → PAID
```
Mesma função `recalcOrder()` da tela de detalhe. Sinal na criação = atalho que cria pedido + 1º pagamento juntos.

> Agendamento opcional: sem data = pronta-entrega. Com data futura = entra na Agenda e nos cards de agendados.

## Fluxo 2 — Tocar o pedido (detalhe)
Painel com 3 blocos empilhados (mobile):
```
#1023 · Maria · [Loja A][Loja B]                 🟡 PARTIAL
┌ PRODUÇÃO ─────────────────────────────────────┐
│ PENDING  →[Iniciar]→ IN_PRODUCTION →[Pronto]→ READY
├ PAGAMENTO ────────────────────────────────────┤
│ total R$180 · pago R$50 · saldo R$130
│ [ + Registrar pagamento ]
├ ENTREGA ──────────────────────────────────────┤
│ método ▾ · [ Despachar ]→SHIPPED · [ Receber ]→RECEIVED
│ ⚠️ [Receber] travado enquanto saldo > 0
└───────────────────────────────────────────────┘
Itens (agrupados por loja) · [Editar] · agendado p/ 12/jun 14h
```

## Fluxo 3 — Receber pagamento (sinal → quitar)
```
[ + Registrar pagamento ] → valor + método (PIX/dinheiro/cartão) → salva
  → recalcula pago/saldo/payment_status (PARTIAL ou PAID)
  → zerou saldo → badge 🟢 PAID → libera [Receber]
```

## Fluxo 3b — Desconto da loja (fechar com saldo aberto)
```
Bloco PAGAMENTO → [ Aplicar desconto ]
  pergunta: Fixo (R$) ou Percentual (%) ?  → coleta valor
  → has_store_discount=true, recalcula total + payment_status
  → se zerou saldo: 🟢 PAID → libera [Receber]
Badge "💰 desconto da loja" no pedido. Não fura a regra dura — só baixa o total.
```

## Fluxo 4 — Despachar / entregar
```
Bloco ENTREGA → método (PICKUP/OWN_DELIVERY/UBER/MOTOBOY/CORREIOS/OTHER)
  entrega:  [Despachar] → quem (delivered_by/courier) + custo → SHIPPED
            [Receber]   → recipient → RECEIVED   (exige PAID ⚠️)
  retirada: [Receber] direto (pula despacho)
```

## Fluxo 5 — Agenda (calendário + lista)
```
📅 Agenda
  toggle: [ Mês | Semana | Lista ]
  Mês/Semana: dias com contagem de pedidos ("qui: 8")
  toca no dia → lista dos pedidos agendados daquele dia
  pedido atrasado (scheduled_for passou, não RECEIVED) → 🔴 destaque
```
`agendado = scheduled_for > now()` · `atrasado = scheduled_for < now() AND delivery_status != RECEIVED`.

## Fluxo 6 — Início (Dashboard)
```
🏠 Início — cards:
  • Agendados pra HOJE
  • Atrasados 🔴
  • Em produção
  • A receber (soma balance_due)
  • Faturamento do mês (por loja + total)
toca no card → listagem já filtrada
```

## Fluxo 7 — Listagem de pedidos
```
📋 Pedidos
  filtros: produção · pagamento · entrega · loja · data(scheduled_for)
  linha (card mobile):
    #code · cliente · [badges loja]
    R$ total · 🔴🟡🟢 pgto · status produção · entrega
    agendado/atrasado se houver
  toca → detalhe (Fluxo 2)
```

## Fluxo 8 — Cadastros
```
👥 Clientes: lista/busca → CRUD → histórico de pedidos do cliente
📦 Produtos: por loja → CRUD + categorias
⚙️ Config: lojas, membros/usuários
```

---

## Máquina de estados (resumo das travas)

| Eixo | Transições | Trava |
|------|-----------|-------|
| Produção | PENDING→IN_PRODUCTION→READY · *→CANCELED | edição só até READY; depois só cancela |
| Pagamento | UNPAID/PARTIAL/PAID/OVERPAID/REFUNDED | derivado, não manual |
| Entrega | PENDING→SHIPPED→RECEIVED (PICKUP pula SHIPPED) | **RECEIVED só se payment ∈ {PAID, OVERPAID}** |

## Decidido (fluxo)

- ✅ "Pagou a mais" → estado **OVERPAID** (aviso de troco/excedente na UI).
- ✅ Pedido misto → **1 entrega** pro pedido todo.
- ✅ Editar pedido após **READY**: **bloqueado**. UI mostra só [Cancelar] + [Refazer], esconde [Editar itens].
- ✅ Cancelar pedido com pagamento: UI **avisa** "há R$ X pago" e oferece [Estornar] manual (não faz sozinho).
