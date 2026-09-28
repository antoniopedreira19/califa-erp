-- =====================================================================
-- Orçamento se arquiva, e o arquivado (orçamento ou projeto) é só leitura
-- =====================================================================
-- Decisão 118, do Tiago em 28/09/2026:
--   * o orçamento que se tornou irrelevante se ARQUIVA: some da visão
--     agregada e das abas do projeto, e só aparece na lista do projeto com
--     o filtro "arquivados" — como o projeto arquivado na lista de projetos;
--   * só se arquiva orçamento antes da aprovação (rascunho, em revisão, e
--     o cancelado de antes da 117). Aprovado precisa ter a aprovação
--     desfeita; com job, nunca;
--   * projeto arquivado e orçamento arquivado são SÓ LEITURA: nada se cria
--     nem se edita dentro deles até o "Reativar".
--
-- Arquivar não é status. O status do orçamento é do sistema (decisão 117);
-- o arquivamento é uma marca à parte, que guarda o status de antes intacto
-- para o Reativar.
--
-- A trava de leitura vale para a escrita de USUÁRIO — `auth.uid()` não
-- nulo —, inclusive a que passa por função `security definer` (apagar
-- versão, reordenar itens, save). Migration, cron e service role passam.
--
-- 1) `orcamentos.arquivado_em` / `arquivado_por`. O único orçamento
--    `cancelado` que existia (HIT-P001/26) nasce arquivado, como o Tiago
--    decidiu: o cancelado manual deixa de existir (117).
-- 2) Guardas:
--      * `projetos`: arquivado não se edita, só se reativa; e arquivar
--        confere a regra da 116 (nenhum orçamento aprovado ou com job,
--        nenhum job fora o cancelado antes da abertura);
--      * `projeto_regionais` e `projeto_responsaveis`: não mudam com o
--        projeto arquivado;
--      * `orcamentos`: não nasce em projeto arquivado; não se edita com o
--        projeto ou ele arquivado (só o Reativar); só se arquiva fora de
--        `aprovado` e `job_criado`, sem job vivo;
--      * versão, grupo, meses, item, importação, BV e save da versão: não
--        mudam quando o orçamento dono está só leitura.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Colunas
-- ---------------------------------------------------------------------
alter table public.orcamentos
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por uuid references public.profiles(id);

comment on column public.orcamentos.arquivado_em is
  'Quando o orçamento foi arquivado (decisão 118). Nulo = ativo. Arquivar não mexe no status: o Reativar volta ao que era.';
comment on column public.orcamentos.arquivado_por is
  'Quem arquivou (decisão 118).';

create index if not exists idx_orcamentos_arquivado_por
  on public.orcamentos (arquivado_por)
  where arquivado_por is not null;

-- O cancelado manual deixa de existir (117): o único que havia vira
-- arquivado. Preenche coluna nova; não sobrescreve nada.
update public.orcamentos
   set arquivado_em = updated_at
 where status = 'cancelado'
   and arquivado_em is null;

-- ---------------------------------------------------------------------
-- 2) Projeto
-- ---------------------------------------------------------------------
create or replace function public.projetos_guarda_arquivado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if old.status = 'arquivado' and new.status = 'arquivado' then
    raise exception 'Projeto arquivado é só leitura. Reative o projeto para editar.'
      using errcode = '42501';
  end if;

  if old.status = 'ativo' and new.status = 'arquivado' then
    if exists (
      select 1 from public.orcamentos o
       where o.projeto_id = new.id
         and o.status in ('aprovado', 'job_criado')
    ) or exists (
      select 1 from public.jobs j
       where j.projeto_id = new.id
         and (j.status <> 'cancelado' or j.data_abertura_financeiro is not null)
    ) then
      raise exception 'Este projeto tem orçamento aprovado ou job e não pode ser arquivado.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.projetos_guarda_arquivado() from public, anon;

drop trigger if exists trg_projetos_a_guarda_arquivado on public.projetos;
create trigger trg_projetos_a_guarda_arquivado
  before update on public.projetos
  for each row
  execute function public.projetos_guarda_arquivado();

create or replace function public.projeto_vinculo_guarda_arquivado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projeto uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_projeto := old.projeto_id;
  else
    v_projeto := new.projeto_id;
  end if;

  if exists (
    select 1 from public.projetos p
     where p.id = v_projeto and p.status = 'arquivado'
  ) then
    raise exception 'Projeto arquivado é só leitura. Reative o projeto para editar.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.projeto_vinculo_guarda_arquivado() from public, anon;

drop trigger if exists trg_projeto_regionais_guarda_arquivado on public.projeto_regionais;
create trigger trg_projeto_regionais_guarda_arquivado
  before insert or update or delete on public.projeto_regionais
  for each row
  execute function public.projeto_vinculo_guarda_arquivado();

drop trigger if exists trg_projeto_responsaveis_guarda_arquivado on public.projeto_responsaveis;
create trigger trg_projeto_responsaveis_guarda_arquivado
  before insert or update or delete on public.projeto_responsaveis
  for each row
  execute function public.projeto_vinculo_guarda_arquivado();

