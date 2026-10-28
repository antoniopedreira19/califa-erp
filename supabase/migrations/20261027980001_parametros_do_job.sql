-- Decisão 224 — o financeiro edita os parâmetros da versão na abertura do job.
--
-- Pedido do Tiago (27/10/2026, protótipo aprovado): honorários/fee e
-- impostos (todos os modelos) e, no internacional, int. taxes, Impostos BR,
-- custo de transação e câmbio — a linha do cabeçalho da versão — passam a
-- ser editáveis pelo financeiro na Planilha Interna da abertura, como já é
-- o "Editar orçado" (decisão 115). Respostas dele:
--   * grava no JOB; a versão aprovada fica como o cliente aprovou;
--   * motivo obrigatório, num pop-up ao salvar (confirmação A);
--   * no internacional o financeiro edita também int. taxes, Impostos BR e
--     custo de transação, sem passar pela Exceção do administrador (206);
--   * depois da abertura só o câmbio continua editável.
--
-- O que esta migration cria:
--   1. `jobs_parametros` — os parâmetros do job, 1:1 com `jobs`. A linha só
--      existe depois da primeira alteração e guarda o retrato INTEIRO (não
--      só o campo mudado): sem linha, o job segue a versão aprovada.
--   2. `vw_parametros_do_job` — a leitura única "o que vale para o job":
--      a linha de `jobs_parametros` quando existe, a versão aprovada quando
--      não. `vw_job_rentabilidade` e `vw_saves_por_job` passam a ler daqui.
--   3. `jobs_alteracoes_financeiro.parametros` — o de → para dos parâmetros
--      no mesmo histórico do "Editar orçado" (card Alterações do
--      Financeiro). Nulo nas alterações só de linhas.
--   4. `registrar_alteracao_do_financeiro` aceita `p->'parametros'`
--      ({de, para}) além das linhas: grava o retrato, o histórico e os
--      números do job numa transação só. Depois da abertura recusa mudar
--      qualquer coisa que não seja o câmbio.
--
-- Fica de fora, de propósito: nada é copiado para os jobs que já existem
-- (sem linha = versão aprovada, a mesma leitura de sempre); a versão
-- aprovada não é tocada.

-- ---- 1. Os parâmetros do job ------------------------------------------------

create table if not exists public.jobs_parametros (
  job_id                uuid primary key references public.jobs(id) on delete cascade,
  tenant_id             uuid not null references public.tenants(id),
  percentual_honorarios numeric(6,3)  not null,
  percentual_imposto    numeric(10,6) not null,
  percentual_int_taxes  numeric(10,6) not null default 0,
  int_transaction_costs numeric(14,2) not null default 0,
  moeda_estrangeira     text,
  cambio_cotacao        numeric(14,6),
  cambio_compra         numeric(12,4),
  cambio_venda          numeric(14,6),
  cambio_data           date,
  percentual_veiculo    numeric(6,3)  not null default 80,
  base_honorarios       text          not null default 'negociado',
  updated_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  constraint jobs_parametros_percentuais_check check (
    percentual_honorarios between 0 and 100
    and percentual_imposto >= 0 and percentual_imposto < 100
    and percentual_int_taxes >= 0 and percentual_int_taxes < 100
    and int_transaction_costs >= 0
    and percentual_veiculo between 0 and 100
  ),
  constraint jobs_parametros_base_check check (base_honorarios in ('negociado', 'liquido'))
);

comment on table public.jobs_parametros is
  'Decisão 224: os parâmetros do job (honorários, impostos, cadeia internacional, câmbio, base da mídia) depois que o financeiro os alterou. Sem linha, o job segue a versão aprovada. Leia por vw_parametros_do_job.';

create index if not exists jobs_parametros_tenant_idx on public.jobs_parametros (tenant_id);

alter table public.jobs_parametros enable row level security;

drop policy if exists jobs_parametros_select on public.jobs_parametros;
create policy jobs_parametros_select on public.jobs_parametros
  for select to authenticated
  using (
    is_tenant_member(tenant_id)
    and (
      (select session_role()) <> 'freelancer'::app_role
      or exists (
        select 1 from public.jobs j
         where j.id = jobs_parametros.job_id
           and is_freelancer_do_projeto(j.projeto_id)
      )
    )
  );

