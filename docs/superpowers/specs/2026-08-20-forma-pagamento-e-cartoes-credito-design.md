# Forma de Pagamento e Cartões de Crédito — Design

**Data:** 2026-08-20
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

Hoje "Contas a Pagar" trata todo dinheiro a sair como se saísse do caixa na data do vencimento do título. Isso vale para PIX, transferência e boleto — o pagamento é 1-a-1 com o lançamento financeiro na conta bancária.

Cartão de crédito quebra essa premissa: várias compras feitas no mês só saem do caixa juntas, na data em que a fatura do cartão é paga. Se o usuário lançar "compra no cartão" com a data da compra e baixar 1-a-1, três problemas aparecem:

1. **Fluxo de caixa mente** — antecipa saídas que só sairão no vencimento da fatura.
2. **Trabalho manual duplicado** — dar baixa em 15 lançamentos de cartão um por um, na mesma data, na mesma conta, é retrabalho.
3. **Perde-se a rastreabilidade da fatura** — não se sabe quais lançamentos compõem a fatura de setembro do Nubank Antonio.

Esta spec introduz o conceito de **forma de pagamento** nas 3 origens de dinheiro a sair (PP, avulsa, recorrência), um **cadastro de cartões de crédito**, e uma **aba nova de baixa em lote por cartão** que agrupa todos os títulos pendentes de cada cartão para pagamento conjunto.

## 2. Objetivo

Entregar em 3 frentes:

1. **Cadastro** — nova página `/cadastros/cartoes-credito` (nome, banco, bandeira, últimos 4 dígitos, dono, dia de vencimento da fatura).
2. **Origem** — as 3 tabelas (`pedidos_compra`, `contas_avulsas`, `contas_avulsas_recorrentes`) ganham `forma_pagamento` (enum) e `cartao_credito_id` (FK opcional, obrigatória quando forma = cartão). Nos formulários de emissão/criação, dropdown de forma + combobox condicional de cartão. Se cartão, `data_pagamento` é auto-preenchida com a próxima data de vencimento da fatura desse cartão (editável).
3. **Baixa** — nova aba **"Títulos a Pagar (Cartão)"** em `/financeiro/contas-a-pagar`, agrupada por cartão, com filtros de cartão e data. Seleção múltipla + botão "Baixar N títulos" que grava N `lancamentos_financeiros` na mesma data / mesma conta / mesmo plano de contas, atomicamente via RPC.

Objetivo secundário: extrair componente `FormaPagamentoField` compartilhado pelos 3 formulários, evitando divergência (o mesmo problema documentado em `docs/09-identidade-visual-ui.md` que já derrubou o projeto antes).

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes desta spec.

### 3.1. `forma_pagamento` como enum, aditiva e nullable no schema

Enum `forma_pagamento` com 4 valores: `pix`, `transferencia`, `boleto`, `cartao_credito`. Aplicada nas 3 tabelas como coluna nullable.

**Nullable porque** já há 10 PPs em produção sem forma. Deixá-las `NULL` (= "não informada") preserva o histórico sem backfill destrutivo. Formulários novos passam a exigir a escolha via Zod, mas o banco não trava as antigas. Linhas com `forma_pagamento IS NULL` continuam na aba "Títulos a Pagar" comum (não cartão).

Rejeitado: backfill para `'transferencia'` como default e `NOT NULL`. É mudança destrutiva — troca semântica de dados existentes por conveniência de constraint. Não vale o risco.

### 3.2. `cartao_credito_id` como FK opcional + check constraint de coerência

Cada uma das 3 tabelas ganha `cartao_credito_id uuid null references cartoes_credito(id)` e a constraint:

```sql
check (
  (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
  or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
)
```

Regra: se cartão, exige cartão selecionado. Se não-cartão, `cartao_credito_id` tem que ser nulo — evita "sujeira" de FK apontando pra cartão em um lançamento que não é de cartão. `distinct from` cobre o `NULL` (linhas antigas) e os outros 3 enums.

### 3.3. Cadastro de cartão com dia de vencimento da fatura

Campos: `nome`, `banco`, `bandeira`, `ultimos_4_digitos`, `dono`, `dia_vencimento_fatura`, `ativo`.

