-- A NF presa ao job da planilha (decisão 276, 23/11/2026).
--
-- Pedido do Tiago (23/11): lançar no sistema as NFs da aba Faturamento da
-- planilha do financeiro — em aberto ou recebidas desde o início das contas
-- (03/11), mais as 27 da pasta "NFs Pri" — para que todos os títulos a
-- receber existam e a conciliação feche. Boa parte é de jobs que não existem
-- no sistema: os do 1T ao 3T (que nunca serão abertos) e os do 4T que a
-- produção ainda não abriu. Sem tela nova: a NF fica no banco presa ao job da
-- planilha (`historico_jobs`, pela chave e pelo nome) e, quando o financeiro
-- abre o job com o nome da planilha (o campo sugere enquanto se digita), as
-- NFs e os títulos passam para ele sozinhos, com registro.
--
-- Modelo: a NF do job da planilha é uma nota avulsa (o "Sem job" do
-- "+ Faturamento"), com rateio na regional do job da planilha, e cada item
-- guarda a chave e o nome do job da planilha (`faturamento_itens`). Tudo que o
-- sistema já faz com a avulsa — título, baixa, conciliação, Fiscal, fluxo,
-- cancelamento — vale igual. A passagem para o job faz o que a migration
-- 20261118400001 (decisão 265) fez com as três avulsas "referente a um job":
-- a nota vira Novo faturamento do job, sem centro de custo e sem rateio.
-- No job mensal, o mês é o anterior ao da emissão (Tiago, 23/11: a 6397,
-- emitida em 03/11, fatura outubro), e o previsto do mês vem do servidor.
-- As notas que a carga lança para jobs que já existem no sistema também
-- guardam a chave do job da planilha (a origem), sem efeito no resto.
--
-- O fluxo de caixa: a previsão de recebimento da planilha (REC) que cita o
-- número da NF ("NF 6331", na observação) e é do mesmo job da planilha sai do
-- ramo "previsao_planilha" quando a NF está no sistema — no lugar dela fica o
-- título. A retenção prevista (CT) fica: o título entra pelo bruto.
--
-- Mudança aditiva: duas colunas, uma tabela, funções novas, uma condição a
-- mais na `vw_fluxo_caixa` e o item de `emitir_faturamento` gravando as duas
-- colunas novas (o resto da função não muda; a troca é feita no texto atual
-- dela, conferindo que o trecho aparece uma vez).

-- 1. A chave e o nome do job da planilha no item da nota.
alter table public.faturamento_itens
  add column if not exists job_planilha_chave text,
  add column if not exists job_planilha_nome text;

alter table public.faturamento_itens
  drop constraint if exists chk_fat_item_job_planilha;
alter table public.faturamento_itens
  add constraint chk_fat_item_job_planilha check (
    (job_planilha_chave is null) = (job_planilha_nome is null)
    and (
      job_planilha_chave is null
      or (
        length(trim(job_planilha_chave)) > 0
        and length(trim(job_planilha_nome)) > 0
        and origem_tipo in ('avulso', 'job', 'save')
      )
    )
  );

comment on column public.faturamento_itens.job_planilha_chave is
  'Decisão 276: a chave do job da planilha (historico_jobs.chave, "job:…" ou "evento:…") do item. Na nota avulsa, o job que ainda não existe no sistema; na nota de job, a origem da carga.';
comment on column public.faturamento_itens.job_planilha_nome is
  'Decisão 276: o nome do job na planilha, o que o financeiro usa na abertura (nome financeiro).';

create index if not exists idx_faturamento_itens_job_planilha
  on public.faturamento_itens (tenant_id, job_planilha_chave)
  where job_planilha_chave is not null;

-- 2. O registro de cada passagem da NF para o job.
create table if not exists public.faturamentos_passagens_da_planilha (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  faturamento_id uuid not null references public.faturamentos(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete restrict,
  job_planilha_chave text not null,
  job_planilha_nome text not null,
  nome_no_sistema text not null,
  mes_novo_faturamento date,
  previsto_do_mes numeric(14,2),
  passado_por uuid not null references public.profiles(id),
  passado_em timestamptz not null default now()
);

comment on table public.faturamentos_passagens_da_planilha is
  'Decisão 276: a NF presa ao job da planilha que passou para o job aberto no sistema — de qual nome veio, para qual job, quem e quando.';

create index if not exists idx_passagens_planilha_faturamento
  on public.faturamentos_passagens_da_planilha (faturamento_id);
create index if not exists idx_passagens_planilha_job
  on public.faturamentos_passagens_da_planilha (job_id);
create index if not exists idx_passagens_planilha_tenant
  on public.faturamentos_passagens_da_planilha (tenant_id);

alter table public.faturamentos_passagens_da_planilha enable row level security;

drop policy if exists passagens_da_planilha_select on public.faturamentos_passagens_da_planilha;
create policy passagens_da_planilha_select
  on public.faturamentos_passagens_da_planilha
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (
      tenant_id in (select public.current_tenant_ids_com_papel('administrador'::app_role))
      or tenant_id in (select public.current_tenant_ids_com_papel('financeiro'::app_role))
    )
  );

