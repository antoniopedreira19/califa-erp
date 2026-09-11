-- =====================================================================
-- Orçamento internacional — modelo de planilha na categoria
--
-- A California fecha job internacional numa planilha própria, fora do
-- ERP ("Modelo de planilha interna - Internacional 2026.xlsx"). O
-- fechamento dela tem um degrau que o nacional não tem: entre os
-- honorários (lá chamados FEE) e os impostos brasileiros existem as
-- INT TAXES, retidas no exterior, também em gross-up; e o total ainda
-- soma INT TRANSACTION COSTS.
--
--   sub-total -> fee -> int. taxes (gross-up) -> total recebido no
--   exterior -> int. transaction costs -> impostos BR (gross-up)
--   -> invoice
--
-- O QUE IDENTIFICA A PLANILHA É UM CAMPO, NÃO O NOME DA CATEGORIA.
-- `categorias_dominio` é lista que o usuário edita em
-- /orcamentos/categorias; casar a conta com a string "Internacional"
-- quebraria em silêncio no dia em que alguém renomeasse. Por isso a
-- categoria carrega `modelo_planilha`, e é ele que o código lê.
--
-- Enum, e não boolean, porque já há plano de outras categorias com
-- planilha própria: a próxima é um valor novo aqui — aditivo — em vez
-- de uma segunda coluna.
--
-- Decisão 072. Tudo nesta migration é aditivo: nenhuma coluna sai,
-- nenhum valor existente é sobrescrito.
-- =====================================================================

-- 1) enum do modelo de planilha ---------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'categoria_modelo_planilha') then
    create type public.categoria_modelo_planilha as enum ('nacional', 'internacional');
  end if;
end$$;

-- 2) a coluna na categoria --------------------------------------------
-- As categorias existentes viram 'nacional' pelo default. Não há
-- backfill: o default já é a resposta certa para todas elas.
alter table public.categorias_dominio
  add column if not exists modelo_planilha public.categoria_modelo_planilha
    not null default 'nacional';

comment on column public.categorias_dominio.modelo_planilha is
  'Qual fechamento a versão do orçamento desta categoria usa. Escrito SÓ por migration — a tela não tem controle para ele, e o trigger abaixo recusa mudança vinda de `authenticated`.';

-- 3) a categoria Internacional ----------------------------------------
-- Uma por tenant, sem id fixo. `on conflict` mantém a migration
-- idempotente e, se a categoria já existir como nacional, promove o
-- modelo sem tocar em `ativo` (que é decisão do usuário, não daqui).
insert into public.categorias_dominio (tenant_id, escopo, nome, modelo_planilha)
select t.id, 'orcamento'::public.categoria_dominio_escopo, 'Internacional',
       'internacional'::public.categoria_modelo_planilha
from public.tenants t
on conflict (tenant_id, escopo, lower(nome))
do update set modelo_planilha = 'internacional'::public.categoria_modelo_planilha;

-- 4) trava da categoria com modelo próprio -----------------------------
-- O nome e o escopo dela são contrato com o código e com o time; o
-- modelo é o que decide a conta. Nada disso pode mudar pela tela.
--
-- A trava é no BANCO, e não só na server action, porque regra crítica
-- não depende do frontend (CLAUDE.md). A porta de escape é o próprio
-- `current_user`: PostgREST faz `set role authenticated`, migration roda
-- como `postgres`. Então desenvolvedor passa, usuário não.
--
-- ⚠️ SEM `security definer`, e isso é essencial: dentro de uma função
-- SECURITY DEFINER o `current_user` passa a ser o DONO dela (postgres),
-- e a comparação abaixo nunca daria 'authenticated' — a trava existiria
-- no papel e deixaria tudo passar. Aqui não há nada a elevar: a função
-- só lê OLD e NEW.
--
-- `ativo` fica de fora de propósito: desativar é reversível, não mexe
-- em número nenhum, e é a ação legítima de "não fazemos job
-- internacional este ano".
--
-- DELETE não precisa de guarda: `categorias_dominio` nunca teve policy
-- nem grant de delete para `authenticated` (soft-delete via ativo).
create or replace function public.categoria_modelo_proprio_travado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.modelo_planilha = 'nacional' then
    return new;
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.nome is distinct from old.nome then
    raise exception
      'A categoria "%" tem modelo de planilha próprio e não pode ser renomeada.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.escopo is distinct from old.escopo then
    raise exception
      'A categoria "%" tem modelo de planilha próprio e não pode mudar de escopo.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.modelo_planilha is distinct from old.modelo_planilha then
    raise exception
      'O modelo de planilha da categoria "%" só pode ser alterado por migration.', old.nome
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.categoria_modelo_proprio_travado() is
  'Recusa renomear, mudar de escopo ou trocar o modelo de uma categoria cujo modelo_planilha não é nacional, quando a sessão é `authenticated`. Migration (postgres) passa.';

drop trigger if exists trg_categoria_modelo_proprio_travado on public.categorias_dominio;
create trigger trg_categoria_modelo_proprio_travado
  before update on public.categorias_dominio
  for each row execute function public.categoria_modelo_proprio_travado();

-- 5) parâmetros internacionais na versão -------------------------------
-- `taxa_cambio` NÃO ganha irmã de conversão: ela continua sendo a taxa
-- que converte, e no internacional é a COMPRA (é a que a planilha
-- modelo usa em B15). Duas taxas disputando a mesma coluna da planilha
-- é como a coluna passa a mostrar um número que ninguém sabe explicar.
-- Cotação e venda entram como registro de conferência.
alter table public.versoes_orcamento
  add column if not exists percentual_int_taxes  numeric(10,6) not null default 0,
  add column if not exists int_transaction_costs numeric(14,2) not null default 0,
  add column if not exists cambio_cotacao        numeric(14,6),
  add column if not exists cambio_venda          numeric(14,6),
  add column if not exists cambio_data           date;

comment on column public.versoes_orcamento.percentual_int_taxes is
  'Int. taxes retidas no exterior, em gross-up sobre (base de imposto + fee). 18,02% na planilha modelo = IR 17,64% + IOF 0,37%. Zero fora do internacional.';
comment on column public.versoes_orcamento.int_transaction_costs is
  'Custos de transação internacional, em BRL. Entram DEPOIS do total recebido no exterior e NÃO compõem a base dos impostos brasileiros (planilha modelo: G11 = G8 + G9 + G10, com G10 calculado só sobre G8).';
comment on column public.versoes_orcamento.cambio_cotacao is
  'Cotação do dia da moeda estrangeira. Registro: quem converte é `taxa_cambio` (a compra).';
comment on column public.versoes_orcamento.cambio_venda is
  'Taxa de venda. Registro de conferência; não entra em conta nenhuma.';
comment on column public.versoes_orcamento.cambio_data is
  'Data da cotação registrada em `cambio_cotacao`.';

-- 6) permissões --------------------------------------------------------
-- Sem tabela nova: as colunas herdam a RLS de `versoes_orcamento` e de
-- `categorias_dominio`. Os grants são reafirmados no nível da tabela
-- porque grant por coluna, quando existe, não cobre coluna nova.
grant select, insert, update on public.versoes_orcamento to authenticated;
grant select, insert, update on public.categorias_dominio to authenticated;