- **`bandeira`** é enum: `visa | master | elo | amex | hipercard | outra`. Fecha o dropdown na tela e permite ícone padronizado no futuro. Aditivo — se aparecer bandeira nova (Diners, JCB), é `alter type ... add value`.
- **`dono`** é `text not null` livre — o dono do cartão nem sempre é usuário do sistema (pode ser sócio, gerente, cônjuge). Se um dia virar FK pra `profiles`, migração aditiva.
- **`dia_vencimento_fatura`** é `smallint not null check between 1 and 31`. Um único campo, sem `dia_fechamento`. A regra "dia > 28 cai no último dia do mês" já está resolvida no projeto (`contas_avulsas_recorrentes` faz isso — reutilizar a mesma lógica).
- **`ultimos_4_digitos`** é `text` com check `^\d{4}$` — mantém zeros à esquerda.
- **Unicidade** por `(tenant_id, nome)` — impede dois "Nubank Antonio" no mesmo tenant.

Inativar em vez de deletar (padrão do projeto — `contas_bancarias`, `plano_contas_tipos`). Cartão inativo some dos dropdowns de criação mas não quebra FK dos títulos históricos.

### 3.4. Auto-preenchimento de `data_pagamento` a partir do cartão

Ao escolher `forma_pagamento = cartão` + selecionar um cartão nos 3 formulários, `data_pagamento` do título é auto-preenchida com a próxima ocorrência de `dia_vencimento_fatura` a partir de hoje:

- Hoje é dia 5, vencimento é 20 → data = 20 deste mês.
- Hoje é dia 22, vencimento é 20 → data = 20 do próximo mês.

Cálculo mora em helper puro `lib/cartoes/proxima-fatura.ts` (testável isoladamente, sem I/O). Chamado no client (form) e no server (validação da action).

**Campo continua editável.** Cobre o caso "compra caiu na fatura seguinte por causa do fechamento" sem precisar cadastrar `dia_fechamento`. Simplicidade explícita — se o volume de erro justificar, adiciona depois.

**PP com múltiplas parcelas no cartão**: cada parcela ganha sua data. 1ª parcela = próxima fatura, 2ª = fatura +1 mês, etc. Auto-preenchimento aplica isso no form; cada linha é editável.

**Recorrência no cartão**: template guarda `forma_pagamento` e `cartao_credito_id`. A ocorrência materializada calcula a data da fatura **no momento da materialização** (não usa a data prevista do template) — RPC `gerar_ocorrencias_recorrentes` chama o helper de cálculo. Isso mantém coerência: a ocorrência de setembro entra na fatura de setembro, não em uma fatura antiga.

### 3.5. Validação server-side: cartão sempre em data futura

Server action valida que `data_pagamento >= hoje` quando `forma_pagamento = cartão`. Impede baixar cartão retroativo por engano no form (compra futura na fatura de agosto que já foi paga). Cartão sem essa checagem hoje seria vazamento silencioso para o fluxo de caixa.

Não vale para outras formas — boleto/transferência retroativos são normais (lançamento tardio).

### 3.6. Aba "Títulos a Pagar (Cartão)" separada, só pendentes de cartão

Ordem final das abas em `/financeiro/contas-a-pagar`:

**PPs → Recorrências → Títulos a Pagar → Títulos a Pagar (Cartão) → Títulos Pagos**

Aba nova mostra **apenas** títulos com `forma_pagamento = 'cartao_credito'` E `status = 'a_pagar'`. Origens: PP-parcela aprovada, avulsa aprovada, ocorrência de recorrência.

- **Agrupamento**: por cartão (accordion/seção por cartão). Cada grupo tem totalizador e contador.
- **Filtros**: `cartao_credito_id` (dropdown com "Todos" + cartões ativos) e intervalo de `data_pagamento`. Filtros são aditivos.
- **Aba "Títulos a Pagar" comum** passa a ocultar os de cartão pendentes. Recebe filtro complementar `forma_pagamento != 'cartao_credito' OR forma_pagamento IS NULL`.

**Títulos de cartão baixados** vão para "Títulos Pagos" comum — não há "Títulos Pagos (Cartão)". Uma aba de arquivo única, respeitando a arquitetura do commit `54c0faa`.

### 3.7. Baixa em lote via RPC transacional (Opção A)

Nova RPC `dar_baixa_lote_cartao(p_titulos jsonb, p_pago_em, p_conta_bancaria_id, p_plano_conta_tipo_id, p_plano_conta_subtipo_id, p_criado_por)`. Recebe array `[{origem: 'pp'|'avulso'|'recorrencia', id: uuid}, ...]` e grava N `lancamentos_financeiros`, um por título, todos com mesma `data_movimento` / conta / plano, dentro de uma única transaction.

