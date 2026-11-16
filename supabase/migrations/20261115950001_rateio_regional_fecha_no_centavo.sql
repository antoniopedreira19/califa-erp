-- =====================================================================
-- Rateio de regional fecha no centavo (vw_fluxo_caixa, 15/11/2026)
-- =====================================================================
--
-- A view dividia o valor rateado entre regionais e arredondava cada
-- pedaço sozinho, sem devolver o resto. Caso real, achado no acerto da
-- conciliação da Santander: a baixa da AV-00026 (R$ 4.069,86, rateio
-- SP 30 / NE 25 / RJ 25 / NO 20) saía no fluxo de caixa de 03/11 como
-- 1.220,96 + 1.017,47 + 1.017,47 + 813,97 = 4.069,87, um centavo acima
-- do extrato. A conciliação lê o lançamento e batia; o fluxo, não.
-- No previsto, o mesmo erro aparecia em 24 avulsas de recorrência e em
-- 170 ocorrências futuras de recorrência (±0,01 cada).
--
-- Regra (Tiago, 15/11/2026): cada pedaço continua arredondado ao
-- centavo, e a diferença do arredondamento fica num pedaço só, o de
-- MAIOR PERCENTUAL; no empate, a regional que vem primeiro em ordem
-- alfabética. A soma dos pedaços passa a ser igual ao valor que foi
-- dividido. Na AV-00026, a SP fica com 1.220,95.
--
-- Vale para o realizado e o previsto (decisão do Tiago no mesmo dia):
--   * lançamento realizado: rateio da avulsa, do desembolso ou do
--     faturamento, vezes a divisão por job/save do título. A diferença
--     vai para o pedaço de maior fator, contados os pedaços que saem
--     como save (`lancamento_save`), para que o lançamento inteiro feche;
--   * avulsa prevista (saldo em aberto), parcela de desembolso prevista,
--     título previsto (por job ou por regional) e recorrência prevista.
--
-- Como: um CTE de ajuste por origem calcula, só onde a soma não fecha,
-- qual pedaço leva a diferença e quanto ela vale. O ramo da view soma
-- esse ajuste ao pedaço escolhido. Os pedaços que já fechavam não mudam.
-- As colunas e os tipos da view continuam os mesmos (lib/types.ts não
-- muda).
--
-- Fica de fora, de propósito:
--   * fatura de cartão prevista e folha prevista: somam por regional
--     antes de arredondar e não dividem um valor só em pedaços;
--   * outras views (DRE, rentabilidade), que têm rateio próprio.
--
-- Mesma técnica da 20261115800001: troca trechos exatos da definição
-- atual e confere antes que cada um aparece o número de vezes esperado.
-- Se outra frente tiver mexido num desses trechos, a migration para sem
-- aplicar nada. Os trechos novos dos CTEs entram por último, para não
-- serem contados nas conferências.
-- =====================================================================

do $$
declare
  v_def    text;
  v_antes  text[];
  v_depois text[];
  v_vezes  int[];
  v_n      int;
  i        int;
