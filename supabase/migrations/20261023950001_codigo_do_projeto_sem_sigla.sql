-- =====================================================================
-- Decisão 210 — o código do projeto perde a sigla do cliente.
--
-- Tiago, 23/10/2026: o código do projeto serve só ao controle do sistema;
-- quem lê a sigla do cliente é o código do JOB (`AMB-1006/26`, decisão
-- 114), que não muda. Formato aprovado:
--   * projeto da produção:   AMB-P004/26    → P-NNNN/AA  (ex.: P-0001/26)
--   * orçamento acompanha:   AMB-P004/26-03 → P-NNNN/AA-03
--   * projeto do financeiro: AMB-F004/26    → F-NNNN/AA  (ex.: F-0001/26)
-- 4 dígitos (foram 94 projetos em 30 dias); sequencial por letra e ano;
-- ano = o da CRIAÇÃO do projeto, no fuso de São Paulo; número nunca volta.
-- `PRJ-`/`FIN-` foram descartados porque existe cliente com a sigla FIN.
--
-- Conversão dos atuais: pela ordem de criação (`created_at`, desempate
-- pelo código), em cada letra e ano. Os orçamentos trocam só o prefixo e
-- mantêm o "-NN". Os rótulos da foto da abertura
-- (`jobs_aberturas.projeto_financeiro_rotulo`, "CÓDIGO · nome") trocam o
-- código; os de projeto do financeiro já apagado ficam com o antigo — não
-- há código novo para eles.
--
-- ⚠️ DESTRUTIVA: sobrescreve `projetos.codigo`, `orcamentos.codigo`,
-- `projetos_financeiro.codigo` e `jobs_aberturas.projeto_financeiro_rotulo`,
-- e troca a assinatura de `trocar_cliente_do_projeto`. Cada troca de
-- código vira um evento `*.codigo_trocado` na auditoria, com o código de
-- antes. Aplicar na hora combinada com a frente do Antonio, com o código
-- da decisão 210 publicado logo em seguida: o gerador antigo, rodando no
-- intervalo, criaria projeto no formato com sigla.
--
-- Levantado em 23/10/2026: 104 projetos, 179 orçamentos e 73 projetos do
-- financeiro, todos de 2026 e no formato "[SIGLA]-[PF]NNN/AA"; todo
-- orçamento começa pelo código do próprio projeto; 143 rótulos de
-- abertura, 2 de projeto apagado. Nenhuma função ou view do banco monta
-- ou lê o formato (o rótulo é montado pelo gatilho, só no insert). O
-- `updated_at` das três tabelas fica como está: a troca é do sistema, não
-- edição de ninguém.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Registro de códigos do projeto do financeiro — aditivo.
--    O projeto do financeiro sem job é apagado (decisão 119); sem o
--    registro, o número do último apagado voltaria a ser usado. Mesmo
--    desenho de `codigos_de_projeto_usados` (decisão 122).
-- ---------------------------------------------------------------------
create table if not exists public.codigos_de_projeto_financeiro_usados (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  codigo text not null,
  -- Nulo quando o projeto não existe mais (apagado sem job).
  projeto_financeiro_id uuid references public.projetos_financeiro(id) on delete set null,
  registrado_em timestamptz not null default now(),
  primary key (tenant_id, codigo)
);

comment on table public.codigos_de_projeto_financeiro_usados is
  'Todo código que um projeto do financeiro já teve (decisão 210). Só cresce: o gerador pula estes números, e código não volta a ser usado.';

create index if not exists codigos_de_projeto_financeiro_usados_projeto_idx
  on public.codigos_de_projeto_financeiro_usados (projeto_financeiro_id);

alter table public.codigos_de_projeto_financeiro_usados enable row level security;

drop policy if exists codigos_de_projeto_financeiro_usados_select
  on public.codigos_de_projeto_financeiro_usados;
create policy codigos_de_projeto_financeiro_usados_select
  on public.codigos_de_projeto_financeiro_usados
  for select to authenticated
  using (is_tenant_member(tenant_id));

-- Só leitura para quem usa o app; quem escreve é o gatilho.
revoke all on public.codigos_de_projeto_financeiro_usados from anon, authenticated;
grant select on public.codigos_de_projeto_financeiro_usados to authenticated;

