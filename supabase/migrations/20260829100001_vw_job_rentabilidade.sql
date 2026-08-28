-- 2026-08-29 · Relatório de Rentabilidade
--
-- View agrega, por job, as bases usadas na fórmula gerencial de rentabilidade:
-- faturamento previsto/realizado, imposto previsto/realizado, custo realizado
-- bruto (com regra A/D) e BV realizado (bloco confirmado+recebido, líquido).
--
-- A fórmula de Result.Op continua em lib/calculos/versao-totais.ts — esta view
-- só entrega inputs prontos pra evitar carregar itens de N jobs em N queries no
-- server component do relatório (spec §3).
--
-- Regra A/D no custo: tipos A e D não geram PP (calha BV); o realizado desses
-- itens é o próprio total_orcado do item. Espelha realizadoBrutoDoItem() em
-- lib/calculos/bv-planilha.ts (linhas ~157-177). Se essa lógica mudar lá,
-- mudar aqui no mesmo commit — a divergência corrompe o relatório em silêncio.
--
-- Fonte do orçado/realizado do job: usamos a CÓPIA do job (jobs_itens_orcado /
-- jobs_itens_realizado), NÃO a versão aprovada. Errata do job só existe na
-- cópia; a versão aprovada é congelada. Ver docs/decisions sobre errata.
--
-- BV realizado: soma dos BVs com situacao IN ('confirmado','recebido') (o enum
-- bv_situacao NÃO tem 'realizado'), vinculados via itens_bv.job_item_orcado_id
-- → jobs_itens_orcado.id → job_id. O valor deduzido é o LÍQUIDO
-- (valor − valor × pct_imposto/100), como em bvLiquido() no bv-planilha.ts.
--
-- data_abertura_financeiro é timestamptz na tabela mas expomos como ::date no
-- output, porque o relatório filtra por período e mês/trimestre — matches spec.
--
-- Origem de cliente_id: jobs → projetos.cliente_id (não há coluna cliente_id em
-- orcamentos nem em jobs). marca_id: projetos.produto_id (referencia
-- cliente_produtos; jobs tem só um campo texto 'produto').
--
-- Segurança: security_invoker = true faz a view herdar RLS por tenant das
-- tabelas subjacentes. GRANT explícito pra authenticated (regra do projeto,
-- CLAUDE.md e docs/PERFORMANCE.md); nada pra anon.

CREATE OR REPLACE VIEW public.vw_job_rentabilidade
WITH (security_invoker = true) AS
SELECT
  j.id                                            AS job_id,
  j.tenant_id,
  j.empresa_id,
  j.regional_id,
  p.cliente_id,
  p.produto_id                                    AS marca_id,
  j.codigo                                        AS job_codigo,
  j.nome                                          AS job_nome,
  j.data_abertura_financeiro::date                AS data_abertura_financeiro,

  COALESCE(j.faturamento_previsto, 0)             AS faturamento_previsto,
  COALESCE(imp_prev.imposto, 0)                   AS imposto_previsto,

  COALESCE(fr.total, 0)                           AS faturamento_realizado,
  -- Imposto realizado: mesma alíquota da versão aprovada, gross-up sobre
  -- faturamento_realizado (base = faturamento_realizado, taxa = pct/100).
  -- Fórmula gross-up: base × t / (1 − t). Guarda pra pct >= 100 (nunca deve
  -- ocorrer, mas evita divisão por zero se dado torto).
  CASE
    WHEN COALESCE(fr.total, 0) = 0 THEN 0
    WHEN v.percentual_imposto >= 100 THEN 0
    ELSE COALESCE(fr.total, 0)
         * (v.percentual_imposto / 100.0)
         / (1 - v.percentual_imposto / 100.0)
  END                                              AS imposto_realizado,

  COALESCE(cr.total, 0)                           AS custo_realizado,
  COALESCE(bv.total, 0)                           AS bv_realizado

FROM public.jobs j
JOIN public.projetos p             ON p.id = j.projeto_id
JOIN public.orcamentos o           ON o.id = j.orcamento_id
JOIN public.versoes_orcamento v    ON v.id = j.versao_orcamento_aprovada_id

