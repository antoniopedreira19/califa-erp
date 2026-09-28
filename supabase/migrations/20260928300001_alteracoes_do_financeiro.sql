-- =====================================================================
-- O financeiro edita o orçado do job — decisão 115 (28/09/2026)
--
-- Pedido do Tiago: na Planilha Interna do job no FINANCEIRO, um botão
-- "Editar orçado" no lugar em que a produção tem o "Realizar errata". A
-- edição não passa por aprovação nem pela revisão da abertura: vale na
-- hora. Cada uma fica registrada num card "Alterações do Financeiro" (na
-- aba Informações do Job, nas duas telas), com quem fez.
--
-- As respostas dele que moldam este arquivo:
--   P1  o financeiro edita só os VALORES do orçado (R$ unitário, QT e D/M).
--       Tipo de custo, linha nova, linha removida, linha vermelha e o
--       planejado continuam sendo da errata da produção.
--   P2  linha com PP já no financeiro é editável (a errata não é).
--   P3  a previsão de recebimento ACOMPANHA a alteração: cada parcela na
--       proporção dela, sem mudar a data. Os recolhimentos de imposto
--       (decisão 100) seguem a mesma regra — eles precisam fechar com o
--       imposto previsto, que muda junto.
--   P4  vale até a primeira NOTA emitida, mesmo que parcial. Com o job já
--       enviado e ainda sem nota, o envio (valor e parcelas) acompanha. No
--       modelo mensal a trava é por mês: só o mês com nota fica de fora.
--       A trava da nota é conferida pela action; a função só se recusa a
--       mexer em parcela de envio que já virou nota.
--   P5  a produção vê o card e o aviso na Comunicação.
--
-- Por que tabela nova, e não `jobs_erratas` com uma coluna de origem:
-- toda errata registrada depois da última foto da abertura é "pendente de
-- revisão" (decisão 059) — o mural, a faixa da revisão e o histórico das
-- fotos contam com isso. Uma alteração do financeiro não é revisada por
-- ninguém; misturar as duas faria cada leitor de errata precisar de um
-- filtro, e o primeiro que esquecesse devolveria o job ao mural.
--
-- Histórico imutável, como as fotos da abertura: sem UPDATE nem DELETE,
-- nem na policy nem no grant. Só administrador e financeiro gravam.
--
-- `registrar_alteracao_do_financeiro` grava tudo numa transação, como a
-- `registrar_errata_do_job` (24/09/2026): o histórico, as linhas, o envio,
-- as previsões e os números do job — ou nada. Roda como o usuário
-- (SECURITY INVOKER): valem as policies e as travas de banco (a de save,
-- `save_trava_linha_job`, recusa linha com save). O ENVIO é atualizado
-- ANTES dos números do job: na ordem inversa, `jobs_carimba_faturamento_
-- enviado` veria o faturamento novo contra o envio velho, apagaria
-- `faturamento_enviado_em` e o carimbo voltaria com a hora de agora.
-- =====================================================================

create table if not exists public.jobs_alteracoes_financeiro (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id),
  job_id                      uuid not null references public.jobs(id) on delete cascade,
  motivo                      text not null
                                check (char_length(btrim(motivo)) between 5 and 500),
  custo_orcado_antes          numeric(14,2) not null,
  custo_orcado_depois         numeric(14,2) not null,
  valor_job_antes             numeric(14,2) not null,
  valor_job_depois            numeric(14,2) not null,
  faturamento_previsto_antes  numeric(14,2) not null,
  faturamento_previsto_depois numeric(14,2) not null,
  -- O que as previsões e o envio eram e passaram a ser. Fotos para
  -- leitura, abertas inteiras: [{data_prevista, valor}] e, no envio,
  -- [{mes, valor_faturado, parcelas: [{data_vencimento, valor}]}].
  recebimento_antes           jsonb not null default '[]'::jsonb,
  recebimento_depois          jsonb not null default '[]'::jsonb,
  impostos_antes              jsonb not null default '[]'::jsonb,
  impostos_depois             jsonb not null default '[]'::jsonb,
  envio_antes                 jsonb not null default '[]'::jsonb,
  envio_depois                jsonb not null default '[]'::jsonb,
  created_by                  uuid references public.profiles(id) on delete set null,
  created_at                  timestamptz not null default now()
);

create table if not exists public.jobs_alteracoes_financeiro_itens (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id),
  alteracao_id                uuid not null
                                references public.jobs_alteracoes_financeiro(id) on delete cascade,
  -- Nulo se a linha sumir depois (errata que a remove): o nome fica.
  job_item_orcado_id          uuid references public.jobs_itens_orcado(id) on delete set null,
  item_nome                   text not null,
  grupo_nome                  text not null,
  -- Modelo mensal (decisão 078): o mês da linha. Nulo nos outros.
  mes                         date,
  tipo_custo                  public.tipo_custo not null,
  valor_unitario_de           numeric not null,
  valor_unitario_para         numeric not null,
  quantidade_de               numeric not null,
  quantidade_para             numeric not null,
  dias_meses_de               numeric not null,
  dias_meses_para             numeric not null,
  total_de                    numeric(14,2) not null,
  total_para                  numeric(14,2) not null,
  efeito_valor_job            numeric(14,2) not null,
  efeito_faturamento_previsto numeric(14,2) not null,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_jobs_alteracoes_financeiro_job
  on public.jobs_alteracoes_financeiro (job_id, created_at desc);
