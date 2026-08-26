# PP de Verba de Produção — Design

**Data:** 2026-08-26
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

Alguns Pedidos de Produção não são pagos ao fornecedor — são pagos **ao gerente responsável**, que fica com o dinheiro em mãos e o gasta ao longo de um período de produção (compras miúdas, deslocamentos, materiais de última hora). Ao fim do período, se sobrou dinheiro, ele **devolve** o saldo. É a chamada **PP de Verba de Produção**.

Duas peculiaridades dobram esse fluxo em cima do fluxo padrão de PP:

- **Não tem fornecedor.** O `fornecedor_id` obrigatório de `pedidos_compra` não faz sentido. O que existe é um **responsável** (funcionário da empresa) que assume o dinheiro.
- **Depois de paga, precisa de prestação de contas.** Passado o período, o responsável entra na PP, declara **quanto gastou** e anexa as NFs como comprovante. A diferença entre o valor da PP e o gasto declarado vira **devolução** — um "título negativo" que aparece em Contas a Pagar e precisa ser baixado quando o dinheiro cair de volta na conta.

Hoje esse fluxo simplesmente não existe no sistema. Verbas de produção são tratadas manualmente fora do ERP ou empurradas como PPs regulares com o gerente cadastrado como "fornecedor" — o que polui a base de fornecedores e não deixa rastro do que efetivamente foi gasto.

Esta spec introduz o subtipo **Verba de Produção** de PP e o ciclo completo de prestação de contas + devolução.

## 2. Objetivo

Entregar em 4 frentes:

1. **Extensão de `pedidos_compra`** — flag `verba_producao` + `responsavel_verba_id` + constraint condicional que faz `fornecedor_id` opcional quando é verba (e proibido quando não é). Sem impacto no fluxo normal de PP.
2. **Nova entidade `pp_verba_prestacoes`** + tabela de anexos — registro imutável (não reabrível) da prestação de contas, com valor gasto declarado + N NFs anexadas.
3. **Nova entidade `pp_verba_devolucoes`** — o "título negativo" que aparece em Contas a Pagar quando a prestação apura sobra. Baixa própria (RPC), lançamento com origem `pp_devolucao_verba`.
4. **Integração com telas existentes:**
   - Form de emissão de PP ganha switch "Verba de Produção" que troca o combo Fornecedor pelo combo Responsável.
   - Drawer/página da PP ganha aba "Prestação de contas" quando aplicável.
   - Aba Títulos a Pagar (via view `vw_a_pagar`) passa a incluir devoluções como origem nova, com badge e cor específicos.

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes desta spec.

### 3.1. Verba não é entidade nova — é subtipo de PP

Rejeitado criar `pedidos_verba` como tabela separada:
- Fluxo de emissão, aprovação, parcelas e baixa é **idêntico** ao de PP normal (mesmo formulário, mesmas parcelas, mesma RPC de baixa, mesmo pipeline de aprovação financeira).
- Duplicar a máquina toda pra mudar 2 campos (fornecedor → responsável) e adicionar 1 aba (prestação) seria muita cópia sem ganho de clareza.
- Verbas de produção são raras — não justificam entidade paralela.

Custo real: 2 colunas novas em `pedidos_compra` + 1 constraint condicional + ajuste do form de emissão pra trocar o campo condicionalmente. Views e RPCs existentes continuam funcionando sem tocar (fornecedor_id fica nullable, mas quem já lê ignora null naturalmente).

### 3.2. Prestação de contas é imutável (sem reabertura no MVP)

Fechou, fechou. Se depois descobrir que o valor estava errado, o caminho é estornar o lançamento da devolução (função `estornar_baixa_devolucao_verba`, que restaura a devolução como aguardando baixa) e a partir daí ver o que fazer — mas prestação em si não reabre.

Motivos:
- Fluxo simples pro MVP; reabertura implicaria estornar devolução automaticamente, permitir editar valor gasto, permitir remover NFs anexadas — muita máquina pra caso raro.
- Prestação é um evento contábil: no dia que a empresa reconhece "esses R$ 40k foram gastos", esse reconhecimento não deveria ser trivialmente editável.

### 3.3. Usuário digita o total gasto — sistema não soma NFs individuais

