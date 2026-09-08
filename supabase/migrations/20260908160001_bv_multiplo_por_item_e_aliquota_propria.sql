-- =====================================================================
-- O BV deixa de ser um por item, e ganha alíquota própria
--
-- Decisão do Tiago em 08/09/2026 (docs/decisions/062). Três mudanças que
-- andam juntas porque mexem no mesmo registro:
--
-- 1. VÁRIOS BVs POR ITEM. Um item pode ter mais de uma comissão a
--    negociar, e cada uma anda sozinha — como as PPs do item já fazem
--    desde a decisão 039. O painel "BV do item" vira lista, e o que a
--    planilha desconta do REALIZADO é a SOMA dos BVs que já contam.
--
--    Era `uniq_bv_item` / `uniq_bv_por_copia` que impediam isso: índices
--    ÚNICOS em `item_versao_id` e `job_item_orcado_id`. Eles caem e
--    voltam como índices comuns — a consulta continua sendo "os BVs
--    deste item", e sem índice ela vira seq scan em toda planilha
--    (anti-padrão de docs/PERFORMANCE.md).
--
--    Isto AFROUXA uma restrição: nenhuma linha existente deixa de caber.
--    Os 16 BVs de hoje seguem válidos, um por item, como estavam.
--
-- 2. ALÍQUOTA PRÓPRIA. Até aqui o imposto do BV saía de
--    `versoes_orcamento.percentual_imposto` — a alíquota do job — e o
--    formulário só a exibia. Agora ela é campo DO BV, `null` enquanto se
--    negocia, e exigida no Confirmar, que é o envio ao contas a receber.
--    Nullable de propósito: é isso que permite ela "faltar" e o
--    Confirmar cobrar.
--
--    Mesma precisão de `versoes_orcamento.percentual_imposto`
--    (numeric(10,6)) — 19,53 e 19,54 precisam ser números diferentes
--    (decisão 006).
--
-- 3. O QUE A PLANILHA DESCONTA VIRA O BRUTO. Isso não é DDL: mora em
--    `lib/calculos/bv-planilha.ts`. Fica registrado aqui porque explica
--    por que a alíquota deixou de ser obrigatória — ela não alimenta
--    mais número de planilha nenhum, só o que o financeiro emite.
--
-- Aditiva, com uma ressalva: os dois índices únicos são REMOVIDOS. Não
-- se perde dado — uma restrição some, e o Tiago autorizou explicitamente
-- em 08/09/2026, no plano validado antes da implementação.
-- =====================================================================

-- ------------------------------------------- 1. vários BVs por item
-- `uniq_bv_item` nasceu como CONSTRAINT e `uniq_bv_por_copia` como
-- índice único solto. Cada um sai pela porta que o criou: `drop index`
-- num índice que sustenta constraint é recusado pelo Postgres.
alter table public.itens_bv drop constraint if exists uniq_bv_item;
drop index if exists public.uniq_bv_item;
alter table public.itens_bv drop constraint if exists uniq_bv_por_copia;
drop index if exists public.uniq_bv_por_copia;

-- Voltam como índices comuns: "os BVs deste item" é a consulta de toda
-- planilha que mostra a dedução, e ela roda por item.
create index if not exists idx_itens_bv_item_versao
  on public.itens_bv(item_versao_id);
create index if not exists idx_itens_bv_job_item_orcado
  on public.itens_bv(job_item_orcado_id);

-- ------------------------------------------------ 2. alíquota própria
alter table public.itens_bv
  add column if not exists percentual_imposto numeric(10,6);

comment on column public.itens_bv.percentual_imposto is
  'Alíquota do imposto DESTE BV, em pontos percentuais (19.53 = 19,53%). Nula enquanto o BV é negociado; obrigatória para confirmar, que é o envio ao contas a receber (decisão 062, 08/09/2026). Não alimenta a planilha: o que o REALIZADO desconta passou a ser o BV bruto.';

-- Alíquota negativa ou acima de 100% não é imposto; deixar passar
-- produziria um BV líquido maior que o bruto na tela do financeiro.
alter table public.itens_bv
  drop constraint if exists chk_bv_percentual_imposto_faixa;
alter table public.itens_bv
  add constraint chk_bv_percentual_imposto_faixa
  check (percentual_imposto is null
         or (percentual_imposto >= 0 and percentual_imposto < 100));

-- Confirmar sem alíquota é o que a Server Action recusa em português. A
-- constraint é a segunda linha: `situacao` também se move por trigger
-- (a baixa do título leva a `recebido`), e ali não passa Server Action
-- nenhuma.
alter table public.itens_bv
  drop constraint if exists chk_bv_confirmado_tem_aliquota;
alter table public.itens_bv
  add constraint chk_bv_confirmado_tem_aliquota
  check (situacao not in ('confirmado', 'recebido')
         or percentual_imposto is not null);

comment on table public.itens_bv is
  'Comissão do fornecedor por item de custo A, A · Repasse ou D. Vários por item desde 08/09/2026 (decisão 062); cada um com fornecedor, valor, prazo, alíquota e situação próprios.';