create index if not exists idx_jobs_alteracoes_financeiro_tenant
  on public.jobs_alteracoes_financeiro (tenant_id);
create index if not exists idx_jobs_alteracoes_financeiro_created_by
  on public.jobs_alteracoes_financeiro (created_by);
create index if not exists idx_jobs_alteracoes_financeiro_itens_alteracao
  on public.jobs_alteracoes_financeiro_itens (alteracao_id);
create index if not exists idx_jobs_alteracoes_financeiro_itens_tenant
  on public.jobs_alteracoes_financeiro_itens (tenant_id);
create index if not exists idx_jobs_alteracoes_financeiro_itens_linha
  on public.jobs_alteracoes_financeiro_itens (job_item_orcado_id);

alter table public.jobs_alteracoes_financeiro enable row level security;
alter table public.jobs_alteracoes_financeiro_itens enable row level security;

-- Leitura: a mesma das erratas (o freelancer só no projeto dele).
drop policy if exists jobs_alteracoes_financeiro_select on public.jobs_alteracoes_financeiro;
create policy jobs_alteracoes_financeiro_select on public.jobs_alteracoes_financeiro
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      (select public.session_role()) <> 'freelancer'::public.app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_alteracoes_financeiro.job_id
           and public.is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

-- Escrita: só quem edita o orçado pelo financeiro.
drop policy if exists jobs_alteracoes_financeiro_insert on public.jobs_alteracoes_financeiro;
create policy jobs_alteracoes_financeiro_insert on public.jobs_alteracoes_financeiro
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (select public.session_role()) in ('administrador'::public.app_role, 'financeiro'::public.app_role)
  );

drop policy if exists jobs_alteracoes_financeiro_itens_select on public.jobs_alteracoes_financeiro_itens;
create policy jobs_alteracoes_financeiro_itens_select on public.jobs_alteracoes_financeiro_itens
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      (select public.session_role()) <> 'freelancer'::public.app_role
      or exists (
        select 1
          from public.jobs_alteracoes_financeiro a
          join public.jobs j on j.id = a.job_id
         where a.id = jobs_alteracoes_financeiro_itens.alteracao_id
           and public.is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

drop policy if exists jobs_alteracoes_financeiro_itens_insert on public.jobs_alteracoes_financeiro_itens;
create policy jobs_alteracoes_financeiro_itens_insert on public.jobs_alteracoes_financeiro_itens
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and (select public.session_role()) in ('administrador'::public.app_role, 'financeiro'::public.app_role)
  );

grant select, insert on public.jobs_alteracoes_financeiro to authenticated;
grant select, insert on public.jobs_alteracoes_financeiro_itens to authenticated;

comment on table public.jobs_alteracoes_financeiro is
  'Cada edicao do orcado do job feita pelo financeiro ("Editar orcado" da Planilha Interna), sem aprovacao. Imutavel — sem update nem delete (decisao 115).';
comment on column public.jobs_alteracoes_financeiro.motivo is
  'O "Motivo da alteracao" do pop-up de confirmacao: obrigatorio, de 5 a 500 caracteres.';
comment on column public.jobs_alteracoes_financeiro.envio_antes is
  'Envios para faturamento que a alteracao acompanhou (job enviado e ainda sem nota): [{mes, valor_faturado, parcelas: [{data_vencimento, valor}]}]. Vazio quando nao havia envio a acompanhar.';
comment on table public.jobs_alteracoes_financeiro_itens is
  'As linhas de uma alteracao do financeiro: o orcado de antes e de depois e o efeito de cada uma no faturamento previsto e no valor do job (decisao 115).';

-- ---------------------------------------------------------------------
-- A gravação, numa transação só
-- ---------------------------------------------------------------------
create or replace function public.registrar_alteracao_do_financeiro(p_job_id uuid, p jsonb)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job   record;
  v_uid   uuid := (select auth.uid());
  v_id    uuid;
  v_row   jsonb;
  a       jsonb := p->'alteracao';