- **Atômica**: falha em qualquer item aborta todos. Reaproveita constraints unique de baixa existentes (`uniq_baixa_ativa_por_parcela`, `uniq_baixa_ativa_por_avulsa`).
- **1 lançamento por título**, não 1 por fatura. Preserva rastreabilidade individual em conciliação e evita introduzir tabela `faturas_cartao` agora.
- **Auditoria**: 1 evento agregado `contas_pagar.baixa_lote_cartao` (metadata: cartão, quantidade, valor total, ids dos títulos) + N eventos individuais (`pedido_compra.parcela_paga` / `conta_avulsa.baixada`) reutilizando as chaves de auditoria existentes.

Rejeitado — Opção B (loop no server action chamando `darBaixaTitulo` N vezes): falha parcial ingovernável, mensagem confusa, rollback manual.

Rejeitado — Opção C (1 lançamento agregado por fatura + tabela `lancamentos_cartao_itens`): mudança grande de modelo com valor incerto no MVP. Deixado para quando o DRE por cartão for pauta.

### 3.8. `FormaPagamentoField` componente único

Em `components/financeiro/forma-pagamento-field.tsx`. Recebe `cartoes: Array<{id, nome, banco, ultimos_4_digitos, dia_vencimento_fatura}>` via props (server component busca uma vez, passa pros forms) e emite `{forma_pagamento, cartao_credito_id, data_pagamento_sugerida}`.

Consumido nos 3 formulários (emissão de PP, drawer de avulsa, drawer de recorrência). Zero duplicação. Se a UI de forma de pagamento mudar, muda em 1 lugar.

### 3.9. Data de compra vs data de fatura — decisão de MVP

`data_pagamento` do título de cartão significa **quando a fatura desse cartão será paga**, não quando a compra foi feita. Convenção documentada no header do drawer ("Para cartão de crédito, a data é o vencimento da fatura em que essa compra entrará").

Trade-off: perde-se a data da compra individual. Aceito no MVP porque:
- A informação está preservada no `created_at` do título (aproximação boa).
- Sem essa convenção, teria que introduzir `data_compra` separada + `data_pagamento` (2 datas por título) — inflaria os 3 formulários.
- Se o comercial pedir análise por data de compra depois, `data_compra` entra como coluna aditiva.

## 4. Modelo de dados

### 4.1. Enum + tabela nova (Migration 1)

```sql
create type forma_pagamento as enum ('pix', 'transferencia', 'boleto', 'cartao_credito');

create type bandeira_cartao as enum ('visa', 'master', 'elo', 'amex', 'hipercard', 'outra');

create table cartoes_credito (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  banco text not null,
  bandeira bandeira_cartao not null,
  ultimos_4_digitos text not null check (ultimos_4_digitos ~ '^\d{4}$'),
  dono text not null,
  dia_vencimento_fatura smallint not null check (dia_vencimento_fatura between 1 and 31),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (tenant_id, nome)
);

create index idx_cartoes_credito_tenant_ativo
  on cartoes_credito (tenant_id, ativo);

alter table cartoes_credito enable row level security;

create policy cartoes_credito_select on cartoes_credito
  for select to authenticated
  using (is_tenant_member(tenant_id));

create policy cartoes_credito_insert on cartoes_credito
  for insert to authenticated
  with check (is_tenant_member(tenant_id));

create policy cartoes_credito_update on cartoes_credito
  for update to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- deleção liberada, mas UI usa "inativar" (`ativo=false`)
create policy cartoes_credito_delete on cartoes_credito
  for delete to authenticated
  using (is_tenant_member(tenant_id));

grant select, insert, update, delete on cartoes_credito to authenticated;
```

### 4.2. Colunas nas 3 tabelas (Migration 2)

```sql
alter table pedidos_compra
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id),
  add constraint chk_pp_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

alter table contas_avulsas
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id),
  add constraint chk_avulsa_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

alter table contas_avulsas_recorrentes
  add column forma_pagamento forma_pagamento null,
  add column cartao_credito_id uuid null references cartoes_credito(id),
  add constraint chk_recorrente_cartao check (
    (forma_pagamento = 'cartao_credito' and cartao_credito_id is not null)
    or (forma_pagamento is distinct from 'cartao_credito' and cartao_credito_id is null)
  );

-- índice para o filtro/agrupamento da aba nova
create index idx_pp_cartao        on pedidos_compra (tenant_id, cartao_credito_id) where cartao_credito_id is not null;
create index idx_avulsa_cartao    on contas_avulsas (tenant_id, cartao_credito_id) where cartao_credito_id is not null;
create index idx_recorrente_cartao on contas_avulsas_recorrentes (tenant_id, cartao_credito_id) where cartao_credito_id is not null;
```

