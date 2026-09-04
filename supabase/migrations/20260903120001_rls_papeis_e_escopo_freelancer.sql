-- RLS: escopo do Freelancer + gate de papel nas policies operacionais.
--
-- CONTEXTO. Ate 03/09/2026, as policies das tabelas operacionais
-- (jobs, orcamentos, versoes, itens, PP, errata, save, chat) usavam
-- apenas `is_tenant_member(tenant_id)` — qualquer membro autenticado
-- do tenant enxergava tudo. Isso bastava enquanto so existiam
-- administradores. A entrada de Financeiro, Produtor e Freelancer no
-- enum (migration 20260903100001) exige recorte adicional:
--
--   - Freelancer so ve os projetos onde consta em `projeto_responsaveis`
--     (qualquer papel — `gp` ou `equipe`). O resto do tenant e invisivel
--     pra ele, no nivel do banco. Row-level enforcement de verdade.
--   - Os outros papeis (administrador, gerente_producao, produtor,
--     financeiro) mantem visao ampla do tenant — role gate deles vive
--     no aplicativo (server actions), nao no RLS.
--
-- ESTRATEGIA: duas funcoes helper, uma pra papel e outra pra
-- participacao em projeto, e cada policy operacional passa a incluir
-- cirurgicamente a clausula que restringe o Freelancer.
--
-- PERFORMANCE. Anti-pattern H do docs/PERFORMANCE.md:
--   - `(select auth.uid())` em vez de `auth.uid()`: uma vez por
--     statement em vez de por linha.
--   - Funcoes `STABLE` + `SECURITY DEFINER` — Postgres cacheia o
--     resultado dentro do statement.
--   - Curto-circuito no OR: `session_role() <> 'freelancer'` avaliado
--     primeiro. Se o usuario nao e freelancer, o EXISTS nem roda.
--     Como 19/19 profiles hoje sao administrador, custo pra usuario
--     atual = zero.
--   - Indices: PK de `projeto_responsaveis` e `(projeto_id, profile_id)`
--     e ja existe `idx_projeto_responsaveis_profile` em `(profile_id)`.
--     Cobrem tanto lookup por projeto+profile quanto so por profile.
--
-- ORDEM DE APLICACAO:
--   1. helpers (session_role, is_freelancer_do_projeto)
--   2. policies operacionais (SELECT/INSERT/UPDATE/DELETE quando cabe)
--   3. get_advisors performance (fora da migration).

-- ==================================================================
-- 1. Helpers
-- ==================================================================

-- Papel do usuario logado no tenant ativo. No MVP so ha um tenant por
-- profile — se um dia houver mais, precisamos passar tenant_id como
-- parametro (nada aqui a assume).
create or replace function public.session_role()
returns public.app_role
language sql
security definer
stable
set search_path = public
as $function$
  select tm.role
  from public.tenant_members tm
  where tm.user_id = (select auth.uid())
    and tm.status = 'ativo'
  limit 1;
$function$;

comment on function public.session_role() is
  'Papel do usuario logado no tenant ativo. STABLE + SECURITY DEFINER pra ser barata em policies RLS.';

grant execute on function public.session_role() to authenticated;

-- Verdadeiro se o usuario logado esta em `projeto_responsaveis` do
-- projeto — qualquer papel (`gp` OU `equipe`). E o gate row-level do
-- Freelancer: sem esta linha, ele nao ve nada do projeto.
create or replace function public.is_freelancer_do_projeto(projeto uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $function$
  select exists (
    select 1
    from public.projeto_responsaveis pr
    where pr.projeto_id = projeto
      and pr.profile_id = (select auth.uid())
  );
$function$;

comment on function public.is_freelancer_do_projeto(uuid) is
  'True se o usuario esta na equipe do projeto (papel gp OU equipe). Escopo RLS do Freelancer.';

grant execute on function public.is_freelancer_do_projeto(uuid) to authenticated;

-- ==================================================================
-- 2. Policies com recorte do Freelancer
-- ==================================================================
-- Padrao: `is_tenant_member(tenant_id) AND (session_role() <> 'freelancer'
-- OR ... freelancer participa)`. Curto-circuito no papel mantem custo
-- zero pra ADM/GP/PROD/FIN.

-- ---------- jobs ----------
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(projeto_id)
  )
);

drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(projeto_id)
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(projeto_id)
  )
);

-- ---------- orcamentos ----------
drop policy if exists orcamentos_select on public.orcamentos;
create policy orcamentos_select on public.orcamentos
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(projeto_id)
  )
);

drop policy if exists orcamentos_update on public.orcamentos;
create policy orcamentos_update on public.orcamentos
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(projeto_id)
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or is_freelancer_do_projeto(projeto_id)
  )
);

-- ---------- versoes_orcamento (nao tem projeto_id direto) ----------
drop policy if exists versoes_select on public.versoes_orcamento;
create policy versoes_select on public.versoes_orcamento
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.orcamentos o
      where o.id = versoes_orcamento.orcamento_id
        and is_freelancer_do_projeto(o.projeto_id)
    )
  )
);

drop policy if exists versoes_update on public.versoes_orcamento;
create policy versoes_update on public.versoes_orcamento
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.orcamentos o
      where o.id = versoes_orcamento.orcamento_id
        and is_freelancer_do_projeto(o.projeto_id)
    )
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.orcamentos o
      where o.id = versoes_orcamento.orcamento_id
        and is_freelancer_do_projeto(o.projeto_id)
    )
  )
);

