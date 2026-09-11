-- =====================================================================
-- O BV se associa ao job, como o resto
--
-- Continua a decisão 069 (`20260910210001_regional_do_job_e_a_fonte.sql`):
-- "origem em job -> a regional é a do job". O BV ficou de fora dela por
-- omissão da view, não por regra — e o Tiago mandou corrigir agora, em
-- 11/09/2026, deixando o resto para o próximo lote.
--
-- ---------------------------------------------------------------------
-- O que estava errado
--
-- BV é bonificação de veiculação: a comissão que a agência recebe do
-- FORNECEDOR de mídia. Ele entra na esteira de faturamento como origem
-- própria (`faturamento_origem = 'bv'`), com fornecedor no lugar do
-- cliente — e por isso parecia não ter job.
--
-- Tem. O caminho é `itens_bv.job_item_orcado_id` ->
-- `jobs_itens_orcado.job_id`, e a `vw_faturamento_pendente` JÁ o percorre
-- para listar o BV a faturar. Quem não percorria era a `vw_fluxo_caixa`:
-- o CTE `fat_composicao` resolvia o job só para `origem_tipo = 'job'` e
-- devolvia NULL para todo o resto. Consequência:
--
--   - o título de BV aparecia sem job e SEM REGIONAL;
--   - a baixa desse título também, porque `lancamento_job` deriva o job
--     do lançamento a partir de `fat_composicao`.
--
-- ---------------------------------------------------------------------
-- Por que o elo direto basta
--
-- Levantado no banco antes de escrever (8 BVs): nos 5 que têm cópia no
-- job, `job_item_orcado_id` está preenchido E a rota alternativa (pelo
-- `item_versao_id`) devolve o MESMO job. Os 3 sem o elo não têm cópia no
-- job nenhuma — são BVs de orçamento, cujo job ainda não existe; não há
-- job a associar.
--
-- Além disso, só BV `confirmado` chega ao faturamento, e `confirmarBv`
-- exige job aberto (`jobAceitaAcoesPlanilha`). BV faturado sempre tem job.
--
-- Por isso a resolução aqui é a MESMA da `vw_faturamento_pendente` — as
-- duas views contam a mesma história. Um COALESCE com a rota pelo
-- `item_versao_id` seria inventar regra que o dado não pede.
--
-- ---------------------------------------------------------------------
-- O efeito
--
-- `fat_composicao` passa a agrupar o faturamento por job também quando o
-- item é BV. Como é ele que alimenta o rateio do título entre N jobs, uma
-- nota que misture faturamento de job e BV passa a dividir certo — antes
-- o pedaço do BV caía todo no grupo NULL.
--
-- Segue fora, para o próximo lote: título com origem `avulso` (esse não
-- tem job mesmo), pagamento de fatura de cartão, e o rateio da despesa
-- sem job.
-- =====================================================================

