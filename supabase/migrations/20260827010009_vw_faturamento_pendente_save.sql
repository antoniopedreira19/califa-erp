-- =====================================================================
-- SAVE — a fila de faturamento mostra a quebra job x save
--
-- A parcela do envio vale o `faturamento_previsto` inteiro, save
-- incluido. Quem emite a nota precisa ver quanto daquele saldo e do job e
-- quanto e saldo em save — sao dois itens de nota diferentes, e o save
-- tem teto proprio (20260827010007).
--
-- Colunas novas, no FIM (o `create or replace view` exige que as antigas
-- mantenham nome, tipo e ordem):
--
--   valor_proprio_da_parcela / valor_save_da_parcela — a divisao BRUTA da
--     parcela, pela regra JOB PRIMEIRO: as primeiras parcelas do envio
--     cobrem a parte propria e o save ocupa o fim da fila.
--   saldo_proprio / saldo_save — o que ainda cabe faturar de cada um.
--     `saldo_proprio + saldo_save = saldo`, sempre.
--
-- O ja faturado NAO e estimado: `faturamento_itens` guarda o
-- `origem_tipo` de cada item, entao da para saber exatamente quanto ja
-- saiu de job e quanto ja saiu de save.
--
-- Sem save, `valor_save_da_parcela` e zero e `saldo_proprio` e o `saldo`
-- de sempre — a fila continua identica.
--
-- Conferido com dado temporario: JOB-0015, previsto R$ 41.754,69 com
-- R$ 12.526,41 de save, em tres parcelas de R$ 13.918,23. As duas
-- primeiras saem inteiras como proprio e a terceira parte em R$ 1.391,82
-- de job + R$ 12.526,41 de save, fechando os R$ 29.228,28 de proprio.
-- =====================================================================

create or replace view public.vw_faturamento_pendente as
 WITH parcela_faturada AS (
         SELECT fi.envio_parcela_id,
            sum(fi.valor)::numeric(14,2) AS valor_faturado,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo <> 'save'::faturamento_origem), 0)::numeric(14,2) AS faturado_proprio,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem), 0)::numeric(14,2) AS faturado_save
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE f.status = 'emitido'::faturamento_status AND fi.envio_parcela_id IS NOT NULL
          GROUP BY fi.envio_parcela_id
        ), parcelas AS (
         SELECT par.id, par.envio_id, par.job_id, par.tenant_id, par.ordem, par.valor,
            par.data_vencimento,
            count(*) OVER (PARTITION BY par.envio_id)::smallint AS total,
            COALESCE(pf.valor_faturado, 0::numeric)::numeric(14,2) AS ja_faturado,
            COALESCE(pf.faturado_proprio, 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(pf.faturado_save, 0::numeric)::numeric(14,2) AS faturado_save,
            -- JOB PRIMEIRO: o save ocupa o fim da fila das parcelas do envio.
            GREATEST(0::numeric, LEAST(par.valor,
              (COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric))
              - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor)
            ))::numeric(14,2) AS bruto_proprio
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs j ON j.id = par.job_id
             LEFT JOIN parcela_faturada pf ON pf.envio_parcela_id = par.id
        )
 SELECT 'job'::text AS origem_tipo,
    j.id AS origem_id, j.tenant_id, j.empresa_id, j.codigo, j.nome AS descricao,
    p.cliente_id, NULL::uuid AS fornecedor_id,
    par.valor::numeric AS valor_previsto,
    par.ja_faturado AS valor_ja_faturado,
    (par.valor - par.ja_faturado)::numeric(14,2) AS saldo,
    par.data_vencimento AS data_prevista,
    par.id AS envio_parcela_id, par.ordem AS parcela_numero, par.total AS parcela_total,
    ( SELECT sum(x.valor - x.ja_faturado)::numeric(14,2) AS sum
           FROM parcelas x
          WHERE x.envio_id = par.envio_id AND (x.valor - x.ja_faturado) > 0::numeric) AS saldo_job,
    LEAST(par.valor, par.bruto_proprio)::numeric(14,2) AS valor_proprio_da_parcela,
    (par.valor - LEAST(par.valor, par.bruto_proprio))::numeric(14,2) AS valor_save_da_parcela,
    GREATEST(0::numeric, LEAST(par.valor, par.bruto_proprio) - par.faturado_proprio)::numeric(14,2) AS saldo_proprio,
    GREATEST(0::numeric, (par.valor - LEAST(par.valor, par.bruto_proprio)) - par.faturado_save)::numeric(14,2) AS saldo_save
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
  WHERE j.status = 'aberto'::job_status AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id, bv.tenant_id, NULL::uuid AS empresa_id, NULL::text AS codigo,
    'BV — '::text || v.item AS descricao,
    NULL::uuid AS cliente_id, bv.fornecedor_id,
    bv.valor AS valor_previsto, 0::numeric(14,2) AS valor_ja_faturado,
    bv.valor AS saldo, bv.prazo_repasse AS data_prevista,
    NULL::uuid AS envio_parcela_id, 1::smallint AS parcela_numero, 1::smallint AS parcela_total,
    bv.valor AS saldo_job,
    bv.valor::numeric(14,2) AS valor_proprio_da_parcela,
    0::numeric(14,2) AS valor_save_da_parcela,
    bv.valor::numeric(14,2) AS saldo_proprio,
    0::numeric(14,2) AS saldo_save
   FROM itens_bv bv
     JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));