No MVP, NFs entram só como **arquivos anexados** (sem valor individual, sem número de NF estruturado, sem fornecedor real cadastrado). O responsável **digita um valor único** ("gastei R$ 40.000,00") e faz upload das NFs como prova.

Motivos:
- Requerer cadastro estruturado de cada NF (número, fornecedor, valor, data) forçaria fluxo pesado de captura pra uma quantidade grande de comprovantes miúdos.
- No fluxo real, o financeiro conferirá as NFs anexadas contra o valor declarado — a conferência é humana no MVP.
- Se depois quisermos estruturar cada NF, é aditivo (novas colunas em `pp_verba_prestacoes_anexos`, sem quebrar o que já foi feito).

Regra dura: `valor_gasto > 0 AND valor_gasto <= pp.valor` (validado na RPC). Se `valor_gasto > pp.valor`, bloqueia — MVP não trata "gastou mais que o adiantado".

### 3.4. Devolução tem tabela própria (não reusar `contas_avulsas`)

Rejeitado usar `contas_avulsas` com `natureza='entrada'` e vínculo à PP:
- `contas_avulsas` é o "vale-tudo" pra despesas administrativas de fora do sistema — devolução vem **de dentro**, de uma PP e prestação específicas.
- Rastreabilidade ficaria frouxa: sem FK direto pra prestação, o vínculo viraria texto em `descricao` ou joins improvisados.
- Espalharia condicionais "se é do tipo devolução de verba" em várias regras de avulsa (approval, campos obrigatórios, etc.).
- Precedente do projeto: **Desembolsos** (spec de 2026-08-20) também teve tabela dedicada em vez de tentar reusar avulsa.

Custo: +1 tabela + 1 RPC de baixa + 1 união na view `vw_a_pagar` + tratamento do novo `origem_tipo` no componente da lista. Sem impacto em fluxos existentes.

### 3.5. Devolução não passa por aprovação — nasce pronta pra baixar

Aprovação existe pra autorizar **saída** de dinheiro. Devolução é **entrada** — o ato de fechar a prestação já é a autorização (quem fecha confere as NFs e valida o número). No dia que o TED do gerente cai, o financeiro clica em baixar (data + conta) e o lançamento entra.

### 3.6. Origem nova `pp_devolucao_verba` em `lancamentos_financeiros`

Ampliar o enum `origem_lancamento` (ou o CHECK, dependendo de como está modelado — a migration confere) pra aceitar `pp_devolucao_verba`. Vinculado a `pedido_compra_id` (já existente) + `pp_verba_devolucao_id` (nova FK opcional em `lancamentos_financeiros`).

Views que somam custo da PP no realizado do job (planilha REALIZADO, agregado do projeto) passam a incluir esse origem como **redutor** — o custo efetivo da PP para o job é `soma(pp_baixa) - soma(pp_estorno) - soma(pp_devolucao_verba)`.

### 3.7. Responsável = `profiles` do tenant

Rejeitado criar tabela nova de "gerentes responsáveis":
- Já existe `profiles` com os usuários do tenant.
- Qualquer profile do tenant pode ser responsável (o gerente que a PP nomeia).
- Filtrar por permissão (só admin/gestor?) fica pra fase posterior — no MVP, qualquer profile do tenant é elegível.

Coluna: `responsavel_verba_id uuid references profiles(id) on delete restrict`.

## 4. Modelo de dados

### 4.1. Migration `20260826000001_pp_verba_producao_pp.sql`

**Alter em `pedidos_compra`:**

```sql
alter table public.pedidos_compra
  add column if not exists verba_producao boolean not null default false,
  add column if not exists responsavel_verba_id uuid references public.profiles(id) on delete restrict,
  alter column fornecedor_id drop not null;

-- Regra dupla: verba <=> tem responsável, sem fornecedor; não-verba <=> sem responsável, tem fornecedor.
alter table public.pedidos_compra
  add constraint chk_pp_verba_producao_coerencia check (
    (verba_producao = true  and fornecedor_id is null     and responsavel_verba_id is not null) or
    (verba_producao = false and fornecedor_id is not null and responsavel_verba_id is null)
  );

create index if not exists idx_pp_responsavel_verba
  on public.pedidos_compra(responsavel_verba_id)
  where verba_producao = true;
```

