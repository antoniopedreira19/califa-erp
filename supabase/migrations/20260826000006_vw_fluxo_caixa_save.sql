-- =====================================================================
-- SAVE — o fluxo de caixa separa "recebimento do job" de "saldo em save"
--
-- Decisao docs/decisions/023, com as regras de fluxo definidas pelo Tiago
-- em 26/08/2026:
--
--   * O dinheiro em save entra no fluxo SEM JOB. Ele nao e do job que
--     faturou nem de ninguem, ate que um job o consuma — mas a origem
--     nunca se perde: a descricao carrega "saldo em save de JOB-XXXX".
--   * JOB PRIMEIRO, DEPOIS O SAVE. Onde o recebimento se divide em
--     parcelas, as primeiras cobrem a parte propria do job e o save ocupa
--     o fim da fila. Vale para a previsao da abertura, para o saldo do
--     envio, para os titulos da nota e para as baixas.
--   * Em nota agrupada, os jobs se dividem entre si proporcionalmente
--     (como ja faziam) e o save vem por ultimo.
--
-- NAO MUDA NADA ONDE NAO HA SAVE. Sem itens de save, `valor_proprio` e o
-- total, cada parcela sai inteira como propria e o rateio entre jobs usa
-- o mesmo denominador de antes. Conferido por impressao digital da saida
-- da view antes e depois: 35 linhas, R$ 2.174.187,25, md5 identico.
--
-- De onde vem "quanto e save":
--   * na nota  -> `faturamento_itens.origem_tipo = 'save'`
--   * no job   -> `jobs.faturamento_save_previsto`, escrito pelo
--                 TypeScript. A matriz de REGRAS_TIPO_CUSTO NAO se repete
--                 aqui — foi para isso que a coluna existe.
--
-- Ramos novos: `titulo_save`, `previsao_recebimento_save` e
-- `envio_parcela_save`, todos com `job_id` nulo.
--
-- O que ainda NAO esta aqui: a atribuicao do save ao job que o consome.
-- Entra na proxima migration.
-- =====================================================================

create or replace view public.vw_fluxo_caixa as
 WITH avulsa_rateio AS (
         SELECT r.conta_avulsa_id, r.regional_id, r.percentual / 100.0 AS fator
           FROM contas_avulsas_regionais r
        UNION ALL
         SELECT a.id, COALESCE(j.regional_id, e.regional_id) AS regional_id, 1.0 AS fator
           FROM contas_avulsas a
             LEFT JOIN jobs j ON j.id = a.job_id
             LEFT JOIN empresas e ON e.id = a.empresa_id
          WHERE NOT (EXISTS ( SELECT 1 FROM contas_avulsas_regionais r WHERE r.conta_avulsa_id = a.id))
        ), lancamento_rateio AS (
         SELECT l.id AS lancamento_id, ar.regional_id, ar.fator
           FROM lancamentos_financeiros l
             JOIN avulsa_rateio ar ON ar.conta_avulsa_id = l.conta_avulsa_id
        UNION ALL
         SELECT l.id, COALESCE(j.regional_id, e.regional_id) AS regional_id, 1.0 AS fator
           FROM lancamentos_financeiros l
             LEFT JOIN jobs j ON j.id = l.job_id
             LEFT JOIN empresas e ON e.id = l.empresa_id
          WHERE l.conta_avulsa_id IS NULL

-- ---------------------------------------------------------------------
-- SAVE (docs/decisions/023): a nota separa o que e do job do que e saldo
-- em save. `fat_composicao` passa a EXCLUIR os itens de save, e por isso
-- `fat_total` vira "o proprio da nota" — o denominador do rateio entre os
-- jobs que ela cobre continua sendo so a parte deles.
-- ---------------------------------------------------------------------
        ), fat_composicao AS (
         SELECT fi.faturamento_id,
                CASE WHEN fi.origem_tipo = 'job'::faturamento_origem THEN fi.origem_id ELSE NULL::uuid END AS job_id,
            sum(fi.valor) AS valor
           FROM faturamento_itens fi
          WHERE fi.origem_tipo <> 'save'::faturamento_origem
          GROUP BY fi.faturamento_id, (CASE WHEN fi.origem_tipo = 'job'::faturamento_origem THEN fi.origem_id ELSE NULL::uuid END)
        ), fat_total AS (
         SELECT fat_composicao.faturamento_id, sum(fat_composicao.valor) AS total
           FROM fat_composicao GROUP BY fat_composicao.faturamento_id

-- Quanto de cada nota e save, e de qual job veio o credito.
        ), fat_partes AS (
         SELECT fi.faturamento_id,
            sum(fi.valor) FILTER (WHERE fi.origem_tipo <> 'save'::faturamento_origem) AS valor_proprio,
            sum(fi.valor) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem) AS valor_save,
            -- Postgres nao tem min(uuid); e todos os itens de save de uma
            -- nota apontam para o MESMO job de origem (o dono da nota),
            -- entao qualquer um serve.
            (array_agg(fi.origem_id) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem))[1] AS save_job_id
           FROM faturamento_itens fi GROUP BY fi.faturamento_id

