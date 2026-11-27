-- Backfill: férias "concluidas" importadas em 2026-11-13 que ainda não aconteceram
--
-- Contexto:
-- Em 2026-11-13 17:54:48 UTC o RH importou um batch de lançamentos de férias
-- marcando-os diretamente como status='concluido' e lancado_direto_por_rh=true.
-- Essa importação pulou os passos que a aprovação normal faz:
--   (a) calcular valor_base_remuneracao / valor_ferias / valor_um_terco / valor_abono / valor_total
--   (b) criar as linhas em folhas_pagamento tipo='ferias'
--   (c) replicar a alocação vigente pra cada folha
--
-- Consequência prática: PJ/MEI/clt_recibo com férias futuras NÃO veem o card
-- "Anexar NF" no /perfil e o RH não tem onde anexar recibo dos CLT puros. A
-- view vw_nf_pendentes_colaborador depende de folhas_pagamento.
--
-- Decisão do RH (sessão 2026-11-27):
--   - Férias PASSADAS (data_fim < hoje): NÃO backfillar. Pagamento já saiu fora do sistema.
--   - Férias EM CURSO (data_inicio <= hoje <= data_fim): NÃO backfillar. Mesma razão.
--   - Férias FUTURAS (data_inicio > hoje): backfillar completo.
--
-- Esta migration roda APENAS pros 11 lançamentos futuros do batch de 2026-11-13.
-- Reaproveita a fórmula de lib/ferias/calcular-valores.ts e a regra de
-- decidirFolhasAInserir em lib/ferias/criar-folhas-pagamento.ts:
--   - usufruto         → 1 folha califórnia tipo=usufruto, base = valor_ferias + valor_um_terco
--   - abono_excepcional → 1 folha califórnia tipo=abono,    base = valor_abono + valor_um_terco
--   - CLT puro usufruto → 1 folha contabilidade tipo=usufruto, base = salario_total (ref.; RH substitui pelo recibo)
--
-- Idempotente: só atualiza lançamentos com valor_ferias IS NULL; só insere
-- folhas que ainda não existem pro par (lancamento_ferias_id, origem, tipo_folha_ferias).

BEGIN;

-- 1. CTE de alvos: só futuros, só importados sem valor
WITH alvos AS (
  SELECT
    l.id as lanc_id,
    l.tenant_id,
    l.colaborador_id,
    l.tipo,
    l.data_inicio,
    l.dias,
    COALESCE(l.dias_abono, 0) as dias_abono,
    c.tipo_contratacao,
    (
      SELECT s.valor::numeric
      FROM colaboradores_salarios s
      WHERE s.colaborador_id = l.colaborador_id
        AND s.data_inicio <= l.data_inicio
        AND (s.data_fim IS NULL OR s.data_fim >= l.data_inicio)
      ORDER BY s.data_inicio DESC
      LIMIT 1
    ) as salario
  FROM colaboradores_ferias_lancamentos l
  JOIN colaboradores c ON c.id = l.colaborador_id
  WHERE l.status = 'concluido'
    AND l.valor_ferias IS NULL
    AND l.lancado_direto_por_rh = true
    AND l.data_inicio > CURRENT_DATE
),
calc AS (
  SELECT
    a.*,
    CASE
      WHEN a.tipo IN ('abono_avulso','abono_excepcional') THEN 0::numeric
      WHEN a.tipo = 'abono_combinado' THEN ROUND(((a.salario / 30.0) * (a.dias - a.dias_abono))::numeric, 2)
      ELSE ROUND(((a.salario / 30.0) * a.dias)::numeric, 2)
    END as v_ferias,
    CASE
      WHEN a.tipo IN ('abono_avulso','abono_excepcional') THEN ROUND(((a.salario / 30.0) * a.dias)::numeric, 2)
      WHEN a.tipo = 'abono_combinado' THEN ROUND(((a.salario / 30.0) * a.dias_abono)::numeric, 2)
      ELSE 0::numeric
    END as v_abono
  FROM alvos a
),
calc2 AS (
  SELECT
    c.*,
    ROUND(((c.v_ferias + c.v_abono) / 3.0)::numeric, 2) as v_umterco
  FROM calc c
)
-- 2. Atualiza os valores no lançamento
UPDATE colaboradores_ferias_lancamentos l
SET
  valor_base_remuneracao = c.salario,
  valor_ferias = c.v_ferias,
  valor_um_terco = c.v_umterco,
  valor_abono = c.v_abono,
  valor_total = c.v_ferias + c.v_abono + c.v_umterco,
  updated_at = now()
FROM calc2 c
WHERE l.id = c.lanc_id;

