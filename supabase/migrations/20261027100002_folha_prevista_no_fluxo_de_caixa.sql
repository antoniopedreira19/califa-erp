-- =============================================================================
-- A folha ainda não aprovada entra no fluxo de caixa como previsão (decisão 218)
-- =============================================================================
-- Pedido do Tiago em 27/10/2026: "A folha em rascunho entra no fluxo de caixa
-- como previsão na data prevista de pagamento [...] e ao aprovar a previsão
-- vira o título a pagar, sem duplicar." Até aqui a folha só aparecia no fluxo
-- depois de aprovada, quando vira conta avulsa (`contas_avulsas.folha_id`).
--
-- A regra, decidida por ele:
--
-- 1. Entra a linha da folha que ainda não tem título: status rascunho,
--    enviada ou pendente de correção, e nenhuma conta avulsa com o
--    `folha_id` dela. Quando a linha é aprovada, a conta avulsa nasce, a
--    linha sai daqui e o título entra pelo ramo das avulsas: não duplica.
-- 2. A data é a `data_pagamento_prevista` da linha; vazia, o dia 03 do mês
--    seguinte à competência, como a planilha paga o pessoal.
-- 3. Só as competências a partir de 10/2026, quando o sistema começa
--    (decisão 211). A folha 09/2026 está toda em rascunho (recriada em
--    14/10, 202 linhas, R$ 1,66 mi), mas foi paga fora do sistema no começo
--    de outubro: com ela, o fluxo mostraria uma saída que já aconteceu.
-- 4. Da 10/2026 em diante, a linha cuja data já passou vai para a próxima
--    janela de pagamento, como a Recorrência prevista.
--
-- O valor é o `salario_base`, o mesmo que a aprovação grava no título,
-- dividido pelas alocações da linha (empresa e regional). A linha sem
-- alocação não tem empresa e fica de fora.
--
-- Uma linha por competência, empresa, regional e data, sem o nome do
-- colaborador: a view é lida por quem acessa o fluxo, e o salário de cada
-- pessoa fica na folha, que só o administrador, o RH e o financeiro leem. O
-- `origem_id` é o mesmo para as regionais da mesma empresa e competência,
-- para a tela juntar o rateio num item só, como faz com a conta avulsa.
--
-- Como em 20261021300001, o ramo novo é acrescentado à definição no ar
-- (`pg_get_viewdef`), não a uma cópia escrita à mão: o resto da view fica
-- igual, e a migration confere isso antes de terminar. `create or replace`
-- mantém dono, GRANTs e a view dependente (`vw_fluxo_caixa_job_totais`, que
-- só soma linha com job e não vê a folha). Os índices de que o ramo precisa
-- já existem: `idx_folha_aloc_folha` e `idx_contas_avulsas_folha`.
-- =============================================================================

do $$
declare
  v_antes  text;
  v_depois text;
  c_ramo   constant text := $ramo$
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_folha'::text AS origem_tipo,
    md5(fp.tenant_id::text || '|folha|' || fp.empresa_id::text || '|' || fp.competencia::text)::uuid AS origem_id,
    fp.tenant_id,
    fp.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    fp.data_evento,
    fp.valor,
    'saida'::natureza_lancamento AS natureza,
    'Folha prevista · '::text || to_char(fp.competencia::timestamp without time zone, 'MM/YYYY'::text) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    NULL::uuid AS job_id,
    'previsao'::text AS classe,
    fp.regional_id,
    NULL::text AS origem_lancamento
   FROM ( SELECT f.tenant_id,
            al.empresa_id,
            al.regional_id,
            make_date(f.competencia_ano::integer, f.competencia_mes::integer, 1) AS competencia,
                CASE
                    WHEN d.data_pagamento < (( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo)) THEN fc_proxima_janela_pagamento(( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo))
                    ELSE d.data_pagamento
                END AS data_evento,
            sum(f.salario_base * al.percentual / 100.0)::numeric(14,2) AS valor
           FROM folhas_pagamento f
             JOIN folhas_pagamento_alocacoes al ON al.folha_id = f.id
             CROSS JOIN LATERAL ( SELECT COALESCE(f.data_pagamento_prevista, (make_date(f.competencia_ano::integer, f.competencia_mes::integer, 1) + '1 mon 2 days'::interval)::date) AS data_pagamento) d
          WHERE (f.status = ANY (ARRAY['rascunho'::folha_linha_status, 'enviada'::folha_linha_status, 'pendente_correcao'::folha_linha_status]))
            AND make_date(f.competencia_ano::integer, f.competencia_mes::integer, 1) >= '2026-10-01'::date
            AND NOT (EXISTS ( SELECT 1
                   FROM contas_avulsas a
                  WHERE a.folha_id = f.id))
          GROUP BY f.tenant_id, al.empresa_id, al.regional_id, (make_date(f.competencia_ano::integer, f.competencia_mes::integer, 1)), (
                CASE
                    WHEN d.data_pagamento < (( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo)) THEN fc_proxima_janela_pagamento(( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo))
                    ELSE d.data_pagamento
                END)) fp
  WHERE fp.valor > 0::numeric
$ramo$;
begin
  v_antes := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);

  if position('previsao_folha' in v_antes) > 0 then
    return; -- já tem o ramo da folha
  end if;

  v_antes := rtrim(v_antes, E'; \n');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_antes || c_ramo;

  -- Conferência: a definição no ar começa, byte a byte, pela de antes, e
  -- traz o ramo da folha.
  v_depois := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  if left(v_depois, length(v_antes)) <> v_antes
     or position('previsao_folha' in v_depois) = 0 then
    raise exception 'public.vw_fluxo_caixa: a definição no ar não é a esperada';
  end if;
end
$$;