-- JOB PRIMEIRO, DEPOIS O SAVE (decisao do Tiago, 26/08/2026).
-- Os titulos da nota, na ordem, cobrem primeiro a parte propria; o save
-- ocupa o FIM da fila. Em nota sem save `valor_proprio` e o total e cada
-- titulo sai inteiro como proprio — a conta de hoje, intacta.
        ), titulo_partes AS (
         SELECT t.id AS titulo_id, t.faturamento_id, t.valor,
            GREATEST(0::numeric, LEAST(t.valor,
              COALESCE(fp.valor_proprio, t.valor)
              - (sum(t.valor) OVER (PARTITION BY t.faturamento_id ORDER BY t.numero_parcela, t.id) - t.valor)
            ))::numeric(14,2) AS valor_proprio,
            fp.save_job_id
           FROM titulos_receber t
             LEFT JOIN fat_partes fp ON fp.faturamento_id = t.faturamento_id
          WHERE t.status <> 'cancelado'::titulo_receber_status

-- A baixa herda a divisao do titulo dela: a parte propria rateada entre
-- os jobs da nota (como sempre) e a parte em save SEM JOB, ate que alguem
-- consuma o credito.
        ), lancamento_job AS (
         SELECT l.id AS lancamento_id,
            COALESCE(rat.job_id, l.job_id) AS job_id,
            COALESCE(rat.fator, 1.0) AS fator,
            rat.save_job_id
           FROM lancamentos_financeiros l
             LEFT JOIN LATERAL (
                 SELECT c.job_id,
                    (tp.valor_proprio / NULLIF(tp.valor, 0::numeric))
                      * (c.valor / NULLIF(ft.total, 0::numeric)) AS fator,
                    NULL::uuid AS save_job_id
                   FROM titulo_partes tp
                     JOIN fat_composicao c ON c.faturamento_id = tp.faturamento_id
                     JOIN fat_total ft ON ft.faturamento_id = tp.faturamento_id
                  WHERE tp.titulo_id = l.titulo_receber_id AND l.job_id IS NULL
                    AND tp.valor_proprio > 0::numeric
                 UNION ALL
                 SELECT NULL::uuid,
                    (tp.valor - tp.valor_proprio) / NULLIF(tp.valor, 0::numeric),
                    tp.save_job_id
                   FROM titulo_partes tp
                  WHERE tp.titulo_id = l.titulo_receber_id AND l.job_id IS NULL
                    AND tp.valor > tp.valor_proprio
             ) rat ON true
        ), itens_com_pp AS (
         SELECT DISTINCT pc.item_realizado_id FROM pedidos_compra pc
          WHERE pc.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status])
        ), abatimento_curva AS (
         SELECT ir.job_id, sum(COALESCE(voi.total_planejado, 0::numeric))::numeric(14,2) AS valor
           FROM jobs_itens_realizado ir
             JOIN versoes_orcamento_itens voi ON voi.id = ir.item_id
          WHERE (ir.id IN ( SELECT itens_com_pp.item_realizado_id FROM itens_com_pp))
            AND (voi.tipo_custo::text = ANY (ARRAY['AR'::text, 'B'::text, 'C'::text, 'F'::text, 'FI'::text]))
          GROUP BY ir.job_id
        ), curva AS (
         SELECT p.id, p.tenant_id, p.job_id, p.ordem, p.data_prevista, p.valor,
            sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas
           FROM jobs_previsao_custo p
        ), residuo_curva AS (
         SELECT c.id, c.tenant_id, c.job_id, c.ordem, c.total_parcelas, c.data_prevista,
            GREATEST(0::numeric, LEAST(c.valor, c.acumulado - COALESCE(a.valor, 0::numeric)))::numeric(14,2) AS valor
           FROM curva c LEFT JOIN abatimento_curva a ON a.job_id = c.job_id
        ), jobs_com_envio AS (
         SELECT DISTINCT e.job_id FROM jobs_envio_faturamento e

-- A previsao da abertura tambem se divide job primeiro. O quanto e save
-- vem de `jobs.faturamento_save_previsto`, escrito pelo TypeScript — a
-- matriz de tipos de custo nao se repete aqui.
        ), previsao_recebimento AS (
         SELECT p.id, p.tenant_id, p.job_id, p.ordem, p.data_prevista, p.valor,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas,
            GREATEST(0::numeric, LEAST(p.valor,
              (COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric))
              - (sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id) - p.valor)
            ))::numeric(14,2) AS valor_proprio
           FROM jobs_previsao_recebimento p JOIN jobs j ON j.id = p.job_id
        ), envio_saldo AS (
         SELECT pa.id, pa.tenant_id, pa.job_id, pa.ordem, pa.data_vencimento,
            (pa.valor - COALESCE(( SELECT sum(fi.valor) FROM faturamento_itens fi
                     JOIN faturamentos f ON f.id = fi.faturamento_id
                  WHERE fi.envio_parcela_id = pa.id AND f.status <> 'cancelado'::faturamento_status), 0::numeric))::numeric(14,2) AS valor,
            count(*) OVER (PARTITION BY pa.envio_id) AS total_parcelas,
            GREATEST(0::numeric, LEAST(pa.valor,
              (COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric))
              - (sum(pa.valor) OVER (PARTITION BY pa.envio_id ORDER BY pa.ordem, pa.id) - pa.valor)
            ))::numeric(14,2) AS bruto_proprio
           FROM jobs_envio_faturamento_parcelas pa JOIN jobs j ON j.id = pa.job_id
        )
 SELECT 'realizado'::text AS situacao, 'lancamento'::text AS origem_tipo, l.id AS origem_id,
    l.tenant_id, l.empresa_id, l.conta_bancaria_id, l.data_movimento AS data_evento,
    (l.valor * lr.fator * lj.fator)::numeric(14,2) AS valor, l.natureza,
    CASE WHEN lj.save_job_id IS NOT NULL
         THEN l.descricao || ' · saldo em save de ' || COALESCE(sj.codigo, '—')
         ELSE l.descricao END AS descricao,
    l.fornecedor_id, l.cliente_id, lj.job_id, 'movimento'::text AS classe,
    lr.regional_id, l.origem::text AS origem_lancamento
   FROM lancamentos_financeiros l
     JOIN lancamento_rateio lr ON lr.lancamento_id = l.id
     JOIN lancamento_job lj ON lj.lancamento_id = l.id
     LEFT JOIN jobs sj ON sj.id = lj.save_job_id
