-- =====================================================================
-- Decisão 274 (pendência de 23/11/2026, Tiago: "corrija"): o BV de Mídia
-- Off aparece na fila de faturamento com nome.
-- ---------------------------------------------------------------------
-- A descrição do BV na fila (`vw_faturamento_pendente`) era
-- "BV — " || coalesce(item da versão, item do job). Na linha de Mídia Off o
-- item fica vazio (a linha é praça, veículo e meio), e o BV do veículo no
-- mês aparecia só como "BV — ". Agora, sem item, vale
-- "praça · agrupamento (meio) · MM/AAAA" — o veículo já está na coluna da
-- contraparte. Item preenchido segue como sempre; item vazio fora da mídia
-- deixa de mostrar o travessão sozinho.
--
-- Só muda a expressão `descricao` da parte do BV e ganha dois LEFT JOIN
-- (o agrupamento do job e o mês dele). Colunas, ordem, tipos e a parte do
-- job ficam idênticas: `create or replace view` mantém os GRANTs.
-- =====================================================================

create or replace view public.vw_faturamento_pendente as
 WITH parcela_faturada AS (
         SELECT fi.envio_parcela_id,
            sum(fi.valor)::numeric(14,2) AS valor_faturado,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo <> 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_save
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE f.status = 'emitido'::faturamento_status AND fi.envio_parcela_id IS NOT NULL
          GROUP BY fi.envio_parcela_id
        ), variacao_da_nota AS (
         SELECT r.envio_nota_id,
            sum(r.variacao_cambial)::numeric(14,2) AS variacao_cambial
           FROM recebimentos_antes_nf r
          WHERE (r.status = ANY (ARRAY['aguardando'::text, 'aplicado'::text])) AND r.variacao_cambial IS NOT NULL AND r.envio_nota_id IS NOT NULL
          GROUP BY r.envio_nota_id
        ), variacao AS (
         SELECT par.id,
                CASE
                    WHEN row_number() OVER (PARTITION BY par.nota_id ORDER BY par.ordem, par.id) = 1 THEN COALESCE(vn.variacao_cambial, 0::numeric)
                    ELSE 0::numeric
                END AS variacao_cambial
           FROM jobs_envio_faturamento_parcelas par
             LEFT JOIN variacao_da_nota vn ON vn.envio_nota_id = par.nota_id
        ), parcelas AS (
         SELECT par.id,
            par.envio_id,
            par.job_id,
            par.tenant_id,
            par.ordem,
            par.valor AS valor_enviado,
            (par.valor + va.variacao_cambial)::numeric(14,2) AS valor,
            va.variacao_cambial,
            par.data_vencimento,
            count(*) OVER (PARTITION BY par.envio_id)::smallint AS total,
            COALESCE(pf.valor_faturado, 0::numeric)::numeric(14,2) AS ja_faturado,
            COALESCE(pf.faturado_proprio, 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(pf.faturado_save, 0::numeric)::numeric(14,2) AS faturado_save,
            (GREATEST(0::numeric, LEAST(par.valor,
                CASE
                    WHEN e.mes IS NOT NULL THEN e.valor_faturado - COALESCE(e.valor_save, 0::numeric)
                    ELSE COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric)
                END - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor))) + va.variacao_cambial)::numeric(14,2) AS bruto_proprio,
            e.mes,
            par.nota_id,
            n.ordem AS nota_ordem,
            (( SELECT count(*) AS count
                   FROM jobs_envio_faturamento_notas n2
                  WHERE n2.envio_id = par.envio_id))::smallint AS nota_total,
            n.cnpj AS nota_cnpj,
            n.cnae_sugerido AS nota_cnae_sugerido,
            n.descritivo AS nota_descritivo,
            n.tomador_exterior AS nota_tomador_exterior
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs_envio_faturamento e ON e.id = par.envio_id
             JOIN jobs j ON j.id = par.job_id
             JOIN jobs_envio_faturamento_notas n ON n.id = par.nota_id
             JOIN variacao va ON va.id = par.id
             LEFT JOIN parcela_faturada pf ON pf.envio_parcela_id = par.id
        )
 SELECT 'job'::text AS origem_tipo,
    j.id AS origem_id,
    j.tenant_id,
    j.empresa_id,
    j.codigo,
    j.nome AS descricao,
    j.cliente_id,
    NULL::uuid AS fornecedor_id,
    par.valor_enviado::numeric AS valor_previsto,
    par.ja_faturado AS valor_ja_faturado,
    (par.valor - par.ja_faturado)::numeric(14,2) AS saldo,
    par.data_vencimento AS data_prevista,
    par.id AS envio_parcela_id,
    par.ordem AS parcela_numero,
    par.total AS parcela_total,
    ( SELECT sum(x.valor - x.ja_faturado)::numeric(14,2) AS sum
           FROM parcelas x
          WHERE x.envio_id = par.envio_id AND (x.valor - x.ja_faturado) > 0::numeric) AS saldo_job,
    LEAST(par.valor, par.bruto_proprio) AS valor_proprio_da_parcela,
    (par.valor - LEAST(par.valor, par.bruto_proprio))::numeric(14,2) AS valor_save_da_parcela,
    GREATEST(0::numeric, LEAST(par.valor, par.bruto_proprio) - par.faturado_proprio)::numeric(14,2) AS saldo_proprio,
    GREATEST(0::numeric, par.valor - LEAST(par.valor, par.bruto_proprio) - par.faturado_save)::numeric(14,2) AS saldo_save,
    j.id AS job_id,
    par.mes AS mes_referencia,
    par.nota_id AS envio_nota_id,
    par.nota_ordem,
    par.nota_total,
    par.nota_cnpj AS cnpj_tomador,
    par.nota_cnae_sugerido AS cnae_sugerido,
    par.nota_descritivo AS descritivo_nota,
    pe.nome AS autor_nome,
    ef.enviado_em AS autor_em,
    par.nota_tomador_exterior AS tomador_exterior,
    par.variacao_cambial
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
     JOIN jobs_envio_faturamento ef ON ef.id = par.envio_id
     LEFT JOIN profiles pe ON pe.id = ef.enviado_por
  WHERE (j.status = ANY (ARRAY['aberto'::job_status, 'encerrado'::job_status, 'finalizado'::job_status])) AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id,
    bv.tenant_id,
    NULL::uuid AS empresa_id,
    jbv.codigo,
    'BV — '::text || COALESCE(
      NULLIF(btrim(v.item), ''::text),
      NULLIF(btrim(jio.item), ''::text),
      -- Mídia Off (decisão 274): praça · agrupamento · mês.
      NULLIF(concat_ws(' · '::text, NULLIF(btrim(jio.praca), ''::text), jg.nome, to_char(mm.mes::timestamp, 'MM/YYYY'::text)), ''::text),
      'Item'::text
    ) AS descricao,
    NULL::uuid AS cliente_id,
    bv.fornecedor_id,
    bv.valor AS valor_previsto,
    0::numeric(14,2) AS valor_ja_faturado,
    bv.valor AS saldo,
    bv.prazo_repasse AS data_prevista,
    NULL::uuid AS envio_parcela_id,
    1::smallint AS parcela_numero,
    1::smallint AS parcela_total,
    bv.valor AS saldo_job,
    bv.valor AS valor_proprio_da_parcela,
    0::numeric(14,2) AS valor_save_da_parcela,
    bv.valor AS saldo_proprio,
    0::numeric(14,2) AS saldo_save,
    jio.job_id,
    NULL::date AS mes_referencia,
    NULL::uuid AS envio_nota_id,
    NULL::smallint AS nota_ordem,
    NULL::smallint AS nota_total,
    NULL::text AS cnpj_tomador,
    NULL::text AS cnae_sugerido,
    NULL::text AS descritivo_nota,
    pb.nome AS autor_nome,
    bv.confirmado_em AS autor_em,
    false AS tomador_exterior,
    0::numeric(14,2) AS variacao_cambial
   FROM itens_bv bv
     LEFT JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs_grupos jg ON jg.id = jio.job_grupo_id
     LEFT JOIN versoes_orcamento_meses mm ON mm.id = jg.mes_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
     LEFT JOIN profiles pb ON pb.id = bv.confirmado_por
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));