### 4.3. Ajuste no RPC de materialização (Migration 3)

`gerar_ocorrencias_recorrentes()` passa a copiar `forma_pagamento` e `cartao_credito_id` do template. Se for cartão, calcula `data_prevista_pagamento` = próxima fatura do cartão a partir de hoje (função `proxima_fatura_cartao(cartao_id, referencia_date)` em SQL, espelho do helper TS).

### 4.4. RPC de baixa em lote (Migration 4)

```sql
create or replace function dar_baixa_lote_cartao(
  p_titulos jsonb,                    -- [{"origem":"pp","id":"..."}]
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por uuid
) returns uuid[] as $$
declare
  v_titulo jsonb;
  v_lanc_id uuid;
  v_ids uuid[] := '{}';
begin
  for v_titulo in select * from jsonb_array_elements(p_titulos) loop
    if v_titulo->>'origem' = 'pp' then
      v_lanc_id := dar_baixa_pp_parcela(
        (v_titulo->>'id')::uuid, p_pago_em,
        p_conta_bancaria_id, p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id, p_criado_por
      );
    else
      v_lanc_id := dar_baixa_avulsa_com_plano(
        (v_titulo->>'id')::uuid, p_pago_em,
        p_conta_bancaria_id, p_plano_conta_tipo_id,
        p_plano_conta_subtipo_id
      );
    end if;
    v_ids := v_ids || v_lanc_id;
  end loop;
  return v_ids;
end;
$$ language plpgsql security invoker;

grant execute on function dar_baixa_lote_cartao(jsonb, date, uuid, uuid, uuid, uuid) to authenticated;
```

Reuso puro das RPCs existentes — a atomicidade vem da transaction implícita da função.

### 4.5. Atualização de `lib/types.ts`

Cada migration acompanhada de patch em `lib/types.ts` no mesmo commit:
- `FormaPagamento` (union type).
- `BandeiraCartao` (union type).
- `CartaoCredito` (interface completa).
- Colunas novas em `PedidoCompra`, `ContaAvulsa`, `ContaAvulsaRecorrente`.
- `TituloRow` ganha `forma_pagamento` e `cartao_credito_id` opcionais.

## 5. UI

### 5.1. Cadastro `/cadastros/cartoes-credito`

Segue o padrão de `contas-bancarias` e `regionais`:

- `page.tsx` — lista + botão "Novo cartão".
- `cartoes-list.tsx` — tabela client densa. Colunas: **Nome** (com dono em cinza), **Banco / Bandeira**, **•••• 4 dígitos**, **Vencimento fatura** (dia XX), **Status** (ativo/inativo), **Ações** (editar, inativar).
- `cartao-drawer.tsx` — criação/edição. Selects: bandeira. Input numérico: dia (1-31) + 4 dígitos.
- `actions.ts` — `criarCartao`, `atualizarCartao`, `inativarCartao`, `reativarCartao`.
- `lib/validations/cartao-credito.ts` — Zod schemas.
- Link no menu de `/cadastros/page.tsx`.
- Permissão: admin ou financeiro (mesmo gate de `contas-bancarias`).

### 5.2. `FormaPagamentoField` compartilhado

Componente client em `components/financeiro/forma-pagamento-field.tsx`. Recebe:

```ts
interface Props {
  cartoes: Array<{
    id: string;
    nome: string;
    banco: string;
    ultimos_4_digitos: string;
    dia_vencimento_fatura: number;
  }>;
  value: { forma_pagamento: FormaPagamento | null; cartao_credito_id: string | null };
  onChange: (v: { forma_pagamento: FormaPagamento; cartao_credito_id: string | null; data_pagamento_sugerida?: string }) => void;
  disabled?: boolean;
}
```

Layout: select "Forma de pagamento" ao lado; se `cartao_credito`, aparece combobox "Cartão" com formato "Nubank Antonio · Visa · ••••1234". Ao selecionar cartão, `onChange` inclui `data_pagamento_sugerida` calculada pelo helper.