Backfill: nada a fazer. PPs existentes já têm `fornecedor_id` preenchido e `verba_producao` nasce `false` pelo default — a constraint é satisfeita sem tocar em linha nenhuma.

### 4.2. Migration `20260826000002_pp_verba_prestacoes.sql`

**Tabela `pp_verba_prestacoes`:**

```sql
create table public.pp_verba_prestacoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id      uuid not null references public.pedidos_compra(id) on delete restrict,
  valor_gasto           numeric(14,2) not null,
  valor_devolvido       numeric(14,2) not null,
  fechada_em            timestamptz not null default now(),
  fechada_por           uuid not null references public.profiles(id),

  constraint uniq_prestacao_por_pp unique (pedido_compra_id),
  constraint chk_prestacao_valor_gasto_positivo check (valor_gasto > 0),
  constraint chk_prestacao_valor_devolvido_nao_negativo check (valor_devolvido >= 0)
);

create index idx_pp_verba_prestacoes_tenant on public.pp_verba_prestacoes(tenant_id);
```

**Tabela `pp_verba_prestacoes_anexos`:**

```sql
create table public.pp_verba_prestacoes_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  prestacao_id          uuid not null references public.pp_verba_prestacoes(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),

  constraint chk_prestacao_anexo_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index idx_pp_verba_prestacoes_anexos_prestacao
  on public.pp_verba_prestacoes_anexos(prestacao_id);
```

**RLS + GRANT** (mesmo padrão do resto do projeto: policy `is_tenant_member`, grant só pra `authenticated`, nada pra `anon`, sem GRANT de DELETE em anexos — cascade apaga se a prestação for removida por retrabalho manual do DBA).

### 4.3. Migration `20260826000003_pp_verba_enum_lancamentos.sql`

Amplia o enum `origem_lancamento` — **migration separada** porque `ADD VALUE` precisa commitar antes de ser usado em constraints (mesmo padrão da migration `20260820000007_desembolso_enum_lancamentos.sql`).

```sql
alter type origem_lancamento add value if not exists 'pp_devolucao_verba';
alter type origem_lancamento add value if not exists 'pp_devolucao_verba_estornada';
```

### 4.4. Migration `20260826000004_pp_verba_devolucoes.sql`

**Tabela `pp_verba_devolucoes`:**

```sql
create table public.pp_verba_devolucoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,
  prestacao_id          uuid not null references public.pp_verba_prestacoes(id) on delete restrict,
  pedido_compra_id      uuid not null references public.pedidos_compra(id) on delete restrict,
  valor                 numeric(14,2) not null,

  -- Data prevista de crédito. Nasce igual à data em que a prestação foi
  -- fechada — o financeiro repactua depois pelo mesmo lápis das outras
  -- linhas da aba Títulos a Pagar (função existente de repactuação será
  -- estendida pra aceitar essa origem — ver §5.2).
  data_pagamento        date not null,
  data_pagamento_primeira date not null,

  pago_em               date,
  pago_por              uuid references public.profiles(id),
  lancamento_id         uuid references public.lancamentos_financeiros(id) on delete restrict,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uniq_devolucao_por_prestacao unique (prestacao_id),
  constraint chk_devolucao_valor_positivo check (valor > 0)
);

create index idx_pp_verba_devolucoes_tenant on public.pp_verba_devolucoes(tenant_id);
create index idx_pp_verba_devolucoes_a_baixar
  on public.pp_verba_devolucoes(tenant_id, data_pagamento)
  where pago_em is null;
```

Trigger de `updated_at` e trigger `congela_data_pagamento_primeira` (função já existe, é reutilizada — a assinatura é genérica, funciona sem alteração).

**FK opcional em `lancamentos_financeiros`:**

```sql
alter table public.lancamentos_financeiros
  add column if not exists pp_verba_devolucao_id uuid
    references public.pp_verba_devolucoes(id) on delete restrict;

create index idx_lancamentos_pp_verba_devolucao
  on public.lancamentos_financeiros(pp_verba_devolucao_id);
```