create or replace function public.registrar_codigo_de_projeto_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.codigo is not null
     and (tg_op = 'INSERT' or new.codigo is distinct from old.codigo) then
    insert into public.codigos_de_projeto_financeiro_usados (tenant_id, codigo, projeto_financeiro_id)
    values (new.tenant_id, new.codigo, new.id)
    on conflict (tenant_id, codigo) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.registrar_codigo_de_projeto_financeiro() from public, anon;

drop trigger if exists trg_projetos_financeiro_registra_codigo on public.projetos_financeiro;
create trigger trg_projetos_financeiro_registra_codigo
  after insert or update of codigo on public.projetos_financeiro
  for each row execute function public.registrar_codigo_de_projeto_financeiro();

-- Carga inicial: os códigos de hoje (o gatilho registra os novos na troca
-- abaixo) e os da auditoria, que cobrem os projetos apagados.
insert into public.codigos_de_projeto_financeiro_usados (tenant_id, codigo, projeto_financeiro_id)
select f.tenant_id, f.codigo, f.id
  from public.projetos_financeiro f
 where f.codigo is not null
on conflict (tenant_id, codigo) do nothing;

insert into public.codigos_de_projeto_financeiro_usados (tenant_id, codigo, projeto_financeiro_id)
select a.tenant_id,
       c.codigo,
       (select f.id from public.projetos_financeiro f where f.id::text = a.entidade_id)
  from public.audit_events a
  cross join lateral (
    values (a.metadata ->> 'codigo'), (a.metadata ->> 'codigo_anterior')
  ) as c(codigo)
 where a.acao like 'projeto_financeiro.%'
   and a.tenant_id is not null
   and c.codigo is not null
   and c.codigo <> ''
on conflict (tenant_id, codigo) do nothing;

-- ---------------------------------------------------------------------
-- 2) O de-para: ordem de criação dentro da letra e do ano.
-- ---------------------------------------------------------------------
create temp table _de_para_projetos on commit drop as
select p.id,
       p.tenant_id,
       p.codigo as antigo,
       'P-' || lpad(row_number() over (
                 partition by p.tenant_id, to_char(p.created_at at time zone 'America/Sao_Paulo', 'YY')
                 order by p.created_at, p.codigo)::text, 4, '0')
            || '/' || to_char(p.created_at at time zone 'America/Sao_Paulo', 'YY') as novo
  from public.projetos p;

create temp table _de_para_financeiro on commit drop as
select f.id,
       f.tenant_id,
       f.codigo as antigo,
       'F-' || lpad(row_number() over (
                 partition by f.tenant_id, to_char(f.created_at at time zone 'America/Sao_Paulo', 'YY')
                 order by f.created_at, f.codigo)::text, 4, '0')
            || '/' || to_char(f.created_at at time zone 'America/Sao_Paulo', 'YY') as novo
  from public.projetos_financeiro f;

-- ---------------------------------------------------------------------
-- 3) A troca. O código novo nunca é igual a um "[SIGLA]-[PF]NNN/AA", então
--    os índices únicos (tenant_id, codigo) não esbarram no meio do update.
--    Os gatilhos de guarda deixam passar (sem `auth.uid()`); os de
--    registro gravam os códigos novos em `codigos_de_*_usados`.
-- ---------------------------------------------------------------------
alter table public.projetos disable trigger trg_projetos_updated_at;
alter table public.orcamentos disable trigger trg_orcamentos_updated_at;
alter table public.projetos_financeiro disable trigger trg_projetos_financeiro_updated_at;

update public.projetos p
   set codigo = d.novo
  from _de_para_projetos d
 where d.id = p.id;

-- Por comparação de texto, não LIKE: um "_" na sigla seria curinga.
update public.orcamentos o
   set codigo = d.novo || substr(o.codigo, length(d.antigo) + 1)
  from _de_para_projetos d
 where d.id = o.projeto_id
   and left(o.codigo, length(d.antigo) + 1) = d.antigo || '-';

update public.projetos_financeiro f
   set codigo = d.novo
  from _de_para_financeiro d
 where d.id = f.id;

alter table public.projetos enable trigger trg_projetos_updated_at;
alter table public.orcamentos enable trigger trg_orcamentos_updated_at;
alter table public.projetos_financeiro enable trigger trg_projetos_financeiro_updated_at;

update public.jobs_aberturas a
   set projeto_financeiro_rotulo = d.novo || substr(a.projeto_financeiro_rotulo, length(d.antigo) + 1)
  from _de_para_financeiro d
 where d.id = a.projeto_financeiro_id
   and left(a.projeto_financeiro_rotulo, length(d.antigo) + 3) = d.antigo || ' · ';