Empty state: se `cartoes.length === 0` e user escolhe "Cartão de Crédito", mensagem "Nenhum cartão cadastrado. [Cadastrar cartão](link)" — link abre `/cadastros/cartoes-credito` em nova aba.

### 5.3. Integração nos 3 formulários

- **PP** — form de emissão. Novos campos entre "Fornecedor" e "Parcelas". Se cartão + N parcelas, cada linha de parcela recebe data auto = fatura +N meses, editável.
- **Avulsa** — [conta-avulsa-drawer.tsx](app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx). Campo entra antes de "Data de vencimento". Se cartão, "Data de vencimento" fica bloqueada com hint "Auto-preenchida com a fatura do cartão" (permite override via botão "Editar").
- **Recorrência** — drawer de recorrência. Campo entra antes de "Frequência". Se cartão, aviso: "Cada ocorrência será agendada para a próxima fatura do cartão na data da geração."

Todos usam o mesmo `FormaPagamentoField`.

### 5.4. Aba "Títulos a Pagar (Cartão)"

Novo componente `titulos-cartao-list.tsx` — não estende `TitulosPagarList` (UX diferente demais: agrupamento + seleção múltipla + baixa em lote).

**Header**:
- Filtro de cartão (dropdown, "Todos" + cartões ativos).
- Filtro de data (`data_pagamento` — inputs "de / até", com atalhos "Este mês" / "Próximo mês").
- Totalizador global (soma dos títulos filtrados).

**Corpo**:
- Uma seção por cartão (ordenada por nome). Cabeçalho: nome do cartão + bandeira + últimos 4 + total do grupo + contador de títulos + checkbox "selecionar todos".
- Dentro do grupo, tabela: **Descrição / Origem / Fornecedor / Job / Vencimento / Valor / Ações**. Checkbox por linha.
- Estado vazio de grupo: escondido (não mostra cartões sem títulos pendentes na janela filtrada).

**Barra de ação (aparece quando há seleção)**:
- Sticky no rodapé: "N títulos selecionados de <cartão> — Total R$ X · [Baixar]".
- Só permite selecionar títulos do mesmo cartão. Selecionar em outro grupo limpa a seleção anterior (com aviso "trocando de cartão").

**Modal de baixa em lote** (`baixa-lote-cartao-dialog.tsx`):
- Campos: `pago_em` (date), `conta_bancaria_id` (select), `plano_conta_tipo_id` + `plano_conta_subtipo_id` (2 selects encadeados, padrão do baixa individual).
- Resumo: "Você vai baixar N títulos do cartão X, total R$ Y, na conta Z, em DD/MM/YYYY."
- Botão "Confirmar baixa" chama server action `darBaixaLoteCartao`.

### 5.5. Ajuste na aba "Títulos a Pagar" comum

