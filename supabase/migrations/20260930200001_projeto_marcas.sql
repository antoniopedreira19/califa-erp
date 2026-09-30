-- =====================================================================
-- Projeto com mais de uma marca (decisão 133)
--
-- Origem: pedido do Tiago em 30/09/2026 — o projeto passa a aceitar mais
-- de uma marca do cliente. A regra que vem junto:
--
--   * UMA marca escolhida  → é ela que o job leva ao financeiro, como
--     sempre foi;
--   * MAIS DE UMA          → o job leva a marca geral do cliente (a
--     `padrao`, código PRD-01), esteja ela entre as escolhidas ou não.
--
-- Como fica o modelo:
--
-- 1) `projeto_marcas` é a fonte-verdade do que foi ESCOLHIDO no projeto,
--    no molde de `projeto_regionais` e `projeto_responsaveis`.
--
-- 2) `projetos.produto_id` CONTINUA existindo e passa a guardar a marca
--    que o job leva (a "marca do job"): a única escolhida, ou a geral
--    quando há mais de uma. Quem escreve é a server action do projeto.
--    É ela que o envio para abertura copia para `jobs.produto` e que a
--    `vw_job_rentabilidade` lê como `marca_id` — nenhum dos dois muda.
--
-- ⚠️ A chave primária é `id`, e NÃO (projeto_id, produto_id), de propósito.
--    O PostgREST só trata como muitos-para-muitos a tabela de vínculo
--    cujas duas FKs fazem parte da chave primária. Com a chave composta,
--    `projetos` e `cliente_produtos` passariam a ter DOIS caminhos (a FK
--    direta `produto_id` e o vínculo), e todo embed escrito como
--    `produto:cliente_produtos(...)` a partir de `projetos` ficaria
--    ambíguo (HTTP 300) — inclusive na versão do app que já está no ar.
--    Foi o que aconteceu com `orcamentos.servico_id` em 02/09/2026 (ver
--    docs/FLUXO-BANCO.md). Conferido em 30/09/2026: `projetos` →
--    `regionais`, que tem a chave composta, responde 300; `jobs`, que tem
--    `id` e FKs para `projetos` e `empresas`, não cria caminho nenhum.
--    A unicidade do par fica no índice único.
--
-- O banco não garante que a marca é do cliente do projeto (mesma situação
-- de `projetos.produto_id`, ver a migration 20260806000001): a checagem
-- vive na server action.
--
-- Mudança aditiva: tabela nova e backfill que só preenche.
-- =====================================================================

create table if not exists public.projeto_marcas (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete restrict,
  projeto_id uuid not null references public.projetos(id) on delete cascade,
  produto_id uuid not null references public.cliente_produtos(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- O par é único; o índice também serve à leitura por projeto.
create unique index if not exists uniq_projeto_marcas_par
  on public.projeto_marcas(projeto_id, produto_id);
create index if not exists idx_projeto_marcas_produto
  on public.projeto_marcas(produto_id);
create index if not exists idx_projeto_marcas_tenant
  on public.projeto_marcas(tenant_id);

alter table public.projeto_marcas enable row level security;

drop policy if exists projeto_marcas_select on public.projeto_marcas;
create policy projeto_marcas_select on public.projeto_marcas
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists projeto_marcas_insert on public.projeto_marcas;
create policy projeto_marcas_insert on public.projeto_marcas
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

-- DELETE existe aqui pelo mesmo motivo das regionais: editar o projeto
-- troca o conjunto, não inativa linha por linha.
drop policy if exists projeto_marcas_delete on public.projeto_marcas;
create policy projeto_marcas_delete on public.projeto_marcas
  for delete to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.projeto_marcas from anon;
grant select, insert, delete on public.projeto_marcas to authenticated;

-- Projeto arquivado é só leitura (decisão 118): a mesma guarda dos outros
-- vínculos do projeto.
drop trigger if exists trg_projeto_marcas_guarda_arquivado on public.projeto_marcas;
create trigger trg_projeto_marcas_guarda_arquivado
  before insert or update or delete on public.projeto_marcas
  for each row execute function public.projeto_vinculo_guarda_arquivado();

-- Backfill: cada projeto entra com a marca que já tinha. Só preenche — o
-- `not exists` deixa a migration rodar duas vezes sem duplicar, e serve
-- também para alcançar projeto criado pela versão antiga do app entre a
-- aplicação desta migration e a publicação do código.
insert into public.projeto_marcas (tenant_id, projeto_id, produto_id)
select p.tenant_id, p.id, p.produto_id
  from public.projetos p
 where p.produto_id is not null
   and not exists (
     select 1 from public.projeto_marcas m where m.projeto_id = p.id
   );

comment on table public.projeto_marcas is
  'Marcas escolhidas no projeto (decisão 133). Fonte-verdade da seleção; a marca que o job leva fica em projetos.produto_id.';

comment on column public.projetos.produto_id is
  'Marca que o job leva ao financeiro (decisão 133): a única escolhida no projeto ou, com mais de uma, a marca geral do cliente (padrao, PRD-01). As escolhidas vivem em projeto_marcas.';
