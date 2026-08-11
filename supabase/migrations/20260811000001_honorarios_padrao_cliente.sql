-- =====================================================================
-- Honorários padrão por cliente
--
-- Decisão do time (11/08/2026): o percentual de honorários deixa de ser
-- um campo digitado a cada orçamento e passa a ser atributo do CLIENTE.
-- Todo orçamento/versão nasce com o percentual do cadastro do cliente,
-- travado nas telas de criação. Alterar só é possível pelo botão
-- "Editar" da tela da versão, e só para role `administrador`.
--
-- Por que a coluna fica em `clientes` e não numa tabela nova: é um único
-- valor por cliente, sem histórico próprio nem vigência. O histórico do
-- que foi efetivamente usado já vive em `versoes_orcamento`, que continua
-- guardando o percentual do momento em que a versão nasceu — não há
-- propagação retroativa quando o cadastro do cliente muda.
--
-- Default 12%: valor combinado como padrão comercial da agência. Cobre
-- também o backfill dos clientes que já existem (o ALTER preenche as
-- linhas existentes com o default).
-- =====================================================================

-- 1) Coluna no cliente -------------------------------------------------
alter table public.clientes
  add column if not exists percentual_honorarios_padrao numeric(6, 3) not null default 12;

comment on column public.clientes.percentual_honorarios_padrao is
  'Percentual de honorários padrão do cliente. Nasce em toda versão de orçamento do cliente e só administrador altera na versão. Não propaga para versões já criadas.';

-- Mesma faixa do check de `versoes_orcamento.percentual_honorarios`.
alter table public.clientes
  drop constraint if exists clientes_honorarios_padrao_faixa;
alter table public.clientes
  add constraint clientes_honorarios_padrao_faixa
  check (
    percentual_honorarios_padrao >= 0
    and percentual_honorarios_padrao <= 100
  );

-- 2) Versões ainda editáveis passam a usar o percentual do cliente -----
--
-- Escopo deliberado: só `rascunho`, `em_revisao` e `enviada_cliente`.
-- `aprovada` é a base do job e nunca muda; `reprovada`, `substituida` e
-- `cancelada` são histórico fechado — reescrever o percentual delas
-- mudaria o número de propostas já encerradas.
update public.versoes_orcamento v
set percentual_honorarios = c.percentual_honorarios_padrao,
    updated_at = now()
from public.orcamentos o
join public.projetos p on p.id = o.projeto_id
join public.clientes c on c.id = p.cliente_id
where v.orcamento_id = o.id
  and v.tenant_id = c.tenant_id
  and v.status in ('rascunho', 'em_revisao', 'enviada_cliente')
  and v.percentual_honorarios is distinct from c.percentual_honorarios_padrao;

-- 3) Permissões --------------------------------------------------------
-- A tabela já é lida e escrita por `authenticated` via as policies de
-- `clientes` (Task 002). Grant repetido aqui porque coluna nova em
-- Postgres herda o grant de tabela, mas o projeto trata GRANT explícito
-- como parte do contrato de toda migration.
grant select, insert, update on public.clientes to authenticated;