Query da lista adiciona filtro: `forma_pagamento IS NULL OR forma_pagamento != 'cartao_credito'`. Aplica em ambas as fontes agregadas em [page.tsx:319-349](app/(app)/financeiro/contas-a-pagar/page.tsx#L319-L349) (PP) e [page.tsx:351-390](app/(app)/financeiro/contas-a-pagar/page.tsx#L351-L390) (avulsa). Contagem `titulosAPagarCount` também.

**"Títulos Pagos" comum não muda** — recebe pago de cartão junto com o resto.

## 6. Server actions e RPCs

- `criarCartao / atualizarCartao / inativarCartao / reativarCartao` — em `app/(app)/cadastros/cartoes-credito/actions.ts`. Gate admin/financeiro. Auditoria: `cartao_credito.criado / atualizado / inativado / reativado`.
- `darBaixaLoteCartao(input)` — em `app/(app)/financeiro/contas-a-pagar/actions-cartao.ts`. Zod valida `titulos: [{origem, id}]` (min 1), demais campos como no baixa individual. Chama RPC `dar_baixa_lote_cartao`. Log de auditoria: 1 `contas_pagar.baixa_lote_cartao` + revalida `/financeiro/contas-a-pagar`, `/financeiro/fluxo-caixa`, `/financeiro/conciliacao`, cada job envolvido.
- Formulários existentes (PP/avulsa/recorrência) ganham 2 campos nas suas actions de criação, com Zod discriminated union enforce.

## 7. Auditoria

Eventos novos em `audit_events`:
- `cartao_credito.criado` — metadata: nome, banco, últimos 4.
- `cartao_credito.atualizado` — metadata: diff dos campos.
- `cartao_credito.inativado` / `reativado`.
- `contas_pagar.baixa_lote_cartao` — metadata: `cartao_credito_id`, `cartao_nome`, `quantidade_titulos`, `valor_total`, `titulos_ids`, `conta_bancaria_id`, `pago_em`.

Eventos existentes (`pedido_compra.parcela_paga`, `conta_avulsa.baixada`) continuam sendo emitidos por título, dentro da RPC — mantém rastreabilidade individual.

## 8. Permissões e RLS

- `cartoes_credito` — políticas por `is_tenant_member(tenant_id)`, GRANT completo para `authenticated`. Ver 4.1.
- `dar_baixa_lote_cartao` — `security invoker` (herda permissões do usuário chamador). Não escala privilégios.
- Gate de UI: admin ou financeiro, mesmo padrão de `contas-bancarias` e das actions de baixa existentes.

## 9. Riscos e mitigações

**Risco 1 — Materialização da recorrência atrasa a fatura**
Se cron roda dia 20 e vencimento da fatura é dia 15, ocorrência entra na fatura do mês seguinte. Comportamento correto (fatura de junho já fechou), mas pode surpreender. Mitigação: aviso no drawer da recorrência com cartão + valor calculado exibido em preview.

**Risco 2 — Backfill de `forma_pagamento` "escondido"**
Alguém rodando uma migration futura pode assumir que a coluna já está preenchida e definir NOT NULL. Mitigação: comentário no schema (`comment on column pedidos_compra.forma_pagamento is 'Nullable pra preservar títulos anteriores a 20/08/2026 — não converter em NOT NULL sem backfill explícito.'`).

**Risco 3 — Constraint check bloqueia edições legítimas**
Editar PP existente sem `forma_pagamento` continua válido (`NULL` + `cartao_credito_id IS NULL` satisfaz o `distinct from`). Cobertura testada explicitamente no plano.

**Risco 4 — Performance da nova aba**
Query agrega 3 fontes filtradas por cartão. Índices parciais em `(tenant_id, cartao_credito_id) where cartao_credito_id is not null` garantem que a busca não faça full scan. Página segue o padrão `Promise.all` de `contas-a-pagar/page.tsx`.

**Risco 5 — Seleção múltipla entre cartões diferentes**
UX complexa se permitir. Decisão: só um cartão por vez na baixa em lote (baixa em lote É uma fatura). Selecionar em outro cartão limpa a seleção anterior com aviso visível.

## 10. Não-objetivos

Fora deste escopo, ficam para próximas fases:

1. Tabela `faturas_cartao` com fechamento/vencimento próprios. MVP usa `data_pagamento` como aproximação de "data da fatura".
2. `dia_fechamento` no cadastro do cartão. Cobrível manualmente ajustando `data_pagamento` no form.
3. `data_compra` separada de `data_pagamento`. Se um dia o comercial pedir análise por data de compra, coluna aditiva.
4. Estorno em lote de baixa de cartão. Continua por título individual (aba "Títulos Pagos" comum).
5. Import de fatura CSV do banco / OCR de fatura. YAGNI.
6. Limite de crédito por cartão / alerta de estouro. YAGNI.

## 11. Ordem de implementação

Sequência que minimiza risco (cada passo é commit isolado com migration + código + tipos):

1. Migration 1 (enum + tabela `cartoes_credito`) + `lib/types.ts` + página `/cadastros/cartoes-credito`.
2. Migration 2 (colunas + constraints nas 3 tabelas) + `lib/types.ts`.
3. Helper `lib/cartoes/proxima-fatura.ts` + testes unitários.
4. Componente `FormaPagamentoField` + integração nos 3 formulários + Zod discriminated union.
5. Migration 3 (ajuste em `gerar_ocorrencias_recorrentes`).
6. Migration 4 (RPC `dar_baixa_lote_cartao`) + action `darBaixaLoteCartao`.
7. Aba "Títulos a Pagar (Cartão)" + `titulos-cartao-list.tsx` + `baixa-lote-cartao-dialog.tsx` + filtro na aba comum + posição no `ContasPagarTabs`.
8. Verificação manual end-to-end no browser: cadastro de cartão, criação de PP no cartão, materialização de recorrência de cartão, baixa em lote, aparição em "Títulos Pagos".