create or replace view public.vw_fluxo_caixa as
 WITH avulsa_rateio AS (
         SELECT a.id AS conta_avulsa_id,
            j.regional_id,
            1.0 AS fator
           FROM (contas_avulsas a
             JOIN jobs j ON ((j.id = a.job_id)))
        UNION ALL
         SELECT r.conta_avulsa_id,
            r.regional_id,
            (r.percentual / 100.0) AS fator
           FROM (contas_avulsas_regionais r
             JOIN contas_avulsas a ON ((a.id = r.conta_avulsa_id)))
          WHERE (a.job_id IS NULL)
        UNION ALL
         SELECT a.id,
            a.regional_id,
            1.0 AS fator
           FROM contas_avulsas a
          WHERE ((a.job_id IS NULL) AND (NOT (EXISTS ( SELECT 1
                   FROM contas_avulsas_regionais r
                  WHERE (r.conta_avulsa_id = a.id)))))
        ), desembolso_rateio AS (
         SELECT r.desembolso_id,
            r.regional_id,
            (r.percentual / 100.0) AS fator
           FROM desembolsos_regionais r
        UNION ALL
         SELECT d.id,
            NULL::uuid AS regional_id,
            1.0 AS fator
           FROM desembolsos d
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM desembolsos_regionais r
                  WHERE (r.desembolso_id = d.id))))
        ), lancamento_rateio AS (
         SELECT l.id AS lancamento_id,
            ar.regional_id,
            ar.fator
           FROM (lancamentos_financeiros l
             JOIN avulsa_rateio ar ON ((ar.conta_avulsa_id = l.conta_avulsa_id)))
        UNION ALL
         SELECT l.id,
            dr.regional_id,
            dr.fator
           FROM (lancamentos_financeiros l
             JOIN desembolso_rateio dr ON ((dr.desembolso_id = l.desembolso_id)))
          WHERE (l.conta_avulsa_id IS NULL)
        UNION ALL
         SELECT l.id,
            COALESCE(j.regional_id, l.regional_id) AS regional_id,
            1.0 AS fator
           FROM (lancamentos_financeiros l
             LEFT JOIN jobs j ON ((j.id = l.job_id)))
          WHERE ((l.conta_avulsa_id IS NULL) AND (l.desembolso_id IS NULL))
        ), fat_composicao AS (
         SELECT fi.faturamento_id,
                CASE
                    WHEN (fi.origem_tipo = 'job'::faturamento_origem) THEN fi.origem_id
                    WHEN (fi.origem_tipo = 'bv'::faturamento_origem) THEN bvi.job_id
                    ELSE NULL::uuid
                END AS job_id,
            sum(fi.valor) AS valor
           FROM ((faturamento_itens fi
             LEFT JOIN itens_bv bv ON (((bv.id = fi.origem_id) AND (fi.origem_tipo = 'bv'::faturamento_origem))))
             LEFT JOIN jobs_itens_orcado bvi ON ((bvi.id = bv.job_item_orcado_id)))
          WHERE (fi.origem_tipo <> 'save'::faturamento_origem)
          GROUP BY fi.faturamento_id,
                CASE
                    WHEN (fi.origem_tipo = 'job'::faturamento_origem) THEN fi.origem_id
                    WHEN (fi.origem_tipo = 'bv'::faturamento_origem) THEN bvi.job_id
                    ELSE NULL::uuid
                END
        ), fat_total AS (
         SELECT fat_composicao.faturamento_id,
            sum(fat_composicao.valor) AS total
           FROM fat_composicao
          GROUP BY fat_composicao.faturamento_id
        ), fat_partes AS (
         SELECT fi.faturamento_id,
            sum(fi.valor) FILTER (WHERE (fi.origem_tipo <> 'save'::faturamento_origem)) AS valor_proprio,
            sum(fi.valor) FILTER (WHERE (fi.origem_tipo = 'save'::faturamento_origem)) AS valor_save,
            (array_agg(fi.origem_id) FILTER (WHERE (fi.origem_tipo = 'save'::faturamento_origem)))[1] AS save_job_id
           FROM faturamento_itens fi
          GROUP BY fi.faturamento_id
        ), titulo_partes AS (
         SELECT tp.titulo_id,
            tp.faturamento_id,
            tp.valor,
            tp.valor_proprio,
            tp.save_job_id
           FROM vw_titulo_partes tp
        ), lancamento_job AS (
         SELECT l.id AS lancamento_id,
            COALESCE(rat.job_id, l.job_id) AS job_id,
            COALESCE(rat.fator, 1.0) AS fator,
            rat.save_job_id
           FROM (lancamentos_financeiros l
             LEFT JOIN LATERAL ( SELECT c.job_id,
                    ((tp.valor_proprio / NULLIF(tp.valor, (0)::numeric)) * (c.valor / NULLIF(ft.total, (0)::numeric))) AS fator,
                    NULL::uuid AS save_job_id
                   FROM ((titulo_partes tp
                     JOIN fat_composicao c ON ((c.faturamento_id = tp.faturamento_id)))
                     JOIN fat_total ft ON ((ft.faturamento_id = tp.faturamento_id)))
                  WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor_proprio > (0)::numeric))
                UNION ALL
                 SELECT NULL::uuid AS uuid,
                    ((tp.valor - tp.valor_proprio) / NULLIF(tp.valor, (0)::numeric)),
                    tp.save_job_id
                   FROM titulo_partes tp
                  WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor > tp.valor_proprio))) rat ON (true))
        ), pps_do_item AS (
         SELECT pc.item_realizado_id,
            COALESCE(sum(pc.valor) FILTER (WHERE (pc.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status]))), (0)::numeric) AS em_titulo,
            COALESCE(sum(pc.valor) FILTER (WHERE (pc.status <> ALL (ARRAY['cancelada'::pp_status, 'aprovada'::pp_status, 'pago'::pp_status]))), (0)::numeric) AS sem_titulo
           FROM pedidos_compra pc
          WHERE (pc.item_realizado_id IS NOT NULL)
          GROUP BY pc.item_realizado_id
        ), abatimento_curva AS (
         SELECT ir.job_id,
            (sum(
                CASE
                    WHEN (ir.pps_concluidas_em IS NOT NULL) THEN GREATEST((0)::numeric, (COALESCE(io.total_planejado, (0)::numeric) - COALESCE(p.sem_titulo, (0)::numeric)))
                    ELSE LEAST(COALESCE(io.total_planejado, (0)::numeric), COALESCE(p.em_titulo, (0)::numeric))
                END))::numeric(14,2) AS valor
           FROM ((jobs_itens_realizado ir
             JOIN jobs_itens_orcado io ON ((io.id = ir.job_item_orcado_id)))
             LEFT JOIN pps_do_item p ON ((p.item_realizado_id = ir.id)))
          WHERE ((io.tipo_custo)::text = ANY (ARRAY['AR'::text, 'B'::text, 'C'::text, 'F'::text, 'FI'::text]))
          GROUP BY ir.job_id
        ), curva AS (
         SELECT p.id,
            p.tenant_id,
            p.job_id,
            p.ordem,
            p.data_prevista,
            p.valor,
            sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas
           FROM jobs_previsao_custo p
        ), residuo_curva AS (
         SELECT c.id,
            c.tenant_id,
            c.job_id,
            c.ordem,
            c.total_parcelas,
            c.data_prevista,
            (GREATEST((0)::numeric, LEAST(c.valor, (c.acumulado - COALESCE(a.valor, (0)::numeric)))))::numeric(14,2) AS valor
           FROM (curva c
             LEFT JOIN abatimento_curva a ON ((a.job_id = c.job_id)))
        ), jobs_com_envio AS (
         SELECT DISTINCT e.job_id
           FROM jobs_envio_faturamento e
        ), previsao_recebimento AS (
         SELECT p.id,
            p.tenant_id,
            p.job_id,
            p.ordem,
            p.data_prevista,
            p.valor,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas,
            (GREATEST((0)::numeric, LEAST(p.valor, ((COALESCE(j.faturamento_previsto, (0)::numeric) - COALESCE(j.faturamento_save_previsto, (0)::numeric)) - (sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id) - p.valor)))))::numeric(14,2) AS valor_proprio
           FROM (jobs_previsao_recebimento p
             JOIN jobs j ON ((j.id = p.job_id)))
        ), envio_saldo AS (
         SELECT pa.id,
            pa.tenant_id,
            pa.job_id,
            pa.ordem,
            pa.data_vencimento,
            ((pa.valor - COALESCE(( SELECT sum(fi.valor) AS sum
                   FROM (faturamento_itens fi
                     JOIN faturamentos f ON ((f.id = fi.faturamento_id)))
                  WHERE ((fi.envio_parcela_id = pa.id) AND (f.status <> 'cancelado'::faturamento_status))), (0)::numeric)))::numeric(14,2) AS valor,
            count(*) OVER (PARTITION BY pa.envio_id) AS total_parcelas,
            (GREATEST((0)::numeric, LEAST(pa.valor, ((COALESCE(j.faturamento_previsto, (0)::numeric) - COALESCE(j.faturamento_save_previsto, (0)::numeric)) - (sum(pa.valor) OVER (PARTITION BY pa.envio_id ORDER BY pa.ordem, pa.id) - pa.valor)))))::numeric(14,2) AS bruto_proprio
           FROM (jobs_envio_faturamento_parcelas pa
             JOIN jobs j ON ((j.id = pa.job_id)))
        ), save_fatias AS (
         SELECT lj.save_job_id,
            'realizado'::text AS situacao,
            'movimento'::text AS classe,
            'lancamento_save'::text AS origem_tipo,
            l.id AS origem_id,
            l.tenant_id,
            l.empresa_id,
            l.conta_bancaria_id,
            l.data_movimento AS data_evento,
            (((l.valor * lr.fator) * lj.fator))::numeric(14,2) AS valor,
            l.descricao AS base,
            l.cliente_id,
            l.fornecedor_id,
            COALESCE(jlj.regional_id, lr.regional_id) AS regional_id,
            (l.origem)::text AS origem_lancamento
           FROM (((lancamentos_financeiros l
             JOIN lancamento_rateio lr ON ((lr.lancamento_id = l.id)))
             JOIN lancamento_job lj ON ((lj.lancamento_id = l.id)))
             LEFT JOIN jobs jlj ON ((jlj.id = lj.job_id)))
          WHERE (lj.save_job_id IS NOT NULL)
        UNION ALL
         SELECT tp.save_job_id,
            'previsto'::text AS text,
            'titulo'::text AS text,
            'titulo_save'::text AS text,
            t.id,
            t.tenant_id,
            t.empresa_id,
            NULL::uuid AS uuid,
            COALESCE(t.data_previsao_recebimento, t.data_vencimento) AS "coalesce",
            ((t.valor - tp.valor_proprio))::numeric(14,2) AS "numeric",
            ((('Título NF '::text || f.numero_nf) || '/'::text) || (t.numero_parcela)::text),
            f.cliente_id,
            f.fornecedor_id,
            COALESCE(sj.regional_id, t.regional_id) AS "coalesce",
            NULL::text AS text
           FROM (((titulos_receber t
             JOIN titulo_partes tp ON ((tp.titulo_id = t.id)))
             JOIN faturamentos f ON ((f.id = t.faturamento_id)))
             LEFT JOIN jobs sj ON ((sj.id = tp.save_job_id)))
          WHERE ((t.status = 'em_aberto'::titulo_receber_status) AND (t.valor > tp.valor_proprio))
        UNION ALL
         SELECT p.job_id,
            'previsto'::text AS text,
            'previsao'::text AS text,
            'previsao_recebimento_save'::text AS text,
            p.id,
            p.tenant_id,
            j.empresa_id,
            NULL::uuid AS uuid,
                CASE
                    WHEN (p.data_prevista < CURRENT_DATE) THEN (CURRENT_DATE + 1)
                    ELSE p.data_prevista
                END AS data_prevista,
            ((p.valor - p.valor_proprio))::numeric(14,2) AS "numeric",
            ((((('Previsão de recebimento · '::text || j.codigo) || ' '::text) || p.ordem) || '/'::text) || p.total_parcelas),
            pj.cliente_id,
            NULL::uuid AS uuid,
            j.regional_id,
            NULL::text AS text
           FROM ((previsao_recebimento p
             JOIN jobs j ON ((j.id = p.job_id)))
             LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
          WHERE ((p.valor > p.valor_proprio) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])) AND (NOT (EXISTS ( SELECT 1
                   FROM jobs_com_envio ce
                  WHERE (ce.job_id = p.job_id)))))
        UNION ALL
         SELECT s.job_id,
            'previsto'::text AS text,
            'previsao'::text AS text,
            'envio_parcela_save'::text AS text,
            s.id,
            s.tenant_id,
            j.empresa_id,
            NULL::uuid AS uuid,
                CASE
                    WHEN (s.data_vencimento < CURRENT_DATE) THEN (CURRENT_DATE + 1)
                    ELSE s.data_vencimento
                END AS data_vencimento,
            ((s.valor - LEAST(s.valor, s.bruto_proprio)))::numeric(14,2) AS "numeric",
            ((((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text) || s.total_parcelas),
            pj.cliente_id,
            NULL::uuid AS uuid,
            j.regional_id,
            NULL::text AS text
           FROM ((envio_saldo s
             JOIN jobs j ON ((j.id = s.job_id)))
             LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
          WHERE ((s.valor > LEAST(s.valor, s.bruto_proprio)) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])))
        ), save_fatias_ord AS (
         SELECT f.save_job_id,
            f.situacao,
            f.classe,
            f.origem_tipo,
            f.origem_id,
            f.tenant_id,
            f.empresa_id,
            f.conta_bancaria_id,
            f.data_evento,
            f.valor,
            f.base,
            f.cliente_id,
            f.fornecedor_id,
            f.regional_id,
            f.origem_lancamento,
            (sum(f.valor) OVER w - f.valor) AS ini,
            sum(f.valor) OVER w AS fim
           FROM save_fatias f
          WHERE (f.valor > (0)::numeric)
          WINDOW w AS (PARTITION BY f.save_job_id ORDER BY f.data_evento, f.origem_tipo, f.origem_id)
        ), save_gerado AS (
         SELECT o.job_id,
            sum(o.total_orcado) AS principal
           FROM jobs_itens_orcado o
          WHERE o.em_save
          GROUP BY o.job_id
        ), save_consumo_ord AS (
         SELECT c.job_origem_id,
            oc.job_id AS job_consumidor,
            c.id,
            (((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2) AS valor,
            (sum((((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2)) OVER w2 - (((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2)) AS ini,
            sum((((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2)) OVER w2 AS fim
           FROM (((saves_consumos c
             JOIN jobs_itens_orcado oc ON ((oc.id = c.job_item_orcado_id)))
             JOIN jobs jo ON ((jo.id = c.job_origem_id)))
             JOIN save_gerado g ON ((g.job_id = c.job_origem_id)))
          WHERE (c.job_item_orcado_id IS NOT NULL)
          WINDOW w2 AS (PARTITION BY c.job_origem_id ORDER BY c.created_at, c.id)
        ), save_alocado AS (
         SELECT f.origem_id,
            f.origem_tipo,
            f.situacao,
            f.classe,
            f.tenant_id,
            f.empresa_id,
            f.conta_bancaria_id,
            f.data_evento,
            f.base,
            f.cliente_id,
            f.fornecedor_id,
            f.origem_lancamento,
            f.save_job_id,
            c.job_consumidor,
            c.id AS consumo_id,
            ((LEAST(f.fim, c.fim) - GREATEST(f.ini, c.ini)))::numeric(14,2) AS valor,
            jc.regional_id
           FROM ((save_fatias_ord f
             JOIN save_consumo_ord c ON ((c.job_origem_id = f.save_job_id)))
             JOIN jobs jc ON ((jc.id = c.job_consumidor)))
          WHERE ((LEAST(f.fim, c.fim) - GREATEST(f.ini, c.ini)) > 0.004)
        )
 SELECT 'realizado'::text AS situacao,
    'lancamento'::text AS origem_tipo,
    l.id AS origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento AS data_evento,
    (((l.valor * lr.fator) * lj.fator))::numeric(14,2) AS valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    lj.job_id,
    'movimento'::text AS classe,
    COALESCE(jlj.regional_id, lr.regional_id) AS regional_id,
    (l.origem)::text AS origem_lancamento
   FROM (((lancamentos_financeiros l
     JOIN lancamento_rateio lr ON ((lr.lancamento_id = l.id)))
     JOIN lancamento_job lj ON ((lj.lancamento_id = l.id)))
     LEFT JOIN jobs jlj ON ((jlj.id = lj.job_id)))
  WHERE (lj.save_job_id IS NULL)
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'pp'::text AS origem_tipo,
    par.id AS origem_id,
    pp.tenant_id,
    pp.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    par.data_pagamento AS data_evento,
    (par.valor)::numeric(14,2) AS valor,
    'saida'::natureza_lancamento AS natureza,
    ((((((('PP '::text || pp.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(pp.servico, 1, 150)) AS descricao,
    pp.fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    'titulo'::text AS classe,
    jb.regional_id,
    NULL::text AS origem_lancamento
   FROM (((pedidos_compra_parcelas par
     JOIN pedidos_compra pp ON ((pp.id = par.pedido_compra_id)))
     JOIN jobs jb ON ((jb.id = pp.job_id)))
     JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM pedidos_compra_parcelas x
          WHERE (x.pedido_compra_id = par.pedido_compra_id)) tot ON (true))
  WHERE ((pp.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status])) AND (par.pago_em IS NULL))
UNION ALL
 SELECT 'previsto'::text AS situacao,
        CASE
            WHEN (a.recorrente_id IS NOT NULL) THEN 'recorrente'::text
            ELSE 'avulsa'::text
        END AS origem_tipo,
    a.id AS origem_id,
    a.tenant_id,
    a.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    COALESCE(a.data_pagamento, a.data_prevista_pagamento) AS data_evento,
    ((a.valor * ar.fator))::numeric(14,2) AS valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    'titulo'::text AS classe,
    ar.regional_id,
    NULL::text AS origem_lancamento
   FROM (contas_avulsas a
     JOIN avulsa_rateio ar ON ((ar.conta_avulsa_id = a.id)))
  WHERE (a.status = 'aprovada'::conta_avulsa_status)
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'desembolso'::text AS origem_tipo,
    par.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    par.data_pagamento AS data_evento,
    ((par.valor * dr.fator))::numeric(14,2) AS valor,
    'saida'::natureza_lancamento AS natureza,
    ((((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(d.descricao, 1, 150)) AS descricao,
    d.fornecedor_id,
    d.cliente_id,
    NULL::uuid AS job_id,
    'titulo'::text AS classe,
    dr.regional_id,
    NULL::text AS origem_lancamento
   FROM (((desembolsos_parcelas par
     JOIN desembolsos d ON ((d.id = par.desembolso_id)))
     JOIN desembolso_rateio dr ON ((dr.desembolso_id = d.id)))
     JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM desembolsos_parcelas x
          WHERE (x.desembolso_id = par.desembolso_id)) tot ON (true))
  WHERE ((d.status = ANY (ARRAY['aprovada'::desembolso_status, 'pago'::desembolso_status])) AND (par.pago_em IS NULL))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'titulo'::text AS origem_tipo,
    t.id AS origem_id,
    t.tenant_id,
    t.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    COALESCE(t.data_previsao_recebimento, t.data_vencimento) AS data_evento,
    ((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)))::numeric(14,2) AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((('Título NF '::text || f.numero_nf) || '/'::text) || (t.numero_parcela)::text) AS descricao,
    f.fornecedor_id,
    f.cliente_id,
    c.job_id,
    'titulo'::text AS classe,
    COALESCE(j.regional_id, t.regional_id) AS regional_id,
    NULL::text AS origem_lancamento
   FROM (((((titulos_receber t
     JOIN titulo_partes tp ON ((tp.titulo_id = t.id)))
     JOIN faturamentos f ON ((f.id = t.faturamento_id)))
     LEFT JOIN fat_composicao c ON ((c.faturamento_id = t.faturamento_id)))
     LEFT JOIN fat_total ft ON ((ft.faturamento_id = t.faturamento_id)))
     LEFT JOIN jobs j ON ((j.id = c.job_id)))
  WHERE ((t.status = 'em_aberto'::titulo_receber_status) AND (tp.valor_proprio > (0)::numeric))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_custo'::text AS origem_tipo,
    r.id AS origem_id,
    r.tenant_id,
    j.empresa_id,
    NULL::uuid AS conta_bancaria_id,
        CASE
            WHEN (r.data_prevista < CURRENT_DATE) THEN fc_proxima_janela_pagamento(CURRENT_DATE)
            ELSE r.data_prevista
        END AS data_evento,
    r.valor,
    'saida'::natureza_lancamento AS natureza,
    ((((('Cronograma de desembolsos · '::text || j.codigo) || ' '::text) || r.ordem) || '/'::text) || r.total_parcelas) AS descricao,
    NULL::uuid AS fornecedor_id,
    pj.cliente_id,
    r.job_id,
    'previsao'::text AS classe,
    j.regional_id,
    NULL::text AS origem_lancamento
   FROM ((residuo_curva r
     JOIN jobs j ON ((j.id = r.job_id)))
     LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
  WHERE ((r.valor > (0)::numeric) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_recebimento'::text AS origem_tipo,
    p.id AS origem_id,
    p.tenant_id,
    j.empresa_id,
    NULL::uuid AS conta_bancaria_id,
        CASE
            WHEN (p.data_prevista < CURRENT_DATE) THEN (CURRENT_DATE + 1)
            ELSE p.data_prevista
        END AS data_evento,
    p.valor_proprio AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((((('Previsão de recebimento · '::text || j.codigo) || ' '::text) || p.ordem) || '/'::text) || p.total_parcelas) AS descricao,
    NULL::uuid AS fornecedor_id,
    pj.cliente_id,
    p.job_id,
    'previsao'::text AS classe,
    j.regional_id,
    NULL::text AS origem_lancamento
   FROM ((previsao_recebimento p
     JOIN jobs j ON ((j.id = p.job_id)))
     LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
  WHERE ((p.valor_proprio > (0)::numeric) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])) AND (NOT (EXISTS ( SELECT 1
           FROM jobs_com_envio ce
          WHERE (ce.job_id = p.job_id)))))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'envio_parcela'::text AS origem_tipo,
    s.id AS origem_id,
    s.tenant_id,
    j.empresa_id,
    NULL::uuid AS conta_bancaria_id,
        CASE
            WHEN (s.data_vencimento < CURRENT_DATE) THEN (CURRENT_DATE + 1)
            ELSE s.data_vencimento
        END AS data_evento,
    LEAST(s.valor, s.bruto_proprio) AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text) || s.total_parcelas) AS descricao,
    NULL::uuid AS fornecedor_id,
    pj.cliente_id,
    s.job_id,
    'previsao'::text AS classe,
    j.regional_id,
    NULL::text AS origem_lancamento
   FROM ((envio_saldo s
     JOIN jobs j ON ((j.id = s.job_id)))
     LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
  WHERE ((LEAST(s.valor, s.bruto_proprio) > (0)::numeric) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'pp_devolucao_verba'::text AS origem_tipo,
    d.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    d.data_pagamento AS data_evento,
    d.valor,
    'entrada'::natureza_lancamento AS natureza,
    ((('Devolução verba '::text || pp.codigo) || ' — '::text) || "substring"(pp.servico, 1, 140)) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    'titulo'::text AS classe,
    jb.regional_id,
    NULL::text AS origem_lancamento
   FROM ((pp_verba_devolucoes d
     JOIN pedidos_compra pp ON ((pp.id = d.pedido_compra_id)))
     LEFT JOIN jobs jb ON ((jb.id = pp.job_id)))
  WHERE (d.pago_em IS NULL)
UNION ALL
 SELECT f.situacao,
    f.origem_tipo,
    f.origem_id,
    f.tenant_id,
    f.empresa_id,
    f.conta_bancaria_id,
    f.data_evento,
    ((f.valor - COALESCE(al.alocado, (0)::numeric)))::numeric(14,2) AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((f.base || ' · saldo em save de '::text) || COALESCE(sj.codigo, '—'::text)) AS descricao,
    f.fornecedor_id,
    f.cliente_id,
    NULL::uuid AS job_id,
    f.classe,
    f.regional_id,
    f.origem_lancamento
   FROM ((save_fatias_ord f
     LEFT JOIN jobs sj ON ((sj.id = f.save_job_id)))
     LEFT JOIN LATERAL ( SELECT sum(a.valor) AS alocado
           FROM save_alocado a
          WHERE ((a.origem_id = f.origem_id) AND (a.origem_tipo = f.origem_tipo))) al ON (true))
  WHERE ((f.valor - COALESCE(al.alocado, (0)::numeric)) > 0.004)
UNION ALL
 SELECT a.situacao,
    (a.origem_tipo || '_consumido'::text) AS origem_tipo,
    a.origem_id,
    a.tenant_id,
    a.empresa_id,
    a.conta_bancaria_id,
    a.data_evento,
    a.valor,
    'entrada'::natureza_lancamento AS natureza,
    ((((a.base || ' · save de '::text) || COALESCE(so.codigo, '—'::text)) || ' consumido por '::text) || COALESCE(jc.codigo, '—'::text)) AS descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_consumidor AS job_id,
    a.classe,
    a.regional_id,
    a.origem_lancamento
   FROM ((save_alocado a
     LEFT JOIN jobs so ON ((so.id = a.save_job_id)))
     LEFT JOIN jobs jc ON ((jc.id = a.job_consumidor)));

grant select on public.vw_fluxo_caixa to authenticated;