UNION ALL
 SELECT 'previsto'::text, 'pp'::text, par.id, pp.tenant_id, pp.empresa_id, NULL::uuid,
    par.data_pagamento, par.valor::numeric(14,2), 'saida'::natureza_lancamento,
    (((((('PP '::text || pp.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(pp.servico, 1, 150),
    pp.fornecedor_id, NULL::uuid, pp.job_id, 'titulo'::text, jb.regional_id, NULL::text
   FROM pedidos_compra_parcelas par
     JOIN pedidos_compra pp ON pp.id = par.pedido_compra_id
     JOIN jobs jb ON jb.id = pp.job_id
     JOIN LATERAL ( SELECT count(*)::integer AS total FROM pedidos_compra_parcelas x WHERE x.pedido_compra_id = par.pedido_compra_id) tot ON true
  WHERE (pp.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status])) AND par.pago_em IS NULL
UNION ALL
 SELECT 'previsto'::text, CASE WHEN a.recorrente_id IS NOT NULL THEN 'recorrente'::text ELSE 'avulsa'::text END,
    a.id, a.tenant_id, a.empresa_id, NULL::uuid,
    COALESCE(a.data_pagamento, a.data_prevista_pagamento), (a.valor * ar.fator)::numeric(14,2),
    a.natureza, a.descricao, a.fornecedor_id, a.cliente_id, a.job_id, 'titulo'::text, ar.regional_id, NULL::text
   FROM contas_avulsas a JOIN avulsa_rateio ar ON ar.conta_avulsa_id = a.id
  WHERE a.status = 'aprovada'::conta_avulsa_status
UNION ALL
 SELECT 'previsto'::text, 'desembolso'::text, par.id, d.tenant_id, d.empresa_id, NULL::uuid,
    par.data_pagamento, par.valor, 'saida'::natureza_lancamento,
    (((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(d.descricao, 1, 150),
    d.fornecedor_id, d.cliente_id, d.job_id, 'titulo'::text, jb.regional_id, NULL::text
   FROM desembolsos_parcelas par
     JOIN desembolsos d ON d.id = par.desembolso_id
     LEFT JOIN jobs jb ON jb.id = d.job_id
     JOIN LATERAL ( SELECT count(*)::integer AS total FROM desembolsos_parcelas x WHERE x.desembolso_id = par.desembolso_id) tot ON true
  WHERE (d.status = ANY (ARRAY['aprovada'::desembolso_status, 'pago'::desembolso_status])) AND par.pago_em IS NULL
UNION ALL
-- Titulo em aberto: a parte propria, rateada entre os jobs da nota.
 SELECT 'previsto'::text, 'titulo'::text, t.id, t.tenant_id, t.empresa_id, NULL::uuid,
    COALESCE(t.data_previsao_recebimento, t.data_vencimento),
    (tp.valor_proprio * COALESCE(c.valor / NULLIF(ft.total, 0::numeric), 1::numeric))::numeric(14,2),
    'entrada'::natureza_lancamento,
    (('Título NF '::text || f.numero_nf) || '/'::text) || t.numero_parcela::text,
    f.fornecedor_id, f.cliente_id, c.job_id, 'titulo'::text,
    COALESCE(j.regional_id, e.regional_id), NULL::text
   FROM titulos_receber t
     JOIN titulo_partes tp ON tp.titulo_id = t.id
     JOIN faturamentos f ON f.id = t.faturamento_id
     LEFT JOIN fat_composicao c ON c.faturamento_id = t.faturamento_id
     LEFT JOIN fat_total ft ON ft.faturamento_id = t.faturamento_id
     LEFT JOIN jobs j ON j.id = c.job_id
     LEFT JOIN empresas e ON e.id = t.empresa_id
  WHERE t.status = 'em_aberto'::titulo_receber_status AND tp.valor_proprio > 0::numeric
UNION ALL
-- Titulo em aberto: a parte em save, SEM JOB ate alguem consumir.
 SELECT 'previsto'::text, 'titulo_save'::text, t.id, t.tenant_id, t.empresa_id, NULL::uuid,
    COALESCE(t.data_previsao_recebimento, t.data_vencimento),
    (t.valor - tp.valor_proprio)::numeric(14,2), 'entrada'::natureza_lancamento,
    ((('Título NF '::text || f.numero_nf) || '/'::text) || t.numero_parcela::text) || ' · saldo em save de ' || COALESCE(sj.codigo, '—'),
    f.fornecedor_id, f.cliente_id, NULL::uuid, 'titulo'::text,
    COALESCE(sj.regional_id, e.regional_id), NULL::text
   FROM titulos_receber t
     JOIN titulo_partes tp ON tp.titulo_id = t.id
     JOIN faturamentos f ON f.id = t.faturamento_id
     LEFT JOIN jobs sj ON sj.id = tp.save_job_id
     LEFT JOIN empresas e ON e.id = t.empresa_id
  WHERE t.status = 'em_aberto'::titulo_receber_status AND t.valor > tp.valor_proprio
UNION ALL
 SELECT 'previsto'::text, 'previsao_custo'::text, r.id, r.tenant_id, j.empresa_id, NULL::uuid,
    CASE WHEN r.data_prevista < CURRENT_DATE THEN fc_proxima_janela_pagamento(CURRENT_DATE) ELSE r.data_prevista END,
    r.valor, 'saida'::natureza_lancamento,
    (((('Cronograma de desembolsos · '::text || j.codigo) || ' '::text) || r.ordem) || '/'::text) || r.total_parcelas,
    NULL::uuid, pj.cliente_id, r.job_id, 'previsao'::text, j.regional_id, NULL::text
   FROM residuo_curva r JOIN jobs j ON j.id = r.job_id LEFT JOIN projetos pj ON pj.id = j.projeto_id
  WHERE r.valor > 0::numeric AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
UNION ALL
-- Previsao de recebimento: a parte propria do job.
 SELECT 'previsto'::text, 'previsao_recebimento'::text, p.id, p.tenant_id, j.empresa_id, NULL::uuid,
    CASE WHEN p.data_prevista < CURRENT_DATE THEN CURRENT_DATE + 1 ELSE p.data_prevista END,
    p.valor_proprio, 'entrada'::natureza_lancamento,
    (((('Previsão de recebimento · '::text || j.codigo) || ' '::text) || p.ordem) || '/'::text) || p.total_parcelas,
    NULL::uuid, pj.cliente_id, p.job_id, 'previsao'::text, j.regional_id, NULL::text
   FROM previsao_recebimento p JOIN jobs j ON j.id = p.job_id LEFT JOIN projetos pj ON pj.id = j.projeto_id
  WHERE p.valor_proprio > 0::numeric AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
    AND NOT (EXISTS ( SELECT 1 FROM jobs_com_envio ce WHERE ce.job_id = p.job_id))
UNION ALL
-- Previsao de recebimento: a parte em save, sem job.
 SELECT 'previsto'::text, 'previsao_recebimento_save'::text, p.id, p.tenant_id, j.empresa_id, NULL::uuid,
    CASE WHEN p.data_prevista < CURRENT_DATE THEN CURRENT_DATE + 1 ELSE p.data_prevista END,
    (p.valor - p.valor_proprio)::numeric(14,2), 'entrada'::natureza_lancamento,
    ((('Previsão de recebimento · '::text || j.codigo) || ' '::text) || p.ordem) || '/'::text || p.total_parcelas || ' · saldo em save',
    NULL::uuid, pj.cliente_id, NULL::uuid, 'previsao'::text, j.regional_id, NULL::text
   FROM previsao_recebimento p JOIN jobs j ON j.id = p.job_id LEFT JOIN projetos pj ON pj.id = j.projeto_id
  WHERE p.valor > p.valor_proprio AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
    AND NOT (EXISTS ( SELECT 1 FROM jobs_com_envio ce WHERE ce.job_id = p.job_id))
UNION ALL
-- Saldo do envio ainda nao faturado: parte propria e parte em save.
 SELECT 'previsto'::text, 'envio_parcela'::text, s.id, s.tenant_id, j.empresa_id, NULL::uuid,
    CASE WHEN s.data_vencimento < CURRENT_DATE THEN CURRENT_DATE + 1 ELSE s.data_vencimento END,
    LEAST(s.valor, s.bruto_proprio)::numeric(14,2), 'entrada'::natureza_lancamento,
    (((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text) || s.total_parcelas,
    NULL::uuid, pj.cliente_id, s.job_id, 'previsao'::text, j.regional_id, NULL::text
   FROM envio_saldo s JOIN jobs j ON j.id = s.job_id LEFT JOIN projetos pj ON pj.id = j.projeto_id
  WHERE LEAST(s.valor, s.bruto_proprio) > 0::numeric AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
UNION ALL
 SELECT 'previsto'::text, 'envio_parcela_save'::text, s.id, s.tenant_id, j.empresa_id, NULL::uuid,
    CASE WHEN s.data_vencimento < CURRENT_DATE THEN CURRENT_DATE + 1 ELSE s.data_vencimento END,
    (s.valor - LEAST(s.valor, s.bruto_proprio))::numeric(14,2), 'entrada'::natureza_lancamento,
    ((((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text) || s.total_parcelas) || ' · saldo em save',
    NULL::uuid, pj.cliente_id, NULL::uuid, 'previsao'::text, j.regional_id, NULL::text
   FROM envio_saldo s JOIN jobs j ON j.id = s.job_id LEFT JOIN projetos pj ON pj.id = j.projeto_id
  WHERE s.valor > LEAST(s.valor, s.bruto_proprio) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
UNION ALL
 SELECT 'previsto'::text, 'pp_devolucao_verba'::text, d.id, d.tenant_id, d.empresa_id, NULL::uuid,
    d.data_pagamento, d.valor, 'entrada'::natureza_lancamento,
    (('Devolução verba '::text || pp.codigo) || ' — '::text) || "substring"(pp.servico, 1, 140),
    NULL::uuid, NULL::uuid, pp.job_id, 'titulo'::text, jb.regional_id, NULL::text
   FROM pp_verba_devolucoes d
     JOIN pedidos_compra pp ON pp.id = d.pedido_compra_id
     LEFT JOIN jobs jb ON jb.id = pp.job_id
  WHERE d.pago_em IS NULL;
