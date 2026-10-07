-- =====================================================================
-- 20261007900002 — Save do orçamento inteiro: a conferência do Interno
-- =====================================================================
--
-- Correção da 20261007900001 (decisão 154), achada na simulação logada
-- antes de qualquer tela usar as funções: `versao_save_gerar_tudo` e
-- `versao_save_consumir_tudo` são SECURITY INVOKER e chamavam
-- `orcamento_de_investimento_interno`, que não tem EXECUTE para
-- `authenticated` ("permission denied for function"). Agora elas leem o
-- serviço do orçamento direto (`categorias_dominio.investimento_interno`),
-- que a RLS deixa ler. Nada mais muda.
-- =====================================================================

create or replace function public.versao_save_gerar_tudo(p_versao_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status        text;
  v_orcamento     uuid;
  v_consumo_job   uuid;
  v_codigo        text;
  v_itens         uuid[];
  v_marcadas      integer;
begin
  select v.status::text, v.orcamento_id, v.save_consumo_job_id
    into v_status, v_orcamento, v_consumo_job
    from public.versoes_orcamento v
   where v.id = p_versao_id
   for update;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;
  -- Direto no serviço: `orcamento_de_investimento_interno` não é liberada
  -- para `authenticated`, e estas funções rodam como quem chama.
  if coalesce((select s.investimento_interno
                 from public.orcamentos o
                 join public.categorias_dominio s on s.id = o.servico_id
                where o.id = v_orcamento), false) then
    raise exception 'O serviço Interno não usa save.';
  end if;
  if v_consumo_job is not null then
    select codigo into v_codigo from public.jobs where id = v_consumo_job;
    raise exception 'Este orçamento inteiro consome o saldo do %. Para transformá-lo em orçamento de save, retire antes todos os saves.', v_codigo;
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and exists (select 1 from public.saves_consumos c
                  where c.item_versao_id = i.id and c.substituido_em is null);
  if v_itens is not null then
    raise exception 'Não dá para transformar o orçamento em save: % já % saldo de outro job (%). Retire antes esses saves.',
      case when cardinality(v_itens) = 1 then '1 linha' else cardinality(v_itens) || ' linhas' end,
      case when cardinality(v_itens) = 1 then 'consome' else 'consomem' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and exists (select 1 from public.itens_bv b
                  where b.item_versao_id = i.id and b.situacao <> 'cancelado');
  if v_itens is not null then
    raise exception 'Não dá para transformar o orçamento em save: % BV, e linha em save não aceita BV (%). Retire antes o BV.',
      case when cardinality(v_itens) = 1 then '1 linha tem' else cardinality(v_itens) || ' linhas têm' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  -- A chave antes das linhas: o gatilho da linha confere o modo da versão.
  update public.versoes_orcamento
     set save_por_padrao = true
   where id = p_versao_id;

  update public.versoes_orcamento_itens
     set em_save = true
   where versao_orcamento_id = p_versao_id
     and not em_save;
  get diagnostics v_marcadas = row_count;

  return jsonb_build_object('linhas_marcadas', v_marcadas);
end;
$$;

create or replace function public.versao_save_consumir_tudo(p_versao_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status        text;
  v_orcamento     uuid;
  v_tenant        uuid;
  v_padrao        boolean;
  v_job_atual     uuid;
  v_cliente       uuid;
  v_job           record;
  v_itens         uuid[];
  v_total         numeric(14,2);
  v_disponivel    numeric(14,2);
  v_linhas        integer;
begin
  select v.status::text, v.orcamento_id, v.tenant_id, v.save_por_padrao, v.save_consumo_job_id, p.cliente_id
    into v_status, v_orcamento, v_tenant, v_padrao, v_job_atual, v_cliente
    from public.versoes_orcamento v
    join public.orcamentos o on o.id = v.orcamento_id
    join public.projetos p on p.id = o.projeto_id
   where v.id = p_versao_id
   for update of v;
  if not found then
    raise exception 'Versão não encontrada.';
  end if;
  if v_status = 'aprovada' then
    raise exception 'Versão aprovada não permite alterar o save aqui. Use a Errata na Planilha Interna do job.';
  end if;
  -- Direto no serviço: `orcamento_de_investimento_interno` não é liberada
  -- para `authenticated`, e estas funções rodam como quem chama.
  if coalesce((select s.investimento_interno
                 from public.orcamentos o
                 join public.categorias_dominio s on s.id = o.servico_id
                where o.id = v_orcamento), false) then
    raise exception 'O serviço Interno não usa save.';
  end if;
  if v_padrao then
    raise exception 'Este orçamento inteiro gera save. Para consumir o saldo de um job, retire antes todos os saves.';
  end if;

  select j.id, j.codigo, j.status::text as status, j.orcamento_id, j.tenant_id, p.cliente_id
    into v_job
    from public.jobs j
    join public.projetos p on p.id = j.projeto_id
   where j.id = p_job_id;
  if not found then
    raise exception 'Job de origem do save não encontrado.';
  end if;
  if v_job.tenant_id <> v_tenant then
    raise exception 'Job de origem do save não encontrado.';
  end if;
  if v_job.orcamento_id = v_orcamento then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;
  if v_job.cliente_id is distinct from v_cliente then
    raise exception 'O saldo de save é do cliente: o % é de outro cliente.', v_job.codigo;
  end if;
  if v_job.status in ('rejeitado_financeiro', 'cancelado') then
    raise exception 'O % foi cancelado ou recusado pelo financeiro e não oferece saldo.', v_job.codigo;
  end if;

  select array_agg(i.id) into v_itens
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.em_save;
  if v_itens is not null then
    raise exception 'Não dá para consumir o saldo de um job: % save (%). Retire antes esses saves.',
      case when cardinality(v_itens) = 1 then '1 linha gera' else cardinality(v_itens) || ' linhas geram' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  -- Consumo de OUTRO job trava. O do mesmo job é absorvido, e o do job que
  -- o orçamento já consumia é trocado (é o "Trocar o job").
  select array_agg(distinct i.id) into v_itens
    from public.versoes_orcamento_itens i
    join public.saves_consumos c on c.item_versao_id = i.id and c.substituido_em is null
   where i.versao_orcamento_id = p_versao_id
     and c.job_origem_id <> p_job_id
     and c.job_origem_id is distinct from v_job_atual;
  if v_itens is not null then
    raise exception 'Não dá para consumir o saldo do %: % o saldo de outro job (%). O orçamento inteiro consome de um job só; retire antes esses saves.',
      v_job.codigo,
      case when cardinality(v_itens) = 1 then '1 linha já consome' else cardinality(v_itens) || ' linhas já consomem' end,
      public.save_nomes_das_linhas(v_itens);
  end if;

  select coalesce(sum(i.total_orcado), 0) into v_total
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id;
  v_disponivel := coalesce(public.save_disponivel_para_rascunho(p_job_id), 0);
  if v_total > v_disponivel + 0.005 then
    raise exception 'O orçamento soma R$ % e o saldo disponível do % é de R$ %: faltam R$ %. Nada foi gravado.',
      public.save_reais(v_total), v_job.codigo, public.save_reais(v_disponivel),
      public.save_reais(v_total - v_disponivel);
  end if;

  -- O modo antes dos consumos: o gatilho da linha passa a acompanhar.
  update public.versoes_orcamento
     set save_consumo_job_id = p_job_id
   where id = p_versao_id;

  delete from public.saves_consumos c
   using public.versoes_orcamento_itens i
   where c.item_versao_id = i.id
     and i.versao_orcamento_id = p_versao_id
     and c.substituido_em is null;

  insert into public.saves_consumos (tenant_id, job_origem_id, item_versao_id, valor, created_by)
  select i.tenant_id, p_job_id, i.id, i.total_orcado, (select auth.uid())
    from public.versoes_orcamento_itens i
   where i.versao_orcamento_id = p_versao_id
     and i.total_orcado > 0;
  get diagnostics v_linhas = row_count;

  return jsonb_build_object(
    'linhas', v_linhas,
    'total', v_total,
    'disponivel', v_disponivel,
    'restante', v_disponivel - v_total,
    'codigo', v_job.codigo
  );
end;
$$;