begin
  v_def := rtrim(pg_get_viewdef('public.vw_fluxo_caixa'::regclass), E'; \n');

  v_antes := array[
    -- 1. Realizado (lançamento e save do lançamento): o valor do pedaço.
    $t$(((l.valor * lr.fator) * lj.fator))::numeric(14,2) AS valor$t$,
    -- 2 e 3. Os dois ramos do realizado ganham o ajuste do lançamento.
    $t$WHERE (lj.save_job_id IS NULL)$t$,
    $t$WHERE (lj.save_job_id IS NOT NULL)$t$,
    -- 4, 5 e 6. Avulsa prevista.
    $t$(((a.valor - COALESCE(($t$,
    $t$* ar.fator))::numeric(14,2) AS valor$t$,
    $t$WHERE ((a.status = 'aprovada'::conta_avulsa_status) AND (a.fatura_cartao_id IS NULL))$t$,
    -- 7 e 8. Parcela de desembolso prevista.
    $t$((par.valor * dr.fator))::numeric(14,2) AS valor$t$,
    $t$WHERE ((d.status = ANY (ARRAY['aprovada'::desembolso_status, 'pago'::desembolso_status])) AND (par.pago_em IS NULL))$t$,
    -- 9, 10 e 11. Título previsto.
    $t$((((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)) * COALESCE(fr.fator, 1.0)) *$t$,
    $t$/ NULLIF(t.valor, (0)::numeric)))))::numeric(14,2) AS valor$t$,
    $t$LEFT JOIN fat_rateio fr ON (((fr.faturamento_id = t.faturamento_id) AND (c.job_id IS NULL))))$t$,
    -- 12 e 13. Recorrência prevista.
    $t$((t.valor * rr.fator))::numeric(14,2) AS valor$t$,
    $t$WHERE (r2.recorrente_id = t.id))))) rr)$t$,
    -- 14. Os CTEs de ajuste entram antes do pps_do_item.
    $t$), pps_do_item AS ($t$
  ];

  v_depois := array[
    -- 1
    $t$((((l.valor * lr.fator) * lj.fator))::numeric(14,2) + COALESCE(CASE WHEN ((lpa.rateio_regional_id IS NOT DISTINCT FROM lr.regional_id) AND (lpa.job_id IS NOT DISTINCT FROM lj.job_id) AND (lpa.save_job_id IS NOT DISTINCT FROM lj.save_job_id)) THEN lpa.ajuste ELSE NULL::numeric END, (0)::numeric))::numeric(14,2) AS valor$t$,
    -- 2
    $t$LEFT JOIN lancamento_ajuste lpa ON ((lpa.lancamento_id = l.id))
  WHERE (lj.save_job_id IS NULL)$t$,
    -- 3
    $t$LEFT JOIN lancamento_ajuste lpa ON ((lpa.lancamento_id = l.id))
          WHERE (lj.save_job_id IS NOT NULL)$t$,
    -- 4
    $t$((((a.valor - COALESCE(($t$,
    -- 5
    $t$* ar.fator))::numeric(14,2) + COALESCE(CASE WHEN (aaj.regional_id IS NOT DISTINCT FROM ar.regional_id) THEN aaj.ajuste ELSE NULL::numeric END, (0)::numeric))::numeric(14,2) AS valor$t$,
    -- 6
    $t$LEFT JOIN avulsa_ajuste aaj ON ((aaj.conta_avulsa_id = a.id))
  WHERE ((a.status = 'aprovada'::conta_avulsa_status) AND (a.fatura_cartao_id IS NULL))$t$,
    -- 7
    $t$(((par.valor * dr.fator))::numeric(14,2) + COALESCE(CASE WHEN (daj.regional_id IS NOT DISTINCT FROM dr.regional_id) THEN daj.ajuste ELSE NULL::numeric END, (0)::numeric))::numeric(14,2) AS valor$t$,
    -- 8
    $t$LEFT JOIN desembolso_ajuste daj ON ((daj.parcela_id = par.id))
  WHERE ((d.status = ANY (ARRAY['aprovada'::desembolso_status, 'pago'::desembolso_status])) AND (par.pago_em IS NULL))$t$,
    -- 9
    $t$(((((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)) * COALESCE(fr.fator, 1.0)) *$t$,
    -- 10
    $t$/ NULLIF(t.valor, (0)::numeric)))))::numeric(14,2) + COALESCE(CASE WHEN ((taj.job_id IS NOT DISTINCT FROM c.job_id) AND (taj.regional_id IS NOT DISTINCT FROM fr.regional_id)) THEN taj.ajuste ELSE NULL::numeric END, (0)::numeric))::numeric(14,2) AS valor$t$,
    -- 11
    $t$LEFT JOIN fat_rateio fr ON (((fr.faturamento_id = t.faturamento_id) AND (c.job_id IS NULL))))
     LEFT JOIN titulo_ajuste taj ON ((taj.titulo_id = t.id))$t$,
    -- 12
    $t$(((t.valor * rr.fator))::numeric(14,2) + COALESCE(CASE WHEN (raj.regional_id IS NOT DISTINCT FROM rr.regional_id) THEN raj.ajuste ELSE NULL::numeric END, (0)::numeric))::numeric(14,2) AS valor$t$,
    -- 13
    $t$WHERE (r2.recorrente_id = t.id))))) rr)
     LEFT JOIN recorrente_ajuste raj ON ((raj.recorrente_id = t.id))$t$,
    -- 14
    $t$), lancamento_ajuste AS (
         -- Lançamento realizado: os pedaços são rateio de regional (lr)
         -- vezes divisão por job/save do título (lj).
         SELECT x.lancamento_id, x.rateio_regional_id, x.job_id, x.save_job_id, x.ajuste
           FROM ( SELECT p.lancamento_id, p.rateio_regional_id, p.job_id, p.save_job_id,
                    row_number() OVER (PARTITION BY p.lancamento_id ORDER BY p.fator DESC, p.regional_nome, p.rateio_regional_id, p.job_id, p.save_job_id) AS ordem,
                    round(sum(p.bruto) OVER (PARTITION BY p.lancamento_id), 2)
                      - sum(p.bruto::numeric(14,2)) OVER (PARTITION BY p.lancamento_id) AS ajuste
                   FROM ( SELECT l.id AS lancamento_id,
                            lr.regional_id AS rateio_regional_id,
                            lj.job_id,
                            lj.save_job_id,
                            lr.fator * lj.fator AS fator,
                            (l.valor * lr.fator) * lj.fator AS bruto,
                            rg.nome AS regional_nome
                           FROM lancamentos_financeiros l
                             JOIN lancamento_rateio lr ON lr.lancamento_id = l.id
                             JOIN lancamento_job lj ON lj.lancamento_id = l.id
                             LEFT JOIN jobs jlj ON jlj.id = lj.job_id
                             LEFT JOIN regionais rg ON rg.id = COALESCE(jlj.regional_id, lr.regional_id)) p) x
          WHERE x.ordem = 1 AND x.ajuste <> 0
        ), avulsa_ajuste AS (
         -- Avulsa prevista sem job: o saldo em aberto pelo rateio dela.
         SELECT x.conta_avulsa_id, x.regional_id, x.ajuste
           FROM ( SELECT r.conta_avulsa_id, r.regional_id,
                    row_number() OVER (PARTITION BY r.conta_avulsa_id ORDER BY r.percentual DESC, rg.nome, r.regional_id) AS ordem,
                    round(s.saldo * sum(r.percentual / 100.0) OVER (PARTITION BY r.conta_avulsa_id), 2)
                      - sum((s.saldo * (r.percentual / 100.0))::numeric(14,2)) OVER (PARTITION BY r.conta_avulsa_id) AS ajuste
                   FROM contas_avulsas_regionais r
                     JOIN contas_avulsas a ON a.id = r.conta_avulsa_id
                     CROSS JOIN LATERAL ( SELECT a.valor - COALESCE(( SELECT sum(lb.valor + COALESCE(( SELECT sum(rb.valor)
                                           FROM baixas_retencoes rb
                                          WHERE rb.lancamento_id = lb.id), 0::numeric))
                                   FROM lancamentos_financeiros lb
                                  WHERE lb.origem = 'avulsa_baixa'::origem_lancamento AND lb.conta_avulsa_id = a.id), 0::numeric) AS saldo) s
                     LEFT JOIN regionais rg ON rg.id = r.regional_id
                  WHERE a.job_id IS NULL AND a.status = 'aprovada'::conta_avulsa_status AND a.fatura_cartao_id IS NULL) x
          WHERE x.ordem = 1 AND x.ajuste <> 0
        ), desembolso_ajuste AS (
         -- Parcela de desembolso prevista pelo rateio do desembolso.
         SELECT x.parcela_id, x.regional_id, x.ajuste
           FROM ( SELECT par.id AS parcela_id, r.regional_id,
                    row_number() OVER (PARTITION BY par.id ORDER BY r.percentual DESC, rg.nome, r.regional_id) AS ordem,
                    round(par.valor * sum(r.percentual / 100.0) OVER (PARTITION BY par.id), 2)
                      - sum((par.valor * (r.percentual / 100.0))::numeric(14,2)) OVER (PARTITION BY par.id) AS ajuste
                   FROM desembolsos_parcelas par
                     JOIN desembolsos_regionais r ON r.desembolso_id = par.desembolso_id
                     LEFT JOIN regionais rg ON rg.id = r.regional_id
                  WHERE par.pago_em IS NULL) x
          WHERE x.ordem = 1 AND x.ajuste <> 0
        ), titulo_ajuste AS (
         -- Título previsto: divisão por job da nota e, sem job, rateio
         -- de regional do faturamento. Mesmas junções do ramo do título.
         SELECT x.titulo_id, x.job_id, x.regional_id, x.ajuste
           FROM ( SELECT p.titulo_id, p.job_id, p.regional_id,
                    row_number() OVER (PARTITION BY p.titulo_id ORDER BY p.fator DESC, p.regional_nome, p.job_id, p.regional_id) AS ordem,
                    round(sum(p.bruto) OVER (PARTITION BY p.titulo_id), 2)
                      - sum(p.bruto::numeric(14,2)) OVER (PARTITION BY p.titulo_id) AS ajuste
                   FROM ( SELECT t.id AS titulo_id,
                            c.job_id,
                            fr.regional_id,
                            COALESCE(c.valor / NULLIF(ft.total, 0::numeric), 1::numeric) * COALESCE(fr.fator, 1.0) AS fator,
                            ((tp.valor_proprio * COALESCE(c.valor / NULLIF(ft.total, 0::numeric), 1::numeric)) * COALESCE(fr.fator, 1.0))
                              * (1::numeric - COALESCE(b.baixado, 0::numeric) / NULLIF(t.valor, 0::numeric)) AS bruto,
                            rg.nome AS regional_nome
                           FROM titulos_receber t
                             JOIN titulo_partes tp ON tp.titulo_id = t.id
                             LEFT JOIN fat_composicao c ON c.faturamento_id = t.faturamento_id
                             LEFT JOIN fat_total ft ON ft.faturamento_id = t.faturamento_id
                             LEFT JOIN jobs j ON j.id = c.job_id
                             LEFT JOIN fat_rateio fr ON fr.faturamento_id = t.faturamento_id AND c.job_id IS NULL
                             LEFT JOIN regionais rg ON rg.id = COALESCE(j.regional_id, fr.regional_id, t.regional_id)
                             CROSS JOIN LATERAL ( SELECT sum(lb.valor + COALESCE(( SELECT sum(rb.valor)
                                           FROM baixas_retencoes rb
                                          WHERE rb.lancamento_id = lb.id), 0::numeric)) AS baixado
                                   FROM lancamentos_financeiros lb
                                  WHERE lb.origem = 'titulo_baixa'::origem_lancamento AND lb.titulo_receber_id = t.id) b
                          WHERE t.status = 'em_aberto'::titulo_receber_status
                            AND tp.valor_proprio > 0::numeric
                            AND NOT EXISTS ( SELECT 1
                                   FROM saves_avulsos sa
                                  WHERE sa.faturamento_id = t.faturamento_id)) p) x
          WHERE x.ordem = 1 AND x.ajuste <> 0
        ), recorrente_ajuste AS (
         -- Recorrência prevista: o valor da recorrência pelo rateio dela
         -- (o mesmo em toda ocorrência).
         SELECT x.recorrente_id, x.regional_id, x.ajuste
           FROM ( SELECT r.recorrente_id, r.regional_id,
                    row_number() OVER (PARTITION BY r.recorrente_id ORDER BY r.percentual DESC, rg.nome, r.regional_id) AS ordem,
                    round(t.valor * sum(r.percentual / 100.0) OVER (PARTITION BY r.recorrente_id), 2)
                      - sum((t.valor * (r.percentual / 100.0))::numeric(14,2)) OVER (PARTITION BY r.recorrente_id) AS ajuste
                   FROM contas_avulsas_recorrentes_regionais r
                     JOIN contas_avulsas_recorrentes t ON t.id = r.recorrente_id
                     LEFT JOIN regionais rg ON rg.id = r.regional_id) x
          WHERE x.ordem = 1 AND x.ajuste <> 0
        ), pps_do_item AS ($t$
  ];

  v_vezes := array[2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

  for i in 1 .. array_length(v_antes, 1) loop
    v_n := (length(v_def) - length(replace(v_def, v_antes[i], ''))) / length(v_antes[i]);
    if v_n <> v_vezes[i] then
      raise exception 'public.vw_fluxo_caixa: o trecho % aparece % vez(es), esperado %', i, v_n, v_vezes[i];
    end if;
    v_def := replace(v_def, v_antes[i], v_depois[i]);
  end loop;

  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;

  -- Conferência: todo lançamento realizado soma, na view, o próprio valor.
  if exists (
    select 1
      from (select v.origem_id, sum(v.valor) as soma
              from public.vw_fluxo_caixa v
             where v.situacao = 'realizado'
               and v.origem_tipo in ('lancamento', 'lancamento_save', 'lancamento_save_consumido')
             group by v.origem_id) v
      join public.lancamentos_financeiros l on l.id = v.origem_id
     where v.soma <> l.valor
  ) then
    raise exception 'public.vw_fluxo_caixa: há lançamento realizado cuja soma na view difere do valor';
  end if;
end $$;
