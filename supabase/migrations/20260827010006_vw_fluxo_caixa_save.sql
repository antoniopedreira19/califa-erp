-- =====================================================================
-- SAVE — o fluxo de caixa separa job de save, e o save migra para quem
-- o consome
--
-- Decisao docs/decisions/023, com as regras de fluxo definidas pelo Tiago
-- em 26/08/2026:
--
--   * JOB PRIMEIRO, DEPOIS O SAVE. Onde o recebimento se divide em
--     parcelas, as primeiras cobrem a parte propria do job e o save ocupa
--     o fim da fila; a parcela que cruza a fronteira parte em duas. Vale
--     para a previsao da abertura, o saldo do envio, os titulos da nota e
--     as baixas. Em nota agrupada os jobs se dividem entre si
--     proporcionalmente, como ja faziam, e o save vem por ultimo.
--   * O dinheiro em save entra SEM JOB — nao e do job que faturou nem de
--     ninguem — mas a origem nunca se perde: "saldo em save de JOB-XXXX".
--   * Quando um job consome, o valor correspondente passa a ser DELE, NA
--     DATA EM QUE O DINHEIRO ENTROU, mesmo que anterior a abertura dele.
--     A linha de save encolhe na mesma medida, entao o total da empresa
--     no periodo nao muda: so muda de quem e. Consumido tudo, a linha de
--     save zera e sobram so os jobs.
--
-- COMO A ATRIBUICAO E FEITA: `save_fatias_ord` poe todo o dinheiro em
-- save de um job de origem numa lista cronologica, cada fatia com um
-- intervalo [ini, fim) num eixo de dinheiro acumulado.
-- `save_consumo_ord` faz o mesmo com os consumos, ja convertidos de
-- principal para dinheiro (`faturamento_save_previsto × consumido /
-- principal`). `save_alocado` cruza os dois pela SOBREPOSICAO dos
-- intervalos — o padrao de "alocar A sobre B" — e o resultado e o consumo
-- cronologico: o job consumidor leva os pedacos mais antigos primeiro, e
-- por isso o dinheiro ja recebido aparece no fluxo dele na data em que de
-- fato entrou.
--
-- So conta consumo ja copiado para o job (`job_item_orcado_id`). Enquanto
-- o orcamento nao virou job, e RESERVA: aparece na planilha e nao move
-- dinheiro no fluxo de ninguem.
--
-- NAO MUDA NADA ONDE NAO HA SAVE. Conferido por impressao digital da
-- saida da view antes e depois: 35 linhas, R$ 2.174.187,25, md5 igual.
--
-- De onde vem "quanto e save": da nota, por `origem_tipo = 'save'`; do
-- job, por `jobs.faturamento_save_previsto`. A matriz de
-- REGRAS_TIPO_CUSTO NAO se repete em SQL — foi para isso que a coluna
-- existe.
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