-- ---------------------------------------------------------------------
-- 3) Orçamento
-- ---------------------------------------------------------------------
create or replace function public.orcamentos_guarda_arquivado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_projeto_arquivado boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select p.status = 'arquivado'
    into v_projeto_arquivado
    from public.projetos p
   where p.id = new.projeto_id;

  if tg_op = 'INSERT' then
    if coalesce(v_projeto_arquivado, false) then
      raise exception 'Projeto arquivado não recebe orçamento novo. Reative o projeto primeiro.'
        using errcode = '42501';
    end if;
    if new.arquivado_em is not null then
      raise exception 'O orçamento nasce ativo.' using errcode = '42501';
    end if;
    return new;
  end if;

  if coalesce(v_projeto_arquivado, false) then
    raise exception 'Projeto arquivado é só leitura. Reative o projeto para editar.'
      using errcode = '42501';
  end if;

  if old.arquivado_em is not null then
    -- Arquivado só sai do arquivo: nada mais muda junto.
    if new.arquivado_em is not null then
      raise exception 'Orçamento arquivado é só leitura. Reative o orçamento para editar.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.arquivado_em is not null then
    if old.status in ('aprovado', 'job_criado') then
      raise exception 'Orçamento aprovado ou com job não se arquiva. Desfaça a aprovação antes.'
        using errcode = '42501';
    end if;
    if exists (
      select 1 from public.jobs j
       where j.orcamento_id = new.id
         and (j.status <> 'cancelado' or j.data_abertura_financeiro is not null)
    ) then
      raise exception 'Orçamento com job não se arquiva.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.orcamentos_guarda_arquivado() from public, anon;

drop trigger if exists trg_orcamentos_a_guarda_arquivado on public.orcamentos;
create trigger trg_orcamentos_a_guarda_arquivado
  before insert or update on public.orcamentos
  for each row
  execute function public.orcamentos_guarda_arquivado();

-- ---------------------------------------------------------------------
-- 4) O que mora debaixo do orçamento
-- ---------------------------------------------------------------------
-- Uma função para as sete tabelas. O gatilho diz por onde chegar ao
-- orçamento: tg_argv[0] é o degrau ('orcamento', 'versao' ou 'item') e
-- tg_argv[1] a coluna. A linha é lida por `to_jsonb` para a mesma função
-- servir a tabelas com colunas diferentes sem citar `new.<coluna>` (que
-- quebra com 42703 na tabela que não a tem).
create or replace function public.guarda_orcamento_so_leitura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref uuid;
  v_orcamento uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  v_ref := nullif(
    to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> tg_argv[1],
    ''
  )::uuid;

  -- BV e save do job não têm linha de versão: não são daqui.
  if v_ref is null then
    return coalesce(new, old);
  end if;

  if tg_argv[0] = 'orcamento' then
    v_orcamento := v_ref;
  elsif tg_argv[0] = 'versao' then
    select v.orcamento_id into v_orcamento
      from public.versoes_orcamento v
     where v.id = v_ref;
  elsif tg_argv[0] = 'item' then
    select v.orcamento_id into v_orcamento
      from public.versoes_orcamento_itens i
      join public.versoes_orcamento v on v.id = i.versao_orcamento_id
     where i.id = v_ref;
  end if;

  if v_orcamento is not null and exists (
    select 1
      from public.orcamentos o
      join public.projetos p on p.id = o.projeto_id
     where o.id = v_orcamento
       and (o.arquivado_em is not null or p.status = 'arquivado')
  ) then
    raise exception 'Orçamento arquivado, ou de projeto arquivado, é só leitura. Reative para editar.'
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.guarda_orcamento_so_leitura() from public, anon;

drop trigger if exists trg_versoes_orcamento_guarda_so_leitura on public.versoes_orcamento;
create trigger trg_versoes_orcamento_guarda_so_leitura
  before insert or update or delete on public.versoes_orcamento
  for each row
  execute function public.guarda_orcamento_so_leitura('orcamento', 'orcamento_id');

drop trigger if exists trg_orcamento_importacoes_guarda_so_leitura on public.orcamento_importacoes;
create trigger trg_orcamento_importacoes_guarda_so_leitura
  before insert or update or delete on public.orcamento_importacoes
  for each row
  execute function public.guarda_orcamento_so_leitura('orcamento', 'orcamento_id');

drop trigger if exists trg_versoes_orcamento_itens_guarda_so_leitura on public.versoes_orcamento_itens;
create trigger trg_versoes_orcamento_itens_guarda_so_leitura
  before insert or update or delete on public.versoes_orcamento_itens
  for each row
  execute function public.guarda_orcamento_so_leitura('versao', 'versao_orcamento_id');

drop trigger if exists trg_versoes_orcamento_grupos_guarda_so_leitura on public.versoes_orcamento_grupos;
create trigger trg_versoes_orcamento_grupos_guarda_so_leitura
  before insert or update or delete on public.versoes_orcamento_grupos
  for each row
  execute function public.guarda_orcamento_so_leitura('versao', 'versao_orcamento_id');

drop trigger if exists trg_versoes_orcamento_meses_guarda_so_leitura on public.versoes_orcamento_meses;
create trigger trg_versoes_orcamento_meses_guarda_so_leitura
  before insert or update or delete on public.versoes_orcamento_meses
  for each row
  execute function public.guarda_orcamento_so_leitura('versao', 'versao_orcamento_id');

drop trigger if exists trg_itens_bv_guarda_so_leitura on public.itens_bv;
create trigger trg_itens_bv_guarda_so_leitura
  before insert or update or delete on public.itens_bv
  for each row
  execute function public.guarda_orcamento_so_leitura('item', 'item_versao_id');

drop trigger if exists trg_saves_consumos_guarda_so_leitura on public.saves_consumos;
create trigger trg_saves_consumos_guarda_so_leitura
  before insert or update or delete on public.saves_consumos
  for each row
  execute function public.guarda_orcamento_so_leitura('item', 'item_versao_id');
