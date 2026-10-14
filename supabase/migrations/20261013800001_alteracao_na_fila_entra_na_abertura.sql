-- =====================================================================
-- A edição do orçado feita pelo financeiro NA FILA DA ABERTURA entra no
-- valor inicial do job — revisão da decisão 115 (13/10/2026)
--
-- Pedido do Tiago, com o AMB-1030/26: o financeiro ajustou o Transporte
-- Equipe de R$ 3.500,00 para R$ 3.500,89 às 21:48 de 08/10, abriu o job às
-- 21:50, e o cabeçalho mostrou "Valor do job · inicial R$ 229.998,76" e
-- "atual R$ 230.000,00". "Caso o financeiro fizesse alguma edição antes
-- da abertura, esse valor viesse como o valor inicial."
--
-- Até aqui a decisão 115 (§3, item 8) mandava a foto da abertura
-- (`valor_job_abertura`, `faturamento_previsto_abertura`) ficar com o
-- número do envio. A regra nova, confirmada pelo Tiago no mesmo dia:
--   * edição com o job em `aguardando_abertura` → os dois números da foto
--     andam junto com os do job: o job abre com o valor já editado;
--   * edição depois da abertura → a foto não muda, e o cabeçalho continua
--     separando inicial e atual, como hoje.
--
-- O que muda:
--
-- 1. `registrar_alteracao_do_financeiro`: com o job na fila, grava também
--    `valor_job_abertura` e `faturamento_previsto_abertura` com os
--    espelhos novos. Fora da fila, nada muda. O resto da função é o da
--    20261008800001, sem alteração.
--
-- 2. Backfill (sobrescreve valor existente; autorizado pelo Tiago em
--    13/10/2026, "Sim, os 10"): os jobs já abertos que tiveram edição na
--    fila recebem nos dois campos o `*_depois` da ÚLTIMA edição feita antes
--    de `data_abertura_financeiro`. Em todos os 10 esse número é o mesmo da
--    foto nº 1 de `jobs_aberturas` — conferido antes de aplicar:
--      AMB-1006/26  145.000,12 → 145.000,00
--      AMB-1007/26    6.999,99 →   7.000,00
--      AMB-1008/26  307.000,02 → 283.000,00 (fat. 286.550,02 → 283.000,00)
--      AMB-1029/26   23.720,03 →  23.753,72 (fat.   3.299,03 →  23.753,72)
--      AMB-1030/26  229.998,76 → 230.000,00
--      ANI-1011/26  135.000,02 → 135.000,00
--      ASO-1004/26   55.000,12 →  55.000,00
--      EDU-1001/26  120.000,02 → 120.000,00
--      TES-1014/26    9.464,40 (editado e desfeito: não muda)
--      TES-1025/26  172.620,85 → 176.261,34 (fat. 142.620,85 → 161.261,34)
--    Nenhum desses teve errata antes da abertura.
--
-- O lado da tela (o "inicial" recalculado a partir da versão aprovada mais
-- as edições da fila) está em `lib/calculos/abertura-do-job.ts`.
-- =====================================================================

-- ---- 1. A gravação ----
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
  a         jsonb := p->'alteracao';
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
  -- (revisão de 13/10/2026).
  v_na_fila := v_job.status = 'aguardando_abertura';

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
      item_nome, grupo_nome, mes, tipo_custo, tipo_custo_para,
      valor_unitario_de, valor_unitario_para,
      quantidade_de, quantidade_para,
      dias_meses_de, dias_meses_para,
      total_de, total_para,
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
      (v_row->>'efeito_valor_job')::numeric, (v_row->>'efeito_faturamento_previsto')::numeric
    );
  end loop;

  -- ---- As linhas: os valores do orçado (P1) e o tipo de custo ----
  for v_row in select * from jsonb_array_elements(coalesce(p->'linhas', '[]'::jsonb))
  loop
    select o.id, o.item, o.tipo_custo
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

    update public.jobs_itens_orcado
       set valor_unitario_orcado = (v_row->>'valor_unitario_orcado')::numeric,
           quantidade_orcada = (v_row->>'quantidade_orcada')::numeric,
           dias_meses_orcado = (v_row->>'dias_meses_orcado')::numeric,
           tipo_custo = v_tipo,
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

revoke all on function public.registrar_alteracao_do_financeiro(uuid, jsonb) from public, anon;
grant execute on function public.registrar_alteracao_do_financeiro(uuid, jsonb) to authenticated;

comment on function public.registrar_alteracao_do_financeiro(uuid, jsonb) is
  'Grava uma alteracao do orcado feita pelo financeiro (decisao 115) numa transacao: historico, valores e tipo de custo das linhas, envio sem nota, previsoes de recebimento e de impostos e os espelhos do job. Com o job na fila da abertura, a foto da abertura (valor_job_abertura, faturamento_previsto_abertura) anda junto: o job abre com o valor editado (revisao de 13/10/2026). O tipo so muda em linha sem PP, PP a emitir ou BV (revisao de 08/10/2026). Aceita o job na fila da abertura e o aberto ou em producao; recusa o resto. SECURITY INVOKER.';

comment on column public.jobs.valor_job_abertura is
  'Valor do job na abertura: gravado no envio para abertura e acompanhando as edicoes do orcado feitas pelo financeiro com o job na fila (revisao da decisao 115, 13/10/2026). Depois da abertura nao muda: e a base do card de Erratas e do valor inicial do cabecalho.';
comment on column public.jobs.faturamento_previsto_abertura is
  'Faturamento previsto na abertura: gravado no envio para abertura e acompanhando as edicoes do orcado feitas pelo financeiro com o job na fila (revisao da decisao 115, 13/10/2026). Depois da abertura nao muda.';

-- ---- 2. Os jobs já abertos que tiveram edição na fila ----
with ultima_na_fila as (
  select distinct on (a.job_id)
         a.job_id, a.valor_job_depois, a.faturamento_previsto_depois
    from public.jobs_alteracoes_financeiro a
    join public.jobs j on j.id = a.job_id
   where j.data_abertura_financeiro is not null
     and a.created_at < j.data_abertura_financeiro
   order by a.job_id, a.created_at desc
)
update public.jobs j
   set valor_job_abertura = u.valor_job_depois,
       faturamento_previsto_abertura = u.faturamento_previsto_depois
  from ultima_na_fila u
 where j.id = u.job_id
   and (j.valor_job_abertura is distinct from u.valor_job_depois
     or j.faturamento_previsto_abertura is distinct from u.faturamento_previsto_depois);