-- ---------------------------------------------------------------------
-- O SALDO EM SAVE E QUEM O CONSOME
--
-- Todo dinheiro em save de um job de origem, em UMA lista, na ordem
-- cronologica: a baixa ja realizada, o titulo em aberto, a previsao da
-- abertura e o saldo do envio. Cada fatia ganha o intervalo [ini, fim)
-- num eixo de dinheiro acumulado.
-- ---------------------------------------------------------------------
        ), save_fatias AS (
         SELECT lj.save_job_id, 'realizado'::text AS situacao, 'movimento'::text AS classe,
            'lancamento_save'::text AS origem_tipo, l.id AS origem_id, l.tenant_id, l.empresa_id,
            l.conta_bancaria_id, l.data_movimento AS data_evento,
            (l.valor * lr.fator * lj.fator)::numeric(14,2) AS valor,
            l.descricao AS base, l.cliente_id, l.fornecedor_id, lr.regional_id,
            l.origem::text AS origem_lancamento
           FROM lancamentos_financeiros l
             JOIN lancamento_rateio lr ON lr.lancamento_id = l.id
             JOIN lancamento_job lj ON lj.lancamento_id = l.id
          WHERE lj.save_job_id IS NOT NULL
        UNION ALL
         SELECT tp.save_job_id, 'previsto'::text, 'titulo'::text, 'titulo_save'::text, t.id,
            t.tenant_id, t.empresa_id, NULL::uuid,
            COALESCE(t.data_previsao_recebimento, t.data_vencimento),
            (t.valor - tp.valor_proprio)::numeric(14,2),
            ('Título NF ' || f.numero_nf) || '/' || t.numero_parcela::text,
            f.cliente_id, f.fornecedor_id, COALESCE(sj.regional_id, e.regional_id), NULL::text
           FROM titulos_receber t
             JOIN titulo_partes tp ON tp.titulo_id = t.id
             JOIN faturamentos f ON f.id = t.faturamento_id
             LEFT JOIN jobs sj ON sj.id = tp.save_job_id
             LEFT JOIN empresas e ON e.id = t.empresa_id
          WHERE t.status = 'em_aberto'::titulo_receber_status AND t.valor > tp.valor_proprio
        UNION ALL
         SELECT p.job_id, 'previsto'::text, 'previsao'::text, 'previsao_recebimento_save'::text, p.id,
            p.tenant_id, j.empresa_id, NULL::uuid,
            CASE WHEN p.data_prevista < CURRENT_DATE THEN CURRENT_DATE + 1 ELSE p.data_prevista END,
            (p.valor - p.valor_proprio)::numeric(14,2),
            ('Previsão de recebimento · ' || j.codigo || ' ' || p.ordem || '/' || p.total_parcelas),
            pj.cliente_id, NULL::uuid, j.regional_id, NULL::text
           FROM previsao_recebimento p JOIN jobs j ON j.id = p.job_id
             LEFT JOIN projetos pj ON pj.id = j.projeto_id
          WHERE p.valor > p.valor_proprio
            AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
            AND NOT (EXISTS ( SELECT 1 FROM jobs_com_envio ce WHERE ce.job_id = p.job_id))
        UNION ALL
         SELECT s.job_id, 'previsto'::text, 'previsao'::text, 'envio_parcela_save'::text, s.id,
            s.tenant_id, j.empresa_id, NULL::uuid,
            CASE WHEN s.data_vencimento < CURRENT_DATE THEN CURRENT_DATE + 1 ELSE s.data_vencimento END,
            (s.valor - LEAST(s.valor, s.bruto_proprio))::numeric(14,2),
            ('Faturamento previsto · ' || j.codigo || ' parcela ' || s.ordem || '/' || s.total_parcelas),
            pj.cliente_id, NULL::uuid, j.regional_id, NULL::text
           FROM envio_saldo s JOIN jobs j ON j.id = s.job_id
             LEFT JOIN projetos pj ON pj.id = j.projeto_id
          WHERE s.valor > LEAST(s.valor, s.bruto_proprio)
            AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
        ), save_fatias_ord AS (
         SELECT f.*,
            sum(f.valor) OVER w - f.valor AS ini,
            sum(f.valor) OVER w AS fim
           FROM save_fatias f
          WHERE f.valor > 0::numeric
         WINDOW w AS (PARTITION BY f.save_job_id ORDER BY f.data_evento, f.origem_tipo, f.origem_id)

-- Quanto de DINHEIRO cada consumo leva. O consumo e em principal; a
-- receita migrada e proporcional (decisao 023 §4):
--   migrado = faturamento_save_previsto × consumido / principal_gerado
-- So consumo ja copiado para o job conta: enquanto o orcamento nao virou
-- job, e reserva, e nao aparece no fluxo de ninguem.
        ), save_gerado AS (
         SELECT o.job_id, sum(o.total_orcado) AS principal
           FROM jobs_itens_orcado o WHERE o.em_save GROUP BY o.job_id
        ), save_consumo_ord AS (
         SELECT c.job_origem_id, oc.job_id AS job_consumidor, c.id,
            ((c.valor / NULLIF(g.principal, 0::numeric)) * COALESCE(jo.faturamento_save_previsto, 0::numeric))::numeric(14,2) AS valor,
            sum(((c.valor / NULLIF(g.principal, 0::numeric)) * COALESCE(jo.faturamento_save_previsto, 0::numeric))::numeric(14,2)) OVER w2
              - ((c.valor / NULLIF(g.principal, 0::numeric)) * COALESCE(jo.faturamento_save_previsto, 0::numeric))::numeric(14,2) AS ini,
            sum(((c.valor / NULLIF(g.principal, 0::numeric)) * COALESCE(jo.faturamento_save_previsto, 0::numeric))::numeric(14,2)) OVER w2 AS fim
           FROM saves_consumos c
             JOIN jobs_itens_orcado oc ON oc.id = c.job_item_orcado_id
             JOIN jobs jo ON jo.id = c.job_origem_id
             JOIN save_gerado g ON g.job_id = c.job_origem_id
          WHERE c.job_item_orcado_id IS NOT NULL
         WINDOW w2 AS (PARTITION BY c.job_origem_id ORDER BY c.created_at, c.id)

-- O cruzamento: sobreposicao dos dois intervalos no eixo do dinheiro.
-- E o mesmo consumo cronologico do resto do sistema — o job consumidor
-- leva os pedacos mais antigos primeiro, e por isso o dinheiro ja
-- recebido aparece no fluxo dele na data em que de fato entrou.
        ), save_alocado AS (
         SELECT f.origem_id, f.origem_tipo, f.situacao, f.classe, f.tenant_id, f.empresa_id,
            f.conta_bancaria_id, f.data_evento, f.base, f.cliente_id, f.fornecedor_id,
            f.origem_lancamento, f.save_job_id, c.job_consumidor, c.id AS consumo_id,
            (LEAST(f.fim, c.fim) - GREATEST(f.ini, c.ini))::numeric(14,2) AS valor,
            jc.regional_id
           FROM save_fatias_ord f
             JOIN save_consumo_ord c ON c.job_origem_id = f.save_job_id
             JOIN jobs jc ON jc.id = c.job_consumidor
          WHERE LEAST(f.fim, c.fim) - GREATEST(f.ini, c.ini) > 0.004
        )
 SELECT 'realizado'::text AS situacao, 'lancamento'::text AS origem_tipo, l.id AS origem_id,
    l.tenant_id, l.empresa_id, l.conta_bancaria_id, l.data_movimento AS data_evento,
    (l.valor * lr.fator * lj.fator)::numeric(14,2) AS valor, l.natureza,
    l.descricao,
    l.fornecedor_id, l.cliente_id, lj.job_id, 'movimento'::text AS classe,
    lr.regional_id, l.origem::text AS origem_lancamento
   FROM lancamentos_financeiros l
     JOIN lancamento_rateio lr ON lr.lancamento_id = l.id
     JOIN lancamento_job lj ON lj.lancamento_id = l.id
  WHERE lj.save_job_id IS NULL
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
-- Saldo do envio ainda nao faturado: parte propria e parte em save.
 SELECT 'previsto'::text, 'envio_parcela'::text, s.id, s.tenant_id, j.empresa_id, NULL::uuid,
    CASE WHEN s.data_vencimento < CURRENT_DATE THEN CURRENT_DATE + 1 ELSE s.data_vencimento END,
    LEAST(s.valor, s.bruto_proprio)::numeric(14,2), 'entrada'::natureza_lancamento,
    (((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text) || s.total_parcelas,
    NULL::uuid, pj.cliente_id, s.job_id, 'previsao'::text, j.regional_id, NULL::text
   FROM envio_saldo s JOIN jobs j ON j.id = s.job_id LEFT JOIN projetos pj ON pj.id = j.projeto_id
  WHERE LEAST(s.valor, s.bruto_proprio) > 0::numeric AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status]))
