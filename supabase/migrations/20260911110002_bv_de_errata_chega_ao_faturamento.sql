-- =====================================================================
-- O BV de linha de errata chega ao faturamento
--
-- CORREÇÃO da 20260911110001, achada na conferência ao vivo do JOB-0029.
--
-- A 073 destravou o BV na linha nascida de errata, e o percurso de tela
-- funcionou inteiro: lançar, salvar, reabrir, recusar sem alíquota e
-- confirmar. Só que o BV confirmado NÃO APARECEU no contas a receber.
--
-- A causa é o INNER JOIN desta view:
--
--     FROM itens_bv bv
--       JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
--
-- BV de linha de errata tem `item_versao_id` nulo — o join o descarta. E
-- a descrição saía de `v.item`, que também só existe do lado da versão.
--
-- É o mesmo desenho que o `carregar-detalhe.ts` já tinha abandonado em
-- 27/08/2026, com o comentário "pelo caminho antigo ela sumiria da lista
-- em silêncio". A leitura da planilha foi corrigida naquele dia; a fila
-- de faturamento ficou para trás e ninguém notou, porque até ontem não
-- existia BV confirmado em lugar nenhum.
--
-- O QUE MUDA, e só isto:
--
--   1. o JOIN em `versoes_orcamento_itens` vira LEFT JOIN;
--   2. a descrição passa a ser `coalesce(v.item, jio.item)` — o nome do
--      item vem da versão quando ela existe, e da cópia do job quando
--      não existe.
--
-- Nenhuma outra linha da view muda. `chk_bv_tem_item` (da 110001)
-- garante que pelo menos uma das duas pontas existe, então a descrição
-- nunca fica nula.
--
-- As outras duas views que leem `itens_bv` já estavam certas e não são
-- tocadas aqui: `vw_fluxo_caixa` e `vw_job_rentabilidade` entram pela
-- cópia do job (`job_item_orcado_id`), conferido antes de escrever isto.
--
-- Decisão 073.
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
        ), parcelas AS (
         SELECT par.id,
            par.envio_id,
            par.job_id,
            par.tenant_id,
            par.ordem,
            par.valor,
            par.data_vencimento,
            count(*) OVER (PARTITION BY par.envio_id)::smallint AS total,
            COALESCE(pf.valor_faturado, 0::numeric)::numeric(14,2) AS ja_faturado,
            COALESCE(pf.faturado_proprio, 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(pf.faturado_save, 0::numeric)::numeric(14,2) AS faturado_save,
            GREATEST(0::numeric, LEAST(par.valor, COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric) - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor)))::numeric(14,2) AS bruto_proprio
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs j ON j.id = par.job_id
             LEFT JOIN parcela_faturada pf ON pf.envio_parcela_id = par.id
        )
 SELECT 'job'::text AS origem_tipo,
    j.id AS origem_id,
    j.tenant_id,
    j.empresa_id,
    j.codigo,
    j.nome AS descricao,
    p.cliente_id,
    NULL::uuid AS fornecedor_id,
    par.valor::numeric AS valor_previsto,
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
    j.id AS job_id
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
  WHERE j.status = 'aberto'::job_status AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id,
    bv.tenant_id,
    NULL::uuid AS empresa_id,
    jbv.codigo,
    'BV — '::text || COALESCE(v.item, jio.item) AS descricao,
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
    jio.job_id
   FROM itens_bv bv
     LEFT JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));

comment on view public.vw_faturamento_pendente is
  'Fila do contas a receber: parcelas de job abertas e BVs confirmados ainda nao faturados. O BV entra pela versao OU pela copia do job — linha nascida de errata so tem a segunda (decisao 073).';

-- A view existia sem GRANT explicito nesta migration; reafirmar mantem o
-- padrao do projeto e nao muda nada para quem ja lia.
grant select on public.vw_faturamento_pendente to authenticated;
revoke all on public.vw_faturamento_pendente from anon;