CHECKs existentes (`chk_origem_tem_referencia`, `chk_origem_contraparte_tem_id`) precisam aceitar a nova origem apontando pra `pp_verba_devolucao_id` — a migration ajusta.

## 5. RPCs

### 5.1. `fechar_prestacao_verba_pp`

Assinatura:

```sql
fechar_prestacao_verba_pp(
  p_pp_id       uuid,
  p_valor_gasto numeric,
  p_fechada_por uuid
) returns uuid  -- id da prestação criada
```

Faz atomicamente:

1. Valida PP: existe, tenant, `verba_producao=true`, status `pago`, sem prestação prévia (unique já garante, mas o erro é mais claro se checar antes).
2. Valida `p_valor_gasto`: `> 0 AND <= pp.valor`.
3. Calcula `valor_devolvido = pp.valor - p_valor_gasto`.
4. Insere `pp_verba_prestacoes`.
5. Se `valor_devolvido > 0`: insere `pp_verba_devolucoes` com `data_pagamento = current_date` (financeiro repactua se quiser).
6. Retorna `prestacao_id`.

**Anexos entram fora da RPC**, pelo server action que chama esta função — mesmo padrão da emissão de PP (upload no Storage + insert direto em `pp_verba_prestacoes_anexos` antes de chamar a RPC, com `prestacao_id` gerado pelo RETURNING; ou depois, se preferir criar a prestação primeiro e anexar por cima — a migration não impõe).

Servrer action garante `>=1 anexo` — não é constraint de tabela.

### 5.2. `dar_baixa_devolucao_verba`

Assinatura:

```sql
dar_baixa_devolucao_verba(
  p_devolucao_id           uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid
) returns uuid  -- id do lançamento
```

Estrutura idêntica à `dar_baixa_pp_parcela`, adaptada:

1. Valida devolução: existe, tenant, `pago_em is null`.
2. Valida conta bancária: existe, pertence à empresa da devolução, ativa, `p_pago_em >= saldo_inicial_data`.
3. Valida subtipo pertence ao tipo (mesma checagem que existe hoje).
4. Insere `lancamentos_financeiros` com:
   - `natureza = 'entrada'`
   - `origem = 'pp_devolucao_verba'`
   - `pp_verba_devolucao_id = p_devolucao_id`
   - `pedido_compra_id = devolucao.pedido_compra_id` (satisfaz CHECK existente)
   - `descricao = 'Devolução de verba ' || pp.codigo || ' — ' || substring(pp.servico, 1, 140)`
5. Atualiza devolução: `pago_em`, `pago_por`, `lancamento_id`.
6. Retorna `lancamento_id`.

### 5.3. `estornar_baixa_devolucao_verba`

Espelho de `estornar_baixa_pp_parcela`:

```sql
estornar_baixa_devolucao_verba(
  p_devolucao_id uuid,
  p_motivo       text,
  p_criado_por   uuid
) returns uuid  -- id do lançamento reverso
```

1. Valida: devolução paga, motivo não vazio, tenant.
2. Encontra lançamento original (via `devolucao.lancamento_id`).
3. Insere lançamento reverso: `natureza='saida'` (inverte entrada), `origem='pp_devolucao_verba_estornada'` (nova — mesmo padrão de `pp_baixa_estornada`), `estorno_de_lancamento_id=<original>`.
4. Marca lançamento original como estornado (mesmo padrão: muda `origem` pra `pp_devolucao_verba_estornada`).
5. Devolve devolução ao estado "aguardando baixa": limpa `pago_em`, `pago_por`, `lancamento_id`.

**Ver §3.2 — este RPC é a única forma de "corrigir" uma prestação errada.**

## 6. Extensão da view `vw_a_pagar`

Nova UNION ALL:

```sql
union all

select
  'pp_devolucao_verba'::text                    as origem_tipo,
  d.id                                          as origem_id,
  d.tenant_id,
  d.empresa_id,
  d.data_pagamento                              as data_prevista,
  d.valor                                       as valor,
  'entrada'::natureza_lancamento                as natureza,
  'Devolução verba ' || pp.codigo || ' — '
    || substring(pp.servico, 1, 140)            as descricao,
  null::uuid                                    as fornecedor_id,
  null::uuid                                    as cliente_id,
  pp.job_id,
  null::timestamptz                             as aprovada_em,
  null::uuid                                    as aprovada_por
from public.pp_verba_devolucoes d
join public.pedidos_compra pp on pp.id = d.pedido_compra_id
where d.pago_em is null
```

