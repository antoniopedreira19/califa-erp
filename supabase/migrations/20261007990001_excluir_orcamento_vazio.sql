-- =====================================================================
-- Decisão 148, entrega 2 (07/10/2026): excluir orçamento completamente
-- vazio, e código de orçamento nunca volta a ser usado.
--
-- Vazio (combinado com o Tiago em 06/10/2026): em rascunho, nunca
-- aprovado, sem job e sem nenhum item em nenhuma versão. Grupo sem item
-- conta como vazio. Quem pode: quem cria orçamento (`orcamentos.criar` em
-- lib/permissoes.ts — administrador, gerente_producao, produtor).
--
-- Código (Tiago, 07/10/2026: "sem reaproveitar código"): o gerador
-- (`gerarCodigoOrcamento`) usa o maior número JÁ EXISTENTE + 1. Apagado o
-- último orçamento do projeto, o próximo nasceria com o mesmo código, e
-- a auditoria e as conversas antigas passariam a apontar para outro
-- orçamento. Mesmo modelo dos projetos (decisão 122,
-- `codigos_de_projeto_usados`):
--
-- 1) `codigos_de_orcamento_usados`: todo código que um orçamento já teve,
--    por tenant. Só cresce. O gatilho registra na criação e em cada troca
--    de código (a troca de cliente do projeto renomeia os orçamentos).
-- 2) Carga inicial: os códigos atuais e os da auditoria — criação, troca
--    de código (decisão 114) e as cópias apagadas do AMB-P017/26.
-- 3) `orcamento_esta_vazio`: a regra, num lugar só.
-- 4) `orcamentos_excluiveis_do_projeto`: para a visão agregada, os
--    orçamentos que só dependem de não ter item, com as versões que ainda
--    têm item — a tela confere a versão aberta pelo estado dela.
-- 5) `excluir_orcamento_vazio`: confere tudo, apaga e audita na mesma
--    transação. Invoker: a RLS de `orcamentos` vale como em qualquer
--    escrita do app.
--
-- Aditiva: tabela, funções e gatilho novos; a carga só insere. O DELETE
-- só acontece quando alguém exclui pela tela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Registro dos códigos usados
-- ---------------------------------------------------------------------
create table if not exists public.codigos_de_orcamento_usados (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  codigo text not null,
  -- Nulo quando o orçamento não existe mais (excluído).
  orcamento_id uuid references public.orcamentos(id) on delete set null,
  projeto_id uuid references public.projetos(id) on delete set null,
  registrado_em timestamptz not null default now(),
  primary key (tenant_id, codigo)
);

comment on table public.codigos_de_orcamento_usados is
  'Todo código que um orçamento já teve (decisão 148, entrega 2). Só cresce: o gerador pula estes números, e código não volta a ser usado.';

create index if not exists codigos_de_orcamento_usados_orcamento_id_idx
  on public.codigos_de_orcamento_usados (orcamento_id);
create index if not exists codigos_de_orcamento_usados_projeto_id_idx
  on public.codigos_de_orcamento_usados (projeto_id);
-- O gerador busca pelo prefixo do projeto (`codigo like 'AMB-P017/26-%'`).
create index if not exists codigos_de_orcamento_usados_prefixo_idx
  on public.codigos_de_orcamento_usados (tenant_id, codigo text_pattern_ops);

alter table public.codigos_de_orcamento_usados enable row level security;

drop policy if exists codigos_de_orcamento_usados_select on public.codigos_de_orcamento_usados;
create policy codigos_de_orcamento_usados_select
  on public.codigos_de_orcamento_usados
  for select to authenticated
  using (is_tenant_member(tenant_id));

-- Só leitura para quem usa o app; quem escreve é o gatilho.
revoke all on public.codigos_de_orcamento_usados from anon, authenticated;
grant select on public.codigos_de_orcamento_usados to authenticated;

create or replace function public.registrar_codigo_de_orcamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.codigo is not null
     and (tg_op = 'INSERT' or new.codigo is distinct from old.codigo) then
    insert into public.codigos_de_orcamento_usados (tenant_id, codigo, orcamento_id, projeto_id)
    values (new.tenant_id, new.codigo, new.id, new.projeto_id)
    on conflict (tenant_id, codigo) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.registrar_codigo_de_orcamento() from public, anon;

drop trigger if exists trg_orcamentos_registra_codigo on public.orcamentos;
create trigger trg_orcamentos_registra_codigo
  after insert or update of codigo on public.orcamentos
  for each row execute function public.registrar_codigo_de_orcamento();

-- ---------------------------------------------------------------------
-- 2) Carga inicial
-- ---------------------------------------------------------------------
insert into public.codigos_de_orcamento_usados (tenant_id, codigo, orcamento_id, projeto_id)
select o.tenant_id, o.codigo, o.id, o.projeto_id
  from public.orcamentos o
 where o.codigo is not null
on conflict (tenant_id, codigo) do nothing;

-- Criação e troca de código: cobre os orçamentos que já não existem.
insert into public.codigos_de_orcamento_usados (tenant_id, codigo, orcamento_id, projeto_id)
select a.tenant_id,
       c.codigo,
       (select o.id from public.orcamentos o where o.id::text = a.entidade_id),
       (select p.id from public.projetos p where p.id::text = a.metadata ->> 'projeto_id')
  from public.audit_events a
  cross join lateral (
    values (a.metadata ->> 'codigo'), (a.metadata ->> 'codigo_anterior')
  ) as c(codigo)
 where a.acao in ('orcamento.criado', 'orcamento.codigo_trocado')
   and a.tenant_id is not null
   and c.codigo is not null
   and c.codigo <> ''
