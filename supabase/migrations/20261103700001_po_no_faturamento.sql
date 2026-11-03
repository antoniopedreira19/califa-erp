-- =============================================================================
-- 20261103700001 — O Nº da PO e o anexo da PO no registro do faturamento
-- (decisão 234)
-- =============================================================================
-- A PO (pedido de compra do cliente) chegava ao financeiro só pelo envio para
-- faturamento (`jobs_envio_faturamento.numero_po` e
-- `jobs_envio_faturamento_anexos`, decisão 123). A nota avulsa não tinha onde
-- registrá-la, e na nota de job o que o financeiro conferia ou trocava ao
-- faturar não ficava gravado. Decisão do Tiago (03/11/2026): o registro é
-- sempre feito nas informações do faturamento, porque é o formulário de
-- faturamento que se preenche — na NF em si a PO pode ou não aparecer, depende
-- do cliente.
--
-- • `faturamentos_po`: uma linha por PO da nota. Na avulsa, uma só, sem job;
--   na nota de job, uma por job (e por mês, na planilha mensal), já com o que
--   a produção mandou no envio. Nº da PO opcional; a linha existe quando há
--   número ou anexo.
-- • `faturamentos_po_anexos`: os arquivos da PO. O do envio é referenciado
--   (`envio_anexo_id`, o arquivo fica no bucket `envios-faturamento`, onde
--   ninguém apaga depois do envio); o anexado no Faturar sobe para o bucket
--   `faturamentos-nf`, o mesmo do PDF da nota (admin e financeiro).
--
-- Como a nota, o registro não se edita nem se apaga: só insert e select. O
-- insert vem do `emitirFaturamento`, depois da RPC `emitir_faturamento`, com o
-- cliente de quem emite: a RLS confere que é admin ou financeiro do tenant e
-- que a nota é dele. Select: quem lê a nota (a RLS de `faturamentos`).
-- GRANT de select e insert para `authenticated`, nada para `anon`.
--
-- Mudança ADITIVA: duas tabelas novas, sem tocar nas existentes.
-- =============================================================================

create table public.faturamentos_po (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  faturamento_id  uuid not null references public.faturamentos(id) on delete cascade,
  -- Nulo na nota avulsa.
  job_id          uuid references public.jobs(id) on delete restrict,
  -- O mês do envio na planilha mensal (`chaveInfoDoEnvio`), como o envio grava.
  mes             text,
  numero_po       text,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  constraint chk_faturamentos_po_numero check (numero_po is null or length(btrim(numero_po)) between 1 and 120),
  constraint chk_faturamentos_po_mes check (mes is null or job_id is not null)
);
comment on table public.faturamentos_po is
  'A PO registrada no faturamento (decisão 234): uma por nota avulsa, uma por job (e mês) na nota de job. Imutável, como a nota.';

create unique index uq_faturamentos_po_job on public.faturamentos_po (faturamento_id, coalesce(job_id::text, ''), coalesce(mes, ''));
create index idx_faturamentos_po_tenant on public.faturamentos_po (tenant_id);
create index idx_faturamentos_po_job on public.faturamentos_po (job_id) where job_id is not null;
create index idx_faturamentos_po_created_by on public.faturamentos_po (created_by);

create table public.faturamentos_po_anexos (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete restrict,
  faturamento_po_id  uuid not null references public.faturamentos_po(id) on delete cascade,
  -- O arquivo veio do envio para faturamento: o caminho é o dele.
  envio_anexo_id     uuid references public.jobs_envio_faturamento_anexos(id) on delete restrict,
  bucket             text not null,
  path               text not null,
  nome_arquivo       text not null,
  mime_type          text not null,
  tamanho_bytes      bigint,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  constraint chk_faturamentos_po_anexos_bucket check (
    (envio_anexo_id is not null and bucket = 'envios-faturamento')
    or (envio_anexo_id is null and bucket = 'faturamentos-nf')
  ),
  constraint chk_faturamentos_po_anexos_mime check (mime_type in ('application/pdf', 'image/png', 'image/jpeg'))
);
comment on table public.faturamentos_po_anexos is
  'Os arquivos da PO registrada no faturamento (decisão 234): o do envio por referência (bucket envios-faturamento), o anexado no Faturar no bucket faturamentos-nf.';

create index idx_faturamentos_po_anexos_po on public.faturamentos_po_anexos (faturamento_po_id);
create index idx_faturamentos_po_anexos_tenant on public.faturamentos_po_anexos (tenant_id);
create index idx_faturamentos_po_anexos_envio on public.faturamentos_po_anexos (envio_anexo_id) where envio_anexo_id is not null;
create index idx_faturamentos_po_anexos_created_by on public.faturamentos_po_anexos (created_by);

-- RLS ------------------------------------------------------------------------

alter table public.faturamentos_po enable row level security;
alter table public.faturamentos_po_anexos enable row level security;

-- Quem lê a nota lê a PO dela (a RLS de `faturamentos` no subselect).
create policy faturamentos_po_select on public.faturamentos_po
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and faturamento_id in (select f.id from public.faturamentos f)
  );

create policy faturamentos_po_insert on public.faturamentos_po
  for insert to authenticated
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
    and created_by = (select auth.uid())
    and exists (select 1 from public.faturamentos f where f.id = faturamento_id and f.tenant_id = faturamentos_po.tenant_id)
  );

create policy faturamentos_po_anexos_select on public.faturamentos_po_anexos
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and faturamento_po_id in (select p.id from public.faturamentos_po p)
  );

create policy faturamentos_po_anexos_insert on public.faturamentos_po_anexos
  for insert to authenticated
  with check (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
    and created_by = (select auth.uid())
    and exists (select 1 from public.faturamentos_po p where p.id = faturamento_po_id and p.tenant_id = faturamentos_po_anexos.tenant_id)
    -- O arquivo novo mora na pasta do tenant (`tenant_do_caminho_no_storage`).
    and (bucket <> 'faturamentos-nf' or public.tenant_do_caminho_no_storage(path) = tenant_id)
    -- O do envio é do mesmo job da PO e com o mesmo caminho.
    and (
      envio_anexo_id is null
      or exists (
        select 1
        from public.jobs_envio_faturamento_anexos a
        join public.faturamentos_po p on p.id = faturamento_po_id
        where a.id = envio_anexo_id and a.tenant_id = faturamentos_po_anexos.tenant_id
          and a.job_id = p.job_id and a.path = faturamentos_po_anexos.path
      )
    )
  );

revoke all on public.faturamentos_po from public, anon, authenticated;
revoke all on public.faturamentos_po_anexos from public, anon, authenticated;
grant select, insert on public.faturamentos_po to authenticated;
grant select, insert on public.faturamentos_po_anexos to authenticated;