revoke all on public.faturamentos_passagens_da_planilha from anon, public;
grant select on public.faturamentos_passagens_da_planilha to authenticated;

-- 3. Os números de NF que um texto da planilha cita ("NF 6331",
--    "NF 145 (repasse referente a NF 4698)", "NFs 6404/6405"), sem zeros à esquerda.
create or replace function public._numeros_de_nf(p_texto text)
 returns text[]
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct ltrim(n[1], '0')), array[]::text[])
    from regexp_matches(
           coalesce(p_texto, ''),
           '\y(?:NFS?|N\.F\.?|NOTAS?)\s*[:#nº°o.\-]*\s*((?:\d{2,5}\s*(?:[,/&]|\ye\y)?\s*)+)',
           'gi') as g(m)
   cross join lateral regexp_matches(g.m[1], '(\d{2,5})', 'g') as n
   where ltrim(n[1], '0') <> '';
$function$;

revoke all on function public._numeros_de_nf(text) from public, anon;
grant execute on function public._numeros_de_nf(text) to authenticated;

-- 4. A previsão de recebimento da planilha cuja NF já está no sistema.
create or replace function public._previsao_de_nf_lancada(
  p_tenant_id uuid, p_grupo text, p_job_chave text, p_texto text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select p_grupo = 'REC'
     and p_job_chave is not null
     and exists (
       select 1
         from public.faturamento_itens fi
         join public.faturamentos f on f.id = fi.faturamento_id
        where fi.tenant_id = p_tenant_id
          and fi.job_planilha_chave = p_job_chave
          and f.status = 'emitido'
          and ltrim(f.numero_nf, '0') = any (public._numeros_de_nf(p_texto))
     );
$function$;

revoke all on function public._previsao_de_nf_lancada(uuid, text, text, text) from public, anon, authenticated;

do $$
declare
  v_def    text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  v_ancora constant text := 'WHERE ((h.extrato_linha_id IS NULL) AND (h.valor <> (0)::numeric)';
begin
  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception 'vw_fluxo_caixa: o ramo da previsão da planilha não apareceu 1 vez.';
  end if;
  execute 'create or replace view public.vw_fluxo_caixa as ' || replace(v_def, v_ancora,
    v_ancora || ' AND (NOT public._previsao_de_nf_lancada(h.tenant_id, h.grupo, h.job_chave,'
             || ' concat_ws('' '', h.descricao, h.documento, h.observacao, h.parcela)))');
end;
$$;

-- 5. `emitir_faturamento` grava a chave e o nome do job da planilha do item.
do $$
declare
  v_def  text := pg_get_functiondef('public.emitir_faturamento(jsonb)'::regprocedure);
  v_de   constant text :=
'    insert into public.faturamento_itens (
      tenant_id, faturamento_id, origem_tipo, origem_id,
      envio_parcela_id, valor
    ) values (
      v_tenant_id, v_faturamento_id,
      (v_item->>''origem_tipo'')::faturamento_origem,
      nullif(v_item->>''origem_id'', '''')::uuid,
      nullif(v_item->>''envio_parcela_id'', '''')::uuid,
      (v_item->>''valor'')::numeric
    );';
  v_para constant text :=
'    -- 276: a chave e o nome do job da planilha (a NF presa a ele, ou a origem da carga).
    insert into public.faturamento_itens (
      tenant_id, faturamento_id, origem_tipo, origem_id,
      envio_parcela_id, valor, job_planilha_chave, job_planilha_nome
    ) values (
      v_tenant_id, v_faturamento_id,
      (v_item->>''origem_tipo'')::faturamento_origem,
      nullif(v_item->>''origem_id'', '''')::uuid,
      nullif(v_item->>''envio_parcela_id'', '''')::uuid,
      (v_item->>''valor'')::numeric,
      nullif(trim(v_item->>''job_planilha_chave''), ''''),
      nullif(trim(v_item->>''job_planilha_nome''), '''')
    );';
begin
  if (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'emitir_faturamento: o insert do item não apareceu 1 vez.';
  end if;
  execute replace(v_def, v_de, v_para);
end;
$$;

-- 6. O nome comparado: sem acento, sem caixa e com os espaços de um em um.
create or replace function public._nome_de_job_comparavel(p_nome text)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select lower(regexp_replace(trim(unaccent(coalesce(p_nome, ''))), '\s+', ' ', 'g'));
$function$;

revoke all on function public._nome_de_job_comparavel(text) from public, anon;
grant execute on function public._nome_de_job_comparavel(text) to authenticated;

-- 7. Os jobs da planilha com NF esperando (a sugestão do nome na abertura).
--    Só as notas de um job da planilha só: a de vários jobs não passa sozinha.
create or replace function public.jobs_da_planilha_com_nf()
 returns table (
   job_planilha_chave text,
   job_planilha_nome text,
   cliente_id uuid,
   empresa_id uuid,
   qtd_nfs integer,
   valor numeric
 )
 language sql
 stable
 security invoker
 set search_path to 'public'
as $function$
  with notas as (
    select f.id, f.cliente_id, f.empresa_id, f.valor_total,
           min(fi.job_planilha_chave) as chave,
           min(fi.job_planilha_nome) as nome
      from public.faturamentos f
      join public.faturamento_itens fi on fi.faturamento_id = f.id
     where f.status = 'emitido'
       and f.origem_tipo = 'avulso'
     group by f.id
    having bool_and(fi.job_planilha_chave is not null)
       and count(distinct fi.job_planilha_chave) = 1
  )
  select n.chave, n.nome, min(n.cliente_id::text)::uuid, min(n.empresa_id::text)::uuid,
         count(*)::integer, sum(n.valor_total)
    from notas n
   group by n.chave, n.nome
   order by n.nome;
$function$;

revoke all on function public.jobs_da_planilha_com_nf() from public, anon;
grant execute on function public.jobs_da_planilha_com_nf() to authenticated;

-- 8. A passagem de uma NF presa ao job da planilha para o job do sistema.
--    Quem chama (a abertura do job) já leu o mês e o previsto do mês no job
--    mensal, pela mesma leitura do Novo faturamento.
create or replace function public.passar_nf_da_planilha_ao_job(
  p_faturamento_id uuid,
  p_job_id uuid,
  p_mes date,
  p_previsto_do_mes numeric
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job     record;
  v_nota    record;
  v_chave   text;
  v_nome    text;
  v_rateio  jsonb;
  v_previsto numeric(14,2);
begin
  select j.id, j.tenant_id, j.codigo, j.status::text as status, j.empresa_id, j.cliente_id,
         j.nome_financeiro, j.faturamento_save_previsto, j.faturamento_previsto
    into v_job
    from public.jobs j
   where j.id = p_job_id
     for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  if not exists (
    select 1
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.user_id = (select auth.uid())
       and tm.tenant_id = v_job.tenant_id
       and tm.status = 'ativo'
       and p.ativo = true
       and tm.role in ('administrador', 'financeiro')
  ) then
    raise exception 'Apenas administrador ou financeiro passa a NF da planilha para o job.';
  end if;

  if v_job.status not in ('aberto', 'em_producao', 'encerrado', 'finalizado') then
    raise exception 'O % não está aberto: a NF da planilha não passa para ele.', v_job.codigo;
  end if;

  select f.id, f.tenant_id, f.numero_nf, f.status::text as status, f.origem_tipo::text as origem_tipo,
         f.empresa_id, f.cliente_id, f.plano_conta_tipo_id, f.plano_conta_subtipo_id
    into v_nota
    from public.faturamentos f
   where f.id = p_faturamento_id
     for update;
  if not found or v_nota.tenant_id <> v_job.tenant_id then
    raise exception 'NF não encontrada.';
  end if;
  if v_nota.status <> 'emitido' or v_nota.origem_tipo <> 'avulso' then
    raise exception 'A NF % não está presa a um job da planilha.', v_nota.numero_nf;
  end if;

  select min(fi.job_planilha_chave), min(fi.job_planilha_nome)
    into v_chave, v_nome
    from public.faturamento_itens fi
   where fi.faturamento_id = v_nota.id
  having bool_and(fi.job_planilha_chave is not null)
     and count(distinct fi.job_planilha_chave) = 1;
  if v_chave is null then
    raise exception 'A NF % não é de um job da planilha só.', v_nota.numero_nf;
  end if;
  if public._nome_de_job_comparavel(v_nome) <> public._nome_de_job_comparavel(v_job.nome_financeiro) then
    raise exception 'A NF % é do job da planilha "%", e o nome do % é outro.', v_nota.numero_nf, v_nome, v_job.codigo;
  end if;

  -- As travas da conversão da decisão 265 e do Novo faturamento.
  if v_nota.empresa_id is distinct from v_job.empresa_id then
    raise exception 'A NF % é de outra empresa (gerencial) que o %.', v_nota.numero_nf, v_job.codigo;
  end if;
  if v_nota.cliente_id is distinct from v_job.cliente_id then
    raise exception 'A NF % é de outro cliente que o %.', v_nota.numero_nf, v_job.codigo;
  end if;
  if coalesce(v_job.faturamento_save_previsto, 0) > 0 then
    raise exception 'O % gera save: a NF % precisa ser dividida entre o job e o save, à mão.', v_job.codigo, v_nota.numero_nf;
  end if;
  if exists (
    select 1 from public.vw_faturamento_pendente v
     where v.origem_tipo = 'job'
       and v.job_id = v_job.id
       and v.saldo > 0.004
       and (p_mes is null or v.mes_referencia = p_mes)
  ) then
    raise exception 'O GP enviou o % para faturamento: a NF % sai pelo envio.', v_job.codigo, v_nota.numero_nf;
  end if;
  if p_mes is not null then
    if extract(day from p_mes) <> 1 then
      raise exception 'O mês do Novo faturamento começa no dia 1.';
    end if;
    if p_previsto_do_mes is null or p_previsto_do_mes < 0 then
      raise exception 'Informe o previsto do mês do Novo faturamento.';
    end if;
    v_previsto := p_previsto_do_mes;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('regional_id', r.regional_id, 'percentual', r.percentual)), '[]'::jsonb)
    into v_rateio
    from public.faturamentos_regionais r
   where r.faturamento_id = v_nota.id;

  update public.faturamentos
     set origem_tipo = 'job',
         origem_id = v_job.id,
         job_referencia_id = null,
         faturado_pelo_financeiro = true,
         mes_novo_faturamento = p_mes,
         previsto_do_mes = v_previsto,
         plano_conta_tipo_id = null,
         plano_conta_subtipo_id = null
   where id = v_nota.id;
  update public.faturamento_itens
     set origem_tipo = 'job',
         origem_id = v_job.id
   where faturamento_id = v_nota.id
     and origem_tipo = 'avulso';
  delete from public.faturamentos_regionais where faturamento_id = v_nota.id;
  update public.faturamentos_po
     set job_id = v_job.id
   where faturamento_id = v_nota.id
     and job_id is null;

  insert into public.faturamentos_passagens_da_planilha (
    tenant_id, faturamento_id, job_id, job_planilha_chave, job_planilha_nome,
    nome_no_sistema, mes_novo_faturamento, previsto_do_mes, passado_por
  ) values (
    v_job.tenant_id, v_nota.id, v_job.id, v_chave, v_nome,
    v_job.nome_financeiro, p_mes, v_previsto, (select auth.uid())
  );

  perform public.log_audit_event(
    'faturamento.passado_da_planilha_ao_job', v_job.tenant_id, 'faturamento', v_nota.id::text,
    jsonb_build_object(
      'decisao', 276,
      'numero_nf', v_nota.numero_nf,
      'job_id', v_job.id,
      'job_codigo', v_job.codigo,
      'job_planilha_chave', v_chave,
      'job_planilha_nome', v_nome,
      'mes_novo_faturamento', p_mes,
      'antes', jsonb_build_object(
        'origem_tipo', 'avulso',
        'plano_conta_tipo_id', v_nota.plano_conta_tipo_id,
        'plano_conta_subtipo_id', v_nota.plano_conta_subtipo_id,
        'rateio', v_rateio
      )
    )
  );

  -- O carimbo, pela regra do Novo faturamento.
  if public.job_faturamento_todo_enviado(v_job.id, v_job.faturamento_previsto) then
    update public.jobs
       set faturamento_enviado_em = coalesce(faturamento_enviado_em, now())
     where id = v_job.id;
  end if;
end;
$function$;

revoke all on function public.passar_nf_da_planilha_ao_job(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.passar_nf_da_planilha_ao_job(uuid, uuid, date, numeric) to authenticated;