on conflict (tenant_id, codigo) do nothing;

-- As 36 cópias do AMB-P017/26 (migration 20261006600002).
insert into public.codigos_de_orcamento_usados (tenant_id, codigo, orcamento_id, projeto_id)
select a.tenant_id, x ->> 'codigo', null, null
  from public.audit_events a
  cross join lateral jsonb_array_elements(coalesce(a.metadata -> 'apagados', '[]'::jsonb)) as x
 where a.acao = 'orcamento.copias_apagadas'
   and a.tenant_id is not null
   and coalesce(x ->> 'codigo', '') <> ''
on conflict (tenant_id, codigo) do nothing;

-- ---------------------------------------------------------------------
-- 3) A regra do vazio
-- ---------------------------------------------------------------------
create or replace function public.orcamento_esta_vazio(p_orcamento_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.orcamentos o
     where o.id = p_orcamento_id
       and o.status = 'rascunho'
       and o.versao_aprovada_id is null
       and not exists (
         select 1 from public.versoes_orcamento v
          where v.orcamento_id = o.id and v.status = 'aprovada'
       )
       and not exists (
         select 1 from public.jobs j where j.orcamento_id = o.id
       )
       and not exists (
         select 1
           from public.versoes_orcamento_itens i
           join public.versoes_orcamento v on v.id = i.versao_orcamento_id
          where v.orcamento_id = o.id
       )
  );
$$;

comment on function public.orcamento_esta_vazio(uuid) is
  'Decisão 148: em rascunho, nunca aprovado, sem job e sem nenhum item em nenhuma versão. Só ele se exclui.';

revoke all on function public.orcamento_esta_vazio(uuid) from public, anon;
grant execute on function public.orcamento_esta_vazio(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Para a visão agregada
-- ---------------------------------------------------------------------
-- O mesmo que `orcamento_esta_vazio`, menos o "sem item": devolve as
-- versões que ainda têm item. A agregada edita a versão aberta na hora,
-- então ela confere essa versão pelo próprio estado e as outras por aqui.
-- Mude as duas funções juntas.
create or replace function public.orcamentos_excluiveis_do_projeto(p_projeto_id uuid)
returns table (orcamento_id uuid, versoes_com_item uuid[])
language sql
stable
set search_path = public
as $$
  select o.id,
         coalesce(
           array(
             select distinct i.versao_orcamento_id
               from public.versoes_orcamento_itens i
               join public.versoes_orcamento v on v.id = i.versao_orcamento_id
              where v.orcamento_id = o.id
           ),
           '{}'::uuid[]
         )
    from public.orcamentos o
   where o.projeto_id = p_projeto_id
     and o.arquivado_em is null
     and o.status = 'rascunho'
     and o.versao_aprovada_id is null
     and not exists (
       select 1 from public.versoes_orcamento v
        where v.orcamento_id = o.id and v.status = 'aprovada'
     )
     and not exists (
       select 1 from public.jobs j where j.orcamento_id = o.id
     );
$$;

revoke all on function public.orcamentos_excluiveis_do_projeto(uuid) from public, anon;
grant execute on function public.orcamentos_excluiveis_do_projeto(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) A exclusão
-- ---------------------------------------------------------------------
create or replace function public.excluir_orcamento_vazio(p_orcamento_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_orc record;
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão expirada. Entre de novo para excluir.'
      using errcode = '42501';
  end if;

  -- O mesmo papel de `orcamentos.criar` (lib/permissoes.ts). A action
  -- confere antes; aqui é para quem chamar a função direto.
  if coalesce(public.session_role()::text, '') not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Só quem cria orçamento pode excluir um orçamento vazio.'
      using errcode = '42501';
  end if;

  select o.id, o.tenant_id, o.projeto_id, o.codigo, o.nome, o.arquivado_em,
         p.codigo as projeto_codigo, p.status::text as projeto_status
    into v_orc
    from public.orcamentos o
    join public.projetos p on p.id = o.projeto_id
   where o.id = p_orcamento_id
     for update of o;

  if not found then
    raise exception 'Orçamento não encontrado.' using errcode = 'P0002';
  end if;

  if v_orc.arquivado_em is not null or v_orc.projeto_status = 'arquivado' then
    raise exception 'Orçamento arquivado, ou de projeto arquivado, é só leitura. Reative para excluir.'
      using errcode = '42501';
  end if;

  if not public.orcamento_esta_vazio(p_orcamento_id) then
    raise exception 'Só se exclui orçamento completamente vazio: em rascunho, nunca aprovado, sem job e sem nenhum item em nenhuma versão.'
      using errcode = 'P0001';
  end if;

  -- Versões, grupos, meses e o histórico de importação vão junto (FKs em
  -- cascata). O código fica em `codigos_de_orcamento_usados`.
  delete from public.orcamentos where id = p_orcamento_id;

  perform public.log_audit_event(
    'orcamento.excluido',
    v_orc.tenant_id,
    'orcamento',
    p_orcamento_id::text,
    jsonb_build_object(
      'codigo', v_orc.codigo,
      'nome', v_orc.nome,
      'projeto_id', v_orc.projeto_id,
      'projeto', v_orc.projeto_codigo
    )
  );

  return jsonb_build_object(
    'id', p_orcamento_id,
    'codigo', v_orc.codigo,
    'nome', v_orc.nome,
    'projeto_id', v_orc.projeto_id
  );
end;
$$;

revoke all on function public.excluir_orcamento_vazio(uuid) from public, anon;
grant execute on function public.excluir_orcamento_vazio(uuid) to authenticated;
