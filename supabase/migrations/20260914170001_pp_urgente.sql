-- ===========================================================================
-- A PP pode ser marcada como pagamento urgente, com justificativa
-- ===========================================================================
-- Pedido do Tiago em 14/09/2026, aprovado no desenho da decisão 077.
--
-- A produção marca a PP como urgente ao gerar ou editar, e justifica. O
-- financeiro vê a marca no topo da lista de aprovação e na tela da PP, e
-- ela continua depois de aprovada: o título nasce urgente e sobe em
-- Títulos a Pagar (pergunta 4a). A urgência NÃO libera prazo fora das
-- janelas de pagamento (pergunta 2a) — quem antecipa é o financeiro, ao
-- escolher a data na aprovação, que continua livre (pergunta 3a).
--
-- Por que constraint, e não só a tela: "urgente sem justificativa" é um
-- estado que nenhuma tela deve conseguir produzir, e o banco tem mais de
-- uma porta (gerar, editar, reenviar). O mínimo de 10 caracteres é o
-- mesmo do motivo de rejeição (pergunta 7a).
--
-- `urgente_por`/`urgente_em` guardam quem MARCOU e quando — editar a
-- justificativa de uma PP que já era urgente não troca o autor. Desmarcar
-- zera os quatro campos juntos.
--
-- Aditivo: as PPs existentes nascem não urgentes (default false), e
-- nenhum dado muda. RLS e GRANT já cobrem a tabela; colunas novas herdam.

alter table public.pedidos_compra
  add column if not exists urgente boolean not null default false,
  add column if not exists urgente_justificativa text,
  add column if not exists urgente_por uuid references public.profiles(id),
  add column if not exists urgente_em timestamptz;

alter table public.pedidos_compra
  drop constraint if exists pedidos_compra_urgente_justificada;

alter table public.pedidos_compra
  add constraint pedidos_compra_urgente_justificada
  check (
    not urgente
    or (
      urgente_justificativa is not null
      and char_length(btrim(urgente_justificativa)) >= 10
    )
  );

-- A lista de aprovação e Títulos a Pagar ordenam pelas urgentes primeiro;
-- são poucas, então o índice parcial é pequeno.
create index if not exists idx_pedidos_compra_urgentes
  on public.pedidos_compra (tenant_id)
  where urgente;

create index if not exists idx_pedidos_compra_urgente_por
  on public.pedidos_compra (urgente_por);

comment on column public.pedidos_compra.urgente is
  'Pagamento urgente, marcado pela produção (decisão 077). Não libera prazo fora das janelas: quem antecipa é o financeiro, na aprovação.';
comment on column public.pedidos_compra.urgente_justificativa is
  'Por que é urgente. Obrigatória (mín. 10 caracteres) quando urgente — ver a constraint pedidos_compra_urgente_justificada.';
comment on column public.pedidos_compra.urgente_por is
  'Quem marcou a PP como urgente. Editar a justificativa não troca o autor.';
comment on column public.pedidos_compra.urgente_em is
  'Quando a PP foi marcada como urgente.';
