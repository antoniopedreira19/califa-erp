-- =====================================================================
-- As previsões da planilha no fluxo de caixa (decisão 232, revisão de
-- 03/11/2026; Tiago: "Só o que o sistema não prevê", e a regra dos
-- impostos por competência)
-- =====================================================================
--
-- A carga `previsao` (decisão 232) entrou na conciliação e na DRE, mas não
-- no fluxo de caixa: a `vw_fluxo_caixa` só lia a cauda. Duas mudanças, as
-- duas na `vw_fluxo_caixa`:
--
--   1. A previsão ligada ao banco é realizada (D5 da 232): entra no ramo da
--      cauda, como já entra em `fc_saldos_por_conta`. Sem isso, o saldo de
--      partida do fluxo contava a previsão ligada e a lista do fluxo não.
--
--   2. A previsão ainda não ligada entra como prevista (`previsao_planilha`,
--      classe `previsao`), menos o que o sistema já prevê:
--        * os jobs do sistema (`historico_jobs.job_id`): o fluxo tem a
--          previsão de recebimento, o cronograma de desembolsos, as PPs e o
--          cronograma de impostos de cada um;
--        * a folha (Tipo DP, saída) da empresa no mês em que o sistema tem
--          folha (`folhas_pagamento`, pela data de pagamento);
--        * o imposto (Tipo CT, saída, sem job) com competência do 4T de 2026
--          em diante: vale o Fiscal. Até o 3T fica o da planilha (cotas de
--          IRPJ e CSLL e parcelamentos, que o Fiscal não calcula);
--        * o mútuo que o sistema já tem a transferir (mesma conta, dia e
--          valor), que o fluxo soma fora da view.
--      A previsão vencida e não ligada rola como as do sistema (decisão 018,
--      §3): a saída para a próxima janela de pagamento, a entrada para
--      amanhã.
--
-- Na carga de 01/11 (3.044 previsões): saem 497 de jobs do sistema, 79 da
-- folha de novembro, 33 impostos do 4T e 2 mútuos; entram 2.433 (R$ 52,20
-- mi de entradas e R$ 44,14 mi de saídas).
--
-- Mesmo jeito das mudanças anteriores da view (20261029950002): parte da
-- definição no ar e troca o trecho, que tem de estar lá uma vez só.
-- Aditiva: nenhuma linha existente muda e a view mantém colunas e GRANT.
-- =====================================================================

do $$
declare
  v_def   text;
  c_de    constant text := '(hc.tipo = ''cauda''::text) AND (hc.situacao = ''ativa''::text)';
  c_para  constant text := '((hc.tipo = ''cauda''::text) OR ((hc.tipo = ''previsao''::text) AND (h.extrato_linha_id IS NOT NULL))) AND (hc.situacao = ''ativa''::text)';
  c_ramo  constant text := $ramo$
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
    AND (NOT ((h.grupo = 'DP'::text) AND (h.valor < (0)::numeric) AND (EXISTS ( SELECT 1
           FROM (folhas_pagamento f
             JOIN folhas_pagamento_alocacoes al ON ((al.folha_id = f.id)))
          WHERE ((f.tenant_id = h.tenant_id) AND (al.empresa_id = h.empresa_id)
            AND (date_trunc('month'::text, (COALESCE(f.data_pagamento_prevista, ((make_date((f.competencia_ano)::integer, (f.competencia_mes)::integer, 1) + '1 mon 2 days'::interval))::date))::timestamp without time zone) = date_trunc('month'::text, (h.data)::timestamp without time zone)))))))
    AND (NOT ((h.grupo = 'CT'::text) AND (h.valor < (0)::numeric) AND (COALESCE(h.job_chave, ''::text) = ''::text)
          AND (((h.competencia_ano * 10) + h.competencia_trimestre) >= 20264)))
    AND (NOT ((h.grupo ~~* 'M_TUO%'::text) AND (EXISTS ( SELECT 1
           FROM transferencias_contas t
          WHERE ((t.tenant_id = h.tenant_id) AND (t.tipo = 'mutuo'::text) AND (t.status = 'a_transferir'::text)
            AND (t.data_prevista = h.data) AND (t.valor = abs(h.valor))
            AND (((h.valor > (0)::numeric) AND (t.conta_destino_id = h.conta_bancaria_id))
              OR ((h.valor < (0)::numeric) AND (t.conta_origem_id = h.conta_bancaria_id)))))))))
$ramo$;
begin
  v_def := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  if position('previsao_planilha' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de) <> 1 then
    raise exception 'public.vw_fluxo_caixa: o trecho da cauda não está lá uma vez só';
  end if;
  v_def := replace(rtrim(v_def, E'; \n'), c_de, c_para) || c_ramo;
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;
end
$$;