-- Escrita só pela função (security invoker): administrador e financeiro,
-- os mesmos do "Editar orçado".
drop policy if exists jobs_parametros_insert on public.jobs_parametros;
create policy jobs_parametros_insert on public.jobs_parametros
  for insert to authenticated
  with check (
    is_tenant_member(tenant_id)
    and (select session_role()) = any (array['administrador'::app_role, 'financeiro'::app_role])
  );

drop policy if exists jobs_parametros_update on public.jobs_parametros;
create policy jobs_parametros_update on public.jobs_parametros
  for update to authenticated
  using (
    is_tenant_member(tenant_id)
    and (select session_role()) = any (array['administrador'::app_role, 'financeiro'::app_role])
  )
  with check (
    is_tenant_member(tenant_id)
    and (select session_role()) = any (array['administrador'::app_role, 'financeiro'::app_role])
  );

revoke all on public.jobs_parametros from anon;
grant select, insert, update on public.jobs_parametros to authenticated;

-- ---- 2. A leitura única -----------------------------------------------------

create or replace view public.vw_parametros_do_job
with (security_invoker = true) as
select
  j.id        as job_id,
  j.tenant_id,
  (jp.job_id is not null) as alterado,
  case when jp.job_id is null then v.percentual_honorarios else jp.percentual_honorarios end as percentual_honorarios,
  case when jp.job_id is null then v.percentual_imposto    else jp.percentual_imposto    end as percentual_imposto,
  case when jp.job_id is null then v.percentual_int_taxes  else jp.percentual_int_taxes  end as percentual_int_taxes,
  case when jp.job_id is null then v.int_transaction_costs else jp.int_transaction_costs end as int_transaction_costs,
  case when jp.job_id is null then v.moeda_estrangeira     else jp.moeda_estrangeira     end as moeda_estrangeira,
  case when jp.job_id is null then v.cambio_cotacao        else jp.cambio_cotacao        end as cambio_cotacao,
  case when jp.job_id is null then v.cambio_compra         else jp.cambio_compra         end as cambio_compra,
  case when jp.job_id is null then v.cambio_venda          else jp.cambio_venda          end as cambio_venda,
  case when jp.job_id is null then v.cambio_data           else jp.cambio_data           end as cambio_data,
  case when jp.job_id is null then v.percentual_veiculo    else jp.percentual_veiculo    end as percentual_veiculo,
  case when jp.job_id is null then v.base_honorarios       else jp.base_honorarios       end as base_honorarios
from public.jobs j
join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
left join public.jobs_parametros jp on jp.job_id = j.id;

comment on view public.vw_parametros_do_job is
  'Decisão 224: os parâmetros que valem para o job — os de jobs_parametros quando o financeiro os alterou, os da versão aprovada quando não.';

revoke all on public.vw_parametros_do_job from anon;
grant select on public.vw_parametros_do_job to authenticated;

-- As duas views do job que leem os percentuais passam a ler a leitura única.
-- A troca é feita sobre a definição viva (as views são de outras entregas e
-- podem ter mudado): a junção com a versão vira a junção com a view acima,
-- que expõe as mesmas colunas com o mesmo nome. Para se o alvo sumir.
do $$
declare
  v_def text;
  v_nova text;
begin
  v_def := pg_get_viewdef('public.vw_job_rentabilidade'::regclass);
  v_nova := replace(
    v_def,
    'JOIN versoes_orcamento v ON ((v.id = j.versao_orcamento_aprovada_id))',
    'JOIN vw_parametros_do_job v ON ((v.job_id = j.id))'
  );
  if v_nova = v_def and position('vw_parametros_do_job' in v_def) = 0 then
    raise exception 'vw_job_rentabilidade mudou: a junção com a versão aprovada não foi encontrada.';
  end if;
  execute 'create or replace view public.vw_job_rentabilidade with (security_invoker = true) as ' || v_nova;

  v_def := pg_get_viewdef('public.vw_saves_por_job'::regclass);
  v_nova := replace(
    v_def,
    'LEFT JOIN versoes_orcamento v ON ((v.id = j.versao_orcamento_aprovada_id))',
    'LEFT JOIN vw_parametros_do_job v ON ((v.job_id = j.id))'
  );
  if v_nova = v_def and position('vw_parametros_do_job' in v_def) = 0 then
    raise exception 'vw_saves_por_job mudou: a junção com a versão aprovada não foi encontrada.';
  end if;
  execute 'create or replace view public.vw_saves_por_job with (security_invoker = true) as ' || v_nova;
