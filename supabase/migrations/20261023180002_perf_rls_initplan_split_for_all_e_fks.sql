-- Perf hardening do banco: três fixes baseados nos advisors do Supabase e
-- no case study A/B/H/I do docs/PERFORMANCE.md.
--
-- 1) auth.uid() → (select auth.uid()) em todas as policies public.*
--    (adivsor "auth_rls_initplan"). Reavaliar auth.uid() por linha num
--    SELECT que retorna 500 rows = 500 chamadas de função. Com SELECT
--    wrapper, Postgres avalia 1 vez por query. Ganho: 20-40% em queries
--    que retornam muitas linhas em tabelas quentes.
--
-- 2) Policies FOR ALL quebradas em FOR INSERT + FOR UPDATE + FOR DELETE
--    (advisor "multiple_permissive_policies"). O padrão `_select` + `_modify
--    FOR ALL` fazia o Postgres aplicar OR das 2 policies por linha no SELECT.
--    Separando _modify em 3 (insert/update/delete), ele sai do caminho de
--    leitura. Ganho: 10-20% nas tabelas afetadas.
--
-- 3) Índices nas top ~40 FKs sem índice (advisor "unindexed_foreign_keys").
--    Prioridade pelas tabelas quentes do perfil de uso: pedidos_compra,
--    contas_avulsas, lancamentos_financeiros, jobs, orçamento_itens,
--    folhas_pagamento, versoes_orcamento, projetos.
--
-- 4) Drop de 6 índices redundantes (advisor "duplicate_index"). Mantém
--    o UNIQUE (que serve pra lookup+constraint) e dropa o não-único.

-- =====================================================================
-- 1 + 2) Rewrite de policies: SELECT com initplan + FOR ALL split
-- =====================================================================
do $$
declare
  pol record;
  new_qual text;
  new_with_check text;
  roles_clause text;
  base_name text;
begin
  -- 1) policies SELECT com raw auth.uid() (initplan sem FOR ALL)
  for pol in
    select schemaname, tablename, policyname, roles, qual, with_check, cmd
    from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and qual ~ 'auth\.uid\(\)'
      and qual !~ '\( ?SELECT auth\.uid\(\)'
  loop
    -- normaliza qualquer (SELECT auth.uid()) existente pra raw e depois wrap
    new_qual := regexp_replace(pol.qual, '\( ?SELECT auth\.uid\(\)( AS uid)?\)', 'auth.uid()', 'g');
    new_qual := regexp_replace(new_qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');

    roles_clause := array_to_string(pol.roles, ',');

    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
    execute format(
      'create policy %I on public.%I as permissive for select to %s using (%s)',
      pol.policyname, pol.tablename, roles_clause, new_qual
    );
    raise notice 'rewrote SELECT policy %.%', pol.tablename, pol.policyname;
  end loop;

  -- 2) policies FOR ALL: quebrar em INSERT + UPDATE + DELETE
  for pol in
    select schemaname, tablename, policyname, roles, qual, with_check, cmd
    from pg_policies
    where schemaname = 'public'
      and cmd = 'ALL'
  loop
    -- Normaliza auth.uid() → (select auth.uid()) de uma vez
    new_qual := case
      when pol.qual is null then null
      else
        regexp_replace(
          regexp_replace(pol.qual, '\( ?SELECT auth\.uid\(\)( AS uid)?\)', 'auth.uid()', 'g'),
          'auth\.uid\(\)', '(select auth.uid())', 'g'
        )
    end;
    new_with_check := case
      when pol.with_check is null then null
      else
        regexp_replace(
          regexp_replace(pol.with_check, '\( ?SELECT auth\.uid\(\)( AS uid)?\)', 'auth.uid()', 'g'),
          'auth\.uid\(\)', '(select auth.uid())', 'g'
        )
    end;

    roles_clause := array_to_string(pol.roles, ',');
    base_name := pol.policyname;

    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);

    -- INSERT: só WITH CHECK
    if new_with_check is not null then
      execute format(
        'create policy %I on public.%I as permissive for insert to %s with check (%s)',
        base_name || '_insert', pol.tablename, roles_clause, new_with_check
      );
    end if;

    -- UPDATE: USING (qual) + WITH CHECK (with_check)
    if new_qual is not null then
      execute format(
        'create policy %I on public.%I as permissive for update to %s using (%s)%s',
        base_name || '_update',
        pol.tablename,
        roles_clause,
        new_qual,
        case when new_with_check is not null
          then format(' with check (%s)', new_with_check)
          else ''
        end
      );
    end if;

    -- DELETE: só USING
    if new_qual is not null then
      execute format(
        'create policy %I on public.%I as permissive for delete to %s using (%s)',
        base_name || '_delete', pol.tablename, roles_clause, new_qual
      );
    end if;

    raise notice 'split FOR ALL policy %.% into 3', pol.tablename, pol.policyname;
  end loop;