-- Imposto previsto: replica calcularTotaisVersao().imposto sobre os itens da
-- CÓPIA do job (jobs_itens_orcado). Assim errata do job já reflete no
-- previsto. Fórmula:
--   baseHonorarios = Σ total_orcado onde tipo ∈ (A,AR,B,D,F)
--   honorarios     = baseHonorarios × pct_honorarios/100
--   baseImposto    = Σ total_orcado onde tipo ∈ (B,C) + honorarios
--   imposto        = baseImposto × t / (1 − t),  t = pct_imposto/100
-- Linhas em_save ficam de fora (não têm custo — decisão 028 §9). Espelha
-- REGRAS_TIPO_CUSTO em lib/calculos/versao-totais.ts.
LEFT JOIN LATERAL (
  SELECT
    CASE
      WHEN v.percentual_imposto >= 100 THEN 0
      ELSE (
        (
          COALESCE(SUM(jio.total_orcado) FILTER (WHERE jio.tipo_custo IN ('B','C')), 0)
          + COALESCE(SUM(jio.total_orcado) FILTER (WHERE jio.tipo_custo IN ('A','AR','B','D','F')), 0)
            * (v.percentual_honorarios / 100.0)
        )
        * (v.percentual_imposto / 100.0)
        / (1 - v.percentual_imposto / 100.0)
      )
    END AS imposto
  FROM public.jobs_itens_orcado jio
  WHERE jio.job_id = j.id
    AND COALESCE(jio.em_save, false) = false
) imp_prev ON true

-- Faturamento realizado: soma dos envios de faturamento. Na prática há no
-- máximo um por job (ver carregar-detalhe.ts:222 — maybeSingle), mas SUM é
-- defensivo caso um dia tenha múltiplos.
LEFT JOIN LATERAL (
  SELECT SUM(valor_faturado) AS total
  FROM public.jobs_envio_faturamento
  WHERE job_id = j.id
) fr ON true

-- Custo realizado BRUTO: regra A/D usa total_orcado (não geram PP); demais
-- tipos usam total_realizado (soma das PPs, agregada pelo trigger da tabela
-- jobs_itens_realizado). Espelha realizadoBrutoDoItem() + jobJaAberto=true
-- (jobs cancelado/aguardando_abertura/rejeitado_financeiro estão fora do
-- WHERE final, então todos aqui já estão abertos).
LEFT JOIN LATERAL (
  SELECT SUM(
    CASE
      WHEN jio.tipo_custo IN ('A','D') THEN COALESCE(jio.total_orcado, 0)
      ELSE COALESCE(jir.total_realizado, 0)
    END
  ) AS total
  FROM public.jobs_itens_orcado jio
  LEFT JOIN public.jobs_itens_realizado jir
    ON jir.job_item_orcado_id = jio.id AND jir.job_id = j.id
  WHERE jio.job_id = j.id
    AND COALESCE(jio.em_save, false) = false
) cr ON true

-- BV realizado: soma dos BVs líquidos (valor − valor × pct_imposto/100) com
-- situacao IN ('confirmado','recebido') — bvContaNoRealizado() em
-- bv-planilha.ts. Enum bv_situacao não tem 'realizado' (labels são a_negociar,
-- confirmado, recebido, cancelado). O vínculo com o job é por
-- itens_bv.job_item_orcado_id → jobs_itens_orcado.id → job_id (a mesma cadeia
-- que carregar-detalhe.ts:197 usa para filtrar BVs do job).
LEFT JOIN LATERAL (
  SELECT SUM(
    COALESCE(ib.valor, 0)
    - COALESCE(ib.valor, 0) * (v.percentual_imposto / 100.0)
  ) AS total
  FROM public.itens_bv ib
  JOIN public.jobs_itens_orcado jio2 ON jio2.id = ib.job_item_orcado_id
  WHERE jio2.job_id = j.id
    AND ib.situacao IN ('confirmado', 'recebido')
) bv ON true

WHERE j.data_abertura_financeiro IS NOT NULL
  AND j.status NOT IN ('cancelado', 'aguardando_abertura', 'rejeitado_financeiro');

GRANT SELECT ON public.vw_job_rentabilidade TO authenticated;

-- Índice parcial pra acelerar filtros por período. data_abertura_financeiro
-- é o pivô do relatório (spec §3.5). Predicate espelha o WHERE da view pra
-- que o planner use o índice quando o relatório filtrar por mês/trimestre.
CREATE INDEX IF NOT EXISTS idx_jobs_abertura_financeiro
  ON public.jobs (tenant_id, data_abertura_financeiro)
  WHERE data_abertura_financeiro IS NOT NULL
    AND status NOT IN ('cancelado', 'aguardando_abertura', 'rejeitado_financeiro');