-- O número de orçamento excluído não volta (decisão 148): o gerador busca
-- pelo prefixo do projeto, então o código registrado ganha a versão com o
-- prefixo novo. O de antes fica no registro também.
insert into public.codigos_de_orcamento_usados (tenant_id, codigo, orcamento_id, projeto_id)
select u.tenant_id,
       d.novo || substr(u.codigo, length(d.antigo) + 1),
       u.orcamento_id,
       u.projeto_id
  from public.codigos_de_orcamento_usados u
  join _de_para_projetos d on d.id = u.projeto_id
 where left(u.codigo, length(d.antigo) + 1) = d.antigo || '-'
on conflict (tenant_id, codigo) do nothing;

-- ---------------------------------------------------------------------
-- 4) Auditoria: um evento por código trocado.
-- ---------------------------------------------------------------------
insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
select d.tenant_id, null::uuid, 'projeto.codigo_trocado', 'projeto', d.id::text,
       jsonb_build_object('codigo_anterior', d.antigo, 'codigo', d.novo, 'decisao', '210')
  from _de_para_projetos d
union all
select o.tenant_id, null::uuid, 'orcamento.codigo_trocado', 'orcamento', o.id::text,
       jsonb_build_object(
         'codigo_anterior', d.antigo || substr(o.codigo, length(d.novo) + 1),
         'codigo', o.codigo,
         'decisao', '210')
  from public.orcamentos o
  join _de_para_projetos d on d.id = o.projeto_id
union all
select d.tenant_id, null::uuid, 'projeto_financeiro.codigo_trocado', 'projeto_financeiro', d.id::text,
       jsonb_build_object('codigo_anterior', d.antigo, 'codigo', d.novo, 'decisao', '210')
  from _de_para_financeiro d;

-- ---------------------------------------------------------------------
-- 5) A troca de cliente (decisão 122) deixa de trocar o código.
--    Sai o parâmetro do código: a versão antiga, chamada pelo código de
--    antes da 210, devolveria o projeto ao formato com sigla.
-- ---------------------------------------------------------------------
drop function if exists public.trocar_cliente_do_projeto(uuid, uuid, uuid, text);

create or replace function public.trocar_cliente_do_projeto(
  p_projeto_id uuid,
  p_cliente_id uuid,
  p_produto_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- A guarda `projetos_guarda_cliente` dispara aqui e recusa se já houver
  -- aprovação. O código fica: desde a decisão 210 ele não leva a sigla.
  update public.projetos
     set cliente_id = p_cliente_id,
         produto_id = p_produto_id
   where id = p_projeto_id;

  if not found then
    raise exception 'Projeto não encontrado.' using errcode = 'P0002';
  end if;

  return jsonb_build_object('id', p_projeto_id, 'cliente_id', p_cliente_id);
end;
$$;

revoke all on function public.trocar_cliente_do_projeto(uuid, uuid, uuid) from public, anon;
grant execute on function public.trocar_cliente_do_projeto(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Conferência: nada no formato antigo, nada repetido, e todo
--    orçamento começando pelo código do próprio projeto.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.projetos where codigo !~ '^P-[0-9]{4,}/[0-9]{2}$')
     or exists (select 1 from public.projetos_financeiro where codigo !~ '^F-[0-9]{4,}/[0-9]{2}$')
     or exists (select 1 from public.orcamentos where codigo !~ '^P-[0-9]{4,}/[0-9]{2}-[0-9]{2,}$') then
    raise exception 'Ainda há projeto ou orçamento fora do formato novo depois da troca.';
  end if;
  if exists (
    select 1
      from public.orcamentos o
      join public.projetos p on p.id = o.projeto_id
     where left(o.codigo, length(p.codigo) + 1) <> p.codigo || '-'
  ) then
    raise exception 'Há orçamento que não começa pelo código do próprio projeto depois da troca.';
  end if;
  if exists (
    select 1
      from public.jobs_aberturas a
      join public.projetos_financeiro f on f.id = a.projeto_financeiro_id
     where left(a.projeto_financeiro_rotulo, length(f.codigo) + 3) <> f.codigo || ' · '
  ) then
    raise exception 'Há rótulo de abertura com o código antigo de um projeto do financeiro que existe.';
  end if;
end;
$$;