begin
  select j.id, j.tenant_id
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- ---- O histórico ----
  insert into public.jobs_alteracoes_financeiro (
    tenant_id, job_id, motivo,
    custo_orcado_antes, custo_orcado_depois,
    valor_job_antes, valor_job_depois,
    faturamento_previsto_antes, faturamento_previsto_depois,
    recebimento_antes, recebimento_depois,
    impostos_antes, impostos_depois,
    envio_antes, envio_depois,
    created_by
  ) values (
    v_job.tenant_id, p_job_id, a->>'motivo',
    (a->>'custo_orcado_antes')::numeric, (a->>'custo_orcado_depois')::numeric,
    (a->>'valor_job_antes')::numeric, (a->>'valor_job_depois')::numeric,
    (a->>'faturamento_previsto_antes')::numeric, (a->>'faturamento_previsto_depois')::numeric,
    coalesce(a->'recebimento_antes', '[]'::jsonb), coalesce(a->'recebimento_depois', '[]'::jsonb),
    coalesce(a->'impostos_antes', '[]'::jsonb), coalesce(a->'impostos_depois', '[]'::jsonb),
    coalesce(a->'envio_antes', '[]'::jsonb), coalesce(a->'envio_depois', '[]'::jsonb),
    v_uid
  )
  returning id into v_id;

  for v_row in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb))
  loop
    insert into public.jobs_alteracoes_financeiro_itens (
      tenant_id, alteracao_id, job_item_orcado_id,
      item_nome, grupo_nome, mes, tipo_custo,
      valor_unitario_de, valor_unitario_para,
      quantidade_de, quantidade_para,
      dias_meses_de, dias_meses_para,
      total_de, total_para,
      efeito_valor_job, efeito_faturamento_previsto
    ) values (
      v_job.tenant_id, v_id, (v_row->>'job_item_orcado_id')::uuid,
      v_row->>'item_nome', v_row->>'grupo_nome', nullif(v_row->>'mes', '')::date,
      (v_row->>'tipo_custo')::public.tipo_custo,
      (v_row->>'valor_unitario_de')::numeric, (v_row->>'valor_unitario_para')::numeric,
      (v_row->>'quantidade_de')::numeric, (v_row->>'quantidade_para')::numeric,
      (v_row->>'dias_meses_de')::numeric, (v_row->>'dias_meses_para')::numeric,
      (v_row->>'total_de')::numeric, (v_row->>'total_para')::numeric,
      (v_row->>'efeito_valor_job')::numeric, (v_row->>'efeito_faturamento_previsto')::numeric
    );
  end loop;

  -- ---- As linhas: só os valores do orçado (P1) ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'linhas', '[]'::jsonb))
  loop
    update public.jobs_itens_orcado
       set valor_unitario_orcado = (v_row->>'valor_unitario_orcado')::numeric,
           quantidade_orcada = (v_row->>'quantidade_orcada')::numeric,
           dias_meses_orcado = (v_row->>'dias_meses_orcado')::numeric,
           updated_at = now()
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id
       and linha_vermelha = false;
    if not found then
      raise exception 'Uma das linhas alteradas não pertence a este job, ou é linha vermelha.';
    end if;
  end loop;

  -- ---- O envio, antes dos números do job (ver o cabeçalho) ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'envios', '[]'::jsonb))
  loop
    update public.jobs_envio_faturamento
       set valor_faturado = (v_row->>'valor_faturado')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'O envio para faturamento não pertence a este job.';
    end if;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p->'parcelas_envio', '[]'::jsonb))
  loop
    -- Parcela que já virou nota não se reescreve (P4).
    if exists (
      select 1
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.envio_parcela_id = (v_row->>'id')::uuid
         and f.status = 'emitido'
    ) then
      raise exception 'Uma parcela do envio já virou nota emitida: o orçado desse faturamento não muda mais.';
    end if;
    update public.jobs_envio_faturamento_parcelas
       set valor = (v_row->>'valor')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'Uma parcela do envio não pertence a este job.';
    end if;
  end loop;

  -- ---- As previsões da abertura (P3) ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'recebimento', '[]'::jsonb))
  loop
    update public.jobs_previsao_recebimento
       set valor = (v_row->>'valor')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'Uma parcela da previsão de recebimento não pertence a este job.';
    end if;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p->'impostos', '[]'::jsonb))
  loop
    update public.jobs_previsao_impostos
       set valor = (v_row->>'valor')::numeric
     where id = (v_row->>'id')::uuid
       and job_id = p_job_id;
    if not found then
      raise exception 'Um recolhimento de imposto previsto não pertence a este job.';
    end if;
  end loop;

  -- ---- Os números do job ----
  update public.jobs
     set valor_total = (p->'espelhos'->>'valor_total')::numeric,
         faturamento_previsto = (p->'espelhos'->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p->'espelhos'->>'faturamento_save_previsto')::numeric
   where id = p_job_id;

  return v_id;
end;
$function$;

revoke all on function public.registrar_alteracao_do_financeiro(uuid, jsonb) from public, anon;
grant execute on function public.registrar_alteracao_do_financeiro(uuid, jsonb) to authenticated;

comment on function public.registrar_alteracao_do_financeiro(uuid, jsonb) is
  'Grava uma alteracao do orcado feita pelo financeiro (decisao 115) numa transacao: historico, valores das linhas, envio sem nota, previsoes de recebimento e de impostos e os espelhos do job. SECURITY INVOKER.';
