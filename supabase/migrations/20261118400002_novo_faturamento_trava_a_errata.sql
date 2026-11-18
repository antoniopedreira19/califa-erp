-- Decisão 265: o Novo faturamento trava a planilha do job como o envio do GP.
--
-- Racional (Tiago, 17/11/2026): os jobs faturados pelo financeiro "deveriam
-- ter tido seus faturamentos contados e planilhas travadas de acordo". A
-- decisão 256 fez o Novo faturamento fechar o envio da produção e carimbar
-- o job, mas a porta da errata continuou olhando só o envio do GP
-- (`jobs_envio_faturamento`): depois de uma nota do financeiro, a produção
-- ainda podia mudar o orçado e os parâmetros, e a nota sairia por um número
-- que não é mais o do job. A regra passa a ser a mesma do envio: depois da
-- nota do Novo faturamento (no mensal, a do mês), não há errata nem mudança
-- de consumo de save; os parâmetros, só pelo financeiro.
--
-- 1. `novo_faturamento_do_job(job)`: os meses que o financeiro já faturou
--    pelo Novo faturamento (mês nulo = o job inteiro). `security definer`
--    porque a errata é do GP e do produtor, que nem sempre leem a nota; o
--    tenant é conferido pela sessão. As server actions da errata e do save
--    leem por ela (`lib/data/envio-faturamento.ts`).
-- 2. `gravar_parametros_da_errata`: a trava dos parâmetros (03/11/2026)
--    passa a contar também o Novo faturamento.

-- ---------------------------------------------------------------------------
-- 1. Os meses fechados pelo Novo faturamento
-- ---------------------------------------------------------------------------
create or replace function public.novo_faturamento_do_job(p_job_id uuid)
 returns table (mes date)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select distinct f.mes_novo_faturamento
    from public.faturamentos f
    join public.faturamento_itens fi on fi.faturamento_id = f.id
   where f.faturado_pelo_financeiro
     and f.status = 'emitido'
     and fi.origem_tipo in ('job', 'save')
     and fi.origem_id = p_job_id
     and f.tenant_id in (select public.current_tenant_ids());
$function$;

comment on function public.novo_faturamento_do_job(uuid) is
  'Decisão 265: os meses do job já faturados pelo Novo faturamento (mês nulo = o job inteiro). Fecham a errata como o envio do GP.';

revoke all on function public.novo_faturamento_do_job(uuid) from public, anon;
grant execute on function public.novo_faturamento_do_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A trava dos parâmetros conta o Novo faturamento
-- ---------------------------------------------------------------------------
create or replace function public.gravar_parametros_da_errata(p_errata_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_e     record;
  v_par   jsonb;
  v_de    jsonb;
  v_atual record;
begin
  select e.id, e.job_id, e.tenant_id, e.created_by, e.created_at, e.parametros
    into v_e
    from public.jobs_erratas e
   where e.id = p_errata_id;
  if not found or jsonb_typeof(v_e.parametros) <> 'object' then
    raise exception 'A errata não tem parâmetros para gravar.';
  end if;

  -- Só a errata que este usuário acabou de registrar, nesta transação, pelo
  -- `registrar_errata_do_job` (que confere o papel: GP ou administrador).
  if not public.is_tenant_member(v_e.tenant_id)
     or v_e.created_by is distinct from (select auth.uid())
     or v_e.created_at <> now()
     or coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao') then
    raise exception 'Os parâmetros do job só mudam pela errata, no momento em que ela é registrada.';
  end if;

  -- A trava da errata (03/11/2026): depois do envio para faturamento (no
  -- mensal, de qualquer mês), só o financeiro mexe nos parâmetros.
  if exists (select 1 from public.jobs_envio_faturamento f where f.job_id = v_e.job_id) then
    raise exception 'O job já foi enviado para faturamento: honorários, impostos e taxas agora só mudam pelo financeiro.';
  end if;
  -- Decisão 265: a nota do Novo faturamento trava como o envio.
  if exists (
    select 1
      from public.faturamentos f
      join public.faturamento_itens fi on fi.faturamento_id = f.id
     where f.faturado_pelo_financeiro
       and f.status = 'emitido'
       and fi.origem_tipo in ('job', 'save')
       and fi.origem_id = v_e.job_id
  ) then
    raise exception 'O job já foi faturado pelo financeiro: honorários, impostos e taxas agora só mudam pelo financeiro.';
  end if;

  -- O "de" é o que a tela mostrou. Se o financeiro mexeu nos parâmetros
  -- enquanto a errata estava aberta, a conta da errata não vale mais.
  select * into v_atual from public.vw_parametros_do_job where job_id = v_e.job_id;
  if not found then
    raise exception 'O job não tem versão aprovada: não há parâmetros para alterar.';
  end if;
  v_de := v_e.parametros->'de';
  -- A tela lê o percentual vazio como zero (`parametrosGravadosDe`).
  if coalesce((v_de->>'percentual_honorarios')::numeric, 0) <> coalesce(v_atual.percentual_honorarios, 0)
     or coalesce((v_de->>'percentual_imposto')::numeric, 0) <> coalesce(v_atual.percentual_imposto, 0)
     or coalesce((v_de->>'percentual_int_taxes')::numeric, 0) <> coalesce(v_atual.percentual_int_taxes, 0)
     or coalesce((v_de->>'int_transaction_costs')::numeric, 0) <> coalesce(v_atual.int_transaction_costs, 0)
     or nullif(v_de->>'moeda_estrangeira', '') is distinct from nullif(v_atual.moeda_estrangeira, '')
     or (v_de->>'cambio_cotacao')::numeric is distinct from v_atual.cambio_cotacao then
    raise exception 'Os parâmetros do job mudaram enquanto a errata estava aberta. Recarregue a página e refaça a errata.';
  end if;

  v_par := v_e.parametros->'para';
  insert into public.jobs_parametros (
    job_id, tenant_id,
    percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs,
    moeda_estrangeira, cambio_cotacao, cambio_compra, cambio_venda, cambio_data,
    percentual_veiculo, base_honorarios, updated_by
  ) values (
    v_e.job_id, v_e.tenant_id,
    (v_par->>'percentual_honorarios')::numeric, (v_par->>'percentual_imposto')::numeric,
    (v_par->>'percentual_int_taxes')::numeric, (v_par->>'int_transaction_costs')::numeric,
    nullif(v_par->>'moeda_estrangeira', ''), (v_par->>'cambio_cotacao')::numeric,
    (v_par->>'cambio_compra')::numeric, (v_par->>'cambio_venda')::numeric,
    nullif(v_par->>'cambio_data', '')::date,
    (v_par->>'percentual_veiculo')::numeric, v_par->>'base_honorarios', (select auth.uid())
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
end;
$function$;
