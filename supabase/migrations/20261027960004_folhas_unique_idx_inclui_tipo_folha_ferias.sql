-- =====================================================================
-- Fix: índice único de folhas_pagamento precisa incluir tipo_folha_ferias
--
-- Por que: `abono_combinado` deve gerar DUAS folhas california (usufruto
-- + abono) e DUAS folhas contabilidade (idem) no mesmo mês/colaborador/
-- origem. O índice antigo
--   (tenant, ano, mes, colaborador, origem, tipo)
-- barrava a segunda folha com unique_violation, deixando o lançamento
-- aprovado mas com folhas incompletas (0 ou 1 em vez de 4).
--
-- Caso real: Antonio Pedreira (TESTE), lançamento 6db106e8 (clt_recibo,
-- abono_combinado 30 dias + 10 vendidos). Depois do GRANT da RPC
-- fn_calcular_vencimento_ferias, a 1ª folha (california/usufruto)
-- entraria, mas a 2ª (california/abono) explodia na constraint.
--
-- Solução: índice único passa a incluir `tipo_folha_ferias`, com
-- NULLS NOT DISTINCT (PG 15+). Pra tipo != 'ferias' o campo é NULL
-- e vira chave única — mantém o invariante antigo de "um salário/13º
-- por mês/colab/origem". Pra tipo = 'ferias', usufruto e abono viram
-- chaves distintas.
--
-- Mudança aditiva (drop + recreate do índice; não afeta dados).
-- =====================================================================

drop index if exists public.folhas_pagamento_tenant_ano_mes_colab_origem_tipo_idx;

create unique index folhas_pagamento_tenant_ano_mes_colab_origem_tipo_ff_idx
  on public.folhas_pagamento
    (tenant_id, competencia_ano, competencia_mes, colaborador_id, origem, tipo, tipo_folha_ferias)
  nulls not distinct;

comment on index public.folhas_pagamento_tenant_ano_mes_colab_origem_tipo_ff_idx is
  'Garante unicidade de folhas por (tenant, mês, colaborador, origem, tipo, tipo_folha_ferias). Para abono_combinado permite usufruto + abono no mesmo mês/origem; para salario/13 (tipo_folha_ferias NULL) mantém unicidade com NULLS NOT DISTINCT.';
