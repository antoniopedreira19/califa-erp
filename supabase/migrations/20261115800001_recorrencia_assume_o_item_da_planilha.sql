-- =====================================================================
-- A recorrência da planilha assume o item de vez (revisão da decisão
-- 235, 15/11/2026)
-- =====================================================================
--
-- A 20261103800001 tirava a previsão da planilha do fluxo só enquanto a
-- recorrência estava ativa e dentro da `data_fim`. Em 15/11 as duas
-- recorrências de R$ 75.000,00 (California e CCH) geraram o título de
-- dezembro, passaram da data de fim e pararam sozinhas. Com isso, a
-- previsão da planilha do mesmo item voltou para o fluxo, e novembro e
-- dezembro passaram a mostrar R$ 150.000,00 a mais cada um: o título e
-- a previsão.
--
-- Regra nova (Tiago, 15/11/2026: "Sim, corrigir"): a recorrência que
-- veio da planilha (`previsao_chave` preenchida) assume o item de vez. A
-- previsão da planilha não volta quando a recorrência é pausada,
-- encerrada pela data de fim ou excluída com títulos (que só a marca
-- como parada). Volta só se a recorrência for apagada de vez, o que só
-- acontece com a que nunca gerou título.
--
-- Troca só as duas condições do ramo `previsao_planilha`: `r.ativo` e a
-- da `data_fim`. Confere antes que cada uma aparece uma vez só na view.
-- =====================================================================

do $$
declare
  v_def    text;
  c_ativo  constant text := '(r.tenant_id = h.tenant_id) AND r.ativo AND (r.previsao_chave IS NOT NULL)';
  c_fim    constant text := ' AND ((r.data_fim IS NULL) OR (h.data <= r.data_fim))';
begin
  v_def := rtrim(pg_get_viewdef('public.vw_fluxo_caixa'::regclass), E'; \n');
  if (length(v_def) - length(replace(v_def, c_ativo, ''))) / length(c_ativo) <> 1 then
    raise exception 'public.vw_fluxo_caixa: a condição r.ativo da recorrência não está lá uma vez só';
  end if;
  if (length(v_def) - length(replace(v_def, c_fim, ''))) / length(c_fim) <> 1 then
    raise exception 'public.vw_fluxo_caixa: a condição da data_fim da recorrência não está lá uma vez só';
  end if;
  v_def := replace(v_def, c_ativo, '(r.tenant_id = h.tenant_id) AND (r.previsao_chave IS NOT NULL)');
  v_def := replace(v_def, c_fim, '');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;
end
$$;

comment on column public.contas_avulsas_recorrentes.previsao_chave is
  'md5 de fornecedor|descrição da planilha (normalizados): a previsão da planilha com a mesma chave sai do fluxo, mesmo com a recorrência pausada ou encerrada (decisão 235, revista em 15/11/2026). Nulo na recorrência criada pela tela.';
