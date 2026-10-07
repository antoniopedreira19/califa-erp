-- Decisão 156 (07/10/2026) — o CNPJ da PP, separado da empresa gerencial.
--
-- POR QUE
-- O campo "Empresa emissora" do formulário da PP listava as empresas
-- GERENCIAIS (Agência California, CCH, Hitlab, Ventura, Empresa Teste), e a
-- PP usava essa escolha para três coisas: a RLS e os relatórios (gerencial —
-- certo), o cabeçalho do PDF, que diz ao fornecedor contra qual CNPJ emitir
-- a nota (errado: a PP-00144, de um job da CCH, saiu com "CCH LTDA · CNPJ
-- 00.000.000/0000-00"), e a conferência do CNPJ tomador da NF (errado: a
-- regional SS é atendida pela GoCrazy, e as NFs 19 e 102, com tomador
-- GoCrazy, apareciam como erro numa PP da Agência California).
-- As duas dimensões são independentes (Tiago, 02/10 e 07/10/2026): o CNPJ da
-- California pode arcar com custo da Hitlab gerencial, e a regional SS da
-- Agência California costuma sair pela GoCrazy.
--
-- O QUE MUDA
--   1. `pedidos_compra.estabelecimento_id`: o CNPJ da PP (cadastro de
--      impostos). Sai no PDF, vem como tomador da NF e é com ele que a nota
--      é conferida. `empresa_id` continua sendo a gerencial, a do job (RLS,
--      relatórios, fluxo de caixa).
--   2. `fiscal_cnpj_da_pp_por_regional`: o CNPJ que a PP já traz escolhido,
--      por regional (SS → GoCrazy, pedido do Tiago). Sem linha, vale o CNPJ
--      da empresa gerencial do job (Hitlab → Hitlab, Agência California →
--      California) e, por último, o da empresa principal.
--   3. `fiscal_estabelecimentos` ganha os dados do cabeçalho do PDF
--      (endereço, telefone, e-mail, inscrições), que até aqui vinham da
--      empresa gerencial.
--
-- BACKFILL (só preenche o que está vazio, como o Tiago escolheu):
--   • dados do PDF dos CNPJs: os da empresa gerencial de mesmo CNPJ
--     (California e Hitlab); a GoCrazy não tem esses dados em lugar nenhum;
--   • CNPJ das PPs existentes: o tomador da NF anexada; sem NF, o CNPJ da
--     empresa gerencial; e, se ela não tiver CNPJ no cadastro (CCH, Ventura,
--     Empresa Teste), o da empresa principal. Os PDFs já gerados não mudam.

-- 1. Os dados do cabeçalho do PDF, por CNPJ --------------------------------
alter table public.fiscal_estabelecimentos
  add column if not exists logradouro          text,
  add column if not exists numero              text,
  add column if not exists complemento         text,
  add column if not exists bairro              text,
  add column if not exists cep                 text,
  add column if not exists telefone            text,
  add column if not exists email               text,
  add column if not exists inscricao_estadual  text,
  add column if not exists inscricao_municipal text;

comment on column public.fiscal_estabelecimentos.logradouro is
  'Endereço do CNPJ, para o cabeçalho do PDF da PP (decisão 156). Município e UF são as colunas municipio e uf.';
comment on column public.fiscal_estabelecimentos.inscricao_estadual is
  'Inscrição estadual do CNPJ, no cabeçalho do PDF da PP (decisão 156). Vazia = "ISENTO".';

update public.fiscal_estabelecimentos f
   set logradouro          = coalesce(f.logradouro, e.logradouro),
       numero              = coalesce(f.numero, e.numero),
       complemento         = coalesce(f.complemento, e.complemento),
       bairro              = coalesce(f.bairro, e.bairro),
       cep                 = coalesce(f.cep, e.cep),
       telefone            = coalesce(f.telefone, e.telefone),
       email               = coalesce(f.email, e.email),
       inscricao_estadual  = coalesce(f.inscricao_estadual, e.inscricao_estadual),
       inscricao_municipal = coalesce(f.inscricao_municipal, e.inscricao_municipal),
       municipio           = coalesce(f.municipio, e.cidade),
       uf                  = coalesce(f.uf, e.uf)
  from public.empresas e
 where e.tenant_id = f.tenant_id
   and f.cnpj is not null
   and regexp_replace(e.cnpj, '\D', '', 'g') = regexp_replace(f.cnpj, '\D', '', 'g');