Mesma extensão em `vw_fluxo_caixa` — devolução em aberto entra como previsto (entrada); depois de baixada, entra pelo ramo `realizado` normal (lançamento).

## 7. UI

### 7.1. Emissão de PP

`app/(app)/jobs/[jobId]/realizado/emitir-pp-drawer.tsx` (ou o componente equivalente) ganha:

- **Switch "Verba de Produção"** no topo do formulário.
- Quando OFF (default): campo Fornecedor visível e obrigatório (comportamento atual).
- Quando ON:
  - Campo Fornecedor some.
  - Campo **Responsável** aparece — combo de profiles do tenant.
  - Header do PDF gerado passa a estampar "Verba de Produção — Responsável: {Nome}" no lugar dos dados do fornecedor.

Nenhuma outra parte do form muda (parcelas, valor, prazo, anexos, tudo igual).

### 7.2. Página / drawer da PP

Onde hoje aparece "Fornecedor: X", passa a aparecer condicional:
- Não-verba: "Fornecedor: {nome}" (igual)
- Verba: badge "Verba de Produção" + "Responsável: {nome do profile}"

**Aba nova "Prestação de contas"** aparece só quando `verba_producao = true`. Estados:

- **PP ainda não paga** (`status != 'pago'`): aba visível, mas conteúdo é um card informativo "A prestação de contas só pode ser feita após a PP estar totalmente paga."
- **PP paga, prestação ainda não feita**: botão grande "Prestar contas" → abre dialog (7.3).
- **Prestação já feita**: card readonly com:
  - "Fechada em {data} por {profile}"
  - "Valor da PP: R$ X | Gasto declarado: R$ Y | Devolvido: R$ Z"
  - Lista de NFs anexadas (linha clicável → download do arquivo)
  - Se `valor_devolvido > 0`: link "Ver devolução em Contas a Pagar" (leva pra aba Títulos a Pagar filtrando por essa devolução)

### 7.3. Dialog "Prestar contas"

Campos:

- **Valor gasto** (numeric, máscara R$, obrigatório) — validação client: `> 0 && <= pp.valor`.
- **Notas fiscais** (uploader multi-arquivo, obrigatório ≥1) — mesmo padrão de anexos de PP.
- **Resumo em tempo real** (card à direita ou embaixo):
  - Valor da PP: R$ X (readonly)
  - Gasto: R$ Y (do input)
  - **Devolução: R$ Z** (calculado, destacado)
- Botão principal:
  - Se `Z == 0`: "Fechar prestação (sem devolução)"
  - Se `Z > 0`: "Fechar prestação e gerar devolução de R$ Z"
- Botão secundário "Cancelar".

Warning antes de confirmar: "Prestação não pode ser reaberta depois de fechada. Confirme os valores e as NFs antes de continuar."

### 7.4. Aba Títulos a Pagar (`app/(app)/financeiro/contas-a-pagar/titulos-pagar-list.tsx`)

O componente já itera sobre `origem_tipo` (hoje: `pp`, `avulsa`, `recorrente`, `desembolso`). Ganha caso novo `pp_devolucao_verba`:

- **Badge**: "Devolução verba" (cor específica — verde-escuro pra diferenciar do laranja/azul das saídas).
- **Valor**: exibido como `+R$ X` em verde (é entrada, não saída).
- **Descrição**: "Devolução verba PP-XXXX — {servico}"
- **Fornecedor**: em branco (não tem).
- **Job**: nome do job da PP (link como as outras linhas de PP).
- **Ação de baixa**: mesmo modal de baixa das outras origens, mas com título "Baixar devolução" e labels adaptados ("Data em que o dinheiro caiu na conta", "Conta que recebeu").

O componente `BaixaRegistradaDialog` também precisa suportar visualizar/estornar essa origem — mesmo padrão dos demais.

### 7.5. Filtro/ordenação

A aba Títulos a Pagar hoje ordena por `data_pagamento`. Devoluções entram na ordenação normalmente — nada especial.