-- ---------- versoes_orcamento_itens ----------
drop policy if exists itens_select on public.versoes_orcamento_itens;
create policy itens_select on public.versoes_orcamento_itens
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1
      from public.versoes_orcamento v
      join public.orcamentos o on o.id = v.orcamento_id
      where v.id = versoes_orcamento_itens.versao_orcamento_id
        and is_freelancer_do_projeto(o.projeto_id)
    )
  )
);

drop policy if exists itens_update on public.versoes_orcamento_itens;
create policy itens_update on public.versoes_orcamento_itens
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1
      from public.versoes_orcamento v
      join public.orcamentos o on o.id = v.orcamento_id
      where v.id = versoes_orcamento_itens.versao_orcamento_id
        and is_freelancer_do_projeto(o.projeto_id)
    )
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1
      from public.versoes_orcamento v
      join public.orcamentos o on o.id = v.orcamento_id
      where v.id = versoes_orcamento_itens.versao_orcamento_id
        and is_freelancer_do_projeto(o.projeto_id)
    )
  )
);

-- ---------- jobs_itens_orcado ----------
drop policy if exists jobs_itens_orcado_select on public.jobs_itens_orcado;
create policy jobs_itens_orcado_select on public.jobs_itens_orcado
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_itens_orcado.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

drop policy if exists jobs_itens_orcado_update on public.jobs_itens_orcado;
create policy jobs_itens_orcado_update on public.jobs_itens_orcado
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_itens_orcado.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_itens_orcado.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- jobs_itens_realizado ----------
drop policy if exists jobs_realizado_select on public.jobs_itens_realizado;
create policy jobs_realizado_select on public.jobs_itens_realizado
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_itens_realizado.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

drop policy if exists jobs_realizado_update on public.jobs_itens_realizado;
create policy jobs_realizado_update on public.jobs_itens_realizado
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_itens_realizado.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_itens_realizado.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- jobs_erratas ----------
drop policy if exists jobs_erratas_select on public.jobs_erratas;
create policy jobs_erratas_select on public.jobs_erratas
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_erratas.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- Errata: Freelancer NAO cria (nem via UI, nem via RLS). O gate no
-- server (Task 3) ja barra, mas defesa em profundidade aqui tambem:
-- with_check exige `is_tenant_member` E que o freelancer seja
-- participante do projeto do job — na pratica isso e Task 3 novamente,
-- mas nao custa nada aqui.
drop policy if exists jobs_erratas_insert on public.jobs_erratas;
create policy jobs_erratas_insert on public.jobs_erratas
for insert
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_erratas.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- jobs_erratas_itens ----------
drop policy if exists jobs_erratas_itens_select on public.jobs_erratas_itens;
create policy jobs_erratas_itens_select on public.jobs_erratas_itens
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1
      from public.jobs_erratas e
      join public.jobs j on j.id = e.job_id
      where e.id = jobs_erratas_itens.errata_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- saves_consumos ----------
-- saves_consumos vincula um job origem (gerou o credito) a uma linha
-- do orcado do consumidor. O Freelancer precisa participar do projeto
-- de PELO MENOS um dos dois lados pra enxergar.
drop policy if exists saves_consumos_select on public.saves_consumos;
create policy saves_consumos_select on public.saves_consumos
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1
      from public.jobs j
      where j.id = saves_consumos.job_origem_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
    or exists (
      select 1
      from public.jobs_itens_orcado io
      join public.jobs j on j.id = io.job_id
      where io.id = saves_consumos.job_item_orcado_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- pedidos_compra ----------
drop policy if exists pp_select on public.pedidos_compra;
create policy pp_select on public.pedidos_compra
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = pedidos_compra.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

drop policy if exists pp_update on public.pedidos_compra;
create policy pp_update on public.pedidos_compra
for update
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = pedidos_compra.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
)
with check (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = pedidos_compra.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- pedidos_compra_parcelas ----------
drop policy if exists pp_parcelas_select on public.pedidos_compra_parcelas;
create policy pp_parcelas_select on public.pedidos_compra_parcelas
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1
      from public.pedidos_compra pp
      join public.jobs j on j.id = pp.job_id
      where pp.id = pedidos_compra_parcelas.pedido_compra_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- pedidos_compra_anexos ----------
drop policy if exists pp_anexos_select on public.pedidos_compra_anexos;
create policy pp_anexos_select on public.pedidos_compra_anexos
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1
      from public.pedidos_compra pp
      join public.jobs j on j.id = pp.job_id
      where pp.id = pedidos_compra_anexos.pedido_compra_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- jobs_mensagens (chat) ----------
drop policy if exists jobs_mensagens_select on public.jobs_mensagens;
create policy jobs_mensagens_select on public.jobs_mensagens
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_mensagens.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);

-- ---------- jobs_chat_leituras ----------
drop policy if exists jobs_chat_leituras_select on public.jobs_chat_leituras;
create policy jobs_chat_leituras_select on public.jobs_chat_leituras
for select
using (
  is_tenant_member(tenant_id)
  and (
    session_role() <> 'freelancer'
    or exists (
      select 1 from public.jobs j
      where j.id = jobs_chat_leituras.job_id
        and is_freelancer_do_projeto(j.projeto_id)
    )
  )
);
