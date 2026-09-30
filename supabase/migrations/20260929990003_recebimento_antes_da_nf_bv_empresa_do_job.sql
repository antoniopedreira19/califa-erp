-- =====================================================================
-- Recebimento antes da NF do BV: a empresa vem do job (decisão 130)
-- =====================================================================
--
-- A linha de BV da `vw_faturamento_pendente` não tem empresa (a view
-- devolve `NULL::uuid AS empresa_id`: quem escolhe a empresa é a NF).
-- Sem empresa, `registrar_recebimento_antes_nf` recusava todo BV com
-- "Esta linha não tem empresa ou job para o recebimento.", e o BV é uma
-- das duas linhas que o recebimento antes da NF atende.
--
-- A empresa do lançamento passa a ser a do job quando a linha não traz
-- uma. É provisória como a da nota: ao emitir a NF, `emitir_faturamento`
-- troca a empresa do lançamento pela da nota.
--
-- Edição cirúrgica do corpo aplicado em 20260929990002: troca de um
-- trecho único, conferido antes de recriar.
-- =====================================================================

do $mig$
declare
  v_src  text;
  v_novo text;
  v_de   text := $t$  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  if v_empresa is null or v_job is null then$t$;
  v_para text := $t$  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  -- O BV chega sem empresa (quem escolhe é a NF): vale a do job.
  if v_empresa is null and v_job is not null then
    select empresa_id into v_empresa from public.jobs where id = v_job;
  end if;

  if v_empresa is null or v_job is null then$t$;
begin
  select prosrc into v_src
    from pg_proc
   where oid = 'public.registrar_recebimento_antes_nf(uuid, uuid, date, uuid, numeric, uuid, uuid)'::regprocedure;

  if (length(v_src) - length(replace(v_src, v_de, ''))) / length(v_de) <> 1 then
    raise exception 'registrar_recebimento_antes_nf: trecho da empresa não encontrado uma única vez';
  end if;

  v_novo := replace(v_src, v_de, v_para);

  execute format(
    $f$create or replace function public.registrar_recebimento_antes_nf(
      p_envio_nota_id uuid, p_item_bv_id uuid, p_data date, p_conta_bancaria_id uuid,
      p_valor numeric, p_tipo_id uuid, p_subtipo_id uuid)
    returns uuid language plpgsql security definer set search_path to 'public'
    as %L$f$, v_novo);
end
$mig$;

revoke all on function public.registrar_recebimento_antes_nf(uuid, uuid, date, uuid, numeric, uuid, uuid) from public, anon;
grant execute on function public.registrar_recebimento_antes_nf(uuid, uuid, date, uuid, numeric, uuid, uuid) to authenticated;
