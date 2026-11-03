-- =====================================================================
-- As previsões da planilha no fluxo: a previsão sem Tipo também entra
-- (correção da 20261103100001, no mesmo dia)
-- =====================================================================
--
-- O ramo `previsao_planilha` da `vw_fluxo_caixa` tira a folha, o imposto do
-- 4T e o mútuo com `NOT (grupo = 'DP' AND ...)`. Com o Tipo vazio, o
-- `grupo = 'DP'` dá nulo, o `NOT` também, e o WHERE descartava a linha: 4
-- previsões sem Tipo (R$ 130.635,50 de saídas) ficaram fora do fluxo. O
-- mesmo com a competência vazia no imposto.
--
-- Agora cada exclusão é `NOT COALESCE(..., false)`: o que não se sabe se é
-- folha, imposto do 4T ou mútuo do sistema entra.
--
-- Troca o ramo inteiro, que é o último da view: corta do começo dele até o
-- fim e põe o corrigido. Confere antes que o começo está lá uma vez só e que
-- nada vem depois dele.
-- =====================================================================

do $$
declare
  v_def    text;
  v_pos    integer;
  c_inicio constant text := E'\nUNION ALL\n SELECT ''previsto''::text AS situacao,\n    ''previsao_planilha''::text AS origem_tipo';
  c_ramo   constant text := $ramo$
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_planilha'::text AS origem_tipo,
    h.id AS origem_id,
    h.tenant_id,
    h.empresa_id,
    h.conta_bancaria_id,
        CASE
            WHEN (h.data >= ( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo)) THEN h.data
            WHEN (h.valor < (0)::numeric) THEN fc_proxima_janela_pagamento(( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo))
            ELSE (( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo) + 1)
        END AS data_evento,
    (abs(h.valor))::numeric(14,2) AS valor,
        CASE
            WHEN (h.valor >= (0)::numeric) THEN 'entrada'::natureza_lancamento
            ELSE 'saida'::natureza_lancamento
        END AS natureza,
    ('Previsão da planilha · '::text || COALESCE(NULLIF(h.job_nome, ''::text), NULLIF(h.descricao, ''::text), h.grupo, 'sem descrição'::text)) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    NULL::uuid AS job_id,
    'previsao'::text AS classe,
    h.regional_id,
    NULL::text AS origem_lancamento
   FROM (historico_movimentos h
     JOIN historico_cargas hc ON (((hc.id = h.carga_id) AND (hc.tipo = 'previsao'::text) AND (hc.situacao = 'ativa'::text))))
  WHERE ((h.extrato_linha_id IS NULL) AND (h.valor <> (0)::numeric)
    AND (NOT (EXISTS ( SELECT 1
           FROM historico_jobs hj
          WHERE ((hj.carga_id = h.carga_id) AND (hj.chave = h.job_chave) AND (hj.job_id IS NOT NULL)))))
    AND (NOT COALESCE(((h.grupo = 'DP'::text) AND (h.valor < (0)::numeric) AND (EXISTS ( SELECT 1
           FROM (folhas_pagamento f
             JOIN folhas_pagamento_alocacoes al ON ((al.folha_id = f.id)))
          WHERE ((f.tenant_id = h.tenant_id) AND (al.empresa_id = h.empresa_id)
            AND (date_trunc('month'::text, (COALESCE(f.data_pagamento_prevista, ((make_date((f.competencia_ano)::integer, (f.competencia_mes)::integer, 1) + '1 mon 2 days'::interval))::date))::timestamp without time zone) = date_trunc('month'::text, (h.data)::timestamp without time zone)))))), false))
    AND (NOT COALESCE(((h.grupo = 'CT'::text) AND (h.valor < (0)::numeric) AND (COALESCE(h.job_chave, ''::text) = ''::text)
          AND (((h.competencia_ano * 10) + h.competencia_trimestre) >= 20264)), false))
    AND (NOT COALESCE(((h.grupo ~~* 'M_TUO%'::text) AND (EXISTS ( SELECT 1
           FROM transferencias_contas t
          WHERE ((t.tenant_id = h.tenant_id) AND (t.tipo = 'mutuo'::text) AND (t.status = 'a_transferir'::text)
            AND (t.data_prevista = h.data) AND (t.valor = abs(h.valor))
            AND (((h.valor > (0)::numeric) AND (t.conta_destino_id = h.conta_bancaria_id))
              OR ((h.valor < (0)::numeric) AND (t.conta_origem_id = h.conta_bancaria_id))))))), false)))
$ramo$;
begin
  v_def := rtrim(pg_get_viewdef('public.vw_fluxo_caixa'::regclass), E'; \n');
  if (length(v_def) - length(replace(v_def, c_inicio, ''))) / length(c_inicio) <> 1 then
    raise exception 'public.vw_fluxo_caixa: o começo do ramo previsao_planilha não está lá uma vez só';
  end if;
  v_pos := position(c_inicio in v_def);
  if position('UNION ALL' in substr(v_def, v_pos + length(c_inicio))) > 0 then
    raise exception 'public.vw_fluxo_caixa: há outro ramo depois do previsao_planilha';
  end if;
  v_def := left(v_def, v_pos - 1) || c_ramo;
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;
end
$$;