end $$;

-- =====================================================================
-- 3) Índices em FKs quentes (top ~40 por tamanho da tabela)
-- =====================================================================

-- jobs_itens_orcado (1352 kB — maior tabela com FKs sem índice)
create index if not exists ix_jobs_itens_orcado_errata_origem_id on public.jobs_itens_orcado (errata_origem_id);
create index if not exists ix_jobs_itens_orcado_cancelada_errata_id on public.jobs_itens_orcado (cancelada_errata_id);
create index if not exists ix_jobs_itens_orcado_categoria_id on public.jobs_itens_orcado (categoria_id);

-- jobs_itens_realizado
create index if not exists ix_jobs_itens_realizado_created_by on public.jobs_itens_realizado (created_by);

-- pedidos_compra (720 kB, 12 FKs sem índice — maior ofensor da auditoria)
create index if not exists ix_pedidos_compra_plano_conta_tipo_id on public.pedidos_compra (plano_conta_tipo_id);
create index if not exists ix_pedidos_compra_plano_conta_subtipo_id on public.pedidos_compra (plano_conta_subtipo_id);
create index if not exists ix_pedidos_compra_cartao_credito_id on public.pedidos_compra (cartao_credito_id);
create index if not exists ix_pedidos_compra_enviada_financeiro_por on public.pedidos_compra (enviada_financeiro_por);
create index if not exists ix_pedidos_compra_emitida_por on public.pedidos_compra (emitida_por);
create index if not exists ix_pedidos_compra_editada_por on public.pedidos_compra (editada_por);
create index if not exists ix_pedidos_compra_pronta_para_envio_por on public.pedidos_compra (pronta_para_envio_por);
create index if not exists ix_pedidos_compra_aprovada_por on public.pedidos_compra (aprovada_por);
create index if not exists ix_pedidos_compra_rejeitada_por on public.pedidos_compra (rejeitada_por);
create index if not exists ix_pedidos_compra_pago_por on public.pedidos_compra (pago_por);
create index if not exists ix_pedidos_compra_cancelada_por on public.pedidos_compra (cancelada_por);
create index if not exists ix_pedidos_compra_pag_fora_cadastro_aprovado_por on public.pedidos_compra (pagamento_fora_do_cadastro_aprovado_por);

-- jobs (584 kB)
create index if not exists ix_jobs_abertura_revisao_errata_id on public.jobs (abertura_revisao_errata_id);
create index if not exists ix_jobs_created_by on public.jobs (created_by);
create index if not exists ix_jobs_produtor_envia_pp_por on public.jobs (produtor_envia_pp_por);
create index if not exists ix_jobs_aberto_por on public.jobs (aberto_por);

-- lancamentos_financeiros (512 kB)
create index if not exists ix_lanc_fin_criado_por on public.lancamentos_financeiros (criado_por);
create index if not exists ix_lanc_fin_cartao_credito_id on public.lancamentos_financeiros (cartao_credito_id);
create index if not exists ix_lanc_fin_estorno_de_lanc_id on public.lancamentos_financeiros (estorno_de_lancamento_id);
create index if not exists ix_lanc_fin_cliente_id on public.lancamentos_financeiros (cliente_id);
create index if not exists ix_lanc_fin_plano_conta_subtipo_id on public.lancamentos_financeiros (plano_conta_subtipo_id);