end;
$$;

-- ---- 3. O histórico ---------------------------------------------------------

alter table public.jobs_alteracoes_financeiro
  add column if not exists parametros jsonb;

comment on column public.jobs_alteracoes_financeiro.parametros is
  'Decisão 224: {de, para} dos parâmetros do job (os campos de jobs_parametros) quando a alteração mexeu neles. Nulo nas alterações só de linhas.';

-- ---- 4. A gravação ----------------------------------------------------------

create or replace function public.registrar_alteracao_do_financeiro(p_job_id uuid, p jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job     record;
  v_linha   record;
  v_uid     uuid := (select auth.uid());
  v_id      uuid;
  v_row     jsonb;
  v_tipo    public.tipo_custo;
  v_gravado public.tipo_custo;
  v_lanc    text;
  v_na_fila boolean;
  v_plan_u  numeric;
  v_plan_q  numeric;
  v_plan_d  numeric;
  a         jsonb := p->'alteracao';
  -- Decisão 224: os parâmetros do job.
  v_par     jsonb := p->'parametros'->'para';
  v_atual   record;
begin
  select j.id, j.tenant_id, j.status, j.data_abertura_financeiro
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  -- Da fila da abertura até a primeira nota (a action confere) ou o
  -- encerramento (aqui também).
  if not (
       v_job.status = 'aguardando_abertura'
    or (v_job.data_abertura_financeiro is not null
        and v_job.status in ('aberto', 'em_producao'))
  ) then
    raise exception 'O orçado só é editado pelo financeiro na abertura do job ou com o job aberto: depois do encerramento, não muda mais.';
  end if;

  -- Na fila, o job ainda não abriu: a edição é parte do valor inicial
  -- (revisão de 13/10/2026) e o planejado também se edita (14/10/2026).
  v_na_fila := v_job.status = 'aguardando_abertura';

  -- ---- Os parâmetros (decisão 224): depois da abertura, só o câmbio ----
  if v_par is not null then
    select * into v_atual from public.vw_parametros_do_job where job_id = p_job_id;
    if not found then
      raise exception 'O job não tem versão aprovada: não há parâmetros para alterar.';
    end if;
    if not v_na_fila and (
         (v_par->>'percentual_honorarios')::numeric is distinct from v_atual.percentual_honorarios
      or (v_par->>'percentual_imposto')::numeric    is distinct from v_atual.percentual_imposto
      or (v_par->>'percentual_int_taxes')::numeric  is distinct from v_atual.percentual_int_taxes
      or (v_par->>'int_transaction_costs')::numeric is distinct from v_atual.int_transaction_costs
      or (v_par->>'percentual_veiculo')::numeric    is distinct from v_atual.percentual_veiculo
      or (v_par->>'base_honorarios')                is distinct from v_atual.base_honorarios
    ) then
      raise exception 'Depois da abertura só o câmbio muda: honorários, impostos e taxas ficam como o job abriu.';
    end if;

    insert into public.jobs_parametros (
      job_id, tenant_id,
      percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs,
      moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data,
      percentual_veiculo, base_honorarios, updated_by
    ) values (
      p_job_id, v_job.tenant_id,
      (v_par->>'percentual_honorarios')::numeric, (v_par->>'percentual_imposto')::numeric,
      (v_par->>'percentual_int_taxes')::numeric, (v_par->>'int_transaction_costs')::numeric,
      nullif(v_par->>'moeda_estrangeira', ''), (v_par->>'cambio_cotacao')::numeric,
      (v_par->>'cambio_compra')::numeric, (v_par->>'cambio_venda')::numeric,
      nullif(v_par->>'cambio_data', '')::date,
      (v_par->>'percentual_veiculo')::numeric, v_par->>'base_honorarios', v_uid
    )
    on conflict (job_id) do update set
      percentual_honorarios = excluded.percentual_honorarios,
      percentual_imposto    = excluded.percentual_imposto,
      percentual_int_taxes  = excluded.percentual_int_taxes,
      int_transaction_costs = excluded.int_transaction_costs,
      moeda_estrangeira     = excluded.moeda_estrangeira,
      cambio_cotacao        = excluded.cambio_cotacao,
      cambio_compra         = excluded.cambio_compra,
      cambio_venda          = excluded.cambio_venda,
      cambio_data           = excluded.cambio_data,
      percentual_veiculo    = excluded.percentual_veiculo,
      base_honorarios       = excluded.base_honorarios,
      updated_by            = excluded.updated_by,
      updated_at            = now();
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
    parametros,
    created_by
  ) values (
    v_job.tenant_id, p_job_id, a->>'motivo',
    (a->>'custo_orcado_antes')::numeric, (a->>'custo_orcado_depois')::numeric,
    (a->>'valor_job_antes')::numeric, (a->>'valor_job_depois')::numeric,
    (a->>'faturamento_previsto_antes')::numeric, (a->>'faturamento_previsto_depois')::numeric,
    coalesce(a->'recebimento_antes', '[]'::jsonb), coalesce(a->'recebimento_depois', '[]'::jsonb),
    coalesce(a->'impostos_antes', '[]'::jsonb), coalesce(a->'impostos_depois', '[]'::jsonb),
    coalesce(a->'envio_antes', '[]'::jsonb), coalesce(a->'envio_depois', '[]'::jsonb),
    p->'parametros',
    v_uid
  )
  returning id into v_id;

  for v_row in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb))
  loop
    insert into public.jobs_alteracoes_financeiro_itens (
      tenant_id, alteracao_id, job_item_orcado_id,
      item_nome, grupo_nome, mes, tipo_custo, tipo_custo_para,
      valor_unitario_de, valor_unitario_para,
      quantidade_de, quantidade_para,
      dias_meses_de, dias_meses_para,
      total_de, total_para,
      valor_unitario_planejado_de, valor_unitario_planejado_para,
      quantidade_planejada_de, quantidade_planejada_para,
      dias_meses_planejado_de, dias_meses_planejado_para,
      total_planejado_de, total_planejado_para,
      efeito_valor_job, efeito_faturamento_previsto
    ) values (
      v_job.tenant_id, v_id, (v_row->>'job_item_orcado_id')::uuid,
      v_row->>'item_nome', v_row->>'grupo_nome', nullif(v_row->>'mes', '')::date,
      (v_row->>'tipo_custo')::public.tipo_custo,
      -- Aba aberta antes da revisão de 08/10 não manda o tipo novo: só valor.
      coalesce(nullif(v_row->>'tipo_custo_para', ''), v_row->>'tipo_custo')::public.tipo_custo,
      (v_row->>'valor_unitario_de')::numeric, (v_row->>'valor_unitario_para')::numeric,
      (v_row->>'quantidade_de')::numeric, (v_row->>'quantidade_para')::numeric,
      (v_row->>'dias_meses_de')::numeric, (v_row->>'dias_meses_para')::numeric,
      (v_row->>'total_de')::numeric, (v_row->>'total_para')::numeric,
      -- Aba aberta antes da revisão de 14/10 não manda o planejado.
      (v_row->>'valor_unitario_planejado_de')::numeric, (v_row->>'valor_unitario_planejado_para')::numeric,
      (v_row->>'quantidade_planejada_de')::numeric, (v_row->>'quantidade_planejada_para')::numeric,
      (v_row->>'dias_meses_planejado_de')::numeric, (v_row->>'dias_meses_planejado_para')::numeric,
      (v_row->>'total_planejado_de')::numeric, (v_row->>'total_planejado_para')::numeric,
      (v_row->>'efeito_valor_job')::numeric, (v_row->>'efeito_faturamento_previsto')::numeric
    );
  end loop;

  -- ---- As linhas: os valores do orçado (P1), o tipo de custo e, na fila,
  --      o planejado ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'linhas', '[]'::jsonb))
  loop
    select o.id, o.item, o.tipo_custo,
           o.valor_unitario_planejado, o.quantidade_planejada, o.dias_meses_planejado
      into v_linha
      from public.jobs_itens_orcado o
     where o.id = (v_row->>'id')::uuid
       and o.job_id = p_job_id
       and o.linha_vermelha = false;
    if not found then
      raise exception 'Uma das linhas alteradas não pertence a este job, ou é linha vermelha.';
    end if;

    v_tipo := coalesce(nullif(v_row->>'tipo_custo', '')::public.tipo_custo, v_linha.tipo_custo);

    -- O tipo só muda enquanto nada foi lançado no item (Tiago, 08/10/2026).
    if v_tipo <> v_linha.tipo_custo then
      select l.lancamento into v_lanc
        from public.lancamentos_nas_linhas_do_job(array[v_linha.id]) l;
      if v_lanc is not null then
        raise exception '"%" já tem %: o tipo de custo só muda enquanto nada foi lançado no item.',
          v_linha.item,
          case v_lanc
            when 'pp' then 'Pedido de Produção'
            when 'pp_a_emitir' then 'PP a emitir'
            else 'BV'
          end;
      end if;
    end if;

    -- O planejado: o do payload, ou o de hoje quando ele não vem.
    v_plan_u := coalesce((v_row->>'valor_unitario_planejado')::numeric, v_linha.valor_unitario_planejado);
    v_plan_q := coalesce((v_row->>'quantidade_planejada')::numeric, v_linha.quantidade_planejada);
    v_plan_d := coalesce((v_row->>'dias_meses_planejado')::numeric, v_linha.dias_meses_planejado);

    -- Depois da abertura o planejado é o da abertura (decisão 151).
    if not v_na_fila and (
         v_plan_u is distinct from v_linha.valor_unitario_planejado
      or v_plan_q is distinct from v_linha.quantidade_planejada
      or v_plan_d is distinct from v_linha.dias_meses_planejado
    ) then
      raise exception '"%": o planejado só é editado pelo financeiro com o job na fila da abertura. Depois dela, ele é o da abertura.',
        v_linha.item;
    end if;

    update public.jobs_itens_orcado
       set valor_unitario_orcado = (v_row->>'valor_unitario_orcado')::numeric,
           quantidade_orcada = (v_row->>'quantidade_orcada')::numeric,
           dias_meses_orcado = (v_row->>'dias_meses_orcado')::numeric,
           tipo_custo = v_tipo,
           valor_unitario_planejado = v_plan_u,
           quantidade_planejada = v_plan_q,
           dias_meses_planejado = v_plan_d,
           updated_at = now()
     where id = v_linha.id
    returning tipo_custo into v_gravado;

    -- No Interno o trigger regrava F · Interno (decisão 105).
    if v_gravado <> v_tipo then
      raise exception 'No serviço Interno o tipo de custo é sempre F · Interno.';
    end if;
  end loop;

  -- ---- O envio, antes dos números do job (ver a 20260928300001) ----
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

  -- ---- As previsões da abertura (P3): recebimento e impostos ----
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
  -- Na fila, a foto da abertura anda junto: o job abre com o valor editado
  -- (revisão de 13/10/2026). Depois da abertura, ela não muda (§3, item 8).
  update public.jobs
     set valor_total = (p->'espelhos'->>'valor_total')::numeric,
         faturamento_previsto = (p->'espelhos'->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p->'espelhos'->>'faturamento_save_previsto')::numeric,
         valor_job_abertura = case
           when v_na_fila then (p->'espelhos'->>'valor_total')::numeric
           else valor_job_abertura
         end,
         faturamento_previsto_abertura = case
           when v_na_fila then (p->'espelhos'->>'faturamento_previsto')::numeric
           else faturamento_previsto_abertura
         end
   where id = p_job_id;

  return v_id;
end;
$function$;