## 8. Impacto em views/agregados existentes

### 8.1. Realizado do job / planilha REALIZADO

O custo efetivo de uma PP no realizado é `saidas - entradas` filtrando por `pedido_compra_id`. Como a devolução é entrada com esse `pedido_compra_id`, o cálculo já reduz o custo automaticamente — sem mudar a query, se ela estiver somando por natureza.

**Confirmar durante implementação:** as queries que hoje montam o realizado por PP consideram entrada/saída (net) ou só saídas? Se só saídas, ajustar pra fazer o net.

### 8.2. DRE / Fluxo de caixa

Devolução baixada entra em `lancamentos_financeiros` como entrada normal — o fluxo de caixa realizado já a mostra sem mudança.

Devolução em aberto (não baixada) entra na `vw_fluxo_caixa` pelo ramo `previsto` (ver §6). Sem mudança na leitura.

### 8.3. RPCs de baixa/estorno de PP existentes

Nenhuma. `dar_baixa_pp_parcela` e `estornar_baixa_pp_parcela` não sabem nada sobre verba/devolução. A PP em si segue idêntica.

## 9. Fora de escopo (MVP)

Registrados aqui pra que ninguém "adicione depois" achando que a spec esqueceu:

- **Reabertura de prestação** — se errou, estorna a devolução e é isso.
- **NFs como entidades estruturadas** — no MVP são só arquivos anexos, sem número/fornecedor/data/valor por NF.
- **Prestação parcial** durante o período — só uma prestação, no fim, depois da PP paga.
- **Bloqueio quando `valor_gasto > valor_pp`** — bloqueia mesmo, não gera "estouro a pagar" pro responsável.
- **Compensar devolução com PP futura** — devolução é sempre cash de volta na conta, pelo pipeline de baixa.
- **Permissão granular pra "quem pode ser responsável"** — no MVP, qualquer profile do tenant.
- **Notificações** (email/whatsapp) pra lembrar o responsável de prestar contas.
- **PDF diferente pra PP de verba** — mesmo PDF, só muda o cabeçalho (Fornecedor → Responsável).

## 10. Testes / verificação

Antes de considerar cada migration aplicada:

- `list_tables` confirma as colunas/tabelas/índices novos.
- Advisor `anon_security_definer_function_executable` limpo (todas as RPCs novas com `revoke execute from public` + `grant execute to authenticated`).
- PP existente (não-verba) continua satisfazendo a constraint condicional — testar com um SELECT que faria falhar se `fornecedor_id` estivesse `null` numa PP não-verba.
- Emitir PP de verba, aprovar, baixar todas as parcelas, prestar contas, baixar devolução — fluxo E2E manual antes de merge.
- Estornar devolução, confirmar que a devolução volta a "aguardando baixa" e reaparece em Títulos a Pagar.
- Verificar que planilha REALIZADO do job mostra o custo NET da PP (com a devolução reduzindo).

## 11. Ordem de implementação sugerida (o plano detalhado sai pelo skill `writing-plans` depois)

1. Migration 4.1 (colunas em `pedidos_compra` + constraint) + tipo TS + ajuste do form de emissão.
2. Migration 4.2 (`pp_verba_prestacoes` + anexos).
3. RPC 5.1 (`fechar_prestacao_verba_pp`) + server action + dialog de prestação (§7.3).
4. Migration 4.3 (enum `origem_lancamento` ampliado — separada porque `ADD VALUE` precisa commitar antes).
5. Migration 4.4 (`pp_verba_devolucoes` + FK em `lancamentos_financeiros`).
6. RPC 5.2 (`dar_baixa_devolucao_verba`) + integração com modal de baixa existente.
7. RPC 5.3 (`estornar_baixa_devolucao_verba`) + integração com `BaixaRegistradaDialog`.
8. Extensão de `vw_a_pagar` + `vw_fluxo_caixa` (§6) + tratamento do novo `origem_tipo` em `titulos-pagar-list.tsx` (§7.4).
9. Aba "Prestação de contas" no drawer/página da PP (§7.2).
10. Ajuste de exibição "Verba de Produção — Responsável X" onde antes aparecia fornecedor.
11. Verificação E2E manual (§10).