UNION ALL
 SELECT 'previsto'::text, 'pp_devolucao_verba'::text, d.id, d.tenant_id, d.empresa_id, NULL::uuid,
    d.data_pagamento, d.valor, 'entrada'::natureza_lancamento,
    (('Devolução verba '::text || pp.codigo) || ' — '::text) || "substring"(pp.servico, 1, 140),
    NULL::uuid, NULL::uuid, pp.job_id, 'titulo'::text, jb.regional_id, NULL::text
   FROM pp_verba_devolucoes d
     JOIN pedidos_compra pp ON pp.id = d.pedido_compra_id
     LEFT JOIN jobs jb ON jb.id = pp.job_id
  WHERE d.pago_em IS NULL
UNION ALL
-- O SALDO EM SAVE que ainda ninguem consumiu. Sem job, e com a origem na
-- descricao: o dinheiro entrou, mas ainda nao custeia trabalho nenhum.
 SELECT f.situacao, f.origem_tipo, f.origem_id, f.tenant_id, f.empresa_id, f.conta_bancaria_id,
    f.data_evento,
    (f.valor - COALESCE(al.alocado, 0::numeric))::numeric(14,2),
    'entrada'::natureza_lancamento,
    f.base || ' · saldo em save de ' || COALESCE(sj.codigo, '—'),
    f.fornecedor_id, f.cliente_id, NULL::uuid, f.classe, f.regional_id, f.origem_lancamento
   FROM save_fatias_ord f
     LEFT JOIN jobs sj ON sj.id = f.save_job_id
     LEFT JOIN LATERAL ( SELECT sum(a.valor) AS alocado FROM save_alocado a
                          WHERE a.origem_id = f.origem_id AND a.origem_tipo = f.origem_tipo) al ON true
  WHERE f.valor - COALESCE(al.alocado, 0::numeric) > 0.004
UNION ALL
-- O SAVE JA CONSUMIDO, atribuido ao job que o gastou e NA DATA EM QUE O
-- DINHEIRO ENTROU — que pode ser anterior a abertura desse job (decisao
-- do Tiago, 26/08/2026). A linha de save acima encolhe na mesma medida,
-- entao o total da empresa no periodo nao muda: so muda de quem e.
 SELECT a.situacao, a.origem_tipo || '_consumido', a.origem_id, a.tenant_id, a.empresa_id,
    a.conta_bancaria_id, a.data_evento, a.valor, 'entrada'::natureza_lancamento,
    a.base || ' · save de ' || COALESCE(so.codigo, '—') || ' consumido por ' || COALESCE(jc.codigo, '—'),
    a.fornecedor_id, a.cliente_id, a.job_consumidor, a.classe, a.regional_id, a.origem_lancamento
   FROM save_alocado a
     LEFT JOIN jobs so ON so.id = a.save_job_id
     LEFT JOIN jobs jc ON jc.id = a.job_consumidor;