-- 2. O CNPJ que a PP já traz escolhido, por regional ------------------------
create table if not exists public.fiscal_cnpj_da_pp_por_regional (
  regional_id        uuid primary key references public.regionais(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  estabelecimento_id uuid not null references public.fiscal_estabelecimentos(id) on delete restrict,
  atualizado_por     uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_fcpr_tenant on public.fiscal_cnpj_da_pp_por_regional (tenant_id);
create index if not exists idx_fcpr_estabelecimento on public.fiscal_cnpj_da_pp_por_regional (estabelecimento_id);
create index if not exists idx_fcpr_atualizado_por on public.fiscal_cnpj_da_pp_por_regional (atualizado_por);
comment on table public.fiscal_cnpj_da_pp_por_regional is
  'O CNPJ que o formulário da PP já traz escolhido para os jobs da regional (decisão 156). Sem linha, vale o CNPJ da empresa gerencial do job e, por último, o da empresa principal. Sempre se pode trocar na PP.';

alter table public.fiscal_cnpj_da_pp_por_regional enable row level security;
drop policy if exists fcpr_select on public.fiscal_cnpj_da_pp_por_regional;
-- Todo mundo que gera PP lê (o formulário usa como padrão).
create policy fcpr_select on public.fiscal_cnpj_da_pp_por_regional
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));
drop policy if exists fcpr_modify on public.fiscal_cnpj_da_pp_por_regional;
create policy fcpr_modify on public.fiscal_cnpj_da_pp_por_regional
  for all to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)))
  with check (tenant_id in (select public.current_tenant_ids())
              and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));
revoke all on table public.fiscal_cnpj_da_pp_por_regional from public, anon;
grant select, insert, update, delete on table public.fiscal_cnpj_da_pp_por_regional to authenticated;

drop trigger if exists trg_fcpr_updated_at on public.fiscal_cnpj_da_pp_por_regional;
create trigger trg_fcpr_updated_at
  before update on public.fiscal_cnpj_da_pp_por_regional
  for each row execute function public.set_updated_at();

-- SS (Agência California) → GoCrazy, pedido do Tiago em 07/10/2026.
insert into public.fiscal_cnpj_da_pp_por_regional (regional_id, tenant_id, estabelecimento_id)
select r.id, r.tenant_id, f.id
  from public.regionais r
  join public.empresas e on e.id = r.empresa_id
  join public.fiscal_estabelecimentos f
    on f.tenant_id = r.tenant_id and f.ativo and regexp_replace(f.cnpj, '\D', '', 'g') = '29943648000183'
 where r.nome = 'SS' and e.principal
on conflict (regional_id) do nothing;

-- 3. O CNPJ da PP -------------------------------------------------------------
alter table public.pedidos_compra
  add column if not exists estabelecimento_id uuid references public.fiscal_estabelecimentos(id) on delete restrict;
create index if not exists idx_pp_estabelecimento on public.pedidos_compra (estabelecimento_id) where estabelecimento_id is not null;
comment on column public.pedidos_compra.estabelecimento_id is
  'O CNPJ da PP (decisão 156): sai no cabeçalho do PDF, é o tomador esperado da NF e o CNPJ da conta que paga. Independente de empresa_id, que é a empresa gerencial do job.';

-- Backfill: o tomador da 1ª NF anexada; sem NF, o CNPJ da gerencial; sem
-- ele, o da empresa principal.
update public.pedidos_compra p
   set estabelecimento_id = coalesce(
         (select a.nf_tomador_estabelecimento_id
            from public.pedidos_compra_anexos a
           where a.pedido_compra_id = p.id
             and a.documento_tipo = 'nota_fiscal'
             and a.nf_tomador_estabelecimento_id is not null
           order by a.created_at
           limit 1),
         (select f.id
            from public.empresas e
            join public.fiscal_estabelecimentos f
              on f.tenant_id = e.tenant_id and f.ativo
             and regexp_replace(f.cnpj, '\D', '', 'g') = regexp_replace(e.cnpj, '\D', '', 'g')
           where e.id = p.empresa_id
           order by f.ordem
           limit 1),
         (select f.id
            from public.empresas e
            join public.fiscal_estabelecimentos f
              on f.tenant_id = e.tenant_id and f.ativo
             and regexp_replace(f.cnpj, '\D', '', 'g') = regexp_replace(e.cnpj, '\D', '', 'g')
           where e.tenant_id = p.tenant_id and e.principal
           order by f.ordem
           limit 1))
 where p.estabelecimento_id is null;