-- 3. Cria folhas_pagamento pros lançamentos backfillados
--    Pro PJ (10 usufruto + 1 abono_excepcional): 1 folha california
--    Pro CLT puro (Nathalia, usufruto): 1 folha contabilidade
WITH alvos AS (
  SELECT
    l.id as lanc_id,
    l.tenant_id,
    l.colaborador_id,
    l.tipo,
    l.data_inicio,
    l.valor_ferias,
    l.valor_um_terco,
    l.valor_abono,
    c.tipo_contratacao,
    (
      SELECT s.valor::numeric
      FROM colaboradores_salarios s
      WHERE s.colaborador_id = l.colaborador_id
        AND s.data_inicio <= l.data_inicio
        AND (s.data_fim IS NULL OR s.data_fim >= l.data_inicio)
      ORDER BY s.data_inicio DESC
      LIMIT 1
    ) as salario_total
  FROM colaboradores_ferias_lancamentos l
  JOIN colaboradores c ON c.id = l.colaborador_id
  WHERE l.status = 'concluido'
    AND l.lancado_direto_por_rh = true
    AND l.data_inicio > CURRENT_DATE
    AND l.valor_ferias IS NOT NULL  -- já foi backfillado agora
),
folhas_a_inserir AS (
  -- PJ puro: só folha california
  SELECT
    a.tenant_id,
    a.colaborador_id,
    EXTRACT(YEAR FROM a.data_inicio)::smallint as competencia_ano,
    EXTRACT(MONTH FROM a.data_inicio)::smallint as competencia_mes,
    CASE
      WHEN a.tipo IN ('abono_avulso','abono_excepcional') THEN (a.valor_abono + a.valor_um_terco)
      ELSE (a.valor_ferias + a.valor_um_terco)
    END as salario_base,
    'california'::folha_origem as origem,
    CASE
      WHEN a.tipo IN ('abono_avulso','abono_excepcional') THEN 'abono'
      ELSE 'usufruto'
    END as tipo_folha_ferias,
    a.lanc_id as lancamento_ferias_id,
    public.fn_calcular_vencimento_ferias(a.data_inicio) as data_pagamento_prevista
  FROM alvos a
  WHERE a.tipo_contratacao = 'pj'

  UNION ALL

  -- CLT puro: só folha contabilidade, base = salário total (referência)
  SELECT
    a.tenant_id,
    a.colaborador_id,
    EXTRACT(YEAR FROM a.data_inicio)::smallint,
    EXTRACT(MONTH FROM a.data_inicio)::smallint,
    a.salario_total,
    'contabilidade'::folha_origem,
    CASE
      WHEN a.tipo IN ('abono_avulso','abono_excepcional') THEN 'abono'
      ELSE 'usufruto'
    END,
    a.lanc_id,
    public.fn_calcular_vencimento_ferias(a.data_inicio)
  FROM alvos a
  WHERE a.tipo_contratacao = 'clt'
)
INSERT INTO folhas_pagamento (
  tenant_id, colaborador_id, competencia_ano, competencia_mes,
  salario_base, status, origem, tipo, tipo_folha_ferias,
  lancamento_ferias_id, data_pagamento_prevista
)
SELECT
  f.tenant_id,
  f.colaborador_id,
  f.competencia_ano,
  f.competencia_mes,
  f.salario_base,
  'rascunho'::folha_linha_status,
  f.origem,
  'ferias'::folha_tipo,
  f.tipo_folha_ferias,
  f.lancamento_ferias_id,
  f.data_pagamento_prevista
FROM folhas_a_inserir f
WHERE NOT EXISTS (
  SELECT 1 FROM folhas_pagamento fp
  WHERE fp.lancamento_ferias_id = f.lancamento_ferias_id
    AND fp.origem = f.origem
    AND fp.tipo_folha_ferias = f.tipo_folha_ferias
);

-- 4. Replica alocação vigente pra cada folha recém-criada
--    (necessário pra aparecer na aba People do financeiro com alocação correta;
--    replicar_alocacao_para_folha é idempotente)
DO $$
DECLARE
  folha_rec RECORD;
BEGIN
  FOR folha_rec IN
    SELECT fp.id
    FROM folhas_pagamento fp
    JOIN colaboradores_ferias_lancamentos l ON l.id = fp.lancamento_ferias_id
    WHERE fp.tipo = 'ferias'
      AND l.status = 'concluido'
      AND l.lancado_direto_por_rh = true
      AND l.data_inicio > CURRENT_DATE
      AND fp.created_at >= now() - interval '5 minutes'  -- só as criadas agora
  LOOP
    PERFORM public.replicar_alocacao_para_folha(folha_rec.id);
  END LOOP;
END $$;

COMMIT;