-- versoes_orcamento_grupos
create index if not exists ix_vo_grupos_versao_mes on public.versoes_orcamento_grupos (versao_orcamento_id, mes_id);

-- contas_avulsas (416 kB, 7 FKs sem índice)
create index if not exists ix_contas_avulsas_aprovada_por on public.contas_avulsas (aprovada_por);
create index if not exists ix_contas_avulsas_cartao_credito_id on public.contas_avulsas (cartao_credito_id);
create index if not exists ix_contas_avulsas_criado_por on public.contas_avulsas (criado_por);
create index if not exists ix_contas_avulsas_conta_bancaria_baixa_id on public.contas_avulsas (conta_bancaria_baixa_id);
create index if not exists ix_contas_avulsas_plano_conta_subtipo_id on public.contas_avulsas (plano_conta_subtipo_id);
create index if not exists ix_contas_avulsas_plano_conta_tipo_id on public.contas_avulsas (plano_conta_tipo_id);
create index if not exists ix_contas_avulsas_pago_por on public.contas_avulsas (pago_por);

-- orcamentos (376 kB)
create index if not exists ix_orcamentos_aprovado_por on public.orcamentos (aprovado_por);
create index if not exists ix_orcamentos_created_by on public.orcamentos (created_by);

-- pedidos_compra_anexos
create index if not exists ix_pp_anexos_created_by on public.pedidos_compra_anexos (created_by);

-- pedidos_compra_parcelas
create index if not exists ix_pp_parcelas_created_by on public.pedidos_compra_parcelas (created_by);
create index if not exists ix_pp_parcelas_pago_por on public.pedidos_compra_parcelas (pago_por);

-- folhas_pagamento (296 kB, 6 FKs sem índice)
create index if not exists ix_folhas_pgto_reprovada_por on public.folhas_pagamento (reprovada_por);
create index if not exists ix_folhas_pgto_created_by on public.folhas_pagamento (created_by);
create index if not exists ix_folhas_pgto_enviada_por on public.folhas_pagamento (enviada_por);
create index if not exists ix_folhas_pgto_paga_por on public.folhas_pagamento (paga_por);
create index if not exists ix_folhas_pgto_aprovada_por on public.folhas_pagamento (aprovada_por);
create index if not exists ix_folhas_pgto_colaborador_id on public.folhas_pagamento (colaborador_id);

-- projetos
create index if not exists ix_projetos_created_by on public.projetos (created_by);

-- versoes_orcamento
create index if not exists ix_vo_created_by on public.versoes_orcamento (created_by);
create index if not exists ix_vo_aprovado_por on public.versoes_orcamento (aprovado_por);

-- empresa_members (256 kB — usada por policies em cascata)
create index if not exists ix_empresa_members_created_by on public.empresa_members (created_by);
create index if not exists ix_empresa_members_regional_id on public.empresa_members (regional_id);
create index if not exists ix_empresa_members_tenant_id on public.empresa_members (tenant_id);

-- =====================================================================
-- 4) Drop de 6 índices redundantes (mantém o UNIQUE, remove o não-único)
-- =====================================================================

-- contratacoes: UNIQUE da PK já cobre o token; idx_contratacoes_token é duplicata
drop index if exists public.idx_contratacoes_token;

-- decimo_terceiro_folhas: a UNIQUE (tenant_id, ano) já serve pra lookup
drop index if exists public.idx_decimo_terceiro_folhas_tenant_ano;

-- faturas_cartao: duas UNIQUE idênticas, mantém a com prefixo uniq_
drop index if exists public.uq_fatura_cartao_competencia;

-- jobs_aberturas: UNIQUE constraint já cobre
drop index if exists public.idx_jobs_aberturas_job;

-- nf_extracao_cache: UNIQUE constraint já cobre
drop index if exists public.nf_extracao_cache_tenant_hash_modelo_idx;

-- pedidos_compra_parcelas: UNIQUE constraint já cobre
drop index if exists public.idx_pp_parcelas_pedido;
